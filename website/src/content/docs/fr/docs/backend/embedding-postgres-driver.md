---
sourceHash: 82f7615bf6bd44b4
title: Intégrer le pilote Postgres
sidebar_label: Intégrer le pilote Postgres
description: Ouvrez le pilote de données et le socket temps réel de @rebasepro/server-postgres dans Express, Fastify ou Node standard, sans le serveur Rebase — réplicas de lecture, Drizzle et vidage de connexions inclus.
---

Un cran en dessous d'un [serveur personnalisé](/docs/backend/custom-server/), `@rebasepro/server-postgres` fonctionne entièrement sans le serveur Rebase. Il dépend de Drizzle et du `http.Server` de Node, ce qui vous permet d'ouvrir le pilote de données et le socket temps réel dans Express, Fastify ou Node standard. À ce niveau, vous assemblez le backend vous-même : il n'y a pas de routes d'authentification, pas de stockage et pas d'API d'administration, à moins que vous ne les construisiez.

## Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Ouverture du pilote et du socket

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`openPostgresDriver`
et `postgresDriverConfigFromEnv` sont exportés.

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

`./tables` est un de vos modules qui compile vos `defineTable` avec `compileSchema` de `@rebasepro/common` : le descripteur de chaque table avec ses hooks, à partir duquel le pilote construit son modèle d'exécution ([Scripts](/docs/backend/scripts/#openrebase) prend la même liste) :

```typescript
import { compileSchema } from "@rebasepro/common";
import { products, orders } from "./schema";

export const tables = compileSchema([products, orders]);
```

`openPostgresDriver` est ce que `createPostgresAdapter` exécute au démarrage du serveur Rebase, après que `postgresDriverConfigFromEnv` a chargé l'environnement dans la configuration. Son second argument indique ce qu'il faut ouvrir : les `tables`, si l'ouverture peut exécuter son propre DDL (`provision`, par défaut `true`), et le rôle que ce processus joue dans le temps réel (`realtime: false` pour aucun).

Il ne crée aucune table applicative, donc sur une base de données qui n'en possède pas, `POST /api/products` répondra `500` « Table not found for 'products' (table: products) ». Créez d'abord les tables. `rebase db push` s'en charge depuis un projet Rebase dont le `backend/schema` les déclare. Dans ce serveur, `await createPostgresAdapter(pgConfig).ensureTableSchema?.(tables)` avant `openPostgresDriver` ajoute les tables et les colonnes manquantes dans la base de données, tout comme le fait le démarrage du serveur Rebase, sans modifier ce qui existe déjà.

## Connexions aux réplicas de lecture
Définissez `readConnectionString` dans la configuration du pilote, ou la variable d'environnement `DATABASE_READ_URL`, que le démarrage du serveur et `postgresDriverConfigFromEnv` y lisent, et le pilote ouvrira un second pool de connexions vers votre réplica de lecture, accessible sous `internals.readDb`. Les lectures vont vers le réplica ; les écritures restent sur le primaire.

## Intégration de Drizzle
Vous n'avez pas à choisir entre Rebase et Drizzle. Le pilote compile vos schémas dynamiquement, et `internals.db` est le client Drizzle `NodePgDatabase` typé, pour du SQL brut ou des constructeurs Drizzle typés aux côtés des services REST de Rebase.

## Vidage gracieux des connexions
Dans les environnements serverless ou les orchestrateurs (comme Kubernetes), l'arrêt des pods peut entraîner des connexions interrompues. Implémentez toujours des gestionnaires de signaux qui appellent `internals.realtimeService.stopListening()` (ce qui met fin au client pg LISTEN dédié) et `pool.end()`, afin de ne pas gaspiller d'emplacements de connexion sur votre serveur de base de données.

## Voir aussi

- [Intégration d'un serveur personnalisé](/docs/backend/custom-server/) — l'ensemble du backend Rebase, construit à partir de briques publiques dans votre propre serveur
- [Scripts et console](/docs/backend/scripts/) — les données du projet depuis un script, un test ou un REPL, sans serveur
