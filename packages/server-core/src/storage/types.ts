/**
 * Storage configuration and types for Rebase backend
 */

import { StorageSource, UploadFileProps, UploadFileResult, DownloadConfig, StorageListResult, StorageReference } from "@rebasepro/types";

/**
 * Local filesystem storage configuration
 */
export interface LocalStorageConfig {
    type: 'local';
    /** Base directory for file storage (e.g., './uploads') */
    basePath: string;
    /** Maximum file size in bytes (default: 50MB) */
    maxFileSize?: number;
    /** Allowed MIME types (if not set, all types allowed) */
    allowedMimeTypes?: string[];
    /** Base URL for generating download URLs (default: auto-detected from request) */
    baseUrl?: string;
}

/**
 * S3-compatible storage configuration (works with AWS S3 and MinIO)
 */
export interface S3StorageConfig {
    type: 's3';
    /** S3 bucket name */
    bucket: string;
    /** AWS region (e.g., 'us-east-1') */
    region?: string;
    /** Custom endpoint URL (required for MinIO, Cloudflare R2, Hetzner Object Storage) */
    endpoint?: string;
    /** AWS access key ID */
    accessKeyId: string;
    /** AWS secret access key */
    secretAccessKey: string;
    /** Use path-style URLs (required for MinIO) */
    forcePathStyle?: boolean;
    /** Maximum file size in bytes (default: 50MB) */
    maxFileSize?: number;
    /** Allowed MIME types (if not set, all types allowed) */
    allowedMimeTypes?: string[];
    /** URL expiration time in seconds for signed URLs (default: 3600) */
    signedUrlExpiration?: number;
}

/**
 * Storage configuration — local filesystem or S3-compatible.
 *
 * **Built-in providers:**
 * - `local` — Zero-config filesystem storage. Great for dev and single-server deployments (Hetzner, bare metal).
 * - `s3` — Any S3-compatible provider. AWS S3, Cloudflare R2, MinIO, Hetzner Object Storage,
 *           Backblaze B2, DigitalOcean Spaces, and even GCS (via its S3-compatible interoperability API).
 *
 * **Custom providers:**
 * For cloud-native storage (GCS, Azure Blob, etc.), implement the `StorageController`
 * interface and pass the instance directly to the `storage` config.
 */
export type BackendStorageConfig = LocalStorageConfig | S3StorageConfig;

/**
 * Storage controller interface for backend implementations
 */
export interface StorageController {
    /**
     * Upload a file
     */
    uploadFile(props: UploadFileProps): Promise<UploadFileResult>;

    /**
     * Get a download URL for a file
     */
    getDownloadURL(path: string, bucket?: string): Promise<DownloadConfig>;

    /**
     * Get file as a File object
     */
    getFile(path: string, bucket?: string): Promise<File | null>;

    /**
     * Delete a file
     */
    deleteFile(path: string, bucket?: string): Promise<void>;

    /**
     * List files in a path
     */
    list(path: string, options?: {
        bucket?: string;
        maxResults?: number;
        pageToken?: string;
    }): Promise<StorageListResult>;

    /**
     * Get the storage provider identifier.
     *
     * Built-in values are `'local'` and `'s3'`. Custom implementations
     * should return their own identifier (e.g. `'gcs'`, `'azure'`).
     */
    getType(): string;
}

/**
 * Default maximum file size (50MB)
 */
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Common image MIME types
 */
export const IMAGE_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff'
];

/**
 * Common document MIME types
 */
export const DOCUMENT_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
];

/**
 * Resolve a `BackendStorageConfig` from environment variables.
 *
 * Reads `STORAGE_TYPE` and returns the matching config, falling back
 * to `local` when nothing is set.
 *
 * **Supported values for `STORAGE_TYPE`:**
 *
 * | Value   | Provider                                              | Required env vars                                      |
 * |---------|-------------------------------------------------------|--------------------------------------------------------|
 * | `local` | Local filesystem (default)                            | `STORAGE_PATH` (optional, default: ./uploads)          |
 * | `s3`    | Any S3-compatible (AWS, R2, MinIO, Hetzner, GCS\*…)   | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`|
 *
 * \* GCS supports S3 interop — use HMAC keys + `S3_ENDPOINT=https://storage.googleapis.com`.
 *   See: https://cloud.google.com/storage/docs/interoperability
 *
 * For custom storage backends (Azure Blob, native GCS SDK, etc.),
 * implement the `StorageController` interface and pass it directly
 * to the `storage` config instead of using this helper.
 *
 * @param defaults  Fallback values (e.g. `{ localPath: './uploads' }`)
 */
export function resolveStorageFromEnv(defaults?: {
    localPath?: string;
}): BackendStorageConfig {
    const storageType = (process.env.STORAGE_TYPE || 'local').toLowerCase();

    switch (storageType) {
        case 's3':
            if (!process.env.S3_BUCKET) {
                throw new Error(
                    'STORAGE_TYPE=s3 requires S3_BUCKET to be set. ' +
                    'Also set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and optionally S3_REGION, S3_ENDPOINT.'
                );
            }
            return {
                type: 's3',
                bucket: process.env.S3_BUCKET,
                region: process.env.S3_REGION || 'auto',
                accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
                endpoint: process.env.S3_ENDPOINT,
                forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
            };

        case 'local':
        default:
            return {
                type: 'local',
                basePath: process.env.STORAGE_PATH || defaults?.localPath || './uploads',
            };
    }
}
