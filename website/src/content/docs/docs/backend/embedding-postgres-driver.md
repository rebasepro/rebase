---
title: Embedding the Postgres Driver
sidebar_label: Embedding the Postgres Driver
description: Open @rebasepro/server-postgres's data driver and realtime socket inside Express, Fastify or plain Node, without the Rebase server — read replicas, Drizzle and draining included.
---

One step below a [custom server](/docs/backend/custom-server/), `@rebasepro/server-postgres` works without the Rebase server at all. It depends on Drizzle and Node's `http.Server`, so you can open the data driver and the realtime socket inside Express, Fastify or plain Node. At this level you assemble the backend yourself: there are no auth routes, no storage and no admin API unless you build them.

## Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Opening the driver and the socket

`openPostgresDriver`
and `postgresDriverConfigFromEnv` are exported. On 0.24, open the driver with
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, whose `internals` is
untyped.

```typescript
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import {
    createPostgresDatabaseConnection,
    createPostgresWebSocket,
    openPostgresDriver,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { collections } from "./collections";

async function startServer() {
    const app = express();

    // The socket needs the raw http.Server, so listen on it, not on app.listen.
    // 64 KB of headers, as the Rebase runtime takes: a vector search in the URL
    // outgrows Node's 16 KB.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, app);

    const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

    // The environment, read the way the Rebase server's boot reads it:
    // DATABASE_READ_URL, DATABASE_DIRECT_URL and the REALTIME_* variables.
    // Leave this call out and the driver reads no environment variable at all.
    const pgConfig = postgresDriverConfigFromEnv({ connection: db, connectionString });

    // The collections' tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { collections });

    // The realtime socket. It answers upgrades on `path` only, so a WebSocket
    // server of your own can share the same http.Server.
    createPostgresWebSocket(
        server,
        internals.realtimeService,
        internals.driver,
        { requireAuth: true, jwtSecret: process.env.JWT_SECRET },
        undefined,
        { path: "/" }
    );

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // A write through the driver
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

    // Drizzle directly, typed: `internals.db`, and `internals.readDb` when a
    // read replica is configured.
    app.get("/api/stats", async (req, res) => {
        const result = await internals.db.execute(sql`select count(*) from products`);
        res.json(result.rows);
    });

    const port = process.env.PORT || 3000;
    server.listen(port);

    // Graceful shutdown: stop listening, stop the LISTEN client, evict branch
    // pools, then end the main pool.
    const handleShutdown = (signal: string) => {
        console.log(`Shutdown triggered via ${signal}.`);
        server.close(async () => {
            try {
                await internals.realtimeService.stopListening();
                await internals.poolManager?.shutdown();
                await pool.end();
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

`openPostgresDriver` is what `createPostgresAdapter` runs when the Rebase server boots, after `postgresDriverConfigFromEnv` has read the environment into the config. Its second argument says what to open: the `collections`, whether opening may run its own DDL (`provision`, default `true`), and what part this process takes in realtime (`realtime: false` for none).

It creates no collection table, so against a database without one `POST /api/products` answers `500` "Table not found for collection 'products'". Create the tables first. `rebase db push` does it from a Rebase project whose `config/collections` declares them. In this server, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` before `openPostgresDriver` adds the tables and columns the database lacks, as the Rebase server's boot does, and changes nothing that exists.

## Read Replica Connections
Set `readConnectionString` on the driver config, or the `DATABASE_READ_URL` environment variable, which the server's boot and `postgresDriverConfigFromEnv` read into it, and the driver opens a second connection pool against your read replica, under `internals.readDb`. Reads go to the replica; writes stay on the primary.

The `readConnectionString` option is honoured. On 0.24 it was declared and ignored, and only `DATABASE_READ_URL` worked.

## Drizzle Integration
You do not have to choose between Rebase and Drizzle. The driver compiles your schemas dynamically, and `internals.db` is the Drizzle `NodePgDatabase` client, typed, for raw SQL or type-safe Drizzle builders alongside Rebase's REST services.

## Graceful Connection Draining
In serverless environments or orchestrators (like Kubernetes), terminating pods can result in broken connections. Always implement signal handlers that call `internals.realtimeService.stopListening()` (which ends the dedicated pg LISTEN client) and `pool.end()`, so you do not leak connection slots on your database server.

## Related

- [Custom Server Integration](/docs/backend/custom-server/) — the whole Rebase backend, built from public pieces in your own server
- [Scripts and the Console](/docs/backend/scripts/) — the project's data from a script, a test or a REPL, with no server
