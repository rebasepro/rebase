/**
 * RebaseBuiltinAuthAdapter
 *
 * Wraps Rebase's existing built-in JWT auth system (routes, middleware, user/role
 * management) into the `AuthAdapter` interface. This is the default adapter used
 * when the user passes a plain `RebaseAuthConfig` object.
 *
 * This is NOT a rewrite — it delegates to the existing `createAuthRoutes()`,
 * `createAdminRoutes()`, and `verifyAccessToken()` functions. The goal is to
 * present the same functionality through the pluggable `AuthAdapter` contract.
 */

import type {
    AuthAdapter,
    AuthenticatedUser,
    AuthAdapterCapabilities,
    UserManagementAdapter,
    RoleManagementAdapter,
    AuthUserListOptions,
    AuthUserListResult,
    AuthUserData,
    AuthCreateUserData,
    AuthRoleData,
    AuthCreateRoleData,
    BootstrappedAuth,
    BackendHooks,
} from "@rebasepro/types";

import type { Hono } from "hono";
import { verifyAccessToken } from "./jwt";
import type { AccessTokenPayload } from "./jwt";
import { createAuthRoutes } from "./routes";
import { createAdminRoutes } from "./admin-routes";
import type { AuthRepository, OAuthProvider } from "./interfaces";
import type { EmailService, EmailConfig } from "../email";
import type { HonoEnv } from "../api/types";
import { safeCompare } from "./crypto-utils";

/**
 * Configuration for the built-in Rebase auth adapter.
 *
 * This mirrors the existing `RebaseAuthConfig` — users pass this and
 * server-core auto-wraps it in a `RebaseBuiltinAuthAdapter`.
 */
export interface BuiltinAuthAdapterConfig {
    /** The bootstrapper-provided auth repository (users, roles, tokens). */
    authRepository: AuthRepository;
    /** Email service for password resets, verification, etc. */
    emailService?: EmailService;
    /** Email configuration. */
    emailConfig?: EmailConfig;
    /** Whether to allow new user registration. */
    allowRegistration?: boolean;
    /** Default role to assign to new users. */
    defaultRole?: string;
    /** OAuth providers to register. */
    oauthProviders?: OAuthProvider<unknown>[];
    /** Static service key for server-to-server auth. */
    serviceKey?: string;
    /** Backend hooks for intercepting admin data. */
    hooks?: BackendHooks;
}

/**
 * Create the built-in Rebase auth adapter.
 *
 * This wraps the existing auth infrastructure (JWT, OAuth, user/role management)
 * into the `AuthAdapter` interface. It's used internally by `initializeRebaseBackend()`
 * when the user passes a plain `RebaseAuthConfig` object.
 */
export function createBuiltinAuthAdapter(config: BuiltinAuthAdapterConfig): AuthAdapter {
    const {
        authRepository,
        emailService,
        emailConfig,
        allowRegistration = false,
        defaultRole,
        oauthProviders = [],
        serviceKey,
        hooks,
    } = config;

    const adapter: AuthAdapter = {
        id: "rebase-builtin",

        serviceKey,

        async verifyRequest(request: Request): Promise<AuthenticatedUser | null> {
            const authHeader = request.headers.get("authorization");
            const url = new URL(request.url, "http://localhost");
            const queryToken = url.searchParams.get("token");
            const hasBearer = authHeader?.startsWith("Bearer ");

            if (!hasBearer && !queryToken) {
                return null;
            }

            const token = hasBearer ? authHeader!.substring(7) : queryToken!;

            // Check service key first (constant-time)
            if (serviceKey && safeCompare(token, serviceKey)) {
                return {
                    uid: "service",
                    email: "service@rebase.internal",
                    roles: ["admin"],
                    isAdmin: true,
                    rawToken: token,
                };
            }

            // JWT verification
            const payload = verifyAccessToken(token);
            if (!payload) {
                return null;
            }

            // The decoded JWT may contain additional claims beyond the typed payload
            const extendedPayload = payload as AccessTokenPayload & {
                email?: string;
                displayName?: string;
            };

            // Resolve roles from the repository
            let roles: string[] = payload.roles || [];
            try {
                const userRoles = await authRepository.getUserRoles(payload.userId);
                roles = userRoles.map((r) => r.id);
            } catch {
                // Fall back to token roles if repository lookup fails
            }

            const isAdmin = roles.some((r) => r === "admin" || r === "schema-admin");

            return {
                uid: payload.userId,
                email: extendedPayload.email ?? "",
                displayName: extendedPayload.displayName ?? null,
                roles,
                isAdmin,
                rawToken: token,
            };
        },

        async verifyToken(token: string): Promise<AuthenticatedUser | null> {
            // Service key check (constant-time)
            if (serviceKey && safeCompare(token, serviceKey)) {
                return {
                    uid: "service",
                    email: "service@rebase.internal",
                    roles: ["admin"],
                    isAdmin: true,
                    rawToken: token,
                };
            }

            // JWT verification
            const payload = verifyAccessToken(token);
            if (!payload) {
                return null;
            }

            const extendedPayload = payload as AccessTokenPayload & {
                email?: string;
                displayName?: string;
            };

            let roles: string[] = payload.roles || [];
            try {
                const userRoles = await authRepository.getUserRoles(payload.userId);
                roles = userRoles.map((r) => r.id);
            } catch {
                // Fall back to token roles if repository lookup fails
            }

            const isAdmin = roles.some((r) => r === "admin" || r === "schema-admin");

            return {
                uid: payload.userId,
                email: extendedPayload.email ?? "",
                displayName: extendedPayload.displayName ?? null,
                roles,
                isAdmin,
                rawToken: token,
            };
        },

        userManagement: createUserManagementFromRepo(authRepository),

        roleManagement: createRoleManagementFromRepo(authRepository),

        createAuthRoutes(): Hono<HonoEnv> | undefined {
            return createAuthRoutes({
                authRepo: authRepository,
                emailService,
                emailConfig,
                allowRegistration,
                defaultRole,
                oauthProviders,
            });
        },

        createAdminRoutes(): Hono<HonoEnv> | undefined {
            return createAdminRoutes({
                authRepo: authRepository,
                emailService,
                emailConfig,
                serviceKey,
                hooks,
            });
        },

        async getCapabilities(): Promise<AuthAdapterCapabilities> {
            // Detect bootstrap mode: are there any users?
            let needsSetup = false;
            try {
                const result = await authRepository.listUsersPaginated({ limit: 1 });
                needsSetup = result.total === 0;
            } catch {
                // If the check fails, assume not in setup mode
            }

            const enabledProviders = oauthProviders.map((p) => p.id);

            return {
                hasBuiltInAuthRoutes: true,
                emailPasswordLogin: true,
                registration: allowRegistration || needsSetup,
                registrationEnabled: allowRegistration || needsSetup,
                passwordReset: !!emailService?.isConfigured(),
                sessionManagement: true,
                profileUpdate: true,
                emailVerification: !!emailService?.isConfigured(),
                enabledProviders,
                needsSetup,
            };
        },
    };

    return adapter;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function createUserManagementFromRepo(repo: AuthRepository): UserManagementAdapter {
    return {
        async listUsers(options?: AuthUserListOptions): Promise<AuthUserListResult> {
            const result = await repo.listUsersPaginated({
                limit: options?.limit,
                offset: options?.offset,
                search: options?.search,
                orderBy: options?.orderBy,
                orderDir: options?.orderDir,
                roleId: options?.roleId,
            });
            return {
                users: result.users.map(toAuthUserData),
                total: result.total,
                limit: result.limit,
                offset: result.offset,
            };
        },

        async getUserById(id: string): Promise<AuthUserData | null> {
            const user = await repo.getUserById(id);
            return user ? toAuthUserData(user) : null;
        },

        async createUser(data: AuthCreateUserData): Promise<AuthUserData> {
            const { hashPassword } = await import("./password");
            const passwordHash = data.password ? await hashPassword(data.password) : undefined;
            const user = await repo.createUser({
                email: data.email,
                passwordHash,
                displayName: data.displayName,
                photoUrl: data.photoUrl,
            });
            return toAuthUserData(user);
        },

        async updateUser(id: string, data: Partial<AuthCreateUserData>): Promise<AuthUserData | null> {
            const updateData: Record<string, unknown> = {};
            if (data.email !== undefined) updateData.email = data.email;
            if (data.displayName !== undefined) updateData.displayName = data.displayName;
            if (data.photoUrl !== undefined) updateData.photoUrl = data.photoUrl;
            if (data.password) {
                const { hashPassword } = await import("./password");
                updateData.passwordHash = await hashPassword(data.password);
            }
            const user = await repo.updateUser(id, updateData);
            return user ? toAuthUserData(user) : null;
        },

        async deleteUser(id: string): Promise<void> {
            await repo.deleteUser(id);
        },

        async getUserRoles(userId: string): Promise<AuthRoleData[]> {
            const roles = await repo.getUserRoles(userId);
            return roles.map(toAuthRoleData);
        },

        async setUserRoles(userId: string, roleIds: string[]): Promise<void> {
            await repo.setUserRoles(userId, roleIds);
        },
    };
}

function createRoleManagementFromRepo(repo: AuthRepository): RoleManagementAdapter {
    return {
        async listRoles(): Promise<AuthRoleData[]> {
            const roles = await repo.listRoles();
            return roles.map(toAuthRoleData);
        },

        async getRoleById(id: string): Promise<AuthRoleData | null> {
            const role = await repo.getRoleById(id);
            return role ? toAuthRoleData(role) : null;
        },

        async createRole(data: AuthCreateRoleData): Promise<AuthRoleData> {
            const role = await repo.createRole({
                id: data.id,
                name: data.name,
                isAdmin: data.isAdmin,
                defaultPermissions: data.defaultPermissions,
                collectionPermissions: data.collectionPermissions,
                config: data.config,
            });
            return toAuthRoleData(role);
        },

        async updateRole(id: string, data: Partial<AuthRoleData>): Promise<AuthRoleData | null> {
            const role = await repo.updateRole(id, data);
            return role ? toAuthRoleData(role) : null;
        },

        async deleteRole(id: string): Promise<void> {
            await repo.deleteRole(id);
        },
    };
}

function toAuthUserData(user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; createdAt?: Date; updatedAt?: Date }): AuthUserData {
    return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

function toAuthRoleData(role: { id: string; name: string; isAdmin: boolean; defaultPermissions?: unknown; collectionPermissions?: unknown; config?: unknown }): AuthRoleData {
    return {
        id: role.id,
        name: role.name,
        isAdmin: role.isAdmin,
        defaultPermissions: role.defaultPermissions as AuthRoleData["defaultPermissions"],
        collectionPermissions: role.collectionPermissions as AuthRoleData["collectionPermissions"],
        config: role.config as AuthRoleData["config"],
    };
}
