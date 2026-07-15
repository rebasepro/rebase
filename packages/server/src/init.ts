import {
    AuthAdapter,
    BackendBootstrapper,
    BootstrappedAuth,
    DatabaseAdapter,
    DataDriver,
    DataSourceDefinition,
    CollectionCallbacks,
    CollectionConfig,
    HealthCheckResult,
    HistoryConfig,
    InitializedDriver,
    isPostgresCollectionConfig,
    isSQLAdmin,
    RealtimeProvider,
    SecurityRule
} from "@rebasepro/types";
import { createDataSourceRegistry, resolveDataSource, buildSdkData, buildRoutedRebaseData } from "@rebasepro/common";
import { randomBytes } from "node:crypto";
import { BackendCollectionRegistry } from "./collections/BackendCollectionRegistry";
import { loadCollectionsFromDirectory } from "./collections/loader";
import { DEFAULT_DRIVER_ID, DefaultDriverRegistry, DriverRegistry } from "./services/driver-registry";
import { createRoutedRealtimeService } from "./services/routed-realtime-service";
import { Server } from "http";

import { RestApiGenerator } from "./api/rest/api-generator";
import { createAuthMiddleware } from "./auth/middleware";
import { createAdapterAuthMiddleware } from "./auth/adapter-middleware";
import { scopeDataDriver } from "./auth/rls-scope";
import { createBuiltinAuthAdapter } from "./auth/builtin-auth-adapter";
import { errorHandler } from "./api/errors";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HonoEnv } from "./api/types";
import { configureLogLevel } from "./utils/logging";
import { logger } from "./utils/logger";
import { configureMiddlewares } from "./init/middlewares";
import { initializeStorage } from "./init/storage";
import { mountOpenApiDocs } from "./init/docs";
import { createHealthCheck } from "./init/health";
import { createShutdown } from "./init/shutdown";
import { configureJwt, requireAdmin, requireAuth } from "./auth";
import {
    BackendStorageConfig,
    createStorageRoutes,
    StorageController,
    StorageRegistry
} from "./storage";
import type { ApiKeyStore } from "./auth/api-keys/api-key-store";
import { createApiKeyStore } from "./auth/api-keys/api-key-store";
import { createApiKeyRoutes } from "./auth/api-keys/api-key-routes";
import { createApiKeyRateLimiter } from "./auth/rate-limiter";
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
    collection?: CollectionConfig;
    jwtSecret?: string;
    accessExpiresIn?: string;
    refreshExpiresIn?: string;
    requireAuth?: boolean;
    allowRegistration?: boolean;
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
    collections?: CollectionConfig[];
    collectionsDir?: string;
    server: Server;
    app: Hono<HonoEnv>;
    basePath?: string;

    /**
     * How much of Rebase to run.
     *
     * - `"cms"` (default) — collections come from `collections`/`collectionsDir`
     *   and describe both the API and the admin UI. The schema editor is
     *   available outside production.
     * - `"baas"` — no collection config at all. Collections are derived from the
     *   live database at boot (see `BackendBootstrapper.introspectCollections`),
     *   so every table is served over REST with nothing to define. The schema
     *   editor is off, since it exists to write collection files back to disk.
     *
     * Both modes serve the same control plane: auth, storage, realtime,
     * backups, cron, functions and OpenAPI. Neither serves the admin SPA —
     * that is the application's call, via `serveSPA`.
     */
    mode?: "cms" | "baas";

    /**
     * Force the schema-editor routes on or off.
     *
     * Defaults to enabled when `collectionsDir` is set, outside production, in
     * `cms` mode. The editor rewrites collection files, so it needs a
     * `collectionsDir` to write to.
     */
    schemaEditor?: boolean;

    /** Options that only apply in `baas` mode. */
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
     * Entity history / audit-log configuration.
     *
     * - `true` — enable history with default settings
     * - `{ retention?: number }` — enable with optional retention period (days)
     */
    history?: HistoryConfig;
    /**
     * Default security rules applied to any collection that does not define
     * its own `securityRules`. Opt-in — if not set, collections without
     * explicit rules remain unrestricted (beyond `requireAuth`).
     *
     * @example
     * ```ts
     * defaultSecurityRules: [
     *     { operation: "select", access: "public" },
     *     { operations: ["insert", "update", "delete"], roles: ["admin"] }
     * ]
     * ```
     */
    defaultSecurityRules?: SecurityRule[];
    enableSwagger?: boolean;
    functionsDir?: string;
    cronsDir?: string;
    /**
     * Enable/disable database persistence for cron job execution logs.
     * When set to false, cron jobs will run but logs will not be persisted to the database.
     * Default: true.
     */
    cronPersistence?: boolean;
    /**
     * Maximum request body size in bytes for API routes (default: 10MB).
     * Set to 0 to disable the global limit entirely.
     *
     * Note: Storage upload routes use their own limit from the storage config's
     * `maxFileSize` property (default: 50MB), which takes precedence over this.
     */
    maxBodySize?: number;
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
}

/**
 * Type guard to detect whether the `auth` config is an `AuthAdapter`
 * (has a `verifyRequest` method) vs a plain `RebaseAuthConfig` (plain object).
 */
export function isAuthAdapter(auth: RebaseAuthConfig | AuthAdapter): auth is AuthAdapter {
    return typeof auth === "object" && auth !== null && "verifyRequest" in auth && typeof (auth as AuthAdapter).verifyRequest === "function";
}

/**
 * Type guard to detect whether `database` is a `DatabaseAdapter`.
 */
export function isDatabaseAdapter(db: unknown): db is DatabaseAdapter {
    return typeof db === "object" && db !== null && "initializeDriver" in db && "type" in db && !("initializeAuth" in db);
}

/**
 * Resolve the `requireAuth` flag from either a `RebaseAuthConfig` or an `AuthAdapter`.
 *
 * - `RebaseAuthConfig` has an explicit `requireAuth` boolean
 * - `AuthAdapter` always implies auth is required (secure by default)
 * - If no auth config is provided at all, default to `true`
 */
function resolveRequireAuth(auth?: RebaseAuthConfig | AuthAdapter): boolean {
    if (!auth) return true;
    if (isAuthAdapter(auth)) return true; // AuthAdapters are always secure-by-default
    return (auth as RebaseAuthConfig).requireAuth !== false;
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

    logger.info("Initializing Rebase Backend");

    const basePath = config.basePath || "/api";
    const isProduction = process.env.NODE_ENV === "production";

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
    const mode = config.mode ?? "cms";
    logger.info(
        mode === "baas"
            ? "Starting in baas mode — collections derived from the database schema"
            : "Starting in cms mode — collections from config"
    );
    let activeCollections = config.collections || [];
    if (mode === "baas") {
        // Collections come from the database itself, after the driver connects.
        if (activeCollections.length > 0 || config.collectionsDir) {
            logger.warn(
                "Ignoring configured collections: baas mode derives them from the database schema. " +
                "Remove `collections`/`collectionsDir`, or use mode: \"cms\" to serve them."
            );
            activeCollections = [];
        }
    } else if (config.collectionsDir && activeCollections.length === 0) {
        activeCollections = await loadCollectionsFromDirectory(config.collectionsDir);
        logger.info("Auto-discovered collections", {
            count: activeCollections.length,
            dir: config.collectionsDir
        });
    }

    // Apply default security rules to collections that don't define their own.
    // Also called for collections introspected in baas mode, which are created
    // after this point and would otherwise be served without the defaults.
    const applyDefaultSecurityRules = (collections: CollectionConfig[]) => {
        if (!config.defaultSecurityRules?.length) return;
        for (const collection of collections) {
            if (isPostgresCollectionConfig(collection) && (!collection.securityRules || collection.securityRules.length === 0)) {
                collection.securityRules = config.defaultSecurityRules;
            }
        }
        logger.info("Default security rules applied to collections without explicit rules");
    };
    applyDefaultSecurityRules(activeCollections);

    const realtimeServices: Record<string, RealtimeProvider> = {};
    const delegates: Record<string, DataDriver> = {};

    // ─── Resolve bootstrappers ───────────────────────────────────────────
    let bootstrappers: BackendBootstrapper[] = config.bootstrappers || [];
    if (config.database) {
        const dbAdapter = config.database;
        logger.info("Using DatabaseAdapter", { type: dbAdapter.type });
        const wrappedBootstrapper: BackendBootstrapper = {
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
            getAdmin: dbAdapter.getAdmin,
            mountRoutes: dbAdapter.mountRoutes
        };
        bootstrappers = [wrappedBootstrapper];
    }

    if (bootstrappers.length === 0) {
        throw new Error("No bootstrappers or database adapter provided. Cannot initialize database drivers.");
    }

    let defaultDriverId = DEFAULT_DRIVER_ID;

    let defaultDriverResult: InitializedDriver | undefined = undefined;

    // 1. Initialize all drivers
    for (const bootstrapper of bootstrappers) {
        const b = bootstrapper;
        logger.info("Running bootstrapper for driver", { driverId: b.id || bootstrapper.type });
        if (b.isDefault) {
            defaultDriverId = b.id || bootstrapper.type;
        }

        const driverResult = await bootstrapper.initializeDriver({
            collections: activeCollections,
            collectionRegistry,
            mode,
            baas: config.baas
        });
        delegates[b.id || bootstrapper.type] = driverResult.driver;

        // In baas mode the driver reports what it found in the database.
        // `undefined` means it never looked — it has no introspection support,
        // so baas mode can only ever serve nothing. Say so at boot rather than
        // letting every request 404 against a server that claims to be healthy.
        if (mode === "baas") {
            const driverName = b.id || bootstrapper.type;
            if (!driverResult.collections) {
                throw new Error(
                    `Driver "${driverName}" does not support baas mode: it cannot derive collections ` +
                    "from the database schema. Use mode: \"cms\" and declare collections explicitly, " +
                    "or use a driver that implements introspection (e.g. @rebasepro/server-postgres)."
                );
            }
            if (driverResult.collections.length === 0) {
                logger.warn(
                    `Driver "${driverName}" found no tables to serve. The data API will not be mounted. ` +
                    "Create tables (migrations, SQL, any tool) and restart."
                );
            }
        }

        // These never passed through the config-time steps above, so apply them here.
        if (driverResult.collections?.length) {
            applyDefaultSecurityRules(driverResult.collections);
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

            logger.info("Using AuthAdapter", { id: authAdapter.id });

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
                    logger.info("Auto-discovered auth collection from collection definitions", { slug: foundAuthCollection.slug });
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

            // Warn if the auth collection relies on data callbacks for lifecycle
            // side effects. User creation/updates via the auth subsystem
            // (registration, admin user management, OAuth) write directly to the
            // user store and do NOT go through the collection save pipeline, so
            // `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` never fire for
            // those paths. Use the auth hooks (`afterUserCreate`, etc.) instead.
            if (safeAuthConfig.collection?.callbacks) {
                const cb = safeAuthConfig.collection.callbacks as Record<string, unknown>;
                const dataCallbacks = ["beforeSave", "afterSave", "beforeDelete", "afterDelete"].filter(k => typeof cb[k] === "function");
                if (dataCallbacks.length > 0) {
                    logger.warn(
                        `[Auth] The auth collection "${safeAuthConfig.collection.slug}" defines ` +
                        `${dataCallbacks.join("/")} callback(s), but these do NOT fire when users are ` +
                        `created or updated through the auth system (registration, admin, OAuth) — ` +
                        `that path bypasses the collection save pipeline. Use auth hooks ` +
                        `(afterUserCreate, beforeUserCreate, afterUserDelete, …) for those side effects.`
                    );
                }
            }

            // Extract the collection-level auth config (if `auth` is an object, not just `true`)
            const collectionAuth = safeAuthConfig.collection ? safeAuthConfig.collection.auth : undefined;
            const collectionAuthConfig = (typeof collectionAuth === "object" && collectionAuth !== null) ? collectionAuth : undefined;
            if (safeAuthConfig.jwtSecret) {
                configureJwt({
                    secret: safeAuthConfig.jwtSecret,
                    accessExpiresIn: safeAuthConfig.accessExpiresIn || "1h",
                    refreshExpiresIn: safeAuthConfig.refreshExpiresIn || "30d"
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
                logger.info("Service key configured for script/server-to-server authentication");
            }

            if (defaultBootstrapper.initializeAuth) {
                logger.info("Bootstrapping authentication via driver protocol");
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
            logger.info("Bootstrapping entity history via driver protocol");
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
                allowUserLookup: safeAuthConfig.allowUserLookup ?? false,
                defaultRole: safeAuthConfig.defaultRole,
                oauthProviders,
                serviceKey,
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
        if (authAdapter && authAdapter.createAuthRoutes) {
            const authRoutes = authAdapter.createAuthRoutes();
            if (authRoutes) {
                config.app.route(`${basePath}/auth`, authRoutes);
                logger.info("Auth routes mounted via adapter", { adapter: authAdapter.id });
            }
        }

        if (authAdapter && authAdapter.createAdminRoutes) {
            const adminRoutes = authAdapter.createAdminRoutes();
            if (adminRoutes) {
                config.app.route(`${basePath}/admin`, adminRoutes);
                logger.info("Admin routes mounted via adapter", { adapter: authAdapter.id });
            }
        }
    }

    // ─── Internal per-process credential ───────────────────────────────────
    // When the user hasn't configured a REBASE_SERVICE_KEY, generate a random
    // per-boot key so the singleton's control-plane APIs (auth, admin, storage,
    // functions) can still authenticate against the server's own middleware.
    // This key never leaves the process and is never logged.
    const internalServiceKey = serviceKey || randomBytes(48).toString("base64");
    if (!serviceKey) {
        logger.info("No REBASE_SERVICE_KEY configured. Generated internal per-boot key for singleton control-plane APIs.");
    }

    // Update the auth adapter's service key to include the internal key
    // so that the singleton's control-plane requests are recognized.
    if (authAdapter && !authAdapter.serviceKey) {
        authAdapter.serviceKey = internalServiceKey;
    }

    // ─── API Key Store Bootstrap ──────────────────────────────────────────
    let apiKeyStore: ApiKeyStore | undefined;
    const apiKeyStoreResult = createApiKeyStore(defaultDriver);
    if (apiKeyStoreResult) {
        apiKeyStore = apiKeyStoreResult;
        await apiKeyStore.ensureTable();
        logger.info("Service API Keys initialized");

        // Mount API key admin routes
        const apiKeyRoutes = createApiKeyRoutes({
            store: apiKeyStore,
            serviceKey: internalServiceKey
        });
        config.app.route(`${basePath}/admin/api-keys`, apiKeyRoutes);
        logger.info("API key admin routes mounted", { path: `${basePath}/admin/api-keys` });
    }

    // The schema editor rewrites collection files, so it needs a collectionsDir
    // to write to and is off in baas mode (no files) and in production.
    const schemaEditorEnabled =
        config.schemaEditor ?? (!!config.collectionsDir && process.env.NODE_ENV !== "production" && mode === "cms");
    if (schemaEditorEnabled && !config.collectionsDir) {
        logger.warn("schemaEditor is enabled but no collectionsDir is set — the schema editor has nowhere to write. Skipping.");
    }

    if (schemaEditorEnabled && config.collectionsDir) {
        {
            const { createSchemaEditorRoutes } = await import("./api/schema-editor-routes");
            const schemaEditorRoutes = createSchemaEditorRoutes(config.collectionsDir);

            if (authAdapter && !isAuthAdapter(config.auth!)) {
                const safeAuth = config.auth as RebaseAuthConfig;
                if (safeAuth.requireAuth !== false && !!safeAuth.jwtSecret) {
                    schemaEditorRoutes.use("/*", requireAuth, requireAdmin);
                }
            } else if (authAdapter) {
                // External auth adapter — still protect schema editor
                schemaEditorRoutes.use("/*", requireAuth, requireAdmin);
            }

            config.app.route(`${basePath}/schema-editor`, schemaEditorRoutes);
            logger.info("Schema Editor mounted", { path: `${basePath}/schema-editor` });
        }
    }

    if (storageController) {
        // Storage uploads get their own body limit, derived from the storage config's
        // maxFileSize (default 50MB), which overrides the global API body limit.
        const storageMaxSize = (
            config.storage && typeof config.storage === "object" && "type" in config.storage
                ? (config.storage as BackendStorageConfig).maxFileSize
                : undefined
        ) ?? 50 * 1024 * 1024;

        const storageRoutes = createStorageRoutes({
            controller: storageController,
            registry: storageRegistry,
            sources: config.storageSources,
            requireAuth: resolveRequireAuth(config.auth),
            authAdapter
        });

        // Apply a permissive body limit specifically for the upload endpoint
        storageRoutes.use("/upload", bodyLimit({
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

        config.app.route(`${basePath}/storage`, storageRoutes);
    }

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

        // Per-API-key rate limiting (no-op for non-API-key requests)
        if (apiKeyStore) {
            dataRouter.use("/*", createApiKeyRateLimiter());
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

        // Only generate server data routes for server-mediated collections.
        // Collections on a direct/custom transport are client-only — the
        // backend must not expose a (mis-engined) endpoint for them.
        const serverCollections = activeCollections.filter(
            (collection) => resolveDataSource(collection, dataSourceRegistry).transport === "server"
        );

        const restGenerator = new RestApiGenerator(
            serverCollections,
            defaultDriver,
            authAdapter
        );
        dataRouter.route("/", restGenerator.generateRoutes());

        config.app.route(`${basePath}/data`, dataRouter);
    }

    // ── OpenAPI / Swagger ─────────────────────────────────────────────────
    await mountOpenApiDocs(config.app, basePath, config.enableSwagger, activeCollections, resolveRequireAuth(config.auth));

    // ─── Server-side singleton ────────────────────────────────────────────
    // Build the RebaseClient for control-plane APIs (auth, admin, storage,
    // functions, cron). These still route through the Hono app because they
    // genuinely need route dispatch + middleware.
    // `rebase.data` is replaced below with a native driver-backed data plane.
    const serverClient = createRebaseClient({
        baseUrl: "http://localhost",
        apiPath: basePath,
        websocketUrl: "",
        token: internalServiceKey,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            return await config.app.request(input as string | Request | URL, init);
        }
    });

    // ─── Native data plane ────────────────────────────────────────────────
    // Replace the HTTP-transport data layer with a driver-backed RebaseData.
    // This eliminates JSON serialize → Hono dispatch → auth → deserialize for
    // every rebase.data call. RLS semantics are preserved: the driver is scoped
    // once as { uid: "service", roles: ["admin"] }, matching the identity the
    // service-key HTTP path produced.
    const serviceIdentity = { uid: "service", roles: ["admin"] as string[] };

    const scopedDefaultDriver = await scopeDataDriver(defaultDriver, serviceIdentity);
    const defaultData = buildSdkData(scopedDefaultDriver);

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
    // `dataAsAdmin` is the loud, explicitly-named admin accessor; `data` is kept
    // as a (deprecated) alias pointing at the same admin-scoped, RLS-bypassing
    // object — same trust level, clearer name at the call site.
    Object.assign(serverClient, { data: serverData, dataAsAdmin: serverData });
    logger.info("Native data plane attached to singleton (bypasses HTTP loop)");

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
        logger.info("Email service attached to singleton", { configured: emailService.isConfigured() });

        if (emailService.isConfigured() && typeof emailService.verifyConnection === "function") {
            emailService.verifyConnection().then((success) => {
                if (!success) {
                    logger.warn("Warning: SMTP connection verification failed. Email delivery may fail.");
                } else {
                    logger.info("SMTP connection verified successfully.");
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
            sql: (query: string, options?: { database?: string; role?: string }) =>
                driverAdmin.executeSql(query, options)
        });
        logger.info("SQL capability attached to singleton");
    }

    // The server client is assembled dynamically above (native data plane,
    // dataAsAdmin, email, sql attached via Object.assign), so TS can't see the
    // full RebaseServerClient shape statically — cast at the boundary.
    _initRebase(serverClient as unknown as import("@rebasepro/types").RebaseServerClient);
    logger.info("Rebase singleton initialized");

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
    if (config.functionsDir) {
        const { loadFunctionsFromDirectory } = await import("./functions/function-loader");
        const { createFunctionRoutes } = await import("./functions/function-routes");

        const loadedFunctions = await loadFunctionsFromDirectory(config.functionsDir);

        if (loadedFunctions.length > 0) {
            const functionsRouter = new Hono<HonoEnv>();
            functionsRouter.onError(errorHandler);

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

            const fnRoutes = createFunctionRoutes(loadedFunctions);
            functionsRouter.route("/", fnRoutes);
            config.app.route(`${basePath}/functions`, functionsRouter);
            logger.info("Mounted custom functions", {
                count: loadedFunctions.length,
                path: `${basePath}/functions`
            });
        }
    }

    // 6. Mount Cron Jobs
    let cronScheduler: import("./cron").CronScheduler | undefined;
    if (config.cronsDir) {
        const { loadCronJobsFromDirectory } = await import("./cron/cron-loader");
        const { CronScheduler } = await import("./cron/cron-scheduler");
        const { createCronRoutes } = await import("./cron/cron-routes");
        const { createCronStore } = await import("./cron/cron-store");

        const loadedCronJobs = await loadCronJobsFromDirectory(config.cronsDir);

        if (loadedCronJobs.length > 0) {
            cronScheduler = new CronScheduler();

            // The cron scheduler uses the same serverClient as the singleton.
            // ctx.client inside cron handlers IS the same `rebase` instance.
            cronScheduler.setClient(serverClient);

            cronScheduler.registerJobs(loadedCronJobs);

            // Attach database persistence if the driver supports SQL and persistence is enabled
            const admin = defaultBootstrapper.getAdmin?.(defaultDriverResult);
            const store = (admin && config.cronPersistence !== false) ? createCronStore(defaultDriver) : undefined;
            if (store) {
                await store.ensureTable();
                cronScheduler.setStore(store);
            }

            const cronRouter = new Hono<HonoEnv>();

            // Cron admin routes require authentication + admin role
            if (authAdapter && !isAuthAdapter(config.auth!)) {
                const safeAuth = config.auth as RebaseAuthConfig;
                if (safeAuth.requireAuth !== false && !!safeAuth.jwtSecret) {
                    cronRouter.use("/*", requireAuth, requireAdmin);
                }
            } else if (authAdapter) {
                cronRouter.use("/*", requireAuth, requireAdmin);
            }

            cronRouter.route("/", createCronRoutes(cronScheduler));
            config.app.route(`${basePath}/cron`, cronRouter);

            // Start the scheduler
            cronScheduler.start();

            logger.info("Mounted cron jobs", {
                count: loadedCronJobs.length,
                path: `${basePath}/cron`
            });
        }
    }

    // 6b. Mount Backup admin routes (for the Studio Backups panel).
    // Read the destination lazily from env so config changes don't need a
    // rebuild. Only enabled when BACKUP_DESTINATION is set.
    {
        const { createBackupRoutes, parseBackupDestination } = await import("./backup");
        const backupRouter = new Hono<HonoEnv>();

        if (authAdapter && !isAuthAdapter(config.auth!)) {
            const safeAuth = config.auth as RebaseAuthConfig;
            if (safeAuth.requireAuth !== false && !!safeAuth.jwtSecret) {
                backupRouter.use("/*", requireAuth, requireAdmin);
            }
        } else if (authAdapter) {
            backupRouter.use("/*", requireAuth, requireAdmin);
        }

        backupRouter.route("/", createBackupRoutes({
            getDestination: () => {
                const out = process.env.BACKUP_DESTINATION?.trim();
                return out ? parseBackupDestination(out) : null;
            },
            storage: storageController
        }));
        config.app.route(`${basePath}/admin/backups`, backupRouter);
        logger.info("Backup admin routes mounted", { path: `${basePath}/admin/backups` });
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

    logger.info("Rebase Backend Initialized");

    // ── Deep Health Check ─────────────────────────────────────────────────
    const healthCheck = createHealthCheck(defaultDriver);

    // ── Graceful Shutdown ─────────────────────────────────────────────────
    const shutdown = createShutdown({
        server: config.server,
        cronScheduler,
        realtimeServices
    });

    return {
        driverRegistry,
        driver: defaultDriver,
        realtimeServices,
        realtimeService: effectiveRealtimeService,
        auth: authConfigResult,
        history: historyConfigResult,
        storageRegistry,
        storageController,
        collectionRegistry,
        cronScheduler,
        healthCheck,
        shutdown
    };
}
