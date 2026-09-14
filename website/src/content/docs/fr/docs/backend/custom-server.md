---
sourceHash: bec01a5d7942e188
title: Intégration de serveur personnalisé
sidebar_label: Serveur personnalisé (Express)
description: Comment intégrer les services Rebase Database et Realtime dans votre propre backend Node.js personnalisé sans utiliser Hono ni le coordinateur Rebase.
---

# Intégration de serveur personnalisé

Rebase a été conçu pour être totalement modulaire. Bien que le coordinateur `initializeRebaseBackend` fournisse un backend complet « clés en main » utilisant Hono, vous pouvez l'ignorer totalement et intégrer directement le **Database Adapter** de base ainsi que les **Realtime WebSockets** au sein de votre propre application Node.js personnalisée (comme Express, Fastify ou simplement le serveur HTTP natif de Node.js).

Le package `@rebasepro/server-postgres` est totalement indépendant du framework. Il dépend uniquement de Drizzle ORM et de l'`http.Server` standard de Node.js.

## Configuration de l'environnement

Rebase fournit un utilitaire centralisé `loadEnv()` dans `@rebasepro/server` qui valide vos variables d'environnement par rapport à un schéma Zod strict. Appelez-le **après** avoir chargé votre fichier `.env` :

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

L'importation de `z` depuis `@rebasepro/server` est récente. Sur la version 0.17 et les versions antérieures, le package n'exportait aucun `z` : importez-le depuis `zod`, en faisant correspondre la version majeure utilisée par le runtime, et laissez votre bundler dédupliquer les deux copies.

:::caution[Le `z` utilisé pour étendre doit être le zod du runtime]
Avoir deux copies de zod chargées en même temps est la seule façon dont cet appel peut échouer, et cela échouait auparavant silencieusement. `.merge()` accepte un schéma provenant de l'autre copie — les structures sont identiques — puis `.parse()` rejette chaque champ comportant un `.default()`, car une valeur par défaut est reconnue par identité de classe. Le serveur démarrait, signalait un succès et n'exécutait aucune de ses tâches cron ; rien dans l'échec ne mentionnait zod.

Ne déclarez pas `zod` dans les dépendances de votre projet — le runtime le fournit déjà. Si vous devez le faire, faites correspondre sa version majeure et laissez votre bundler dédupliquer. `loadEnv` refuse désormais un schéma étranger au démarrage avec un message indiquant la solution, plutôt que de l'accepter et de n'en valider que la moitié.
:::

**Comportements clés :**
- Génère automatiquement des clés éphémères `JWT_SECRET` et `REBASE_SERVICE_KEY` en développement pour que vous puissiez démarrer sans configuration manuelle.
- Bloque les secrets générés automatiquement en production — vous devez les définir explicitement.
- Valide que `CORS_ORIGINS` ou `FRONTEND_URL` est défini en production.
- Refuse un schéma `extend` construit par une copie différente de zod.

Consultez `.env.example` dans l'application échafaudée pour la liste complète des variables prises en charge.

## Utiliser Rebase avec Express

Voici un exemple complet montrant comment initialiser l'adaptateur PostgreSQL de Rebase et les WebSockets Realtime au sein d'une application Express standard, gérer les répliques de lecture, accéder directement à Drizzle et implémenter une fermeture propre du serveur.

### 1. Installation

Installez les packages de base requis ainsi qu'Express :

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Exemple d'initialisation et d'arrêt gracieux

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

> **Voie standard :** si votre serveur utilise `initializeRebaseBackend` (comme le fait le template généré), ne concevez pas vous-même le gestionnaire d'arrêt ci-dessus — utilisez plutôt le helper intégré. Il vide les connexions HTTP, arrête le planificateur de tâches cron, détruit les services en temps réel, protège contre les signaux répétés et force l'arrêt si la fermeture se bloque :
>
> ```ts
> import { installShutdownHandlers } from "@rebasepro/server";
>
> const backend = await initializeRebaseBackend({ ... });
> installShutdownHandlers(backend, { onCleanup: () => pool.end() });
> ```
>
> Ne le combinez **pas** avec votre propre `server.close()` — `backend.shutdown()` ferme déjà le serveur, et une seconde fermeture provoquerait un interblocage (deadlock). Le gestionnaire manuel présenté dans l'exemple ci-dessus est uniquement destiné aux configurations entièrement personnalisées qui contournent `initializeRebaseBackend`.

---

## Concepts clés du backend

### Connexions aux répliques de lecture (Read Replicas)
Si vous définissez la variable d'environnement `DATABASE_READ_URL`, Rebase génère automatiquement un pool de connexions secondaire ciblant votre réplique de lecture. Le bootstrapper l'enregistre sous `internals.readDb`. Le service principal `EntityFetchService` route toutes les requêtes SELECT vers le pool de la réplique pour optimiser les performances, tandis que les requêtes de mutation restent sur le pool principal.

### Intégration de Drizzle
Vous n'avez pas à choisir entre Rebase et Drizzle. Le bootstrapper compile vos schémas de manière dynamique. Vous pouvez accéder au client Drizzle NodePgDatabase compilé via `internals.db`, ce qui vous permet d'exécuter des migrations SQL brutes ou d'invoquer les constructeurs de requêtes typés de Drizzle aux côtés des services REST de Rebase.

### Vidange propre des connexions (Graceful Connection Draining)
Dans les environnements serverless ou les orchestrateurs (comme Kubernetes), la terminaison de pods peut entraîner des connexions interrompues. Implémentez toujours des gestionnaires de signaux qui appellent `realtimeProvider.stopListening()` (ce qui met fin au client pg LISTEN dédié) et `pool.end()` afin d'éviter la fuite d'emplacements de connexion sur votre serveur de base de données.

## Liens connexes

- [Backend Overview](/docs/backend/) — où réside chaque option lorsque le runtime démarre à la place
- [Split Processes](/docs/deployment/split-processes/) — les rôles qu'un serveur personnalisé doit reproduire
- [Storage Configuration](/docs/backend/storage/) — les sources qu'un serveur personnalisé doit résoudre lui-même
