---
sourceHash: 65910bc3708c9f5d
title: Funzioni personalizzate
sidebar_label: Funzioni personalizzate
description: Aggiungi endpoint API Hono personalizzati accanto alle tue route CRUD di Rebase. Individuazione automatica da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate ti consentono di aggiungere **route API Hono arbitrarie** accanto agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso pattern di **individuazione basata su file** (file-based discovery) di collection e cron job: inserisci un file TypeScript nella tua directory `functions/` e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook Stripe, comandi Slack, proxy per API esterne
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, controlli di integrità (health check)
- **Query di aggregazione** — statistiche per dashboard, report, analisi (analytics)

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

`POST`, perché è ciò che l'SDK invia per impostazione predefinita — vedi
[Invocazione dal client](#invocazione-dal-client). Una route `GET` è altrettanto
valida; il chiamante dovrà semplicemente specificare `{ method: "GET" }`.

`rebase dev` monitora la directory delle funzioni, quindi un file aggiunto mentre è in
esecuzione viene montato al ricaricamento successivo — senza riavvio. (È necessario specificarlo: la
directory viene scansionata anziché importata, quindi il watcher non può dedurlo).

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
`RebaseApiError` in caso di codice non-2xx — in questo modo la struttura dell'errore
definita dalla funzione stessa raggiunge il chiamante invece di un semplice rifiuto di `fetch`.

Tre parametri aggiuntivi che accetta oltre al nome:

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });
```

:::note
Anche `client.call("functions/hello", …)` raggiunge una funzione, ma fa qualcosa
di leggermente diverso: spacchetta `res.data` quando la risposta ne contiene uno. Due modalità
di accesso con due contratti di risposta differenti è una trappola — usa `functions.invoke`. `call`
esiste per le route montate all'esterno di `/api/functions`, che `invoke` non può esprimere.
:::

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso è la superficie di sviluppo *portabile*: non include nulla che richieda Node, quindi una funzione scritta utilizzandolo può essere eseguita su qualsiasi runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di avvio, i loader dei file, il livello WebSocket — il che è corretto per l'entrypoint di un server, ma superfluo per un gestore di route. Ti fornisce inoltre funzioni di accesso al contesto tipizzate (`getUser`, `getDriver`) invece di dover effettuare il cast manuale di `c.get("user")`.

Consulta [Portabilità del runtime](#portabilità-del-runtime) per il contratto completo.
:::

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** nulla da configurare — il runtime rileva `backend/functions/` autonomamente (`entry.functions` in `rebase.json` se è stato spostato). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitano quali funzioni vengono servite da un processo.
**Ejected:** `initializeRebaseBackend({ functionsDir })` in `backend/src/index.ts`.
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

1. Scansiona la directory alla ricerca di file `.ts` / `.js`
2. Valida che ogni export di default sia un'app Hono (duck-typed tramite `.fetch()` + `.routes`)
3. Monta ciascuna app su `/api/functions/<filename>`
4. Applica il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) sotto)

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

Il nome rappresenta l'identità della funzione anche in tutti gli altri contesti: è il segmento URL, il permesso della chiave API `functions/<name>` e il valore utilizzato da `REBASE_FUNCTIONS_ONLY` per selezionarla quando si assegna a una singola funzione un processo dedicato.

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

`defineFunction` restituisce esattamente l'app Hono che questi approcci costruiscono manualmente, quindi i tre sono intercambiabili. Ti evita di dichiarare `Hono<HonoEnv>` e ti passa il singleton `rebase` nella callback.

---

## Dietro le quinte: Il loader duck-typing

Durante la compilazione di codebase con più directory annidate o all'interno di monorepo, potresti riscontrare la **duplicazione del pacchetto Hono**.

Se il framework Rebase dipende da una versione di Hono e la tua directory locale delle funzioni si risolve in un'altra, i controlli standard di ereditarietà delle classi (`exported instanceof Hono`) falliranno perché i loro prototipi risiedono in spazi di memoria separati.

Per prevenire falsi negativi ed evitare di rifiutare il caricamento di router funzionanti, Rebase utilizza un validatore basato su duck typing (`isHonoLike`):
- Verifica che l'oggetto esportato sia un `object` non nullo.
- Controlla che l'oggetto esponga un metodo `.fetch` (necessario per instradare le richieste).
- Verifica che `.routes` sia un `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Escape del compilatore per ES Module

Per importare dinamicamente file TypeScript e JavaScript sia su sistemi Windows che Posix, il loader converte i percorsi dei file in URI di file standard tramite `pathToFileURL(filePath).href`.

Per evitare che la compilazione TypeScript riscriva le importazioni dinamiche ESM native (`import(url)`) in chiamate `require()` di CommonJS (che genererebbero errori a runtime negli ambienti ESM), Rebase esegue un escape del compilatore a runtime:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Autenticazione e propagazione del contesto

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle route dei dati, ma con `requireAuth: false`. Ciò significa che:

- Il JWT dell'utente viene **analizzato e inserito** nel contesto, se presente
- Ma le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- Devi **proteggere esplicitamente** le route che richiedono autenticazione

Un chiamante che presenta un token *non valido* non raggiunge mai il tuo gestore: un token non verificabile o scaduto viene rifiutato con un 401 dal middleware stesso, evitando così che una sessione scaduta venga declassata silenziosamente a una anonima.

### Lettura del chiamante

```typescript
import { defineFunction, getUser, getUserId, getRoles, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c) });
    });
});
```

`getUser` restituisce un oggetto tipizzato e ristretto: `uid` è una stringa e `roles` è sempre un array, indipendentemente dal metodo di autenticazione utilizzato dal chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie.

### Protezione delle route

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without an administrative role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Inserisci i guard nello **slot middleware dedicato della route**, come mostrato sopra, piuttosto che usare `app.use("/*", requireAuth)`. `use()` copre solo le route dichiarate *sotto* di esso; pertanto, una route aggiunta successivamente — in fondo al file, a distanza di mesi — rimarrebbe silenziosamente non protetta.

:::important
Leggere `getUser(c)` **non** costituisce un guard. Un chiamante anonimo riceve `undefined` e il tuo handler viene comunque eseguito. Solo un guard, o un `if (!user) return 401` esplicito, blocca la richiesta.
:::

### Autenticazione con Service Key

Rebase supporta una chiave statica `REBASE_SERVICE_KEY` definita nel tuo `.env` per chiamate tramite script o server-to-server.

Quando una richiesta esterna passa la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione esegue automaticamente le seguenti operazioni:
1. Valida la chiave utilizzando un confronto a tempo costante per prevenire attacchi di temporizzazione (timing attacks).
2. Concede l'accesso a livello di amministratore, impostando il chiamante su `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` con ambito limitato a tale identità di servizio. La Row-Level Security viene comunque applicata — viene valutata come `{ uid: "service", roles: ["admin"] }`, non ignorata.

### Auto-autenticazione interna

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una chiave casuale **interna valida per il singolo avvio (per-boot)**. Il singleton `rebase` utilizza automaticamente questa chiave quando effettua chiamate alle API del piano di controllo (control-plane) interne del server (come `rebase.auth` o `rebase.storage`). Ciò significa che la tua logica lato server può sempre eseguire attività amministrative, anche senza una service key configurata manualmente.

## Accesso al database e ai servizi

### 1. Il driver con ambito utente (user-scoped) — per qualsiasi operazione che gestisce una richiesta

`getDriver(c)` restituisce il driver **con ambito ristretto al chiamante**, in modo che ogni operazione di lettura e scrittura sia valutata rispetto alle tue policy di Row-Level Security per quell'utente:

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

`requireDriver(c)` è `getDriver(c)` senza il `!` — genera un'eccezione con un messaggio che indica il problema di configurazione invece di fallire venti righe dopo a causa di un `undefined`.

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

### Driver con ambito RLS vs Singleton Rebase

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Eseguito come**         | Il chiamante (`uid`, i suoi ruoli)                | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS** | ✅ Sì (valutata rispetto al chiamante)          | ✅ Sì (valutata rispetto all'identità di servizio)                   |
| **Ideale per...**    | CRUD generico utente, ricerca e query          | Job in background, trigger di sistema, webhook                        |
| **Stile API**       | Metodi a livello di driver (`fetchCollection`, `save`) | Funzioni di accesso fluide alle collection (`rebase.dataAsAdmin.jobs.find`) |

#### Cos'è con precisione `dataAsAdmin`

`rebase.dataAsAdmin` ha **ambito amministratore, non bypassa la RLS**. L'ambito del driver viene definito una sola volta, all'avvio, con `withAuth({ uid: "service", roles: ["admin"] })`, quindi ogni lettura e scrittura viene eseguita all'interno di una transazione passata al ruolo ristretto `rebase_user` con `app.uid = 'service'`. Le tue policy vengono valutate — rispetto a tale identità.

Per la maggior parte dei progetti la distinzione non emerge mai, poiché le policy predefinite che Rebase inserisce in ogni collection consentono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa la seconda condizione. La differenza emerge nel momento in cui scrivi policy personalizzate:

- **`policy.serverContext()` restituisce false per esso.** Tale helper compila in `rebase.uid() IS NULL`, e l'`uid` di questo accessor è `'service'`. Una collection con `disableDefaultPolicies: true` la cui unica regola di scrittura è `serverContext()` rifiuterà una scrittura con `dataAsAdmin` restituendo l'errore Postgres `42501`, e una lettura eseguita su tale collection restituirà **zero righe con HTTP 200** — il comportamento silenzioso. Usa `rolesOverlap(["admin"])` (o aggiungilo a fianco) quando intendi "il mio backend".
- **La sua portata equivale a quella di un utente `admin`.** Assegnare il ruolo `admin` a un utente dell'applicazione gli consente di visualizzare esattamente le stesse righe a cui ha accesso questo accessor. Non si tratta di un canale privato.

### 3. `rebase.sql()` — SQL grezzo e l'unico accessor vincolato a Node

Se hai realmente bisogno di un bypass incondizionato, `rebase.sql()` fa al caso tuo: SQL grezzo sulla connessione proprietaria (owner), nessuna policy, tutte le righe. È l'elemento più privilegiato nel contesto di una funzione — ancor più dell'accessor con "admin" nel nome.

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

Viene eseguito su una connessione TCP verso il tuo database, il che lo rende l'unico accessor vincolato a un processo Node. Questo non comporta alcun costo sulle distribuzioni attuali — è semplicemente l'unico aspetto da tenere a mente se la funzione dovesse essere trasferita in seguito. Consulta [Portabilità del runtime](#portabilità-del-runtime).

:::caution[L'accesso diretto a Drizzle è solo per Node]
Puoi anche importare la tua istanza Drizzle ed eseguire query direttamente (`db.execute(sql\`…\`)`). Funziona, e su una distribuzione Node gestita o self-hosted va benissimo.

Vale la pena sapere cosa comporta: una funzione che importa `drizzle-orm` e un pool `pg` diventa permanentemente una funzione Node, bypassa le callback e la validazione delle collection e acquisisce la connessione da una sorgente diversa dalla richiesta. `rebase.sql()` ti offre lo stesso SQL grezzo attraverso la connessione del framework. È consigliabile preferirlo.
:::

## Configurazione e secret

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

Una lettura a livello di modulo viene valutata quando il file viene importato, prima che esista qualsiasi richiesta. Su Node ciò significa che una singola variabile mancante blocca l'intero file e tutte le route al suo interno. Su un host che associa la configurazione alla richiesta anziché al processo, non c'è nulla da leggere al momento dell'importazione.

- `getEnv(c)` — ogni variabile visibile per questa richiesta
- `env(c, "NAME")` — una singola variabile, ripulita da spazi vuoti (trimmed); il valore vuoto è considerato non impostato
- `requireEnv(c, "NAME")` — la stessa cosa, ma genera un errore con il nome della variabile mancante
- `lazyResource(factory)` — inizializza un client oneroso una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` a livello di modulo nella directory delle tue funzioni.

## Attività in background

I task che devono proseguire oltre la risposta vanno inseriti in `waitUntil`:

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

Una promise non attesa (un-awaited) sembra equivalente, ma non lo è. `waitUntil` offre due vantaggi:

- **Su Node**, la promise viene tracciata, quindi una terminazione controllata (graceful shutdown) attende il suo completamento invece di arrestare il processo nel bel mezzo dell'invio di un webhook. Una promise isolata al momento di un `SIGTERM` andrebbe semplicemente persa.
- **Su un host basato su isolate**, l'host viene istruito a mantenere attivo l'isolate fino alla risoluzione della promise. Senza di esso, il lavoro viene interrotto nell'istante in cui la risposta viene inviata — silenziosamente, con un pulito codice 200 nei log.

Un'eventuale rejection viene registrata nei log anziché essere lasciata all'unhandled-rejection handler generico, consentendo così al log dell'errore di specificare la route di provenienza.

## Portabilità del runtime

Una funzione personalizzata è un'app Hono, e Hono può essere eseguito su qualsiasi runtime server JavaScript. La possibilità che la *tua* funzione possa essere eseguita al di fuori di un processo Node dipende quindi da ciò che il suo file importa e utilizza.

Nulla di quanto descritto rappresenta una limitazione su ciò che puoi scrivere oggi. Ogni deployment di Rebase è un processo Node, una funzione che legge un file o apre un socket è perfettamente valida e nessun processo di build o deploy fallirà per questo motivo. Viene documentato affinché tu possa esserne consapevole fin da subito, anziché doverlo scoprire file per file in seguito.

**Portabile — funziona su qualsiasi runtime:**

- Tutto ciò che viene esportato da `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — entrambi comunicano tramite lo stesso protocollo indipendentemente da dove vengono eseguiti
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la piattaforma Web standard
- Qualsiasi dipendenza che non richieda Node

**Solo per Node:**

- `rebase.sql()` — la connessione proprietaria del database è un socket TCP
- Un client Drizzle/`pg`/`mongodb` importato direttamente, per la stessa ragione
- Moduli integrati di Node: `fs`, `path`, `crypto` (il modulo Node — `globalThis.crypto` è portabile), `child_process`, …
- Pacchetti basati su di essi: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bug latenti su qualsiasi runtime** — vale la pena risolverli in ogni caso:

- `process.env` letto a livello di modulo (vedi [Configurazione e secret](#configurazione-e-secret))
- Promise "fire-and-forget" invece di [`waitUntil`](#attività-in-background)
- Affidarsi al fatto che un gestore continui a essere eseguito dopo che la sua richiesta è andata in timeout. Su Node ciò accade; è una proprietà del processo, non una garanzia fornita dal framework

### Verificare le proprie funzioni

`rebase build` stampa una riga per ogni segnalazione utile e registra l'esito per ciascuna funzione nel manifest del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` segnala la stessa informazione senza dover compilare.

### Se necessiti di un percorso specifico per il runtime

`runtimeKey()` restituisce `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` è il controllo comune più utilizzato. Usali per degradare le funzionalità in modo controllato (graceful degradation), non per biforcare un'implementazione — una funzione che richiede due implementazioni diverse è in realtà composta da due funzioni distinte.

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

1. **Bootstrapper** — Connessioni al database, tabelle di autenticazione, servizi real-time
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di storage** — `/api/storage/*`
4. **Route dei dati** — `/api/data/*` (CRUD per le collection)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/cron/*`
7. **WebSocket** — Sottoscrizioni real-time

Ciò significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra qualsiasi route che debba essere eseguita **prima** di Rebase direttamente sull'app Hono, prima di chiamare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le route aggiunte alla tua app in questo modo si trovano **all'esterno** di qualsiasi router di Rebase, pertanto nessun middleware di autenticazione è stato eseguito su di esse e `getDriver(c)` risulterà non impostato. Proteggi tali route con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano autonomamente il token. I guard sul sottopercorso `/functions` leggono un'identità già risolta da un router di Rebase e risponderanno con 500 piuttosto che fingere che ne esista una.
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

Quando una funzione viene caricata correttamente, vedrai:

```
⚡ Loaded function route: hello
```

Se il caricamento fallisce, il loader fornisce un output di diagnostica:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Il router viene montato per la **directory**, non per le singole funzioni al suo interno. Se l'importazione di ogni file fallisce — una sola variabile d'ambiente mancante a livello di modulo è sufficiente a bloccarli tutti — `GET /api/functions` risponde comunque con `200` restituendo un elenco vuoto e un conteggio `skipped`, così da poter distinguere "nessun elemento caricato" da "questa build non include funzioni". L'elenco stesso richiede un chiamante autenticato, una chiave API o la service key — le funzioni rimangono invocabili da chiunque ciascuna di esse autorizzi, ma il loro inventario non è pubblico. I motivi degli errori rimangono nel log di avvio.

## Timeout e rate limit

A `/api/functions/*` si applicano due limiti massimi:

- **Timeout della richiesta** — 30 secondi per impostazione predefinita, rispondendo con `504` e il codice `FUNCTION_TIMEOUT`. Configura con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disabilita. L'handler non può essere annullato dall'esterno, quindi assegna alle chiamate HTTP in uscita un `AbortSignal` — il timeout libera il client e il socket, ma non interrompe il lavoro in corso. Il fatto che l'handler *continui a essere eseguito* dopo l'errore 504 è una caratteristica di un processo Node a lunga esecuzione, non una garanzia del contratto; qualsiasi operazione che debba necessariamente completarsi appartiene a [`waitUntil`](#attività-in-background).
- **Rate limit** — I chiamanti con chiave API e autenticati condividono i bucket dell'API dei dati. I chiamanti anonimi ricevono una quota dedicata, molto più permissiva (3000 per finestra temporale), poiché questo router è pubblico per impostazione predefinita per la ricezione dei webhook. È possibile sovrascriverlo con `rateLimit.anonymousFunctions`; `null` lo disattiva.

I rifiuti di promise non gestiti (unhandled promise rejections) vengono registrati nei log anziché essere fatali: una chiamata fire-and-forget in una funzione terminerebbe altrimenti l'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per ripristinare il comportamento predefinito di Node.

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Documentazione completa sulla configurazione del backend
- **[Callback delle entità](/docs/collections/callbacks)** — Esegui logica alle modifiche dei dati
- **[Cron Job](/docs/backend/cron-jobs)** — Attività pianificate in background
