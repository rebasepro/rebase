/**
 * A Rebase backend as a value the application holds.
 *
 * `createRebaseBackend(options)` builds everything a backend is — the drivers,
 * auth, storage, the in-process client, every route group — and stops there:
 * it mounts nothing, starts no timer and adds no process listener. What happens
 * next is the caller's, one public method at a time:
 *
 * ```ts
 * const backend = await createRebaseBackend({ database, auth, collections, provision: true });
 * app.route("/api/data", backend.routes.data());   // one group, at a path of your choosing
 * backend.mount(app, { basePath: "/api" });         // or every group, exactly as initializeRebaseBackend lays them out
 * await backend.attachRealtime(server);             // the websocket
 * backend.start();                                  // cron, job workers, sweeps, the metrics sampler, the RLS audit
 * await backend.shutdown();
 * ```
 *
 * `initializeRebaseBackend` (`../init.ts`) is those calls in that order, and
 * nothing else.
 *
 * @module
 */
import {
    AuthAdapter,
    BackendBootstrapper,
    BootstrappedAuth,
    DatabaseAdapter,
    DataDriver,
    CollectionConfig,
    HealthCheckResult,
    InitializedDriver,
    isSQLAdmin,
    MountableRouter,
    RealtimeProvider,
    buildResourceGraph,
    computeSchemaVersion,
    parseEnvBoolean,
    resourceKeyOf,
    DEFAULT_STORAGE_SOURCE_KEY,
    type AdminScope,
    type AuthConfigDocument,
    type CollectionCallbacks,
    type RebaseServerClient
} from "@rebasepro/types";
import { createDataSourceRegistry, resolveDataSource, buildSdkData, buildRoutedRebaseData, createAccessorSlugResolver, getEffectiveSecurityRules, assertBeforeQueryIsPostgresOnly } from "@rebasepro/common";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import nodePath from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRebaseClient } from "@rebasepro/client";

import { BackendCollectionRegistry } from "../collections/BackendCollectionRegistry";
import { loadCollectionsFromDirectory } from "../collections/loader";
import { assertCollectionConfigs } from "../collections/validate-config";
import {
    collectionsStoredBy,
    logUnprovisionedCollections,
    provisionTargetsFor,
    provisioningDisabled,
    type ProvisionTarget,
    provisionCollectionPolicies,
    provisionCollectionTables,
    verifyProvisioningConnection
} from "../boot/provision";
import { enforceSchemaStamp, resolveSchemaMismatchPolicy } from "../boot/schema-stamp";
import { DEFAULT_DRIVER_ID, DefaultDriverRegistry, DriverRegistry } from "../services/driver-registry";
import { createRoutedRealtimeService } from "../services/routed-realtime-service";

import { RestApiGenerator } from "../api/rest/api-generator";
import { createAuthMiddleware } from "../auth/middleware";
import { refuseUnhonouredImpersonation } from "../auth/impersonation";
import { createAdapterAuthMiddleware } from "../auth/adapter-middleware";
import { scopeDataDriver, SERVICE_IDENTITY } from "../auth/rls-scope";
import { createBuiltinAuthAdapter } from "../auth/builtin-auth-adapter";
import { ApiError, errorHandler } from "../api/errors";
import { createSchemaDriftDetector } from "../api/schema-drift";
import { installRootErrorHandler, installUnmatchedApiEnvelope } from "../api/root-error-handler";
import { recordMountPath } from "../api/mount-path";
import type { HonoEnv } from "../api/types";
import { logger, setLogLevel } from "../utils/logger";
import { formatByteSize } from "../utils/byte-size";
import { configureMiddlewares } from "../init/middlewares";
import { initializeStorage, assertStorageAccessControlConfigured } from "../init/storage";
import { resolveStorageAccessControl } from "../storage/policies";
import { loadOpenApiGenerator, mountOpenApiDocs, type OpenApiGenerator } from "../init/docs";
import { createHealthCheck } from "../init/health";
import { createShutdown } from "../init/shutdown";
import { createLiveSchemaRoutes, readAccountIdentity } from "../api/live-schema-routes";
import { deprecatedAlias } from "../api/mount";
import {
    commitPathsFor,
    usesVersionedMigrations,
    DEFAULT_COLLECTIONS_PATH
} from "../schema-edit/project-root";
import { createGitHubRepository } from "../schema-edit/github-repository";
import { rewriteRemoteCollection } from "../schema-edit/remote-source";
import { editCollectionSource, writeLocalCollectionSource } from "../schema-edit/local-source";
import type { SchemaSourceEditor } from "../schema-edit/source-editor";
import { createLocalGitRepository, findRepositoryRoot } from "../schema-edit/local-git-repository";
import { createRlsAudit, type RlsAudit } from "../rls-audit";
import { startExpiredTokenSweep } from "../auth/expired-token-sweep";
import { startHistoryRetentionSweep } from "../history/retention-sweep";
import {
    ALL_RUNTIME_SURFACES,
    trimmedSurfaces,
    resolveOwnership,
    resolveSurfaces,
    type RuntimeSurface
} from "../init/surfaces";
import { injectCallbackClient } from "../init/callback-client";
import { handGlobalCallbacksTo } from "../init/global-callbacks";
import { createJwtService, DEFAULT_REFRESH_EXPIRES_IN, processJwtService, type JwtService } from "../auth/jwt";
import { createJwksRoutes } from "../auth/jwks-routes";
import { readRuntimeVersion } from "../boot/version-skew";
import { createStorageMaintenanceRoutes } from "../storage/maintenance-routes";
import { supportsRlsScoping } from "../auth/rls-scope";
import { createOAuthStore, type OAuthStore } from "../mcp/oauth-store";
import { createOAuthRoutes, grantIdentityFromRepository } from "../mcp/oauth-routes";
import { createMcpRoutes, createMcpWellKnownRoutes } from "../mcp/mcp-routes";
import {
    BackendStorageConfig,
    createStorageRoutes,
    createUploadConstraintResolver,
    createUploadPathResolver,
    DEFAULT_MAX_FILE_SIZE,
    DEFAULT_STORAGE_ID,
    StorageController,
    StorageRegistry
} from "../storage";
import { storageRateLimitCost } from "../storage/routes";
import type { ApiKeyStore } from "../auth/api-keys/api-key-store";
import { createApiKeyStore } from "../auth/api-keys/api-key-store";
import { createApiKeyRoutes, createPersonalKeyRoutes } from "../auth/api-keys/api-key-routes";
import { createApiKeyPreAuth, createFunctionScopeGuard, createTusScopeGuard, resolveApiKey } from "../auth/api-keys/api-key-middleware";
import type { KeyTargets } from "../auth/api-keys/key-grant";
import { createPlatformTokenPreAuth, platformTokensFromEnv } from "../auth/platform-token";
import { createRequireAuth } from "../auth/middleware";
import { accessModelFromCollections, callerScopes, keyOwnerResolverFor, requireScope, requireScopeByMethod, type AccessControl, type KeyOwnerResolver } from "../auth/access";
import { createScopeRoutes } from "../auth/scope-routes";
import { verifyCredentialAgainst, type VerifiedCredential } from "../auth/verify-credential";
import { createAuthLimiters, createDataRateLimiter, createDataRateLimitCheck, DEFAULT_FUNCTIONS_ANONYMOUS_LIMIT, type DataRateLimitConfig } from "../auth/rate-limiter";
import { MemoryRateLimitStore } from "../auth/rate-limit-store";
import { createSqlRateLimitStore } from "../auth/sql-rate-limit-store";
import { resolveRateLimitStoreKind } from "../auth/resolve-rate-limit-store";
import { warnOnAuthCollectionDataCallbacks } from "../auth/collection-callback-warning";
import { enforceAuthSecretExclusion } from "../auth/exclude-auth-secrets";
import { seedInitialAdmin } from "../auth/seed-admin";
import { createHistoryRoutes } from "../history";
import type { HistoryService } from "../history/history-routes";
import type { EmailService } from "../email";
import { createEmailService, createUnconfiguredEmailService } from "../email";
import { activeDevEmailSink } from "../email/dev-sink";
import type { OAuthProvider } from "../auth/interfaces";
import { isAuthAdapter, resolveRequireAuth } from "../auth/require-auth";
import {
    assertNoReplacedResourceConfig,
    graphToDataSources,
    graphToStorageSources,
    graphTopics,
    graphQueues
} from "../boot/resource-adapters.js";
import { assertEveryKindBindable } from "../boot/resource-resolvers.js";
import { createTopicRuntime, topicJobHandlers } from "../topics/runtime.js";
import { createQueueRuntime, queueJobHandlers } from "../queues/runtime.js";
import type { CronScheduler } from "../cron";
import type { JobQueue } from "../jobs";
import type { MetricsHistory } from "../metrics/history-recorder.js";
import type { ProvisionOptions, RebaseAuthConfig, RebaseBackendOptions } from "./options";
import type { BackendServices } from "./services";
import { runInBackendScope, type BackendScope } from "./scope";
import { noCollectionsCause } from "./no-collections";

/**
 * A backend's HTTP surface, one route group at a time.
 *
 * Each group is a self-contained Hono sub-app: it carries the middleware it
 * needs — the auth context that puts `user`, `driver` and `scopes` on the
 * request, its rate limits, its admin gate — so it answers the same wherever it
 * is mounted:
 *
 * ```ts
 * app.route("/v2/data", backend.routes.data());
 * app.route("/hooks", backend.routes.functions());   // getDriver(c) and getUser(c) work inside
 * ```
 *
 * What a group does not carry is the process-wide HTTP hygiene `mount()`
 * installs ahead of every group — request ids, the global body limit,
 * compression, CSRF, the request log and the JSON envelope for errors and
 * unmatched paths. An application mounting groups one by one adds its own
 * (`hono/body-limit`, `app.onError(errorHandler)`).
 *
 * Every call returns a fresh router over the same handlers, so a group can be
 * mounted in several places. Asking for a group whose surface is off
 * (`surfaces: { data: false }`) throws: that backend never built it.
 */
export interface RebaseRoutes {
    /**
     * The sign-in surface, normally at `/api/auth`: registration, sessions,
     * OAuth, password reset, `GET /config` (what the login screen offers),
     * the caller's own API keys (`/keys`) and the scope catalogue (`/scopes`).
     */
    auth(): Hono<HonoEnv>;
    /**
     * The data API, normally at `/api/data`: the collections' REST routes and
     * their history, behind authentication, RLS scoping and rate limits.
     */
    data(): Hono<HonoEnv>;
    /**
     * File storage, normally at `/api/storage` — or, with no storage
     * configured, the router that says so (`STORAGE_NOT_CONFIGURED`).
     */
    storage(): Hono<HonoEnv>;
    /**
     * Custom functions, normally at `/api/functions` — or the forwarder to the
     * process that serves them, when this one has a `functionsUpstream`.
     */
    functions(): Hono<HonoEnv>;
    /**
     * Every admin-gated surface, normally at `/api/admin`: users and roles,
     * service API keys, live schema editing and the schema editor, storage
     * maintenance, backups, the RLS audit, SQL export, the development
     * mailbox and the log reader. Cron's admin surface is {@link cron}.
     */
    admin(): Hono<HonoEnv>;
    /** The cron admin surface — list, trigger, read runs — normally at `/api/admin/cron`. */
    cron(): Hono<HonoEnv>;
    /** The project contract a generated SDK reads, normally at `/api/meta`. */
    meta(): Hono<HonoEnv>;
}

/** Where {@link RebaseBackend.mount} puts the backend. */
export interface BackendMountOptions {
    /** The prefix every group is mounted under. Default `/api`. */
    basePath?: string;
}

/** How {@link RebaseBackend.attachRealtime} attaches the websocket. */
export interface AttachRealtimeOptions {
    /**
     * The URL path the socket accepts upgrades on. The SDK dials its `baseUrl`
     * with no extra segment while HTTP goes to `${baseUrl}/api`, so the default
     * is the base path given to `mount()` with a trailing `/api` removed —
     * `/api` → `/`, `/x/api` → `/x` — and `/` when nothing was mounted. An
     * upgrade to any other path is left for the server's other listeners.
     */
    path?: string;
}

/**
 * A backend built by {@link createRebaseBackend}: everything constructed,
 * nothing mounted, nothing started.
 */
export interface RebaseBackend {
    /**
     * The in-process client — what `rebase` from `@rebasepro/server` is inside
     * every request, cron run and job this backend serves (and everywhere,
     * once it is the process default: {@link setDefaultBackend}).
     * `dataAsAdmin`, `sql`, `storage`, `bucket` and `email` call the drivers
     * and controllers directly; `auth`, `admin`, `functions` and `cron` reach
     * this backend's routes in-process, without an HTTP server and wherever
     * (or whether) the application mounted them.
     */
    rebase: RebaseServerClient;

    /**
     * What this backend holds and its requests ask it for: its JWT keys
     * (`services.jwt` signs and verifies its tokens), its access model, its
     * API-key store, its rate limiters, its collections. Its own — another
     * backend in the same process has others.
     *
     * ```ts
     * const token = await backend.services.jwt.generateAccessToken("u1", ["editor"]);
     * ```
     */
    services: BackendServices;

    /**
     * The identity and scopes behind a bearer credential — a session token or
     * an `rk_` API key — as this backend verifies it, or null. For an app's
     * own socket or tunnel.
     */
    verifyCredential(token: string): Promise<VerifiedCredential | null>;
    driverRegistry: DriverRegistry;
    driver: DataDriver;
    realtimeServices: Record<string, RealtimeProvider>;
    realtimeService: RealtimeProvider;
    auth?: BootstrappedAuth;
    history?: { historyService: HistoryService };
    /**
     * Stored metrics for this deployment, when it can keep any.
     *
     * Absent on a driver with no SQL admin. The `/metrics/history` route turns
     * that absence into a named 501 rather than an empty series, because an
     * empty chart and "this deployment keeps no history" look identical.
     */
    metricsHistory?: MetricsHistory;
    storageRegistry?: StorageRegistry;
    storageController?: StorageController;
    collectionRegistry: BackendCollectionRegistry;
    /** The cron scheduler. Its jobs are registered; `start()` starts its timers. */
    cronScheduler?: CronScheduler;
    /**
     * The durable job queue, when `jobs.enabled` is set and the driver can run
     * SQL. Enqueueing works at once; `start()` starts the workers. Present on
     * the instance because the *producers* live in application code:
     *
     * ```ts
     * const dispatcher = new WebhookDispatcher({ jobQueue: backend.jobQueue });
     * backend.jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload, ctx));
     * ```
     */
    jobQueue?: JobQueue;

    /** The route groups, each mountable on its own. */
    routes: RebaseRoutes;

    /**
     * The whole backend as one fetch handler, laid out as `mount()` lays it
     * out at `/api`. For in-process calls, tests and scripts — no server, no
     * port: `await backend.fetch(new Request("http://local/api/data/posts"))`.
     */
    fetch(request: Request): Promise<Response>;

    /**
     * Mount every group this backend serves onto `app` under `basePath`, with
     * the process-wide middleware in front of them — exactly the layout
     * `initializeRebaseBackend` produces, legacy aliases included. Call it
     * before adding routes of your own under the same prefix.
     */
    mount(app: Hono<HonoEnv>, options?: BackendMountOptions): void;

    /**
     * Attach the realtime websocket to an HTTP server. Does nothing when the
     * `realtime` surface is off or the driver offers no realtime. Once only.
     */
    attachRealtime(server: Server, options?: AttachRealtimeOptions): Promise<void>;

    /**
     * Start what runs on a timer: the cron scheduler, the job workers, the
     * expired-token and history-retention sweeps, the metrics sampler and the
     * scheduled RLS audit — each only where `ownership` gives it to this
     * process. Idempotent.
     */
    start(): void;

    /**
     * Attach collection callbacks after the backend is built.
     *
     * Use this instead of mutating `collectionRegistry.get(slug).callbacks`.
     * Every registry normalizes its collections through `{ ...c }`, so the
     * backend registry and each driver's registry hold **separate copies** of
     * the same collection — assigning callbacks to one is invisible to the
     * driver that actually invokes them, and the hooks silently never fire.
     * This writes to all of them.
     *
     * It REPLACES the callbacks the collection declared. To keep them, attach
     * `composeCallbacks(declared, mine)`.
     */
    setCollectionCallbacks(slug: string, callbacks: CollectionCallbacks): void;

    /**
     * Deep health check that verifies database connectivity.
     * Returns latency and component status.
     */
    healthCheck(): Promise<HealthCheckResult>;

    /**
     * Stop what `start()` started and `attachRealtime()` attached, waiting for
     * work in flight (cron runs, jobs, `waitUntil()` tasks) within the budget.
     *
     * The HTTP server is the application's: it is closed — drained, then
     * force-closed at the deadline — only when passed as `options.server`.
     *
     * @param timeoutMs - Maximum time (ms) to wait for drain before giving up
     *                    (default: 15000). Pass 0 to wait without a deadline.
     */
    shutdown(timeoutMs?: number, options?: { server?: Server }): Promise<void>;
}

/** Where the backend's own control plane is laid out, for `fetch` and the in-process client. */
const IN_PROCESS_BASE_PATH = "/api";

/**
 * Type guard to detect whether `database` is a `DatabaseAdapter`.
 */
export function isDatabaseAdapter(db: unknown): db is DatabaseAdapter {
    return typeof db === "object" && db !== null && "initializeDriver" in db && "type" in db && !("initializeAuth" in db);
}

/**
 * Present a `DatabaseAdapter` as a `BackendBootstrapper`.
 *
 * The `database` convenience path — one adapter, no explicit source keys —
 * funnels through here. `adapterToBootstrapper` in `boot/driver.ts` does the
 * same job for the multi-source path, and the two stay separate because only
 * that one carries a registry id and a default flag; this path has exactly one
 * driver and needs neither.
 *
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
        verifyConnection: dbAdapter.verifyConnection
            ? (driverResult) => dbAdapter.verifyConnection!(driverResult)
            : undefined,
        ensureCollectionSchema: dbAdapter.ensureCollectionSchema
            ? (collections, driverResult, log) =>
                dbAdapter.ensureCollectionSchema!(collections, driverResult, log)
            : undefined,
        ensureCollectionPolicies: dbAdapter.ensureCollectionPolicies
            ? (collections, driverResult, log) =>
                dbAdapter.ensureCollectionPolicies!(collections, driverResult, log)
            : undefined,
        ensureRlsRuntime: dbAdapter.ensureRlsRuntime
            ? (driverResult) => dbAdapter.ensureRlsRuntime!(driverResult)
            : undefined,
        finalizeSecurityPosture: dbAdapter.finalizeSecurityPosture
            ? (driverResult) => dbAdapter.finalizeSecurityPosture!(driverResult)
            : undefined,
        readCollectionsSchemaVersion: dbAdapter.readCollectionsSchemaVersion
            ? (driverResult) => dbAdapter.readCollectionsSchemaVersion!(driverResult)
            : undefined,
        stampCollectionsSchemaVersion: dbAdapter.stampCollectionsSchemaVersion
            ? (version, driverResult) => dbAdapter.stampCollectionsSchemaVersion!(version, driverResult)
            : undefined,
        getAdmin: dbAdapter.getAdmin
    };
}

/**
 * Functions and crons each come from values or from a directory, never both.
 *
 * Both would be two answers to "what does `/api/functions/send` run", and any
 * rule picking one — values first, the directory first, a merge — is a rule a
 * reader has to know to predict the server. Refused at the first line of boot,
 * naming the pair, before anything is loaded.
 */
function assertOneSourceEach(config: Pick<RebaseBackendOptions, "functions" | "functionsDir" | "crons" | "cronsDir">): void {
    if (config.functions && config.functionsDir) {
        throw new Error(
            "Both `functions` and `functionsDir` are set. Pass one: `functions: await loadFunctions(dir)` " +
            "is the same as `functionsDir: dir`, so keep whichever reads better and drop the other."
        );
    }
    if (config.crons && config.cronsDir) {
        throw new Error(
            "Both `crons` and `cronsDir` are set. Pass one: `crons: await loadCrons(dir)` " +
            "is the same as `cronsDir: dir`, so keep whichever reads better and drop the other."
        );
    }
}

/** `provision` with every part answered. */
interface ResolvedProvision {
    /** The database role, and the framework's own tables. */
    database: boolean;
    collections: boolean;
    realtime: boolean;
}

function resolveProvision(provision: boolean | ProvisionOptions | undefined): ResolvedProvision {
    if (provision === undefined) {
        // A JavaScript caller can leave out what the types require; the answer
        // is still not ours to pick.
        throw new Error(
            "createRebaseBackend needs `provision`: `true` to create what this backend serves (collection tables, " +
            "RLS policies, change capture, the framework's own tables), `false` to change nothing in the database."
        );
    }
    if (typeof provision === "boolean") {
        return { database: provision, collections: provision, realtime: provision };
    }
    return {
        database: true,
        collections: provision.collections ?? true,
        realtime: provision.realtime ?? true
    };
}

/**
 * Build a backend: open the drivers, provision what `options.provision` allows,
 * initialise auth, storage and the in-process client, and build every route
 * group. Mounts nothing, starts no timer, adds no process listener — see
 * {@link RebaseBackend} for the steps that do.
 *
 * Writes no process global either. The backend holds its own JWT keys, access
 * model, API-key store, rate-limit counts and client (`backend.services`,
 * `backend.rebase`), and code it runs — a function, a cron job, a hook — sees
 * it as `rebase`. The module-level API (`rebase` outside any request,
 * `verifyAccessToken`, `getAccessModel`, …) answers for the process default,
 * which {@link setDefaultBackend} sets and `initializeRebaseBackend` sets for
 * its backend. The one process-wide setting it touches is the log level, and
 * only when `logging.level` is given: the logger is the process's.
 */
export async function createRebaseBackend(options: RebaseBackendOptions): Promise<RebaseBackend> {
    const config = options;
    const provision = resolveProvision(config.provision);

    // One level system, and the process's: every line any backend in this
    // process writes goes through the one logger, so the level is set only
    // when this backend was asked to set it. This used to also call
    // `configureLogLevel`, which replaced `console.debug`/`console.log`/
    // `console.warn` with no-ops — so `LOG_LEVEL=warn` silenced not just this
    // server's info lines but every `console.log` in the process: a
    // dependency's, and the project's own debugging. Irreversibly, since the
    // originals were discarded.
    if (config.logging?.level !== undefined) setLogLevel(config.logging.level);

    // Before anything reads the config: a project still declaring resources the
    // old way is refused here rather than booted with them ignored. First
    // statement of substance on purpose — after this line, `config` is known not
    // to carry a declaration nothing will honour.
    assertNoReplacedResourceConfig(config as unknown as Record<string, unknown>);
    assertOneSourceEach(config);

    // The graph replaces both. Read once here so everything below sees one
    // answer: the registry is populated by the config module's own
    // declarations, which have already been evaluated by the time a backend is
    // being initialised with them.
    const resourceGraph = buildResourceGraph();
    assertEveryKindBindable(resourceGraph);
    const declaredDataSources = graphToDataSources(resourceGraph);
    const declaredStorageSources = graphToStorageSources(resourceGraph);

    logger.debug("Initializing Rebase Backend");

    const isProduction = process.env.NODE_ENV === "production";

    // What this process serves, and what it owns. Both default to everything,
    // so a caller that passes neither builds the backend this server has always
    // booted. Resolved here, before anything is built, so every gate below reads
    // one already-decided answer rather than re-deriving it from optionals.
    const surfaces = resolveSurfaces(config.surfaces);
    const ownership = resolveOwnership(config.ownership);
    // `trimmedSurfaces`, not `disabledSurfaces`: a surface that is off by
    // default was not turned off by anyone, and counting it made every
    // deployment in the fleet announce itself as partial. See its docblock.
    const offSurfaces = trimmedSurfaces(surfaces);
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

    const collectionRegistry = new BackendCollectionRegistry();
    // Declared data sources — drives engine resolution (capabilities) and the
    // server-vs-direct transport distinction. Set before collections register
    // so normalization can resolve each collection's engine.
    const dataSourceRegistry = createDataSourceRegistry(
        declaredDataSources.length > 0 ? declaredDataSources : undefined
    );
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

    // Before anything copies them. Every registry re-normalizes what it is
    // handed — `normalizeCollection` rebuilds each property as `{ ...property }`
    // — so a flag set after a registry was built reaches the config object and
    // none of the copies serving requests. The driver's own registry is built
    // inside `initializeDriver` below, which is where reads are rendered from:
    // running this only before `collectionRegistry.register` (as it did) fixed
    // the write path, whose validation reads the server's copy, and left the
    // read path serving `password_hash` in every row of the users collection.
    // Repeated after the loop for collections the drivers introspected.
    enforceAuthSecretExclusion(activeCollections);

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
    // Tables a driver found while deriving collections and did not serve, for
    // the answer the data API gives when it then has nothing to serve.
    const unprotectedTables: { schema: string; table: string }[] = [];

    /** What each bootstrapper's `initializeDriver` returned, by bootstrapper. */
    const driverResults = new Map<BackendBootstrapper, InitializedDriver>();

    // ─── Collection schema ───────────────────────────────────────────────
    //
    // Create any collection tables the database is missing, BEFORE any driver
    // initializes: the driver introspects the tables during initialization, and
    // attaches its change-capture triggers to them, so a table created after
    // this point stays uninstrumented until the next restart.
    //
    // This runs here — inside the function every boot path calls — rather than
    // in `bootFromBundle`, which is where it used to live and therefore only
    // ever ran for managed tenants. An app shipping its own image called
    // `initializeRebaseBackend` directly, got no tables, and served sign-in
    // while 500ing every data route. See ../boot/provision. Whether it runs at
    // all is `provision.collections`.
    // One target per data source, the default first. Each source gets exactly
    // the collections routed to it: this used to hand every same-engine
    // collection to the default, so a table for `database("analytics")` was
    // created in the default database and the analytics one stayed empty.
    const provisionTargets = provisionTargetsFor(bootstrappers, config.database, config.provisioningDriverResult);
    const provisionTarget = provisionTargets[0];
    const sourceShapes = provisionTargets.map(t => ({ key: t.key ?? DEFAULT_DRIVER_ID, engine: t.engine }));
    const declaredShapes = declaredDataSources.map(source => ({
        key: source.key,
        engine: source.engine ?? provisionTarget.engine
    }));
    const provisionableBy = new Map<ProvisionTarget, CollectionConfig[]>();
    const storedBySome = new Set<CollectionConfig>();
    for (const target of provisionTargets) {
        const mine = collectionsStoredBy(
            activeCollections,
            { key: target.key ?? DEFAULT_DRIVER_ID, engine: target.engine },
            declaredShapes.length > 0 ? declaredShapes : sourceShapes
        );
        provisionableBy.set(target, mine);
        for (const c of mine) storedBySome.add(c);
    }
    logUnprovisionedCollections(activeCollections, storedBySome, sourceShapes);
    const provisionable = provisionableBy.get(provisionTarget) ?? [];

    // Before that first query: ask the database whether it is there at all. The
    // adapter's connection diagnosis — the box that names the host, the port and
    // `docker compose up -d db` — used to live only inside `initializeDriver`,
    // which runs after this, so the one failure it was written for never reached
    // it. See `verifyProvisioningConnection`.
    await verifyProvisioningConnection(provisionTarget);

    let schemaOutcome = await provisionCollectionTables(provisionable, provisionTarget, {
        introspecting: introspectCollections,
        provision: provision.collections
    });
    for (const target of provisionTargets.slice(1)) {
        const mine = provisionableBy.get(target) ?? [];
        if (mine.length === 0) continue;
        logger.info(`Provisioning ${mine.length} collection table(s) on data source "${target.key}"`);
        // The same question for every database that gets tables, not only the
        // first: a second source that is down would otherwise fail inside the
        // DDL with the redacted "Failed query" this probe exists to pre-empt.
        await verifyProvisioningConnection(target);
        const outcome = await provisionCollectionTables(mine, target, {
            introspecting: introspectCollections,
            provision: provision.collections
        });
        if (outcome.status === "applied" && schemaOutcome.status === "applied") {
            schemaOutcome = { status: "applied", applied: schemaOutcome.applied + outcome.applied };
        }
    }

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
            dataSourceKey: b.id || DEFAULT_DRIVER_ID,
            baas: config.baas,
            // So the driver's drift check can say something true about WHY a
            // table is missing. Its warning used to assert that "this runtime
            // applies the collection schema at boot" and point at
            // REBASE_MIGRATE_ON_BOOT — advice that was unactionable for every
            // app whose boot path had no provisioning step at all.
            schemaProvisioning: {
                attempted: schemaOutcome.status === "applied",
                reason: schemaOutcome.status === "skipped" ? schemaOutcome.reason : undefined
            },
            // Two separate questions, and a split deployment answers them
            // differently. `subscribe` is "does this process have anyone to
            // deliver change events to" — false for the roles that serve no
            // websockets, which is what stops a worker holding a dedicated
            // LISTEN connection for nothing. `provision` is DDL, and it follows
            // the same single-owner rule as the tables and the policies: the
            // capture triggers are installed once, by the process that owns the
            // schema, and every other process then reads what they publish.
            realtime: {
                subscribe: surfaces.realtime,
                provision: provision.realtime
            },
            // Everything else opening the driver may change — the role
            // requests run as under RLS, its grants, the branch metadata. Off
            // only when this backend provisions nothing at all.
            provision: provision.database
        });
        // Global callbacks were set on `collectionRegistry` above, and no driver
        // reads that one — see `handGlobalCallbacksTo`.
        if (config.callbacks) {
            handGlobalCallbacksTo(b.id || bootstrapper.type, bootstrapper.type, driverResult, config.callbacks);
        }
        delegates[b.id || bootstrapper.type] = driverResult.driver;
        // Kept because a later step has to hand each bootstrapper back its own
        // result: `finalizeSecurityPosture` reaches into the driver it
        // initialized, and only the default driver's result was retained here.
        driverResults.set(bootstrapper, driverResult);

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
        if (introspectCollections && driverResult.unprotectedTables?.length) {
            unprotectedTables.push(...driverResult.unprotectedTables);
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

    // A redeclared `users` collection must not lose the exclusions the default
    // one carries. Again, for whatever a driver introspected and appended
    // above; the declared ones were done before the drivers ran, and a property
    // already carrying the flag is skipped here, so this neither re-fixes nor
    // re-warns about them. See exclude-auth-secrets.ts.
    enforceAuthSecretExclusion(activeCollections);

    activeCollections.forEach(collection => collectionRegistry.register(collection));

    const defaultDriver = driverRegistry.getOrDefault(defaultDriverId);
    if (!defaultDriver || !defaultDriverResult) {
        // Named, because the reader's next question is "which one" and the
        // answer is not obvious from a multi-source configuration: the default
        // is whichever adapter is marked `isDefault`, or the first declared.
        throw new Error(
            `The "${defaultDriverId}" data source is the default, and its adapter's ` +
            "`initializeDriver` returned nothing usable. Adapters that ran: " +
            `${bootstrappers.map(b => b.id || b.type).join(", ") || "none"}. ` +
            "Check that adapter's connection configuration."
        );
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

    // The access model — the app's declared roles and scopes — before anything
    // that reads it: the registration guard refuses a default role holding an
    // admin-plane scope, and every scope check consults it. Built from the
    // users collection's `auth` block; an explicitly configured auth
    // collection takes precedence over one found among the collections.
    const explicitAuthCollection = config.auth && !isAuthAdapter(config.auth) ? config.auth.collection : undefined;
    const accessCollections = explicitAuthCollection ? [explicitAuthCollection, ...activeCollections] : activeCollections;
    const accessModel = accessModelFromCollections(accessCollections);
    const declaredAuth = accessCollections.find(collection => collection.auth === true
        || (typeof collection.auth === "object" && collection.auth !== null && collection.auth.enabled === true))?.auth;
    const personalKeysEnabled = typeof declaredAuth === "object" && declaredAuth !== null && declaredAuth.personalKeys === true;

    // 2. Initialize Auth & History via the default driver's bootstrapper
    let authConfigResult: BootstrappedAuth | undefined = undefined;
    let serviceKey: string | undefined;
    let authAdapter: AuthAdapter | undefined;
    // This backend's tokens: signed and verified with its own secret and keys
    // when `auth.jwtSecret` gives it some. A backend given none — one that
    // authenticates through an adapter, or a server wired by hand that calls
    // `configureJwt` itself — signs with the process default's, as it always
    // has: it has no keys of its own to keep apart.
    let jwt: JwtService = processJwtService;

    if (config.auth) {
        if (isAuthAdapter(config.auth)) {
            // ── New path: User provided an AuthAdapter directly ──────────
            authAdapter = config.auth;
            serviceKey = authAdapter.serviceKey;

            if (authAdapter.initialize) {
                await authAdapter.initialize();
            }

            logger.debug("Using AuthAdapter", { id: authAdapter.id });

            // The backend exposes `auth?: BootstrappedAuth`, so an
            // adapter-based backend fills it from the adapter's own user
            // management — the same field, whichever way auth was configured.
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

            if (safeAuthConfig.jwtSecret) {
                jwt = createJwtService({
                    secret: safeAuthConfig.jwtSecret,
                    accessExpiresIn: safeAuthConfig.accessExpiresIn || "1h",
                    refreshExpiresIn: safeAuthConfig.refreshExpiresIn || DEFAULT_REFRESH_EXPIRES_IN,
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

    // ─── RLS policies ────────────────────────────────────────────────────
    //
    // The companion to the table creation above, and it has to be here rather
    // than beside it: generated policies call the `auth.*` helper functions, and
    // `CREATE POLICY` validates those exist — they are created during auth
    // initialization, which just finished. A table without its policies is not
    // servable either, so skipping this half only changes the symptom from a 500
    // to an empty result.
    const policyOutcome = await provisionCollectionPolicies(provisionable, provisionTarget, {
        introspecting: introspectCollections,
        provision: provision.collections
    });
    for (const target of provisionTargets.slice(1)) {
        const mine = provisionableBy.get(target) ?? [];
        if (mine.length === 0) continue;
        // The helper functions the policies call arrive with the auth tables
        // on the default source only. A second database needs them created on
        // its own, or every CREATE POLICY below fails and the source denies
        // every user read while reporting itself healthy.
        if (provision.collections && !provisioningDisabled() && target.bootstrapper.ensureRlsRuntime) {
            await target.bootstrapper.ensureRlsRuntime(target.driverResult);
        }
        await provisionCollectionPolicies(mine, target, {
            introspecting: introspectCollections,
            provision: provision.collections
        });
    }

    // ── Is the database's authorization actually in force? ───────────────────
    //
    // The driver decided that at connect time, which on a fresh database is
    // before there is anything to decide from: a role that owns no tables does
    // not bypass RLS, so no isolation is configured — and then the steps above
    // create every table on that same connection, making it their owner, and an
    // owner is exempt from the policies on what it owns. The answer has to be
    // taken again now that the schema exists, on every driver that has one.
    //
    // Deliberately after the policies, not merely after the tables: a table with
    // RLS enabled and no policy is closed, so the window this closes is the one
    // where both halves are in place and only the role switch is missing.
    for (const bootstrapper of bootstrappers) {
        const result = driverResults.get(bootstrapper);
        if (!bootstrapper.finalizeSecurityPosture || !result) continue;
        await bootstrapper.finalizeSecurityPosture(result);
    }

    // ── Does this process match the schema it is about to serve? ─────────────
    //
    // Deliberately here, after the policies rather than after the tables: half a
    // schema is not a schema, and the missing half is the one whose absence
    // shows up as an empty result rather than an error. A process that just
    // provisioned stamps what it applied; every other process compares and says
    // so. See ./boot/schema-stamp.
    // `provisionTarget` already answered "which adapter owns the schema, and
    // through which handle" for the two steps above; the stamp is the third step
    // of the same job and reads it off the same object rather than resolving it
    // again. Two answers to that question is how the create path and the patch
    // path drifted apart elsewhere in this codebase.
    await enforceSchemaStamp({
        collections: provisionable,
        // What this process *did*, not what its role permits. The difference is
        // the chart's default: with an external migration Job every pod runs
        // REBASE_MIGRATE_ON_BOOT=none, including the api, whose role still says
        // it may provision. Keyed on permission, the api would stamp a schema it
        // had not applied — overwriting the Job's answer with its own and making
        // the check agree with whatever booted last. Keyed on the outcome, the
        // Job stamps and the api compares, which is what each of them actually
        // is in that topology.
        provisioned: schemaOutcome.status === "applied" && policyOutcome.status === "applied",
        introspecting: introspectCollections,
        policy: resolveSchemaMismatchPolicy(),
        read: provisionTarget.bootstrapper.readCollectionsSchemaVersion
            ? () => provisionTarget.bootstrapper.readCollectionsSchemaVersion!(provisionTarget.driverResult)
            : undefined,
        stamp: provisionTarget.bootstrapper.stampCollectionsSchemaVersion
            ? version => provisionTarget.bootstrapper.stampCollectionsSchemaVersion!(version, provisionTarget.driverResult)
            : undefined
    });

    let historyConfigResult: { historyService: HistoryService } | undefined = undefined;
    if (config.history) {
        if (defaultBootstrapper.initializeHistory) {
            logger.debug("Bootstrapping entity history via driver protocol");
            historyConfigResult = await defaultBootstrapper.initializeHistory(config.history, defaultDriverResult) as { historyService: HistoryService } | undefined;

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
    // Bootstrapped before the routers are built so `rk_` pre-auth can sit in
    // front of every admin surface (Hono runs middleware in registration order
    // — a `use()` after `route()` would never fire for that router).
    let apiKeyStore: ApiKeyStore | undefined;
    const apiKeyStoreResult = createApiKeyStore(defaultDriver);
    if (apiKeyStoreResult) {
        apiKeyStore = apiKeyStoreResult;
        if (provision.database) await apiKeyStore.ensureTable();
        logger.debug("Service API Keys initialized");
    }

    // ─── What an administrative gate must re-read, per request ───────────
    //
    // An access token was minted up to an hour ago. Everything that has
    // happened since — a demotion, a sign-out-everywhere, a password reset — is
    // invisible to a gate that reads its `roles` claim, and the scopes an admin
    // surface checks come from those roles. So every admin gate re-reads both
    // from the database on every request: a revoked token must not download a
    // database dump, and a demoted admin must not mint themselves a key.
    //
    // Same repository, same two questions, wired once here so a new admin
    // surface inherits the answer instead of having to remember it.
    const adminIdentityRepo = (
        authConfigResult?.authRepository ?? authConfigResult?.userService
    ) as import("../auth/interfaces").AuthRepository | undefined;
    const adminGateIdentity = {
        resolveRoles: typeof adminIdentityRepo?.getUserRoleIds === "function"
            ? (uid: string) => adminIdentityRepo.getUserRoleIds(uid)
            : undefined,
        revocationRepo: typeof adminIdentityRepo?.getTokensValidAfter === "function"
            ? adminIdentityRepo
            : undefined
    };

    // A personal key acts as its owner as they are now, so it needs an account
    // store to read the owner from. With `personalKeys` off — or an external
    // auth adapter that keeps accounts elsewhere — no resolver is installed and
    // every personal key is refused, which is also what switching the flag off
    // does to the keys already minted.
    let resolveKeyOwner: KeyOwnerResolver | undefined;
    if (personalKeysEnabled) {
        if (typeof adminIdentityRepo?.getUserById === "function" && typeof adminIdentityRepo.getUserRoleIds === "function") {
            // One read of the owner per request: exists, not disabled, roles.
            resolveKeyOwner = keyOwnerResolverFor(adminIdentityRepo);
        } else {
            logger.warn(
                "[Auth] auth.personalKeys is on, but this backend's auth keeps no account store Rebase can " +
                "read a key's owner from (an external AuthAdapter). Personal API keys are refused."
            );
        }
    }
    // This backend's roles and scopes. Every scope check on its routes, its
    // socket and its key verification reads this one, never another
    // backend's — a role declared here grants nothing anywhere else.
    const access: AccessControl = { model: accessModel, resolveKeyOwner };

    // What a key's scope target may name, read when a key is minted.
    let servedFunctionNames: string[] = [];
    const keyTargets: KeyTargets = {
        collections: () => collectionRegistry.getRawCollections().map(collection => collection.slug),
        functions: () => servedFunctionNames,
        buckets: () => storageRegistry?.list() ?? [DEFAULT_STORAGE_SOURCE_KEY]
    };

    // Authenticates `rk_` bearer tokens in front of the JWT-based admin gates,
    // so a key holding an admin-plane scope genuinely reaches that surface.
    const apiKeyPreAuth = apiKeyStore
        ? createApiKeyPreAuth({ store: apiKeyStore, driver: defaultDriver })
        : undefined;

    // `rpt_` tokens the hosting platform mints for a project member — read-only
    // admin scopes, minutes long, bound to this project. Off unless the platform
    // set its public key and this project's audience; see `auth/platform-token`.
    // In front of the admin group where the `rk_` pre-auth is, and for the same
    // reason: the auth adapter's own admin router sits on `/admin` and
    // authenticates everything under it, ahead of each surface's gate. What a
    // token then reaches is the surfaces' scope checks to decide, exactly as
    // for a key.
    const platformTokenPreAuth = createPlatformTokenPreAuth(await platformTokensFromEnv(process.env));

    // A backup download link — `GET /admin/backups/download?key=…&token=…`,
    // minted behind the Backups gate by `POST /admin/backups/download-url` —
    // stands in for the admin's header on that one request, for one backup and
    // 60 seconds, so a browser can stream a dump to disk. It is answered ahead
    // of every gate in the admin group: the auth adapter's admin routers,
    // mounted after it, authenticate everything under that prefix. A request
    // without `token` passes through to them untouched.
    let backupLinkRouter: Hono<HonoEnv> | undefined;
    if (surfaces.admin) {
        const { createBackupLinkRoutes, backupDestinationFromEnv } = await import("../backup");
        backupLinkRouter = createBackupLinkRoutes({
            getDestination: () => backupDestinationFromEnv(process.env)
        });
    }

    const apiKeyRouter = apiKeyStore && surfaces.admin
        ? createApiKeyRoutes({
            store: apiKeyStore,
            serviceKey: internalServiceKey,
            targets: keyTargets,
            // A key minted here may outlive the session that minted it, so this
            // is the single most valuable thing a stale token can reach.
            ...adminGateIdentity
        })
        : undefined;

    // Ahead of the adapter's auth router in the auth group, which is mounted on
    // the prefix above this one and would otherwise see these requests first.
    let personalKeyRouter: Hono<HonoEnv> | undefined;
    if (apiKeyStore && surfaces.auth) {
        personalKeyRouter = new Hono<HonoEnv>();
        if (apiKeyPreAuth) personalKeyRouter.use("/*", apiKeyPreAuth);
        personalKeyRouter.route("/", createPersonalKeyRoutes({
            store: apiKeyStore,
            enabled: personalKeysEnabled,
            serviceKey: internalServiceKey,
            targets: keyTargets,
            ...adminGateIdentity
        }));
    }
    const scopeRouter = createScopeRoutes({
        serviceKey: internalServiceKey,
        apiKeyPreAuth,
        ...adminGateIdentity
    });

    // One rate-limit store shared by the data, functions and storage limiters:
    // the budget is per caller, not per router — private stores would silently
    // multiply every caller's allowance. An operator-provided store is
    // respected as-is.
    //
    // Across *processes* the same argument applies and the default cannot make
    // it: a process cannot read its own replica count, so `memory` stays the
    // default and a deployment that knows it has peers asks for `sql`. The
    // refusal for an unrecognised value is in `resolveRateLimitStoreKind` — this
    // setting fails silently in every other direction, so the moment it is read
    // is the only moment it can be caught.
    const rateLimitWindowMs = config.rateLimit?.windowMs ?? 15 * 60 * 1000;
    const sharedRateLimitStore = config.rateLimit?.store ?? (
        resolveRateLimitStoreKind(process.env) === "sql"
            // `undefined` when the driver has no SQL admin — it warns and we
            // fall back, rather than refusing to serve on a Mongo deployment
            // that asked for something Mongo cannot give.
            ? createSqlRateLimitStore(defaultDriver)
            : undefined
    );
    const rateLimitStore = sharedRateLimitStore ?? new MemoryRateLimitStore(rateLimitWindowMs);
    // The auth limiters too — login, reset, the OTP and MFA attempt budgets —
    // this backend's own, counting in the shared store when there is one and
    // in their own memory otherwise.
    const authLimiters = createAuthLimiters(sharedRateLimitStore);
    const rateLimitConfig: DataRateLimitConfig | undefined =
        config.rateLimit?.enabled !== false
            ? { ...config.rateLimit, store: rateLimitStore, serviceKey: internalServiceKey }
            : undefined;

    // ── What this backend's requests ask it for ──────────────────────────
    //
    // Everything below that verifies a token, checks a scope, counts a hit or
    // resolves a key reads it from here — through a closure where a router is
    // built, through `c.var.services` on a request — never from a process
    // global. `topics` and `queues` are filled in once the job queue exists.
    const services: BackendServices = {
        jwt,
        access,
        authLimiters,
        rateLimitStore: sharedRateLimitStore,
        apiKeyStore,
        collections: () => collectionRegistry.getRawCollections()
    };
    /**
     * Every route group's first middleware: this backend's services on the
     * request, and the rest of the request run in its scope — so a function,
     * a hook or a callback it reaches sees this backend as `rebase`, however
     * many backends the process holds.
     *
     * `ownScope` is declared further down, once the in-process client exists.
     * No request reaches a group before then: an application mounts the groups
     * through the backend this function returns, and the in-process app the
     * client dispatches into is declared further down still.
     */
    const provideServices: MiddlewareHandler<HonoEnv> = async (c, next) => {
        c.set("services", services);
        return runInBackendScope(ownScope, next);
    };

    // 3. Initialize Storage
    const { storageRegistry, storageController } = await initializeStorage(config.storage, isProduction);

    // 4. The auth adapter, and the routers it contributes.
    //
    // ── Auth Capabilities Endpoint ───────────────────────────────────────
    // Exposes adapter capabilities so the frontend knows what's available
    // (login form vs external redirect, OAuth providers, etc.)
    //
    // Rate-limited like the rest of the unauthenticated auth surface: it is
    // public and it counts users on every call, so an uncapped caller can make
    // a login screen's cheapest request the backend's busiest query. This is
    // the *only* handler for the path — the auth router used to carry a second
    // copy that this registration shadowed, returning a different shape.
    //
    // It also says whether storage is configured. The admin panel reads this
    // document on every load, so the flag spares it asking `/storage/sources`
    // on a deployment with no bucket.
    //
    // Part of the auth group like every other `/auth` route: a process that
    // serves no sign-in (a `functions` or `worker` role) has no login screen to
    // describe, and no ingress sends it that traffic.
    const authConfigHandler: MiddlewareHandler<HonoEnv> = async (c) => {
        const capabilities = await authAdapter!.getCapabilities();
        return c.json({
            ...capabilities,
            storage: Boolean(storageRegistry || storageController)
        } satisfies AuthConfigDocument);
    };

    // The adapter's own routers. Its contract returns the structural
    // `MountableRouter` (a `fetch` and a `routes` array) rather than `Hono`, so
    // that `@rebasepro/types` needs no hono dependency — that single `import
    // type` was putting a server framework into every browser app's lockfile.
    // `.route()` wants the concrete class, and this package genuinely depends
    // on hono, so the narrowing happens here, once. The shape is duck-checked
    // rather than trusted, because an adapter is third-party code.
    const adapterRouter = (router: MountableRouter, kind: string): Hono<HonoEnv> => {
        if (typeof router.fetch !== "function" || !Array.isArray(router.routes)) {
            throw new Error(
                `Auth adapter "${authAdapter?.id}" returned something that is not a mountable router `
                + `from create${kind}Routes(): expected an object with a \`fetch\` method and a \`routes\` `
                + "array, which is what Hono and every router like it provides."
            );
        }
        return router as Hono<HonoEnv>;
    };
    let adapterAuthRouter: Hono<HonoEnv> | undefined;
    let adapterAdminRouter: Hono<HonoEnv> | undefined;

    if (config.auth) {
        if (!isAuthAdapter(config.auth)) {
            const safeAuthConfig = config.auth as RebaseAuthConfig;
            const oauthProviders: OAuthProvider<unknown>[] = [...(safeAuthConfig.providers || [])];

            // Resolve configured OAuth providers via data-driven registration.
            // Each entry maps a config key to its factory function name and required fields.
            // `factory` is a key of the auth module, not a `string`.
            //
            // Twelve names were listed here as bare strings and looked up with
            // `authModule as unknown as Record<string, …>`, which tied them to
            // nothing: rename or misspell one and `createFn` is `undefined` and
            // the boot dies on "createFn is not a function", naming neither the
            // provider nor the export. The template literal keeps the union to
            // the provider factories rather than every export of the module.
            type ProviderFactory = Extract<keyof typeof import("../auth"), `create${string}Provider`>;
            const OAUTH_PROVIDERS: Array<{
                key: keyof RebaseAuthConfig;
                factory: ProviderFactory;
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
                    const authModule = await import("../auth");
                    // The *name* is checked (see `ProviderFactory` above); the
                    // call is not. Each factory declares its own config shape,
                    // so indexing by a runtime name gives a union of twelve
                    // signatures, and calling a union intersects its parameters
                    // into something no single provider's config satisfies. The
                    // shapes are validated by `requiredFields` a line above.
                    const createFn = authModule[factory] as (cfg: Record<string, unknown>) => OAuthProvider<unknown>;
                    oauthProviders.push(createFn(providerConfig));
                }
            }

            // Re-create the built-in adapter with all resolved OAuth providers
            const reCollectionAuth = safeAuthConfig.collection ? safeAuthConfig.collection.auth : undefined;
            const collectionAuthConfig = (typeof reCollectionAuth === "object" && reCollectionAuth !== null) ? reCollectionAuth : undefined;
            authAdapter = createBuiltinAuthAdapter({
                authRepository: authConfigResult!.authRepository as import("../auth/interfaces").AuthRepository ?? authConfigResult!.userService as import("../auth/interfaces").AuthRepository,
                // This backend's keys, limits and roles — the adapter signs,
                // verifies and judges for it alone.
                jwt,
                limiters: authLimiters,
                access,
                emailService: authConfigResult!.emailService as import("../email").EmailService,
                emailConfig: safeAuthConfig.email,
                allowRegistration: safeAuthConfig.allowRegistration ?? false,
                disableSelfRegistration: safeAuthConfig.disableSelfRegistration ?? false,
                allowAnonymous: safeAuthConfig.allowAnonymous ?? false,
                allowUserLookup: safeAuthConfig.allowUserLookup ?? false,
                captcha: safeAuthConfig.captcha,
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
                enableEmailOtp: safeAuthConfig.emailOtp ?? false,
                cookieAuth: safeAuthConfig.cookieAuth,
                requireEmailVerification: safeAuthConfig.requireEmailVerification ?? false,
                refreshTokenReuseIntervalSeconds: safeAuthConfig.refreshTokenReuseIntervalSeconds,
                refreshTokenReuse: safeAuthConfig.refreshTokenReuse,
                magicLinkCreatesUsers: safeAuthConfig.magicLinkCreatesUsers ?? false
            });

            // A requirement nobody can meet is a backend nobody can sign in
            // to by password. Refused here, where it names the setting, rather
            // than discovered when the first registrant waits for a mail.
            if (safeAuthConfig.requireEmailVerification
                && !(authConfigResult!.emailService as import("../email").EmailService | undefined)?.isConfigured()) {
                throw new Error(
                    "auth.requireEmailVerification is on, but no email service is configured, so no address could ever be " +
                    "verified and nobody could sign in with a password. Configure auth.email (SMTP_* or the email settings), " +
                    "or turn requireEmailVerification off."
                );
            }

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

        if (authAdapter && authAdapter.createAuthRoutes && surfaces.auth) {
            const authRoutes = authAdapter.createAuthRoutes();
            if (authRoutes) adapterAuthRouter = adapterRouter(authRoutes, "Auth");
        }

        if (authAdapter && authAdapter.createAdminRoutes && surfaces.admin) {
            const adminRoutes = authAdapter.createAdminRoutes();
            if (adminRoutes) adapterAdminRouter = adapterRouter(adminRoutes, "Admin");
        }

        // ── The operator's own account, before anyone can race them to it ──
        //
        // A fresh deployment's user table is empty, and the registration policy
        // admits the first registration and makes it an admin — because
        // otherwise an empty database can never produce the authenticated
        // caller that `POST /admin/bootstrap` needs. That is fine on a laptop
        // and a race on anything with a hostname. Naming the first account in
        // the environment is what lets an artifact ship with self-registration
        // off and still be reachable by the person who deployed it.
        //
        // Which makes this the production half of one contract, and it only acts
        // there: `rebase dev` reads the same `.env` the compose stack does, so
        // an unconditional seed spent the window before the developer had opened
        // the app, and the documented first sign-up produced a role-less
        // account. `seedInitialAdmin` announces the variables and declines while
        // the window is open.
        //
        // Awaited, so the account exists before the server accepts a request.
        // A write, so only a backend allowed to change the database makes it.
        // See ./auth/seed-admin.
        if (provision.database) await seedInitialAdmin(authAdapter?.userManagement);
    }

    // ── MCP ──────────────────────────────────────────────────────────────
    //
    // `/mcp` lets an AI client — Claude, an IDE, an agent — read and write this
    // project **as the person who authorized it**, with every row filtered by
    // that person's own RLS policies. See `mcp/mcp-tools.ts`.
    //
    // Three preconditions, each of which declines rather than degrades:
    //
    //  1. `REBASE_PUBLIC_URL` must be set. Every document this surface serves
    //     names absolute URLs, and the token audience is one of them. The
    //     alternative — deriving the origin from the `Host` header — makes the
    //     issuer identity a thing the caller supplies, and a resource server
    //     whose audience check reads its expected value out of the request is
    //     not performing an audience check. So: configured, or absent.
    //  2. The driver must support `withAuth()`. `scopeDataDriver` returns the
    //     driver UNSCOPED when it does not, which is correct for `/api/data`
    //     (Mongo has no RLS and never claimed to) and catastrophic here, where
    //     it would silently turn "acts as you" into "acts as the database
    //     owner". Refusing to mount is the only safe reading.
    //  3. The store must have somewhere to keep clients and codes.
    //
    // Nothing about this is on by default: `surfaces.mcp` is opt-in, because a
    // project that has not thought about agent access should not be answering
    // agents.
    //
    // Prepared here — the checks, and the tables — and mounted by `mount()`,
    // because its documents name the URLs of the auth and OAuth routes, and
    // only a mount knows where those are.
    let mcpReady: { store: OAuthStore; publicUrl: string } | undefined;
    if (surfaces.mcp) {
        const publicUrl = process.env.REBASE_PUBLIC_URL;
        const driver = defaultDriver;
        if (!publicUrl) {
            logger.warn("[mcp] Surface enabled but REBASE_PUBLIC_URL is not set — not mounting. " +
                "Set it to this deployment's externally reachable origin, e.g. https://app.example.com");
        } else if (!jwt.isConfigured()) {
            logger.warn("[mcp] Surface enabled but no JWT secret is configured — not mounting.");
        } else if (!driver || !supportsRlsScoping(driver)) {
            logger.error("[mcp] Surface enabled but this data driver cannot scope by user — not mounting. " +
                "Every MCP call must run under the caller's own row-level security; a driver without " +
                "`withAuth()` would run them as the database owner instead.");
        } else {
            const store = createOAuthStore(driver);
            if (!store) {
                logger.error("[mcp] Surface enabled but the driver cannot persist OAuth state — not mounting.");
            } else {
                // `ensureTables` verifies its own work and throws when the
                // tables are not there. Caught here rather than left to reach
                // the boot, because this is one opt-in surface: an operator who
                // switched on `mcp` should get a server that runs everything
                // else and one loud line explaining what did not mount, not a
                // process that refuses to start. A backend that provisions
                // nothing leaves the tables to whoever does.
                let ready = true;
                if (provision.database) {
                    try {
                        await store.ensureTables();
                    } catch (error) {
                        ready = false;
                        logger.error("[mcp] Could not prepare the OAuth tables — not mounting.", { error });
                    }
                }
                if (ready) mcpReady = { store, publicUrl };
            }
        }
    }

    /**
     * Mount `/mcp`, its two `.well-known` documents and the OAuth server that
     * issues its tokens. `/mcp` and the documents sit at the origin, outside
     * `basePath`; the OAuth routes sit under it, beside `/auth`.
     */
    const mountMcp = (app: Hono<HonoEnv>, basePath: string, announce: boolean): void => {
        if (!mcpReady) return;
        const { store, publicUrl } = mcpReady;
        const mcpPath = "/mcp";
        const oauthBasePath = `${basePath}/oauth`;
        const mcpConfig = {
            // Tokens this backend's OAuth server minted, with its own key.
            jwt,
            publicUrl,
            mcpPath,
            oauthBasePath,
            getDriver: () => defaultDriver,
            // The RESOLVED set, not `config.collections` — a project that
            // declares its collections in a directory has an empty
            // `config.collections`, and the MCP client would be told this
            // project has no data at all.
            getCollections: () => activeCollections,
            // The write tools' door into the users table answers to the
            // adapter, as the REST routes and the socket do.
            getAuthAdapter: () => authAdapter,
            serverInfo: {
                name: "rebase",
                version: readRuntimeVersion([process.cwd()]) ?? "unknown"
            },
            // Mounted at the origin, outside `basePath`, so the server-wide
            // body limit and the data rate limiter do not reach it; it carries
            // both itself.
            maxBodySize: config.maxBodySize,
            rateLimit: rateLimitConfig,
            // A client configured with a header instead of an OAuth flow
            // presents a key; its `data:*` scopes decide which tools and
            // collections it reaches.
            resolveApiKey: apiKeyStore ? (token: string) => resolveApiKey(apiKeyStore, token, access) : undefined
        };

        app.route("/", createMcpWellKnownRoutes(mcpConfig));
        app.route(mcpPath, createMcpRoutes(mcpConfig));
        app.route(oauthBasePath, createOAuthRoutes({
            store,
            jwt,
            publicUrl,
            mcpPath,
            authBasePath: `${basePath}/auth`,
            // Open registration is what makes the Claude connector flow work at
            // all — there is nobody to hand a client ID to in advance. A
            // deployment that would rather pre-register can switch it off and
            // issue IDs itself — with any spelling of no; `!== "false"` left it
            // open on `=0`.
            allowDynamicRegistration: parseEnvBoolean(process.env.REBASE_MCP_OPEN_REGISTRATION) !== false,
            // The repository the admin gate re-reads from, so a grant answers
            // to the same revocation, roles and account a session does — at
            // consent and every refresh.
            identity: grantIdentityFromRepository(adminIdentityRepo)
        }));

        if (announce) logger.info(`MCP endpoint mounted at ${publicUrl}${mcpPath} (OAuth at ${oauthBasePath})`);
    };

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
    /**
     * The admin gate itself: an `rk_` key, an `rpt_` platform token, the
     * service key, or a person's token — roles and revocation read from the
     * database, never off the token — and then the surface's scope. One scope
     * for a surface whose every route needs the same thing; a `read`/`write` pair for one whose
     * reads and writes split along the HTTP method. {@link applyAdminGate} puts
     * it on a router; a surface mounted on a single path (the contract, the
     * private docs) takes the same list.
     */
    type SurfaceScopes = AdminScope | { read: AdminScope; write: AdminScope };
    const adminGate = (scopes: SurfaceScopes): MiddlewareHandler<HonoEnv>[] => [
        // This backend's keys and roles judge the caller, wherever the gate is
        // mounted — the docs route sits outside every group.
        provideServices,
        ...(apiKeyPreAuth ? [apiKeyPreAuth] : []),
        platformTokenPreAuth,
        createRequireAuth({ serviceKey: internalServiceKey, ...adminGateIdentity }),
        typeof scopes === "string" ? requireScope(scopes) : requireScopeByMethod(scopes)
    ];
    const applyAdminGate = (router: Hono<HonoEnv>, surface: string, scopes: SurfaceScopes): void => {
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
        router.use("/*", ...adminGate(scopes));
    };

    /** Where a server with no editable source of its own can still edit collections. */
    const LIVE_SCHEMA_REPOSITORY_HINT = "To edit collections from a deployment, name a repository to commit " +
        "them to: `liveSchema.repository`, or REBASE_LIVE_SCHEMA_REPOSITORY for a built bundle.";

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
        // A built bundle lands here: its runtime passes `schemaEditor: false`.
        // The second sentence is how its operator finds the opt-in.
        if (config.schemaEditor === false) return {
            code: "SCHEMA_EDITOR_DISABLED",
            message: "The schema editor is turned off for this server (`schemaEditor: false`). " +
                LIVE_SCHEMA_REPOSITORY_HINT
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
                "deploy, so an edit here would be discarded. Edit collections in development and deploy. " +
                LIVE_SCHEMA_REPOSITORY_HINT
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
    // The one editor of `collectionsDir` in this process, shared by the
    // source-only editor's routes and live schema editing's `/apply`.
    let schemaSourceEditor: SchemaSourceEditor | undefined;

    if (!schemaEditorOff && config.collectionsDir) {
        // ts-morph is an optional peer dependency, so it can legitimately be
        // absent — run without the schema editor instead of failing startup.
        try {
            const editorModule = await import("../api/schema-editor-routes");
            schemaSourceEditor = editorModule.createSchemaSourceEditor(config.collectionsDir);
            schemaEditorRoutes = editorModule.createSchemaEditorRoutes(schemaSourceEditor);
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

    // The two schema surfaces of the admin group: `/schema` (live editing)
    // and `/schema-editor` (source-only editing).
    let liveSchemaSurface: Hono<HonoEnv> | undefined;
    let schemaEditorSurface: Hono<HonoEnv> | undefined;

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

        applyAdminGate(schemaEditorRouter, "Schema editor", { read: "schema:read", write: "schema:write" });

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

        // ── Live schema editing ───────────────────────────────────────────
        // Two write paths. Without a configured repository, writing goes
        // through the source-only editor above, so live editing is on exactly
        // where that editor is: a `collectionsDir` on disk, `schemaEditor` not
        // false, and NODE_ENV other than production unless `schemaEditor:
        // true`.
        //
        // With `liveSchema.repository`, the write never touches this machine's
        // files: the collection files are fetched, rewritten in a scratch
        // directory and committed back. That path does not depend on the
        // source-only editor's gate — a built bundle boots with `schemaEditor:
        // false` under production, and the repository is how one opts in. It
        // needs only `ts-morph`, checked below so `/status` can name it.
        //
        // Mounted either way; the routes themselves decide what is possible, so
        // the reason a change is refused arrives as a message rather than as a
        // missing endpoint. Without a `collectionsDir` the surface still
        // answers, because it lives under `/api/admin` and an unmounted path
        // there is caught by the admin gate in front of it — which would reply
        // 401 to an operator whose actual problem is an unconfigured
        // `collectionsDir`. Being told the wrong thing is worse than a 404, and
        // both are worse than being told.
        // With a configured repository the collection file is fetched,
        // rewritten and committed back through the Git Data API instead of the
        // local working tree.
        const remoteRepo = config.liveSchema?.repository;
        const canEditSchema = Boolean(config.collectionsDir) || Boolean(remoteRepo);

        // The remote write path's one dependency. Loaded at boot rather than on
        // the first apply, so a server without `ts-morph` says so on `/status`
        // instead of offering the control and failing when it is pressed.
        let remoteEditor: typeof import("../api/ast-schema-editor") | undefined;
        let remoteEditingOff: { code: string, message: string } | undefined;
        if (remoteRepo) {
            try {
                remoteEditor = await import("../api/ast-schema-editor");
            } catch (err) {
                if ((err as { code?: string })?.code !== "ERR_MODULE_NOT_FOUND") throw err;
                remoteEditingOff = {
                    code: "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                    message: "Live schema editing rewrites collection source with `ts-morph`, which is " +
                        "not installed on this server. Run `pnpm add -D ts-morph@28.0.0` to enable it."
                };
                logger.warn(`Live schema editing disabled: ${remoteEditingOff.message}`);
            }
            logger.info(`Live schema editing commits to ${remoteRepo.owner}/${remoteRepo.repo}` +
                ` (${remoteRepo.branch ?? "main"}, ${remoteRepo.collectionsPath ?? DEFAULT_COLLECTIONS_PATH}).`);
        }

        if (!canEditSchema) {
            const unconfigured = new Hono<HonoEnv>();
            applyAdminGate(unconfigured, "Live schema editing", "schema:read");
            unconfigured.all("/*", (c) => c.json({
                error: {
                    code: "SCHEMA_EDITING_NO_COLLECTIONS_DIR",
                    message: "Live schema editing needs `collectionsDir` — the directory holding " +
                        "this project's collection definitions — or `liveSchema.repository`, a " +
                        "repository to fetch them from. This server was started with neither, so " +
                        "there is nothing for it to edit."
                }
            }, 501));
            liveSchemaSurface = unconfigured;
        }

        if (canEditSchema) {
            const collectionsDir = config.collectionsDir;
            // Resolved once, at boot. A deployment either has a working tree or
            // it does not, and asking git on every request would spawn a
            // process for every plan the panel asks for.
            const repositoryRoot = collectionsDir
                ? await findRepositoryRoot(collectionsDir)
                : undefined;
            const liveSchemaRouter = new Hono<HonoEnv>();
            // A commit to the remote repository that this process is not
            // running yet. The generated schema files in a commit are built
            // from the collections this process serves, and a remote commit
            // does not change those until it is deployed — so a second change
            // before then would commit generated files that leave the first
            // one out. Set only once a commit has landed.
            let undeployedCommit: string | undefined;
            // `apply` additionally needs `schema:write` — checked on its route.
            applyAdminGate(liveSchemaRouter, "Live schema editing", "schema:read");

            // Correct for a project in a subdirectory: the generated-artifact
            // paths are relative to the *project*, and the repository resolves
            // them against its own root. Those coincide only in a scaffold.
            // A remote repository states its own layout, because nothing on
            // this machine can be walked up from to discover it.
            const commitPaths = remoteRepo
                ? commitPathsFor(
                    nodePath.join("/", remoteRepo.collectionsPath ?? DEFAULT_COLLECTIONS_PATH),
                    "/"
                )
                : (collectionsDir && repositoryRoot)
                    ? commitPathsFor(collectionsDir, repositoryRoot)
                    : undefined;
            if (commitPaths) {
                logger.debug("Live schema editing commit paths relocated", { commitPaths });
            }

            liveSchemaRouter.route("/", createLiveSchemaRoutes({
                commitPaths,
                // The reason source editing is off, when it is — carried across
                // rather than inferred.
                //
                // The two aliases of this status disagreed, and the admin calls
                // both on every page load: `/api/schema-editor/status` said
                // `SCHEMA_EDITOR_DISABLED` while `/api/admin/schema/status`
                // said `SCHEMA_EDITOR_MISSING_DEPENDENCY` and named `ts-morph`
                // — on a server where `ts-morph` resolves. `writeSource` is
                // only set when the editor routes were built, which is skipped
                // for *every* `schemaEditorOff` reason, so all of them were
                // reported as the missing dependency. One reason, the true one.
                //
                // With a repository the source-only editor's reasons do not
                // apply — that path never uses it — so only its own does.
                sourceEditingOff: remoteRepo ? remoteEditingOff : schemaEditorOff,
                // Only answerable for a project on this machine. A deployment
                // committing to a remote repository is a built bundle, which is
                // provisioned by boot-ensure rather than by replaying
                // migrations, so the question does not arise there.
                usesVersionedMigrations: collectionsDir
                    ? () => usesVersionedMigrations(collectionsDir)
                    : undefined,
                // Off unless the project says otherwise. An automated schema
                // change is a legitimate thing to want and a poor default:
                // the credential that would make it is the one most likely to
                // be sitting in a CI environment variable.
                policy: {
                    allowMachineApply: config.liveSchema?.allowMachineApply
                        ?? parseEnvBoolean(process.env.REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY) === true
                },
                getCollections: () => collectionRegistry.getRawCollections(),
                getAdmin: () => defaultDriver.admin,
                // The token on the request names the uid only; the commit is
                // authored by the account's name and address.
                resolveAuthorIdentity: (uid) => readAccountIdentity(authAdapter, uid),
                getRepository: (author) => {
                    // A configured repository wins: a deployment that names one
                    // means its source is *there*, even when a working tree
                    // happens to exist beside the running process.
                    if (remoteRepo) {
                        const repository = createGitHubRepository({
                            auth: remoteRepo.auth,
                            owner: remoteRepo.owner,
                            repo: remoteRepo.repo,
                            branch: remoteRepo.branch ?? "main",
                            author
                        });
                        return {
                            ...repository,
                            commit: async (paths, message) => {
                                const sha = await repository.commit(paths, message);
                                undeployedCommit = sha;
                                return sha;
                            }
                        };
                    }
                    if (!repositoryRoot) return undefined;
                    return createLocalGitRepository({ root: repositoryRoot, author });
                },
                // Absent, not throwing, when the AST editor is unavailable.
                //
                // A function that exists and throws made `/status` answer
                // `enabled: true` — it can only see whether the field is set —
                // and then `/apply` died with a 500 the moment somebody
                // confirmed. Leaving it undefined is the same fact stated where
                // both surfaces can read it: `/status` reports
                // `SCHEMA_EDITOR_MISSING_DEPENDENCY`, the panel never offers the
                // control, and a caller that asks anyway gets a refusal that
                // names the missing dependency.
                writeSource: remoteRepo
                    ? (remoteEditor ? async (change) => {
                        // No source on this machine: fetch the collections
                        // directory, rewrite it in a scratch directory, hand
                        // back what changed. The edit is applied the one way it
                        // is implemented (`editCollectionSource`, or the
                        // editor's own deletion) — a second implementation of
                        // keeping a collection file's imports, comments and
                        // formatting for the remote case would be a second
                        // thing to get wrong.
                        if (undeployedCommit) {
                            throw new Error(
                                `This deployment already committed a schema change (${undeployedCommit.slice(0, 9)}) ` +
                                "that it is not running yet. Deploy that commit, then make the next change: " +
                                "until then a change here is planned against the collections this deployment " +
                                "runs, and its generated schema files would leave the first change out. " +
                                "Nothing was changed."
                            );
                        }
                        const { AstSchemaEditor } = remoteEditor!;
                        return rewriteRemoteCollection(
                            {
                                repository: createGitHubRepository({
                                    auth: remoteRepo.auth,
                                    owner: remoteRepo.owner,
                                    repo: remoteRepo.repo,
                                    branch: remoteRepo.branch ?? "main"
                                }),
                                collectionsPath: remoteRepo.collectionsPath ?? DEFAULT_COLLECTIONS_PATH,
                                edit: async (dir, collectionId, edit: typeof change) => {
                                    const editor = new AstSchemaEditor(dir);
                                    if (edit.remove) await editor.deleteCollection(collectionId);
                                    else await editCollectionSource(editor, collectionId, edit);
                                }
                            },
                            change.collectionId,
                            change
                        );
                    } : undefined)
                    : schemaSourceEditor ? async (change) => {
                        // This machine's source: through the process's editor,
                        // queued behind any edit already running in either router.
                        return writeLocalCollectionSource(
                            schemaSourceEditor,
                            { collectionsDir: collectionsDir!, repositoryRoot: repositoryRoot! },
                            change
                        );
                    } : undefined,
                // The same path `writeSource` resolves, derived without writing
                // anything — the dirty-tree check has to know it before the
                // edit, or it sees this change's own file and refuses.
                sourcePathsFor: (change) => {
                    if (remoteRepo) {
                        const dir = (remoteRepo.collectionsPath ?? DEFAULT_COLLECTIONS_PATH)
                            .replace(/\/+$/, "");
                        return [
                            `${dir}/${change.collectionId}.ts`,
                            ...(change.remove ? [`${dir}/index.ts`] : [])
                        ];
                    }
                    if (!collectionsDir || !repositoryRoot) return [];
                    return [
                        nodePath.relative(repositoryRoot, nodePath.join(collectionsDir, `${change.collectionId}.ts`)),
                        // A removal edits the directory's index too.
                        ...(change.remove ? [nodePath.relative(repositoryRoot, nodePath.join(collectionsDir, "index.ts"))] : [])
                    ];
                }
            }));

            // Admin-only, so it lives under `/api/admin` — see
            // `docs/api-conventions.md`. It has never shipped anywhere else, so
            // there is no legacy path to keep alive.
            liveSchemaSurface = liveSchemaRouter;
            logger.debug("Live schema editing repository", {
                repository: repositoryRoot ?? "(none — refusals only)"
            });
        }

        // A sibling of `/admin/schema`, not a child of it. Nested, every
        // request here would first pass the live editor's `use("/*")` gate —
        // harmless while that gate calls `next()`, and a silent hijack the
        // moment it does not: with no auth configured it answers 501 itself,
        // and this surface's requests would come back describing the wrong
        // one. Siblings cannot shadow each other.
        //
        // `/api/schema-editor` is the shipped path and stays reachable, with a
        // `Deprecation` header, until a major — `mount()` serves the alias.
        schemaEditorSurface = schemaEditorRouter;
        if (!schemaEditorRoutes) {
            logger.debug("Schema Editor unavailable", { code: schemaEditorOff!.code });
        }
    }

    // Filled in once the native data plane exists (below). The storage
    // authorize hook needs trusted reads to answer "who owns this object?", and
    // it cannot import the server itself — it is declared in the project's
    // config package, which depends on `@rebasepro/types` alone.
    const storageAuthorizeData: { current?: import("@rebasepro/types").StorageAuthorizeData } = {};

    // The storage group (the routes, or the stub that says storage is off),
    // and the admin group's storage maintenance surface.
    let storageSurface: Hono<HonoEnv>;
    let storageMaintenanceSurface: Hono<HonoEnv> | undefined;
    /** Whether the storage group carries its own upload body limit, in place of the global one. */
    let storageCarriesUploadLimit = false;

    // Served whenever any source is live, not only a default one. Production
    // drops a `local` default and keeps the named buckets that are bound; the
    // routes serve those and answer a request that names no source with
    // STORAGE_NOT_CONFIGURED, where the stub below would refuse all of them.
    if (storageRegistry || storageController) {
        // `POST /upload` gets its own body limit, the storage config's
        // maxFileSize (default 50MB), in place of the global API body limit.
        // "In place of" takes the exemption at the mount below. Without it,
        // both limits run and the smaller one always wins, so the global 10MB
        // refused every upload above it.
        //
        // With several sources it is the largest of their limits — the route
        // holds each source to its own — read from the controllers themselves.
        // It used to be read from a single-source config only, and the boot
        // path always passes a map, so every booted project got 50 MB whatever
        // its sources said.
        const sourceLimits = (storageRegistry
            ? storageRegistry.list().map(key => storageRegistry.get(key))
            : [storageController]
        ).flatMap(c => {
            const limit = c?.maxFileSize?.();
            return typeof limit === "number" ? [limit] : [];
        });
        const storageMaxSize = sourceLimits.length > 0
            ? Math.max(...sourceLimits)
            : (
                config.storage && typeof config.storage === "object" && "type" in config.storage
                    ? (config.storage as BackendStorageConfig).maxFileSize
                    : undefined
            ) ?? DEFAULT_MAX_FILE_SIZE;

        // Storage is not under RLS and its keys share one flat namespace, so an
        // allow-all default is a cross-user read/write/delete hole. Refuse to
        // boot in production unless the deployment has stated an access-control
        // intent (a hook, public-read, or the explicit insecure opt-out); warn
        // loudly in development.
        // Compiled before the guard runs, so a malformed pattern fails the boot
        // here rather than on the first upload.
        const storageAccessControl = resolveStorageAccessControl({
            storagePolicies: config.storagePolicies,
            storageAuthorize: config.storageAuthorize,
            // `storagePublicRead` alone satisfies the guard below but only
            // relaxes the READ gate, leaving write/delete/list on the global
            // requireAuth — which is off on precisely the public-site
            // configuration this flag is for. See publicReadOnlyAuthorize.
            storagePublicRead: config.storagePublicRead === true
        });

        assertStorageAccessControlConfigured(
            {
                hasAuthorize: !!config.storageAuthorize || !!config.storagePolicies?.length,
                publicRead: config.storagePublicRead === true,
                allowAnyAuthenticated: config.storageInsecureAllowAnyAuthenticated === true
            },
            isProduction
        );

        // `rebase storage orphans` and `rebase storage move`: every object of a
        // source against every row, and copies between sources. Whole-store
        // operations past every storage policy, so admin-only: reading every
        // row is `database:read`, deleting or copying files `database:write`.
        if (surfaces.admin) {
            const maintenanceRouter = new Hono<HonoEnv>();
            applyAdminGate(maintenanceRouter, "Storage maintenance", { read: "database:read", write: "database:write" });
            maintenanceRouter.route("/", createStorageMaintenanceRoutes({
                registry: storageRegistry,
                controller: storageController,
                collections: () => collectionRegistry.getRawCollections(),
                // Unscoped: a row a policy hides from the admin still names its files.
                driverFor: (collection) => {
                    const key = resolveDataSource(collection, dataSourceRegistry).key;
                    return !key || key === DEFAULT_DRIVER_ID ? defaultDriver : driverRegistry.get(key);
                }
            }));
            storageMaintenanceSurface = maintenanceRouter;
        }

        const storageRoutes = createStorageRoutes({
            controller: storageController,
            registry: storageRegistry,
            sources: declaredStorageSources.length > 0 ? declaredStorageSources : undefined,
            requireAuth: resolveRequireAuth(config.auth),
            publicRead: config.storagePublicRead === true,
            authAdapter,
            authorize: storageAccessControl,
            // Resolved lazily: the admin data plane is built further down, well
            // after these routes are mounted, but always before a request runs.
            authorizeData: () => storageAuthorizeData.current,
            renditionCache: config.storageRenditionCache,
            downloadTokenTtlSeconds: config.storageDownloadTokenTtl,
            triggers: config.storageTriggers,
            // The same number the upload route's body limit is derived from.
            // The resumable route only has the global limit in front of it,
            // and that caps each chunk, not the file: a chunked upload is many
            // small bodies. So it has to be told the file limit.
            maxFileSize: storageMaxSize,
            // Per-property `maxSize` / `acceptedFiles`, resolved from the
            // registry rather than from the request: the limits have to be the
            // server's, or a caller could send their own alongside the file.
            // Read lazily so a collection registered after this point (the
            // introspected ones) is still covered.
            uploadConstraints: (slug, property) =>
                createUploadConstraintResolver(collectionRegistry.getRawCollections())(slug, property),
            // And the same limits by where the file lands: every upload into a
            // property's `storagePath` meets them, whether or not it names the
            // property. Compiled once per collection list.
            uploadPathConstraints: (storageId, key) =>
                createUploadPathResolver(collectionRegistry.getRawCollections())(storageId, key)
        });

        // Wrapper router: middleware must be registered BEFORE the routes it
        // guards — Hono composes handlers in registration order, so a `use()`
        // issued after `createStorageRoutes()` has registered its handlers
        // sits deeper than them and never runs. The previous
        // `storageRoutes.use("/upload", bodyLimit)` was exactly that: dead
        // code, leaving uploads without any size cap.
        const storageRouter = new Hono<HonoEnv>();

        // API keys on storage: authenticate `rk_` tokens here; the storage
        // scope for each operation is checked where the route has resolved the
        // source it addresses (`checkAuthorized`), and the resumable-upload
        // steps that follow a create need `storage:write`.
        if (apiKeyPreAuth) {
            storageRouter.use("/*", apiKeyPreAuth);
        }
        storageRouter.use("/*", createTusScopeGuard());

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
            // A batched `POST /metadata` of N keys counts as ⌈N/10⌉ requests.
            storageRouter.use("/*", createDataRateLimiter(rateLimitConfig, { cost: storageRateLimitCost }));
        }

        // The upload endpoint's own body limit. The same path is exempted from
        // the global limit where `mount()` mounts the router.
        storageRouter.use(STORAGE_UPLOAD_PATH, bodyLimit({
            maxSize: storageMaxSize,
            onError: (c) => errorHandler(
                new ApiError(
                    413,
                    "PAYLOAD_TOO_LARGE",
                    `File too large. Maximum upload size is ${formatByteSize(storageMaxSize)}.`
                ),
                c
            ) as Response
        }));

        storageRouter.route("/", storageRoutes);
        // Only the HTTP surface is optional. The controller, the registry and
        // the access-control boot guard above are not: a process that serves no
        // storage routes still hands `rebase.storage` to every function it runs.
        storageSurface = storageRouter;
        storageCarriesUploadLimit = true;
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
        // Listing the sources is a question, not a use of storage: the answer is
        // "none", and it is a 200, so a client that asks on every page load
        // does not put an ERROR in the logs each time.
        storageStub.get("/sources", (c) => c.json({ data: [], configured: false }));
        storageStub.all("/*", (c) => c.json({
            error: {
                message: "File storage is not configured on this deployment, so uploads and " +
                    "downloads are disabled. Configure a storage backend (STORAGE_TYPE=s3 or " +
                    "STORAGE_TYPE=gcs plus its bucket and credentials) and redeploy.",
                code: "STORAGE_NOT_CONFIGURED"
            }
        }, 501));
        storageSurface = storageStub;
    }

    // Only the server-mediated collections get a backend surface. Collections
    // on a direct/custom transport are client-only — the backend must not
    // expose a (mis-engined) endpoint for them, nor *document* one: the routes
    // were filtered and the OpenAPI document was not, so the one collection the
    // backend deliberately refuses to serve was the one it advertised hardest.
    const serverCollections = activeCollections.filter(
        (collection) => resolveDataSource(collection, dataSourceRegistry).transport === "server"
    );

    // The data group: the REST routes, or the stub that says there are none.
    let dataSurface: Hono<HonoEnv>;
    if (activeCollections.length > 0) {
        const dataRouter = new Hono<HonoEnv>();
        dataRouter.onError(errorHandler);
        // First, so everything after it knows where the group is mounted.
        dataRouter.use("/*", recordMountPath());

        // Read `x-rebase-schema`, which a generated SDK has been sending for a
        // while and nothing has ever read. It refuses nothing — see
        // `createSchemaDriftDetector` — it only lets the error handler say
        // "this client was generated against an older schema" on a 400 or 404
        // that was going to be returned regardless. Registered before
        // `route("/")`, because a `use()` added after the routes never runs.
        //
        // `config.schemaVersion` is what the bundle recorded at build time and
        // is what `/api/meta/contract` serves; a `baas` project has none, so the
        // stamp is computed from the collections introspection found — the same
        // input and the same function the contract route uses, so the two
        // cannot answer differently.
        dataRouter.use("/*", createSchemaDriftDetector(() =>
            config.schemaVersion ?? computeSchemaVersion(collectionRegistry.getRawCollections())));

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
        //
        // The collection path is what follows the group's mount — wherever the
        // application mounted it, which the group recorded on the request.
        const resolveRequestDriver = (c: Context<HonoEnv>): DataDriver => {
            const mountPath = c.get("mountPath") ?? "";
            const collectionPath = c.req.path.startsWith(mountPath) ? c.req.path.slice(mountPath.length) : c.req.path;
            const key = keyForCollectionPath(collectionPath);
            // Use the authoritative default for the default key; otherwise the
            // named delegate, falling back to default if it isn't registered.
            if (!key || key === DEFAULT_DRIVER_ID) return defaultDriver;
            return driverRegistry.get(key) ?? defaultDriver;
        };
        const multiEngine = bootstrappers.length > 1;
        const resolveDriver = multiEngine ? resolveRequestDriver : undefined;

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
        dataSurface = dataRouter;
    } else {
        // No collections and no tables to derive them from — the state a fresh
        // `--headless` project starts in, since it declares nothing and the
        // database is empty — or tables the driver would not serve, because
        // row-level security is off on every one; then the answer names them.
        //
        // Without this the data surface is simply absent, so Hono's default
        // answers: a bare `404 Not Found` in `text/plain`. That reads as a typo
        // in the URL and sends the reader to check their path, when the truth is
        // that the server is working and there is nothing to serve yet. Every
        // other error this API returns is JSON, so a client parsing the body
        // gets a surprise on top.
        //
        // 404, not 501: the collection genuinely does not exist, and unlike
        // storage this resolves by creating a table rather than by configuring
        // the deployment. Same reasoning as `storageStub` above, different verb.
        const emptyDataStub = new Hono<HonoEnv>();
        const emptyDataAnswer = {
            error: {
                message: `This project serves no collections yet. ${noCollectionsCause(unprotectedTables)}`,
                code: "NO_COLLECTIONS",
                ...(unprotectedTables.length > 0 && {
                    details: { unprotectedTables: unprotectedTables.map(({ schema, table }) => `${schema}.${table}`) }
                })
            }
        };
        emptyDataStub.all("/*", (c) => c.json(emptyDataAnswer, 404));
        dataSurface = emptyDataStub;
    }

    // ── OpenAPI / Swagger ─────────────────────────────────────────────────
    // Follows the data surface: the document describes the collection routes, so
    // a process that does not serve them would publish a spec for URLs it 404s.
    // The generator is loaded here; the routes are `mount()`'s, because the
    // document names the paths it mounted the data group at.
    const openApiGenerator: OpenApiGenerator | undefined = surfaces.data && serverCollections.length > 0
        ? await loadOpenApiGenerator()
        : undefined;

    // ─── Server-side singleton ────────────────────────────────────────────
    // Build the RebaseClient for control-plane APIs (auth, admin, storage,
    // functions, cron). These route through this backend's own routes because
    // they genuinely need route dispatch + middleware — the in-process app
    // `fetch` serves, not the application's, so they answer the same wherever
    // (or whether) the application mounted anything.
    // `rebase.data` is replaced below with a native driver-backed data plane.
    const serverClient = createRebaseClient({
        baseUrl: "http://localhost",
        apiPath: IN_PROCESS_BASE_PATH,
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
            return await inProcessApp().request(input as string | Request | URL, init);
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
    // `rebase.dataAsAdmin.myNotes` is the collection whose generated accessor
    // is `myNotes`, whatever its slug's snake_case or its table is.
    const resolveAccessor = createAccessorSlugResolver(() => collectionRegistry.getCollections());
    const defaultData = buildSdkData(scopedDefaultDriver, { resolveAccessor });

    // Hand the storage authorize hook its trusted reader. Scoped as the service
    // identity, so an ownership lookup is not itself filtered by the caller's
    // permissions — the hook IS the permission decision.
    storageAuthorizeData.current = defaultData as import("@rebasepro/types").StorageAuthorizeData;

    // Multi-engine: scope and wrap each non-default delegate so
    // rebase.data on a non-default-engine collection reaches the correct driver.
    const dataSourcesByKey: Record<string, import("@rebasepro/types").RebaseSdkData> = {};
    for (const driverKey of driverRegistry.list()) {
        if (driverKey === DEFAULT_DRIVER_ID) continue;
        const delegate = driverRegistry.get(driverKey);
        if (!delegate) continue;
        const scopedDelegate = await scopeDataDriver(delegate, serviceIdentity);
        dataSourcesByKey[driverKey] = buildSdkData(scopedDelegate, { resolveAccessor });
    }

    const serverData = buildRoutedRebaseData({
        defaultData,
        sources: dataSourcesByKey,
        resolveKey: (slugOrPath: string) => keyForCollectionPath(slugOrPath),
        resolveAccessor
    });

    // Overwrite the HTTP-transport data proxy with the native driver-backed one.
    // The rest of the client (auth, admin, cron, functions, storage) keeps using
    // the HTTP transport, which is fine — they are low-frequency control-plane ops.
    //
    // `dataAsAdmin` is the admin accessor, and the only one `RebaseServerClient`
    // declares — `data` is `Omit`ted from the type so the privilege has to be
    // named at the call site.
    //
    // `data` is deleted rather than re-pointed. `createRebaseClient` above put an
    // HTTP-transport `data` on this object, and for a while the fix was to
    // overwrite it with the native plane — so `rebase.data` kept working in plain
    // JavaScript as a second name for the admin-scoped accessor. That is the
    // thing the type change was for: one name for a privileged plane, visible at
    // the call site. A hidden alias means untyped code can still reach it by the
    // name that reads user-scoped everywhere else. Removed, so `rebase.data` is
    // `undefined` in JavaScript as it is absent in TypeScript.
    Object.assign(serverClient, { dataAsAdmin: serverData });
    delete (serverClient as { data?: unknown }).data;
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
    // `rebase.bucket(media)`: the source a declared bucket names, by handle or
    // by key, straight to its controller. Refuses an unknown source by name
    // rather than handing back the default — a write that lands in the wrong
    // bucket is the failure that looks like success.
    // Installed unconditionally, like `email`: a backend with no storage at all
    // refuses by name instead of leaving the property undefined, where the
    // first sign of trouble is `rebase.bucket is not a function` at the call.
    Object.assign(serverClient, {
        bucket: (source: import("@rebasepro/types").ResourceRef) => {
            const key = resourceKeyOf(source);
            if (storageRegistry) {
                const found = storageRegistry.get(key);
                if (found) return found;
                throw new Error(
                    `No storage source "${key}" is configured on this backend. ` +
                    `Configured: ${storageRegistry.list().map(k => `"${k}"`).join(", ") || "(none)"}. ` +
                    "Declare it in config/resources.ts and bind it — `rebase status` shows which variable."
                );
            }
            if (storageController && key === DEFAULT_STORAGE_ID) return storageController;
            if (storageController) {
                throw new Error(`No storage source "${key}" is configured on this backend; only the default is.`);
            }
            throw new Error(
                `No storage source "${key}" is configured: this backend has no storage at all. ` +
                "Declare a bucket in config/resources.ts and bind it — `rebase status` shows which variable."
            );
        }
    });

    // Attach email service to the server client when configured.
    // The email service may come from the auth bootstrapper or from the auth config directly.
    let emailService: EmailService | undefined;
    if (authConfigResult?.emailService) {
        emailService = authConfigResult.emailService as EmailService;
    } else if (config.auth && !isAuthAdapter(config.auth) && (config.auth as RebaseAuthConfig).email) {
        emailService = createEmailService((config.auth as RebaseAuthConfig).email!);
    }

    // `RebaseServerClient` declares `email` as always present, so it has to be.
    // Left absent, a cron or a custom function calling `rebase.email.send` on a
    // backend without SMTP died on "Cannot read properties of undefined" — a
    // stack trace about a language feature rather than about the thing nobody
    // configured. The stand-in throws a sentence that names the fix, and reports
    // `isConfigured() === false`, so the auth routes that already check that keep
    // answering 503 rather than reaching it.
    {
        const attached = emailService ?? createUnconfiguredEmailService();
        Object.assign(serverClient, { email: attached });
        logger.debug("Email service attached to singleton", { configured: attached.isConfigured() });
    }

    // Attach raw SQL capability when the driver supports it (Postgres, MySQL).
    // Document databases (MongoDB, Firestore) won't have this.
    const driverAdmin = defaultBootstrapper.getAdmin?.(defaultDriverResult);
    if (isSQLAdmin(driverAdmin)) {
        Object.assign(serverClient, {
            sql: (query: string, sqlOptions?: { database?: import("@rebasepro/types").ResourceRef; role?: string; params?: unknown[] }) =>
                driverAdmin.executeSql(query, sqlOptions && {
                    role: sqlOptions.role,
                    params: sqlOptions.params,
                    ...(sqlOptions.database !== undefined ? { database: resourceKeyOf(sqlOptions.database) } : {})
                })
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
    // What `rebase` is inside this backend's scope: every request its groups
    // answer, every cron run and job it executes. Not the process's — that is
    // whichever backend `setDefaultBackend` installed.
    const ownScope: BackendScope = { rebase: serverSingleton };

    // Retroactively inject the server client into every source's driver so that
    // entity callbacks receive `context.client` at runtime — see
    // injectCallbackClient for why "every" and not only the default's.
    injectCallbackClient(driverResults.values(), serverClient);

    // 5. Custom Functions
    //
    // The functions group: this process's own functions, or the forwarder to
    // the process that serves them.
    let functionsSurface: Hono<HonoEnv> | undefined;
    // Gated on the surface before the loader runs, not after: importing a
    // project's function modules has side effects the author chose (a client
    // constructed at module scope, a connection opened), and a process that will
    // never serve them should not be paying for or triggering any of it.
    if ((config.functionsDir || config.functions) && surfaces.functions) {
        const { functionList, readFunctionsDirectory } = await import("../functions/function-loader");
        const { createFunctionRoutes } = await import("../functions/function-routes");
        const { createFunctionsRequestTimeout, resolveFunctionsTimeoutMs } = await import("../functions/request-timeout");

        // Values, or a directory read into exactly those values. Only the
        // directory can have files that failed to load.
        const { functions: functionRecord, problems } = config.functions
            ? { functions: config.functions, problems: [] }
            : await readFunctionsDirectory(config.functionsDir!);
        const allFunctions = functionList(functionRecord);

        // A subset, when this process was told to serve one. Applied after the
        // load rather than before it so an unknown name can be reported against
        // what the bundle actually contains — the list is the whole value of
        // that error message.
        const { selectFunctions } = await import("../functions/selection");
        const loadedFunctions = selectFunctions(allFunctions, config.functionsSelection);
        servedFunctionNames = loadedFunctions.map(fn => fn.name);
        if (loadedFunctions.length !== allFunctions.length) {
            logger.info("Serving a subset of this bundle's functions", {
                serving: loadedFunctions.map(fn => fn.name),
                notServing: allFunctions
                    .filter(fn => !loadedFunctions.includes(fn))
                    .map(fn => fn.name)
            });
        }

        // Mounted for the directory, not for the functions in it — the same
        // correction the cron router carries ninety lines down, which was never
        // swept back here. Three function files that all `import` a module
        // throwing on a missing env var is one deploy, not three bugs: every
        // import failed, the list came back empty, `/api/functions` 404ed, and
        // `rebase cloud debug` read that 404 as "this build shipped no
        // functions". An empty list is the honest answer and a debuggable one.
        const functionsRouter = new Hono<HonoEnv>();
        functionsRouter.onError(errorHandler);
        // Where the group is mounted, for the scope guard and the listing.
        functionsRouter.use("/*", recordMountPath());

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

        // A narrowed credential must hold `functions:invoke` — unqualified, or
        // on the function it calls. Without this, any valid key, however
        // narrowly scoped, could invoke every custom function.
        functionsRouter.use("/*", createFunctionScopeGuard());

        // What the caller holds, resolved for the handler: `getScopes(c)`,
        // `hasScope(c, …)` and `requireScope(…)` from
        // `@rebasepro/server/functions` read it without importing the access
        // model, which that portable surface cannot.
        functionsRouter.use("/*", async (c, next) => {
            if (c.get("user") && !c.get("scopes")) c.set("scopes", callerScopes(c));
            return next();
        });

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

        const fnRoutes = createFunctionRoutes(loadedFunctions, problems);
        functionsRouter.route("/", fnRoutes);
        functionsSurface = functionsRouter;

        if (loadedFunctions.length > 0) {
            logger.info("Loaded custom functions", {
                count: loadedFunctions.length,
                timeoutMs: functionsTimeoutMs
            });
        } else {
            logger.warn(
                "Function routes are served, but no functions loaded from " +
                `${config.functionsDir ?? "the `functions` option"}. ` +
                (problems.length > 0
                    ? `${problems.length} file(s) were skipped — see the messages above.`
                    : "The directory holds no .ts/.js function files.")
            );
        }
    }

    // 5a. Or forward them, when another process serves them.
    //
    // Mutually exclusive with mounting: a process either serves these routes or
    // hands them on, and a deployment that configured both would have the local
    // copy silently win. The `surfaces.functions` check is what makes that
    // impossible rather than merely unlikely.
    if (config.functionsUpstream && !surfaces.functions) {
        const { createFunctionsProxy } = await import("../functions/proxy");
        // No `basePath`: the forwarder asks the upstream for the path it was
        // asked for, wherever the group is mounted.
        functionsSurface = createFunctionsProxy({ upstream: config.functionsUpstream });
        logger.info("Forwarding custom functions to another process", {
            upstream: config.functionsUpstream
        });
    }

    // 6. Cron Jobs
    //
    // Two independent questions, and this block answers both: whether the cron
    // *admin surface* is served (`surfaces.cron`), and whether this process is
    // one of the ones whose timers fire (`ownership.cronScheduler`). A process
    // that is neither does not even load the job files — importing them runs
    // whatever the author put at module scope.
    let cronScheduler: CronScheduler | undefined;
    let cronSurface: Hono<HonoEnv> | undefined;
    /** How many cron jobs `start()` schedules in this process. */
    let cronJobsToSchedule = 0;
    // Whether the surface is *served* does not depend on there being a
    // directory to serve from. `cronsDir` resolves only if the directory
    // exists, and a scaffold ships `backend/functions/` and no `backend/crons/`
    // — so the whole surface was never mounted, `GET /api/cron` answered 404,
    // and Studio's Cron Jobs pane dead-ended on "Not Found" with a "Try again"
    // that could never succeed. The argument three paragraphs down — mounted
    // for the directory, not for the jobs in it, because an empty list is the
    // honest answer — just stopped one level too early.
    if (surfaces.cron || ((config.cronsDir || config.crons) && ownership.cronScheduler)) {
        const { cronJobsFrom, readCronsDirectory } = await import("../cron/cron-loader");
        const { CronScheduler } = await import("../cron/cron-scheduler");
        const { createCronRoutes } = await import("../cron/cron-routes");
        const { createCronStore } = await import("../cron/cron-store");

        const { crons: cronRecord, problems: cronProblems } = config.crons
            ? { crons: config.crons, problems: [] }
            : config.cronsDir
                ? await readCronsDirectory(config.cronsDir)
                : { crons: {}, problems: [] };
        // Each run in this backend's scope, so a handler that imports `rebase`
        // gets this backend's client — the one `ctx.rebase` is.
        const loadedCronJobs = cronJobsFrom(cronRecord).map(job => ({
            ...job,
            definition: {
                ...job.definition,
                handler: (ctx: Parameters<typeof job.definition.handler>[0]) =>
                    runInBackendScope(ownScope, () => job.definition.handler(ctx))
            }
        }));

        cronScheduler = new CronScheduler();

        // The cron scheduler gets this backend's client, so `ctx.rebase` inside a
        // cron handler IS the `rebase` it would import — same object, same type,
        // same `dataAsAdmin` spelling for the admin-scoped plane.
        cronScheduler.setClient(serverSingleton);

        if (loadedCronJobs.length > 0) {
            cronScheduler.registerJobs(loadedCronJobs);

            // Attach database persistence if the driver supports SQL and persistence is enabled
            const admin = defaultBootstrapper.getAdmin?.(defaultDriverResult);
            const store = (admin && config.cronPersistence !== false) ? createCronStore(defaultDriver) : undefined;
            if (store) {
                if (provision.database) await store.ensureTable();
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
        applyAdminGate(cronRouter, "Cron", { read: "cron:read", write: "cron:write" });

        cronRouter.route("/", createCronRoutes(cronScheduler, cronProblems.length));
        cronSurface = cronRouter;

        if (loadedCronJobs.length > 0 && !ownership.cronScheduler) {
            // Registered but not started. The admin surface still lists the jobs
            // and can trigger one by hand — which is the point of serving `/cron`
            // from a process that does not schedule: a person looking at the
            // Studio panel sees the same jobs the worker is running.
            logger.info("Cron jobs registered but NOT scheduled in this process", {
                count: loadedCronJobs.length,
                reason: "this process does not own the cron scheduler"
            });
        } else if (loadedCronJobs.length > 0) {
            // Scheduled by `start()`, not here: building a backend starts no timer.
            cronJobsToSchedule = loadedCronJobs.length;
            logger.info("Loaded cron jobs", { count: loadedCronJobs.length });
        } else if (config.cronsDir && !config.crons) {
            logger.warn(
                `Cron routes are served, but no jobs loaded from ${config.cronsDir}. ` +
                (cronProblems.length > 0
                    ? `Nothing is scheduled — ${cronProblems.length} file(s) were skipped, see the messages above.`
                    : "The directory holds no .ts/.js cron files, so nothing is scheduled.")
            );
        } else {
            // Not a warning: a project with no cron jobs is an ordinary
            // project, and it is the common one on a fresh scaffold.
            logger.debug("Cron routes are served. This project has no cron jobs, so the list is empty.");
        }
    }

    // 6a. The durable job queue.
    //
    // After cron on purpose: both create tables in `rebase`, and cron's
    // bootstrap is the older and better-exercised of the two.
    //
    // A project that declares a topic gets the queue whether or not it asked
    // for one. Topics are delivered as job rows, so `jobs.enabled: false` with
    // a topic declared is a backend where every publish throws — and requiring
    // somebody to turn on a subsystem they never named, to make a feature they
    // did name work, is the kind of second step this model exists to remove.
    const declaredTopics = graphTopics(buildResourceGraph());
    const declaredQueues = graphQueues(buildResourceGraph());
    const topicTasks = declaredTopics.length > 0 ? topicJobHandlers() : {};
    const queueTasks = declaredQueues.length > 0 ? queueJobHandlers() : {};
    let jobsOptions = config.jobs;
    if (declaredTopics.length > 0 || declaredQueues.length > 0) {
        jobsOptions = {
            ...config.jobs,
            enabled: true,
            tasks: { ...(config.jobs?.tasks ?? {}), ...topicTasks, ...queueTasks }
        };
        logger.debug(
            `[topics] ${declaredTopics.length} topic(s), ${Object.keys(topicTasks).length} subscription(s); ` +
            `[queues] ${declaredQueues.length} queue(s), ${Object.keys(queueTasks).length} handler(s) ` +
            "wired onto the job queue"
        );
    }

    // A little history for the metrics this process already keeps, in this
    // project's own database. Beside the job store because it is the same kind
    // of thing — a framework-owned table, created and swept at boot — and for
    // the same reason: this is the moment the schema is reachable and nobody is
    // mid-request.
    //
    // Undefined on a driver with no SQL admin, which the route reports as a
    // named 501. An empty chart and "this deployment keeps no history" must not
    // look alike.
    //
    // The table is made here; the sampler that writes to it is started by
    // `start()`.
    let metricsHistory: MetricsHistory | undefined;
    try {
        const { createMetricsHistory } = await import("../metrics/history-recorder.js");
        metricsHistory = createMetricsHistory(defaultDriver);
        if (metricsHistory && provision.database) {
            await metricsHistory.ensure();
        }
    } catch (err) {
        // A backend that serves is worth more than one that charts. This is the
        // only subsystem here whose absence costs nothing but a graph.
        logger.warn("[metrics] history is unavailable; the runtime is otherwise unaffected.", { err });
        metricsHistory = undefined;
    }

    let jobQueue: JobQueue | undefined;
    if (jobsOptions?.enabled) {
        const { createJobStore, createJobQueue } = await import("../jobs");
        const store = createJobStore(defaultDriver);

        if (store) {
            if (provision.database) await store.ensureTable();
            // Each job runs in this backend's scope, so a handler that imports
            // `rebase`, or publishes to a topic, reaches this backend.
            const tasks = Object.fromEntries(Object.entries(jobsOptions.tasks ?? {}).map(([task, handler]) => [
                task,
                (ctx: Parameters<typeof handler>[0]) => runInBackendScope(ownScope, () => handler(ctx))
            ]));
            jobQueue = createJobQueue(store, { ...jobsOptions, tasks });
            // Topics publish through the queue, in every process — enqueueing is
            // a write, so an api pod that runs no workers still publishes. The
            // handlers only *run* where the workers do, which is the same split
            // the queue already makes. This backend's own runtimes: a publish
            // from code it runs lands in its queue, not another backend's.
            if (declaredTopics.length > 0) {
                ownScope.topics = createTopicRuntime({ queue: jobQueue, topics: declaredTopics });
                services.topics = ownScope.topics;
            }
            if (declaredQueues.length > 0) {
                ownScope.queues = createQueueRuntime({ queue: jobQueue, queues: declaredQueues });
                services.queues = ownScope.queues;
            }
            // Constructed either way, started (by `start()`) only where this
            // process owns the workers: `jobQueue.enqueue` must keep working in
            // a process that runs none of them. Enqueueing is a write to a
            // table; running is a poll loop, and only the second is what
            // "owning" means here.
            if (!ownership.jobWorkers) {
                logger.info("Job queue available for enqueue, workers NOT started in this process", {
                    tasks: Object.keys(jobsOptions.tasks ?? {}).length
                });
            }
        } else if (declaredTopics.length > 0 || declaredQueues.length > 0) {
            // A warning would be wrong here. Webhooks have an in-memory
            // fallback; topics and queues have none, so every publish would
            // throw at the first event — in production, at whatever hour the
            // first one arrives. A driver that cannot carry the job queue
            // cannot carry either, and the honest place to say so is boot.
            const named = [
                ...declaredTopics.map(t => `topic ${t.key}`),
                ...declaredQueues.map(q => `queue ${q.key}`)
            ].join(", ");
            throw new Error(
                `This project declares ${named}, but the durable job queue is not ` +
                "available on this database driver, and topics and queues are delivered as job rows.\n\n" +
                "Use a driver that supports the job queue, or remove the declarations. " +
                "Refusing to boot rather than starting a backend where every publish throws."
            );
        } else {
            // `createJobStore` already said why. What it cannot say is what the
            // caller should expect instead, which depends on who asked.
            logger.warn(
                "Job queue requested but unavailable on this driver — the backend's `jobQueue` is undefined, " +
                "and webhook deliveries fall back to the in-memory queue."
            );
        }
    }

    // Assigned by `start()`; the admin route below closes over this binding
    // rather than its value.
    let rlsAudit: RlsAudit | undefined;

    // Aborted by this backend's shutdown, ending every response that would
    // otherwise stay open until its client left — see `createShutdown`.
    const longLivedResponses = new AbortController();

    // The rest of the admin group, each a surface of its own.
    let backupSurface: Hono<HonoEnv> | undefined;
    let rlsAuditSurface: Hono<HonoEnv> | undefined;
    let sqlExportSurface: Hono<HonoEnv> | undefined;
    let devMailSurface: Hono<HonoEnv> | undefined;
    let logsSurface: Hono<HonoEnv> | undefined;
    let metaSurface: Hono<HonoEnv> | undefined;

    // 6b. Backup admin routes (for the Studio Backups panel).
    // Read the destination lazily from env so config changes don't need a
    // rebuild. Only enabled when BACKUP_DESTINATION is set. An object-storage
    // destination is read through a controller for its own bucket, built from
    // the S3_* environment as the backup cron builds its own — not through the
    // app's file storage, which is another bucket, a local directory, or none.
    if (surfaces.admin) {
        const { createBackupRoutes, backupDestinationFromEnv, readBackupSchedule } = await import("../backup");
        const backupRouter = new Hono<HonoEnv>();

        applyAdminGate(backupRouter, "Backup", "backups:read");

        // The scheduler, when this process has one, is what knows whether the
        // nightly backup ran — on the `api` role too, which registers the jobs
        // without starting them and reads their runs from `cron_logs`.
        const scheduler = cronScheduler;
        backupRouter.route("/", createBackupRoutes({
            getDestination: () => backupDestinationFromEnv(process.env),
            getSchedule: scheduler ? () => readBackupSchedule(scheduler) : undefined,
            scheduledElsewhere: !ownership.cronScheduler
        }));
        backupSurface = backupRouter;
    }

    // 6b-ii. The scheduled RLS audit's latest result.
    //
    // Declared here and assigned below: the handler reads through the binding at
    // request time, so the order of mounting and starting does not matter, and
    // the route can sit with the other admin surfaces where it belongs.
    if (surfaces.admin) {
        const rlsAuditRouter = new Hono<HonoEnv>();
        applyAdminGate(rlsAuditRouter, "RLS audit", "schema:read");
        rlsAuditRouter.get("/", (c) => c.json(
            rlsAudit
                ? rlsAudit.status()
                : {
                    enabled: false,
                    reason: config.rlsAudit?.enabled
                        ? "This process serves the admin surface but does not own the RLS audit."
                        : "The scheduled RLS audit is off. Set `rlsAudit.enabled` to turn it on."
                }
        ));
        rlsAuditSurface = rlsAuditRouter;
    }

    // 6b-ii-a. The SQL console's "Download full result as CSV".
    //
    // `database:write`: the scope the socket's `EXECUTE_SQL` asks of the same
    // console, so whoever may run the query may download its whole result,
    // and nobody else.
    if (surfaces.admin) {
        const { createSqlExportRoutes } = await import("../api/sql-export-routes");
        const sqlExportRouter = new Hono<HonoEnv>();
        applyAdminGate(sqlExportRouter, "SQL export", "database:write");
        sqlExportRouter.route("/", createSqlExportRoutes({ getAdmin: () => defaultDriver.admin }));
        sqlExportSurface = sqlExportRouter;
    }

    // 6b-iii. The development mailbox.
    //
    // When no SMTP is configured outside production, auth mail is captured
    // rather than sent (see `email/dev-sink.ts`). The links were printed to the
    // log, which works and asks the reader to be looking at a terminal — so a
    // magic link on a machine whose logs are in another window, or in Docker, or
    // scrolled past, is a flow that still cannot be completed. This serves the
    // same capture over HTTP so the panel can open it.
    //
    // Three independent gates, because what this hands out is a working
    // credential — a password-reset token is a login:
    //
    //  1. `applyAdminGate` — authenticated, and holding `users:write`;
    //  2. there must be a registered sink, which `registerDevEmailSink` refuses
    //     to create under `NODE_ENV=production`;
    //  3. this handler re-checks `NODE_ENV` at request time, so a sink
    //     registered by hand before the environment was set is still not
    //     readable.
    //
    // Any of them failing answers 501 with the reason rather than 404: a route
    // the panel just called returning "not found" reads as a broken deploy.
    if (surfaces.admin) {
        const devMailRouter = new Hono<HonoEnv>();
        // `users:write`, not a read scope: a captured message carries a working
        // sign-in or reset link, which is an account to whoever reads it.
        applyAdminGate(devMailRouter, "Development mailbox", "users:write");

        const unavailable = {
            error: {
                code: "DEV_MAILBOX_UNAVAILABLE",
                message:
                    "No development mailbox is active. Mail is captured only when SMTP_HOST is " +
                    "unset and NODE_ENV is not production; with a mail server configured, messages " +
                    "are delivered rather than held here."
            }
        } as const;

        devMailRouter.get("/", (c) => {
            const sink = activeDevEmailSink();
            if (!sink) return c.json(unavailable, 501);
            return c.json({ enabled: true, messages: sink.list() });
        });

        // A mailbox that only grows is a mailbox nobody can find the newest
        // message in. DELETE rather than POST /clear: it removes a collection
        // of things, which is what DELETE means.
        devMailRouter.delete("/", (c) => {
            const sink = activeDevEmailSink();
            if (!sink) return c.json(unavailable, 501);
            sink.clear();
            return c.json({ cleared: true });
        });

        devMailSurface = devMailRouter;
    }

    // 6c. Logs routes (for the Studio Logs Explorer). Request logs expose
    // paths, status codes and correlation IDs, so they are admin-only — the same
    // posture as the cron and backup admin routes above.
    if (surfaces.admin) {
        const { createLogsRoutes } = await import("../api/logs-routes");
        const logsRouter = new Hono<HonoEnv>();

        applyAdminGate(logsRouter, "Logs", "logs:read");

        // Per backend, not the module's shared instance: its streams end when
        // this backend shuts down (see `closeLongLivedResponses` below).
        logsRouter.route("/", createLogsRoutes({}, { closeSignal: longLivedResponses.signal }));
        logsSurface = logsRouter;
    }

    // 6d. The project contract — what lets a repository that does *not*
    // contain the collections still generate a typed client against them. This
    // is the backbone of frontends, second web apps and mobile apps living in
    // their own repositories.
    //
    // Built here rather than by the bundle runtime so a project with a
    // hand-written entrypoint gets it too: ejecting should cost you the stock
    // runtime, not the API surface.
    if (surfaces.meta) {
        const { createContractRoutes } = await import("../api/contract-routes");
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
            contractRouter.use("/contract", ...adminGate("schema:read"));
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

        metaSurface = contractRouter;
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

    // ── Deep Health Check ─────────────────────────────────────────────────
    // The auth probe is only available when a driver bootstrapped auth — an
    // AuthAdapter or a deployment without auth leaves it undefined, and the
    // health check falls back to the database probe alone.
    const authSchemaCheck = authConfigResult?.schemaHealthCheck;
    const healthCheck = createHealthCheck(
        defaultDriver,
        authSchemaCheck ? () => authSchemaCheck.call(authConfigResult) : undefined,
        Object.values(realtimeServices)
    );

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

    const setCollectionCallbacks = (slug: string, callbacks: CollectionCallbacks): void => {
        // The boot-time check on `beforeQuery` saw the collection's declared
        // callbacks, not these, so it is repeated here before anything is
        // assigned: a hook attached to a collection its engine cannot narrow is
        // the same inert row filter it refuses at boot.
        const declared = collectionRegistry.get(slug);
        if (declared) assertBeforeQueryIsPostgresOnly([{ ...declared, callbacks }]);
        let attached = 0;
        // Assignment, not a merge — attaching callbacks REPLACES whatever the
        // collection declared. That is the right semantics (the caller is
        // taking ownership, and the cloud relies on it) and a silent one: a
        // `beforeSave` on the collection config simply stops running, and a
        // guard that is gone looks exactly like a guard that passed. It has
        // already cost a duplicate-membership check in the control plane. So
        // the replacement is said out loud, naming what is being dropped and
        // the one call that keeps it.
        const replaced = new Set<string>();
        for (const registry of callbackTargets()) {
            const collection = registry.get(slug) as { callbacks?: Record<string, unknown> } | undefined;
            if (collection) {
                for (const [name, value] of Object.entries(collection.callbacks ?? {})) {
                    if (typeof value === "function" && typeof (callbacks as Record<string, unknown>)[name] !== "function") {
                        replaced.add(name);
                    }
                }
                collection.callbacks = callbacks;
                attached++;
            }
        }
        if (replaced.size > 0) {
            logger.warn(
                `[callbacks] Attaching callbacks to "${slug}" replaced ${[...replaced].map(n => `'${n}'`).join(", ")} ` +
                "declared on the collection itself, which will no longer run. Callbacks are assigned, not merged. " +
                "To keep the collection's own, attach `composeCallbacks(declared, mine)` from @rebasepro/server, " +
                "where `declared` is the collection's `callbacks`."
            );
        }
        if (attached === 0) {
            logger.warn(`[callbacks] Collection "${slug}" not found in any registry — callbacks not attached.`);
        }
    };

    // ── Route groups ──────────────────────────────────────────────────────
    //
    // Everything above built routers; this is where they are put together into
    // the groups an application mounts. Each group is composed on request, over
    // the same handlers, so a caller can mount one in several places and cannot
    // add routes to the copy `mount()` and the in-process client use.

    /**
     * A group: this backend's services on every request first, then a fresh
     * router over `router`'s handlers.
     */
    const group = (router?: Hono<HonoEnv>): Hono<HonoEnv> => {
        const composed = new Hono<HonoEnv>();
        composed.use("/*", provideServices);
        return router ? composed.route("/", router) : composed;
    };

    const requireSurface = (surface: RuntimeSurface): void => {
        if (surfaces[surface]) return;
        throw new Error(
            `routes.${surface}(): this backend was created with \`surfaces: { ${surface}: false }\`, so it built ` +
            `no ${surface} routes. Create it with the ${surface} surface on to mount them.`
        );
    };

    const routes: RebaseRoutes = {
        auth: () => {
            requireSurface("auth");
            const authGroup = group();
            // The caller's own keys and the scope catalogue first: the adapter's
            // auth router is mounted on the group's root and would otherwise
            // see these requests first.
            if (personalKeyRouter) authGroup.route("/keys", personalKeyRouter);
            authGroup.route("/scopes", scopeRouter);
            if (config.auth) authGroup.get("/config", authLimiters.default, authConfigHandler);
            if (adapterAuthRouter) authGroup.route("/", adapterAuthRouter);
            return authGroup;
        },
        data: () => {
            requireSurface("data");
            return group(dataSurface);
        },
        storage: () => {
            requireSurface("storage");
            return group(storageSurface);
        },
        functions: () => {
            if (!functionsSurface) {
                throw new Error(
                    "routes.functions(): this backend serves no functions. Pass `functions` (or `functionsDir`) " +
                    "with the functions surface on, or `functionsUpstream` with it off to forward them."
                );
            }
            return group(functionsSurface);
        },
        admin: () => {
            requireSurface("admin");
            const adminGroup = group();
            // Order is load-bearing here. Hono runs matching handlers in
            // registration order, and the auth adapter's admin router
            // authenticates everything under the group's root: the credentials
            // it does not know (`rk_` keys, `rpt_` platform tokens) are resolved
            // ahead of it, and the backup download link — which stands in for a
            // credential — is answered before it.
            if (apiKeyPreAuth) adminGroup.use("/*", apiKeyPreAuth);
            adminGroup.use("/*", platformTokenPreAuth);
            if (backupLinkRouter) adminGroup.route("/backups", backupLinkRouter);
            if (apiKeyRouter) adminGroup.route("/api-keys", apiKeyRouter);
            if (adapterAdminRouter) adminGroup.route("/", adapterAdminRouter);
            // `/schema` and `/schema-editor` are siblings, not parent and child:
            // nested, every request to the editor would first pass the live
            // editor's gate, which answers 501 itself when no auth is configured.
            if (liveSchemaSurface) adminGroup.route("/schema", liveSchemaSurface);
            if (schemaEditorSurface) adminGroup.route("/schema-editor", schemaEditorSurface);
            if (storageMaintenanceSurface) adminGroup.route("/storage", storageMaintenanceSurface);
            if (backupSurface) adminGroup.route("/backups", backupSurface);
            if (rlsAuditSurface) adminGroup.route("/rls-audit", rlsAuditSurface);
            if (sqlExportSurface) adminGroup.route("/sql", sqlExportSurface);
            if (devMailSurface) adminGroup.route("/dev/emails", devMailSurface);
            if (logsSurface) adminGroup.route("/logs", logsSurface);
            return adminGroup;
        },
        cron: () => {
            requireSurface("cron");
            return group(cronSurface!);
        },
        meta: () => {
            requireSurface("meta");
            return group(metaSurface!);
        }
    };

    /** The base path the application last mounted at — where the SDK's socket dials by default. */
    let mountedBasePath: string | undefined;

    /**
     * Mount everything onto `app` under `basePath`.
     *
     * The process-wide middleware first, then the groups. Their prefixes do not
     * overlap, so their order among themselves does not change what answers;
     * the order *inside* each group is the one that matters, and the groups
     * keep it. `announce` is off for the in-process app, which would otherwise
     * repeat every boot line.
     */
    const mountInto = (app: Hono<HonoEnv>, basePathOption: string | undefined, announce: boolean): void => {
        const basePath = basePathOption || "/api";

        // The JSON envelope, on the root app, before any middleware is added —
        // so that a throw *in* a middleware is caught too. It used to live on
        // the data and functions routers alone, so everything else (auth,
        // storage, admin, a project's own routes) answered Hono's default `500
        // Internal Server Error` as `text/plain`: no `code`, and a JSON parse
        // failure for any client that reads one. An app that already has its
        // own handler keeps it — see `installRootErrorHandler`.
        installRootErrorHandler(app);

        // The other half of it: a path under `basePath` that matches no route is
        // not a throw, so `onError` never sees it and it came back `404 Not
        // Found` as `text/plain` — the one shape no caller handles, on the 404 a
        // typo'd collection or function name produces.
        installUnmatchedApiEnvelope(app, basePath);

        // Request ID, compression, body limit, CSRF, the CORS warning, logging.
        // The in-process app is never reached by a browser, so it has no
        // origin policy to warn about.
        const middlewares = configureMiddlewares(app, basePath, isProduction, announce ? config : { ...config, corsHandled: true });

        // Before any route is mounted, so it runs ahead of all of them, and
        // after the request id and the request logger, so a refusal is logged
        // like any other: a request asking to act as another user is honoured
        // by the data and functions auth middlewares and refused everywhere
        // else, never answered as the administrator who sent it. See
        // `auth/impersonation.ts`.
        app.use(`${basePath}/*`, refuseUnhonouredImpersonation([`${basePath}/data`, `${basePath}/functions`]));

        if (surfaces.admin) app.route(`${basePath}/admin`, routes.admin());
        if (surfaces.auth) app.route(`${basePath}/auth`, routes.auth());

        // ── JWKS ─────────────────────────────────────────────────────────
        // At the root, not under `basePath`: `/.well-known/` is where verifiers
        // look. Mounted whenever this backend mints its own tokens, and
        // answering an empty key set when none are asymmetric — "this issuer
        // publishes no public keys" is a fact a verifier can act on, where a
        // 404 is indistinguishable from a wrong URL. Gated with the auth
        // surface: a process that does not issue tokens has no key set to
        // publish, and serving an empty one from a functions-only replica would
        // tell a verifier the issuer has no public keys.
        if (jwt.isConfigured() && surfaces.auth) {
            app.route("/.well-known", createJwksRoutes(jwt));
            if (announce && jwt.hasAsymmetricSigningKey()) {
                logger.info("Access tokens are signed asymmetrically; public keys at /.well-known/jwks.json");
            }
        }

        mountMcp(app, basePath, announce);

        // `/api/schema-editor` is the shipped path and stays reachable, with a
        // `Deprecation` header, until a major. The same handlers as the
        // canonical `/admin/schema-editor`, so the two cannot drift.
        if (schemaEditorSurface) {
            app.route(`${basePath}/schema-editor`, deprecatedAlias(schemaEditorSurface, `${basePath}/admin/schema-editor`));
        }

        if (surfaces.storage) {
            app.route(`${basePath}/storage`, routes.storage());
            if (storageCarriesUploadLimit) {
                // Only the upload route. Every other path under `/storage` stays
                // on the global limit, TUS included: `PATCH /tus/:id` reads its
                // chunk into memory, and the global limit is the only cap on one
                // chunk.
                middlewares.exemptFromBodyLimit(`${basePath}/storage${STORAGE_UPLOAD_PATH}`);
            } else if (announce) {
                logger.info("Storage not configured — /storage/sources lists none, every other /storage route returns 501 STORAGE_NOT_CONFIGURED");
            }
        }

        if (surfaces.data) {
            app.route(`${basePath}/data`, routes.data());
            if (announce && activeCollections.length === 0) {
                logger.info("No collections to serve — /data returns 404 NO_COLLECTIONS");
            }
            // ── OpenAPI / Swagger ─────────────────────────────────────────
            // Follows the data surface: the document describes the collection
            // routes, so a process that does not serve them would publish a
            // spec for URLs it 404s.
            mountOpenApiDocs(app, basePath, {
                enableSwagger: config.enableSwagger,
                serverCollections,
                requireAuth: resolveRequireAuth(config.auth),
                adminGate: adminGate("schema:read"),
                generate: openApiGenerator,
                announce,
                unprotectedTables
            });
        }

        if (functionsSurface) {
            app.route(`${basePath}/functions`, routes.functions());
            if (announce) logger.debug("Function routes mounted", { path: `${basePath}/functions` });
        }

        if (surfaces.cron && cronSurface) {
            app.route(`${basePath}/admin/cron`, routes.cron());
            app.route(`${basePath}/cron`, deprecatedAlias(cronSurface, `${basePath}/admin/cron`));
        }

        if (logsSurface) {
            app.route(`${basePath}/logs`, deprecatedAlias(logsSurface, `${basePath}/admin/logs`));
        }

        if (surfaces.meta && metaSurface) app.route(`${basePath}/meta`, routes.meta());

        if (announce) logger.debug("Rebase backend mounted", { basePath });
    };

    // The app the in-process client and `fetch` dispatch into: everything,
    // laid out at `IN_PROCESS_BASE_PATH`, built on first use — a backend whose
    // control plane is never called in-process never builds it.
    let inProcess: Hono<HonoEnv> | undefined;
    const inProcessApp = (): Hono<HonoEnv> => {
        if (!inProcess) {
            inProcess = new Hono<HonoEnv>();
            mountInto(inProcess, IN_PROCESS_BASE_PATH, false);
        }
        return inProcess;
    };

    // ── Realtime ──────────────────────────────────────────────────────────
    let realtimeAttached = false;
    const attachRealtime = async (server: Server, attachOptions: AttachRealtimeOptions = {}): Promise<void> => {
        // The websocket server is attached to the HTTP server rather than
        // mounted on a path, which is why it went on answering for roles that
        // mount no surfaces at all. A `worker` serves no HTTP a client can reach
        // and a `functions` process has no subscribers; upgrading a connection
        // for either is a listener nobody asked for on a port nobody routes to.
        if (!surfaces.realtime || !defaultBootstrapper.initializeWebsockets || !effectiveRealtimeService) return;
        if (realtimeAttached) {
            throw new Error("attachRealtime(): this backend's websocket is already attached to a server.");
        }
        realtimeAttached = true;
        await defaultBootstrapper.initializeWebsockets(server, effectiveRealtimeService, defaultDriver, config.auth, authAdapter, {
            // The socket is another door into the rows the data router serves,
            // and not under `${basePath}/*` where that router's body limit and
            // rate limiter are registered: it carries both itself — the same
            // body limit, and the same buckets in the same store, so a
            // person's frames and requests spend one allowance.
            maxPayload: config.maxBodySize,
            dataRateLimit: rateLimitConfig ? createDataRateLimitCheck(rateLimitConfig) : undefined,
            // An API key authenticates the socket as it does a request.
            resolveApiKey: apiKeyStore ? (token: string) => resolveApiKey(apiKeyStore, token, access) : undefined,
            // A session token, verified with this backend's keys, and the
            // roles it holds read from this backend's access model — for a
            // socket with no auth adapter to ask.
            verifyAccessToken: (token: string) => jwt.isConfigured() ? jwt.verifyAccessToken(token) : Promise.resolve(null),
            accessModel: access.model,
            // Its own path, so it shares the server with the application's
            // websockets instead of claiming every upgrade on it.
            path: attachOptions.path ?? realtimeSocketPath(mountedBasePath)
        });
    };

    // ── Timers ────────────────────────────────────────────────────────────
    let started = false;
    // Kept for the shutdown: the sampler's interval writes to the pool.
    let stopMetricsSampler: (() => void) | undefined;
    let authTokenSweep: { stop(): Promise<void> | void } | undefined;
    let historyRetentionSweep: { stop(): Promise<void> | void } | undefined;

    const start = (): void => {
        if (started) return;
        started = true;
        // Inside this backend's scope, so every timer started below — the cron
        // ticks, the job workers' polls, the sweeps — runs its callbacks with
        // this backend as `rebase`.
        runInBackendScope(ownScope, startTimers);
    };

    const startTimers = (): void => {
        // Whether the configured mail server answers — a warning now rather
        // than at the first password reset. A connection, so it waits for
        // `start()`: a script that only builds a backend should not open one.
        if (emailService?.isConfigured() && typeof emailService.verifyConnection === "function") {
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

        if (cronScheduler && cronJobsToSchedule > 0) {
            cronScheduler.start();
            logger.info("Cron jobs scheduled", { count: cronJobsToSchedule });
        }

        if (metricsHistory) {
            try {
                stopMetricsSampler = metricsHistory.start();
            } catch (err) {
                // A backend that serves is worth more than one that charts.
                logger.warn("[metrics] history sampling did not start; the runtime is otherwise unaffected.", { err });
            }
        }

        if (jobQueue && ownership.jobWorkers) {
            jobQueue.start();
            logger.info("Job queue started", { tasks: Object.keys(jobsOptions?.tasks ?? {}).length });
        }

        // ── Scheduled RLS audit ───────────────────────────────────────────
        // Owned rather than served: `surfaces.admin` decides whether the
        // *result* is readable over HTTP, `ownership.rlsAudit` whether this
        // process is the one that runs the scan. A process that serves the
        // surface without owning the scan reports "not run here", which is the
        // truth.
        if (config.rlsAudit?.enabled && ownership.rlsAudit) {
            rlsAudit = createRlsAudit(config.rlsAudit);
            rlsAudit.start();
        }

        // ── Expired auth tokens ───────────────────────────────────────────
        // Housekeeping with a timer, so it runs where the timers do: once an
        // hour, on one instance of the fleet, claimed as a cron slot is.
        authTokenSweep = startExpiredTokenSweep({
            authRepo: adminIdentityRepo,
            driver: defaultDriver,
            ownsTimers: ownership.cronScheduler,
            persistClaims: config.cronPersistence !== false
        });

        // ── History retention ─────────────────────────────────────────────
        // The same kind of housekeeping: entries past `retention` deleted once
        // an hour, fleet-wide, so a row nobody writes again does not keep its
        // history for good. The inline prune after each write still caps a
        // busy row.
        historyRetentionSweep = startHistoryRetentionSweep({
            historyService: historyConfigResult?.historyService,
            driver: defaultDriver,
            ownsTimers: ownership.cronScheduler,
            persistClaims: config.cronPersistence !== false
        });
    };

    // ── Graceful Shutdown ─────────────────────────────────────────────────
    // Assembled when called, so it stops what `start()` actually started.
    const shutdown = (timeoutMs?: number, shutdownOptions: { server?: Server } = {}): Promise<void> =>
        createShutdown({
            server: shutdownOptions.server,
            cronScheduler,
            jobQueue,
            rlsAudit,
            authTokenSweep,
            historyRetentionSweep,
            stopMetricsSampler,
            realtimeServices,
            closeLongLivedResponses: () => longLivedResponses.abort(),
            emailService
        })(timeoutMs);

    logger.debug("Rebase Backend Initialized");

    return {
        rebase: serverSingleton,
        services,
        verifyCredential: (token: string) => verifyCredentialAgainst(services, token),
        driverRegistry,
        driver: defaultDriver,
        realtimeServices,
        realtimeService: effectiveRealtimeService,
        auth: authConfigResult,
        history: historyConfigResult,
        metricsHistory,
        storageRegistry,
        storageController,
        collectionRegistry,
        cronScheduler,
        jobQueue,
        routes,
        fetch: async (request: Request) => await inProcessApp().fetch(request),
        mount: (app: Hono<HonoEnv>, mountOptions: BackendMountOptions = {}) => {
            mountInto(app, mountOptions.basePath, true);
            mountedBasePath = mountOptions.basePath || "/api";
        },
        attachRealtime,
        start,
        setCollectionCallbacks,
        healthCheck,
        shutdown
    };
}

/** The path under `/storage` that carries its own body limit — the upload. */
const STORAGE_UPLOAD_PATH = "/upload";

/**
 * Where the SDK's socket dials for an API mounted at `basePath`.
 *
 * The client sends HTTP to `${baseUrl}/api` and opens the socket at `baseUrl`
 * itself, so the socket's path is the base path without its trailing `/api`:
 * `/api` → `/`, `/x/api` → `/x`. Any other base path gives `/`, the default an
 * SDK configured with that path as its `apiPath` dials.
 */
export function realtimeSocketPath(basePath: string | undefined): string {
    if (!basePath) return "/";
    const trimmed = basePath.replace(/\/+$/, "");
    if (!trimmed.endsWith("/api")) return "/";
    return trimmed.slice(0, -"/api".length) || "/";
}
