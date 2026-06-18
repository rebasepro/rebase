/**
 * Hono middleware for authenticating requests via Service API Keys.
 *
 * This middleware is integrated into `createAuthMiddleware()` and
 * activates only when the bearer token starts with `rk_`. It:
 *
 * 1. Hashes the token with SHA-256
 * 2. Looks up the hash in the `rebase.api_keys` table
 * 3. Validates the key is not revoked and not expired
 * 4. Sets `c.set("user", ...)` and `c.set("apiKey", ...)` for downstream use
 * 5. Scopes the DataDriver via `withAuth()` using the API key's service identity
 *
 * @module
 */

import { createHash } from "crypto";
import type { Context } from "hono";
import type { DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../../api/types";
import type { ApiKeyStore } from "./api-key-store";
import type { ApiKeyMasked } from "./api-key-types";
import { scopeDataDriver } from "../rls-scope";

/**
 * Check whether a token looks like a Rebase API key.
 */
export function isApiKeyToken(token: string): boolean {
    return token.startsWith("rk_");
}

/**
 * Hash a plaintext API key token for database lookup.
 */
function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/**
 * Options for the API key authentication handler.
 */
export interface ApiKeyAuthOptions {
    store: ApiKeyStore;
    driver: DataDriver;
}

/**
 * Validate an API key token and populate the Hono context.
 *
 * Returns `true` if the key is valid and context has been populated,
 * or returns an error Response if the key is invalid.
 *
 * This is NOT a standalone middleware — it's called from within
 * `createAuthMiddleware()` when a `rk_` prefixed token is detected.
 */
export async function validateApiKey(
    c: Context<HonoEnv>,
    token: string,
    options: ApiKeyAuthOptions
): Promise<Response | true> {
    const { store, driver } = options;

    const hash = hashToken(token);
    const apiKey = await store.findByKeyHash(hash);

    if (!apiKey) {
        return c.json({
            error: { message: "Invalid API key",
code: "UNAUTHORIZED" }
        }, 401);
    }

    // Check revocation
    if (apiKey.revoked_at) {
        return c.json({
            error: { message: "API key has been revoked",
code: "UNAUTHORIZED" }
        }, 401);
    }

    // Check expiration
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        return c.json({
            error: { message: "API key has expired",
code: "UNAUTHORIZED" }
        }, 401);
    }

    // Set user identity — API keys represent service accounts
    const userId = `api-key:${apiKey.id}`;
    c.set("user", { userId,
roles: [] });

    // Expose masked key metadata for downstream permission checks
    const masked: ApiKeyMasked = {
        id: apiKey.id,
        name: apiKey.name,
        key_prefix: apiKey.key_prefix,
        permissions: apiKey.permissions,
        rate_limit: apiKey.rate_limit,
        created_by: apiKey.created_by,
        created_at: apiKey.created_at,
        updated_at: apiKey.updated_at,
        last_used_at: apiKey.last_used_at,
        expires_at: apiKey.expires_at,
        revoked_at: apiKey.revoked_at
    };
    // Store apiKey in the context for permission checking in api-generator
    c.set("apiKey", masked);

    // Scope the DataDriver — API keys bypass RLS (service identity)
    try {
        const scopedDriver = await scopeDataDriver(driver, {
            uid: userId,
            roles: ["service"]
        });
        c.set("driver", scopedDriver);
    } catch (error) {
        console.error("[AUTH] RLS scoping failed for API key:", error);
        return c.json({
            error: { message: "Internal authentication error",
code: "INTERNAL_ERROR" }
        }, 500);
    }

    // Touch last_used_at in the background (non-blocking)
    store.updateLastUsed(apiKey.id).catch(() => {
        // Swallowed intentionally — logged inside the store
    });

    return true;
}
