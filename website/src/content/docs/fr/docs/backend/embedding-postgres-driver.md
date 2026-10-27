---
sourceHash: 26a29be19ddbdcb0
title: Intégrer le driver Postgres
sidebar_label: Intégrer le driver Postgres
description: Ouvrez le driver de données et le socket temps réel de @rebasepro/server-postgres dans Express, Fastify ou Node pur, sans le serveur Rebase — réplicas de lecture, Drizzle et drainage inclus.
---

Un cran sous un [serveur personnalisé](/docs/backend/custom-server/), `@rebasepro/server-postgres` fonctionne sans le serveur Rebase du tout. Il dépend de Drizzle et du `http.Server` de Node, vous pouvez donc ouvrir le driver de données et le socket temps réel dans Express, Fastify ou Node pur. À ce niveau, vous assemblez le backend vous-même : il n'y a ni routes d'authentification, ni stockage, ni API d'administration, sauf si vous les construisez.

## Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Ouverture du driver et du socket

`openPostgresDriver`
et `postgresDriverConfigFromEnv` sont exportés. Sur la 0.24, ouvrez le driver avec
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, dont `internals` n'est
pas typé.

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

`openPostgresDriver` est ce que `createPostgresAdapter` exécute au démarrage du serveur Rebase, une fois que `postgresDriverConfigFromEnv` a lu l'environnement dans la configuration. Son second argument dit quoi ouvrir : les `collections`, si l'ouverture peut exécuter son propre DDL (`provision`, `true` par défaut), et le rôle que ce processus joue dans le temps réel (`realtime: false` pour aucun).

Il ne crée aucune table de collection : face à une base qui n'en a pas, `POST /api/products` répond `500` "Table not found for collection 'products'". Créez d'abord les tables. `rebase db push` le fait depuis un projet Rebase dont `config/collections` les déclare. Dans ce serveur, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` avant `openPostgresDriver` ajoute les tables et colonnes qui manquent à la base, comme le fait le démarrage du serveur Rebase, et ne modifie rien de ce qui existe.

## Connexions à un réplica de lecture
Définissez `readConnectionString` dans la configuration du driver, ou la variable d'environnement `DATABASE_READ_URL`, que le démarrage du serveur et `postgresDriverConfigFromEnv` y lisent, et le driver ouvre un second pool de connexions vers votre réplica de lecture, sous `internals.readDb`. Les lectures vont au réplica ; les écritures restent sur le primaire.

L'option `readConnectionString` est prise en compte. Sur la 0.24 elle était déclarée et ignorée, et seule `DATABASE_READ_URL` fonctionnait.

## Intégration de Drizzle
Vous n'avez pas à choisir entre Rebase et Drizzle. Le driver compile vos schémas dynamiquement, et `internals.db` est le client Drizzle `NodePgDatabase`, typé, pour du SQL brut ou des builders Drizzle typés, aux côtés des services REST de Rebase.

## Drainage progressif des connexions
Dans les environnements serverless ou les orchestrateurs (comme Kubernetes), l'arrêt des pods peut laisser des connexions rompues. Implémentez toujours des gestionnaires de signaux qui appellent `internals.realtimeService.stopListening()` (ce qui termine le client pg LISTEN dédié) et `pool.end()`, afin de ne pas laisser fuir des emplacements de connexion sur votre serveur de base de données.

## Liens connexes

- [Intégration de serveur personnalisé](/docs/backend/custom-server/) — tout le backend Rebase, construit à partir de pièces publiques dans votre propre serveur
- [Scripts et console](/docs/backend/scripts/) — les données du projet depuis un script, un test ou un REPL, sans serveur
