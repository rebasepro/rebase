import path from "path";
import { createServer, type Server } from "http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    DEFAULT_DATA_SOURCE_KEY,
    normalizeStorageSources,
    type CollectionConfig,
    type DataSourceDefinition,
    type InitializedDriver,
    type StorageSourceDefinition
} from "@rebasepro/types";
import { createDataSourceRegistry, resolveDataSource } from "@rebasepro/common";

import { initializeRebaseBackend, type RebaseBackendInstance } from "../init";
import { loadCollectionsFromDirectory } from "../collections/loader";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";
import { serveSPA } from "../serve-spa";
import { installShutdownHandlers } from "../init/shutdown";
import { listenWithPortRetry, cleanupDevPortFile } from "../utils/dev-port";

import { loadBootEnv, resolveCorsOrigin, resolveEnableSwagger, type RebaseBootEnv } from "./env";
import {
    BundleError,
    loadBundle,
    loadBundleConfigExports,
    loadBundleSchema,
    loadUsersCollection,
    type LoadedBundle
} from "./bundle";
import { resolveDataSources, resolveStorageSources } from "./sources";
import { bundleResolutionRoots, initializeDataSources, probeDataSource, type InitializedDataSource } from "./driver";
import { resolveAuthOptions } from "./options";
import { createMetricsRoutes, createMetricsMiddleware } from "../metrics";
import { fetchBundle, shouldFetchBundle, BUNDLE_URL_ENV, BUNDLE_TOKEN_ENV } from "./fetch-bundle.js";
import { describeDriverSkew, readRuntimeVersion, schemaRecoveryGuidance } from "./version-skew";

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
    // Serverless platforms have no init container, so there may be nothing on
    // disk yet. `REBASE_BUNDLE_URL` means "download it first"; an explicit
    // bundle path always wins, because a platform that mounted one AND set a URL
    // is mid-migration between the two and the local copy is definitely there.
    //
    // This runs on EVERY cold start — a scale-from-zero, an instance recycled
    // after an hour idle — which is why the URL it is given is a stable endpoint
    // rather than a signed one that would have expired.
    const fetchedDir = !options.bundleDir && !options.bundle && shouldFetchBundle()
        ? await fetchBundle({
            url: process.env[BUNDLE_URL_ENV]!,
            token: process.env[BUNDLE_TOKEN_ENV]
        })
        : undefined;

    const bundleDir = options.bundleDir
        || fetchedDir
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
    logger.debug("Loaded bundle", {
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
    // `rebase.json` (recorded in the manifest) is authoritative; config code may
    // add sources it does not mention — a `direct`-transport bucket reached by a
    // provider SDK has no reason to appear in a document the platform reads for
    // provisioning. Merging rather than choosing is what keeps the console's view
    // and the tenant's reality the same list. A bundle built before the manifest
    // carried sources falls through to the config exports alone.
    const declaredStorage = normalizeStorageSources(
        bundle.manifest.storage?.sources,
        configExports.storageSources
    );
    const storageSourceDefs: StorageSourceDefinition[] | undefined =
        declaredStorage.length > 0 ? declaredStorage : undefined;

    // ── Databases ────────────────────────────────────────────────────────────
    const resolvedSources = resolveDataSources(process.env, dataSourceDefs);
    const schema = await loadBundleSchema(bundle);
    const driverRoots = bundleResolutionRoots(bundle.dir);
    const dataSources = await initializeDataSources(resolvedSources, schema, driverRoots);
    warnOnDriverSkew(dataSources, readRuntimeVersion(driverRoots));

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
        enableSwagger: resolveEnableSwagger(env),
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

    // ── RLS policies ───────────────────────────────────────────────────────────
    //
    // Now that the backend is up — auth tables and the `auth.*` helper functions
    // exist, the restricted user role is provisioned, and the collection tables
    // were created above — apply the collections' row-level-security policies.
    // Tables without them are not servable: authenticated requests run as a
    // restricted role, so a read with no policy returns nothing (a public
    // collection answers 401) and a write with no policy is denied. This is the
    // second half of what `db push` does, and the half a managed tenant could
    // not reach any other way. Ordered after `initializeRebaseBackend` on
    // purpose: `CREATE POLICY` validates the `auth.uid()` functions it references
    // exist, and those are created during auth initialization. Same
    // `REBASE_MIGRATE_ON_BOOT=none` opt-out as the table creation above.
    await ensureCollectionPolicies(bundle, dataSources, env);

    // Restrict metric labels to collections that exist, now that they do.
    metrics?.setKnownCollections(
        backend.collectionRegistry.getCollections()
            .map(collection => collection.slug)
            .filter((slug): slug is string => Boolean(slug))
    );

    // ── Health ───────────────────────────────────────────────────────────────
    // Not part of `initializeRebaseBackend` because it sits outside `basePath`:
    // orchestrators probe `/health`, not `/api/health`.
    //
    // Registered under `basePath` as well, because every other route a developer
    // touches is there and `/api/health` answering 404 reads as "the server is
    // broken" rather than "that is not where health lives". An orchestrator keeps
    // probing the bare path; a person gets an answer wherever they look first.
    const healthPaths = ["/health", `${(env.REBASE_BASE_PATH || "/api").replace(/\/$/, "")}/health`];
    for (const healthPath of [...new Set(healthPaths)]) app.get(healthPath, async (c) => {
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
                // `/.well-known` among them: the JWKS is mounted at the root,
                // so the "/"-rooted app's catch-all would otherwise answer a
                // verifier's fetch with index.html — a 200 of HTML, which
                // reads as "this issuer has no keys" rather than as a routing
                // mistake.
                excludePaths: ["/health", "/livez", "/metrics", "/.well-known", ...siblings],
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
    // `/api/health` too — same reason as the backend path: a static app served by
    // this runtime still answers on the prefix a developer will try first.
    for (const healthPath of [...new Set(["/health", `${basePath.replace(/\/$/, "")}/health`])]) {
        app.get(healthPath, (c) => c.json({ status: "ok", latencyMs: 0 }));
    }

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
 * Say so, once per boot, when a data source's driver is older than this runtime.
 *
 * The check exists because of how a managed deployment is assembled: the image
 * supplies `@rebasepro/server` (the entrypoint symlinks it over the bundle's
 * copy) while every driver comes from the bundle's own `deps.declared`, pinned
 * by the project's package.json. So the platform can ship a fix, roll every
 * tenant onto the new image, and still have none of them running the fixed
 * driver. Nothing detected that before this: the halves simply disagreed in
 * silence until some capability turned out to be missing three layers down.
 *
 * A warning rather than a refusal. Old drivers are usually fine — the pairing is
 * supported, and a boot that dies on version arithmetic would be a far worse
 * failure than the drift it is guarding against. This only has to make the skew
 * *visible*, so that the next person reading the log starts from the right
 * question.
 */
export function warnOnDriverSkew(
    dataSources: InitializedDataSource[],
    runtimeVersion: string | undefined
): void {
    if (!runtimeVersion) return;

    for (const source of dataSources) {
        const skew = describeDriverSkew(source.driverVersion, runtimeVersion);
        if (!skew.stale) continue;
        logger.warn(
            `Driver version skew on data source "${source.key}": ` +
                `"${source.driverPackage}" is at ${source.driverVersion}, this runtime is ${runtimeVersion}. ` +
                "A driver is installed from your bundle's dependencies, NOT supplied by the platform image, " +
                "so a newer runtime does not update it. Capabilities added after " +
                `${source.driverVersion} are unavailable to this deployment — bump ` +
                `"${source.driverPackage}" in your project's package.json and redeploy.`
        );
    }
}

/**
 * The collections a data source's engine is the store for.
 *
 * A bundle's collections directory holds *every* collection the project
 * declares, whatever engine serves it — that is the point of `dataSource`
 * routing. What it is not is a list of tables to create: handing the whole
 * directory to the primary source's bootstrapper made a Firestore collection
 * declared alongside the Postgres ones arrive as an empty Postgres table, with
 * RLS policies, while the app went on reading its documents from Firestore.
 *
 * Excluding is deliberately conservative. A collection that names neither an
 * `engine` nor a `dataSource` belongs to whichever source is primary — the
 * "postgres" that `resolveDataSource` falls back to there is a default, not a
 * declaration, and must not exclude anything on its own. Only a collection that
 * explicitly routes to a *different* engine is dropped, so a project running two
 * sources on the same engine is unaffected.
 */
export function collectionsStoredBy(
    collections: CollectionConfig[],
    primary: InitializedDataSource,
    dataSources: InitializedDataSource[]
): CollectionConfig[] {
    const registry = createDataSourceRegistry(
        dataSources.map(source => ({ key: source.key, engine: source.engine }))
    );
    return collections.filter(collection => {
        // The collection's own `engine` is read first, and `resolveDataSource`
        // is not asked to settle it: that function lets a registered definition
        // override the collection's engine, which is the right precedence for
        // *routing* and the wrong one here — a collection declaring
        // `engine: "firestore"` and no `dataSource` would come back as the
        // default source's "postgres" and be provisioned as a table.
        const declared = collection.engine
            ?? (collection.dataSource ? resolveDataSource(collection, registry).engine : undefined);
        if (!declared) return true;
        return declared === primary.engine;
    });
}

/** Say what was routed elsewhere, so a missing table is never a silent one. */
function logForeignCollections(
    all: CollectionConfig[],
    stored: CollectionConfig[],
    primary: InitializedDataSource
): void {
    if (stored.length === all.length) return;
    const foreign = all.filter(c => !stored.includes(c)).map(c => c.slug);
    logger.info(
        `Skipping ${foreign.length} collection(s) served by another engine, not "${primary.engine}": ${foreign.join(", ")}. ` +
            "Their storage is not managed by this data source."
    );
}

/**
 * Bring the database's collection tables up to date before serving.
 *
 * Delegates to whichever driver bootstrapped the default data source; a driver
 * without `ensureCollectionSchema` (a schemaless one, or an older build) skips
 * rather than failing, which is why this cannot break an existing deployment.
 *
 * Every path out of here says why, at info or louder. Guaranteeing the tables
 * exist is this function's entire job, so "it declined, and said nothing" is the
 * one outcome it must never produce: a deployment that skips comes up answering
 * sign-in and 500ing every `/api/data/*` route, and the operator's only evidence
 * is what these lines print. Silence here has already sent one investigation
 * chasing a stale runtime image that was not stale.
 *
 * Failure is fatal on purpose. Booting anyway would produce exactly the state
 * this exists to prevent — an app that answers sign-in and 500s every data
 * request — and a crash-looping pod with the DDL error in its logs is a far
 * better signal than a running one that silently cannot serve.
 */
export async function ensureCollectionSchema(
    bundle: LoadedBundle,
    dataSources: InitializedDataSource[],
    env: RebaseBootEnv
): Promise<void> {
    // `info` is for the bundle shapes with legitimately nothing to create;
    // `warn` is for a bundle that asked for collection tables and is not getting
    // them. A backend carrying a config package is the shape that expects
    // tables, so every stop after that point is a real problem worth raising.
    const skip = (reason: string, level: "info" | "warn" = "info"): void => {
        logger[level](`Collection schema: skipped — ${reason}`);
    };

    const mode = env.REBASE_MIGRATE_ON_BOOT || "ensure";
    if (mode === "none") {
        skip("REBASE_MIGRATE_ON_BOOT=none, leaving the database schema untouched.");
        return;
    }
    // A bundle without a config package introspects its collections FROM the
    // database, so there is nothing to create; a `static` bundle has no database
    // at all. Both conditions matter: gating on `kind` alone would push a
    // schema into an existing database that a project only meant to read.
    if (bundle.manifest.kind !== "backend") {
        skip(`this bundle's kind is "${bundle.manifest.kind}", which serves no database.`);
        return;
    }
    if (!bundle.manifest.entry?.config) {
        skip("this bundle declares no config package, so its collections are read from the database rather than from code.");
        return;
    }
    // Reachable only when the config package exists but carries no collections
    // directory — a build that produced a manifest the runtime cannot act on,
    // which looks identical from the outside to a database that was never
    // migrated. Name the path so the two are told apart from the log alone.
    if (!bundle.collectionsDir) {
        skip(
            `this bundle declares a config package at "${bundle.manifest.entry.config}", but no collections directory resolved inside it. ` +
                "Rebuild with `rebase build` and check the manifest's `entry.collections`.",
            "warn"
        );
        return;
    }

    const primary = dataSources[0];
    if (!primary) {
        skip("no data source was initialized for this runtime.", "warn");
        return;
    }
    if (!primary.bootstrapper.ensureCollectionSchema) {
        // What is missing is the method on the ADAPTER — the only object boot
        // ever sees — which is not the same as the driver package lacking the
        // code. Three unrelated causes collapse into this one symptom: a
        // schemaless driver, a driver too old to have it, and a driver that
        // implements it on a class the adapter never forwards. Only the middle
        // one is a version problem, so saying "the driver does not implement"
        // and naming versions points at the wrong suspect two times in three —
        // it sent one investigation after driver and runtime releases that were
        // both fine while a wrapper silently dropped the method in between.
        const skew = describeDriverSkew(primary.driverVersion, readRuntimeVersion(bundleResolutionRoots(bundle.dir)));
        skip(
            `the adapter from "${primary.driverPackage}" (engine "${primary.engine}") does not expose collection-table creation. ` +
                (skew.detail ? `${skew.detail} ` : "") +
                "The driver package may well implement it on a class the adapter does not forward, so check the adapter's shape before blaming its version. " +
                "Collection tables will NOT be created, so every /api/data route will fail on a missing relation.\n" +
                schemaRecoveryGuidance({ staleDriver: skew.stale }),
            "warn"
        );
        return;
    }

    const loaded = await loadCollectionsFromDirectory(bundle.collectionsDir);
    if (loaded.length === 0) {
        skip(`no collections were loaded from "${bundle.collectionsDir}".`, "warn");
        return;
    }

    const collections = collectionsStoredBy(loaded, primary, dataSources);
    logForeignCollections(loaded, collections, primary);
    if (collections.length === 0) {
        skip(`none of the ${loaded.length} declared collection(s) are stored by the "${primary.engine}" data source.`);
        return;
    }

    const { applied } = await primary.bootstrapper.ensureCollectionSchema(
        collections,
        preInitDriverResult(primary),
        message => logger.debug(`schema: ${message}`)
    );
    // Only the change is news. "Collection schema is up to date" is the
    // overwhelmingly common outcome and says nothing a developer can act on;
    // at `debug` it is still there for anyone diagnosing a boot.
    if (applied > 0) {
        logger.info(`Applied ${applied} additive schema change(s) before boot.`);
    } else {
        logger.debug("Collection schema is up to date.");
    }
}

/**
 * The `InitializedDriver` to hand a bootstrapper before any driver exists.
 *
 * Both schema hooks are declared to take the result of `initializeDriver`, but
 * they deliberately run *before* it: the tables have to exist before the driver
 * introspects them and registers collections. So there is no real result to
 * pass, and the field the hooks actually read is `internals` — the driver's own
 * opaque handle, which at this point is exactly the connection the coordinator
 * just opened (`{ db, pool }`, where `db` is the drizzle instance).
 *
 * Wrapping it matters: the connection passed *bare* type-checks through any cast
 * and then reads `undefined.db` inside the driver, which surfaces as a boot
 * crash — `TypeError: Cannot read properties of undefined (reading 'db')` — on
 * every project whose driver implements these hooks. The cast is narrowed to the
 * one field a pre-init result cannot honestly supply, rather than `as never`
 * blanketing the whole argument.
 */
function preInitDriverResult(source: InitializedDataSource): InitializedDriver {
    return { internals: source.connection } as unknown as InitializedDriver;
}

/**
 * Apply the project's RLS policies before serving — the companion to
 * {@link ensureCollectionSchema}, which creates the tables this makes servable.
 *
 * Runs after `initializeRebaseBackend`, not alongside table creation: the
 * generated policies call the `auth.*` helper functions, and `CREATE POLICY`
 * validates those exist, so this cannot run before auth is initialized. The
 * gate conditions mirror `ensureCollectionSchema` (mode, bundle shape, driver
 * support) — and because that function already ran and explained any skip on
 * this same boot, the benign gates here return quietly rather than logging the
 * same reason twice. The one thing it does say out loud is a driver that
 * created tables but cannot apply policies: that is the difference between a
 * served collection and a 401, and it must not pass in silence.
 */
export async function ensureCollectionPolicies(
    bundle: LoadedBundle,
    dataSources: InitializedDataSource[],
    env: RebaseBootEnv
): Promise<void> {
    const mode = env.REBASE_MIGRATE_ON_BOOT || "ensure";
    if (mode === "none") return;
    if (bundle.manifest.kind !== "backend") return;
    if (!bundle.manifest.entry?.config) return;
    if (!bundle.collectionsDir) return;

    const primary = dataSources[0];
    if (!primary) return;
    if (!primary.bootstrapper.ensureCollectionPolicies) {
        // The tables may exist (ensureCollectionSchema ran) while their RLS does
        // not. Name it: a silent skip here reads from outside the pod as "the
        // database has no data".
        //
        // Whether that means denied or exposed depends on the driver, so the
        // wording below does not promise either. On the Postgres driver the
        // user role is granted DML schema-wide before policies are applied, so
        // a table without RLS is open, not locked — that driver revokes the
        // grant itself rather than relying on this message being true.
        const skew = describeDriverSkew(primary.driverVersion, readRuntimeVersion(bundleResolutionRoots(bundle.dir)));
        logger.warn(
            `Collection policies: skipped — the "${primary.driverPackage}" driver (engine "${primary.engine}") ` +
                "does not apply RLS policies at boot. " +
                (skew.detail ? `${skew.detail} ` : "") +
                "Collections are not row-secured until policies are applied — depending on the " +
                "driver's grants that means reads are denied or that they are unfiltered. " +
                "Do not serve traffic until this is resolved.\n" +
                schemaRecoveryGuidance({ staleDriver: skew.stale })
        );
        return;
    }

    const loaded = await loadCollectionsFromDirectory(bundle.collectionsDir);
    if (loaded.length === 0) return;

    // Quiet here: `ensureCollectionSchema` already listed what it routed
    // elsewhere on this same boot.
    const collections = collectionsStoredBy(loaded, primary, dataSources);
    if (collections.length === 0) return;

    const { applied } = await primary.bootstrapper.ensureCollectionPolicies(
        collections,
        preInitDriverResult(primary),
        message => logger.debug(`policies: ${message}`)
    );
    // Same rule as the schema summary above: report the change, not the
    // steady state.
    if (applied > 0) {
        logger.info(`Applied ${applied} RLS policy statement(s) before serving.`);
    } else {
        logger.debug("RLS policies are up to date.");
    }
}
