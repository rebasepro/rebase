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
 * 5. Honours or refuses the RLS simulator's `x-rebase-simulate-*` headers
 *    (`applySimulation`) and `x-rebase-impersonate` (`applyImpersonation`)
 * 6. Enforces auth (401) when `requireAuth` is true and no user is found
 *
 * The behavior is identical to `createAuthMiddleware()` — only the
 * token verification strategy is pluggable.
 */

import type { MiddlewareHandler, Context } from "hono";
import type { DataDriver, AuthAdapter, AuthenticatedUser } from "@rebasepro/types";
import { ANONYMOUS_USER_ID } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { scopeDataDriver, SERVICE_IDENTITY } from "./rls-scope";
import { validateApiKey } from "./api-keys/api-key-middleware";
import { applyImpersonation } from "./impersonation";
import { applySimulation } from "./simulation";
import { extractBearerToken } from "./bearer-token";
import { logger } from "../utils/logger";
import { ApiError } from "../api/errors";
import { refuse } from "./middleware";

export interface AdapterAuthMiddlewareOptions {
    /** The auth adapter to delegate verification to. */
    adapter: AuthAdapter;
    /** The DataDriver to scope via withAuth() for RLS. */
    driver: DataDriver;
    /**
     * Optional per-request driver resolver for multi-data-source backends.
     * Returns the unscoped delegate to use for this request (the Postgres
     * database its collection is routed to). When omitted, `driver` is used for every request.
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
 * What a request is refused with when `adapter.verifyRequest` throws: the
 * adapter's own answer when it gave one, otherwise a 401 — fail closed either
 * way. The built-in adapter throws the 401 that says why a session is refused
 * (`SESSION_REVOKED`, `ACCOUNT_DISABLED`) and a 503 when it cannot read the
 * caller's account (`DATABASE_UNAVAILABLE` when the database is down). Every
 * door that asks an adapter answers with this, so none of them turns an outage
 * into a bad session, which sends the client to refresh one that is fine.
 */
export function adapterRefusal(error: unknown): ApiError {
    return error instanceof ApiError && error.statusCode >= 400 ? error : ApiError.unauthenticated("Unauthorized");
}

/** What {@link verifyWithAdapter} decided: who the caller is (`null`: nobody), or why they are refused. */
export type AdapterVerdict = { user: AuthenticatedUser | null } | { refused: ApiError };

/**
 * Ask the backend's auth adapter who sent a request — the one place every door
 * that reads "who is calling" asks it: the data and functions routers here, and
 * the admin gate and the caller-described documents (`/schema/tables`, OpenAPI)
 * through {@link createAdapterCallerResolution}. A throw is the adapter's
 * refusal ({@link adapterRefusal}), never a 500.
 */
export async function verifyWithAdapter(adapter: AuthAdapter, c: Context<HonoEnv>): Promise<AdapterVerdict> {
    try {
        return { user: await adapter.verifyRequest(c.req.raw) };
    } catch (error) {
        // adapter.verifyRequest() threw — reject the request (fail closed).
        return { refused: adapterRefusal(error) };
    }
}

/** The request's `user` for an account the adapter recognised. */
function requestUserOf(user: AuthenticatedUser): NonNullable<HonoEnv["Variables"]["user"]> {
    return {
        uid: user.uid,
        email: user.email,
        roles: user.roles,
        isAnonymous: user.isAnonymous === true
    };
}

/**
 * The caller resolution of the surfaces outside the data plane, through the
 * same adapter the data routes ask ({@link verifyWithAdapter}), so a backend
 * with its own adapter is answered there as it is on `/data`.
 *
 * - `identify` sets `user` when the adapter recognises the request and lets a
 *   request with no credential through as nobody; a credential that is
 *   presented and not recognised is a 401, never read as anonymous.
 * - `require` does the same and refuses nobody with a 401.
 *
 * A caller an earlier middleware already resolved (an `rk_` key, an `rpt_`
 * platform token) is kept. Neither scopes the data driver, simulates or
 * impersonates: these surfaces judge the caller's scopes, not rows.
 */
export function createAdapterCallerResolution(adapter: AuthAdapter): {
    identify: MiddlewareHandler<HonoEnv>;
    require: MiddlewareHandler<HonoEnv>;
} {
    const resolve = (required: boolean): MiddlewareHandler<HonoEnv> => async (c, next) => {
        if (c.get("user")) return next();
        const verdict = await verifyWithAdapter(adapter, c);
        if ("refused" in verdict) return refuse(c, verdict.refused);
        if (verdict.user) {
            c.set("user", requestUserOf(verdict.user));
            return next();
        }
        if (c.req.header("authorization") !== undefined) {
            return refuse(c, ApiError.unauthenticated("Invalid or expired token"));
        }
        if (required) return refuse(c, ApiError.unauthenticated("Authorization header missing or invalid"));
        return next();
    };
    return { identify: resolve(false), require: resolve(true) };
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
                if (result !== true) return result;
                const refusedSimulation = await applySimulation(c, { credential: "api-key", driver });
                if (refusedSimulation) return refusedSimulation;
                const refused = await applyImpersonation(c, { credential: "api-key", driver });
                if (refused) return refused;
                return next();
            }
        }

        const verdict = await verifyWithAdapter(adapter, c);
        if ("refused" in verdict) return refuse(c, verdict.refused);
        const authenticatedUser = verdict.user;

        if (authenticatedUser) {
            // Authenticated — set user context and scope driver
            c.set("user", requestUserOf(authenticatedUser));
            try {
                c.set("driver", await scopeDataDriver(driver, {
                    uid: authenticatedUser.uid,
                    roles: authenticatedUser.roles,
                    // A guest is a signed-in caller with no account behind
                    // them. Absent from an adapter that has no such concept,
                    // and absent reads as "not a guest".
                    isAnonymous: authenticatedUser.isAnonymous === true,
                    // The token's custom claims, as `createAuthMiddleware`
                    // passes them: `rebase.jwt()` and claim-form tenancy read
                    // them. The identity keys are written over them when the
                    // driver builds the database identity.
                    ...(authenticatedUser.claims ? { claims: authenticatedUser.claims } : {})
                }));
            } catch (error) {
                logger.error("[AUTH-ADAPTER] RLS scoping failed for authenticated user", { error: error });
                return refuse(c, ApiError.internal("Internal authentication error"));
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
                return refuse(c, ApiError.unauthenticated("Invalid or expired token"));
            }

            // Not authenticated — scope as anon for RLS evaluation
            try {
                c.set("driver", await scopeDataDriver(driver, { uid: ANONYMOUS_USER_ID,
roles: ["anon"] }));
            } catch (error) {
                logger.error("[AUTH-ADAPTER] Failed to create anon-scoped driver", { error: error });
                return refuse(c, ApiError.internal("Server configuration error"));
            }
        }

        // After the caller's own scoping, so a refusal is decided on who they
        // are, and a grant replaces their identity rather than adding to it.
        // The built-in adapter verifies the service key as `SERVICE_IDENTITY`,
        // which is how that credential is recognised here.
        const credential = !authenticatedUser
            ? "none"
            : authenticatedUser.uid === SERVICE_IDENTITY.uid ? "service-key" : "session";
        const resolveUser = adapter.resolveUser ? adapter.resolveUser.bind(adapter) : undefined;
        // Simulated access first: it refuses a request that also impersonates.
        const refusedSimulation = await applySimulation(c, { credential, driver, resolveUser, apiKeyStore });
        if (refusedSimulation) return refusedSimulation;
        const refused = await applyImpersonation(c, { credential, driver, resolveUser });
        if (refused) return refused;

        // Enforce auth if required. Word for word the JWT middleware's message,
        // for the reason set out there: a bare "Unauthorized" from a collection
        // whose author wrote `access: "public"` reads as broken RLS, and the two
        // paths must not explain the same gate differently.
        // A simulated anonymous caller has no `user` but is let past: see
        // `auth/simulation.ts`.
        if (enforceAuth && !c.get("user") && !c.get("simulation")) {
            return refuse(c, ApiError.unauthenticated(
                "Unauthorized: Authentication required. This is the API-level gate, not a row " +
                "rule — a table granting public reads still needs a caller. Set " +
                "AUTH_REQUIRE=false (or `auth.requireAuth: false`) to let RLS alone decide."
            ));
        }

        return next();
    };
}
