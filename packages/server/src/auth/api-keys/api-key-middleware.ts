/**
 * Authenticating requests that present an API key (`rk_`).
 *
 * {@link resolveApiKey} turns a presented key into the identity it acts as and
 * the scopes it holds; the HTTP middlewares, the realtime socket and `/mcp`
 * all call it, so a key means the same thing on every surface.
 *
 * - A **service key** acts as `api-key:<id>`, with the RLS roles `service`
 *   plus whatever it was given, and holds exactly its scopes.
 * - A **personal key** acts as its owner — their uid and their roles as they
 *   are *now*, read on every use — and holds its scopes narrowed to what the
 *   owner's roles still hold. Demote the owner and the key shrinks with them;
 *   delete the account and the key stops.
 *
 * A key never bypasses RLS: the request's driver is scoped to the identity
 * like any other caller's, so the scopes are one ceiling and the database's
 * policies another, independent one.
 *
 * @module
 */

import type { Context, MiddlewareHandler } from "hono";
import { intersectScopes, scopesForRoles, scopeGrants, scopeGrantsAny, type DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../../api/types";
import type { ApiKeyStore } from "./api-key-store";
import type { ApiKeyMasked } from "./api-key-types";
import { scopeDataDriver } from "../rls-scope";
import { extractBearerToken } from "../bearer-token";
import { getAccessModel, getKeyOwnerResolver } from "../access";
import { logger } from "../../utils/logger";
import { sha256Hex } from "../../utils/portable-crypto";
import { ApiError, errorHandler } from "../../api/errors";

/**
 * Check whether a token looks like a Rebase API key.
 */
export function isApiKeyToken(token: string): boolean {
    return token.startsWith("rk_");
}

/** Who a verified key acts as, and what it may do. */
export interface ApiKeyIdentity {
    uid: string;
    roles: string[];
    scopes: string[];
    apiKey: ApiKeyMasked;
}

/** A presented key that does not authenticate, and why. */
export interface ApiKeyRefusal {
    message: string;
}

/**
 * Verify a presented key: it exists, is live, and — for a personal key —
 * personal keys are on and its owner still exists. Records the use.
 */
export async function resolveApiKey(store: ApiKeyStore, token: string): Promise<ApiKeyIdentity | ApiKeyRefusal> {
    const apiKey = await store.findByKeyHash(await sha256Hex(token));

    if (!apiKey) return { message: "Invalid API key" };
    if (apiKey.revoked_at) return { message: "API key has been revoked" };
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) return { message: "API key has expired" };

    let identity: { uid: string; roles: string[]; scopes: string[] };
    if (apiKey.kind === "personal") {
        const resolveOwner = getKeyOwnerResolver();
        if (!resolveOwner || !apiKey.owner_uid) {
            return { message: "Personal API keys are switched off on this backend" };
        }
        const owner = await resolveOwner(apiKey.owner_uid);
        if (!owner) return { message: "The account this API key acts as no longer exists" };
        identity = {
            uid: apiKey.owner_uid,
            roles: owner.roles,
            scopes: intersectScopes(apiKey.scopes, scopesForRoles(owner.roles, getAccessModel()))
        };
    } else {
        identity = {
            uid: `api-key:${apiKey.id}`,
            roles: ["service", ...apiKey.roles.filter(role => role !== "service")],
            scopes: apiKey.scopes
        };
    }

    // Debounced: every request a busy key makes routes through here, and an
    // UPDATE per request would serialize on its one row.
    const lastTouch = lastUsedTouchedAt.get(apiKey.id);
    const now = Date.now();
    if (!lastTouch || now - lastTouch >= LAST_USED_DEBOUNCE_MS) {
        lastUsedTouchedAt.set(apiKey.id, now);
        store.updateLastUsed(apiKey.id).catch(() => {
            // Swallowed intentionally — logged inside the store
        });
    }

    const masked: ApiKeyMasked = {
        id: apiKey.id,
        name: apiKey.name,
        kind: apiKey.kind,
        key_prefix: apiKey.key_prefix,
        scopes: apiKey.scopes,
        roles: apiKey.roles,
        owner_uid: apiKey.owner_uid,
        rate_limit: apiKey.rate_limit,
        created_by: apiKey.created_by,
        created_at: apiKey.created_at,
        updated_at: apiKey.updated_at,
        last_used_at: apiKey.last_used_at,
        expires_at: apiKey.expires_at,
        revoked_at: apiKey.revoked_at
    };
    return { ...identity, apiKey: masked };
}

/** Per-process debounce state for last_used_at touches. */
const lastUsedTouchedAt = new Map<string, number>();
const LAST_USED_DEBOUNCE_MS = 60_000;

/**
 * Options for the API key authentication handler.
 */
export interface ApiKeyAuthOptions {
    store: ApiKeyStore;
    driver: DataDriver;
}

/**
 * Validate an API key token and populate the Hono context: `user`, `apiKey`,
 * `scopes` and the RLS-scoped `driver`.
 *
 * Returns `true` when the context is populated, or the error Response.
 */
export async function validateApiKey(
    c: Context<HonoEnv>,
    token: string,
    options: ApiKeyAuthOptions
): Promise<Response | true> {
    const resolved = await resolveApiKey(options.store, token);
    if (!("uid" in resolved)) {
        return errorHandler(ApiError.unauthenticated(resolved.message), c) as Response;
    }

    c.set("user", { uid: resolved.uid, roles: resolved.roles });
    c.set("apiKey", resolved.apiKey);
    c.set("scopes", resolved.scopes);

    try {
        c.set("driver", await scopeDataDriver(options.driver, {
            uid: resolved.uid,
            roles: resolved.roles
        }));
    } catch (error) {
        logger.error("[AUTH] RLS scoping failed for API key", { error: error });
        return errorHandler(ApiError.internal("Internal authentication error"), c) as Response;
    }

    return true;
}

/**
 * The 403 for a credential that lacks a data-plane scope outside the REST
 * generator (storage and functions). Names the scope that would grant it.
 */
export function forbidScope(c: Context<HonoEnv>, scope: string, target?: string): Response {
    const wanted = target !== undefined && target !== "" ? `${scope}:${target}` : scope;
    return errorHandler(new ApiError(403, "SCOPE_MISSING",
        `This credential does not hold the "${wanted}" scope.`,
        { requiredScope: wanted }), c) as Response;
}

/** Whether this request's caller holds `scope` — on `target` when given. */
function callerHolds(c: Context<HonoEnv>, scope: string, target?: string): boolean {
    const narrowed = c.get("scopes");
    if (!narrowed) return true; // a person: the data plane is theirs, RLS and policies decide
    return target === undefined ? scopeGrantsAny(narrowed, scope) : scopeGrants(narrowed, scope, target);
}

/**
 * Scope guard for the resumable-upload routes (`/tus/:id`).
 *
 * Every step of an upload — the offset check (HEAD), the chunks (PATCH), the
 * cancel (DELETE) — is part of writing it, so all of them need
 * `storage:write`. Which source the upload writes to was checked when it was
 * created; these steps only reach an upload the same caller owns.
 */
export function createTusScopeGuard(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        if (/\/tus\/[^/]+$/.test(c.req.path) && c.get("user") && !callerHolds(c, "storage:write")) {
            return forbidScope(c, "storage:write");
        }
        return next();
    };
}

/**
 * Scope guard for the custom-functions router: a narrowed credential needs
 * `functions:invoke` on the function it calls. The functions index — the
 * listing at the mount point itself — needs the unqualified scope.
 *
 * People pass: what a person may do inside a function is the function's own
 * business, as it always was.
 *
 * @param mountPrefix - The path the functions router is mounted at
 *                      (e.g. `/api/functions`), used to extract the function
 *                      name from the request path.
 */
export function createFunctionScopeGuard(mountPrefix: string): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const narrowed = c.get("scopes");
        if (!narrowed) return next();

        const path = c.req.path;
        const idx = path.indexOf(mountPrefix);
        const rest = idx < 0 ? "" : path.slice(idx + mountPrefix.length);
        const rawName = rest.split("/").filter(Boolean)[0] ?? "";
        let functionName: string;
        try {
            functionName = decodeURIComponent(rawName);
        } catch {
            // Malformed percent-encoding (e.g. %ZZ) — fall back to the raw
            // segment rather than throwing a 500. It won't match any
            // functions:invoke:<name> grant, so only the unqualified one passes.
            functionName = rawName;
        }

        const allowed = functionName === ""
            ? scopeGrants(narrowed, "functions:invoke")
            : scopeGrants(narrowed, "functions:invoke", functionName);
        if (!allowed) return forbidScope(c, "functions:invoke", functionName);
        return next();
    };
}

/**
 * Pre-auth middleware for `rk_` bearer tokens.
 *
 * Routers whose auth gate is JWT-based (`createRequireAuth` — the admin
 * surfaces, the key routes) don't know about API keys. Mounted in front of
 * them, this authenticates `rk_` tokens and populates the request context; the
 * downstream gates then see the already-resolved caller and check its scopes.
 *
 * Requests without an `rk_` bearer token pass through untouched. An invalid,
 * revoked, or expired `rk_` token is rejected here (401) rather than falling
 * through to be misparsed as a JWT.
 */
export function createApiKeyPreAuth(options: ApiKeyAuthOptions): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        // Already validated by an earlier instance (e.g. the app-level
        // /admin/* pre-auth composing with a router-level one) — don't hit
        // the store twice.
        if (c.get("apiKey")) return next();

        const token = extractBearerToken(c.req.header("authorization")) ?? "";
        if (!token || !isApiKeyToken(token)) return next();

        const result = await validateApiKey(c, token, options);
        if (result !== true) return result;
        return next();
    };
}
