---
title: Custom Server Integration
sidebar_label: Custom Server (Express)
description: How to embed Rebase Database and Realtime services into your own custom Node.js backend without using Hono or the Rebase coordinator.
---

# Custom Server Integration

Rebase was built to be completely modular. While the `initializeRebaseBackend` coordinator provides a full batteries-included backend using Hono, you can completely bypass it and embed the core **Database Adapter** and **Realtime WebSockets** directly into your own custom Node.js application (like Express, Fastify, or plain Node.js HTTP).

The `@rebasepro/server-postgres` package is completely framework-agnostic. It depends only on Drizzle ORM and standard Node.js `http.Server`.

## Environment Configuration

Rebase provides a centralized `loadEnv()` utility in `@rebasepro/server` that validates your environment variables against a strict Zod schema. Call it **after** loading your `.env` file:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Basic — just Rebase env vars:
export const env = loadEnv();

// Extended — add your own typed vars:
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string        (validated, required)
```

Importing `z` from `@rebasepro/server` is new <span class="since-badge" data-since="0.18">Since 0.18</span>. On 0.17 and
earlier the package exported no `z`: import it from `zod`, matching the major the
runtime uses, and let your bundler dedupe the two copies.

:::caution[The `z` you extend with must be the runtime's zod]
Two copies of zod loaded at once is the one way this call goes wrong, and it
used to go wrong silently. `.merge()` accepts a schema from the other copy —
the shapes are identical — and then `.parse()` rejects every field carrying a
`.default()`, because a default is recognised by class identity. The server came
up, reported success, and ran none of its crons; nothing in the failure
mentioned zod.

Don't declare `zod` in your project's dependencies — the runtime provides it. If
you must, match its major and let your bundler dedupe. `loadEnv` now refuses a
foreign schema at boot with a message naming the fix, rather than accepting it
and validating half of it.
:::

**Key behaviors:**
- Auto-generates ephemeral `JWT_SECRET` and `REBASE_SERVICE_KEY` in development so you can start without manual setup.
- Blocks auto-generated secrets in production — you must set them explicitly.
- Validates that `CORS_ORIGINS` or `FRONTEND_URL` is set in production.
- Refuses an `extend` schema built by a different copy of zod.

See `.env.example` in the scaffolded app for the full list of supported variables.

## Using Rebase with Express

Here is a complete example of how to initialize the Rebase PostgreSQL adapter and Realtime WebSockets inside a standard Express application, manage read replicas, access Drizzle directly, and implement clean server terminations.

### 1. Installation

Install the required core packages along with Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Initialization and Graceful Shutdown Example

```typescript
import express from "express";
import { createServer } from "http";
import pg from "pg";
import { createPostgresBootstrapper } from "@rebasepro/server-postgres";

async function startServer() {
    const app = express();
    
    // 1. WebSocket Upgrade Guard
    // WebSockets require hijacking the HTTP Upgrade header. You must bind
    // Rebase to a raw Node.js http.Server instance.
    const server = createServer(app);

    // 2. Configure the connection pool
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20, // Max concurrent database connections
        idleTimeoutMillis: 30000
    });

    // 3. Initialize the Postgres Bootstrapper
    const bootstrapper = createPostgresBootstrapper({
        connection: pool,
        connectionString: process.env.DATABASE_URL,
        adminConnectionString: process.env.ADMIN_CONNECTION_STRING, // Required for branching
        schema: {
            tables: {},   // Place your custom Drizzle tables here
            relations: {} // Place your custom Drizzle relations here
        }
    });

    // 4. Initialize the Driver and Services
    // Connects to Postgres, verifies connection, starts cross-instance listeners
    const { driver, realtimeProvider, internals } = await bootstrapper.initializeDriver({
        collections: [] // Pass Rebase CollectionConfigs if using schema-as-code
    });

    // Access the underlying schema-aware Drizzle client if needed.
    // `internals` is an *opaque handle* on the DatabaseAdapter contract — the shape is
    // the driver's business, so narrow it to what the Postgres bootstrapper puts there.
    // (named `driverInternals` rather than `pg`, which is the node-postgres import)
    const driverInternals = internals as {
        db: any;                                    // Drizzle NodePgDatabase
        readDb?: any;                               // Read replica, when DATABASE_READ_URL is set
        poolManager?: { destroy(): Promise<void> };
    };
    const db = driverInternals.db;
    const readDb = driverInternals.readDb;

    // 5. Mount Realtime WebSockets
    // Both halves are optional on the contract: a driver need not create a
    // realtime provider, and a bootstrapper need not serve websockets at all.
    if (!realtimeProvider || !bootstrapper.initializeWebsockets) {
        throw new Error("This driver does not support realtime websockets.");
    }
    await bootstrapper.initializeWebsockets(server, realtimeProvider, driver, {
        requireAuth: true // Enforces authentication token checks
    });

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // Direct Driver CRUD Operation
    app.post("/api/products", async (req, res) => {
        try {
            const result = await driver.save({
                path: "products",
                values: req.body,
                status: "new"   // required: "new" | "existing" | "copy"
            });
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Raw Drizzle SQL Execution (RLS bypass)
    app.get("/api/stats", async (req, res) => {
        try {
            const countResult = await db.select().from(...); // Perform standard Drizzle operations
            res.json(countResult);
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Start listening (Using the HTTP Server, NOT app.listen)
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`🚀 Server and WebSocket engine running on port ${port}`);
    });

    // 6. Graceful Shutdown Handler
    // Terminate listeners and drain connection pools on process termination signals
    const handleShutdown = async (signal: string) => {
        console.log(`\nShutdown triggered via ${signal}. Cleaning up resources...`);
        
        server.close(async () => {
            console.log("✔ HTTP Server closed.");
            try {
                // Terminate cross-instance pg LISTEN/NOTIFY client
                if (realtimeProvider && typeof realtimeProvider.stopListening === "function") {
                    await realtimeProvider.stopListening();
                    console.log("✔ Realtime listeners stopped.");
                }

                // Disconnect dynamic branch connection pools
                if (driverInternals.poolManager) {
                    await driverInternals.poolManager.destroy();
                    console.log("✔ Branch connection pools evicted.");
                }

                // End the main database pool
                await pool.end();
                console.log("✔ Database connection pool drained.");

                process.exit(0);
            } catch (err) {
                console.error("❌ Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

> **Standard path:** if your server uses `initializeRebaseBackend` (like the scaffolded template does), don't hand-roll the shutdown handler above — use the built-in helper instead. It drains HTTP, stops the cron scheduler, tears down realtime services, guards against repeated signals, and force-exits if shutdown hangs:
>
> ```ts
> import { installShutdownHandlers } from "@rebasepro/server";
>
> const backend = await initializeRebaseBackend({ ... });
> installShutdownHandlers(backend, { onCleanup: () => pool.end() });
> ```
>
> Do **not** combine it with your own `server.close()` — `backend.shutdown()` already closes the server, and a second close deadlocks. The manual handler shown in the example above is only for fully custom setups that bypass `initializeRebaseBackend`.

---

## Key Backend Concepts

### Read Replica Connections
If you define the `DATABASE_READ_URL` environment variable, Rebase automatically spawns a secondary connection pool targeting your read replica. The bootstrapper registers this under `internals.readDb`. The core `EntityFetchService` routes all SELECT queries to the replica pool to optimize performance, while mutation queries remain on the primary pool.

### Drizzle Integration
You do not have to choose between Rebase and Drizzle. The bootstrapper compiles your schemas dynamically. You can access the compiled Drizzle NodePgDatabase client via `internals.db`, allowing you to run raw SQL migrations or invoke type-safe Drizzle builders alongside Rebase's REST services.

### Graceful Connection Draining
In serverless environments or orchestrators (like Kubernetes), terminating pods can result in broken connections. Always implement signal handlers that invoke `realtimeProvider.stopListening()` (which terminates the dedicated pg LISTEN client) and `pool.end()` to prevent leaking connection slots in your database server.


## Related

- [Backend Overview](/docs/backend/) — where each option lives when the runtime boots instead
- [Split Processes](/docs/deployment/split-processes/) — the roles a custom server has to reproduce
- [Storage Configuration](/docs/backend/storage/) — the sources a custom server must resolve itself
