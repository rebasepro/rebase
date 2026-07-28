/**
 * Service API keys — machine-to-machine authentication for scripts, cron jobs
 * and third-party integrations.
 *
 * The wire contract lives here because all three sides need it and used to
 * declare it separately: `@rebasepro/server` implements the routes,
 * `@rebasepro/client` calls them, and {@link ApiKeysAPI} types the SDK surface.
 * The client's copy had already drifted — it never gained `admin`.
 *
 * The database row itself (`ApiKey`, which carries `key_hash`) stays in the
 * server package: nothing off the server may see it.
 */

/**
 * A single permission entry scoping an API key to a collection and set of
 * operations.
 *
 * Use `"*"` as the collection value to grant access to all collections (and all
 * custom functions). Custom functions are addressed with the `functions`
 * namespace: `"functions"` grants every function, `"functions/<name>"` grants a
 * single one.
 *
 * @group Models
 */
export interface ApiKeyPermission {
    /** Collection slug, `"functions"`/`"functions/<name>"`, or `"*"` for everything. */
    collection: string;
    /** Allowed operations on the collection. */
    operations: ("read" | "write" | "delete")[];
}

/**
 * An API key with the secret portion masked — what list / get / update return.
 * @group Models
 */
export interface ApiKeyMasked {
    id: string;
    name: string;
    /** First 12 characters of the plaintext key, for display only. */
    key_prefix: string;
    permissions: ApiKeyPermission[];
    /**
     * When true, the key is granted the `admin` role: it passes the admin-gated
     * routes (users, roles, cron, backups, logs, API keys) and the RLS
     * `default_admin` policies. Non-admin keys carry only the `service` role —
     * RLS grants them nothing unless a collection policy names that role.
     */
    admin: boolean;
    /**
     * Requests per 15-minute window. `null` means "no per-key override" — the
     * data rate limiter then applies its default API-key limit (1000/window
     * unless configured otherwise), not unlimited.
     */
    rate_limit: number | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
}

/**
 * Returned exactly once, when a key is created. The `key` field holds the full
 * plaintext key — it is never stored or returned again.
 * @group Models
 */
export interface ApiKeyWithSecret extends ApiKeyMasked {
    /** Full plaintext API key (e.g. `rk_live_abc123...`). */
    key: string;
}

/**
 * Payload for creating a new API key.
 * @group Models
 */
export interface CreateApiKeyRequest {
    name: string;
    permissions: ApiKeyPermission[];
    /** When true, grants the `admin` role. See {@link ApiKeyMasked.admin}. */
    admin?: boolean;
    /** Requests per 15-minute window. Omit or `null` for the server default. */
    rate_limit?: number | null;
    /** ISO-8601 expiration timestamp. Omit for no expiration. */
    expires_at?: string | null;
}

/**
 * Payload for updating an existing API key. Only the fields provided change.
 * @group Models
 */
export interface UpdateApiKeyRequest {
    name?: string;
    permissions?: ApiKeyPermission[];
    /** When true, grants the `admin` role. See {@link ApiKeyMasked.admin}. */
    admin?: boolean;
    rate_limit?: number | null;
    expires_at?: string | null;
}

/** @group Models */
export interface ApiKeysAPI {
    listKeys(): Promise<{ keys: ApiKeyMasked[] }>;
    getKey(id: string): Promise<{ key: ApiKeyMasked }>;
    createKey(data: CreateApiKeyRequest): Promise<{ key: ApiKeyWithSecret }>;
    updateKey(id: string, data: UpdateApiKeyRequest): Promise<{ key: ApiKeyMasked }>;
    revokeKey(id: string): Promise<{ success: boolean }>;
}
