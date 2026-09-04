import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    initializeRebaseBackend,
    installShutdownHandlers,
    // {{#frontend}}
    serveSPA,
    // {{/frontend}}
    HonoEnv,
    listenWithPortRetry,
    cleanupDevPortFile,
    initializeDataSources,
    resolveDataSources,
    resolveStorageSources,
    logger
} from "@rebasepro/server";
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";
// Side-effect import: declaring is what registers, so anything that dropped
// this as "unused" would leave the backend with no buckets — silently.
import "../../config/resources.js";
// {{#collections}}
import { enums, relations, tables } from "./schema.generated.js";
// {{/collections}}
import { storageAuthorize } from "../../config/storage.js";
import { env } from "./env.js";
// {{#collections}}
import usersCollection from "../../config/collections/users.js";
// {{/collections}}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Which databases and buckets this project has, read from the declarations in
// `config/resources.ts`. One declaration site, so this process, the platform
// and the frontend all read the same list. A project that declares none gets
// one default source of each, from the plain unsuffixed variables.
const dataSources = declaredDataSources();
const storageSources = declaredStorageSources();

// ─── App ─────────────────────────────────────────────────────────────
const app: Hono<HonoEnv> = new Hono<HonoEnv>();

const isProduction = env.NODE_ENV === "production";
const allowedOrigins = isProduction
    ? (() => {
        const origins = env.CORS_ORIGINS || env.FRONTEND_URL;
        if (!origins) {
            throw new Error(
                "CORS_ORIGINS or FRONTEND_URL must be set in production. " +
                "Example: CORS_ORIGINS=https://yourdomain.com"
            );
        }
        return origins.split(",").map(s => s.trim());
    })()
    : [];

// In dev we still restrict which origins are reflected. Because `credentials`
// is enabled, reflecting an arbitrary Origin would let any website the
// developer happens to visit make credentialed cross-origin requests to this
// dev server (and read the responses) using the developer's session. So dev
// reflects only localhost origins; requests with no Origin (curl, same-origin)
// are unaffected.
const isLocalhostOrigin = (origin: string): boolean => {
    try {
        const { hostname } = new URL(origin);
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
    } catch {
        return false;
    }
};

app.use("/*", cors({
    origin: (origin) => {
        if (isProduction) return allowedOrigins.includes(origin) ? origin : null;
        if (!origin) return "*";
        return isLocalhostOrigin(origin) ? origin : null;
    },
    credentials: true
}));

app.use("/*", secureHeaders());

// ─── Databases ───────────────────────────────────────────────────────
// One connection per declared database, resolved from `DATABASE_URL` for the
// default one and `DATABASE_URL__<KEY>` for every other — the same resolver the
// managed runtime uses, so this entrypoint cannot drift from it.
//
// It reads `process.env` rather than the typed `env` above on purpose: the
// suffixed names belong to sources this project declared, so no fixed schema
// can list them.
//
// Doing this by hand — one `createPostgresDatabaseConnection(env.DATABASE_URL)`
// — is what this file used to do, and it quietly broke the moment anyone
// declared a second database: collections routed to it fell back to the default
// driver and their rows landed in the wrong database, behind a server that
// looked healthy.
const resolvedDataSources = resolveDataSources(process.env, dataSources);

// ─── Start ───────────────────────────────────────────────────────────
async function startServer() {
    const jwtSecret = env.JWT_SECRET;
    const PORT = env.PORT;
    const server = createServer(getRequestListener(app.fetch));

    // `backend/crons` holds the scheduled jobs — nightly backups among them.
    // Passed only when the directory exists, because a configured `cronsDir`
    // with nothing in it mounts the cron routes and warns at every boot.
    // Sibling-relative like `functionsDir`: both compile alongside this file, so
    // the same path is right from source and from `backend/dist/backend/src`.
    const cronsDir = path.resolve(__dirname, "../crons");

    // Open a connection per declared database. Sequential, and a failure on the
    // second closes whatever the first opened rather than leaking it against a
    // server this process is about to abandon.
    const drivers = await initializeDataSources(
        resolvedDataSources,
        // {{#collections}}
        { tables, enums, relations },
        // {{/collections}}
        // {{^collections}}
        // No generated schema: this project declares no collections in code.
        undefined,
        // {{/collections}}
        [__dirname]
    );

    const backend = await initializeRebaseBackend({
        // {{#collections}}
        collectionsDir: path.resolve(__dirname, "../../config/collections"),
        // {{/collections}}
        // {{^collections}}
        // No `collectionsDir`: this project declares no collections in code, so
        // the server derives them from the live database schema at boot —
        // exactly what the managed runtime did for it.
        // {{/collections}}
        functionsDir: path.resolve(__dirname, "../functions"),
        cronsDir: fs.existsSync(cronsDir) ? cronsDir : undefined,
        server,
        app,
        // One bootstrapper per data source, each registered under its own key —
        // the key is exactly what `collection.dataSource` routes against. Only
        // the default source is handed the generated schema, which describes
        // this project's tables and they live in the default database.
        bootstrappers: drivers.map(driver => driver.bootstrapper),
        auth: {
            // {{#collections}}
            collection: usersCollection,
            // {{/collections}}
            // {{^collections}}
            // No users collection is declared here, so auth falls back to its
            // own default users table — the same fallback a headless bundle gets.
            // {{/collections}}
            jwtSecret,
            accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
            refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
            serviceKey: env.REBASE_SERVICE_KEY,
            // Cookie-based auth: the refresh token is stored in an httpOnly
            // cookie (not readable by JS) instead of localStorage, so it is
            // not exposed to XSS. The frontend opts in via
            // `authFlowMode: "cookie"` on createRebaseClient. Requires CORS
            // `credentials: true` (set above).
            cookieAuth: { sameSite: "Lax" },
            google: env.GOOGLE_CLIENT_ID
                ? { clientId: env.GOOGLE_CLIENT_ID }
                : undefined,
            allowRegistration: env.ALLOW_REGISTRATION,
            email: env.SMTP_HOST
                ? {
                    from: env.SMTP_FROM || `${env.APP_NAME} <noreply@rebase.pro>`,
                    smtp: {
                        host: env.SMTP_HOST,
                        port: env.SMTP_PORT,
                        secure: env.SMTP_SECURE,
                        auth: env.SMTP_USER
                            ? { user: env.SMTP_USER,
pass: env.SMTP_PASS! }
                            : undefined,
                        name: env.SMTP_NAME
                    },
                    appName: env.APP_NAME,
                    resetPasswordUrl: env.FRONTEND_URL
                }
                : undefined
        },
        // File storage is opt-in. With no bucket configured, storage is OFF in
        // production — the upload routes answer 501 STORAGE_NOT_CONFIGURED —
        // rather than writing to the container filesystem, which is erased on
        // every restart and redeploy. Uploads that fail loudly are recoverable;
        // uploads that succeed into a disk about to be wiped are not. That rule
        // lives in the runtime, which drops a `local` backend in production
        // unless FORCE_LOCAL_STORAGE says a durable volume really is mounted.
        //
        // One resolver, shared with the managed runtime, so this entrypoint
        // cannot drift from it: every source declared in `rebase.json` is read
        // from `<BASE>__<KEY>` (S3_BUCKET__MEDIA for a source keyed "media"),
        // and a project that declared nothing gets one default source from the
        // plain, unsuffixed variables — exactly as before.
        storage: resolveStorageSources(
            process.env,
            storageSources,
            path.resolve(__dirname, "../../uploads")
        ),
        // Storage is not under row-level security, so this hook IS its access
        // model — the server refuses to boot in production without one, because
        // "signed in" would otherwise be the only thing between a visitor and
        // every file in the bucket. See config/storage.ts, which also shows the
        // multi-tenant (per-owner) shape and the two escape hatches.
        storageAuthorize,
        history: true
    });

    // ─── Your own routes ──────────────────────────────────────────
    // This is a plain Hono app and everything you add to it is yours — which
    // also means it is outside Rebase's auth. `initializeRebaseBackend` guards
    // the routers it mounts (`/api/data`, `/api/auth`, …); it does not guard
    // this `app`. A route added here is reachable by anyone on the internet
    // until you put a guard in its middleware slot:
    //
    //   import { requireAuth, requireAdmin } from "@rebasepro/server";
    //   app.get("/admin/report", requireAuth, requireAdmin, handler);
    //
    // From the package root here, deliberately — **not** from
    // `@rebasepro/server/functions`. The guards on that subpath read an
    // identity that a Rebase router has already resolved, which is the right
    // thing inside `backend/functions/` and useless out here, where no such
    // middleware ran. These verify the token themselves.
    //
    // `requireAuth` answers 401 without a valid token; `requireAdmin` answers
    // 403 without the `admin` role and must follow `requireAuth`. Note that
    // `c.get("driver")` — the driver carrying the caller's identity — is only
    // set inside the Rebase routers, so out here reach for
    // `rebase.dataAsAdmin`. That one is **admin-scoped, not an RLS bypass**: it
    // runs as `{ uid: "service", roles: ["admin"] }` and your policies still
    // apply, evaluated against that identity — which is exactly an admin's
    // reach, and therefore belongs behind one of those guards. (`rebase.sql()`
    // is the real bypass: owner connection, no policies.)

    // ─── Health check ─────────────────────────────────────────────
    // Deliberately public: an orchestrator's probe has no token to send.
    //
    // Answered on both paths. `/health` is what an orchestrator probes and what
    // the generated `docker-compose.yml` already points at, so it stays.
    // `/api/health` is where a developer looks first, because every other route
    // this server has is under `/api` — and a reverse proxy that forwards only
    // `/api` to the backend can reach nothing else.
    const healthCheck = async (c: Context<HonoEnv>) => {
        const result = await backend.healthCheck();
        const status = result.healthy ? 200 : 503;
        return c.json({
            status: result.healthy ? "ok" : "degraded",
            latencyMs: result.latencyMs,
            ...(result.details ? { details: result.details } : {})
        }, status);
    };
    app.get("/health", healthCheck);
    app.get("/api/health", healthCheck);

    // {{#frontend}}
    // Serve the frontend in production.
    //
    // Four levels up, not two: in production this file runs compiled, from
    // `backend/dist/backend/src`. The paths above are the same in both modes
    // because `config/` is compiled alongside this file; `frontend/dist` is not
    // in the compiled tree at all, so it stays where the repository put it.
    // `serveSPA` only warns when the path is wrong, which is why the Dockerfile
    // that builds this image also copies `frontend` — verify a mount by
    // fetching `/`, never by reading the log.
    if (isProduction) {
        serveSPA(app, { frontendPath: path.resolve(__dirname, "../../../../frontend/dist") });
    }
    // {{/frontend}}

    if (!isProduction) {
        // Dev mode: retry the next port if the current one is in use
        const projectRoot = path.resolve(__dirname, "../..");
        const actualPort = await listenWithPortRetry(server, PORT, { portFileDir: projectRoot, serviceKey: env.REBASE_SERVICE_KEY });

        // Clean up port file on exit
        const cleanup = () => cleanupDevPortFile(projectRoot);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("exit", cleanup);

        logger.info(`Server running at http://localhost:${actualPort}`);
    } else {
        server.listen(PORT, () => {
            logger.info(`Server running at http://localhost:${PORT}`);
        });
    }

    // ─── Graceful Shutdown ───────────────────────────────────────────────
    // Drains HTTP, stops crons, tears down realtime, then closes the pool.
    // Guards against double signals and force-exits if shutdown hangs.
    installShutdownHandlers(backend, {
        // Every pool, not just the first: a second database left open holds a
        // connection against the server while this process is meant to be gone.
        onCleanup: async () => {
            await Promise.all(drivers.map(driver => driver.connection.pool?.end()));
        }
    });
}

startServer().catch(err => {
    logger.error("Failed to start server", { error: err instanceof Error ? err : new Error(String(err)) });
    process.exit(1);
});

export { app };
