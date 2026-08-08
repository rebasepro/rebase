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
 * 4. Rejects a presented-but-unverifiable token with 401, whatever
 *    `requireAuth` says
 * 5. Enforces auth (401) when `requireAuth` is true and no user is found
 *
 * The behavior is identical to `createAuthMiddleware()` — only the
 * token verification strategy is pluggable.
 */

import type { MiddlewareHandler, Context } from "hono";
import type { DataDriver, AuthAdapter } from "@rebasepro/types";
import { ANONYMOUS_USER_ID } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { scopeDataDriver } from "./rls-scope";
import { validateApiKey } from "./api-keys/api-key-middleware";
import { extractBearerToken } from "./bearer-token";
import { logger } from "../utils/logger";

export interface AdapterAuthMiddlewareOptions {
    /** The auth adapter to delegate verification to. */
    adapter: AuthAdapter;
    /** The DataDriver to scope via withAuth() for RLS. */
    driver: DataDriver;
    /**
     * Optional per-request driver resolver for multi-data-source backends.
     * Returns the unscoped delegate to use for this request (e.g. Postgres vs
     * Mongo). When omitted, `driver` is used for every request.
     */
    resolveDriver?: (c: Context<HonoEnv>) => DataDriver;
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
    const { adapter, driver: baseDriver, resolveDriver, requireAuth: enforceAuth = true, apiKeyStore } = options;

    return async (c, next) => {
        // Pick the per-request delegate (multi-data-source) before scoping.
        const driver = resolveDriver ? resolveDriver(c) : baseDriver;
        // Whether the caller presented a bearer token at all. A token that is
        // present and does not verify is a 401 below, exactly as in
        // `createAuthMiddleware` — see the comment there.
        const presentedToken = extractBearerToken(c.req.header("authorization"));
        // ── API Key check (Rebase-level, independent of auth adapter) ────
        if (apiKeyStore) {
            const token = presentedToken ?? "";
            if (token.startsWith("rk_")) {
                const result = await validateApiKey(c, token, { store: apiKeyStore,
driver });
                if (result === true) return next();
                return result;
            }
        }

        let authenticatedUser = null;

        try {
            authenticatedUser = await adapter.verifyRequest(c.req.raw);
        } catch (error) {
            // adapter.verifyRequest() threw — reject the request (fail closed)
            return c.json({ error: { message: "Unauthorized",
code: "UNAUTHORIZED" } }, 401);
        }

        if (authenticatedUser) {
            // Authenticated — set user context and scope driver
            c.set("user", {
                uid: authenticatedUser.uid,
                email: authenticatedUser.email,
                roles: authenticatedUser.roles
            });
            try {
                c.set("driver", await scopeDataDriver(driver, {
                    uid: authenticatedUser.uid,
                    roles: authenticatedUser.roles
                }));
            } catch (error) {
                logger.error("[AUTH-ADAPTER] RLS scoping failed for authenticated user", { error: error });
                return c.json({ error: { message: "Internal authentication error",
code: "INTERNAL_ERROR" } }, 500);
            }
        } else {
            // Token present but invalid — always reject, regardless of
            // `requireAuth`. Presenting a malformed or expired token should
            // never grant access, and it must not be *downgraded* to an
            // anonymous request either: the SDK's refresh flow is driven by a
            // 401, so a router mounted with `requireAuth: false` — the custom
            // functions router is the only one — would answer 200 with public
            // content to a user whose access token had merely expired, and the
            // refresh would never fire.
            //
            // This is the rule `createAuthMiddleware` already applies. It lived
            // in only one of the two implementations, and this is the path that
            // runs whenever `config.auth` is a config object.
            //
            // A request with no Authorization header stays anonymous: adapters
            // may authenticate by cookie, and "no credential" is not "a bad
            // credential".
            if (presentedToken !== undefined) {
                return c.json({ error: { message: "Invalid or expired token",
code: "UNAUTHORIZED" } }, 401);
            }

            // Not authenticated — scope as anon for RLS evaluation
            try {
                c.set("driver", await scopeDataDriver(driver, { uid: ANONYMOUS_USER_ID,
roles: ["anon"] }));
            } catch (error) {
                logger.error("[AUTH-ADAPTER] Failed to create anon-scoped driver", { error: error });
                return c.json({ error: { message: "Server configuration error",
code: "INTERNAL_ERROR" } }, 500);
            }
        }

        // Enforce auth if required
        if (enforceAuth && !c.get("user")) {
            return c.json({ error: { message: "Unauthorized: Authentication required",
code: "UNAUTHORIZED" } }, 401);
        }

        return next();
    };
}
