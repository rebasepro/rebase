---
sourceHash: 49840b693028a89f
title: Custom Functions
sidebar_label: Custom Functions
description: Aggiungi endpoint API Hono personalizzati insieme alle tue route CRUD di Rebase. Individuazione automatica da directory, con pieno accesso all'istanza backend.
---

## Panoramica

Le custom function ti consentono di aggiungere **route API Hono arbitrarie** insieme agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **individuazione basata su file** delle collezioni e dei cron job: inserisci un file TypeScript nella directory `functions/` e Rebase lo monterà automaticamente.

Usa le custom function per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy per API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, controlli dello stato di salute (health check)
- **Query aggregate** — statistiche della dashboard, report, analisi dati

## Definire una Custom Function

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

`POST`, perché è ciò che l'SDK invia per impostazione predefinita — vedi
[Invocazione dal client](#invocazione-dal-client). Una route `GET` è altrettanto
valida; in tal caso il chiamante deve specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in
esecuzione viene montato al ricaricamento successivo — senza riavvio. (Deve essergli
notificato: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo.)

## Invocazione dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // il nome del file, senza estensione — un singolo segmento di percorso
    { name: "Ada" }          // corpo JSON; omesso per una GET
);
```

`invoke` costruisce l'URL, allega il token del chiamante e genera un
`RebaseApiError` in caso di codice non-2xx — in modo che la struttura dell'errore
della funzione stessa raggiunga il chiamante invece di un semplice rifiuto di `fetch`.

Oltre al nome, accetta altri quattro parametri:

```typescript
// Un metodo diverso. Il payload viene rimosso per le GET, poiché GET non ha un body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// Un sotto-percorso — `/api/functions/hello/stats`. Va inserito qui, mai nel nome:
// un nome contenente "/" viene rifiutato invece di essere codificato in percentuale in un 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// Una query string. Passata come `path`, senza separatori inseriti prima di `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// Una funzione che risponde con testo o un file (`c.text(csv)`, `c.body(pdf)`).
// La risposta viene letta come JSON a meno che non si indichi diversamente: "text" restituisce una stringa,
// "blob" un Blob, "response" la Response stessa con il body non letto.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
Anche `client.call("functions/hello", payload)` può raggiungere una funzione. Effettua
sempre una `POST` e, come `invoke`, restituisce il body così com'è — nessuno dei due
estrae una chiave `data`. È preferibile usare `functions.invoke`, che supporta un metodo, un
sotto-percorso e un `responseType`; `call` esiste per le route montate al di fuori di
`/api/functions`, che `invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso rappresenta la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto richiama l'intero framework — la sequenza di avvio, i file loader, il layer WebSocket — il che è adatto all'entrypoint di un server ma eccessivo per un gestore di route. Inoltre, fornisce funzioni di accesso al contesto tipizzate (`getUser`, `getDriver`) invece di dover effettuare il cast manuale di `c.get("user")`.

Vedi [Portabilità del runtime](#portabilità-del-runtime) per le specifiche complete.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime individua `backend/functions/` autonomamente (`entry.functions` in `rebase.json` se è stato spostato). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, o `functions` (sotto), in `backend/src/index.ts`.
:::

Abilita le custom function aggiungendo `functionsDir` alla configurazione del backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... altra configurazione
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase si occuperà di:

1. Scansionare la directory alla ricerca di file `.ts` / `.js`
2. Convalidare che ogni export di default sia un'app Hono (tramite duck typing con `.fetch()` + `.routes`)
3. Montare ciascuna app su `/api/functions/<filename>`
4. Applicare il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) sotto)

### Funzioni come valori

Dalla versione 0.24 le funzioni provengono esclusivamente da una directory.

Una directory è un modo per produrre ciò che il server espone: una mappatura da segmento URL ad app Hono. Puoi passare direttamente questa mappatura come `functions`, oppure leggere una directory al suo interno con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// equivalente a functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: la fase di avvio rifiuta la coppia. `loadFunctions(dir, { onSkip })` restituisce ogni file ignorato, specificandone il motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecati e generano un unico avviso. Preso singolarmente, il gruppo di funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` continuano a funzionare al suo interno; vedi [Integrazione server personalizzato](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Naming dei file e mappatura delle route

| File | Percorso di montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono individuate **solo al livello principale della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma non montato; appiattisci il nome del file (`functions/admin-users.ts`). Eventuali sottodirectory vengono segnalate all'avvio e conteggiate nell'endpoint di elenco anziché essere ignorate silenziosamente.

File che vengono **ignorati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problematici, poiché la build compila più elementi di quanti il runtime ne carichi

Il nome identifica la funzione anche in qualsiasi altro contesto: è il segmento URL, il target dello scope `functions:invoke:<name>` richiesto a una chiave per poterla chiamare, e il valore utilizzato da `REBASE_FUNCTIONS_ONLY` per selezionarla quando assegni a una funzione un processo dedicato.

## Formati di esportazione

Il loader supporta altri due formati di esportazione oltre a `defineFunction`:

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

`defineFunction` restituisce esattamente l'app Hono che questi formati costruiscono manualmente, rendendo i tre approcci intercambiabili. Ti evita di dichiarare `Hono<HonoEnv>` e fornisce il singleton `rebase` nella callback.

---

## Dietro le quinte: il loader Duck-Typing

In un monorepo, le tue funzioni potrebbero risolvere una copia di Hono diversa da quella utilizzata da Rebase, facendo fallire `exported instanceof Hono` anche per un router valido. Per questo motivo, il loader ne verifica la struttura (`isHonoLike`): un oggetto non nullo provvisto di un metodo `.fetch` e di un array `.routes`.

### Escape del compilatore per i moduli ES

Il loader trasforma il percorso di ciascun file in un URL file (`pathToFileURL(filePath).href`), garantendo l'importazione uniforme sia su Windows che su sistemi POSIX, e richiama `import(url)` tramite `new Function("url", "return import(url)")`, evitando così che una build TypeScript lo converta in una chiamata `require()` incompatibile con ESM.

---

## Autenticazione e propagazione del contesto

Le custom function vengono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Ciò comporta che:

- Il JWT dell'utente viene **analizzato e inserito** nel contesto, se presente
- Le richieste **non vengono respinte** in assenza di JWT
- È necessario **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che fornisce un token *non valido* non raggiungerà mai il tuo gestore: un token non verificabile o scaduto viene respinto con un 401 dal middleware stesso, evitando che una sessione scaduta venga declassata silenziosamente a richiesta anonima.

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

`getUser` restituisce un oggetto tipizzato: `uid` è una stringa e `roles` è sempre un array, a prescindere dal metodo di autenticazione usato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` elenca tutte le azioni concesse al chiamante come stringhe di [scope](/docs/backend/roles-and-scopes/): per un utente corrisponde a data plane, scope specifici dell'app e scope associati ai suoi ruoli; per una chiave API, corrisponde esattamente a ciò che la chiave include.

### Protezione delle route

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Endpoint pubblico — nessun guard, accessibile a chiunque.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 per i chiamanti anonimi.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 se anonimo, 403 se privo del ruolo admin. L'ordine è rilevante.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Uno qualsiasi dei ruoli indicati.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Inserisci i guard nello **slot middleware della route stessa**, come mostrato sopra, anziché usare `app.use("/*", requireAuth)`. `use()` agisce solo sulle route dichiarate *successivamente*, quindi una route aggiunta in seguito — in fondo al file, anche a distanza di tempo — rimarrebbe non protetta senza avvisi.

:::important
Leggere `getUser(c)` **non** equivale a un guard. Un chiamante anonimo riceverà `undefined` e il gestore verrà comunque eseguito. Solo un guard, o un `if (!user) return 401` esplicito, blocca la richiesta.
:::

### Scope e app scope

`requireAdmin` consente l'accesso unicamente al ruolo `admin`. Per un'azione a cui deve poter accedere un ruolo più restrittivo o una chiave API, proteggi la route con `requireScope`. Accetta uno [scope](/docs/backend/roles-and-scopes/) predefinito o uno dichiarato dall'applicazione in `auth.scopes` nella collezione users, come ad esempio `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Ogni utente autenticato possiede tutti gli app scope; per una persona, quindi, `requireScope` non è determinante: verifica all'interno del gestore se tale persona è autorizzata a distribuire il progetto specifico. Lo scope permette invece di **limitare i permessi di una chiave**: una chiave che possiede `project:deploy:p1` sarà valida esclusivamente per `p1`. Una chiave deve inoltre disporre di `functions:invoke`, o `functions:invoke:<name>`, prima di poter accedere alla funzione. Consulta [App scope](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticazione con Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel file `.env` per chiamate tramite script o comunicazioni server-to-server.

Quando una richiesta esterna trasmette la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione si occupa automaticamente di:
1. Validare la chiave tramite confronto a tempo costante per prevenire attacchi di temporizzazione (timing attack).
2. Assegnare l'accesso di livello amministrativo, configurando il chiamante come `{ uid: "service", roles: ["admin"] }`.
3. Fornire un `DataDriver` associato a tale identità di servizio. La Row-Level Security rimane attiva — viene valutata come `{ uid: "service", roles: ["admin"] }`, senza essere ignorata.

### Autenticazione interna automatica

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave casuale interna per ciascun avvio**. Il singleton `rebase` utilizza automaticamente questa chiave per invocare le API del control-plane del server stesso (come `rebase.auth` o `rebase.storage`). In questo modo, la logica lato server può sempre completare attività amministrative anche in assenza di una chiave di servizio configurata manualmente.

## Accesso al database e ai servizi

### 1. Driver vincolato all'utente — per gestire le richieste

`getDriver(c)` restituisce il driver **associato al contesto del chiamante**, garantendo che ogni operazione di lettura e scrittura rispetti le policy di Row-Level Security per tale utente:

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

`requireDriver(c)` è l'equivalente di `getDriver(c)` senza l'uso dell'operatore `!` — genera un errore che indica chiaramente il problema di configurazione anziché fallire venti righe dopo con un `undefined`.

### 2. `rebase.dataAsAdmin` — per operazioni in background affidabili

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

`rebase.dataAsAdmin` è privo di tipi finché non avrai [registrato il tuo `Database` generato](/docs/backend/typed-server-data).

### Confronto tra driver RLS e singleton Rebase

|                     | `getDriver(c)` (ambito richiesta)              | `rebase.dataAsAdmin` (identità di servizio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Esecuzione come** | Il chiamante (`uid`, i suoi ruoli)             | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS**| ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)               |
| **Ideale per...**   | CRUD utente generico, ricerche e query         | Task in background, trigger di sistema, webhook                   |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Funzioni di accesso fluenti alla collezione (`rebase.dataAsAdmin.jobs.find`) |

#### Cosa rappresenta esattamente `dataAsAdmin`

`rebase.dataAsAdmin` è **vincolato ai permessi di amministratore, non un bypass dell'RLS**. Il driver viene configurato una sola volta all'avvio con `withAuth({ uid: "service", roles: ["admin"] })`, pertanto ogni operazione di lettura e scrittura viene eseguita all'interno di una transazione che passa al ruolo ristretto `rebase_user` con `app.uid = 'service'`. Le policy continuano a essere valutate — in relazione a tale identità.

Nella maggior parte dei progetti questa distinzione non è evidente, poiché le policy predefinite applicate da Rebase su ogni collezione consentono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. La differenza emerge nel momento in cui definisci policy personalizzate:

- **`policy.serverContext()` restituisce false per esso.** Quell'helper compila in `rebase.uid() IS NULL`, mentre l'identità di questo accessor ha `uid` impostato a `'service'`. Una collezione con `disableDefaultPolicies: true` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura via `dataAsAdmin` con errore Postgres `42501`, e una lettura sulla medesima collezione restituirà **zero righe con HTTP 200** — fallendo in modo silenzioso. Specifica `rolesOverlap(["admin"])` (o aggiungilo in parallelo) quando intendi fare riferimento al "mio backend".
- **Il suo raggio d'azione coincide con quello di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli consente di visualizzare esattamente le stesse righe a cui ha accesso questo accessor. Non si tratta di un canale riservato.

### 3. `rebase.sql()` — SQL non elaborato, l'unico accessor per solo ambiente Node

Se necessiti di un bypass incondizionato, la soluzione è `rebase.sql()`: esegue query SQL non elaborate sulla connessione owner, senza applicare policy, accedendo a ogni riga. È l'elemento con i privilegi più elevati all'interno del contesto di una funzione — ancor più dell'accessor con il termine "admin" nel nome.

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

Funziona tramite una connessione TCP verso il database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta svantaggi nelle implementazioni correnti, ma rappresenta un dettaglio importante qualora la funzione debba essere trasferita altrove in futuro. Vedi [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è consentito solo su Node]
Puoi anche importare la tua istanza Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Questa operazione funziona ed è adeguata in un deployment Node self-hosted o gestito.

È importante valutarne le implicazioni: una funzione che importa `drizzle-orm` e un pool `pg` diventa a tutti gli effetti vincolata a Node; salta le callback della collezione che `rebase.data` esegue (entrambi non verificano la `validation`, che riguarda le [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)); infine, ottiene la connessione al di fuori del flusso della richiesta. `rebase.sql()` ti offre le stesse funzionalità di SQL diretto sfruttando la connessione nativa del framework. È l'approccio consigliato.
:::

## Configurazione e segreti

Leggi la configurazione **all'interno** del gestore, mai a livello di modulo:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Inizializzato una sola volta, alla prima richiesta che ne ha bisogno — non durante l'importazione.
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

Il motivo per cui questo è importante su **qualsiasi** runtime, incluso Node:

```typescript no-verify
// Evita questo schema. Se STRIPE_SECRET_KEY non è impostata, verrà generato un errore
// durante l'importazione del file — e il loader segnalerà il file come *funzione saltata*.
// La route risponderà con un 404, indicando il motivo solo nei log di avvio.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

La lettura a livello di modulo viene eseguita al momento dell'importazione del file, prima che sia disponibile qualsiasi richiesta. Su Node, una singola variabile mancante rende inagibile l'intero file e tutte le route in esso definite. Su piattaforme in cui la configurazione è associata alla richiesta anziché al processo, non vi sarà alcun dato leggibile al momento dell'importazione.

- `getEnv(c)` — restituisce tutte le variabili visibili alla richiesta corrente
- `env(c, "NAME")` — restituisce una singola variabile ripulita dagli spazi; i valori vuoti sono considerati non impostati
- `requireEnv(c, "NAME")` — identico al precedente, ma genera un'eccezione specificando il nome della variabile se mancante
- `lazyResource(factory)` — inizializza un client oneroso una sola volta, al primo utilizzo effettivo

`rebase doctor` segnala eventuali letture di `process.env` a livello di modulo all'interno della directory functions.

## Attività in background

Le operazioni che devono proseguire dopo l'invio della risposta vanno inserite in `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // Il chiamante non attende questa operazione, ma il processo di arresto sì.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Una promise non attesa (un-awaited) può sembrare equivalente, ma non lo è. L'uso di `waitUntil` offre due vantaggi:

- **Su Node**, la promise viene monitorata, consentendo a un arresto controllato (graceful shutdown) di attenderne il completamento invece di interrompere bruscamente il processo durante l'invio di un webhook. Una promise lasciata in sospeso all'arrivo di un segnale `SIGTERM` andrebbe semplicemente persa.
- **Su piattaforme basate su isolati (isolates)**, viene indicato all'host di mantenere attivo l'isolato fino alla risoluzione della promise. In caso contrario, l'esecuzione verrebbe interrotta non appena inviata la risposta — in modo silente e registrando un codice 200 nei log.

Un eventuale rifiuto (rejection) della promise viene registrato nei log invece di essere affidato al gestore degli errori non gestiti, facilitando l'individuazione della route da cui ha avuto origine.

## Portabilità del runtime

Una custom function è a tutti gli effetti un'applicazione Hono, e Hono può essere eseguito su qualunque server runtime JavaScript. La possibilità di eseguire la *tua* funzione al di fuori di un processo Node dipende quindi esclusivamente dalle importazioni e dalle API utilizzate nel file stesso.

Ciò non limita ciò che puoi sviluppare oggi. Ogni deployment di Rebase è basato su un processo Node: una funzione che legge un file o apre un socket è del tutto valida, e nessuna procedura di compilazione o rilascio fallirà per questo motivo. Queste indicazioni servono a valutare la compatibilità fin da subito anziché verificarla file per file in futuro.

**Portabile — funziona su qualsiasi runtime:**

- Tutto ciò che viene esportato da `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — entrambi comunicano tramite il medesimo canale su qualsiasi runtime
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — le API della piattaforma web standard
- Qualsiasi dipendenza che non richieda l'ambiente Node

**Solo per Node:**

- `rebase.sql()` — la connessione owner al database richiede un socket TCP
- Un client Drizzle/`pg`/`mongodb` importato direttamente, per la medesima ragione
- Moduli integrati di Node: `fs`, `path`, `crypto` (il modulo specifico di Node — `globalThis.crypto` è invece portabile), `child_process`, …
- Pacchetti basati su di essi: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bug latenti su qualsiasi runtime** — è opportuno correggerli a prescindere:

- Lettura di `process.env` a livello di modulo (vedi [Configurazione e segreti](#configurazione-e-segreti))
- Promise non tracciate eseguite in modalità fire-and-forget anziché tramite [`waitUntil`](#attività-in-background)
- Fare affidamento sul fatto che il gestore continui a lavorare anche dopo il timeout della richiesta. Su Node ciò accade per le caratteristiche intrinseche del processo, non perché garantito dal framework

### Verificare le proprie funzioni

Il comando `rebase build` segnala ogni anomalia riscontrata e memorizza il risultato per ogni funzione all'interno del manifest del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` restituisce la medesima analisi senza la necessità di eseguire la build.

### Gestione di percorsi specifici per il runtime

`runtimeKey()` restituisce `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` rappresenta il controllo consueto. Utilizzali per gestire fallback controllati (degrade), non per sdoppiare l'implementazione — una logica che necessita di due implementazioni distinte dovrebbe essere suddivisa in due funzioni differenti.

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

Le custom function vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato l'inizializzazione del core. La sequenza di inizializzazione è la seguente:

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di archiviazione (storage)** — `/api/storage/*`
4. **Route dati** — `/api/data/*` (CRUD per le collezioni)
5. **Custom function** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Le custom function hanno pertanto accesso a tutti i servizi già avviati. Qualsiasi route che debba essere registrata **prima** di Rebase deve essere aggiunta direttamente sull'app Hono, prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// Viene eseguito PRIMA delle route di Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Inizializzazione di Rebase — registra tutte le route sotto /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route collegate all'app principale in questo modo restano **esterne** ai router di Rebase: su di esse non verrà applicato il middleware di autenticazione predefinito e `getDriver(c)` risulterà indefinito. Proteggile utilizzando `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — i quali verificano direttamente il token. I guard importati dal sottopercorso `/functions` cercano di leggere un'identità già elaborata a monte da un router Rebase, e restituiranno un errore 500 piuttosto che procedere in modo indefinito.
:::

## Esempio: Gestore di webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Inizializzato alla prima richiesta a partire dalla configurazione della richiesta stessa. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Intenzionalmente pubblico: Stripe non invia un token. La firma
    // funge da autenticazione, quindi va validata prima di qualsiasi altra operazione.
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
            // L'evasione può continuare dopo la risposta; il codice 200 conferma a Stripe di non ripetere la chiamata.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Debugging

Quando una funzione viene caricata correttamente, vedrai a video:

```
⚡ Loaded function route: hello
```

In caso di problemi durante il caricamento, il loader fornirà un log diagnostico dettagliato:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Il router viene montato a livello di **directory**, non per le singole funzioni in essa contenute. Nel caso in cui l'importazione di ogni singolo file fallisca — è sufficiente una variabile d'ambiente non definita a livello di modulo per bloccare tutti i file — l'endpoint `GET /api/functions` restituirà comunque un codice `200` con una lista vuota e un conteggio di elementi `skipped`, consentendo di distinguere l'assenza di funzioni caricate da una build priva di funzioni. L'accesso a questo elenco richiede un utente autenticato, una chiave API dotata dello scope `functions:invoke`, oppure la chiave di servizio: l'invocazione di ciascuna funzione resta consentita a chiunque ne abbia i permessi specifici, ma l'inventario generale non è pubblico. I dettagli sugli errori rimangono consultabili nei log di avvio.

## Timeout e Rate Limit

Alla route `/api/functions/*` si applicano due limiti:

- **Timeout della richiesta** — 30 secondi come impostazione predefinita, con risposta `504` e codice `FUNCTION_TIMEOUT`. Configurabile tramite `functionsTimeoutMs` (oppure `REBASE_FUNCTIONS_TIMEOUT_MS`); il valore `0` lo disabilita. Il gestore non può essere terminato forzatamente dall'esterno, ma riceve una notifica: l'oggetto `getSignal(c)` fornito da `@rebasepro/server/functions` invia l'abort al momento dell'errore 504. È consigliabile passarlo a `fetch` e a qualsiasi altra operazione che accetti un segnale di cancellazione (`fetch(url, { signal: getSignal(c) })`). Le operazioni a cui non viene passato il segnale continueranno la loro esecuzione — il timeout rilascia il client e il socket, ma non interrompe il lavoro sottostante. Il fatto che il gestore *continui a essere eseguito* dopo il 504 è una caratteristica del ciclo di vita dei processi Node, non una garanzia formale dell'architettura; qualsiasi operazione che debba essere completata con certezza deve essere incapsulata in [`waitUntil`](#attività-in-background).
- **Rate limit** — I chiamanti autenticati e le chiavi API condividono i bucket standard delle API dati. Ai chiamanti anonimi viene invece assegnata una soglia indipendente e molto più permissiva (3000 richieste per finestra temporale), garantendo il corretto funzionamento dei webhook receiver pubblici. Questo comportamento può essere modificato configurando `rateLimit.anonymousFunctions`; indicando `null` la funzionalità viene disattivata.

Le promise rejection non gestite vengono registrate nei log senza provocare l'arresto dell'applicazione, evitando che una chiamata isolata in modalità fire-and-forget possa interrompere l'intero processo. Per ripristinare il comportamento predefinito di Node, imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`.

Su Rebase Cloud, il layer edge posizionato a monte delle tue funzioni applica vincoli specifici; inoltre, lo stato a livello di modulo, il file system e le connessioni in uscita presentano caratteristiche rilevanti da considerare durante la fase di progettazione. Consulta la guida su [Managed backend runtime](/docs/deployment/managed-runtime/).

## Passaggi successivi

- **[Panoramica del Backend](/docs/backend)** — Documentazione completa per la configurazione del backend
- **[Callback sulle entità](/docs/collections/callbacks)** — Esegui logica applicativa alle modifiche dei dati
- **[Cron Job](/docs/backend/cron-jobs)** — Pianificazione di attività in background
