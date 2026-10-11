/**
 * S3-compatible storage controller (works with AWS S3 and MinIO)
 */

import type { S3Client as S3ClientType, } from "@aws-sdk/client-s3";
import {
    DEFAULT_MAX_FILE_SIZE,
    S3StorageConfig,
    StorageController,
    type StoredObjectInfo,
    type StoredObjectRange,
    type PutObjectOptions,
    type StoredObjectStream
} from "./types";
import { folderKey, listingPrefix } from "./keys";
import { webStreamFrom } from "./streams";
import { ApiError } from "../api/errors";
import { validateUploadedFile } from "./upload-validation";
import {
    DownloadConfig,
    DownloadMetadata,
    StorageListResult,
    StorageReference,
    UploadFileProps,
    UploadFileResult
} from "@rebasepro/types";

let _s3Module: typeof import("@aws-sdk/client-s3") | undefined;
let _presignerModule: typeof import("@aws-sdk/s3-request-presigner") | undefined;

async function loadS3() {
    if (!_s3Module) {
        try {
            _s3Module = await import("@aws-sdk/client-s3");
        } catch {
            throw new Error(
                "@aws-sdk/client-s3 is required for S3 storage. " +
                "Install it: pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner"
            );
        }
    }
    return _s3Module;
}

async function loadPresigner() {
    if (!_presignerModule) {
        try {
            _presignerModule = await import("@aws-sdk/s3-request-presigner");
        } catch {
            throw new Error(
                "@aws-sdk/s3-request-presigner is required for S3 storage. " +
                "Install it: pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner"
            );
        }
    }
    return _presignerModule;
}

/** Files up to this size are one `PutObject`; larger ones are uploaded in parts of (at least) this size. */
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
/** S3's limit on the parts of one upload. */
const MAX_MULTIPART_PARTS = 10_000;

/**
 * S3-compatible storage implementation
 * Works with AWS S3 and MinIO (with forcePathStyle option)
 */
export class S3StorageController implements StorageController {
    private config: S3StorageConfig;
    private _client: S3ClientType | undefined;

    constructor(config: S3StorageConfig) {
        this.config = config;
    }

    /**
     * Lazily create and cache the S3 client on first use
     */
    private async getClient(): Promise<S3ClientType> {
        if (!this._client) {
            const s3 = await loadS3();
            this._client = new s3.S3Client({
                region: this.config.region || "us-east-1",
                endpoint: this.config.endpoint,
                forcePathStyle: this.config.forcePathStyle ?? !!this.config.endpoint, // Auto-enable for custom endpoints (MinIO)
                credentials: {
                    accessKeyId: this.config.accessKeyId,
                    secretAccessKey: this.config.secretAccessKey
                }
            });
        }
        return this._client;
    }

    getType(): "s3" {
        return "s3";
    }

    /**
     * The configured bucket, and the logical `default` that maps to it.
     *
     * Any other name went straight to S3 as a bucket name, so the request
     * parameter was a way to address *any* bucket the deployment's credentials
     * can reach — and a mistyped one came back as "file not found".
     */
    knownBuckets(): string[] {
        return ["default", this.config.bucket];
    }

    /** See {@link StorageController.maxFileSize}. */
    maxFileSize(): number {
        return this.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    }

    /**
     * Validate file before upload
     */
    private validateFile(file: File): void {
        validateUploadedFile(file, this.maxFileSize(), this.config.allowedMimeTypes);
    }

    /**
     * Get the bucket name - either from parameter or config
     */
    private getBucket(bucket?: string): string {
        // "default" is a logical bucket name used by local storage;
        // for S3 it should resolve to the configured bucket.
        if (!bucket || bucket === "default") return this.config.bucket;
        return bucket;
    }

    async putObject({
        file,
        key,
        metadata,
        bucket
    }: UploadFileProps, options?: PutObjectOptions): Promise<UploadFileResult> {
        if (options?.uploadLimits !== false) this.validateFile(file);

        const usedBucket = this.getBucket(bucket);
        const s3 = await loadS3();
        const client = await this.getClient();
        const target = {
            Bucket: usedBucket,
            Key: key,
            ContentType: file.type,
            Metadata: metadata ? this.flattenMetadata(metadata) : undefined
        };

        if (file.size <= MULTIPART_PART_SIZE) {
            // One request from one buffer, as always: a small file is no bigger
            // than a part. `Buffer.from(arrayBuffer)` is a view, not a copy.
            await client.send(new s3.PutObjectCommand({ ...target, Body: Buffer.from(await file.arrayBuffer()) }))
                .catch((error: unknown) => { throw misconfiguredOr(error, usedBucket); });
        } else {
            await this.putMultipart(target, file);
        }

        return {
            key,
            bucket: usedBucket,
            storageUrl: `s3://${usedBucket}/${key}`
        };
    }

    /**
     * Upload a large file in parts, one part in memory at a time.
     *
     * Reading the whole file into one buffer held it twice over (the
     * `arrayBuffer()`, then the SDK's view and the multipart parser's copy
     * before it), and `PutObject` stops at 5 GB regardless. A slice of a
     * `File` reads only that range — from disk, for the disk-backed files TUS
     * and backups hand over — so memory is one part whatever the file's size.
     * A failure aborts the upload: no partial object appears at the key, and
     * no orphaned parts are kept (and billed).
     */
    private async putMultipart(
        target: { Bucket: string; Key: string; ContentType: string; Metadata?: Record<string, string> },
        file: Blob
    ): Promise<void> {
        const s3 = await loadS3();
        const client = await this.getClient();
        // At most 10,000 parts: a part grows past 8 MiB only beyond 80 GB.
        const partSize = Math.max(MULTIPART_PART_SIZE, Math.ceil(file.size / MAX_MULTIPART_PARTS));
        const { UploadId } = await client.send(new s3.CreateMultipartUploadCommand(target))
            .catch((error: unknown) => { throw misconfiguredOr(error, target.Bucket); });
        if (!UploadId) throw new Error(`S3 did not start a multipart upload for ${target.Key}.`);
        const { Bucket, Key } = target;
        try {
            const parts: { ETag?: string; PartNumber: number }[] = [];
            for (let offset = 0, PartNumber = 1; offset < file.size; offset += partSize, PartNumber++) {
                const Body = Buffer.from(await file.slice(offset, Math.min(offset + partSize, file.size)).arrayBuffer());
                const { ETag } = await client.send(new s3.UploadPartCommand({ Bucket, Key, UploadId, PartNumber, Body }));
                parts.push({ ETag, PartNumber });
            }
            await client.send(new s3.CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: parts } }));
        } catch (error: unknown) {
            await client.send(new s3.AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => undefined);
            throw misconfiguredOr(error, Bucket);
        }
    }

    /**
     * Flatten nested metadata to string values (S3 requirement)
     */
    private flattenMetadata(metadata: Record<string, unknown>): Record<string, string> {
        const flattened: Record<string, string> = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (typeof value === "string") {
                flattened[key] = value;
            } else if (value !== undefined && value !== null) {
                flattened[key] = JSON.stringify(value);
            }
        }
        return flattened;
    }

    async getSignedUrl(key: string, bucket?: string): Promise<DownloadConfig> {
        // Handle s3:// and gs:// URLs for backward compatibility
        let resolvedPath = key;
        let resolvedBucket = this.getBucket(bucket);

        const match = key.match(/^(s3|gs):\/\//);
        if (match) {
            const protocolLength = match[0].length;
            const withoutProtocol = key.substring(protocolLength);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        try {
            const s3 = await loadS3();
            const presigner = await loadPresigner();
            const client = await this.getClient();

            // First check if the object exists and get metadata
            const headCommand = new s3.HeadObjectCommand({
                Bucket: resolvedBucket,
                Key: resolvedPath
            });

            const headResult = await client.send(headCommand);

            // Generate a signed URL
            const getCommand = new s3.GetObjectCommand({
                Bucket: resolvedBucket,
                Key: resolvedPath
            });

            const expiresIn = this.config.signedUrlExpiration ?? 3600;
            const url = await presigner.getSignedUrl(client, getCommand, { expiresIn });

            const metadata: DownloadMetadata = {
                bucket: resolvedBucket,
                fullPath: resolvedPath,
                name: resolvedPath.split("/").pop() || resolvedPath,
                size: headResult.ContentLength || 0,
                contentType: headResult.ContentType || "application/octet-stream",
                customMetadata: headResult.Metadata || {}
            };

            return {
                url,
                metadata
            };
        } catch (error: unknown) {
            if (isS3NotFound(error)) {
                return {
                    url: null,
                    fileNotFound: true
                };
            }
            throw misconfiguredOr(error, resolvedBucket);
        }
    }

    async getObject(key: string, bucket?: string): Promise<File | null> {
        // Handle s3:// and gs:// URLs
        let resolvedPath = key;
        let resolvedBucket = this.getBucket(bucket);

        const match = key.match(/^(s3|gs):\/\//);
        if (match) {
            const protocolLength = match[0].length;
            const withoutProtocol = key.substring(protocolLength);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        try {
            const s3 = await loadS3();
            const client = await this.getClient();

            const command = new s3.GetObjectCommand({
                Bucket: resolvedBucket,
                Key: resolvedPath
            });

            const response = await client.send(command);

            if (!response.Body) {
                return null;
            }

            // Convert stream to buffer
            const chunks: Uint8Array[] = [];
            for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const contentType = response.ContentType || "application/octet-stream";
            const fileName = resolvedPath.split("/").pop() || resolvedPath;

            const blob = new Blob([buffer], { type: contentType });
            // The object's own version. Left out, `File` stamps `Date.now()`,
            // and the routes build the `ETag`, `Last-Modified` and the
            // transform cache key from this — so every read was a new version:
            // no 304, no cache hit, and a fresh rendition written per request.
            return new File([blob], fileName, {
                type: contentType,
                lastModified: response.LastModified?.getTime()
            });
        } catch (error: unknown) {
            if (isS3NotFound(error)) {
                return null;
            }
            throw misconfiguredOr(error, resolvedBucket);
        }
    }

    /**
     * The bucket and key a call addresses: an `s3://` or `gs://` URL names its
     * own bucket, anything else is a key in the given (or configured) bucket.
     */
    private resolveLocation(key: string, bucket?: string): { bucket: string; key: string } {
        const match = key.match(/^(s3|gs):\/\//);
        if (match) {
            const withoutProtocol = key.substring(match[0].length);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                return { bucket: withoutProtocol.substring(0, firstSlash), key: withoutProtocol.substring(firstSlash + 1) };
            }
        }
        return { bucket: this.getBucket(bucket), key };
    }

    /**
     * See {@link StorageController.getMetadata}. One `HeadObject`. Without it,
     * `GET /metadata/*` fell back to `getSignedUrl`, which signed a URL per
     * call — ~134 µs of CPU — only for the route to throw it away.
     */
    async getMetadata(key: string, bucket?: string): Promise<DownloadMetadata | null> {
        const location = this.resolveLocation(key, bucket);
        const s3 = await loadS3();
        const client = await this.getClient();
        try {
            const head = await client.send(new s3.HeadObjectCommand({ Bucket: location.bucket, Key: location.key }));
            return {
                bucket: location.bucket,
                fullPath: location.key,
                name: location.key.split("/").pop() || location.key,
                size: head.ContentLength || 0,
                contentType: head.ContentType || "application/octet-stream",
                customMetadata: head.Metadata || {}
            };
        } catch (error: unknown) {
            if (isS3NotFound(error)) return null;
            throw misconfiguredOr(error, location.bucket);
        }
    }

    /** See {@link StorageController.statObject}. One `HeadObject`; no body is read. */
    async statObject(key: string, bucket?: string): Promise<StoredObjectInfo | null> {
        const location = this.resolveLocation(key, bucket);
        const s3 = await loadS3();
        const client = await this.getClient();
        try {
            const head = await client.send(new s3.HeadObjectCommand({ Bucket: location.bucket, Key: location.key }));
            return {
                size: head.ContentLength ?? 0,
                contentType: head.ContentType || "application/octet-stream",
                // The object's version — see `getObject` on why a missing one
                // must not become a stable value.
                lastModified: head.LastModified?.getTime() ?? Date.now()
            };
        } catch (error: unknown) {
            if (isS3NotFound(error)) return null;
            throw misconfiguredOr(error, location.bucket);
        }
    }

    /**
     * See {@link StorageController.getObjectStream}. One `GetObject`, with a
     * `Range` when one is asked for, so only those bytes leave the bucket; the
     * body is handed on as it arrives rather than collected first.
     */
    async getObjectStream(
        key: string,
        options?: { bucket?: string; range?: StoredObjectRange }
    ): Promise<StoredObjectStream | null> {
        const location = this.resolveLocation(key, options?.bucket);
        const range = options?.range;
        const s3 = await loadS3();
        const client = await this.getClient();
        let response;
        try {
            response = await client.send(new s3.GetObjectCommand({
                Bucket: location.bucket,
                Key: location.key,
                ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {})
            }));
        } catch (error: unknown) {
            if (isS3NotFound(error)) return null;
            // The object shrank below the range since it was described. Read
            // it whole: the caller serves a whole object as a 200, which HTTP
            // allows for any range request.
            if (range && isS3RangeNotSatisfiable(error)) return this.getObjectStream(key, { bucket: options?.bucket });
            throw misconfiguredOr(error, location.bucket);
        }
        const body = response.Body;
        if (!body) return null;

        // A ranged answer says the whole object's size after the slash of its
        // `Content-Range`. A store that ignored the `Range` sent no
        // `Content-Range` and the whole object, which is what this then says.
        const total = range ? /\/(\d+)\s*$/.exec(response.ContentRange ?? "")?.[1] : undefined;
        const served = range && total !== undefined ? range : undefined;
        return {
            stream: isByteIterable(body) ? webStreamFrom(body) : body.transformToWebStream(),
            size: total !== undefined ? Number(total) : response.ContentLength ?? 0,
            contentType: response.ContentType || "application/octet-stream",
            lastModified: response.LastModified?.getTime() ?? Date.now(),
            ...(served ? { range: served } : {})
        };
    }

    async deleteObject(key: string, bucket?: string): Promise<void> {
        // Handle s3:// and gs:// URLs
        let resolvedPath = key;
        let resolvedBucket = this.getBucket(bucket);

        const match = key.match(/^(s3|gs):\/\//);
        if (match) {
            const protocolLength = match[0].length;
            const withoutProtocol = key.substring(protocolLength);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        const s3 = await loadS3();
        const client = await this.getClient();

        const command = new s3.DeleteObjectCommand({
            Bucket: resolvedBucket,
            Key: resolvedPath
        });

        // Deleting something that is already gone is the outcome the caller
        // wanted, so it is not an error. AWS itself answers DeleteObject with
        // 204 for a key that never existed, but S3-compatible backends (MinIO,
        // Ceph, R2 in some configurations) do raise NoSuchKey — and the local
        // controller has always returned quietly in this case. Without this,
        // which of those a deployment happens to run decides whether
        // `DELETE /api/storage/:path` on a stale reference is a 200 or a 500.
        try {
            await client.send(command);
        } catch (error: unknown) {
            if (isS3NotFound(error)) {
                return;
            }
            throw misconfiguredOr(error, resolvedBucket);
        }
    }

    async listObjects(prefix: string, options?: {
        bucket?: string;
        maxResults?: number;
        pageToken?: string;
    }): Promise<StorageListResult> {
        const resolvedBucket = this.getBucket(options?.bucket);

        const s3 = await loadS3();
        const client = await this.getClient();

        const folderPrefix = listingPrefix(prefix);
        const command = new s3.ListObjectsV2Command({
            Bucket: resolvedBucket,
            Prefix: folderPrefix,
            MaxKeys: options?.maxResults ?? 1000,
            ContinuationToken: options?.pageToken,
            Delimiter: "/" // This gives us folder-like behavior
        });

        const response = await client.send(command)
            .catch((error: unknown) => { throw misconfiguredOr(error, resolvedBucket); });

        // The folder's own marker — the zero-byte `folder/` object that
        // `POST /folder` writes — is in `Contents` when the listed prefix is
        // that folder. It is how the folder exists, not something in it, and
        // listed it is an entry with an empty name. Local storage has no such
        // object to list.
        const objects = (response.Contents || []).filter(obj => obj.Key !== folderPrefix);
        const items: StorageReference[] = objects.map(obj => ({
            bucket: resolvedBucket,
            fullPath: obj.Key || "",
            name: (obj.Key || "").split("/").pop() || "",
            // What the listing already carries, so a folder can be shown
            // without a HEAD per file. ListObjectsV2 has no content type.
            ...(typeof obj.Size === "number" ? { size: obj.Size } : {}),
            ...(obj.LastModified instanceof Date ? { updated: obj.LastModified.toISOString() } : {}),
            parent: null as never,
            root: null as never,
            toString: () => `s3://${resolvedBucket}/${obj.Key}`
        }));

        const prefixes: StorageReference[] = (response.CommonPrefixes || []).map(common => {
            // Without the trailing slash S3 puts on a common prefix, so a
            // `fullPath` from a listing is a key any controller accepts.
            const folder = folderKey(common.Prefix || "");
            return {
                bucket: resolvedBucket,
                fullPath: folder,
                name: folder.split("/").pop() || "",
                parent: null as never,
                root: null as never,
                toString: () => `s3://${resolvedBucket}/${folder}`
            };
        });

        return {
            items,
            prefixes,
            nextPageToken: response.NextContinuationToken
        };
    }
}

/** The error name and HTTP status an SDK error carries, read without assuming its shape. */
function s3ErrorFacts(error: unknown): { name?: string; status?: number } {
    if (typeof error !== "object" || error === null) return {};
    const name = "name" in error && typeof error.name === "string" ? error.name : undefined;
    const meta = "$metadata" in error ? error.$metadata : undefined;
    const status = typeof meta === "object" && meta !== null && "httpStatusCode" in meta && typeof meta.httpStatusCode === "number"
        ? meta.httpStatusCode
        : undefined;
    return { name, status };
}

/**
 * A missing object, as `GetObject` (`NoSuchKey`) and `HeadObject` (`NotFound`, no body) report it.
 *
 * Not a missing bucket, which is a 404 too: read as a missing object, a typo in
 * `S3_BUCKET` made every file of the deployment "not found", and a delete
 * report success. (A `HeadObject` on a missing bucket carries no error name, so
 * that one call still cannot tell the two apart.)
 */
function isS3NotFound(error: unknown): boolean {
    const { name, status } = s3ErrorFacts(error);
    if (name === "NoSuchBucket") return false;
    return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/** What S3 answers when the deployment's configuration, not the request, is wrong. */
const MISCONFIGURATION_ERRORS = new Set(["NoSuchBucket", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"]);

/**
 * A provider error that says this deployment's storage is misconfigured, as a
 * `502 STORAGE_MISCONFIGURED` naming the bucket — or the error as it was.
 *
 * These used to reach the caller as a bare 500 "Internal Server Error", with
 * nothing to say the bucket or its credentials were the problem.
 */
function misconfiguredOr(error: unknown, bucket: string): unknown {
    const { name } = s3ErrorFacts(error);
    if (!name || !MISCONFIGURATION_ERRORS.has(name)) return error;
    return new ApiError(
        502,
        "STORAGE_MISCONFIGURED",
        name === "NoSuchBucket"
            ? `The storage bucket "${bucket}" does not exist. Check the bucket name this source is configured with (S3_BUCKET, or S3_BUCKET__<KEY> for a named source).`
            : `The storage provider refused this deployment's credentials for bucket "${bucket}" (${name}). Check the access key and its permissions on the bucket.`,
        { bucket, reason: name }
    );
}

function isS3RangeNotSatisfiable(error: unknown): boolean {
    const { name, status } = s3ErrorFacts(error);
    return name === "InvalidRange" || status === 416;
}

/** A Node response body — what the SDK hands over on Node — rather than a browser one. */
function isByteIterable(value: unknown): value is AsyncIterable<Uint8Array> {
    return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
