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
import { resolveRole, RoleConfigurationError } from "./role";
import { FunctionSelectionError } from "../functions/selection";
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
import { fetchBundle, shouldFetchBundle, BUNDLE_URL_ENV, BUNDLE_TOKEN_ENV, BUNDLE_FETCH_DIR_ENV } from "./fetch-bundle.js";
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

/**
 * Whether this process is the one that provisions the database schema.
 *
 * Separate from `REBASE_MIGRATE_ON_BOOT` on purpose. That variable answers
 * "does this deployment create its own schema at boot"; this answers "is this
 * *process* the one that does it", which only becomes a question once a
 * deployment boots the same bundle more than once.
 */
export interface SchemaProvisioningOptions {
    /** Default `true`. `false` leaves every DDL statement to another process. */
    provision?: boolean;
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
    /**
     * Whether this process provisions the collection schema and its RLS
     * policies at boot. Default `true` — the behaviour every deployment has.
     *
     * Set `false` on a process that is one of several booting the same bundle
     * against the same database. `CREATE … IF NOT EXISTS` reads the catalog and
     * then writes to it non-atomically, so peers starting together do collide;
     * exactly one owner is cheaper and more legible than N racing and retrying.
     *
     * Independent of `REBASE_MIGRATE_ON_BOOT`, which answers a different
     * question — whether *this deployment* provisions its schema at boot at all,
     * rather than which of its processes does.
     */
    provisionSchema?: boolean;
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
            token: process.env[BUNDLE_TOKEN_ENV],
            destination: process.env[BUNDLE_FETCH_DIR_ENV] || undefined
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

    // What this process is. Resolved before anything is built, because a role
    // that cannot boot must say so at once rather than after opening a pool and
    // half-mounting a server.
    const runtimeRole = resolveRole(env);
    if (runtimeRole.role !== "all") {
        logger.info(`Runtime role: ${runtimeRole.role}`, {
            provisionsSchema: runtimeRole.provisionSchema,
            ...runtimeRole.ownership
        });
    }

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
    // Collection tables and their RLS policies are created by
    // `initializeRebaseBackend`, not here. This is where that used to live, and
    // living here was the bug: it meant managed tenants got provisioned and
    // every app that boots by calling `initializeRebaseBackend` directly — its
    // own image, `runtimeMode: custom` — got nothing, came up serving sign-in,
    // and 500'd every data route. Provisioning belongs in the function both
    // paths go through. See ../boot/provision.
    //
    // What stays here is the one diagnosis that needs the bundle to make: a
    // build that produced a config package with no collections directory looks,
    // from inside the runtime, exactly like a project that declared nothing.
    warnOnUnusableBundleShape(bundle);

    const backend = await initializeRebaseBackend({
        server,
        app,
        basePath: env.REBASE_BASE_PATH,
        // The schema hooks run before any driver initializes, so they need a
        // stand-in for the result they are declared to take. This path has one
        // — the coordinator opened the connection itself — and passes it
        // because a driver written before the argument became optional reads
        // `driverResult.internals` unconditionally. Wrapping matters: passed
        // bare, it type-checks through any cast and then dies inside the driver
        // on `undefined.db`.
        provisioningDriverResult: dataSources[0]
            ? ({ internals: dataSources[0].connection } as unknown as InitializedDriver)
            : undefined,
        collectionsDir: bundle.collectionsDir,
        functionsDir: bundle.functionsDir,
        cronsDir: bundle.cronsDir,
        // One process provisions. `bootFromBundle` no longer does this itself —
        // it moved into `initializeRebaseBackend` so every boot path gets it —
        // so the role's answer travels as an option rather than as a call here.
        provisionSchema: options.provisionSchema ?? runtimeRole.provisionSchema,
        surfaces: runtimeRole.surfaces,
        ownership: runtimeRole.ownership,
        functionsSelection: runtimeRole.functionsSelection,
        functionsUpstream: runtimeRole.functionsUpstream,
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
    // A provisioning run has already done its work by the time it gets here:
    // schema DDL happens during boot, above. What is left is to NOT start
    // serving. Deciding it at the socket rather than earlier is what keeps this
    // honest — the process that migrates is byte-identical to the one that
    // serves, right up to the point where one of them binds a port.
    const provisionOnly = options.listen === false || resolveProvisionOnly(process.env);
    if (!provisionOnly) {
        if (isProduction) {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(env.PORT, () => {
                    server.removeListener("error", reject);
                    // The socket, not the request: `PORT=0` asks the OS to pick
                    // one, and reporting the request then announces a port
                    // nothing listens on — to the log, and to every caller of
                    // `BootedRuntime.port`.
                    const address = server.address();
                    if (address && typeof address === "object") port = address.port;
                    resolve();
                });
            });
            logger.info(`Rebase runtime listening on port ${port}`);
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

    // A provisioning run reports what it did and stops. Without this it is a
    // process that migrated successfully and then sat there holding an open
    // pool — which to a Kubernetes Job is a migration that never finished, and
    // to a `helm upgrade` waiting on a pre-upgrade hook is an upgrade that
    // hangs until the backoff limit reports a failure for work that succeeded.
    //
    // Only when the environment asked for it: `listen: false` is also how the
    // test suite boots a runtime it wants to drive in-process, and exiting
    // under that would take the test runner with it.
    if (resolveProvisionOnly(process.env) && options.listen !== false) {
        logger.info("Schema provisioning complete — exiting without serving (REBASE_PROVISION_ONLY).");
        await closeConnections();
        return {
            app,
            server,
            backend,
            bundle,
            env,
            port,
            dataSources,
            shutdown: async () => { /* already closed */ }
        };
    }

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

    // No backend and no data sources exist for a static app, but the HTTP server
    // is real and something has to close it.
    //
    // The stub used to be `shutdown: async () => {}`, and `installShutdownHandlers`
    // drains by calling exactly that — so SIGTERM ran an empty drain and exited
    // with the server still accepting. Every in-flight response was truncated at
    // process exit, and every response that arrived during the seconds it takes
    // an endpoint removal to propagate was truncated too. A rollout of a static
    // app dropped requests, and the only symptom was a connection reset on the
    // client, which reads as a network blip.
    const staticBackend = {
        shutdown: async () => {
            await new Promise<void>((resolve) => {
                // `close` stops accepting and waits for in-flight responses.
                // Errors are ignored deliberately: a server that was never
                // listening (`listen: false`) rejects, and failing the shutdown
                // over that would turn a clean exit into a force-kill.
                server.close(() => resolve());
            });
        }
    } as unknown as RebaseBackendInstance;

    if (options.handleSignals !== false) {
        installShutdownHandlers(staticBackend, {
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
        backend: staticBackend,
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
/**
 * Whether this process should provision the schema and stop, rather than serve.
 *
 * The shape a migration Job wants: same image, same bundle, same boot — and no
 * socket. Nothing else changes, which is the point. A separate migration image
 * would be a second artifact to build, publish and keep in step with the
 * runtime, and the failure mode of it drifting is a schema applied by a version
 * that is not the one about to run against it.
 *
 * A blank value is *unset*: `REBASE_PROVISION_ONLY=${SOMETHING}` with SOMETHING
 * undefined is the ordinary way to write a compose file or a Helm template, and
 * reading it as true would turn an ordinary deployment into one that migrates
 * and then refuses to serve.
 */
export function resolveProvisionOnly(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = (env.REBASE_PROVISION_ONLY ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true";
}

export async function runFromBundle(options: BootOptions = {}): Promise<BootedRuntime> {
    try {
        const booted = await bootFromBundle(options);
        // Exit explicitly rather than letting the event loop drain. A bundle is
        // free to leave a handle open — a driver's keepalive, a library's
        // timer — and a Job that hangs on one of those is indistinguishable
        // from a migration that never finished.
        if (resolveProvisionOnly(process.env) && options.listen !== false) {
            process.exit(0);
        }
        return booted;
    } catch (err) {
        // Both of these are "your configuration says something that cannot
        // work", so both get the message and the fix rather than a stack trace.
        // The reader is looking at a container that will not start.
        if (err instanceof BundleError || err instanceof RoleConfigurationError ||
            err instanceof FunctionSelectionError) {
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
 * A warning rather than a refusal. Either pairing can be fine — both are
 * supported, and a boot that dies on version arithmetic would be a far worse
 * failure than the drift it is guarding against. This only has to make the skew
 * *visible*, so that the next person reading the log starts from the right
 * question.
 *
 * ## Both directions, because only one of them was ever reported
 *
 * A driver *behind* the runtime was the original case: the platform ships a fix,
 * every tenant rolls onto the new image, and none of them run the fixed driver.
 *
 * A driver *ahead* by a minor is the mirror image and was silent until it cost
 * another day. It is not the deliberate pin this check used to assume — that is
 * a patch bump, and still says nothing. It is what a floating runtime range
 * produces when the image lags: a bundle built against a framework the image
 * predates, so a feature split across `@rebasepro/server` and the driver has
 * only its driver half present. Nothing errors. The half that landed reads
 * config the older harness never sets, defaults it, and a subsystem — realtime
 * channels, in the case that prompted this — is inert in a process that passes
 * every probe. The fix is the opposite of the stale case, which is exactly why
 * the two need separate sentences: bump the *image*, not the package.json.
 */
export function warnOnDriverSkew(
    dataSources: InitializedDataSource[],
    runtimeVersion: string | undefined
): void {
    if (!runtimeVersion) return;

    for (const source of dataSources) {
        const skew = describeDriverSkew(source.driverVersion, runtimeVersion);
        if (skew.stale) {
            logger.warn(
                `Driver version skew on data source "${source.key}": ` +
                    `"${source.driverPackage}" is at ${source.driverVersion}, this runtime is ${runtimeVersion}. ` +
                    "A driver is installed from your bundle's dependencies, NOT supplied by the platform image, " +
                    "so a newer runtime does not update it. Capabilities added after " +
                    `${source.driverVersion} are unavailable to this deployment — bump ` +
                    `"${source.driverPackage}" in your project's package.json and redeploy.`
            );
            continue;
        }
        if (skew.ahead) {
            logger.warn(
                `Driver version skew on data source "${source.key}": ` +
                    `"${source.driverPackage}" is at ${source.driverVersion}, this runtime is ${runtimeVersion}. ` +
                    "The driver is AHEAD of the platform image by a minor or more. Your bundle supplies the " +
                    "driver while the image supplies `@rebasepro/server`, so a feature spanning both packages " +
                    "has only its driver half running here — the other half is missing, and the usual symptom " +
                    "is a subsystem that is silently inert rather than one that errors. " +
                    "Deploy a newer platform image (or pin the runtime version), " +
                    `or pin "${source.driverPackage}" back to ${runtimeVersion} in your project's package.json.`
            );
        }
    }
}
/**
 * Warn about a bundle whose shape makes provisioning impossible.
 *
 * `initializeRebaseBackend` provisions the collection schema for every boot
 * path, and it decides from what actually resolved: a project with no
 * collections reads them from the database and creates nothing. That rule is
 * right, but from inside the runtime it cannot tell "this project declares no
 * collections" from "this build lost them" — and the second is a broken build
 * that silently serves an empty API.
 *
 * Only the bundle knows the difference, so this is the one piece of the old
 * bundle-side provisioning worth keeping here. It warns; it never provisions.
 */
export function warnOnUnusableBundleShape(bundle: LoadedBundle): void {
    if (bundle.manifest.kind !== "backend") return;
    if (!bundle.manifest.entry?.config) return;
    if (bundle.collectionsDir) return;
    logger.warn(
        `This bundle declares a config package at "${bundle.manifest.entry.config}", but no collections ` +
            "directory resolved inside it, so no collections were loaded and no tables will be created. " +
            "Rebuild with `rebase build` and check the manifest's `entry.collections`."
    );
}
