import type { Transport } from "./transport";

export type {
    ApiKeyKind,
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    CreatePersonalKeyRequest,
    UpdateApiKeyRequest
} from "@rebasepro/types";

import type {
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    CreatePersonalKeyRequest,
    ScopeSummary,
    UpdateApiKeyRequest
} from "@rebasepro/types";

/** Options for the `createApiKeys` factory. */
export interface CreateApiKeysOptions {
    apiKeysPath?: string;
}

/**
 * Creates a client for the project's service keys, via the admin routes.
 * Needs `keys:read` / `keys:write`.
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

/** Options for the `createPersonalKeys` factory. */
export interface CreatePersonalKeysOptions {
    personalKeysPath?: string;
    scopesPath?: string;
}

/**
 * Creates a client for the signed-in account's own API keys — each acts as the
 * account and holds no scope it does not. Answers `PERSONAL_KEYS_DISABLED`
 * unless the backend sets `personalKeys: true` on the users collection.
 */
export function createPersonalKeys(transport: Transport, options?: CreatePersonalKeysOptions) {
    const keysPath = options?.personalKeysPath || "/auth/keys";
    const scopesPath = options?.scopesPath || "/auth/scopes";

    /** List this account's keys (masked). */
    async function listKeys(): Promise<{ keys: ApiKeyMasked[] }> {
        return transport.request<{ keys: ApiKeyMasked[] }>(keysPath, { method: "GET" });
    }

    /** Create a key for this account. The full secret is included in the response. */
    async function createKey(data: CreatePersonalKeyRequest): Promise<{ key: ApiKeyWithSecret }> {
        return transport.request<{ key: ApiKeyWithSecret }>(keysPath, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    /** Revoke one of this account's keys. */
    async function revokeKey(id: string): Promise<{ success: boolean }> {
        return transport.request<{ success: boolean }>(
            keysPath + "/" + encodeURIComponent(id),
            { method: "DELETE" }
        );
    }

    /**
     * Every scope the backend knows, described, and the ones the caller holds —
     * what a screen offering scopes for a key needs.
     */
    async function listScopes(): Promise<{ scopes: ScopeSummary[]; held: string[] }> {
        return transport.request<{ scopes: ScopeSummary[]; held: string[] }>(scopesPath, { method: "GET" });
    }

    return {
        listKeys,
        createKey,
        revokeKey,
        listScopes
    };
}
