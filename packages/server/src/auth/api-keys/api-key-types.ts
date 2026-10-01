/**
 * Type definitions for API keys.
 *
 * The wire contract — scopes, the masked key, the create/update payloads —
 * lives in `@rebasepro/types`, because the client SDK needs the same shapes.
 * Only {@link ApiKey}, the database row carrying `key_hash`, is server-side
 * and stays here.
 *
 * @module
 */

import type { ApiKeyKind } from "@rebasepro/types";

export type {
    ApiKeyKind,
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    CreatePersonalKeyRequest,
    UpdateApiKeyRequest
} from "@rebasepro/types";

/**
 * Full database row for an API key.
 * The `key_hash` is never exposed via the API — only stored for lookup.
 */
export interface ApiKey {
    id: string;
    name: string;
    kind: ApiKeyKind;
    /** First 12 characters of the plaintext key, for display only. */
    key_prefix: string;
    /** SHA-256 hash of the full plaintext key. */
    key_hash: string;
    /** `resource:action[:target]` scope strings. */
    scopes: string[];
    /** RLS roles a service key runs as, beside `service`. Empty on a personal key. */
    roles: string[];
    /** The account a personal key acts as. Null on a service key. */
    owner_uid: string | null;
    /**
     * Requests per 15-minute window. `null` means "no per-key override" —
     * the data rate limiter then applies its default API-key limit
     * (1000/window unless configured otherwise), not unlimited.
     */
    rate_limit: number | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
}
