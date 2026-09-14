---
sourceHash: bec01a5d7942e188
title: Integrazione Server Personalizzato
sidebar_label: Server Personalizzato (Express)
description: Come integrare i servizi Rebase Database e Realtime nel tuo backend Node.js personalizzato senza utilizzare Hono o il coordinator di Rebase.
---

# Integrazione Server Personalizzato

Rebase è stato progettato per essere completamente modulare. Sebbene il coordinator `initializeRebaseBackend` fornisca un backend completo "chiavi in mano" basato su Hono, puoi bypassarlo del tutto e incorporare il **Database Adapter** principale e i **Realtime WebSocket** direttamente nella tua applicazione Node.js personalizzata (come Express, Fastify o semplicemente Node.js HTTP).

Il pacchetto `@rebasepro/server-postgres` è completamente agnostico rispetto al framework. Dipende unicamente da Drizzle ORM e dal modulo standard `http.Server` di Node.js.

## Configurazione dell'Ambiente

Rebase fornisce un'utilità centralizzata `loadEnv()` in `@rebasepro/server` che valida le variabili d'ambiente rispetto a uno schema Zod rigoroso. Eseguila **dopo** aver caricato il file `.env`:

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

L'importazione di `z` da `@rebasepro/server` è una novità. Nella versione 0.17 e
precedenti il pacchetto non esportava `z`: importalo da `zod`, allineando la major version a quella usata
dal runtime, e lascia che il tuo bundler deduplichi le due copie.

:::caution[La versione di `z` con cui estendi deve essere lo zod del runtime]
Avere due copie di zod caricate contemporaneamente è l'unico modo in cui questa chiamata fallisce, e in passato
falliva silenziosamente. `.merge()` accetta uno schema dall'altra copia —
le forme sono identiche — e poi `.parse()` rifiuta ogni campo provvisto di un
`.default()`, poiché un default viene riconosciuto dall'identità di classe. Il server si
avviava, riportava esito positivo e non eseguiva alcuno dei suoi cron; nessun errore
menzionava zod.

Non dichiarare `zod` nelle dipendenze del tuo progetto: è fornito dal runtime. Se
proprio devi, allinea la major version e lascia che il tuo bundler la deduplichi. `loadEnv` ora rifiuta uno
schema esterno all'avvio con un messaggio che indica la soluzione, invece di accettarlo
e validarlo solo a metà.
:::

**Comportamenti chiave:**
- Genera automaticamente `JWT_SECRET` e `REBASE_SERVICE_KEY` effimeri in fase di sviluppo, permettendo l'avvio senza configurazione manuale.
- Blocca i segreti generati automaticamente in produzione — è necessario impostarli esplicitamente.
- Valida che `CORS_ORIGINS` o `FRONTEND_URL` siano configurati in produzione.
- Rifiuta uno schema `extend` generato da una copia diversa di zod.

Consulta `.env.example` nell'applicazione generata tramite scaffolding per l'elenco completo delle variabili supportate.

## Utilizzo di Rebase con Express

Di seguito è riportato un esempio completo su come inizializzare l'adapter PostgreSQL di Rebase e i Realtime WebSocket all'interno di un'applicazione standard Express, gestire le read replica, accedere direttamente a Drizzle e implementare una terminazione corretta del server (graceful shutdown).

### 1. Installazione

Installa i pacchetti core richiesti insieme a Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Esempio di Inizializzazione e Graceful Shutdown

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

> **Percorso standard:** se il tuo server utilizza `initializeRebaseBackend` (come nel template di scaffolding), non implementare manualmente l'handler di shutdown mostrato sopra: usa invece l'helper integrato. Questo si occupa di svuotare le richieste HTTP, arrestare il cron scheduler, arrestare i servizi realtime, proteggere da segnali ripetuti ed eseguire un'uscita forzata se la chiusura si blocca:
>
> ```ts
> import { installShutdownHandlers } from "@rebasepro/server";
>
> const backend = await initializeRebaseBackend({ ... });
> installShutdownHandlers(backend, { onCleanup: () => pool.end() });
> ```
>
> **Non** combinarlo con il tuo `server.close()` — `backend.shutdown()` chiude già il server, e una seconda chiusura porterebbe a un deadlock. L'handler manuale mostrato nell'esempio precedente è riservato esclusivamente a configurazioni interamente personalizzate che bypassano `initializeRebaseBackend`.

---

## Concetti Chiave del Backend

### Connessioni alle Read Replica
Se definisci la variabile d'ambiente `DATABASE_READ_URL`, Rebase avvia automaticamente un connection pool secondario indirizzato alla tua read replica. Il bootstrapper lo registra sotto `internals.readDb`. Il componente principale `EntityFetchService` instrada tutte le query SELECT verso il pool di replica per ottimizzare le prestazioni, mentre le query di mutazione rimangono sul pool primario.

### Integrazione con Drizzle
Non devi scegliere tra Rebase e Drizzle. Il bootstrapper compila i tuoi schemi dinamicamente. Puoi accedere al client Drizzle NodePgDatabase compilato tramite `internals.db`, consentendoti di eseguire migrazioni SQL raw o invocare i query builder type-safe di Drizzle insieme ai servizi REST di Rebase.

### Drenaggio Corretto delle Connessioni (Graceful Draining)
Negli ambienti serverless o negli orchestratori (come Kubernetes), la chiusura dei pod può causare interruzioni anomale delle connessioni. Implementa sempre signal handler che richiamino `realtimeProvider.stopListening()` (il quale chiude il client dedicato a pg LISTEN) e `pool.end()` per prevenire il leak di slot di connessione nel tuo server di database.


## Correlati

- [Panoramica Backend](/docs/backend/) — dove risiede ciascuna opzione quando viene invece avviato il runtime
- [Processi Suddivisi](/docs/deployment/split-processes/) — i ruoli che un server personalizzato deve riprodurre
- [Configurazione dello Storage](/docs/backend/storage/) — le sorgenti che un server personalizzato deve risolvere autonomamente
