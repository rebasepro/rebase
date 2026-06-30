/**
 * Describes a named storage backend — a place files live.
 *
 * Declared once and shared front + back: the frontend uses it to decide
 * transport (HTTP proxy vs direct SDK), the backend uses the same `key`
 * to resolve a StorageController, and collection properties reference
 * a definition by its `key` via `StorageConfig.storageSource`.
 *
 * This mirrors the {@link DataSourceDefinition} pattern used for databases.
 *
 * @group Models
 */

/**
 * The default storage source key, used when a property does not specify
 * a `storageSource`. Shared by the frontend and backend registries so
 * both agree on "the default storage backend".
 * @group Models
 */
export const DEFAULT_STORAGE_SOURCE_KEY = "(default)";

/**
 * How the *frontend* reaches a storage backend.
 *
 * - `"server"` — through the Rebase backend REST API (`/api/storage`).
 *   The backend holds the actual `StorageController` and routes by
 *   storage-source key. This is the default and covers Local, S3, GCS,
 *   and any other server-mediated engine.
 * - `"direct"` — straight from the client to the external backend via
 *   its own SDK (e.g. Firebase Storage via `@firebase/storage`).
 *   The Rebase backend is **not** in the upload/download path.
 *
 * @group Models
 */
export type StorageSourceTransport = "server" | "direct";

/**
 * Declarative definition of a storage source — a named place files live.
 *
 * Declared once and shared front and back: the frontend uses it to decide
 * transport (client HTTP proxy vs direct provider SDK), the backend uses
 * the same `key` to resolve a `StorageController`, and collection
 * properties reference a definition by its `key` via
 * `StorageConfig.storageSource`.
 *
 * @group Models
 */
export interface StorageSourceDefinition {
    /**
     * Unique identifier for this storage source. Collection properties
     * point at it via `StorageConfig.storageSource`.
     * Defaults to {@link DEFAULT_STORAGE_SOURCE_KEY}.
     */
    key: string;

    /**
     * The engine backing this storage source (e.g. `"local"`, `"s3"`,
     * `"gcs"`, `"firebase"`, `"azure"`, or a custom id).
     */
    engine: string;

    /**
     * How the frontend reaches this storage. Defaults to `"server"`.
     *
     * When `"direct"`, the client uses a provider-specific SDK
     * (e.g. `@firebase/storage`) and the backend does not proxy
     * upload/download traffic for this source.
     */
    transport: StorageSourceTransport;

    /** Human-readable label for the UI (e.g. "Firebase Storage", "S3 Media"). */
    label?: string;
}

/**
 * A resolved storage source: the single source of truth that the frontend
 * router and backend registry both derive from.
 *
 * @group Models
 */
export interface ResolvedStorageSource {
    /** Storage source key (routing key, shared front + back). */
    key: string;
    /** Engine backing the source. */
    engine: string;
    /** Frontend transport. */
    transport: StorageSourceTransport;
    /** Human-readable label. */
    label?: string;
}
