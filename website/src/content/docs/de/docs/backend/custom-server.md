---
sourceHash: 25ae48f967fcc90a
title: Eigene Serverintegration
sidebar_label: Eigener Server (Express)
description: So betten Sie Rebase-Datenbank- und Echtzeitdienste in Ihr eigenes benutzerdefiniertes Node.js-Backend ein, ohne Hono oder den Rebase-Koordinator zu verwenden.
---

# Eigene Serverintegration

Rebase wurde so konzipiert, dass es vollständig modular ist. Während der Koordinator `initializeRebaseBackend` ein komplettes, einsatzbereites Backend mit Hono bereitstellt, können Sie diesen komplett umgehen und den Core **Datenbank-Adapter** sowie **Echtzeit-WebSockets** direkt in Ihre eigene Node.js-Anwendung (wie Express, Fastify oder reines Node.js HTTP) einbetten.

Das Paket `@rebasepro/server-postgres` ist vollständig framework-agnostisch. Es hängt nur von Drizzle ORM und dem Standard-Node.js-`http.Server` ab.

## Umgebungskonfiguration

Rebase bietet ein zentrales Hilfsprogramm `loadEnv()` in `@rebasepro/server`, das Ihre Umgebungsvariablen anhand eines strengen Zod-Schemas validiert. Rufen Sie es auf, **nachdem** Sie Ihre `.env`-Datei geladen haben:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Einfach — nur Rebase-Umgebungsvariablen:
export const env = loadEnv();

// Erweitert — fügen Sie Ihre eigenen typisierten Variablen hinzu:
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (vollständig typisiert)
// env.STRIPE_SECRET_KEY → string        (validiert, erforderlich)
```

**Wichtige Verhaltensweisen:**
- Generiert automatisch flüchtige `JWT_SECRET`- und `REBASE_SERVICE_KEY`-Werte in der Entwicklung, sodass Sie ohne manuelle Einrichtung starten können.
- Blockiert automatisch generierte Secrets in der Produktion — Sie müssen diese explizit festlegen.
- Validiert, dass `CORS_ORIGINS` oder `FRONTEND_URL` in der Produktion gesetzt ist.

Siehe `.env.example` in der generierten App für die vollständige Liste der unterstützten Variablen.

## Verwendung von Rebase mit Express

Hier ist ein vollständiges Beispiel dafür, wie der Rebase-PostgreSQL-Adapter und die Echtzeit-WebSockets in einer Standard-Express-Anwendung initialisiert werden.

### 1. Abhängigkeiten installieren

Sie benötigen das Postgres-Server-Paket zusammen mit Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express
```

### 2. Initialisierungsbeispiel

```typescript
import express from 'express';
import { createServer } from 'http';
import { createPostgresBootstrapper } from '@rebasepro/server-postgres';

async function startServer() {
    const app = express();
    
    // 1. Sie MÜSSEN den rohen Node HTTP-Server erstellen, damit sich der WebSocket-Server daran binden kann
    const server = createServer(app);

    // 2. Initialisieren Sie den Postgres-Bootstrapper direkt
    const bootstrapper = createPostgresBootstrapper({
        connectionString: process.env.DATABASE_URL,
        // Optional: Definieren Sie hier Ihr Drizzle-Schema, falls Sie typisierte Beziehungen/Abfragen wünschen
        // schema: { tables: { ... } } 
    });

    // 3. Initialisieren Sie den Treiber (verbindet sich mit der DB, startet logische Replikations-Listener)
    const { driver, realtimeProvider } = await bootstrapper.initializeDriver({
        collections: [] // Übergeben Sie hier Ihre Rebase-Sammlungen, falls Sie sie verwenden
    });

    // 4. Binden Sie die Rebase-WebSockets an Ihren HTTP-Server an
    await bootstrapper.initializeWebsockets(
        server, 
        realtimeProvider, 
        driver
    );

    // --- Express-Routen ---
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('Express-Server läuft mit eingebettetem Rebase!');
    });

    // Sie können direkt in Ihren Express-Routen mit dem Rebase-Treiber interagieren
    app.post('/custom-data', async (req, res) => {
        try {
            // Verwenden Sie den rohen Rebase-Datenbank-Treiber
            const result = await driver.save({
                collection: 'products',
                entity: req.body
            });
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. Starten Sie das Lauschen über die rohe Server-Instanz (NICHT app.listen)
    server.listen(3000, () => {
        console.log('Express und Rebase Realtime laufen auf Port 3000');
    });
}

startServer();
```

## Wichtige Konzepte

### Nativer HTTP-Server
Da WebSockets eine HTTP-`Upgrade`-Anfrage erfordern, **müssen** Sie Rebase an die native Node.js-`http.Server`-Instanz binden. Wenn Sie in Express einfach `app.listen(3000)` aufrufen, haben Sie keinen Zugriff auf das zugrunde liegende Server-Objekt, das von `initializeWebsockets()` benötigt wird.

### Umgehung von Hono
Durch den direkten Aufruf von `createPostgresBootstrapper()` und das manuelle Aufrufen von `initializeDriver()` und `initializeWebsockets()` umgehen Sie den Rebase-Koordinator (`initializeRebaseBackend`) vollständig. Dies bedeutet, dass keine Hono-Abhängigkeiten geladen werden und die automatisch generierten REST-APIs, Admin-UI-Routen und Auth-Endpunkte nicht bereitgestellt werden.

Dies gibt Ihnen die vollständige Kontrolle über Ihre API-Oberfläche, während Sie dennoch die leistungsstarke logical-replication WebSocket-Engine und den Drizzle-gesteuerten Treiber von Rebase nutzen.
