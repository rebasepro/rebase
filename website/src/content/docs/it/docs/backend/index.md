---
sourceHash: 21b1ae6712a17e38
title: Panoramica del backend
sidebar_label: Backend
description: Il backend di Rebase fornisce un server completo con API REST, autenticazione, storage, WebSocket in tempo reale e cronologia delle entità — tutto inizializzato con una singola chiamata di funzione.
---

## Panoramica

Il backend di Rebase è un **server Node.js** basato su [Hono](https://hono.dev/) che fornisce:

- **API REST** — Endpoint CRUD generati automaticamente per ciascuna collection
- **Autenticazione** — Token JWT, accesso tramite OAuth e OIDC, magic link, codici monouso, MFA, chiavi API, gestione di utenti/ruoli
- **Storage** — Caricamento/download di file con filesystem locale o S3
- **WebSocket** — Sincronizzazione dei dati in tempo reale tramite LISTEN/NOTIFY di PostgreSQL
- **Cronologia delle entità** — Audit trail per ogni modifica dei dati
- **Branching del database** — Copie del database istantanee e isolate per dev/staging/testing
- **Cron job** — Attività in background pianificate con dashboard di monitoraggio

Tutto viene inizializzato con una singola funzione:

:::note[Dove va inserito]
La chiamata sottostante è quella presente in un backend **ejected**, in `backend/src/index.ts`. Nel **runtime gestito** non esiste un file simile: il runtime effettua la chiamata e tu la configuri tramite variabili d'ambiente, le risorse dichiarate in `config/resources.ts` (`database()`, `bucket()`), e i due export letti da `config/index.ts` (`storageAuthorize`, `callbacks`). Ogni pagina di questa sezione specifica quale delle due modalità si applica all'opzione documentata, indicando quelle prive di una forma gestita. Se esporti un'opzione che il runtime non legge, verrà generato un avviso all'avvio anziché ignorarla silenziosamente; se ne esporti una sostituita da una dichiarazione di risorsa, l'avvio la rifiuterà indicandola per nome, insieme alla riga da scrivere in `config/resources.ts` al suo posto.
:::

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

## Dove risiede ciascuna opzione

Quella chiamata rappresenta la configurazione **ejected** — quella che scrivi tu stesso dopo `rebase eject` o in un server personalizzato. Un progetto scaffolded non la include: il runtime pubblicato avvia il progetto e ogni opzione viene fornita come variabile d'ambiente in `.env`, come export da `config/index.ts` o come directory dichiarata dal bundle in `rebase.json`.

Entrambi i percorsi fanno capo alla medesima `RebaseBackendConfig`. Ecco la mappa completa.

| Opzione | Runtime gestito |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (predefinito `/api`) |
| `collections`, `collectionsDir` | la directory `config/collections/`, dichiarata da `rebase.json` |
| `functionsDir` | `backend/functions/` |
| `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, più una dichiarazione `database("<key>")` in `config/resources.ts` per ogni database oltre a quello predefinito |
| `auth` | `JWT_SECRET`, le variabili `OAUTH_*` e `config/collections/users` |
| `storage` | le variabili `STORAGE_*`, più una dichiarazione `bucket("<key>")` in `config/resources.ts` per ogni bucket oltre a quello predefinito |
| `storageAuthorize` | `export const storageAuthorize` da `config/index.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `callbacks` | `export const callbacks` da `config/index.ts` |
| `history` | `REBASE_HISTORY` (attivo per impostazione predefinita) — solo in forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se non impostato, è attivo al di fuori della produzione |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulta [Processi separati](/docs/deployment/split-processes/) |
| `corsHandled` | CORS viene configurato dal runtime a partire da `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la build li include entrambi nel bundle |
| `app`, `server`, `provisioningDriverResult` | vengono creati dal runtime |

### Opzioni senza una controparte gestita

Queste opzioni non dispongono di una variabile d'ambiente né di un export di configurazione. Sono accessibili solo tramite una chiamata manuale a `initializeRebaseBackend` — dopo un `rebase eject` o in un [server personalizzato](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` · `functionsTimeoutMs` ·
`storagePolicies` · `storageTriggers` · `baas` · `liveSchema` · `rlsAudit` ·
`history` nella sua forma a oggetto (`{ retention }`)

`schemaEditor` è forzatamente disattivato in un bundle compilato: l'editor riscrive i file *sorgente* delle collection, mentre un bundle contiene solo l'output compilato.

## Cosa viene creato

Dopo l'inizializzazione, vengono montate queste route:

| Percorso | Scopo |
|------|---------|
| `/api/auth/*` | Autenticazione (registrazione, login, refresh, OAuth, magic link, codici monouso, MFA) |
| `/api/admin/*` | Gestione di utenti e ruoli (solo admin) |
| `/api/storage/*` | Caricamento, download ed eliminazione di file |
| `/api/data/:slug` | Operazioni CRUD per collection (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Cronologia delle modifiche delle entità (se abilitata) |
| `/api/docs` | Specifica OpenAPI (quando `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (modalità dev, quando `enableSwagger: true`) |
| `/api/meta/contract` | Lo schema delle collection del progetto (solo admin) |
| `/api/meta/schema-version` | Una stringa di versione per tale schema (non autenticato) |
| `/api/functions/*` | Route di funzioni personalizzate (quando `functionsDir` è impostato) |
| `/api/cron/*` | Gestione dei cron job (solo admin, quando `cronsDir` è impostato) |
| WebSocket su richiesta di upgrade | Sottoscrizioni in tempo reale |

---

## Il ciclo di vita dell'inizializzazione

Quando invochi `initializeRebaseBackend()`, il framework attiva una sequenza di avvio a 5 fasi:

```
[Start Boot]
     │
     ▼
1. ENV validation (Zod parsing of jwt, databases, cors)
     │
     ▼
2. Dynamic Collection Loading (Chokidar watches .ts files, AST parsing)
     │
     ▼
3. Database Bootstrapping (Acquires advisory lock, creates schemas/auth/helper SQL functions)
     │
     ▼
4. Service Initialization (Auth, Storage S3/Local client instances, Cron store seeding)
     │
     ▼
5. Route Mounting & Edge Loading (Hono controllers, custom functions, WebSocket binding)
     │
     ▼
[Boot Complete]
```

---

## Cosa succede quando l'avvio fallisce

**L'avvio fallisce in modo esplicito (loud failure).** Se il database non è raggiungibile, le credenziali sono errate o non è possibile applicare lo schema delle collection, `initializeRebaseBackend` genera un'eccezione, non viene servito nulla e il processo termina con il codice `1`. Non esiste una modalità degradata né un server parziale: un container che non riesce a raggiungere il proprio database si riavvia, e l'errore che ne ha causato l'interruzione sarà l'ultima voce nei suoi log.

Questo comportamento è intenzionale. Un server che si avvia gestendo l'accesso mentre ogni route `/api/data/*` fallisce è molto più difficile da diagnosticare rispetto a uno che non si avvia affatto — e un orchestratore può intervenire in caso di crash loop.

Prima della prima query, la fase di avvio verifica la connessione e stampa la diagnosi: l'host e la porta non raggiungibili, il motivo segnalato dal driver (`ECONNREFUSED`, `password authentication failed for user "app"`) e la soluzione. Consulta la sezione [Risoluzione dei problemi](/docs/troubleshooting/) per l'elenco dettagliato dei possibili errori.

### Una volta avviato: `/livez` e `/health`

Due probe che rispondono a due domande diverse.

| Percorso | Interroga il database | Risposta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` finché il processo è in esecuzione. Utilizzalo come liveness probe. |
| `/health` | Sì, ogni origine dati | `200 {"status":"ok"}` quando ogni origine dati configurata risponde; `503 {"status":"degraded"}` quando una di esse non risponde. Utilizzalo come readiness probe. |

Configurare una liveness probe su `/health` è un errore che vale la pena sottolineare: una temporanea indisponibilità del database spingerebbe l'orchestratore a terminare un processo altrimenti sano, trasformando un breve disservizio in un ciclo continuo di riavvii.

`/health` non richiede autenticazione, pertanto pubblica l'esito e non la motivazione — al di fuori dell'ambiente di sviluppo specifica quale origine dati è degradata e nient'altro. Il testo dell'errore restituito dal driver cita l'host, la porta, il nome del database e il ruolo, e viene inviato ai log. Entrambi i percorsi sono disponibili anche sotto `basePath` (`/api/health`).

---

## Riferimento di configurazione

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Collections
    collections?: CollectionConfig[];  // Your collection definitions
    collectionsDir?: string;  // Auto-load collections from a directory

    // Database adapter (PostgreSQL, SQLite, etc.)
    database?: DatabaseAdapter;

    // Authentication configuration or custom adapter
    auth?: RebaseAuthConfig | AuthAdapter;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;         // Auto-load cron jobs from a directory
    cronPersistence?: boolean; // Write run logs to rebase.cron_logs (default: true)

    // HTTP behaviour
    compression?: boolean;     // gzip/deflate for API responses (default: true)
    maxBodySize?: number;      // Request-body ceiling in bytes (default: 10MB; 0 disables)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Schema editing
    schemaEditor?: boolean;   // Force the schema-editor routes on or off

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Cinque di queste opzioni possono passare facilmente inosservate e modificano comportamenti che altrimenti potresti solo dedurre dall'osservazione:

| Chiave | Predefinito | Descrizione |
|---|---|---|
| `compression` | `true` | gzip/deflate sulle risposte dell'API, negoziato tramite `Accept-Encoding`. I corpi già compressi, in streaming e con `no-transform` non vengono modificati, quindi è sicuro mantenerlo attivo — una risposta JSON di grandi dimensioni si riduce tipicamente di circa 20 volte. Impostalo su `false` se nginx, Cloudflare o un altro reverse proxy a monte applica già la compressione, per evitare di eseguirla due volte. Variabile d'ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite massimo per i corpi delle richieste sulle route API; `0` lo disabilita. I caricamenti di storage utilizzano il valore `maxFileSize` (50MB) della configurazione dello storage, che ha la precedenza per tali route. Variabile d'ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | disattivato | **Opzionale (opt-in).** Un'API BaaS viene invocata da app mobile, SPA su domini differenti e strumenti CLI, nessuno dei quali invia un header `Origin` che una lista fissa accetterebbe — per questo non è attiva di default. Abilitala specificando le origini utilizzate dai tuoi client browser. Nessuna forma tramite variabili d'ambiente: esegui l'eject per configurarla. |
| `cronPersistence` | `true` | Determina se i log di esecuzione vengono scritti in `rebase.cron_logs`. `false` mantiene i job in esecuzione e la cronologia solo in memoria, che il pannello Studio perderà al riavvio. |
| `schemaEditor` | attivo fuori dalla produzione, quando `collectionsDir` è impostato | Forza l'attivazione o la disattivazione delle route dello schema editor. L'editor riscrive i file *sorgente* delle collection, pertanto necessita di una directory in cui scrivere — e un bundle compilato non ne ha alcuna, motivo per cui non è mai presente in ambiente di produzione. |

Il resto di `RebaseBackendConfig` è documentato nella rispettiva pagina dedicata (`auth`, `storage`, `jobs`, `callbacks`, `liveSchema`, `rlsAudit`) oppure è contrassegnato come `@internal`: `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` e `runtimeVersion` vengono valorizzati da `bootFromBundle` tramite l'ambiente, e passarli manualmente rischia di generare discrepanze con il runtime sulla natura del processo.

## L'istanza del backend

`initializeRebaseBackend` restituisce una `RebaseBackendInstance` che fornisce l'accesso ai servizi interni:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.auth?.roleService       // Role management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.collectionRegistry  // Collection metadata
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when cronsDir is set)
```

> **Nota:** Sebbene l'`instance` esponga questi servizi interni, il codice applicativo (come funzioni personalizzate e cron job) dovrebbe utilizzare il singleton globale `rebase` di `@rebasepro/server` per interagire con l'API del backend.

## API REST

L'API REST viene generata automaticamente a partire dalle tue collection. Ogni collection ottiene questi endpoint:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità — filtri, ordinamento, paginazione e ricerca sono gestiti tramite parametri di query |
| `GET` | `/api/data/:slug/count` | Numero di righe corrispondenti alla query |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opzionalmente raggruppati |
| `GET` | `/api/data/:slug/:id` | Recupera una singola entità |
| `POST` | `/api/data/:slug` | Crea una nuova entità |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna i campi inviati |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea più righe in una singola transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna più righe in una singola transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina più righe in una singola transazione |

### Parametri di query

Esiste una guida di riferimento dedicata per questi parametri. La pagina [API REST](/docs/backend/api/) illustra entrambi i dialetti di query accettati dal server — il formato stile PostgREST `?column=op.value` e il formato JSON `?where=` — insieme a `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e ricerca vettoriale. La pagina [Endpoint](/docs/backend/endpoints/) costituisce l'indice di tutte le route montate dal server, incluse quelle generate.

Un parametro non riservato dal server viene interpretato come un filtro sulla colonna con quel nome, quindi un parametro inesistente non genera un errore: semplicemente non produrrà alcun risultato.

## WebSocket

Il server WebSocket si aggancia al medesimo server HTTP e fornisce sottoscrizioni in tempo reale:

- Sottoscrizione alle **modifiche delle collection** — ricevi notifiche quando un'entità in una collection viene creata, aggiornata o eliminata
- Sottoscrizione alle **modifiche delle entità** — ricevi notifiche quando una specifica entità viene modificata
- Gestione automatica della **riconnessione** nell'SDK client

Il backend utilizza internamente `LISTEN/NOTIFY` di PostgreSQL. Per i deployment multi-istanza, specifica una `connectionString` nel tuo `PostgresBootstrapper` per abilitare la trasmissione (broadcasting) tra istanze.

## Gestione degli errori

Ogni errore — proveniente da qualsiasi route o sottosistema — viene restituito in un unico formato (envelope):

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Sempre presente | Descrizione |
|-------|:--------------:|------------|
| `message` | sì | Scritto per essere letto da una persona in console. Descrive l'ostacolo, non la regola. |
| `code` | sì | `SCREAMING_SNAKE_CASE` e stabile. È il campo su cui basare la logica condizionale. |
| `details` | no | Payload strutturato quando il rifiuto riguarda dettagli specifici — un elenco di percorsi non validi, un set di campi sconosciuti. |
| `requestId` | no | Presente se la richiesta ne conteneva uno o se gliene è stato assegnato uno; replica `X-Request-ID`. Da includere nelle segnalazioni di bug. |

Lo stato HTTP è presente nella risposta, non nel corpo. Gestisci la logica basandoti su `code` e non su `message` — i messaggi sono scritti per gli utenti e possono variare.

L'SDK client converte ciascuno di questi errori in un `RebaseApiError` contenente `status`, `code` e `details` — inclusi i fallimenti che non hanno mai raggiunto il server. Una connessione rifiutata, un errore DNS, problemi di CORS o un'interruzione (abort) vengono restituiti come `status: 0`, `code: "NETWORK_ERROR"`, con l'errore del runtime associato a `cause`, anziché con l'eccezione generica restituita da `fetch`. In questo modo il codice applicativo gestisce un'unica classe di errore:

```typescript
async function setPrice(id: string, price: number) {
    try {
        return await client.data.products.update(id, { price });
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

## Prossimi passi

- **[Autenticazione](/docs/backend/authentication)** — Provider JWT, OAuth e OIDC, MFA, chiavi API, gestione utenti
- **[Storage](/docs/backend/storage)** — Archiviazione file locale e S3
- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita e API `context.data`
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiungi endpoint API personalizzati
- **[Cron job](/docs/backend/cron-jobs)** — Attività pianificate in background
- **[Branching del database](/docs/backend/branching)** — Copie istantanee del database per dev/staging
- **[Deployment](/docs/getting-started/deployment)** — Porta il backend in produzione
