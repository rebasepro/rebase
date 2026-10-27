---
sourceHash: 26a29be19ddbdcb0
title: Incorporare il driver Postgres
sidebar_label: Incorporare il driver Postgres
description: Apri il driver dei dati e il socket realtime di @rebasepro/server-postgres dentro Express, Fastify o Node semplice, senza il server Rebase — repliche in lettura, Drizzle e draining inclusi.
---

Un gradino sotto un [server personalizzato](/docs/backend/custom-server/), `@rebasepro/server-postgres` funziona senza alcun server Rebase. Dipende da Drizzle e dall'`http.Server` di Node, quindi puoi aprire il driver dei dati e il socket realtime dentro Express, Fastify o Node semplice. A questo livello assembli il backend da te: non ci sono route di autenticazione, storage né API di amministrazione, a meno che tu non le costruisca.

## Installazione

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Aprire il driver e il socket

`openPostgresDriver`
e `postgresDriverConfigFromEnv` sono esportati. Sulla 0.24, apri il driver con
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, il cui `internals` non è
tipizzato.

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

`openPostgresDriver` è ciò che `createPostgresAdapter` esegue all'avvio del server Rebase, dopo che `postgresDriverConfigFromEnv` ha letto l'ambiente nella configurazione. Il suo secondo argomento dice cosa aprire: le `collections`, se l'apertura può eseguire il proprio DDL (`provision`, `true` per impostazione predefinita) e quale parte ha questo processo nel realtime (`realtime: false` per nessuna).

Non crea alcuna tabella di collection, quindi su un database che non ne ha, `POST /api/products` risponde `500` "Table not found for collection 'products'". Crea prima le tabelle. `rebase db push` lo fa da un progetto Rebase la cui `config/collections` le dichiara. In questo server, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` prima di `openPostgresDriver` aggiunge le tabelle e le colonne che mancano al database, come fa l'avvio del server Rebase, e non cambia nulla di ciò che esiste.

## Connessioni a una replica in lettura
Imposta `readConnectionString` nella configurazione del driver, oppure la variabile d'ambiente `DATABASE_READ_URL`, che l'avvio del server e `postgresDriverConfigFromEnv` leggono nella configurazione, e il driver apre un secondo pool di connessioni verso la tua replica in lettura, in `internals.readDb`. Le letture vanno alla replica; le scritture restano sul primario.

L'opzione `readConnectionString` viene rispettata. Sulla 0.24 era dichiarata e ignorata, e funzionava solo `DATABASE_READ_URL`.

## Integrazione con Drizzle
Non devi scegliere tra Rebase e Drizzle. Il driver compila i tuoi schemi dinamicamente, e `internals.db` è il client `NodePgDatabase` di Drizzle, tipizzato, per SQL grezzo o per i builder di Drizzle type-safe accanto ai servizi REST di Rebase.

## Chiusura graduale delle connessioni (draining)
In ambienti serverless o negli orchestratori (come Kubernetes), la terminazione dei pod può lasciare connessioni interrotte. Implementa sempre gestori di segnali che chiamino `internals.realtimeService.stopListening()` (che chiude il client pg LISTEN dedicato) e `pool.end()`, così non perdi slot di connessione sul tuo server di database.

## Correlati

- [Integrazione Server Personalizzato](/docs/backend/custom-server/) — l'intero backend Rebase, costruito da componenti pubblici nel tuo server
- [Script e console](/docs/backend/scripts/) — i dati del progetto da uno script, da un test o da un REPL, senza alcun server
