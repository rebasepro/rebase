import { DataDriver, EntityCollection, BackendBootstrapper, BootstrappedAuth, RealtimeProvider, HealthCheckResult, InitializedDriver } from "@rebasepro/types";
import { BackendCollectionRegistry } from "./collections/BackendCollectionRegistry";
import { loadCollectionsFromDirectory } from "./collections/loader";
import { DriverRegistry, DEFAULT_DRIVER_ID, DefaultDriverRegistry } from "./services/driver-registry";
import { Server } from "http";

import { RestApiGenerator } from "./api/rest/api-generator";
import { createAuthMiddleware } from "./auth/middleware";
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
import { createRebaseClient } from "@rebasepro/client";
import { createHistoryRoutes } from "./history";
import { EmailConfig, createEmailService } from "./email";
import type { EmailService } from "./email";
import type { OAuthProvider } from "./auth/interfaces";
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
    google?: { clientId: string };
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
    providers?: OAuthProvider[];
    [key: string]: unknown;
}

export interface RebaseBackendConfig {
    collections?: EntityCollection[];
    collectionsDir?: string;
    server: Server;
    app: Hono<HonoEnv>;
    basePath?: string;
    bootstrappers: BackendBootstrapper[];
    logging?: {
        level?: "error" | "warn" | "info" | "debug";
    };
    auth?: RebaseAuthConfig;
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

    logger.info("Initializing Rebase Backend (Bootstrapper Protocol V2)");

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
        logger.info("Auto-discovered collections", { count: activeCollections.length, dir: config.collectionsDir });
    }

    const realtimeServices: Record<string, RealtimeProvider> = {};
    const delegates: Record<string, DataDriver> = {};
    const bootstrappers = config.bootstrappers || [];

    if (bootstrappers.length === 0) {
        throw new Error("No bootstrappers provided. Cannot initialize database drivers.");
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

        const driverResult = await bootstrapper.initializeDriver({ collections: activeCollections, collectionRegistry });
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

    if (config.auth) {
        // Secure JWT setup proactively within core package memory to eliminate dual-package hazards
        const safeAuthConfig = config.auth;
        if (safeAuthConfig.jwtSecret) {
            configureJwt({
                secret: safeAuthConfig.jwtSecret,
                accessExpiresIn: safeAuthConfig.accessExpiresIn || "1h",
                refreshExpiresIn: safeAuthConfig.refreshExpiresIn || "30d"
            });
        }

        // ── Service Key Validation ───────────────────────────────────────
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
            logger.info("Authentication initialized");
        } else {
            logger.warn("Auth requested but default bootstrapper does not support initializeAuth");
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
            if (typeof (entry as StorageController).putObject === 'function') {
                return entry as StorageController;
            }
            // Otherwise it's a config object — use the built-in factory
            const conf = entry as BackendStorageConfig;
            if (isProduction && conf.type === 'local') {
                logger.warn(`Storage backend "${label}" uses local filesystem in production. ` +
                    "Files will be lost on container restart. " +
                    "Configure S3-compatible storage or a custom StorageController.");
            }
            return createStorageController(conf);
        };

        if (typeof config.storage === 'object' && ('type' in config.storage || typeof (config.storage as StorageController).putObject === 'function')) {
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
    if (config.auth && authConfigResult) {
        const oauthProviders: OAuthProvider[] = [...(config.auth.providers || [])];
        
        if (config.auth.google?.clientId) {
            const { createGoogleProvider } = await import("./auth");
            oauthProviders.push(createGoogleProvider(config.auth.google.clientId));
        }

        if (config.auth.linkedin?.clientId && config.auth.linkedin?.clientSecret) {
            const { createLinkedinProvider } = await import("./auth");
            oauthProviders.push(createLinkedinProvider(config.auth.linkedin as { clientId: string; clientSecret: string }));
        }

        if (config.auth.github?.clientId && config.auth.github?.clientSecret) {
            const { createGitHubProvider } = await import("./auth");
            oauthProviders.push(createGitHubProvider(config.auth.github));
        }

        if (config.auth.microsoft?.clientId && config.auth.microsoft?.clientSecret) {
            const { createMicrosoftProvider } = await import("./auth");
            oauthProviders.push(createMicrosoftProvider(config.auth.microsoft));
        }

        if (config.auth.apple?.clientId && config.auth.apple?.teamId && config.auth.apple?.keyId && config.auth.apple?.privateKey) {
            const { createAppleProvider } = await import("./auth");
            oauthProviders.push(createAppleProvider(config.auth.apple));
        }

        if (config.auth.facebook?.clientId && config.auth.facebook?.clientSecret) {
            const { createFacebookProvider } = await import("./auth");
            oauthProviders.push(createFacebookProvider(config.auth.facebook));
        }

        if (config.auth.twitter?.clientId && config.auth.twitter?.clientSecret) {
            const { createTwitterProvider } = await import("./auth");
            oauthProviders.push(createTwitterProvider(config.auth.twitter));
        }

        if (config.auth.discord?.clientId && config.auth.discord?.clientSecret) {
            const { createDiscordProvider } = await import("./auth");
            oauthProviders.push(createDiscordProvider(config.auth.discord));
        }

        if (config.auth.gitlab?.clientId && config.auth.gitlab?.clientSecret) {
            const { createGitLabProvider } = await import("./auth");
            oauthProviders.push(createGitLabProvider(config.auth.gitlab));
        }

        if (config.auth.bitbucket?.clientId && config.auth.bitbucket?.clientSecret) {
            const { createBitbucketProvider } = await import("./auth");
            oauthProviders.push(createBitbucketProvider(config.auth.bitbucket));
        }

        if (config.auth.slack?.clientId && config.auth.slack?.clientSecret) {
            const { createSlackProvider } = await import("./auth");
            oauthProviders.push(createSlackProvider(config.auth.slack));
        }

        if (config.auth.spotify?.clientId && config.auth.spotify?.clientSecret) {
            const { createSpotifyProvider } = await import("./auth");
            oauthProviders.push(createSpotifyProvider(config.auth.spotify));
        }

        const authRoutes = createAuthRoutes({
            authRepo: authConfigResult.authRepository as import("./auth/interfaces").AuthRepository ?? authConfigResult.userService as import("./auth/interfaces").AuthRepository,
            emailService: authConfigResult.emailService as import("./email").EmailService,
            emailConfig: config.auth.email,
            allowRegistration: config.auth.allowRegistration ?? false,
            defaultRole: config.auth.defaultRole,
            oauthProviders
        });
        config.app.route(`${basePath}/auth`, authRoutes);

        const adminRoutes = createAdminRoutes({ 
            authRepo: authConfigResult.authRepository as import("./auth/interfaces").AuthRepository ?? authConfigResult.userService as import("./auth/interfaces").AuthRepository,
            emailService: authConfigResult.emailService as import("./email").EmailService,
            emailConfig: config.auth.email,
            serviceKey,
        });
        config.app.route(`${basePath}/admin`, adminRoutes);
    }

    if (config.collectionsDir) {
        if (process.env.NODE_ENV !== "production") {
            const { createSchemaEditorRoutes } = await import("./api/schema-editor-routes");
            const schemaEditorRoutes = createSchemaEditorRoutes(config.collectionsDir);
            
            if (config.auth?.requireAuth !== false && !!config.auth?.jwtSecret) {
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
            requireAuth: config.auth?.requireAuth ?? true
        });

        // Apply a permissive body limit specifically for the upload endpoint
        storageRoutes.use('/upload', bodyLimit({
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
        const dataRequireAuth = config.auth?.requireAuth !== false;

        if (!dataRequireAuth) {
            logger.warn(
                "Data routes running WITHOUT authentication enforcement. " +
                "Access control is fully delegated to Postgres RLS policies. " +
                "If no RLS policies exist, data is publicly accessible. " +
                "Set auth.requireAuth to true (or remove it) to require authentication."
            );
        }

        dataRouter.use("/*", createAuthMiddleware({
            driver: defaultDriver,
            requireAuth: dataRequireAuth,
            serviceKey
        }));

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

        const restGenerator = new RestApiGenerator(activeCollections, defaultDriver);
        dataRouter.route("/", restGenerator.generateRoutes());

        config.app.route(`${basePath}/data`, dataRouter);
    }

    // ── OpenAPI / Swagger ─────────────────────────────────────────────────
    if (config.enableSwagger !== false && activeCollections.length > 0) {
        const { generateOpenApiSpec } = await import("./api/openapi-generator");

        config.app.get(`${basePath}/docs`, (c) => {
            const spec = generateOpenApiSpec(activeCollections, {
                basePath,
                requireAuth: config.auth?.requireAuth !== false
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
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            return await config.app.request(input as string | Request | URL, init);
        }
    });

    // Attach email service to the server client when configured.
    // The email service may come from the auth bootstrapper or from the auth config directly.
    let emailService: EmailService | undefined;
    if (authConfigResult?.emailService) {
        emailService = authConfigResult.emailService as EmailService;
    } else if (config.auth?.email) {
        emailService = createEmailService(config.auth.email);
    }

    if (emailService) {
        Object.assign(serverClient, { email: emailService });
        logger.info("Email service attached to singleton", { configured: emailService.isConfigured() });
    }

    _initRebase(serverClient);
    logger.info("Rebase singleton initialized");

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
            const functionsRequireAuth = config.auth?.requireAuth !== false;

            functionsRouter.use("/*", createAuthMiddleware({
                driver: defaultDriver,
                requireAuth: functionsRequireAuth,
                serviceKey
            }));

            const fnRoutes = createFunctionRoutes(loadedFunctions);
            functionsRouter.route("/", fnRoutes);
            config.app.route(`${basePath}/functions`, functionsRouter);
            logger.info("Mounted custom functions", { count: loadedFunctions.length, path: `${basePath}/functions` });
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

            // Attach database persistence if the driver supports SQL
            const store = createCronStore(defaultDriver);
            if (store) {
                await store.ensureTable();
                cronScheduler.setStore(store);
            }

            const cronRouter = new Hono<HonoEnv>();

            // Cron admin routes require authentication + admin role
            if (config.auth?.requireAuth !== false && !!config.auth?.jwtSecret) {
                cronRouter.use("/*", requireAuth, requireAdmin);
            }

            cronRouter.route("/", createCronRoutes(cronScheduler));
            config.app.route(`${basePath}/cron`, cronRouter);

            // Start the scheduler
            cronScheduler.start();

            logger.info("Mounted cron jobs", { count: loadedCronJobs.length, path: `${basePath}/cron` });
        }
    }

    if ((defaultBootstrapper as BackendBootstrapper & { initializeWebsockets?: (...args: unknown[]) => unknown }).initializeWebsockets) {
        await (defaultBootstrapper as BackendBootstrapper & { initializeWebsockets: (...args: unknown[]) => unknown }).initializeWebsockets(config.server, defaultRealtimeService, defaultDriver, config.auth);
    }

    logger.info("Rebase Backend Initialized");

    // ── Deep Health Check ─────────────────────────────────────────────────
    const healthCheck = async (): Promise<HealthCheckResult> => {
        const start = performance.now();
        try {
            // Use executeSql if available (Postgres), otherwise try fetchCollection as a probe
            if (typeof defaultDriver.executeSql === "function") {
                await defaultDriver.executeSql("SELECT 1");
            } else {
                // Fallback: try a lightweight fetch to confirm driver is responsive
                await defaultDriver.fetchCollection({ path: "__health_check_nonexistent__", limit: 1 });
            }
            const latencyMs = Math.round(performance.now() - start);
            return { healthy: true, latencyMs };
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
            logger.info("Shutting down Rebase Backend...");

            // 1. Stop cron scheduler
            if (cronScheduler) {
                cronScheduler.stop();
                logger.info("Cron scheduler stopped");
            }

            // 2. Close the HTTP server (stop accepting, drain in-flight)
            config.server.close(() => {
                logger.info("HTTP server closed");
                resolve();
            });

            // 3. Force-resolve after timeout (unless disabled with 0)
            if (timeoutMs > 0) {
                setTimeout(() => {
                    logger.warn(`Forced shutdown after ${timeoutMs / 1000}s timeout`);
                    resolve();
                }, timeoutMs).unref();
            }
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
