/**
 * Type definitions for Service API Keys.
 *
 * API keys provide machine-to-machine authentication for scripts, cron jobs,
 * and third-party integrations. Each key is scoped to specific collections
 * and operations via the `ApiKeyPermission` model.
 *
 * @module
 */

/**
 * A single permission entry scoping an API key to a collection and set of operations.
 *
 * Use `"*"` as the collection value to grant access to all collections.
 */
export interface ApiKeyPermission {
    /** Collection slug, or `"*"` for all collections. */
    collection: string;
    /** Allowed operations on the collection. */
    operations: ("read" | "write" | "delete")[];
}

/**
 * Full database row for an API key.
 * The `key_hash` is never exposed via the API — only stored for lookup.
 */
export interface ApiKey {
    id: string;
    name: string;
    /** First 12 characters of the plaintext key, for display only. */
    key_prefix: string;
    /** SHA-256 hash of the full plaintext key. */
    key_hash: string;
    permissions: ApiKeyPermission[];
    /** Requests per 15-minute window. `null` means unlimited. */
    rate_limit: number | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
}

/**
 * Masked version of an API key, safe for API responses.
 * Omits `key_hash` and shows only the prefix.
 */
export interface ApiKeyMasked {
    id: string;
    name: string;
    key_prefix: string;
    permissions: ApiKeyPermission[];
    rate_limit: number | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
}

/**
 * Request body for creating a new API key.
 */
export interface CreateApiKeyRequest {
    name: string;
    permissions: ApiKeyPermission[];
    /** Requests per 15-minute window. Omit or `null` for unlimited. */
    rate_limit?: number | null;
    /** ISO-8601 expiration timestamp. Omit for no expiration. */
    expires_at?: string | null;
}

/**
 * Request body for updating an existing API key.
 * All fields are optional — only provided fields are updated.
 */
export interface UpdateApiKeyRequest {
    name?: string;
    permissions?: ApiKeyPermission[];
    rate_limit?: number | null;
    expires_at?: string | null;
}

/**
 * Returned exactly once when a key is created.
 * The `key` field contains the full plaintext key — it is never stored
 * or returned again after creation.
 */
export interface ApiKeyWithSecret extends ApiKeyMasked {
    /** Full plaintext API key (e.g. `rk_live_abc123...`). */
    key: string;
}
