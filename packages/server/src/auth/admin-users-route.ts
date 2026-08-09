/**
 * Standalone admin endpoint for user management.
 *
 * Mounts:
 *   GET /users
 *   GET /users/:uid
 *   POST /users
 *   PUT /users/:uid
 *   DELETE /users/:uid
 *   POST /bootstrap
 */

import { Hono } from "hono";
import { isAnonymousUid } from "@rebasepro/types";
import { normalizeEmail } from "@rebasepro/common";
import { ApiError, errorHandler } from "../api/errors";
import type { AuthRepository } from "./interfaces";
import { createRequireAuth, requireAdmin } from "./middleware";
import type { AuthHooks } from "./auth-hooks";
import { resolveAuthHooks } from "./auth-hooks";
import { prepareAdminUserValues, finalizeAdminUserCreation } from "./admin-user-ops";
import type { EmailService, EmailConfig } from "../email";
import type { HonoEnv } from "../api/types";
import type { AdminUser, AuthCollectionConfig } from "@rebasepro/types";
import { resolveListLimitParam } from "../api/rest/query-parser";
import { logger } from "../utils/logger";

export interface AdminUsersRouteConfig {
    authRepo: AuthRepository;
    emailService?: EmailService;
    emailConfig?: EmailConfig;
    serviceKey?: string;
    authHooks?: AuthHooks;
    collectionAuthConfig?: AuthCollectionConfig;
    isBootstrapCompleted?: () => Promise<boolean>;
    setBootstrapCompleted?: () => Promise<void>;
}

/** Upper bound for `GET /users?ids=…`, so one request can't fan out unbounded. */
const MAX_USER_IDS_PER_LOOKUP = 100;

export function createAdminUsersRoute(config: AdminUsersRouteConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const authRepo = config.authRepo;
    const { emailService, emailConfig, collectionAuthConfig } = config;
    const ops = resolveAuthHooks(config.authHooks);

    function toAdminUser(
        u: {
            id: string;
            email: string;
            displayName?: string | null;
            photoUrl?: string | null;
            createdAt?: Date | string;
            updatedAt?: Date | string;
        },
        roles: string[]
    ): AdminUser {
        return {
            uid: u.id,
            email: u.email,
            displayName: u.displayName ?? null,
            photoURL: u.photoUrl ?? null,
            providerId: "custom",
            roles,
            createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : (u.createdAt ?? new Date().toISOString()),
            updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : (u.updatedAt ?? new Date().toISOString())
        };
    }

    router.onError(errorHandler);
    router.use("/*", createRequireAuth({
        serviceKey: config.serviceKey,
        // These routes can grant roles, so they must not trust a role claim.
        resolveRoles: uid => authRepo.getUserRoleIds(uid),
        revocationRepo: authRepo
    }));

    router.post("/bootstrap", async (c) => {
        const user = c.get("user");
        if (!user || typeof user !== "object") {
            throw ApiError.unauthorized("Not authenticated");
        }

        if (config.isBootstrapCompleted) {
            const alreadyDone = await config.isBootstrapCompleted();
            if (alreadyDone) {
                throw ApiError.forbidden("Bootstrap has already been completed.", "BOOTSTRAP_COMPLETED");
            }
        }

        const users = await authRepo.listUsers();
        let hasAdmin = false;

        for (const u of users) {
            const roles = await authRepo.getUserRoleIds(u.id);
            if (roles.includes("admin")) {
                hasAdmin = true;
                break;
            }
        }

        if (hasAdmin) {
            throw ApiError.forbidden("Admin users already exist. Bootstrap not allowed.", "BOOTSTRAP_COMPLETED");
        }

        const uid = "uid" in user ? (user as { uid: string }).uid : undefined;
        if (!uid) {
            throw ApiError.unauthorized("User ID not found in auth context");
        }

        // An anonymous session may not claim the initial admin role.
        //
        // `POST /auth/anonymous` mints a real session for anyone who asks, and
        // an anonymous principal is a row in the users table like any other —
        // so on an empty backend it was also the *earliest* one, which is the
        // only thing the land-grab gate below checks. Two unauthenticated
        // requests therefore took a fresh deployment: anonymous session, then
        // bootstrap. It worked with `disableSelfRegistration: true` as well,
        // the flag whose docblock promises "an empty backend has no
        // self-service path in at all".
        if (isAnonymousUid(uid)) {
            logger.warn("[Security Audit] Bootstrap denied: anonymous caller", {
                eventType: "auth.bootstrap.denied.anonymous",
                callerId: uid
            });
            throw ApiError.forbidden(
                "An anonymous session cannot claim the initial admin role. Register a real " +
                "account and bootstrap from it, or assign the admin role using the service key.",
                "BOOTSTRAP_ANONYMOUS"
            );
        }
        const caller = await authRepo.getUserById(uid);
        if (!caller) {
            throw ApiError.notFound("Authenticated user does not exist in the database.", "USER_NOT_FOUND");
        }

        // Even while no admin exists, only the earliest-registered user may claim
        // the initial admin role. The common paths already auto-promote the first
        // user, so this endpoint only matters once a system has reached a "users
        // exist but no admin" state — e.g. concurrent first-registrations, or the
        // first user being deleted. Without this gate, any authenticated user
        // could then seize admin: a land-grab. The genuine first user is
        // deterministic; tie-break by id so identical timestamps still resolve to
        // a single winner.
        // Anonymous principals are excluded from "earliest registered" for the
        // same reason they cannot bootstrap: they are sessions, not
        // registrations. Leaving them in would also let an anonymous row that
        // happens to predate the real first user block that user forever.
        const registeredUsers = users.filter(u => !isAnonymousUid(u.id));
        if (registeredUsers.length > 0) {
            const earliest = registeredUsers.reduce((a, b) => {
                const at = new Date(a.createdAt).getTime();
                const bt = new Date(b.createdAt).getTime();
                if (at !== bt) return at < bt ? a : b;
                return a.id < b.id ? a : b;
            });
            if (earliest.id !== uid) {
                logger.warn("[Security Audit] Bootstrap denied: caller is not the earliest-registered user", {
                    eventType: "auth.bootstrap.denied",
                    callerId: uid,
                    earliestUserId: earliest.id
                });
                throw ApiError.forbidden(
                    "Only the first registered user may claim the initial admin role. " +
                    "Ask that user to bootstrap, or assign the admin role using the service key.",
                    "BOOTSTRAP_NOT_FIRST_USER"
                );
            }
        }

        await authRepo.setUserRoles(uid, ["admin"]);
        logger.info("[Security Audit] Initial admin bootstrapped", {
            eventType: "auth.bootstrap.success",
            uid
        });

        if (config.setBootstrapCompleted) {
            await config.setBootstrapCompleted();
        }

        return c.json({
            success: true,
            message: "You are now an admin",
            user: {
                uid: uid,
                roles: ["admin"]
            }
        });
    });

    router.get("/users", requireAdmin, async (c) => {
        // `?ids=a,b,c` resolves a known set of users in one round trip. The admin
        // UI needs it to turn the ids stored in `userSelect` columns into names
        // without firing one request per row.
        const idsParam = c.req.query("ids");
        if (idsParam !== undefined) {
            const ids = [...new Set(idsParam.split(",").map(id => id.trim()).filter(Boolean))]
                .slice(0, MAX_USER_IDS_PER_LOOKUP);
            const resolved = await Promise.all(ids.map(async (id) => {
                const result = await authRepo.getUserWithRoles(id);
                return result ? toAdminUser(result.user, result.roles.map((r) => r.id)) : undefined;
            }));
            const users = resolved.filter((u): u is AdminUser => u !== undefined);
            return c.json({ users,
total: users.length,
limit: ids.length,
offset: 0 });
        }

        const limitParam = c.req.query("limit");
        const offsetParam = c.req.query("offset");
        const search = c.req.query("search");
        const orderBy = c.req.query("orderBy");
        const orderDir = c.req.query("orderDir") as "asc" | "desc" | undefined;

        // Same bounded guarantee as every other list ingress: an absent limit
        // gets this endpoint's own 25 default, and one above the ceiling is a
        // 400 naming it rather than a shorter page that reads like the end of
        // the user list.
        const limit = resolveListLimitParam(limitParam, { defaultLimit: 25 });
        const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;

        const result = await authRepo.listUsersPaginated({
            limit,
            offset,
            search: search || undefined,
            orderBy: orderBy || undefined,
            orderDir: orderDir || undefined,
            roleId: c.req.query("role") || undefined
        });

        const usersWithRoles = await Promise.all(
            result.users.map(async (u) => {
                const roles = await authRepo.getUserRoleIds(u.id);
                return toAdminUser(u, roles);
            })
        );

        return c.json({
            users: usersWithRoles,
            total: result.total,
            limit: result.limit,
            offset: result.offset
        });
    });

    router.get("/users/:uid", requireAdmin, async (c) => {
        const uid = c.req.param("uid");
        const result = await authRepo.getUserWithRoles(uid);

        if (!result) {
            throw ApiError.notFound("User not found");
        }

        const adminUser = toAdminUser(result.user, result.roles.map((r) => r.id));
        return c.json({ user: adminUser });
    });

    router.post("/users", requireAdmin, async (c) => {
        const body = await c.req.json();
        const { email, roles } = body;
        if (!email) {
            throw ApiError.badRequest("Email is required");
        }

        const existing = await authRepo.getUserByEmail(normalizeEmail(email));
        if (existing) {
            throw ApiError.conflict("A user with this email already exists");
        }

        const prepResult = await prepareAdminUserValues(body, {
            authRepo,
            emailService,
            emailConfig,
            resolvedHooks: ops,
            collectionAuthConfig
        });

        const user = await authRepo.createUser({
            email: prepResult.values.email as string,
            passwordHash: prepResult.values.passwordHash as string | undefined,
            displayName: prepResult.values.displayName as string | undefined,
            photoUrl: prepResult.values.photoUrl as string | undefined,
            metadata: prepResult.values.metadata as Record<string, unknown> | undefined
        });

        if (roles && Array.isArray(roles)) {
            await authRepo.setUserRoles(user.id, roles);
        }

        const finalizeResult = await finalizeAdminUserCreation(
            { id: user.id,
values: prepResult.values },
            prepResult.clearPassword,
            {
                authRepo,
                emailService,
                emailConfig,
                resolvedHooks: ops,
                collectionAuthConfig
            }
        );

        const userRoles = await authRepo.getUserRoleIds(user.id);
        const adminUser = toAdminUser(user, userRoles);

        return c.json(
            {
                user: adminUser,
                invitationSent: finalizeResult.invitationSent,
                ...(finalizeResult.temporaryPassword ? { temporaryPassword: finalizeResult.temporaryPassword } : {}),
                ...(finalizeResult.emailDeliveryFailed ? { emailDeliveryFailed: true } : {})
            },
            201
        );
    });

    router.put("/users/:uid", requireAdmin, async (c) => {
        const uid = c.req.param("uid");
        const body = await c.req.json();
        const { password, email, displayName, roles } = body;

        const existing = await authRepo.getUserById(uid);
        if (!existing) {
            throw ApiError.notFound("User not found");
        }

        const updates: Record<string, unknown> = {};
        if (email !== undefined) updates.email = normalizeEmail(email);
        if (displayName !== undefined) updates.displayName = displayName;

        if (password) {
            const validation = ops.validatePasswordStrength(password);
            if (!validation.valid) {
                throw ApiError.badRequest(`Password too weak: ${validation.errors.join(". ")}`);
            }
            updates.passwordHash = await ops.hashPassword(password);
        }

        if (Object.keys(updates).length > 0) {
            await authRepo.updateUser(uid, updates);
        }

        if (roles !== undefined && Array.isArray(roles)) {
            const currentRoles = await authRepo.getUserRoleIds(uid);
            const wasAdmin = currentRoles.includes("admin");
            const willBeAdmin = roles.includes("admin");

            if (wasAdmin && !willBeAdmin) {
                const adminUsers = await authRepo.listUsersPaginated({
                    roleId: "admin",
                    limit: 1
                });
                if (adminUsers.total <= 1) {
                    throw ApiError.forbidden("Cannot demote the last administrator", "LAST_ADMIN");
                }
            }
            await authRepo.setUserRoles(uid, roles);
        }

        const result = await authRepo.getUserWithRoles(uid);
        const adminUser = toAdminUser(result!.user, result!.roles.map((r) => r.id));

        return c.json({ user: adminUser });
    });

    router.delete("/users/:uid", requireAdmin, async (c) => {
        const uid = c.req.param("uid");
        const authUser = c.get("user") as { uid?: string } | undefined;

        if (authUser?.uid === uid) {
            throw ApiError.badRequest("Cannot delete your own account", "SELF_DELETE");
        }

        const existing = await authRepo.getUserById(uid);
        if (!existing) {
            throw ApiError.notFound("User not found");
        }

        const roles = await authRepo.getUserRoleIds(uid);
        if (roles.includes("admin")) {
            const adminUsers = await authRepo.listUsersPaginated({
                roleId: "admin",
                limit: 1
            });
            if (adminUsers.total <= 1) {
                throw ApiError.forbidden("Cannot delete the last administrator", "LAST_ADMIN");
            }
        }

        await authRepo.deleteUser(uid);
        return c.json({ success: true });
    });

    return router;
}
