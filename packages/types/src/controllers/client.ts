import type { User } from "../users";
import type { RebaseData } from "./data";
import type { EmailService } from "./email";
import type { StorageSource } from "./storage";
import type { CronJobStatus, CronJobLogEntry } from "../types/cron";
import type { ApiKeysAPI } from "../types/api_keys";
import type { StorageSourceDefinition } from "../types/storage_source";


/**
 * Event type for authentication state changes
 */
export type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

/**
 * Standard session interface representing an authenticated state
 */
export interface RebaseSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    user: User;
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
}

// ─── Admin API ───────────────────────────────────────────────────────────────

/**
 * User record as returned by the Admin API.
 * @group Admin
 */
export interface AdminUser {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    provider: string;
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
    getUser(userId: string): Promise<{ user: AdminUser }>;
    createUser(data: { email: string; displayName?: string; password?: string; roles?: string[]; metadata?: Record<string, any> }): Promise<{ user: AdminUser }>;
    updateUser(userId: string, data: { email?: string; displayName?: string; password?: string; roles?: string[]; metadata?: Record<string, any> }): Promise<{ user: AdminUser }>;
    deleteUser(userId: string): Promise<{ success: boolean }>;
    resetPassword(userId: string, options?: { password?: string }): Promise<{ user: AdminUser; temporaryPassword?: string; invitationSent?: boolean }>;
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
    data: RebaseData;

    /** Unified Authentication layer */
    auth: AuthClient;

    /** Unified Storage layer (default storage source, backward-compatible) */
    storage?: StorageSource;

    /** Registry of all named storage sources for multi-backend support */
    storageRegistry?: StorageSourceRegistry;

    /**
     * Build a server-backed {@link StorageSource} for a named storage source.
     * The returned source forwards `storageId` to the backend so requests are
     * routed to the matching `StorageController`. Used to lazily wire
     * `transport: "server"` sources on the frontend.
     */
    createStorageSource?(storageId: string): StorageSource;

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

    /** Custom backend functions API */
    functions?: FunctionsAPI;

    /** Service API keys management API */
    apiKeys?: ApiKeysAPI;


    /** Base HTTP URL of the backend server */
    baseUrl?: string;

    /** WebSocket client for realtime subscriptions */
    ws?: unknown;

    /** Set the auth token for subsequent requests */
    setToken?(token: string | null): void;

    /** Set a function that lazily resolves the auth token */
    setAuthTokenGetter?(getter: () => Promise<string | null>): void;

    /** Set handler called when a request returns 401 */
    setOnUnauthorized?(handler: () => Promise<boolean>): void;

    /** Resolve the current auth token */
    resolveToken?(): Promise<string | null>;

    /** Make a raw HTTP call to the backend */
    call?<T = unknown>(endpoint: string, payload?: unknown): Promise<T>;

    /**
     * Execute raw SQL against the database.
     * Only available server-side with a SQL database.
     */
    sql?(query: string, options?: { database?: string; role?: string }): Promise<Record<string, unknown>[]>;
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

