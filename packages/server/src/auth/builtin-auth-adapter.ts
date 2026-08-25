/**
 * RebaseBuiltinAuthAdapter
 *
 * Wraps Rebase's existing built-in JWT auth system (routes, middleware, user/role
 * management) into the `AuthAdapter` interface. This is the default adapter used
 * when the user passes a plain `RebaseAuthConfig` object.
 *
 * This is NOT a rewrite — it delegates to the existing `createAuthRoutes()`,
 * `createResetPasswordRoute()`, and `verifyAccessToken()` functions. The goal is to
 * present the same functionality through the pluggable `AuthAdapter` contract.
 */

import type {
    AuthAdapter,
    AuthenticatedUser,
    AuthAdapterCapabilities,
    UserManagementAdapter,
    AuthUserListOptions,
    AuthUserListResult,
    AuthUserData,
    AuthCreateUserData,
    BootstrappedAuth
} from "@rebasepro/types";

import { Hono } from "hono";
import { isAccessTokenRevoked } from "./token-revocation";
import { hasAdministrativeRole } from "./admin-roles";
import { verifyAccessToken } from "./jwt";
import type { AccessTokenPayload } from "./jwt";
import { createAuthRoutes } from "./routes";
import type { CaptchaConfig } from "./captcha";
import { buildBuiltinAuthCapabilities } from "./capabilities";
import { createResetPasswordRoute } from "./reset-password-admin";
import { createAdminRolesRoute } from "./admin-roles-route";
import { createAdminUsersRoute } from "./admin-users-route";
import { prepareAdminUserValues, finalizeAdminUserCreation } from "./admin-user-ops";
import type { AuthRepository, OAuthProvider } from "./interfaces";
import type { AuthHooks, ResolvedAuthHooks } from "./auth-hooks";
import { resolveAuthHooks } from "./auth-hooks";
import type { EmailService, EmailConfig } from "../email";
import type { HonoEnv } from "../api/types";
import { safeCompare } from "./crypto-utils";
import { extractBearerToken } from "./bearer-token";
import { logger } from "../utils/logger";

/**
 * Configuration for the built-in Rebase auth adapter.
 *
 * This mirrors the existing `RebaseAuthConfig` — users pass this and
 * server auto-wraps it in a `RebaseBuiltinAuthAdapter`.
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
    /**
     * Hard kill switch: block self-registration outright, including the
     * first-user bootstrap window that an empty database would otherwise open.
     *
     * Was declared on the route module and read by both config endpoints, but
     * never plumbed through here — so nothing a user of the framework could
     * write ever reached it, and the tests that covered it passed only because
     * they built `createAuthRoutes` directly, bypassing this adapter (the sole
     * wiring path a real backend uses).
     */
    disableSelfRegistration?: boolean;
    /**
     * Opt-in: allow `POST /auth/anonymous` to mint a user without credentials.
     *
     * Off by default, and overridden by `disableSelfRegistration`. Anonymous
     * sign-in inserts a `users` row and assigns `defaultRole` exactly as
     * registration does, so before this key existed a closed backend still
     * handed out permanent accounts via `/auth/anonymous` + `/auth/anonymous/link`.
     */
    allowAnonymous?: boolean;
    /** Whether to expose the authenticated email→minimal-profile lookup route. */
    allowUserLookup?: boolean;
    /** Bot protection for the auth routes. See `captcha.ts`. */
    captcha?: CaptchaConfig;
    /** Default role to assign to new users. */
    defaultRole?: string;
    /** OAuth providers to register. */
    oauthProviders?: OAuthProvider<unknown>[];
    /** Redirect URIs the OAuth routes accept, for every provider. */
    allowedRedirectUris?: string[];
    /** Static service key for server-to-server auth. */
    serviceKey?: string;
    /** Auth hooks for customizing password, credentials, lifecycle, etc. */
    authHooks?: AuthHooks;
    /** The parsed auth config from the collection (if `auth` is an object, not just `true`). */
    collectionAuthConfig?: import("@rebasepro/types").AuthCollectionConfig;
    /** Enable magic link (passwordless email) login. Requires email service. */
    enableMagicLink?: boolean;
    enableEmailOtp?: boolean;
    /** Opt-in httpOnly cookie mode for refresh tokens. */
    cookieAuth?: import("./routes").CookieAuthConfig;
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
        disableSelfRegistration = false,
        allowAnonymous = false,
        allowUserLookup = false,
        captcha,
        defaultRole,
        oauthProviders = [],
        allowedRedirectUris,
        serviceKey,
        authHooks,
        collectionAuthConfig,
        enableMagicLink = false,
        enableEmailOtp = false,
        cookieAuth
    } = config;

    const resolvedOps = resolveAuthHooks(authHooks);

    const adapter: AuthAdapter = {
        id: "rebase-builtin",

        serviceKey,

        async verifyRequest(request: Request): Promise<AuthenticatedUser | null> {
            // Tokens are accepted ONLY via the Authorization header. A `?token=`
            // query param must NOT authenticate here: URLs leak into access
            // logs, proxies, Referer headers, and browser history, and the
            // non-adapter middleware already refuses query tokens for exactly
            // that reason. Routes that legitimately need query-string tokens
            // (storage file serving for `<img src>`) use scoped download
            // tokens via `fileTokenAuth`, which never reach this adapter.
            const token = extractBearerToken(request.headers.get("authorization"));

            if (token === undefined) {
                return null;
            }

            // Check service key first (constant-time)
            if (serviceKey && safeCompare(token, serviceKey)) {
                return {
                    uid: "service",
                    email: "service@rebase.internal",
                    roles: ["admin"],
                    isAdmin: true,
                    rawToken: token
                };
            }

            // JWT verification
            const payload = verifyAccessToken(token);
            if (!payload) {
                return null;
            }

            // A token issued before the user's revocation watermark is void,
            // however well it verifies. This is the read that makes `logout`,
            // `change-password`, `reset-password` and `DELETE /auth/sessions`
            // reach the access token instead of only the refresh row.
            if (await isAccessTokenRevoked(authRepository, payload)) {
                logger.warn("[Security Audit] Refused a revoked access token", {
                    eventType: "auth.token.revoked",
                    uid: payload.uid
                });
                return null;
            }

            // Resolve roles from the repository
            let roles: string[] = payload.roles || [];
            try {
                roles = await authRepository.getUserRoleIds(payload.uid);
            } catch (err: unknown) {
                logger.warn("Role lookup from repository failed, using token roles as fallback", { uid: payload.uid, error: err });
            }

            const isAdmin = hasAdministrativeRole(roles);

            return {
                uid: payload.uid,
                email: payload.email ?? "",
                displayName: payload.displayName ?? null,
                roles,
                isAdmin,
                rawToken: token
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
                    rawToken: token
                };
            }

            // JWT verification
            const payload = verifyAccessToken(token);
            if (!payload) {
                return null;
            }

            // The same watermark read the request path does above, for the same
            // reason. This function is what the WebSocket AUTHENTICATE handler
            // calls, and without it `logout`, `change-password`,
            // `reset-password` and `DELETE /auth/sessions` voided an access
            // token for HTTP and left it working over the socket — so signing
            // out on a stolen session closed the browser's requests and not its
            // realtime connection.
            //
            // This closes the entry point. An ALREADY OPEN socket is a separate
            // question: nothing re-checks a connection after AUTHENTICATE, so a
            // session revoked mid-connection survives until it reconnects. That
            // is recorded in docs/audits/32 (H3) and is a decision about socket
            // lifetime, not a line missing from here.
            if (await isAccessTokenRevoked(authRepository, payload)) {
                logger.warn("[Security Audit] Refused a revoked access token", {
                    eventType: "auth.token.revoked",
                    uid: payload.uid
                });
                return null;
            }

            let roles: string[] = payload.roles || [];
            try {
                roles = await authRepository.getUserRoleIds(payload.uid);
            } catch (err: unknown) {
                logger.warn("Role lookup from repository failed, using token roles as fallback", { uid: payload.uid, error: err });
            }

            const isAdmin = hasAdministrativeRole(roles);

            return {
                uid: payload.uid,
                email: payload.email ?? "",
                displayName: payload.displayName ?? null,
                roles,
                isAdmin,
                rawToken: token
            };
        },

        userManagement: createUserManagementFromRepo(authRepository, resolvedOps),


        createAuthRoutes(): Hono<HonoEnv> | undefined {
            return createAuthRoutes({
                authRepo: authRepository,
                emailService,
                emailConfig,
                allowRegistration,
                disableSelfRegistration,
                allowAnonymous,
                allowUserLookup,
                defaultRole,
                oauthProviders,
                allowedRedirectUris,
                authHooks,
                enableMagicLink,
                enableEmailOtp,
                cookieAuth,
                captcha
            });
        },

        createAdminRoutes(): Hono<HonoEnv> | undefined {
            const router = new Hono<HonoEnv>();
            const resetPasswordRoute = createResetPasswordRoute({
                authRepo: authRepository,
                emailService,
                emailConfig,
                serviceKey,
                authHooks,
                collectionAuthConfig
            });
            const rolesRoute = createAdminRolesRoute({
                authRepo: authRepository,
                serviceKey
            });
            const adminUsersRoute = createAdminUsersRoute({
                authRepo: authRepository,
                emailService,
                emailConfig,
                serviceKey,
                authHooks,
                collectionAuthConfig
            });
            router.route("/", resetPasswordRoute);
            router.route("/", rolesRoute);
            router.route("/", adminUsersRoute);
            return router;
        },

        async prepareUserCreation(values, collectionAuth) {
            const parsedCollectionAuth = collectionAuth as import("@rebasepro/types").AuthCollectionConfig | undefined;
            return prepareAdminUserValues(values, {
                authRepo: authRepository,
                emailService,
                emailConfig,
                resolvedHooks: resolvedOps,
                collectionAuthConfig: parsedCollectionAuth ?? collectionAuthConfig
            });
        },

        describeUserCreationContract(collectionAuth) {
            const parsedCollectionAuth = collectionAuth as import("@rebasepro/types").AuthCollectionConfig | undefined;
            const authConfig = parsedCollectionAuth ?? collectionAuthConfig;

            // A custom hook owns the body's shape — `prepareAdminUserValues`
            // hands it the raw body and returns whatever the hook built, so the
            // fields it accepts are the hook's business and unknowable here.
            // Checking against the collection would reject bodies the hook is
            // designed to take.
            if (authConfig?.onCreateUser || resolvedOps.onAdminCreateUser) {
                return { validate: false, extraFields: [] };
            }

            // The built-in path consumes exactly one field the users table does
            // not declare: `password`, which it hashes into `passwordHash` and
            // deletes. Everything else it spreads through untouched, so
            // everything else has to be a real column.
            return { validate: true, extraFields: ["password"] };
        },

        async finalizeUserCreation(entity, clearPassword) {
            return finalizeAdminUserCreation(entity, clearPassword, {
                authRepo: authRepository,
                emailService,
                emailConfig,
                resolvedHooks: resolvedOps,
                collectionAuthConfig
            });
        },

        async getCapabilities(): Promise<AuthAdapterCapabilities> {
            // Detect bootstrap mode: are there any users?
            let needsSetup = false;
            try {
                const result = await authRepository.listUsersPaginated({ limit: 1 });
                needsSetup = result.total === 0;
            } catch (error) {
                // Fail closed — an unreadable users table must not open the
                // first-admin window — but say so. Silently answering "not in
                // setup mode" makes a database that is merely unreachable look
                // like a backend that has been set up already, which is the
                // login screen a fresh deployment least wants to see.
                logger.warn("[Auth] Could not count users for `needsSetup`; reporting the backend as already set up.", {
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            // `buildBuiltinAuthCapabilities` is the only place this payload is
            // assembled, so `GET /auth/config` cannot drift from what the auth
            // routes enforce — see `capabilities.ts`.
            return buildBuiltinAuthCapabilities({
                needsSetup,
                allowRegistration,
                disableSelfRegistration,
                allowAnonymous,
                enableMagicLink,
                enableEmailOtp,
                emailConfigured: !!emailService?.isConfigured(),
                enabledProviders: oauthProviders.map((p) => p.id)
            });
        }
    };

    return adapter;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function createUserManagementFromRepo(repo: AuthRepository, resolvedOps: ResolvedAuthHooks): UserManagementAdapter {
    return {
        async listUsers(options?: AuthUserListOptions): Promise<AuthUserListResult> {
            const result = await repo.listUsersPaginated({
                limit: options?.limit,
                offset: options?.offset,
                search: options?.search,
                orderBy: options?.orderBy,
                orderDir: options?.orderDir,
                roleId: options?.roleId
            });
            return {
                users: result.users.map(toAuthUserData),
                total: result.total,
                limit: result.limit,
                offset: result.offset
            };
        },

        async getUserById(id: string): Promise<AuthUserData | null> {
            const user = await repo.getUserById(id);
            return user ? toAuthUserData(user) : null;
        },

        async createUser(data: AuthCreateUserData): Promise<AuthUserData> {
            const passwordHash = data.password ? await resolvedOps.hashPassword(data.password) : undefined;
            let createData: import("./interfaces").CreateUserData = {
                email: data.email,
                passwordHash,
                displayName: data.displayName,
                photoUrl: data.photoUrl,
                metadata: data.metadata
            };
            if (resolvedOps.beforeUserCreate) {
                createData = await resolvedOps.beforeUserCreate(createData);
            }
            const user = await repo.createUser(createData);
            if (resolvedOps.afterUserCreate) {
                try {
                    await resolvedOps.afterUserCreate(user);
                } catch (err) {
                    logger.error("[AuthHooks] afterUserCreate error", { error: err instanceof Error ? err.message : err });
                }
            }
            return toAuthUserData(user);
        },

        async updateUser(id: string, data: Partial<AuthCreateUserData>): Promise<AuthUserData | null> {
            const updateData: Record<string, unknown> = {};
            if (data.email !== undefined) updateData.email = data.email;
            if (data.displayName !== undefined) updateData.displayName = data.displayName;
            if (data.photoUrl !== undefined) updateData.photoUrl = data.photoUrl;
            if (data.metadata !== undefined) updateData.metadata = data.metadata;
            if (data.password) {
                updateData.passwordHash = await resolvedOps.hashPassword(data.password);
            }
            const user = await repo.updateUser(id, updateData);
            return user ? toAuthUserData(user) : null;
        },

        async deleteUser(id: string): Promise<void> {
            // Call beforeUserDelete hook (throw to prevent deletion)
            if (resolvedOps.beforeUserDelete) {
                await resolvedOps.beforeUserDelete(id);
            }

            await repo.deleteUser(id);

            // Fire afterUserDelete hook (fire-and-forget)
            if (resolvedOps.afterUserDelete) {
                resolvedOps.afterUserDelete(id).catch(err => {
                    logger.error("[AuthHooks] afterUserDelete error", { error: err instanceof Error ? err.message : err });
                });
            }
        },

        async getUserRoles(uid: string): Promise<string[]> {
            return repo.getUserRoleIds(uid);
        },

        async setUserRoles(uid: string, roleIds: string[]): Promise<void> {
            await repo.setUserRoles(uid, roleIds);
        }
    };
}

function toAuthUserData(user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; metadata?: Record<string, unknown>; createdAt?: Date; updatedAt?: Date }): AuthUserData {
    return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
        emailVerified: user.emailVerified,
        metadata: user.metadata,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}
