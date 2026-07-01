import type { Transport } from "./transport";

// Re-define the types locally since they live in server-core, not in @rebasepro/types.
// These match the server-side types exactly.

/** A single permission entry scoping an API key to a collection and its allowed operations. */
export interface ApiKeyPermission {
    collection: string;
    operations: ("read" | "write" | "delete")[];
}

/** An API key with the secret portion masked (returned by list / get / update). */
export interface ApiKeyMasked {
    id: string;
    name: string;
    key_prefix: string;
    permissions: ApiKeyPermission[];
    admin: boolean;
    rate_limit: number | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
}

/** An API key including the full secret (returned only on creation). */
export interface ApiKeyWithSecret extends ApiKeyMasked {
    key: string;
}

/** Payload for creating a new API key. */
export interface CreateApiKeyRequest {
    name: string;
    permissions: ApiKeyPermission[];
    rate_limit?: number | null;
    expires_at?: string | null;
}

/** Payload for updating an existing API key. */
export interface UpdateApiKeyRequest {
    name?: string;
    permissions?: ApiKeyPermission[];
    rate_limit?: number | null;
    expires_at?: string | null;
}

/** Options for the `createApiKeys` factory. */
export interface CreateApiKeysOptions {
    apiKeysPath?: string;
}

/**
 * Creates a client for managing API keys via the admin routes.
 *
 * @param transport - The shared HTTP transport created by `createTransport`.
 * @param options   - Optional overrides (e.g. a custom base path).
 */
export function createApiKeys(transport: Transport, options?: CreateApiKeysOptions) {
    const apiKeysPath = options?.apiKeysPath || "/admin/api-keys";

    /** List all API keys (masked). */
    async function listKeys(): Promise<{ keys: ApiKeyMasked[] }> {
        return transport.request<{ keys: ApiKeyMasked[] }>(apiKeysPath, { method: "GET" });
    }

    /** Get a single API key by ID (masked). */
    async function getKey(id: string): Promise<{ key: ApiKeyMasked }> {
        return transport.request<{ key: ApiKeyMasked }>(
            apiKeysPath + "/" + encodeURIComponent(id),
            { method: "GET" }
        );
    }

    /** Create a new API key. The full secret is included in the response. */
    async function createKey(data: CreateApiKeyRequest): Promise<{ key: ApiKeyWithSecret }> {
        return transport.request<{ key: ApiKeyWithSecret }>(apiKeysPath, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    /** Update an existing API key. */
    async function updateKey(id: string, data: UpdateApiKeyRequest): Promise<{ key: ApiKeyMasked }> {
        return transport.request<{ key: ApiKeyMasked }>(
            apiKeysPath + "/" + encodeURIComponent(id),
            {
                method: "PUT",
                body: JSON.stringify(data)
            }
        );
    }

    /** Revoke (soft-delete) an API key. */
    async function revokeKey(id: string): Promise<{ success: boolean }> {
        return transport.request<{ success: boolean }>(
            apiKeysPath + "/" + encodeURIComponent(id),
            { method: "DELETE" }
        );
    }

    return {
        listKeys,
        getKey,
        createKey,
        updateKey,
        revokeKey
    };
}
