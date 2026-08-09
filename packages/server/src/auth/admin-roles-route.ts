/**
 * Admin endpoint for listing all roles.
 *
 * Mounts: GET /roles
 */

import { Hono } from "hono";
import { errorHandler } from "../api/errors";
import type { AuthRepository } from "./interfaces";
import { createRequireAuth, requireAdmin } from "./middleware";
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
        // These routes can grant roles, so they must not trust a role claim.
        resolveRoles: uid => authRepo.getUserRoleIds(uid)
    }));

    router.get("/roles", requireAdmin, async (c) => {
        const roles = await authRepo.listRoles();
        return c.json({ roles });
    });

    return router;
}
