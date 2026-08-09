/**
 * @module AuthAdapter
 *
 * Pluggable authentication abstraction for Rebase.
 *
 * An `AuthAdapter` decouples authentication from the database layer,
 * allowing users to bring their own auth system (Clerk, Auth0, or other
 * external providers) while keeping the Rebase admin frontend fully functional.
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
 * import { createCustomAuthAdapter } from "@rebasepro/server";
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
    /**
     * Supports the end-user password reset flow (emailing a reset link).
     *
     * This is about *self-service* reset, so it is typically tied to whether an
     * email service is configured. It says nothing about whether an admin can
     * reset someone else's password — see `adminPasswordReset`.
     */
    passwordReset: boolean;
    /**
     * Whether the adapter exposes `POST /admin/users/:uid/reset-password`,
     * letting an admin reset another user's password.
     *
     * Independent of `passwordReset`: the built-in adapter supports this even
     * with no email service configured (it returns a one-time temporary
     * password instead of sending a link). Adapters that mount their own admin
     * routes must set this to `true` only once that route actually exists —
     * the admin UI hides the "Reset Password" action when it is `false`.
     */
    adminPasswordReset: boolean;
    /** Supports session listing/revocation. */
    sessionManagement: boolean;
    /** Supports profile updates (display name, photo). */
    profileUpdate: boolean;
    /** Supports email verification. */
    emailVerification: boolean;
    /** Supports passwordless magic link login. */
    magicLink: boolean;
    /**
     * Whether `POST /auth/anonymous` will mint a credential-less session.
     *
     * Optional so an external adapter that predates the key keeps typechecking;
     * absent means "this adapter does not offer anonymous sign-in".
     */
    anonymousLogin?: boolean;
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

// ─── User Management ────────────────────────────────────────────────────────

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
    getUserRoles(uid: string): Promise<string[]>;
    setUserRoles(uid: string, roleIds: string[]): Promise<void>;
}

// ─── User Creation Lifecycle ─────────────────────────────────────────────────

/**
 * Result of `AuthAdapter.prepareUserCreation()`.
 *
 * Contains the processed values ready for persistence and metadata
 * needed by the finalization step.
 *
 * @group Auth
 */
export interface UserCreationPrepareResult {
    /** Processed values to persist (passwordHash instead of raw password, etc.). */
    values: Record<string, unknown>;
    /** Cleartext password for post-save processing (email or admin display). */
    clearPassword?: string;
    /** Whether the hook already handled the invitation (email, etc.). */
    hookHandledEmail: boolean;
    /** Whether an invitation was sent (only relevant when hookHandledEmail is true). */
    invitationSent: boolean;
}

/**
 * What a create body for an auth collection may name beyond the collection's
 * own declared fields — see `AuthAdapter.describeUserCreationContract()`.
 *
 * @group Auth
 */
export interface UserCreationWriteContract {
    /**
     * Whether to check the body for fields neither the collection nor
     * {@link extraFields} declares. `false` skips the check entirely.
     */
    validate: boolean;
    /**
     * Credential and provider keys the adapter consumes itself, which the
     * collection therefore does not declare as columns. `password` is the
     * canonical one: `prepareUserCreation` hashes it into `passwordHash` and
     * deletes it before the row is ever built.
     */
    extraFields: string[];
}

/**
 * Result of `AuthAdapter.finalizeUserCreation()`.
 *
 * Returned to the REST API for inclusion in the response.
 *
 * @group Auth
 */
export interface UserCreationFinalizeResult {
    /** If set, returned to the admin in the API response. */
    temporaryPassword?: string;
    /** Whether an invitation email was sent. */
    invitationSent: boolean;
    /**
     * Whether an email service was configured but delivery failed, causing the
     * fallback to `temporaryPassword`. Absent when no email service is configured.
     */
    emailDeliveryFailed?: boolean;
}

// ─── Auth Response Transform ─────────────────────────────────────────────────

/**
 * The auth response payload shape that flows through `transformAuthResponse`.
 *
 * For login, register, OAuth, anonymous, and magic-link flows the payload
 * contains both `user` and `tokens`. For refresh and MFA flows the payload
 * contains only `tokens` (no `user`).
 *
 * @group Auth
 */
export interface AuthResponsePayload {
    user?: {
        uid: string;
        email: string;
        displayName: string | null;
        photoURL: string | null;
        providerId?: string;
        isAnonymous?: boolean;
        emailVerified?: boolean;
        roles: string[];
        metadata: Record<string, unknown>;
    };
    tokens: {
        accessToken: string;
        refreshToken: string;
        accessTokenExpiresAt: number;
        /** Additional tokens injected by `transformAuthResponse`. */
        [key: string]: unknown;
    };
}

/**
 * Context passed to the `transformAuthResponse` hook.
 *
 * @group Auth
 */
export interface TransformAuthResponseContext {
    /** The authenticated user's ID. */
    uid: string;
    /** The auth method that triggered this response. */
    method: "login" | "register" | "oauth" | "refresh" | "anonymous" | "magic-link" | "mfa";
    /** The raw HTTP request (for reading headers, IP, etc.). */
    request: Request;
}

// ─── Auth Adapter ────────────────────────────────────────────────────────────

/**
 * Pluggable authentication adapter for Rebase.
 *
 * This is the **key interface** that decouples authentication from the
 * database layer. Each auth adapter knows how to:
 *
 * 1. Verify incoming HTTP requests (`verifyRequest`)
 * 2. Optionally manage users (for the admin panel)
 * 3. Optionally mount auth-specific routes (login, register, etc.)
 * 4. Advertise its capabilities so the frontend can adapt
 *
 * The built-in Rebase auth implements this interface internally.
 * External providers (Clerk, Auth0, or others) provide their own adapters.
 * Users with custom auth can use `createCustomAuthAdapter()` for a minimal setup.
 *
 * @group Auth
 */
export interface AuthAdapter {
    /**
     * Unique identifier for this auth adapter.
     *
     * @example "rebase-builtin", "clerk", "auth0", "external-provider", "custom"
     */
    readonly id: string;

    // ── Request Authentication ──────────────────────────────────────────

    /**
     * Verify an incoming request and extract the authenticated user.
     *
     * This replaces the hardcoded JWT verification in server's middleware.
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

    // ── User Management (for admin panel) ────────────────────────────

    /**
     * User CRUD for the admin panel's user management UI.
     * Optional — if not provided, user management UI is hidden.
     */
    userManagement?: UserManagementAdapter;

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
     * Mount admin routes (e.g. password reset for users).
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

    // ── Collection User Creation (for auth collections) ───────────────

    /**
     * Prepare values for creating a user via the auth collection's REST API.
     *
     * Called on POST to a collection with `auth: true`. Handles password
     * hashing, email normalization, and any collection/backend-level hooks.
     *
     * If not implemented, the collection saves values as-is (no password hashing).
     *
     * @param values - Raw request body from the client.
     * @param collectionAuth - The parsed `AuthCollectionConfig` from the collection (if `auth` is an object).
     * @returns Processed values ready for `driver.save()`, plus metadata for the post-save step.
     */
    prepareUserCreation?(
        values: Record<string, unknown>,
        collectionAuth?: unknown
    ): Promise<UserCreationPrepareResult>;

    /**
     * Describe what a create body for this auth collection is allowed to name,
     * so unknown-field validation can run on it.
     *
     * A signup body is not the collection's shape: it carries credential fields
     * like `password` that the users table never declares as columns, and
     * `prepareUserCreation` maps them onto real ones. Validating the raw body
     * against the collection alone would reject every legitimate signup — which
     * is why the check used to be skipped outright for auth collections. That
     * skip was total, so an undeclared field was silently dropped and the write
     * still returned 201, while the same typo on a normal collection was a 400.
     *
     * This narrows the exemption to the fields the adapter actually consumes.
     *
     * `validate: false` disables the check for this collection, and is the right
     * answer when a custom `onCreateUser` hook is configured: the body is then
     * the hook's contract, not the collection's, and this layer cannot know what
     * the hook accepts.
     *
     * If not implemented, validation is skipped — the pre-existing behaviour.
     *
     * @param collectionAuth - The parsed `AuthCollectionConfig` from the collection (if `auth` is an object).
     */
    describeUserCreationContract?(
        collectionAuth?: unknown
    ): UserCreationWriteContract;

    /**
     * Finalize a user creation after the entity has been persisted.
     *
     * Handles post-save work: sending invitation emails, generating
     * password-reset tokens, or falling back to returning a temporary password.
     *
     * @param entity - The persisted entity (id + values).
     * @param clearPassword - The cleartext password from the prepare step (if any).
     * @returns Metadata for the API response (temporary password, invitation status).
     */
    finalizeUserCreation?(
        entity: { id: string; values: Record<string, unknown> },
        clearPassword?: string
    ): Promise<UserCreationFinalizeResult>;

    // ── Service Key (optional) ──────────────────────────────────────────

    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When set, requests with `Authorization: Bearer <serviceKey>` bypass
     * normal token verification and are granted admin-level access.
     */
    serviceKey?: string;

    // ── Response Transform ───────────────────────────────────────────────

    /**
     * Transform the auth response before sending it to the client.
     *
     * Called after successful login, register, refresh, OAuth, anonymous,
     * magic-link, and MFA flows. The hook receives the fully-formed
     * response and returns a (potentially enriched) response.
     *
     * Use cases:
     * - Inject tokens from external auth systems (custom provider tokens, etc.)
     * - Add project-specific metadata to the response
     * - Enrich the user object with data from external sources
     *
     * The hook runs in the request path — keep it fast.
     * Heavy work should be offloaded to `onAuthenticated` (fire-and-forget).
     */
    transformAuthResponse?(
        response: AuthResponsePayload,
        context: TransformAuthResponseContext
    ): Promise<AuthResponsePayload>;
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

    /** Static service key for server-to-server auth. */
    serviceKey?: string;

    /** Override default capabilities. */
    capabilities?: Partial<AuthAdapterCapabilities>;

    /**
     * Transform the auth response before sending it to the client.
     * Same semantics as `AuthAdapter.transformAuthResponse`.
     */
    transformAuthResponse?: (
        response: AuthResponsePayload,
        context: TransformAuthResponseContext
    ) => Promise<AuthResponsePayload>;
}
