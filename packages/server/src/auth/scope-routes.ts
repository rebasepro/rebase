/**
 * `GET /auth/scopes` — every scope this backend knows, described, and the
 * ones the caller holds.
 *
 * What a screen needs to offer scopes for a key or a role: the built-in ones,
 * the app's own `auth.scopes`, their wording and what their targets name. Any
 * authenticated caller may read it; it describes the backend's vocabulary,
 * not anybody's data.
 *
 * @module
 */

import { Hono, type MiddlewareHandler } from "hono";
import { summarizeScopes } from "@rebasepro/types";
import { errorHandler } from "../api/errors";
import { callerScopes, getAccessModel } from "./access";
import { createRequireAuth } from "./middleware";
import type { AuthRepository } from "./interfaces";
import type { HonoEnv } from "../api/types";

export interface ScopeRouteOptions {
    serviceKey?: string;
    resolveRoles?: (uid: string) => Promise<string[]>;
    revocationRepo?: Pick<AuthRepository, "getTokensValidAfter">;
    /** Authenticates `rk_` keys first, so a key can read what it holds. */
    apiKeyPreAuth?: MiddlewareHandler<HonoEnv>;
}

export function createScopeRoutes(options: ScopeRouteOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    if (options.apiKeyPreAuth) router.use("/*", options.apiKeyPreAuth);
    router.use("/*", createRequireAuth({
        serviceKey: options.serviceKey,
        resolveRoles: options.resolveRoles,
        revocationRepo: options.revocationRepo
    }));
    router.get("/", (c) => c.json({
        scopes: summarizeScopes(getAccessModel()),
        held: callerScopes(c)
    }));
    return router;
}
