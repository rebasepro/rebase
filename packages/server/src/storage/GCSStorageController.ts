/**
 * Google Cloud Storage controller (works with GCS and Firebase Storage)
 *
 * The `@google-cloud/storage` package is loaded lazily so it remains an
 * optional peer dependency — users who don't need GCS never pay for the
 * import cost or need it installed.
 */

import {
    StorageController,
    GCSStorageConfig,
    DEFAULT_MAX_FILE_SIZE
} from "./types";
import { folderKey, listingPrefix } from "./keys";
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
    }: UploadFileProps): Promise<UploadFileResult> {
        this.validateFile(file);

        const usedBucket = this.getBucket(bucket);
        const client = await this.getClient();
        const gcsFile = client.bucket(usedBucket).file(key);

        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await gcsFile.save(buffer, {
            contentType: file.type,
            metadata: metadata ? { metadata: this.flattenMetadata(metadata) } : undefined
        });

        return {
            key,
            bucket: usedBucket,
            storageUrl: `gs://${usedBucket}/${key}`
        };
    }

    async getSignedUrl(key: string, bucket?: string): Promise<DownloadConfig> {
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
            const gcsFile = client.bucket(resolvedBucket).file(resolvedPath);

            // Get metadata first to check existence and populate response
            const [fileMetadata] = await gcsFile.getMetadata();

            // Generate a signed URL
            const expiresIn = this.config.signedUrlExpiration ?? 3600;
            const [url] = await gcsFile.getSignedUrl({
                action: "read",
                expires: Date.now() + expiresIn * 1000
            });

            const metadata: DownloadMetadata = {
                bucket: resolvedBucket,
                fullPath: resolvedPath,
                name: resolvedPath.split("/").pop() || resolvedPath,
                size: Number(fileMetadata.size) || 0,
                contentType: fileMetadata.contentType || "application/octet-stream",
                customMetadata: (fileMetadata.metadata as Record<string, string> | undefined) || {}
            };

            return {
                url,
                metadata
            };
        } catch (error: unknown) {
            if (isNotFoundError(error)) {
                return {
                    url: null,
                    fileNotFound: true
                };
            }
            throw error;
        }
    }

    async getObject(key: string, bucket?: string): Promise<File | null> {
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
            const gcsFile = client.bucket(resolvedBucket).file(resolvedPath);

            const [contents] = await gcsFile.download();

            // Get content type from metadata
            const [fileMetadata] = await gcsFile.getMetadata();
            const contentType = fileMetadata.contentType || "application/octet-stream";
            const fileName = resolvedPath.split("/").pop() || resolvedPath;

            const blob = new Blob([new Uint8Array(contents)], { type: contentType });
            return new File([blob], fileName, { type: contentType });
        } catch (error: unknown) {
            if (isNotFoundError(error)) {
                return null;
            }
            throw error;
        }
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
        const [files, , filesApiResponse] = await gcsBucket.getFiles({
            prefix: listingPrefix(prefix),
            delimiter: "/",
            maxResults: options?.maxResults ?? 1000,
            pageToken: options?.pageToken,
            autoPaginate: false
        });

        const items: StorageReference[] = files.map(file => ({
            bucket: resolvedBucket,
            fullPath: file.name,
            name: file.name.split("/").pop() || "",
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

    /**
     * Validate file before upload
     */
    private validateFile(file: File): void {
        const maxSize = this.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
        if (file.size > maxSize) {
            throw new Error(`File size ${file.size} exceeds maximum allowed size ${maxSize}`);
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
