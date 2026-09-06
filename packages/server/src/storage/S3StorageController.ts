/**
 * S3-compatible storage controller (works with AWS S3 and MinIO)
 */

import type { S3Client as S3ClientType, } from "@aws-sdk/client-s3";
import { DEFAULT_MAX_FILE_SIZE, S3StorageConfig, StorageController } from "./types";
import { folderKey, listingPrefix } from "./keys";
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
            return new File([blob], fileName, { type: contentType });
        } catch (error: unknown) {
            const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw error;
        }
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

        const command = new s3.ListObjectsV2Command({
            Bucket: resolvedBucket,
            Prefix: listingPrefix(prefix),
            MaxKeys: options?.maxResults ?? 1000,
            ContinuationToken: options?.pageToken,
            Delimiter: "/" // This gives us folder-like behavior
        });

        const response = await client.send(command);

        const items: StorageReference[] = (response.Contents || []).map(obj => ({
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
