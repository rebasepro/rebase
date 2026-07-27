import path from "path";
import { createServer, type Server } from "http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    DEFAULT_DATA_SOURCE_KEY,
    type DataSourceDefinition,
    type StorageSourceDefinition
} from "@rebasepro/types";

import { initializeRebaseBackend, type RebaseBackendInstance } from "../init";
import { loadCollectionsFromDirectory } from "../collections/loader";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";
import { serveSPA } from "../serve-spa";
import { installShutdownHandlers } from "../init/shutdown";
import { listenWithPortRetry, cleanupDevPortFile } from "../utils/dev-port";

import { loadBootEnv, resolveCorsOrigin, type RebaseBootEnv } from "./env";
import {
    BundleError,
    loadBundle,
    loadBundleConfigExports,
    loadBundleSchema,
    loadUsersCollection,
    type LoadedBundle
} from "./bundle";
import { resolveDataSources, resolveStorageSources } from "./sources";
import { initializeDataSources, probeDataSource, type InitializedDataSource } from "./driver";
import { resolveAuthOptions } from "./options";
import { createMetricsRoutes, createMetricsMiddleware } from "../metrics";

/** A running runtime, and the handle to stop it. */
export interface BootedRuntime {
    app: Hono<HonoEnv>;
    server: Server;
    backend: RebaseBackendInstance;
    bundle: LoadedBundle;
    env: RebaseBootEnv;
    /** The port actually bound, which in development may not be the one asked for. */
    port: number;
    dataSources: InitializedDataSource[];
    shutdown: () => Promise<void>;
}

export interface BootOptions {
    /** Bundle directory. Defaults to `REBASE_BUNDLE` or `./dist-bundle`. */
    bundleDir?: string;
    /**
     * A bundle that has already been resolved.
     *
     * `rebase dev` passes one built from source (see `createSourceBundle`), so
     * development and production run the identical boot path rather than two
     * implementations that drift apart.
     */
    bundle?: LoadedBundle;
    /** Skip binding a port. Used by tests that drive `app.fetch` directly. */
    listen?: boolean;
    /** Install SIGTERM/SIGINT handlers. Off for tests. */
    handleSignals?: boolean;
}

/**
 * Boot a Rebase runtime from a built bundle.
 *
 * This is the entrypoint the official container image runs, and it is the same
 * code path a self-hosted deployment uses — there is no separate "platform"
 * runtime. Everything it does was previously the responsibility of a
 * hand-written `backend/src/index.ts` in every project: wiring CORS and security
 * headers, opening database connections, resolving storage, mounting health and
 * metrics, serving the client bundle, and shutting all of it down cleanly.
 *
 * Moving it here is what makes a project's *code* separable from the *engine*
 * that runs it: the bundle can then be handed to a newer runtime without being
 * rebuilt, which is the precondition for patching a fleet.
 */
export async function bootFromBundle(options: BootOptions = {}): Promise<BootedRuntime> {
    const bundleDir = options.bundleDir
        || process.env.REBASE_BUNDLE
        || path.resolve(process.cwd(), "dist-bundle");

    // The bundle is located before the environment is validated, because
    // pointing at the wrong directory is the likeliest first-run mistake, and
    // "no bundle here, build one" is far more useful than being told
    // DATABASE_URL is missing — which it also is, but only because nothing has
    // been set up yet.
    const bundle = options.bundle ?? loadBundle(bundleDir);

    // Where dev-only state (the port file, the MCP discovery file) lives. A
    // source boot runs from the project root; a built bundle sits inside it.
    const devRoot = process.env.REBASE_DEV_PROJECT_ROOT || process.cwd();
    logger.info("Loaded bundle", {
        app: bundle.manifest.app,
        kind: bundle.manifest.kind,
        schemaVersion: bundle.manifest.schemaVersion,
        builtAgainst: bundle.manifest.runtime?.builtAgainst
    });

    // A `static` bundle is a built SPA and nothing else — no collections, no data
    // sources, no database. It runs on this same image so a project's frontend
    // and admin apps are just more bundles, deployed and scaled independently of
    // the backend. Handled BEFORE `loadBootEnv`, which requires DATABASE_URL and
    // JWT_SECRET — a static app needs neither, and demanding them would be the
    // one thing that could stop a folder of assets from being served.
    if (bundle.manifest.kind === "static") {
        return bootStaticApp(bundle, devRoot, options);
    }

    const env = loadBootEnv();
    const isProduction = env.NODE_ENV === "production";

    // ── Declarations ─────────────────────────────────────────────────────────
    const configExports = await loadBundleConfigExports(bundle);
    const dataSourceDefs: DataSourceDefinition[] | undefined = configExports.dataSources;
    const storageSourceDefs: StorageSourceDefinition[] | undefined = configExports.storageSources;

    // ── Databases ────────────────────────────────────────────────────────────
    const resolvedSources = resolveDataSources(process.env, dataSourceDefs);
    const schema = await loadBundleSchema(bundle);
    // Where to look for driver packages. A built bundle installs its own
    // dependencies beside it; a source boot in a workspace has them inside the
    // package that declared them.
    const driverRoots = [
        bundle.dir,
        path.join(bundle.dir, "backend"),
        path.join(bundle.dir, "config")
    ];
    const dataSources = await initializeDataSources(resolvedSources, schema, driverRoots);

    // ── HTTP ─────────────────────────────────────────────────────────────────
    const app = new Hono<HonoEnv>();

    app.use("/*", cors({
        origin: resolveCorsOrigin(env),
        credentials: true
    }));
    app.use("/*", secureHeaders({
        // An API serves assets and tokens to origins other than its own, so the
        // browser defaults are wrong here in two specific ways:
        //
        // - `crossOriginResourcePolicy` defaults to `same-origin`, which blocks a
        //   frontend on another origin from loading anything this server serves.
        // - `crossOriginOpenerPolicy` defaults to `same-origin`, which severs
        //   `window.opener` and breaks the OAuth popup sign-in that
        //   `resolveAuthOptions` configures whenever GOOGLE_CLIENT_ID is set.
        //
        // Cross-origin access is still governed by CORS; these only stop the
        // browser from refusing before CORS is consulted.
        crossOriginResourcePolicy: "cross-origin",
        crossOriginOpenerPolicy: "same-origin-allow-popups"
    }));

    // Classified against the configured base path, not a hardcoded "/api" — a
    // project on a different base path would otherwise label every request
    // "other" and the per-surface breakdown would silently be empty.
    const metrics = env.REBASE_METRICS
        ? createMetricsMiddleware(env.REBASE_BASE_PATH)
        : undefined;
    if (metrics) {
        app.use("/*", metrics.middleware);
    }

    const server = createServer(getRequestListener(app.fetch));

    // ── Backend ──────────────────────────────────────────────────────────────
    const usersCollection = await loadUsersCollection(bundle);
    const storage = resolveStorageSources(
        process.env,
        storageSourceDefs,
        path.join(bundle.dir, "uploads")
    );

    // ── Schema ───────────────────────────────────────────────────────────────
    //
    // Create any collection tables the database is missing, before the backend
    // starts serving. `initializeRebaseBackend` ensures AUTH tables; nothing
    // ensured collection tables, so a runtime booted against a fresh database
    // came up with working sign-in and a 500 on every `/api/data/*` route — the
    // state every managed tenant would have launched in.
    //
    // Additive only: the driver may create missing tables, columns and enum
    // types, and may never drop or rewrite. Destructive changes stay a
    // deliberate migration, because this runs unattended with nobody reading a
    // diff. `REBASE_MIGRATE_ON_BOOT=none` opts out entirely for a deployment
    // that manages its own schema.
    await ensureCollectionSchema(bundle, dataSources, env);

    const backend = await initializeRebaseBackend({
        server,
        app,
        basePath: env.REBASE_BASE_PATH,
        collectionsDir: bundle.collectionsDir,
        functionsDir: bundle.functionsDir,
        cronsDir: bundle.cronsDir,
        bootstrappers: dataSources.map(s => s.bootstrapper),
        dataSources: dataSourceDefs,
        storage,
        storageSources: storageSourceDefs,
        // Per-object access control comes from the project's own code — no
        // environment variable can express "this user may read this key".
        storageAuthorize: configExports.storageAuthorize,
        storagePublicRead: env.STORAGE_PUBLIC_READ,
        storageInsecureAllowAnyAuthenticated: env.STORAGE_ALLOW_ANY_AUTHENTICATED,
        callbacks: configExports.callbacks,
        auth: resolveAuthOptions(env, usersCollection),
        history: env.REBASE_HISTORY,
        enableSwagger: env.REBASE_ENABLE_SWAGGER,
        compression: env.REBASE_COMPRESSION,
        maxBodySize: env.REBASE_MAX_BODY_SIZE,
        logging: env.LOG_LEVEL ? { level: env.LOG_LEVEL } : undefined,
        // CORS is installed above, before this call.
        corsHandled: true,
        // Published by the contract endpoint, so a client generated in another
        // repository can tell whether it is built against this schema.
        // Empty for a source boot: nothing was built, so the runtime computes a
        // version from the live collections instead of quoting one.
        schemaVersion: bundle.manifest.schemaVersion || undefined,
        runtimeVersion: bundle.manifest.runtime?.builtAgainst,
        // The schema editor rewrites collection *source* files. A bundle holds
        // compiled output, so there is nothing it could meaningfully edit —
        // and a running deployment is the last place that should be possible.
        schemaEditor: false
    });

    // Restrict metric labels to collections that exist, now that they do.
    metrics?.setKnownCollections(
        backend.collectionRegistry.getCollections()
            .map(collection => collection.slug)
            .filter((slug): slug is string => Boolean(slug))
    );

    // ── Health ───────────────────────────────────────────────────────────────
    // Not part of `initializeRebaseBackend` because it sits outside `basePath`:
    // orchestrators probe `/health`, not `/api/health`.
    app.get("/health", async (c) => {
        const result = await backend.healthCheck();

        // `backend.healthCheck()` probes the default driver only. With several
        // databases configured, that would report a healthy server while every
        // collection routed to an unreachable secondary returns 500 — an
        // orchestrator would keep sending it traffic.
        const secondaries = await Promise.all(
            dataSources
                .filter(source => source.key !== DEFAULT_DATA_SOURCE_KEY)
                .map(async source => ({
                    key: source.key,
                    result: await probeDataSource(source)
                }))
        );

        const unhealthy = secondaries
            .filter(source => source.result && !source.result.healthy)
            .map(source => ({ key: source.key,
                error: source.result?.error }));
        const healthy = result.healthy && unhealthy.length === 0;

        return c.json({
            status: healthy ? "ok" : "degraded",
            latencyMs: result.latencyMs,
            ...(result.details ? { details: result.details } : {}),
            ...(unhealthy.length > 0 ? { dataSources: unhealthy } : {})
        }, healthy ? 200 : 503);
    });

    // Liveness vs readiness: `/health` touches the database, so a database blip
    // would make an orchestrator kill an otherwise healthy process. `/livez`
    // answers "is this process running", which is the question a liveness probe
    // is actually asking.
    app.get("/livez", (c) => c.json({ status: "ok" }));

    // ── Metrics ──────────────────────────────────────────────────────────────
    if (metrics) {
        if (!env.REBASE_METRICS_TOKEN) {
            logger.warn(
                "Metrics are enabled without REBASE_METRICS_TOKEN — /metrics is readable by anyone " +
                "who can reach this port. Set a token, or keep the port on a private network."
            );
        }
        app.route("/metrics", createMetricsRoutes(metrics.registry, env.REBASE_METRICS_TOKEN));
    }

    // ── Static assets ────────────────────────────────────────────────────────
    // Mounted last: each app's `serveSPA` ends in a catch-all under its own
    // prefix, so anything registered after it would never be reached.
    //
    // `bundle.staticApps` arrives longest-path-first, which puts the "/"-rooted
    // app last. Ordering alone is not enough, though — every app also excludes
    // its siblings, or a miss under "/admin" would be answered with the site's
    // index.html at the admin's URL.
    if (env.REBASE_SERVE_STATIC) {
        for (const staticApp of bundle.staticApps) {
            const siblings = bundle.staticApps
                .filter(other => other !== staticApp)
                .map(other => other.path)
                .filter(other => other !== "/");
            logger.info("Serving static assets", { path: staticApp.dir,
at: staticApp.path });
            serveSPA(app, {
                frontendPath: staticApp.dir,
                basePath: staticApp.path,
                apiBasePath: env.REBASE_BASE_PATH,
                excludePaths: ["/health", "/livez", "/metrics", ...siblings],
                spa: staticApp.spa
            });
        }
    }

    // ── Listen ───────────────────────────────────────────────────────────────
    let port = env.PORT;
    if (options.listen !== false) {
        if (isProduction) {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(env.PORT, () => {
                    server.removeListener("error", reject);
                    resolve();
                });
            });
            logger.info(`Rebase runtime listening on port ${env.PORT}`);
        } else {
            port = await listenWithPortRetry(server, env.PORT, {
                portFileDir: devRoot,
                serviceKey: env.REBASE_SERVICE_KEY
            });
            // Phrased to match what `rebase dev` watches for before it starts
            // the frontend. One convention, shared by the template entrypoint
            // this replaced — changing the wording here silently breaks dev.
            logger.info(`Server running at http://localhost:${port}`);
        }
    }

    const closeConnections = async (): Promise<void> => {
        await Promise.allSettled(
            dataSources.map(source => source.connection.pool?.end())
        );
        if (!isProduction) cleanupDevPortFile(devRoot);
    };

    if (options.handleSignals !== false) {
        installShutdownHandlers(backend, { onCleanup: closeConnections });
        // The graceful path is not the only way a dev server ends. Without this,
        // a crash or a force-exit leaves `.rebase-dev-port` behind and the next
        // run inherits a port nothing is listening on.
        if (!isProduction) {
            process.on("exit", () => cleanupDevPortFile(devRoot));
        }
    }

    return {
        app,
        server,
        backend,
        bundle,
        env,
        port,
        dataSources,
        shutdown: async () => {
            await backend.shutdown();
            await closeConnections();
        }
    };
}

/**
 * Boot a `static` bundle: serve its built SPA and nothing else.
 *
 * No database, no data sources, no backend — a static app is a folder of assets
 * plus an `index.html`. Kept deliberately minimal so it is cheap to run and
 * cannot fail for a reason a static site never should (a database blip, a
 * missing collection). Exposes the same `/livez` and `/health` the orchestrator
 * probes, so a static app is provisioned by the exact same deployment path as a
 * backend — the only difference is what the bundle contains.
 */
async function bootStaticApp(
    bundle: LoadedBundle,
    devRoot: string,
    options: BootOptions
): Promise<BootedRuntime> {
    if (bundle.staticApps.length === 0) {
        throw new BundleError(
            "A static bundle declares no assets to serve.",
            "Its manifest has `kind: \"static\"` but no `entry.static` — rebuild the app with `rebase build`."
        );
    }

    // Read only the handful of variables a static server uses, directly — the
    // full env schema requires a database and a JWT secret, which this path
    // deliberately does not.
    const isProduction = process.env.NODE_ENV === "production";
    const requestedPort = Number(process.env.PORT ?? "3001") || 3001;
    const basePath = process.env.REBASE_BASE_PATH || "/api";
    const metricsEnabled = process.env.REBASE_METRICS === "true";
    const metricsToken = process.env.REBASE_METRICS_TOKEN;

    const app = new Hono<HonoEnv>();

    // Assets must be loadable from other origins (a custom domain, the console),
    // so the same cross-origin relaxation the API path makes applies here.
    app.use("/*", secureHeaders({
        crossOriginResourcePolicy: "cross-origin",
        crossOriginOpenerPolicy: "same-origin-allow-popups"
    }));

    const metrics = metricsEnabled ? createMetricsMiddleware(basePath) : undefined;
    if (metrics) app.use("/*", metrics.middleware);

    const server = createServer(getRequestListener(app.fetch));

    // Liveness and readiness are the same for a static app: it is ready the
    // moment it can serve, and there is no database to make readiness lie.
    app.get("/livez", (c) => c.json({ status: "ok" }));
    app.get("/health", (c) => c.json({ status: "ok", latencyMs: 0 }));

    if (metrics) {
        app.route("/metrics", createMetricsRoutes(metrics.registry, metricsToken));
    }

    // Mounted last: each app's serveSPA ends in a catch-all under its prefix.
    // Same ordering and sibling-exclusion rules as the backend path above.
    for (const staticApp of bundle.staticApps) {
        const siblings = bundle.staticApps
            .filter(other => other !== staticApp)
            .map(other => other.path)
            .filter(other => other !== "/");
        logger.info("Serving static app", {
            app: bundle.manifest.app,
            path: staticApp.dir,
            at: staticApp.path
        });
        serveSPA(app, {
            frontendPath: staticApp.dir,
            basePath: staticApp.path,
            apiBasePath: basePath,
            excludePaths: ["/health", "/livez", "/metrics", ...siblings],
            spa: staticApp.spa
        });
    }

    let port = requestedPort;
    if (options.listen !== false) {
        if (isProduction) {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(requestedPort, () => {
                    server.removeListener("error", reject);
                    resolve();
                });
            });
            logger.info(`Rebase static runtime listening on port ${requestedPort}`);
        } else {
            port = await listenWithPortRetry(server, requestedPort, { portFileDir: devRoot });
            logger.info(`Server running at http://localhost:${port}`);
        }
    }

    // No backend and no data sources exist for a static app; the stub keeps the
    // returned shape uniform so callers (and shutdown) do not special-case it.
    const noopBackend = { shutdown: async () => {} } as unknown as RebaseBackendInstance;

    if (options.handleSignals !== false) {
        installShutdownHandlers(noopBackend, {
            onCleanup: async () => { if (!isProduction) cleanupDevPortFile(devRoot); }
        });
        if (!isProduction) process.on("exit", () => cleanupDevPortFile(devRoot));
    }

    // A static app runs on a deliberately reduced env — only the fields it read
    // above are meaningful. Surfaced for callers/tests without pretending the
    // database-shaped fields exist.
    const env = {
        NODE_ENV: (process.env.NODE_ENV ?? "development"),
        PORT: requestedPort,
        REBASE_BASE_PATH: basePath,
        REBASE_METRICS: metricsEnabled,
        REBASE_METRICS_TOKEN: metricsToken
    } as unknown as RebaseBootEnv;

    return {
        app,
        server,
        backend: noopBackend,
        bundle,
        env,
        port,
        dataSources: [],
        shutdown: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            if (!isProduction) cleanupDevPortFile(devRoot);
        }
    };
}

/**
 * Boot and keep running, reporting failures the way a container should.
 *
 * A `BundleError` is a configuration problem with a known fix, so it prints the
 * message and its hint without a stack trace — the stack is noise when the
 * answer is "set DATABASE_URL". Anything else keeps its stack, because it is a
 * bug and the trace is the point.
 */
export async function runFromBundle(options: BootOptions = {}): Promise<BootedRuntime> {
    try {
        return await bootFromBundle(options);
    } catch (err) {
        if (err instanceof BundleError) {
            logger.error(err.message);
            if (err.hint) logger.error(err.hint);
        } else {
            logger.error("Failed to start the Rebase runtime", {
                error: err instanceof Error ? err : new Error(String(err))
            });
        }
        process.exit(1);
    }
}


/**
 * Bring the database's collection tables up to date before serving.
 *
 * Delegates to whichever driver bootstrapped the default data source; a driver
 * without `ensureCollectionSchema` (a schemaless one, or an older build) simply
 * skips, which is why this cannot break an existing deployment.
 *
 * Failure is fatal on purpose. Booting anyway would produce exactly the state
 * this exists to prevent — an app that answers sign-in and 500s every data
 * request — and a crash-looping pod with the DDL error in its logs is a far
 * better signal than a running one that silently cannot serve.
 */
async function ensureCollectionSchema(
    bundle: LoadedBundle,
    dataSources: InitializedDataSource[],
    env: RebaseBootEnv
): Promise<void> {
    const mode = env.REBASE_MIGRATE_ON_BOOT || "ensure";
    if (mode === "none") {
        logger.info("REBASE_MIGRATE_ON_BOOT=none — leaving the database schema untouched.");
        return;
    }
    // A bundle without a config package introspects its collections FROM the
    // database, so there is nothing to create; a `static` bundle has no database
    // at all. Both conditions matter: gating on `kind` alone would push a
    // schema into an existing database that a project only meant to read.
    if (bundle.manifest.kind !== "backend") return;
    if (!bundle.manifest.entry?.config) return;
    if (!bundle.collectionsDir) return;

    const primary = dataSources[0];
    if (!primary?.bootstrapper.ensureCollectionSchema) return;

    const collections = await loadCollectionsFromDirectory(bundle.collectionsDir);
    if (collections.length === 0) return;

    const { applied } = await primary.bootstrapper.ensureCollectionSchema(
        collections,
        primary.connection as never,
        message => logger.info(`schema: ${message}`)
    );
    logger.info(
        applied > 0
            ? `Applied ${applied} additive schema change(s) before boot.`
            : "Collection schema is up to date."
    );
}
