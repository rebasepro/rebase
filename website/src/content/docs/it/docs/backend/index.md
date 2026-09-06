---
title: Panoramica del Backend
sidebar_label: Backend
description: Il backend di Rebase fornisce un server completo con API REST, autenticazione, archiviazione, tempo reale WebSocket e cronologia delle entità — tutto inizializzato con una singola chiamata di funzione.
---

## Panoramica

Il backend di Rebase è un **server Node.js** basato su [Hono](https://hono.dev/) che fornisce:

- **API REST** — Endpoint CRUD auto-generati per ogni collezione
- **Autenticazione** — Token JWT, accesso OAuth e OIDC, magic link, codici monouso, MFA, chiavi API, gestione utenti/ruoli
- **Archiviazione** — Caricamento/download di file con filesystem locale o S3
- **WebSocket** — Sincronizzazione dati in tempo reale tramite PostgreSQL LISTEN/NOTIFY
- **Cronologia delle Entità** — Traccia di audit per ogni modifica dei dati
- **Branching del Database** — Copie del database istantanee e isolate per dev/staging/testing
- **Cron Job** — Attività in background programmate con dashboard di monitoraggio

Tutto viene inizializzato con una singola funzione:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
    enableSwagger: env.NODE_ENV !== "production"
});
```

## Cosa Viene Creato

Dopo l'inizializzazione, queste rotte vengono montate:

| Path | Purpose |
|------|---------|
| `/api/auth/*` | Autenticazione (registrazione, login, refresh, OAuth, magic link, codici monouso, MFA) |
| `/api/admin/*` | Gestione utenti e ruoli (solo per admin) |
| `/api/storage/*` | Caricamento, download ed eliminazione di file |
| `/api/data/:slug` | Operazioni CRUD per collezione (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Cronologia delle modifiche delle entità (quando abilitata) |
| `/api/docs` | Specifica OpenAPI (quando `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (modalità sviluppo, quando `enableSwagger: true`) |
| `/api/meta/contract` | Lo schema delle collezioni del progetto (solo admin) |
| `/api/meta/schema-version` | Una stringa di versione per quello schema (non autenticata) |
| `/api/functions/*` | Rotte per funzioni personalizzate (quando `functionsDir` è impostato) |
| `/api/cron/*` | Gestione dei Cron job (solo per admin, quando `cronsDir` è impostato) |
| WebSocket on upgrade | Sottoscrizioni in tempo reale |

## Riferimento Configurazione

```typescript
interface RebaseBackendConfig {
    // Framework HTTP
    app: Hono;               // Istanza dell'applicazione Hono
    server: Server;           // Server HTTP Node.js (per l'attaccamento WebSocket)
    basePath?: string;        // Prefisso della rotta (predefinito: "/api")

    // Collezioni
    collections?: CollectionConfig[];  // Le tue definizioni di collezione
    collectionsDir?: string;  // Carica automaticamente le collezioni da una directory

    // Bootstrappers (Database, Autenticazione, Tempo reale, ecc.)
    bootstrappers: BackendBootstrapper[];

    // Autenticazione
    auth?: AuthConfig;

    // Archiviazione file
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Cronologia delle entità
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Endpoint API personalizzati
    functionsDir?: string;    // Carica automaticamente le rotte Hono da una directory

    // Attività programmate
    cronsDir?: string;        // Carica automaticamente i cron job da una directory

    // Registrazione
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

## L'Istanza del Backend

`initializeRebaseBackend` restituisce una `RebaseBackendInstance` con accesso ai servizi interni:

```typescript
const instance = await initializeRebaseBackend(config);

// Accesso ai servizi interni
instance.driver              // Driver dati predefinito
instance.driverRegistry      // Tutti i driver (per multi-database)
instance.realtimeService     // Servizio in tempo reale predefinito
instance.userService         // Gestione utenti
instance.roleService         // Gestione ruoli
instance.storageController   // Archiviazione predefinita
instance.storageRegistry     // Tutti i backend di archiviazione
instance.collectionRegistry  // Metadati delle collezioni
instance.historyService      // Cronologia delle entità
instance.cronScheduler       // Scheduler di cron job (quando cronsDir è impostato)
```

> **Nota:** Sebbene l'`instance` esponga questi servizi interni, il codice dell'applicazione (come funzioni personalizzate e cron job) dovrebbe utilizzare il singleton globale `rebase` da `@rebasepro/server` per interagire con l'API del backend.

## API REST

L'API REST viene generata automaticamente dalle tue collezioni. Ogni collezione ottiene questi endpoint:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenca entità — filtro, ordinamento, paginazione e ricerca sono parametri di query |
| `GET` | `/api/data/:slug/count` | Quante righe corrispondono alla stessa query |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, facoltativamente raggruppati |
| `GET` | `/api/data/:slug/:id` | Ottieni una singola entità |
| `POST` | `/api/data/:slug` | Crea una nuova entità |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna i campi che invii |
| `DELETE` | `/api/data/:slug/:id` | Elimina un'entità |
| `POST` | `/api/data/:slug/bulk` | Crea molte righe in un'unica transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna molte righe in un'unica transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina molte righe in un'unica transazione |

### Parametri di query

Esiste un unico riferimento per essi e non è questa pagina. [API REST](/docs/backend/api/)
documenta entrambi i dialetti di query accettati dal server — la forma `?column=op.value` in
stile PostgREST e la forma JSON `?where=` — insieme a `orderBy`, `limit`/`offset`, `include`,
`fields`, `searchString` e la ricerca vettoriale.
[Endpoint](/docs/backend/endpoints/) è l'indice di ogni rotta montata dal server, incluse
quelle generate.

Un parametro che il server non riserva viene letto come filtro sulla colonna con quel nome:
uno inventato quindi non fallisce, semplicemente non corrisponde a nulla.

## WebSocket

Il server WebSocket si connette allo stesso server HTTP e fornisce sottoscrizioni in tempo reale:

- Iscriviti alle **modifiche delle collezioni** — ricevi notifiche quando qualsiasi entità in una collezione viene creata, aggiornata o eliminata
- Iscriviti alle **modifiche delle entità** — ricevi notifiche quando una specifica entità cambia
- Gestione automatica della **riconnessione** nell'SDK del client

Il backend utilizza internamente PostgreSQL `LISTEN/NOTIFY`. Per deploy multi-istanza, fornisci una `connectionString` nel tuo `PostgresBootstrapper` per abilitare la trasmissione tra istanze.

## Gestione degli Errori

Il backend include un gestore degli errori che cattura tutte le eccezioni e restituisce risposte di errore strutturate:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Sempre presente | Che cos'è |
|-------|:---------------:|-----------|
| `message` | sì | Scritto per la persona che lo leggerà in una console. Nomina l'ostacolo, non la regola. |
| `code` | sì | `SCREAMING_SNAKE_CASE` e stabile. È il campo su cui ramificare. |
| `details` | no | Payload strutturato quando il rifiuto riguarda *qualcosa* — un elenco di percorsi falliti, un insieme di campi sconosciuti. |
| `requestId` | no | Presente quando la richiesta ne portava uno o gliene è stato assegnato uno; riflette `X-Request-ID`. Citalo in una segnalazione. |

Lo stato HTTP sta nella risposta, non nel corpo. Ramifica su `code`, non su
`message` — i messaggi sono scritti per le persone e possono cambiare.

## Prossimi Passi

- **[Autenticazione](/docs/backend/authentication)** — JWT, provider OAuth e OIDC, MFA, chiavi API, gestione utenti
- **[Archiviazione](/docs/backend/storage)** — Archiviazione di file locali e S3
- **[Callback delle Entità](/docs/collections/callbacks)** — Hook del ciclo di vita e API `context.data`
- **[Cronologia delle Entità](/docs/backend/history)** — Traccia di audit
- **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Aggiungi endpoint API personalizzati
- **[Cron Job](/docs/backend/cron-jobs)** — Attività in background programmate
- **[Branching del Database](/docs/backend/branching)** — Copie istantanee del database per dev/staging
- **[Distribuzione](/docs/getting-started/deployment)** — Portare il backend in produzione

---
