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
    HonoEnv,
    listenWithPortRetry,
    cleanupDevPortFile,
    logger
} from "@rebasepro/server";
import { createPostgresDatabaseConnection, createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env.js";
import { storageAuthorize } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        // BaaS mode: every RLS-protected table is served over REST. There are
        // no collection files to write or keep in sync — change the schema with
        // a migration and the API follows.
        //
        // Your database's own row-level security is the whole authorization
        // model here: requests run as the `rebase_user` role, so a table
        // without RLS has no rules at all and is not served. Protect one with:
        //   ALTER TABLE mytable ENABLE ROW LEVEL SECURITY;
        //   CREATE POLICY mytable_read ON mytable FOR SELECT TO public USING (true);
        mode: "baas",
        functionsDir: path.resolve(__dirname, "../functions"),
        server,
        app,
        database: createPostgresAdapter({
            connection: db,
            adminConnectionString: env.ADMIN_CONNECTION_STRING || databaseUrl,
            connectionString
        }),
        auth: {
            // No `collection` here: BaaS mode has no collection files, and the
            // auth adapter owns its own user tables.
            jwtSecret,
            accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
            refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
            serviceKey: env.REBASE_SERVICE_KEY,
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
        // uploads that succeed into a disk about to be wiped are not.
        // Local disk stays the default in development, where it is what you want.
        storage: env.STORAGE_TYPE === "s3"
            ? {
                type: "s3",
                bucket: env.S3_BUCKET!,
                region: env.S3_REGION || "auto",
                accessKeyId: env.S3_ACCESS_KEY_ID || "",
                secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
                endpoint: env.S3_ENDPOINT,
                forcePathStyle: env.S3_FORCE_PATH_STYLE
            }
            : env.STORAGE_TYPE === "gcs"
                ? {
                    type: "gcs",
                    bucket: env.GCS_BUCKET!,
                    projectId: env.GCS_PROJECT_ID,
                    keyFilename: env.GCS_KEY_FILENAME
                }
                // Set FORCE_LOCAL_STORAGE=true only if this deployment really
                // does have a durable volume mounted at STORAGE_PATH.
                : isProduction && !env.FORCE_LOCAL_STORAGE
                    ? undefined
                    : {
                        type: "local",
                        basePath: env.STORAGE_PATH || path.resolve(__dirname, "../../uploads")
                    },
        // Storage is not under row-level security, so this hook IS its access
        // model — the server refuses to boot in production without one, because
        // "signed in" would otherwise be the only thing between a caller and every
        // file in the bucket. See storage.ts; the default scopes each caller to
        // `users/<uid>/` and is meant to be replaced with your own rule.
        storageAuthorize,
        history: true,
        enableSwagger: true
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

    // No serveSPA: this is a headless API. Point any frontend at it over HTTP.

    if (!isProduction) {
        // Dev mode: retry the next port if the current one is in use
        const projectRoot = path.resolve(__dirname, "../..");
        const actualPort = await listenWithPortRetry(server, PORT, { portFileDir: projectRoot, serviceKey: env.REBASE_SERVICE_KEY });

        // Clean up port file on exit
        const cleanup = () => cleanupDevPortFile(projectRoot);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("exit", cleanup);

        logger.info(`API running at http://localhost:${actualPort}`);
        // Docs are only mounted once there is something to document; with no
        // servable tables the URL would 404, so don't advertise it.
        if (backend.collectionRegistry.getCollections().length > 0) {
            logger.info(`API docs at http://localhost:${actualPort}/api/swagger`);
        }
    } else {
        server.listen(PORT, () => {
            logger.info(`API running at http://localhost:${PORT}`);
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
