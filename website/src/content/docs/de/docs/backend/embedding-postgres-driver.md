---
sourceHash: 82f7615bf6bd44b4
title: Einbetten des Postgres-Treibers
sidebar_label: Einbetten des Postgres-Treibers
description: Öffnen Sie den Datentreiber und den Realtime-Socket von @rebasepro/server-postgres in Express, Fastify oder reinem Node, ganz ohne Rebase-Server – einschließlich Read-Replicas, Drizzle und Draining.
---

Eine Stufe unter einem [benutzerdefinierten Server](/docs/backend/custom-server/) funktioniert `@rebasepro/server-postgres` komplett ohne den Rebase-Server. Es hängt von Drizzle und Nodes `http.Server` ab, sodass Sie den Datentreiber und den Realtime-Socket innerhalb von Express, Fastify oder reinem Node öffnen können. Auf dieser Ebene bauen Sie das Backend selbst zusammen: Es gibt keine Auth-Routen, keinen Speicher und keine Admin-API, es sei denn, Sie erstellen diese selbst.

## Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Öffnen des Treibers und des Sockets

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`openPostgresDriver` und `postgresDriverConfigFromEnv` werden exportiert.

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
import { tables } from "./tables";

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

    // The tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { tables });

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

`./tables` ist ein eigenes Modul, das Ihre `defineTable`s mit `compileSchema` aus `@rebasepro/common` kompiliert: der Deskriptor jeder Tabelle samt ihren Hooks, woraus der Treiber sein Laufzeitmodell erstellt ([Skripte](/docs/backend/scripts/#openrebase) akzeptiert dieselbe Liste):

```typescript
import { compileSchema } from "@rebasepro/common";
import { products, orders } from "./schema";

export const tables = compileSchema([products, orders]);
```

`openPostgresDriver` ist das, was `createPostgresAdapter` beim Booten des Rebase-Servers ausführt, nachdem `postgresDriverConfigFromEnv` die Umgebungsvariablen in die Konfiguration eingelesen hat. Das zweite Argument gibt an, was geöffnet werden soll: die `tables`, ob das Öffnen eigene DDL ausführen darf (`provision`, Standard `true`), und welche Rolle dieser Prozess in Realtime übernimmt (`realtime: false` für keine).

Es werden keine Anwendungstabellen erstellt; bei einer Datenbank ohne entsprechende Tabellen antwortet `POST /api/products` daher mit `500` "Table not found for 'products' (table: products)". Erstellen Sie die Tabellen zuerst. `rebase db push` erledigt dies aus einem Rebase-Projekt, dessen `backend/schema` sie deklariert. In diesem Server fügt `await createPostgresAdapter(pgConfig).ensureTableSchema?.(tables)` vor `openPostgresDriver` die Tabellen und Spalten hinzu, die der Datenbank fehlen – genau wie beim Booten des Rebase-Servers –, ohne bestehende Strukturen zu verändern.

## Read-Replica-Verbindungen
Setzen Sie `readConnectionString` in der Treiberkonfiguration oder die Umgebungsvariable `DATABASE_READ_URL`, die beim Server-Boot und von `postgresDriverConfigFromEnv` eingelesen wird, und der Treiber öffnet einen zweiten Verbindungspool zu Ihrer Read-Replica unter `internals.readDb`. Lesezugriffe gehen an das Replikat; Schreibzugriffe verbleiben auf der primären Datenbank.

## Drizzle-Integration
Sie müssen sich nicht zwischen Rebase und Drizzle entscheiden. Der Treiber kompiliert Ihre Schemas dynamisch, und `internals.db` ist der typisierte Drizzle-`NodePgDatabase`-Client für rohes SQL oder typsichere Drizzle-Builder neben den REST-Diensten von Rebase.

## Graceful Connection Draining
In serverlosen Umgebungen oder Orchestratoren (wie Kubernetes) kann das Beenden von Pods zu abgebrochenen Verbindungen führen. Implementieren Sie immer Signal-Handler, die `internals.realtimeService.stopListening()` (wodurch der dedizierte pg-LISTEN-Client beendet wird) und `pool.end()` aufrufen, damit Sie keine Verbindungsslots auf Ihrem Datenbankserver belegen.

## Verwandte Themen

- [Integration eines benutzerdefinierten Servers](/docs/backend/custom-server/) — das gesamte Rebase-Backend, aufgebaut aus öffentlichen Bausteinen in Ihrem eigenen Server
- [Skripte und die Konsole](/docs/backend/scripts/) — die Daten des Projekts aus einem Skript, einem Test oder einer REPL, ganz ohne Server
