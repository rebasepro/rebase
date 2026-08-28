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
 * Authorization is double-gated for API keys: the key's own permission list
 * (checked by the REST generator) is one ceiling, and Postgres RLS is another,
 * independent one — `withAuth()` runs API-key requests as the restricted
 * `rebase_user` role like any other caller. An `admin` key passes RLS via the
 * injected `default_admin` policies; a non-admin key (roles `["service"]`,
 * uid `api-key:<id>`) only sees rows that a policy explicitly grants to the
 * `service` role or to the public. Owner-style policies
 * (`owner_id = rebase.uid()`) never match an API key's synthetic uid.
 *
 * @module
 */

import type { Context, MiddlewareHandler } from "hono";
import type { DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../../api/types";
import type { ApiKeyStore } from "./api-key-store";
import type { ApiKeyMasked } from "./api-key-types";
import { scopeDataDriver } from "../rls-scope";
import { extractBearerToken } from "../bearer-token";
import { httpMethodToOperation, isFunctionAllowed, isStorageAllowed } from "./api-key-permission-guard";
import { logger } from "../../utils/logger";
import { sha256Hex } from "../../utils/portable-crypto";

/**
 * Check whether a token looks like a Rebase API key.
 */
export function isApiKeyToken(token: string): boolean {
    return token.startsWith("rk_");
}

/**
 * Hash a plaintext API key token for database lookup.
 *
 * Async because it hashes with WebCrypto rather than `node:crypto` — the sole
 * caller was already awaiting the store lookup this feeds.
 */
function hashToken(token: string): Promise<string> {
    return sha256Hex(token);
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

    const hash = await hashToken(token);
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
    const uid = `api-key:${apiKey.id}`;
    const roles: string[] = apiKey.admin ? ["admin", "service"] : ["service"];
    c.set("user", { uid,
roles });

    // Expose masked key metadata for downstream permission checks
    const masked: ApiKeyMasked = {
        id: apiKey.id,
        name: apiKey.name,
        key_prefix: apiKey.key_prefix,
        permissions: apiKey.permissions,
        admin: apiKey.admin,
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

    // Scope the DataDriver. API keys do NOT bypass RLS: withAuth() downgrades
    // to the restricted rebase_user role like every other caller. Admin keys
    // pass via the default_admin policies; non-admin keys are additionally
    // bound by whatever the collection policies grant the "service" role.
    try {
        const scopedDriver = await scopeDataDriver(driver, {
            uid,
            roles
        });
        c.set("driver", scopedDriver);
    } catch (error) {
        logger.error("[AUTH] RLS scoping failed for API key", { error: error });
        return c.json({
            error: { message: "Internal authentication error",
code: "INTERNAL_ERROR" }
        }, 500);
    }

    // Touch last_used_at in the background (non-blocking), debounced: every
    // API-key request on every surface routes through here, and per-request
    // UPDATEs would serialize on the single api_keys row for a busy key.
    // Minute-resolution is plenty for a "last used" display.
    const lastTouch = lastUsedTouchedAt.get(apiKey.id);
    const now = Date.now();
    if (!lastTouch || now - lastTouch >= LAST_USED_DEBOUNCE_MS) {
        lastUsedTouchedAt.set(apiKey.id, now);
        store.updateLastUsed(apiKey.id).catch(() => {
            // Swallowed intentionally — logged inside the store
        });
    }

    return true;
}

/** Per-process debounce state for last_used_at touches. */
const lastUsedTouchedAt = new Map<string, number>();
const LAST_USED_DEBOUNCE_MS = 60_000;

/**
 * Shared 403 response for API-key permission denials outside the REST
 * generator (storage and functions guards). One envelope, one code — a
 * change to the error contract happens in one place.
 */
function forbidApiKey(c: Context<HonoEnv>, operation: string, resource: string, grantHint: string): Response {
    return c.json({
        error: {
            message: `API key does not have "${operation}" permission for ${resource}. ` +
                `Grant it with a permission entry like { "collection": "${grantHint}", "operations": ["${operation}"] }.`,
            code: "API_KEY_FORBIDDEN"
        }
    }, 403);
}

/**
 * Permission guard for API-key requests to the storage router.
 *
 * Storage previously did not accept API keys at all (`rk_` tokens were
 * misparsed as JWTs and 401'd). Now that the pre-auth middleware
 * authenticates them, this guard decides what they may do: the key needs a
 * `"storage"` permission entry (or the global `"*"` wildcard) covering the
 * operation derived from the HTTP method. Requests not authenticated via an
 * API key pass through to the storage router's own auth gates.
 *
 * TUS resumable-upload routes (`/tus`, `/tus/:id`) are classified as `write`
 * for EVERY method: the protocol's offset check is a GET and its cancel is a
 * DELETE, but both are steps of an upload — a write-scoped key must be able
 * to complete (and abort) its own resumable upload without also holding
 * `read`/`delete` on stored objects.
 */
export function createStorageApiKeyGuard(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const apiKey = c.get("apiKey") as ApiKeyMasked | undefined;
        if (!apiKey) return next();

        const isTus = /\/tus(\/|$)/.test(c.req.path);
        const operation = isTus ? "write" : httpMethodToOperation(c.req.method);
        if (!isStorageAllowed(apiKey.permissions, operation)) {
            return forbidApiKey(c, operation, "storage", "storage");
        }

        return next();
    };
}

/**
 * Permission guard for API-key requests to the custom-functions router.
 *
 * The collection permission guard lives in the REST generator and never sees
 * function routes, so before this middleware existed ANY valid API key —
 * however narrowly scoped — could invoke every custom function. This guard
 * closes that: API-key requests must hold a `"functions"`/`"functions/<name>"`
 * permission entry (or the global `"*"` wildcard) for the derived operation.
 *
 * Non-API-key requests (JWT, service key, anonymous) pass through untouched —
 * functions decide their own auth for those, as before.
 *
 * @param mountPrefix - The path the functions router is mounted at
 *                      (e.g. `/api/functions`), used to extract the function
 *                      name from the request path.
 */
export function createFunctionApiKeyGuard(mountPrefix: string): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const apiKey = c.get("apiKey") as ApiKeyMasked | undefined;
        if (!apiKey) return next();

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
            // functions/<name> entry, so only namespace-wide grants pass.
            functionName = rawName;
        }

        const operation = httpMethodToOperation(c.req.method);
        if (!isFunctionAllowed(apiKey.permissions, functionName, operation)) {
            const resource = functionName ? `function "${functionName}"` : "the functions index";
            return forbidApiKey(c, operation, resource, `functions${functionName ? `/${functionName}` : ""}`);
        }

        return next();
    };
}

/**
 * Standalone pre-auth middleware for `rk_` bearer tokens.
 *
 * Routers whose auth gate is JWT-based (`requireAuth` / `createRequireAuth` —
 * the admin surfaces: admin users/roles, api-keys management, cron, backups,
 * logs, schema editor) don't know about API keys. Mounting this middleware in
 * front of them authenticates `rk_` tokens and populates the request context;
 * the downstream gates then see the already-resolved user and apply their
 * role checks (`requireAdmin`) as usual — so an `admin: true` key passes and
 * a non-admin key is rejected with 403.
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
