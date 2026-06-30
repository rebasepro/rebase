/**
 * Storage module for Rebase backend
 *
 * Provides pluggable file storage with three built-in providers:
 * - **Local filesystem** — zero config, great for dev and single-server deployments.
 * - **S3-compatible** — works with AWS S3, Cloudflare R2, MinIO, Hetzner Object Storage,
 *   Backblaze B2, DigitalOcean Spaces, and GCS (via S3 interop).
 * - **Google Cloud Storage / Firebase Storage** — native GCS support via `@google-cloud/storage`
 *   (optional peer dependency, lazily loaded).
 *
 * For other providers (Azure Blob, etc.), implement the
 * `StorageController` interface and pass the instance directly to the `storage` config.
 */

export * from "./types";
export { LocalStorageController } from "./LocalStorageController";
export { S3StorageController } from "./S3StorageController";
export { GCSStorageController } from "./GCSStorageController";
export { createStorageRoutes } from "./routes";
export type { StorageRoutesConfig } from "./routes";
export * from "./storage-registry";
export { parseTransformOptions, transformImage, isTransformableImage, TransformCache } from "./image-transform";
export type { ImageTransformOptions } from "./image-transform";
export { TusHandler } from "./tus-handler";

import { BackendStorageConfig, StorageController } from "./types";
import { LocalStorageController } from "./LocalStorageController";
import { S3StorageController } from "./S3StorageController";
import { GCSStorageController } from "./GCSStorageController";

/**
 * Create a storage controller from a config object.
 *
 * For custom providers, implement `StorageController` directly instead
 * of going through this factory.
 */
export function createStorageController(config: BackendStorageConfig): StorageController {
    switch (config.type) {
        case "local":
            return new LocalStorageController(config);
        case "s3":
            return new S3StorageController(config);
        case "gcs":
            return new GCSStorageController(config);
        default:
            throw new Error(
                `Unknown storage type: ${(config as Record<string, unknown>).type}. ` +
                "Built-in types: local, s3, gcs. " +
                "For other providers, implement the StorageController interface directly."
            );
    }
}
