---
sourceHash: 3d3fc39a95926201
title: Panoramica del Backend
sidebar_label: Backend
description: Il backend di Rebase fornisce un server completo con API REST, autenticazione, storage, real-time via WebSocket e cronologia delle entità — il tutto inizializzato con una singola chiamata di funzione.
---

## Panoramica

Il backend di Rebase è un **server Node.js** basato su [Hono](https://hono.dev/) che fornisce:

- **API REST** — Endpoint CRUD generati automaticamente per ciascuna tabella
- **Autenticazione** — Token JWT, accesso tramite OAuth e OIDC, magic link, codici monouso, MFA, chiavi API, gestione di utenti/ruoli
- **Storage** — Caricamento/download di file con filesystem locale o S3
- **WebSocket** — Sincronizzazione dei dati in tempo reale tramite LISTEN/NOTIFY di PostgreSQL
- **Cronologia delle Entità** — Traccia di controllo (audit trail) per ogni modifica ai dati
- **Branching del Database** — Copie del database istantanee e isolate per sviluppo/staging/testing
- **Cron Job** — Attività in background pianificate con dashboard di monitoraggio

Tutto viene inizializzato con una singola funzione:

:::note[Dove va posizionato]
La chiamata sottostante è quella presente in un backend sottoposto a **eject**, in `backend/src/index.ts`. Nel
**runtime gestito** tale file non esiste: il runtime esegue la chiamata, e
lo si configura tramite variabili d'ambiente, le tabelle esportate da
`backend/schema/index.ts`, le risorse dichiarate in `backend/resources.ts` (`database()`,
`bucket()`), e due export che esso legge: `storageAuthorize` da
`backend/storage.ts` e `hooks` da `backend/hooks.ts`. Ogni pagina in questa
sezione indica quale dei due approcci si applica all'opzione documentata, menzionando
quelle che non hanno una forma gestita. Esportando qualsiasi altra cosa da quei due moduli,
il runtime mostrerà un avviso all'avvio anziché ignorarla silenziosamente; esportando
un elemento sostituito da una dichiarazione di risorsa, l'avvio verrà bloccato indicandone il nome,
insieme alla riga da inserire in `backend/resources.ts`.
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
una scorciatoia rispetto a passaggi pubblici: `installUnhandledRejectionHandler` impedisce a un
rejection imprevisto di terminare il processo, `createRebaseBackend` crea il backend,
`setDefaultBackend` lo imposta come istanza predefinita per l'API a livello di modulo, e
`mount`, `attachRealtime` e `start` si occupano di servirlo. Per montare solo alcuni gruppi
di route, posizionarli su percorsi differenti, delegare i timer a un altro processo o eseguire
due backend in un unico processo, è possibile richiamare i passaggi manualmente. Consulta
[Integrazione Server Personalizzata](/docs/backend/custom-server/).

## Dove risiede ciascuna opzione

Quella chiamata rappresenta la configurazione da **eject** — quella scritta manualmente dopo `rebase
eject`, o in un server personalizzato. Un progetto generato tramite scaffolding non la possiede: il
runtime rilasciato avvia il progetto e ciascuna opzione viene definita tramite una variabile
d'ambiente in `.env`, un export da `backend/storage.ts` o `backend/hooks.ts`,
oppure una directory dichiarata dal bundle in `rebase.json`.

Entrambi i percorsi fanno capo allo stesso `RebaseBackendConfig`. Ecco la mappatura completa.

| Opzione | Runtime gestito |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (predefinito `/api`) |
| `tables`, `schemaDir`, `defaultRls` | la directory `backend/schema/` (la chiave `tables` di `rebase.json`): le tabelle e il `defaultRls` esportati dal suo `index.ts` |
| `rpc` | <span class="since-badge" data-since="0.35">Da 0.35</span> le dichiarazioni `defineRpc` esportate da `backend/schema/index.ts` — vedi [Funzioni SQL come RPC](/docs/backend/rpc/) |
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
| `push` | `REBASE_PUSH`, con `REBASE_VAPID_*` per le chiavi — solo in forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se non impostato serve `/api/docs` al pubblico autorizzato per l'endpoint di schema, se `true` lo pubblica con la Swagger UI, se `false` lo mantiene protetto da restrizioni di amministrazione |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e le credenziali `REBASE_LIVE_SCHEMA_*` associate — solo nella variante con repository |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — vedi [Processi Separati](/docs/deployment/split-processes/) |
| `corsHandled` | Il CORS viene installato dal runtime a partire da `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la build include entrambi nel bundle |
| `app`, `server`, `provisioningDriverResult` | vengono creati dal runtime |

### Opzioni senza un percorso gestito

Queste non dispongono di una variabile d'ambiente né di un export di modulo. Sono accessibili
soltanto tramite una chiamata manuale a `initializeRebaseBackend` — a seguito di `rebase eject`, o all'interno di un
[server personalizzato](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` nel formato ad oggetto (`{ retention }`) ·
`push` nel formato ad oggetto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` viene forzatamente disabilitato in un bundle compilato: l'editor riscrive i file
*sorgente* di `backend/schema`, mentre un bundle contiene l'output compilato.

## Cosa viene creato

Dopo l'inizializzazione, vengono montate queste route:

| Percorso | Scopo |
|------|---------|
| `/api/auth/*` | Autenticazione (registrazione, login, refresh, OAuth, magic link, codici monouso, MFA) |
| `/api/admin/*` | Utenti, ruoli, chiavi di servizio, cron, backup, log e schema, ciascuno protetto dal rispettivo [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Caricamento, download e cancellazione di file |
| `/api/data/:slug` | Operazioni CRUD per tabella (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Cronologia delle modifiche all'entità (se abilitata) |
| `/api/docs` | Specifica OpenAPI delle tabelle visibili al chiamante (pubblica con `enableSwagger: true`; riservata agli admin con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, solo al di fuori dell'ambiente di produzione) |
| `/api/schema/tables` | Le tabelle servite da questo backend, visibili in base ai permessi del chiamante — vedi [Endpoint](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versione dello schema, il runtime e ogni tabella così come visti da un amministratore (richiede `schema:read`) |
| `/api/meta/schema-version` | Una stringa di versione per lo schema in questione (non autenticata) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">Da 0.35</span> Le funzioni SQL dichiarate con `defineRpc`, eseguite con l'identità del chiamante — vedi [Funzioni SQL come RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Route per funzioni personalizzate (quando `functions` o `functionsDir` è impostato) |
| `/api/push/*` | Iscrizioni alle [notifiche push](/docs/backend/push-notifications/) (quando `push` è attivo) |
| `/api/admin/cron/*` | Gestione dei cron job (`cron:read` / `cron:write`, quando `crons` o `cronsDir` è impostato) |
| WebSocket su upgrade | Sottoscrizioni in tempo reale, su `/` per un'API posizionata su `/api` |

---

## Il ciclo di vita dell'inizializzazione

Quando si richiama `initializeRebaseBackend()`, il framework esegue una sequenza di boot a 5 fasi:

```
[Inizio Boot]
     │
     ▼
1. Configurazione (l'adattatore di database, le opzioni di autenticazione e storage fornite)
     │
     ▼
2. Caricamento dello Schema (importa backend/schema/index.ts, compila ogni tabella — qualsiasi errore impedisce l'avvio)
     │
     ▼
3. Bootstrap del Database (crea schemi/auth/funzioni SQL helper, come consentito da `provision`)
     │
     ▼
4. Inizializzazione dei Servizi (istanze client di Auth, Storage S3/Locale, popolamento del cron store)
     │
     ▼
5. Montaggio Route & Caricamento Edge (controller Hono, funzioni personalizzate, associazione WebSocket)
     │
     ▼
[Boot Completato]
```

---

## Cosa accade se l'avvio fallisce

**Il boot fallisce in modo evidente.** Se il database non è raggiungibile, le credenziali sono
errate, oppure lo schema non può essere compilato o applicato, `initializeRebaseBackend`
solleva un errore, nulla viene servito e il processo termina con codice `1`. Non è prevista una modalità degradata
né un server parziale: un container impossibilitato a raggiungere il proprio database si riavvia, e
l'errore che ne ha causato l'arresto rimane come ultima riga nei log.

Si tratta di un comportamento voluto. Un server che si avvia gestendo le richieste di accesso mentre ogni
route `/api/data/*` fallisce è molto più difficile da diagnosticare rispetto a uno che non si avvia affatto —
e un orchestratore può intervenire di fronte a un crash loop.

Prima della prima query, la fase di boot verifica la connessione e stampa la diagnosi: l'host
e la porta non raggiungibili, il motivo segnalato dal driver (`ECONNREFUSED`,
`password authentication failed for user "app"`), e la relativa soluzione. Consulta
la sezione [Risoluzione dei Problemi](/docs/troubleshooting/) per l'elenco dettagliato dei singoli errori.

### Una volta avviato: `/livez` e `/health`

Due probe che rispondono a due domande diverse.

| Percorso | Interroga il database | Risponde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` finché il processo è in esecuzione. Da utilizzare per una liveness probe. |
| `/health` | Sì, ogni origine dati | `200 {"status":"ok"}` quando ogni origine dati configurata risponde; `503 {"status":"degraded"}` quando una di esse non risponde. Da utilizzare per una readiness probe. |

Impostare una liveness probe su `/health` è un errore da evitare: un'interruzione temporanea del database
porterebbe l'orchestratore a terminare un processo altrimenti sano, trasformando un breve disservizio
in un ciclo continuo di riavvii.

`/health` non richiede autenticazione, pertanto restituisce solo l'esito complessivo e non la causa —
al di fuori dell'ambiente di sviluppo si limita a indicare quale origine dati risulta degradata. Il testo
dell'errore del driver riporta host, porta, nome del database e ruolo, ed è destinato ai log. Inoltre,
`/health` viene servito anche sotto `basePath` (`/api/health`);
`/livez` no.

Entrambe le probe appartengono al runtime gestito. Una versione da eject in `backend/src/index.ts` serve
`/health` e `/api/health` direttamente, verificando solo il database predefinito, e non include
alcun `/livez` finché non viene aggiunto manualmente.

---

## Riferimento della Configurazione

<span class="since-badge" data-since="0.35">Da 0.35</span> L'opzione `rpc` indicata di seguito.

```typescript
interface RebaseBackendConfig {
    // Framework HTTP
    app: Hono;               // Istanza dell'applicazione Hono
    server: Server;           // Server HTTP Node.js (per l'aggancio del WebSocket)
    basePath?: string;        // Prefisso delle route (predefinito: "/api")

    // Tabelle
    tables?: (AnyTableDef | AnyViewDef)[]; // Risultati di defineTable / defineAuthTable / defineView
    defaultRls?: DefaultRls;  // Ciò che le tabelle `rls: "inherit"` assumono, quando si passa `tables`
    schemaDir?: string;       // La directory backend/schema: caricata quando `tables` è assente, e su cui scrive lo schema editor
    hooks?: TableHooks;       // Hook di tabella globali, eseguiti per ogni tabella

    // Adattatore database (PostgreSQL, SQLite, ecc.)
    database?: DatabaseAdapter;

    // Configurazione dell'autenticazione o adattatore personalizzato
    auth?: RebaseAuthConfig | AuthAdapter;

    // Storage file
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Cronologia delle entità
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Funzioni SQL servite su /api/rpc/<name> (defineRpc). Lette dall'indice
    // di schemaDir quando sono presenti le tabelle; altrimenti passate come valori.
    rpc?: AnyRpcDef[];

    // Endpoint API personalizzati: valori, o una directory di file (non entrambi)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Caricamento automatico di route Hono da una directory

    // Attività pianificate: valori, o una directory di file (non entrambi)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
    cronsDir?: string;         // Caricamento automatico di cron job da una directory
    cronPersistence?: boolean; // Scrive i log di esecuzione in rebase.cron_logs (predefinito: true)

    // Comportamento HTTP
    compression?: boolean;     // gzip/deflate per le risposte API (predefinito: true)
    maxBodySize?: number;      // Dimensione massima del corpo della richiesta in byte (predefinito: 10MB; 0 disabilita)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Modifica dello schema
    schemaEditor?: boolean;   // Forza l'attivazione o la disattivazione delle route dello schema-editor

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Cinque di queste opzioni possono passare inosservate ma modificano comportamenti altrimenti
visibili solo a runtime:

| Chiave | Predefinito | Descrizione |
|---|---|---|
| `compression` | `true` | gzip/deflate sulle risposte API, negoziato tramite `Accept-Encoding`. I corpi già compressi, in streaming o con `no-transform` non vengono modificati, così come quelli inferiori a 1 KB (dove gzip comporterebbe un overhead maggiore del risparmio), per cui è sicuro lasciarlo attivo — un elenco JSON voluminoso si riduce tipicamente di circa 20 volte. Impostare su `false` quando proxy intermedi come nginx, Cloudflare o altri applicano già la compressione, per evitare un doppio carico. Variabile d'ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite per il corpo delle richieste sulle route API; `0` lo disabilita. I caricamenti di file nello storage utilizzano il valore `maxFileSize` (50MB) della configurazione dello storage, che ha la precedenza per tali route. Variabile d'ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | disabilitato | **Opzionale (opt-in).** Un'API BaaS viene chiamata da app mobile, SPA su domini differenti e strumenti da riga di comando, nessuno dei quali invia un header `Origin` compatibile con un elenco prefissato — motivo per cui non è abilitato di default. È possibile attivarlo specificando le origini utilizzate dai client basati su browser. Non esiste una forma via variabile d'ambiente: richiede l'eject per essere configurato. |
| `cronPersistence` | `true` | Determina se i log di esecuzione devono essere registrati in `rebase.cron_logs`. Con `false`, i job continuano a essere eseguiti e la cronologia viene mantenuta solo in memoria, venendo persa nel pannello di Studio a ogni riavvio. |
| `schemaEditor` | attivo fuori dalla produzione, quando `schemaDir` è impostato | Forza l'attivazione o la disattivazione delle route dello schema editor. L'editor riscrive i *file sorgente* in `backend/schema`, necessitando di conseguenza di una directory accessibile in scrittura — cosa che non è presente in un bundle compilato, motivo per cui non è mai disponibile in produzione. |

Il resto di `RebaseBackendConfig` è documentato nella rispettiva pagina dedicata (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) oppure contrassegnato con `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` vengono popolati da
`bootFromBundle` a partire dall'ambiente; passarli manualmente rischia di creare
incongruenze con il runtime rispetto alla natura del processo in esecuzione.

## L'istanza del Backend

`initializeRebaseBackend` restituisce l'istanza del backend creata, già montata e
avviata. Il suo tipo è `RebaseBackendInstance`, che corrisponde a `RebaseBackend`, il
tipo restituito da `createRebaseBackend`:

```typescript
const instance = await initializeRebaseBackend(config);

// Accesso ai servizi interni
instance.driver              // Driver dati predefinito
instance.driverRegistry      // Tutti i driver (per scenari multi-database)
instance.realtimeService     // Servizio realtime predefinito
instance.auth?.userService       // Gestione utenti
instance.storageController   // Storage predefinito
instance.storageRegistry     // Tutti i backend di storage
instance.getTableDescriptors() // Le tabelle compilate, nel formato servito da GET /api/schema/tables
instance.history?.historyService // Cronologia delle entità
instance.cronScheduler       // Scheduler dei cron job (quando crons o cronsDir è impostato)
instance.jobQueue            // Coda di job durevole (quando jobs è abilitato)
instance.setTableHooks(slug, hooks) // Sostituisce gli hook di una tabella
instance.shutdown()          // Arresta e svuota le connessioni; chiude anche il server associato
```

Contiene inoltre
`rebase`, il client in-process, `fetch(request)`, `routes`, i gruppi di route
come sotto-applicazioni Hono, `services`, le relative chiavi JWT, il modello di accesso, lo store delle chiavi API e
i limitatori di frequenza, oltre a `verifyCredential(token)`; consulta
[Integrazione Server Personalizzata](/docs/backend/custom-server/).

> **Nota:** Sebbene l'`instance` esponga questi servizi interni, il codice dell'applicazione (come le funzioni personalizzate e i cron job) dovrebbe utilizzare il singleton `rebase` di `@rebasepro/server` per interagire con l'API del backend. All'interno di una richiesta, di un'esecuzione cron o di un job, `rebase` corrisponde al backend che lo sta gestendo; altrove fa riferimento all'istanza di processo predefinita, impostata da `initializeRebaseBackend` al proprio backend.

## API REST

L'API REST viene generata a partire dalle tabelle. Ciascuna tabella ottiene i seguenti endpoint:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenco delle entità — filtraggio, ordinamento, paginazione e ricerca avvengono tramite parametri di query |
| `GET` | `/api/data/:slug/count` | Numero di righe corrispondenti alla medesima query |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opzionalmente raggruppati |
| `GET` | `/api/data/:slug/:id` | Recupera una singola entità |
| `POST` | `/api/data/:slug` | Crea una nuova entità |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna i campi forniti |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea più righe in una singola transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna più righe in una singola transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina più righe in una singola transazione |

### Parametri di query

Il riferimento esaustivo non si trova in questa pagina. La guida all'[API
REST](/docs/backend/api/) illustra entrambi i formati di query supportati dal server — la
sintassi in stile PostgREST `?column=op.value` e il formato JSON `?where=` — insieme a
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e ricerca vettoriale.
La pagina [Endpoint](/docs/backend/endpoints/) elenca tutte le route montate dal
server, comprese quelle generate.

Un parametro non riservato dal server viene interpretato come un filtro applicato alla colonna con
quel nome; di conseguenza, un parametro inesistente non produce un errore: semplicemente non corrisponderà ad alcun record.

## WebSocket

Il server WebSocket si aggancia allo stesso server HTTP e offre sottoscrizioni in tempo reale. Risponde alle richieste di upgrade su un unico percorso, `/` per un'API posizionata su `/api`, a cui l'SDK si connette, lasciando ogni altro percorso ai propri listener di `upgrade`:

- Sottoscrizione alle **modifiche delle tabelle** — ricevi notifiche quando una riga in una tabella viene creata, aggiornata o eliminata
- Sottoscrizione alle **modifiche delle singole righe** — ricevi notifiche quando una specifica riga cambia
- Gestione automatica della **riconnessione** nell'SDK tipizzato

Il backend utilizza internamente il meccanismo `LISTEN/NOTIFY` di PostgreSQL. Per le distribuzioni multi-istanza, è possibile specificare una `connectionString` nel proprio `PostgresBootstrapper` per abilitare la trasmissione tra istanze diverse.

## Gestione degli Errori

Qualsiasi errore — su qualsiasi route e in qualunque sottosistema — viene restituito all'interno di una struttura uniforme:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Sempre presente | Significato |
|-------|:--------------:|------------|
| `message` | sì | Pensato per un utente che legge la console. Indica il problema riscontrato, non la regola. |
| `code` | sì | In formato `SCREAMING_SNAKE_CASE` e stabile. È il campo su cui basare la logica condizionale. |
| `details` | no | Payload strutturato presente quando il rifiuto riguarda elementi specifici — un elenco di percorsi errati, un insieme di campi non riconosciuti. |
| `requestId` | no | Presente se la richiesta ne conteneva uno o se ne è stato assegnato uno; replica `X-Request-ID`. Utile da includere nelle segnalazioni di bug. |

Lo status code HTTP si trova nella risposta, non nel corpo. È consigliabile gestire la logica basandosi su `code` anziché su
`message` — i messaggi sono pensati per la lettura umana e possono variare nel tempo.

L'SDK tipizzato converte ciascuno di questi errori in un `RebaseApiError` contenente
`status`, `code` e `details` — inclusi i fallimenti che non hanno mai raggiunto il
server. Una connessione rifiutata, un errore DNS, problemi di CORS o una richiesta annullata vengono restituiti con
`status: 0`, `code: "NETWORK_ERROR"`, con l'errore effettivo del runtime riportato su `cause`,
anziché con l'eccezione generica generata da `fetch`. Una risposta priva di
struttura envelope — come un 413 generato da un proxy o un 502 da un load balancer — riceve comunque un `code` derivato dal suo
stato HTTP (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e un
client configurato fuori dal browser privo di `baseUrl` fallisce con
`BASE_URL_REQUIRED` anziché con un errore di rete generico.
Una lettura che riceve una risposta di successo priva del formato atteso — un codice `204`, un body vuoto, una pagina senza l'elenco `data` —
fallisce con `UNEXPECTED_RESPONSE` invece di risolversi come "nessuna riga trovata", mentre
operazioni come `createMany`, `updateMany`, `deleteMany` o `batch` eseguite passando un valore diverso da un array
falliscono con `INVALID_BULK_BODY`, lo stesso codice utilizzato dal server per questo errore.
In questo modo il codice applicativo deve intercettare un'unica classe di eccezione:

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

## Passaggi Successivi

- **[Autenticazione](/docs/backend/authentication)** — JWT, provider OAuth e OIDC, MFA, chiavi API, gestione utenti
- **[Storage](/docs/backend/storage)** — Archiviazione di file su storage locale e S3
- **[Hook di Tabella](/docs/collections/callbacks)** — Hook del ciclo di vita e API `context.data`
- **[Cronologia delle Entità](/docs/backend/history)** — Traccia di controllo (audit trail)
- **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Aggiunta di endpoint API personalizzati
- **[Funzioni SQL come RPC](/docs/backend/rpc)** — Chiamata a una funzione Postgres su `/api/rpc/<name>`, con l'identità del chiamante
- **[Cron Job](/docs/backend/cron-jobs)** — Attività in background pianificate
- **[Branching del Database](/docs/backend/branching)** — Copie istantanee del database per dev/staging
- **[Deployment](/docs/getting-started/deployment)** — Portare il backend in produzione
