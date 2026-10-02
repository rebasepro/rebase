/**
 * API keys — long-lived bearer credentials for scripts, CI, agents and
 * third-party integrations.
 *
 * The wire contract lives here because all three sides need it:
 * `@rebasepro/server` implements the routes, `@rebasepro/client` calls them,
 * and {@link ApiKeysAPI} types the SDK surface. The database row itself
 * (which carries `key_hash`) stays in the server package: nothing off the
 * server may see it.
 *
 * What a key may do is a list of scopes — see `scopes.ts`.
 */

import type { ScopeSummary } from "./scopes";

/**
 * Who a key acts as.
 *
 * - `"service"` — the project's own machine identity, `api-key:<id>`. It is no
 *   person: it runs as the RLS roles it was given (`service` always, plus any
 *   in {@link ApiKeyMasked.roles}). Managed by holders of `keys:write`.
 * - `"personal"` — its owner. It runs as the owner's account, with the owner's
 *   roles as they are *now*, and can never hold a scope the owner does not.
 *   Managed by the owner, when the app enables `auth.personalKeys`.
 *
 * @group Models
 */
export type ApiKeyKind = "service" | "personal";

/**
 * An API key with the secret masked — what list / get / update return.
 * @group Models
 */
export interface ApiKeyMasked {
    id: string;
    name: string;
    kind: ApiKeyKind;
    /** First 12 characters of the plaintext key, for display only. */
    key_prefix: string;
    /**
     * What the key may do, as `resource:action[:target]` scope strings —
     * `data:read:posts`, `functions:invoke`, `logs:read`.
     */
    scopes: string[];
    /**
     * The RLS roles a service key runs as, beside `service`. `["admin"]` reads
     * every row through the default admin policies. Always empty on a personal
     * key, which runs as its owner's live roles.
     */
    roles: string[];
    /** The account a personal key acts as. Null on a service key. */
    owner_uid: string | null;
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
 * Payload for creating a service key.
 * @group Models
 */
export interface CreateApiKeyRequest {
    name: string;
    /** At least one. `keys:*` is refused, and so is any scope the creator does not hold. */
    scopes: string[];
    /** RLS roles beside `service`. A creator may only give roles they hold, unless they are an admin. */
    roles?: string[];
    /** Requests per 15-minute window. Omit or `null` for the server default. */
    rate_limit?: number | null;
    /** ISO-8601 expiration timestamp. Omit for no expiration. */
    expires_at?: string | null;
}

/**
 * Payload for updating a service key. Only the fields provided change.
 * @group Models
 */
export interface UpdateApiKeyRequest {
    name?: string;
    scopes?: string[];
    roles?: string[];
    rate_limit?: number | null;
    expires_at?: string | null;
}

/**
 * Payload for creating a personal key. It acts as the caller, so it carries no
 * roles and no rate-limit override.
 * @group Models
 */
export interface CreatePersonalKeyRequest {
    name: string;
    /** At least one, and none the caller does not hold. `keys:*` is refused. */
    scopes: string[];
    /** ISO-8601 expiration timestamp. Omit for no expiration. */
    expires_at?: string | null;
}

/** The project's service keys. Requires `keys:read` / `keys:write`. @group Models */
export interface ApiKeysAPI {
    listKeys(): Promise<{ keys: ApiKeyMasked[] }>;
    getKey(id: string): Promise<{ key: ApiKeyMasked }>;
    createKey(data: CreateApiKeyRequest): Promise<{ key: ApiKeyWithSecret }>;
    updateKey(id: string, data: UpdateApiKeyRequest): Promise<{ key: ApiKeyMasked }>;
    revokeKey(id: string): Promise<{ success: boolean }>;
}

/** The signed-in person's own keys, when the app enables them. @group Models */
export interface PersonalKeysAPI {
    listKeys(): Promise<{ keys: ApiKeyMasked[] }>;
    createKey(data: CreatePersonalKeyRequest): Promise<{ key: ApiKeyWithSecret }>;
    revokeKey(id: string): Promise<{ success: boolean }>;
    /** Every scope the backend knows, described, and the ones the caller holds. */
    listScopes(): Promise<{ scopes: ScopeSummary[]; held: string[] }>;
}
