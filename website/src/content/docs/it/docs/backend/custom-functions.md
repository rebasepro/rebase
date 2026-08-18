---
title: Funzioni Personalizzate
sidebar_label: Funzioni Personalizzate
description: Aggiungi endpoint API Hono personalizzati accanto alle tue route CRUD di Rebase. Scoperta automatica da una directory, con accesso completo all'istanza backend.
---

## Panoramica

Le funzioni personalizzate ti permettono di aggiungere **route API Hono arbitrarie** accanto agli endpoint CRUD auto-generati di Rebase. Seguono lo stesso modello di **scoperta basata su file** delle collezioni e dei cron job: inserisci un file TypeScript nella tua directory `functions/`, e Rebase lo monterà automaticamente.

Usa le funzioni personalizzate per:

- **Endpoint di logica aziendale** — approvazioni, promozioni, workflow personalizzati
- **Integrazioni di terze parti** — webhook di Stripe, comandi Slack, proxy API esterni
- **Endpoint pubblici** — moduli di contatto, acquisizione lead, controlli di stato
- **Query aggregate** — statistiche dashboard, report, analisi

## Definire una Funzione Personalizzata

Crea un file nella tua directory `backend/functions/` che esporta di default un'applicazione Hono:

```typescript
// backend/functions/hello.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", (c) => {
    return c.json({ message: "Hello from custom function!" });
});

export default app;
```

Questo viene montato su **`/api/functions/hello`**. Il nome del file (senza estensione) diventa il prefisso della route.

## Configurazione

Abilita le funzioni personalizzate aggiungendo `functionsDir` alla tua configurazione backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase farà:

1. Scannerizzare la directory per file `.ts` / `.js`
2. Convalidare che ogni esportazione di default sia un'app Hono (duck-typed tramite `.fetch()` + `.routes`)
3. Montare ogni app su `/api/functions/<filename>`
4. Applicare il middleware di autenticazione (vedi [Autenticazione](#authentication) sotto)

## Nomenclatura dei File e Mappatura delle Route

| File | Percorso di Montaggio |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

File che vengono **saltati**:

- `index.ts` / `index.js` — riservati
- `*.test.ts` / `*.test.js` — file di test
- `*.d.ts` — dichiarazioni di tipo

## Formati di Esportazione

Il loader accetta due formati di esportazione:

### App Hono (raccomandato)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Funzione Factory

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

Entrambi vengono rilevati tramite duck-typing — il loader controlla le proprietà `.fetch()` e `.routes`, quindi qualsiasi istanza compatibile con Hono funzionerà indipendentemente dalla versione di Hono installata.

## Autenticazione

Le funzioni personalizzate vengono montate con lo **stesso middleware di autenticazione** delle route dati, ma con `requireAuth: false`. Questo significa:

- Il JWT dell'utente viene **parsiato e iniettato** nel contesto se presente
- Ma le richieste **non vengono rifiutate** se non viene fornito alcun JWT
- Devi **proteggere esplicitamente** le route che richiedono autenticazione

### Protezione delle Route

Usa gli helper di autenticazione integrati di Rebase:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

// Public endpoint — no auth required
app.get("/public", (c) => {
    return c.json({ message: "Anyone can access this" });
});

// Protected endpoint — requires a valid JWT
app.post("/protected", async (c) => {
    // Narrowed: the env types every variable the middleware may set.
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ message: `Hello, ${user.uid}` });
});

// Admin-only endpoint
app.post("/admin-only", async (c) => {
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    const roles: string[] = user?.roles ?? [];
    if (!roles.includes("admin")) {
        return c.json({ error: "Admin access required" }, 403);
    }
    return c.json({ message: "Admin operation succeeded" });
});

export default app;
```

:::important
Il middleware JWT di Rebase è limitato alle route API integrate (`/api/data`, `/api/auth`, ecc.). Le route delle funzioni personalizzate ottengono il **contesto utente parsato**, ma devi imporre il controllo degli accessi da solo.
:::

## Accedere al Database

Le funzioni personalizzate vengono eseguite insieme a Rebase, quindi puoi accedere al database tramite due approcci:

### 1. Tramite il Singleton di Rebase (Raccomandato)

Il pacchetto `@rebasepro/server` fornisce un singleton `rebase` che ti dà accesso a livello amministrativo a tutti i servizi con ambito applicazione (dati, autenticazione, storage, email) da qualsiasi punto del tuo backend.

```typescript
// backend/functions/approve-job.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { rebase } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");

    // Use the admin-level data API (bypasses RLS)
    await rebase.data.saveEntity("jobs", {
        id,
        status: "published",
        approved_at: new Date().toISOString(),
    });

    return c.json({ success: true });
});

export default app;
```

### 2. Tramite Accesso Diretto a Drizzle

```typescript
// backend/functions/reports.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { db } from "../src/db"; // Your Drizzle instance
import { sql } from "drizzle-orm";

const app = new Hono<HonoEnv>();

app.get("/stats", async (c) => {
    const result = await db.execute(sql`
        SELECT COUNT(*) as total FROM jobs WHERE status = 'published'
    `);
    return c.json({ totalJobs: result.rows[0]?.total });
});

export default app;
```

:::tip
L'istanza `db` di Drizzle utilizzata da Rebase è la stessa che passi a `createPostgresBootstrapper`. Puoi condividerla liberamente tra funzioni personalizzate e Rebase.
:::

## Ordine di Registrazione delle Route

Le funzioni personalizzate vengono caricate e montate **dopo** che `initializeRebaseBackend()` completa la configurazione principale. L'ordine di inizializzazione è:

1. **Bootstrappers** — Connessioni al database, tabelle di autenticazione, servizi realtime
2. **Route di autenticazione** — `/api/auth/*`, `/api/admin/*`
3. **Route di storage** — `/api/storage/*`
4. **Route dati** — `/api/data/*` (CRUD per le collezioni)
5. **Funzioni personalizzate** ← `/api/functions/*`
6. **Cron job** — `/api/cron/*`
7. **WebSocket** — Sottoscrizioni realtime

Ciò significa che le tue funzioni personalizzate hanno accesso a tutti i servizi inizializzati. Registra qualsiasi route che deve essere eseguita **prima** di Rebase direttamente sull'app Hono, prima di chiamare `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// Questo viene eseguito PRIMA delle route di Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Inizializzazione di Rebase — registra tutte le route /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

## Esempio: Gestore Webhook

```typescript
// backend/functions/stripe-webhook.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import Stripe from "stripe";
import { instance } from "../src/index";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const sig = c.req.header("stripe-signature")!;
    const body = await c.req.text();

    const event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await instance.driver.data.subscriptions.create({
            userId: session.client_reference_id,
            stripe_id: session.subscription,
            status: "active",
        });
    }

    return c.json({ received: true });
});

export default app;
```

## Debugging

Quando una funzione viene caricata con successo, vedrai:

```
⚡ Loaded function route: hello
```

Se il caricamento fallisce, il loader fornisce un output diagnostico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  tipo di esportazione: object (SomeClass)
  metodi prototipo: constructor, someMethod
  Suggerimento: assicurati che la funzione esporti un'app Hono creata con la stessa versione di Hono del server.
```

## Prossimi Passi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Callback delle Entità](/docs/collections/callbacks)** — Esegui la logica sulle modifiche ai dati
- **[Cron Job](/docs/backend/cron-jobs)** — Task in background programmati
---
