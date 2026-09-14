---
sourceHash: 65910bc3708c9f5d
title: Benutzerdefinierte Funktionen
sidebar_label: Benutzerdefinierte Funktionen
description: Fügen Sie benutzerdefinierte Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Benutzerdefinierte Funktionen ermöglichen es Ihnen, **beliebige Hono-API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzuzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Collections und Cronjobs: Legen Sie eine TypeScript-Datei in Ihrem `functions/`-Verzeichnis ab, und Rebase bindet sie automatisch ein.

Nutzen Sie benutzerdefinierte Funktionen für:

- **Endpunkte für Geschäftslogik** – Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregierte Abfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer benutzerdefinierten Funktion

Erstellen Sie eine Datei in Ihrem Verzeichnis `backend/functions/`, die standardmäßig eine Hono-App exportiert:

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

Dies wird unter **`/api/functions/hello`** eingebunden. Der Dateiname (ohne Erweiterung) wird zum Routenpräfix.

`POST`, da dies standardmäßig vom SDK gesendet wird – siehe [Vom Client aufrufen](#vom-client-aufrufen-invoke-from-the-client). Eine `GET`-Route ist ebenso gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis. Eine Datei, die hinzugefügt wird, während es läuft, wird beim nächsten Neuladen eingebunden – kein Neustart erforderlich. (Es muss mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, sodass der Watcher dies nicht ableiten kann.)

## Vom Client aufrufen {#invoke-from-the-client}

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` erstellt die URL, hängt das Token des Aufrufers an und wirft bei einem Nicht-2xx-Status einen `RebaseApiError` – sodass die eigene Fehlerstruktur der Funktion den Aufrufer erreicht, anstatt einer reinen `fetch`-Zurückweisung.

Drei Dinge, die es neben dem Namen akzeptiert:

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
`client.call("functions/hello", …)` erreicht ebenfalls eine Funktion und tut etwas subtil anderes: Es entpackt `res.data`, wenn die Antwort dies enthält. Zwei Zugangswege mit zwei Antwortverträgen sind eine Falle – verwenden Sie `functions.invoke`. `call` existiert für Routen, die außerhalb von `/api/functions` eingebunden sind, was `invoke` nicht ausdrücken kann.
:::

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Autorenoberfläche: Er bindet nichts ein, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeitumgebung ausgeführt werden kann. Das Paket-Root greift auf das gesamte Framework zu – die Boot-Sequenz, die Datei-Loader, die WebSocket-Schicht –, was für einen Server-Einstiegspunkt richtig ist, aber mehr darstellt, als ein Route-Handler benötigt. Zudem bietet er Ihnen typisierte Kontext-Zugriffsmethoden (`getUser`, `getDriver`), anstatt `c.get("user")` manuell casten zu müssen.

Siehe [Laufzeit-Portabilität](#laufzeit-portabilität-runtime-portability) für den vollständigen Vertrag.
:::

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime:** Nichts zu konfigurieren – die Runtime erkennt `backend/functions/` von selbst (`entry.functions` in `rebase.json`, falls Sie es verschoben haben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein Prozess bedient.
**Ejected:** `initializeRebaseBackend({ functionsDir })` in `backend/src/index.ts`.
:::

Aktivieren Sie benutzerdefinierte Funktionen, indem Sie `functionsDir` zu Ihrer Backend-Konfiguration hinzufügen:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase wird:

1. Das Verzeichnis nach `.ts`- / `.js`-Dateien durchsuchen
2. Validieren, dass jeder Standard-Export eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontext-weitergabe-authentication-and-context-propagation) unten)

## Dateibenennung und Routen-Mapping

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **nur auf der obersten Ebene des Verzeichnisses** erkannt – es gibt keine Rekursion. `functions/admin/users.ts` wird zwar von `rebase build` kompiliert, aber niemals eingebunden; flachen Sie den Namen stattdessen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Booten gemeldet und auf dem Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` – reserviert
- `*.test.ts` / `*.test.js` – Testdateien
- `*.d.ts` – Typdeklarationen
- Unterverzeichnisse und `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien – werden als Probleme gemeldet, da der Build mehr kompiliert, als die Runtime lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, die API-Schlüssel-Berechtigung `functions/<name>` und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` filtert, wenn Sie einer Funktion einen eigenen Prozess zuweisen.

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

`defineFunction` gibt genau die Hono-App zurück, die diese manuell aufbauen, sodass alle drei austauschbar sind. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und übergibt Ihnen das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

Beim Kompilieren von Codebasen mit mehreren verschachtelten Verzeichnissen oder in Monorepos kann es zu **Hono-Paketduplikaten** kommen.

Wenn das Rebase-Framework von einer Hono-Version abhängt und Ihr lokales functions-Verzeichnis zu einer anderen auflöst, schlagen standardmäßige Klassenvererbungsprüfungen (`exported instanceof Hono`) fehl, da ihre Prototypen in getrennten Speicherbereichen existieren.

Um falsch-negative Ergebnisse zu vermeiden und das Laden funktionierender Router nicht fälschlicherweise abzulehnen, verwendet Rebase einen duck-typisierten Validator (`isHonoLike`):
- Er prüft, ob das exportierte Objekt ein Nicht-Null-`object` ist.
- Er überprüft, ob das Objekt eine `.fetch`-Methode bereitstellt (erforderlich zum Routen von Anfragen).
- Er stellt sicher, dass `.routes` ein `array` ist.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### ES-Modul-Compiler-Escape

Um TypeScript- und JavaScript-Dateien sowohl auf Windows- als auch auf POSIX-Systemen dynamisch zu importieren, konvertiert der Loader Dateipfade über `pathToFileURL(filePath).href` in Standard-Datei-URIs.

Um zu verhindern, dass die TypeScript-Kompilierung native dynamische ESM-Imports (`import(url)`) in CommonJS-`require()`-Aufrufe umschreibt (was zur Laufzeit unter ESM-Runtimes zu Fehlern führen würde), führt Rebase einen Laufzeit-Compiler-Escape aus:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Authentifizierung und Kontext-Weitergabe {#authentication-and-context-propagation}

Benutzerdefinierte Funktionen werden mit der **gleichen Auth-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und in den Kontext injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgelehnt**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die eine Authentifizierung erfordern, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht Ihren Handler nie: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend auf eine anonyme herabgestuft wird.

### Auslesen des Aufrufers

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

`getUser` gibt ein eingegrenztes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig von der vom Aufrufer verwendeten Authentifizierungsmethode. `getUserId(c)` und `getRoles(c)` sind Direktaufrufe.

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

Platzieren Sie Guards wie oben im **eigenen Middleware-Slot der Route** statt `app.use("/*", requireAuth)` zu verwenden. `use()` deckt nur die Routen ab, die *darunter* deklariert sind, sodass eine später hinzugefügte Route – am Ende der Datei, Monate später – stillschweigend ungeschützt bleibt.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined` und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Service-Key-Authentifizierung

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in Ihrer `.env` für Skripte oder Server-zu-Server-Aufrufe definiert ist.

Wenn eine externe Anfrage den Service-Schlüssel über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, führt die Auth-Middleware automatisch Folgendes aus:
1. Validiert den Schlüssel mittels zeitkonstantem Vergleich, um Timing-Angriffe zu verhindern.
2. Gewährt Zugriff auf Admin-Ebene und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security gilt weiterhin – sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet und nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Schlüssel pro Systemstart**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch beim Aufruf der servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`). Das bedeutet, dass Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Schlüssel jederzeit administrative Aufgaben ausführen kann.

## Zugriff auf Datenbank und Services

### 1. Der benutzerbezogene Driver – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Treiber **beschränkt auf den Aufrufer** zurück, sodass jeder Lese- und Schreibzugriff anhand Ihrer Row-Level-Security-Richtlinien als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` – es wirft einen Fehler mit dem konkreten Verbindungsproblem, anstatt zwanzig Zeilen später an `undefined` zu scheitern.

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

### RLS-bezogener Driver vs. Rebase-Singleton

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Ausführung als**  | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Erzwingung**  | ✅ Ja (ausgewertet für den Aufrufer)          | ✅ Ja (ausgewertet für die Service-Identität)                   |
| **Ideal für...**    | Allgemeine Benutzer-CRUD, Suche und Abfragen   | Hintergrund-Jobs, System-Trigger, Webhooks                        |
| **API-Stil**        | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluent-Collection-Zugriffsmethoden (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin-Ebene beschränkt, umgeht RLS jedoch nicht**. Der Driver wird einmalig beim Booten mit `withAuth({ uid: "service", roles: ["admin"] })` initialisiert, sodass jeder Lese- und Schreibzugriff innerhalb einer Transaktion ausgeführt wird, die zur eingeschränkten Rolle `rebase_user` mit `app.uid = 'service'` gewechselt hat. Ihre Richtlinien werden ausgewertet – und zwar gegen diese Identität.

Für die meisten Projekte wird dieser Unterschied nie sichtbar, da die Standardrichtlinien, die Rebase in jede Collection einfügt, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er wird in dem Moment relevant, in dem Sie eigene Richtlinien schreiben:

- **`policy.serverContext()` ist dafür false.** Dieser Helper kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors ist `'service'`. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, verweigert einen `dataAsAdmin`-Schreibvorgang mit dem Postgres-Fehler `42501`, und ein Lesevorgang auf einer solchen Collection liefert **null Zeilen mit HTTP 200** – der stille Fehlerfall. Schreiben Sie `rolesOverlap(["admin"])` (oder fügen Sie es hinzu), wenn Sie „mein Backend“ meinen.
- **Seine Reichweite entspricht der Reichweite eines `admin`-Benutzers.** Wenn Sie einem Anwendungsbenutzer die Rolle `admin` gewähren, erhält er genau die Zeilen, die auch dieser Accessor sieht. Es ist kein privater Kanal.

### 3. `rebase.sql()` – Raw SQL und der einzige reine Node-Accessor

Wenn Sie wirklich eine bedingungslose Umgehung benötigen, ist `rebase.sql()` die Lösung: Raw SQL über die Owner-Verbindung, keine Richtlinien, jede Zeile. Es ist das am stärksten privilegierte Element im Kontext einer Funktion – mehr noch als der Accessor mit „admin“ im Namen.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Das hat bei heutigen Deployments keinerlei Nachteile – es ist lediglich der eine Punkt, den man wissen muss, falls eine Funktion später migriert werden soll. Siehe [Laufzeit-Portabilität](#laufzeit-portabilität-runtime-portability).

:::caution[Direkter Drizzle-Zugriff ist Node-only]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder verwalteten Node-Deployment völlig in Ordnung.

Es lohnt sich zu wissen, was das bedeutet: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine Node-Funktion, sie umgeht Ihre Collection-Callbacks und Validierungen und bezieht ihre Verbindung nicht aus dem Anfragekontext. `rebase.sql()` bietet Ihnen dasselbe Raw SQL über die frameworkeigene Verbindung. Ziehen Sie dies vor.
:::

## Konfiguration und Secrets {#configuration-and-secrets}

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

Ein Lesezugriff auf Modulebene wird ausgewertet, wenn die Datei importiert wird – bevor überhaupt eine Anfrage existiert. Unter Node bedeutet dies, dass eine einzige fehlende Variable die gesamte Datei und jede darin enthaltene Route lahmlegt. Bei einem Host, der die Konfiguration an den Request statt an den Prozess bindet, gibt es beim Importzeitpunkt überhaupt nichts auszulesen.

- `getEnv(c)` – jede für diese Anfrage sichtbare Variable
- `env(c, "NAME")` – eine Variable, getrimmt; Leerzeichen gelten als nicht gesetzt
- `requireEnv(c, "NAME")` – dasselbe, wirft jedoch einen Fehler mit dem Namen der Variablen
- `lazyResource(factory)` – erstellt einen aufwendigen Client einmalig bei der ersten Verwendung

`rebase doctor` meldet `process.env`-Lesezugriffe auf Modulebene in Ihrem functions-Verzeichnis.

## Hintergrundarbeiten {#background-work}

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

Ein Promise ohne `await` sieht gleichwertig aus, ist es aber nicht. `waitUntil` bringt zwei entscheidende Vorteile:

- **Unter Node** wird das Promise nachverfolgt, sodass ein Graceful Shutdown darauf wartet, anstatt dass der Prozess während eines halb gesendeten Webhooks beendet wird. Ein nicht abgewartetes Promise geht bei `SIGTERM` einfach verloren.
- **Auf einem Isolate-basierten Host** wird der Host angewiesen, das Isolate am Leben zu erhalten, bis das Promise abgeschlossen ist. Ohne dies wird die Aufgabe in dem Moment abgebrochen, in dem die Antwort aufgelöst wird – stillschweigend und mit einem sauberen 200-Status in den Logs.

Eine Zurückweisung wird protokolliert, anstatt dem Handler für unbehandelte Rejections überlassen zu werden, sodass bei einem Fehler die Route benannt wird, von der er stammt.

## Laufzeit-Portabilität {#runtime-portability}

Eine benutzerdefinierte Funktion ist eine Hono-App, und Hono läuft auf jeder JavaScript-Server-Laufzeitumgebung. Ob *Ihre* Funktion woanders als in einem Node-Prozess ausgeführt werden kann, hängt daher davon ab, was ihre eigene Datei importiert und verwendet.

Nichts davon stellt eine Einschränkung für das dar, was Sie heute schreiben können. Jedes Rebase-Deployment ist ein Node-Prozess, eine Funktion, die eine Datei liest oder einen Socket öffnet, ist vollkommen valide, und kein Build oder Deployment schlägt deswegen fehl. Dies wird hier festgehalten, damit die Antwort jetzt bereits bekannt ist und nicht später für jede Datei einzeln herausgefunden werden muss.

**Portabel – funktioniert auf jeder Runtime:**

- Alles, was aus `@rebasepro/server/functions` exportiert wird
- `getDriver(c)` und `rebase.dataAsAdmin` – beide laufen über dieselbe Verbindung, unabhängig davon, wo sie ausgeführt werden
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` – die Web-Plattform
- Jede Abhängigkeit, die kein Node benötigt

**Node-only:**

- `rebase.sql()` – die Datenbank-Owner-Verbindung ist ein TCP-Socket
- Ein direkt importierter Drizzle-/`pg`-/`mongodb`-Client aus demselben Grund
- Node-Built-ins: `fs`, `path`, `crypto` (das Node-Modul – `globalThis.crypto` ist portabel), `child_process`, …
- Pakete, die darauf aufbauen: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latente Fehler auf jeder Runtime** – diese sollten unabhängig davon behoben werden:

- Lesezugriff auf `process.env` auf Modulebene (siehe [Konfiguration und Secrets](#konfiguration-und-secrets-configuration-and-secrets))
- Fire-and-Forget-Promises anstelle von [`waitUntil`](#hintergrundarbeiten-background-work)
- Sich darauf verlassen, dass ein Handler nach einem Timeout des Requests weiterläuft. Unter Node tut er das; dies ist eine Eigenschaft des Prozesses, kein Garantieversprechen des Frameworks

### Eigene Funktionen prüfen

`rebase build` gibt für jeden handlungsrelevanten Befund eine Zeile aus und erfasst das Ergebnis pro Funktion im Bundle-Manifest:

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

### Wenn Sie einen runtime-spezifischen Pfad benötigen

`runtimeKey()` gibt `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` oder `"other"` zurück; `isNodeRuntime()` ist die gängige Prüfung. Verwenden Sie sie für ein Graceful Degrading, nicht um eine Implementierung aufzuspalten – eine Funktion, die zwei Implementierungen erfordert, sind zwei Funktionen.

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

## Reihenfolge der Routenregistrierung

Benutzerdefinierte Funktionen werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` das Core-Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** – Datenbankverbindungen, Auth-Tabellen, Realtime-Services
2. **Auth-Routen** – `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** – `/api/storage/*`
4. **Daten-Routen** – `/api/data/*` (CRUD für Collections)
5. **Benutzerdefinierte Funktionen** ← `/api/functions/*`
6. **Cronjobs** – `/api/cron/*`
7. **WebSocket** – Realtime-Abonnements

Das bedeutet, dass Ihre benutzerdefinierten Funktionen Zugriff auf alle initialisierten Dienste haben. Registrieren Sie Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App vor dem Aufruf von `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie auf diese Weise zu Ihrer eigenen App hinzufügen, befinden sich **außerhalb** jedes Rebase-Routers, sodass für sie keine Auth-Middleware ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Schützen Sie diese mit `requireAuth` / `requireAdmin`, die aus **`@rebasepro/server`** – dem Paket-Root – importiert werden und das Token selbst verifizieren. Die Guards auf dem Subpfad `/functions` lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt vorzugeben, dass eine existiert.
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

Wenn das Laden fehlschlägt, liefert der Loader Diagnoseausgaben:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Der Router wird für das **Verzeichnis** eingebunden, nicht für die darin enthaltenen Funktionen. Wenn der Import jeder einzelnen Datei fehlschlägt – eine fehlende Umgebungsvariable auf Modulebene reicht aus, um alle lahmzulegen –, antwortet `GET /api/functions` dennoch mit `200` und einer leeren Liste plus einem `skipped`-Zähler, sodass „nichts geladen“ von „dieser Build enthielt keine Funktionen“ unterschieden werden kann. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Schlüssel oder den Service-Schlüssel – die Funktionen bleiben für jeden aufrufbar, den die jeweilige Funktion zulässt, aber die Übersicht über sie ist nicht öffentlich. Die Gründe verbleiben im Boot-Log.

## Timeouts und Rate-Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** – standardmäßig 30 Sekunden, beantwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert es. Der Handler kann von außen nicht abgebrochen werden, übergeben Sie ausgehenden HTTP-Aufrufen daher ein `AbortSignal` – das Timeout gibt den Client und den Socket frei, bricht aber die Arbeit nicht ab. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses, keine Zusage des Vertrags; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeiten-background-work).
- **Rate-Limit** – API-Schlüssel und angemeldete Aufrufer teilen sich die Buckets der Daten-API. Anonyme Aufrufer erhalten ein eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router standardmäßig für Webhook-Empfänger öffentlich ist. Überschreiben Sie dies mit `rateLimit.anonymousFunctions`; `null` schaltet es aus.

Unbehandelte Promise-Rejections werden protokolliert und sind nicht fatal: Ein Fire-and-Forget-Aufruf in einer Funktion würde andernfalls den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`, um das Standardverhalten von Node zu aktivieren.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration
- **[Entity-Callbacks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Cronjobs](/docs/backend/cron-jobs)** – Geplante Hintergrundaufgaben
