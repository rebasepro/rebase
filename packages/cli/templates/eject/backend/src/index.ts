import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
    initializeRebaseBackend,
    installShutdownHandlers,
    serveSPA,
    HonoEnv,
    listenWithPortRetry,
    cleanupDevPortFile,
    loadDeclaredStorageSources,
    resolveStorageSources,
    logger
} from "@rebasepro/server";
import { createPostgresDatabaseConnection, createPostgresAdapter } from "@rebasepro/server-postgres";
import { enums, relations, tables } from "./schema.generated.js";
import { storageAuthorize } from "../../config/storage.js";
import { env } from "./env.js";
import usersCollection from "../../config/collections/users.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Which buckets this project has, read from the `storage` block of its own
// `rebase.json`. Declared there rather than here so the platform, the console
// and this process all read one list — a custom image ships the repository, so
// the file it already contains is the natural place for it. Absent means one
// default source, configured from the plain S3_*/GCS_* variables.
const storageSources = loadDeclaredStorageSources(__dirname);

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

// ─── Database ────────────────────────────────────────────────────────
const databaseUrl = env.DATABASE_URL;

const { db, pool, connectionString } = createPostgresDatabaseConnection(databaseUrl);

// ─── Start ───────────────────────────────────────────────────────────
async function startServer() {
    const jwtSecret = env.JWT_SECRET;
    const PORT = env.PORT;
    const server = createServer(getRequestListener(app.fetch));

    const backend = await initializeRebaseBackend({
        collectionsDir: path.resolve(__dirname, "../../config/collections"),
        functionsDir: path.resolve(__dirname, "../functions"),
        server,
        app,
        database: createPostgresAdapter({
            connection: db,
            schema: { tables,
enums,
relations },
            adminConnectionString: env.ADMIN_CONNECTION_STRING || databaseUrl,
            connectionString
        }),
        auth: {
            collection: usersCollection,
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
        storageSources,
        // Storage is not under row-level security, so this hook IS its access
        // model — the server refuses to boot in production without one, because
        // "signed in" would otherwise be the only thing between a visitor and
        // every file in the bucket. See config/storage.ts, which also shows the
        // multi-tenant (per-owner) shape and the two escape hatches.
        storageAuthorize,
        history: true
    });

    // ─── Health check ─────────────────────────────────────────────
    app.get("/health", async (c) => {
        const result = await backend.healthCheck();
        const status = result.healthy ? 200 : 503;
        return c.json({
            status: result.healthy ? "ok" : "degraded",
            latencyMs: result.latencyMs,
            ...(result.details ? { details: result.details } : {})
        }, status);
    });

    // Serve the frontend in production
    if (isProduction) {
        serveSPA(app, { frontendPath: path.join(__dirname, "../../frontend/dist") });
    }

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
        onCleanup: () => pool.end()
    });
}

startServer().catch(err => {
    logger.error("Failed to start server", { error: err instanceof Error ? err : new Error(String(err)) });
    process.exit(1);
});

export { app };
