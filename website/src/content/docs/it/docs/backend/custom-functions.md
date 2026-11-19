---
sourceHash: 03f5153ebeb46a08
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati insieme alle tue route CRUD di Rebase. Individuati automaticamente da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate ti consentono di aggiungere **route API Hono arbitrarie** insieme agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **individuazione basata su file** dei cron job: inserisci un file TypeScript nella directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy verso API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, controlli dello stato (health check)
- **Query aggregate** — statistiche della dashboard, report, analisi

## Definizione di una funzione personalizzata

Crea un file nella tua directory `backend/functions/` che esporti come default un'app Hono:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/", async (c) => {
        const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
        return c.json({ message: `Hello, ${name ?? "world"}!` });
    });
});
```

Questo viene montato su **`/api/functions/hello`**. Il nome del file (senza estensione) diventa il prefisso della route.

`POST`, perché è ciò che l'SDK invia per impostazione predefinita — vedi [Invocazione dal client](#invoke-from-the-client). Una route `GET` è altrettanto valida; il chiamante dovrà quindi specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in
esecuzione viene montato al ricaricamento successivo — senza riavvio. (Va precisato: la
directory viene scansionata anziché importata, quindi il watcher non può dedurlo automaticamente.)

## Invoke from the client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` compone l'URL, allega il token del chiamante e genera un
`RebaseApiError` in caso di risposta diversa da 2xx — in questo modo la struttura di errore
della funzione stessa raggiunge il chiamante anziché restituire un semplice rifiuto di `fetch`.

Quattro parametri aggiuntivi accettati oltre al nome:

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// A function that answers text or a file (`c.text(csv)`, `c.body(pdf)`).
// The answer is read as JSON unless you say otherwise: "text" gives a string,
// "blob" a Blob, "response" the Response itself with its body unread.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
Anche `client.call("functions/hello", payload)` raggiunge una funzione. Esegue sempre
una `POST` e, come `invoke`, restituisce il body testualmente — nessuno dei due cerca
una chiave `data`. È preferibile usare `functions.invoke`, che accetta un metodo, un sotto-percorso e un
`responseType`; `call` esiste per le route montate all'esterno di `/api/functions`, che
`invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il subpath è la superficie di authoring *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di avvio, i loader di file, il layer WebSocket — il che è appropriato per un entry point del server ma più di quanto serva a un gestore di route. Ti fornisce inoltre funzioni di accesso tipizzate al contesto (`getUser`, `getDriver`) invece di dover eseguire manualmente il cast di `c.get("user")`.

Vedi [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime individua autonomamente `backend/functions/` (`functions` nella voce `rebase.json` dell'app backend se l'hai spostata). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo con `REBASE_ROLE=functions`; qualsiasi altro ruolo rifiuta l'avvio se queste variabili sono impostate.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, o `functions` (in basso), in `backend/src/index.ts`.
:::

Abilita le funzioni personalizzate aggiungendo `functionsDir` alla configurazione del tuo backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase provvederà a:

1. Scansionare la directory alla ricerca di file `.ts` / `.js`
2. Convalidare che ogni esportazione di default sia un'app Hono (tramite duck typing con `.fetch()` + `.routes`)
3. Montare ogni app su `/api/functions/<filename>`
4. Applicare il middleware di autenticazione (vedi [Autenticazione](#authentication-and-context-propagation) di seguito)

### Funzioni come valori

Una directory è uno dei modi per produrre ciò che il server espone: un record che mappa segmenti di URL ad app Hono. Puoi passare direttamente questo record come `functions`, oppure leggere una directory al suo interno con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: la fase di avvio rifiuterà la presenza di entrambi. `loadFunctions(dir, { onSkip })` restituisce ogni file ignorato insieme al relativo motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecati e generano un unico avviso. Preso singolarmente, il gruppo delle funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e al suo interno funzionano `getUser(c)` e `getDriver(c)`; vedi [Integrazione server personalizzata](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Denominazione dei file e mappatura delle route

| File | Percorso di montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono individuate **esclusivamente al livello principale della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma non viene mai montato; appiattisci invece il nome (`functions/admin-users.ts`). Eventuali sottodirectory vengono segnalate all'avvio e conteggiate nell'endpoint di elenco anziché essere ignorate silenziosamente.

File che vengono **ignorati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più di quanto il runtime carichi

Il nome rappresenta l'identità della funzione anche in tutti gli altri contesti: è il segmento dell'URL, il target dello scope `functions:invoke:<name>` necessario a una chiave per chiamarla e il valore in base al quale `REBASE_FUNCTIONS_ONLY` effettua la selezione quando assegni a una funzione un proprio processo dedicato.

## Formati di esportazione

Il loader accetta due formati di esportazione oltre a `defineFunction`:

### App Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Funzione Factory

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` restituisce esattamente l'app Hono creata manualmente da questi metodi, rendendo i tre formati intercambiabili. Ti evita di dover dichiarare `Hono<HonoEnv>` e fornisce il singleton `rebase` nella callback.

---

## Dietro le quinte: il loader basato su duck typing

In un monorepo le tue funzioni potrebbero risolvere una copia di Hono diversa da quella usata da Rebase; in questo caso, `exported instanceof Hono` risulterebbe false anche per un router perfettamente funzionante. Per questo motivo il loader ne verifica invece la struttura (`isHonoLike`): un oggetto non nullo dotato di un metodo `.fetch` e di un array `.routes`.

### Escape dal compilatore per moduli ES

Il loader converte ogni percorso di file in un URL di file (`pathToFileURL(filePath).href`), in modo da importarlo correttamente sia su Windows che su sistemi POSIX, e chiama `import(url)` tramite `new Function("url", "return import(url)")`, evitando così che una build TypeScript lo riscriva in una chiamata `require()` destinata a fallire in ambiente ESM.

---

## Authentication and Context Propagation

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e inserito** nel contesto, se presente
- Le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- È necessario **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che presenta un token *non valido* non raggiungerà mai il tuo handler: un token non verificabile o scaduto viene rifiutato con un 401 direttamente dal middleware, evitando così che una sessione scaduta venga declassata silenziosamente a una sessione anonima.

### Lettura del chiamante

```typescript
import { defineFunction, getUser, getUserId, getRoles, getScopes, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c), scopes: getScopes(c) });
    });
});
```

`getUser` restituisce un oggetto tipizzato: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione utilizzato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` rappresenta tutto ciò che il chiamante è autorizzato a fare, sotto forma di stringhe di [scope](/docs/backend/roles-and-scopes/): per un utente reale, il piano dati, gli scope specifici dell'app e gli scope dei suoi ruoli; per una chiave API, esattamente ciò che la chiave include.

### L'account del chiamante

`getUser(c)` legge il token di accesso, e il token contiene l'ID, i ruoli e l'indirizzo del chiamante. Non indica come l'account effettua l'accesso né quale sia il suo nome visualizzato. `getUserProfile(c)` legge queste informazioni dall'archivio di autenticazione:

```typescript
import { defineFunction, getUserProfile } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/whoami", async (c) => {
        const profile = await getUserProfile(c);
        if (!profile) return c.json({ error: "Unauthorized" }, 401);
        // { uid, email?, displayName?, photoURL?, emailVerified, isAnonymous, providers }
        return c.json({ name: profile.displayName ?? null, social: profile.providers.some(p => p !== "password") });
    });
});
```

`providers` elenca le modalità con cui l'account può accedere: `"password"` quando ne possiede una, seguito da ogni provider collegato (`"google"`, `"apple"`, …) nell'ordine in cui è stato associato. Un account ospite, o uno che accede solo tramite codice monouso, ha un elenco vuoto.

La lettura è aggiornata per ciascuna richiesta: un provider collegato dal chiamante un momento prima apparirà nella richiesta successiva, senza dover attendere l'aggiornamento del token. La prima chiamata all'interno di una richiesta comporta due ricerche indicizzate, eseguite insieme. Le chiamate successive nella stessa richiesta riutilizzano il risultato, mentre una richiesta che non lo chiama mai non ha alcun costo.

Restituisce `undefined` per un chiamante anonimo, per un chiamante con chiave di servizio o chiave API che non agisce come un account e per un account non più esistente. Restituisce `undefined` anche su un backend i cui account risiedono su un [adapter di autenticazione](/docs/backend/auth-adapters/) esterno: in tal caso, interroga direttamente quel provider. Quando un amministratore invia l'header `x-rebase-impersonate`, restituisce l'account impersonato.

### Protezione delle route

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without the admin role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Inserisci i guard nello **slot del middleware della route stessa**, come mostrato sopra, piuttosto che usare `app.use("/*", requireAuth)`. `use()` copre solo le route dichiarate *sotto* di esso; pertanto, una route aggiunta in seguito — in fondo al file, mesi dopo — rimarrebbe silenziosamente non protetta.

:::important
La lettura di `getUser(c)` **non** è un guard. Un chiamante anonimo riceve `undefined` e il tuo handler viene comunque eseguito. Solo un guard o un controllo esplicito `if (!user) return 401` interrompe la richiesta.
:::

### Scope e scope dell'app

`requireAdmin` consente l'accesso solo al ruolo `admin` e a nessun altro. Per un'azione a cui dovrebbe accedere un ruolo più ristretto o una chiave API, proteggi la route con `requireScope`. Questo accetta uno [scope](/docs/backend/roles-and-scopes/) predefinito o uno dichiarato dall'app in `auth.scopes` nella collezione degli utenti, come ad esempio `"project:deploy": { label: "Deploy projects", target: "project" }`:

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING unless the caller holds project:deploy, or project:deploy:<this project>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // The same question inside a handler.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Ogni utente autenticato possiede tutti gli scope dell'applicazione, quindi per un utente reale `requireScope` non è determinante: verifica all'interno dell'handler se tale persona è autorizzata a distribuire questo progetto. Ciò che lo scope aggiunge è un modo per **restringere i permessi di una chiave**: una chiave che possiede `project:deploy:p1` sarà valida esclusivamente per `p1`. Una chiave necessita inoltre di `functions:invoke`, o `functions:invoke:<name>`, prima di poter accedere alla funzione. Vedi [Scope dell'applicazione](/docs/backend/roles-and-scopes/#app-scopes).

### Rate limit

Una route che comporta un costo computazionale o economico per chiamata può utilizzare il middleware `rateLimit`, che esegue il conteggio tra le varie repliche. Vedi [Rate limit nelle funzioni](/docs/backend/function-rate-limits/).

### Autenticazione tramite chiave di servizio

Rebase supporta una variabile statica `REBASE_SERVICE_KEY` definita nel tuo file `.env` per chiamate da script o comunicazioni server-to-server.

Quando una richiesta esterna trasmette la chiave di servizio tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione esegue automaticamente le seguenti operazioni:
1. Convalida la chiave mediante un confronto a tempo costante per prevenire attacchi di temporizzazione (timing attack).
2. Concede l'accesso a livello di amministratore, impostando il chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inserisce un `DataDriver` associato a tale identità di servizio. La Row-Level Security rimane attiva — viene valutata come `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Autenticazione interna autonoma

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale a ogni avvio**. Il singleton `rebase` utilizza automaticamente questa chiave per chiamare le API del piano di controllo del server stesso (come `rebase.auth` o `rebase.storage`). Ciò significa che la logica lato server può sempre eseguire operazioni amministrative anche senza una chiave di servizio configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver associato all'utente — per tutto ciò che serve una richiesta

`getDriver(c)` restituisce il driver **associato al chiamante**, in modo che ogni lettura e scrittura venga valutata in base ai criteri di Row-Level Security per quell'utente specifico:

```typescript
import { defineFunction, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", requireAuth, async (c) => {
        const driver = requireDriver(c);
        const myProducts = await driver.fetchCollection({ path: "products", limit: 10 });
        return c.json(myProducts);
    });
});
```

`requireDriver(c)` è l'equivalente di `getDriver(c)` senza `!` — solleva un'eccezione specificando il problema di configurazione anziché fallire venti righe dopo su un valore `undefined`.

`fetchCollection` e `fetchOne` restituiscono le stesse righe restituite da `GET /api/data/<table>`: date come stringhe RFC 3339, una relazione `belongsTo` come chiave esterna (`authorId`) e una riga correlata solo se specificata in `include` — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — per attività in background affidabili

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.table<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` non è tipizzato finché non [registri il tuo `Database` generato](/docs/backend/typed-server-data).

### Driver associato a RLS vs. Singleton Rebase

|                     | `getDriver(c)` (associato alla richiesta)      | `rebase.dataAsAdmin` (identità di servizio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Esecuzione come** | Il chiamante (`uid`, i suoi ruoli)             | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS**| ✅ Sì (valutata rispetto al chiamante)         | ✅ Sì (valutata rispetto all'identità di servizio)                |
| **Ideale per...**   | CRUD utente generale, ricerche e query         | Job in background, trigger di sistema, webhook                   |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Accessor fluenti per tabelle (`rebase.dataAsAdmin.jobs.find`)    |

#### Cosa rappresenta esattamente `dataAsAdmin`

`rebase.dataAsAdmin` è **associato al ruolo admin, non un bypass di RLS**. Il driver viene configurato una sola volta all'avvio con `withAuth({ uid: "service", roles: ["admin"] })`, quindi ogni lettura e scrittura viene eseguita all'interno di una transazione passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. I tuoi criteri vengono valutati — rispetto a tale identità.

Per la maggior parte dei progetti questa distinzione non emerge mai, poiché i criteri predefiniti inseriti da Rebase su ciascuna tabella ammettono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. Emerge invece nel momento in cui definisci criteri personalizzati:

- **`policy.serverContext()` risulta false per essa.** Tale helper viene compilato in `rebase.uid() IS NULL`, mentre l'`uid` di questo accessor è `'service'`. Una tabella con `defaultPolicies: false` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura con `dataAsAdmin` generando l'errore Postgres `42501`, e una lettura su tale tabella restituirà **zero righe con HTTP 200** — l'esito silenzioso. Specifica `rolesOverlap(["admin"])` (o aggiungilo contestualmente) quando intendi "il mio backend".
- **Il suo raggio d'azione equivale a quello di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione garantisce esattamente l'accesso alle righe visibili a questo accessor. Non si tratta di un canale privato.

### 3. `getSql(c)` — SQL come chiamante

Quando l'SDK non consente di esprimere una query o una scrittura in modo lineare — un upsert condizionale, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, una CTE — scrivi direttamente l'SQL ed eseguilo con l'identità del chiamante:

```typescript
import { defineFunction, getSql, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/my-stats", requireAuth, async (c) => {
        const sql = getSql(c);
        const rows = await sql(
            "SELECT lower(artist) AS artist, count(*) FILTER (WHERE liked) AS likes FROM songs WHERE lang = $1 GROUP BY 1",
            { params: [c.req.query("lang") ?? "en"] }
        );
        return c.json(rows);
    });
});
```
I valori sono quelli di Postgres, con due formattati nello stesso modo di `/api/data`: un `timestamptz` è in formato RFC 3339 in UTC (`2026-11-18T10:52:23.500Z`), e un `bigint` è un numero se rientra in un intero sicuro (oltre 2^53 rimane sotto forma di cifre, come stringa). Un tipo `numeric` è una stringa, in modo da non perdere alcuna cifra; esegui il cast nella query (`total::float8`) se hai bisogno di un numero.

L'istruzione viene eseguita nella transazione del chiamante, sotto il ruolo ristretto `rebase_user` con la sua identità — la stessa transazione aperta dal driver associato all'utente — quindi le regole `rls` delle tue tabelle determinano ogni riga, esattamente come avviene con l'SDK. Una query che richiede tutte le righe otterrà solo quelle dell'utente chiamante.

- **Sola lettura per impostazione predefinita.** Passa `{ write: true }` per eseguire insert, update o delete; i criteri di inserimento e aggiornamento continuano ad applicarsi.
- **Il testo della query è il tuo; i valori vanno in `params`** (`$1`, `$2`, …). L'identità del chiamante risiede nelle impostazioni di transazione, che l'SQL potrebbe modificare; pertanto, qualsiasi istruzione che potrebbe farlo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, istruzioni multiple — viene rifiutata con `400 SQL_NOT_ALLOWED` prima dell'esecuzione. L'interpolazione dell'input utente nel testo metterebbe alla prova questo controllo; non farlo.
- **Cosa condivide con l'SDK.** I criteri e tre regole applicate da Postgres a entrambi: una [vista materializzata](/docs/collections/views/#materialized-views) restituisce le proprie righe solo ai suoi `roles`, una riga di una tabella che dichiara un `tenant` non può essere spostata su un altro tenant se non da un chiamante con `bypassRoles` (`TENANT_IMMUTABLE`), e le funzioni interne del server (`rebase.record_history`, `rebase.enqueue_job`) vengono rifiutate. Una colonna che il chiamante non è autorizzato a leggere — `.private()` o un `.access({ read })` non posseduto — viene rimossa dalle righe, come accade nell'API, quando si tratta di un riferimento diretto alla colonna (`SELECT *`, `password_hash AS h`); un valore *calcolato* da essa (`md5(password_hash)`) non viene riconosciuto, quindi evita di utilizzarlo nei calcoli.
- **Cosa non condivide.** `beforeQuery` e `afterRead`, la validazione, gli hook di salvataggio e la cronologia risiedono in Node e non vengono eseguiti.

Da uno script, [`openRebase`](/docs/backend/embedding-postgres-driver/) offre la stessa funzionalità: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL come identità di servizio

Una funzione che applica regole personalizzate (un ticket al giorno, una verifica temporale) su tabelle leggibili solo dagli amministratori non può usare `getSql(c)`: il chiamante necessiterebbe di criteri che gli consentano l'accesso, e quegli stessi criteri esporrebbero le tabelle anche sull'API dati pubblica. `rebase.sqlAsAdmin` esegue l'istruzione come `{ uid: "service", roles: ["admin"] }`, l'identità usata da `rebase.dataAsAdmin`, con la medesima row-level security:

```typescript
import { defineFunction, rebase } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/claim", async (c) => {
        const { device } = await c.req.json();
        const rows = await rebase.sqlAsAdmin(
            "INSERT INTO tickets (device, day) VALUES ($1, current_date) ON CONFLICT DO NOTHING RETURNING id",
            { params: [device], write: true }
        );
        return c.json({ claimed: rows.length === 1 });
    });
});
```

È equivalente a `getSql(c)` ma con un'identità differente: il ruolo di richiesta ristretto, il ramo admin dei tuoi criteri, sola lettura salvo `{ write: true }` e la stessa protezione `SQL_NOT_ALLOWED`. A differenza di `rebase.sql()` dell'owner, non può eseguire DDL e, per quanto riguarda l'archivio di autenticazione, accede unicamente a ciò che un admin può raggiungere tramite la collezione utenti: sessioni, chiavi e segreti MFA sono preclusi al ruolo di richiesta, e l'hash della password viene rimosso dalle righe. Una singola istruzione comporta un solo round trip, esattamente come `rebase.sql()`. Da uno script, è accessibile anche tramite `openRebase()`.

### 4. `rebase.sql()` — SQL dell'owner e l'unico accessor per solo ambiente Node

Se necessiti realmente di un bypass incondizionato, `rebase.sql()` è ciò che fa per te: SQL grezzo sulla connessione dell'owner, senza criteri di sicurezza, con accesso a ogni riga. È l'elemento più privilegiato nel contesto di una funzione — più ancora dell'accessor con la parola "admin" nel nome.

Non serve per creare tabelle. Una tabella viene [dichiarata](/docs/schema/) con `defineTable` in `backend/schema/` e creata all'avvio; una tabella creata con `CREATE TABLE` all'interno di una funzione non dispone di validazione, hook, impostazione di row-level security, visualizzazione nell'admin o tipi SDK. `rebase.sql()` consente l'esecuzione di tale istruzione, ma registra un avviso indicando la tabella da dichiarare formalmente.

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", requireAuth, requireAdmin, async (c) => {
        const rows = await rebase.sql(
            "SELECT count(*) AS total FROM jobs WHERE status = $1",
            { params: ["published"] }
        );
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

Viene eseguito tramite una connessione TCP verso il database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta svantaggi sui deployment attuali — è semplicemente l'unico aspetto da tenere presente se una funzione dovesse essere trasferita altrove in futuro. Vedi [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è consentito solo su Node]
Puoi anche importare la tua istanza di Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Funziona, e su un deployment Node self-hosted o gestito va benissimo.

È utile tuttavia sapere cosa comporta: una funzione che importa `drizzle-orm` e un pool `pg` diventa permanentemente una funzione per Node, bypassa gli hook di tabella eseguiti da `rebase.data` (nessuno dei due controlla `.validate()`, che si applica alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)) e preleva la propria connessione al di fuori della richiesta. `rebase.sql()` offre lo stesso SQL grezzo attraverso la connessione interna del framework, mentre `getSql(c)` lo rende disponibile nel rispetto dei criteri del chiamante. È consigliabile preferire questi ultimi.
:::

## Configurazione e segreti

Leggi la configurazione **all'interno** dell'handler, mai a livello di modulo (module scope):

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Built once, on the first request that needs it — not at import time.
const apiKey = lazyResource((env) => env.PRICING_API_KEY ?? "");

export default defineFunction((app) => {
    app.get("/price", async (c) => {
        const endpoint = requireEnv(c, "PRICING_API_URL");
        const response = await fetch(endpoint, {
            headers: { authorization: `Bearer ${apiKey(c)}` }
        });
        return c.json(await response.json());
    });
});
```

Perché questo è importante su **qualsiasi** runtime, incluso Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lettura a livello di modulo viene valutata al momento dell'importazione del file, prima che esista alcuna richiesta. Su Node ciò significa che una sola variabile mancante compromette l'intero file e tutte le route in esso contenute. Su un host che assegna la configurazione alla richiesta anziché al processo, non c'è assolutamente nulla da leggere al momento dell'importazione.

- `getEnv(c)` — ogni variabile visibile per questa richiesta
- `env(c, "NAME")` — una singola variabile, con rimozione degli spazi (trimmed); un valore vuoto viene considerato non impostato
- `requireEnv(c, "NAME")` — come sopra, ma solleva un'eccezione specificando il nome della variabile mancante
- `lazyResource(factory)` — crea un client oneroso una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` a livello di modulo all'interno della directory delle funzioni.

## Attività in background

Spostato nella pagina dedicata: [Attività in background](/docs/backend/background-work/).

## Portabilità del runtime

Una funzione personalizzata è un'app Hono, quindi la possibilità di eseguirla al di fuori di un processo Node dipende da ciò che il file stesso importa. `rebase.sql()`, un client di database importato direttamente e i moduli integrati di Node la vincolano a Node; il resto di `rebase` e la piattaforma web non lo fanno, e nulla oggi fallisce a causa di nessuno dei due. [Portabilità del runtime](/docs/backend/runtime-portability/) elenca gli elementi portabili, come `rebase build` e `rebase doctor` li segnalano e come gestire i rami di esecuzione in base al runtime.

## Ordine di registrazione delle route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato l'inizializzazione principale. L'ordine di inizializzazione è:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi in tempo reale
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di archiviazione** — `/api/storage/*`
4. **Route dei dati** — `/api/data/*` (CRUD per tabelle)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni in tempo reale

Ciò significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra qualsiasi route che debba essere eseguita **prima** di Rebase direttamente sull'app Hono, prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua app in questo modo si trovano **all'esterno** di ogni router di Rebase, pertanto nessun middleware di autenticazione è stato eseguito su di esse e `getDriver(c)` non è impostato. Proteggi tali route con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano autonomamente il token. I guard presenti nel sottopercorso `/functions` leggono un'identità già risolta da un router Rebase e risponderanno con 500 anziché fingere che ne esista una.
:::

## Esempio: Gestore di webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Constructed on the first request, from that request's configuration. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberately public: Stripe has no token to send. The signature is the
    // authentication, so verify it before doing anything else.
    app.post("/", async (c) => {
        const signature = c.req.header("stripe-signature");
        const body = await c.req.text();

        if (!signature || !verifySignature(body, signature, secret(c))) {
            return c.json({ error: "Bad signature" }, 400);
        }

        const event = JSON.parse(body) as { type: string; data: { object: Record<string, string> } };

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            await rebase.dataAsAdmin.table("subscriptions").create({
                user_id: session.client_reference_id,
                stripe_id: session.subscription,
                status: "active",
            });
            // Fulfilment can outlive the response; the 200 tells Stripe to stop retrying.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Debugging

Quando le funzioni vengono caricate, il log di avvio mostra `Loaded custom functions` con il relativo conteggio. La riga dedicata a ciascuna funzione viene registrata al livello `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se il caricamento non va a buon fine, il loader fornisce un output di diagnostica:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Il router viene montato per la **directory**, non per le singole funzioni in essa contenute. Se l'importazione di ogni file fallisce — una sola variabile d'ambiente mancante a livello di modulo è sufficiente per bloccarli tutti — `GET /api/functions` risponde comunque `200` con un elenco vuoto e un conteggio dei file `skipped`, distinguendo così "nessun elemento caricato" da "questa build non includeva funzioni". L'elenco stesso richiede un chiamante autenticato, una chiave API con lo scope generico `functions:invoke` o la chiave di servizio — le funzioni rimangono invocabili da chiunque ciascuna di esse autorizzi, ma il loro inventario non è pubblico. I dettagli rimangono nel log di avvio.

## Timeout e rate limit

Due limiti massimi si applicano a `/api/functions/*`:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, rispondendo con `504` e codice `FUNCTION_TIMEOUT`. Configurabile tramite `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disabilita. L'handler non può essere interrotto dall'esterno, ma riceve una notifica: `getSignal(c)` da `@rebasepro/server/functions` viene interrotto al momento dell'errore 504, quindi passalo a `fetch` e a qualsiasi altra chiamata che accetti un segnale (`fetch(url, { signal: getSignal(c) })`). Le operazioni a cui non viene passato il segnale proseguono — il timeout libera il client e il socket, non il lavoro in corso. Il fatto che l'handler *continui a essere eseguito* dopo il 504 è una caratteristica dei processi Node a esecuzione prolungata, non una garanzia del contratto; qualsiasi operazione che debba necessariamente completarsi appartiene a [`waitUntil`](#attività-in-background).
- **Rate limit** — I chiamanti autenticati e con chiave API condividono i bucket dell'API dati. I chiamanti anonimi dispongono di un limite dedicato, molto più permissivo (3000 per intervallo), poiché questo router è pubblico per impostazione predefinita per ricevere i webhook. È possibile sovrascriverlo con `rateLimit.anonymousFunctions`; impostare su `null` per disattivarlo.

I rifiuti di promise non gestiti (unhandled promise rejections) vengono registrati anziché essere considerati fatali: una chiamata fire-and-forget in una funzione provocherebbe altrimenti l'arresto dell'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per ripristinare il comportamento predefinito di Node.

Su Rebase Cloud, l'edge a monte delle tue funzioni presenta limiti propri, e lo stato a livello di modulo, il filesystem e le porte in uscita si comportano in modi che è opportuno conoscere prima di strutturare l'architettura. Vedi [Runtime backend gestito](/docs/deployment/managed-runtime/).

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esegui logica in risposta alle modifiche dei dati
- **[Cron job](/docs/backend/cron-jobs)** — Attività pianificate in background
