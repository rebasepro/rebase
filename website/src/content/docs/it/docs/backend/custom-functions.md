---
sourceHash: 9240cd2dc83f4b7b
title: Custom Functions
sidebar_label: Custom Functions
description: Aggiungi endpoint API Hono personalizzati insieme alle tue route CRUD di Rebase. Individuazione automatica da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le custom function ti consentono di aggiungere **route API Hono arbitrarie** insieme agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **rilevamento basato su file** dei cron job: inserisci un file TypeScript nella tua directory `functions/` e Rebase lo monterà automaticamente.

Usa le custom function per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy verso API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, health check
- **Query di aggregazione** — statistiche per dashboard, report, analisi

## Definire una Custom Function

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

`POST`, perché è ciò che l'SDK invia per impostazione predefinita — vedi [Invocare dal client](#invocare-dal-client). Una route `GET` è altrettanto valida; il chiamante deve quindi specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in
esecuzione viene montato al ricaricamento successivo — nessun riavvio necessario. (Deve essere istruito: la
directory viene scansionata anziché importata, quindi il watcher non può dedurlo.)

## Invocare dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // il nome del file, senza estensione — un singolo segmento di percorso
    { name: "Ada" }          // corpo JSON; omesso per una GET
);
```

`invoke` costruisce l'URL, allega il token del chiamante e genera un
`RebaseApiError` in caso di codice diverso da 2xx — in questo modo la struttura dell'errore della funzione stessa raggiunge il
chiamante invece di un semplice rifiuto di `fetch`.

Quattro parametri aggiuntivi che accetta oltre al nome:

```typescript
// Un metodo diverso. Il payload viene rimosso per le GET, poiché GET non ha un corpo.
await client.functions.invoke("hello", undefined, { method: "GET" });

// Un sotto-percorso — `/api/functions/hello/stats`. Va inserito qui, mai nel nome:
// un nome contenente "/" viene rifiutato invece di essere percent-encoded in un 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// Una query string. Passata come `path`, senza alcun separatore inserito prima di `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// Una funzione che restituisce testo o un file (`c.text(csv)`, `c.body(pdf)`).
// La risposta viene letta come JSON a meno che non si indichi diversamente: "text" restituisce una stringa,
// "blob" un Blob, "response" la Response stessa con il corpo non letto.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
Anche `client.call("functions/hello", payload)` raggiunge una funzione. Esegue sempre
una `POST` e, come `invoke`, restituisce il corpo così com'è — nessuno dei due cerca
una chiave `data`. È preferibile usare `functions.invoke`, che accetta un metodo, un sotto-percorso e un
`responseType`; `call` esiste per le route montate al di fuori di `/api/functions`, cosa che
`invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di avvio, i file loader, il layer WebSocket — il che è adatto per un entrypoint del server ma è più di quanto serva a un gestore di route. Ti fornisce inoltre funzioni di accesso al contesto tipizzate (`getUser`, `getDriver`) invece di dover fare il cast manuale di `c.get("user")`.

Vedi [Portabilità del runtime](#portabilit%C3%A0-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime individua `backend/functions/` autonomamente (`functions` nella voce `rebase.json` dell'app backend se l'hai spostata). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo con `REBASE_ROLE=functions`; qualsiasi altro ruolo rifiuterà l'avvio se queste variabili sono impostate.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, o `functions` (sotto), in `backend/src/index.ts`.
:::

Abilita le custom function aggiungendo `functionsDir` alla configurazione del backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase effettuerà le seguenti operazioni:

1. Eseguirà la scansione della directory alla ricerca di file `.ts` / `.js`
2. Validerà che ogni esportazione predefinita sia un'app Hono (duck-typed tramite `.fetch()` + `.routes`)
3. Monterà ciascuna app su `/api/functions/<filename>`
4. Applicherà il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) di seguito)

### Funzioni come valori

Una directory è un modo per produrre ciò che il server eroga: una mappa da segmento URL ad app Hono. Puoi passare tu stesso tale mappa come `functions`, oppure leggere una directory e inserirla al suo interno con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// equivalente a functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: la fase di avvio rifiuta la presenza di entrambi. `loadFunctions(dir, { onSkip })` ti restituisce ogni file ignorato, specificandone il motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecate ed emettono un avviso una sola volta. Da solo, il gruppo delle funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funzioneranno al suo interno; vedi [Integrazione server personalizzata](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Denominazione dei file e mappatura delle route

| File | Percorso di montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono rilevate **esclusivamente al livello principale della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma non viene mai montato; appiattisci invece il nome (`functions/admin-users.ts`). La presenza di una sottodirectory viene segnalata all'avvio e conteggiata nell'endpoint di elenco anziché essere ignorata silenziosamente.

File che vengono **ignorati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più file di quanti il runtime ne carichi

Il nome rappresenta l'identità della funzione anche in tutti gli altri contesti: è il segmento URL, il target dello scope `functions:invoke:<name>` necessario a una chiave per chiamarla e il valore in base al quale `REBASE_FUNCTIONS_ONLY` seleziona quando assegni a una funzione un proprio processo dedicato.

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

### Factory Function

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` restituisce esattamente l'app Hono che questi esempi costruiscono manualmente, quindi i tre approcci sono intercambiabili. Ti evita di dover dichiarare `Hono<HonoEnv>` e ti fornisce il singleton `rebase` nella callback.

---

## Dietro le quinte: Il Loader Duck-Typing

In un monorepo le tue funzioni potrebbero risolvere una copia di Hono diversa da quella utilizzata da Rebase; in tal caso, `exported instanceof Hono` risulterebbe falso anche a fronte di un router perfettamente funzionante. Per questo motivo il loader ne verifica invece la struttura (`isHonoLike`): un oggetto non nullo dotato di un metodo `.fetch` e di un array `.routes`.

### Escape del compilatore per ES Module

Il loader converte ogni percorso di file in un URL di file (`pathToFileURL(filePath).href`), in modo da poter essere importato indifferentemente sia su Windows che su sistemi POSIX, e invoca `import(url)` tramite `new Function("url", "return import(url)")`, evitando così che una build TypeScript possa riscriverlo in un `require()` non compatibile con ESM.

---

## Autenticazione e propagazione del contesto

Le custom function vengono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e iniettato** nel contesto, se presente
- Le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- È necessario **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che presenta un token *non valido* non raggiungerà mai il tuo gestore: un token non verificabile o scaduto viene rifiutato con un errore 401 dal middleware stesso, evitando così che una sessione scaduta venga degradata silenziosamente a una anonima.

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

`getUser` restituisce un oggetto tipizzato in modo restrittivo: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione usato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` contiene tutto ciò che il chiamante è autorizzato a fare, espresso come stringhe di [scope](/docs/backend/roles-and-scopes/): per una persona, il data plane, gli scope propri dell'app e gli scope dei suoi ruoli; per una chiave API, esattamente ciò che la chiave include.

### L'account del chiamante

`getUser(c)` legge il token di accesso, e il token contiene l'ID, i ruoli e l'indirizzo del chiamante. Non indica come l'account esegue l'accesso o quale sia il suo nome visualizzato. `getUserProfile(c)` legge queste informazioni dall'auth store:

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

`providers` elenca le modalità con cui l'account può accedere: `"password"` quando ne ha una, seguita da ciascun provider collegato (`"google"`, `"apple"`, …) nell'ordine in cui è stato associato. Un account guest, o uno che accede solo tramite codice monouso, ha un elenco vuoto.

La lettura è aggiornata a ogni richiesta: un provider collegato dal chiamante pochi istanti prima sarà visibile nella sua richiesta successiva, senza dover attendere il rinnovo del token. La prima chiamata all'interno di una richiesta richiede due ricerche con chiave, eseguite contestualmente. Le chiamate successive nella stessa richiesta riutilizzano il risultato, mentre una richiesta che non lo chiama mai non comporta alcun costo.

Restituisce `undefined` per un chiamante anonimo, per un chiamante tramite chiave di servizio o chiave API che non agisce per conto di alcun account e per un account non più esistente. Restituisce inoltre `undefined` su un backend i cui account risiedono presso un [auth adapter](/docs/backend/auth-adapters/) esterno: in tal caso, interroga direttamente quel provider. Quando un amministratore invia l'intestazione `x-rebase-impersonate`, restituisce l'account impersonato.

### Proteggere le route

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Endpoint pubblico — nessuna protezione, accessibile a chiunque.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 per i chiamanti anonimi.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 se anonimo, 403 se privo del ruolo admin. L'ordine conta.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Uno qualsiasi dei ruoli specificati.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Inserisci i guard direttamente nello **slot middleware della route stessa**, come mostrato sopra, anziché usare `app.use("/*", requireAuth)`. Il metodo `use()` protegge solo le route dichiarate *sotto* di esso; di conseguenza, una route aggiunta successivamente — in fondo al file, a distanza di mesi — rimarrebbe inavvertitamente non protetta.

:::important
La lettura di `getUser(c)` **non** costituisce un guard. Un chiamante anonimo ottiene `undefined` e il tuo gestore viene comunque eseguito. Solo un guard o un controllo esplicito `if (!user) return 401` blocca la richiesta.
:::

### Scope e app scope

`requireAdmin` consente l'accesso al ruolo `admin` e a nessun altro. Per un'azione che dovrebbe essere accessibile a un ruolo più ristretto o a una chiave API, proteggi la route con `requireScope`. Questo accetta uno [scope](/docs/backend/roles-and-scopes/) predefinito o uno dichiarato dall'app sotto `auth.scopes` nella collezione users, come ad esempio `"project:deploy": { label: "Deploy projects", target: "project" }`:

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING a meno che il chiamante non possieda project:deploy, o project:deploy:<this project>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // La stessa verifica all'interno di un gestore.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Ogni utente autenticato possiede tutti gli app scope; pertanto, nel caso di un utente, `requireScope` non determina l'accesso: verifica all'interno del gestore se tale persona è autorizzata a distribuire questo progetto. Ciò che lo scope introduce è la possibilità di **limitare i permessi di una chiave**: una chiave dotata di `project:deploy:p1` sarà valida esclusivamente per `p1`. Una chiave deve inoltre disporre di `functions:invoke` o `functions:invoke:<name>` prima ancora di poter raggiungere la funzione. Vedi [App scope](/docs/backend/roles-and-scopes/#app-scopes).

### Rate limit

Una route che comporta un costo computazionale o economico per chiamata supporta il middleware `rateLimit`, che esegue il conteggio distribuito tra le repliche. Vedi [Rate limit nelle funzioni](/docs/backend/function-rate-limits/).

### Autenticazione con Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel file `.env`, pensata per script o chiamate server-to-server.

Quando una richiesta esterna trasmette la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione esegue automaticamente le seguenti operazioni:
1. Valida la chiave mediante un confronto a tempo costante per prevenire attacchi di temporizzazione (timing attacks).
2. Assegna l'accesso a livello di amministratore, impostando l'identità del chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` associato a tale identità di servizio. La Row-Level Security rimane attiva — viene valutata per `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Auto-autenticazione interna

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale a ogni avvio**. Il singleton `rebase` utilizza automaticamente questa chiave per effettuare chiamate alle API del piano di controllo del server stesso (come `rebase.auth` o `rebase.storage`). In questo modo, la tua logica lato server può sempre svolgere operazioni amministrative anche in assenza di una service key configurata manualmente.

## Accesso al Database e ai Servizi

### 1. Il driver con scope utente — per tutto ciò che serve una richiesta

`getDriver(c)` restituisce il driver con lo **scope limitato al chiamante**, in modo che ogni operazione di lettura e scrittura venga valutata in base ai criteri di Row-Level Security come quell'utente specifico:

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

`requireDriver(c)` equivale a `getDriver(c)` senza il `!` — solleva un'eccezione con un messaggio che esplicita l'errore di configurazione anziché fallire venti righe più avanti a causa di un `undefined`.

`fetchCollection` e `fetchOne` restituiscono i record restituiti da `GET /api/data/<table>`: date in formato stringa RFC 3339, una relazione `belongsTo` come chiave esterna (`authorId`), e il record correlato solo se specificato in `include` — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

`rebase.dataAsAdmin` non è tipizzato fino a quando non [registri il tuo `Database` generato](/docs/backend/typed-server-data).

### Driver con scope RLS vs. Singleton Rebase

|                     | `getDriver(c)` (scope della richiesta)        | `rebase.dataAsAdmin` (identità di servizio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Viene eseguito come** | Il chiamante (`uid`, i suoi ruoli)          | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS** | ✅ Sì (valutata rispetto al chiamante)         | ✅ Sì (valutata rispetto all'identità di servizio)              |
| **Ideale per...**    | Operazioni CRUD utente generali, ricerche e query | Job in background, trigger di sistema, webhook                   |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Funzioni fluent di accesso alle tabelle (`rebase.dataAsAdmin.jobs.find`) |

#### Che cos'è esattamente `dataAsAdmin`

`rebase.dataAsAdmin` ha lo **scope di amministratore, non bypassa la RLS**. Il driver riceve lo scope una sola volta, all'avvio, con `withAuth({ uid: "service", roles: ["admin"] })`, per cui ogni operazione di lettura e scrittura viene eseguita all'interno di una transazione che è passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. I tuoi criteri vengono comunque valutati — rispetto a tale identità.

Nella maggior parte dei progetti questa distinzione non si nota, poiché i criteri predefiniti iniettati da Rebase su ciascuna tabella ammettono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. La differenza emerge nel momento in cui definisci criteri personalizzati:

- **`policy.serverContext()` risulta falso.** Tale helper viene compilato in `rebase.uid() IS NULL`, mentre l'`uid` di questo accessor è `'service'`. Una tabella con `defaultPolicies: false` la cui unica regola di scrittura sia `serverContext()` rifiuterà una scrittura da `dataAsAdmin` con errore Postgres `42501`, e una lettura su tale tabella restituirà **zero righe con codice HTTP 200** — fallendo in modo silenzioso. Usa `rolesOverlap(["admin"])` (o aggiungilo in parallelo) quando intendi indicare "il mio backend".
- **Il suo raggio d'azione coincide con quello di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli consente di visualizzare esattamente le stesse righe a cui ha accesso questo accessor. Non si tratta di un canale privato.

### 3. `getSql(c)` — SQL come chiamante

Quando l'SDK non consente di esprimere agevolmente una query o una scrittura — un upsert condizionale, un `UPDATE … WHERE rev = $3 RETURNING` compare-and-swap, un `count(*) FILTER (…)`, una CTE — scrivi la query SQL ed eseguila impersonando il chiamante:

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
I valori sono quelli di Postgres, con due eccezioni formattate come in `/api/data`: un `timestamptz` è una stringa RFC 3339 in UTC (`2026-11-18T10:52:23.500Z`), e un `bigint` è un numero purché rientri nell'intervallo degli interi sicuri (oltre 2^53 rimane rappresentato come stringa di cifre). Un tipo `numeric` è una stringa, in modo da non perdere precisione decimale; fanne il cast nella query (`total::float8`) se hai bisogno di un numero.

L'istruzione viene eseguita all'interno della transazione del chiamante, con il ruolo ristretto `rebase_user` e la sua identità — la transazione aperta dal driver con scope utente — per cui le regole `rls` delle tue tabelle determinano ogni singola riga, esattamente come avviene tramite l'SDK. Una query che richiede tutte le righe otterrà solo quelle accessibili al chiamante.

- **Di sola lettura per impostazione predefinita.** Passa `{ write: true }` per eseguire inserimenti, aggiornamenti o eliminazioni; i criteri di inserimento e aggiornamento continuano ad essere applicati.
- **Il testo della query è definito da te; i valori vanno inseriti in `params`** (`$1`, `$2`, …). L'identità del chiamante risiede nelle impostazioni della transazione, che possono essere modificate tramite comandi SQL; pertanto, qualsiasi istruzione che potrebbe alterarle — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, o istruzioni multiple — viene rifiutata con `400 SQL_NOT_ALLOWED` prima dell'esecuzione. L'interpolazione dell'input utente nel testo della query metterebbe alla prova questo guard; evita di farlo.
- **Cosa condivide con l'SDK.** I criteri e tre regole applicate da Postgres a entrambi: una [vista materializzata](/docs/collections/views/#materialized-views) restituisce le proprie righe solo ai relativi `roles`, una riga di una tabella che dichiara un `tenant` non può essere spostata in un altro tenant se non da un chiamante con permessi `bypassRoles` (`TENANT_IMMUTABLE`), e l'accesso alle funzioni interne del server (`rebase.record_history`, `rebase.enqueue_job`) viene negato. Una colonna che il chiamante non è autorizzato a leggere — definita come `.private()` o protetta da un vincolo `.access({ read })` non soddisfatto — viene rimossa dalle righe restituite, così come fa l'API, qualora sia un riferimento diretto alla colonna (`SELECT *`, `password_hash AS h`); un valore *calcolato* a partire da essa (`md5(password_hash)`) non viene rilevato, quindi evita di calcolarne il valore.
- **Cosa non condivide.** `beforeQuery` e `afterRead`, validazione, hook di salvataggio e cronologia risiedono in Node e non vengono eseguiti.

Da uno script, [`openRebase`](/docs/backend/embedding-postgres-driver/) ti mette a disposizione la stessa funzionalità: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL con identità di servizio

Una funzione che applica regole proprie (un ticket al giorno, una verifica temporale) su tabelle che solo gli amministratori possono leggere non può utilizzare `getSql(c)`: il chiamante necessiterebbe di criteri che gli concedano l'accesso, e quegli stessi criteri esporrebbero le tabelle anche sulle data API pubbliche. `rebase.sqlAsAdmin` esegue l'istruzione come `{ uid: "service", roles: ["admin"] }`, l'identità impiegata da `rebase.dataAsAdmin`, mantenendo la medesima row-level security:

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

È identico a `getSql(c)` ma con un'identità diversa: il ruolo di richiesta con privilegi limitati, il ramo admin dei tuoi criteri, la modalità sola lettura salvo specificare `{ write: true }` e la stessa protezione `SQL_NOT_ALLOWED`. A differenza di `rebase.sql()` eseguito come owner, non può eseguire comandi DDL e, per quanto riguarda l'archivio di autenticazione, può accedere solo a ciò che un amministratore può raggiungere tramite la collezione utenti: sessioni, chiavi e segreti MFA sono preclusi al ruolo di richiesta, e gli hash delle password vengono esclusi dalle righe restituite. Una singola istruzione comporta un unico round trip, proprio come `rebase.sql()`. Da uno script, anche `openRebase()` include questa funzionalità.

### 4. `rebase.sql()` — SQL come owner e unico accessor esclusivo di Node

Se necessiti realmente di bypassare ogni vincolo in modo incondizionato, la soluzione è `rebase.sql()`: SQL nativo sulla connessione owner, nessun criterio applicato, visibilità totale su ogni riga. Rappresenta l'elemento con i permessi più elevati all'interno del contesto di una funzione — ancor più dell'accessor che contiene "admin" nel nome.

Non è pensato per la creazione di tabelle. Le tabelle vanno [dichiarate](/docs/schema/) con `defineTable` in `backend/schema/` e create in fase di avvio; una tabella creata tramite `CREATE TABLE` all'interno di una funzione non disporrà di validazione, hook, configurazione di sicurezza a livello di riga, interfaccia di amministrazione o tipi per l'SDK. `rebase.sql()` eseguirà comunque una simile istruzione, ma registrerà un avviso nei log indicando quale tabella dichiarare in alternativa.

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

Viene eseguito tramite una connessione TCP verso il database, rendendolo l'unico accessor strettamente vincolato a un processo Node. Questo non comporta svantaggi nelle distribuzioni attuali, ma è un fattore essenziale da considerare qualora una funzione debba essere migrata in seguito. Consulta la sezione [Portabilità del runtime](#portabilit%C3%A0-del-runtime).

:::caution[L'accesso diretto a Drizzle è esclusivo per Node]
È possibile importare la propria istanza di Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Il sistema lo supporta, e in un ambiente Node gestito o self-hosted non presenta problemi.

Tuttavia, è bene considerare le implicazioni: una funzione che importa `drizzle-orm` e un pool `pg` resta vincolata in modo permanente a Node, bypassa gli hook di tabella eseguiti da `rebase.data` (nessuno dei due controlla `.validate()`, che si applica alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)) e acquisisce la connessione da una sorgente esterna rispetto alla richiesta corrente. Al contrario, `rebase.sql()` offre le stesse funzionalità di SQL nativo sfruttando la connessione integrata del framework, mentre `getSql(c)` le mette a disposizione rispettando i criteri del chiamante. È preferibile optare per queste soluzioni.
:::

## Configurazione e Segreti

Leggi la configurazione **all'interno** del gestore, mai a livello di modulo:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Inizializzato una sola volta, alla prima richiesta che lo richiede — non al momento dell'importazione.
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

Il motivo per cui questo è fondamentale su **qualsiasi** runtime, incluso Node:

```typescript no-verify
// Non farlo. Se STRIPE_SECRET_KEY non è impostata, viene generata un'eccezione
// durante l'importazione del file — e il loader segnalerà il file come *funzione ignorata*.
// La route risponderà con un 404, con la causa nascosta in una riga di log di avvio.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lettura a livello di modulo viene valutata nel momento in cui il file viene importato, prima che venga gestita qualsiasi richiesta. Su Node ciò significa che una singola variabile mancante blocca l'intero file e, con esso, tutte le route in esso definite. Su piattaforme di hosting che collegano la configurazione alla richiesta anziché al processo, non vi è assolutamente nulla da leggere al momento dell'importazione.

- `getEnv(c)` — tutte le variabili visibili per questa specifica richiesta
- `env(c, "NAME")` — una singola variabile con spazi rimossi agli estremi; se vuota, è considerata non impostata
- `requireEnv(c, "NAME")` — come sopra, ma solleva un'eccezione specificando il nome della variabile mancante
- `lazyResource(factory)` — crea un client ad alto costo computazionale una sola volta, al primo utilizzo

`rebase doctor` segnala l'uso di `process.env` a livello di modulo all'interno della cartella delle funzioni.

## Elaborazioni in background

Spostato in una pagina dedicata: [Elaborazioni in background](/docs/backend/background-work/).

## Portabilità del runtime

Una custom function è a tutti gli effetti un'applicazione Hono; pertanto, la possibilità di eseguirla su un ambiente diverso da un processo Node dipende unicamente da ciò che il file stesso importa. L'uso di `rebase.sql()`, l'importazione diretta di client per database e l'accesso a moduli nativi di Node vincolano la funzione a quest'ultimo; il resto di `rebase` e le API della piattaforma web standard sono indipendenti, e a oggi nulla fallisce per la presenza di uno o dell'altro. La pagina [Portabilità del runtime](/docs/backend/runtime-portability/) descrive in dettaglio le componenti portabili, le modalità di segnalazione di `rebase build` e `rebase doctor`, nonché le tecniche per differenziare il comportamento in base al runtime in uso.

## Ordine di registrazione delle route

Le custom function vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato l'inizializzazione principale. La sequenza di inizializzazione è la seguente:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di storage** — `/api/storage/*`
4. **Route dati** — `/api/data/*` (operazioni CRUD per le tabelle)
5. **Custom function** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Ciò assicura che le tue custom function abbiano accesso a tutti i servizi già inizializzati. Se hai bisogno di registrare route che devono essere elaborate **prima** di Rebase, definiscile direttamente sull'applicazione Hono prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// Questo viene eseguito PRIMA delle route di Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Inizializzazione di Rebase — registra tutte le route sotto /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua applicazione secondo questa modalità si trovano **all'esterno** di qualsiasi router Rebase: di conseguenza, nessun middleware di autenticazione è stato eseguito su di esse e `getDriver(c)` risulterà indefinito. Proteggile utilizzando `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — i quali verificano direttamente il token. I guard forniti nel sottopercorso `/functions` si basano su un'identità già risolta a monte da un router Rebase, e restituiranno un errore 500 anziché simularne l'esistenza.
:::

## Esempio: Gestore di Webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Inizializzato alla prima richiesta a partire dalla configurazione della richiesta stessa. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberatamente pubblico: Stripe non invia alcun token. La firma costituisce
    // l'autenticazione, quindi va verificata prima di compiere qualsiasi altra operazione.
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
            // L'evasione dell'ordine può proseguire dopo l'invio della risposta; il 200 segnala a Stripe di non ripetere l'invio.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Debugging

Scrivi i log da una funzione con `logger` da `@rebasepro/server/functions`, non con `console.log`: vedi [Logging](/docs/backend/logging/). Durante il caricamento delle funzioni, la procedura di avvio registra il messaggio `Loaded custom functions` indicandone il numero complessivo. Ciascuna funzione viene inoltre registrata individualmente a livello `debug` (`LOG_LEVEL=debug`):

```
Loaded function route: hello
```

In caso di fallimento durante il caricamento, il loader restituisce informazioni diagnostiche dettagliate:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Il router viene montato per l'intera **directory**, non per le singole funzioni in essa contenute. Se l'importazione di tutti i file fallisce — basta una sola variabile d'ambiente mancante a livello di modulo per comprometterli tutti — `GET /api/functions` restituirà comunque `200` con una lista vuota affiancata dal conteggio `skipped`, consentendo di distinguere la situazione di "nessuna funzione caricata" da "questa build non include funzioni". L'accesso alla lista richiede che il chiamante sia autenticato, che utilizzi una chiave API con lo scope generico `functions:invoke` o che impieghi la service key: le funzioni continuano a poter essere chiamate da chiunque ne abbia i permessi, ma il loro elenco completo non è pubblico. I dettagli sugli errori rimangono consultabili nei log di avvio.

## Timeout e Rate Limit

Alla route `/api/functions/*` si applicano due limiti principali:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, con restituzione dell'errore `504` associato al codice `FUNCTION_TIMEOUT`. È possibile configurarlo per tutte le funzioni tramite `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); impostarlo a `0` lo disabilita. Una funzione che attende le risposte di un servizio lento, come un LLM, può dichiarare un valore personalizzato tramite il secondo argomento di `defineFunction`: `defineFunction((app) => { … }, { timeoutMs: 150_000 })`. Questo valore sostituisce il timeout globale del server per la sola funzione in oggetto, aumentandolo o diminuendolo; decorre a partire dall'istante in cui la richiesta raggiunge il router delle funzioni ed è valido anche se il timeout globale è impostato su `0`. Il server ne limita il valore massimo a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300000 ms, pari a 5 minuti per impostazione predefinita), e non può essere impostato a `0`. Il messaggio associato al 504 specifica quale limite è intervenuto e dove era stato configurato, e `error.details` ne include i dati come `{ timeoutMs, source }` (con `source` che può valere `default`, `env`, `option` o `function`). Il gestore non può essere terminato forzatamente dall'esterno, ma ne riceve segnalazione: `getSignal(c)` fornito da `@rebasepro/server/functions` viene interrotto (aborted) nel momento esatto in cui scatta il 504, consentendone l'inoltro a `fetch` e a qualsiasi altra operazione che accetti un segnale (`fetch(url, { signal: getSignal(c) })`). Le operazioni a cui non viene associato il segnale continueranno a essere eseguite: l'intervento del timeout libera il client e il socket, non l'esecuzione in sé. Il fatto che il gestore *prosegua l'elaborazione* dopo il 504 è tipico di un processo Node a lunga esecuzione, non una garanzia del contratto; qualsiasi operazione che debba essere portata a termine necessariamente deve essere affidata a [`waitUntil`](#elaborazioni-in-background).
- **Rate limit** — Le chiamate eseguite tramite chiavi API e da utenti autenticati condividono i bucket delle API dati. I chiamanti anonimi beneficiano di una quota indipendente e notevolmente più permissiva (3000 richieste per finestra), dal momento che questo router è pubblico per impostazione predefinita per la ricezione di webhook. È possibile personalizzare tale comportamento tramite `rateLimit.anonymousFunctions`; impostandolo a `null` la limitazione viene disattivata.

Le promise rejection non gestite vengono registrate nei log anziché provocare un errore irreversibile, evitando che una chiamata di tipo fire-and-forget in una singola funzione provochi l'arresto dell'intero processo. Per ripristinare il comportamento predefinito di Node, imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`.

Su Rebase Cloud, l'edge proxy posizionato a monte delle tue funzioni applica limiti specifici; inoltre, lo stato a livello di modulo, il filesystem e le porte in uscita presentano comportamenti peculiari di cui è opportuno tenere conto in fase di progettazione. Consulta la guida [Runtime backend gestito](/docs/deployment/managed-runtime/).

## Prossimi passi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esegui logica personalizzata alle modifiche dei dati
- **[Cron Job](/docs/backend/cron-jobs)** — Task pianificati in background
