/**
 * Routes for managing API keys.
 *
 * - {@link createApiKeyRoutes} — the project's service keys, under
 *   `/api/admin/api-keys`, for holders of `keys:read` / `keys:write`.
 * - {@link createPersonalKeyRoutes} — the caller's own personal keys, under
 *   `/api/auth/keys`, when the app enables `auth.personalKeys`.
 *
 * All routes return masked keys (never the hash). The full plaintext key is
 * returned exactly once, in the response that creates it. No API key may call
 * either router.
 *
 * @module
 */

import { Hono, type MiddlewareHandler } from "hono";
import type { AccessModel } from "@rebasepro/types";
import { ApiError, errorHandler } from "../../api/errors";
import { createRequireAuth } from "../middleware";
import { callerScopes, getAccessModel, requireScopeByMethod } from "../access";
import type { HonoEnv } from "../../api/types";
import type { ApiKeyStore } from "./api-key-store";
import type { UpdateApiKeyRequest } from "./api-key-types";
import {
    assertRolesGrantable,
    assertScopesGrantable,
    readExpiresAt,
    readName,
    readRateLimit,
    readRolesField,
    readScopesField,
    type KeyTargets
} from "./key-grant";

export interface ApiKeyRouteOptions {
    store: ApiKeyStore;
    serviceKey?: string;
    /**
     * Read the caller's roles from the database rather than from their token.
     *
     * A key minted here may outlive the session that minted it, so the roles
     * that bound what it may hold must be the caller's roles now — not the
     * ones a token issued before a demotion still claims. See
     * `createRequireAuth`.
     */
    resolveRoles?: (uid: string) => Promise<string[]>;
    /** Repository for the token-revocation watermark. See `createRequireAuth`. */
    revocationRepo?: import("../token-revocation").AccessJudgeRepository;
    /** What a scope's target may name. Unset, targets are not checked for existence. */
    targets?: KeyTargets;
    /** The access model to validate scopes against. Defaults to the configured one. */
    accessModel?: () => AccessModel;
}

/**
 * Refuse API-key-authenticated requests to the key-management routes.
 *
 * A key that could manage keys could mint its own successor, widen itself, or
 * revoke the keys other integrations run on — and revoking it would undo none
 * of that, because the keys it minted are ordinary rows with no link back to
 * it. So key management is for a person, or the service key. Reads are
 * refused alongside writes: a listing of every key's name, prefix and scopes
 * is reconnaissance for exactly that.
 *
 * `keys:*` can never be granted to a key either (`key-grant.ts`); this guard is
 * what makes the rule hold for a key minted before that, and for personal
 * keys, whose routes need no scope.
 */
const rejectApiKeyAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    if (c.get("apiKey")) {
        // Names where the service key comes from, because "use the service key"
        // sent readers looking for something they had no way to obtain: it is
        // injected by the platform, so it is not in their config, and it is
        // reserved, so `env set` refuses it.
        throw ApiError.forbidden(
            "API keys cannot manage API keys. Authenticate as a person, or use the service key — " +
            "REBASE_SERVICE_KEY in this server's environment, or `rebase cloud env reveal REBASE_SERVICE_KEY` " +
            "on Rebase Cloud.",
            "API_KEY_SELF_MANAGEMENT_FORBIDDEN"
        );
    }
    return next();
};

/** The caller's uid and roles, as the auth gate resolved them. */
function caller(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): { uid: string; roles: string[]; isAnonymous: boolean } {
    const user = c.get("user");
    if (!user || typeof user !== "object" || !("uid" in user) || typeof user.uid !== "string") {
        throw ApiError.unauthenticated("Authentication required");
    }
    const roles = "roles" in user && Array.isArray(user.roles)
        ? user.roles.filter((role): role is string => typeof role === "string")
        : [];
    const isAnonymous = "isAnonymous" in user && user.isAnonymous === true;
    return { uid: user.uid, roles, isAnonymous };
}

async function readBody(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        throw ApiError.badRequest("Request body must be JSON", "INVALID_INPUT");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw ApiError.badRequest("Request body must be a JSON object", "INVALID_INPUT");
    }
    return Object.fromEntries(Object.entries(body));
}

/**
 * The project's service keys: `GET` needs `keys:read`, everything else
 * `keys:write`.
 */
export function createApiKeyRoutes(options: ApiKeyRouteOptions): Hono<HonoEnv> {
    const { store, serviceKey, resolveRoles, revocationRepo, targets } = options;
    const model = options.accessModel ?? getAccessModel;
    const router = new Hono<HonoEnv>();

    router.onError(errorHandler);

    router.use("/*", createRequireAuth({ serviceKey, resolveRoles, revocationRepo }));
    // Before the scope check, so a key gets the reason it was refused rather
    // than a missing scope that implies a wider key would work.
    router.use("/*", rejectApiKeyAuth);
    router.use("/*", requireScopeByMethod({ read: "keys:read", write: "keys:write" }));

    router.get("/", async (c) => {
        const keys = await store.listApiKeys({ kind: "service" });
        return c.json({ keys });
    });

    router.post("/", async (c) => {
        const body = await readBody(c);
        const name = readName(body.name);
        const scopes = readScopesField(body.scopes);
        const roles = body.roles === undefined ? [] : readRolesField(body.roles);
        const rate_limit = readRateLimit(body.rate_limit) ?? null;
        const expires_at = readExpiresAt(body.expires_at, true) ?? null;
        const minter = caller(c);

        assertScopesGrantable(scopes, callerScopes(c), model(), targets);
        assertRolesGrantable(roles, minter.roles);

        const key = await store.createApiKey({
            name,
            kind: "service",
            scopes,
            roles,
            owner_uid: null,
            rate_limit,
            expires_at
        }, minter.uid);

        return c.json({ key }, 201);
    });

    router.get("/:id", async (c) => {
        const key = await store.getApiKeyById(c.req.param("id"));
        if (!key || key.kind !== "service") {
            throw ApiError.notFound("API key not found");
        }
        return c.json({ key });
    });

    router.put("/:id", async (c) => {
        const id = c.req.param("id");
        const body = await readBody(c);
        const minter = caller(c);
        const updates: UpdateApiKeyRequest = {};

        if (body.name !== undefined) updates.name = readName(body.name);
        if (body.scopes !== undefined) {
            updates.scopes = readScopesField(body.scopes);
            assertScopesGrantable(updates.scopes, callerScopes(c), model(), targets);
        }
        if (body.roles !== undefined) {
            updates.roles = readRolesField(body.roles);
            assertRolesGrantable(updates.roles, minter.roles);
        }
        const rateLimit = readRateLimit(body.rate_limit);
        if (rateLimit !== undefined) updates.rate_limit = rateLimit;
        const expiresAt = readExpiresAt(body.expires_at, false);
        if (expiresAt !== undefined) updates.expires_at = expiresAt;

        const key = await store.updateApiKey(id, updates);
        if (!key) {
            throw ApiError.notFound("API key not found");
        }
        return c.json({ key });
    });

    router.delete("/:id", async (c) => {
        const revoked = await store.revokeApiKey(c.req.param("id"));
        if (!revoked) {
            throw ApiError.notFound("API key not found or already revoked");
        }
        return c.json({ success: true });
    });

    return router;
}

export interface PersonalKeyRouteOptions {
    store: ApiKeyStore;
    /** Whether the app enabled `auth.personalKeys`. Off, every route explains how to turn it on. */
    enabled: boolean;
    /** Recognised only to be refused with a reason: the service key has no account. */
    serviceKey?: string;
    resolveRoles?: (uid: string) => Promise<string[]>;
    revocationRepo?: import("../token-revocation").AccessJudgeRepository;
    targets?: KeyTargets;
    accessModel?: () => AccessModel;
}

/**
 * The caller's own keys. Each acts as the caller — their account, their roles
 * as they are when the key is used — and holds no scope the caller does not.
 *
 * For a signed-in account only: not a key, not the service key (it has no
 * account to act as) and not a guest, whose account is one sign-out from gone.
 */
export function createPersonalKeyRoutes(options: PersonalKeyRouteOptions): Hono<HonoEnv> {
    const { store, enabled, serviceKey, resolveRoles, revocationRepo, targets } = options;
    const model = options.accessModel ?? getAccessModel;
    const router = new Hono<HonoEnv>();

    router.onError(errorHandler);

    if (!enabled) {
        router.all("/*", () => {
            throw ApiError.forbidden(
                "Personal API keys are switched off on this backend. Set `personalKeys: true` in the " +
                "auth block of the users collection to let accounts create them.",
                "PERSONAL_KEYS_DISABLED"
            );
        });
        return router;
    }

    router.use("/*", createRequireAuth({ serviceKey, resolveRoles, revocationRepo }));
    router.use("/*", rejectApiKeyAuth);
    router.use("/*", async (c, next) => {
        const me = caller(c);
        if (me.uid === "service") {
            throw ApiError.forbidden(
                "The service key has no account for a personal key to act as. Create a service key " +
                "under /api/admin/api-keys instead.",
                "PERSONAL_KEY_NEEDS_ACCOUNT"
            );
        }
        if (me.isAnonymous) {
            throw ApiError.forbidden(
                "A guest session cannot create API keys. Sign in to an account first.",
                "PERSONAL_KEY_NEEDS_ACCOUNT"
            );
        }
        return next();
    });

    router.get("/", async (c) => {
        const keys = await store.listApiKeys({ kind: "personal", owner_uid: caller(c).uid });
        return c.json({ keys });
    });

    router.post("/", async (c) => {
        const body = await readBody(c);
        if (body.roles !== undefined) {
            throw ApiError.badRequest(
                "A personal key runs as your account's roles and takes none of its own.",
                "INVALID_INPUT"
            );
        }
        if (body.rate_limit !== undefined) {
            throw ApiError.badRequest(
                "A personal key uses the server's API-key rate limit and cannot set its own.",
                "INVALID_INPUT"
            );
        }
        const name = readName(body.name);
        const scopes = readScopesField(body.scopes);
        const expires_at = readExpiresAt(body.expires_at, true) ?? null;
        const me = caller(c);

        assertScopesGrantable(scopes, callerScopes(c), model(), targets);

        const key = await store.createApiKey({
            name,
            kind: "personal",
            scopes,
            roles: [],
            owner_uid: me.uid,
            rate_limit: null,
            expires_at
        }, me.uid);

        return c.json({ key }, 201);
    });

    router.delete("/:id", async (c) => {
        const revoked = await store.revokeApiKey(c.req.param("id"), caller(c).uid);
        if (!revoked) {
            throw ApiError.notFound("API key not found or already revoked");
        }
        return c.json({ success: true });
    });

    return router;
}
