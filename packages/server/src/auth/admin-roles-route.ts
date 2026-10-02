/**
 * Admin endpoint for listing roles.
 *
 * Mounts: GET /roles — the built-in `admin` role and the roles the app
 * declares under `auth.roles` on the users collection, with the scopes each
 * holds. Requires `users:read`.
 */

import { Hono } from "hono";
import { summarizeRoles } from "@rebasepro/types";
import { errorHandler } from "../api/errors";
import type { AuthRepository } from "./interfaces";
import { createRequireAuth } from "./middleware";
import { getAccessModel, requireScope } from "./access";
import type { HonoEnv } from "../api/types";

export interface AdminRolesRouteConfig {
    authRepo: AuthRepository;
    serviceKey?: string;
}

/**
 * Create a standalone admin route for listing roles.
 *
 * Mounts: GET /roles
 */
export function createAdminRolesRoute(config: AdminRolesRouteConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const authRepo = config.authRepo;

    router.onError(errorHandler);
    router.use("/*", createRequireAuth({
        serviceKey: config.serviceKey,
        resolveRoles: uid => authRepo.getUserRoleIds(uid),
        revocationRepo: authRepo
    }));

    router.get("/roles", requireScope("users:read"), (c) => {
        return c.json({ roles: summarizeRoles(getAccessModel()) });
    });

    return router;
}
