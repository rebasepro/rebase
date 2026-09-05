/**
 * Storage configuration and types for Rebase backend
 */

import { StorageSource, UploadFileProps, UploadFileResult, DownloadConfig, StorageListResult, StorageReference } from "@rebasepro/types";

/**
 * Local filesystem storage configuration
 */
export interface LocalStorageConfig {
    type: "local";
    /** Base directory for file storage (e.g., './uploads') */
    basePath: string;
    /** Maximum file size in bytes (default: 50MB) */
    maxFileSize?: number;
    /** Allowed MIME types (if not set, all types allowed) */
    allowedMimeTypes?: string[];
    /** Base URL for generating download URLs (default: auto-detected from request) */
    baseUrl?: string;
    /**
     * Set when this local backend stands in for an object store the source
     * declared and nothing bound — `bucket("media", { engine: "s3" })` with no
     * `S3_BUCKET__MEDIA` in a development process. Names the engine it stands
     * in for, so boot can say so and `rebase status` can show it. Never set in
     * production, where an unbound object store stays unbound.
     */
    standsInFor?: string;
}

/**
 * S3-compatible storage configuration (works with AWS S3 and MinIO)
 */
export interface S3StorageConfig {
    type: "s3";
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
 * Google Cloud Storage configuration (works with GCS and Firebase Storage)
 */
export interface GCSStorageConfig {
    type: "gcs";
    /** GCS bucket name (e.g. "my-project.appspot.com" for Firebase Storage) */
    bucket: string;
    /** GCP project ID (optional, auto-detected from credentials) */
    projectId?: string;
    /** Path to service account JSON key file */
    keyFilename?: string;
    /** Service account credentials object (alternative to keyFilename) */
    credentials?: { client_email: string; private_key: string; project_id?: string };
    /** Maximum file size in bytes (default: 50MB) */
    maxFileSize?: number;
    /** Allowed MIME types */
    allowedMimeTypes?: string[];
    /** Signed URL expiration in seconds (default: 3600) */
    signedUrlExpiration?: number;
}

/**
 * Storage configuration — local filesystem, S3-compatible, or Google Cloud Storage.
 *
 * **Built-in providers:**
 * - `local` — Zero-config filesystem storage. Great for dev and single-server deployments (Hetzner, bare metal).
 * - `s3` — Any S3-compatible provider. AWS S3, Cloudflare R2, MinIO, Hetzner Object Storage,
 *           Backblaze B2, DigitalOcean Spaces, and even GCS (via its S3-compatible interoperability API).
 * - `gcs` — Native Google Cloud Storage / Firebase Storage via `@google-cloud/storage`.
 *
 * **Custom providers:**
 * For other cloud storage (Azure Blob, etc.), implement the `StorageController`
 * interface and pass the instance directly to the `storage` config.
 */
export type BackendStorageConfig = LocalStorageConfig | S3StorageConfig | GCSStorageConfig;

/** What a storage request is trying to do to an object. */
export type {
    StorageOperation,
    StorageAuthorizeUser,
    StorageAuthorizeContext,
    StorageAuthorizeData,
    StorageAuthorize
} from "@rebasepro/types";

/**
 * Storage controller interface for backend implementations
 */
export interface StorageController {
    /**
     * Upload an object
     */
    putObject(props: UploadFileProps): Promise<UploadFileResult>;

    /**
     * Get a download URL (signed URL equivalent) for an object
     */
    getSignedUrl(key: string, bucket?: string): Promise<DownloadConfig>;

    /**
     * Get object as a File
     */
    getObject(key: string, bucket?: string): Promise<File | null>;

    /**
     * Delete an object
     */
    deleteObject(key: string, bucket?: string): Promise<void>;

    /**
     * List objects in a prefix
     */
    listObjects(prefix: string, options?: {
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
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff"
];

/**
 * Common document MIME types
 */
export const DOCUMENT_MIME_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv"
];
