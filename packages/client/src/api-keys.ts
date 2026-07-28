import type { Transport } from "./transport";

/**
 * These were re-declared here, under a comment saying they lived in the server
 * package rather than in `@rebasepro/types`. That stopped being true, and the
 * copy drifted: it never gained `admin`, the flag that grants a key the `admin`
 * role — admin routes plus the RLS `default_admin` policies — so the SDK could
 * describe every kind of key except a privileged one, and
 * `createKey({ …, admin: true })` was an excess-property error.
 */
export type {
    ApiKeyPermission,
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    UpdateApiKeyRequest
} from "@rebasepro/types";

import type {
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    UpdateApiKeyRequest
} from "@rebasepro/types";

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
