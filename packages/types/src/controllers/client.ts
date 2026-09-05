import type { User } from "../users";
import type { ResourceRef } from "../types/resources";
import type { RebaseSdkData } from "./data";
import type { EmailService } from "./email";
import type { StorageSource } from "./storage";
import type { CronJobStatus, CronJobLogEntry } from "../types/cron";
import type { BackupInfo, BackupDestinationKind } from "../types/backup";
import type { ApiKeysAPI } from "../types/api_keys";
import type { StorageSourceDefinition } from "../types/storage_source";


/**
 * Event type for authentication state changes
 */
export type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

/**
 * Standard session interface representing an authenticated state.
 *
 * There is exactly one canonical definition of this type (here in
 * `@rebasepro/types`). The `@rebasepro/client` package re-exports it.
 */
export interface RebaseSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    user: User;
}

/**
 * Access and refresh token pair returned by authentication endpoints.
 *
 * Replaces the former `RebaseTokens` (client) and `AuthTokens` (auth) types,
 * which had identical shapes.
 *
 * @group Auth
 */
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    /** Unix timestamp (ms) when the access token expires. */
    accessTokenExpiresAt: number;
}

/**
 * A device-level session entry as returned by `GET /auth/sessions`.
 *
 * Represents one refresh-token / device pair. Not to be confused with
 * {@link RebaseSession}, which is the client-side representation of the
 * *current* authenticated state (user + tokens).
 *
 * @group Auth
 */
export interface DeviceSession {
    id: string;
    userAgent?: string;
    ipAddress?: string;
    createdAt: string;
    isCurrentSession?: boolean;
}

/**
 * Unified Authentication Client Interface
 * Pure functional SDK interface, decoupled from UI and React hooks
 */
export interface AuthClient {
    /**
     * Get the current user from the server or cache
     */
    getUser(): Promise<User | null>;

    /**
     * Get the currently active session
     */
    getSession(): RebaseSession | null;

    /**
     * Get the current user's active sessions
     */
    getSessions?: () => Promise<DeviceSession[]>;
    revokeSession?: (sessionId: string) => Promise<void>;
    revokeAllSessions?: () => Promise<void>;

    /**
     * Sign out the current user and clear local session
     */
    signOut(): Promise<void>;

    /**
     * Subscribe to authentication state changes
     */
    onAuthStateChange(callback: (event: AuthChangeEvent, session: RebaseSession | null) => void): () => void;

    /**
     * Manually refresh the session token
     */
    refreshSession(): Promise<RebaseSession>;

    /**
     * Whether a session could exist that this client has not loaded yet.
     *
     * `false` means the only way this client can hold a session is an explicit
     * sign-in during this page's lifetime: it neither persists sessions nor
     * carries an httpOnly auth cookie, so there is nothing on disk or in the
     * browser to restore from. A caller that would otherwise probe the server
     * — `getUser()` on mount, say — can skip it, because the answer is already
     * known and the request can only ever fail.
     *
     * Optional so that alternative {@link AuthClient} implementations need not
     * supply it; treat a missing implementation as "unknown, go ahead and ask".
     */
    canRestoreSession?: () => boolean;
}

// ─── Admin API ───────────────────────────────────────────────────────────────

/**
 * User record as returned by the Admin API (`GET /admin/users`, etc.).
 *
 * This is a dedicated DTO for admin operations and differs from {@link User}:
 * - `roles` is required (always an array), vs optional on `User`
 * - Includes audit timestamps (`createdAt`, `updatedAt`) as ISO strings
 * - `email` is non-nullable (admin users always have an email)
 *
 * @see User — the canonical client-facing user type
 * @group Admin
 */
export interface AdminUser {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    /**
     * The provider used to authenticate the user (e.g. `"password"`,
     * `"google"`). Named to match the canonical {@link User.providerId}.
     */
    providerId: string;
    roles: string[];
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

/**
 * Client-side Admin API interface.
 * Provides user management operations.
 * @group Admin
 */
export interface AdminAPI {
    listUsers(): Promise<{ users: AdminUser[] }>;
    listUsersPaginated(options?: {
        search?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDir?: "asc" | "desc";
    }): Promise<{ users: AdminUser[]; total: number; limit: number; offset: number }>;
    getUser(uid: string): Promise<{ user: AdminUser }>;
    createUser(data: { email: string; displayName?: string; password?: string; roles?: string[]; metadata?: Record<string, any> }): Promise<{ user: AdminUser }>;
    updateUser(uid: string, data: { email?: string; displayName?: string; password?: string; roles?: string[]; metadata?: Record<string, any> }): Promise<{ user: AdminUser }>;
    deleteUser(uid: string): Promise<{ success: boolean }>;
    resetPassword(uid: string, options?: { password?: string }): Promise<{ user: AdminUser; temporaryPassword?: string; invitationSent?: boolean; emailDeliveryFailed?: boolean }>;
    listRoles(): Promise<{ roles: Array<{ id: string; name: string }> }>;
    bootstrap(): Promise<{ success: boolean; message: string; user: { uid: string; roles: string[] } }>;
}

// ─── Cron API ────────────────────────────────────────────────────────────────

/**
 * Client-side Cron job management interface.
 * @group Cron
 */
export interface CronAPI {
    listJobs(): Promise<{ jobs: CronJobStatus[] }>;
    getJob(jobId: string): Promise<{ job: CronJobStatus }>;
    triggerJob(jobId: string): Promise<{ log: CronJobLogEntry; job: CronJobStatus }>;
    getJobLogs(jobId: string, options?: { limit?: number }): Promise<{ logs: CronJobLogEntry[] }>;
    toggleJob(jobId: string, enabled: boolean): Promise<{ job: CronJobStatus }>;
}

// ─── Backups API ─────────────────────────────────────────────────────────────

/**
 * Client-side database-backup management interface.
 * @group Backups
 */
export interface BackupsAPI {
    /** List available backups at the configured destination, newest first. */
    list(): Promise<{ backups: BackupInfo[]; destinationKind: BackupDestinationKind; configured: boolean }>;
    /** Fetch a backup's bytes for download (authenticated). */
    download(key: string): Promise<Blob>;
}

// ─── Functions API ───────────────────────────────────────────────────────────

/**
 * Options for invoking a custom backend function.
 * @group Functions
 */
export interface FunctionInvokeOptions {
    /** HTTP method — defaults to `"POST"`. */
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    /** Sub-path appended after the function name. */
    path?: string;
    /** Extra headers merged into the request. */
    headers?: Record<string, string>;
}

/**
 * Client interface for invoking custom backend functions.
 * @group Functions
 */
export interface FunctionsAPI {
    /**
     * Invoke a custom backend function by name.
     *
     * @typeParam T - Expected shape of the response payload.
     * @param name    - Function name (filename without extension, e.g. `"extract-job"`).
     * @param payload - Optional JSON-serialisable body sent as POST.
     * @param options - Optional overrides (method, sub-path, headers).
     */
    invoke<T = unknown>(name: string, payload?: unknown, options?: FunctionInvokeOptions): Promise<T>;
}

// ─── HistoryConfig ───────────────────────────────────────────────────────────

/**
 * Configuration for entity history / audit-log tracking.
 *
 * - `true` — enable history with default settings
 * - `{ retention?: number }` — enable with optional retention period in days
 */
export type HistoryConfig = boolean | { retention?: number };

// ─── RebaseWebSocket ─────────────────────────────────────────────────────────

/**
 * Minimal WebSocket client contract exposed on {@link RebaseClient}.
 *
 * The full implementation (`RebaseWebSocketClient` in `@rebasepro/client`)
 * adds subscription helpers, CRUD-over-WS, SQL execution, etc.
 */
export interface RebaseWebSocket {
    /** Disconnect the WebSocket and stop reconnecting. */
    disconnect(): void;
    /** Send an authentication token to the server. */
    authenticate(token: string): Promise<void>;
    /** Set a function that lazily resolves the auth token for auto-authentication. */
    setAuthTokenGetter(getter: () => Promise<string | null>): void;
    /** Listen for connection lifecycle events. */
    on(event: "connect" | "disconnect" | "reconnect" | "error", cb: (...args: unknown[]) => void): () => void;
}

// ─── RebaseClient ────────────────────────────────────────────────────────────

/**
 * The single, canonical Rebase client interface.
 *
 * Used everywhere: the server-side `rebase` singleton, the SDK's
 * `createRebaseClient()`, React context, cron job context, etc.
 *
 * Core fields (`data`, `auth`) are always present. Everything else
 * is optional — which capabilities are populated depends on the
 * runtime environment and adapter.
 */
export interface RebaseClient<DB = unknown> {
    /** Unified Data access layer */
    data: RebaseSdkData<DB>;

    /**
     * Admin-scoped data accessor — **not** an RLS bypass.
     *
     * Present on the **server** singleton only (see {@link RebaseServerClient}).
     * It runs as the service identity `{ uid: "service", roles: ["admin"] }`,
     * and the driver is scoped with `withAuth()` at boot, so every read and
     * write runs in a transaction that has switched to the restricted
     * `rebase_user` role with `app.uid = 'service'`: policies are evaluated,
     * against that identity. This is the correct tool for trusted background
     * work (cron jobs, migrations, service-to-service tasks).
     *
     * Two consequences the name does not suggest:
     *
     * - `policy.serverContext()` compiles to `rebase.uid() IS NULL` and is
     *   therefore **false** here. A collection with `disableDefaultPolicies:
     *   true` whose only rule is `serverContext()` refuses these writes
     *   (`42501`) and returns zero rows — HTTP 200, empty — for these reads.
     * - Its reach equals an `admin`-roled application user's reach. It is not a
     *   private channel. The true bypass is {@link sql}, which runs on the
     *   owner connection and never goes through `withAuth`.
     *
     * ⚠️ **Do NOT use it to serve user-facing data.** Inside a request handler,
     * user-scoped queries must go through the request-scoped driver
     * (`c.var.driver`), which carries the caller's identity. Reaching for
     * `dataAsAdmin` (or its alias {@link data}) in a request handler serves
     * every caller whatever an admin may see.
     *
     * Undefined in the browser SDK.
     */
    dataAsAdmin?: RebaseSdkData<DB>;

    /** Unified Authentication layer */
    auth: AuthClient;

    /** Unified Storage layer — the default storage source. */
    storage?: StorageSource;

    /** Registry of all named storage sources for multi-backend support */
    storageRegistry?: StorageSourceRegistry;

    /**
     * Build a server-backed {@link StorageSource} for a named storage source.
     * The returned source forwards `storageId` to the backend so requests are
     * routed to the matching `StorageController`. Used to lazily wire
     * `transport: "server"` sources on the frontend.
     */
    createStorageSource?(storageId: ResourceRef): StorageSource;

    /**
     * The storage source a bucket handle names, ready to use.
     *
     * ```ts
     * import { media } from "../../config/resources";
     * await rebase.bucket(media).upload(key, file);
     * ```
     *
     * Named after the constructor: `bucket("media")` declares it, and
     * `rebase.bucket(media)` reaches it — the same name, spelled once. A string
     * key is accepted for callers that only have one. Throws on a source the
     * backend did not register, naming the ones it did, rather than silently
     * serving the default — the failure that used to look like an upload that
     * worked.
     */
    bucket?(source: ResourceRef): StorageSource;

    /**
     * Discover the storage sources declared on the backend via
     * `GET /api/storage/sources`. Server-transport sources are auto-registered
     * into {@link storageRegistry}; `direct` sources are returned so the app
     * can supply the live {@link StorageSource} instance. The result is cached
     * (a failed call is retryable). This makes the backend the single source of
     * truth for storage-source configuration.
     */
    fetchStorageSources?(): Promise<StorageSourceDefinition[]>;

    /**
     * Server-side email service.
     * Available when SMTP or a custom `sendEmail` function is configured.
     */
    email?: EmailService;

    /** Admin API for user management */
    admin?: AdminAPI;

    /** Cron job management API */
    cron?: CronAPI;

    /** Database backup management API */
    backups?: BackupsAPI;

    /** Custom backend functions API */
    functions?: FunctionsAPI;

    /** Service API keys management API */
    apiKeys?: ApiKeysAPI;


    /** Base HTTP URL of the backend server */
    baseUrl?: string;

    /**
     * The path every API route is mounted under, appended to {@link baseUrl}.
     *
     * `"/api"` unless the backend was configured with a different `basePath`
     * and the client told to match. Exposed because code that builds a URL by
     * hand — rather than going through the client's own methods — otherwise has
     * to guess, and guessing `/api` is wrong for exactly the projects that set
     * the option.
     */
    apiPath?: string;

    /** WebSocket client for realtime subscriptions */
    ws?: RebaseWebSocket;

    /** Set the auth token for subsequent requests */
    setToken?(token: string | null): void;

    /** Set a function that lazily resolves the auth token */
    setAuthTokenGetter?(getter: () => Promise<string | null>): void;

    /** Set handler called when a request returns 401 */
    setOnUnauthorized?(handler: () => Promise<boolean>): void;

    /** Resolve the current auth token */
    resolveToken?(): Promise<string | null>;

    /**
     * POST to an arbitrary path on the backend — the escape hatch, not the way
     * to call a function.
     *
     * For a custom function use {@link functions}`.invoke(name, payload)`: it
     * targets `/functions/<name>`, takes a method and sub-path, and returns the
     * response body as sent. This posts wherever you point it and **unwraps**:
     * it returns `res.data` when the response has a `data` property and the
     * whole envelope otherwise — so an endpoint that legitimately answers
     * `{ data: null }` hands back the envelope rather than `null`. Two ways to
     * reach a function with two different response contracts is a trap; this is
     * the one that exists for paths `invoke` cannot express.
     *
     * @internal Prefer `functions.invoke()`. Kept public because a backend can
     * mount routes outside `/functions`, and nothing else reaches those.
     */
    call?<T = unknown>(endpoint: string, payload?: unknown): Promise<T>;

    /**
     * Execute raw SQL against the database.
     * Only available server-side with a SQL database.
     */
    sql?(query: string, options?: { database?: string; role?: string }): Promise<Record<string, unknown>[]>;
}

// ─── RebaseServerClient ──────────────────────────────────────────────────────

/**
 * The server-side Rebase surface — the shape of the `rebase` singleton exported
 * from `@rebasepro/server`.
 *
 * Narrows {@link RebaseClient} to the guarantees that always hold on the server:
 * the admin-scoped {@link dataAsAdmin} accessor, raw {@link sql}, and the
 * {@link email} service are all present (non-optional).
 *
 * **Trust levels.** {@link dataAsAdmin} is the admin-scoped driver — scoped as
 * `{ uid: "service", roles: ["admin"] }`, so policies are still evaluated
 * against that identity rather than skipped — and it is the only name for it
 * here: the `data` alias that used to sit beside it is deliberately `Omit`ted
 * from {@link RebaseClient} so the privilege has to be spelled out at every
 * call site. {@link sql} is the unconditional bypass: raw SQL on the owner
 * connection, no policies. For user-scoped queries inside a request handler use
 * the request-scoped driver (`c.var.driver`) instead — never `dataAsAdmin`.
 */
export interface RebaseServerClient<DB = unknown> extends Omit<RebaseClient<DB>, "data"> {
    /**
     * Admin-scoped data accessor (RLS is evaluated as the service identity, not
     * skipped). Always present server-side. See {@link RebaseClient.dataAsAdmin}
     * for the full safety contract.
     */
    dataAsAdmin: RebaseSdkData<DB>;

    /**
     * Server-side email service. Always present server-side (a no-op sender is
     * wired when SMTP is not configured).
     */
    email: EmailService;

    /**
     * Execute raw SQL against the database. Always present server-side for SQL
     * engines. Values interpolated into the query should be passed via
     * `params`, referenced as `$1`, `$2`, … placeholders in the query text.
     *
     * **Runtime note.** This is the one accessor on this object that is not
     * portable. It runs on the database owner connection over a TCP socket, so
     * it is available wherever the framework holds that connection — every Node
     * deployment, self-hosted or managed — and not on a host that has no
     * sockets and no business holding owner credentials.
     *
     * Nothing about that is a problem for a Node deployment, and it is not a
     * reason to avoid it there. It is a reason not to build a function's *only*
     * data path on it if that function may later move: `c.get("driver")` and
     * `rebase.dataAsAdmin` go over the same wire wherever they run. A function
     * that genuinely needs raw SQL can ask `runtimeKey()` and degrade, rather
     * than discovering it at the call.
     */
    sql(query: string, options?: { database?: ResourceRef; role?: string; params?: unknown[] }): Promise<Record<string, unknown>[]>;
}

/**
 * Client-side registry for managing multiple storage sources.
 *
 * Mirrors the server-side `StorageRegistry` pattern. Allows collection
 * properties to reference a named storage backend via
 * `StorageConfig.storageSource`.
 *
 * @group Models
 */
export interface StorageSourceRegistry {
    /**
     * Get a storage source by key.
     * @param key - Storage source key, or undefined/null for default
     * @returns The StorageSource, or undefined if not found
     */
    get(key: string | undefined | null): StorageSource | undefined;

    /**
     * Get the default storage source (key = "(default)").
     * @throws Error if no default storage is registered
     */
    getDefault(): StorageSource;

    /**
     * Get a storage source by key, with fallback to default.
     * @param key - Storage source key, or undefined/null for default
     * @returns The StorageSource (falls back to default if key not found)
     * @throws Error if neither the specified nor default storage exists
     */
    getOrDefault(key: string | undefined | null): StorageSource;

    /** Check if a storage source with the given key exists */
    has(key: string): boolean;

    /** List all registered storage source keys */
    list(): string[];
}

