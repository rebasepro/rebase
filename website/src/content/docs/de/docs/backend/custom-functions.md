---
sourceHash: 22d7c8bbab763065
title: Eigene Funktionen (Custom Functions)
sidebar_label: Custom Functions
description: Fügen Sie eigene Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit Custom Functions können Sie **beliebige Hono-API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Collections und Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihrem Verzeichnis `functions/` ab, und Rebase bindet sie automatisch ein.

Verwenden Sie Custom Functions für:

- **Endpunkte für Geschäftslogik** — Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** — Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** — Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregierte Abfragen** — Dashboard-Statistiken, Berichte, Analysen

## Definieren einer Custom Function

Erstellen Sie eine Datei in Ihrem Verzeichnis `backend/functions/`, die standardmäßig (default export) eine Hono-App exportiert:

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

Dies wird unter **`/api/functions/hello`** eingebunden. Der Dateiname (ohne Dateiendung) wird zum Routen-Präfix.

`POST`, da das SDK dies standardmäßig sendet — siehe
[Vom Client aufrufen](#vom-client-aufrufen). Eine `GET`-Route ist genauso
gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis. Eine Datei, die hinzugefügt wird, während
der Server läuft, wird beim nächsten Reload eingebunden — kein Neustart erforderlich. (Sie muss
neu erkannt werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

## Vom Client aufrufen

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` baut die URL auf, hängt das Token des Aufrufers an und wirft bei
einem Nicht-2xx-Status einen `RebaseApiError` — sodass die eigene Fehlerstruktur der
Funktion den Aufrufer erreicht, anstelle einer einfachen `fetch`-Rejection.

Vier Dinge, die über den Namen hinaus akzeptiert werden:

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
`client.call("functions/hello", payload)` erreicht eine Funktion ebenfalls. Es sendet immer
ein `POST`, und wie `invoke` gibt es den Body unverändert zurück — keines von beiden greift
auf einen `data`-Schlüssel zu. Bevorzugen Sie `functions.invoke`, da es Methoden, Unterpfade
und einen `responseType` akzeptiert; `call` existiert für Routen außerhalb von `/api/functions`,
die `invoke` nicht abbilden kann.
:::

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Authoring-Schnittstelle: Er importiert nichts, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeitumgebung ausgeführt werden kann. Das Root-Paket bindet das gesamte Framework ein — die Boot-Sequenz, die Datei-Loader, die WebSocket-Schicht —, was für einen Server-Einstiegspunkt passend ist, aber mehr darstellt, als ein Route-Handler benötigt. Zudem bietet es typisierte Kontext-Zugriffsmethoden (`getUser`, `getDriver`), statt `c.get("user")` manuell casten zu müssen.

Den vollständigen Vertrag finden Sie unter [Portabilität der Laufzeitumgebung](#portabilität-der-laufzeitumgebung).
:::

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime:** Nichts zu konfigurieren — die Runtime erkennt `backend/functions/` automatisch (`functions` im `rebase.json`-Eintrag der Backend-App, falls verschoben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein Prozess mit `REBASE_ROLE=functions` bereitstellt; jede andere Rolle verweigert den Start, wenn sie gesetzt sind.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, oder `functions` (unten), in `backend/src/index.ts`.
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
2. Prüfen, ob jeder Standardexport eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontextweitergabe) unten)

### Funktionen als Werte

In Version 0.24 stammen Funktionen ausschließlich aus einem Verzeichnis.

Ein Verzeichnis ist ein Weg, um das zu erzeugen, was der Server ausliefert: ein Record von URL-Segment zu Hono-App. Übergeben Sie diesen Record selbst als `functions` oder lesen Sie ein Verzeichnis mit `loadFunctions` ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Geben Sie entweder `functions` oder `functionsDir` an, nicht beides: Der Boot-Vorgang verweigert die Kombination. `loadFunctions(dir, { onSkip })` übergibt jede übersprungene Datei inklusive Grund. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet und geben eine einmalige Warnung aus. Für sich allein lässt sich die Funktionsgruppe mit `app.route("/hooks", backend.routes.functions())` unter einem beliebigen Pfad mounten; `getUser(c)` und `getDriver(c)` funktionieren darin; siehe [Custom Server Integration](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Mapping

| Datei | Mount-Pfad |
|-------|------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **ausschließlich auf oberster Ebene des Verzeichnisses** erkannt — es gibt keine Rekursion. `functions/admin/users.ts` wird zwar von `rebase build` kompiliert, aber niemals gemountet; flachen Sie den Namen stattdessen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Booten gemeldet und im Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` — reserviert
- `*.test.ts` / `*.test.js` — Testdateien
- `*.d.ts` — Typdeklarationen
- Unterverzeichnisse sowie `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien — werden als Probleme gemeldet, da der Build mehr kompiliert, als die Runtime lädt

Der Name ist auch an allen anderen Stellen die Identität der Funktion: Er ist das URL-Segment, das Ziel des Scopes `functions:invoke:<name>`, den ein Schlüssel für den Aufruf benötigt, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` filtert, wenn Sie einer Funktion einen eigenen Prozess zuweisen.

## Export-Formate

Der Loader akzeptiert neben `defineFunction` zwei weitere Export-Formate:

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

`defineFunction` gibt genau die Hono-App zurück, die diese Varianten manuell erzeugen, sodass alle drei austauschbar sind. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und übergibt Ihnen das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

In einem Monorepo lösen Ihre Funktionen möglicherweise eine andere Hono-Kopie auf als die von Rebase verwendete, wodurch `exported instanceof Hono` selbst bei einem funktionierenden Router `false` ergibt. Daher prüft der Loader stattdessen die Struktur (`isHonoLike`): ein Nicht-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Modul-Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine Datei-URL um (`pathToFileURL(filePath).href`), sodass der Import unter Windows und POSIX gleichermaßen funktioniert, und ruft `import(url)` über `new Function("url", "return import(url)")` auf. So kann ein TypeScript-Build den Aufruf nicht in ein `require()` umschreiben, das unter ESM fehlschlagen würde.

---

## Authentifizierung und Kontextweitergabe

Custom Functions werden mit **derselben Auth-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Nutzers wird **geparst und in den Kontext injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgewiesen**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die Authentifizierung erfordern, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token übergibt, erreicht Ihren Handler nie: Ein nicht überprüfbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend zu einer anonymen herabgestuft wird.

### Auslesen des Aufrufers

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

`getUser` liefert ein typisiertes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig von der Authentifizierungsmethode des Aufrufers. `getUserId(c)` und `getRoles(c)` sind Shortcuts. `getScopes(c)` liefert alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die Scopes der App und die Scopes ihrer Rollen; für einen API-Schlüssel exakt das, was der Schlüssel enthält.

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

Platzieren Sie Guards wie oben gezeigt im **eigenen Middleware-Slot der Route** anstatt über `app.use("/*", requireAuth)`. `use()` deckt nur die Routen ab, die *darunter* deklariert sind. Eine später hinzugefügte Route — ganz unten in der Datei, Monate später — wäre sonst unbeabsichtigt ungeschützt.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined` und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` lässt ausschließlich die Rolle `admin` zu. Für Aktionen, die eine spezifischere Rolle oder ein API-Schlüssel ausführen darf, sichern Sie die Route mit `requireScope`. Dies akzeptiert einen integrierten [Scope](/docs/backend/roles-and-scopes/) oder einen, den die App unter `auth.scopes` in der users-Collection definiert hat, wie etwa `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Jede angemeldete Person besitzt jeden App-Scope; für eine Person entscheidet `requireScope` daher nichts: Prüfen Sie im Handler, ob diese Person dieses konkrete Projekt bereitstellen darf. Der Scope dient dazu, **einen Schlüssel einzuschränken**: Ein Schlüssel mit `project:deploy:p1` ist nur für `p1` gültig. Ein Schlüssel benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App-Scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Authentifizierung über Service-Keys

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in Ihrer `.env` für Skripte oder Server-to-Server-Aufrufe definiert wird.

Wenn eine externe Anfrage den Service-Key über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, führt die Auth-Middleware automatisch folgende Schritte aus:
1. Validiert den Schlüssel über einen Constant-Time-Vergleich, um Timing-Angriffe zu verhindern.
2. Gewährt Administratorzugriff und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security gilt weiterhin — sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet, nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Schlüssel pro Boot-Vorgang**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch bei Aufrufen der servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`). So kann Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Key administrative Aufgaben ausführen.

## Zugriff auf Datenbank & Services

### 1. Der benutzerbezogene Driver — für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Driver zurück, der **auf den Aufrufer beschränkt** ist. Jeder Lese- und Schreibzugriff wird anhand Ihrer Row-Level-Security-Richtlinien als dieser Nutzer ausgewertet:

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

`requireDriver(c)` entspricht `getDriver(c)` ohne das `!` — es wirft einen Fehler mit dem genauen Verdrahtungsproblem, anstatt zwanzig Zeilen später mit `undefined` abzubrechen.

### 2. `rebase.dataAsAdmin` — für vertrauenswürdige Hintergrundaufgaben

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

### RLS-bezogener Driver vs. Rebase-Singleton

|                     | `getDriver(c)` (anfragebezogen)                | `rebase.dataAsAdmin` (Service-Identität)                         |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Läuft als**       | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung**| ✅ Ja (wird gegen den Aufrufer geprüft)        | ✅ Ja (wird gegen die Service-Identität geprüft)                  |
| **Ideal für...**    | Reguläre Nutzer-CRUD, Suche und Abfragen       | Hintergrundjobs, System-Trigger, Webhooks                        |
| **API-Stil**        | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluent Collection-Accessors (`rebase.dataAsAdmin.jobs.find`)    |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin-Rechte beschränkt, umgeht RLS jedoch nicht**. Der Driver wird einmalig beim Booten mit `withAuth({ uid: "service", roles: ["admin"] })` initialisiert, sodass jeder Lese- und Schreibzugriff innerhalb einer Transaktion ausgeführt wird, die mit `app.uid = 'service'` in die eingeschränkte Rolle `rebase_user` gewechselt ist. Ihre Richtlinien werden ausgewertet — und zwar gegen diese Identität.

Bei den meisten Projekten fällt dieser Unterschied nicht auf, da die von Rebase standardmäßig auf jede Collection angewendeten Policies `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Teil erfüllt. Er wird jedoch relevant, sobald Sie eigene Policies schreiben:

- **`policy.serverContext()` ist dafür `false`.** Dieser Helper kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors ist `'service'`. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, wird einen Schreibzugriff über `dataAsAdmin` mit dem Postgres-Fehler `42501` abweisen. Ein Lesezugriff auf eine solche Collection gibt **null Zeilen mit HTTP 200** zurück — der stille Fehlerfall. Schreiben Sie `rolesOverlap(["admin"])` (oder ergänzen Sie es), wenn Sie "mein Backend" meinen.
- **Die Reichweite entspricht der Reichweite eines `admin`-Benutzers.** Weisen Sie einem Anwendungsbenutzer die Rolle `admin` zu, erhält dieser genau dieselben Zeilen, die auch dieser Accessor sieht. Es handelt sich nicht um einen privaten Kanal.

### 3. `rebase.sql()` — Raw SQL und der einzige Node-exklusive Accessor

Wenn Sie zwingend eine bedingungslose Umgehung benötigen, ist `rebase.sql()` die Lösung: Raw SQL über die Owner-Verbindung, keine Policies, Zugriff auf alle Zeilen. Es ist das mächtigste Werkzeug im Kontext einer Funktion — mehr noch als der Accessor mit "admin" im Namen.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Bei heutigen Deployments verursacht das keine Nachteile — man sollte es jedoch wissen, falls eine Funktion später portiert werden soll. Siehe [Portabilität der Laufzeitumgebung](#portabilität-der-laufzeitumgebung).

:::caution[Direkter Drizzle-Zugriff ist nur unter Node möglich]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder gemanagten Node-Deployment in Ordnung.

Man sollte jedoch die Konsequenzen kennen: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine Node-Funktion, umgeht Ihre Collection-Callbacks, die `rebase.data` ausführt (wobei keines von beiden `validation` prüft, das für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und bezieht ihre Verbindung nicht aus der Anfrage. `rebase.sql()` bietet Ihnen dasselbe Raw SQL über die Verbindung des Frameworks. Bevorzugen Sie diesen Weg.
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

Warum dies auf **jeder** Laufzeitumgebung, einschließlich Node, wichtig ist:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Ein lesender Zugriff auf Modulebene wird ausgewertet, sobald die Datei importiert wird, noch bevor eine Anfrage existiert. Unter Node bedeutet dies, dass eine einzige fehlende Variable die gesamte Datei und alle darin enthaltenen Routen lahmlegt. Auf einem Host, der Konfigurationen an die Anfrage statt an den Prozess bindet, gibt es zum Importzeitpunkt überhaupt nichts auszulesen.

- `getEnv(c)` — alle für diese Anfrage sichtbaren Variablen
- `env(c, "NAME")` — eine einzelne Variable, getrimmt; Leerstrings gelten als nicht gesetzt
- `requireEnv(c, "NAME")` — wie oben, wirft jedoch einen Fehler mit dem Namen der Variable
- `lazyResource(factory)` — initialisiert einen aufwendigen Client einmalig bei der ersten Nutzung

`rebase doctor` meldet Zugriffe auf `process.env` auf Modulebene in Ihrem functions-Verzeichnis.

## Hintergrundaufgaben

Arbeiten, die über die Antwort hinaus fortgeführt werden sollen, gehören in `waitUntil`:

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

Ein Promise ohne `await` sieht ähnlich aus, ist es aber nicht. `waitUntil` bietet zwei entscheidende Vorteile:

- **Unter Node** wird das Promise nachverfolgt, sodass ein Graceful Shutdown darauf wartet, anstatt dass der Prozess während eines halb gesendeten Webhooks beendet wird. Ein offenes Promise bei `SIGTERM` geht andernfalls einfach verloren.
- **Auf einem Isolate-basierten Host** wird der Host angewiesen, das Isolate am Leben zu erhalten, bis das Promise abgeschlossen ist. Ohne dies wird die Aufgabe in dem Moment abgebrochen, in dem die Antwort aufgelöst wird — stillschweigend und mit einem sauberen 200-Status in den Logs.

Ein Fehler wird geloggt, anstatt an den Unhandled-Rejection-Handler übergeben zu werden, sodass ein Fehlschlag die Route nennt, aus der er stammt.

## Portabilität der Laufzeitumgebung

Eine Custom Function ist eine Hono-App, und Hono läuft auf jeder JavaScript-Server-Laufzeitumgebung. Ob *Ihre* Funktion außerhalb eines Node-Prozesses laufen kann, hängt davon ab, was ihre eigene Datei importiert und verwendet.

Nichts davon schränkt ein, was Sie heute schreiben können. Jedes Rebase-Deployment ist ein Node-Prozess; eine Funktion, die eine Datei liest oder einen Socket öffnet, ist völlig legitim, und kein Build oder Deployment schlägt deswegen fehl. Dies ist dokumentiert, damit die Antwort bereits jetzt bekannt ist und nicht später dateiweise ermittelt werden muss.

**Portabel — funktioniert auf jeder Laufzeitumgebung:**

- Alles, was aus `@rebasepro/server/functions` exportiert wird
- `getDriver(c)` und `rebase.dataAsAdmin` — beide kommunizieren unabhängig von der Umgebung über dieselbe Schnittstelle
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — Web-Standards
- Jede Abhängigkeit, die kein Node erfordert

**Nur unter Node:**

- `rebase.sql()` — die Owner-Verbindung zur Datenbank ist ein TCP-Socket
- Ein direkt importierter Drizzle-/`pg`-/`mongodb`-Client aus demselben Grund
- Node-eigene Module: `fs`, `path`, `crypto` (das Node-Modul — `globalThis.crypto` ist portabel), `child_process`, …
- Darauf aufbauende Pakete: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latente Fehler auf jeder Laufzeitumgebung** — diese sollten in jedem Fall behoben werden:

- `process.env`-Zugriffe auf Modulebene (siehe [Konfiguration und Secrets](#konfiguration-und-secrets))
- Fire-and-Forget-Promises anstelle von [`waitUntil`](#hintergrundaufgaben)
- Sich darauf zu verlassen, dass ein Handler nach dem Timeout seiner Anfrage weiterläuft. Unter Node tut er das; das ist jedoch eine Eigenschaft des Prozesses, keine Garantie des Frameworks

### Eigene Funktionen überprüfen

`rebase build` gibt für jeden relevanten Befund eine Zeile aus und vermerkt das Ergebnis pro Funktion im Bundle-Manifest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` meldet dasselbe, ohne dass ein Build erforderlich ist.

### Wenn Sie einen laufzeitspezifischen Pfad benötigen

`runtimeKey()` gibt `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` oder `"other"` zurück; `isNodeRuntime()` ist die gängige Prüfung. Nutzen Sie diese für Fallbacks, nicht um eine Implementierung zu forken — eine Funktion, die zwei Implementierungen erfordert, sind eigentlich zwei Funktionen.

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

Custom Functions werden geladen und gemountet, **nachdem** `initializeRebaseBackend()` das Core-Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** — Datenbankverbindungen, Auth-Tabellen, Realtime-Services
2. **Auth-Routen** — `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** — `/api/storage/*`
4. **Daten-Routen** — `/api/data/*` (CRUD für Collections)
5. **Custom Functions** ← `/api/functions/*`
6. **Cron-Jobs** — `/api/admin/cron/*`
7. **WebSocket** — Realtime-Abonnements

Das bedeutet, dass Ihre Custom Functions Zugriff auf alle initialisierten Services haben. Registrieren Sie Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App, bevor Sie `initializeRebaseBackend()` aufrufen:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie Ihrer eigenen App auf diese Weise hinzufügen, liegen **außerhalb** jedes Rebase-Routers, sodass auf ihnen keine Auth-Middleware gelaufen ist und `getDriver(c)` nicht gesetzt ist. Sichern Sie diese mit `requireAuth` / `requireAdmin` ab, importiert aus **`@rebasepro/server`** — dem Root-Paket —, die das Token selbst validieren. Die Guards unter dem Subpfad `/functions` lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt eine vorzutäuschen.
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

## Fehlerbehebung (Debugging)

Wenn Funktionen geladen werden, protokolliert der Boot `Loaded custom functions` mit deren Anzahl. Die Zeile jeder einzelnen Funktion wird auf `debug` protokolliert (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Wenn das Laden fehlschlägt, gibt der Loader Diagnoseinformationen aus:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Der Router wird für das **Verzeichnis** gemountet, nicht für die einzelnen darin enthaltenen Funktionen. Sollte der Import aller Dateien fehlschlagen — eine einzige fehlende Umgebungsvariable auf Modulebene reicht aus, um alle zu blockieren —, antwortet `GET /api/functions` dennoch mit `200` mit einer leeren Liste sowie einem `skipped`-Zähler. So lässt sich unterscheiden, ob "nichts geladen werden konnte" oder "dieser Build keine Funktionen enthielt". Das Listing selbst erfordert einen authentifizierten Aufrufer, einen API-Schlüssel mit dem Scope `functions:invoke` oder den Service-Key — die Funktionen bleiben für jeden aufrufbar, den sie jeweils zulassen, aber die Liste der Funktionen ist nicht öffentlich. Die genauen Ursachen verbleiben im Boot-Log.

## Timeouts und Rate Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** — standardmäßig 30 Sekunden, antwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert das Timeout. Der Handler kann von außen nicht abgebrochen werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504-Fehlers abgebrochen; übergeben Sie es daher an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Operationen, denen das Signal nicht übergeben wird, laufen weiter — das Timeout gibt den Client und den Socket frei, stoppt aber nicht die Ausführung. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses und keine vertragliche Garantie; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundaufgaben).
- **Rate Limit** — Aufrufer mit API-Schlüssel oder Authentifizierung teilen sich die Kontingente der Daten-API. Anonyme Aufrufer erhalten ein eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Kann mit `rateLimit.anonymousFunctions` überschrieben werden; `null` schaltet es ab.

Unbehandelte Promise-Rejections werden protokolliert, führen jedoch nicht zum Absturz: Ein unüberwachter Fire-and-Forget-Aufruf in einer einzelnen Funktion würde sonst den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`, um das Standardverhalten von Node wiederherzustellen.

In Rebase Cloud gelten an der Edge vor Ihren Funktionen eigene Limits. Zustände auf Modulebene, das Dateisystem und ausgehende Ports verhalten sich dort auf eine Weise, die man kennen sollte, bevor man Architekturen darauf aufbaut. Siehe
[Managed Backend Runtime](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[Entity-Callbacks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
