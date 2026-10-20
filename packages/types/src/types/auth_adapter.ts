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

/**
 * A sub-app an adapter hands back for the framework to mount.
 *
 * Structural on purpose. This was `Hono<any, any, any>`, and that one
 * `import type { Hono } from "hono"` was the whole reason `@rebasepro/types`
 * peer-depended on hono — which npm and pnpm auto-install, so **every browser
 * app that installed `@rebasepro/client` got a 2.8 MB server framework in its
 * lockfile and its security scanners**, for a type used by two optional methods
 * that a browser app can never call.
 *
 * The shape is the same duck-type the function loader already validates at
 * runtime (`isHonoLike`: a `fetch` method and a `routes` array), and a real
 * `Hono` satisfies it — asserted in `auth_adapter.test.ts`, which does import
 * hono, because a structural type is only worth having if something proves the
 * real thing still fits.
 *
 * @group Auth
 */
export interface MountableRouter {
    /** Handle a request. Hono, Elysia and a hand-rolled router all have this. */
    fetch: (request: Request) => Response | Promise<Response>;
    /** The routes the sub-app declares. Only its presence is contractual. */
    routes: readonly unknown[];
}

// ─── Impersonation ───────────────────────────────────────────────────────────

/**
 * The request header that asks for a data-plane request to run as another
 * user, named by uid.
 *
 * The server honours it only on a signed-in administrator's own session —
 * never on an API key or the service key — and only through an adapter that
 * implements {@link AuthAdapter.resolveUser}. Everywhere else a request that
 * carries it is refused, never run as its caller.
 *
 * @group Auth
 */
export const IMPERSONATE_HEADER = "x-rebase-impersonate";

// ─── Access simulation ───────────────────────────────────────────────────────

/**
 * The request header that asks for a data-plane request to run as a role —
 * the RLS simulator's "view as". Alone it runs as a signed-in holder of that
 * role who owns no rows; with {@link SIMULATE_USER_ID_HEADER} it runs as that
 * uid holding that role, whether or not such an account exists.
 *
 * `anon` (or `anonymous`) runs as a caller with no session at all.
 *
 * Like {@link IMPERSONATE_HEADER}, only a signed-in administrator's own session
 * may send it; anyone else is refused with 403, never answered as themselves.
 *
 * @group Auth
 */
export const SIMULATE_ROLE_HEADER = "x-rebase-simulate-role";

/**
 * The uid a simulated request runs as. With {@link SIMULATE_ROLE_HEADER} it is
 * a hypothetical — "u_1 holding customer" — and need not name an account;
 * without it, the uid must be an active user and runs with their roles now.
 *
 * @group Auth
 */
export const SIMULATE_USER_ID_HEADER = "x-rebase-simulate-user-id";

/**
 * The id of a service API key a simulated request runs as: the key's identity,
 * its RLS roles and its scopes, exactly as a request presenting the key would.
 * Excludes the other two simulation headers.
 *
 * @group Auth
 */
export const SIMULATE_API_KEY_ID_HEADER = "x-rebase-simulate-api-key-id";

/**
 * The response header naming what a simulated request ran as:
 * `role=<role>;sub=<uid>;masked_columns=<a,b>`, plus `api_key=<id>` and
 * `collection=<slug>` when they apply. Every value is URI-encoded. Read it
 * with {@link parseSimulatedContext}.
 *
 * @group Auth
 */
export const SIMULATED_CONTEXT_HEADER = "x-rebase-simulated-context";

/**
 * What an administrator asks a request to run as. Exactly one of these
 * shapes is honoured: a role (optionally with a uid), a uid alone (an existing
 * user, with their roles), or an API key id alone.
 *
 * @group Auth
 */
export interface AccessSimulation {
    role?: string;
    userId?: string;
    apiKeyId?: string;
}

/**
 * The request headers for an {@link AccessSimulation}. Empty when it asks for
 * nothing, so spreading it into a header set is always safe.
 *
 * @group Auth
 */
export function simulationHeaders(simulation: AccessSimulation | null | undefined): Record<string, string> {
    if (!simulation) return {};
    const headers: Record<string, string> = {};
    if (simulation.role) headers[SIMULATE_ROLE_HEADER] = simulation.role;
    if (simulation.userId) headers[SIMULATE_USER_ID_HEADER] = simulation.userId;
    if (simulation.apiKeyId) headers[SIMULATE_API_KEY_ID_HEADER] = simulation.apiKeyId;
    return headers;
}

/**
 * What {@link SIMULATED_CONTEXT_HEADER} says a request ran as.
 *
 * @group Auth
 */
export interface SimulatedContext {
    role: string;
    sub: string;
    maskedColumns: string[];
    apiKeyId?: string;
    collection?: string;
}

/**
 * Write a {@link SimulatedContext} as the header value.
 *
 * @group Auth
 */
export function formatSimulatedContext(context: SimulatedContext): string {
    const parts = [
        `role=${encodeURIComponent(context.role)}`,
        `sub=${encodeURIComponent(context.sub)}`,
        `masked_columns=${context.maskedColumns.map(encodeURIComponent).join(",")}`
    ];
    if (context.apiKeyId) parts.push(`api_key=${encodeURIComponent(context.apiKeyId)}`);
    if (context.collection) parts.push(`collection=${encodeURIComponent(context.collection)}`);
    return parts.join(";");
}

/**
 * Read {@link SIMULATED_CONTEXT_HEADER}. `undefined` for an absent header or one
 * missing `role` or `sub`.
 *
 * @group Auth
 */
export function parseSimulatedContext(value: string | null | undefined): SimulatedContext | undefined {
    if (!value) return undefined;
    const fields = new Map<string, string>();
    for (const part of value.split(";")) {
        const at = part.indexOf("=");
        if (at > 0) fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
    const role = fields.get("role");
    const sub = fields.get("sub");
    if (role === undefined || sub === undefined) return undefined;
    const decode = (raw: string) => {
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    };
    const masked = fields.get("masked_columns") ?? "";
    const apiKeyId = fields.get("api_key");
    const collection = fields.get("collection");
    return {
        role: decode(role),
        sub: decode(sub),
        maskedColumns: masked === "" ? [] : masked.split(",").map(decode),
        ...(apiKeyId ? { apiKeyId: decode(apiKeyId) } : {}),
        ...(collection ? { collection: decode(collection) } : {})
    };
}

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
    /**
     * Whether `roles` includes `admin`. Informational — every authorization
     * decision reads `roles` and the scopes they hold, so an adapter that
     * wants a user treated as an administrator gives them the `admin` role.
     */
    isAdmin: boolean;
    /**
     * Whether this session is a GUEST — anonymous sign-in rather than an
     * account.
     *
     * Optional, and absent means "not a guest", so an external adapter that
     * has no such concept keeps behaving exactly as it did. When present it
     * reaches the database as `rebase.is_anonymous()`, which is what lets a
     * policy say "a signed-in person, not somebody who pressed Continue as
     * guest" — two things that were the same principal inside every rule,
     * because anonymous sign-in mints a real user row with a real uid.
     */
    isAnonymous?: boolean;
    /** Raw bearer token from the request (for forwarding). */
    rawToken?: string;
    /** Extra claims/metadata from the auth provider. */
    claims?: Record<string, unknown>;
    /**
     * What this credential may do, when it is narrower than its person — set
     * for an API key. Absent means everything the user's roles hold
     * (`scopesForRoles`).
     */
    scopes?: string[];
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
    /**
     * Whether self-registration is open **right now**.
     *
     * A runtime answer, not a static feature list: the built-in adapter also
     * reports `true` during the first-user bootstrap window (an empty user
     * table) and `false` the moment `disableSelfRegistration` is set. Whatever
     * this says, `POST /auth/register` does — both read the same predicate, so
     * the UI can never be sent to a form that can only 403.
     */
    registrationEnabled: boolean;
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
     * Supports passwordless sign-in with a six-digit code sent by email.
     *
     * Optional so that an external adapter written before this existed still
     * satisfies the interface; absent reads as "no", which is what an adapter
     * that has never heard of the flow means.
     */
    emailOtp?: boolean;
    /** Whether `POST /auth/anonymous` will mint a credential-less session. */
    anonymousLogin: boolean;
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
}

/**
 * What `GET /api/auth/config` answers: the auth adapter's capabilities, plus
 * the optional features of the backend around it.
 *
 * The admin panel reads this document before anything else, so it is where
 * the panel learns that a feature is off, without first asking for that
 * feature and getting a refusal.
 *
 * @group Auth
 */
export interface AuthConfigDocument extends AuthAdapterCapabilities {
    /**
     * Whether this backend serves file storage. When it is `false`, no storage
     * backend is configured: `GET /storage/sources` lists nothing and every
     * other `/storage` route answers 501 `STORAGE_NOT_CONFIGURED`. Absent from
     * a backend that predates the field, so a client must ask
     * `GET /storage/sources` there.
     */
    storage?: boolean;
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
    /**
     * Store the address as verified: whoever creates the account named it
     * (an operator, an administrator), so nobody needs to prove it.
     */
    emailVerified?: boolean;
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
    /**
     * Whether the hook already handled the invitation (email, etc.). When
     * `true`, `finalizeUserCreation` is skipped and `clearPassword` is returned
     * to the admin as the temporary password.
     */
    hookHandledEmail: boolean;
    /** Whether an invitation was sent (only relevant when hookHandledEmail is true). */
    invitationSent: boolean;
}

/**
 * What the door creating a user knows about its caller, for
 * `AuthAdapter.prepareUserCreation()`.
 *
 * @group Auth
 */
export interface UserCreationOptions {
    /**
     * Whether the caller may waive the password policy with
     * `skipPasswordPolicy: true` in the body. The doors set it for an
     * administrator (the service key signs in as one) and for nobody else, so
     * an adapter that reads the flag is taking an administrator at their word —
     * an import of accounts whose passwords were set under another system's
     * rules. Absent, the flag waives nothing.
     */
    mayWaivePasswordPolicy?: boolean;
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
    /**
     * Each body's `prepareUserCreation` touches nothing but its own result —
     * no hook, no email, no write — so a bulk create may prepare several at
     * once. The built-in adapter's path with no `onCreateUser`, no
     * `onAdminCreateUser` and the default `hashPassword` is: it hashes a
     * password and normalizes an email, and a 1,000-row bulk spent half a
     * minute hashing one password at a time. Leave it unset when a hook runs:
     * preparations then run one at a time, in the order the rows were given.
     */
    independent?: boolean;
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
    method: "login" | "register" | "oauth" | "refresh" | "anonymous" | "magic-link" | "otp" | "mfa";
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

    /**
     * The identity a verified request from this account would carry right
     * now, with no credential involved: its uid, its roles as they are now,
     * its guest flag, and the custom claims a token minted for it now would
     * hold. `null` when no active account has this uid — none at all, or one
     * that is disabled.
     *
     * This is what lets an administrator run a request as another user (the
     * {@link IMPERSONATE_HEADER} header). The server calls it only after it
     * has decided the caller may do that, and it calls it for the caller too,
     * so the decision rests on the caller's roles as they are now rather than
     * on the ones their token claims.
     *
     * Optional. An adapter without it cannot be impersonated through, and a
     * request carrying the header is refused rather than run as its caller.
     */
    resolveUser?(uid: string): Promise<AuthenticatedUser | null>;

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
     * The return type is the structural {@link MountableRouter} rather than
     * `Hono`, so this package needs no hono dependency. A real `Hono<HonoEnv>`
     * satisfies it, and implementations are free to use their own env.
     *
     * @returns A Hono sub-app with auth routes, or `undefined` to skip route mounting.
     */
    createAuthRoutes?(): MountableRouter | undefined;

    /**
     * Mount admin routes (e.g. password reset for users).
     *
     * @returns A Hono sub-app with admin routes, or `undefined` to skip.
     */
    createAdminRoutes?(): MountableRouter | undefined;

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
     * A chosen `password` is held to the password policy unless the body says
     * `skipPasswordPolicy: true` and `options.mayWaivePasswordPolicy` is set.
     *
     * @param values - Raw request body from the client.
     * @param collectionAuth - The parsed `AuthCollectionConfig` from the collection (if `auth` is an object).
     * @param options - What the door knows about its caller.
     * @returns Processed values ready for `driver.save()`, plus metadata for the post-save step.
     */
    prepareUserCreation?(
        values: Record<string, unknown>,
        collectionAuth?: unknown,
        options?: UserCreationOptions
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
     * Not called when `prepareUserCreation` reported `hookHandledEmail`. A
     * create hook then owns delivery, and the response carries the
     * `invitationSent` and `clearPassword` the prepare step returned. This
     * holds for both ways of creating a user: a `POST` to the auth collection
     * and `POST /admin/users`.
     *
     * @param entity - The persisted entity (id + values).
     * @param clearPassword - The cleartext password from the prepare step (if any).
     * @returns Metadata for the API response (temporary password, invitation status).
     */
    finalizeUserCreation?(
        entity: { id: string; values: Record<string, unknown> },
        clearPassword?: string
    ): Promise<UserCreationFinalizeResult>;

    // ── User Administration Through the Auth Collection ─────────────────

    /**
     * Check, and put in stored form, updates to rows of the auth collection
     * that arrive through the data API — `PATCH /<users>/:id`, `PATCH /bulk`,
     * `_batch`, the realtime socket.
     *
     * Those rows are the users, so an update to one is user administration,
     * and has to hold to what the admin user routes hold to: no update that
     * leaves the project without an administrator, and an email stored the
     * way sign-in looks it up. Throws to refuse; the updates are judged
     * together, so a bulk demotion of every admin is refused even though each
     * row alone would pass.
     *
     * If not implemented, the values are written as they arrived.
     *
     * @returns Each update's values, as they should be written, in order.
     */
    prepareUserUpdates?(
        updates: ReadonlyArray<{ uid: string; values: Record<string, unknown> }>
    ): Promise<Record<string, unknown>[]>;

    /**
     * Check a deletion of these users through the data API before any row goes,
     * and run the hooks that may veto it (`beforeUserDelete`). Throws to
     * refuse — for one that would leave the project without an administrator,
     * among others.
     *
     * If not implemented, the rows are deleted as any other.
     */
    prepareUserDeletions?(uids: readonly string[]): Promise<void>;

    /**
     * After those users' rows are deleted through the data API: end their
     * sessions and run the after-delete hooks (`afterUserDelete`).
     */
    finalizeUserDeletions?(uids: readonly string[]): Promise<void>;

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
