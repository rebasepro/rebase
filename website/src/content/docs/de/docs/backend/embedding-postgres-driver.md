---
sourceHash: 26a29be19ddbdcb0
title: Den Postgres-Treiber einbetten
sidebar_label: Postgres-Treiber einbetten
description: Öffnen Sie den Daten-Treiber und den Realtime-Socket von @rebasepro/server-postgres innerhalb von Express, Fastify oder reinem Node, ohne den Rebase-Server – inklusive Read-Replicas, Drizzle und Draining.
---

Eine Stufe unterhalb eines [eigenen Servers](/docs/backend/custom-server/) funktioniert `@rebasepro/server-postgres` ganz ohne den Rebase-Server. Es hängt von Drizzle und dem `http.Server` von Node ab, sodass Sie den Daten-Treiber und den Realtime-Socket innerhalb von Express, Fastify oder reinem Node öffnen können. Auf dieser Ebene setzen Sie das Backend selbst zusammen: Es gibt keine Auth-Routen, keinen Speicher und keine Admin-API, sofern Sie diese nicht selbst bauen.

## Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Treiber und Socket öffnen

`openPostgresDriver`
und `postgresDriverConfigFromEnv` werden exportiert. Unter 0.24 öffnen Sie den Treiber mit
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, dessen `internals` untypisiert ist.

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

`openPostgresDriver` ist das, was `createPostgresAdapter` ausführt, wenn der Rebase-Server startet, nachdem `postgresDriverConfigFromEnv` die Umgebung in die Konfiguration eingelesen hat. Sein zweites Argument legt fest, was geöffnet wird: die `collections`, ob das Öffnen eigenes DDL ausführen darf (`provision`, Standard `true`) und welche Rolle dieser Prozess im Realtime-Betrieb übernimmt (`realtime: false` für keine).

Es legt keine Collection-Tabelle an, sodass `POST /api/products` gegen eine Datenbank ohne eine solche mit `500` „Table not found for collection 'products'“ antwortet. Legen Sie die Tabellen zuerst an. `rebase db push` erledigt das aus einem Rebase-Projekt, dessen `config/collections` sie deklariert. In diesem Server fügt `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` vor `openPostgresDriver` die Tabellen und Spalten hinzu, die der Datenbank fehlen, so wie es der Start des Rebase-Servers tut, und ändert nichts, was bereits existiert.

## Read-Replica-Verbindungen

Setzen Sie `readConnectionString` in der Treiber-Konfiguration oder die Umgebungsvariable `DATABASE_READ_URL`, die der Start des Servers und `postgresDriverConfigFromEnv` dort einlesen, und der Treiber öffnet unter `internals.readDb` einen zweiten Connection-Pool gegen Ihre Read-Replica. Lesezugriffe gehen an die Replica; Schreibzugriffe bleiben auf dem Primary.

Die Option `readConnectionString` wird berücksichtigt. Unter 0.24 war sie deklariert und wurde ignoriert, und nur `DATABASE_READ_URL` funktionierte.

## Drizzle-Integration

Sie müssen sich nicht zwischen Rebase und Drizzle entscheiden. Der Treiber kompiliert Ihre Schemas dynamisch, und `internals.db` ist der typisierte Drizzle-`NodePgDatabase`-Client, für rohes SQL oder typsichere Drizzle-Builder neben den REST-Diensten von Rebase.

## Verbindungen sauber beenden (Graceful Draining)

In Serverless-Umgebungen oder Orchestratoren (wie Kubernetes) kann das Beenden von Pods zu abgebrochenen Verbindungen führen. Implementieren Sie stets Signal-Handler, die `internals.realtimeService.stopListening()` (beendet den dedizierten pg-LISTEN-Client) und `pool.end()` aufrufen, damit Sie auf Ihrem Datenbankserver keine Verbindungsslots verlieren.

## Verwandte Themen

- [Integration eines eigenen Servers](/docs/backend/custom-server/) — das gesamte Rebase-Backend, aus öffentlichen Bausteinen in Ihrem eigenen Server gebaut
- [Skripte und die Konsole](/docs/backend/scripts/) — die Daten des Projekts aus einem Skript, einem Test oder einer REPL, ohne Server
