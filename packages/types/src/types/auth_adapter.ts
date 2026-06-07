/**
 * @module AuthAdapter
 *
 * Pluggable authentication abstraction for Rebase.
 *
 * An `AuthAdapter` decouples authentication from the database layer,
 * allowing users to bring their own auth system (Clerk, Auth0, Firebase Auth,
 * custom JWT, etc.) while keeping the Rebase admin frontend fully functional.
 *
 * @example Built-in auth (default — zero config change)
 * ```ts
 * initializeRebaseBackend({
 *   auth: { jwtSecret: "...", google: { clientId: "..." } },
 *   database: createPostgresAdapter({ ... }),
 * });
 * ```
 *
 * @example Custom auth
 * ```ts
 * import { createCustomAuthAdapter } from "@rebasepro/server-core";
 *
 * initializeRebaseBackend({
 *   auth: createCustomAuthAdapter({
 *     verifyRequest: async (req) => { ... },
 *   }),
 *   database: createPostgresAdapter({ ... }),
 * });
 * ```
 *
 * @group Auth
 */

import type { Hono } from "hono";

// ─── Authenticated User ──────────────────────────────────────────────────────

/**
 * The normalized user object returned by `AuthAdapter.verifyRequest()`.
 *
 * Regardless of the auth provider, every request is resolved to this shape
 * so that downstream middleware (RLS scoping, route guards) can work uniformly.
 *
 * @group Auth
 */
export interface AuthenticatedUser {
    /** Unique user identifier (provider-specific). */
    uid: string;
    /** Primary email address. */
    email: string;
    /** Human-readable display name. */
    displayName?: string | null;
    /** Avatar URL. */
    photoUrl?: string | null;
    /** Role identifiers the user holds. */
    roles: string[];
    /** Whether the user has admin privileges. */
    isAdmin: boolean;
    /** Raw bearer token from the request (for forwarding). */
    rawToken?: string;
    /** Extra claims/metadata from the auth provider. */
    claims?: Record<string, unknown>;
}

// ─── Capabilities ────────────────────────────────────────────────────────────

/**
 * Feature flags advertised by an auth adapter.
 *
 * The frontend reads these from `GET /api/auth/config` to dynamically
 * show/hide UI elements (login form, registration, password reset, etc.).
 *
 * @group Auth
 */
export interface AuthAdapterCapabilities {
    /**
     * Whether this adapter mounts its own `/auth/*` routes.
     *
     * - `true` for the built-in Rebase auth (login, register, refresh, etc.)
     * - `false` for external providers like Clerk or Auth0 that handle
     *   auth flows outside of the Rebase backend.
     */
    hasBuiltInAuthRoutes: boolean;

    /** Supports email/password login. */
    emailPasswordLogin: boolean;
    /** Supports new user registration. */
    registration: boolean;
    /** Supports password reset flow. */
    passwordReset: boolean;
    /** Supports session listing/revocation. */
    sessionManagement: boolean;
    /** Supports profile updates (display name, photo). */
    profileUpdate: boolean;
    /** Supports email verification. */
    emailVerification: boolean;
    /** List of enabled OAuth provider IDs (e.g. `["google", "github"]`). */
    enabledProviders: string[];

    /**
     * For external auth (Clerk, Auth0, etc.): the URL where the user should
     * be redirected for login. The Rebase frontend will navigate here instead
     * of showing its own login form.
     */
    externalLoginUrl?: string;

    /**
     * True when no users exist yet — first-user bootstrap mode.
     * Only applicable for built-in auth.
     */
    needsSetup?: boolean;

    /** Whether new user registration is enabled (may differ from `registration` capability at runtime). */
    registrationEnabled?: boolean;
}

// ─── User & Role Management ─────────────────────────────────────────────────

/**
 * Options for paginated user listing.
 * @group Auth
 */
export interface AuthUserListOptions {
    limit?: number;
    offset?: number;
    search?: string;
    orderBy?: string;
    orderDir?: "asc" | "desc";
    roleId?: string;
}

/**
 * Paginated user listing result.
 * @group Auth
 */
export interface AuthUserListResult {
    users: AuthUserData[];
    total: number;
    limit: number;
    offset: number;
}

/**
 * User data exposed by the auth adapter.
 * @group Auth
 */
export interface AuthUserData {
    id: string;
    email: string;
    displayName?: string | null;
    photoUrl?: string | null;
    emailVerified?: boolean;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Data for creating a user.
 * @group Auth
 */
export interface AuthCreateUserData {
    email: string;
    password?: string;
    displayName?: string;
    photoUrl?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Role data exposed by the auth adapter.
 * @group Auth
 */
export interface AuthRoleData {
    id: string;
    name: string;
    isAdmin: boolean;
    defaultPermissions?: {
        read?: boolean;
        create?: boolean;
        edit?: boolean;
        delete?: boolean;
    } | null;
    collectionPermissions?: Record<string, {
        read?: boolean;
        create?: boolean;
        edit?: boolean;
        delete?: boolean;
    }> | null;
}

/**
 * Data for creating a role.
 * @group Auth
 */
export interface AuthCreateRoleData {
    id: string;
    name: string;
    isAdmin?: boolean;
    defaultPermissions?: AuthRoleData["defaultPermissions"];
    collectionPermissions?: AuthRoleData["collectionPermissions"];
}

/**
 * User management operations for the admin panel.
 *
 * Optional — if not provided by the adapter, the user management UI is hidden.
 *
 * @group Auth
 */
export interface UserManagementAdapter {
    listUsers(options?: AuthUserListOptions): Promise<AuthUserListResult>;
    getUserById(id: string): Promise<AuthUserData | null>;
    createUser(data: AuthCreateUserData): Promise<AuthUserData>;
    updateUser(id: string, data: Partial<AuthCreateUserData>): Promise<AuthUserData | null>;
    deleteUser(id: string): Promise<void>;
    getUserRoles(userId: string): Promise<AuthRoleData[]>;
    setUserRoles(userId: string, roleIds: string[]): Promise<void>;
}

/**
 * Role management operations for the admin panel.
 *
 * Optional — if not provided by the adapter, role management is disabled.
 *
 * @group Auth
 */
export interface RoleManagementAdapter {
    listRoles(): Promise<AuthRoleData[]>;
    getRoleById(id: string): Promise<AuthRoleData | null>;
    createRole(data: AuthCreateRoleData): Promise<AuthRoleData>;
    updateRole(id: string, data: Partial<AuthRoleData>): Promise<AuthRoleData | null>;
    deleteRole(id: string): Promise<void>;
}

// ─── Auth Adapter ────────────────────────────────────────────────────────────

/**
 * Pluggable authentication adapter for Rebase.
 *
 * This is the **key interface** that decouples authentication from the
 * database layer. Each auth adapter knows how to:
 *
 * 1. Verify incoming HTTP requests (`verifyRequest`)
 * 2. Optionally manage users and roles (for the admin panel)
 * 3. Optionally mount auth-specific routes (login, register, etc.)
 * 4. Advertise its capabilities so the frontend can adapt
 *
 * The built-in Rebase auth implements this interface internally.
 * External providers (Clerk, Auth0, Firebase Auth) provide their own adapters.
 * Users with custom auth can use `createCustomAuthAdapter()` for a minimal setup.
 *
 * @group Auth
 */
export interface AuthAdapter {
    /**
     * Unique identifier for this auth adapter.
     *
     * @example "rebase-builtin", "clerk", "auth0", "firebase", "custom"
     */
    readonly id: string;

    // ── Request Authentication ──────────────────────────────────────────

    /**
     * Verify an incoming request and extract the authenticated user.
     *
     * This replaces the hardcoded JWT verification in server-core's middleware.
     * Each adapter implements its own token verification strategy:
     * - Built-in: verify Rebase JWT
     * - Clerk: call Clerk's `verifyToken()`
     * - Auth0: validate Auth0 JWT with JWKS
     * - Custom: whatever logic the user provides
     *
     * @param request - The raw `Request` object (portable across Hono, Express, Fastify)
     * @returns The authenticated user, or `null` for unauthenticated requests.
     *          Throw an error to reject the request with 401.
     */
    verifyRequest(request: Request): Promise<AuthenticatedUser | null>;

    /**
     * Verify a raw bearer token and extract the authenticated user.
     *
     * Used for **WebSocket authentication**, where there is no HTTP `Request`
     * object — only a token string sent over the socket.
     *
     * If not implemented, the default behavior synthesizes a minimal `Request`
     * with an `Authorization: Bearer <token>` header and delegates to
     * `verifyRequest()`. Adapters should override this if their token
     * verification logic doesn't depend on request headers/cookies.
     *
     * @param token - The raw bearer token string.
     * @returns The authenticated user, or `null` if the token is invalid.
     */
    verifyToken?(token: string): Promise<AuthenticatedUser | null>;

    // ── User & Role Management (for admin panel) ────────────────────────

    /**
     * User CRUD for the admin panel's user management UI.
     * Optional — if not provided, user management UI is hidden.
     */
    userManagement?: UserManagementAdapter;

    /**
     * Role CRUD for the admin panel.
     * Optional — if not provided, role management is disabled.
     */
    roleManagement?: RoleManagementAdapter;

    // ── Auth Routes ─────────────────────────────────────────────────────

    /**
     * Mount adapter-specific auth routes (login, register, refresh, etc.).
     *
     * - Built-in adapter: mounts `/auth/login`, `/auth/register`, etc.
     * - External adapter: typically returns `undefined` (auth is handled externally).
     * - Custom adapter: user mounts their own routes.
     *
     * The return type uses `Hono<any, any, any>` because this sub-app will be
     * mounted into a parent app via `.route()`, which accepts any Hono env type.
     * Adapter implementations are free to use their own env (e.g. `Hono<HonoEnv>`).
     *
     * @returns A Hono sub-app with auth routes, or `undefined` to skip route mounting.
     */
    createAuthRoutes?(): Hono<any, any, any> | undefined;

    /**
     * Mount admin routes for user/role management.
     *
     * Same typing rationale as `createAuthRoutes` — the sub-app env is
     * unconstrained to support arbitrary adapter implementations.
     *
     * @returns A Hono sub-app with admin routes, or `undefined` to skip.
     */
    createAdminRoutes?(): Hono<any, any, any> | undefined;

    // ── Feature Detection ───────────────────────────────────────────────

    /**
     * Advertise what this auth adapter supports.
     *
     * The frontend reads this from `GET /api/auth/config` to dynamically
     * show/hide UI elements. This is the bridge between backend capabilities
     * and the frontend's `AuthCapabilities` type.
     */
    getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;

    // ── Lifecycle ───────────────────────────────────────────────────────

    /**
     * Called during backend initialization.
     * Use for running migrations, creating tables, seeding initial data, etc.
     */
    initialize?(): Promise<void>;

    /**
     * Called during graceful shutdown.
     * Use for closing connections, flushing caches, etc.
     */
    destroy?(): Promise<void>;

    // ── Service Key (optional) ──────────────────────────────────────────

    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When set, requests with `Authorization: Bearer <serviceKey>` bypass
     * normal token verification and are granted admin-level access.
     */
    serviceKey?: string;
}

// ─── Custom Auth Adapter Options ─────────────────────────────────────────────

/**
 * Options for creating a minimal custom auth adapter via `createCustomAuthAdapter()`.
 *
 * This is the simplest way to plug an existing auth system into Rebase.
 * Only `verifyRequest` is required — everything else is optional.
 *
 * @group Auth
 */
export interface CustomAuthAdapterOptions {
    /**
     * Verify an incoming request and return the authenticated user.
     * This is the only required method.
     */
    verifyRequest: (request: Request) => Promise<AuthenticatedUser | null>;

    /**
     * Verify a raw bearer token for WebSocket authentication.
     * Optional — if omitted, a synthetic `Request` is constructed and passed
     * to `verifyRequest`.
     */
    verifyToken?: (token: string) => Promise<AuthenticatedUser | null>;

    /** Optional user management for the admin panel. */
    userManagement?: UserManagementAdapter;

    /** Optional role management for the admin panel. */
    roleManagement?: RoleManagementAdapter;

    /** Static service key for server-to-server auth. */
    serviceKey?: string;

    /** Override default capabilities. */
    capabilities?: Partial<AuthAdapterCapabilities>;
}
