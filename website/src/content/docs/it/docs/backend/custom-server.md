---
sourceHash: aeb69aa6164eafbc
title: Integrazione di un Server Personalizzato
sidebar_label: Server Personalizzato (Express)
description: Come incorporare i servizi di database e Realtime di Rebase nel proprio backend Node.js personalizzato senza utilizzare Hono o il coordinatore Rebase.
---

# Integrazione di un Server Personalizzato

Rebase è stato progettato per essere completamente modulare. Sebbene il coordinatore `initializeRebaseBackend` fornisca un backend completo e pronto all'uso con Hono, puoi bypassarlo completamente e integrare l'**Adattatore di Database** principale e i **WebSocket Realtime** direttamente nella tua applicazione Node.js personalizzata (come Express, Fastify o HTTP Node.js standard).

Il pacchetto `@rebasepro/server-postgres` è completamente indipendente da qualsiasi framework. Dipende solo da Drizzle ORM e dal server `http.Server` standard di Node.js.

## Configurazione dell'Ambiente

Rebase fornisce un'utilità centralizzata `loadEnv()` in `@rebasepro/server` che convalida le variabili di ambiente rispetto a un rigido schema Zod. Richiamala **dopo** aver caricato il file `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Base — solo variabili di ambiente di Rebase:
export const env = loadEnv();

// Esteso — aggiungi le tue variabili tipizzate:
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (completamente tipizzato)
// env.STRIPE_SECRET_KEY → string        (convalidato, richiesto)
```

Importare `z` da `@rebasepro/server` è una novità <span class="since-badge" data-since="0.18">Since 0.18</span>. In 0.17 e
precedenti il pacchetto non esportava alcun `z`: importalo da `zod`, con la
stessa versione major usata dal runtime, e lascia che il tuo bundler deduplichi
le due copie.

**Comportamenti chiave:**
- Genera automaticamente chiavi temporanee `JWT_SECRET` e `REBASE_SERVICE_KEY` in fase di sviluppo in modo da poter iniziare senza una configurazione manuale.
- Blocca i segreti autogenerati in produzione — devi impostarli esplicitamente.
- Convalida che `CORS_ORIGINS` o `FRONTEND_URL` siano configurati in produzione.

Vedi `.env.example` nell'applicazione generata per l'elenco completo delle variabili supportate.

## Utilizzo di Rebase con Express

Ecco un esempio completo di come inizializzare l'adattatore PostgreSQL di Rebase e i WebSocket realtime all'interno di un'applicazione Express standard.

### 1. Installare le Dipendenze

Avrai bisogno del pacchetto del server Postgres insieme a Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express
```

### 2. Esempio di Inizializzazione

```typescript
import express from 'express';
import { createServer } from 'http';
import { createPostgresBootstrapper } from '@rebasepro/server-postgres';

async function startServer() {
    const app = express();
    
    // 1. DEVI creare il server HTTP Node nativo per consentire al server WebSocket di associarsi ad esso
    const server = createServer(app);

    // 2. Inizializzare direttamente il Postgres Bootstrapper
    const bootstrapper = createPostgresBootstrapper({
        connectionString: process.env.DATABASE_URL,
        // Opzionale: definisci uno schema Drizzle qui se desideri relazioni/query tipizzate
        // schema: { tables: { ... } } 
    });

    // 3. Inizializzare il driver (si connette al DB, avvia i listener di replica logica)
    const { driver, realtimeProvider } = await bootstrapper.initializeDriver({
        collections: [] // Passa le tue collezioni Rebase qui se le stai utilizzando
    });

    // 4. Associa i WebSocket di Rebase al tuo server HTTP
    await bootstrapper.initializeWebsockets(
        server, 
        realtimeProvider, 
        driver
    );

    // --- Rotte Express ---
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('Server Express in esecuzione con Rebase integrato!');
    });

    // Puoi interagire direttamente con il driver di Rebase in qualsiasi punto delle rotte Express
    app.post('/custom-data', async (req, res) => {
        try {
            // Usa il driver di database nativo di Rebase
            const result = await driver.save({
                collection: 'products',
                entity: req.body
            });
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. Avvia l'ascolto usando l'istanza del server nativo (NON app.listen)
    server.listen(3000, () => {
        console.log('Express e Rebase Realtime attivi sulla porta 3000');
    });
}

startServer();
```

## Concetti Chiave

### Server HTTP Nativo
Poiché i WebSocket richiedono una richiesta HTTP `Upgrade`, **devi** associare Rebase all'istanza nativa `http.Server` di Node.js. Se chiami semplicemente `app.listen(3000)` in Express, non avrai accesso all'oggetto del server sottostante richiesto da `initializeWebsockets()`.

### Bypassare Hono
Richiamando direttamente `createPostgresBootstrapper()` e chiamando manualmente `initializeDriver()` e `initializeWebsockets()`, stai bypassando completamente il coordinatore Rebase (`initializeRebaseBackend`). Ciò significa che non vengono caricate le dipendenze di Hono e non vengono montate le API REST generate automaticamente, le rotte dell'interfaccia utente amministrativa o gli endpoint di autenticazione.

Questo ti offre un controllo completo sulle tue API sfruttando al contempo il potente motore WebSocket di replica logica di Rebase e il driver basato su Drizzle.
