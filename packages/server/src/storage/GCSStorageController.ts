/**
 * Google Cloud Storage controller (works with GCS and Firebase Storage)
 *
 * The `@google-cloud/storage` package is loaded lazily so it remains an
 * optional peer dependency — users who don't need GCS never pay for the
 * import cost or need it installed.
 */

import type { FileMetadata } from "@google-cloud/storage";
import {
    StorageController,
    GCSStorageConfig,
    DEFAULT_MAX_FILE_SIZE,
    type StoredObjectInfo,
    type StoredObjectRange,
    type PutObjectOptions,
    type StoredObjectStream
} from "./types";
import { folderKey, listingPrefix } from "./keys";
import { bufferWebStream, bytesView, webStreamFrom } from "./streams";
import { ApiError } from "../api/errors";
import {
    UploadFileProps,
    UploadFileResult,
    DownloadConfig,
    DownloadMetadata,
    StorageListResult,
    StorageReference
} from "@rebasepro/types";

// ---------------------------------------------------------------------------
// Lazy import of @google-cloud/storage
// ---------------------------------------------------------------------------

let gcsModule: typeof import("@google-cloud/storage") | null = null;

async function loadGCS(): Promise<typeof import("@google-cloud/storage")> {
    if (gcsModule) return gcsModule;
    try {
        gcsModule = await import("@google-cloud/storage");
        return gcsModule;
    } catch {
        throw new Error(
            "Google Cloud Storage is required for the GCS storage controller. " +
            "Install it with: pnpm add @google-cloud/storage"
        );
    }
}

// ---------------------------------------------------------------------------
// GCSStorageController
// ---------------------------------------------------------------------------

/**
 * Google Cloud Storage implementation of `StorageController`.
 *
 * Works with standard GCS buckets **and** Firebase Storage buckets
 * (e.g. `"my-project.appspot.com"`).
 */
export class GCSStorageController implements StorageController {
    private config: GCSStorageConfig;
    private client: InstanceType<typeof import("@google-cloud/storage").Storage> | null = null;

    constructor(config: GCSStorageConfig) {
        this.config = config;
    }

    // ------------------------------------------------------------------
    // Lazy client initialisation
    // ------------------------------------------------------------------

    private async getClient(): Promise<InstanceType<typeof import("@google-cloud/storage").Storage>> {
        if (this.client) return this.client;
        const { Storage } = await loadGCS();
        this.client = new Storage({
            projectId: this.config.projectId,
            keyFilename: this.config.keyFilename,
            credentials: this.config.credentials
        });
        return this.client;
    }

    // ------------------------------------------------------------------
    // StorageController interface
    // ------------------------------------------------------------------

    getType(): "gcs" {
        return "gcs";
    }

    /**
     * The configured bucket, and the logical `default` that maps to it.
     * @see S3StorageController.knownBuckets
     */
    knownBuckets(): string[] {
        return ["default", this.config.bucket];
    }

    async putObject({
        file,
        key,
        metadata,
        bucket
    }: UploadFileProps, options?: PutObjectOptions): Promise<UploadFileResult> {
        if (options?.uploadLimits !== false) this.validateFile(file);

        const usedBucket = this.getBucket(bucket);
        const client = await this.getClient();
        const gcsFile = client.bucket(usedBucket).file(key);

        // Streamed from the file a chunk at a time. Read into one buffer first,
        // it was held whole (twice, with the copy) for the length of the
        // upload. Handed over as a function so the client can open it again to
        // retry, which it does not do for a stream it was given once.
        await gcsFile.save(() => byteChunks(file), {
            contentType: file.type,
            metadata: metadata ? { metadata: this.flattenMetadata(metadata) } : undefined
        });

        return {
            key,
            bucket: usedBucket,
            storageUrl: `gs://${usedBucket}/${key}`
        };
    }

    /**
     * Read the object's metadata and nothing else — no signing.
     *
     * Signing needs a private key. With `keyFilename` or `credentials` the
     * client has one; on Cloud Run, GKE or GCE it has only the metadata
     * server's token, and falls back to the IAM Credentials `signBlob` API,
     * which the runtime account may call on itself only when it holds
     * `iam.serviceAccounts.signBlob` there. That is not a default grant.
     */
    async getMetadata(key: string, bucket?: string): Promise<DownloadMetadata | null> {
        // Handle gs:// and s3:// URLs
        let resolvedPath = key;
        let resolvedBucket = this.getBucket(bucket);

        const match = key.match(/^(gs|s3):\/\//);
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
            const client = await this.getClient();
            const [fileMetadata] = await client.bucket(resolvedBucket).file(resolvedPath).getMetadata();

            return {
                bucket: resolvedBucket,
                fullPath: resolvedPath,
                name: resolvedPath.split("/").pop() || resolvedPath,
                size: Number(fileMetadata.size) || 0,
                contentType: fileMetadata.contentType || "application/octet-stream",
                customMetadata: (fileMetadata.metadata as Record<string, string> | undefined) || {}
            };
        } catch (error: unknown) {
            if (isNotFoundError(error)) {
                return null;
            }
            throw error;
        }
    }

    async getSignedUrl(key: string, bucket?: string): Promise<DownloadConfig> {
        // Metadata first, to check existence and populate the response.
        const metadata = await this.getMetadata(key, bucket);
        if (!metadata) {
            return {
                url: null,
                fileNotFound: true
            };
        }

        const client = await this.getClient();
        const expiresIn = this.config.signedUrlExpiration ?? 3600;
        const [url] = await client.bucket(metadata.bucket).file(metadata.fullPath).getSignedUrl({
            action: "read",
            expires: Date.now() + expiresIn * 1000
        });

        return {
            url,
            metadata
        };
    }

    /**
     * The object's bytes, type and version — all three of ONE generation.
     *
     * Described first, then read pinned to the generation described, as
     * {@link getObjectStream} reads. It used to download and then ask for the
     * metadata: an overwrite between the two calls answered the old bytes
     * under the new generation's `updated`, and that `lastModified` keys the
     * routes' `ETag` and transform cache, so the stale bytes — or a rendition
     * of them — were served as current. A pinned read of a generation replaced
     * since it was described fails, and the object is described again.
     */
    async getObject(key: string, bucket?: string): Promise<File | null> {
        for (let attempt = 1; ; attempt++) {
            const located = await this.locate(key, bucket);
            if (!located) return null;

            let contents: Buffer;
            try {
                contents = await this.readDecompressed(located);
            } catch (error: unknown) {
                // Replaced or deleted since it was described. Three
                // overwrites inside one read is a write loop, not a race.
                if (isNotFoundError(error) && attempt < 3) continue;
                if (isNotFoundError(error)) {
                    throw new Error(`The object "${located.key}" changed on every read; try again.`);
                }
                throw error;
            }

            const contentType = located.meta.contentType || "application/octet-stream";
            // The object's own version — see `S3StorageController.getObject`.
            const updated = typeof located.meta.updated === "string" ? Date.parse(located.meta.updated) : NaN;
            return new File([bytesView(contents)], located.key.split("/").pop() || located.key, {
                type: contentType,
                lastModified: Number.isNaN(updated) ? undefined : updated
            });
        }
    }

    /**
     * The bucket and key a call addresses: a `gs://` or `s3://` URL names its
     * own bucket, anything else is a key in the given (or configured) bucket.
     */
    private resolveLocation(key: string, bucket?: string): { bucket: string; key: string } {
        const match = key.match(/^(gs|s3):\/\//);
        if (match) {
            const withoutProtocol = key.substring(match[0].length);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                return { bucket: withoutProtocol.substring(0, firstSlash), key: withoutProtocol.substring(firstSlash + 1) };
            }
        }
        return { bucket: this.getBucket(bucket), key };
    }

    /** The object's metadata and where it lives, or `null` when there is no such object. */
    private async locate(key: string, bucket?: string): Promise<{ bucket: string; key: string; meta: FileMetadata } | null> {
        const location = this.resolveLocation(key, bucket);
        const client = await this.getClient();
        try {
            const [meta] = await client.bucket(location.bucket).file(location.key).getMetadata();
            return { ...location, meta };
        } catch (error: unknown) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    /**
     * The generation just described, so an overwrite between describing an
     * object and reading it fails the read instead of sending the new bytes
     * under the old size and version.
     */
    private async pinnedFile(located: { bucket: string; key: string; meta: FileMetadata }) {
        const client = await this.getClient();
        const generation = located.meta.generation;
        return client.bucket(located.bucket).file(located.key, generation !== undefined ? { generation } : {});
    }

    /**
     * An object stored gzip-encoded (`gsutil cp -z`) is decompressed on the way
     * out, so its stored size is not the size served and a range of the one is
     * not a range of the other. Such an object is read whole, as every object
     * used to be; nothing this server writes is stored that way.
     */
    private async readDecompressed(located: { bucket: string; key: string; meta: FileMetadata }): Promise<Buffer> {
        const [contents] = await (await this.pinnedFile(located)).download();
        return contents;
    }

    /** See {@link StorageController.statObject}. One metadata request; no body is read. */
    async statObject(key: string, bucket?: string): Promise<StoredObjectInfo | null> {
        const located = await this.locate(key, bucket);
        if (!located) return null;
        const info = storedObjectInfo(located.meta);
        if (located.meta.contentEncoding === "gzip") {
            return { ...info, size: (await this.readDecompressed(located)).byteLength };
        }
        return info;
    }

    /**
     * See {@link StorageController.getObjectStream}. One metadata request, then
     * a read of exactly the requested bytes, handed on as they arrive.
     *
     * The metadata comes first, not after the download as `getObject` has it:
     * it is what pins the read to one generation.
     */
    async getObjectStream(
        key: string,
        options?: { bucket?: string; range?: StoredObjectRange }
    ): Promise<StoredObjectStream | null> {
        const located = await this.locate(key, options?.bucket);
        if (!located) return null;
        const info = storedObjectInfo(located.meta);
        const range = options?.range;

        if (located.meta.contentEncoding === "gzip") {
            const contents = await this.readDecompressed(located);
            const inRange = range && range.end < contents.byteLength && range.start <= range.end;
            return {
                ...info,
                size: contents.byteLength,
                stream: bufferWebStream(inRange ? contents.subarray(range.start, range.end + 1) : contents),
                ...(inRange ? { range } : {})
            };
        }

        const file = await this.pinnedFile(located);
        return {
            ...info,
            // Opened on the first read: nothing is requested from the bucket
            // for a stream the caller ends up not reading.
            stream: webStreamFrom(() => file.createReadStream(range ? { start: range.start, end: range.end } : {})),
            ...(range ? { range } : {})
        };
    }

    async deleteObject(key: string, bucket?: string): Promise<void> {
        // Handle gs:// and s3:// URLs
        let resolvedPath = key;
        let resolvedBucket = this.getBucket(bucket);

        const match = key.match(/^(gs|s3):\/\//);
        if (match) {
            const protocolLength = match[0].length;
            const withoutProtocol = key.substring(protocolLength);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        const client = await this.getClient();
        const gcsFile = client.bucket(resolvedBucket).file(resolvedPath);

        await gcsFile.delete({ ignoreNotFound: true });
    }

    async listObjects(prefix: string, options?: {
        bucket?: string;
        maxResults?: number;
        pageToken?: string;
    }): Promise<StorageListResult> {
        const resolvedBucket = this.getBucket(options?.bucket);
        const client = await this.getClient();
        const gcsBucket = client.bucket(resolvedBucket);

        // Fetch files (objects) matching the prefix
        const folderPrefix = listingPrefix(prefix);
        const [listed, , filesApiResponse] = await gcsBucket.getFiles({
            prefix: folderPrefix,
            delimiter: "/",
            maxResults: options?.maxResults ?? 1000,
            pageToken: options?.pageToken,
            autoPaginate: false
        });

        // The folder's own marker object is not something in the folder —
        // see `S3StorageController.listObjects`.
        const files = listed.filter(file => file.name !== folderPrefix);
        const items: StorageReference[] = files.map(file => ({
            bucket: resolvedBucket,
            fullPath: file.name,
            name: file.name.split("/").pop() || "",
            // Each listed object arrives with its full metadata, so a folder
            // can be shown without a metadata request per file.
            ...listedFacts(file.metadata),
            parent: null as never,
            root: null as never,
            toString: () => `gs://${resolvedBucket}/${file.name}`
        }));

        // Common prefixes (folder-like entries) come from the API response
        const apiPrefixes: string[] =
            (filesApiResponse as Record<string, unknown> | undefined)?.prefixes as string[] ?? [];

        const prefixes: StorageReference[] = apiPrefixes.map(p => {
            // Without the trailing slash GCS puts on a common prefix, so a
            // `fullPath` from a listing is a key any controller accepts.
            const folder = folderKey(p);
            return {
                bucket: resolvedBucket,
                fullPath: folder,
                name: folder.split("/").pop() || "",
                parent: null as never,
                root: null as never,
                toString: () => `gs://${resolvedBucket}/${folder}`
            };
        });

        // The next page token is returned on the query object (second element)
        const nextPageToken =
            (filesApiResponse as Record<string, unknown> | undefined)?.nextPageToken as string | undefined;

        return {
            items,
            prefixes,
            nextPageToken
        };
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

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
     * Get the bucket name — either from parameter or config.
     */
    private getBucket(bucket?: string): string {
        // "default" is a logical bucket name used by local storage;
        // for GCS it should resolve to the configured bucket.
        if (!bucket || bucket === "default") return this.config.bucket;
        return bucket;
    }

    /**
     * Flatten nested metadata to string values (GCS custom metadata requirement)
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
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** A file's bytes, a chunk at a time — what `File.save` pipes from. */
async function* byteChunks(file: Blob): AsyncGenerator<Uint8Array> {
    const reader = file.stream().getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally {
        reader.releaseLock();
    }
}

/** What a listing entry says about its object, from the metadata the listing carried. */
function listedFacts(meta: FileMetadata | undefined): Pick<StorageReference, "size" | "updated" | "contentType"> {
    if (!meta) return {};
    const size = meta.size === undefined ? NaN : Number(meta.size);
    return {
        ...(Number.isFinite(size) ? { size } : {}),
        ...(typeof meta.updated === "string" ? { updated: meta.updated } : {}),
        ...(typeof meta.contentType === "string" && meta.contentType ? { contentType: meta.contentType } : {})
    };
}

/** What `statObject` reports, from an object's metadata. */
function storedObjectInfo(meta: FileMetadata): StoredObjectInfo {
    // The object's own version — see `S3StorageController.getObject`.
    const updated = typeof meta.updated === "string" ? Date.parse(meta.updated) : NaN;
    return {
        size: Number(meta.size) || 0,
        contentType: meta.contentType || "application/octet-stream",
        lastModified: Number.isNaN(updated) ? Date.now() : updated
    };
}

/**
 * Check whether an error represents a 404 / Not Found from the GCS client.
 */
function isNotFoundError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const err = error as Record<string, unknown>;
    if (err["code"] === 404) return true;
    if (typeof err["message"] === "string" && /not found/i.test(err["message"])) return true;
    return false;
}
