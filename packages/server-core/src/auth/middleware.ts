import { MiddlewareHandler, Context } from "hono";
import { DataDriver } from "@rebasepro/types";
import { verifyAccessToken, AccessTokenPayload } from "./jwt";
import { HonoEnv } from "../api/types";
import { timingSafeEqual } from "crypto";

/**
 * Result from a custom auth validator.
 * - `false`/`null`/`undefined` = not authenticated
 * - `true` = authenticated as default user
 * - object with `userId` or `uid` = authenticated with user info
 */
export type AuthResult = boolean | null | undefined | { userId?: string; uid?: string; roles?: string[]; [key: string]: unknown };

/**
 * Options for creating an auth middleware via createAuthMiddleware()
 */
export interface AuthMiddlewareOptions {
    /** DataDriver to scope via withAuth() for RLS */
    driver: DataDriver;
    /**
     * If true, return 401 when no valid token is present.
     *
     * **Defaults to `true` (secure by default).** Set to `false` only for
     * intentionally public endpoints where access control is fully delegated
     * to Postgres Row-Level Security policies.
     */
    requireAuth?: boolean;
    /** Optional custom validator (for non-JWT auth, e.g. Firebase Auth) */
    validator?: (c: Context<HonoEnv>) => Promise<AuthResult>;
    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When a request sends `Authorization: Bearer <key>` and the key matches
     * this value, the request is granted admin-level access (uid: `service`,
     * roles: `["admin"]`) **without** JWT verification. The driver is scoped
     * via `withAuth()` with the service identity.
     *
     * This is the Rebase equivalent of a Firebase Service Account key.
     * Set via `REBASE_SERVICE_KEY` in `.env` and pass through the backend config.
     *
     * **Security:** The comparison uses constant-time equality to prevent
     * timing attacks. The key must be at least 32 characters.
     */
    serviceKey?: string;
}

/**
 * Hono middleware that requires a valid JWT token
 * Returns 401 if token is missing or invalid
 */
export const requireAuth: MiddlewareHandler<HonoEnv> = async (
    c,
    next
) => {
    const authHeader = c.req.header("authorization");
    const queryToken = c.req.query("token");
    const hasBearer = authHeader && authHeader.startsWith("Bearer ");

    if (!hasBearer && !queryToken) {
        return c.json({
            error: {
                message: "Authorization header or token query parameter missing or invalid",
                code: "UNAUTHORIZED"
            }
        }, 401);
    }

    const token = hasBearer ? authHeader!.substring(7) : queryToken!;
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
        const authHeader = c.req.header("authorization");
        const queryToken = c.req.query("token");
        const hasBearer = authHeader && authHeader.startsWith("Bearer ");

        if (!hasBearer && !queryToken) {
            return c.json({
                error: {
                    message: "Authorization header or token query parameter missing or invalid",
                    code: "UNAUTHORIZED"
                }
            }, 401);
        }

        const token = hasBearer ? authHeader!.substring(7) : queryToken!;

        // Check service key first (constant-time comparison)
        if (safeCompare(token, key)) {
            c.set("user", { userId: "service", roles: ["admin"] } as AccessTokenPayload);
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
 * Middleware that optionally extracts user from JWT
 * Does not return 401 if token is missing - allows anonymous access
 */
export const optionalAuth: MiddlewareHandler<HonoEnv> = async (
    c,
    next
) => {
    const authHeader = c.req.header("authorization");
    const queryToken = c.req.query("token");
    const hasBearer = authHeader && authHeader.startsWith("Bearer ");

    if (hasBearer || queryToken) {
        const token = hasBearer ? authHeader!.substring(7) : queryToken!;
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
    return verifyAccessToken(token);
}

/**
 * Helper to scope a DataDriver via withAuth() for RLS.
 * SECURITY: If withAuth() is available but fails, the error is re-thrown
 * so the request is denied rather than proceeding with unscoped access.
 */
async function scopeDataDriver(
    driver: DataDriver,
    user: { uid: string; roles?: string[] }
): Promise<DataDriver> {
    if ("withAuth" in driver && typeof (driver as Record<string, unknown>).withAuth === "function") {
        // Fail closed — do NOT catch and swallow errors here.
        // If RLS scoping fails the request must be rejected.
        return await (driver as unknown as { withAuth: (user: Record<string, unknown>) => Promise<DataDriver> }).withAuth(user);
    }
    return driver;
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
/**
 * Constant-time string comparison to prevent timing attacks on service keys.
 *
 * We intentionally avoid early-returning on length mismatch because that
 * would leak the key's length through timing differences. Instead, both
 * inputs are padded to the same length so `timingSafeEqual` always runs
 * over equal-length buffers.
 */
function safeCompare(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length);
    // Pad both to maxLen so timingSafeEqual always compares equal-length buffers.
    // If the original lengths differ the result will be false due to the padding
    // difference, but the comparison still takes constant time.
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a);
    bufB.write(b);
    try {
        const isEqual = timingSafeEqual(bufA, bufB);
        // Even though padding makes mismatched-length strings compare as
        // different bytes, we still need to verify lengths match to avoid
        // a padded shorter string accidentally equaling a longer one that
        // has trailing null bytes.
        return isEqual && a.length === b.length;
    } catch {
        return false;
    }
}

export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler<HonoEnv> {
    const { driver, requireAuth: enforceAuth = true, validator, serviceKey } = options;

    return async (c, next) => {
        if (validator) {
            // Custom validator path (e.g., Firebase Auth, API keys)
            try {
                const authResult = await validator(c);
                if (authResult && typeof authResult === "object") {
                    const id = ("userId" in authResult ? authResult.userId : undefined)
                        || ("uid" in authResult ? authResult.uid : undefined);
                    if (id) {
                        const roles = authResult.roles || [];
                        c.set("user", { userId: id, roles });
                        const user = { uid: id, roles, ...authResult };
                        c.set("driver", await scopeDataDriver(driver, user));
                    } else {
                        // Validator returned an object but without an ID — scope as anon
                        c.set("driver", await scopeDataDriver(driver, { uid: "anon", roles: ["anon"] }));
                    }
                } else if (authResult === true) {
                    c.set("user", { userId: "default", roles: [] });
                    c.set("driver", await scopeDataDriver(driver, { uid: "default", roles: [] }));
                } else {
                    // Not authenticated — scope as anon so RLS can evaluate.
                    // Fail closed: if anon scoping fails, reject instead of
                    // falling back to the raw driver.
                    c.set("driver", await scopeDataDriver(driver, { uid: "anon", roles: ["anon"] }));
                }
            } catch (error) {
                return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
            }
        } else {
            // Default JWT path (with optional service key support)
            const authHeader = c.req.header("authorization");
            const queryToken = c.req.query("token");
            const hasBearer = authHeader && authHeader.startsWith("Bearer ");

            if (hasBearer || queryToken) {
                const token = hasBearer ? authHeader!.substring(7) : queryToken!;

                // ── Service Key check ──────────────────────────────────
                // Check BEFORE JWT verification. Service keys are static
                // secrets (like Firebase SA keys) that grant admin access
                // for scripts, cron jobs, and server-to-server calls.
                if (serviceKey && safeCompare(token, serviceKey)) {
                    const serviceUser: AccessTokenPayload = {
                        userId: "service",
                        roles: ["admin"]
                    };
                    c.set("user", serviceUser);
                    try {
                        c.set("driver", await scopeDataDriver(driver, {
                            uid: "service",
                            roles: ["admin"]
                        }));
                    } catch (error) {
                        console.error("[AUTH] RLS scoping failed for service key:", error);
                        return c.json({ error: { message: "Internal authentication error", code: "INTERNAL_ERROR" } }, 500);
                    }
                } else {
                    // ── JWT verification ───────────────────────────────────
                    const payload = extractUserFromToken(token);

                    if (payload) {
                        c.set("user", payload);
                        try {
                            const user = { uid: payload.userId, roles: payload.roles };
                            c.set("driver", await scopeDataDriver(driver, user));
                        } catch (error) {
                            // withAuth() failed for a valid token — reject (fail closed)
                            console.error("[AUTH] RLS scoping failed for authenticated user:", error);
                            return c.json({ error: { message: "Internal authentication error", code: "INTERNAL_ERROR" } }, 500);
                        }
                    } else {
                        // Token present but invalid — always reject.
                        // Providing a malformed token should never grant access,
                        // regardless of requireAuth setting.
                        return c.json({ error: { message: "Invalid or expired token", code: "UNAUTHORIZED" } }, 401);
                    }
                }
            } else {
                // No token provided — scope as anon for RLS evaluation.
                // Fail closed: if anon scoping fails, return 500 rather
                // than silently proceeding with an unscoped driver.
                try {
                    c.set("driver", await scopeDataDriver(driver, { uid: "anon", roles: ["anon"] }));
                } catch (error) {
                    console.error("[AUTH] Failed to create anon-scoped driver:", error);
                    return c.json({ error: { message: "Server configuration error", code: "INTERNAL_ERROR" } }, 500);
                }
            }
        }

        if (enforceAuth && !c.get("user")) {
            return c.json({ error: { message: "Unauthorized: Authentication required", code: "UNAUTHORIZED" } }, 401);
        }

        return next();
    };
}
