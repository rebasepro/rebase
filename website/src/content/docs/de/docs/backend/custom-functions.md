---
title: Benutzerdefinierte Funktionen
sidebar_label: Benutzerdefinierte Funktionen
description: Fügen Sie benutzerdefinierte Hono API-Endpunkte neben Ihren Rebase CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Benutzerdefinierte Funktionen ermöglichen es Ihnen, **beliebige Hono API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzuzufügen. Sie folgen dem gleichen **dateibasierten Erkennungsmuster** wie Collections und Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihr `functions/`-Verzeichnis, und Rebase bindet sie automatisch ein.

Verwenden Sie benutzerdefinierte Funktionen für:

- **Endpunkte für Geschäftslogik** – Genehmigungen, Aktionen, benutzerdefinierte Workflows
- **Integrationen von Drittanbietern** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health Checks
- **Aggregierte Abfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer benutzerdefinierten Funktion

Erstellen Sie eine Datei in Ihrem `backend/functions/`-Verzeichnis, die standardmäßig eine Hono-App exportiert:

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

Dies wird unter **`/api/functions/hello`** eingebunden. Der Dateiname (ohne Erweiterung) wird zum Routenpräfix.

## Konfiguration

Aktivieren Sie benutzerdefinierte Funktionen, indem Sie `functionsDir` zu Ihrer Backend-Konfiguration hinzufügen:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase wird:

1. Das Verzeichnis nach `.ts` / `.js`-Dateien durchsuchen
2. Überprüfen, ob jeder Standard-Export eine Hono-App ist (duck-typed über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Authentifizierungs-Middleware anwenden (siehe [Authentifizierung](#authentication) unten)

## Dateibenennung und Routen-Mapping

| Datei | Einbindungspfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` — reserviert
- `*.test.ts` / `*.test.js` — Testdateien
- `*.d.ts` — Typdeklarationen

## Exportformate

Der Loader akzeptiert zwei Exportformate:

### Hono App (empfohlen)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Factory-Funktion

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

Beide werden über Duck-Typing erkannt – der Loader prüft auf die Eigenschaften `.fetch()` und `.routes`, sodass jede Hono-kompatible Instanz funktioniert, unabhängig von der installierten Hono-Version.

## Authentifizierung

Benutzerdefinierte Funktionen werden mit der **gleichen Authentifizierungs-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird, falls vorhanden, **geparst und in den Kontext injiziert**
- Anfragen werden aber **nicht abgelehnt**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die Authentifizierung benötigen, **explizit schützen**

### Routen schützen

Verwenden Sie die integrierten Auth-Helfer von Rebase:

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
Die JWT-Middleware von Rebase ist auf die integrierten API-Routen (`/api/data`, `/api/auth`, etc.) beschränkt. Benutzerdefinierte Funktionsrouten erhalten den **geparsten Benutzerkontext**, aber Sie müssen die Zugriffskontrolle selbst durchsetzen.
:::

## Auf die Datenbank zugreifen

Benutzerdefinierte Funktionen laufen neben Rebase, sodass Sie über zwei Ansätze auf die Datenbank zugreifen können:

### 1. Über das Rebase Singleton (Empfohlen)

Das Paket `@rebasepro/server` stellt ein `rebase`-Singleton bereit, das Ihnen von überall in Ihrem Backend Administratorzugriff auf alle app-spezifischen Dienste (Daten, Authentifizierung, Speicher, E-Mail) ermöglicht.

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

### 2. Über direkten Drizzle-Zugriff

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
Die von Rebase verwendete Drizzle `db`-Instanz ist dieselbe, die Sie an `createPostgresBootstrapper` übergeben. Sie können sie frei zwischen benutzerdefinierten Funktionen und Rebase teilen.
:::

## Reihenfolge der Routenregistrierung

Benutzerdefinierte Funktionen werden **nachdem** `initializeRebaseBackend()` die Kernkonfiguration abgeschlossen hat, geladen und eingebunden. Die Initialisierungsreihenfolge ist:

1. **Bootstrappers** – Datenbankverbindungen, Auth-Tabellen, Echtzeitdienste
2. **Auth-Routen** – `/api/auth/*`, `/api/admin/*`
3. **Speicherrouten** – `/api/storage/*`
4. **Datenrouten** – `/api/data/*` (CRUD für Collections)
5. **Benutzerdefinierte Funktionen** ← `/api/functions/*`
6. **Cron-Jobs** – `/api/cron/*`
7. **WebSocket** – Echtzeit-Abonnements

Das bedeutet, dass Ihre benutzerdefinierten Funktionen Zugriff auf alle initialisierten Dienste haben. Registrieren Sie alle Routen, die **vor** Rebase ausgeführt werden müssen, direkt in der Hono-App, bevor Sie `initializeRebaseBackend()` aufrufen:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

## Beispiel: Webhook-Handler

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

## Fehlerbehebung

Wenn eine Funktion erfolgreich geladen wird, sehen Sie:

```
⚡ Loaded function route: hello
```

Wenn das Laden fehlschlägt, liefert der Loader eine Diagnoseausgabe:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration
- **[Entitäts-Callbacks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** – Geplante Hintergrundaufgaben
---
