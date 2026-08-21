---
title: Funzioni Personalizzate
sidebar_label: Funzioni Personalizzate
description: Aggiungi endpoint API Hono personalizzati accanto alle tue rotte CRUD di Rebase. Rilevate automaticamente da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate ti permettono di aggiungere **rotte API Hono arbitrarie** accanto agli endpoint CRUD generati automaticamente da Rebase. Seguono lo stesso schema di **rilevamento basato su file** delle collection e dei job cron: metti un file TypeScript nella tua directory `functions/` e Rebase lo monta automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica di business** — approvazioni, promozioni, flussi di lavoro personalizzati
- **Integrazioni di terze parti** — webhook Stripe, comandi Slack, proxy verso API esterne
- **Endpoint pubblici** — moduli di contatto, raccolta contatti, health check
- **Query aggregate** — statistiche di dashboard, report, analisi

## Definire una Funzione Personalizzata

Crea un file nella tua directory `backend/functions/` che esporti di default un'app Hono:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", (c) => c.json({ message: "Hello from custom function!" }));
});
```

Viene montata su **`/api/functions/hello`**. Il nome del file (senza estensione) diventa il prefisso della rotta.

:::important
Importa da **`@rebasepro/server/functions`**, non da `@rebasepro/server`.

Entrambi funzionano. Il sottopercorso è la superficie di scrittura *portabile*: non trascina nulla che richieda Node, così una funzione scritta con esso può girare su qualunque runtime JavaScript. La radice del pacchetto raggiunge l'intero framework — la sequenza di avvio, i loader di file, il livello WebSocket — il che va bene per un entrypoint di server ed è più di quanto serva a un gestore di rotta. Ti dà inoltre accessor di contesto tipizzati (`getUser`, `getDriver`) invece di convertire `c.get("user")` a mano.

Vedi [Portabilità tra runtime](#portabilità-tra-runtime) per il contratto completo.
:::

## Configurazione

Abilita le funzioni personalizzate aggiungendo `functionsDir` alla configurazione del backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase farà quanto segue:

1. Analizzare la directory alla ricerca di file `.ts` / `.js`
2. Verificare che ogni export di default sia un'app Hono (duck-typing tramite `.fetch()` + `.routes`)
3. Montare ogni app su `/api/functions/<filename>`
4. Applicare il middleware di autenticazione (vedi [Autenticazione](#autenticazione-e-propagazione-del-contesto) più sotto)

## Nomi dei File e Mappatura delle Rotte

| File | Percorso di Montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Le funzioni vengono rilevate **solo al livello superiore della directory** — non c'è ricorsione. `functions/admin/users.ts` viene compilato da `rebase build` ma non viene mai montato; appiattisci invece il nome (`functions/admin-users.ts`). Una sottodirectory viene segnalata all'avvio e conteggiata nell'endpoint di elenco, invece di essere ignorata in silenzio.

File che vengono **saltati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo
- Sottodirectory e file `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — segnalati come problemi, dato che la compilazione copre più di quanto il runtime carichi

Il nome è anche l'identità della funzione ovunque: è il segmento dell'URL, il permesso `functions/<name>` di una chiave API e il valore che `REBASE_FUNCTIONS_ONLY` seleziona quando dai a una funzione un processo tutto suo.

## Formati di Export

Oltre a `defineFunction`, il loader accetta due formati di export:

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

`defineFunction` restituisce esattamente l'app Hono che queste costruiscono a mano, quindi le tre forme sono intercambiabili. Ti evita di dichiarare `Hono<HonoEnv>` e ti consegna il singleton `rebase` nella callback.

---

## Sotto il Cofano: Il Loader con Duck-Typing

Compilando codebase con più directory annidate o all'interno di monorepo, puoi imbatterti nella **duplicazione del pacchetto Hono**.

Se il framework Rebase dipende da una versione di Hono e la tua directory locale delle funzioni ne risolve un'altra, i controlli classici di ereditarietà (`exported instanceof Hono`) falliscono, perché i loro prototipi vivono in spazi di memoria distinti.

Per evitare falsi negativi e il rifiuto di router perfettamente validi, Rebase usa un validatore con duck-typing (`isHonoLike`):
- Verifica che l'oggetto esportato sia un `object` non nullo.
- Verifica che l'oggetto esponga un metodo `.fetch` (necessario per instradare le richieste).
- Verifica che `.routes` sia un `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Scappatoia del Compilatore per i Moduli ES

Per importare dinamicamente file TypeScript e JavaScript sia su Windows sia su Posix, il loader converte i percorsi in URI di file standard tramite `pathToFileURL(filePath).href`.

Per impedire che la compilazione TypeScript riscriva gli import dinamici ESM nativi (`import(url)`) in chiamate `require()` di CommonJS (che genererebbero errori a runtime sotto runtime ESM), Rebase esegue una scappatoia del compilatore a runtime:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Autenticazione e Propagazione del Contesto

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle rotte dati, ma con `requireAuth: false`. Questo significa che:

- Il JWT dell'utente viene **analizzato e iniettato** nel contesto, se presente
- Ma le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- Devi **proteggere esplicitamente** le rotte che richiedono autenticazione

Chi presenta un token *non valido* non arriva mai al tuo gestore: un token non verificabile o scaduto viene rifiutato con 401 dal middleware stesso, così una sessione scaduta non viene mai silenziosamente declassata ad anonima.

### Leggere il chiamante

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

`getUser` restituisce un oggetto ristretto: `uid` è una stringa e `roles` è sempre un array, qualunque metodo di autenticazione abbia usato il chiamante. `getUserId(c)` e `getRoles(c)` sono scorciatoie.

### Proteggere le Rotte

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

Metti le guardie nello **slot di middleware della rotta stessa**, come sopra, invece di `app.use("/*", requireAuth)`. `use()` copre solo le rotte dichiarate *sotto* di esso, quindi una rotta aggiunta più tardi — in fondo al file, tra qualche mese — resta silenziosamente non protetta.

:::important
Leggere `getUser(c)` **non** è una guardia. Un chiamante anonimo ottiene `undefined` e il tuo gestore viene eseguito comunque. Solo una guardia, o un `if (!user) return 401` esplicito, ferma la richiesta.
:::

### Autenticazione con Service Key

Rebase supporta una `REBASE_SERVICE_KEY` statica definita nel tuo `.env` per script o chiamate server-to-server.

Quando una richiesta esterna passa la service key tramite l'header Authorization (`Authorization: Bearer <service_key>`), il middleware di autenticazione automaticamente:
1. Valida la chiave con un confronto a tempo costante, per prevenire attacchi di temporizzazione.
2. Concede accesso di livello amministratore, impostando il chiamante a `{ uid: "service", roles: ["admin"] }`.
3. Inietta un `DataDriver` ristretto a quella stessa identità di servizio. La Row-Level Security continua ad applicarsi — viene valutata come `{ uid: "service", roles: ["admin"] }`, non saltata.

### Auto-Autenticazione Interna

Se non hai configurato una `REBASE_SERVICE_KEY`, Rebase genera una **chiave interna casuale per ogni avvio**. Il singleton `rebase` la usa automaticamente quando chiama le API del control plane del server stesso (come `rebase.auth` o `rebase.storage`). La tua logica lato server può quindi sempre svolgere compiti amministrativi, anche senza una service key configurata a mano.

## Accedere al Database e ai Servizi

### 1. Il driver ristretto all'utente — per tutto ciò che serve una richiesta

`getDriver(c)` restituisce il driver **ristretto al chiamante**, così ogni lettura e scrittura viene valutata contro le tue policy di Row-Level Security come quell'utente:

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

`requireDriver(c)` è `getDriver(c)` senza il `!` — solleva un messaggio che nomina il problema di montaggio invece di fallire venti righe dopo su `undefined`.

### 2. `rebase.dataAsAdmin` — per lavoro di background fidato

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

### Driver ristretto da RLS vs. Singleton Rebase

|                     | `getDriver(c)` (legato alla richiesta)         | `rebase.dataAsAdmin` (identità di servizio)                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Viene eseguito come** | Il chiamante (`uid`, i suoi ruoli)         | `{ uid: "service", roles: ["admin"] }`                            |
| **Applicazione RLS** | ✅ Sì (valutata contro il chiamante)          | ✅ Sì (valutata contro l'identità di servizio)                    |
| **Ideale per...**   | CRUD utente, ricerche e query                   | Job di background, trigger di sistema, webhook                    |
| **Stile API**       | Metodi del driver (`fetchCollection`, `save`)   | Accessor fluenti di collection (`rebase.dataAsAdmin.jobs.find`) |

#### Cos'è `dataAsAdmin`, con precisione

`rebase.dataAsAdmin` è **ristretto ad admin, non aggira la RLS**. Il driver viene ristretto una sola volta, all'avvio, con `withAuth({ uid: "service", roles: ["admin"] })`, così ogni lettura e scrittura avviene dentro una transazione che è passata al ruolo limitato `rebase_user` con `app.uid = 'service'`. Le tue policy vengono valutate — contro quell'identità.

Per la maggior parte dei progetti la distinzione non emerge mai, perché le policy di default che Rebase inietta in ogni collection ammettono `serverContext() OR rolesOverlap(['admin'])`, e l'identità di servizio soddisfa il secondo ramo. Emerge nel momento in cui scrivi policy tue:

- **`policy.serverContext()` è falso per esso.** Quell'helper compila in `rebase.uid() IS NULL`, e l'`uid` di questo accessor è `'service'`. Una collection con `disableDefaultPolicies: true` la cui unica regola di scrittura sia `serverContext()` rifiuterà una scrittura di `dataAsAdmin` con l'errore Postgres `42501`, e una lettura su una collection simile restituisce **zero righe con HTTP 200** — la direzione silenziosa. Scrivi `rolesOverlap(["admin"])` (o affiancalo) quando intendi "il mio backend".
- **La sua portata equivale a quella di un utente `admin`.** Concedere il ruolo `admin` a un utente dell'applicazione gli concede esattamente le righe che vede questo accessor. Non è un canale privato.

### 3. `rebase.sql()` — SQL grezzo, e l'unico accessor riservato a Node

Se ti serve davvero un aggiramento incondizionato, `rebase.sql()` è quello: SQL grezzo sulla connessione del proprietario, nessuna policy, tutte le righe. È la cosa più privilegiata nel contesto di una funzione — più dell'accessor che ha "admin" nel nome.

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

Viene eseguito su una connessione TCP verso il tuo database, il che lo rende l'unico accessor legato a un processo Node. Questo non costa nulla in nessun deployment esistente oggi — è semplicemente l'unica cosa da sapere se una funzione dovesse spostarsi in futuro. Vedi [Portabilità tra runtime](#portabilità-tra-runtime).

:::caution[L'accesso diretto a Drizzle è riservato a Node]
Puoi anche importare la tua istanza Drizzle e interrogarla direttamente (`db.execute(sql\`…\`)`). Funziona, e su un deployment Node self-hosted o gestito va benissimo.

Vale la pena sapere cosa costa: una funzione che importa `drizzle-orm` e un pool `pg` è permanentemente una funzione Node, aggira le callback e la validazione della tua collection, e prende la connessione da un posto diverso dalla richiesta. `rebase.sql()` ti dà lo stesso SQL grezzo attraverso la connessione del framework. Preferiscilo.
:::

## Configurazione e Segreti

Leggi la configurazione **dentro** il gestore, mai nello scope del modulo:

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

Perché questo conta su **qualsiasi** runtime, Node incluso:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lettura nello scope del modulo viene valutata quando il file viene importato, prima che esista una richiesta. Su Node questo significa che una singola variabile mancante fa cadere l'intero file e con esso tutte le sue rotte. Su un host che allega la configurazione alla richiesta anziché al processo, al momento dell'import non c'è proprio nulla da leggere.

- `getEnv(c)` — tutte le variabili visibili a questa richiesta
- `env(c, "NAME")` — una variabile, ripulita dagli spazi; vuota vale come non impostata
- `requireEnv(c, "NAME")` — lo stesso, ma solleva un messaggio che nomina la variabile
- `lazyResource(factory)` — costruisce un client costoso una sola volta, al primo utilizzo

`rebase doctor` segnala le letture di `process.env` nello scope del modulo nella tua directory delle funzioni.

## Lavoro in Background

Il lavoro che deve sopravvivere alla risposta va in `waitUntil`:

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

Una promise senza `await` sembra equivalente e non lo è. `waitUntil` porta due cose:

- **Su Node** la promise viene tracciata, così uno spegnimento controllato la attende invece che il processo esca da sotto un webhook mandato a metà. Una promise sospesa a `SIGTERM` è semplicemente persa.
- **Su un host basato su isolate**, all'host viene detto di tenere vivo l'isolate finché la promise non si risolve. Senza, il lavoro viene scartato nel momento in cui la risposta si risolve — in silenzio, con un 200 pulito nei log.

Un rifiuto viene registrato invece di essere lasciato al gestore delle rejection non gestite, così il fallimento nomina la rotta da cui proviene.

## Portabilità tra runtime

Una funzione personalizzata è un'app Hono, e Hono gira su ogni runtime server JavaScript. Se *la tua* funzione possa girare da qualche parte che non sia un processo Node dipende quindi interamente da cosa il suo file importa e tocca.

Nulla di tutto questo limita ciò che puoi scrivere oggi. Ogni deployment di Rebase è un processo Node, una funzione che legge un file o apre un socket è una funzione perfettamente valida, e nessuna compilazione o deployment fallisce per questo. È scritto perché la risposta sia conoscibile ora, invece di essere scoperta file per file più avanti.

**Portabile — funziona su qualsiasi runtime:**

- Tutto ciò che `@rebasepro/server/functions` esporta
- `getDriver(c)` e `rebase.dataAsAdmin` — entrambi passano dallo stesso filo ovunque girino
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la piattaforma web
- Qualsiasi dipendenza che non abbia bisogno di Node

**Riservato a Node:**

- `rebase.sql()` — la connessione del proprietario del database è un socket TCP
- Un client Drizzle/`pg`/`mongodb` importato direttamente, per la stessa ragione
- Moduli integrati di Node: `fs`, `path`, `crypto` (il modulo Node — `globalThis.crypto` è portabile), `child_process`, …
- Pacchetti costruiti su di essi: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bug latenti su ogni runtime** — vale la pena correggerli comunque:

- `process.env` letto nello scope del modulo (vedi [Configurazione e Segreti](#configurazione-e-segreti))
- Promise sospese invece di [`waitUntil`](#lavoro-in-background)
- Contare sul fatto che un gestore continui a girare dopo il timeout della sua richiesta. Su Node lo fa; è una proprietà del processo, non una promessa del framework

### Controllare le tue funzioni

`rebase build` stampa una riga per ogni riscontro azionabile e registra il verdetto per funzione nel manifest del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` riporta lo stesso senza compilare.

### Se ti serve un percorso specifico del runtime

`runtimeKey()` restituisce `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` è il controllo abituale. Usali per degradare, non per biforcare un'implementazione — una funzione che ha bisogno di due implementazioni sono due funzioni.

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

## Ordine di Registrazione delle Rotte

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` ha completato la configurazione principale. L'ordine di inizializzazione è:

1. **Bootstrapper** — connessioni al database, tabelle di autenticazione, servizi realtime
2. **Rotte di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Rotte di storage** — `/api/storage/*`
4. **Rotte dati** — `/api/data/*` (CRUD delle collection)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Job cron** — `/api/cron/*`
7. **WebSocket** — sottoscrizioni realtime

Le tue funzioni personalizzate hanno quindi accesso a tutti i servizi inizializzati. Registra le rotte che devono girare **prima** di Rebase direttamente sull'app Hono, prima di chiamare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Le rotte che aggiungi così alla tua app sono **fuori** da ogni router di Rebase: nessun middleware di autenticazione è stato eseguito su di esse, e `getDriver(c)` non è impostato. Proteggile con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto — che verificano il token da soli. Le guardie del sottopercorso `/functions` leggono un'identità che un router di Rebase ha già risolto, e risponderanno 500 invece di fingere che ne esista una.
:::

## Esempio: Gestore di Webhook

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

Se il caricamento fallisce, il loader fornisce una diagnostica:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Il router viene montato per la **directory**, non per le funzioni al suo interno. Se ogni file fallisce l'import — una sola variabile d'ambiente mancante nello scope del modulo basta a farli cadere tutti — `GET /api/functions` risponde comunque `200` con una lista vuota più un conteggio `skipped`, così "non è stato caricato nulla" resta distinguibile da "questa build non conteneva funzioni". Le ragioni restano nel log di avvio.

## Timeout e Limiti di Frequenza

A `/api/functions/*` si applicano due tetti:

- **Timeout della richiesta** — 30 secondi per default, con risposta `504` e codice `FUNCTION_TIMEOUT`. Configurabile con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo disattiva. Il gestore non può essere annullato dall'esterno, quindi dai un `AbortSignal` alle chiamate HTTP in uscita — il timeout libera il client e il socket, non il lavoro. Che il gestore *continui a girare* dopo il 504 è una proprietà di un processo Node di lunga durata, non una garanzia del contratto; tutto ciò che deve essere completato appartiene a [`waitUntil`](#lavoro-in-background).
- **Limite di frequenza** — i chiamanti con chiave API e quelli autenticati condividono i bucket dell'API dati. I chiamanti anonimi hanno una loro allocazione, molto più ampia (3000 per finestra), perché questo router è pubblico per default per i ricevitori di webhook. Sovrascrivilo con `rateLimit.anonymousFunctions`; `null` lo disattiva.

Le rejection di promise non gestite vengono registrate invece di essere fatali: una chiamata fire-and-forget in una funzione terminerebbe altrimenti l'intero processo. Imposta `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` per il comportamento di default di Node.

## Prossimi Passi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo della configurazione del backend
- **[Callback di Entità](/docs/collections/callbacks)** — Eseguire logica sui cambiamenti dei dati
- **[Job Cron](/docs/backend/cron-jobs)** — Attività di background pianificate
