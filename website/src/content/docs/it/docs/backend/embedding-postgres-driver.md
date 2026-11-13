---
sourceHash: 82f7615bf6bd44b4
title: Incorporare il driver Postgres
sidebar_label: Incorporare il driver Postgres
description: Apri il data driver e il socket realtime di @rebasepro/server-postgres all'interno di Express, Fastify o Node puro, senza il server Rebase — repliche di lettura, Drizzle e draining inclusi.
---

Un gradino sotto un [server personalizzato](/docs/backend/custom-server/), `@rebasepro/server-postgres` funziona completamente senza il server Rebase. Dipende da Drizzle e da `http.Server` di Node, quindi puoi aprire il data driver e il socket realtime all'interno di Express, Fastify o Node puro. A questo livello assembli il backend autonomamente: non ci sono route di autenticazione, nessuno storage e nessuna API di amministrazione a meno che tu non le crei.

## Installazione

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Apertura del driver e del socket

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Vengono esportati `openPostgresDriver` e `postgresDriverConfigFromEnv`.

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

`./tables` è un tuo modulo che compila i tuoi `defineTable` con `compileSchema` di `@rebasepro/common`: il descrittore di ciascuna tabella con i relativi hook, ovvero ciò da cui il driver costruisce il proprio modello di runtime ([Script](/docs/backend/scripts/#openrebase) accetta la stessa lista):

```typescript
import { compileSchema } from "@rebasepro/common";
import { products, orders } from "./schema";

export const tables = compileSchema([products, orders]);
```

`openPostgresDriver` è ciò che `createPostgresAdapter` esegue all'avvio del server Rebase, dopo che `postgresDriverConfigFromEnv` ha letto l'ambiente nella configurazione. Il suo secondo argomento definisce cosa aprire: le `tables`, se l'apertura può eseguire il proprio DDL (`provision`, predefinito `true`) e quale ruolo svolge questo processo nel realtime (`realtime: false` per nessuno).

Non crea alcuna tabella applicativa, quindi a fronte di un database che ne è privo `POST /api/products` risponde `500` "Table not found for 'products' (table: products)". Crea prima le tabelle. `rebase db push` esegue questa operazione da un progetto Rebase in cui `backend/schema` le dichiara. In questo server, `await createPostgresAdapter(pgConfig).ensureTableSchema?.(tables)` prima di `openPostgresDriver` aggiunge le tabelle e le colonne mancanti nel database, esattamente come fa l'avvio del server Rebase, senza modificare nulla di ciò che già esiste.

## Connessioni alle repliche di lettura
Imposta `readConnectionString` nella configurazione del driver, oppure la variabile d'ambiente `DATABASE_READ_URL`, che l'avvio del server e `postgresDriverConfigFromEnv` leggono e integrano nella configurazione; il driver aprirà un secondo pool di connessioni verso la replica di lettura, accessibile tramite `internals.readDb`. Le letture andranno alla replica, mentre le scritture rimarranno sul database primario.

## Integrazione con Drizzle
Non devi scegliere tra Rebase e Drizzle. Il driver compila gli schemi dinamicamente e `internals.db` è il client Drizzle `NodePgDatabase` tipizzato, per SQL grezzo o query builder type-safe di Drizzle affiancati ai servizi REST di Rebase.

## Draining controllato delle connessioni
In ambienti serverless o orchestratori (come Kubernetes), l'arresto dei pod può causare connessioni interrotte in modo anomalo. Implementa sempre dei gestori di segnali (signal handler) che richiamino `internals.realtimeService.stopListening()` (che termina il client pg LISTEN dedicato) e `pool.end()`, in modo da non causare leak di slot di connessione sul database server.

## Risorse correlate

- [Integrazione server personalizzato](/docs/backend/custom-server/) — l'intero backend Rebase, assemblato a partire da componenti pubblici nel tuo server
- [Script e console](/docs/backend/scripts/) — i dati del progetto da uno script, un test o una REPL, senza alcun server
