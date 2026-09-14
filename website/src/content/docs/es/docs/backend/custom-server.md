---
sourceHash: bec01a5d7942e188
title: Integración de servidor personalizado
sidebar_label: Servidor personalizado (Express)
description: Cómo integrar los servicios de base de datos y Realtime de Rebase en tu propio backend personalizado de Node.js sin usar Hono ni el coordinador de Rebase.
---

# Integración de servidor personalizado

Rebase fue diseñado para ser completamente modular. Si bien el coordinador `initializeRebaseBackend` proporciona un backend completo con todo incluido utilizando Hono, puedes omitirlo por completo e integrar el **Adaptador de base de datos** y los **WebSockets en tiempo real** directamente en tu propia aplicación personalizada de Node.js (como Express, Fastify o Node.js HTTP puro).

El paquete `@rebasepro/server-postgres` es totalmente independiente del framework. Solo depende de Drizzle ORM y del `http.Server` estándar de Node.js.

## Configuración del entorno

Rebase proporciona una utilidad centralizada `loadEnv()` en `@rebasepro/server` que valida tus variables de entorno contra un esquema estricto de Zod. Invócala **después** de cargar tu archivo `.env`:

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

Importar `z` desde `@rebasepro/server` es una novedad. En la versión 0.17 y anteriores, el paquete no exportaba ningún `z`: impórtalo desde `zod`, haciendo coincidir la versión principal (major) que utiliza el runtime, y deja que tu empaquetador elimine duplicados entre las dos copias.

:::caution[El `z` con el que extiendes debe ser el zod del runtime]
Cargar dos copias de zod a la vez es la única forma en que esta llamada falla, y solía fallar silenciosamente. `.merge()` acepta un esquema de la otra copia —las estructuras son idénticas— y luego `.parse()` rechaza cada campo que tenga un `.default()`, porque un valor por defecto se reconoce por la identidad de la clase. El servidor se iniciaba, reportaba éxito y no ejecutaba ninguno de sus crons; nada en el fallo mencionaba zod.

No declares `zod` en las dependencias de tu proyecto; el runtime ya lo proporciona. Si es imprescindible hacerlo, haz coincidir su versión principal y permite que tu empaquetador elimine duplicados. Ahora `loadEnv` rechaza un esquema externo durante el arranque con un mensaje que indica la solución, en lugar de aceptarlo y validar solo la mitad de él.
:::

**Comportamientos clave:**
- Genera automáticamente `JWT_SECRET` y `REBASE_SERVICE_KEY` efímeros en desarrollo para que puedas comenzar sin configuración manual.
- Bloquea los secretos generados automáticamente en producción; debes definirlos explícitamente.
- Valida que `CORS_ORIGINS` o `FRONTEND_URL` estén configurados en producción.
- Rechaza un esquema `extend` creado por una copia diferente de zod.

Consulta `.env.example` en la aplicación generada para ver la lista completa de variables admitidas.

## Uso de Rebase con Express

A continuación, se muestra un ejemplo completo de cómo inicializar el adaptador de PostgreSQL de Rebase y los WebSockets en tiempo real dentro de una aplicación estándar de Express, gestionar réplicas de lectura, acceder a Drizzle directamente e implementar terminaciones limpias del servidor.

### 1. Instalación

Instala los paquetes principales requeridos junto con Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Ejemplo de inicialización y apagado ordenado (graceful shutdown)

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

> **Vía estándar:** si tu servidor utiliza `initializeRebaseBackend` (como hace la plantilla generada), no crees manualmente el manejador de apagado anterior; utiliza en su lugar el helper integrado. Este drena HTTP, detiene el programador de crons, desconecta los servicios en tiempo real, protege contra señales repetidas y fuerza la salida si el apagado se bloquea:
>
> ```ts
> import { installShutdownHandlers } from "@rebasepro/server";
>
> const backend = await initializeRebaseBackend({ ... });
> installShutdownHandlers(backend, { onCleanup: () => pool.end() });
> ```
>
> **No** lo combines con tu propio `server.close()`: `backend.shutdown()` ya cierra el servidor, y un segundo cierre provocará un bloqueo mutuo (deadlock). El manejador manual mostrado en el ejemplo anterior es solo para configuraciones totalmente personalizadas que omiten `initializeRebaseBackend`.

---

## Conceptos clave del backend

### Conexiones de réplica de lectura
Si defines la variable de entorno `DATABASE_READ_URL`, Rebase genera automáticamente un pool de conexiones secundario dirigido a tu réplica de lectura. El bootstrapper registra esto bajo `internals.readDb`. El `EntityFetchService` principal enruta todas las consultas SELECT al pool de la réplica para optimizar el rendimiento, mientras que las consultas de mutación permanecen en el pool principal.

### Integración con Drizzle
No tienes que elegir entre Rebase y Drizzle. El bootstrapper compila tus esquemas dinámicamente. Puedes acceder al cliente compilado `NodePgDatabase` de Drizzle mediante `internals.db`, lo que te permite ejecutar migraciones SQL directas o invocar los builders con seguridad de tipos de Drizzle junto con los servicios REST de Rebase.

### Drenado ordenado de conexiones
En entornos serverless u orquestadores (como Kubernetes), la finalización de pods puede provocar conexiones interrumpidas. Implementa siempre manejadores de señales que invoquen `realtimeProvider.stopListening()` (que finaliza el cliente dedicado de pg LISTEN) y `pool.end()` para evitar agotar o fugar conexiones en tu servidor de base de datos.


## Relacionado

- [Descripción general del backend](/docs/backend/) — dónde se ubica cada opción cuando el runtime arranca en su lugar
- [Procesos divididos](/docs/deployment/split-processes/) — los roles que un servidor personalizado debe reproducir
- [Configuración de almacenamiento](/docs/backend/storage/) — las fuentes que un servidor personalizado debe resolver por sí mismo
