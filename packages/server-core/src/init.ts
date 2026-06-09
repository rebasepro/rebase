import { DataDriver, EntityCollection, BackendBootstrapper, BootstrappedAuth, RealtimeProvider, HealthCheckResult, InitializedDriver, isSQLAdmin, BackendHooks, AuthAdapter, DatabaseAdapter } from "@rebasepro/types";
import { BackendCollectionRegistry } from "./collections/BackendCollectionRegistry";
import { loadCollectionsFromDirectory } from "./collections/loader";
import { DriverRegistry, DEFAULT_DRIVER_ID, DefaultDriverRegistry } from "./services/driver-registry";
import { Server } from "http";

import { RestApiGenerator } from "./api/rest/api-generator";
import { createAuthMiddleware } from "./auth/middleware";
import { createAdapterAuthMiddleware } from "./auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "./auth/builtin-auth-adapter";
import { errorHandler } from "./api/errors";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HonoEnv } from "./api/types";
import { configureLogLevel } from "./utils/logging";
import { logger } from "./utils/logger";
import { requestLogger } from "./utils/request-logger";
import { createAdminRoutes, createAuthRoutes, requireAuth, requireAdmin, configureJwt } from "./auth";
import { createStorageController, createStorageRoutes, DEFAULT_STORAGE_ID, DefaultStorageRegistry, BackendStorageConfig, StorageController, StorageRegistry } from "./storage";
import { createApiKeyStore } from "./auth/api-keys/api-key-store";
import { createApiKeyRoutes } from "./auth/api-keys/api-key-routes";
import type { ApiKeyStore } from "./auth/api-keys/api-key-store";
import { createApiKeyRateLimiter } from "./auth/rate-limiter";
import { createRebaseClient } from "@rebasepro/client";
import { defaultUsersCollection } from "@rebasepro/common";
import { createHistoryRoutes } from "./history";
import { EmailConfig, createEmailService } from "./email";
import type { EmailService } from "./email";
import type { OAuthProvider } from "./auth/interfaces";
import type { AuthHooks } from "./auth/auth-hooks";
import { _initRebase } from "./singleton";

export interface RebaseAuthConfig {
    jwtSecret?: string;
    accessExpiresIn?: string;
    refreshExpiresIn?: string;
    requireAuth?: boolean;
    allowRegistration?: boolean;
    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When a request includes `Authorization: Bearer <serviceKey>`, it is
     * granted admin-level access without JWT verification. This is the
     * Rebase equivalent of a Firebase Service Account key.
     *
     * Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
     *
     * Set via `REBASE_SERVICE_KEY` in your `.env`.
     * Must be at least 32 characters.
     */
    serviceKey?: string;
    email?: EmailConfig;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providers?: OAuthProvider<any>[];
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
    [key: string]: unknown;
}

export interface RebaseBackendConfig {
    collections?: EntityCollection[];
    collectionsDir?: string;
    server: Server;
    app: Hono<HonoEnv>;
    basePath?: string;

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
     * import { createPostgresAdapter } from "@rebasepro/server-postgresql";
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
     * - A `BackendStorageConfig` object (`{ type: 'local' | 's3', ... }`)
     * - A `StorageController` instance (for custom providers like GCS, Azure, etc.)
     * - A `Record<string, ...>` of either, for multi-backend setups
     */
    storage?: BackendStorageConfig | StorageController | Record<string, BackendStorageConfig | StorageController>;
    history?: unknown;
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
     * Backend-level hooks for intercepting admin data (users, roles)
     * at the API boundary. These run server-side after database reads
     * and before API responses are sent.
     *
     * Complement the per-collection `EntityCallbacks` system which
     * handles collection CRUD operations.
     */
    hooks?: BackendHooks;
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
    history?: unknown;
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

    // ─── Request Body Size Limit ─────────────────────────────────────────
    const maxBodySize = config.maxBodySize ?? 10 * 1024 * 1024; // 10MB default
    if (maxBodySize > 0) {
        config.app.use(`${basePath}/*`, bodyLimit({
            maxSize: maxBodySize,
            onError: (c) => {
                return c.json({
                    error: {
                        message: `Request body too large. Maximum size is ${Math.round(maxBodySize / 1024 / 1024)}MB.`,
                        code: "PAYLOAD_TOO_LARGE"
                    }
                }, 413);
            }
        }));
        logger.info("Request body limit configured", { maxSizeMB: Math.round(maxBodySize / 1024 / 1024) });
    }

    // ─── CSRF Protection (opt-in) ────────────────────────────────────────
    // BaaS APIs are consumed by mobile apps, SPAs on different origins, and
    // CLI/SDK tools. CSRF is only enabled when the developer explicitly
    // configures it with allowed origins.
    if (config.csrf?.origin) {
        config.app.use(`${basePath}/*`, csrf({
            origin: config.csrf.origin
        }));
        logger.info("CSRF protection enabled");
    }

    // ─── Request Logging ─────────────────────────────────────────────────
    config.app.use(`${basePath}/*`, requestLogger());

    const collectionRegistry = new BackendCollectionRegistry();
    let activeCollections = config.collections || [];
    if (config.collectionsDir && activeCollections.length === 0) {
        activeCollections = await loadCollectionsFromDirectory(config.collectionsDir);
        logger.info("Auto-discovered collections", { count: activeCollections.length,
dir: config.collectionsDir });
    }

    if (config.auth) {
        // Prepend defaultUsersCollection if not overridden by the developer's collections
        activeCollections = Array.from(
            new Map([defaultUsersCollection, ...activeCollections].map(c => [c.slug, c])).values()
        );
    }

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
            mountRoutes: dbAdapter.mountRoutes,
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
        const b = bootstrapper as BackendBootstrapper & { id?: string; isDefault?: boolean };
        logger.info("Running bootstrapper for driver", { driverId: b.id || bootstrapper.type });
        if (b.isDefault) {
            defaultDriverId = b.id || bootstrapper.type;
        }

        const driverResult = await bootstrapper.initializeDriver({ collections: activeCollections,
collectionRegistry });
        delegates[b.id || bootstrapper.type] = driverResult.driver;

        if ((b.id || bootstrapper.type) === defaultDriverId || !defaultDriverResult) {
            defaultDriverResult = driverResult;
        }

        if (bootstrapper.initializeRealtime) {
            const realtime = await bootstrapper.initializeRealtime({}, driverResult);
            realtimeServices[b.id || bootstrapper.type] = realtime as RealtimeProvider;
        }
    }

    const driverRegistry = DefaultDriverRegistry.create(delegates);
    activeCollections.forEach(collection => collectionRegistry.register(collection));

    const defaultDriver = driverRegistry.getOrDefault(defaultDriverId);
    if (!defaultDriver || !defaultDriverResult) {
        throw new Error("Default driver not initialized by bootstrappers");
    }
    const defaultBootstrapper = bootstrappers.find(b => (b as BackendBootstrapper & { id?: string }).id === defaultDriverId || b.type === defaultDriverId) || bootstrappers[0];
    const defaultRealtimeService = defaultDriverResult.realtimeProvider;

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
                userService: authAdapter.userManagement ?? {},
            };
        } else {
            // ── RebaseAuthConfig — wrap in built-in adapter ──
            const safeAuthConfig = config.auth as RebaseAuthConfig;
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
                        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\""
                    );
                }
                serviceKey = safeAuthConfig.serviceKey;
                logger.info("Service key configured for script/server-to-server authentication");
            }

            if (defaultBootstrapper.initializeAuth) {
                logger.info("Bootstrapping authentication via driver protocol");
                authConfigResult = await defaultBootstrapper.initializeAuth(config.auth, defaultDriverResult);

                // Build the built-in auth adapter from bootstrapper results
                if (authConfigResult) {
                    const oauthProviders: OAuthProvider<unknown>[] = [...(safeAuthConfig.providers || [])];
                    // OAuth providers are resolved later in route mounting,
                    // but we need them here for the adapter
                    authAdapter = createBuiltinAuthAdapter({
                        authRepository: authConfigResult.authRepository as import("./auth/interfaces").AuthRepository ?? authConfigResult.userService as import("./auth/interfaces").AuthRepository,
                        emailService: authConfigResult.emailService as import("./email").EmailService,
                        emailConfig: safeAuthConfig.email,
                        allowRegistration: safeAuthConfig.allowRegistration ?? false,
                        defaultRole: safeAuthConfig.defaultRole,
                        oauthProviders,
                        serviceKey,
                        hooks: config.hooks,
                        authHooks: safeAuthConfig.hooks,
                    });
                }

                logger.info("Authentication initialized");
            } else {
                logger.warn("Auth requested but default bootstrapper does not support initializeAuth");
            }
        }
    }

    let historyConfigResult: Record<string, unknown> | undefined = undefined;
    if (config.history) {
        if (defaultBootstrapper.initializeHistory) {
            logger.info("Bootstrapping entity history via driver protocol");
            historyConfigResult = await defaultBootstrapper.initializeHistory(config.history, defaultDriverResult);

            // Inject the historyService into the driver so saveEntity/deleteEntity can record history.
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
    let storageRegistry: StorageRegistry | undefined;
    let storageController: StorageController | undefined;

    if (config.storage) {
        logger.info("Configuring storage");
        const controllers: Record<string, StorageController> = {};

        // Helper: resolve a single storage entry to a controller
        const toController = (entry: BackendStorageConfig | StorageController, label: string): StorageController => {
            // Duck-type: if it has putObject, it's already a controller instance
            if (typeof (entry as StorageController).putObject === "function") {
                return entry as StorageController;
            }
            // Otherwise it's a config object — use the built-in factory
            const conf = entry as BackendStorageConfig;
            if (isProduction && conf.type === "local") {
                logger.warn(`Storage backend "${label}" uses local filesystem in production. ` +
                    "Files will be lost on container restart. " +
                    "Configure S3-compatible storage or a custom StorageController.");
            }
            return createStorageController(conf);
        };

        if (typeof config.storage === "object" && ("type" in config.storage || typeof (config.storage as StorageController).putObject === "function")) {
            // Single storage config or controller
            controllers[DEFAULT_STORAGE_ID] = toController(config.storage as BackendStorageConfig | StorageController, DEFAULT_STORAGE_ID);
        } else {
            // Multi-backend record
            for (const [storageId, entry] of Object.entries(config.storage as Record<string, BackendStorageConfig | StorageController>)) {
                controllers[storageId] = toController(entry, storageId);
            }
        }

        if (Object.keys(controllers).length > 0) {
            storageRegistry = DefaultStorageRegistry.create(controllers);
            storageController = storageRegistry.getDefault();
            logger.info("Initialized storage backends", { count: Object.keys(controllers).length });
        }
    }

    // basePath already resolved above

    // 4. Mount API Routes
    if (config.auth && authAdapter) {
        // ── Auth Capabilities Endpoint ───────────────────────────────────
        // Exposes adapter capabilities so the frontend knows what's available
        // (login form vs external redirect, OAuth providers, etc.)
        config.app.get(`${basePath}/auth/config`, async (c) => {
            const capabilities = await authAdapter!.getCapabilities();
            return c.json(capabilities);
        });

        if (!isAuthAdapter(config.auth)) {
            const safeAuthConfig = config.auth as RebaseAuthConfig;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const oauthProviders: OAuthProvider<any>[] = [...(safeAuthConfig.providers || [])];

            if (safeAuthConfig.google?.clientId) {
                const { createGoogleProvider } = await import("./auth");
                oauthProviders.push(createGoogleProvider(safeAuthConfig.google));
            }

            if (safeAuthConfig.linkedin?.clientId && safeAuthConfig.linkedin?.clientSecret) {
                const { createLinkedinProvider } = await import("./auth");
                oauthProviders.push(createLinkedinProvider(safeAuthConfig.linkedin as { clientId: string; clientSecret: string }));
            }

            if (safeAuthConfig.github?.clientId && safeAuthConfig.github?.clientSecret) {
                const { createGitHubProvider } = await import("./auth");
                oauthProviders.push(createGitHubProvider(safeAuthConfig.github));
            }

            if (safeAuthConfig.microsoft?.clientId && safeAuthConfig.microsoft?.clientSecret) {
                const { createMicrosoftProvider } = await import("./auth");
                oauthProviders.push(createMicrosoftProvider(safeAuthConfig.microsoft));
            }

            if (safeAuthConfig.apple?.clientId && safeAuthConfig.apple?.teamId && safeAuthConfig.apple?.keyId && safeAuthConfig.apple?.privateKey) {
                const { createAppleProvider } = await import("./auth");
                oauthProviders.push(createAppleProvider(safeAuthConfig.apple));
            }

            if (safeAuthConfig.facebook?.clientId && safeAuthConfig.facebook?.clientSecret) {
                const { createFacebookProvider } = await import("./auth");
                oauthProviders.push(createFacebookProvider(safeAuthConfig.facebook));
            }

            if (safeAuthConfig.twitter?.clientId && safeAuthConfig.twitter?.clientSecret) {
                const { createTwitterProvider } = await import("./auth");
                oauthProviders.push(createTwitterProvider(safeAuthConfig.twitter));
            }

            if (safeAuthConfig.discord?.clientId && safeAuthConfig.discord?.clientSecret) {
                const { createDiscordProvider } = await import("./auth");
                oauthProviders.push(createDiscordProvider(safeAuthConfig.discord));
            }

            if (safeAuthConfig.gitlab?.clientId && safeAuthConfig.gitlab?.clientSecret) {
                const { createGitLabProvider } = await import("./auth");
                oauthProviders.push(createGitLabProvider(safeAuthConfig.gitlab));
            }

            if (safeAuthConfig.bitbucket?.clientId && safeAuthConfig.bitbucket?.clientSecret) {
                const { createBitbucketProvider } = await import("./auth");
                oauthProviders.push(createBitbucketProvider(safeAuthConfig.bitbucket));
            }

            if (safeAuthConfig.slack?.clientId && safeAuthConfig.slack?.clientSecret) {
                const { createSlackProvider } = await import("./auth");
                oauthProviders.push(createSlackProvider(safeAuthConfig.slack));
            }

            if (safeAuthConfig.spotify?.clientId && safeAuthConfig.spotify?.clientSecret) {
                const { createSpotifyProvider } = await import("./auth");
                oauthProviders.push(createSpotifyProvider(safeAuthConfig.spotify));
            }

            // Re-create the built-in adapter with all resolved OAuth providers
            authAdapter = createBuiltinAuthAdapter({
                authRepository: authConfigResult!.authRepository as import("./auth/interfaces").AuthRepository ?? authConfigResult!.userService as import("./auth/interfaces").AuthRepository,
                emailService: authConfigResult!.emailService as import("./email").EmailService,
                emailConfig: safeAuthConfig.email,
                allowRegistration: safeAuthConfig.allowRegistration ?? false,
                defaultRole: safeAuthConfig.defaultRole,
                oauthProviders,
                serviceKey,
                hooks: config.hooks,
                authHooks: safeAuthConfig.hooks,
            });
        }

        // ── Mount auth & admin routes via the adapter ────────────────────
        if (authAdapter.createAuthRoutes) {
            const authRoutes = authAdapter.createAuthRoutes();
            if (authRoutes) {
                config.app.route(`${basePath}/auth`, authRoutes);
                logger.info("Auth routes mounted via adapter", { adapter: authAdapter.id });
            }
        }

        if (authAdapter.createAdminRoutes) {
            const adminRoutes = authAdapter.createAdminRoutes();
            if (adminRoutes) {
                config.app.route(`${basePath}/admin`, adminRoutes);
                logger.info("Admin routes mounted via adapter", { adapter: authAdapter.id });
            }
        }
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
            serviceKey,
        });
        config.app.route(`${basePath}/admin/api-keys`, apiKeyRoutes);
        logger.info("API key admin routes mounted", { path: `${basePath}/admin/api-keys` });
    }

    if (config.collectionsDir) {
        if (process.env.NODE_ENV !== "production") {
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
                ? (config.storage as BackendStorageConfig & { maxFileSize?: number }).maxFileSize
                : undefined
        ) ?? 50 * 1024 * 1024;

        const storageRoutes = createStorageRoutes({
            controller: storageController,
            requireAuth: resolveRequireAuth(config.auth)
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

        // Use adapter middleware when an AuthAdapter is available,
        // falling back to the built-in JWT middleware otherwise.
        if (authAdapter) {
            dataRouter.use("/*", createAdapterAuthMiddleware({
                adapter: authAdapter,
                driver: defaultDriver,
                requireAuth: dataRequireAuth,
                apiKeyStore,
            }));
        } else {
            dataRouter.use("/*", createAuthMiddleware({
                driver: defaultDriver,
                requireAuth: dataRequireAuth,
                serviceKey,
                apiKeyStore,
            }));
        }

        // Per-API-key rate limiting (no-op for non-API-key requests)
        if (apiKeyStore) {
            dataRouter.use("/*", createApiKeyRateLimiter());
        }

        // Mount history routes BEFORE the REST API subcollection catch-all so
        // that /:slug/:entityId/history is matched by the dedicated handler first.
        if (historyConfigResult && historyConfigResult.historyService) {
            const historyRoutes = createHistoryRoutes({
                historyService: historyConfigResult.historyService as import("./history/history-routes").HistoryService,
                registry: collectionRegistry,
                driver: defaultDriver
            });
            dataRouter.route("/", historyRoutes);
        }

        const restGenerator = new RestApiGenerator(activeCollections, defaultDriver, config.hooks?.data);
        dataRouter.route("/", restGenerator.generateRoutes());

        config.app.route(`${basePath}/data`, dataRouter);
    }

    // ── OpenAPI / Swagger ─────────────────────────────────────────────────
    if (config.enableSwagger !== false && activeCollections.length > 0) {
        const { generateOpenApiSpec } = await import("./api/openapi-generator");

        config.app.get(`${basePath}/docs`, (c) => {
            const spec = generateOpenApiSpec(activeCollections, {
                basePath,
                requireAuth: resolveRequireAuth(config.auth)
            });
            return c.json(spec);
        });

        if (process.env.NODE_ENV !== "production") {
            config.app.get(`${basePath}/swagger`, (c) => {
                return c.html(`<!DOCTYPE html>
<html>
<head>
    <title>Rebase API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
    <style>body{margin:0;padding:0;}</style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>SwaggerUIBundle({ url: '${basePath}/docs', dom_id: '#swagger-ui' });</script>
</body>
</html>`);
            });
            logger.info("Swagger UI available", { path: `${basePath}/swagger` });
        }
    }

    // ─── Server-side singleton ────────────────────────────────────────────
    // Build the admin-level RebaseClient and expose it as the `rebase` singleton.
    // This client bypasses the network and uses Hono's internal request handler.
    // websocketUrl is explicitly empty to prevent opening a WebSocket connection.
    const serverClient = createRebaseClient({
        baseUrl: "http://localhost",
        apiPath: basePath,
        websocketUrl: "",
        token: serviceKey,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            return await config.app.request(input as string | Request | URL, init);
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

    if (emailService) {
        Object.assign(serverClient, { email: emailService });
        logger.info("Email service attached to singleton", { configured: emailService.isConfigured() });
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

    _initRebase(serverClient);
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

            // Custom functions follow the same auth policy as data routes.
            // Per-route auth can be further refined inside individual functions.
            const functionsRequireAuth = resolveRequireAuth(config.auth);

            // Use adapter middleware when available, fallback to built-in
            if (authAdapter) {
                functionsRouter.use("/*", createAdapterAuthMiddleware({
                    adapter: authAdapter,
                    driver: defaultDriver,
                    requireAuth: functionsRequireAuth,
                    apiKeyStore,
                }));
            } else {
                functionsRouter.use("/*", createAuthMiddleware({
                    driver: defaultDriver,
                    requireAuth: functionsRequireAuth,
                    serviceKey,
                    apiKeyStore,
                }));
            }

            const fnRoutes = createFunctionRoutes(loadedFunctions);
            functionsRouter.route("/", fnRoutes);
            config.app.route(`${basePath}/functions`, functionsRouter);
            logger.info("Mounted custom functions", { count: loadedFunctions.length,
path: `${basePath}/functions` });
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

            logger.info("Mounted cron jobs", { count: loadedCronJobs.length,
path: `${basePath}/cron` });
        }
    }

    if ((defaultBootstrapper as BackendBootstrapper & { initializeWebsockets?: (...args: unknown[]) => unknown }).initializeWebsockets) {
        await (defaultBootstrapper as BackendBootstrapper & { initializeWebsockets: (...args: unknown[]) => unknown }).initializeWebsockets(config.server, defaultRealtimeService, defaultDriver, config.auth, authAdapter);
    }

    logger.info("Rebase Backend Initialized");

    // ── Deep Health Check ─────────────────────────────────────────────────
    const healthCheck = async (): Promise<HealthCheckResult> => {
        const start = performance.now();
        try {
            // Use admin.executeSql if available (Postgres), otherwise try fetchCollection as a probe
            const admin = defaultDriver.admin;
            if (isSQLAdmin(admin)) {
                await admin.executeSql("SELECT 1");
            } else {
                // Fallback: try a lightweight fetch to confirm driver is responsive
                await defaultDriver.fetchCollection({ path: "__health_check_nonexistent__",
limit: 1 });
            }
            const latencyMs = Math.round(performance.now() - start);
            return { healthy: true,
latencyMs };
        } catch (error: unknown) {
            const latencyMs = Math.round(performance.now() - start);
            logger.error("Health check failed", {
                error: error instanceof Error ? error : new Error(String(error)),
                latencyMs
            });
            return {
                healthy: false,
                latencyMs,
                details: {
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    };

    // ── Graceful Shutdown ─────────────────────────────────────────────────
    const shutdown = (timeoutMs = 15_000): Promise<void> => {
        return new Promise<void>((resolve) => {
            (async () => {
                logger.info("Shutting down Rebase Backend...");

                // 1. Stop cron scheduler
                if (cronScheduler) {
                    cronScheduler.stop();
                    logger.info("Cron scheduler stopped");
                }

                // 2. Tear down realtime services (LISTEN clients, debounce timers,
                //    subscriptions). Must happen BEFORE pool.end() so that pending
                //    timer callbacks don't fire against a closed pool.
                for (const [key, rt] of Object.entries(realtimeServices)) {
                    try {
                        const rtWithLifecycle = rt as RealtimeProvider & { destroy?: () => Promise<void>; stopListening?: () => Promise<void> };
                        if (typeof rtWithLifecycle.destroy === "function") {
                            await rtWithLifecycle.destroy();
                            logger.info(`Realtime service "${key}" destroyed`);
                        } else if (typeof rtWithLifecycle.stopListening === "function") {
                            await rtWithLifecycle.stopListening();
                            logger.info(`Realtime service "${key}" LISTEN client stopped`);
                        }
                    } catch (err) {
                        logger.warn(`Error destroying realtime service "${key}":`, { error: err });
                    }
                }

                // 3. Close the HTTP server (stop accepting, drain in-flight)
                config.server.close(() => {
                    logger.info("HTTP server closed");
                    resolve();
                });

                // 4. Force-resolve after timeout (unless disabled with 0)
                if (timeoutMs > 0) {
                    setTimeout(() => {
                        logger.warn(`Forced shutdown after ${timeoutMs / 1000}s timeout`);
                        resolve();
                    }, timeoutMs).unref();
                }
            })();
        });
    };

    return {
        driverRegistry,
        driver: defaultDriver,
        realtimeServices,
        realtimeService: defaultRealtimeService as RealtimeProvider,
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
