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
     * The credential set this source signs with, when several sources share one.
     *
     * ## What it is for
     *
     * Every binding a bucket needs is read per key — `S3_BUCKET__MEDIA`,
     * `S3_ACCESS_KEY_ID__MEDIA`, and so on. That is right for the bucket *name*,
     * which is different for every source by definition, and wrong for the
     * credentials, which usually are not: fifteen buckets on one MinIO install
     * meant fifteen copies of the same endpoint, access key and secret — ninety
     * variables where eighteen would do, and one key rotation became fifteen
     * paired edits where a single missed one fails at upload time with an opaque
     * signing error.
     *
     * Naming an account here lets the *account-scoped* bindings fall back to
     * `<BASE>__<ACCOUNT>` when no per-key value is set. The bucket name never
     * falls back: it is what distinguishes one source from another.
     *
     * ## Why it does not fall back to the bare variable
     *
     * A source with no `account` reads only its own suffixed names, exactly as
     * before — so every project that predates this is wire-identical. The
     * unsuffixed `S3_ACCESS_KEY_ID` belongs to the *default* source, and letting
     * a named bucket inherit it would mean a typo'd key silently signs with
     * another source's credentials. Two forms, both explicit, opt-in.
     */
    account?: string;

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

/**
 * The environment-variable suffix for a storage or data source key.
 *
 * `""` for the default source — so a single-bucket project keeps configuring
 * plain `S3_BUCKET` — and `__<KEY>` for every named one, uppercased with
 * non-alphanumerics collapsed to underscores: `media-cdn` → `S3_BUCKET__MEDIA_CDN`.
 *
 * The rule derives the variable name from the declared key rather than
 * discovering keys by scanning the environment. Scanning would have to guess how
 * `S3_BUCKET__MEDIA_CDN` splits into a key; deriving cannot be ambiguous, and a
 * typo surfaces as a missing source at boot instead of a silently ignored
 * variable.
 *
 * It lives in this package, with no dependencies, because four things must agree
 * on it exactly: the CLI (validating a build), the runtime (reading its own
 * environment), the control plane (writing a tenant's Secret), and the docs. A
 * second implementation of a naming convention is a second chance to disagree.
 *
 * @group Models
 */
export function storageEnvSuffix(key: string, defaultKey: string = DEFAULT_STORAGE_SOURCE_KEY): string {
    if (!key || key === defaultKey) return "";
    const normalized = key
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    if (!normalized) {
        throw new Error(
            `Source key "${key}" cannot be turned into an environment variable name. ` +
            "Use a key containing at least one letter or digit."
        );
    }
    return `__${normalized}`;
}

/**
 * Two distinct keys that collapse onto the same variable name, or `null`.
 *
 * `media-cdn` and `media_cdn` are different source keys but the same suffix, so
 * without this one of them silently reads the other's configuration. Returns the
 * offending pair rather than throwing, so each caller can raise it in its own
 * idiom — a `BundleError` at boot, a build failure in the CLI, a rejected deploy
 * in a control plane.
 *
 * @group Models
 */
export function findStorageSuffixCollision(
    keys: string[],
    defaultKey: string = DEFAULT_STORAGE_SOURCE_KEY
): { a: string; b: string; suffix: string } | null {
    const seen = new Map<string, string>();
    for (const key of keys) {
        const suffix = storageEnvSuffix(key, defaultKey);
        const existing = seen.get(suffix);
        if (existing !== undefined && existing !== key) {
            return { a: existing, b: key, suffix };
        }
        seen.set(suffix, key);
    }
    return null;
}
