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
    admin?: boolean;
    rate_limit?: number | null;
    expires_at?: string | null;
}

/** Payload for updating an existing API key. */
export interface UpdateApiKeyRequest {
    name?: string;
    permissions?: ApiKeyPermission[];
    admin?: boolean;
    rate_limit?: number | null;
    expires_at?: string | null;
}

export interface ApiKeysAPI {
    listKeys(): Promise<{ keys: ApiKeyMasked[] }>;
    getKey(id: string): Promise<{ key: ApiKeyMasked }>;
    createKey(data: CreateApiKeyRequest): Promise<{ key: ApiKeyWithSecret }>;
    updateKey(id: string, data: UpdateApiKeyRequest): Promise<{ key: ApiKeyMasked }>;
    revokeKey(id: string): Promise<{ success: boolean }>;
}
