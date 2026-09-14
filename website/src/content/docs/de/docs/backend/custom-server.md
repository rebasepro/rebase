---
sourceHash: bec01a5d7942e188
title: Integration eines eigenen Servers
sidebar_label: Eigener Server (Express)
description: Wie Sie Rebase-Datenbank- und Realtime-Dienste in Ihr eigenes benutzerdefiniertes Node.js-Backend einbetten, ohne Hono oder den Rebase-Koordinator zu verwenden.
---

# Integration eines eigenen Servers

Rebase wurde von Grund auf modular aufgebaut. Während der `initializeRebaseBackend`-Koordinator ein vollständiges, sofort einsatzbereites Backend auf Basis von Hono bereitstellt, können Sie diesen komplett umgehen und den eigentlichen **Datenbank-Adapter** sowie **Realtime-WebSockets** direkt in Ihre eigene Node.js-Anwendung einbetten (wie z. B. Express, Fastify oder reines Node.js-HTTP).

Das Paket `@rebasepro/server-postgres` ist vollständig framework-agnostisch. Es hängt lediglich von Drizzle ORM und dem Standard-Node.js-`http.Server` ab.

## Umgebungskonfiguration

Rebase stellt mit `loadEnv()` in `@rebasepro/server` ein zentrales Hilfsprogramm bereit, das Ihre Umgebungsvariablen anhand eines strikten Zod-Schemas validiert. Rufen Sie es **nach** dem Laden Ihrer `.env`-Datei auf:

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

Der Import von `z` aus `@rebasepro/server` ist neu. In Version 0.17 und
früher exportierte das Paket kein `z`: Importieren Sie es aus `zod` passend zur Major-Version,
die die Runtime verwendet, und lassen Sie Ihren Bundler die beiden Kopien deduplizieren.

:::caution[Das `z`, mit dem Sie erweitern, muss das Zod der Runtime sein]
Zwei gleichzeitig geladene Kopien von Zod sind die einzige Ursache dafür, dass dieser Aufruf fehlschlägt – und früher geschah dies stillschweigend. `.merge()` akzeptiert ein Schema der anderen Kopie (die Strukturen sind identisch), und anschließend lehnt `.parse()` jedes Feld mit einem `.default()` ab, da ein Standardwert anhand der Klassenidentität erkannt wird. Der Server fuhr hoch, meldete Erfolg und führte keinen seiner Crons aus; keine Fehlermeldung erwähnte Zod.

Deklarieren Sie `zod` nicht in den Abhängigkeiten Ihres Projekts – die Runtime stellt es bereit. Wenn Sie es müssen, stimmen Sie die Major-Version ab und lassen Sie Ihren Bundler deduplizieren. `loadEnv` verweigert jetzt beim Start ein fremdes Schema mit einer Meldung, die die Lösung nennt, anstatt es zu akzeptieren und nur die Hälfte davon zu validieren.
:::

**Wichtigste Verhaltensweisen:**
- Generiert in der Entwicklungsumgebung automatisch kurzlebige Werte für `JWT_SECRET` und `REBASE_SERVICE_KEY`, sodass Sie ohne manuelle Einrichtung starten können.
- Blockiert automatisch generierte Secrets in der Produktionsumgebung – Sie müssen diese explizit setzen.
- Prüft, ob in der Produktionsumgebung `CORS_ORIGINS` oder `FRONTEND_URL` gesetzt ist.
- Verweigert ein `extend`-Schema, das von einer anderen Kopie von Zod erstellt wurde.

Die vollständige Liste der unterstützten Variablen finden Sie in der `.env.example`-Datei der bereitgestellten Scaffold-App.

## Rebase mit Express verwenden

Hier ist ein vollständiges Beispiel dafür, wie Sie den Rebase-PostgreSQL-Adapter und die Realtime-WebSockets in einer standardmäßigen Express-Anwendung initialisieren, Read Replicas verwalten, direkt auf Drizzle zugreifen und ein sauberes Herunterfahren des Servers implementieren.

### 1. Installation

Installieren Sie die erforderlichen Core-Pakete zusammen mit Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Beispiel für Initialisierung und Graceful Shutdown

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

> **Standard-Weg:** Wenn Ihr Server `initializeRebaseBackend` verwendet (wie es die vorgefertigte Vorlage tut), schreiben Sie den oben gezeigten Shutdown-Handler nicht von Hand – verwenden Sie stattdessen den integrierten Helper. Dieser schließt HTTP-Verbindungen ordnungsgemäß ab, stoppt den Cron-Scheduler, beendet Realtime-Dienste, schützt vor wiederholten Signalen und erzwingt das Beenden, falls der Shutdown hängen bleibt:
>
> ```ts
> import { installShutdownHandlers } from "@rebasepro/server";
>
> const backend = await initializeRebaseBackend({ ... });
> installShutdownHandlers(backend, { onCleanup: () => pool.end() });
> ```
>
> Kombinieren Sie dies **nicht** mit Ihrem eigenen `server.close()` – `backend.shutdown()` schließt den Server bereits, und ein zweiter Schließversuch führt zu einem Deadlock. Der im obigen Beispiel gezeigte manuelle Handler ist ausschließlich für vollständig benutzerdefinierte Setups gedacht, die `initializeRebaseBackend` umgehen.

---

## Zentrale Backend-Konzepte

### Read-Replica-Verbindungen
Wenn Sie die Umgebungsvariable `DATABASE_READ_URL` definieren, erzeugt Rebase automatisch einen sekundären Verbindungspool, der auf Ihr Read Replica verweist. Der Bootstrapper registriert diesen unter `internals.readDb`. Der zentrale `EntityFetchService` leitet alle SELECT-Abfragen an den Replica-Pool weiter, um die Leistung zu optimieren, während Mutationsabfragen auf dem primären Pool verbleiben.

### Drizzle-Integration
Sie müssen sich nicht zwischen Rebase und Drizzle entscheiden. Der Bootstrapper kompiliert Ihre Schemas dynamisch. Sie können über `internals.db` auf den kompilierten Drizzle-NodePgDatabase-Client zugreifen. Dies ermöglicht es Ihnen, rohe SQL-Migrationen auszuführen oder typsichere Drizzle-Builder parallel zu den REST-Diensten von Rebase aufzurufen.

### Geordnetes Schließen von Verbindungen (Graceful Connection Draining)
In serverlosen Umgebungen oder Orchestratoren (wie Kubernetes) kann das Beenden von Pods zu unterbrochenen Verbindungen führen. Implementieren Sie stets Signal-Handler, die `realtimeProvider.stopListening()` (wodurch der dedizierte pg LISTEN-Client beendet wird) und `pool.end()` aufrufen, um das Blockieren ungenutzter Verbindungsslots auf Ihrem Datenbankserver zu verhindern.


## Verwandte Themen

- [Backend-Übersicht](/docs/backend/) – Wo die einzelnen Optionen liegen, wenn stattdessen die Runtime startet
- [Getrennte Prozesse](/docs/deployment/split-processes/) – Die Rollen, die ein eigener Server reproduzieren muss
- [Storage-Konfiguration](/docs/backend/storage/) – Die Quellen, die ein eigener Server selbst auflösen muss
