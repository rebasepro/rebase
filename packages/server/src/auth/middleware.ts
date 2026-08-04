import { MiddlewareHandler, Context } from "hono";
import { ANONYMOUS_USER_ID, DataDriver, isPublicStoragePath } from "@rebasepro/types";
import { verifyAccessToken, AccessTokenPayload, isJwtConfigured, verifyDownloadToken } from "./jwt";
import type { HonoEnv } from "../api/types";
import { scopeDataDriver } from "./rls-scope";
import { safeCompare } from "./crypto-utils";
import { isApiKeyToken, validateApiKey } from "./api-keys/api-key-middleware";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { logger } from "../utils/logger";
import { extractBearerToken } from "./bearer-token";

// Re-exported from here because this is where callers look for it; the separate
// module exists only so `api-key-middleware` can use it without closing an
// import cycle with this file.
export { extractBearerToken };

/**
 * Result from a custom auth validator.
 * - `false`/`null`/`undefined` = not authenticated
 * - `true` = authenticated as default user
 * - object with `uid` (or legacy `userId`) = authenticated with user info
 */
export type AuthResult = boolean | null | undefined | { uid?: string; userId?: string; roles?: string[]; [key: string]: unknown };

/**
 * Options for creating an auth middleware via createAuthMiddleware()
 */
export interface AuthMiddlewareOptions {
    /** DataDriver to scope via withAuth() for RLS */
    driver: DataDriver;
    /**
     * Optional per-request driver resolver for multi-data-source backends.
     * Given the request context, returns the unscoped delegate to use (e.g.
     * Postgres vs Mongo, picked by the request's collection data source).
     * When omitted, `driver` is used for every request.
     */
    resolveDriver?: (c: Context<HonoEnv>) => DataDriver;
    /**
     * If true, return 401 when no valid token is present.
     *
     * **Defaults to `true` (secure by default).** Set to `false` only for
     * intentionally public endpoints where access control is fully delegated
     * to Postgres Row-Level Security policies.
     */
    requireAuth?: boolean;
    /** Optional custom validator (for non-JWT auth, e.g. external auth providers) */
    validator?: (c: Context<HonoEnv>) => Promise<AuthResult>;
    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When a request sends `Authorization: Bearer <key>` and the key matches
     * this value, the request is granted admin-level access (uid: `service`,
     * roles: `["admin"]`) **without** JWT verification. The driver is scoped
     * via `withAuth()` with the service identity.
     *
     * This is the Rebase equivalent of a Service Account key.
     * Set via `REBASE_SERVICE_KEY` in `.env` and pass through the backend config.
     *
     * **Security:** The comparison uses constant-time equality to prevent
     * timing attacks. The key must be at least 32 characters.
     */
    serviceKey?: string;
    /**
     * API key store for authenticating `rk_` prefixed tokens.
     * When set, tokens starting with `rk_` are validated against the
     * database instead of being treated as JWTs.
     */
    apiKeyStore?: ApiKeyStore;
}

/**
 * Hono middleware that requires a valid JWT token via Authorization header.
 * Returns 401 if token is missing or invalid.
 *
 * **Security:** Tokens are only accepted via the `Authorization: Bearer`
 * header. Query-string tokens (`?token=`) are intentionally NOT accepted
 * here because URLs leak into access logs, proxies, Referer headers, and
 * browser history. Use {@link queryTokenAuth} on routes that legitimately
 * need query-string tokens (e.g. storage file serving for `<img src>`).
 */
export const requireAuth: MiddlewareHandler<HonoEnv> = async (
    c,
    next
) => {
    // A prior middleware (queryTokenAuth, API-key pre-auth) may have already
    // resolved the user — respect it instead of re-parsing the token as a JWT.
    if (c.get("user")) return next();

    const token = extractBearerToken(c.req.header("authorization"));

    if (token === undefined) {
        return c.json({
            error: {
                message: "Authorization header missing or invalid",
                code: "UNAUTHORIZED"
            }
        }, 401);
    }

    const payload = verifyAccessToken(token);

    if (!payload) {
        return c.json({
            error: {
                message: "Invalid or expired token",
                code: "UNAUTHORIZED"
            }
        }, 401);
    }

    c.set("user", payload);
    return next();
};

/**
 * Factory that creates a requireAuth middleware with optional service key support.
 *
 * When `serviceKey` is provided, the middleware will check if the Bearer token
 * matches the service key using constant-time comparison. If it matches, the
 * request is authenticated as a service user with admin privileges.
 *
 * This allows admin routes (which use standalone requireAuth + requireAdmin)
 * to be accessed via service keys for scripts and server-to-server calls.
 */
export function createRequireAuth(options?: { serviceKey?: string }): MiddlewareHandler<HonoEnv> {
    if (!options?.serviceKey) return requireAuth;

    const key = options.serviceKey;
    return async (c, next) => {
        // Respect a user already resolved upstream (e.g. API-key pre-auth).
        if (c.get("user")) return next();

        const token = extractBearerToken(c.req.header("authorization"));

        if (token === undefined) {
            return c.json({
                error: {
                    message: "Authorization header missing or invalid",
                    code: "UNAUTHORIZED"
                }
            }, 401);
        }

        // Check service key first (constant-time comparison)
        if (safeCompare(token, key)) {
            c.set("user", { uid: "service",
roles: ["admin"] } as AccessTokenPayload);
            return next();
        }

        // Fall back to JWT verification
        const payload = verifyAccessToken(token);

        if (!payload) {
            return c.json({
                error: {
                    message: "Invalid or expired token",
                    code: "UNAUTHORIZED"
                }
            }, 401);
        }

        c.set("user", payload);
        return next();
    };
}

/**
 * Middleware that requires the user to have an admin or schema-admin role.
 * Must be used AFTER requireAuth or on a route where user is guaranteed.
 */
export const requireAdmin: MiddlewareHandler<HonoEnv> = async (
    c,
    next
) => {
    const user = c.get("user");
    if (!user) {
        return c.json({
            error: {
                message: "User not authenticated. requireAuth middleware is missing?",
                code: "UNAUTHORIZED"
            }
        }, 401);
    }

    const roles = (typeof user === "object" && user !== null && "roles" in user) ? (user.roles || []) : [];
    const isAdmin = roles.some((role: string) => {
        return role === "admin" || role === "schema-admin";
    });

    if (!isAdmin) {
        return c.json({
            error: {
                message: "Admin privileges required for this operation",
                code: "FORBIDDEN"
            }
        }, 403);
    }

    return next();
};


/**
 * Middleware that optionally extracts user from JWT via Authorization header.
 * Does not return 401 if token is missing — allows anonymous access.
 *
 * Query-string tokens are NOT accepted here. Use {@link queryTokenAuth}
 * on routes that need them.
 */
export const optionalAuth: MiddlewareHandler<HonoEnv> = async (
    c,
    next
) => {
    // Skip if a prior middleware (e.g. queryTokenAuth) already set the user.
    if (c.get("user")) return next();

    const token = extractBearerToken(c.req.header("authorization"));

    // A backend that authenticates through an adapter (Firebase, Clerk) never
    // calls `configureJwt`, so verifying here would throw — turning a route
    // that had already accepted anonymous callers into a 500 for every
    // request that happens to carry a bearer token. Anonymous is the answer.
    if (token !== undefined && isJwtConfigured()) {
        const payload = verifyAccessToken(token);
        if (payload) {
            c.set("user", payload);
        }
    }

    return next();
};

/**
 * Extract user from token - for WebSocket authentication
 */
export function extractUserFromToken(token: string): AccessTokenPayload | null {
    // Returns "nobody" rather than throwing on a backend with no JWT of its
    // own — the socket then closes as unauthenticated, which is the outcome
    // this function already describes.
    if (!isJwtConfigured()) return null;
    return verifyAccessToken(token);
}

/**
 * Create a configurable auth middleware that handles:
 * 1. Token extraction (via custom validator or JWT Bearer token)
 * 2. RLS-scoped DataDriver via withAuth()
 * 3. Enforcement (401 when requireAuth is true and no user)
 *
 * **Secure by default:** `requireAuth` defaults to `true`. Anonymous
 * access is only allowed when the developer explicitly opts out by
 * setting `requireAuth: false`, indicating that Postgres RLS policies
 * fully control access.
 *
 * **Fail-closed:** The raw unscoped driver is never placed in the
 * request context. Every code path either scopes via `withAuth()` or
 * rejects the request. This prevents silent RLS bypass.
 *
 * This is the single source of truth for HTTP auth in Rebase.
 * Use this instead of manually parsing tokens in route handlers.
 */

export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler<HonoEnv> {
    const { driver: baseDriver, resolveDriver, requireAuth: enforceAuth = true, validator, serviceKey, apiKeyStore } = options;

    return async (c, next) => {
        // Pick the per-request delegate (multi-data-source) before scoping.
        const driver = resolveDriver ? resolveDriver(c) : baseDriver;
        if (validator) {
            // Custom validator path (e.g., API keys, external auth)
            try {
                const authResult = await validator(c);
                if (authResult && typeof authResult === "object") {
                    // `uid` first: it is the spelling everything else uses. A
                    // custom validator written against the older `uid` shape
                    // still works — this is a user-supplied extension point, so
                    // it stays tolerant of both rather than breaking on rename.
                    const id = ("uid" in authResult ? authResult.uid : undefined)
                        || ("uid" in authResult ? authResult.uid : undefined);
                    if (id) {
                        const roles = authResult.roles || [];
                        c.set("user", { uid: id,
roles });
                        const user = { uid: id,
roles,
...authResult };
                        c.set("driver", await scopeDataDriver(driver, user));
                    } else {
                        // Validator returned an object but without an ID — scope as anon
                        c.set("driver", await scopeDataDriver(driver, { uid: ANONYMOUS_USER_ID,
roles: ["anon"] }));
                    }
                } else if (authResult === true) {
                    c.set("user", { uid: "default",
roles: [] });
                    c.set("driver", await scopeDataDriver(driver, { uid: "default",
roles: [] }));
                } else {
                    // Not authenticated — scope as anon so RLS can evaluate.
                    // Fail closed: if anon scoping fails, reject instead of
                    // falling back to the raw driver.
                    c.set("driver", await scopeDataDriver(driver, { uid: ANONYMOUS_USER_ID,
roles: ["anon"] }));
                }
            } catch (error) {
                return c.json({ error: { message: "Unauthorized",
code: "UNAUTHORIZED" } }, 401);
            }
        } else {
            // Default JWT path (with optional service key support)
            const token = extractBearerToken(c.req.header("authorization"));

            if (token !== undefined) {
                // ── Service Key check ──────────────────────────────────
                // Check BEFORE JWT verification. Service keys are static
                // secrets (like Service Account keys) that grant admin access
                // for scripts, cron jobs, and server-to-server calls.
                if (serviceKey && safeCompare(token, serviceKey)) {
                    const serviceUser: AccessTokenPayload = {
                        uid: "service",
                        roles: ["admin"]
                    };
                    c.set("user", serviceUser);
                    try {
                        c.set("driver", await scopeDataDriver(driver, {
                            uid: "service",
                            roles: ["admin"]
                        }));
                    } catch (error) {
                        logger.error("[AUTH] RLS scoping failed for service key", { error: error });
                        return c.json({ error: { message: "Internal authentication error",
code: "INTERNAL_ERROR" } }, 500);
                    }
                } else if (apiKeyStore && isApiKeyToken(token)) {
                    // ── API Key verification ──────────────────────────────
                    // Tokens starting with `rk_` are validated against the
                    // api_keys table instead of JWT verification.
                    const result = await validateApiKey(c, token, {
                        store: apiKeyStore,
                        driver
                    });
                    if (result !== true) {
                        return result;
                    }
                } else {
                    // ── JWT verification ───────────────────────────────────
                    const payload = extractUserFromToken(token);

                    if (payload) {
                        c.set("user", payload);
                        try {
                            const user = { uid: payload.uid,
roles: payload.roles };
                            c.set("driver", await scopeDataDriver(driver, user));
                        } catch (error) {
                            // withAuth() failed for a valid token — reject (fail closed)
                            logger.error("[AUTH] RLS scoping failed for authenticated user", { error: error });
                            return c.json({ error: { message: "Internal authentication error",
code: "INTERNAL_ERROR" } }, 500);
                        }
                    } else {
                        // Token present but invalid — always reject.
                        // Providing a malformed token should never grant access,
                        // regardless of requireAuth setting.
                        return c.json({ error: { message: "Invalid or expired token",
code: "UNAUTHORIZED" } }, 401);
                    }
                }
            } else {
                // No token provided — scope as anon for RLS evaluation.
                // Fail closed: if anon scoping fails, return 500 rather
                // than silently proceeding with an unscoped driver.
                try {
                    c.set("driver", await scopeDataDriver(driver, { uid: ANONYMOUS_USER_ID,
roles: ["anon"] }));
                } catch (error) {
                    logger.error("[AUTH] Failed to create anon-scoped driver", { error: error });
                    return c.json({ error: { message: "Server configuration error",
code: "INTERNAL_ERROR" } }, 500);
                }
            }
        }

        if (enforceAuth && !c.get("user")) {
            return c.json({ error: { message: "Unauthorized: Authentication required",
code: "UNAUTHORIZED" } }, 401);
        }

        return next();
    };
}

/**
 * Middleware that authenticates via a `?token=` query parameter.
 *
 * **Use sparingly.** Tokens in URLs leak into access logs, proxy logs,
 * Referer headers, and browser history. This middleware exists solely for
 * routes where the consumer cannot set HTTP headers — e.g. `<img src>`,
 * `<a href>` for file downloads, or similar browser-native requests.
 *
 * Apply it **before** `requireAuth` or `optionalAuth` on the specific
 * route that needs it. Those middlewares will see the user context this
 * middleware sets and skip their own 401 check.
 *
 * @example
 * ```ts
 * router.get("/file/*", queryTokenAuth, readAuthMiddleware, handler);
 * ```
 */
export const queryTokenAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    // Only activate when no Authorization header is present and a query token exists.
    if (extractBearerToken(c.req.header("authorization")) !== undefined) {
        // Authorization header takes precedence — let downstream middleware handle it.
        return next();
    }

    const queryToken = c.req.query("token");
    if (queryToken && isJwtConfigured()) {
        const payload = verifyAccessToken(queryToken);
        if (payload) {
            c.set("user", payload);
        }
        // If the token is invalid, we don't reject here — let the downstream
        // requireAuth / optionalAuth middleware decide the enforcement policy.
    }

    return next();
};

/**
 * Authorizes anonymous access to **public** storage objects (those under the
 * public prefix), which are served token-less via stable, permanent URLs.
 *
 * Runs on the storage `/file/*` and `/metadata/*` routes, *after* the token
 * middleware and *before* the read-auth gate. If the request is already
 * authenticated (Bearer or scoped token), it does nothing. Otherwise, when the
 * requested object path is public, it sets a minimal "public" principal so the
 * downstream `requireAuth` gate lets the read through. Private paths are left
 * untouched, so they still require a valid token.
 */
export const publicObjectAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    // Already authenticated (Bearer / scoped token) — nothing to authorize.
    if (c.get("user")) return next();

    const routePath = c.req.routePath;          // e.g. "/api/storage/file/*"
    const prefix = routePath.replace("/*", "");
    const fullPath = c.req.path;
    const idx = fullPath.indexOf(prefix);
    const rawPath = idx < 0 ? "" : fullPath.substring(idx + prefix.length + 1);

    if (rawPath && isPublicStoragePath(decodeURIComponent(rawPath))) {
        c.set("user", { uid: "public", roles: ["public"] });
    }

    return next();
};

/**
 * Helper to match paths for scoped file tokens.
 * Matches exact paths or prefixes (exact folder prefixes or ending with /).
 *
 * The traversal check is defence in depth, not the load-bearing defence.
 *
 * A prefix comparison is a lie for any path containing `..`: `user1/../user2/x`
 * starts with `user1/`, so a token scoped to `user1/` would authorize reading
 * user2's file — and the storage controller would not object, because its own
 * guard stops a path escaping the *bucket*, and that one resolves to `user2/x`,
 * comfortably inside it. The grant is what would be escaped, and this is the
 * only layer that knows what was granted.
 *
 * Nothing arrives here in that shape today: the URL parser resolves `..` (and
 * `%2e%2e`, which the WHATWG spec treats as a dot for normalization) before
 * Hono routes the request, so this comparison already runs on a resolved path.
 * But that is a guarantee of the runtime rather than of this code, and it is
 * one line to not depend on it. The same rule already guards the public-object
 * path — see `isPublicStoragePath`.
 */
export function isPathMatch(requested: string, allowed: string): boolean {
    if (requested.split("/").some((seg) => seg === "..")) return false;
    if (requested === allowed) return true;
    if (allowed.endsWith("/")) {
        return requested.startsWith(allowed);
    }
    return requested.startsWith(allowed + "/");
}

/**
 * Middleware that authenticates file-serving routes using scoped download tokens.
 * It enforces that only scoped "file-read" tokens can access "/file/*" and "?token=" query params.
 * Full access JWTs are explicitly rejected on "/file/*" routes, and in the "?token=" query param.
 */
export const fileTokenAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    const path = c.req.path;
    const isFileRoute = path.includes("/storage/file/");
    const authHeader = c.req.header("authorization");
    const queryToken = c.req.query("token");

    // Local copy of helper to avoid circular imports with routes.ts
    const extractWildcard = (ctx: import("hono").Context): string => {
        const routePath = ctx.req.routePath;
        const prefix = routePath.replace("/*", "");
        const fullPath = ctx.req.path;
        const idx = fullPath.indexOf(prefix);
        if (idx < 0) return "";
        return fullPath.substring(idx + prefix.length + 1);
    };

    const parseBucketPath = (filePath: string): { bucket: string; resolvedPath: string } => {
        const parts = filePath.split("/");
        if (parts.length > 1 && parts[0].toLowerCase() === "default") {
            return {
                bucket: "default",
                resolvedPath: parts.slice(1).join("/")
            };
        }
        return {
            bucket: "default",
            resolvedPath: filePath
        };
    };

    // 1. Authorization: Bearer <token>
    const bearerToken = extractBearerToken(authHeader);
    if (bearerToken !== undefined) {
        const token = bearerToken;
        const payload = verifyDownloadToken(token);

        if (payload) {
            const rawPath = extractWildcard(c);
            if (rawPath) {
                const filePath = decodeURIComponent(rawPath);
                const { bucket, resolvedPath } = parseBucketPath(filePath);
                const requestedFullPath = `${bucket}/${resolvedPath}`;

                if (isPathMatch(requestedFullPath, payload.path)) {
                    c.set("user", { uid: "download-token", roles: ["reader"] });
                    return next();
                } else {
                    return c.json({ error: { message: "Forbidden: Scoped token path mismatch", code: "FORBIDDEN" } }, 403);
                }
            }
        }

        // If it's a file serving route, explicitly reject full access JWTs
        if (isFileRoute) {
            return c.json({ error: { message: "Unauthorized: Access JWT not allowed on file routes", code: "UNAUTHORIZED" } }, 401);
        }

        // Otherwise (e.g. /metadata/*) let it pass to downstream requireAuth
        return next();
    }

    // 2. Query param: ?token=<token>
    if (queryToken) {
        const payload = verifyDownloadToken(queryToken);

        if (payload) {
            const rawPath = extractWildcard(c);
            if (rawPath) {
                const filePath = decodeURIComponent(rawPath);
                const { bucket, resolvedPath } = parseBucketPath(filePath);
                const requestedFullPath = `${bucket}/${resolvedPath}`;

                if (isPathMatch(requestedFullPath, payload.path)) {
                    c.set("user", { uid: "download-token", roles: ["reader"] });
                    return next();
                } else {
                    return c.json({ error: { message: "Forbidden: Scoped token path mismatch", code: "FORBIDDEN" } }, 403);
                }
            }
        }

        // Explicitly reject query-token if it is not a valid scoped download token (e.g. if it is a full access JWT)
        return c.json({ error: { message: "Unauthorized: Invalid or unauthorized token", code: "UNAUTHORIZED" } }, 401);
    }

    return next();
};

