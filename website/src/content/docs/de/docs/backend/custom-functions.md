---
sourceHash: 49840b693028a89f
title: Custom Functions
sidebar_label: Custom Functions
description: Fügen Sie benutzerdefinierte Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit Custom Functions können Sie **beliebige Hono-API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Collections und Cron-Jobs: Legen Sie einfach eine TypeScript-Datei in Ihrem `functions/`-Verzeichnis ab, und Rebase bindet sie automatisch ein.

Nutzen Sie Custom Functions für:

- **Endpunkte für Geschäftslogik** – Genehmigungen, Rabattaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregierte Abfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer Custom Function

Erstellen Sie eine Datei in Ihrem Verzeichnis `backend/functions/`, die eine Hono-App als Standard-Export bereitstellt:

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

Dies wird unter **`/api/functions/hello`** eingebunden. Der Dateiname (ohne Erweiterung) wird zum Routen-Präfix.

`POST`, da das SDK dies standardmäßig sendet – siehe
[Invoke from the client](#aufruf-über-den-client). Eine `GET`-Route ist ebenso
gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis. Eine Datei, die hinzugefügt wird, während der Befehl ausgeführt wird, wird daher beim nächsten Reload eingebunden – kein Neustart erforderlich. (Dies muss explizit mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, weshalb der Watcher dies nicht ableiten kann.)

## Aufruf über den Client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` baut die URL auf, hängt das Token des Aufrufers an und wirft bei einem Statuscode außerhalb von 2xx einen `RebaseApiError` – sodass das Fehlerformat der Funktion selbst beim Aufrufer ankommt, anstelle einer einfachen `fetch`-Rejection.

Vier Dinge, die es neben dem Namen akzeptiert:

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
`client.call("functions/hello", payload)` erreicht eine Funktion ebenfalls. Es führt immer einen `POST`-Request aus und gibt wie `invoke` den Body unverändert zurück – keines von beiden greift auf einen `data`-Schlüssel zu. Bevorzugen Sie `functions.invoke`, welches eine Methode, einen Subpfad und einen `responseType` entgegennimmt; `call` existiert für Routen, die außerhalb von `/api/functions` eingebunden sind, was `invoke` nicht abbilden kann.
:::

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Autorenoberfläche: Er lädt nichts, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeitumgebung ausgeführt werden kann. Das Paket-Root greift auf das gesamte Framework zu – die Boot-Sequenz, die Datei-Loader, den WebSocket-Layer –, was für einen Server-Einstiegspunkt passend ist, aber mehr darstellt, als ein Route-Handler benötigt. Zudem bietet er Ihnen typisierte Kontext-Zugriffsfunktionen (`getUser`, `getDriver`), anstatt `c.get("user")` manuell casten zu müssen.

Siehe [Runtime portability](#runtime-portability) für den vollständigen Vertrag.
:::

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime:** Nichts zu konfigurieren – die Runtime erkennt `backend/functions/` selbstständig (`entry.functions` in `rebase.json`, falls Sie es verschoben haben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein Prozess bereitstellt.
**Ejected:** `initializeRebaseBackend({ functionsDir })` oder `functions` (unten) in `backend/src/index.ts`.
:::

Aktivieren Sie Custom Functions, indem Sie `functionsDir` zu Ihrer Backend-Konfiguration hinzufügen:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase wird:

1. Das Verzeichnis nach `.ts`- / `.js`-Dateien durchsuchen
2. Überprüfen, ob jeder Standard-Export eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentication](#authentifizierung-und-kontextweitergabe) unten)

### Funktionen als Werte

In Version 0.24 stammen Funktionen ausschließlich aus einem Verzeichnis.

Ein Verzeichnis ist eine Möglichkeit, das zu erzeugen, was der Server bereitstellt: ein Record von URL-Segmenten zu Hono-Apps. Übergeben Sie diesen Record selbst als `functions` oder lesen Sie ein Verzeichnis mit `loadFunctions` darin ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Geben Sie entweder `functions` oder `functionsDir` an, nicht beides: Der Boot-Vorgang verweigert die Kombination. `loadFunctions(dir, { onSkip })` übergibt Ihnen jede übersprungene Datei samt Begründung. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet (deprecated) und geben eine einmalige Warnung aus. Für sich allein genommen wird die Funktionsgruppe unter jedem beliebigen Pfad mit `app.route("/hooks", backend.routes.functions())` eingebunden, und `getUser(c)` sowie `getDriver(c)` funktionieren darin; siehe [Custom Server Integration](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Zuordnung

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **ausschließlich auf der obersten Ebene des Verzeichnisses** erkannt – es gibt keine Rekursion. `functions/admin/users.ts` wird von `rebase build` kompiliert, aber niemals eingebunden; flachen Sie den Namen stattdessen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Booten gemeldet und im Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` – reserviert
- `*.test.ts` / `*.test.js` – Testdateien
- `*.d.ts` – Typdeklarationen
- Unterverzeichnisse und `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien – werden als Probleme gemeldet, da der Build mehr kompiliert, als die Runtime lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, das Ziel des Scopes `functions:invoke:<name>`, den ein Schlüssel für den Aufruf benötigt, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` filtert, wenn Sie einer Funktion ihren eigenen Prozess zuweisen.

## Export-Formate

Der Loader akzeptiert neben `defineFunction` zwei Export-Formate:

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

`defineFunction` gibt genau die Hono-App zurück, die diese manuell aufbauen, sodass alle drei austauschbar sind. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und stellt Ihnen das `rebase`-Singleton im Callback bereit.

---

## Unter der Haube: Der Duck-Typing-Loader

In einem Monorepo lösen Ihre Funktionen möglicherweise eine andere Hono-Kopie auf als die, die Rebase verwendet. In diesem Fall ist `exported instanceof Hono` selbst für einen funktionierenden Router `false`. Daher prüft der Loader stattdessen die Struktur (`isHonoLike`): ein Non-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Modul-Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine File-URL um (`pathToFileURL(filePath).href`), sodass der Import unter Windows und POSIX gleichermaßen funktioniert, und ruft `import(url)` über `new Function("url", "return import(url)")` auf, damit ein TypeScript-Build ihn nicht in ein `require()` umschreiben kann, das unter ESM fehlschlägt.

---

## Authentifizierung und Kontextweitergabe

Custom Functions werden mit der **gleichen Auth-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und in den Kontext injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgelehnt**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die eine Authentifizierung erfordern, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht Ihren Handler nie: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend auf eine anonyme herabgestuft wird.

### Aufrufer auslesen

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

`getUser` gibt ein eingegrenztes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig davon, welche Authentifizierungsmethode der Aufrufer verwendet hat. `getUserId(c)` und `getRoles(c)` sind Shortcuts. `getScopes(c)` enthält alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die anwendungseigenen Scopes und die Scopes ihrer Rollen; für einen API-Schlüssel exakt das, was der Schlüssel beinhaltet.

### Routen schützen

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

Platzieren Sie Guards wie oben gezeigt im **eigenen Middleware-Slot der Route** und nicht über `app.use("/*", requireAuth)`. `use()` deckt nur die Routen ab, die *darunter* deklariert sind, sodass eine später hinzugefügte Route – etwa in einigen Monaten am Ende der Datei – stillschweigend ungeschützt bliebe.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined`, und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` lässt ausschließlich die Rolle `admin` zu. Für eine Aktion, die einer enger gefassten Rolle oder einem API-Schlüssel zugänglich sein soll, schützen Sie die Route mit `requireScope`. Dies akzeptiert einen integrierten [Scope](/docs/backend/roles-and-scopes/) oder einen, den die Anwendung unter `auth.scopes` in der users-Collection deklariert, wie beispielsweise `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Jede angemeldete Person besitzt jeden App-Scope; für eine Person entscheidet `requireScope` also nichts: Prüfen Sie im Handler, ob diese Person dieses Projekt deployen darf. Was der Scope ermöglicht, ist die **Einschränkung eines Schlüssels**: Ein Schlüssel mit `project:deploy:p1` ist nur für `p1` gültig. Ein Schlüssel benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App-Scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Authentifizierung per Service-Key

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in Ihrer `.env` für Skripte oder Server-zu-Server-Aufrufe definiert wird.

Wenn eine externe Anfrage den Service-Key über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, führt die Auth-Middleware automatisch folgende Schritte aus:
1. Sie validiert den Schlüssel mittels Constant-Time-Vergleich, um Timing-Angriffe zu verhindern.
2. Sie gewährt Zugriff auf Administrator-Ebene und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Sie injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security greift weiterhin – sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet und nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Schlüssel pro Boot-Vorgang**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch bei Aufrufen der servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`). Dadurch kann Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Key stets administrative Aufgaben ausführen.

## Zugriff auf Datenbank und Dienste

### 1. Der benutzerbezogene Driver – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Driver **mit dem Scope des Aufrufers** zurück, sodass jeder Lese- und Schreibvorgang anhand Ihrer Row-Level-Security-Richtlinien als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` – es wirft eine Fehlermeldung mit Angabe des Wiring-Problems, anstatt zwanzig Zeilen später an einem `undefined` zu scheitern.

### 2. `rebase.dataAsAdmin` – für vertrauenswürdige Hintergrundarbeiten

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

`rebase.dataAsAdmin` ist untypisiert, bis Sie Ihre [generierte `Database` registrieren](/docs/backend/typed-server-data).

### RLS-Scoped Driver vs. Rebase-Singleton

|                     | `getDriver(c)` (Request-bezogen)               | `rebase.dataAsAdmin` (Service-Identität)                         |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Wird ausgeführt als** | Der Aufrufer (`uid`, dessen Rollen)           | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung** | ✅ Ja (ausgewertet gegen den Aufrufer)         | ✅ Ja (ausgewertet gegen die Service-Identität)                   |
| **Ideal für...**    | Allgemeine Benutzer-CRUD, Suche und Abfragen   | Hintergrund-Jobs, System-Trigger, Webhooks                        |
| **API-Stil**        | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluente Collection-Zugriffsmethoden (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **Admin-bezogen (admin-scoped), umgeht jedoch nicht RLS**. Der Driver wird einmalig beim Booten mit `withAuth({ uid: "service", roles: ["admin"] })` konfiguriert, sodass jeder Lese- und Schreibvorgang innerhalb einer Transaktion ausgeführt wird, die mit `app.uid = 'service'` zur eingeschränkten Rolle `rebase_user` gewechselt hat. Ihre Richtlinien werden ausgewertet – und zwar gegen diese Identität.

Für die meisten Projekte wird dieser Unterschied nie sichtbar, da die Standardrichtlinien, die Rebase in jede Collection einfügt, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er wird jedoch in dem Moment relevant, in dem Sie eigene Richtlinien schreiben:

- **`policy.serverContext()` ist dafür `false`.** Dieser Helper kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors ist `'service'`. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, verweigert einen Schreibvorgang über `dataAsAdmin` mit dem Postgres-Fehler `42501`, und ein Lesevorgang auf einer solchen Collection gibt **null Zeilen mit HTTP 200** zurück – die stille Variante. Schreiben Sie `rolesOverlap(["admin"])` (oder ergänzen Sie es daneben), wenn Sie "mein Backend" meinen.
- **Die Reichweite entspricht der eines `admin`-Benutzers.** Das Zuweisen der `admin`-Rolle an einen Anwendungsbenutzer gewährt diesem Zugriff auf genau dieselben Zeilen, die dieser Accessor sieht. Es handelt sich nicht um einen privaten Kanal.

### 3. `rebase.sql()` – Raw SQL und der einzige reine Node-Accessor

Wenn Sie wirklich eine bedingungslose Umgehung benötigen, ist `rebase.sql()` die Lösung: Raw SQL über die Owner-Verbindung, keine Richtlinien, Zugriff auf jede Zeile. Es ist das am stärksten privilegierte Element im Kontext einer Funktion – mehr noch als der Accessor mit "admin" im Namen.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Bei heutigen Deployments stellt das kein Problem dar – es ist lediglich der eine Punkt, den man wissen muss, falls eine Funktion später migriert werden soll. Siehe [Runtime portability](#runtime-portability).

:::caution[Direkter Drizzle-Zugriff ist nur unter Node möglich]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder verwalteten Node-Deployment völlig in Ordnung.

Es lohnt sich jedoch zu wissen, was dies mit sich bringt: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, bleibt dauerhaft eine reine Node-Funktion; sie umgeht Ihre Collection-Callbacks, die von `rebase.data` ausgeführt werden (keines von beiden prüft `validation`, was für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und sie bezieht ihre Verbindung von außerhalb der Anfrage. `rebase.sql()` bietet Ihnen dasselbe Raw SQL über die frameworkeigene Verbindung. Ziehen Sie dies vor.
:::

## Konfiguration und Secrets

Lesen Sie Konfigurationen **innerhalb** des Handlers aus, niemals auf Modulebene:

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

Warum dies auf **jeder** Laufzeitumgebung wichtig ist, einschließlich Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Ein Lesevorgang auf Modulebene wird ausgewertet, wenn die Datei importiert wird – noch bevor eine Anfrage existiert. Unter Node bedeutet das: Eine einzige fehlende Variable bringt die gesamte Datei und jede darin enthaltene Route zum Absturz. Auf einem Host, der Konfigurationen an die Anfrage statt an den Prozess bindet, gibt es zum Importzeitpunkt überhaupt nichts auszulesen.

- `getEnv(c)` – jede für diese Anfrage sichtbare Variable
- `env(c, "NAME")` – eine Variable, getrimmt; leer gilt als nicht gesetzt
- `requireEnv(c, "NAME")` – dasselbe, wirft jedoch eine Fehlermeldung mit Angabe des Variablennamens
- `lazyResource(factory)` – erstellt einen aufwendigen Client einmalig bei der ersten Verwendung

`rebase doctor` meldet `process.env`-Aufrufe auf Modulebene in Ihrem functions-Verzeichnis.

## Hintergrundarbeiten

Aufgaben, die über die Antwort hinaus fortgeführt werden sollen, gehören in `waitUntil`:

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

Ein Promise ohne `await` sieht gleichwertig aus, ist es aber nicht. `waitUntil` bietet zwei entscheidende Vorteile:

- **Unter Node** wird das Promise nachverfolgt, sodass ein Graceful Shutdown darauf wartet, anstatt dass der Prozess während eines halb versendeten Webhooks beendet wird. Ein ungebundenes (floating) Promise geht bei `SIGTERM` einfach verloren.
- **Auf einem Isolate-basierten Host** wird der Host angewiesen, das Isolate am Leben zu erhalten, bis das Promise abgeschlossen ist. Ohne dies wird die Arbeit in dem Moment verworfen, in dem die Antwort aufgelöst wird – stillschweigend, mit einem sauberen 200-Status in den Logs.

Ein Fehler (Rejection) wird protokolliert, anstatt dem Unhandled-Rejection-Handler überlassen zu werden, sodass bei einem Fehlschlag die verursachende Route genannt wird.

## Runtime portability

Eine Custom Function ist eine Hono-App, und Hono läuft auf jeder JavaScript-Server-Laufzeitumgebung. Ob *Ihre* Funktion woanders als in einem Node-Prozess laufen kann, hängt daher davon ab, was ihre eigene Datei importiert und verwendet.

Nichts davon schränkt ein, was Sie heute schreiben können. Jedes Rebase-Deployment ist ein Node-Prozess, eine Funktion, die eine Datei liest oder einen Socket öffnet, ist eine völlig valide Funktion, und kein Build oder Deployment schlägt deswegen fehl. Dies ist dokumentiert, damit die Antwort jetzt bereits bekannt ist, anstatt später Datei für Datei herausgefunden werden zu müssen.

**Portabel – funktioniert auf jeder Laufzeitumgebung:**

- Alles, was aus `@rebasepro/server/functions` exportiert wird
- `getDriver(c)` und `rebase.dataAsAdmin` – beide nutzen denselben Übertragungsweg, unabhängig davon, wo sie laufen
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` – die Web-Plattform
- Jede Abhängigkeit, die kein Node erfordert

**Nur für Node (Node-only):**

- `rebase.sql()` – die Datenbank-Owner-Verbindung ist ein TCP-Socket
- Ein direkt importierter Drizzle-/`pg`-/`mongodb`-Client aus demselben Grund
- Node-Built-ins: `fs`, `path`, `crypto` (das Node-Modul – `globalThis.crypto` ist portabel), `child_process`, …
- Pakete, die darauf aufbauen: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latente Bugs auf jeder Laufzeitumgebung** – diese sollten in jedem Fall behoben werden:

- Auslesen von `process.env` auf Modulebene (siehe [Configuration and Secrets](#konfiguration-und-secrets))
- Fire-and-Forget-Promises anstelle von [`waitUntil`](#hintergrundarbeiten)
- Sich darauf verlassen, dass ein Handler nach dem Timeout seiner Anfrage weiterläuft. Unter Node tut er das zwar; das ist jedoch eine Eigenschaft des Prozesses und keine Garantie des Frameworks

### Eigene Funktionen überprüfen

`rebase build` gibt pro relevantem Befund eine Zeile aus und erfasst das Ergebnis pro Funktion im Bundle-Manifest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` meldet dasselbe, ohne einen Build durchzuführen.

### Falls Sie einen laufzeitspezifischen Pfad benötigen

`runtimeKey()` gibt `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` oder `"other"` zurück; `isNodeRuntime()` ist die gängige Prüfung. Nutzen Sie diese für Graceful Degradation, nicht um eine Implementierung aufzuspalten – eine Funktion, die zwei Implementierungen benötigt, sind zwei Funktionen.

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

Custom Functions werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` das Core-Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** – Datenbankverbindungen, Auth-Tabellen, Realtime-Dienste
2. **Auth-Routen** – `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** – `/api/storage/*`
4. **Daten-Routen** – `/api/data/*` (CRUD für Collections)
5. **Custom Functions** ← `/api/functions/*`
6. **Cron-Jobs** – `/api/admin/cron/*`
7. **WebSocket** – Realtime-Abonnements

Das bedeutet, dass Ihre Custom Functions Zugriff auf alle initialisierten Dienste haben. Registrieren Sie alle Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App, bevor Sie `initializeRebaseBackend()` aufrufen:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie Ihrer eigenen App auf diese Weise hinzufügen, liegen **außerhalb** jedes Rebase-Routers, sodass für sie keine Auth-Middleware ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Schützen Sie diese mit `requireAuth` / `requireAdmin`, importiert aus **`@rebasepro/server`** – dem Paket-Root –, welche das Token selbst verifizieren. Die Guards auf dem `/functions`-Subpfad lesen eine Identität aus, die bereits von einem Rebase-Router aufgelöst wurde, und antworten mit 500, anstatt vorzugeben, dass eine existiert.
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

## Debugging

Wenn eine Funktion erfolgreich geladen wurde, sehen Sie:

```
⚡ Loaded function route: hello
```

Falls das Laden fehlschlägt, liefert der Loader Diagnoseausgaben:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Der Router wird für das **Verzeichnis** eingebunden, nicht für die darin enthaltenen Funktionen. Selbst wenn der Import jeder Datei fehlschlägt – eine einzige fehlende Umgebungsvariable auf Modulebene reicht aus, um alle lahmzulegen –, antwortet `GET /api/functions` weiterhin mit `200` und einer leeren Liste sowie einem `skipped`-Zähler. So lässt sich "nichts geladen" von "dieser Build enthält keine Funktionen" unterscheiden. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Schlüssel mit dem einfachen `functions:invoke`-Scope oder den Service-Key – die Funktionen bleiben für jeden aufrufbar, den die jeweilige Funktion zulässt, aber die Übersicht über sie ist nicht öffentlich. Die Ursachen verbleiben im Boot-Log.

## Timeouts und Rate-Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** – standardmäßig 30 Sekunden, antwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert ihn. Der Handler kann nicht von außen gestoppt werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504 abgebrochen. Übergeben Sie dieses Signal daher an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Arbeit, der das Signal nicht übergeben wurde, läuft weiter – der Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses, keine vertragliche Zusicherung des Frameworks; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeiten).
- **Rate-Limit** – API-Schlüssel und angemeldete Aufrufer teilen sich die Kontingente (Buckets) der Daten-API. Anonyme Aufrufer erhalten ein eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Überschreiben Sie dies mit `rateLimit.anonymousFunctions`; `null` schaltet es ab.

Nicht abgefangene Promise-Rejections werden protokolliert, anstatt fatal zu sein: Ein Fire-and-Forget-Aufruf in einer Funktion würde andernfalls den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`, um das Standardverhalten von Node wiederherzustellen.

In Rebase Cloud hat das Edge-Netzwerk vor Ihren Funktionen eigene Limits, und
Zustände auf Modulebene, das Dateisystem sowie ausgehende Ports verhalten sich auf eine Weise,
die man kennen sollte, bevor man seine Architektur darauf ausrichtet. Siehe
[Managed backend runtime](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend Overview](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration
- **[Entity Callbacks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Cron Jobs](/docs/backend/cron-jobs)** – Geplante Hintergrundaufgaben
