/**
 * Adapter Auth Middleware
 *
 * Creates a Hono middleware that delegates authentication to an `AuthAdapter`
 * instead of hardcoded JWT verification. This is used when the user passes
 * an `AuthAdapter` to `initializeRebaseBackend()`.
 *
 * The middleware:
 * 1. Checks for API key tokens (`rk_` prefix) first — these are Rebase-level
 * 2. Falls back to `adapter.verifyRequest(request)` to resolve the user
 * 3. Scopes the DataDriver via `withAuth()` for RLS
 * 4. Enforces auth (401) when `requireAuth` is true and no user is found
 *
 * The behavior is identical to `createAuthMiddleware()` — only the
 * token verification strategy is pluggable.
 */

import type { MiddlewareHandler } from "hono";
import type { DataDriver, AuthAdapter } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { scopeDataDriver } from "./rls-scope";
import { validateApiKey } from "./api-keys/api-key-middleware";

export interface AdapterAuthMiddlewareOptions {
    /** The auth adapter to delegate verification to. */
    adapter: AuthAdapter;
    /** The DataDriver to scope via withAuth() for RLS. */
    driver: DataDriver;
    /**
     * If true, return 401 when no valid user is resolved.
     * Defaults to `true` (secure by default).
     */
    requireAuth?: boolean;
    /** Optional API key store — when provided, `rk_` bearer tokens are accepted. */
    apiKeyStore?: ApiKeyStore;
}

/**
 * Create a Hono middleware that uses an `AuthAdapter` for request verification.
 */
export function createAdapterAuthMiddleware(options: AdapterAuthMiddlewareOptions): MiddlewareHandler<HonoEnv> {
    const { adapter, driver, requireAuth: enforceAuth = true, apiKeyStore } = options;

    return async (c, next) => {
        // ── API Key check (Rebase-level, independent of auth adapter) ────
        if (apiKeyStore) {
            const authHeader = c.req.header("authorization") || "";
            const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
            if (token.startsWith("rk_")) {
                const result = await validateApiKey(c, token, { store: apiKeyStore, driver });
                if (result === true) return next();
                return result;
            }
        }

        let authenticatedUser = null;

        try {
            authenticatedUser = await adapter.verifyRequest(c.req.raw);
        } catch (error) {
            // adapter.verifyRequest() threw — reject the request (fail closed)
            return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
        }

        if (authenticatedUser) {
            // Authenticated — set user context and scope driver
            c.set("user", {
                userId: authenticatedUser.uid,
                email: authenticatedUser.email,
                roles: authenticatedUser.roles,
            });
            try {
                c.set("driver", await scopeDataDriver(driver, {
                    uid: authenticatedUser.uid,
                    roles: authenticatedUser.roles,
                }));
            } catch (error) {
                console.error("[AUTH-ADAPTER] RLS scoping failed for authenticated user:", error);
                return c.json({ error: { message: "Internal authentication error", code: "INTERNAL_ERROR" } }, 500);
            }
        } else {
            // Not authenticated — scope as anon for RLS evaluation
            try {
                c.set("driver", await scopeDataDriver(driver, { uid: "anon", roles: ["anon"] }));
            } catch (error) {
                console.error("[AUTH-ADAPTER] Failed to create anon-scoped driver:", error);
                return c.json({ error: { message: "Server configuration error", code: "INTERNAL_ERROR" } }, 500);
            }
        }

        // Enforce auth if required
        if (enforceAuth && !c.get("user")) {
            return c.json({ error: { message: "Unauthorized: Authentication required", code: "UNAUTHORIZED" } }, 401);
        }

        return next();
    };
}
