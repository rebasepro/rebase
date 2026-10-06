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
    type StoredObjectStream
} from "./types";
import { folderKey, listingPrefix } from "./keys";
import { webStreamFrom } from "./streams";
import { ApiError } from "../api/errors";
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
        const maxSize = this.maxFileSize();
        if (file.size > maxSize) {
            // An ApiError, so the refusal reaches the caller as what it is. A
            // plain Error was a 500 on `/upload` and a 502 on TUS — after the
            // client had sent every byte.
            throw new ApiError(
                413,
                "PAYLOAD_TOO_LARGE",
                `File size ${file.size} exceeds this storage source's maximum of ${maxSize} bytes.`,
                { size: file.size, maxFileSize: maxSize }
            );
        }

        if (this.config.allowedMimeTypes && this.config.allowedMimeTypes.length > 0) {
            if (!this.config.allowedMimeTypes.includes(file.type)) {
                throw new Error(`File type ${file.type} is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(", ")}`);
            }
        }
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
    }: UploadFileProps): Promise<UploadFileResult> {
        this.validateFile(file);

        const usedBucket = this.getBucket(bucket);

        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const s3 = await loadS3();
        const client = await this.getClient();

        const command = new s3.PutObjectCommand({
            Bucket: usedBucket,
            Key: key,
            Body: buffer,
            ContentType: file.type,
            Metadata: metadata ? this.flattenMetadata(metadata) : undefined
        });

        await client.send(command);

        return {
            key,
            bucket: usedBucket,
            storageUrl: `s3://${usedBucket}/${key}`
        };
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
            const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Error.name === "NotFound" || s3Error.$metadata?.httpStatusCode === 404) {
                return {
                    url: null,
                    fileNotFound: true
                };
            }
            throw error;
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
            const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw error;
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
            throw error;
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
            throw error;
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
            const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
                return;
            }
            throw error;
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

        const response = await client.send(command);

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

/** A missing object, as `GetObject` (`NoSuchKey`) and `HeadObject` (`NotFound`, no body) report it. */
function isS3NotFound(error: unknown): boolean {
    const { name, status } = s3ErrorFacts(error);
    return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

function isS3RangeNotSatisfiable(error: unknown): boolean {
    const { name, status } = s3ErrorFacts(error);
    return name === "InvalidRange" || status === 416;
}

/** A Node response body — what the SDK hands over on Node — rather than a browser one. */
function isByteIterable(value: unknown): value is AsyncIterable<Uint8Array> {
    return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
