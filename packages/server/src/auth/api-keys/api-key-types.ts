/**
 * Type definitions for Service API Keys.
 *
 * The wire contract — permissions, the masked key, the create/update payloads —
 * lives in `@rebasepro/types`, because the client SDK needs the same shapes and
 * the two declarations had already drifted apart. Only {@link ApiKey}, the
 * database row carrying `key_hash`, is server-side and stays here.
 *
 * @module
 */

import type { ApiKeyPermission } from "@rebasepro/types";

export type {
    ApiKeyPermission,
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    UpdateApiKeyRequest
} from "@rebasepro/types";

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
    /**
     * When true, the key is granted the `admin` role: it passes the
     * admin-gated routes (users, roles, cron, backups, logs, API keys) and
     * the RLS `default_admin` policies. Non-admin keys carry only the
     * `service` role — RLS grants them nothing unless a collection policy
     * explicitly names that role.
     */
    admin: boolean;
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
