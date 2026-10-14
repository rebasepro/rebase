---
sourceHash: e3a81a3528add4c5
title: Integrazione Server Personalizzato
sidebar_label: Server Personalizzato
description: Costruisci il backend Rebase da componenti pubblici nel tuo server — createRebaseBackend, i suoi gruppi di rotte, mount, attachRealtime e start — oppure incorpora il driver Postgres in Express.
---

# Integrazione Server Personalizzato

`initializeRebaseBackend` è una scorciatoia. Costruisce l'intero backend, lo monta
sulla tua app Hono sotto `/api`, aggancia il socket realtime al tuo server HTTP e
avvia il lavoro in background, in una sola chiamata. Quando è ciò che vuoi,
usala.

Quando non lo è, scendi di un gradino. Ogni parte di quella chiamata è un componente
pubblico che puoi chiamare tu stesso: costruisci il backend, poi monta tutto o solo
i gruppi di rotte che vuoi, ai percorsi che vuoi, e decidi quale processo avvia i
timer. L'ultima sezione va un passo oltre e incorpora il solo driver Postgres in
un'app Express.

## Configurazione dell'Ambiente

Rebase fornisce un'utilità centralizzata `loadEnv()` in `@rebasepro/server` che valida le variabili d'ambiente rispetto a uno schema Zod rigoroso. Eseguila **dopo** aver caricato il file `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Per aggiungere variabili tipizzate tue, estendi lo schema:

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

L'importazione di `z` da `@rebasepro/server` è una novità. Nella versione 0.17 e
precedenti il pacchetto non esportava `z`: importalo da `zod`, allineando la major version a quella usata
dal runtime, e lascia che il tuo bundler deduplichi le due copie.

:::caution[La versione di `z` con cui estendi deve essere lo zod del runtime]
Avere due copie di zod caricate contemporaneamente è l'unico modo in cui questa chiamata fallisce, e in passato
falliva silenziosamente. `.merge()` accetta uno schema dall'altra copia —
le forme sono identiche — e poi `.parse()` rifiuta ogni campo provvisto di un
`.default()`, poiché un default viene riconosciuto dall'identità di classe. Il server si
avviava, riportava esito positivo e non eseguiva alcuno dei suoi cron; nessun errore
menzionava zod.

Il runtime fornisce `zod`. Il `backend/package.json` dello scaffold lo elenca
nell'intervallo che usa `@rebasepro/server`, così viene installata una sola copia:
mantieni uguali i due. `loadEnv` ora rifiuta uno schema esterno all'avvio con un
messaggio che indica la soluzione, invece di accettarlo e validarlo solo a metà.
:::

**Comportamenti chiave:**
- Genera `JWT_SECRET` e `REBASE_SERVICE_KEY` in fase di sviluppo quando non sono impostati, permettendo l'avvio senza configurazione manuale, e li memorizza in `.rebase-dev-secrets.json` così un riavvio non disconnette nessuno.
- Blocca i segreti generati automaticamente in produzione — è necessario impostarli esplicitamente.
- Valida che `CORS_ORIGINS` o `FRONTEND_URL` siano configurati in produzione.
- Rifiuta uno schema `extend` generato da una copia diversa di zod.
- Lancia un `Error` che nomina ogni variabile mancante o errata, come `DATABASE_URL: is required`, con i problemi rilevati da zod nella sua proprietà `issues`. Su 0.24 lancia il `ZodError` di zod stesso, che non nomina alcuna variabile quando nulla lo intercetta.

Consulta `.env.example` nell'applicazione generata tramite scaffolding per l'elenco completo delle variabili supportate.

## Un gradino sotto `initializeRebaseBackend`

Su 0.24,
`initializeRebaseBackend` è l'unico ingresso, e nessuno dei componenti qui sotto è
esportato.

`initializeRebaseBackend` è queste chiamate, e nient'altro:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({ ...options, provision: true });
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Lo `shutdown()` che restituisce chiude anche il server che gli è stato passato. Ecco la
stessa cosa scritta per esteso come `backend/src/index.ts` di un progetto, pronta da
modificare. `rebase dev` esegue quel file quando un progetto ce l'ha, al posto
dell'avvio proprio del runtime. Incollato in un progetto generato con lo scaffold, serve
ciò che serviva il runtime: l'API sulla porta scelta da `rebase dev`, accesso e
registrazione con la collection degli utenti del progetto, le funzioni in
`backend/functions/`, i cron job in `backend/crons/`, i bucket dichiarati in
`config/resources.ts` e il CORS di cui il pannello di amministrazione ha bisogno sulla
sua porta.

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
import "../../config/resources";
import usersCollection from "../../config/collections/users";
import { storageAuthorize } from "../../config/storage";

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
    collectionsDir: path.join(root, "config/collections"),
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        collection: usersCollection,
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

I percorsi sono quelli dello scaffold. Il file si affida a ciò che imposta `rebase dev`:
la porta scelta in `PORT`, il database gestito in `DATABASE_URL` e il `.env` del
progetto in `DOTENV_CONFIG_PATH`. `loadEnv()` valida ciò che contengono, e in sviluppo
genera `JWT_SECRET` quando non è impostato. Se ascolti su un'altra porta il pannello di
amministrazione non raggiunge il server; se salti `loadEnv()` e `JWT_SECRET` manca,
l'accesso è disattivato.
`rebase dev` aspetta anche la riga `Server running at http://localhost:<port>` prima di
dichiarare il backend attivo. Le opzioni `auth` sono quelle dello scaffold: il runtime
legge anche i provider OAuth, l'email e le altre variabili `AUTH_*`, quindi passa quelle
che usi, come descrive [Autenticazione](/docs/backend/authentication/). Il file non serve
nemmeno il pannello di amministrazione compilato in produzione: lo fa l'entrypoint che
scrive [`rebase eject`](/docs/cli/), con `serveSPA`, e che apre una connessione per ogni
database dichiarato in `config/resources.ts`.

`createRebaseBackend` accetta le stesse opzioni di `initializeRebaseBackend`, senza
`app`, `server` e `basePath`, e con `provision` obbligatorio. Costruisce tutto: apre il
database, configura autenticazione e storage, carica le funzioni e i cron job, e
costruisce ogni gruppo di rotte e il client in-process. Non monta nulla, non avvia alcun
timer e non aggiunge alcun listener di processo. Ognuna delle altre è una chiamata che
fai tu, oppure ometti:

| Chiamata | Cosa fa | Se la ometti |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra nei log una promise rejection che nessuno ha gestito, come una chiamata fire-and-forget in una funzione personalizzata, invece di lasciare che Node termini il processo. Vale per l'intero processo, quindi è una decisione del processo, non di un backend. Restituisce una funzione che lo disinstalla, oppure `undefined` se ne era già installato uno o se `REBASE_EXIT_ON_UNHANDLED_REJECTION` è impostata. | una rejection non gestita termina il processo, il comportamento predefinito di Node |
| `setDefaultBackend(backend)` | Rende questo backend il [default del processo](#più-backend-nello-stesso-processo): ciò a cui rispondono `import { rebase }` e il resto dell'API a livello di modulo fuori dalle richieste, dalle esecuzioni cron e dai job che un backend serve | quell'API non ha alcun backend a cui rispondere lì |
| `backend.mount(app, { basePath })` | Ogni gruppo di rotte sotto `basePath` (predefinito `/api`), dietro il middleware valido per l'intero processo: id delle richieste, limite del corpo, compressione, CSRF, log delle richieste e envelope JSON per gli errori e i percorsi sconosciuti. Inoltre il documento JWKS, il server MCP, la documentazione OpenAPI e gli alias di rotta legacy. | nulla viene servito via HTTP; `backend.rebase` e `backend.fetch` funzionano comunque |
| `backend.attachRealtime(server, { path })` | Il socket realtime, su `server`, che risponde solo agli upgrade su `path` | non ci sono query live |
| `backend.start()` | Lo scheduler cron, i worker dei job, le pulizie dei token scaduti e della retention della cronologia, il campionatore delle metriche e l'audit RLS pianificato, ciascuno dove `ownership` lo assegna a questo processo. Si può chiamare due volte senza rischi. | nessuno di essi viene eseguito, ed è ciò che vuole un processo che serve richieste in un [deployment a processi suddivisi](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Ferma ciò che `start()` e `attachRealtime()` hanno avviato, attendendo le esecuzioni cron e i job in corso. Chiude `server` solo se lo passi. | |

Il `path` predefinito del socket è il percorso base passato a `mount()` privato di un
`/api` finale, quindi `/api` dà `/` e `/x/api` dà `/x`. È lì che si connette l'SDK,
perché si collega al proprio `baseUrl` mentre le sue richieste HTTP vanno a
`${baseUrl}/api`. Un upgrade verso qualsiasi altro percorso viene lasciato agli altri
listener `upgrade` del server, quindi la tua app può eseguire un proprio server
WebSocket sullo stesso `http.Server`.

### Cosa può cambiare la creazione di un backend: `provision`

La creazione di un backend può eseguire DDL, quindi `createRebaseBackend` ti chiede di
decidere:

| `provision` | Crea | Per |
|---|---|---|
| `true` | Tutto ciò che il backend serve: le tabelle delle collection e le loro policy RLS, l'acquisizione delle modifiche per il realtime, il ruolo con cui girano le richieste e le tabelle del framework (chiavi API, esecuzioni cron, job, metriche). | un deployment a processo singolo; ciò che passa `initializeRebaseBackend` |
| `false` | Nulla. Lo schema deve essere già presente, applicato da `rebase db push`, da una migrazione o da un altro processo. Una tabella mancante fa fallire la chiamata nel momento in cui viene usata. | uno script, un test, un REPL, un processo che si limita a leggere |
| `{ collections: false, realtime: false }` | Le tabelle del framework e il ruolo, ma non lo schema delle collection né l'acquisizione delle modifiche. | un processo che, in un deployment suddiviso, non possiede lo schema |

È un'opzione e non un passaggio successivo, di proposito. Il driver legge le tabelle
mentre si apre e collega l'acquisizione delle modifiche a quelle che esistono in quel
momento. Un `provision()` chiamato dopo verrebbe eseguito quando il driver ha già
deciso che cosa esiste. `REBASE_MIGRATE_ON_BOOT=none` continua a disattivare lo schema
delle collection per qualsiasi backend del processo.

## Montare solo i gruppi che vuoi

`backend.routes` contiene i gruppi di rotte. Ciascuno è una sotto-app Hono che puoi
montare da sola, a qualsiasi percorso:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, collections, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`collections` è l'array che esporta il `config/collections/index.ts` di uno scaffold. Porta con sé le `defaultSecurityRules` di quell'indice, come fa `collectionsDir`, così il backend crea le policy che creerebbe `rebase db push`. Un array tuo porta solo le regole che dichiarano le sue collection, e `provision: true` rende accessibile solo agli amministratori una collection che non ne dichiara nessuna, eliminando le policy che Rebase aveva generato in precedenza per essa, su ogni server che condivide il database.

L'indice dello scaffold applica i valori predefiniti al suo array. In un progetto generato con lo scaffold su 0.24, copia quel ciclo dal `config/collections/index.ts` di un nuovo scaffold, oppure passa `collectionsDir`.

| Gruppo | Normalmente a | Serve |
|---|---|---|
| `routes.auth()` | `/api/auth` | accesso, sessioni, OAuth, reimpostazione della password, `GET /config`, le chiavi API personali del chiamante e il catalogo degli scope |
| `routes.data()` | `/api/data` | le rotte REST delle collection e la loro cronologia |
| `routes.storage()` | `/api/storage` | lo storage dei file, oppure il router che risponde `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | le tue [funzioni personalizzate](/docs/backend/custom-functions/), oppure il forwarder verso il processo che le serve |
| `routes.admin()` | `/api/admin` | utenti e ruoli, chiavi di servizio, modifica dello schema, manutenzione dello storage, backup, l'audit RLS, l'export SQL, la casella di posta di sviluppo e i log |
| `routes.cron()` | `/api/admin/cron` | la superficie di amministrazione del cron |
| `routes.meta()` | `/api/meta` | il contratto del progetto che legge un SDK generato |

Ogni gruppo porta con sé il middleware di cui ha bisogno: il contesto di autenticazione
che mette `user`, `driver` e `scopes` del chiamante sulla richiesta, i suoi rate limit e
il suo controllo d'accesso admin. Quindi risponde allo stesso modo ovunque sia montato,
anche sotto un percorso parametrizzato come `/:tenant/data`. Un gruppo legge anche dove
è stato montato, così l'API dei dati instrada ancora ogni collection verso la sua
sorgente dati e l'elenco delle funzioni riporta i percorsi a cui sono realmente servite.

Ciò che un gruppo non porta con sé è il middleware valido per l'intero processo che
`mount()` mette davanti a tutto. Montando i gruppi uno per uno, aggiungi tu ciò che ti
serve: un limite del corpo (`bodyLimit` da `hono/body-limit`), la compressione e
l'envelope JSON degli errori:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Ogni chiamata restituisce un router nuovo sugli stessi handler, quindi puoi montare un
gruppo in due posti. Chiedere un gruppo la cui superficie questo backend è stato creato
senza (`surfaces: { data: false }`) genera un errore, perché il backend non l'ha mai
costruito. La documentazione OpenAPI e il server MCP non hanno un gruppo: descrivono gli
URL del layout di `mount()`, quindi li serve solo `mount()`.

## Il backend senza un server

Un backend che hai costruito può essere usato senza montare nulla. `backend.rebase` è il
suo client in-process, e `backend.fetch(request)` risponde a una `Request` come farebbe
`mount()` su `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, collections, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Le chiamate del piano di controllo su quel client (`rebase.auth`, `rebase.admin`,
`rebase.functions` e `rebase.cron`) raggiungono in-process le rotte del backend stesso.
Funzionano ovunque, o a prescindere dal fatto che tu abbia montato i gruppi, e il
middleware che hai aggiunto alla tua app non viene eseguito su di esse.

Per uno script che ha bisogno solo dei dati, [`openRebase`](/docs/backend/scripts/)
apre il database senza costruire affatto un backend.

## Più backend nello stesso processo

Su 0.24 la configurazione
JWT, il modello di accesso, l'archivio delle chiavi API, l'archivio dei rate limit e
`rebase` sono globali di processo, e vince l'ultimo backend costruito, per tutti.

`createRebaseBackend` non scrive alcun globale di processo. Ogni backend tiene il proprio
stato in `backend.services`, quindi due backend nello stesso processo restano due:
ciascuno firma e verifica le sessioni con le proprie chiavi, valuta gli scope in base ai
propri ruoli, controlla le chiavi API nel proprio archivio e conta i rate limit nel
proprio archivio.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, collections, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, collections, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Che cos'è |
|---|---|
| `jwt` | Il servizio JWT del backend: firma e verifica sessioni, link di download e i suoi altri token, e serve il proprio JWKS |
| `access` | Il suo modello di accesso (da ruoli a scope) e il resolver per il proprietario di una chiave personale |
| `apiKeyStore` | Dove vengono controllate le sue chiavi API |
| `rateLimitStore`, `authLimiters` | I suoi contatori dei rate limit, e i limiter sulle sue rotte di autenticazione |
| `collections()` | Le collection che serve |
| `topics`, `queues` | I suoi runtime di topic e di code |

Un backend a cui non è stato dato alcun `auth.jwtSecret`, come uno il cui `auth` è un
adapter, non firma nulla di suo, quindi il suo `services.jwt` segue il default del
processo.

**Dove va `rebase`.** All'interno di una richiesta, di un'esecuzione cron o di un job che
un backend serve, `rebase`, sia importato da `@rebasepro/server` sia ricevuto come
`ctx.rebase`, è quel backend, e lo sono anche `publish` di un topic ed `enqueue` di una
coda. Altrove (ambito del modulo, uno script, un test) rispondono per il **default del
processo**, che imposta `setDefaultBackend(backend)` e che `initializeRebaseBackend`
imposta sul proprio backend. Lo stesso vale per il resto dell'API a livello di modulo:
`verifyAccessToken` e gli altri helper JWT, `getAccessModel`, `verifyCredential` ed
`extractUserFromToken`.

Tre componenti lavorano direttamente su un backend, e uno su nessun backend:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the users collection.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The users collection
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Una sessione generata viene controllata come qualsiasi altra a ogni richiesta, quindi il
suo uid deve essere quello di un utente esistente: per un uid senza utente la richiesta
viene rifiutata.

`verifyCredential` arriva allo stesso verdetto delle rotte: una sessione da cui il proprietario si è disconnesso, un uid senza utente e un account disattivato restituiscono null, e i ruoli sono quelli che l'account possiede adesso. Lancia un errore quando il database non è raggiungibile. Su 0.24 controlla solo la firma, e legge i ruoli dal token.

Ogni gruppo di rotte imposta da sé `c.var.services`. Una rotta fuori dai gruppi che usa
`requireAuth`, `requireScope` o un altro guard di `@rebasepro/server` lo legge da lì, e
ripiega sul default del processo quando non è impostato. `requireScope` giudica il
chiamante che `requireAuth` ha identificato, quindi va dopo `requireAuth`: da solo rifiuta
ogni richiesta con un 401. Accetta uno scope integrato, oppure uno scope dell'app che il
backend dichiara sotto `auth.scopes` nella sua collection degli utenti, come nel commento
qui sopra.

Un nome che non è uno scope, o uno scope integrato scritto male come `data:raed`, lancia un errore nel punto in cui la rotta viene registrata. Per uno scope dell'app che il backend che risponde non dichiara, ogni chiamante, anche un amministratore, riceve `500 SCOPE_NOT_DECLARED`. Su 0.24 in entrambi i casi ogni chiamante riceve `403 SCOPE_MISSING`.

## Arresto

Un backend creato con
`createRebaseBackend` è una novità; il resto di questa sezione vale anche per 0.24.

Da `initializeRebaseBackend`, passa il backend all'helper integrato invece di scrivere un
signal handler. Svuota le richieste HTTP, arresta lo scheduler cron, smonta il realtime,
chiude il pool SMTP quando nulla può più inviare, protegge da segnali ripetuti ed esce
forzatamente se l'arresto si blocca:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, collections });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**Non** combinarlo con un tuo `server.close()`: lo `shutdown()` di quel backend chiude
già il server che gli è stato passato, e una seconda chiusura porta a un deadlock. Un
backend creato con `createRebaseBackend` chiude un server solo quando glielo passi,
`backend.shutdown(timeoutMs, { server })`, come nell'esempio in cima a questa pagina.

## Incorporare il driver Postgres in Express

Un passo più in basso, `@rebasepro/server-postgres` funziona senza alcun server Rebase.
Dipende da Drizzle e dall'`http.Server` di Node, quindi puoi aprire il driver dei dati e
il socket realtime dentro Express, Fastify o Node semplice. A questo livello assembli tu
il backend: non ci sono rotte di autenticazione, né storage, né API di amministrazione, a
meno che non le costruisca tu.

### 1. Installazione

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

### 2. Aprire il driver e il socket

`openPostgresDriver`
e `postgresDriverConfigFromEnv` sono esportati. Su 0.24, apri il driver con
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, il cui `internals` non è
tipizzato.

```typescript
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import {
    createPostgresDatabaseConnection,
    createPostgresWebSocket,
    openPostgresDriver,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { collections } from "./collections";

async function startServer() {
    const app = express();

    // The socket needs the raw http.Server, so listen on it, not on app.listen.
    // 64 KB of headers, as the Rebase runtime takes: a vector search in the URL
    // outgrows Node's 16 KB.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, app);

    const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

    // The environment, read the way the Rebase server's boot reads it:
    // DATABASE_READ_URL, DATABASE_DIRECT_URL and the REALTIME_* variables.
    // Leave this call out and the driver reads no environment variable at all.
    const pgConfig = postgresDriverConfigFromEnv({ connection: db, connectionString });

    // The collections' tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { collections });

    // The realtime socket. It answers upgrades on `path` only, so a WebSocket
    // server of your own can share the same http.Server.
    createPostgresWebSocket(
        server,
        internals.realtimeService,
        internals.driver,
        { requireAuth: true, jwtSecret: process.env.JWT_SECRET },
        undefined,
        { path: "/" }
    );

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // A write through the driver
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

    // Drizzle directly, typed: `internals.db`, and `internals.readDb` when a
    // read replica is configured.
    app.get("/api/stats", async (req, res) => {
        const result = await internals.db.execute(sql`select count(*) from products`);
        res.json(result.rows);
    });

    const port = process.env.PORT || 3000;
    server.listen(port);

    // Graceful shutdown: stop listening, stop the LISTEN client, evict branch
    // pools, then end the main pool.
    const handleShutdown = (signal: string) => {
        console.log(`Shutdown triggered via ${signal}.`);
        server.close(async () => {
            try {
                await internals.realtimeService.stopListening();
                await internals.poolManager?.shutdown();
                await pool.end();
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

`openPostgresDriver` è ciò che `createPostgresAdapter` esegue quando il server Rebase si
avvia, dopo che `postgresDriverConfigFromEnv` ha letto l'ambiente nella configurazione.
Il suo secondo argomento dice che cosa aprire: le `collections`, se l'apertura può
eseguire il proprio DDL (`provision`, predefinito `true`) e quale parte ha questo processo
nel realtime (`realtime: false` per nessuna).

Non crea alcuna tabella delle collection, quindi su un database che non ne ha una `POST /api/products` risponde `500` "Table not found for collection 'products'". Crea prima le tabelle. Lo fa `rebase db push`, da un progetto Rebase il cui `config/collections` le dichiara. In questo server, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` prima di `openPostgresDriver` aggiunge le tabelle e le colonne che mancano al database, come fa l'avvio del server Rebase, e non modifica nulla di ciò che esiste.

---

## Concetti Chiave del Backend

### Connessioni alle Read Replica
Imposta `readConnectionString` nella configurazione del driver, oppure la variabile d'ambiente `DATABASE_READ_URL`, che l'avvio del server e `postgresDriverConfigFromEnv` leggono in essa, e il driver apre un secondo connection pool verso la tua read replica, sotto `internals.readDb`. Le letture vanno alla replica; le scritture restano sul primario.

L'opzione `readConnectionString` viene rispettata. Su 0.24 era dichiarata e ignorata, e funzionava solo `DATABASE_READ_URL`.

### Integrazione con Drizzle
Non devi scegliere tra Rebase e Drizzle. Il driver compila i tuoi schemi dinamicamente, e `internals.db` è il client Drizzle `NodePgDatabase`, tipizzato, per SQL raw o per i query builder type-safe di Drizzle accanto ai servizi REST di Rebase.

### Drenaggio Corretto delle Connessioni (Graceful Draining)
Negli ambienti serverless o negli orchestratori (come Kubernetes), la chiusura dei pod può causare interruzioni anomale delle connessioni. Implementa sempre signal handler che richiamino `internals.realtimeService.stopListening()` (il quale chiude il client dedicato a pg LISTEN) e `pool.end()`, per prevenire il leak di slot di connessione nel tuo server di database.

### CORS per un frontend nel browser
Un server personalizzato possiede la propria configurazione CORS, e un frontend
su un'altra origine può leggere solo gli header di risposta che espone.
Esponi quelli che l'SDK legge, altrimenti `etagOf(row)` lì è sempre
`undefined` — una scrittura con `ifMatch` parte allora senza `If-Match` — e un
429 perde il suo `Retry-After`:

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

`CORS_EXPOSED_HEADERS` è l'elenco che espone il runtime stesso, così un
header che l'SDK inizia a leggere in una versione successiva raggiunge il tuo frontend senza
modifiche qui. Sono `ETag`, `Retry-After`, `X-Request-ID`, i tre
header `X-RateLimit-*` e `Preference-Applied`, più `Location`,
`Upload-Offset` e `Rebase-Upload-Result`, con cui risponde un upload riprendibile (file oltre
8 MiB). Senza questi tre l'SDK non può seguire un upload da
un'altra origine, e invia ogni file come un'unica richiesta multipart. Sulla 0.24,
scrivi l'elenco a mano.

Il runtime di Rebase e il backend ottenuto con `rebase eject` inviano già questo elenco. Sulla 0.23 non espongono nessuno di questi header, quindi un frontend su un'altra origine non legge alcun `ETag`.

## Correlati

- [Script e console](/docs/backend/scripts/) — i dati del progetto da uno script, da un test o da un REPL, senza alcun server
- [Panoramica Backend](/docs/backend/) — dove risiede ciascuna opzione quando viene invece avviato il runtime
- [Processi Suddivisi](/docs/deployment/split-processes/) — i ruoli che un server personalizzato deve riprodurre
- [Configurazione dello Storage](/docs/backend/storage/) — le sorgenti che un server personalizzato deve risolvere autonomamente
