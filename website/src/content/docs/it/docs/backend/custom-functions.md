---
sourceHash: 22d7c8bbab763065
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati insieme alle tue route CRUD di Rebase. Rilevamento automatico da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate consentono di aggiungere **route API Hono arbitrarie** insieme agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **rilevamento basato su file** delle collection e dei cron job: inserisci un file TypeScript nella directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy API esterni
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, health check
- **Query di aggregazione** — statistiche della dashboard, report, analisi

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

`POST`, perché questo è ciò che invia l'SDK per impostazione predefinita — vedi
[Invocazione dal client](#invocazione-dal-client). Una route `GET` è altrettanto
valida; il chiamante deve quindi specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è
in esecuzione viene montato al ricaricamento successivo — senza riavvio. (È necessario
specificarlo: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo automaticamente.)

## Invocazione dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` crea l'URL, allega il token del chiamante e genera un
`RebaseApiError` in caso di codice di stato non-2xx — in questo modo la struttura di errore
della funzione stessa raggiunge il chiamante invece di un semplice rifiuto (rejection) di `fetch`.

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
Anche `client.call("functions/hello", payload)` raggiunge una funzione. Effettua
sempre una chiamata `POST` e, come `invoke`, restituisce il body così com'è — nessuno
dei due cerca una chiave `data`. Preferisci `functions.invoke`, che accetta un metodo,
un sotto-percorso e un `responseType`; `call` esiste per le route montate al di fuori
di `/api/functions`, che `invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di avvio, i loader di file, il livello WebSocket — il che è corretto per l'entrypoint di un server, ma più di quanto serva a un gestore di route (route handler). Ti fornisce inoltre funzioni di accesso al contesto tipizzate (`getUser`, `getDriver`) invece di dover eseguire il cast manuale di `c.get("user")`.

Vedi [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime individua `backend/functions/` autonomamente (`functions` nella voce `rebase.json` dell'app backend se l'hai spostata). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringono quali funzioni serve un processo `REBASE_ROLE=functions`; qualsiasi altro ruolo si rifiuta di avviarsi se sono impostate.
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

Rebase eseguirà le seguenti operazioni:

1. Eseguirà la scansione della directory alla ricerca di file `.ts` / `.js`
2. Convaliderà che ogni export di default sia un'app Hono (tramite duck typing con `.fetch()` + `.routes`)
3. Monterà ciascuna app su `/api/functions/<filename>`
4. Applicherà il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) di seguito)

### Funzioni come valori

Nella versione 0.24 le funzioni provengono solo da una directory.

Una directory è un modo per produrre ciò che il server serve: un record dal segmento URL all'app Hono. Passa tu stesso tale record come `functions`, oppure leggi una directory trasformandola in esso con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: all'avvio la coppia viene rifiutata. `loadFunctions(dir, { onSkip })` ti restituisce ciascun file ignorato, insieme al motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecate ed emettono un avviso una sola volta. Preso singolarmente, il gruppo delle funzioni si monta su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funzionano al suo interno; vedi [Integrazione server personalizzato](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

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
- `*.d.ts` — dichiarazioni di tipi
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più di quanto il runtime carichi

Il nome rappresenta l'identità della funzione anche in tutti gli altri contesti: è il segmento URL, la destinazione dello scope `functions:invoke:<name>` richiesto da una chiave per chiamarla, e il valore con cui `REBASE_FUNCTIONS_ONLY` effettua la selezione quando assegni a una funzione un processo dedicato.

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

`defineFunction` restituisce esattamente l'app Hono che questi costruiscono manualmente, quindi i tre formati sono intercambiabili. Ti evita di dover dichiarare `Hono<HonoEnv>` e ti passa il singleton `rebase` nella callback.

---

## Dietro le quinte: il loader duck-typing

In un monorepo le tue funzioni potrebbero risolvere una copia diversa di Hono rispetto a quella usata da Rebase, e in tal caso `exported instanceof Hono` risulterà false anche per un router funzionante. Pertanto, il loader verifica invece la struttura (`isHonoLike`): un oggetto non nullo con un metodo `.fetch` e un array `.routes`.

### Escape del compilatore ES Module

Il loader converte ogni percorso file in un URL di file (`pathToFileURL(filePath).href`), in modo da poter importare sia su Windows che su POSIX, e chiama `import(url)` tramite `new Function("url", "return import(url)")`, evitando così che una build TypeScript lo riscriva in un `require()` che fallirebbe sotto ESM.

---

## Autenticazione e propagazione del contesto

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e inserito** nel contesto, se presente
- Ma le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- Devi **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che presenta un token *non valido* non raggiunge mai il tuo handler: un token non verificabile o scaduto viene rifiutato con un 401 dal middleware stesso, in modo che una sessione scaduta non venga mai degradata silenziosamente a una sessione anonima.

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

`getUser` restituisce un oggetto ristretto (narrowed): `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione usato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` rappresenta tutto ciò che il chiamante può fare, sotto forma di stringhe di [scope](/docs/backend/roles-and-scopes/): per una persona, il data plane, gli scope dell'app e gli scope dei relativi ruoli; per una chiave API, esattamente ciò che la chiave include.

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

Inserisci le guard nello **slot middleware della route stessa**, come sopra, anziché usare `app.use("/*", requireAuth)`. `use()` copre solo le route dichiarate *al di sotto* di esso, quindi una route aggiunta successivamente — in fondo al file, tra mesi — rimarrebbe silenziosamente non protetta.

:::important
Leggere `getUser(c)` **non** costituisce una guard. Un chiamante anonimo riceve `undefined` e il tuo handler viene comunque eseguito. Solo una guard, o un `if (!user) return 401` esplicito, blocca la richiesta.
:::

### Scope e scope dell'applicazione

`requireAdmin` ammette il ruolo `admin` e nessun altro. Per un'azione a cui deve poter accedere un ruolo più restrittivo o una chiave API, proteggi la route con `requireScope`. Accetta uno [scope](/docs/backend/roles-and-scopes/) predefinito o uno dichiarato dall'applicazione sotto `auth.scopes` nella collection degli utenti, come `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Ogni persona autenticata possiede tutti gli scope dell'app, quindi per una persona `requireScope` non determina nulla: verifica nell'handler se questa persona può eseguire il deploy di questo progetto. Ciò che lo scope aggiunge è un modo per **restringere una chiave**: una chiave contenente `project:deploy:p1` è valida solo per `p1`. Una chiave necessita inoltre di `functions:invoke`, oppure di `functions:invoke:<name>`, per poter raggiungere la funzione. Vedi [Scope dell'applicazione](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticazione tramite Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel tuo file `.env` per chiamate da script o server-to-server.

Quando una richiesta esterna passa la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione automaticamente:
1. Convalida la chiave usando un confronto a tempo costante per prevenire attacchi di temporizzazione (timing attacks).
2. Concede l'accesso di livello admin, impostando il chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` associato a quella stessa identità di servizio. La Row-Level Security si applica comunque — viene valutata come `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Auto-autenticazione interna

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale per ciascun avvio**. Il singleton `rebase` usa automaticamente questa chiave quando chiama le API del control plane del server stesso (come `rebase.auth` o `rebase.storage`). Ciò significa che la tua logica lato server può sempre eseguire operazioni amministrative anche senza una service key configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver con scope utente — per qualsiasi operazione a supporto di una richiesta

`getDriver(c)` restituisce il driver **con lo scope del chiamante**, quindi ogni operazione di lettura e scrittura viene valutata in base ai criteri di Row-Level Security come quell'utente:

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

`requireDriver(c)` è `getDriver(c)` senza il `!` — solleva un'eccezione con un messaggio che indica il problema di configurazione invece di fallire venti righe dopo su un `undefined`.

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

`rebase.dataAsAdmin` non è tipizzato finché non [registri il tuo `Database` generato](/docs/backend/typed-server-data).

### Driver con scope RLS vs. Singleton Rebase

|                     | `getDriver(c)` (con scope di richiesta)        | `rebase.dataAsAdmin` (identità di servizio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Eseguito come**   | Il chiamante (`uid`, i suoi ruoli)             | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS**| ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)               |
| **Ideale per...**   | Operazioni CRUD utente generiche, ricerche e query | Job in background, trigger di sistema, webhook                   |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Accessori collection fluenti (`rebase.dataAsAdmin.jobs.find`) |

#### Che cosa è esattamente `dataAsAdmin`

`rebase.dataAsAdmin` ha **scope admin, non aggira la RLS**. Il driver viene configurato una volta sola, all'avvio, con `withAuth({ uid: "service", roles: ["admin"] })`, quindi ogni lettura e scrittura viene eseguita all'interno di una transazione che è passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. I tuoi criteri vengono valutati — rispetto a tale identità.

Per la maggior parte dei progetti la distinzione non emerge mai, perché i criteri predefiniti inseriti da Rebase su ogni collection ammettono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. Emerge invece nel momento in cui scrivi i tuoi criteri personalizzati:

- **`policy.serverContext()` restituisce false per esso.** Quell'helper compila in `rebase.uid() IS NULL`, mentre l'`uid` di questo accessor è `'service'`. Una collection con `disableDefaultPolicies: true` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura con `dataAsAdmin` con errore Postgres `42501`, e una lettura su tale collection restituirà **zero righe con HTTP 200** — il comportamento silenzioso. Usa `rolesOverlap(["admin"])` (o aggiungilo a fianco) quando intendi "il mio backend".
- **La sua portata equivale a quella di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli garantisce esattamente l'accesso alle righe visibili a questo accessor. Non si tratta di un canale privato.

### 3. `rebase.sql()` — SQL grezzo e l'unico accessor per solo Node

Se hai davvero bisogno di un bypass incondizionato, `rebase.sql()` è ciò che fa per te: SQL grezzo sulla connessione proprietaria (owner), nessun criterio, accesso a ogni riga. È l'elemento più privilegiato nel contesto di una funzione — ancor più dell'accessor con "admin" nel nome.

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

Viene eseguito su una connessione TCP verso il tuo database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta svantaggi in nessun deployment attuale — è semplicemente l'unico aspetto da tenere a mente se una funzione dovesse essere spostata in futuro. Vedi [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è solo per Node]
Puoi anche importare la tua istanza Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Funziona, e su un deployment Node self-hosted o gestito va benissimo.

Vale la pena sapere cosa comporta: una funzione che importa `drizzle-orm` e un pool `pg` diventa permanentemente una funzione per Node, bypassa le callback delle tue collection eseguite invece da `rebase.data` (nessuno dei due controlla `validation`, che si applica alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)), e preleva la propria connessione da un punto diverso dalla richiesta. `rebase.sql()` ti offre lo stesso SQL grezzo tramite la connessione nativa del framework. È l'opzione consigliata.
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

Una lettura a livello di modulo viene valutata quando il file viene importato, prima dell'esistenza di qualsiasi richiesta. Su Node ciò significa che una singola variabile mancante compromette l'intero file e tutte le route in esso contenute. Su un host che associa la configurazione alla richiesta anziché al processo, non c'è assolutamente nulla da leggere al momento dell'importazione.

- `getEnv(c)` — tutte le variabili visibili a questa richiesta
- `env(c, "NAME")` — una singola variabile, con rimozione degli spazi (trimmed); un valore vuoto viene considerato non impostato
- `requireEnv(c, "NAME")` — lo stesso, ma solleva un'eccezione specificando il nome della variabile
- `lazyResource(factory)` — crea un client oneroso una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` a livello di modulo nella directory delle funzioni.

## Attività in background

Le attività che devono proseguire oltre la risposta vanno inserite in `waitUntil`:

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

Una promise senza await sembra equivalente ma non lo è. `waitUntil` garantisce due vantaggi:

- **Su Node**, la promise viene tracciata, quindi uno shutdown regolare (graceful shutdown) la attende anziché terminare il processo lasciando un webhook inviato a metà. Una promise non tracciata al momento di `SIGTERM` viene semplicemente persa.
- **Su un host basato su isolate**, l'host riceve l'istruzione di mantenere attivo l'isolate fino al completamento della promise. Senza di esso, l'attività viene interrotta nel momento stesso in cui la risposta viene risolta — silenziosamente, con un regolare 200 nei log.

L'eventuale rifiuto (rejection) viene registrato nei log invece di essere lasciato al gestore delle rejection non gestite, consentendo così di identificare la route da cui ha avuto origine il fallimento.

## Portabilità del runtime

Una funzione personalizzata è un'app Hono, e Hono può essere eseguito su qualsiasi runtime server JavaScript. La possibilità che la *tua* funzione possa essere eseguita altrove rispetto a un processo Node dipende quindi da cosa il suo file importa e utilizza.

Nulla di quanto descritto rappresenta una limitazione a ciò che puoi scrivere oggi. Ogni deployment di Rebase è un processo Node, una funzione che legge un file o apre un socket è una funzione perfettamente valida, e nessuna build o deploy fallirà per queste ragioni. Questo è documentato affinché la compatibilità sia chiara fin da subito, anziché doverla scoprire file per file in seguito.

**Portabile — funziona su qualsiasi runtime:**

- Tutto ciò che viene esportato da `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — entrambi comunicano tramite la stessa connessione ovunque vengano eseguiti
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la piattaforma web standard
- Qualsiasi dipendenza che non richieda Node

**Solo per Node:**

- `rebase.sql()` — la connessione owner al database è un socket TCP
- Un client Drizzle/`pg`/`mongodb` importato direttamente, per lo stesso motivo
- Moduli nativi di Node: `fs`, `path`, `crypto` (il modulo Node — `globalThis.crypto` è portabile), `child_process`, …
- Pacchetti basati su di essi: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bug latenti su qualsiasi runtime** — vale la pena risolverli a prescindere:

- Lettura di `process.env` a livello di modulo (vedi [Configurazione e segreti](#configurazione-e-segreti))
- Promise "fire-and-forget" invece di [`waitUntil`](#attività-in-background)
- Fare affidamento sull'esecuzione continua di un handler dopo il timeout della richiesta. Su Node ciò accade; è una caratteristica del processo, non una garanzia offerta dal framework

### Verificare le proprie funzioni

`rebase build` stampa una riga per ogni segnalazione rilevante e registra l'esito per ciascuna funzione nel manifest del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` segnala le stesse informazioni senza eseguire la build.

### Se hai bisogno di un percorso specifico per il runtime

`runtimeKey()` restituisce `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` è il controllo più comune. Usali per degradare gradualmente le funzionalità, non per ramificare un'implementazione — una funzione che richiede due implementazioni è in realtà costituita da due funzioni distinte.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

## Ordine di registrazione delle route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato la configurazione di base. L'ordine di inizializzazione è:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di archiviazione** — `/api/storage/*`
4. **Route dati** — `/api/data/*` (CRUD per le collection)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Questo significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra qualsiasi route che debba essere eseguita **prima** di Rebase direttamente sull'app Hono, prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua app in questo modo si trovano **all'esterno** di qualsiasi router di Rebase, pertanto nessun middleware di autenticazione è stato eseguito su di esse e `getDriver(c)` non è impostato. Proteggi tali route con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano autonomamente il token. Le guard sul sottopercorso `/functions` leggono un'identità che un router Rebase ha già risolto e risponderanno con un 500 anziché fingere che ne esista una.
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

## Debugging

Quando le funzioni vengono caricate, l'avvio registra `Loaded custom functions` con il loro numero. La riga di ciascuna funzione viene registrata a livello `debug` (`LOG_LEVEL=debug`):

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

Il router viene montato per la **directory**, non per le singole funzioni al suo interno. Se l'importazione di tutti i file fallisce — una singola variabile d'ambiente mancante a livello di modulo è sufficiente a compromettere tutti i file — `GET /api/functions` risponde comunque `200` con un elenco vuoto e un conteggio `skipped`, in modo che "nulla è stato caricato" sia distinguibile da "questa build non includeva funzioni". L'elenco stesso richiede un chiamante autenticato, una chiave API con lo scope semplice `functions:invoke` o la service key — le funzioni rimangono invocabili da chiunque ciascuna di esse autorizzi, ma il loro inventario non è pubblico. I motivi rimangono nel log di avvio.

## Timeout e Rate Limit

Due limiti si applicano a `/api/functions/*`:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, rispondendo `504` con codice `FUNCTION_TIMEOUT`. Si configura con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disabilita. L'handler non può essere arrestato dall'esterno, ma viene informato: `getSignal(c)` da `@rebasepro/server/functions` viene interrotto (aborted) al momento del 504, quindi passalo a `fetch` e a qualsiasi altra chiamata che accetti un signal (`fetch(url, { signal: getSignal(c) })`). Il lavoro a cui non viene passato il signal prosegue — il timeout libera il client e il socket, non l'attività. Il fatto che l'handler *continui l'esecuzione* dopo il 504 è una caratteristica dei processi Node a esecuzione prolungata, non una garanzia del contratto; qualsiasi operazione che deve essere portata a termine deve essere inserita in [`waitUntil`](#attività-in-background).
- **Rate limit** — Le chiamate con chiave API e gli utenti autenticati condividono i bucket della data API. I chiamanti anonimi ottengono una quota dedicata molto più permissiva (3000 per finestra temporale), poiché questo router è pubblico per impostazione predefinita per la ricezione di webhook. È possibile sovrascriverlo con `rateLimit.anonymousFunctions`; `null` lo disattiva.

I rifiuti di promise non gestiti (unhandled rejections) vengono registrati nei log anziché essere fatali: una chiamata fire-and-forget in una funzione altrimenti arresterebbe l'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per ripristinare il comportamento predefinito di Node.

Su Rebase Cloud, l'edge a monte delle tue funzioni presenta limiti propri, e lo stato a livello di modulo, il filesystem e le porte in uscita si comportano in modi che è utile conoscere prima di progettarvi attorno. Vedi [Runtime di backend gestito](/docs/deployment/managed-runtime/).

## Prossimi passi

- **[Panoramica del backend](/docs/backend)** — Riferimento completo per la configurazione del backend
- **[Callback delle entità](/docs/collections/callbacks)** — Esegui logica sulle modifiche ai dati
- **[Cron Job](/docs/backend/cron-jobs)** — Attività in background pianificate
