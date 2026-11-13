---
sourceHash: 93c74d4bdc0c12ea
title: Integrazione Server Personalizzato
sidebar_label: Server personalizzato
description: Costruisci il backend di Rebase da componenti pubblici nel tuo server — createRebaseBackend, i suoi gruppi di route, mount, attachRealtime e start — oppure incorpora il driver Postgres in Express.
---

# Integrazione Server Personalizzato

`initializeRebaseBackend` è una scorciatoia. Crea l'intero backend, lo monta
sulla tua app Hono sotto `/api`, collega il socket realtime al tuo server
HTTP e avvia il lavoro in background, tutto in un'unica chiamata. Quando questo è ciò
di cui hai bisogno, usalo.

Quando non lo è, scendi di un livello. Ogni parte di quella chiamata è un componente
pubblico che puoi chiamare tu stesso: crea il backend, poi monta tutto o solo i
gruppi di route desiderati, nei percorsi che preferisci, e decidi quale processo
avvia i timer. [Incorporare il driver Postgres](/docs/backend/embedding-postgres-driver/)
va oltre di un ulteriore passo e apre il solo driver Postgres in un'applicazione Express.

## Configurazione dell'ambiente

Rebase fornisce un'utilità centralizzata `loadEnv()` in `@rebasepro/server` che valida le tue variabili d'ambiente rispetto a uno schema Zod rigoroso. Chiamala **dopo** aver caricato il file `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Per aggiungere variabili tipizzate personalizzate, estendi lo schema:

```typescript
import { loadEnv, z } from "@rebasepro/server";

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

:::caution[Due copie di zod]
Il caricamento simultaneo di due copie di zod causava in precedenza l'interruzione silenziosa di questa chiamata. `loadEnv`
combinava gli schemi con `.merge()`, che accetta uno schema dall'altra copia
e poi rifiuta ogni campo contenente un `.default()`. Il server si avviava,
segnalava il successo e non eseguiva alcuno dei suoi cron; nessun errore menzionava
zod.

`loadEnv` ora valida lo schema di base e il tuo schema `extend` ciascuno con il
proprio `.parse()`, quindi uno schema creato da un'altra copia di zod funziona. Il runtime
fornisce `zod`, e il file `backend/package.json` dello scaffold lo elenca nello stesso intervallo
utilizzato da `@rebasepro/server`, garantendo l'installazione di una sola copia: mantieni le due versioni identiche.
:::

**Comportamenti chiave:**
- Genera `JWT_SECRET` e `REBASE_SERVICE_KEY` in fase di sviluppo quando non sono impostati, permettendoti di iniziare senza configurazione manuale, e li memorizza nella cache in `.rebase-dev-secrets.json` in modo che un riavvio non disconnetta nessuno.
- Blocca i secret generati automaticamente in produzione: devi impostarli esplicitamente.
- Valida che `CORS_ORIGINS` o `FRONTEND_URL` sia impostato in produzione.
- Rifiuta un valore `extend` che non sia uno schema zod.
- Genera un `Error` indicando ciascuna variabile mancante o errata, come ad esempio `DATABASE_URL: is required`, con le segnalazioni di zod nella relativa proprietà `issues`.

Consulta il file `.env.example` nell'applicazione generata dallo scaffold per l'elenco completo delle variabili supportate.

## Un livello sotto `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`initializeRebaseBackend` è costituito da queste chiamate, e nient'altro:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ tables: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Il metodo `shutdown()` che restituisce chiude anche il server passato come argomento. Ecco la
stessa configurazione scritta come file `backend/src/index.ts` di un progetto, pronta per essere modificata.
`rebase dev` esegue quel file quando un progetto ne possiede uno, al posto del boot
proprio del runtime. Incollato in un progetto scaffolded, serve ciò che serviva il runtime:
l'API sulla porta scelta da `rebase dev`, l'accesso e la registrazione tramite la
tabella auth del progetto, le tabelle esportate da `backend/schema/index.ts`, gli hook
globali in `backend/hooks.ts`, le funzioni in `backend/functions/`, i cron job
in `backend/crons/`, i bucket dichiarati in `backend/resources.ts` e il CORS
necessario al pannello di amministrazione sulla propria porta.

```typescript
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    CORS_EXPOSED_HEADERS,
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    isLocalhostOrigin,
    loadEnv,
    logger,
    resolveStorageSources,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import {
    createPostgresAdapter,
    createPostgresDatabaseConnection,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { declaredStorageSources } from "@rebasepro/types";
import "../resources";
import { storageAuthorize } from "../storage";
import { hooks } from "../hooks";

// dotenv never overrides a variable already set, so what `rebase dev` sets wins.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cronsDir = path.join(root, "backend/crons");

installUnhandledRejectionHandler();

const app = new Hono<HonoEnv>();

// Localhost in development, and the origins in CORS_ORIGINS or FRONTEND_URL.
const origins = (env.CORS_ORIGINS || env.FRONTEND_URL || "").split(",").map((origin) => origin.trim());
app.use("/*", cors({
    origin: (origin) =>
        origins.includes(origin) || (env.NODE_ENV !== "production" && isLocalhostOrigin(origin)) ? origin : null,
    credentials: true,
    exposeHeaders: [...CORS_EXPOSED_HEADERS]
}));
app.use("/*", secureHeaders());

const server = createServer({ maxHeaderSize: 64 * 1024 }, getRequestListener(app.fetch));
const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);

const backend = await createRebaseBackend({
    schemaDir: path.join(root, "backend/schema"),
    hooks,
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        cookieAuth: { sameSite: "Lax" }
    },
    storage: resolveStorageSources(process.env, declaredStorageSources(), path.join(root, "uploads")),
    storageAuthorize,
    history: true,
    provision: true
});

setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();

// The runtime answers health on both paths; an orchestrator probes `/health`.
for (const healthPath of ["/health", "/api/health"]) {
    app.get(healthPath, async (c) => {
        const { healthy } = await backend.healthCheck();
        return c.json({ status: healthy ? "ok" : "degraded" }, healthy ? 200 : 503);
    });
}

// `rebase dev` reads this line to know the backend is up.
server.listen(env.PORT, () => logger.info(`Server running at http://localhost:${env.PORT}`));
installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
```

I percorsi sono quelli dello scaffold; ometti l'importazione e l'opzione `hooks` quando il
progetto non include un file `backend/hooks.ts`. Gli utenti sono memorizzati nella tabella
dichiarata da `backend/schema` con `defineAuthTable`, quindi `auth` non indica alcuna tabella.
Il file si basa su quanto impostato da `rebase dev`: la
porta scelta in `PORT`, il database gestito in `DATABASE_URL` e il
file `.env` del progetto in `DOTENV_CONFIG_PATH`. `loadEnv()` valida il contenuto di
queste variabili e genera `JWT_SECRET` in fase di sviluppo se non è impostato. Se rimani in ascolto su
un'altra porta, il pannello di amministrazione non può raggiungere il server; se salti `loadEnv()`, in
assenza di `JWT_SECRET`, l'accesso è disattivato.
`rebase dev` attende inoltre la riga `Server running at http://localhost:<port>`
prima di segnalare che il backend è attivo. Le opzioni `auth` sono quelle dello scaffold; il
runtime legge anche i provider OAuth, le impostazioni email e le altre variabili `AUTH_*`,
quindi passa quelle che utilizzi, come descritto in [Autenticazione](/docs/backend/authentication/).
Il file non serve il pannello di amministrazione compilato in produzione: l'entrypoint
generato da [`rebase eject`](/docs/cli/) lo fa, tramite `serveSPA`, e apre
una connessione per ciascun database dichiarato in `backend/resources.ts`.

`createRebaseBackend` accetta le stesse opzioni di `initializeRebaseBackend`,
senza `app`, `server` e `basePath`, e con `provision` obbligatorio.
Inizializza ogni componente: apre il database, configura auth e storage, carica le
funzioni e i cron job e crea ciascun gruppo di route e il client
in-process. Non effettua alcun mount, non avvia alcun timer e non aggiunge listener di processo. Ognuna
delle operazioni rimanenti è una chiamata da effettuare manualmente o omettere:

| Chiamata | Cosa fa | Se omessa |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra nei log un rigetto di promise non gestito (come una chiamata fire-and-forget in una funzione personalizzata) invece di lasciare che Node termini il processo. Agisce a livello di processo, quindi è una decisione del processo stesso e non di un singolo backend. Restituisce una funzione per disinstallarlo, oppure `undefined` se ne era già presente uno o se `REBASE_EXIT_ON_UNHANDLED_REJECTION` è impostato. | una promise rejection non gestita termina il processo, comportamento predefinito di Node |
| `setDefaultBackend(backend)` | Rende questo backend il [default di processo](#diversi-backend-in-un-unico-processo): ciò a cui rispondono `import { rebase }` e il resto delle API a livello di modulo al di fuori delle richieste, esecuzioni cron e job gestiti da un backend | quell'API non ha alcun backend a cui fare riferimento in quel contesto |
| `backend.mount(app, { basePath })` | Monta ogni gruppo di route sotto `basePath` (predefinito `/api`), dietro i middleware validi per tutto il processo: ID richiesta, limite del body, compressione, CSRF, log delle richieste e l'involucro JSON per errori e percorsi sconosciuti. Include anche il documento JWKS, il server MCP, la documentazione OpenAPI e gli alias delle route legacy. | nulla viene servito tramite HTTP; `backend.rebase` e `backend.fetch` continuano a funzionare |
| `backend.attachRealtime(server, { path })` | Il socket realtime, su `server`, che risponde agli upgrade solo su `path` | non sono presenti live query |
| `backend.start()` | Lo scheduler cron, i worker dei job, i cicli di pulizia dei token scaduti e di conservazione della cronologia, il campionatore delle metriche e l'audit RLS pianificato, ciascuno laddove la proprietà `ownership` lo assegna a questo processo. Sicuro da chiamare più volte. | nessuno di questi viene eseguito, il che corrisponde a ciò che richiede un processo dedicato alle sole richieste in un [deployment suddiviso](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Arresta ciò che `start()` e `attachRealtime()` hanno avviato, attendendo il completamento delle esecuzioni cron e dei job in corso. Chiude `server` solo se viene passato come argomento. | |

Il percorso `path` predefinito del socket è il percorso di base fornito a `mount()` privo del suffisso
`/api`, quindi `/api` produce `/` e `/x/api` produce `/x`; un percorso di base che
non termina con `/api` produce `/`. È lì che
l'SDK si connette, poiché si collega al proprio `baseUrl` mentre le sue richieste HTTP puntano a
`${baseUrl}/api`. Un upgrade a qualsiasi altro percorso viene lasciato agli altri listener
`upgrade` del server, consentendo alla tua app di eseguire il proprio server WebSocket sullo stesso
`http.Server`.

### Cosa può modificare la creazione di un backend: `provision`

La creazione di un backend può eseguire operazioni DDL, pertanto `createRebaseBackend` richiede una scelta esplicita:

| `provision` | Crea | Destinazione d'uso |
|---|---|---|
| `true` | Tutto ciò che il backend gestisce: le tabelle dichiarate e le relative policy RLS, la cattura delle modifiche per il realtime, il ruolo con cui vengono eseguite le richieste e le tabelle interne del framework (chiavi API, esecuzioni cron, job, metriche). | un deployment a processo singolo; il valore passato da `initializeRebaseBackend` |
| `false` | Nulla, né al boot né successivamente: le tabelle che altri backend creano al primo utilizzo (chiavi di idempotenza, claim dei cron) non vengono create. Lo schema deve essere già presente, applicato tramite `rebase db push`, una migrazione o un altro processo. L'assenza di tabelle auth blocca l'avvio al boot; l'assenza di una tabella opzionale disattiva la relativa funzionalità, segnalata nel log. | uno script, un test, un REPL, un processo di sola lettura, un database modificabile unicamente tramite la tua procedura di migrazione |
| `{ tables: false, realtime: false }` | Le tabelle del framework e il ruolo, ma non lo schema delle tabelle dichiarate né la cattura delle modifiche. | un processo che non gestisce lo schema in un deployment suddiviso |

Si tratta intenzionalmente di un'opzione e non di un passaggio successivo. Il driver legge le
tabelle durante l'apertura e associa la cattura delle modifiche a quelle esistenti in quel momento.
Un eventuale `provision()` chiamato successivamente verrebbe eseguito dopo che il driver ha già
determinato gli elementi esistenti. L'impostazione `REBASE_MIGRATE_ON_BOOT=none` disattiva comunque lo schema
delle tabelle per qualsiasi backend nel processo. `initializeRebaseBackend` passa
`false` quando `REBASE_PROVISION=false`.

## Montare solo i gruppi desiderati

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`backend.routes` contiene i gruppi di route. Ciascuno è una sotto-app Hono che puoi
montare singolarmente, su qualsiasi percorso:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` è un elenco di risultati di `defineTable`, `defineAuthTable` e `defineView` — tipicamente tutto ciò che viene esportato da `backend/schema/index.ts` — e `defaultRls` corrisponde a ciò che le relative tabelle con `rls: "inherit"` assumono, ovvero il `defaultRls` esportato da quell'indice. Ogni tabella viene compilata al momento della creazione del backend e qualsiasi errore presente (assenza di `rls`, valore `"inherit"` senza `defaultRls`, una relazione verso una tabella non inclusa nell'elenco) causa il rifiuto dell'operazione sollevando un'eccezione `SchemaDefinitionError` che specifica ciascun problema. Passa invece `schemaDir` per caricare la directory nel modo in cui fa il runtime, incluse le esportazioni dell'index e `defaultRls`; se passi entrambi, `tables` rappresenta quanto viene servito, mentre `schemaDir` è la directory su cui scrive lo schema editor.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Gruppo | Posizione standard | Descrizione |
|---|---|---|
| `routes.auth()` | `/api/auth` | accesso, sessioni, OAuth, reimpostazione password, `GET /config`, chiavi API del chiamante e catalogo degli scope |
| `routes.data()` | `/api/data` | le route REST delle tabelle e la relativa cronologia |
| `routes.storage()` | `/api/storage` | storage dei file o il router che risponde con `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | le tue [funzioni personalizzate](/docs/backend/custom-functions/) o il forwarder verso il processo che le serve |
| `routes.admin()` | `/api/admin` | utenti e ruoli, service key, modifica dello schema, manutenzione dello storage, backup, audit RLS, esportazione SQL, casella di posta per lo sviluppo e log |
| `routes.cron()` | `/api/admin/cron` | l'interfaccia di amministrazione dei cron |
| `routes.meta()` | `/api/meta` | il contratto di progetto letto da un SDK generato |
| `routes.schema()` | `/api/schema` | `GET /tables`: i descrittori di tabella utilizzati per il rendering da CMS e Studio — vedi [Endpoint](/docs/backend/endpoints/#schema) |

Ogni gruppo include i middleware necessari: il contesto di autenticazione che inserisce
`user`, `driver` e `scopes` del chiamante nella richiesta, i relativi rate limit e il
controllo di accesso amministrativo. Pertanto risponde allo stesso modo indipendentemente da dove viene montato,
anche sotto un percorso parametrizzato come `/:tenant/data`. Un gruppo rileva inoltre la posizione in cui è stato
montato, in modo che l'API dei dati continui a instradare ciascuna tabella al relativo database e
l'elenco delle funzioni riporti i percorsi effettivi su cui viene servito.

Un gruppo rifiuta inoltre direttamente `x-rebase-impersonate` e `x-rebase-simulate-*`
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a meno che non si tratti del
gruppo data o functions, che li supportano. La funzione `refuseUnhonouredImpersonation(honouredMounts)`
di `@rebasepro/server` esegue la stessa operazione per le tue route personalizzate.

Ciò che un gruppo non include è il middleware a livello di processo che `mount()` inserisce
a monte di tutto. Quando monti i gruppi singolarmente, aggiungi autonomamente le parti
desiderate: un limite per il body (`bodyLimit` da `hono/body-limit`), la compressione e
l'involucro JSON per gli errori:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Ogni chiamata restituisce un nuovo router basato sugli stessi handler, permettendoti di montare un gruppo in due percorsi diversi. La richiesta di un gruppo la cui superficie non è stata inclusa alla creazione di questo backend (`surfaces: { data: false }`) solleva un errore, poiché il backend non l'ha mai compilata. La documentazione OpenAPI e il server MCP non appartengono a nessun gruppo specifico: descrivono gli URL della struttura creata da `mount()`, quindi solo `mount()` li serve.

## Il backend senza server

Un backend compilato può essere utilizzato senza montare alcun componente.
`backend.rebase` è il suo client in-process, e `backend.fetch(request)`
risponde a una `Request` esattamente come farebbe `mount()` su `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Le chiamate del piano di controllo su quel client (`rebase.auth`, `rebase.admin`,
`rebase.functions` e `rebase.cron`) raggiungono le route del backend
in-process. Funzionano ovunque, a prescindere dal fatto che i gruppi siano stati montati o meno,
e gli eventuali middleware aggiunti alla tua applicazione non vengono eseguiti su di esse.

Per uno script che necessita unicamente dei dati, [`openRebase`](/docs/backend/scripts/)
apre il database senza dover compilare l'intero backend.

## Diversi backend in un unico processo

`createRebaseBackend` non scrive variabili globali di processo. Ciascun backend mantiene il proprio
stato in `backend.services`, pertanto due backend nello stesso processo rimangono isolati: ciascuno
firma e verifica le sessioni con le proprie chiavi, valuta gli scope in base ai propri ruoli,
controlla le chiavi API nel proprio archivio e conteggia i rate limit nel proprio store.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Che cos'è |
|---|---|
| `jwt` | Il servizio JWT del backend: firma e verifica le sessioni, i link di download e gli altri token, oltre a servire il relativo JWKS |
| `access` | Il modello di accesso (mappatura dai ruoli agli scope) e il resolver per il proprietario di una chiave personale |
| `apiKeyStore` | Dove vengono verificate le chiavi API |
| `rateLimitStore`, `authLimiters` | I contatori di rate limit e i limitatori sulle route di autenticazione |
| `tables()` | I descrittori compilati delle tabelle gestite |
| `topics`, `queues` | I runtime dei topic e delle code |

Un backend a cui non viene fornito alcun `auth.jwtSecret`, ad esempio quando `auth` è un adapter,
non firma nulla autonomamente; di conseguenza, il suo `services.jwt` segue il default di processo.

**Le risorse appartengono al processo.** Le dichiarazioni `database()`, `bucket()`, `topic()` e
`queue()` in `backend/resources.ts` sono valori a livello di modulo e
ciascun backend all'interno del processo le legge tutte: un backend il cui progetto non
dichiara alcun topic attiva comunque la propria coda di job se presente un topic in un altro progetto,
e rifiuta l'avvio se il suo driver non è in grado di supportarlo. Esegui le risorse di un solo
progetto per singolo processo. È invece del tutto supportata l'esecuzione di più backend appartenenti allo stesso progetto, ciascuno collegato al proprio database.

**A cosa fa riferimento `rebase`.** All'interno di una richiesta, di un'esecuzione cron o di un job
gestito da un backend, `rebase` — sia importato da `@rebasepro/server` sia ricevuto come
`ctx.rebase` — fa riferimento a quel backend specifico; lo stesso vale per `publish` sui topic ed `enqueue` sulle code.
In qualsiasi altro contesto (scope di modulo, uno script, un test) risponde per il **default di
processo**, impostato da `setDefaultBackend(backend)` e definito da
`initializeRebaseBackend` sul proprio backend. Lo stesso vale per il resto delle
API a livello di modulo: `verifyAccessToken` e gli altri helper JWT,
`getAccessModel`, `verifyCredential` ed `extractUserFromToken`.

Tre elementi interagiscono direttamente con un singolo backend, e uno opera senza alcun backend:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the auth table.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The auth table
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Una sessione creata manualmente viene verificata come qualsiasi altra a ogni richiesta, quindi il suo uid deve appartenere a un utente esistente: in presenza di un uid senza utente associato, la richiesta viene respinta.

`verifyCredential` formula lo stesso esito delle route: una sessione da cui il proprietario si è disconnesso, un uid senza utente associato o un account disabilitato restituiscono null, mentre i ruoli corrispondono a quelli attualmente detenuti dall'account. Solleva un'eccezione se il database non è raggiungibile.

Ogni gruppo di route imposta autonomamente `c.var.services`. Una route al di fuori dei gruppi che utilizza `requireAuth`, `requireScope` o un altro guard di `@rebasepro/server` legge tale valore da lì, ricorrendo al default di processo se non impostato. `requireScope` valuta il chiamante identificato da `requireAuth`, pertanto deve posizionarsi dopo `requireAuth`: utilizzato da solo, rifiuta ogni richiesta restituendo 401. Accetta uno scope predefinito o uno scope applicativo dichiarato dal backend sotto `auth.scopes` nella propria tabella auth, come illustrato nel commento precedente.

Un nome che non corrisponde a uno scope valido, o uno predefinito con un refuso come `data:raed`, solleva un'eccezione al momento della registrazione della route. Uno scope applicativo non dichiarato dal backend che elabora la richiesta risponde a qualunque chiamante, compreso un amministratore, con `500 SCOPE_NOT_DECLARED`.

## Arresto del sistema

Con `initializeRebaseBackend`, affida la gestione del backend all'helper integrato
anziché implementare manualmente un gestore dei segnali. Questo helper esegue il drain delle connessioni HTTP, ferma lo scheduler dei cron,
arresta il realtime, chiude il pool SMTP quando nessun invio è più possibile, protegge da
segnali ripetuti e forza l'uscita se l'arresto si blocca:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**Non** combinarlo con una chiamata personalizzata a `server.close()`: il metodo `shutdown()`
di quel backend chiude già il server fornito, e una seconda chiusura
causa un deadlock. Un backend istanziato con `createRebaseBackend` chiude un server solo se
questo gli viene passato esplicitamente, `backend.shutdown(timeoutMs, { server })`, come illustrato nell'esempio
all'inizio di questa pagina.

## Incorporare il driver Postgres

Scendendo di un ulteriore livello, `@rebasepro/server-postgres` funziona del tutto a prescindere
dal server Rebase: apri il relativo data driver e il socket realtime all'interno di Express, Fastify
o direttamente in Node, assemblando il resto autonomamente. Consulta
[Incorporare il driver Postgres](/docs/backend/embedding-postgres-driver/).

## CORS per un frontend browser

Un server personalizzato gestisce direttamente la propria configurazione CORS, e un frontend residente su un'altra origine può leggere
esclusivamente gli header di risposta esposti. Assicurati di esporre quelli letti dall'SDK, altrimenti
`etagOf(row)` risulterà sempre `undefined` nel client — impedendo l'invio dell'header `If-Match` durante una scrittura
con `ifMatch` — e una risposta 429 perderà l'header `Retry-After`:

```typescript
import express from "express";
import cors from "cors";
import { CORS_EXPOSED_HEADERS } from "@rebasepro/server";

const app = express();
app.use(cors({
    origin: ["https://app.example.com"],
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS]
}));
```

`CORS_EXPOSED_HEADERS` corrisponde all'elenco esposto dal runtime stesso, garantendo che un
header iniziato a essere letto dall'SDK in una versione successiva sia accessibile al tuo frontend senza
necessità di modifiche manuali. Include `ETag`, `Retry-After`, `X-Request-ID`, i tre
header `X-RateLimit-*` e `Preference-Applied`, oltre a `Location`,
`Upload-Offset` e `Rebase-Upload-Result` (usati nelle risposte dei caricamenti ripristinabili per file
superiori a 8 MiB) e `X-Rebase-Simulated-Context`, che indica il contesto di esecuzione simulato di un
amministratore. Senza i tre header di upload, l'SDK non è in grado di tracciare un caricamento proveniente da un'altra origine,
inviando ogni file come una singola richiesta multipart.

Il runtime di Rebase e il backend generato tramite eject inviano già questo elenco.

## Risorse correlate

- [Incorporare il driver Postgres](/docs/backend/embedding-postgres-driver/) — il data driver e il socket realtime da soli, in Express
- [Script e Console](/docs/backend/scripts/) — i dati del progetto da uno script, un test o un REPL, senza server
- [Panoramica Backend](/docs/backend/) — dove risiede ciascuna opzione quando l'avvio è gestito dal runtime
- [Processi suddivisi](/docs/deployment/split-processes/) — i ruoli che un server personalizzato deve riprodurre
- [Configurazione Storage](/docs/backend/storage/) — le sorgenti che un server personalizzato deve risolvere autonomamente
