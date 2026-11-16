---
sourceHash: 981d8ad3d6e13c80
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati accanto alle tue route CRUD di Rebase. Individuati automaticamente da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate ti consentono di aggiungere **route API Hono arbitrarie** accanto agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **rilevamento basato su file** dei cron job: inserisci un file TypeScript nella directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint per la business logic** — approvazioni, promozioni, workflow personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy per API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, health check
- **Query aggregate** — statistiche della dashboard, report, analisi

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

`POST`, perché è ciò che l'SDK invia di default — consulta [Invocare dal client](#invocare-dal-client). Una route `GET` è altrettanto valida; in tal caso il chiamante deve specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è
in esecuzione viene montato al ricaricamento successivo — senza riavviare. (Deve esserne informato: la
directory viene scansionata anziché importata, quindi il watcher non può dedurlo da solo.)

## Invocare dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` crea l'URL, allega il token del chiamante e genera un
`RebaseApiError` in caso di codice non 2xx — in modo che la struttura di errore della funzione stessa
raggiunga il chiamante invece di un semplice rifiuto di `fetch`.

Quattro opzioni che accetta oltre al nome:

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
una `POST` e, come `invoke`, restituisce il body così com'è — nessuno dei due cerca
una chiave `data`. È preferibile usare `functions.invoke`, che accetta un metodo, un sottopercorso e un
`responseType`; `call` esiste per le route montate all'esterno di `/api/functions`, che
`invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto accede all'intero framework — la sequenza di avvio, i caricatori di file, il livello WebSocket — il che è appropriato per un entry point del server ma eccessivo per un gestore di route. Ti fornisce inoltre funzioni tipizzate di accesso al contesto (`getUser`, `getDriver`) invece di dover eseguire manualmente il cast di `c.get("user")`.

Consulta [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime individua autonomamente `backend/functions/` (`functions` nella voce dell'app backend in `rebase.json` se è stato spostato). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo con `REBASE_ROLE=functions`; qualsiasi altro ruolo rifiuterà l'avvio se queste variabili sono impostate.
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

Rebase:

1. Scansionerà la directory alla ricerca di file `.ts` / `.js`
2. Validerà che ogni esportazione di default sia un'app Hono (tramite duck typing con `.fetch()` + `.routes`)
3. Monterà ciascuna app su `/api/functions/<filename>`
4. Applicherà il middleware di autenticazione (consulta [Autenticazione](#autenticazione-e-propagazione-del-contesto) di seguito)

### Funzioni come valori

Una directory è uno dei modi per generare ciò che il server gestisce: un record che mappa segmenti di URL ad app Hono. Puoi passare direttamente questo record come `functions`, oppure leggere una directory al suo interno con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: all'avvio la coppia viene rifiutata. `loadFunctions(dir, { onSkip })` restituisce ogni file ignorato con la relativa motivazione. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecati e generano un unico avviso. Da solo, il gruppo delle funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funzionano al suo interno; consulta [Integrazione server personalizzato](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Denominazione dei file e mappatura delle route

| File | Percorso di montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono individuate **solo al livello principale della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma non viene mai montato; appiattisci invece il nome (`functions/admin-users.ts`). Eventuali sottodirectory vengono segnalate all'avvio e conteggiate nell'endpoint di elenco anziché essere ignorate silenziosamente.

File che vengono **ignorati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più di quanto il runtime carichi

Il nome costituisce l'identità della funzione anche in tutti gli altri contesti: è il segmento dell'URL, il target dello scope `functions:invoke:<name>` necessario a una chiave per chiamarla, e il valore in base al quale `REBASE_FUNCTIONS_ONLY` effettua la selezione quando assegni a una funzione un proprio processo dedicato.

## Formati di esportazione

Il caricatore accetta due formati di esportazione oltre a `defineFunction`:

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

`defineFunction` restituisce esattamente l'app Hono che questi creano manualmente, quindi i tre formati sono intercambiabili. Ti evita di dover dichiarare `Hono<HonoEnv>` e ti fornisce il singleton `rebase` nella callback.

---

## Dietro le quinte: il loader basato su duck typing

In un monorepo le tue funzioni potrebbero risolvere una copia di Hono diversa da quella utilizzata da Rebase, e in tal caso `exported instanceof Hono` risulterà `false` per un router perfettamente funzionante. Pertanto, il loader verifica invece la struttura (`isHonoLike`): un oggetto non nullo con un metodo `.fetch` e un array `.routes`.

### Escape del compilatore per i moduli ES

Il loader converte ogni percorso file in un URL di file (`pathToFileURL(filePath).href`), in modo da importarlo sia su Windows che su sistemi POSIX, e chiama `import(url)` tramite `new Function("url", "return import(url)")`, evitando che una build di TypeScript possa riscriverlo in un `require()` che fallirebbe con ESM.

---

## Autenticazione e propagazione del contesto

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle route dei dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e inserito** nel contesto, se presente
- Tuttavia le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- È necessario **proteggere esplicitamente** le route che richiedono l'autenticazione

Un chiamante che presenta un token *non valido* non raggiunge mai il tuo gestore: un token non verificabile o scaduto viene rifiutato con un 401 dal middleware stesso, evitando così che una sessione scaduta venga declassata silenziosamente a una anonima.

### Leggere il chiamante

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

`getUser` restituisce un oggetto tipizzato in modo ristretto: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione usato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` rappresenta tutto ciò che il chiamante può fare, sotto forma di stringhe di [scope](/docs/backend/roles-and-scopes/): per una persona, il piano dati, gli scope dell'app e quelli dei relativi ruoli; per una chiave API, esattamente ciò che la chiave contiene.

### L'account del chiamante

`getUser(c)` legge il token di accesso, e il token contiene l'ID, i ruoli e l'indirizzo del chiamante. Non indica la modalità di accesso dell'account né il suo nome visualizzato. `getUserProfile(c)` legge tali informazioni dallo store di autenticazione:

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

`providers` elenca le modalità con cui l'account può accedere: `"password"` quando ne possiede una, quindi ciascun provider collegato (`"google"`, `"apple"`, …) nell'ordine in cui è stato collegato. Un account ospite, o uno che accede solo con un codice monouso, ha un elenco vuoto.

La lettura è aggiornata per ogni richiesta: un provider collegato dal chiamante un istante prima risulterà visibile nella richiesta successiva, senza dover attendere il rinnovo del token. La prima chiamata in una richiesta richiede due ricerche con chiave, eseguite congiuntamente. Le chiamate successive nella stessa richiesta riutilizzano il risultato, mentre una richiesta che non lo chiama mai non costa nulla.

Restituisce `undefined` per un chiamante anonimo, per un chiamante con chiave di servizio o chiave API che non agisce come account, e per un account che non esiste più. Restituisce inoltre `undefined` su un backend i cui account risiedono in un [adapter di autenticazione](/docs/backend/auth-adapters/) esterno: in tal caso, interroga direttamente quel provider. Quando un amministratore invia `x-rebase-impersonate`, restituisce l'account impersonato.

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

Inserisci le guardie nello **slot middleware della route stessa**, come mostrato sopra, anziché usare `app.use("/*", requireAuth)`. `use()` copre solo le route dichiarate *sotto* di esso, quindi una route aggiunta successivamente — in fondo al file, anche a distanza di mesi — resterebbe silenziosamente non protetta.

:::important
La lettura di `getUser(c)` **non** è una guardia. Un chiamante anonimo riceve `undefined` e il tuo gestore viene eseguito comunque. Solo una guardia, o un esplicito `if (!user) return 401`, interrompe la richiesta.
:::

### Scope e scope dell'app

`requireAdmin` ammette il ruolo `admin` e nessun altro. Per un'azione a cui dovrebbe accedere un ruolo più ristretto o una chiave API, proteggi la route con `requireScope`. Accetta uno [scope](/docs/backend/roles-and-scopes/) integrato, oppure uno dichiarato dall'app sotto `auth.scopes` nella collezione users, come ad esempio `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Ogni persona autenticata possiede tutti gli scope dell'applicazione, quindi per un utente `requireScope` non decide nulla: verifica all'interno del gestore se tale persona è autorizzata a distribuire il progetto. Ciò che lo scope aggiunge è un modo per **restringere i permessi di una chiave**: una chiave contenente `project:deploy:p1` viene convalidata solo per `p1`. Una chiave necessita inoltre di `functions:invoke`, o `functions:invoke:<name>`, prima di poter accedere alla funzione. Consulta [Scope dell'applicazione](/docs/backend/roles-and-scopes/#app-scopes).

### Rate limit

Una route che comporta un costo per chiamata accetta il middleware `rateLimit`, che tiene il conteggio tra le varie repliche. Consulta [Rate limit nelle funzioni](/docs/backend/function-rate-limits/).

### Autenticazione con Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel file `.env` per chiamate tramite script o chiamate server-to-server.

Quando una richiesta esterna passa la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione automaticamente:
1. Valida la chiave mediante un confronto a tempo costante per prevenire attacchi di temporizzazione (timing attack).
2. Concede l'accesso a livello admin, impostando il chiamante come `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` con ambito limitato a quella stessa identità di servizio. La Row-Level Security continua a essere applicata — viene valutata come `{ uid: "service", roles: ["admin"] }`, non saltata.

### Autenticazione interna automatica

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale a ogni avvio**. Il singleton `rebase` utilizza automaticamente questa chiave quando effettua chiamate alle API del control plane del server (come `rebase.auth` o `rebase.storage`). Ciò significa che la tua logica lato server può sempre eseguire operazioni amministrative anche senza una chiave di servizio configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver con ambito utente (user-scoped) — per tutto ciò che serve una richiesta

`getDriver(c)` restituisce il driver **con ambito limitato al chiamante**, quindi ogni operazione di lettura e scrittura viene valutata rispetto alle tue policy di Row-Level Security come quell'utente:

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

`requireDriver(c)` è l'equivalente di `getDriver(c)` senza il `!` — solleva un'eccezione specificando il problema di collegamento invece di fallire venti righe dopo su `undefined`.

`fetchCollection` e `fetchOne` restituiscono le righe che `GET /api/data/<table>` restituirebbe: date come stringhe RFC 3339, una relazione `belongsTo` come chiave esterna (`authorId`), e una riga correlata solo se specificata in `include` — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

### Driver con ambito RLS vs Singleton Rebase

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Eseguito come**         | Il chiamante (`uid`, i suoi ruoli)                | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS** | ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)                   |
| **Ideale per...**    | Operazioni CRUD generali degli utenti, ricerche e query          | Job in background, trigger di sistema, webhook                        |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Accessori fluent per tabelle (`rebase.dataAsAdmin.jobs.find`) |

#### Cosa rappresenta esattamente `dataAsAdmin`

`rebase.dataAsAdmin` è **con ambito admin, non esenta da RLS**. Il driver viene configurato una volta, all'avvio, con `withAuth({ uid: "service", roles: ["admin"] })`, quindi ogni lettura e scrittura viene eseguita all'interno di una transazione che è passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. Le tue policy vengono valutate — rispetto a tale identità.

Per la maggior parte dei progetti la distinzione non emerge mai, poiché le policy predefinite che Rebase inserisce in ogni tabella ammettono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. Emerge invece nel momento in cui definisci le tue policy personalizzate:

- **`policy.serverContext()` risulta false per essa.** Tale helper compila in `rebase.uid() IS NULL`, e l'`uid` di questo accessor è `'service'`. Una tabella con `defaultPolicies: false` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura con `dataAsAdmin` restituendo l'errore Postgres `42501`, e una lettura su tale collezione restituirà **zero righe con HTTP 200** — il comportamento silenzioso. Usa `rolesOverlap(["admin"])` (o aggiungilo accanto) quando intendi "il mio backend".
- **La sua portata equivale a quella di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli garantisce l'accesso esattamente alle stesse righe visibili a questo accessor. Non si tratta di un canale privato.

### 3. `getSql(c)` — SQL come chiamante

Quando l'SDK non esprime chiaramente una query o un'operazione di scrittura — un upsert condizionale, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, una CTE — scrivi direttamente il codice SQL ed eseguilo come il chiamante:

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

L'istruzione viene eseguita nella transazione del chiamante, con il ruolo ristretto `rebase_user` e la sua identità — la stessa transazione aperta dal driver con ambito utente — pertanto le regole `rls` delle tue tabelle determinano ogni riga, esattamente come avviene per l'SDK. Una query che richiede tutte le righe otterrà solo quelle accessibili al chiamante.

- **Sola lettura per impostazione predefinita.** Passa `{ write: true }` per eseguire insert, update o delete; le policy di insert e update continueranno a essere applicate.
- **Il testo della query è il tuo; i valori vanno inseriti in `params`** (`$1`, `$2`, …). L'identità del chiamante risiede nelle impostazioni della transazione, che l'SQL potrebbe modificare; pertanto, qualsiasi istruzione che potrebbe farlo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, o più istruzioni concatenate — viene rifiutata con `400 SQL_NOT_ALLOWED` prima dell'esecuzione. L'interpolazione dell'input utente all'interno del testo metterebbe alla prova tale guardia; non farlo.
- **Cosa condivide con l'SDK.** Le policy e tre regole applicate da Postgres a entrambi: una [vista materializzata](/docs/collections/views/#materialized-views) serve le sue righe solo ai relativi `roles`, una riga di una tabella che dichiara `tenant` non può essere spostata a un altro tenant se non da un chiamante `bypassRoles` (`TENANT_IMMUTABLE`), e le funzioni interne del server (`rebase.record_history`, `rebase.enqueue_job`) vengono rifiutate. Una colonna che il chiamante non può leggere — `.private()` o una regola `.access({ read })` di cui è privo — viene rimossa dalle righe, come farebbe l'API, quando si tratta di un riferimento diretto alla colonna (`SELECT *`, `password_hash AS h`); un valore *calcolato* a partire da essa (`md5(password_hash)`) non viene riconosciuto, quindi evita di calcolare valori su di essa.
- **Cosa non condivide.** `beforeQuery` e `afterRead`, validazione, hook di salvataggio e cronologia risiedono in Node e non vengono eseguiti.

Da uno script, [`openRebase`](/docs/backend/embedding-postgres-driver/) offre la stessa funzionalità: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL come identità di servizio

Una funzione che applica regole proprie (un ticket al giorno, un controllo temporale) su tabelle che solo gli amministratori possono leggere non può utilizzare `getSql(c)`: il chiamante necessiterebbe di policy che lo autorizzino, e quelle stesse policy esporrebbero le tabelle anche sull'API pubblica dei dati. `rebase.sqlAsAdmin` esegue l'istruzione come `{ uid: "service", roles: ["admin"] }`, l'identità utilizzata da `rebase.dataAsAdmin`, sotto la medesima row-level security:

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

È `getSql(c)` con un'identità diversa: il ruolo di richiesta ristretto, il ramo admin delle tue policy, sola lettura a meno che non sia specificato `{ write: true }`, e la stessa protezione `SQL_NOT_ALLOWED`. A differenza di `rebase.sql()` del proprietario, non può eseguire DDL e, per quanto riguarda l'auth store, accede solo a ciò che un amministratore può raggiungere tramite la collezione users: sessioni, chiavi e segreti MFA vengono preclusi al ruolo di richiesta, e l'hash della password viene rimosso dalle righe. Una singola istruzione costa un round trip, esattamente come `rebase.sql()`. Da uno script, è disponibile anche tramite `openRebase()`.

### 4. `rebase.sql()` — SQL proprietario (owner) e l'unico accessor per solo Node

Se hai davvero bisogno di un bypass incondizionato, `rebase.sql()` fa al caso tuo: SQL puro sulla connessione proprietaria (owner), nessuna policy, tutte le righe. È l'elemento con maggiori privilegi nel contesto di una funzione — ancor più dell'accessor con "admin" nel nome.

Non è destinato alla creazione di tabelle. Una tabella viene [dichiarata](/docs/schema/) con `defineTable` in `backend/schema/` e creata all'avvio; una creata con `CREATE TABLE` all'interno di una funzione è priva di validazione, hook, impostazioni di row-level security, visualizzazione nell'admin o tipizzazione nell'SDK. `rebase.sql()` eseguirà comunque tale istruzione registrando un avviso nei log che indica il nome della tabella da dichiarare invece.

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

Viene eseguito su una connessione TCP al database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta alcuno svantaggio sui deployment attualmente esistenti — è semplicemente l'unico aspetto da considerare se la funzione dovesse essere trasferita altrove in futuro. Consulta [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è consentito solo su Node]
È possibile anche importare un'istanza personalizzata di Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Funziona, e su una distribuzione Node self-hosted o gestita non ci sono problemi.

Vale la pena considerare i relativi costi: una funzione che importa `drizzle-orm` e un pool `pg` diventa permanentemente una funzione Node, bypassa gli hook di tabella eseguiti da `rebase.data` (nessuno dei due controlla `.validate()`, che si applica alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)) e preleva la propria connessione da un contesto diverso dalla richiesta. `rebase.sql()` offre lo stesso SQL raw attraverso la connessione del framework, e `getSql(c)` lo rende disponibile nel rispetto delle policy del chiamante. È preferibile optare per queste ultime.
:::

## Configurazione e segreti

Leggi la configurazione **all'interno** dell'handler, mai a livello di modulo:

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

Una lettura a livello di modulo viene valutata al momento dell'importazione del file, prima che esista alcuna richiesta. Su Node ciò significa che una sola variabile mancante causa il fallimento dell'intero file e di ogni route al suo interno. Su un host che associa la configurazione alla richiesta anziché al processo, non ci sarà nulla da leggere al momento dell'importazione.

- `getEnv(c)` — ogni variabile visibile a questa richiesta
- `env(c, "NAME")` — una singola variabile, ripulita da spazi vuoti; un valore vuoto è considerato non impostato
- `requireEnv(c, "NAME")` — uguale, ma genera un'eccezione indicando il nome della variabile
- `lazyResource(factory)` — inizializza un client oneroso una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` a livello di modulo presenti nella directory delle funzioni.

## Attività in background

Spostato in una pagina dedicata: [Attività in background](/docs/backend/background-work/).

## Portabilità del runtime

Una funzione personalizzata è un'app Hono, quindi la possibilità di eseguirla altrove rispetto a un processo Node dipende da cosa importa il file stesso. `rebase.sql()`, un client di database importato direttamente e i moduli integrati di Node la vincolano a Node; il resto di `rebase` e le API della piattaforma web non presentano questo vincolo, e nulla fallisce oggi a causa di entrambi. [Portabilità del runtime](/docs/backend/runtime-portability/) elenca cosa è portabile, come `rebase build` e `rebase doctor` lo segnalano e come gestire rami condizionali in base al runtime.

## Ordine di registrazione delle route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato la configurazione principale. L'ordine di inizializzazione è:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di archiviazione** — `/api/storage/*`
4. **Route dati** — `/api/data/*` (CRUD per le tabelle)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Ciò significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra qualsiasi route che debba essere eseguita **prima** di Rebase direttamente sull'app Hono, prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua app in questo modo si trovano **all'esterno** di ogni router Rebase, quindi nessun middleware di autenticazione è stato eseguito su di esse e `getDriver(c)` non è impostato. Proteggi tali route con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano autonomamente il token. Le guardie nel sottopercorso `/functions` leggono un'identità già risolta da un router Rebase e restituiranno un 500 anziché simulare che ne esista una.
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

## Debug

Quando le funzioni vengono caricate, il log di avvio mostra `Loaded custom functions` con il relativo conteggio. La riga specifica di ciascuna funzione viene registrata a livello `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se il caricamento non riesce, il loader restituisce informazioni di diagnostica:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Il router viene montato per la **directory**, non per le singole funzioni in essa contenute. Se tutti i file falliscono l'importazione — una sola variabile di ambiente mancante a livello di modulo è sufficiente per arrestarli tutti — `GET /api/functions` risponde comunque `200` con un elenco vuoto e un conteggio `skipped`, consentendo di distinguere "nessun elemento caricato" da "questa build non contiene funzioni". L'elenco stesso richiede un chiamante autenticato, una chiave API con lo scope `functions:invoke` o la service key — le funzioni rimangono invocabili da chiunque ciascuna di esse ammetta, ma il loro catalogo non è pubblico. Le motivazioni restano registrate nel log di avvio.

## Timeout e rate limit

Due limiti massimi si applicano a `/api/functions/*`:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, con risposta `504` e codice `FUNCTION_TIMEOUT`. Configurabile tramite `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disabilita. Il gestore non può essere interrotto dall'esterno, ma viene avvisato: `getSignal(c)` da `@rebasepro/server/functions` viene interrotto al verificarsi del 504, quindi passalo a `fetch` e a qualsiasi altra chiamata che accetti un signal (`fetch(url, { signal: getSignal(c) })`). Il lavoro a cui non è stato associato il signal prosegue — il timeout libera il client e il socket, non l'esecuzione del lavoro. Il fatto che l'handler *continui a essere eseguito* dopo il 504 è una caratteristica di un processo Node a lunga esecuzione, non una garanzia del contratto; qualsiasi operazione che debba necessariamente concludersi appartiene a [`waitUntil`](#attività-in-background).
- **Rate limit** — I chiamanti con chiave API e gli utenti autenticati condividono i bucket dell'API dei dati. I chiamanti anonimi dispongono di una quota propria, molto più permissiva (3000 per finestra temporale), poiché questo router è pubblico per impostazione predefinita per consentire la ricezione dei webhook. È possibile sovrascriverlo con `rateLimit.anonymousFunctions`; `null` lo disattiva.

Le rejection di promise non gestite vengono registrate nei log anziché essere fatali: una chiamata fire-and-forget in una funzione altrimenti arresterebbe l'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per ripristinare il comportamento predefinito di Node.

Su Rebase Cloud, l'edge a monte delle tue funzioni presenta limiti propri, e
lo stato a livello di modulo, il file system e le porte in uscita si comportano in modi che è
opportuno conoscere prima di progettarne l'architettura. Consulta
[Runtime gestito del backend](/docs/deployment/managed-runtime/).

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esegui logica alle modifiche dei dati
- **[Cron job](/docs/backend/cron-jobs)** — Attività in background pianificate
