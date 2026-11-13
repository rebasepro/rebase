---
sourceHash: 9be8187c5259c1dd
title: Panoramica del backend
sidebar_label: Backend
description: Il backend di Rebase fornisce un server completo con API REST, autenticazione, storage, WebSocket in tempo reale e cronologia delle entità — tutto inizializzato con una singola chiamata di funzione.
---

## Panoramica

Il backend di Rebase è un **server Node.js** basato su [Hono](https://hono.dev/) che fornisce:

- **API REST** — Endpoint CRUD generati automaticamente per ciascuna tabella
- **Autenticazione** — Token JWT, accesso OAuth e OIDC, magic link, codici monouso (OTP), MFA, chiavi API, gestione di utenti e ruoli
- **Storage** — Caricamento/download di file con filesystem locale o S3
- **WebSocket** — Sincronizzazione dei dati in tempo reale tramite LISTEN/NOTIFY di PostgreSQL
- **Cronologia delle entità** — Traccia di controllo (audit trail) per ogni modifica ai dati
- **Branching del database** — Copie istantanee e isolate del database per dev/staging/testing
- **Cron Job** — Attività in background pianificate con dashboard di monitoraggio

Tutto viene inizializzato con una singola funzione:

:::note[Dove va inserito]
La chiamata sottostante è quella presente in un backend **ejected**, in `backend/src/index.ts`. Nel
**runtime gestito** tale file non esiste: il runtime esegue la chiamata e
lo si configura tramite variabili d'ambiente, le tabelle esportate da `backend/schema/index.ts`,
le risorse dichiarate in `backend/resources.ts` (`database()`,
`bucket()`), e due export che legge: `storageAuthorize` da
`backend/storage.ts` e `hooks` da `backend/hooks.ts`. Ciascuna pagina in questa
sezione specifica quale dei due casi si applica all'opzione documentata, e indica
quelle che non hanno una forma gestita. Se si esporta qualsiasi altra cosa da questi due moduli,
il runtime avvisa all'avvio invece di ignorarla in silenzio; se si esporta un elemento
sostituito da una dichiarazione di risorsa, l'avvio lo rifiuterà indicandone il nome, insieme alla
riga da inserire in `backend/resources.ts`.
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

Quella singola chiamata è
una scorciatoia per passaggi pubblici: `installUnhandledRejectionHandler` impedisce a un
rejection isolato di terminare il processo, `createRebaseBackend` costruisce il backend,
`setDefaultBackend` lo imposta come quello a cui risponde l'API a livello di modulo, e
`mount`, `attachRealtime` e `start` lo servono. Per montare solo alcuni gruppi di route,
collocarli su altri percorsi, delegare i timer a un altro processo, o eseguire
due backend in un unico processo, esegui i passaggi manualmente. Consulta
[Custom Server Integration](/docs/backend/custom-server/).

## Dove risiede ciascuna opzione

<span class="since-badge" data-since="0.31">Since 0.31</span>

Quella chiamata rappresenta la configurazione **ejected** — quella che scrivi manualmente dopo `rebase
eject`, o in un server personalizzato. Un progetto generato tramite scaffolding non la possiede: il
runtime distribuito avvia il progetto e ogni opzione viene fornita come variabile
d'ambiente in `.env`, come export da `backend/storage.ts` o `backend/hooks.ts`,
oppure come directory dichiarata dal bundle in `rebase.json`.

Entrambi i percorsi raggiungono la stessa `RebaseBackendConfig`. Ecco la mappa completa.

| Opzione | Runtime gestito |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (predefinito `/api`) |
| `tables`, `schemaDir`, `defaultRls` | la directory `backend/schema/` (la chiave `tables` di `rebase.json`): le tabelle e il `defaultRls` esportati dal suo `index.ts` |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, più una dichiarazione `database("<key>")` in `backend/resources.ts` per ogni database oltre a quello predefinito |
| `auth` | `JWT_SECRET`, le variabili `OAUTH_*`, e la tabella dichiarata da `backend/schema` con `defineAuthTable` |
| `storage` | le variabili `STORAGE_*`, più una dichiarazione `bucket("<key>")` in `backend/resources.ts` per ogni bucket oltre a quello predefinito |
| `storageAuthorize` | `export const storageAuthorize` da `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` da `backend/hooks.ts` — hook di tabella globali |
| `history` | `REBASE_HISTORY` (attivo per impostazione predefinita) — solo in forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se non impostato serve `/api/docs` al pubblico dell'endpoint di schema, `true` lo pubblica con Swagger UI, `false` lo mantiene protetto da gate di amministrazione |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e le relative credenziali `REBASE_LIVE_SCHEMA_*` — solo nella forma a repository |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulta [Split Processes](/docs/deployment/split-processes/) |
| `corsHandled` | Il CORS viene installato dal runtime a partire da `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la build li inserisce entrambi nel bundle |
| `app`, `server`, `provisioningDriverResult` | vengono creati dal runtime |

### Opzioni senza percorso gestito

<span class="since-badge" data-since="0.31">Since 0.31</span>

Queste opzioni non dispongono di una variabile d'ambiente né di un export di modulo. Sono accessibili
soltanto tramite una chiamata manuale a `initializeRebaseBackend` — `rebase eject`, o un
[server personalizzato](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` nella sua forma ad oggetto (`{ retention }`)

`schemaEditor` è disattivato forzatamente in un bundle compilato: l'editor riscrive i
file *sorgente* di `backend/schema`, mentre un bundle contiene l'output compilato.

## Cosa viene creato

Dopo l'inizializzazione, vengono montate queste route:

| Percorso | Scopo |
|------|---------|
| `/api/auth/*` | Autenticazione (registrazione, login, refresh, OAuth, magic link, codici monouso, MFA) |
| `/api/admin/*` | Utenti, ruoli, chiavi di servizio, cron, backup, log e schema, ciascuno protetto dal proprio [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Caricamento, download ed eliminazione di file |
| `/api/data/:slug` | Operazioni CRUD per tabella (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Cronologia delle modifiche dell'entità (se abilitata) |
| `/api/docs` | Specifica OpenAPI delle tabelle visibili al chiamante (pubblica con `enableSwagger: true`; solo per amministratori con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, solo al di fuori dell'ambiente di produzione) |
| `/api/schema/tables` | Le tabelle servite da questo backend, come visibili al chiamante — consulta [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versione dello schema, il runtime e ogni tabella così come visti da un amministratore (richiede `schema:read`) |
| `/api/meta/schema-version` | Una stringa di versione per tale schema (non autenticato) |
| `/api/functions/*` | Route per funzioni personalizzate (quando `functions` o `functionsDir` è impostato) |
| `/api/admin/cron/*` | Gestione dei cron job (`cron:read` / `cron:write`, quando `crons` o `cronsDir` è impostato) |
| WebSocket on upgrade | Sottoscrizioni in tempo reale, su `/` per un'API su `/api` |

---

## Il ciclo di vita dell'inizializzazione

<span class="since-badge" data-since="0.31">Since 0.31</span>

Quando invochi `initializeRebaseBackend()`, il framework avvia una sequenza di boot sequenziale a 5 fasi:

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

## Cosa succede se il boot fallisce

**Il boot fallisce in modo esplicito.** Se il database non è raggiungibile, le credenziali sono
errate o lo schema non può essere compilato o applicato, `initializeRebaseBackend`
genera un'eccezione, non viene servito nulla e il processo termina con codice `1`. Non esiste una modalità degradata
né un server parziale: un container che non riesce a raggiungere il proprio database si riavvia e
l'errore che ne ha causato l'interruzione è l'ultima voce presente nei suoi log.

Questa scelta è intenzionale. Un server che si avvia gestendo il sign-in mentre ogni
route `/api/data/*` fallisce è molto più difficile da diagnosticare rispetto a uno che non si avvia
affatto — e un orchestratore può intervenire in caso di crash loop.

Prima della prima query, la procedura di boot testa la connessione e visualizza la diagnosi:
l'host e la porta non raggiungibili, la motivazione restituita dal driver (`ECONNREFUSED`,
`password authentication failed for user "app"`) e la soluzione. Consulta
[Troubleshooting](/docs/troubleshooting/) per l'elenco dettagliato dei possibili errori.

### Una volta in funzione: `/livez` e `/health`

Due probe che rispondono a due domande diverse.

| Percorso | Interroga il database | Risponde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` finché il processo è in esecuzione. Utilizzalo come liveness probe. |
| `/health` | Sì, ogni origine dati | `200 {"status":"ok"}` quando ogni origine dati configurata risponde; `503 {"status":"degraded"}` quando una di esse non risponde. Utilizzalo come readiness probe. |

Impostare un liveness probe su `/health` è un errore da evitare: un problema temporaneo del database
porterebbe l'orchestratore a terminare un processo altrimenti sano, trasformando un breve disservizio
in un loop di riavvii.

`/health` non richiede autenticazione, pertanto pubblica l'esito e non la causa —
al di fuori dell'ambiente di sviluppo indica quale origine dati è degradata e nient'altro. Il
testo dell'errore del driver include host, porta, nome del database e ruolo, e viene inviato
ai log. `/health` viene servito anche sotto `basePath` (`/api/health`);
`/livez` no.

Entrambi i probe appartengono al runtime gestito. Una versione ejected in `backend/src/index.ts` serve
`/health` e `/api/health` autonomamente, testando solo il database predefinito, e non include
alcun `/livez` fino a quando non ne viene aggiunto uno.

---

## Riferimento di configurazione

<span class="since-badge" data-since="0.31">Since 0.31</span>

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

Cinque di queste opzioni passano facilmente inosservate e modificano comportamenti altrimenti solo
rilevabili:

| Chiave | Predefinito | Cosa fa |
|---|---|---|
| `compression` | `true` | gzip/deflate sulle risposte API, negoziato tramite `Accept-Encoding`. I corpi già compressi, in streaming e `no-transform` vengono lasciati invariati, così come i corpi inferiori a 1 KB (dove il costo di gzip supera il risparmio), per cui è sicuro lasciarlo attivo — un elenco JSON di grandi dimensioni si riduce tipicamente di circa 20 volte. Imposta su `false` quando nginx, Cloudflare o un altro proxy a monte esegue già la compressione, per evitare di pagarla due volte. Variabile d'ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite massimo per il corpo delle richieste sulle route API; `0` lo disabilita. I caricamenti di storage utilizzano il valore `maxFileSize` della configurazione di storage (50MB), che ha la precedenza per quelle route. Variabile d'ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | off | **Opzionale (opt-in).** Un'API BaaS viene chiamata da app mobile, SPA su altri domini e strumenti CLI, nessuno dei quali invia un `Origin` accettabile da un elenco fisso — pertanto questa opzione non è attiva per impostazione predefinita. Attivala specificando le origini utilizzate dai tuoi client browser. Nessuna forma tramite variabile d'ambiente: esegui l'eject per configurarla. |
| `cronPersistence` | `true` | Determina se i log di esecuzione vengono salvati in `rebase.cron_logs`. `false` mantiene i job in esecuzione e la cronologia solo in memoria, che il pannello di Studio perderà al riavvio. |
| `schemaEditor` | on outside production, when `schemaDir` is set | Forza l'attivazione o la disattivazione delle route dello schema editor. L'editor riscrive i *file sorgente* in `backend/schema`, pertanto necessita di una directory in cui scrivere — e un bundle compilato non ne ha alcuna, motivo per cui un deployment non lo include mai. |

Il resto di `RebaseBackendConfig` è documentato nella rispettiva pagina dedicata (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) oppure contrassegnato come `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` vengono compilati da
`bootFromBundle` a partire dall'ambiente, e passarli manualmente è un modo per
entrare in conflitto con il runtime su cosa sia questo processo.

## L'istanza del backend

`initializeRebaseBackend` restituisce il backend appena compilato, già montato e
avviato. Il suo tipo è `RebaseBackendInstance`, ovvero `RebaseBackend`, il
tipo restituito da `createRebaseBackend`:

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

Contiene inoltre
`rebase`, il client in-process, `fetch(request)`, `routes`, i gruppi di route
sotto forma di sub-app Hono, `services`, le proprie chiavi JWT, il modello di accesso, lo store delle chiavi API e
i rate limiter, oltre a `verifyCredential(token)`; consulta
[Custom Server Integration](/docs/backend/custom-server/).

> **Nota:** Sebbene l'`instance` esponga questi servizi interni, il codice applicativo (come funzioni personalizzate e cron job) dovrebbe utilizzare il singleton `rebase` di `@rebasepro/server` per interagire con l'API del backend. All'interno di una richiesta, di un'esecuzione cron o di un job, `rebase` rappresenta il backend che la gestisce; altrove è l'impostazione predefinita del processo, che `initializeRebaseBackend` imposta sul proprio backend.

## API REST

L'API REST viene generata a partire dalle tue tabelle. Ciascuna tabella ottiene questi endpoint:

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

Esiste un unico riferimento per questi parametri e non è questa pagina. [REST
API](/docs/backend/api/) documenta entrambi i dialetti di query accettati dal server — il
formato in stile PostgREST `?column=op.value` e il formato JSON `?where=` — insieme a
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e la ricerca
vettoriale. [Endpoints](/docs/backend/endpoints/) è l'indice di ogni route montata dal
server, incluse quelle generate.

Un parametro non riservato dal server viene interpretato come filtro sulla colonna con
quel nome, pertanto un parametro inesistente non genera errori: semplicemente non restituirà alcuna corrispondenza.

## WebSocket

Il server WebSocket si collega allo stesso server HTTP e fornisce sottoscrizioni in tempo reale. Risponde alle richieste di upgrade su un unico percorso, `/` per un'API su `/api`, a cui l'SDK si connette, lasciando qualsiasi altro percorso ai tuoi listener di `upgrade`:

- Sottoscrizione alle **modifiche delle tabelle** — ricevi notifiche quando una riga qualsiasi in una tabella viene creata, aggiornata o eliminata
- Sottoscrizione alle **modifiche delle righe** — ricevi notifiche quando una riga specifica cambia
- Gestione automatica della **riconnessione** nell'SDK tipizzato

Il backend utilizza internamente `LISTEN/NOTIFY` di PostgreSQL. Per i deployment multi-istanza, fornisci una `connectionString` nel tuo `PostgresBootstrapper` per abilitare il broadcasting tra le istanze.

## Gestione degli errori

Ogni errore — proveniente da qualsiasi route, in qualsiasi sottosistema — viene restituito all'interno di un unico envelope:

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
| `message` | sì | Scritto per una persona che legge una console. Indica l'ostacolo, non la regola. |
| `code` | sì | In formato `SCREAMING_SNAKE_CASE` e stabile. Questo è il campo da utilizzare per la logica di branching. |
| `details` | no | Payload strutturato quando il rifiuto riguarda qualcosa nello specifico — un elenco di percorsi errati, un set di campi sconosciuti. |
| `requestId` | no | Presente quando la richiesta ne includeva uno o ne è stato assegnato uno; replica `X-Request-ID`. Riportalo nelle segnalazioni di bug. |

Lo status HTTP si trova sulla risposta, non nel corpo. Esegui il branching su `code`, non su
`message` — i messaggi sono scritti per gli esseri umani e possono variare.

L'SDK tipizzato trasforma ciascuno di questi in un `RebaseApiError` contenente
`status`, `code` e `details` — inclusi i fallimenti che non hanno mai raggiunto il
server. Una connessione rifiutata, un errore DNS, CORS o un'interruzione (abort) arrivano come
`status: 0`, `code: "NETWORK_ERROR"`, con l'errore del runtime stesso in `cause`,
anziché con qualsiasi errore generico con cui `fetch` avrebbe rifiutato la promessa. Una risposta priva di
envelope — un errore 413 di un proxy, un 502 di un load balancer — ottiene comunque un `code` dal relativo
status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e un
client creato all'esterno del browser senza `baseUrl` fallisce con
`BASE_URL_REQUIRED` anziché con un errore di rete.
Una lettura che riceve una risposta di successo
ma priva della struttura attesa — un `204`, un body vuoto, una pagina priva della lista
`data` — fallisce con `UNEXPECTED_RESPONSE` invece di risolversi come "nessuna riga", e
l'invio a `createMany`, `updateMany`, `deleteMany` o `batch` di qualcosa di diverso da
un array fallisce con `INVALID_BULK_BODY`, lo stesso codice utilizzato dal server per tale
errore. In questo modo il codice applicativo intercetta una sola classe:

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

## Passaggi successivi

- **[Authentication](/docs/backend/authentication)** — JWT, provider OAuth e OIDC, MFA, chiavi API, gestione utenti
- **[Storage](/docs/backend/storage)** — Archiviazione file locale e su S3
- **[Table hooks](/docs/collections/callbacks)** — Hook del ciclo di vita e API `context.data`
- **[Entity History](/docs/backend/history)** — Traccia di controllo (audit trail)
- **[Custom Functions](/docs/backend/custom-functions)** — Aggiunta di endpoint API personalizzati
- **[Cron Jobs](/docs/backend/cron-jobs)** — Attività in background pianificate
- **[Database Branching](/docs/backend/branching)** — Copie istantanee del database per dev/staging
- **[Deployment](/docs/getting-started/deployment)** — Portare il backend in produzione
