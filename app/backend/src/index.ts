import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
    initializeRebaseBackend,
    serveSPA,
    HonoEnv,
    listenWithPortRetry,
    cleanupDevPortFile,
    logger
} from "@rebasepro/server-core";
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgresql";
import { enums, relations, tables } from "./schema.generated";
import { env } from "./env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── App ─────────────────────────────────────────────────────────────
const app = new Hono<HonoEnv>();

const isProduction = env.NODE_ENV === "production";

const allowedOrigins = isProduction
    ? (env.CORS_ORIGINS || env.FRONTEND_URL || "").split(",").map(s => s.trim()).filter(Boolean)
    : [];

app.use("/*", cors({
    origin: (origin) => {
        if (!isProduction) return origin || "*";
        return allowedOrigins.includes(origin) ? origin : null;
    },
    credentials: true
}));

app.use("/*", secureHeaders({
    crossOriginResourcePolicy: "cross-origin"
}));

// ─── Database ────────────────────────────────────────────────────────
const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL, undefined, {
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT,
    connectionTimeoutMillis: env.DB_POOL_CONNECT_TIMEOUT,
});

// ─── Start ───────────────────────────────────────────────────────────
async function startServer() {
    const server = createServer(getRequestListener(app.fetch));

    if (isProduction && !env.FORCE_LOCAL_STORAGE) {
        logger.warn("Using local file storage in production! Uploaded files will be lost if the container restarts. Set FORCE_LOCAL_STORAGE=true to suppress this warning, or configure an S3/GCS adapter.");
    }

    const backend = await initializeRebaseBackend({
        collectionsDir: path.resolve(__dirname, "../../config/collections"),
        functionsDir: path.resolve(__dirname, "../functions"),
        cronsDir: path.resolve(__dirname, "../crons"),
        server,
        app,
        bootstrappers: [
            createPostgresBootstrapper({
                connection: db,
                schema: { tables, enums, relations },
                adminConnectionString: env.ADMIN_CONNECTION_STRING || env.DATABASE_URL,
                connectionString
            })
        ],
        auth: {
            jwtSecret: env.JWT_SECRET,
            accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
            refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
            google: env.GOOGLE_CLIENT_ID
                ? { clientId: env.GOOGLE_CLIENT_ID }
                : undefined,
            defaultRole: "admin",
            seedDefaultRoles: true,
            allowRegistration: env.ALLOW_REGISTRATION,
            serviceKey: env.REBASE_SERVICE_KEY
        },
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
            : {
                type: "local",
                basePath: env.STORAGE_PATH || path.resolve(__dirname, "../../uploads")
            },
        history: true,
        csrf: isProduction
            ? { origin: allowedOrigins }
            : undefined, // dev defaults are applied by server-core
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
        const actualPort = await listenWithPortRetry(server, env.PORT, { portFileDir: projectRoot });

        // Clean up port file on exit
        const cleanup = () => cleanupDevPortFile(projectRoot);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("exit", cleanup);

        logger.info(`Server running at http://localhost:${actualPort}`);
    } else {
        server.listen(env.PORT, () => {
            logger.info(`Server running at http://localhost:${env.PORT}`);
        });
    }

    // ─── Graceful Shutdown ───────────────────────────────────────────────
    let isShuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        
        logger.info(`Received ${signal}, waiting for HTTP connections to drain...`);
        
        // Stop accepting new connections
        server.close(async (err) => {
            if (err) {
                logger.error("Error closing HTTP server:", { error: err instanceof Error ? err : new Error(String(err)) });
            }
            logger.info("HTTP server closed. Draining background tasks and database pool...");
            try {
                await backend.shutdown();
                await pool.end();
                logger.info("Graceful shutdown complete.");
                process.exit(0);
            } catch (shutdownErr) {
                logger.error("Error during shutdown cleanup:", { error: shutdownErr instanceof Error ? shutdownErr : new Error(String(shutdownErr)) });
                process.exit(1);
            }
        });

        // Fallback force exit
        setTimeout(() => {
            logger.error("Shutdown timed out after 15 seconds. Forcefully exiting.");
            process.exit(1);
        }, 15000).unref();
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer().catch(err => {
    logger.error("Failed to start server", { error: err instanceof Error ? err : new Error(String(err)) });
    process.exit(1);
});

export { app };
