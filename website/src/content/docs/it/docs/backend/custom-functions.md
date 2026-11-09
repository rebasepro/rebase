---
sourceHash: 0b723d38ab4a2594
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati accanto alle tue route CRUD di Rebase. Rilevamento automatico da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate (custom functions) ti consentono di aggiungere **route API Hono arbitrarie** accanto agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **file-based discovery** (rilevamento basato su file) di collezioni e cron job: inserisci un file TypeScript nella tua directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy verso API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, controlli dello stato (health check)
- **Query aggregate** — statistiche per dashboard, report, analisi

## Definire una funzione personalizzata

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

`POST`, perché è ciò che l'SDK invia per impostazione predefinita — consulta [Invocazione dal client](#invocazione-dal-client). Una route `GET` è altrettanto valida; il chiamante dovrà quindi specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in esecuzione viene montato al ricaricamento successivo — senza riavvio. (È necessario segnalarlo: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo automaticamente.)

## Invocazione dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` costruisce l'URL, allega il token del chiamante e genera un
`RebaseApiError` in caso di stato diverso da 2xx — in modo che la struttura dell'errore
della funzione stessa raggiunga il chiamante anziché un semplice rifiuto di `fetch`.

Quattro parametri accettati oltre al nome:

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
una `POST` e, come `invoke`, restituisce il body testualmente — nessuno dei due cerca di estrarre
una chiave `data`. È preferibile usare `functions.invoke`, che accetta un metodo, un sotto-percorso e un
`responseType`; `call` esiste per le route montate al di fuori di `/api/functions`, che
`invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di boot, i loader dei file, il layer WebSocket — il che è corretto per un entrypoint del server ma è più di quanto serva a un gestore di route (route handler). Fornisce inoltre funzioni di accesso tipizzate al contesto (`getUser`, `getDriver`) invece di dover eseguire il casting manuale di `c.get("user")`.

Consulta [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime individua autonomamente `backend/functions/` (`functions` nella voce `rebase.json` dell'app backend se l'hai spostata). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringono quali funzioni vengono servite da un processo con `REBASE_ROLE=functions`; qualsiasi altro ruolo rifiuterà l'avvio se queste variabili sono impostate.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, oppure `functions` (sotto), in `backend/src/index.ts`.
:::

Abilita le funzioni personalizzate aggiungendo `functionsDir` alla configurazione del tuo backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase effettuerà le seguenti operazioni:

1. Scansiona la directory alla ricerca di file `.ts` / `.js`
2. Valida che ogni export di default sia un'app Hono (verificato tramite duck-typing con `.fetch()` + `.routes`)
3. Monta ciascuna app su `/api/functions/<filename>`
4. Applica il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) di seguito)

### Funzioni come valori

Una directory è un modo per produrre ciò che il server serve: un record dal segmento URL all'app Hono. Puoi passare tu stesso quel record come `functions`, oppure leggere una directory al suo interno con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: la fase di avvio rifiuterà la presenza di entrambi. `loadFunctions(dir, { onSkip })` restituisce ogni file ignorato, specificandone il motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` continuano a funzionare, sono deprecate ed emettono un avviso una sola volta. Preso singolarmente, il gruppo di funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funzionano al suo interno; consulta [Integrazione server personalizzato](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Denominazione dei file e mappatura delle route

| File | Percorso di montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono rilevate **esclusivamente al livello principale della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma non viene mai montato; appiattisci invece il nome (`functions/admin-users.ts`). Una sottodirectory viene segnalata all'avvio e conteggiata nell'endpoint di elenco anziché essere ignorata silenziosamente.

File che vengono **ignorati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più elementi di quanti il runtime ne carichi

Il nome rappresenta l'identità della funzione anche in tutti gli altri contesti: è il segmento dell'URL, il target dello scope `functions:invoke:<name>` di cui una chiave ha bisogno per chiamarla, e il valore utilizzato da `REBASE_FUNCTIONS_ONLY` per selezionarla quando assegni a una funzione un proprio processo dedicato.

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

### Funzione factory

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` restituisce esattamente l'app Hono che questi costruiscono manualmente, quindi i tre approcci sono intercambiabili. Ti evita di dover dichiarare `Hono<HonoEnv>` e ti fornisce il singleton `rebase` nella callback.

---

## Dietro le quinte: il loader basato su duck-typing

In un monorepo, le tue funzioni potrebbero risolvere una copia di Hono diversa da quella utilizzata da Rebase, e in tal caso `exported instanceof Hono` risulterà false anche per un router funzionante. Per questo motivo, il loader ne verifica invece la struttura (`isHonoLike`): un oggetto non nullo con un metodo `.fetch` e un array `.routes`.

### Scappatoia del compilatore ES Module

Il loader converte ogni percorso di file in un URL di file (`pathToFileURL(filePath).href`), in modo che l'importazione funzioni sia su Windows che su POSIX, e richiama `import(url)` tramite `new Function("url", "return import(url)")`, così che una build TypeScript non possa riscriverlo in un `require()` che fallirebbe in ambiente ESM.

---

## Autenticazione e propagazione del contesto

Le funzioni personalizzate sono montate con lo **stesso middleware di autenticazione** delle route dei dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e iniettato** nel contesto, se presente
- Tuttavia, le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- È necessario **proteggere esplicitamente** le route che richiedono l'autenticazione

Un chiamante che presenta un token *non valido* non raggiungerà mai il tuo handler: un token non verificabile o scaduto viene rifiutato con un 401 dal middleware stesso, evitando che una sessione scaduta venga silenziosamente degradata ad anonima.

### Leggere le informazioni del chiamante

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

`getUser` restituisce un oggetto tipizzato in modo ristretto: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione utilizzato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` rappresenta tutto ciò che il chiamante è autorizzato a fare, sotto forma di stringhe di [scope](/docs/backend/roles-and-scopes/): per una persona fisica, il piano dati, gli scope specifici dell'app e gli scope dei suoi ruoli; per una chiave API, esattamente ciò che la chiave contiene.

### Proteggere le route

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

Inserisci i guard nello **slot middleware della route stessa**, come mostrato sopra, piuttosto che usare `app.use("/*", requireAuth)`. `use()` copre solo le route dichiarate *sotto* di esso, quindi una route aggiunta successivamente — in fondo al file, a distanza di mesi — rimarrebbe silenziosamente non protetta.

:::important
La lettura di `getUser(c)` **non** è un guard. Un chiamante anonimo riceve `undefined` e il tuo handler viene comunque eseguito. Solo un guard, o un `if (!user) return 401` esplicito, blocca la richiesta.
:::

### Scope e scope applicativi

`requireAdmin` autorizza il ruolo `admin` e nessun altro. Per un'azione a cui dovrebbe accedere un ruolo più restrittivo o una chiave API, proteggi la route con `requireScope`. Accetta uno [scope](/docs/backend/roles-and-scopes/) integrato oppure uno dichiarato dall'applicazione sotto `auth.scopes` nella collezione degli utenti, come ad esempio `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Ogni utente autenticato possiede tutti gli scope applicativi, quindi per una persona `requireScope` non prende alcuna decisione: verifica nell'handler se questa persona può effettuare il deploy di questo progetto. Ciò che lo scope aggiunge è un modo per **restringere i permessi di una chiave**: una chiave contenente `project:deploy:p1` sarà valida solo per `p1`. Inoltre, una chiave deve possedere `functions:invoke`, o `functions:invoke:<name>`, prima di poter raggiungere la funzione. Consulta [Scope applicativi](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticazione con Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel tuo file `.env` per chiamate da script o server-to-server.

Quando una richiesta esterna trasmette la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione esegue automaticamente le seguenti operazioni:
1. Convalida la chiave mediante un confronto a tempo costante per prevenire attacchi di temporizzazione (timing attack).
2. Concede l'accesso di livello amministratore, impostando il chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` con ambito (scoped) limitato a quella stessa identità di servizio. La Row-Level Security rimane attiva — viene valutata come `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Autenticazione interna automatica

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale per ciascun avvio**. Il singleton `rebase` utilizza automaticamente questa chiave quando effettua chiamate alle API del piano di controllo del server stesso (come `rebase.auth` o `rebase.storage`). Ciò significa che la logica lato server può sempre eseguire operazioni amministrative anche senza una chiave di servizio configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver con ambito utente (user-scoped) — per tutto ciò che serve una richiesta

`getDriver(c)` restituisce il driver **con ambito limitato al chiamante**, in modo che ogni lettura e scrittura sia valutata in base ai criteri di Row-Level Security come quell'utente:

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

`requireDriver(c)` è equivalente a `getDriver(c)` senza il `!` — genera un'eccezione specificando il problema di configurazione anziché fallire venti righe dopo a causa di un valore `undefined`.

### 2. `rebase.dataAsAdmin` — per attività in background affidabili

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.collection<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` è privo di tipi finché non [registri il tuo `Database` generato](/docs/backend/typed-server-data).

### Driver con ambito RLS vs. Singleton Rebase

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Eseguito come**         | Il chiamante (`uid`, i suoi ruoli)                | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS** | ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)                   |
| **Ideale per...**    | CRUD generale dell'utente, ricerche e query          | Job in background, trigger di sistema, webhook                        |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Accessori fluent per collezioni (`rebase.dataAsAdmin.jobs.find`) |

#### Cosa è esattamente `dataAsAdmin`

`rebase.dataAsAdmin` ha **ambito admin, non ignora la RLS**. Il driver viene configurato con questo ambito una sola volta, all'avvio, tramite `withAuth({ uid: "service", roles: ["admin"] })`, quindi ogni operazione di lettura e scrittura viene eseguita all'interno di una transazione che è passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. Le tue policy vengono valutate — rispetto a tale identità.

Per la maggior parte dei progetti la distinzione non emerge mai, poiché le policy predefinite che Rebase inietta in ogni collezione ammettono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. Emerge invece nel momento in cui scrivi le tue policy personalizzate:

- **`policy.serverContext()` risulta false per esso.** Tale helper viene compilato in `rebase.uid() IS NULL`, mentre l'identificatore `uid` di questo accessor è `'service'`. Una collezione con `disableDefaultPolicies: true` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura con `dataAsAdmin` restituendo l'errore Postgres `42501`, e una lettura su tale collezione restituirà **zero righe con HTTP 200** — il comportamento silenzioso. Scrivi `rolesOverlap(["admin"])` (o aggiungilo a fianco) quando intendi "il mio backend".
- **La sua portata equivale a quella di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli concede esattamente le stesse righe visibili a questo accessor. Non si tratta di un canale privato.

### 3. `getSql(c)` — SQL eseguito come chiamante

Quando l'SDK non esprime in modo pulito una query o una scrittura — un upsert condizionale, un `UPDATE … WHERE rev = $3 RETURNING` di tipo compare-and-swap, `count(*) FILTER (…)`, una CTE — scrivi l'SQL ed eseguilo come chiamante:

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

L'istruzione viene eseguita nella transazione del chiamante, con il ruolo ristretto `rebase_user` e la sua identità — la transazione che apre il driver limitato all'utente — quindi sono le regole di sicurezza delle tue collection a decidere ogni riga, esattamente come per l'SDK. Una query che chiede tutte le righe ottiene quelle del chiamante.

- **Sola lettura per impostazione predefinita.** Passa `{ write: true }` per inserire, aggiornare o eliminare; le policy di inserimento e aggiornamento continuano ad applicarsi.
- **Il testo della query è tuo; i valori vanno in `params`** (`$1`, `$2`, …). L'identità del chiamante risiede nelle impostazioni della transazione, che l'SQL può modificare, quindi un'istruzione che potrebbe farlo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, più di un'istruzione — viene rifiutata con `400 SQL_NOT_ALLOWED` prima di essere eseguita. Interpolare input dell'utente nel testo è esattamente ciò che metterebbe alla prova questa protezione; non farlo.
- **Ciò che condivide con l'SDK.** Le policy, e tre regole che Postgres applica a entrambi: una [vista materializzata](/docs/collections/views/#materialized-views) serve le sue righe solo ai suoi `roles`, una riga di una collection che dichiara `tenant` non può essere spostata in un altro tenant se non da un chiamante `bypassRoles` (`TENANT_IMMUTABLE`), e le funzioni proprie del server (`rebase.record_history`, `rebase.enqueue_job`) vengono rifiutate. Una colonna che il chiamante non può leggere — `excludeFromApi`, oppure un `access.read` che non possiede — viene eliminata dalle righe, come fa l'API, quando è un semplice riferimento alla colonna (`SELECT *`, `password_hash AS h`); un valore *calcolato* da essa (`md5(password_hash)`) non viene riconosciuto, quindi non calcolare nulla a partire da una colonna simile.
- **Ciò che non condivide.** `beforeQuery` e `afterRead`, la validazione, i callback di salvataggio e la cronologia vivono in Node e non vengono eseguiti.

Da uno script, [`openRebase`](/docs/backend/embedding-postgres-driver/) ti offre lo stesso: `(await rebase.withAuth(user)).sql(…)`.

### 4. `rebase.sql()` — SQL del proprietario (owner) e l'unico accessor vincolato a Node

Se hai effettivamente bisogno di un bypass incondizionato, `rebase.sql()` fa al caso tuo: SQL non elaborato sulla connessione del proprietario (owner), nessuna policy, visibilità su ogni riga. È l'elemento più privilegiato nel contesto di una funzione — ancor più dell'accessor con "admin" nel nome.

Non serve per creare tabelle. Una tabella è una [collezione](/docs/collections/), dichiarata in `config/collections/` e creata all'avvio; una tabella creata con `CREATE TABLE` all'interno di una funzione non disporrà di convalida, callback, regole di sicurezza, vista di amministrazione o tipi SDK. `rebase.sql()` eseguirà comunque tale istruzione, registrando un avviso nei log che indicherà la collezione da dichiarare in sua vece.

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

Viene eseguito tramite una connessione TCP verso il database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta svantaggi in nessun deployment attuale — è semplicemente l'unico aspetto da tenere a mente qualora una funzione debba essere spostata in seguito. Consulta [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è consentito solo su Node]
Puoi anche importare la tua istanza Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Funziona, e su un deployment Node self-hosted o gestito va benissimo.

Vale la pena conoscere i risvolti: una funzione che importa `drizzle-orm` e un pool `pg` diventa permanentemente una funzione Node, ignora i callback della collezione che `rebase.data` invece esegue (nessuno dei due controlla `validation`, che si applica alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)), e preleva la propria connessione da una sorgente diversa da quella della richiesta. `rebase.sql()` ti fornisce lo stesso SQL raw sfruttando la connessione nativa del framework, e `getSql(c)` te lo fornisce sotto le policy del chiamante. Sono le opzioni consigliate.
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

Una lettura a livello di modulo viene valutata quando il file viene importato, prima che esista qualsiasi richiesta. Su Node ciò significa che una sola variabile mancante compromette l'intero file e tutte le route in esso contenute. Su un host che associa la configurazione alla richiesta anziché al processo, al momento dell'importazione non c'è assolutamente nulla da leggere.

- `getEnv(c)` — ogni variabile visibile a questa richiesta
- `env(c, "NAME")` — una variabile, ripulita da spazi vuoti (trimmed); un valore vuoto è considerato non impostato
- `requireEnv(c, "NAME")` — la stessa cosa, ma genera un'eccezione specificando il nome della variabile
- `lazyResource(factory)` — crea un client costoso in termini di risorse una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` a livello di modulo all'interno della directory delle funzioni.

## Lavoro in background

Il lavoro che deve proseguire oltre la risposta va inserito in `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Una promise senza await sembra equivalente ma non lo è. `waitUntil` offre due vantaggi:

- **Su Node**, la promise viene tracciata, così che un arresto controllato (graceful shutdown) la attenda anziché terminare il processo lasciando ad esempio un webhook inviato a metà. Una promise fluttuante al momento del `SIGTERM` viene semplicemente persa.
- **Su un host basato su isolate**, l'host viene istruito a mantenere attivo l'isolate fino a quando la promise non si stabilizza. Senza di esso, l'elaborazione viene interrotta non appena la risposta viene risolta — silenziosamente, lasciando un codice 200 pulito nei log.

Un rifiuto (rejection) viene registrato nei log invece di essere lasciato al gestore delle rejection non gestite, consentendo di risalire al percorso da cui ha avuto origine il fallimento.

Il codice eseguito all'esterno di una richiesta non dispone di `c` da passare: un inizializzatore a livello di modulo, un helper condiviso tra route e cron, o un'attività avviata da un'esecuzione cron senza attenderne il completamento. Passa a `waitUntil` solo l'attività:

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

L'attività viene tracciata per il graceful shutdown e le eventuali rejection vengono registrate, proprio come con `c`. Ciò che non può fare è mantenere attivo un isolate, poiché quest'ultimo costituisce il contesto di esecuzione della richiesta: passa `c` ogniqualvolta sia presente una richiesta. Le attività che un'esecuzione cron, un job o un gestore di code possono semplicemente attendere con `await` dovrebbero essere attese; l'esecuzione è infatti ciò che la procedura di arresto attende e il relativo esito viene registrato insieme a essa.

L'arresto attende al massimo 5 secondi per questo lavoro. Le attività che richiedono minuti devono essere collocate in un [cron job](/docs/backend/cron-jobs/) o in un [job](/docs/backend/jobs/), che sono tracciati e riavviabili. Inoltre, un cron job viene eseguito [uno alla volta tra le varie istanze](/docs/backend/cron-across-instances/#concurrency-guarding), indipendentemente dal fatto che sia stato avviato dalla pianificazione o da un trigger manuale.

## Portabilità del runtime

Una funzione personalizzata è un'app Hono, quindi la possibilità di eseguirla altrove rispetto a un processo Node dipende da cosa importa il file stesso. `rebase.sql()`, un client di database importato direttamente e i moduli integrati di Node la vincolano a Node; il resto di `rebase` e la piattaforma web non lo fanno, e attualmente nulla fallisce a causa di nessuno dei due. La sezione [Portabilità del runtime](/docs/backend/runtime-portability/) elenca ciò che è portabile, il modo in cui `rebase build` e `rebase doctor` lo segnalano e come gestire i rami condizionali in base al runtime.

## Ordine di registrazione delle route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato la configurazione di base. L'ordine di inizializzazione è il seguente:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di archiviazione (storage)** — `/api/storage/*`
4. **Route dei dati** — `/api/data/*` (CRUD per le collezioni)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Ciò significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra qualsiasi route che debba essere eseguita **prima** di Rebase direttamente sull'app Hono, prima di chiamare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua app in questo modo si trovano **all'esterno** di ogni router di Rebase, pertanto su di esse non è stato eseguito alcun middleware di autenticazione e `getDriver(c)` non è impostato. Proteggi tali route con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano autonomamente il token. I guard nel sottopercorso `/functions` leggono un'identità già risolta da un router Rebase e restituiranno 500 anziché fingere che ne esista una.
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
            await rebase.dataAsAdmin.collection("subscriptions").create({
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

## Debug

Quando le funzioni vengono caricate, il boot registra nei log `Loaded custom functions` con il relativo conteggio. La riga corrispondente a ciascuna funzione viene registrata a livello `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se il caricamento fallisce, il loader fornisce un output di diagnostica:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Il router viene montato per la **directory**, non per le singole funzioni in essa contenute. Se l'importazione di ogni file fallisce — una sola variabile di ambiente mancante a livello di modulo è sufficiente per comprometterli tutti — una `GET /api/functions` risponderà comunque `200` con un elenco vuoto e il conteggio di `skipped`, consentendo di distinguere "nessun elemento caricato" da "questa build non include funzioni". L'elenco stesso richiede un chiamante autenticato, una chiave API con lo scope semplice `functions:invoke` o la service key — le funzioni rimangono invocabili da chiunque ciascuna di esse autorizzi, ma il loro inventario non è pubblico. I motivi rimangono consultabili nei log di avvio.

## Timeout e limiti di frequenza (Rate Limit)

Due soglie massime si applicano a `/api/functions/*`:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, con risposta `504` e codice `FUNCTION_TIMEOUT`. Si configura con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disabilita. L'handler non può essere interrotto dall'esterno, ma viene notificato: `getSignal(c)` di `@rebasepro/server/functions` viene interrotto (aborted) al momento del 504, quindi è consigliabile passarlo a `fetch` e a qualsiasi altra operazione che accetti un signal (`fetch(url, { signal: getSignal(c) })`). Il lavoro a cui non viene passato il signal continua — il timeout libera il client e il socket, non l'elaborazione. Il fatto che l'handler *continui a essere eseguito* dopo il 504 è una caratteristica propria dei processi Node a lunga durata, non una garanzia del contratto; qualsiasi operazione che debba necessariamente completarsi deve essere inserita in [`waitUntil`](#lavoro-in-background).
- **Rate limit** — I chiamanti autenticati e quelli con chiave API condividono i bucket dell'API dei dati. I chiamanti anonimi ottengono una quota dedicata e molto più ampia (3000 per finestra temporale), poiché questo router è pubblico per impostazione predefinita per consentire la ricezione dei webhook. Puoi sovrascriverlo con `rateLimit.anonymousFunctions`; `null` lo disattiva.

Le rejection di promise non gestite vengono registrate nei log anziché risultare irreversibili: in caso contrario, una chiamata fire-and-forget in una funzione arresterebbe l'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per ripristinare il comportamento predefinito di Node.

Su Rebase Cloud, l'edge a monte delle tue funzioni presenta limiti propri, e lo stato a livello di modulo, il filesystem e le porte in uscita si comportano in modi che è utile conoscere prima di progettare l'architettura. Consulta [Runtime backend gestito](/docs/deployment/managed-runtime/).

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Callback delle entità](/docs/collections/callbacks)** — Esegui logica alle modifiche dei dati
- **[Cron Job](/docs/backend/cron-jobs)** — Attività pianificate in background
