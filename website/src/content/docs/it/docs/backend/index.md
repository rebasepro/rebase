---
sourceHash: e399d82e853d3169
title: Panoramica del Backend
sidebar_label: Backend
description: Il backend di Rebase fornisce un server completo con API REST, autenticazione, archiviazione, real-time via WebSocket e cronologia delle entità — tutto inizializzato con una singola chiamata di funzione.
---

## Panoramica

Il backend di Rebase è un **server Node.js** basato su [Hono](https://hono.dev/) che fornisce:

- **API REST** — Endpoint CRUD generati automaticamente per ciascuna tabella
- **Autenticazione** — Token JWT, accesso OAuth e OIDC, magic link, codici monouso (OTP), MFA, chiavi API, gestione utenti/ruoli
- **Archiviazione (Storage)** — Caricamento/download di file su filesystem locale o S3
- **WebSocket** — Sincronizzazione dei dati in tempo reale tramite LISTEN/NOTIFY di PostgreSQL
- **Cronologia delle entità** — Audit trail per ogni modifica ai dati
- **Database Branching** — Copie istantanee e isolate del database per ambienti di sviluppo/staging/test
- **Cron Job** — Task in background pianificati con dashboard di monitoraggio

Tutto viene inizializzato con una singola funzione:

:::note[Dove va inserito]
La chiamata seguente è quella presente in un backend **ejected**, in `backend/src/index.ts`. Nel
**runtime gestito** tale file non esiste: il runtime esegue la chiamata, e
lo si configura tramite variabili d'ambiente, le tabelle esportate da
`backend/schema/index.ts`, le risorse dichiarate in `backend/resources.ts` (`database()`,
`bucket()`), e due export che legge: `storageAuthorize` da
`backend/storage.ts` e `hooks` da `backend/hooks.ts`. Ogni pagina in questa
sezione specifica a quale dei due casi si applica l'opzione documentata, e menziona
quelle che non hanno una controparte gestita. Esportando qualsiasi altra cosa da questi due moduli,
il runtime avvisa all'avvio invece di ignorarla silenziosamente; esportandone una
sostituita da una dichiarazione di risorsa, l'avvio la rifiuterà indicandola per nome,
specificando la riga da inserire in `backend/resources.ts`.
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

Questa singola chiamata è
una scorciatoia per passaggi pubblici: `installUnhandledRejectionHandler` impedisce che un
rejection isolato arresti il processo, `createRebaseBackend` crea il backend,
`setDefaultBackend` lo imposta come istanza predefinita a cui risponde l'API a livello di modulo, e
`mount`, `attachRealtime` e `start` si occupano di servirlo. Per montare solo alcuni gruppi
di route, posizionarli su altri percorsi, delegare i timer a un altro processo o eseguire
due backend in un unico processo, esegui questi passaggi manualmente. Consulta
[Integrazione Server Personalizzato](/docs/backend/custom-server/).

## Dove risiede ciascuna opzione

Quella chiamata rappresenta la configurazione **ejected** — quella scritta manualmente dopo `rebase
eject`, o in un server personalizzato. Un progetto generato tramite scaffolding non la possiede: il
runtime distribuito avvia il progetto e ogni opzione viene fornita come variabile
d'ambiente in `.env`, come export da `backend/storage.ts` o `backend/hooks.ts`,
o come directory dichiarata dal bundle in `rebase.json`.

Entrambi i percorsi confluiscono nello stesso `RebaseBackendConfig`. Ecco la mappa completa.

| Opzione | Runtime gestito |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (predefinito `/api`) |
| `tables`, `schemaDir`, `defaultRls` | la directory `backend/schema/` (la chiave `tables` di `rebase.json`): le tabelle e il `defaultRls` esportati dal rispettivo `index.ts` |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, oltre a una dichiarazione `database("<key>")` in `backend/resources.ts` per ogni database aggiuntivo rispetto a quello predefinito |
| `auth` | `JWT_SECRET`, le variabili `OAUTH_*`, e la tabella dichiarata in `backend/schema` con `defineAuthTable` |
| `storage` | le variabili `STORAGE_*`, oltre a una dichiarazione `bucket("<key>")` in `backend/resources.ts` per ogni bucket aggiuntivo rispetto a quello predefinito |
| `storageAuthorize` | `export const storageAuthorize` da `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` da `backend/hooks.ts` — hook di tabella globali |
| `history` | `REBASE_HISTORY` (attivo per impostazione predefinita) — solo in forma booleana |
| `push` | `REBASE_PUSH`, con `REBASE_VAPID_*` per le chiavi — solo in forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se non impostato serve `/api/docs` al pubblico dell'endpoint dello schema, `true` lo pubblica con la Swagger UI, `false` lo mantiene protetto da autenticazione admin |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e le relative credenziali `REBASE_LIVE_SCHEMA_*` — solo nella forma basata su repository |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulta [Processi Separati](/docs/deployment/split-processes/) |
| `corsHandled` | Il CORS viene installato dal runtime a partire da `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la compilazione inserisce entrambi all'interno del bundle |
| `app`, `server`, `provisioningDriverResult` | vengono creati dal runtime |

### Opzioni senza percorso gestito

Queste non hanno una variabile d'ambiente né un export di modulo. Sono accessibili
esclusivamente da una chiamata manuale a `initializeRebaseBackend` — tramite `rebase eject`, o in un
[server personalizzato](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` nella sua forma a oggetto (`{ retention }`) ·
`push` nella sua forma a oggetto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` viene disabilitato forzatamente in un bundle compilato: l'editor riscrive i file
*sorgente* in `backend/schema`, mentre un bundle contiene solo l'output compilato.

## Cosa viene creato

Dopo l'inizializzazione, vengono montate queste route:

| Percorso | Scopo |
|------|---------|
| `/api/auth/*` | Autenticazione (registrazione, login, refresh, OAuth, magic link, codici monouso, MFA) |
| `/api/admin/*` | Utenti, ruoli, chiavi di servizio, cron, backup, log e schema, ciascuno protetto dal proprio [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Caricamento, download ed eliminazione di file |
| `/api/data/:slug` | Operazioni CRUD per tabella (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Cronologia delle modifiche dell'entità (se abilitata) |
| `/api/docs` | Specifica OpenAPI delle tabelle visibili al chiamante (pubblica con `enableSwagger: true`; solo admin con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, solo al di fuori dell'ambiente di produzione) |
| `/api/schema/tables` | Le tabelle servite da questo backend, così come visibili al chiamante — vedi [Endpoint](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versione dello schema, il runtime e ogni tabella dal punto di vista di un amministratore (richiede `schema:read`) |
| `/api/meta/schema-version` | Una stringa di versione per tale schema (senza autenticazione) |
| `/api/functions/*` | Route per funzioni personalizzate (quando `functions` o `functionsDir` è impostato) |
| `/api/push/*` | Iscrizioni alle [notifiche push](/docs/backend/push-notifications/) (quando `push` è attivo) |
| `/api/admin/cron/*` | Gestione dei cron job (`cron:read` / `cron:write`, quando `crons` o `cronsDir` è impostato) |
| WebSocket su upgrade | Sottoscrizioni in tempo reale, su `/` per un'API su `/api` |

---

## Il ciclo di vita dell'inizializzazione

Quando si richiama `initializeRebaseBackend()`, il framework avvia una sequenza di boot a 5 fasi:

```
[Inizio Boot]
     │
     ▼
1. Configurazione (l'adattatore del database, le opzioni di autenticazione e archiviazione passate)
     │
     ▼
2. Caricamento Schema (importa backend/schema/index.ts, compila ogni tabella — un errore in una qualsiasi blocca il boot)
     │
     ▼
3. Bootstrapping Database (crea schemi/auth/funzioni helper SQL, nei limiti consentiti da `provision`)
     │
     ▼
4. Inizializzazione Servizi (Auth, istanze client Storage S3/Locale, popolamento del cron store)
     │
     ▼
5. Montaggio Route & Edge Loading (controller Hono, funzioni personalizzate, binding WebSocket)
     │
     ▼
[Boot Completato]
```

---

## Cosa succede se l'avvio fallisce

**Il boot fallisce in modo esplicito (loudly).** Se il database non è raggiungibile, le credenziali sono
errate, o lo schema non può essere compilato o applicato, `initializeRebaseBackend`
genera un errore, nessun servizio viene esposto e il processo termina con codice `1`. Non esiste una modalità degradata
né un server parziale: un container che non riesce a raggiungere il proprio database si riavvia, e
l'errore che ne ha causato la terminazione sarà l'ultima voce nei suoi log.

Ciò è voluto. Un server che si avvia rispondendo all'autenticazione mentre ogni
route `/api/data/*` fallisce è molto più difficile da diagnosticare rispetto a uno che non si avvia
affatto — e un orchestratore può intervenire in caso di crash loop.

Prima della prima query, la fase di boot testa la connessione e stampa la diagnosi:
l'host e la porta non raggiungibili, la causa specifica segnalata dal driver (`ECONNREFUSED`,
`password authentication failed for user "app"`), e la relativa soluzione. Consulta
la sezione [Risoluzione dei problemi](/docs/troubleshooting/) per l'elenco dettagliato dei fallimenti.

### Una volta in funzione: `/livez` e `/health`

Due probe, che rispondono a due domande differenti.

| Percorso | Interroga il database | Risponde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` finché il processo è in esecuzione. Utilizzalo come liveness probe. |
| `/health` | Sì, ogni origine dati | `200 {"status":"ok"}` quando ogni data source configurato risponde; `503 {"status":"degraded"}` quando uno di essi fallisce. Utilizzalo come readiness probe. |

Configurare un liveness probe su `/health` è un errore da evitare: una breve
interruzione momentanea del database porterebbe l'orchestratore a terminare un processo altrimenti sano, trasformando un
disservizio temporaneo in un loop di riavvii.

`/health` non richiede autenticazione, pertanto restituisce il verdetto ma non la causa:
al di fuori dell'ambiente di sviluppo indica quale data source è degradato e null'altro. Il
testo dell'errore del driver include host, porta, nome del database e ruolo, e viene inviato
ai log. `/health` è servito anche sotto `basePath` (`/api/health`);
`/livez` no.

Entrambi i probe appartengono al runtime gestito. Un file `backend/src/index.ts` derivato da un'operazione di eject serve
`/health` e `/api/health` autonomamente, verificando solo il database predefinito, e non possiede
alcun `/livez` finché non viene aggiunto manualmente.

---

## Riferimento della configurazione

```typescript
interface RebaseBackendConfig {
    // Framework HTTP
    app: Hono;               // Istanza dell'applicazione Hono
    server: Server;           // Server HTTP Node.js (per l'integrazione di WebSocket)
    basePath?: string;        // Prefisso delle route (predefinito: "/api")

    // Tabelle
    tables?: (AnyTableDef | AnyViewDef)[]; // Risultati di defineTable / defineAuthTable / defineView
    defaultRls?: DefaultRls;  // Comportamento applicato alle tabelle con `rls: "inherit"`, se si passa `tables`
    schemaDir?: string;       // Directory backend/schema: caricata quando `tables` è assente, e destinazione per l'editor di schema
    hooks?: TableHooks;       // Hook globali per le tabelle, eseguiti per ciascuna tabella

    // Adattatore database (PostgreSQL, SQLite, ecc.)
    database?: DatabaseAdapter;

    // Configurazione dell'autenticazione o adattatore personalizzato
    auth?: RebaseAuthConfig | AuthAdapter;

    // Archiviazione file (Storage)
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Cronologia delle entità
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Endpoint API personalizzati: valori, o una directory di file (non entrambi)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Caricamento automatico delle route Hono da una directory

    // Task pianificati: valori, o una directory di file (non entrambi)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
    cronsDir?: string;         // Caricamento automatico dei cron job da una directory
    cronPersistence?: boolean; // Scrive i log di esecuzione su rebase.cron_logs (predefinito: true)

    // Comportamento HTTP
    compression?: boolean;     // gzip/deflate per le risposte API (predefinito: true)
    maxBodySize?: number;      // Dimensione massima del corpo della richiesta in byte (predefinito: 10MB; 0 disabilita)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Modifica dello schema
    schemaEditor?: boolean;   // Abilita o disabilita forzatamente le route dell'editor di schema

    // Registrazione log
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Cinque di queste opzioni passano spesso inosservate ma modificano comportamenti altrimenti solo
rilevabili sul campo:

| Chiave | Predefinito | Descrizione |
|---|---|---|
| `compression` | `true` | Compressione gzip/deflate sulle risposte API, negoziata da `Accept-Encoding`. I corpi già compressi, in streaming o con `no-transform` non vengono modificati, così come i payload inferiori a 1 KB (dove gzip richiede più risorse di quante ne risparmi); è quindi sicuro mantenerla attiva: un elenco JSON di grandi dimensioni si riduce tipicamente di ~20x. Impostare su `false` se nginx, Cloudflare o un altro proxy a monte esegue già la compressione, per evitare un doppio carico. Variabile d'ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite per il corpo delle richieste sulle route API; `0` lo disabilita. I caricamenti di file nello storage utilizzano il valore `maxFileSize` (50MB) della configurazione dello storage, che ha la precedenza per quelle route. Variabile d'ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | disattivato | **Opt-in.** Un'API BaaS viene interrogata da app mobili, SPA su altri domini e strumenti CLI, nessuno dei quali invia un header `Origin` compatibile con un elenco fisso: per questo motivo non è abilitata di default. Abilitala specificando le origini utilizzate dai tuoi client browser. Nessuna variabile d'ambiente disponibile: richiede l'eject per essere configurata. |
| `cronPersistence` | `true` | Determina se i log di esecuzione vengono salvati su `rebase.cron_logs`. Con `false` i job continuano a essere eseguiti ma la cronologia rimane solo in memoria, venendo persa dal pannello di Studio al riavvio. |
| `schemaEditor` | attivo al di fuori della produzione, se `schemaDir` è impostato | Abilita o disabilita forzatamente le route dell'editor di schema. L'editor riscrive i *file sorgente* in `backend/schema`, necessitando quindi di una directory su cui scrivere — requisito assente in un bundle compilato, motivo per cui non è mai presente in ambiente di deployment. |

Il resto di `RebaseBackendConfig` è documentato nella rispettiva pagina dedicata (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) o contrassegnato come `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` vengono popolati da
`bootFromBundle` tramite l'ambiente; configurarli manualmente crea discrepanze con
il runtime sulla natura del processo in esecuzione.

## L'istanza del Backend

`initializeRebaseBackend` restituisce il backend appena compilato, già montato e
avviato. Il suo tipo è `RebaseBackendInstance`, equivalente a `RebaseBackend`, il
tipo restituito da `createRebaseBackend`:

```typescript
const instance = await initializeRebaseBackend(config);

// Accesso ai servizi interni
instance.driver              // Driver dati predefinito
instance.driverRegistry      // Tutti i driver (per configurazioni multi-database)
instance.realtimeService     // Servizio real-time predefinito
instance.auth?.userService       // Gestione utenti
instance.storageController   // Storage predefinito
instance.storageRegistry     // Tutti i backend di archiviazione
instance.getTableDescriptors() // Le tabelle compilate, restituite da GET /api/schema/tables
instance.history?.historyService // Cronologia entità
instance.cronScheduler       // Scheduler cron job (se crons o cronsDir è impostato)
instance.jobQueue            // Coda job persistente (se i job sono abilitati)
instance.setTableHooks(slug, hooks) // Sostituisce gli hook di una tabella
instance.shutdown()          // Esegue il drain e lo stop; arresta anche il server fornito
```

Espone inoltre
`rebase`, il client in-process, `fetch(request)`, `routes`, i gruppi di route
come sotto-applicazioni Hono, `services`, le proprie chiavi JWT, il modello di accesso, lo store delle chiavi API e
i rate limiter, oltre a `verifyCredential(token)`; consulta
[Integrazione Server Personalizzato](/docs/backend/custom-server/).

> **Nota:** Sebbene l'`instance` esponga tali servizi interni, il codice applicativo (come funzioni personalizzate e cron job) dovrebbe utilizzare il singleton `rebase` di `@rebasepro/server` per interagire con l'API del backend. All'interno di una richiesta, di un'esecuzione cron o di un job, `rebase` rappresenta il backend che lo gestisce; altrove corrisponde all'istanza predefinita del processo, configurata da `initializeRebaseBackend`.

## API REST

L'API REST viene generata a partire dalle tue tabelle. Ciascuna tabella riceve i seguenti endpoint:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità — filtri, ordinamento, paginazione e ricerca sono parametri di query |
| `GET` | `/api/data/:slug/count` | Quante righe corrispondono alla medesima query |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opzionalmente raggruppati |
| `GET` | `/api/data/:slug/:id` | Ottiene una singola entità |
| `POST` | `/api/data/:slug` | Crea una nuova entità |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna i campi inviati |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea più righe in una singola transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna più righe in una singola transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina più righe in una singola transazione |

### Parametri di query

Esiste un riferimento dedicato e non coincide con questa pagina. [API
REST](/docs/backend/api/) documenta entrambi i dialetti di query supportati dal server — il
formato in stile PostgREST `?column=op.value` e il formato JSON `?where=` — insieme a
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e la ricerca
vettoriale. [Endpoint](/docs/backend/endpoints/) contiene l'indice completo di ogni route
montata dal server, comprese quelle generate automaticamente.

Un parametro non riservato dal server viene interpretato come filtro sulla colonna con
quel nome, pertanto un parametro non riconosciuto non genera errori: semplicemente non restituirà alcun risultato.

## WebSocket

Il server WebSocket si aggancia al medesimo server HTTP e gestisce le sottoscrizioni in tempo reale. Risponde alle richieste di upgrade su un unico percorso, `/` per un'API su `/api`, a cui si connette l'SDK, lasciando ogni altro percorso ai tuoi listener `upgrade` personalizzati:

- Sottoscrizione alle **modifiche di tabella** — ricevi notifiche quando una riga in una tabella viene creata, aggiornata o eliminata
- Sottoscrizione alle **modifiche di riga** — ricevi notifiche quando una riga specifica cambia
- Gestione automatica della **riconnessione** nell'SDK tipizzato

Il backend utilizza internamente il comando `LISTEN/NOTIFY` di PostgreSQL. Per deployment multi-istanza, fornisci una `connectionString` nel tuo `PostgresBootstrapper` per abilitare il broadcasting tra istanze.

## Gestione degli errori

Qualsiasi errore — proveniente da qualunque route, in qualsiasi sottosistema — viene restituito all'interno di una struttura standard:

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
| `message` | sì | Pensato per una persona che legge una console. Specifica l'ostacolo riscontrato, non la regola interna. |
| `code` | sì | Formato `SCREAMING_SNAKE_CASE` e stabile. È il campo su cui basare la logica condizionale. |
| `details` | no | Payload strutturato presente quando il rifiuto riguarda elementi specifici — una lista di percorsi non validi, un insieme di campi sconosciuti. |
| `requestId` | no | Presente quando la richiesta ne conteneva uno o ne è stato assegnato uno; replica `X-Request-ID`. Da citare nelle segnalazioni di bug. |

Lo status HTTP è presente nella risposta, non nel corpo. Basa la logica condizionale su `code`, non su
`message` — i messaggi sono scritti per gli utenti e possono variare.

L'SDK tipizzato converte ciascuna di queste risposte in un `RebaseApiError` contenente
`status`, `code` e `details` — inclusi i fallimenti che non hanno mai raggiunto il
server. Una connessione rifiutata, un errore DNS, problemi CORS o un'interruzione (abort) vengono restituiti come
`status: 0`, `code: "NETWORK_ERROR"`, con l'errore del runtime assegnato a `cause`,
piuttosto che con il messaggio di errore arbitrario generato da `fetch`. Una risposta priva di
envelope standard — come un errore 413 di un proxy o un 502 di un bilanciatore di carico — riceve comunque un `code` basato sul proprio
status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e un
client inizializzato al di fuori di un browser senza specificare un `baseUrl` fallisce con
`BASE_URL_REQUIRED` anziché con un generico errore di rete.
Un'operazione di lettura che riceve una risposta di successo priva del formato atteso
— un `204`, un corpo vuoto, una pagina priva della lista `data` — genera
l'errore `UNEXPECTED_RESPONSE` anziché risolversi come "nessuna riga", e le funzioni
`createMany`, `updateMany`, `deleteMany` o `batch` eseguite con un valore diverso da
un array falliscono con `INVALID_BULK_BODY`, il medesimo codice utilizzato dal server per questo
errore. In questo modo il codice applicativo deve gestire un'unica classe di eccezione:

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

- **[Autenticazione](/docs/backend/authentication)** — JWT, provider OAuth e OIDC, MFA, chiavi API, gestione utenti
- **[Archiviazione (Storage)](/docs/backend/storage)** — File storage locale e su S3
- **[Hook di tabella](/docs/collections/callbacks)** — Hook del ciclo di vita e l'API `context.data`
- **[Cronologia delle entità](/docs/backend/history)** — Tracciamento di audit
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiunta di endpoint API su misura
- **[Cron Job](/docs/backend/cron-jobs)** — Task pianificati in background
- **[Database Branching](/docs/backend/branching)** — Copie istantanee del database per dev/staging
- **[Deployment](/docs/getting-started/deployment)** — Distribuzione del backend in produzione
