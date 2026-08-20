/**
 * Route guards for custom functions.
 *
 * These decide access from the identity the platform already resolved. They do
 * **not** verify tokens, and that division is the point rather than a
 * limitation:
 *
 * - Verifying a token needs a signing key, constant-time comparison and a
 *   revocation lookup. That is host work, it belongs to the process that holds
 *   the secret, and it is the part of the stack that cannot be made
 *   runtime-neutral without rewriting it against WebCrypto.
 * - Deciding whether *this* caller may call *this* route is application work.
 *   It needs nothing but the resolved identity, so it costs nothing to make it
 *   portable — and it is the half that lives in user code.
 *
 * Splitting there is what lets a function file compile and run unchanged on a
 * host with no Node built-ins, and it is why these live in
 * `@rebasepro/server/functions` while `verifyAccessToken` does not.
 *
 * **Inside the functions router these are equivalent to the guards exported
 * from the package root.** Both auth middlewares resolve the identity before
 * any handler runs: a valid credential populates `user`, an invalid one is
 * rejected with 401 by the middleware itself, and a missing one leaves `user`
 * unset. So the root `requireAuth`'s token-parsing branch is unreachable from a
 * function, and removing it changes no outcome. The one difference is a handler
 * mounted **outside** the framework's router, where no middleware ran: the root
 * guard would parse the `Authorization` header itself, and these refuse the
 * request with a 500 that names the wiring problem. Fail-closed, and legible.
 *
 * @module
 */
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { getUser, isAdmin, getRoles, identityResolved } from "./context";

/**
 * The answer to "a guard ran, but no middleware had resolved anything".
 *
 * Deliberately a 500 and not a 401. A 401 tells the caller their credential is
 * the problem, and here the caller's credential was never looked at — sending
 * them to check their token is sending them to the one place the answer is not.
 */
function unresolvedIdentity(): { error: { message: string; code: string } } {
    return {
        error: {
            message:
                "This route's identity was never resolved: no Rebase auth middleware ran " +
                "before the guard. A function loaded from the functions directory always " +
                "has one. This usually means the Hono app was mounted onto your own " +
                "server directly, bypassing the functions router.",
            code: "AUTH_MIDDLEWARE_MISSING"
        }
    };
}

/**
 * Reject anonymous callers with 401.
 *
 * Put it in the route's own middleware slot rather than `app.use("/*", …)`:
 * `use()` covers only the routes declared *below* it, so a route appended later
 * — by you, months from now, at the bottom of the file — is silently
 * unprotected. The per-route form cannot drift that way.
 *
 * @example
 * ```ts
 * app.post("/", requireAuth, async (c) => {
 *     const user = getUser(c)!;  // guaranteed by the guard
 *     return c.json({ uid: user.uid });
 * });
 * ```
 */
export const requireAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    if (getUser(c)) return next();
    if (!identityResolved(c)) return c.json(unresolvedIdentity(), 500);

    return c.json({
        error: {
            message: "Authentication required",
            code: "UNAUTHORIZED"
        }
    }, 401);
};

/**
 * Reject callers without an administrative role with 403.
 *
 * Must come **after** {@link requireAuth}: on its own it answers 401 for an
 * anonymous caller, which is right, but pairing them keeps the two failures
 * distinguishable — 401 "who are you", 403 "not you".
 *
 * Administrative means `admin` or `schema-admin`, from the single list in
 * `auth/admin-roles.ts`. Do not compare against `"admin"` by hand; that is the
 * divergence that list exists to prevent.
 */
export const requireAdmin: MiddlewareHandler<HonoEnv> = async (c, next) => {
    const user = getUser(c);
    if (!user) {
        if (!identityResolved(c)) return c.json(unresolvedIdentity(), 500);
        return c.json({
            error: {
                message: "Authentication required",
                code: "UNAUTHORIZED"
            }
        }, 401);
    }

    if (!isAdmin(c)) {
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
 * Reject callers holding none of the named roles with 403.
 *
 * Any of them, not all — require several by chaining the guard twice. Naming no
 * role at all is a programming error and throws at module load rather than at
 * request time, because `requireRole()` with an empty list would otherwise read
 * as a guard while admitting everyone.
 *
 * @example
 * ```ts
 * app.post("/publish", requireAuth, requireRole("editor", "admin"), handler);
 * ```
 */
export function requireRole(...roles: string[]): MiddlewareHandler<HonoEnv> {
    if (roles.length === 0) {
        throw new Error(
            "requireRole() needs at least one role. An empty list would admit every " +
            "signed-in caller while reading as a restriction."
        );
    }

    const allowed = new Set(roles);
    return async (c, next) => {
        const user = getUser(c);
        if (!user) {
            if (!identityResolved(c)) return c.json(unresolvedIdentity(), 500);
            return c.json({
                error: {
                    message: "Authentication required",
                    code: "UNAUTHORIZED"
                }
            }, 401);
        }

        if (!getRoles(c).some(role => allowed.has(role))) {
            return c.json({
                error: {
                    message: `This operation requires one of these roles: ${roles.join(", ")}`,
                    code: "FORBIDDEN"
                }
            }, 403);
        }

        return next();
    };
}
