---
title: Benutzerdefinierte Funktionen
sidebar_label: Benutzerdefinierte Funktionen
description: Fügen Sie benutzerdefinierte Hono API-Endpunkte neben Ihren Rebase CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Benutzerdefinierte Funktionen erlauben Ihnen, **beliebige Hono API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzuzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Collections und Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihr `functions/`-Verzeichnis, und Rebase bindet sie automatisch ein.

Verwenden Sie benutzerdefinierte Funktionen für:

- **Endpunkte mit Geschäftslogik** — Freigaben, Beförderungen, eigene Workflows
- **Integrationen von Drittanbietern** — Stripe-Webhooks, Slack-Befehle, Proxys für externe APIs
- **Öffentliche Endpunkte** — Kontaktformulare, Lead-Erfassung, Health Checks
- **Aggregierte Abfragen** — Dashboard-Statistiken, Berichte, Analysen

## Eine benutzerdefinierte Funktion definieren

Erstellen Sie eine Datei in Ihrem `backend/functions/`-Verzeichnis, die eine Hono-App als Default exportiert:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", (c) => c.json({ message: "Hello from custom function!" }));
});
```

Diese wird unter **`/api/functions/hello`** eingebunden. Der Dateiname (ohne Erweiterung) wird zum Routen-Präfix.

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Unterpfad ist die *portable* Autorenoberfläche: Er zieht nichts herein, das Node voraussetzt, sodass eine dagegen geschriebene Funktion in jeder JavaScript-Laufzeitumgebung läuft. Die Paketwurzel erreicht das gesamte Framework — die Startsequenz, die Datei-Loader, die WebSocket-Schicht — was für einen Server-Einstiegspunkt richtig ist und mehr, als ein Routen-Handler braucht. Sie erhalten damit außerdem typisierte Kontext-Accessoren (`getUser`, `getDriver`), statt `c.get("user")` von Hand zu casten.

Siehe [Portabilität zwischen Laufzeitumgebungen](#portabilität-zwischen-laufzeitumgebungen) für den vollständigen Vertrag.
:::

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
2. Prüfen, dass jeder Default-Export eine Hono-App ist (per Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontextweitergabe) unten)

## Dateinamen und Routen-Zuordnung

| Datei | Einbindungspfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **nur auf der obersten Ebene des Verzeichnisses** erkannt — es gibt keine Rekursion. `functions/admin/users.ts` wird von `rebase build` kompiliert, aber nie eingebunden; flachen Sie stattdessen den Namen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Start gemeldet und im Auflistungs-Endpunkt gezählt, statt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` — reserviert
- `*.test.ts` / `*.test.js` — Testdateien
- `*.d.ts` — Typdeklarationen
- Unterverzeichnisse sowie `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs`-Dateien — werden als Probleme gemeldet, da der Build mehr kompiliert, als die Laufzeit lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, die `functions/<name>`-Berechtigung eines API-Schlüssels und der Wert, den `REBASE_FUNCTIONS_ONLY` auswählt, wenn Sie einer Funktion einen eigenen Prozess geben.

## Export-Formate

Neben `defineFunction` akzeptiert der Loader zwei Export-Formate:

### Hono-App

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Factory-Funktion

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` gibt genau die Hono-App zurück, die diese von Hand bauen — alle drei sind also austauschbar. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und reicht Ihnen das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

Beim Kompilieren von Codebasen mit mehreren verschachtelten Verzeichnissen oder in Monorepos kann es zu **Duplikaten des Hono-Pakets** kommen.

Wenn das Rebase-Framework von einer Hono-Version abhängt und Ihr lokales Funktionsverzeichnis eine andere auflöst, schlagen klassische Vererbungsprüfungen (`exported instanceof Hono`) fehl, weil ihre Prototypen in getrennten Speicherbereichen liegen.

Um falsche Negative und das Ablehnen funktionierender Router zu vermeiden, nutzt Rebase einen Duck-Typing-Validator (`isHonoLike`):
- Er prüft, dass das exportierte Objekt ein `object` ungleich null ist.
- Er prüft, dass das Objekt eine `.fetch`-Methode bereitstellt (nötig zum Routen von Anfragen).
- Er prüft, dass `.routes` ein `array` ist.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### ES-Modul-Compiler-Ausweg

Um TypeScript- und JavaScript-Dateien sowohl unter Windows als auch unter Posix dynamisch zu importieren, wandelt der Loader Dateipfade über `pathToFileURL(filePath).href` in Standard-Datei-URIs um.

Damit die TypeScript-Kompilierung native ESM-Dynamic-Imports (`import(url)`) nicht in CommonJS-`require()`-Aufrufe umschreibt (was unter ESM-Laufzeiten Fehler werfen würde), führt Rebase einen Compiler-Ausweg zur Laufzeit aus:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Authentifizierung und Kontextweitergabe

Benutzerdefinierte Funktionen werden mit **derselben Auth-Middleware** wie die Datenrouten eingebunden, aber mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und in den Kontext injiziert**, sofern vorhanden
- Anfragen werden aber **nicht abgelehnt**, wenn kein JWT übergeben wird
- Sie müssen Routen, die Authentifizierung brauchen, **ausdrücklich schützen**

Wer ein *ungültiges* Token vorlegt, erreicht Ihren Handler nie: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, damit eine abgelaufene Sitzung niemals stillschweigend zu einer anonymen herabgestuft wird.

### Den Aufrufer lesen

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

`getUser` liefert ein eingegrenztes Objekt: `uid` ist ein String und `roles` immer ein Array, egal welche Auth-Methode der Aufrufer verwendet hat. `getUserId(c)` und `getRoles(c)` sind Abkürzungen.

### Routen schützen

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

Setzen Sie Guards in den **Middleware-Slot der Route selbst**, wie oben, statt `app.use("/*", requireAuth)` zu verwenden. `use()` deckt nur die *darunter* deklarierten Routen ab — eine später ergänzte Route, unten in der Datei, in einigen Monaten, bleibt also stillschweigend ungeschützt.

:::important
`getUser(c)` zu lesen ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined`, und Ihr Handler läuft trotzdem. Nur ein Guard oder ein ausdrückliches `if (!user) return 401` stoppt die Anfrage.
:::

### Authentifizierung per Service Key

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY` in Ihrer `.env` für Skripte oder Server-zu-Server-Aufrufe.

Wenn eine externe Anfrage den Service Key über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, tut die Auth-Middleware automatisch Folgendes:
1. Sie validiert den Schlüssel mit einem Vergleich in konstanter Zeit, um Timing-Angriffe zu verhindern.
2. Sie gewährt Admin-Zugriff und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Sie injiziert einen `DataDriver`, der auf dieselbe Service-Identität eingegrenzt ist. Row-Level Security gilt weiterhin — sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet, nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, erzeugt Rebase einen zufälligen **internen Schlüssel pro Start**. Das `rebase`-Singleton verwendet ihn automatisch, wenn es die Control-Plane-APIs des Servers selbst aufruft (etwa `rebase.auth` oder `rebase.storage`). Ihre serverseitige Logik kann administrative Aufgaben also immer ausführen, auch ohne manuell konfigurierten Service Key.

## Zugriff auf Datenbank und Dienste

### 1. Der benutzerbezogene Driver — für alles, was eine Anfrage bedient

`getDriver(c)` liefert den auf den **Aufrufer eingegrenzten** Driver, sodass jeder Lese- und Schreibvorgang gegen Ihre Row-Level-Security-Policies als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` — es wirft eine Meldung, die das Einbindungsproblem benennt, statt zwanzig Zeilen später an `undefined` zu scheitern.

### 2. `rebase.dataAsAdmin` — für vertrauenswürdige Hintergrundarbeit

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

### RLS-eingegrenzter Driver vs. Rebase-Singleton

|                     | `getDriver(c)` (anfragebezogen)                | `rebase.dataAsAdmin` (Service-Identität)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Läuft als**       | Der Aufrufer (`uid`, seine Rollen)             | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung** | ✅ Ja (gegen den Aufrufer ausgewertet)        | ✅ Ja (gegen die Service-Identität ausgewertet)                   |
| **Ideal für...**    | Allgemeines Benutzer-CRUD, Suche und Abfragen   | Hintergrundjobs, System-Trigger, Webhooks                         |
| **API-Stil**        | Driver-Methoden (`fetchCollection`, `save`)     | Fluente Collection-Accessoren (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin eingegrenzt, es umgeht RLS nicht**. Der Driver wird einmalig beim Start mit `withAuth({ uid: "service", roles: ["admin"] })` eingegrenzt, sodass jeder Lese- und Schreibvorgang in einer Transaktion läuft, die auf die eingeschränkte Rolle `rebase_user` mit `app.uid = 'service'` gewechselt hat. Ihre Policies werden ausgewertet — gegen diese Identität.

Für die meisten Projekte tritt der Unterschied nie zutage, weil die Default-Policies, die Rebase in jede Collection injiziert, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er tritt zutage, sobald Sie eigene Policies schreiben:

- **`policy.serverContext()` ist dafür falsch.** Dieser Helfer kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors ist `'service'`. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, lehnt einen `dataAsAdmin`-Schreibvorgang mit dem Postgres-Fehler `42501` ab, und ein Lesevorgang gegen eine solche Collection liefert **null Zeilen mit HTTP 200** — die stille Richtung. Schreiben Sie `rolesOverlap(["admin"])` (oder ergänzen Sie es), wenn Sie "mein Backend" meinen.
- **Seine Reichweite entspricht der eines `admin`-Benutzers.** Wer einem Anwendungsbenutzer die Rolle `admin` gibt, gibt ihm genau die Zeilen, die dieser Accessor sieht. Es ist kein privater Kanal.

### 3. `rebase.sql()` — rohes SQL, und der einzige Node-exklusive Accessor

Wenn Sie wirklich eine bedingungslose Umgehung brauchen, ist `rebase.sql()` genau das: rohes SQL über die Owner-Verbindung, keine Policies, alle Zeilen. Es ist das Privilegierteste im Kontext einer Funktion — mehr als der Accessor mit "admin" im Namen.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Das kostet in keinem heute existierenden Deployment etwas — es ist schlicht das eine, was man wissen sollte, falls eine Funktion später umziehen soll. Siehe [Portabilität zwischen Laufzeitumgebungen](#portabilität-zwischen-laufzeitumgebungen).

:::caution[Direkter Drizzle-Zugriff ist Node-exklusiv]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert, und in einem selbst gehosteten oder verwalteten Node-Deployment ist es in Ordnung.

Man sollte den Preis kennen: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine Node-Funktion, sie umgeht die Callbacks und die Validierung Ihrer Collection, und sie bezieht ihre Verbindung von woanders als die Anfrage. `rebase.sql()` gibt Ihnen dasselbe rohe SQL über die Verbindung des Frameworks. Bevorzugen Sie das.
:::

## Konfiguration und Secrets

Lesen Sie Konfiguration **innerhalb** des Handlers, nie im Modul-Scope:

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

Warum das in **jeder** Laufzeitumgebung zählt, Node eingeschlossen:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Ein Lesevorgang im Modul-Scope wird ausgewertet, wenn die Datei importiert wird — bevor irgendeine Anfrage existiert. Unter Node heißt das: Eine einzige fehlende Variable reißt die ganze Datei und jede Route darin mit. Auf einem Host, der Konfiguration an die Anfrage statt an den Prozess hängt, gibt es zur Importzeit überhaupt nichts zu lesen.

- `getEnv(c)` — alle für diese Anfrage sichtbaren Variablen
- `env(c, "NAME")` — eine Variable, getrimmt; leer zählt als nicht gesetzt
- `requireEnv(c, "NAME")` — dasselbe, wirft aber eine Meldung, die die Variable benennt
- `lazyResource(factory)` — baut einen teuren Client einmalig beim ersten Gebrauch

`rebase doctor` meldet `process.env`-Zugriffe im Modul-Scope in Ihrem Funktionsverzeichnis.

## Hintergrundarbeit

Arbeit, die die Antwort überdauern soll, gehört in `waitUntil`:

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

Ein Promise ohne `await` sieht gleichwertig aus und ist es nicht. `waitUntil` bringt zwei Dinge:

- **Unter Node** wird das Promise erfasst, sodass ein geordnetes Herunterfahren darauf wartet, statt dass der Prozess unter einem halb versendeten Webhook wegbricht. Ein loses Promise ist bei `SIGTERM` schlicht verloren.
- **Auf einem isolate-basierten Host** wird dem Host mitgeteilt, das Isolate am Leben zu halten, bis das Promise erfüllt ist. Ohne das wird die Arbeit verworfen, sobald die Antwort steht — still, mit einer sauberen 200 im Log.

Ein Rejection wird protokolliert, statt dem Unhandled-Rejection-Handler überlassen zu werden, sodass der Fehler die Route benennt, aus der er kam.

## Portabilität zwischen Laufzeitumgebungen

Eine benutzerdefinierte Funktion ist eine Hono-App, und Hono läuft in jeder JavaScript-Server-Laufzeit. Ob *Ihre* Funktion woanders als in einem Node-Prozess laufen kann, hängt daher allein davon ab, was ihre eigene Datei importiert und anfasst.

Nichts davon schränkt ein, was Sie heute schreiben dürfen. Jedes Rebase-Deployment ist ein Node-Prozess, eine Funktion, die eine Datei liest oder einen Socket öffnet, ist eine völlig gute Funktion, und kein Build und kein Deployment schlägt deswegen fehl. Es steht hier, damit die Antwort jetzt bekannt ist, statt später Datei für Datei entdeckt zu werden.

**Portabel — funktioniert in jeder Laufzeit:**

- Alles, was `@rebasepro/server/functions` exportiert
- `getDriver(c)` und `rebase.dataAsAdmin` — beide gehen überall über dieselbe Leitung
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — die Web-Plattform
- Jede Abhängigkeit, die Node nicht braucht

**Node-exklusiv:**

- `rebase.sql()` — die Owner-Verbindung der Datenbank ist ein TCP-Socket
- Ein direkt importierter Drizzle-/`pg`-/`mongodb`-Client, aus demselben Grund
- Node-Builtins: `fs`, `path`, `crypto` (das Node-Modul — `globalThis.crypto` ist portabel), `child_process`, …
- Pakete, die darauf aufbauen: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latente Fehler in jeder Laufzeit** — diese lohnt es sich ohnehin zu beheben:

- `process.env` im Modul-Scope gelesen (siehe [Konfiguration und Secrets](#konfiguration-und-secrets))
- Lose Promises statt [`waitUntil`](#hintergrundarbeit)
- Sich darauf verlassen, dass ein Handler nach dem Timeout seiner Anfrage weiterläuft. Unter Node tut er das; das ist eine Eigenschaft des Prozesses, kein Versprechen des Frameworks

### Ihre eigenen Funktionen prüfen

`rebase build` gibt eine Zeile pro handlungsrelevantem Befund aus und hält das Urteil pro Funktion im Bundle-Manifest fest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` meldet dasselbe, ohne zu bauen.

### Wenn Sie einen laufzeitspezifischen Pfad brauchen

`runtimeKey()` liefert `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` oder `"other"`; `isNodeRuntime()` ist die übliche Prüfung. Nutzen Sie sie, um zu degradieren, nicht um eine Implementierung aufzuspalten — eine Funktion, die zwei Implementierungen braucht, sind zwei Funktionen.

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

## Reihenfolge der Routen-Registrierung

Benutzerdefinierte Funktionen werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` die Kern-Einrichtung abgeschlossen hat. Die Initialisierungsreihenfolge ist:

1. **Bootstrapper** — Datenbankverbindungen, Auth-Tabellen, Realtime-Dienste
2. **Auth-Routen** — `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** — `/api/storage/*`
4. **Datenrouten** — `/api/data/*` (CRUD für Collections)
5. **Benutzerdefinierte Funktionen** ← `/api/functions/*`
6. **Cron-Jobs** — `/api/cron/*`
7. **WebSocket** — Realtime-Abonnements

Ihre benutzerdefinierten Funktionen haben damit Zugriff auf alle initialisierten Dienste. Routen, die **vor** Rebase laufen müssen, registrieren Sie direkt an der Hono-App, bevor Sie `initializeRebaseBackend()` aufrufen:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie so an Ihre eigene App hängen, liegen **außerhalb** jedes Rebase-Routers: Es lief keine Auth-Middleware auf ihnen, und `getDriver(c)` ist nicht gesetzt. Schützen Sie diese mit `requireAuth` / `requireAdmin` aus **`@rebasepro/server`** — der Paketwurzel — die das Token selbst verifizieren. Die Guards des `/functions`-Unterpfads lesen eine Identität, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, statt eine vorzutäuschen.
:::

## Beispiel: Webhook-Handler

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

## Fehlersuche

Wenn eine Funktion erfolgreich geladen wird, sehen Sie:

```
⚡ Loaded function route: hello
```

Schlägt das Laden fehl, liefert der Loader eine Diagnose:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Der Router wird für das **Verzeichnis** eingebunden, nicht für die Funktionen darin. Wenn jede Datei beim Import scheitert — eine einzige fehlende Umgebungsvariable im Modul-Scope genügt, um alle zu Fall zu bringen — antwortet `GET /api/functions` weiterhin mit `200`, einer leeren Liste und einem `skipped`-Zähler, sodass "nichts geladen" von "dieser Build enthielt keine Funktionen" unterscheidbar bleibt. Die Gründe stehen im Start-Log.

## Timeouts und Rate Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Anfrage-Timeout** — standardmäßig 30 Sekunden, Antwort `504` mit dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` schaltet es ab. Der Handler kann von außen nicht abgebrochen werden — geben Sie ausgehenden HTTP-Aufrufen also ein `AbortSignal`: Das Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach der 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses und keine Zusage des Vertrags; alles, was abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeit).
- **Rate Limit** — Aufrufer mit API-Schlüssel und angemeldete Aufrufer teilen sich die Buckets der Daten-API. Anonyme Aufrufer bekommen ein eigenes, deutlich großzügigeres Kontingent (3000 pro Fenster), weil dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Überschreiben Sie es mit `rateLimit.anonymousFunctions`; `null` schaltet es ab.

Unbehandelte Promise-Rejections werden protokolliert statt fatal zu sein: Ein Fire-and-Forget-Aufruf in einer Funktion würde sonst den ganzen Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` für Nodes Standardverhalten.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz der Backend-Konfiguration
- **[Entity-Callbacks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
