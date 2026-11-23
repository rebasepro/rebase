---
sourceHash: f3631ce64dd803f5
title: Panoramica del backend
sidebar_label: Backend
description: Il backend di Rebase fornisce un server completo con API REST, autenticazione, storage, WebSocket in tempo reale e cronologia delle entità — tutto inizializzato con una singola chiamata di funzione.
---

## Panoramica

Il backend di Rebase è un **server Node.js** basato su [Hono](https://hono.dev/) che fornisce:

- **REST API** — Endpoint CRUD generati automaticamente per ciascuna tabella
- **Authentication** — Token JWT, accesso OAuth e OIDC, magic link, codici monouso (OTP), MFA, chiavi API, gestione utenti/ruoli
- **Storage** — Upload/download di file con filesystem locale o S3
- **WebSocket** — Sincronizzazione dei dati in tempo reale tramite PostgreSQL LISTEN/NOTIFY
- **Entity History** — Audit trail per ogni modifica ai dati
- **Database Branching** — Copie del database istantanee e isolate per dev/staging/testing
- **Cron Jobs** — Attività in background pianificate con dashboard di monitoraggio

Tutto viene inizializzato con una singola funzione:

:::note[Dove va inserito questo]
La chiamata sottostante è ciò che contiene un backend **ejected**, in `backend/src/index.ts`. Nel **runtime gestito** non esiste alcun file simile: è il runtime a effettuare la chiamata, e lo si configura tramite variabili d'ambiente, le tabelle esportate da `backend/schema/index.ts`, le risorse dichiarate in `backend/resources.ts` (`database()`, `bucket()`), e due esportazioni che esso legge: `storageAuthorize` da `backend/storage.ts` e `hooks` da `backend/hooks.ts`. Ciascuna pagina di questa sezione specifica quale delle due modalità si applica all'opzione documentata e indica quelle che non hanno una forma gestita. Se si esporta qualsiasi altra cosa da questi due moduli, il runtime mostrerà un avviso all'avvio anziché ignorarla silenziosamente; se si esporta un elemento sostituito da una dichiarazione di risorsa, l'avvio lo rifiuterà indicandone il nome, insieme alla riga da inserire in `backend/resources.ts`.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import path from "node:path";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    schemaDir: path.resolve(__dirname, "../schema"),
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true
});
```

Quella singola chiamata è una scorciatoia rispetto a passaggi pubblici distinti: `installUnhandledRejectionHandler` evita che una rejection non gestita interrompa il processo, `createRebaseBackend` crea il backend, `setDefaultBackend` lo imposta come istanza a cui risponde l'API a livello di modulo, mentre `mount`, `attachRealtime` e `start` lo servono. Per montare solo alcuni gruppi di route, posizionarli su percorsi diversi, demandare i timer a un altro processo o eseguire due backend in un unico processo, è possibile richiamare i passaggi manualmente. Consulta [Custom Server Integration](/docs/backend/custom-server/).

## Dove risiede ciascuna opzione

Quella chiamata rappresenta la forma **ejected** — quella che scrivi manualmente dopo `rebase eject`, o all'interno di un server personalizzato. Un progetto generato tramite scaffolding non la possiede: è il runtime pubblicato ad avviare il progetto, e ciascuna opzione viene fornita come variabile d'ambiente in `.env`, come export da `backend/storage.ts` o `backend/hooks.ts`, o come directory dichiarata dal bundle in `rebase.json`.

Entrambi i percorsi confluiscono nella stessa `RebaseBackendConfig`. Ecco la mappa completa.

| Opzione | Runtime gestito |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (default `/api`) |
| `tables`, `schemaDir`, `defaultRls` | la directory `backend/schema/` (la chiave `tables` di `rebase.json`): le tabelle e il `defaultRls` esportati dal relativo `index.ts` |
| `rpc` | le dichiarazioni `defineRpc` esportate da `backend/schema/index.ts` — vedi [SQL functions as RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, più una dichiarazione `database("<key>")` in `backend/resources.ts` per ogni database oltre a quello predefinito |
| `auth` | `JWT_SECRET`, le variabili `OAUTH_*` e la tabella dichiarata da `backend/schema` con `defineAuthTable` |
| `storage` | le variabili `STORAGE_*`, più una dichiarazione `bucket("<key>")` in `backend/resources.ts` per ogni bucket oltre a quello predefinito |
| `storageAuthorize` | `export const storageAuthorize` da `backend/storage.ts` |
| `storagePolicies` | `STORAGE_POLICIES`, come regole JSON — vedi [Autorizzazione dello storage](/docs/backend/storage-authorization/#as-data-storage_policies) |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` da `backend/hooks.ts` — hook globali delle tabelle |
| `history` | `REBASE_HISTORY` (attivo per impostazione predefinita) — solo forma booleana |
| `push` | `REBASE_PUSH`, con `REBASE_VAPID_*` per le chiavi — solo forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se non impostato serve `/api/docs` al pubblico dell'endpoint dello schema, `true` lo pubblica con la Swagger UI, `false` lo mantiene protetto dietro il controllo admin |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e le relative credenziali `REBASE_LIVE_SCHEMA_*` — solo forma repository |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — vedi [Split Processes](/docs/deployment/split-processes/) |
| `corsHandled` | CORS viene installato dal runtime a partire da `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la build inserisce entrambi nel bundle |
| `app`, `server`, `provisioningDriverResult` | vengono creati dal runtime |

### Opzioni senza route gestita

Queste opzioni non dispongono di una variabile d'ambiente né di un export di modulo. Sono accessibili solo da una chiamata manuale a `initializeRebaseBackend` — tramite `rebase eject` o in un [server personalizzato](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` nella sua forma a oggetto (`{ retention }`) ·
`push` nella sua forma a oggetto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` è disattivato forzatamente in un bundle compilato: l'editor riscrive i file *sorgente* in `backend/schema`, mentre un bundle contiene output compilato.

## Elementi creati

Dopo l'inizializzazione, vengono montate queste route:

| Percorso | Scopo |
|------|---------|
| `/api/auth/*` | Autenticazione (registrazione, login, refresh, OAuth, magic link, codici monouso, MFA) |
| `/api/admin/*` | Utenti, ruoli, chiavi di servizio, cron, backup, log e schema, ciascuno protetto dal proprio [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Upload, download ed eliminazione di file |
| `/api/data/:slug` | Operazioni CRUD per tabella (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Cronologia delle modifiche dell'entità (quando abilitata) |
| `/api/docs` | Specifica OpenAPI delle tabelle visibili al chiamante (pubblica con `enableSwagger: true`; solo per admin con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, solo al di fuori dell'ambiente di produzione) |
| `/api/schema/tables` | Le tabelle servite da questo backend, come possono essere visualizzate dal chiamante — vedi [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versione dello schema, il runtime e ogni tabella così come visti da un amministratore (richiede `schema:read`) |
| `/api/meta/schema-version` | Stringa di versione per tale schema (non autenticata) |
| `/api/rpc/:name` | Le funzioni SQL dichiarate con `defineRpc`, richiamate con l'identità del chiamante — vedi [SQL functions as RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Route di funzioni personalizzate (quando `functions` o `functionsDir` è impostato) |
| `/api/push/*` | Iscrizioni alle [notifiche push](/docs/backend/push-notifications/) (quando `push` è abilitato) |
| `/api/admin/cron/*` | Gestione dei cron job (`cron:read` / `cron:write`, quando `crons` o `cronsDir` è impostato) |
| WebSocket on upgrade | Sottoscrizioni in tempo reale, su `/` per un'API su `/api` |

---

## Il ciclo di vita dell'inizializzazione

Quando si invoca `initializeRebaseBackend()`, il framework avvia una sequenza di boot a 5 fasi in ordine sequenziale:

```
[Start Boot]
     │
     ▼
1. Configuration (the database adapter, the auth and storage options you passed)
     │
     ▼
2. Schema Loading (imports backend/schema/index.ts, compiles every table — a problem in any refuses the boot)
     │
     ▼
3. Database Bootstrapping (creates schemas/auth/helper SQL functions, as `provision` allows)
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

## Cosa succede se l'avvio fallisce

**L'avvio fallisce in modo esplicito (loudly).** Se il database non è raggiungibile, le credenziali sono errate, o lo schema non può essere compilato o applicato, `initializeRebaseBackend` genera un'eccezione, non viene servito nulla e il processo termina con codice di uscita `1`. Non esistono modalità degradate né server parziali: un container che non riesce a raggiungere il proprio database si riavvia, e l'errore che ne ha causato l'arresto è l'ultima riga nei suoi log.

È una scelta deliberata. Un server che si avvia rispondendo alle richieste di autenticazione mentre ogni route `/api/data/*` fallisce è molto più difficile da diagnosticare rispetto a uno che non si avvia affatto — e un orchestratore può intervenire tempestivamente di fronte a un crash loop.

Prima della prima query, la fase di boot verifica la connessione e stampa la diagnosi: l'host e la porta non raggiungibili, la motivazione fornita dal driver stesso (`ECONNREFUSED`, `password authentication failed for user "app"`) e la soluzione. Consulta [Troubleshooting](/docs/troubleshooting/) per l'elenco dettagliato degli errori.

### Una volta in esecuzione: `/livez` e `/health`

Due probe che rispondono a due domande diverse.

| Percorso | Interroga il database | Risposta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` finché il processo è in esecuzione. Da utilizzare come liveness probe. |
| `/health` | Sì, ogni origine dati | `200 {"status":"ok"}` quando ogni origine dati configurata risponde; `503 {"status":"degraded"}` quando una di esse non lo fa. Da utilizzare come readiness probe. |

Configurare un liveness probe su `/health` è un errore che vale la pena segnalare: un'interruzione momentanea del database indurrebbe l'orchestratore a terminare un processo altrimenti sano, trasformando un breve disservizio in un restart loop.

`/health` non richiede autenticazione, pertanto pubblica l'esito finale e non la causa — al di fuori dell'ambiente di sviluppo si limita a indicare quale origine dati è degradata e nient'altro. Il testo dell'errore restituito dal driver cita host, porta, nome del database e ruolo, e tale informazione viene registrata nei log. Inoltre, `/health` viene servito anche sotto `basePath` (`/api/health`), mentre `/livez` no.

Entrambi i probe appartengono al runtime gestito. Una versione ejected in `backend/src/index.ts` serve autonomamente `/health` e `/api/health`, verificando unicamente il database predefinito, e non dispone di `/livez` a meno che non venga aggiunto manualmente.

---

## Riferimento della configurazione

L'opzione `rpc` sottostante.

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Tables
    tables?: (AnyTableDef | AnyViewDef)[]; // defineTable / defineAuthTable / defineView results
    defaultRls?: DefaultRls;  // What `rls: "inherit"` tables take, when you pass `tables`
    schemaDir?: string;       // The backend/schema directory: loaded when `tables` is absent, and what the schema editor writes
    hooks?: TableHooks;       // Global table hooks, run for every table

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

    // SQL functions served at /api/rpc/<name> (defineRpc). Read from the
    // schemaDir index when the tables are; pass them as values otherwise.
    rpc?: AnyRpcDef[];

    // Custom API endpoints: values, or a directory of files (not both)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks: values, or a directory of files (not both)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
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

Cinque di queste opzioni possono passare facilmente inosservate e modificano comportamenti altrimenti solo osservabili:

| Chiave | Valore predefinito | Cosa fa |
|---|---|---|
| `compression` | `true` | gzip/deflate sulle risposte API, negoziato tramite `Accept-Encoding`. I corpi già compressi, in streaming e con intestazione `no-transform` vengono ignorati, così come i corpi inferiori a 1 KB (gzip costa più di quanto risparmi in questi casi), quindi è sicuro lasciarlo attivo — un payload JSON di grandi dimensioni si riduce tipicamente di circa 20 volte. Impostalo a `false` se nginx, Cloudflare o un altro proxy a monte esegue già la compressione, per evitare un doppio overhead. Variabile d'ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite massimo per il corpo delle richieste sulle route API; `0` lo disabilita. I caricamenti nello storage utilizzano il valore `maxFileSize` (50MB) proprio della configurazione di storage, che ha la precedenza per tali route. Variabile d'ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | off | **Opt-in.** Un'API BaaS viene chiamata da app mobili, SPA su altri domini e strumenti CLI, nessuno dei quali invia un'intestazione `Origin` accettabile da un elenco fisso — pertanto questa opzione non è attiva per impostazione predefinita. Abilitala specificando le origini utilizzate dai tuoi client browser. Nessuna forma tramite variabile d'ambiente: effettua l'eject per configurarla. |
| `cronPersistence` | `true` | Determina se i log di esecuzione vengono salvati in `rebase.cron_logs`. Con `false`, i job continuano a essere eseguiti ma la cronologia rimane solo in memoria, venendo quindi persa dal pannello di Studio al riavvio. |
| `schemaEditor` | attivo fuori dalla produzione, quando `schemaDir` è impostato | Forza l'attivazione o la disattivazione delle route dell'editor di schema. L'editor riscrive i *file sorgente* di `backend/schema`, pertanto necessita di una directory su cui scrivere — e un bundle compilato non ne possiede alcuna, motivo per cui non è mai presente in fase di deployment. |

Il resto di `RebaseBackendConfig` è documentato nella rispettiva pagina dedicata (`auth`, `storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) o contrassegnato come `@internal`: `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` e `runtimeVersion` vengono compilati da `bootFromBundle` a partire dall'ambiente, e passarli manualmente rischia di generare discrepanze con il runtime su quale sia il ruolo del processo.

## L'istanza del backend

`initializeRebaseBackend` restituisce il backend appena creato, già montato e avviato. Il suo tipo è `RebaseBackendInstance`, che corrisponde a `RebaseBackend`, il tipo restituito da `createRebaseBackend`:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.getTableDescriptors() // The compiled tables, as GET /api/schema/tables serves them
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when crons or cronsDir is set)
instance.jobQueue            // Durable job queue (when jobs are enabled)
instance.setTableHooks(slug, hooks) // Replace a table's hooks
instance.shutdown()          // Drain and stop; also closes the server it was given
```

Include inoltre `rebase`, il client in-process, `fetch(request)`, `routes`, i gruppi di route come sotto-applicazioni Hono, `services`, le relative chiavi JWT, modello di accesso, archivio delle chiavi API e rate limiter, nonché `verifyCredential(token)`; vedi [Custom Server Integration](/docs/backend/custom-server/).

> **Nota:** Sebbene l'`instance` esponga questi servizi interni, il codice applicativo (come funzioni personalizzate e cron job) dovrebbe utilizzare il singleton `rebase` di `@rebasepro/server` per interagire con l'API del backend. All'interno di una richiesta, dell'esecuzione di un cron o di un job, `rebase` rappresenta il backend che lo sta servendo; altrove rappresenta l'impostazione predefinita del processo, che `initializeRebaseBackend` assegna al proprio backend.

## API REST

L'API REST viene generata a partire dalle tue tabelle. Ciascuna tabella riceve questi endpoint:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità — filtri, ordinamento, paginazione e ricerca sono parametri di query |
| `GET` | `/api/data/:slug/count` | Quante righe corrispondono alla medesima query |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opzionalmente raggruppati |
| `GET` | `/api/data/:slug/:id` | Recupera una singola entità |
| `POST` | `/api/data/:slug` | Crea una nuova entità |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna i campi inviati |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea più righe in una singola transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna più righe in una singola transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina più righe in una singola transazione |

### Parametri di query

Esiste una guida di riferimento dedicata a essi e non è questa pagina. [REST API](/docs/backend/api/) documenta entrambi i dialetti di query accettati dal server — il formato in stile PostgREST `?column=op.value` e il formato JSON `?where=` — insieme a `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e la ricerca vettoriale. [Endpoints](/docs/backend/endpoints/) rappresenta l'indice di ogni route montata dal server, comprese quelle generate.

Un parametro non riservato dal server viene interpretato come filtro sulla colonna con quel nome, perciò un parametro inesistente non genera errori: semplicemente non corrisponderà a nulla in modo silente.

## WebSocket

Il server WebSocket si aggancia allo stesso server HTTP e fornisce sottoscrizioni in tempo reale. Risponde alle richieste di upgrade su un unico percorso, `/` per un'API su `/api`, al quale si collega l'SDK, lasciando qualsiasi altro percorso ai tuoi listener di `upgrade` personalizzati:

- Iscrizione alle **modifiche delle tabelle** — ricevi notifiche quando qualsiasi riga di una tabella viene creata, aggiornata o eliminata
- Iscrizione alle **modifiche delle righe** — ricevi notifiche quando una riga specifica subisce modifiche
- Gestione automatica della **riconnessione** nell'SDK tipizzato

Il backend utilizza internamente il meccanismo `LISTEN/NOTIFY` di PostgreSQL. Per i deployment multi-istanza, fornisci una `connectionString` nel tuo `PostgresBootstrapper` per abilitare il broadcasting tra le diverse istanze.

## Gestione degli errori

Ogni errore — proveniente da qualsiasi route, in qualunque sottosistema — viene restituito all'interno di un unico envelope standard:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Sempre presente | Cos'è |
|-------|:--------------:|------------|
| `message` | sì | Scritto per un operatore umano che legge una console. Indica l'ostacolo riscontrato, non la regola violata. |
| `code` | sì | `SCREAMING_SNAKE_CASE` e stabile. Questo è il campo da utilizzare per la logica di branching. |
| `details` | no | Payload strutturato presente quando il rifiuto riguarda un elemento specifico — un elenco di percorsi errati, un insieme di campi sconosciuti. |
| `requestId` | no | Presente quando la richiesta ne conteneva uno o ne è stato assegnato uno; replica l'intestazione `X-Request-ID`. Da citare nelle segnalazioni di bug. |

Lo stato HTTP si trova sulla risposta, non all'interno del corpo. Gestisci le diramazioni logiche in base a `code`, non a `message` — i messaggi sono scritti per gli utenti e possono variare.

L'SDK tipizzato trasforma ognuno di questi errori in un `RebaseApiError` contenente `status`, `code` e `details` — inclusi i fallimenti che non hanno mai raggiunto il server. Una connessione rifiutata, un errore DNS, CORS o una richiesta interrotta arrivano come `status: 0`, `code: "NETWORK_ERROR"`, con l'errore del runtime associato a `cause`, anziché con qualsiasi errore casuale con cui `fetch` avrebbe rifiutato la promessa. Una risposta priva di envelope — un errore 413 generato da un proxy, un 502 da un load balancer — ottiene comunque un `code` derivato dal proprio stato (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e un client inizializzato all'esterno del browser senza `baseUrl` fallisce con `BASE_URL_REQUIRED` anziché con un errore di rete. Una lettura che ha esito positivo ma senza la struttura prevista — un `204`, un body vuoto, una pagina senza l'elenco `data` — fallisce con `UNEXPECTED_RESPONSE` invece di risolversi come "nessuna riga", e i metodi `createMany`, `updateMany`, `deleteMany` o `batch` a cui viene passato qualcosa di diverso da un array falliscono con `INVALID_BULK_BODY`, lo stesso codice utilizzato dal server per questo errore. Di conseguenza, il codice applicativo intercetta una sola classe:

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

- **[Autenticazione](/docs/backend/authentication)** — JWT, provider OAuth e OIDC, MFA, chiavi API, gestione utenti
- **[Storage](/docs/backend/storage)** — Archiviazione file locale e su S3
- **[Hook di tabella](/docs/collections/callbacks)** — Hook del ciclo di vita e API `context.data`
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiunta di endpoint API personalizzati
- **[SQL functions as RPC](/docs/backend/rpc)** — Esecuzione di una funzione Postgres su `/api/rpc/<name>`, con l'identità del chiamante
- **[Cron Jobs](/docs/backend/cron-jobs)** — Attività pianificate in background
- **[Database Branching](/docs/backend/branching)** — Copie istantanee del database per dev/staging
- **[Deployment](/docs/getting-started/deployment)** — Distribuzione del backend in produzione
