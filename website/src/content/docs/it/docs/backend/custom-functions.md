---
sourceHash: bc87b4afd43a6b60
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati insieme alle tue route CRUD di Rebase. Rilevati automaticamente da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate ti consentono di aggiungere **route API Hono arbitrarie** accanto agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **rilevamento basato su file** delle collezioni e dei cron job: inserisci un file TypeScript nella directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint per la logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy per API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, health check
- **Query di aggregazione** — statistiche per dashboard, report, analisi

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

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in esecuzione viene montato al ricaricamento successivo — senza riavvii. (Deve essere comunicato: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo da solo).

## Invocare dal client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` costruisce l'URL, allega il token del chiamante e genera un `RebaseApiError` in caso di risposta diversa da 2xx — in modo che la struttura dell'errore restituita dalla funzione stessa raggiunga il chiamante anziché un semplice rifiuto di `fetch`.

Oltre al nome, accetta altri quattro parametri:

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
Anche `client.call("functions/hello", payload)` può raggiungere una funzione. Esegue sempre una `POST` e, come `invoke`, restituisce il body testuale — nessuno dei due estrae automaticamente una chiave `data`. È preferibile utilizzare `functions.invoke`, che supporta un metodo, un sotto-percorso e un `responseType`; `call` esiste per le route montate all'esterno di `/api/functions`, che `invoke` non può rappresentare.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sotto-percorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto richiama l'intero framework — la sequenza di avvio, i loader di file, il livello WebSocket — il che è appropriato per un entrypoint del server, ma eccessivo per un semplice gestore di route. Ti fornisce inoltre accessor di contesto tipizzati (`getUser`, `getDriver`) invece di dover effettuare manualmente il casting di `c.get("user")`.

Vedi [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime rileva automaticamente `backend/functions/` (o la voce `functions` nel file `rebase.json` dell'app backend se è stata spostata). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo con `REBASE_ROLE=functions`; qualsiasi altro ruolo rifiuterà l'avvio se queste variabili sono impostate.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, o `functions` (sotto), in `backend/src/index.ts`.
:::

Abilita le funzioni personalizzate aggiungendo `functionsDir` alla configurazione del backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase eseguirà i seguenti passaggi:

1. Scansionerà la directory alla ricerca di file `.ts` / `.js`
2. Validerà che ogni esportazione predefinita sia un'app Hono (verificato tramite duck-typing con `.fetch()` + `.routes`)
3. Monterà ciascuna app su `/api/functions/<nome-file>`
4. Applicherà il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) di seguito)

### Funzioni come valori

Una directory è uno dei modi per generare ciò che il server gestisce: una mappatura da segmento URL ad app Hono. Puoi passare direttamente questo record come `functions`, oppure leggere una directory al suo interno tramite `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fornisci `functions` o `functionsDir`, non entrambi: l'avvio rifiuterà la presenza di entrambi contemporaneamente. `loadFunctions(dir, { onSkip })` ti restituisce ogni file ignorato, specificandone il motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` funzionano ancora, ma sono deprecati e generano un unico avviso. Di per sé, il gruppo delle funzioni può essere montato su qualsiasi percorso con `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` continuano a funzionare al suo interno; consulta [Integrazione server personalizzato](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Denominazione dei file e mappatura delle route

| File | Percorso di montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono rilevate **esclusivamente al livello principale della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma mai montato; appiattisci invece il nome (`functions/admin-users.ts`). Una sottodirectory viene segnalata all'avvio e conteggiata nell'endpoint di elenco anziché essere ignorata silenziosamente.

File che vengono **ignorati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, poiché la build compila più elementi di quanti il runtime ne carichi

Il nome rappresenta l'identità della funzione anche in tutti gli altri contesti: è il segmento URL, la destinazione dello scope `functions:invoke:<name>` richiesto a una chiave per poterla chiamare, e il valore utilizzato da `REBASE_FUNCTIONS_ONLY` quando si assegna a una funzione un processo dedicato.

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

`defineFunction` restituisce esattamente l'app Hono che questi formati creano manualmente, quindi i tre sono intercambiabili. Ti risparmia la dichiarazione di `Hono<HonoEnv>` e ti fornisce il singleton `rebase` nella funzione di callback.

---

## Dietro le quinte: il loader basato su duck typing

In un monorepo, le tue funzioni potrebbero risolvere una copia diversa di Hono rispetto a quella usata da Rebase, e in tal caso `exported instanceof Hono` risulterebbe falso pur trattandosi di un router funzionante. Per questo motivo il loader controlla invece la forma dell'oggetto (`isHonoLike`): un oggetto non nullo con un metodo `.fetch` e un array `.routes`.

### Escape del compilatore ES Module

Il loader trasforma ogni percorso di file in un URL di file (`pathToFileURL(filePath).href`), in modo che venga importato sia su Windows che su sistemi POSIX, e invoca `import(url)` tramite `new Function("url", "return import(url)")`, evitando così che una build TypeScript possa riscriverlo in un `require()` non compatibile in ambiente ESM.

---

## Autenticazione e propagazione del contesto

Le funzioni personalizzate sono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e iniettato** nel contesto se presente
- Le richieste **non vengono respinte** se non viene fornito alcun JWT
- È necessario **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che presenta un token *non valido* non raggiungerà mai il tuo gestore: un token non verificabile o scaduto viene respinto con 401 direttamente dal middleware, evitando così che una sessione scaduta venga declassata silenziosamente a utente anonimo.

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

`getUser` restituisce un oggetto tipizzato in modo ristretto: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione usato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie. `getScopes(c)` elenca tutto ciò che il chiamante ha il permesso di fare, sotto forma di stringhe di [scope](/docs/backend/roles-and-scopes/): per una persona fisica comprende il data plane, gli scope specifici dell'app e quelli derivati dai propri ruoli; per una chiave API, corrisponde esattamente agli scope assegnati alla chiave.

### L'account del chiamante

`getUser(c)` legge il token di accesso, e il token contiene l'ID, i ruoli e l'indirizzo del chiamante. Non indica come l'account ha effettuato l'accesso o quale sia il suo nome visualizzato. `getUserProfile(c)` recupera questi dati dallo store di autenticazione:

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

`providers` elenca le modalità con cui l'account può accedere: `"password"` se ne ha una, seguita da ciascun provider collegato (`"google"`, `"apple"`, …) nell'ordine in cui è stato associato. Un account ospite, o uno che accede solo tramite codice monouso, ha un elenco vuoto.

La lettura è aggiornata a ogni richiesta: un provider collegato dal chiamante pochi istanti prima sarà visibile nella sua richiesta successiva, senza attendere il rinnovo del token. La prima chiamata all'interno di una richiesta richiede due ricerche con chiave, eseguite contestualmente. Le chiamate successive nella stessa richiesta riutilizzano il risultato, mentre una richiesta che non effettua mai la chiamata non comporta alcun costo.

Restituisce `undefined` per i chiamanti anonimi, per i chiamanti con service-key o API-key che non agiscono a nome di un account, e per gli account non più esistenti. Restituisce inoltre `undefined` su un backend i cui account risiedono su un [auth adapter](/docs/backend/auth-adapters/) esterno: in tal caso, interroga direttamente quel provider. Quando un amministratore invia `x-rebase-impersonate`, restituisce l'account impersonato.

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

Inserisci i guard direttamente nello **slot del middleware della route stessa**, come mostrato sopra, piuttosto che usare `app.use("/*", requireAuth)`. `use()` agisce solo sulle route dichiarate *al di sotto* di esso, perciò una route aggiunta in un secondo momento — magari in fondo al file a distanza di mesi — resterebbe priva di protezione in modo non evidente.

:::important
La lettura di `getUser(c)` **non** è un guard. Un chiamante anonimo riceve `undefined` e il tuo handler viene comunque eseguito. Solo un guard, o un controllo esplicito `if (!user) return 401`, blocca la richiesta.
:::

### Scope e app scope

`requireAdmin` consente l'accesso solo al ruolo `admin` e a nessun altro. Per un'azione a cui deve poter accedere un ruolo più specifico o una chiave API, proteggi la route con `requireScope`. Questo accetta uno [scope](/docs/backend/roles-and-scopes/) integrato oppure uno definito dall'applicazione sotto `auth.scopes` nella collezione users, come `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Ogni utente autenticato possiede tutti gli scope dell'app, quindi per una persona fisica `requireScope` non determina l'accesso: verifica all'interno dell'handler se tale persona è autorizzata a effettuare il deploy di questo specifico progetto. Il valore aggiunto dello scope è la possibilità di **limitare i permessi di una chiave**: una chiave contenente `project:deploy:p1` sarà valida solo per `p1`. Una chiave necessita inoltre di `functions:invoke`, o di `functions:invoke:<name>`, prima di poter raggiungere del tutto la funzione. Consulta [App scope](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticazione con Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel file `.env` per chiamate script o da server a server.

Quando una richiesta esterna trasmette la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione esegue automaticamente le seguenti operazioni:
1. Valida la chiave utilizzando un confronto a tempo costante per prevenire attacchi di tipo timing attack.
2. Assegna l'accesso a livello di amministratore, impostando il chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` configurato con tale identità di servizio. La Row-Level Security rimane attiva — viene valutata per `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Autenticazione interna automatica

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale per ogni avvio**. Il singleton `rebase` utilizza questa chiave in modo automatico quando interagisce con le API del control-plane del server (come `rebase.auth` o `rebase.storage`). Questo garantisce che la logica lato server possa sempre svolgere attività amministrative, anche in assenza di una service key configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver con ambito utente — per tutto ciò che serve una richiesta

`getDriver(c)` restituisce il driver **con ambito limitato al chiamante**, in modo che ogni lettura e scrittura venga valutata rispetto alle tue policy di Row-Level Security con l'identità di quell'utente:

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

`requireDriver(c)` corrisponde a `getDriver(c)` senza l'operatore `!` — genera un'eccezione con un messaggio che descrive il problema di configurazione anziché fallire venti righe più avanti a causa di un `undefined`.

<span class="since-badge" data-since="0.31">Since 0.31</span> `fetchCollection` e `fetchOne` restituiscono le stesse righe fornite da `GET /api/data/<table>`: le date come stringhe RFC 3339, una relazione `belongsTo` tramite la sua foreign key (`authorId`), e una riga correlata solo se esplicitamente specificata in `include` — ad esempio `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

`rebase.dataAsAdmin` non è tipizzato fino a quando non [registri il tuo `Database` generato](/docs/backend/typed-server-data).

### Driver con ambito RLS vs. Singleton Rebase

|                     | `getDriver(c)` (ambito della richiesta)       | `rebase.dataAsAdmin` (identità di servizio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Viene eseguito come** | Il chiamante (`uid`, i suoi ruoli)          | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS**| ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)                |
| **Ideale per...**   | Operazioni CRUD utente generali, ricerche e query | Job in background, trigger di sistema, webhook                   |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Accessor fluenti alle collezioni (`rebase.dataAsAdmin.jobs.find`) |

#### Cosa è `dataAsAdmin`, esattamente

`rebase.dataAsAdmin` ha **ambito admin, ma non bypassa la RLS**. Il driver riceve il suo ambito una sola volta all'avvio, con `withAuth({ uid: "service", roles: ["admin"] })`, quindi ogni lettura e scrittura viene eseguita all'interno di una transazione passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. Le tue policy vengono valutate — rispetto a tale identità.

Per la maggior parte dei progetti questa distinzione è trasparente, poiché le policy predefinite che Rebase applica a ogni collezione consentono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa il secondo ramo. La questione emerge nel momento in cui scrivi policy personalizzate:

- **`policy.serverContext()` restituisce false per questa identità.** Questo helper compila in `rebase.uid() IS NULL`, mentre l'identità di questo accessor ha `uid` impostato su `'service'`. Una collezione con `disableDefaultPolicies: true` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura effettuata con `dataAsAdmin` restituendo l'errore Postgres `42501`, e una lettura eseguita sulla stessa collezione restituirà **zero righe con HTTP 200** — il comportamento silente. Scrivi `rolesOverlap(["admin"])` (o aggiungilo a fianco) quando intendi riferirti al "tuo backend".
- **Il suo raggio d'azione coincide con quello di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli consente di visualizzare esattamente le stesse righe accessibili tramite questo accessor. Non si tratta di un canale riservato.

### 3. `getSql(c)` — SQL come chiamante

Quando l'SDK non consente di esprimere una query o un'operazione di scrittura in modo lineare — come un upsert condizionale, un'operazione compare-and-swap del tipo `UPDATE … WHERE rev = $3 RETURNING`, un `count(*) FILTER (…)`, o una CTE — puoi scrivere direttamente l'istruzione SQL ed eseguirla con i permessi del chiamante:

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

L'istruzione viene eseguita all'interno della transazione del chiamante, utilizzando il ruolo ristretto `rebase_user` associato alla sua identità — la stessa transazione aperta dal driver con ambito utente — garantendo che le regole di sicurezza delle tue collezioni decidano per ciascuna riga, esattamente come avviene tramite l'SDK. Una query che richiede tutte le righe otterrà solo quelle accessibili al chiamante.

- **Di sola lettura per impostazione predefinita.** Passa `{ write: true }` per consentire operazioni di inserimento, aggiornamento o cancellazione; le policy di insert e update continueranno a essere applicate.
- **Il testo della query è tuo; i valori vanno inseriti in `params`** (`$1`, `$2`, …). L'identità del chiamante risiede nelle impostazioni della transazione, che l'SQL potrebbe alterare; per questo motivo, qualsiasi istruzione che potrebbe farlo — come `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, o l'invio di query multiple — viene rifiutata con `400 SQL_NOT_ALLOWED` prima dell'esecuzione. L'interpolazione dell'input utente nel testo della query metterebbe alla prova questa protezione: non farlo.
- **Cosa condivide con l'SDK.** Le policy e tre regole applicate da Postgres a entrambi: una [vista materializzata](/docs/collections/views/#materialized-views) restituisce le sue righe solo ai rispettivi `roles`, una riga appartenente a una tabella che definisce un `tenant` non può essere spostata a un altro tenant se non da un chiamante con privilegi `bypassRoles` (`TENANT_IMMUTABLE`), e l'uso delle funzioni interne del server (`rebase.record_history`, `rebase.enqueue_job`) viene respinto. Una colonna che il chiamante non ha il permesso di leggere — contrassegnata come `.private()`, o soggetta a una condizione `.access({ read })` non soddisfatta — viene omessa dai risultati, allo stesso modo dell'API, se è un riferimento diretto alla colonna (`SELECT *`, `password_hash AS h`); un valore *calcolato* a partire da essa (`md5(password_hash)`) non viene rilevato, pertanto evita di effettuare calcoli su tali campi.
- **Cosa non condivide.** Gli hook `beforeQuery` e `afterRead`, la validazione, gli hook di salvataggio e la cronologia risiedono in Node e non vengono eseguiti.

All'interno di uno script, [`openRebase`](/docs/backend/embedding-postgres-driver/) offre la stessa funzionalità: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL con l'identità di servizio

Una funzione che applica regole personalizzate (un ticket al giorno, una verifica temporale) su tabelle accessibili in lettura solo agli amministratori non può utilizzare `getSql(c)`: richiederebbe che il chiamante disponga di policy che lo autorizzino, ma tali policy aprirebbero le tabelle anche sulle API dati pubbliche. `rebase.sqlAsAdmin` esegue l'istruzione con l'identità `{ uid: "service", roles: ["admin"] }`, la stessa usata da `rebase.dataAsAdmin`, mantenendo attiva la medesima row-level security:

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

Si tratta a tutti gli effetti di `getSql(c)` con un'identità differente: il ruolo ristretto della richiesta, il ramo admin delle tue policy, sola lettura a meno che non sia specificato `{ write: true }`, e la medesima protezione `SQL_NOT_ALLOWED`. A differenza di `rebase.sql()` dell'owner, non può eseguire comandi DDL e, per quanto riguarda l'archivio di autenticazione, può accedere solo a ciò che un amministratore può raggiungere tramite la collezione users: sessioni, chiavi e segreti MFA rimangono inaccessibili per il ruolo della richiesta, e gli hash delle password vengono rimossi dai record restituiti. Una singola query comporta un unico round trip, esattamente come `rebase.sql()`. È disponibile anche negli script tramite `openRebase()`.

### 4. `rebase.sql()` — SQL owner e l'unico accessor vincolato a Node

<span class="since-badge" data-since="0.31">Since 0.31</span>

Se hai effettivamente la necessità di bypassare incondizionatamente i controlli, `rebase.sql()` è lo strumento indicato: esecuzione di SQL non elaborato tramite la connessione owner, senza applicazione di policy, con accesso a ogni riga. Rappresenta la risorsa con maggiori privilegi nel contesto di una funzione — ancor più dell'accessor che include "admin" nel nome.

Non deve essere utilizzato per creare tabelle. Una tabella viene [dichiarata](/docs/schema/) con `defineTable` in `backend/schema/` e creata durante la procedura di avvio; una tabella creata con `CREATE TABLE` all'interno di una funzione è sprovvista di validazione, hook, configurazioni di sicurezza a livello di riga, interfaccia nel pannello admin e tipi SDK. L'esecuzione di una simile istruzione tramite `rebase.sql()` viene consentita, ma genera un avviso nei log indicando la tabella da dichiarare formalmente.

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

Viene eseguito attraverso una connessione TCP verso il database, risultando l'unico accessor strettamente vincolato a un processo Node. Questo non comporta svantaggi in alcuno dei modelli di deployment attuali — è semplicemente l'unico elemento da tenere a mente nel caso in cui una funzione debba essere trasferita in futuro. Consulta [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è vincolato a Node]
È possibile importare la propria istanza di Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Questa soluzione è funzionante e pienamente supportata su distribuzioni Node self-hosted o gestite.

È importante considerare i vincoli implicati: una funzione che importa `drizzle-orm` e un pool `pg` resta vincolata in modo permanente all'ambiente Node, ignora gli hook di tabella normalmente eseguiti da `rebase.data` (nessuno dei due verifica `.validate()`, che si applica alle [richieste API](/docs/collections/validation-and-conditions/#where-validation-runs)) e preleva la propria connessione separatamente rispetto al ciclo di vita della richiesta. `rebase.sql()` offre lo stesso accesso a SQL grezzo tramite la connessione gestita dal framework, mentre `getSql(c)` lo rende disponibile nel rispetto delle policy del chiamante. È consigliabile preferire questi ultimi.
:::

## Configurazione e Secret

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

Perché questo aspetto è importante su **qualsiasi** runtime, incluso Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lettura eseguita a livello di modulo viene valutata durante l'importazione del file, prima che qualsiasi richiesta venga gestita. Su Node, una singola variabile mancante causa il fallimento dell'intero file, rendendo inaccessibili tutte le route ivi definite. Su un host che assegna la configurazione alla richiesta anziché al processo, non vi sarà alcun valore disponibile da leggere al momento dell'importazione.

- `getEnv(c)` — tutte le variabili visibili per questa richiesta
- `env(c, "NAME")` — una variabile specifica, con rimozione degli spazi bianchi; una stringa vuota viene considerata come non impostata
- `requireEnv(c, "NAME")` — identico al precedente, ma genera un'eccezione specificando il nome della variabile se mancante
- `lazyResource(factory)` — inizializza un client ad alto costo di allocazione una sola volta, al primo utilizzo

`rebase doctor` rileva e segnala letture di `process.env` a livello di modulo nella directory delle funzioni.

## Attività in background

Questo argomento è trattato nella sezione dedicata: [Attività in background](/docs/backend/background-work/).

## Portabilità del runtime

Una funzione personalizzata è un'applicazione Hono, pertanto la possibilità di eseguirla al di fuori di un processo Node dipende esclusivamente da ciò che il file importa. L'utilizzo di `rebase.sql()`, l'importazione diretta di client per database e l'uso di moduli nativi di Node vincolano la funzione a questo ambiente; le restanti funzionalità di `rebase` e le API della piattaforma Web non presentano tale vincolo e sono pienamente compatibili. La pagina [Portabilità del runtime](/docs/backend/runtime-portability/) descrive i componenti portabili, le modalità di segnalazione da parte di `rebase build` e `rebase doctor` e le strategie per differenziare la logica in base al runtime.

## Ordine di registrazione delle route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato la configurazione dei servizi di base. L'ordine di inizializzazione è il seguente:

1. **Bootstrappers** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di archiviazione (Storage)** — `/api/storage/*`
4. **Route dei dati** — `/api/data/*` (operazioni CRUD per le collezioni)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/admin/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Di conseguenza, le funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Eventuali route che necessitano di essere registrate **prima** di Rebase devono essere collegate direttamente all'app Hono, prima di invocare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route collegate alla tua applicazione in questo modo si trovano **all'esterno** dei router di Rebase; pertanto, non sono protette dal middleware di autenticazione e `getDriver(c)` risulterà non impostato. Per proteggere tali endpoint, impiega `requireAuth` / `requireAdmin` importati dalla radice del pacchetto **`@rebasepro/server`**, che provvedono a verificare il token in autonomia. I guard del sotto-percorso `/functions` si aspettano un'identità già elaborata dal router di Rebase e genereranno un errore 500 anziché assumere un valore fittizio.
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

Durante il caricamento delle funzioni, la procedura di avvio registra il messaggio `Loaded custom functions` indicandone il numero. Ogni singola funzione viene registrata a livello `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

In caso di problemi durante il caricamento, il loader fornisce informazioni diagnostiche:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Il router viene montato a livello di **directory**, non in base alle singole funzioni presenti. Se l'importazione di tutti i file fallisce — ad esempio a causa di una variabile d'ambiente mancante valutata a livello di modulo — la richiesta `GET /api/functions` risponderà comunque con `200`, restituendo un elenco vuoto e il conteggio dei file `skipped`, consentendo di distinguere la mancata importazione dall'assenza effettiva di funzioni nella build. La consultazione dell'elenco richiede un chiamante autenticato, una chiave API con scope `functions:invoke`, oppure la service key — le funzioni restano invocabili da chiunque sia autorizzato da ciascuna di esse, ma l'inventario complessivo non è pubblico. Le motivazioni degli errori rimangono annotate nel log di avvio.

## Timeout e rate limit

Due soglie massime si applicano al percorso `/api/functions/*`:

- **Timeout della richiesta** — 30 secondi come impostazione predefinita, con risposta `504` e codice `FUNCTION_TIMEOUT`. È possibile configurarlo tramite `functionsTimeoutMs` (oppure `REBASE_FUNCTIONS_TIMEOUT_MS`); impostando `0` il timeout viene disabilitato. Il gestore non può essere interrotto dall'esterno, ma viene informato dell'evento: l'istanza restituita da `getSignal(c)` del modulo `@rebasepro/server/functions` invia un segnale di abort nel momento in cui scatta il 504, consentendo di propagarla a `fetch` e a qualsiasi altra API che accetti un signal (`fetch(url, { signal: getSignal(c) })`). Le operazioni a cui non viene passato il signal continuano la loro esecuzione: il timeout serve a liberare il client e il socket, non a interrompere l'elaborazione. Il fatto che l'handler *continui a essere eseguito* dopo l'errore 504 è una caratteristica propria dei processi Node a esecuzione prolungata, non una garanzia del contratto applicativo; qualsiasi elaborazione che deve essere portata a termine con certezza deve essere gestita tramite [`waitUntil`](#attività-in-background).
- **Rate limit** — I chiamanti autenticati e tramite chiave API condividono gli stessi limiti previsti per le API dati. I chiamanti anonimi dispongono di una soglia dedicata, notevolmente più ampia (3000 richieste per finestra temporale), per supportare la natura pubblicamente accessibile del router necessaria alla ricezione di webhook. È possibile sovrascrivere questo parametro mediante `rateLimit.anonymousFunctions`; impostandolo su `null` il rate limit viene disattivato.

Eventuali eccezioni non gestite nelle promise (unhandled promise rejections) vengono annotate nei log senza provocare il crash dell'applicazione, evitando che un'invocazione asincrona non attesa in una singola funzione provochi la terminazione dell'intero processo. Per ripristinare il comportamento predefinito di Node, impostare `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`.

Su Rebase Cloud, il livello di edge interposto a monte delle funzioni adotta limiti specifici, e aspetti come lo stato a livello di modulo, il file system e le connessioni in uscita presentano caratteristiche di cui tenere conto nella progettazione dell'architettura. Per maggiori dettagli, fare riferimento alla documentazione sul [Managed backend runtime](/docs/deployment/managed-runtime/).

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esecuzione di logica personalizzata al cambio dei dati
- **[Cron Job](/docs/backend/cron-jobs)** — Attività pianificate in background
