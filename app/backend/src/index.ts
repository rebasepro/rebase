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
    cleanupDevPortFile
} from "@rebasepro/server-core";
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgresql";
import { enums, relations, tables } from "./schema.generated";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ─── App ─────────────────────────────────────────────────────────────
const app = new Hono<HonoEnv>();

const allowedOrigins = process.env.NODE_ENV === "production"
    ? (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "https://yourdomain.com").split(",").map(s => s.trim())
    : ["http://localhost:5173", "http://localhost:3000"];

app.use("/*", cors({
    origin: (origin) => {
        // In dev mode, allow any localhost origin (frontend may be on any port)
        if (process.env.NODE_ENV !== "production" && origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return origin;
        }
        return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    },
    credentials: true
}));

app.use("/*", secureHeaders({
    crossOriginResourcePolicy: "cross-origin"
}));

// ─── Database ────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const { db, connectionString } = createPostgresDatabaseConnection(databaseUrl);

// ─── Start ───────────────────────────────────────────────────────────
async function startServer() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error("JWT_SECRET is not set");

    const PORT = parseInt(process.env.PORT || "3001", 10);
    const server = createServer(getRequestListener(app.fetch));

    const backend = await initializeRebaseBackend({
        collectionsDir: path.resolve(__dirname, "../../shared/collections"),
        functionsDir: path.resolve(__dirname, "../functions"),
        cronsDir: path.resolve(__dirname, "../crons"),
        server,
        app,
        bootstrappers: [
            createPostgresBootstrapper({
                connection: db,
                schema: { tables, enums, relations },
                adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
                connectionString
            })
        ],
        auth: {
            jwtSecret,
            accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "1h",
            refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
            google: process.env.GOOGLE_CLIENT_ID
                ? { clientId: process.env.GOOGLE_CLIENT_ID }
                : undefined,
            seedDefaultRoles: true,
            allowRegistration: process.env.ALLOW_REGISTRATION === "true"
        },
        storage: {
            type: "local",
            basePath: path.resolve(__dirname, "../../uploads")
        },
        history: true,
    });

    // ─── Your routes ─────────────────────────────────────────────
    app.get("/health", (c) => c.json({ status: "ok" }));

    // Serve the frontend in production
    if (process.env.NODE_ENV === "production") {
        serveSPA(app, { frontendPath: path.join(__dirname, "../../frontend/dist") });
    }

    if (process.env.NODE_ENV !== "production") {
        // Dev mode: retry the next port if the current one is in use
        const projectRoot = path.resolve(__dirname, "../..");
        const actualPort = await listenWithPortRetry(server, PORT, { portFileDir: projectRoot });

        // Clean up port file on exit
        const cleanup = () => cleanupDevPortFile(projectRoot);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("exit", cleanup);

        console.log(`🚀 Server running at http://localhost:${actualPort}`);
    } else {
        server.listen(PORT, () => {
            console.log(`🚀 Server running at http://localhost:${PORT}`);
        });
    }
}

startServer().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
});

export { app };

