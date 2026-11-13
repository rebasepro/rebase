---
sourceHash: 82f7615bf6bd44b4
title: Integrar el driver de Postgres
sidebar_label: Integrar el driver de Postgres
description: Abre el driver de datos y el socket en tiempo real de @rebasepro/server-postgres dentro de Express, Fastify o Node puro, sin el servidor de Rebase — réplicas de lectura, Drizzle y drenaje de conexiones incluidos.
---

Un paso por debajo de un [servidor personalizado](/docs/backend/custom-server/), `@rebasepro/server-postgres` funciona completamente sin el servidor de Rebase. Depende de Drizzle y de `http.Server` de Node, por lo que puedes abrir el driver de datos y el socket en tiempo real dentro de Express, Fastify o Node puro. En este nivel, tú mismo ensamblas el backend: no hay rutas de autenticación, ni almacenamiento ni API de administración a menos que los construyas.

## Instalación

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Abrir el driver y el socket

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se exportan `openPostgresDriver` y `postgresDriverConfigFromEnv`.

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

`./tables` es un módulo tuyo que compila tus `defineTable` con `compileSchema` de `@rebasepro/common`: el descriptor de cada tabla con sus hooks, a partir del cual el driver construye su modelo en tiempo de ejecución ([Scripts](/docs/backend/scripts/#openrebase) toma la misma lista):

```typescript
import { compileSchema } from "@rebasepro/common";
import { products, orders } from "./schema";

export const tables = compileSchema([products, orders]);
```

`openPostgresDriver` es lo que ejecuta `createPostgresAdapter` cuando arranca el servidor de Rebase, después de que `postgresDriverConfigFromEnv` haya leído el entorno en la configuración. Su segundo argumento indica qué abrir: las `tables`, si la apertura puede ejecutar su propio DDL (`provision`, por defecto `true`) y qué papel toma este proceso en tiempo real (`realtime: false` para ninguno).

No crea ninguna tabla de la aplicación, por lo que contra una base de datos sin ella, `POST /api/products` responderá `500` "Table not found for 'products' (table: products)". Crea las tablas primero. `rebase db push` lo hace desde un proyecto de Rebase cuyo `backend/schema` las declare. En este servidor, `await createPostgresAdapter(pgConfig).ensureTableSchema?.(tables)` antes de `openPostgresDriver` añade las tablas y columnas que le faltan a la base de datos, tal como lo hace el arranque del servidor de Rebase, y no modifica nada de lo existente.

## Conexiones de réplica de lectura
Define `readConnectionString` en la configuración del driver, o la variable de entorno `DATABASE_READ_URL`, la cual es leída por el arranque del servidor y por `postgresDriverConfigFromEnv`, y el driver abrirá un segundo pool de conexiones contra tu réplica de lectura, bajo `internals.readDb`. Las lecturas van a la réplica; las escrituras permanecen en el primario.

## Integración con Drizzle
No tienes que elegir entre Rebase y Drizzle. El driver compila tus esquemas dinámicamente, e `internals.db` es el cliente tipado `NodePgDatabase` de Drizzle, para SQL directo o constructores de Drizzle con seguridad de tipos junto a los servicios REST de Rebase.

## Drenaje ordenado de conexiones
En entornos serverless u orquestadores (como Kubernetes), la finalización de pods puede resultar en conexiones rotas. Implementa siempre manejadores de señales que llamen a `internals.realtimeService.stopListening()` (lo que finaliza el cliente dedicado de pg LISTEN) y `pool.end()`, para no dejar conexiones huérfanas en tu servidor de base de datos.

## Relacionado

- [Integración de servidor personalizado](/docs/backend/custom-server/) — todo el backend de Rebase, construido a partir de piezas públicas en tu propio servidor
- [Scripts y la consola](/docs/backend/scripts/) — los datos del proyecto desde un script, una prueba o un REPL, sin necesidad de un servidor
