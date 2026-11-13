---
sourceHash: c42fc466c64146e7
title: Integrazione Server Personalizzato
sidebar_label: Server Personalizzato
description: Costruisci il backend Rebase a partire da componenti pubblici nel tuo server — createRebaseBackend, i suoi gruppi di route, mount, attachRealtime e start — oppure incorpora il driver Postgres in Express.
---

# Integrazione Server Personalizzato

`initializeRebaseBackend` è una scorciatoia. Costruisce l'intero backend, lo
monta sulla tua app Hono sotto `/api`, collega il socket realtime al tuo server
HTTP e avvia i task in background, tutto in un'unica chiamata. Quando questo è
ciò di cui hai bisogno, usalo.

Quando non lo è, fai un passo verso il basso. Ogni parte di quella chiamata è un
componente pubblico che puoi invocare autonomamente: crea il backend, poi montalo
per intero o solo i gruppi di route che desideri, nei percorsi che preferisci, e
decidi quale processo avvia i timer. [Incorporare il driver Postgres](/docs/backend/embedding-postgres-driver/)
fa un passo ulteriore e apre unicamente il driver Postgres in un'app Express.

## Configurazione dell'ambiente

Rebase fornisce un'utilità `loadEnv()` centralizzata in `@rebasepro/server` che valida le tue variabili d'ambiente rispetto a un rigido schema Zod. Invocala **dopo** aver caricato il tuo file `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Per aggiungere le tue variabili tipizzate, estendi lo schema:

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
Il caricamento simultaneo di due copie di zod causava la rottura silenziosa di
questa chiamata. `loadEnv` combinava gli schemi con `.merge()`, che accetta uno
schema dall'altra copia e successivamente rifiuta ogni campo che include un
`.default()`. Il server si avviava, segnalava il successo e non eseguiva alcuno
dei suoi cron; nessun errore menzionava zod.

`loadEnv` ora valida lo schema di base e il tuo schema `extend` ciascuno con il
proprio `.parse()`, in modo che uno schema creato da un'altra copia di zod funzioni
correttamente. Il runtime fornisce `zod`, e il file `backend/package.json` dello
scaffold lo elenca nello stesso intervallo utilizzato da `@rebasepro/server`,
garantendo l'installazione di un'unica copia: mantienile allineate.
:::

**Comportamenti chiave:**
- Genera `JWT_SECRET` e `REBASE_SERVICE_KEY` in fase di sviluppo quando non sono impostati, permettendoti di iniziare senza configurazioni manuali, e li memorizza nella cache in `.rebase-dev-secrets.json` in modo che un riavvio non disconnetta nessuno.
- Blocca i secret generati automaticamente in produzione — devi impostarli esplicitamente.
- Verifica che in produzione sia impostato `CORS_ORIGINS` o `FRONTEND_URL`.
- Rifiuta un valore `extend` che non sia uno schema zod.
- Genera un `Error` indicando ciascuna variabile mancante o errata, come ad esempio `DATABASE_URL: is required`, con i problemi di zod nella sua proprietà `issues`.

Consulta `.env.example` nell'applicazione di scaffold per l'elenco completo delle variabili supportate.

## Un passo sotto `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Da 0.31</span>

`initializeRebaseBackend` è composto da queste chiamate e niente di più:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ collections: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Il metodo `shutdown()` restituito chiude anche il server fornito. Ecco la
stessa configurazione scritta come `backend/src/index.ts` di un progetto, pronta
per essere modificata. `rebase dev` esegue tale file quando un progetto ne possiede
uno, al posto del boot proprio del runtime. Incollato in un progetto scaffoldato,
serve ciò che serviva il runtime: le API sulla porta scelta da `rebase dev`,
accesso e registrazione con la tabella auth del progetto, le tabelle esportate
da `backend/schema/index.ts`, gli hook globali in `backend/hooks.ts`, le funzioni
in `backend/functions/`, i cron job in `backend/crons/`, i bucket dichiarati in
`backend/resources.ts` e il CORS richiesto dal pannello di amministrazione sulla
propria porta.

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

I percorsi sono quelli dello scaffold; ometti l'import e l'opzione `hooks`
quando il progetto non ha `backend/hooks.ts`. Gli utenti sono memorizzati nella
tabella dichiarata da `backend/schema` con `defineAuthTable`, quindi `auth` non
specifica alcuna tabella. Il file si affida a ciò che imposta `rebase dev`: la
porta scelta in `PORT`, il database gestito in `DATABASE_URL` e il file `.env`
del progetto in `DOTENV_CONFIG_PATH`. `loadEnv()` convalida questi dati e genera
`JWT_SECRET` in ambiente di sviluppo se non è impostato. Se ascolti su un'altra
porta, il pannello di amministrazione non potrà raggiungere il server; se salti
`loadEnv()` e non c'è `JWT_SECRET`, il login sarà disattivato.
`rebase dev` attende inoltre la riga `Server running at http://localhost:<port>`
prima di segnalare che il backend è attivo. Le opzioni `auth` sono quelle dello
scaffold; il runtime legge anche i provider OAuth, le email e le altre variabili
`AUTH_*`, quindi passa quelle che utilizzi, come descritto in [Autenticazione](/docs/backend/authentication/).
Inoltre, il file non serve il pannello di amministrazione compilato in produzione:
l'entrypoint generato da [`rebase eject`](/docs/cli/) lo fa tramite `serveSPA`,
aprendo una connessione per ciascun database dichiarato in `backend/resources.ts`.

`createRebaseBackend` accetta le stesse opzioni di `initializeRebaseBackend`,
escluse `app`, `server` e `basePath`, con `provision` obbligatorio. Costruisce
tutto: apre il database, configura auth e storage, carica le funzioni e i cron
job, e compila ciascun gruppo di route e il client in-process. Non monta nulla,
non avvia timer e non aggiunge listener al processo. Ciascuna delle altre
operazioni è una chiamata che puoi effettuare o omettere:

| Chiamata | Cosa fa | Se la ometti |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra il rigetto di una promise non gestito (come una chiamata fire-and-forget in una funzione personalizzata), invece di lasciare che Node termini il processo. Si applica a livello di processo, quindi è una decisione del processo stesso e non di un singolo backend. Restituisce una funzione che lo disinstalla, oppure `undefined` se ne era già installato uno o se `REBASE_EXIT_ON_UNHANDLED_REJECTION` è impostato. | una rejection non gestita termina il processo, comportamento predefinito di Node |
| `setDefaultBackend(backend)` | Rende questo backend il [default di processo](#più-backend-in-un-singolo-processo): ciò per cui `import { rebase }` e il resto dell'API a livello di modulo rispondono al di fuori delle richieste, esecuzioni di cron e job serviti da un backend | quell'API non ha alcun backend a cui fare riferimento in quel contesto |
| `backend.mount(app, { basePath })` | Ogni gruppo di route sotto `basePath` (predefinito `/api`), protetto dal middleware di processo: ID richiesta, limite del body, compressione, CSRF, log delle richieste e l'envelope JSON per errori e percorsi sconosciuti. Inoltre include il documento JWKS, il server MCP, la documentazione OpenAPI e gli alias delle route legacy. | nulla viene servito tramite HTTP; `backend.rebase` e `backend.fetch` continuano a funzionare |
| `backend.attachRealtime(server, { path })` | Il socket realtime, su `server`, che risponde agli upgrade solo su `path` | non ci sono query live |
| `backend.start()` | Lo scheduler dei cron, i worker dei job, i cicli di pulizia dei token scaduti e di retention della cronologia, il campionatore delle metriche e l'audit RLS pianificato, ciascuno dove `ownership` lo assegna a questo processo. Sicuro da chiamare due volte. | nessuno di essi viene eseguito, che è ciò che desidera un processo dedicato alle richieste in un [deployment suddiviso](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Arresta ciò che `start()` e `attachRealtime()` hanno avviato, attendendo l'esecuzione dei cron e dei job in corso. Chiude `server` solo se lo passi come argomento. | |

Il `path` predefinito del socket è il percorso di base passato a `mount()` privo
del `/api` finale, quindi `/api` produce `/` e `/x/api` produce `/x`; un percorso
di base che non termina con `/api` produce `/`. È lì che l'SDK si connette,
poiché contatta la sua `baseUrl` mentre le sue richieste HTTP vanno su
`${baseUrl}/api`. Una richiesta di upgrade verso qualsiasi altro percorso viene
lasciata agli altri listener `upgrade` del server, consentendo alla tua applicazione
di eseguire il proprio server WebSocket sullo stesso `http.Server`.

### Cosa può modificare la creazione di un backend: `provision`

La creazione di un backend può eseguire istruzioni DDL, pertanto `createRebaseBackend` richiede di specificare:

| `provision` | Crea | Destinazione d'uso |
|---|---|---|
| `true` | Tutto ciò che il backend serve: le tabelle dichiarate e le relative policy RLS, il change capture per il realtime, il ruolo con cui vengono eseguite le richieste e le tabelle interne del framework (chiavi API, esecuzioni cron, job, metriche). | un deployment a processo singolo; ciò che passa `initializeRebaseBackend` |
| `false` | Nulla, né all'avvio né successivamente: non vengono create nemmeno le tabelle che gli altri backend creano al primo utilizzo (chiavi di idempotenza, claim dei cron). Lo schema deve essere già presente, applicato tramite `rebase db push`, una migrazione o un altro processo. Le tabelle di autenticazione mancanti bloccano l'avvio con errore; una tabella opzionale mancante ne disattiva la relativa funzionalità, segnalata nel log. | uno script, un test, una REPL, un processo di sola lettura, un database che solo il tuo processo di change management può modificare |
| `{ collections: false, realtime: false }` | Le tabelle del framework e il ruolo, ma non lo schema delle tabelle dichiarate né il change capture. La chiave mantiene il suo nome precedente. | un processo che non è proprietario dello schema in un deployment suddiviso |

È stata concepita intenzionalmente come un'opzione anziché come un passaggio
successivo. Il driver legge le tabelle all'apertura e collega il change capture
a quelle già esistenti in quel momento. Un `provision()` invocato in un secondo
momento verrebbe eseguito dopo che il driver ha già stabilito cosa esiste.
`REBASE_MIGRATE_ON_BOOT=none` disabilita comunque lo schema delle tabelle per
qualsiasi backend nel processo. `initializeRebaseBackend` passa `false` quando
`REBASE_PROVISION=false`.

## Montare solo i gruppi desiderati

<span class="since-badge" data-since="0.31">Da 0.31</span>

`backend.routes` contiene i gruppi di route. Ognuno di essi è una sotto-app
Hono che puoi montare autonomamente, su qualsiasi percorso:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` è un elenco di risultati di `defineTable`, `defineAuthTable` e `defineView` — tipicamente tutto ciò che esporta `backend/schema/index.ts` — e `defaultRls` è ciò che assumono le tabelle con `rls: "inherit"`, ovvero il `defaultRls` esportato da quell'index. Ogni tabella viene compilata al momento della creazione del backend e qualsiasi anomalia (assenza di `rls`, `"inherit"` senza `defaultRls`, una relazione verso una tabella non presente nell'elenco) ne impedisce la creazione con un `SchemaDefinitionError` che specifica ciascun problema. Passa invece `schemaDir` per caricare la directory nel modo in cui fa il runtime, incluse le esportazioni dell'index e `defaultRls`; se passi entrambi, `tables` è ciò che viene servito mentre `schemaDir` è ciò in cui scrive l'editor dello schema.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Gruppo | Percorso standard | Funzione |
|---|---|---|
| `routes.auth()` | `/api/auth` | autenticazione, sessioni, OAuth, reimpostazione password, `GET /config`, le chiavi API dell'utente chiamante e il catalogo degli scope |
| `routes.data()` | `/api/data` | le route REST delle tabelle e la loro cronologia |
| `routes.storage()` | `/api/storage` | storage dei file, oppure il router che risponde con `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | le tue [funzioni personalizzate](/docs/backend/custom-functions/), oppure l'inoltratore verso il processo che le serve |
| `routes.admin()` | `/api/admin` | utenti e ruoli, chiavi di servizio, modifica dello schema, manutenzione dello storage, backup, audit RLS, esportazione SQL, mailbox di sviluppo e log |
| `routes.cron()` | `/api/admin/cron` | la superficie di amministrazione dei cron |
| `routes.meta()` | `/api/meta` | il contratto del progetto letto da un SDK generato |
| `routes.schema()` | `/api/schema` | `GET /tables`: i descrittori delle tabelle da cui il CMS e lo Studio effettuano il rendering — vedi [Endpoint](/docs/backend/endpoints/#schema) |

Ciascun gruppo include i middleware di cui ha bisogno: il contesto di
autenticazione che inserisce `user`, `driver` e `scopes` del chiamante nella
richiesta, i relativi rate limit e il gate di amministrazione. Di conseguenza
risponde allo stesso modo indipendentemente da dove viene montato, anche sotto
un percorso parametrizzato come `/:tenant/data`. Un gruppo rileva inoltre dove
è stato montato, per cui l'API dei dati continua a instradare ogni tabella verso
il relativo database e l'elenco delle funzioni riporta i percorsi sui quali viene
effettivamente servito.

Un gruppo rifiuta autonomamente `x-rebase-impersonate` e `x-rebase-simulate-*`
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a meno che non si
tratti del gruppo dei dati o delle funzioni, che invece li supportano.
`refuseUnhonouredImpersonation(honouredMounts)` di `@rebasepro/server` fa lo
stesso per le tue route personalizzate.

Ciò che un gruppo non include sono i middleware a livello di processo che
`mount()` posiziona a monte di tutto. Montando i gruppi singolarmente, dovrai
aggiungere tu stesso ciò che desideri: un limite al body (`bodyLimit` da
`hono/body-limit`), la compressione e l'envelope JSON degli errori:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Ogni chiamata restituisce un nuovo router basato sugli stessi handler,
permettendoti di montare un gruppo in due punti diversi. Richiedere un gruppo
la cui superficie non è stata inclusa alla creazione del backend (`surfaces: { data: false }`)
genera un'eccezione, poiché il backend non l'ha mai compilata. La documentazione
OpenAPI e il server MCP non appartengono ad alcun gruppo: descrivono gli URL del
layout di `mount()`, quindi solo `mount()` li serve.

## Il backend senza server

Un backend che hai costruito può essere utilizzato senza montare nulla.
`backend.rebase` è il suo client in-process, e `backend.fetch(request)`
risponde a una `Request` esattamente come farebbe `mount()` su `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Le chiamate del control-plane su tale client (`rebase.auth`, `rebase.admin`,
`rebase.functions` e `rebase.cron`) raggiungono le route del backend in-process.
Funzionano ovunque, a prescindere che tu abbia montato o meno i gruppi, e i
middleware aggiunti alla tua applicazione non vengono eseguiti su di esse.

Per uno script che necessita solo dei dati, [`openRebase`](/docs/backend/scripts/)
apre il database senza dover compilare alcun backend.

## Più backend in un singolo processo

`createRebaseBackend` non scrive alcun globale di processo. Ciascun backend
mantiene il proprio stato in `backend.services`, quindi due istanze nello stesso
processo rimangono distinte: ciascuna firma e verifica le sessioni con le
proprie chiavi, valuta gli scope in base ai propri ruoli, verifica le chiavi API
nel proprio store e conteggia i rate limit nel proprio store.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Descrizione |
|---|---|
| `jwt` | Il servizio JWT del backend: firma e verifica le sessioni, i link di download e gli altri token, e serve il relativo JWKS |
| `access` | Il modello di accesso (mappatura dai ruoli agli scope) e il resolver per il proprietario di una chiave personale |
| `apiKeyStore` | Dove vengono verificate le chiavi API |
| `rateLimitStore`, `authLimiters` | I contatori di rate limit e i limitatori sulle route di autenticazione |
| `tables()` | I descrittori compilati delle tabelle servite |
| `topics`, `queues` | I runtime di topic e code |

Un backend privo di `auth.jwtSecret`, ad esempio uno la cui autenticazione è
gestita tramite adapter, non firma nulla autonomamente, per cui il suo
`services.jwt` segue il default di processo.

**Le risorse appartengono al processo.** Le dichiarazioni `database()`,
`bucket()`, `topic()` e `queue()` in `backend/resources.ts` sono valori a
livello di modulo, e ogni backend nel processo le legge tutte: un backend il
cui progetto non dichiara alcun topic attiva comunque la propria coda di job per
il topic di un altro progetto, e rifiuterà l'avvio se il suo driver non è in grado
di gestirne uno. Esegui le risorse di un solo progetto per processo. È invece
del tutto supportato avere più backend appartenenti allo stesso progetto,
ciascuno sul proprio database.

**A cosa punta `rebase`.** All'interno di una richiesta, di un'esecuzione cron
o di un job servito da un backend, `rebase` — sia importato da `@rebasepro/server`
sia ricevuto come `ctx.rebase` — corrisponde a quel backend specifico, e lo stesso
vale per `publish` del topic ed `enqueue` della coda. In qualsiasi altro contesto
(ambito di modulo, uno script, un test) risponde al **default di processo**,
impostato da `setDefaultBackend(backend)` e che `initializeRebaseBackend` assegna
al proprio backend. Lo stesso vale per il resto dell'API a livello di modulo:
`verifyAccessToken` e gli altri helper JWT, `getAccessModel`, `verifyCredential`
ed `extractUserFromToken`.

Tre componenti interagiscono direttamente con un singolo backend, e uno non
richiede alcun backend:

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

Una sessione generata viene verificata come qualsiasi altra a ogni richiesta,
quindi il suo uid deve appartenere a un utente esistente: se l'uid non corrisponde
ad alcun utente, la richiesta viene rifiutata.

`verifyCredential` perviene al medesimo esito delle route: una sessione da cui il
proprietario si è disconnesso, un uid senza utente e un account disabilitato
restituiscono null, e i ruoli corrispondono a quelli attualmente assegnati
all'account. Genera un'eccezione se il database non è raggiungibile.

Ciascun gruppo di route imposta autonomamente `c.var.services`. Una route al di
fuori dei gruppi che utilizza `requireAuth`, `requireScope` o un'altra guard di
`@rebasepro/server` lo legge da lì, tornando al default di processo quando non è
impostato. `requireScope` valuta il chiamante identificato da `requireAuth`, quindi
deve essere posizionato dopo `requireAuth`: utilizzato da solo, rifiuta ogni
richiesta con un 401. Accetta uno scope integrato o uno scope applicativo dichiarato
dal backend sotto `auth.scopes` nella relativa tabella di autenticazione, come
illustrato nel commento precedente.

Un nome che non corrisponde a uno scope, o uno integrato scritto male come
`data:raed`, genera un errore al momento della registrazione della route. Uno
scope applicativo non dichiarato dal backend che gestisce la richiesta restituisce
a qualsiasi chiamante, anche a un amministratore, `500 SCOPE_NOT_DECLARED`.

## Arresto

A partire da `initializeRebaseBackend`, passa il backend all'helper integrato
anziché scrivere un gestore dei segnali personalizzato. Questo drena le connessioni
HTTP, arresta lo scheduler dei cron, disattiva il realtime, chiude il pool SMTP
quando non c'è più nulla da inviare, protegge da segnali ripetuti e forza l'uscita
se l'arresto si blocca:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**Non** combinarlo con il tuo `server.close()`: il metodo `shutdown()` di quel
backend chiude già il server fornito, e una seconda chiusura provocherebbe un
deadlock. Un backend ottenuto con `createRebaseBackend` chiude il server solo se
lo passi esplicitamente, `backend.shutdown(timeoutMs, { server })`, come nell'esempio
all'inizio di questa pagina.

## Incorporare il driver Postgres

Scendendo ancora di un livello, `@rebasepro/server-postgres` può funzionare
completamente senza il server Rebase: apri il relativo data driver e il socket
realtime all'interno di Express, Fastify o semplice Node, assemblando il resto
autonomamente. Vedi [Incorporare il driver Postgres](/docs/backend/embedding-postgres-driver/).

## CORS per un frontend browser

Un server personalizzato gestisce la propria configurazione CORS, e un frontend
residente su un'altra origine può leggere solo gli header di risposta esposti.
Esponi quelli letti dall'SDK, altrimenti `etagOf(row)` risulterà sempre
`undefined` — una scrittura con `ifMatch` verrebbe quindi inviata senza `If-Match` —
e un codice 429 perderebbe il suo `Retry-After`:

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

`CORS_EXPOSED_HEADERS` è l'elenco esposto dal runtime stesso, garantendo che
qualsiasi header che l'SDK inizi a leggere in una versione successiva raggiunga
il tuo frontend senza dover apportare modifiche. Comprende `ETag`, `Retry-After`,
`X-Request-ID`, i tre header `X-RateLimit-*` e `Preference-Applied`, oltre a
`Location`, `Upload-Offset` e `Rebase-Upload-Result` (con cui risponde un
caricamento ripristinabile per file superiori a 8 MiB) e
`X-Rebase-Simulated-Context` (che specifica il contesto di simulazione con cui è
stata eseguita una richiesta amministrativa). Senza i tre header per l'upload,
l'SDK non può gestire un upload da un'altra origine e invierà ogni file come
singola richiesta multipart.

Il runtime di Rebase e il backend espulso (ejected) inviano già questo elenco.

## Correlati

- [Incorporare il driver Postgres](/docs/backend/embedding-postgres-driver/) — il data driver e il socket realtime da soli, in Express
- [Script e console](/docs/backend/scripts/) — i dati del progetto da uno script, un test o una REPL, senza alcun server
- [Panoramica del backend](/docs/backend/) — dove risiede ciascuna opzione quando invece si avvia il runtime
- [Processi suddivisi](/docs/deployment/split-processes/) — i ruoli che un server personalizzato deve riprodurre
- [Configurazione dello storage](/docs/backend/storage/) — le sorgenti che un server personalizzato deve risolvere autonomamente
