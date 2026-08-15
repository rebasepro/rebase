import {
    AuthAdapter,
    BackendBootstrapper,
    BootstrappedAuth,
    DatabaseAdapter,
    DataDriver,
    DataSourceDefinition,
    CollectionCallbacks,
    AnyCollectionConfig,
    CollectionConfig,
    HealthCheckResult,
    HistoryConfig,
    InitializedDriver,
    isSQLAdmin,
    RealtimeProvider,
    SecurityRule
} from "@rebasepro/types";
import { createDataSourceRegistry, resolveDataSource, buildSdkData, buildRoutedRebaseData, getEffectiveSecurityRules } from "@rebasepro/common";
import { randomBytes } from "node:crypto";
import { BackendCollectionRegistry } from "./collections/BackendCollectionRegistry";
import { loadCollectionsFromDirectory } from "./collections/loader";
import { assertCollectionConfigs } from "./collections/validate-config";
import { DEFAULT_DRIVER_ID, DefaultDriverRegistry, DriverRegistry } from "./services/driver-registry";
import { createRoutedRealtimeService } from "./services/routed-realtime-service";
import { Server } from "http";

import { RestApiGenerator } from "./api/rest/api-generator";
import { createAuthMiddleware } from "./auth/middleware";
import { createAdapterAuthMiddleware } from "./auth/adapter-middleware";
import { scopeDataDriver, SERVICE_IDENTITY } from "./auth/rls-scope";
import { createBuiltinAuthAdapter } from "./auth/builtin-auth-adapter";
import { errorHandler } from "./api/errors";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HonoEnv } from "./api/types";
import { configureLogLevel } from "./utils/logging";
import { logger } from "./utils/logger";
import { configureMiddlewares } from "./init/middlewares";
import { initializeStorage, assertStorageAccessControlConfigured } from "./init/storage";
import { mountOpenApiDocs } from "./init/docs";
import { createHealthCheck } from "./init/health";
import { createShutdown } from "./init/shutdown";
import {
    ALL_RUNTIME_SURFACES,
    disabledSurfaces,
    resolveOwnership,
    resolveSurfaces,
    type RuntimeOwnershipOptions,
    type RuntimeSurfaceOptions
} from "./init/surfaces";
import { installUnhandledRejectionHandler } from "./init/process-safety";
import { configureJwt, hasAsymmetricSigningKey, isJwtConfigured, requireAdmin } from "./auth";
import { createJwksRoutes } from "./auth/jwks-routes";
import type { JwtSigningKeyConfig } from "./auth/jwt-keys";
import type { JobQueueOptions } from "./jobs/types";
import {
    BackendStorageConfig,
    createStorageRoutes,
    StorageController,
    StorageRegistry
} from "./storage";
import type { ApiKeyStore } from "./auth/api-keys/api-key-store";
import { createApiKeyStore } from "./auth/api-keys/api-key-store";
import { createApiKeyRoutes } from "./auth/api-keys/api-key-routes";
import { createApiKeyPreAuth, createFunctionApiKeyGuard, createStorageApiKeyGuard } from "./auth/api-keys/api-key-middleware";
import { createRequireAuth } from "./auth/middleware";
import { createDataRateLimiter, DEFAULT_FUNCTIONS_ANONYMOUS_LIMIT, type DataRateLimitConfig } from "./auth/rate-limiter";
import { MemoryRateLimitStore } from "./auth/rate-limit-store";
import { warnOnAuthCollectionDataCallbacks } from "./auth/collection-callback-warning";
import { createRebaseClient } from "@rebasepro/client";

import { createHistoryRoutes } from "./history";
import type { EmailService } from "./email";
import { createEmailService, EmailConfig } from "./email";
import type { OAuthProvider } from "./auth/interfaces";
import type { AuthHooks } from "./auth/auth-hooks";
import { _initRebase } from "./singleton";

export interface RebaseAuthConfig {
    /**
     * The collection that represents auth users.
     *
     * When provided, this collection's underlying database table is used
     * for all auth operations (login, registration, password reset, etc.).
     *
     * Import the built-in default:
     * ```ts
     * import { defaultUsersCollection } from "@rebasepro/common";
     * auth: { collection: defaultUsersCollection, jwtSecret: "..." }
     * ```
     *
     * Or pass your own collection with the required auth fields
     * (email, passwordHash, displayName, etc.).
     */
    /**
     * Accepts a collection of any row type: `defineCollection` infers `M` from
     * the properties, and `CollectionConfig` is invariant in `M`, so a bare
     * `CollectionConfig` here rejects everything the builder returns.
     */
    collection?: AnyCollectionConfig;
    jwtSecret?: string;
    /**
     * Asymmetric keys for signing access tokens, newest first. Additive —
     * without them tokens stay HS256, exactly as before. With them, anyone can
     * verify a session from `/.well-known/jwks.json` without holding the key
     * that mints one, and a key can be rotated without signing users out.
     *
     * ```ts
     * auth: {
     *   jwtSecret: process.env.JWT_SECRET,
     *   signingKeys: [{ kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }]
     * }
     * ```
     */
    signingKeys?: JwtSigningKeyConfig[];
    /** Which of {@link signingKeys} mints new tokens. Defaults to the first. */
    activeKid?: string;
    accessExpiresIn?: string;
    refreshExpiresIn?: string;
    requireAuth?: boolean;
    allowRegistration?: boolean;
    /**
     * Block self-registration outright — the hard kill switch.
     *
     * `allowRegistration: false` still admits the very first user on an empty
     * database, because otherwise a fresh deployment has no way to create its
     * own admin: `POST /admin/bootstrap` needs an authenticated caller. This
     * closes that window too, for operators who provision every account out of
     * band and never want a public first-come-first-admin race.
     *
     * With this set, an empty backend has no self-service path in at all —
     * create the first user with the CLI or a seed script.
     */
    disableSelfRegistration?: boolean;
    /**
     * Opt-in: allow `POST /auth/anonymous` to mint a user with no credentials.
     *
     * Off by default. Anonymous sign-in inserts a `users` row and assigns
     * `defaultRole` exactly as registration does, so leaving it always-on meant
     * a backend with `allowRegistration: false` and `disableSelfRegistration:
     * true` still handed out permanent accounts: `/auth/anonymous` for the row
     * and the session, then `/auth/anonymous/link` to put an email and password
     * on it. `disableSelfRegistration` overrides this key.
     */
    allowAnonymous?: boolean;
    /**
     * Opt-in: expose `POST /auth/find-user` so an authenticated user can resolve
     * an email address to a minimal public profile (`uid`, `displayName`,
     * `photoURL` only). This powers invite-by-email flows without a custom
     * admin server function. Off by default because it enables user enumeration
     * by any signed-in user. Available on the client as `auth.findUserByEmail`.
     */
    allowUserLookup?: boolean;
    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When a request includes `Authorization: Bearer <serviceKey>`, it is
     * granted admin-level access without JWT verification. This is the
     * Rebase equivalent of a Service Account key.
     *
     * Generate with: `node -e "logger.info(require('crypto').randomBytes(48).toString('base64'))"`
     *
     * Set via `REBASE_SERVICE_KEY` in your `.env`.
     * Must be at least 32 characters.
     */
    serviceKey?: string;
    email?: EmailConfig;
    // ── Convenience shortcuts ─────────────────────────────────────────
    // Each named field below is syntactic sugar that internally resolves
    // to an `OAuthProvider` via the corresponding `create*Provider`
    // factory at startup. They are equivalent to constructing the
    // provider manually and passing it in the `providers` array.
    //
    // For providers not listed here, or for full control over the
    // provider configuration, use the `providers` array directly.
    google?: { clientId: string; clientSecret?: string };
    linkedin?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
    microsoft?: { clientId: string; clientSecret: string; tenantId?: string };
    apple?: { clientId: string; teamId: string; keyId: string; privateKey: string };
    facebook?: { clientId: string; clientSecret: string };
    twitter?: { clientId: string; clientSecret: string };
    discord?: { clientId: string; clientSecret: string };
    gitlab?: { clientId: string; clientSecret: string; baseUrl?: string };
    bitbucket?: { clientId: string; clientSecret: string };
    slack?: { clientId: string; clientSecret: string };
    spotify?: { clientId: string; clientSecret: string };
    defaultRole?: string;
    /**
     * Canonical array of OAuth providers.
     *
     * This is the primary extension point for **all** OAuth integrations.
     * Each entry is an `OAuthProvider<unknown>` constructed via one of
     * the `create*Provider` factories exported from `@rebasepro/server`
     * (e.g. `createGoogleProvider`, `createGitHubProvider`).
     *
     * The named convenience fields above (`google`, `github`, etc.) are
     * automatically resolved into this array at startup. You can mix both
     * approaches; named fields and explicit entries are merged (named
     * fields are appended after explicit entries).
     *
     * @example
     * ```ts
     * import { createGoogleProvider } from "@rebasepro/server";
     *
     * auth: {
     *   providers: [
     *     createGoogleProvider({ clientId: "…", clientSecret: "…" }),
     *   ],
     * }
     * ```
     */
    providers?: OAuthProvider<unknown>[];
    /**
     * Redirect URIs the OAuth sign-in routes will accept, for every provider.
     *
     * Left unset, the only check is the provider's own registered-URI match —
     * which authorises *every* URI registered on that OAuth client, including
     * the `localhost` entry someone added for development and the staging host
     * nobody removed. List the origins this backend actually serves to narrow
     * it. Compared on origin plus path; query, fragment and a trailing slash
     * are ignored.
     *
     * @example
     * ```ts
     * auth: { allowedRedirectUris: ["https://admin.example.com/"] }
     * ```
     */
    allowedRedirectUris?: string[];
    /**
     * Override specific parts of the built-in auth implementation.
     *
     * Each override replaces one piece of the default behavior while
     * keeping everything else intact. Unset overrides fall through
     * to the built-in defaults (scrypt passwords, standard validation, etc.).
     *
     * @example bcrypt passwords with a custom hash
     * ```ts
     * import bcrypt from "bcrypt";
     *
     * hooks: {
     *     hashPassword: (pw) => bcrypt.hash(pw, 12),
     *     verifyPassword: (pw, hash) => bcrypt.compare(pw, hash),
     * }
     * ```
     */
    hooks?: AuthHooks;

    /**
     * Enable magic link (passwordless email) authentication.
     * Requires email to be configured.
     */
    magicLink?: boolean;
    /**
     * Opt-in httpOnly cookie mode for refresh tokens.
     *
     * When set, the refresh token is delivered as an `httpOnly`, `Secure`,
     * `SameSite` cookie instead of in the JSON response body. This
     * prevents XSS from stealing the long-lived refresh token.
     *
     * The access token remains in the JSON body so the client can use it
     * in `Authorization: Bearer` headers for API calls.
     *
     * **Requires** `credentials: "include"` on client-side fetch calls to
     * auth endpoints, and CORS must allow credentials (no `origin: "*"`).
     */
    cookieAuth?: import("./auth").CookieAuthConfig;
}

/** @see RebaseBackendConfig.baas */
export interface BaasOptions {
    /**
     * What to do with introspected tables that have row-level security
     * disabled.
     *
     * Such a table carries no authorization model. Every authenticated request
     * runs as `rebase_user`, which is granted DML on the schema, so serving one
     * hands every row to every logged-in user — the API would be an open door
     * onto whatever the database happens to contain.
     *
     * - `"exclude"` (default) — do not serve it. Each excluded table is logged
     *   with the SQL to protect it. Secure by default, consistent with the rest
     *   of the driver, which fails a boot rather than serve unenforced requests.
     * - `"serve"` — serve it anyway. Only sensible when every caller is already
     *   trusted, e.g. an internal service behind its own authorization.
     */
    unprotectedTables?: "exclude" | "serve";
}

export interface RebaseBackendConfig {
    /** Invariance again — see the note on `RebaseAuthConfig.collection`. */
    collections?: AnyCollectionConfig[];
    collectionsDir?: string;
    server: Server;
    app: Hono<HonoEnv>;
    basePath?: string;

    /**
     * Rate limiting for the data API, per caller: an API key by its id, a
     * signed-in user by their uid, anyone else by IP.
     *
     * On by default with loose limits — a floor against a runaway client, not a
     * quota. Counts live in this process's memory unless you pass a `store`, so
     * N replicas enforce N times the limit between them; set real quotas at a
     * proxy or supply a shared store if that matters. `{ enabled: false }` for
     * a deployment whose edge already does this.
     */
    rateLimit?: DataRateLimitConfig;


    /**
     * Force the schema-editor routes on or off.
     *
     * Defaults to enabled when `collectionsDir` is set, outside production, in
     * `cms` mode. The editor rewrites collection files, so it needs a
     * `collectionsDir` to write to.
     */
    schemaEditor?: boolean;

    /** Options that only apply when collections are derived from the database. */
    baas?: BaasOptions;

    /**
     * Declared data sources, shared with the frontend `<Rebase dataSources>`.
     *
     * Used to resolve each collection's engine (capabilities) and transport.
     * Collections on a `direct`/`custom` transport are client-only: the backend
     * still owns their schema/registry but does **not** generate server data
     * routes for them. Server-mediated sources (the default) need no entry.
     */
    dataSources?: DataSourceDefinition[];

    /**
     * Database bootstrappers.
     */
    bootstrappers?: BackendBootstrapper[];
    /**
     * Database adapter.
     *
     * When set, this takes precedence over `bootstrappers`.
     *
     * @example
     * ```ts
     * import { createPostgresAdapter } from "@rebasepro/server-postgres";
     * database: createPostgresAdapter({ connection: db, schema }),
     * ```
     */
    database?: DatabaseAdapter;

    logging?: {
        level?: "error" | "warn" | "info" | "debug";
    };

    /**
     * Authentication configuration.
     *
     * Accepts **either**:
     * - `RebaseAuthConfig` — built-in configuration
     * - `AuthAdapter` — pluggable adapter for external auth (Clerk, Auth0, etc.)
     *
     * When a plain config object is provided, the built-in adapter is created
     * automatically from the bootstrapper's `initializeAuth()` result.
     */
    auth?: RebaseAuthConfig | AuthAdapter;

    /**
     * Storage configuration. Accepts:
     *
     * - A `BackendStorageConfig` object (`{ type: 'local' | 's3' | 'gcs', ... }`)
     * - A `StorageController` instance (for custom providers like Azure, etc.)
     * - A `Record<string, ...>` of either, for multi-backend setups
     */
    storage?: BackendStorageConfig | StorageController | Record<string, BackendStorageConfig | StorageController>;

    /**
     * Declared storage sources. Drives the client-side StorageSourceRegistry
     * and the transport distinction (server vs direct).
     *
     * Server-backed sources are auto-derived from the `storage` map — you
     * only need explicit entries for "direct" transport sources (e.g.
     * external storage) that the backend does not proxy.
     */
    storageSources?: import("@rebasepro/types").StorageSourceDefinition[];

    /**
     * Per-object access control for storage — the analogue of a collection's
     * security rules, and the thing `requireAuth` / `publicRead` cannot
     * express because they are global switches.
     *
     * Called after authentication on every storage route with the key, bucket,
     * operation (`read` / `write` / `delete` / `list`) and resolved user.
     * Return false to deny with a 403; throwing denies too.
     *
     * ```ts
     * storageAuthorize: async ({ key, user, operation }) => {
     *     if (!user) return false;
     *     const [ownerId] = key.split("/");
     *     return ownerId === user.uid || operation === "read";
     * }
     * ```
     *
     * Without it, any authenticated caller may read any key they can name, so
     * multi-tenant apps should treat this as required rather than optional.
     *
     * In production, storage refuses to boot unless one of `storageAuthorize`,
     * {@link storagePublicRead}, or {@link storageInsecureAllowAnyAuthenticated}
     * is set — see `assertStorageAccessControlConfigured`.
     */
    storageAuthorize?: import("./storage/types").StorageAuthorize;

    /**
     * Allow unauthenticated read access to stored files (default: false).
     *
     * Set this only when the bucket is genuinely a public, read-only CDN.
     * Writes, deletes and listing still require authentication. Because it is a
     * deliberate statement that reads are public, it also satisfies the
     * production storage boot guard (see {@link storageAuthorize}).
     */
    storagePublicRead?: boolean;

    /**
     * Opt out of the storage access-control boot guard, keeping the legacy
     * behaviour where **any** authenticated user can read, overwrite, delete or
     * list **any** key (storage keys share one flat namespace and are not under
     * RLS).
     *
     * Only safe for single-tenant apps where every signed-in user is trusted
     * with every file. Multi-tenant apps must use `storageAuthorize` instead.
     * Without one of these, storage refuses to boot in production.
     */
    storageInsecureAllowAnyAuthenticated?: boolean;

    /**
     * Entity history / audit-log configuration.
     *
     * - `true` — enable history with default settings
     * - `{ retention?: number }` — enable with optional retention period (days)
     */
    history?: HistoryConfig;
    enableSwagger?: boolean;
    /**
     * Which HTTP surfaces this process mounts. Every one, unless named.
     *
     * The point of naming a subset is to run the same bundle as several
     * cooperating processes — one answering `/api/data`, another `/api/functions`
     * — so a custom function that pins the event loop does not do it in the
     * process serving the data API. `bootFromBundle` derives this from
     * `REBASE_ROLE`; passing it directly is for tests and for embedders.
     *
     * Omitting it, or naming only some surfaces, leaves the rest mounted. That
     * default is deliberate: a surface added in a later version is served by
     * every existing deployment without anyone editing a list.
     */
    surfaces?: RuntimeSurfaceOptions;
    /**
     * Which background singletons this process runs. All of them, unless named.
     *
     * Separate from {@link surfaces} because "which URLs answer" and "which
     * timers fire" are independent: a process can serve the cron *admin* surface
     * without being the one that fires the jobs, and vice versa.
     *
     * Neither is a correctness control — the cron scheduler claims each
     * `(job, slot)` pair and the job store claims rows `FOR UPDATE SKIP LOCKED`,
     * so running several of each is already safe. It is about not handing
     * scheduled work to a process whose replica count is a scaling decision.
     */
    ownership?: RuntimeOwnershipOptions;
    functionsDir?: string;
    /**
     * Per-request ceiling for `/api/functions/*`, in milliseconds.
     *
     * Custom functions run code the framework did not write, and nothing else
     * in the stack bounds it. Defaults to 30000 (or
     * `REBASE_FUNCTIONS_TIMEOUT_MS`). `0` disables the ceiling — for a function
     * that legitimately runs long, or a deployment whose proxy already imposes
     * one. Timed-out requests answer 504; the handler itself cannot be
     * cancelled, so give outbound calls an `AbortSignal`.
     */
    functionsTimeoutMs?: number;
    cronsDir?: string;
    /**
     * Enable/disable database persistence for cron job execution logs.
     * When set to false, cron jobs will run but logs will not be persisted to the database.
     * Default: true.
     */
    cronPersistence?: boolean;
    /**
     * The durable job queue: background work that survives a restart.
     *
     * Off unless `enabled` is set, because a worker polls the database forever
     * and that is not a default anyone chose. Requires a driver that can run
     * SQL; on one that cannot, the queue is unavailable and callers are told
     * so at boot rather than at the first enqueue.
     *
     * ```ts
     * jobs: {
     *   enabled: true,
     *   tasks: {
     *     "send-welcome": async ({ payload }) => { await sendEmail(payload.email); }
     *   }
     * }
     * ```
     */
    jobs?: JobQueueOptions;
    /**
     * Maximum request body size in bytes for API routes (default: 10MB).
     * Set to 0 to disable the global limit entirely.
     *
     * Note: Storage upload routes use their own limit from the storage config's
     * `maxFileSize` property (default: 50MB), which takes precedence over this.
     */
    maxBodySize?: number;
    /**
     * Response compression for API routes. **Enabled by default.**
     *
     * Compresses responses with gzip/deflate, negotiated from the request's
     * `Accept-Encoding`. Bodies that are already compressed (images, video),
     * streamed (`text/event-stream`), or explicitly marked
     * `Cache-Control: no-transform` are left untouched, so this is safe to
     * leave on — a large JSON list response typically drops by ~20x.
     *
     * Set to `false` when something in front of the app already compresses
     * (nginx, Cloudflare, or another reverse proxy / load balancer), to avoid
     * paying for it twice.
     */
    compression?: boolean;
    /**
     * CSRF protection configuration. **Opt-in** — disabled by default.
     *
     * BaaS APIs are consumed by mobile apps, SPAs on different domains,
     * and CLI tools, so CSRF is intentionally not enabled unless you
     * explicitly configure it with allowed origins.
     *
     * @example
     * ```ts
     * csrf: { origin: ["https://myapp.com", "https://admin.myapp.com"] }
     * ```
     */
    csrf?: {
        /** Allowed origins for CSRF validation. */
        origin: string | string[] | ((origin: string) => boolean);
    };
    /**
     * Global lifecycle callbacks applied to every collection.
     *
     * Same type as per-collection `callbacks` — fires on **every** data path
     * (REST API, WebSocket / realtime, server-side `rebase.data`).
     *
     * Execution order: global callbacks → collection callbacks → property callbacks.
     *
     * @example
     * ```ts
     * callbacks: {
     *     afterRead({ row, collection }) {
     *         console.log(`Read ${collection.slug}/${row.id}`);
     *         return row;
     *     }
     * }
     * ```
     */
    callbacks?: CollectionCallbacks;

    /**
     * Declare that this application installs its own CORS middleware.
     *
     * Suppresses the "no CORS configuration detected" warning, which exists for
     * hand-wired backends that genuinely have no origin policy.
     */
    corsHandled?: boolean;

    /**
     * The schema version this deployment serves, as recorded when it was built.
     *
     * Published by the contract endpoint so a client generated elsewhere can
     * tell whether it is current. Leave unset and the runtime computes one from
     * the live collections — correct, but it means the value moves whenever the
     * collections do, which is exactly right for `baas` mode and slightly less
     * useful for a built bundle that already knows its own answer.
     */
    schemaVersion?: string;

    /** Runtime version reported by the contract endpoint. Informational. */
    runtimeVersion?: string;
}

/**
 * Type guard to detect whether the `auth` config is an `AuthAdapter`
 * (has a `verifyRequest` method) vs a plain `RebaseAuthConfig` (plain object).
 *
 * Re-exported from `auth/require-auth`, which is where it now lives so the
 * drivers can reach `resolveRequireAuth` without importing this entry point.
 */
import { isAuthAdapter, resolveRequireAuth } from "./auth/require-auth";
export { isAuthAdapter } from "./auth/require-auth";

/**
 * Type guard to detect whether `database` is a `DatabaseAdapter`.
 */
export function isDatabaseAdapter(db: unknown): db is DatabaseAdapter {
    return typeof db === "object" && db !== null && "initializeDriver" in db && "type" in db && !("initializeAuth" in db);
}


export interface RebaseBackendInstance {
    driverRegistry: DriverRegistry;
    driver: DataDriver;
    realtimeServices: Record<string, RealtimeProvider>;
    realtimeService: RealtimeProvider;
    auth?: BootstrappedAuth;
    history?: { historyService: import("./history/history-routes").HistoryService };
    storageRegistry?: StorageRegistry;
    storageController?: StorageController;
    collectionRegistry: BackendCollectionRegistry;
    cronScheduler?: import("./cron").CronScheduler;
    /**
     * The durable job queue, when `jobs.enabled` is set and the driver can run
     * SQL. Present on the instance because the *producers* live in application
     * code — a `WebhookDispatcher` is constructed by the app, so this is what
     * it gets handed:
     *
     * ```ts
     * const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });
     * const dispatcher = new WebhookDispatcher({ jobQueue });
     * jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload));
     * ```
     */
    jobQueue?: import("./jobs").JobQueue;

    /**
     * Attach collection callbacks AFTER initialization.
     *
     * Use this instead of mutating `collectionRegistry.get(slug).callbacks`.
     * Every registry normalizes its collections through `{ ...c }`, so the
     * backend registry and each driver's registry hold **separate copies** of
     * the same collection — assigning callbacks to one is invisible to the
     * driver that actually invokes them, and the hooks silently never fire.
     * This writes to all of them.
     *
     * (Assignment, not `Object.defineProperty`: the driver resolves callbacks
     * with a spread, which copies only enumerable properties, and
     * defineProperty defaults `enumerable` to false.)
     */
    setCollectionCallbacks(slug: string, callbacks: import("@rebasepro/types").CollectionCallbacks): void;

    /**
     * Deep health check that verifies database connectivity.
     * Returns latency and component status.
     */
    healthCheck(): Promise<HealthCheckResult>;

    /**
     * Graceful shutdown helper for the BaaS instance.
     * Stops the cron scheduler and closes the HTTP server, allowing
     * in-flight requests to drain within the given timeout.
     *
     * @param timeoutMs - Maximum time (ms) to wait for drain before force-exit (default: 15000).
     *                    Pass 0 to skip the force-exit timer (useful in tests).
     */
    shutdown(timeoutMs?: number): Promise<void>;
}

/**
 * Present a `DatabaseAdapter` as a `BackendBootstrapper`.
 *
 * The `config.database` convenience path — one adapter, no explicit source keys
 * — funnels through here. `adapterToBootstrapper` in `boot/driver.ts` does the
 * same job for the multi-source path, and the two stay separate because only
 * that one carries a registry id and a default flag; this path has exactly one
 * driver and needs neither.
 *
 * Extracted from the middle of `initializeRebaseBackend` so it can be tested.
 * Both wrappers rebuild the bootstrapper field by field, which means any
 * capability nobody remembers to list is dropped in silence — no type error,
 * because every one of them is optional, and no runtime error either, because
 * the caller's own fallback for "driver does not implement this" is to skip.
 * That is not hypothetical: `ensureCollectionSchema` was missing from both
 * wrappers for months, so every managed tenant booted with no collection tables
 * and 500'd on every data route. `bootstrapper-forwarding.test.ts` now asserts
 * both wrappers pass through the whole optional surface.
 */
export function wrapDatabaseAdapter(dbAdapter: DatabaseAdapter): BackendBootstrapper {
    return {
        type: dbAdapter.type,
        initializeDriver: (initConfig: unknown) =>
            dbAdapter.initializeDriver(initConfig as import("@rebasepro/types").DatabaseAdapterInitConfig),
        initializeRealtime: dbAdapter.initializeRealtime
            ? (_config: unknown, driverResult: InitializedDriver) =>
                dbAdapter.initializeRealtime!(driverResult)
            : undefined,
        initializeAuth: dbAdapter.initializeAuth,
        initializeHistory: dbAdapter.initializeHistory,
        initializeWebsockets: dbAdapter.initializeWebsockets,
        ensureCollectionSchema: dbAdapter.ensureCollectionSchema
            ? (collections, driverResult, log) =>
                dbAdapter.ensureCollectionSchema!(collections, driverResult, log)
            : undefined,
        ensureCollectionPolicies: dbAdapter.ensureCollectionPolicies
            ? (collections, driverResult, log) =>
                dbAdapter.ensureCollectionPolicies!(collections, driverResult, log)
            : undefined,
        getAdmin: dbAdapter.getAdmin,
        mountRoutes: dbAdapter.mountRoutes
    };
}

export async function initializeRebaseBackend(config: RebaseBackendConfig): Promise<RebaseBackendInstance> {
    // No try/catch: let init errors propagate to the caller.
    // The app entry point (e.g. startServer()) should catch and process.exit(1).
    // Returning a fake instance hides critical failures and leads to silent data loss.
    return await _initializeRebaseBackend(config);
}

async function _initializeRebaseBackend(config: RebaseBackendConfig): Promise<RebaseBackendInstance> {
    if (config.logging?.level) {
        configureLogLevel(config.logging.level);
    } else {
        configureLogLevel();
    }

    logger.debug("Initializing Rebase Backend");

    // One floating promise in application code — a fire-and-forget call in a
    // custom function is the usual one — otherwise ends the process, and on the
    // managed runtime that process is shared with other tenants. Log it and
    // keep serving. Idempotent, and opt-out via REBASE_EXIT_ON_UNHANDLED_REJECTION.
    installUnhandledRejectionHandler();

    const basePath = config.basePath || "/api";
    const isProduction = process.env.NODE_ENV === "production";

    // What this process serves, and what it owns. Both default to everything,
    // so a caller that passes neither boots the process this server has always
    // booted. Resolved here, before anything mounts, so every gate below reads
    // one already-decided answer rather than re-deriving it from optionals.
    const surfaces = resolveSurfaces(config.surfaces);
    const ownership = resolveOwnership(config.ownership);
    const offSurfaces = disabledSurfaces(surfaces);
    if (offSurfaces.length > 0) {
        // Said once, at info: a request answering 404 because this process was
        // never meant to serve it is indistinguishable, from the client side,
        // from a broken deployment. This line is the only thing that tells the
        // difference, so it must not be at debug.
        logger.info("Partial runtime surface — some routes are not served by this process", {
            serving: ALL_RUNTIME_SURFACES.filter(surface => surfaces[surface]),
            notServing: offSurfaces
        });
    }

    // Configure Hono middlewares (Request ID, body limit, CSRF, CORS warning, logging)
    configureMiddlewares(config.app, basePath, isProduction, config);

    const collectionRegistry = new BackendCollectionRegistry();
    // Declared data sources — drives engine resolution (capabilities) and the
    // server-vs-direct transport distinction. Set before collections register
    // so normalization can resolve each collection's engine.
    const dataSourceRegistry = createDataSourceRegistry(config.dataSources);
    collectionRegistry.setDataSources(dataSourceRegistry);

    // Global lifecycle callbacks — applied to every collection, on all data paths.
    if (config.callbacks) {
        collectionRegistry.setGlobalCallbacks(config.callbacks);
    }
    let activeCollections = config.collections || [];
    // Collections handed in directly never touch the loader, so its strict parse
    // has to be repeated here. Configs derived from the database schema below are
    // machine-generated and are deliberately not checked.
    if (activeCollections.length > 0) assertCollectionConfigs(activeCollections);
    if (config.collectionsDir && activeCollections.length === 0) {
        activeCollections = await loadCollectionsFromDirectory(config.collectionsDir);
        logger.info("Auto-discovered collections", {
            count: activeCollections.length,
            dir: config.collectionsDir
        });
    }

    // Declared collections, or the database's own schema.
    //
    // This was a `mode` flag the caller set, which could disagree with the
    // collections it was set alongside — the server then warned and threw the
    // collections away. There is no such state now: declaring collections is
    // what makes them served.
    //
    // Derived from what actually RESOLVED, not from what was configured: a
    // `collectionsDir` pointing at nothing declares nothing, and treating that
    // as "declared" would serve an empty API and never look at the database.
    const introspectCollections = activeCollections.length === 0;
    // Only the surprising branch is worth a line every boot. Serving what you
    // declared is what a developer already expects; deriving collections from
    // the database because nothing was declared is the state people debug for
    // an hour before finding out it happened.
    if (introspectCollections) {
        logger.info("No collections declared — deriving them from the database schema");
    } else {
        logger.debug("Serving declared collections");
    }

    // Directory-level `defaultSecurityRules` are applied by the collection
    // loader, so the server and `db push` agree on what a collection's rules
    // are. They cannot be set here: the generators that write the actual
    // Postgres policies never see this config.

    const realtimeServices: Record<string, RealtimeProvider> = {};
    const delegates: Record<string, DataDriver> = {};

    // ─── Resolve bootstrappers ───────────────────────────────────────────
    let bootstrappers: BackendBootstrapper[] = config.bootstrappers || [];
    if (config.database) {
        const dbAdapter = config.database;
        logger.debug("Using DatabaseAdapter", { type: dbAdapter.type });
        bootstrappers = [wrapDatabaseAdapter(dbAdapter)];
    }

    if (bootstrappers.length === 0) {
        throw new Error("No bootstrappers or database adapter provided. Cannot initialize database drivers.");
    }

    let defaultDriverId = DEFAULT_DRIVER_ID;

    let defaultDriverResult: InitializedDriver | undefined = undefined;

    // 1. Initialize all drivers
    for (const bootstrapper of bootstrappers) {
        const b = bootstrapper;
        logger.debug("Running bootstrapper for driver", { driverId: b.id || bootstrapper.type });
        if (b.isDefault) {
            defaultDriverId = b.id || bootstrapper.type;
        }

        const driverResult = await bootstrapper.initializeDriver({
            collections: activeCollections,
            collectionRegistry,
            introspectCollections,
            baas: config.baas
        });
        delegates[b.id || bootstrapper.type] = driverResult.driver;

        // In baas mode the driver reports what it found in the database.
        // `undefined` means it never looked — it has no introspection support,
        // so baas mode can only ever serve nothing. Say so at boot rather than
        // letting every request 404 against a server that claims to be healthy.
        if (introspectCollections) {
            const driverName = b.id || bootstrapper.type;
            if (!driverResult.collections) {
                throw new Error(
                    `Driver "${driverName}" cannot derive collections from the database schema, ` +
                    "and this project declared none. Declare collections, or use a driver that " +
                    "implements introspection (e.g. @rebasepro/server-postgres)."
                );
            }
            if (driverResult.collections.length === 0) {
                logger.warn(
                    `Driver "${driverName}" found no tables to serve. The data API will not be mounted. ` +
                    "Create tables (migrations, SQL, any tool) and restart."
                );
            }
        }

        // These never passed through the config-time steps above, so apply them
        // here — but only when the driver was asked to describe the schema. A
        // project that declared its own collections must not have more injected
        // into it by whatever the database happens to contain.
        if (introspectCollections && driverResult.collections?.length) {
            activeCollections = [...activeCollections, ...driverResult.collections];
        }

        if ((b.id || bootstrapper.type) === defaultDriverId || !defaultDriverResult) {
            defaultDriverResult = driverResult;
        }

        if (bootstrapper.initializeRealtime) {
            const realtime = await bootstrapper.initializeRealtime({}, driverResult);
            if (realtime) {
                realtimeServices[b.id || bootstrapper.type] = realtime;
            }
        }
    }

    const driverRegistry = DefaultDriverRegistry.create(delegates);
    activeCollections.forEach(collection => collectionRegistry.register(collection));

    const defaultDriver = driverRegistry.getOrDefault(defaultDriverId);
    if (!defaultDriver || !defaultDriverResult) {
        throw new Error("Default driver not initialized by bootstrappers");
    }
    const defaultBootstrapper = bootstrappers.find(b => b.id === defaultDriverId || b.type === defaultDriverId) || bootstrappers[0];
    const defaultRealtimeService = defaultDriverResult.realtimeProvider;

    // Resolve a collection path (e.g. "products", "authors/1/posts") to its
    // data-source key — shared by the data-driver router and the realtime
    // router. Falls back to the default key for unknown paths.
    const keyForCollectionPath = (collectionPath: string): string => {
        const slug = collectionPath.replace(/^\/+/, "").split("/")[0]?.split("?")[0];
        if (!slug) return DEFAULT_DRIVER_ID;
        const collection = collectionRegistry.get(slug) ?? collectionRegistry.getCollectionByPath(slug);
        if (!collection) return DEFAULT_DRIVER_ID;
        return resolveDataSource(collection, dataSourceRegistry).key;
    };

    // ── Data-source misconfiguration check ────────────────────────────────
    // A server-transport collection whose resolved data-source key has no
    // registered driver delegate would silently fall back to the default
    // driver — i.e. land in the wrong database. Warn loudly so this surfaces
    // at boot rather than as mysterious data going to the wrong engine.
    {
        const unresolved = new Map<string, string[]>();
        const nonRlsEngines = new Set<string>();
        for (const collection of activeCollections) {
            const ds = resolveDataSource(collection, dataSourceRegistry);
            if (ds.transport !== "server") continue; // direct/custom are client-only
            // Server engines without row-level security enforce authorization
            // only at the application layer — surface this so it isn't a
            // silent assumption. (The default Postgres engine supports RLS.)
            if (!ds.capabilities.supportsRLS) nonRlsEngines.add(ds.engine);
            if (ds.key === DEFAULT_DRIVER_ID) continue; // always maps to the default
            if (!driverRegistry.has(ds.key)) {
                const slugs = unresolved.get(ds.key) ?? [];
                slugs.push(collection.slug ?? collection.name ?? "?");
                unresolved.set(ds.key, slugs);
            }
        }
        for (const [key, slugs] of unresolved) {
            logger.warn(
                `[DataSource] No driver registered for data source "${key}" ` +
                `(used by: ${slugs.join(", ")}). These collections will fall back to the ` +
                `default driver "${defaultDriverId}" — register a bootstrapper with this id, ` +
                `or mark the data source as a direct/custom transport in \`dataSources\`.`
            );
        }
        for (const engine of nonRlsEngines) {
            logger.warn(
                `[DataSource] Engine "${engine}" does not support row-level security; ` +
                `authorization for its collections is enforced only at the application layer ` +
                `(authentication still applies). Ensure app-level checks or engine-native rules are in place.`
            );
        }
    }

    // 2. Initialize Auth & History via the default driver's bootstrapper
    let authConfigResult: BootstrappedAuth | undefined = undefined;
    let serviceKey: string | undefined;
    let authAdapter: AuthAdapter | undefined;

    if (config.auth) {
        if (isAuthAdapter(config.auth)) {
            // ── New path: User provided an AuthAdapter directly ──────────
            authAdapter = config.auth;
            serviceKey = authAdapter.serviceKey;

            if (authAdapter.initialize) {
                await authAdapter.initialize();
            }

            logger.debug("Using AuthAdapter", { id: authAdapter.id });

            // Populate authConfigResult for backward compatibility
            // (the return type still exposes `auth?: BootstrappedAuth`)
            authConfigResult = {
                userService: authAdapter.userManagement ?? {}
            };
        } else {
            // ── RebaseAuthConfig — wrap in built-in adapter ──
            const safeAuthConfig = config.auth as RebaseAuthConfig;

            // Auto-discover the auth collection from activeCollections if not explicitly set
            if (!safeAuthConfig.collection) {
                const foundAuthCollection = activeCollections.find(c => {
                    const isAuth = c.auth;
                    return isAuth === true || (isAuth && typeof isAuth === "object" && isAuth.enabled === true);
                });
                if (foundAuthCollection) {
                    safeAuthConfig.collection = foundAuthCollection;
                    logger.debug("Auto-discovered auth collection from collection definitions", { slug: foundAuthCollection.slug });
                }
            }

            // The built-in auth subsystem (users, sessions, repository) is
            // bootstrapped on the DEFAULT driver. If the auth collection is
            // routed to a non-default data source, login would read/write the
            // default engine while the collection's data views hit another —
            // a split-brain user store. Warn loudly.
            if (safeAuthConfig.collection) {
                const authDs = resolveDataSource(safeAuthConfig.collection, dataSourceRegistry);
                if (authDs.key !== DEFAULT_DRIVER_ID) {
                    logger.warn(
                        `[Auth] The auth collection "${safeAuthConfig.collection.slug}" is on data source ` +
                        `"${authDs.key}", but the built-in auth system always uses the default data source. ` +
                        `Move the auth collection to the default data source, or replace auth with an AuthAdapter ` +
                        `that manages users in "${authDs.key}".`
                    );
                }
            }

            // The auth write path does not run the collection save pipeline, on
            // purpose — say so when the collection expects otherwise.
            warnOnAuthCollectionDataCallbacks(safeAuthConfig.collection as never);

            // Extract the collection-level auth config (if `auth` is an object, not just `true`)
            const collectionAuth = safeAuthConfig.collection ? safeAuthConfig.collection.auth : undefined;
            const collectionAuthConfig = (typeof collectionAuth === "object" && collectionAuth !== null) ? collectionAuth : undefined;
            if (safeAuthConfig.jwtSecret) {
                configureJwt({
                    secret: safeAuthConfig.jwtSecret,
                    accessExpiresIn: safeAuthConfig.accessExpiresIn || "1h",
                    refreshExpiresIn: safeAuthConfig.refreshExpiresIn || "30d",
                    signingKeys: safeAuthConfig.signingKeys,
                    activeKid: safeAuthConfig.activeKid
                });
            }

            // ── Service Key Validation ───────────────────────────────────
            if (safeAuthConfig.serviceKey) {
                if (safeAuthConfig.serviceKey.length < 32) {
                    throw new Error(
                        "REBASE_SERVICE_KEY is too short. Must be at least 32 characters. " +
                        "Generate one with: node -e \"logger.info(require('crypto').randomBytes(48).toString('base64'))\""
                    );
                }
                serviceKey = safeAuthConfig.serviceKey;
                logger.debug("Service key configured for script/server-to-server authentication");
            }

            if (defaultBootstrapper.initializeAuth) {
                logger.debug("Bootstrapping authentication via driver protocol");
                authConfigResult = await defaultBootstrapper.initializeAuth(config.auth, defaultDriverResult);

                // The built-in auth adapter is created after OAuth providers
                // are resolved (below) so it only needs to be constructed once.

                logger.info("Authentication initialized");
            } else {
                logger.warn("Auth requested but default bootstrapper does not support initializeAuth");
            }
        }
    }

    let historyConfigResult: { historyService: import("./history/history-routes").HistoryService } | undefined = undefined;
    if (config.history) {
        if (defaultBootstrapper.initializeHistory) {
            logger.debug("Bootstrapping entity history via driver protocol");
            historyConfigResult = await defaultBootstrapper.initializeHistory(config.history, defaultDriverResult) as { historyService: import("./history/history-routes").HistoryService } | undefined;

            // Inject the historyService into the driver so save/delete can record history.
            // The driver was created during initializeDriver() (before history was initialized),
            // so we must set it retroactively here.
            if (historyConfigResult?.historyService && defaultDriverResult.internals) {
                const internals = defaultDriverResult.internals as Record<string, unknown>;
                const driver = internals.driver as Record<string, unknown> | undefined;
                if (driver && "historyService" in driver) {
                    driver.historyService = historyConfigResult.historyService;
                }
            }

            logger.info("Entity history initialized");
        } else {
            logger.warn("History requested but default bootstrapper does not support initializeHistory");
        }
    }

    // ─── Internal per-process credential ───────────────────────────────────
    // When the user hasn't configured a REBASE_SERVICE_KEY, generate a random
    // per-boot key so the singleton's control-plane APIs (auth, admin, storage,
    // functions) can still authenticate against the server's own middleware.
    // This key never leaves the process and is never logged.
    //
    // Resolved BEFORE route mounting so every admin surface — including the
    // adapter-created admin routes, whose middleware captures the key at
    // creation time — gates on the same key.
    const internalServiceKey = serviceKey || randomBytes(48).toString("base64");
    if (!serviceKey) {
        logger.info("No REBASE_SERVICE_KEY configured. Generated internal per-boot key for singleton control-plane APIs.");
    }

    // For user-provided AuthAdapters (the built-in one receives the key at
    // creation below): expose the internal key so the adapter and the
    // websocket auth path recognize the singleton's control-plane requests.
    if (authAdapter && !authAdapter.serviceKey) {
        authAdapter.serviceKey = internalServiceKey;
    }

    // ─── API Key Store Bootstrap ──────────────────────────────────────────
    // Bootstrapped before route mounting so `rk_` pre-auth can be registered
    // in front of every admin surface (Hono runs middleware in registration
    // order — a `use()` after `route()` would never fire for that router).
    let apiKeyStore: ApiKeyStore | undefined;
    const apiKeyStoreResult = createApiKeyStore(defaultDriver);
    if (apiKeyStoreResult) {
        apiKeyStore = apiKeyStoreResult;
        await apiKeyStore.ensureTable();
        logger.debug("Service API Keys initialized");
    }

    // Authenticates `rk_` bearer tokens in front of the JWT-based admin gates,
    // so keys created with `admin: true` genuinely reach the admin surfaces
    // (users, roles, api-keys, cron, backups, logs, schema editor) — their
    // documented behavior. Non-admin keys still fail `requireAdmin` with 403.
    const apiKeyPreAuth = apiKeyStore
        ? createApiKeyPreAuth({ store: apiKeyStore, driver: defaultDriver })
        : undefined;
    if (apiKeyPreAuth && surfaces.admin) {
        config.app.use(`${basePath}/admin/*`, apiKeyPreAuth);
    }

    if (apiKeyStore && surfaces.admin) {
        // Mount API key admin routes
        const apiKeyRoutes = createApiKeyRoutes({
            store: apiKeyStore,
            serviceKey: internalServiceKey
        });
        config.app.route(`${basePath}/admin/api-keys`, apiKeyRoutes);
        logger.debug("API key admin routes mounted", { path: `${basePath}/admin/api-keys` });
    }

    // One rate-limit store shared by the data, functions and storage limiters:
    // the budget is per caller, not per router — private stores would silently
    // multiply every caller's allowance. An operator-provided store is
    // respected as-is.
    const rateLimitConfig: DataRateLimitConfig | undefined =
        config.rateLimit?.enabled !== false
            ? {
                ...config.rateLimit,
                store: config.rateLimit?.store
                    ?? new MemoryRateLimitStore(config.rateLimit?.windowMs ?? 15 * 60 * 1000)
            }
            : undefined;

    // 3. Initialize Storage
    const { storageRegistry, storageController } = await initializeStorage(config.storage, isProduction);

    // basePath already resolved above

    // 4. Mount API Routes
    if (config.auth) {
        // ── Auth Capabilities Endpoint ───────────────────────────────────
        // Exposes adapter capabilities so the frontend knows what's available
        // (login form vs external redirect, OAuth providers, etc.)
        config.app.get(`${basePath}/auth/config`, async (c) => {
            const capabilities = await authAdapter!.getCapabilities();
            return c.json(capabilities);
        });

        if (!isAuthAdapter(config.auth)) {
            const safeAuthConfig = config.auth as RebaseAuthConfig;
            const oauthProviders: OAuthProvider<unknown>[] = [...(safeAuthConfig.providers || [])];

            // Resolve configured OAuth providers via data-driven registration.
            // Each entry maps a config key to its factory function name and required fields.
            const OAUTH_PROVIDERS: Array<{
                key: keyof RebaseAuthConfig;
                factory: string;
                requiredFields: string[];
            }> = [
                { key: "google", factory: "createGoogleProvider", requiredFields: ["clientId"] },
                { key: "linkedin", factory: "createLinkedinProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "github", factory: "createGitHubProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "microsoft", factory: "createMicrosoftProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "apple", factory: "createAppleProvider", requiredFields: ["clientId", "teamId", "keyId", "privateKey"] },
                { key: "facebook", factory: "createFacebookProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "twitter", factory: "createTwitterProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "discord", factory: "createDiscordProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "gitlab", factory: "createGitLabProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "bitbucket", factory: "createBitbucketProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "slack", factory: "createSlackProvider", requiredFields: ["clientId", "clientSecret"] },
                { key: "spotify", factory: "createSpotifyProvider", requiredFields: ["clientId", "clientSecret"] }
            ];

            for (const { key, factory, requiredFields } of OAUTH_PROVIDERS) {
                const providerConfig = safeAuthConfig[key] as Record<string, unknown> | undefined;
                if (providerConfig && requiredFields.every(f => Boolean(providerConfig[f]))) {
                    const authModule = await import("./auth");
                    const createFn = (authModule as unknown as Record<string, (cfg: unknown) => OAuthProvider<unknown>>)[factory];
                    oauthProviders.push(createFn(providerConfig));
                }
            }

            // Re-create the built-in adapter with all resolved OAuth providers
            const reCollectionAuth = safeAuthConfig.collection ? safeAuthConfig.collection.auth : undefined;
            const collectionAuthConfig = (typeof reCollectionAuth === "object" && reCollectionAuth !== null) ? reCollectionAuth : undefined;
            authAdapter = createBuiltinAuthAdapter({
                authRepository: authConfigResult!.authRepository as import("./auth/interfaces").AuthRepository ?? authConfigResult!.userService as import("./auth/interfaces").AuthRepository,
                emailService: authConfigResult!.emailService as import("./email").EmailService,
                emailConfig: safeAuthConfig.email,
                allowRegistration: safeAuthConfig.allowRegistration ?? false,
                disableSelfRegistration: safeAuthConfig.disableSelfRegistration ?? false,
                allowAnonymous: safeAuthConfig.allowAnonymous ?? false,
                allowUserLookup: safeAuthConfig.allowUserLookup ?? false,
                defaultRole: safeAuthConfig.defaultRole,
                oauthProviders,
                allowedRedirectUris: safeAuthConfig.allowedRedirectUris,
                // The internal per-boot fallback is included so the closure the
                // adapter's routes capture recognizes the singleton's own
                // control-plane requests even without a configured key.
                serviceKey: serviceKey || internalServiceKey,
                authHooks: safeAuthConfig.hooks,
                collectionAuthConfig,
                enableMagicLink: safeAuthConfig.magicLink ?? false,
                cookieAuth: safeAuthConfig.cookieAuth
            });

            if (safeAuthConfig.cookieAuth) {
                if (!isProduction && !process.env.CORS_ORIGINS && !process.env.FRONTEND_URL) {
                    logger.warn(
                        "[Auth] Cookie authentication (cookieAuth) is enabled, but no CORS restrictions are detected. " +
                        "Browser-based clients will require credentials: 'include' and the server MUST NOT use " +
                        "Access-Control-Allow-Origin: '*'. Ensure CORS_ORIGINS is set to your frontend URL."
                    );
                }
            }
        }

        // ── Mount auth & admin routes via the adapter ────────────────────
        if (authAdapter && authAdapter.createAuthRoutes && surfaces.auth) {
            const authRoutes = authAdapter.createAuthRoutes();
            if (authRoutes) {
                config.app.route(`${basePath}/auth`, authRoutes);
                logger.debug("Auth routes mounted via adapter", { adapter: authAdapter.id });
            }
        }

        if (authAdapter && authAdapter.createAdminRoutes && surfaces.admin) {
            const adminRoutes = authAdapter.createAdminRoutes();
            if (adminRoutes) {
                config.app.route(`${basePath}/admin`, adminRoutes);
                logger.debug("Admin routes mounted via adapter", { adapter: authAdapter.id });
            }
        }
    }

    // ── JWKS ─────────────────────────────────────────────────────────────
    // At the root, not under `basePath`: `/.well-known/` is where verifiers
    // look. Mounted whenever this backend mints its own tokens, and answering
    // an empty key set when none are asymmetric — "this issuer publishes no
    // public keys" is a fact a verifier can act on, where a 404 is
    // indistinguishable from a wrong URL.
    // Gated with the auth surface: a process that does not issue tokens has no
    // key set to publish, and serving an empty one from a functions-only
    // replica would tell a verifier the issuer has no public keys.
    if (isJwtConfigured() && surfaces.auth) {
        config.app.route("/.well-known", createJwksRoutes());
        if (hasAsymmetricSigningKey()) {
            logger.info("Access tokens are signed asymmetrically; public keys at /.well-known/jwks.json");
        }
    }

    // ─── Shared gate for admin-only surfaces ──────────────────────────────
    // Cron, backups, logs, and the schema editor previously gated on the
    // plain JWT-only `requireAuth`, which silently rejected both the service
    // key and admin API keys while other admin surfaces accepted them. One
    // gate, same acceptance everywhere: `rk_` admin keys (via pre-auth), the
    // service key, and admin JWTs.
    // Whether admin surfaces get a gate at all — global for this boot, so
    // computed once rather than per router.
    //
    // Deliberately NOT conditioned on `requireAuth`. That flag answers a
    // question about the *data plane* — "must a caller present a token to read
    // /api/data, or does RLS alone decide?" — and `false` is the answer this
    // very file recommends to anyone serving a public website from their own
    // backend (see the `publicSelect` notice below). Reusing it here meant
    // taking that advice silently unmounted the gate on the cron trigger, the
    // log reader and the backup routes: one flag deciding two unrelated things,
    // where the harmless-looking value of one is catastrophic for the other.
    // Whether anonymous callers may read your posts has no bearing on whether
    // they may run your cron jobs. If auth exists at all, admin surfaces use it.
    const adminSurfacesGated = !!authAdapter && (
        isAuthAdapter(config.auth!) || !!(config.auth as RebaseAuthConfig).jwtSecret
    );
    const applyAdminGate = (router: Hono<HonoEnv>, surface: string): void => {
        if (!adminSurfacesGated) {
            // No adapter and no `jwtSecret`: there is no credential this server
            // could check a caller against, so it cannot tell an admin from the
            // internet. These surfaces used to mount anyway, open, with this
            // warning as their only defence — which is to say they served the
            // cron trigger and the log reader to anyone, and told nobody but
            // whoever was reading stdout at boot.
            //
            // They answer 501 instead, and stay mounted to say why: an
            // unexplained 404 on `/api/cron` reads as a broken path or a failed
            // deploy, and gets debugged as one.
            logger.warn(
                `${surface} routes are mounted but DISABLED: no authentication is configured ` +
                "(no auth adapter and no auth.jwtSecret), so there is no way to tell an admin " +
                "from an anonymous caller. They answer 501 until auth is configured."
            );
            router.use("/*", async (c) => c.json({
                error: {
                    code: "ADMIN_SURFACE_UNAVAILABLE",
                    message: `${surface} is admin-only, and this server has no authentication ` +
                        "configured to identify an admin with. Set auth.jwtSecret (or pass an " +
                        "AuthAdapter) to enable it."
                }
            }, 501));
            return;
        }
        if (apiKeyPreAuth) router.use("/*", apiKeyPreAuth);
        router.use("/*", createRequireAuth({ serviceKey: internalServiceKey }), requireAdmin);
    };

    // The schema editor rewrites collection files, so it needs a collectionsDir
    // to write to and is off in baas mode (no files) and in production.
    const schemaEditorEnabled =
        config.schemaEditor ?? (!!config.collectionsDir && !introspectCollections && process.env.NODE_ENV !== "production");

    /**
     * Why the editor is off, in the words the person staring at a greyed-out
     * "Add collection" button needs.
     *
     * The admin panel used to decide whether collections were editable from
     * its *own* build mode — `process.env.NODE_ENV` inside the browser bundle.
     * That is a different process from the one that decides whether the routes
     * exist, and the two disagree constantly: a dev frontend against a
     * deployed API, a `baas`-mode project, a project with no `collectionsDir`,
     * a server without `ts-morph`. In every one of those the editor offered
     * itself and each save came back as a bare 404. So the server says whether
     * it can write, and says why not, and the client asks instead of guessing.
     */
    const schemaEditorUnavailable = (): { code: string, message: string } | undefined => {
        if (config.schemaEditor === false) return {
            code: "SCHEMA_EDITOR_DISABLED",
            message: "The schema editor is turned off for this server (`schemaEditor: false`)."
        };
        if (!config.collectionsDir) return {
            code: "SCHEMA_EDITOR_NO_COLLECTIONS_DIR",
            message: "This server has no `collectionsDir`, so the schema editor has no collection files to write to."
        };
        if (schemaEditorEnabled) return undefined;
        if (introspectCollections) return {
            code: "SCHEMA_EDITOR_BAAS_MODE",
            message: "Collections are introspected from the database on this server, so there are no " +
                "collection source files to edit. Change the schema with a migration instead."
        };
        if (process.env.NODE_ENV === "production") return {
            code: "SCHEMA_EDITOR_PRODUCTION",
            message: "The schema editor is off under NODE_ENV=production: it edits collection source " +
                "files, and a deployed server's files are rebuilt from your repository on every " +
                "deploy, so an edit here would be discarded. Edit collections in development and deploy."
        };
        return {
            code: "SCHEMA_EDITOR_DISABLED",
            message: "The schema editor is not enabled on this server."
        };
    };

    if (schemaEditorEnabled && !config.collectionsDir) {
        logger.warn("schemaEditor is enabled but no collectionsDir is set — the schema editor has nowhere to write. Skipping.");
    }

    let schemaEditorOff = schemaEditorUnavailable();
    let schemaEditorRoutes: Hono<HonoEnv> | undefined;

    if (!schemaEditorOff && config.collectionsDir) {
        // ts-morph is an optional peer dependency, so it can legitimately be
        // absent — run without the schema editor instead of failing startup.
        try {
            const editorModule = await import("./api/schema-editor-routes");
            schemaEditorRoutes = editorModule.createSchemaEditorRoutes(config.collectionsDir);
        } catch (err) {
            if ((err as { code?: string })?.code === "ERR_MODULE_NOT_FOUND") {
                schemaEditorOff = {
                    code: "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                    message: "The schema editor needs `ts-morph`, which is not installed on this server. " +
                        // `pnpm`, not `npm`: a Rebase project is a pnpm workspace, and
                        // running npm inside one rewrites node_modules into a hoisted
                        // layout that pnpm then disagrees with. Advice that damages the
                        // project is worse than no advice — see docs/bug-classes.md §5.
                        "Run `pnpm add -D ts-morph@28.0.0` to enable it."
                };
                logger.warn(`Schema Editor disabled: ${schemaEditorOff.message}`);
            } else {
                throw err;
            }
        }
    }

    if (surfaces.admin) {
        // Gate a *fresh* router, then mount the routes into it. Hono collects
        // matching handlers in registration order, so a `use("/*")` appended to
        // an already-populated router runs after the handler it was meant to
        // guard — which is to say never, because the handler has already
        // answered. Gating `createSchemaEditorRoutes()`'s return value did
        // exactly that, leaving `POST /api/schema-editor/collection/save`
        // reachable with no credentials at all: unauthenticated rewrites of the
        // project's collection source on any reachable dev server. Every other
        // admin surface here already builds the router, gates it, and *then*
        // routes into it; this one is now the same shape.
        const schemaEditorRouter = new Hono<HonoEnv>();

        applyAdminGate(schemaEditorRouter, "Schema editor");

        schemaEditorRouter.get("/status", (c) => c.json(
            schemaEditorOff
                ? { enabled: false, reason: schemaEditorOff.message, code: schemaEditorOff.code }
                : { enabled: true }
        ));

        if (schemaEditorRoutes) {
            schemaEditorRouter.route("/", schemaEditorRoutes);
        } else {
            // Mounted-but-refusing, like the other admin surfaces: an
            // unexplained 404 on a route the UI just called reads as a broken
            // deploy and gets debugged as one.
            schemaEditorRouter.all("/*", (c) => c.json({
                error: {
                    code: schemaEditorOff!.code,
                    message: schemaEditorOff!.message
                }
            }, 501));
        }

        config.app.route(`${basePath}/schema-editor`, schemaEditorRouter);
        if (schemaEditorRoutes) {
            logger.debug("Schema Editor mounted", { path: `${basePath}/schema-editor` });
        } else {
            logger.debug("Schema Editor unavailable", {
                path: `${basePath}/schema-editor`,
                code: schemaEditorOff!.code
            });
        }
    }

    // Filled in once the native data plane exists (below). The storage
    // authorize hook needs trusted reads to answer "who owns this object?", and
    // it cannot import the server itself — it is declared in the project's
    // config package, which depends on `@rebasepro/types` alone.
    const storageAuthorizeData: { current?: import("@rebasepro/types").StorageAuthorizeData } = {};

    if (storageController) {
        // Storage uploads get their own body limit, derived from the storage config's
        // maxFileSize (default 50MB), which overrides the global API body limit.
        const storageMaxSize = (
            config.storage && typeof config.storage === "object" && "type" in config.storage
                ? (config.storage as BackendStorageConfig).maxFileSize
                : undefined
        ) ?? 50 * 1024 * 1024;

        // Storage is not under RLS and its keys share one flat namespace, so an
        // allow-all default is a cross-user read/write/delete hole. Refuse to
        // boot in production unless the deployment has stated an access-control
        // intent (a hook, public-read, or the explicit insecure opt-out); warn
        // loudly in development.
        assertStorageAccessControlConfigured(
            {
                hasAuthorize: !!config.storageAuthorize,
                publicRead: config.storagePublicRead === true,
                allowAnyAuthenticated: config.storageInsecureAllowAnyAuthenticated === true
            },
            isProduction
        );

        const storageRoutes = createStorageRoutes({
            controller: storageController,
            registry: storageRegistry,
            sources: config.storageSources,
            requireAuth: resolveRequireAuth(config.auth),
            publicRead: config.storagePublicRead === true,
            authAdapter,
            authorize: config.storageAuthorize,
            // Resolved lazily: the admin data plane is built further down, well
            // after these routes are mounted, but always before a request runs.
            authorizeData: () => storageAuthorizeData.current
        });

        // Wrapper router: middleware must be registered BEFORE the routes it
        // guards — Hono composes handlers in registration order, so a `use()`
        // issued after `createStorageRoutes()` has registered its handlers
        // sits deeper than them and never runs. The previous
        // `storageRoutes.use("/upload", bodyLimit)` was exactly that: dead
        // code, leaving uploads without any size cap.
        const storageRouter = new Hono<HonoEnv>();

        // API keys on storage: authenticate `rk_` tokens, then require a
        // "storage" (or "*") permission entry for the derived operation.
        if (apiKeyPreAuth) {
            storageRouter.use("/*", apiKeyPreAuth, createStorageApiKeyGuard());
        }

        // Storage shares the data/functions limiter and its store, so a caller
        // has one budget across the product rather than one per router.
        //
        // This surface was the one left without any limiter, and it is the one
        // where a single request buys a metered third-party operation: PutObject,
        // GetObject and its egress, ListObjectsV2. With `storagePublicRead: true`
        // — a documented, ordinary setting — `readAuthMiddleware` resolves to a
        // no-op and `GET /file/*` is anonymous, so one machine looping over a
        // large public object was unbounded egress billed a month later.
        //
        // Registered after the API-key guard so a key's identity is already on
        // the context and the limiter buckets by caller rather than by IP, and
        // before `route("/")` for the ordering reason the comment above records.
        if (rateLimitConfig) {
            storageRouter.use("/*", createDataRateLimiter(rateLimitConfig));
        }

        // Apply a permissive body limit specifically for the upload endpoint
        storageRouter.use("/upload", bodyLimit({
            maxSize: storageMaxSize,
            onError: (c) => {
                return c.json({
                    error: {
                        message: `File too large. Maximum upload size is ${Math.round(storageMaxSize / 1024 / 1024)}MB.`,
                        code: "PAYLOAD_TOO_LARGE"
                    }
                }, 413);
            }
        }));

        storageRouter.route("/", storageRoutes);
        // Only the HTTP surface is optional. The controller, the registry and
        // the access-control boot guard above are not: a process that serves no
        // storage routes still hands `rebase.storage` to every function it runs.
        if (surfaces.storage) config.app.route(`${basePath}/storage`, storageRouter);
    } else {
        // No storage backend: say so, instead of 404ing as if the route were a
        // typo. A bare 404 reads as "wrong URL" and sends people debugging
        // their client; this names the actual state of the deployment.
        //
        // 501, not 503: this is permanent until someone configures a bucket,
        // and the client's offline queue retries 503 forever (see
        // RETRYABLE_STATUSES in @rebasepro/client), which would silently pile
        // up uploads that can never land.
        const storageStub = new Hono<HonoEnv>();
        storageStub.all("/*", (c) => c.json({
            error: {
                message: "File storage is not configured on this deployment, so uploads and " +
                    "downloads are disabled. Configure a storage backend (STORAGE_TYPE=s3 or " +
                    "STORAGE_TYPE=gcs plus its bucket and credentials) and redeploy.",
                code: "STORAGE_NOT_CONFIGURED"
            }
        }, 501));
        if (surfaces.storage) {
            config.app.route(`${basePath}/storage`, storageStub);
            logger.info("Storage not configured — /storage returns 501 STORAGE_NOT_CONFIGURED");
        }
    }

    // Only the server-mediated collections get a backend surface. Collections
    // on a direct/custom transport are client-only — the backend must not
    // expose a (mis-engined) endpoint for them, nor *document* one: the routes
    // were filtered and the OpenAPI document was not, so the one collection the
    // backend deliberately refuses to serve was the one it advertised hardest.
    const serverCollections = activeCollections.filter(
        (collection) => resolveDataSource(collection, dataSourceRegistry).transport === "server"
    );

    if (activeCollections.length > 0) {
        const dataRouter = new Hono<HonoEnv>();
        dataRouter.onError(errorHandler);

        // Secure by default: require auth when auth is configured.
        // Developers who intentionally want public data access (relying
        // entirely on Postgres RLS) must explicitly set `auth.requireAuth: false`.
        const dataRequireAuth = resolveRequireAuth(config.auth);

        if (!dataRequireAuth) {
            logger.warn(
                "Data routes running WITHOUT authentication enforcement. " +
                "Access control is fully delegated to Postgres RLS policies. " +
                "If no RLS policies exist, data is publicly accessible. " +
                "Set auth.requireAuth to true (or remove it) to require authentication."
            );
        } else {
            // The other half of the same decision, and the one nobody sees.
            //
            // `{ operation: "select", access: "public" }` means "no row filter",
            // not "no login" — the API gate still answers 401 to a caller with no
            // token, whatever RLS would have allowed. Read on its own, a 401 from
            // a collection the author called public looks like broken RLS or a
            // missing table, and gets debugged as one (it has been). Say it once
            // at boot, where the operator is already reading, naming the switch.
            const publicSelect = activeCollections
                .filter(c => getEffectiveSecurityRules(c).some(rule =>
                    "access" in rule && rule.access === "public" &&
                    (rule.operation === "select" || rule.operation === "all" ||
                        (Array.isArray(rule.operations) && rule.operations.includes("select")))
                ))
                .map(c => c.slug);

            if (publicSelect.length > 0) {
                // One line, not the paragraph this used to be.
                //
                // The explanation is right and worth having somewhere; it was
                // 90 words of documentation printed on every single boot,
                // which is how a log trains people to stop reading it. The
                // sentence below carries the fact (public rows still need a
                // token) and the switch (AUTH_REQUIRE); the reasoning lives in
                // the docs, at the link, where it can be read once. The full
                // text stays reachable at `debug`.
                logger.info(
                    `${publicSelect.length} collection(s) grant unfiltered reads (${publicSelect.join(", ")}) — ` +
                    "reads still require a token. Set AUTH_REQUIRE=false to let RLS alone decide: " +
                    "https://rebase.pro/docs/collections/security-rules"
                );
                logger.debug(
                    "`access: \"public\"` widens which ROWS a caller sees, not who may call, so an " +
                    "unauthenticated read of a public collection answers 401 rather than returning rows. " +
                    "Setting AUTH_REQUIRE=false (or `auth.requireAuth: false`) removes the API-level gate " +
                    "and delegates the decision entirely to the Postgres RLS policies — the usual choice " +
                    "for a public website reading its own backend."
                );
            }
        }

        // Multi-data-source routing: when more than one database engine is
        // registered (e.g. Postgres + MongoDB in one instance), resolve the
        // delegate per request from the request's collection data source. The
        // auth middleware then scopes that delegate (RLS for Postgres, no-op
        // for engines without `withAuth()`) into the request context. For a
        // single-engine backend this is omitted — behaviour is unchanged.
        const dataPathMarker = `${basePath}/data/`;
        const resolveRequestDriver = (reqPath: string): DataDriver => {
            const i = reqPath.indexOf(dataPathMarker);
            const collectionPath = i >= 0 ? reqPath.slice(i + dataPathMarker.length) : reqPath;
            const key = keyForCollectionPath(collectionPath);
            // Use the authoritative default for the default key; otherwise the
            // named delegate, falling back to default if it isn't registered.
            if (!key || key === DEFAULT_DRIVER_ID) return defaultDriver;
            return driverRegistry.get(key) ?? defaultDriver;
        };
        const multiEngine = bootstrappers.length > 1;
        const resolveDriver = multiEngine ? ((c: { req: { path: string } }) => resolveRequestDriver(c.req.path)) : undefined;

        // Use adapter middleware when an AuthAdapter is available,
        // falling back to the built-in JWT middleware otherwise.
        if (authAdapter) {
            dataRouter.use("/*", createAdapterAuthMiddleware({
                adapter: authAdapter,
                driver: defaultDriver,
                resolveDriver,
                requireAuth: dataRequireAuth,
                apiKeyStore
            }));
        } else {
            dataRouter.use("/*", createAuthMiddleware({
                driver: defaultDriver,
                resolveDriver,
                requireAuth: dataRequireAuth,
                serviceKey: internalServiceKey,
                apiKeyStore
            }));
        }

        // Rate limiting, per caller: API key, else signed-in user, else IP.
        // Not gated on `apiKeyStore` any more — that made the limiter's
        // presence depend on a feature it does not need, so a deployment
        // without API keys had no limit at all on its data API.
        if (rateLimitConfig) {
            dataRouter.use("/*", createDataRateLimiter(rateLimitConfig));
        }

        // Mount history routes BEFORE the REST API subcollection catch-all so
        // that /:slug/:id/history is matched by the dedicated handler first.
        if (historyConfigResult && historyConfigResult.historyService) {
            const historyRoutes = createHistoryRoutes({
                historyService: historyConfigResult.historyService,
                registry: collectionRegistry,
                driver: defaultDriver
            });
            dataRouter.route("/", historyRoutes);
        }

        const restGenerator = new RestApiGenerator(
            serverCollections,
            defaultDriver,
            authAdapter
        );
        dataRouter.route("/", restGenerator.generateRoutes());

        // As with storage: the registry, the generator and the driver wiring are
        // built either way, because the singleton's data plane and every custom
        // function read through them. Only the HTTP mount is conditional.
        if (surfaces.data) config.app.route(`${basePath}/data`, dataRouter);
    }

    // ── OpenAPI / Swagger ─────────────────────────────────────────────────
    // Follows the data surface: the document describes the collection routes, so
    // a process that does not serve them would publish a spec for URLs it 404s.
    if (surfaces.data) {
        await mountOpenApiDocs(config.app, basePath, config.enableSwagger, serverCollections, resolveRequireAuth(config.auth));
    }

    // ─── Server-side singleton ────────────────────────────────────────────
    // Build the RebaseClient for control-plane APIs (auth, admin, storage,
    // functions, cron). These still route through the Hono app because they
    // genuinely need route dispatch + middleware.
    // `rebase.data` is replaced below with a native driver-backed data plane.
    const serverClient = createRebaseClient({
        baseUrl: "http://localhost",
        apiPath: basePath,
        // `realtime: false`, not `websocketUrl: ""`.
        //
        // Both leave the client without a socket, but only one of them says so.
        // The empty string reached `options.websocketUrl ?? derive(baseUrl)`,
        // which `??` passes through unchanged, and the client then reported
        // "Realtime is enabled but no WebSocket URL could be derived from
        // baseUrl \"http://localhost\" … pass `realtime: false` to say this was
        // intended" — on every boot, a framework telling its own operator to
        // fix the framework's construction of its own client. This singleton
        // dispatches control-plane calls straight into the Hono app; there is
        // no socket for it to open and never was.
        realtime: false,
        token: internalServiceKey,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            return await config.app.request(input as string | Request | URL, init);
        }
    });

    // ─── Native data plane ────────────────────────────────────────────────
    // Replace the HTTP-transport data layer with a driver-backed RebaseData.
    // This eliminates JSON serialize → Hono dispatch → auth → deserialize for
    // every rebase.data call. RLS semantics are preserved: the driver is scoped
    // once as SERVICE_IDENTITY, matching the identity the service-key HTTP path
    // produced.
    //
    // "Preserved" is the operative word, and it is what the docblocks on this
    // accessor used to deny: `dataAsAdmin` is admin-scoped, NOT RLS-bypassing.
    // See SERVICE_IDENTITY for what that costs you (`policy.serverContext()` is
    // false for it) and `rebase.sql()` for the accessor that really does bypass.
    const serviceIdentity = SERVICE_IDENTITY;

    const scopedDefaultDriver = await scopeDataDriver(defaultDriver, serviceIdentity);
    const defaultData = buildSdkData(scopedDefaultDriver);

    // Hand the storage authorize hook its trusted reader. Scoped as the service
    // identity, so an ownership lookup is not itself filtered by the caller's
    // permissions — the hook IS the permission decision.
    storageAuthorizeData.current = defaultData as unknown as import("@rebasepro/types").StorageAuthorizeData;

    // Multi-engine: scope and wrap each non-default delegate so
    // rebase.data on a non-default-engine collection reaches the correct driver.
    const dataSourcesByKey: Record<string, import("@rebasepro/types").RebaseSdkData> = {};
    for (const driverKey of driverRegistry.list()) {
        if (driverKey === DEFAULT_DRIVER_ID) continue;
        const delegate = driverRegistry.get(driverKey);
        if (!delegate) continue;
        const scopedDelegate = await scopeDataDriver(delegate, serviceIdentity);
        dataSourcesByKey[driverKey] = buildSdkData(scopedDelegate);
    }

    const serverData = buildRoutedRebaseData({
        defaultData,
        sources: dataSourcesByKey,
        resolveKey: (slugOrPath: string) => keyForCollectionPath(slugOrPath)
    });

    // Overwrite the HTTP-transport data proxy with the native driver-backed one.
    // The rest of the client (auth, admin, cron, functions, storage) keeps using
    // the HTTP transport, which is fine — they are low-frequency control-plane ops.
    //
    // `dataAsAdmin` is the admin accessor, and the only one `RebaseServerClient`
    // declares — `data` is `Omit`ted from the type so the privilege has to be
    // named at the call site.
    //
    // It is still assigned here on purpose. `createRebaseClient` above already
    // put an HTTP-transport `data` on this object, so *not* overwriting it would
    // leave `rebase.data` working in plain JS while quietly routing through the
    // loop this native plane exists to skip — a silent performance and identity
    // change instead of the compile error TypeScript now gives. Both names point
    // at the same admin-scoped object — admin-scoped, not RLS-bypassing.
    Object.assign(serverClient, { data: serverData, dataAsAdmin: serverData });
    logger.debug("Native data plane attached to singleton (bypasses HTTP loop)");

    // Same treatment for storage: server-side `rebase.storage` must talk to the
    // controller directly, not loop back through `POST /api/storage/upload`. The
    // loopback carried the service key but still 403'd (the storage route's auth
    // is written for real user/session requests, not the internal self-call), so
    // every backend-initiated write — e.g. the deploy build-context upload —
    // failed at ~2ms with "Request failed with status 403". The controller
    // exposes the same StorageSource surface (putObject/getObject/…).
    if (storageController) {
        Object.assign(serverClient, { storage: storageController });
        logger.debug("Native storage attached to singleton (bypasses HTTP loop)");
    }

    // Attach email service to the server client when configured.
    // The email service may come from the auth bootstrapper or from the auth config directly.
    let emailService: EmailService | undefined;
    if (authConfigResult?.emailService) {
        emailService = authConfigResult.emailService as EmailService;
    } else if (config.auth && !isAuthAdapter(config.auth) && (config.auth as RebaseAuthConfig).email) {
        emailService = createEmailService((config.auth as RebaseAuthConfig).email!);
    }

    if (emailService) {
        Object.assign(serverClient, { email: emailService });
        logger.debug("Email service attached to singleton", { configured: emailService.isConfigured() });

        if (emailService.isConfigured() && typeof emailService.verifyConnection === "function") {
            emailService.verifyConnection().then((success) => {
                if (!success) {
                    logger.warn("Warning: SMTP connection verification failed. Email delivery may fail.");
                } else {
                    logger.debug("SMTP connection verified successfully.");
                }
            }).catch((err) => {
                logger.warn("Warning: SMTP connection verification failed. Email delivery may fail.", { error: err });
            });
        }
    }

    // Attach raw SQL capability when the driver supports it (Postgres, MySQL).
    // Document databases (MongoDB, Firestore) won't have this.
    const driverAdmin = defaultBootstrapper.getAdmin?.(defaultDriverResult);
    if (isSQLAdmin(driverAdmin)) {
        Object.assign(serverClient, {
            sql: (query: string, options?: { database?: string; role?: string; params?: unknown[] }) =>
                driverAdmin.executeSql(query, options)
        });
        logger.debug("SQL capability attached to singleton");
    }

    // The server client is assembled dynamically above (native data plane,
    // dataAsAdmin, email, sql attached via Object.assign), so TS can't see the
    // full RebaseServerClient shape statically — assert once, here.
    //
    // Named rather than cast inline because there are two consumers, and while
    // each cast separately they could disagree about what they were receiving:
    // the cron scheduler took a `RebaseClient`, which re-exposed the `data`
    // alias that `RebaseServerClient` deliberately omits so the RLS-bypassing
    // plane has exactly one name. Both now take this value, so "the singleton"
    // means one type in one place.
    const serverSingleton = serverClient as unknown as import("@rebasepro/types").RebaseServerClient;
    _initRebase(serverSingleton);
    logger.debug("Rebase singleton initialized");

    // Retroactively inject the server client into the driver so that
    // entity callbacks receive `context.client` at runtime.
    // The driver is created before the client (which depends on the mounted
    // Hono app), so we set it here, mirroring the historyService injection above.
    if (defaultDriverResult.internals) {
        const internals = defaultDriverResult.internals as Record<string, unknown>;
        const driver = internals.driver as Record<string, unknown> | undefined;
        if (driver && "client" in driver) {
            driver.client = serverClient;
        }
    }

    // 5. Mount Custom Functions
    //
    // Gated on the surface before the loader runs, not after: importing a
    // project's function modules has side effects the author chose (a client
    // constructed at module scope, a connection opened), and a process that will
    // never serve them should not be paying for or triggering any of it.
    if (config.functionsDir && surfaces.functions) {
        const { loadFunctionsWithDiagnostics } = await import("./functions/function-loader");
        const { createFunctionRoutes } = await import("./functions/function-routes");
        const { createFunctionsRequestTimeout, resolveFunctionsTimeoutMs } = await import("./functions/request-timeout");

        const { functions: loadedFunctions, problems } = await loadFunctionsWithDiagnostics(config.functionsDir);

        // Mounted for the directory, not for the functions in it — the same
        // correction the cron router carries ninety lines down, which was never
        // swept back here. Three function files that all `import` a module
        // throwing on a missing env var is one deploy, not three bugs: every
        // import failed, the list came back empty, `/api/functions` 404ed, and
        // `rebase cloud debug` read that 404 as "this build shipped no
        // functions". An empty list is the honest answer and a debuggable one.
        const functionsRouter = new Hono<HonoEnv>();
        functionsRouter.onError(errorHandler);

        // A ceiling on how long one function request may hold a socket and a
        // request object. First in the chain on purpose: it covers the auth
        // middleware too, so a wedged driver answers 504 rather than hanging.
        const functionsTimeoutMs = resolveFunctionsTimeoutMs(config.functionsTimeoutMs);
        if (functionsTimeoutMs > 0) {
            functionsRouter.use("/*", createFunctionsRequestTimeout(functionsTimeoutMs));
        }

        // Custom functions do NOT require authentication at the global level by default.
        // This allows custom functions to define public endpoints (like webhooks).
        // Per-route auth can be further refined inside individual functions using `requireAuth`.
        const functionsRequireAuth = false;

        // Use adapter middleware when available, fallback to built-in
        if (authAdapter) {
            functionsRouter.use("/*", createAdapterAuthMiddleware({
                adapter: authAdapter,
                driver: defaultDriver,
                requireAuth: functionsRequireAuth,
                apiKeyStore
            }));
        } else {
            functionsRouter.use("/*", createAuthMiddleware({
                driver: defaultDriver,
                requireAuth: functionsRequireAuth,
                serviceKey: internalServiceKey,
                apiKeyStore
            }));
        }

        // API-key requests must hold a "functions"/"functions/<name>"
        // permission (or the "*" wildcard). Without this, any valid key —
        // however narrowly scoped — could invoke every custom function.
        functionsRouter.use("/*", createFunctionApiKeyGuard(`${basePath}/functions`));

        // Same per-caller rate limiting as the data API, sharing its
        // store so one caller has one budget. Previously only /api/data
        // was limited, so a key's rate_limit did not bound its function
        // traffic at all.
        //
        // The anonymous bucket gets its own, much looser allowance rather than
        // being switched off: functions default to public access precisely for
        // webhook receivers (Stripe, GitHub), whose bursts come from a handful
        // of provider IPs and would trip the data API's 300/window cap. That
        // argument bounds the value, not the existence of a limit — and this is
        // the one router that invites anonymous callers, so it is the last one
        // that should have no ceiling. `rateLimit.anonymousFunctions` overrides
        // it; `null` disables it, deliberately.
        if (rateLimitConfig) {
            functionsRouter.use("/*", createDataRateLimiter({
                ...rateLimitConfig,
                anonymous: rateLimitConfig.anonymousFunctions !== undefined
                    ? rateLimitConfig.anonymousFunctions
                    : DEFAULT_FUNCTIONS_ANONYMOUS_LIMIT
            }));
        }

        const fnRoutes = createFunctionRoutes(loadedFunctions, problems.length);
        functionsRouter.route("/", fnRoutes);
        config.app.route(`${basePath}/functions`, functionsRouter);

        if (loadedFunctions.length > 0) {
            logger.info("Mounted custom functions", {
                count: loadedFunctions.length,
                path: `${basePath}/functions`,
                timeoutMs: functionsTimeoutMs
            });
        } else {
            logger.warn(
                `Function routes mounted at ${basePath}/functions, but no functions loaded from ${config.functionsDir}. ` +
                (problems.length > 0
                    ? `${problems.length} file(s) were skipped — see the messages above.`
                    : "The directory holds no .ts/.js function files.")
            );
        }
    }

    // 6. Mount Cron Jobs
    let cronScheduler: import("./cron").CronScheduler | undefined;
    if (config.cronsDir) {
        const { loadCronJobsWithDiagnostics } = await import("./cron/cron-loader");
        const { CronScheduler } = await import("./cron/cron-scheduler");
        const { createCronRoutes } = await import("./cron/cron-routes");
        const { createCronStore } = await import("./cron/cron-store");

        const { jobs: loadedCronJobs, problems: cronProblems } =
            await loadCronJobsWithDiagnostics(config.cronsDir);

        cronScheduler = new CronScheduler();

        // The cron scheduler gets the singleton itself, so `ctx.rebase` inside a
        // cron handler IS the `rebase` you would import — same object, same type,
        // same `dataAsAdmin` spelling for the admin-scoped plane.
        cronScheduler.setClient(serverSingleton);

        if (loadedCronJobs.length > 0) {
            cronScheduler.registerJobs(loadedCronJobs);

            // Attach database persistence if the driver supports SQL and persistence is enabled
            const admin = defaultBootstrapper.getAdmin?.(defaultDriverResult);
            const store = (admin && config.cronPersistence !== false) ? createCronStore(defaultDriver) : undefined;
            if (store) {
                await store.ensureTable();
                cronScheduler.setStore(store);
            }
        }

        // Mounted for the directory, not for the jobs in it. Mounting only when
        // something loaded meant a single unparseable file — a syntax error, an
        // import that throws, a module the loader could not read — took the
        // whole cron surface with it: `/api/cron` 404ed, the Studio panel broke,
        // and the only trace was one line in the boot log. An empty list is the
        // honest answer, and it is a debuggable one.
        const cronRouter = new Hono<HonoEnv>();

        // Cron admin routes require authentication + admin role
        applyAdminGate(cronRouter, "Cron");

        cronRouter.route("/", createCronRoutes(cronScheduler, cronProblems.length));
        if (surfaces.cron) config.app.route(`${basePath}/cron`, cronRouter);

        if (loadedCronJobs.length > 0) {
            cronScheduler.start();
            logger.info("Mounted cron jobs", {
                count: loadedCronJobs.length,
                path: `${basePath}/cron`
            });
        } else {
            logger.warn(
                `Cron routes mounted at ${basePath}/cron, but no jobs loaded from ${config.cronsDir}. ` +
                (cronProblems.length > 0
                    ? `Nothing is scheduled — ${cronProblems.length} file(s) were skipped, see the messages above.`
                    : "The directory holds no .ts/.js cron files, so nothing is scheduled.")
            );
        }
    }

    // 6a. Start the durable job queue.
    //
    // After cron on purpose: both create tables in `rebase`, and cron's
    // bootstrap is the older and better-exercised of the two.
    let jobQueue: import("./jobs").JobQueue | undefined;
    if (config.jobs?.enabled) {
        const { createJobStore, createJobQueue } = await import("./jobs");
        const store = createJobStore(defaultDriver);

        if (store) {
            await store.ensureTable();
            jobQueue = createJobQueue(store, config.jobs);
            jobQueue.start();
            logger.info("Job queue started", { tasks: Object.keys(config.jobs.tasks ?? {}).length });
        } else {
            // `createJobStore` already said why. What it cannot say is what the
            // caller should expect instead, which depends on who asked.
            logger.warn(
                "Job queue requested but unavailable on this driver — `rebase.jobs.enqueue` will throw, " +
                "and webhook deliveries fall back to the in-memory queue."
            );
        }
    }

    // 6b. Mount Backup admin routes (for the Studio Backups panel).
    // Read the destination lazily from env so config changes don't need a
    // rebuild. Only enabled when BACKUP_DESTINATION is set.
    if (surfaces.admin) {
        const { createBackupRoutes, parseBackupDestination } = await import("./backup");
        const backupRouter = new Hono<HonoEnv>();

        applyAdminGate(backupRouter, "Backup");

        backupRouter.route("/", createBackupRoutes({
            getDestination: () => {
                const out = process.env.BACKUP_DESTINATION?.trim();
                return out ? parseBackupDestination(out) : null;
            },
            storage: storageController
        }));
        config.app.route(`${basePath}/admin/backups`, backupRouter);
        logger.debug("Backup admin routes mounted", { path: `${basePath}/admin/backups` });
    }

    // 6c. Mount Logs routes (for the Studio Logs Explorer). Request logs expose
    // paths, status codes and correlation IDs, so they are admin-only — the same
    // posture as the cron and backup admin routes above.
    if (surfaces.admin) {
        const { default: logsRoutes } = await import("./api/logs-routes");
        const logsRouter = new Hono<HonoEnv>();

        applyAdminGate(logsRouter, "Logs");

        logsRouter.route("/", logsRoutes);
        config.app.route(`${basePath}/logs`, logsRouter);
        logger.debug("Logs routes mounted", { path: `${basePath}/logs` });
    }

    // 6d. Mount the project contract — what lets a repository that does *not*
    // contain the collections still generate a typed client against them. This
    // is the backbone of frontends, second web apps and mobile apps living in
    // their own repositories.
    //
    // Mounted here rather than by the bundle runtime so a project with a
    // hand-written entrypoint gets it too: ejecting should cost you the stock
    // runtime, not the API surface.
    if (surfaces.meta) {
        const { createContractRoutes } = await import("./api/contract-routes");
        const contractRouter = new Hono<HonoEnv>();

        // Only `/contract` is gated: it is a full map of the schema, including
        // tables no security rule would ever expose. Its sibling
        // `/schema-version` returns a bare version string that stands for the
        // schema without describing it, and is deliberately reachable by a CI
        // job holding no credentials.
        //
        // With no way to gate it, `/contract` is not served at all — the same
        // answer `applyAdminGate` gives the other admin surfaces, which refuse
        // rather than open when there is no credential to check. It differs only
        // in status: this one is 404 because it is not an operation someone
        // tried to perform, it is a document that is not there. Configure auth
        // and it returns.
        if (adminSurfacesGated) {
            if (apiKeyPreAuth) contractRouter.use("/contract", apiKeyPreAuth);
            contractRouter.use(
                "/contract",
                createRequireAuth({ serviceKey: internalServiceKey }),
                requireAdmin
            );
        } else {
            contractRouter.all("/contract", (c) => c.json({
                error: {
                    code: "CONTRACT_UNAVAILABLE",
                    message: "The project contract is only served when authentication is configured, " +
                        "because it describes every table and relation in the project."
                }
            }, 404));
            logger.warn(
                "Contract endpoint disabled: no auth is configured (no adapter or no jwtSecret), " +
                "and it would otherwise expose the full collection schema to anyone. " +
                "`/api/meta/schema-version` is still served."
            );
        }

        contractRouter.route("/", createContractRoutes({
            collectionRegistry,
            schemaVersion: config.schemaVersion,
            runtimeVersion: config.runtimeVersion
        }));

        config.app.route(`${basePath}/meta`, contractRouter);
        logger.debug("Contract routes mounted", { path: `${basePath}/meta` });
    }

    // With multiple realtime-capable engines, route subscriptions to the
    // provider owning each collection (the realtime counterpart of the data
    // router). The single WebSocket server is driven by this composite.
    // Single-engine setups use the default provider unchanged.
    const effectiveRealtimeService: RealtimeProvider = Object.keys(realtimeServices).length > 1
        ? createRoutedRealtimeService({
            providers: realtimeServices,
            defaultKey: defaultDriverId,
            resolveKey: keyForCollectionPath
        })
        : defaultRealtimeService as RealtimeProvider;

    if (defaultBootstrapper.initializeWebsockets && effectiveRealtimeService) {
        await defaultBootstrapper.initializeWebsockets(config.server, effectiveRealtimeService, defaultDriver, config.auth, authAdapter);
    }

    logger.debug("Rebase Backend Initialized");

    // ── Deep Health Check ─────────────────────────────────────────────────
    // The auth probe is only available when a driver bootstrapped auth — an
    // AuthAdapter or a deployment without auth leaves it undefined, and the
    // health check falls back to the database probe alone.
    const authSchemaCheck = authConfigResult?.schemaHealthCheck;
    const healthCheck = createHealthCheck(
        defaultDriver,
        authSchemaCheck ? () => authSchemaCheck.call(authConfigResult) : undefined
    );

    // ── Graceful Shutdown ─────────────────────────────────────────────────
    const shutdown = createShutdown({
        server: config.server,
        cronScheduler,
        jobQueue,
        realtimeServices
    });

    /**
     * Every registry a driver might resolve callbacks from, plus the backend's
     * own. Each holds its own normalized copy of a collection, so callbacks have
     * to be written to all of them.
     */
    const callbackTargets = (): Array<{ get(slug: string): unknown }> => {
        const targets: Array<{ get(slug: string): unknown }> = [collectionRegistry];
        for (const key of [DEFAULT_DRIVER_ID, ...driverRegistry.list()]) {
            const d = driverRegistry.get(key) as unknown as { registry?: { get(slug: string): unknown } };
            if (d?.registry && typeof d.registry.get === "function" && !targets.includes(d.registry)) {
                targets.push(d.registry);
            }
        }
        return targets;
    };

    const setCollectionCallbacks = (
        slug: string,
        callbacks: import("@rebasepro/types").CollectionCallbacks
    ): void => {
        let attached = 0;
        for (const registry of callbackTargets()) {
            const collection = registry.get(slug) as { callbacks?: unknown } | undefined;
            if (collection) {
                collection.callbacks = callbacks;
                attached++;
            }
        }
        if (attached === 0) {
            logger.warn(`[callbacks] Collection "${slug}" not found in any registry — callbacks not attached.`);
        }
    };

    return {
        driverRegistry,
        driver: defaultDriver,
        setCollectionCallbacks,
        realtimeServices,
        realtimeService: effectiveRealtimeService,
        auth: authConfigResult,
        history: historyConfigResult,
        storageRegistry,
        storageController,
        collectionRegistry,
        cronScheduler,
        jobQueue,
        healthCheck,
        shutdown
    };
}
