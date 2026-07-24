import path from "path";
import { createServer, type Server } from "http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import type { DataSourceDefinition, StorageSourceDefinition } from "@rebasepro/types";

import { initializeRebaseBackend, type RebaseBackendInstance } from "../init";
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
import { initializeDataSources, type InitializedDataSource } from "./driver";
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
    const env = loadBootEnv();
    const isProduction = env.NODE_ENV === "production";

    const bundleDir = options.bundleDir
        || process.env.REBASE_BUNDLE
        || path.resolve(process.cwd(), "dist-bundle");

    const bundle = options.bundle ?? loadBundle(bundleDir);
    logger.info("Loaded bundle", {
        app: bundle.manifest.app,
        mode: bundle.manifest.mode,
        schemaVersion: bundle.manifest.schemaVersion,
        builtAgainst: bundle.manifest.runtime?.builtAgainst
    });

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
    app.use("/*", secureHeaders());

    const metrics = env.REBASE_METRICS ? createMetricsMiddleware() : undefined;
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

    const backend = await initializeRebaseBackend({
        server,
        app,
        basePath: env.REBASE_BASE_PATH,
        mode: bundle.manifest.mode ?? "cms",
        collectionsDir: bundle.collectionsDir,
        functionsDir: bundle.functionsDir,
        cronsDir: bundle.cronsDir,
        bootstrappers: dataSources.map(s => s.bootstrapper),
        dataSources: dataSourceDefs,
        storage,
        storageSources: storageSourceDefs,
        storagePublicRead: env.STORAGE_PUBLIC_READ,
        storageInsecureAllowAnyAuthenticated: env.STORAGE_ALLOW_ANY_AUTHENTICATED,
        auth: resolveAuthOptions(env, usersCollection),
        history: env.REBASE_HISTORY,
        enableSwagger: env.REBASE_ENABLE_SWAGGER,
        compression: env.REBASE_COMPRESSION,
        maxBodySize: env.REBASE_MAX_BODY_SIZE !== undefined
            ? Number(env.REBASE_MAX_BODY_SIZE)
            : undefined,
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

    // ── Health ───────────────────────────────────────────────────────────────
    // Not part of `initializeRebaseBackend` because it sits outside `basePath`:
    // orchestrators probe `/health`, not `/api/health`.
    app.get("/health", async (c) => {
        const result = await backend.healthCheck();
        return c.json({
            status: result.healthy ? "ok" : "degraded",
            latencyMs: result.latencyMs,
            ...(result.details ? { details: result.details } : {})
        }, result.healthy ? 200 : 503);
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
    // Mounted last: `serveSPA` claims `/*` with a catch-all fallback, so anything
    // registered after it would never be reached.
    if (env.REBASE_SERVE_STATIC) {
        const staticRoot = bundle.staticDir ?? bundle.adminDir;
        if (staticRoot) {
            logger.info("Serving static assets", { path: staticRoot });
            serveSPA(app, {
                frontendPath: staticRoot,
                apiBasePath: env.REBASE_BASE_PATH,
                excludePaths: ["/health", "/livez", "/metrics"]
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
            const projectRoot = process.cwd();
            port = await listenWithPortRetry(server, env.PORT, {
                portFileDir: projectRoot,
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
        if (!isProduction) cleanupDevPortFile(process.cwd());
    };

    if (options.handleSignals !== false) {
        installShutdownHandlers(backend, { onCleanup: closeConnections });
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
