---
sourceHash: 41e067cb49021d45
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati accanto alle tue route CRUD di Rebase. Rilevamento automatico da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate consentono di aggiungere **route API Hono arbitrarie** accanto agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **rilevamento basato su file** dei cron job: inserisci un file TypeScript nella directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy API esterni
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, health check
- **Query aggregate** — statistiche per dashboard, report, analisi

## Definire una funzione personalizzata

Crea un file nella directory `backend/functions/` che esporti come default un'app Hono:

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

`POST`, perché è ciò che l'SDK invia per impostazione predefinita — vedi [Invocare dal client](#invocare-dal-client). Una route `GET` è altrettanto valida; in tal caso il chiamante deve specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in esecuzione viene montato al ricaricamento successivo — senza riavvio. (Va specificato: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo automaticamente).

## Invocare dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` costruisce l'URL, allega il token del chiamante e genera un `RebaseApiError` in caso di risposta non-2xx — in modo che la struttura dell'errore definita dalla funzione stessa raggiunga il chiamante anziché un semplice rifiuto di `fetch`.

Quattro parametri che accetta oltre al nome:

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
`client.call("functions/hello", payload)` raggiunge anch'esso una funzione. Esegue sempre una `POST` e, come `invoke`, restituisce il corpo testuale — nessuno dei due cerca di estrarre una chiave `data`. È preferibile usare `functions.invoke`, che accetta un metodo, un sotto-percorso e un `responseType`; `call` esiste per le route montate all'esterno di `/api/functions`, che `invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sotto-percorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta per esso può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di boot, i loader dei file, il livello WebSocket — il che è corretto per l'entrypoint di un server, ma superfluo per un gestore di route. Inoltre, fornisce funzioni di accesso tipizzate al contesto (`getUser`, `getDriver`) anziché dover eseguire il casting manuale di `c.get("user")`.

Consulta [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** niente da configurare — il runtime rileva `backend/functions/` da solo (`functions` nella voce `rebase.json` dell'app backend se è stato spostato). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo con `REBASE_ROLE=functions`; qualsiasi altro ruolo rifiuterà l'avvio se queste variabili sono impostate.
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

Rebase eseguirà quanto segue:

1. Scansiona la directory alla ricerca di file `.ts` / `.js`
2. Convalida che ogni export di default sia un'app Hono (tramite duck typing con `.fetch()` + `.routes`)
3. Monta ciascuna app su `/api/functions/<filename>`
4. Applica il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) di seguito)

### Funzioni come valori

Una directory è uno dei modi per produrre ciò che il server gestisce: un record da segmento URL ad app Hono. Puoi passare direttamente tale record come `functions`, o leggerlo da una directory con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: la procedura di avvio rifiuta la combinazione di entrambi. `loadFunctions(dir, { onSkip })` restituisce ogni file ignorato specificandone il motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecate ed emettono un avviso una sola volta. Da solo, il gruppo delle funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funzionano al suo interno; vedi [Integrazione server personalizzato](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

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
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più di quanto il runtime carichi

Il nome costituisce l'identità della funzione anche in ogni altro ambito: è il segmento URL, la destinazione dello scope `functions:invoke:<name>` richiesto da una chiave per invocarla, e il valore utilizzato da `REBASE_FUNCTIONS_ONLY` per la selezione quando assegni a una funzione un proprio processo dedicato.

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

`defineFunction` restituisce esattamente l'app Hono che questi costruiscono manualmente, quindi i tre formati sono intercambiabili. Risparmia la dichiarazione di `Hono<HonoEnv>` e fornisce il singleton `rebase` nel callback.

---

## Dietro le quinte: il loader basato su Duck-Typing

In un monorepo le tue funzioni potrebbero risolvere una copia di Hono diversa da quella usata da Rebase, e quindi `exported instanceof Hono` risulterebbe false pur trattandosi di un router valido. Pertanto, il loader verifica invece la struttura (`isHonoLike`): un oggetto non nullo dotato di un metodo `.fetch` e di un array `.routes`.

### Escape del compilatore per ES Module

Il loader converte ogni percorso di file in un URL di file (`pathToFileURL(filePath).href`), in modo da eseguire l'importazione sia su Windows che su POSIX, e chiama `import(url)` tramite `new Function("url", "return import(url)")`, evitando così che una build TypeScript lo riscriva in una `require()` non valida in ESM.

---

## Autenticazione e propagazione del contesto

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e inserito** nel contesto, se presente
- Le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- È necessario **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che presenta un token *non valido* non raggiunge mai il tuo handler: un token non verificabile o scaduto viene respinto con un 401 dal middleware stesso, evitando così che una sessione scaduta venga declassata silenziosamente a una anonima.

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

`getUser` restituisce un oggetto tipizzato in modo restrittivo: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione utilizzato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` rappresenta tutto ciò che il chiamante è autorizzato a fare, sotto forma di stringhe di [scope](/docs/backend/roles-and-scopes/): per una persona, il data plane, gli scope dell'app e quelli associati ai suoi ruoli; per una chiave API, esattamente ciò che la chiave contiene.

### L'account del chiamante

`getUser(c)` legge il token di accesso, che contiene l'ID, i ruoli e l'indirizzo del chiamante. Non indica come l'account effettua l'accesso né qual è il suo nome visualizzato. `getUserProfile(c)` recupera queste informazioni dall'archivio di autenticazione:

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

`providers` elenca le modalità con cui l'account può accedere: `"password"` quando disponibile, seguita da ciascun provider collegato (`"google"`, `"apple"`, …) nell'ordine di associazione. Un account ospite, o uno che accede solo tramite codice monouso, ha un elenco vuoto.

La lettura viene aggiornata a ogni richiesta: un provider collegato poco prima dal chiamante sarà visibile nella richiesta successiva, senza dover attendere il rinnovo del token. La prima chiamata all'interno di una richiesta richiede due ricerche con chiave, eseguite contestualmente. Le chiamate successive nella stessa richiesta riutilizzano il risultato, mentre una richiesta che non lo invoca mai non comporta alcun costo.

Restituisce `undefined` per un chiamante anonimo, per chiamanti con chiave di servizio o chiave API che non rappresentano alcun account e per un account non più esistente. Restituisce `undefined` anche su un backend i cui account risiedono su un [adapter di autenticazione](/docs/backend/auth-adapters/) esterno: in tal caso, interroga direttamente quel provider. Quando un amministratore invia l'intestazione `x-rebase-impersonate`, restituisce l'account impersonato.

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

Inserisci i controlli (guard) nello **slot middleware della route stessa**, come mostrato sopra, anziché usare `app.use("/*", requireAuth)`. `use()` copre solo le route dichiarate *al di sotto* di esso, quindi una route aggiunta successivamente — in fondo al file, mesi dopo — rimarrebbe silenziosamente non protetta.

:::important
La lettura di `getUser(c)` **non** funge da guard. Un chiamante anonimo riceve `undefined` e il gestore viene comunque eseguito. Solo una guard, o un `if (!user) return 401` esplicito, interrompe la richiesta.
:::

### Scope e app scope

`requireAdmin` ammette solo il ruolo `admin` e nessun altro. Per un'azione a cui dovrebbe accedere un ruolo più specifico o una chiave API, proteggi la route con `requireScope`. Questo accetta uno [scope](/docs/backend/roles-and-scopes/) integrato o uno dichiarato dall'applicazione in `auth.scopes` nella collezione users, come `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Ogni utente autenticato possiede tutti gli app scope, quindi per una persona `requireScope` non effettua alcuna restrizione: verifica all'interno dell'handler se l'utente è autorizzato a fare il deploy di questo progetto. Lo scope offre invece un modo per **limitare l'ambito di una chiave**: una chiave dotata di `project:deploy:p1` sarà valida solo per `p1`. Una chiave deve inoltre possedere `functions:invoke`, o `functions:invoke:<name>`, per poter raggiungere la funzione. Vedi [App scope](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticazione con Service Key

Rebase supporta una chiave statica `REBASE_SERVICE_KEY` definita nel file `.env` per chiamate da script o comunicazioni server-to-server.

Quando una richiesta esterna passa la chiave di servizio tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione effettua automaticamente quanto segue:
1. Convalida la chiave mediante un confronto a tempo costante per prevenire attacchi di tipo timing attack.
2. Concede l'accesso con privilegi di amministrazione, impostando il chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` associato a tale identità di servizio. La Row-Level Security rimane attiva — viene valutata per `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Auto-autenticazione interna

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una chiave casuale **interna per ciascun avvio**. Il singleton `rebase` utilizza automaticamente questa chiave quando chiama le API del control-plane del server stesso (come `rebase.auth` o `rebase.storage`). Ciò significa che la logica lato server può sempre eseguire attività amministrative, anche senza una chiave di servizio configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver con ambito utente (user-scoped) — per qualsiasi operazione a supporto di una richiesta

`getDriver(c)` restituisce il driver **con ambito limitato al chiamante**, quindi ogni operazione di lettura e scrittura viene valutata in base ai criteri di Row-Level Security configurati per quell'utente:

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

`requireDriver(c)` è equivalente a `getDriver(c)` senza il `!` — solleva un'eccezione specificando il problema di configurazione anziché fallire venti righe dopo su un `undefined`.

<span class="since-badge" data-since="0.31">Da 0.31</span> `fetchCollection` e `fetchOne` restituiscono le stesse righe fornite da `GET /api/data/<table>`: date come stringhe RFC 3339, una relazione `belongsTo` rappresentata dalla sua chiave esterna (`authorId`) e una riga correlata solo se specificata in `include` — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — per operazioni in background fidate

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

`rebase.dataAsAdmin` non è tipizzato finché non [registri il `Database` generato](/docs/backend/typed-server-data).

### Driver con ambito RLS vs Singleton Rebase

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (identità di servizio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Esecuzione come**         | Il chiamante (`uid`, i suoi ruoli)                | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS** | ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)                   |
| **Ideale per...**    | CRUD generale utente, ricerche e query          | Job in background, trigger di sistema, webhook                        |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Funzioni di accesso fluenti alle tabelle (`rebase.dataAsAdmin.jobs.find`) |

#### Cosa rappresenta esattamente `dataAsAdmin`

`rebase.dataAsAdmin` ha **ambito admin, non bypassa la RLS**. L'ambito del driver viene configurato una sola volta all'avvio con `withAuth({ uid: "service", roles: ["admin"] })`, per cui ogni operazione di lettura e scrittura viene eseguita all'interno di una transazione che è passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. I tuoi criteri vengono valutati — rispetto a tale identità.

Per la maggior parte dei progetti questa distinzione non si fa mai notare, perché i criteri predefiniti iniettati da Rebase su ogni tabella consentono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. Diventa rilevante nel momento in cui definisci criteri personalizzati:

- **`policy.serverContext()` restituisce false per questa identità.** Questo helper compila in `rebase.uid() IS NULL`, mentre l'`uid` di questo accessor è `'service'`. Una tabella con `disableDefaultPolicies: true` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura da `dataAsAdmin` con errore Postgres `42501`, e una lettura su tale collezione restituirà **zero righe con codice HTTP 200** — il comportamento silenzioso. Usa `rolesOverlap(["admin"])` (o aggiungilo in parallelo) quando intendi fare riferimento a "il mio backend".
- **La sua portata coincide con quella di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli garantisce l'accesso esattamente alle stesse righe visibili a questo accessor. Non si tratta di un canale privato.

### 3. `getSql(c)` — SQL come chiamante

Quando l'SDK non consente di esprimere una query o una scrittura in modo pulito — un upsert condizionale, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, una CTE — scrivi direttamente l'SQL ed eseguilo con l'identità del chiamante:

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

L'istruzione viene eseguita nella transazione del chiamante, con il ruolo con restrizioni `rebase_user` e con la sua identità — la stessa transazione aperta dal driver con ambito utente — per cui le regole `rls` delle tue tabelle determinano la visibilità di ogni riga, esattamente come avviene per l'SDK. Una query che richiede tutte le righe otterrà solo quelle accessibili al chiamante.

- **Di sola lettura per impostazione predefinita.** Passa `{ write: true }` per eseguire insert, update o delete; le policy di inserimento e aggiornamento continuano ad applicarsi.
- **Il testo della query è tuo; i valori vanno inseriti in `params`** (`$1`, `$2`, …). L'identità del chiamante risiede nelle impostazioni della transazione, che l'SQL potrebbe modificare: pertanto, qualsiasi istruzione che potrebbe farlo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, o l'invio di più istruzioni — viene respinta con `400 SQL_NOT_ALLOWED` prima dell'esecuzione. L'interpolazione dell'input utente nel testo è proprio ciò che metterebbe alla prova questa protezione; evitala assolutamente.
- **Cosa condivide con l'SDK.** Le policy e tre regole applicate da Postgres a entrambi: una [vista materializzata](/docs/collections/views/#materialized-views) serve le proprie righe solo ai propri `roles`, una riga di una tabella che dichiara `tenant` non può essere spostata a un altro tenant se non da un chiamante `bypassRoles` (`TENANT_IMMUTABLE`), e le funzioni interne del server (`rebase.record_history`, `rebase.enqueue_job`) vengono rifiutate. Una colonna che il chiamante non ha il permesso di leggere — `.private()`, o un `.access({ read })` di cui è sprovvisto — viene rimossa dalle righe, come accade nelle API, se è un riferimento diretto alla colonna (`SELECT *`, `password_hash AS h`); un valore *calcolato* da essa (`md5(password_hash)`) non viene rilevato, quindi evita di calcolarne il valore.
- **Cosa non condivide.** `beforeQuery` e `afterRead`, la validazione, gli hook di salvataggio e la cronologia risiedono in Node e non vengono eseguiti.

Da uno script, [`openRebase`](/docs/backend/embedding-postgres-driver/) offre la stessa funzionalità: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL con l'identità di servizio

Una funzione che applica regole proprie (un ticket al giorno, una verifica temporale) su tabelle che solo gli amministratori possono leggere non può usare `getSql(c)`: il chiamante avrebbe bisogno di policy che lo autorizzino, e quelle stesse policy esporrebbero le tabelle anche sulla data API pubblica. `rebase.sqlAsAdmin` esegue l'istruzione come `{ uid: "service", roles: ["admin"] }`, la stessa identità usata da `rebase.dataAsAdmin`, con la medesima row-level security:

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

È analogo a `getSql(c)` ma con un'identità differente: il ruolo ristretto della richiesta, il ramo admin delle tue policy, sola lettura a meno che non sia specificato `{ write: true }` e la stessa protezione `SQL_NOT_ALLOWED`. A differenza di `rebase.sql()` dell'owner, non può eseguire istruzioni DDL, e dell'archivio di autenticazione può raggiungere solo ciò a cui un admin accede tramite la collezione users: sessioni, chiavi e segreti MFA sono inaccessibili per il ruolo della richiesta, e l'hash della password viene escluso dalle righe. Una singola istruzione comporta un solo round trip, esattamente come `rebase.sql()`. Da uno script, è disponibile anche tramite `openRebase()`.

### 4. `rebase.sql()` — SQL proprietario (owner) e l'unico accessor vincolato a Node

<span class="since-badge" data-since="0.31">Da 0.31</span>

Se hai realmente bisogno di un bypass incondizionato, `rebase.sql()` è ciò che fa al caso tuo: SQL grezzo sulla connessione dell'owner, nessuna policy, accesso a ogni riga. È l'elemento con maggiori privilegi nel contesto di una funzione — ancor più dell'accessor con "admin" nel nome.

Non serve per creare tabelle. Una tabella va [dichiarata](/docs/schema/) con `defineTable` in `backend/schema/` e viene creata all'avvio; una creata con `CREATE TABLE` in una funzione è priva di validazione, hook, configurazione di row-level security, visualizzazione admin o tipi nell'SDK. `rebase.sql()` eseguirà comunque tale istruzione, ma registrerà un avviso nei log indicando la tabella da dichiarare invece.

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

Viene eseguito tramite una connessione TCP verso il database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta svantaggi nelle configurazioni attuali — è semplicemente un aspetto da tenere a mente nel caso in cui una funzione debba essere spostata in seguito. Vedi [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è utilizzabile solo su Node]
Puoi anche importare la tua istanza Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Funziona, e su un deployment Node self-hosted o gestito non crea problemi.

È opportuno però essere consapevoli dei compromessi: una funzione che importa `drizzle-orm` e un pool `pg` diventa permanentemente una funzione Node, bypassa gli hook di tabella eseguiti da `rebase.data` (nessuno dei due controlla `.validate()`, che si applica invece alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)) e preleva la propria connessione separatamente rispetto alla richiesta. `rebase.sql()` fornisce lo stesso SQL grezzo attraverso la connessione nativa del framework, mentre `getSql(c)` lo rende disponibile nel rispetto delle policy del chiamante. È consigliabile preferire questi ultimi.
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

Una lettura a livello di modulo viene valutata quando il file viene importato, prima che esista alcuna richiesta. Su Node ciò significa che una singola variabile mancante blocca l'intero file e tutte le route in esso contenute. Su un host che associa la configurazione alla richiesta anziché al processo, non ci sarà assolutamente nulla da leggere al momento dell'importazione.

- `getEnv(c)` — tutte le variabili visibili a questa richiesta
- `env(c, "NAME")` — una variabile, ripulita da spazi bianchi (trimmed); vuota equivale a non definita
- `requireEnv(c, "NAME")` — analogo al precedente, ma lancia un'eccezione specificando il nome della variabile mancante
- `lazyResource(factory)` — crea un client oneroso una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` a livello di modulo nella directory delle funzioni.

## Operazioni in background

Spostato nella pagina dedicata: [Operazioni in background](/docs/backend/background-work/).

## Portabilità del runtime

Una funzione personalizzata è un'app Hono, quindi la possibilità di eseguirla al di fuori di un processo Node dipende da cosa viene importato nel file stesso. `rebase.sql()`, un client di database importato direttamente e i moduli integrati di Node la vincolano a Node; il resto di `rebase` e la piattaforma Web non lo fanno, e attualmente nulla smette di funzionare per questo motivo. [Portabilità del runtime](/docs/backend/runtime-portability/) elenca cosa è portabile, come `rebase build` e `rebase doctor` lo segnalano e come gestire la logica condizionale in base al runtime.

## Ordine di registrazione delle route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato l'inizializzazione principale. L'ordine di inizializzazione è il seguente:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di storage** — `/api/storage/*`
4. **Route dei dati** — `/api/data/*` (CRUD per le tabelle)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Ciò significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra eventuali route che devono essere eseguite **prima** di Rebase direttamente sull'app Hono, prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua app in questo modo si trovano **all'esterno** di ogni router di Rebase, pertanto nessun middleware di autenticazione è stato eseguito su di esse e `getDriver(c)` non è impostato. Proteggi tali route con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano autonomamente il token. I guard del sotto-percorso `/functions` leggono un'identità che un router Rebase ha già risolto e risponderanno con 500 anziché fingere che ne esista una.
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

Al caricamento delle funzioni, la fase di boot registra nei log `Loaded custom functions` indicandone il conteggio. La riga relativa a ciascuna funzione viene registrata a livello `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

In caso di errore durante il caricamento, il loader fornisce un output di diagnostica:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Il router viene montato per la **directory**, non per le singole funzioni in essa contenute. Se l'importazione di tutti i file fallisce — una singola variabile di ambiente mancante a livello di modulo è sufficiente per comprometterli tutti — `GET /api/functions` risponde comunque `200` con un elenco vuoto e un conteggio `skipped`, rendendo distinguibile il caso "nessun caricamento riuscito" da "questa build non include funzioni". L'elenco stesso richiede un chiamante autenticato, una chiave API dotata del semplice scope `functions:invoke` o la service key — le funzioni rimangono invocabili da chiunque sia ammesso da ciascuna di esse, ma il loro inventario non è pubblico. I dettagli sui motivi rimangono nel log di avvio.

## Timeout e Rate Limit

Due limiti si applicano a `/api/functions/*`:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, con risposta `504` e codice `FUNCTION_TIMEOUT`. Configurabile tramite `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disabilita. L'esecuzione dell'handler non può essere interrotta dall'esterno, ma viene notificata: `getSignal(c)` da `@rebasepro/server/functions` viene interrotto (abort) al momento del 504, quindi è consigliabile passarlo a `fetch` e a qualsiasi altra operazione che accetti un segnale (`fetch(url, { signal: getSignal(c) })`). Il lavoro a cui non viene passato il segnale prosegue — il timeout libera il client e il socket, non il lavoro in background. Il fatto che l'handler *continui a essere eseguito* dopo il 504 è una caratteristica del processo Node a lunga esecuzione, non una garanzia del contratto; qualsiasi operazione che deve essere necessariamente completata deve essere gestita in [`waitUntil`](#operazioni-in-background).
- **Rate limit** — I chiamanti autenticati e tramite chiave API condividono i bucket della data API. I chiamanti anonimi dispongono di una soglia dedicata molto più permissiva (3000 per finestra temporale), poiché questo router è pubblico per impostazione predefinita per ricevere webhook. Può essere sovrascritto con `rateLimit.anonymousFunctions`; `null` lo disattiva.

I rigetti non gestiti delle promesse (unhandled promise rejections) vengono registrati nei log anziché essere irreversibili: una chiamata fire-and-forget in una funzione altrimenti arresterebbe l'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per ripristinare il comportamento predefinito di Node.

Su Rebase Cloud, l'edge a monte delle tue funzioni presenta limiti specifici; inoltre lo stato a livello di modulo, il file system e le porte in uscita hanno comportamenti che è importante conoscere prima di progettare l'architettura. Consulta [Runtime backend gestito](/docs/deployment/managed-runtime/).

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esegui logica in risposta alle modifiche dei dati
- **[Cron Job](/docs/backend/cron-jobs)** — Task pianificati in background
