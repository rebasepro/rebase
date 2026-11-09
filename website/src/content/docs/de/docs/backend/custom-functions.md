---
sourceHash: 0b723d38ab4a2594
title: Custom Functions
sidebar_label: Custom Functions
description: Füge eigene Hono-API-Endpunkte neben deinen Rebase-CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit Custom Functions kannst du **beliebige Hono-API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung (File-based Discovery)** wie Collections und Cron-Jobs: Lege eine TypeScript-Datei in deinem `functions/`-Verzeichnis ab, und Rebase mountet sie automatisch.

Verwende Custom Functions für:

- **Endpunkte für Geschäftslogik** – Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregierte Abfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer Custom Function

Erstelle eine Datei in deinem `backend/functions/`-Verzeichnis, die standardmäßig eine Hono-App exportiert:

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

Dies wird unter **`/api/functions/hello`** gemountet. Der Dateiname (ohne Erweiterung) wird zum Routen-Präfix.

`POST`, da das SDK dies standardmäßig sendet – siehe [Aufruf über den Client](#aufruf-über-den-client). Eine `GET`-Route ist genauso gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis. Eine Datei, die hinzugefügt wird, während der Prozess läuft, wird beim nächsten Neuladen gemountet – ohne Neustart. (Dies muss mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

## Aufruf über den Client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` baut die URL auf, hängt das Token des Aufrufers an und wirft bei einem Nicht-2xx-Status einen `RebaseApiError` – sodass die eigene Fehlerstruktur der Funktion den Aufrufer erreicht, anstatt einer reinen `fetch`-Rejection.

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
`client.call("functions/hello", payload)` erreicht ebenfalls eine Funktion. Es sendet immer per `POST` und gibt wie `invoke` den Body unverändert zurück – keines von beiden greift auf einen `data`-Schlüssel zu. Bevorzuge `functions.invoke`, das eine Methode, einen Sub-Pfad und einen `responseType` akzeptiert; `call` existiert für Routen, die außerhalb von `/api/functions` gemountet sind, was `invoke` nicht abbilden kann.
:::

:::important
Importiere aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Autorenoberfläche: Er bindet nichts ein, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Runtime laufen kann. Das Paket-Root greift auf das gesamte Framework zu – die Boot-Sequenz, die Datei-Loader, den WebSocket-Layer –, was für einen Server-Einstiegspunkt richtig ist, aber mehr darstellt, als ein Route-Handler benötigt. Es bietet dir außerdem typisierte Kontext-Zugriffsmethoden (`getUser`, `getDriver`), anstatt manuell `c.get("user")` casten zu müssen.

Siehe [Runtime portability](#portabilität-der-runtime) für den vollständigen Vertrag.
:::

## Konfiguration

:::note[Wo dies hingehört]
**Managed-Runtime:** Nichts zu konfigurieren – die Runtime erkennt `backend/functions/` automatisch (`functions` im `rebase.json`-Eintrag der Backend-App, falls du es verschoben hast). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein `REBASE_ROLE=functions`-Prozess bedient; jede andere Rolle verweigert den Bootvorgang, wenn diese gesetzt sind.
**Ejected:** `initializeRebaseBackend({ functionsDir })` oder `functions` (unten) in `backend/src/index.ts`.
:::

Aktiviere Custom Functions, indem du deiner Backend-Konfiguration `functionsDir` hinzufügst:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase wird:

1. Das Verzeichnis nach `.ts`- / `.js`-Dateien durchsuchen
2. Validieren, dass jeder Default-Export eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` mounten
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontext-weitergabe) unten)

### Funktionen als Werte

Ein Verzeichnis ist eine Möglichkeit, das zu erzeugen, was der Server bereitstellt: ein Record von einem URL-Segment zu einer Hono-App. Übergib diesen Record selbst als `functions` oder lies ein Verzeichnis mit `loadFunctions` ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Gib entweder `functions` oder `functionsDir` an, nicht beides: Der Bootvorgang verweigert die Kombination. `loadFunctions(dir, { onSkip })` übergibt dir jede übersprungene Datei samt Begründung. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind deprecated und warnen einmalig. Für sich allein mountet die Functions-Gruppe an jedem beliebigen Pfad mit `app.route("/hooks", backend.routes.functions())`, und `getUser(c)` sowie `getDriver(c)` funktionieren darin; siehe [Custom Server Integration](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Zuordnung

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **ausschließlich auf der obersten Ebene des Verzeichnisses** erkannt – es gibt keine Rekursion. `functions/admin/users.ts` wird von `rebase build` kompiliert, aber niemals gemountet; verflache stattdessen den Namen (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Booten gemeldet und im Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` – reserviert
- `*.test.ts` / `*.test.js` – Testdateien
- `*.d.ts` – Typdeklarationen
- Unterverzeichnisse sowie `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien – werden als Probleme gemeldet, da der Build mehr kompiliert, als die Runtime lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, das Ziel des `functions:invoke:<name>`-Scopes, den ein Key benötigt, um sie aufzurufen, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` auswählt, wenn du einer Funktion einen eigenen Prozess zuweist.

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

`defineFunction` gibt genau die Hono-App zurück, die diese manuell aufbauen, sodass alle drei austauschbar sind. Es erspart dir die Deklaration von `Hono<HonoEnv>` und übergibt dir das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

In einem Monorepo lösen deine Funktionen möglicherweise eine andere Kopie von Hono auf als die, die Rebase verwendet, wodurch `exported instanceof Hono` bei einem funktionierenden Router `false` ergibt. Daher prüft der Loader stattdessen die Struktur (`isHonoLike`): ein Non-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Module-Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine Datei-URL um (`pathToFileURL(filePath).href`), sodass er unter Windows und POSIX gleichermaßen importiert werden kann, und ruft `import(url)` über `new Function("url", "return import(url)")` auf, damit ein TypeScript-Build ihn nicht in ein `require()` umschreiben kann, das unter ESM fehlschlägt.

---

## Authentifizierung und Kontext-Weitergabe

Custom Functions werden mit **derselben Auth-Middleware** wie die Datenrouten gemountet, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgelehnt**, wenn kein JWT bereitgestellt wird
- Du musst Routen, die Authentifizierung benötigen, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht deinen Handler niemals: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend zu einer anonymen herabgestuft wird.

### Den Aufrufer auslesen

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

`getUser` gibt ein eingegrenztes (narrowed) Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig davon, welche Authentifizierungsmethode der Aufrufer verwendet hat. `getUserId(c)` und `getRoles(c)` sind Shortcuts. `getScopes(c)` enthält alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die anwendungseigenen Scopes und die Scopes ihrer Rollen; für einen API-Key genau das, was der Key beinhaltet.

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

Platziere Guards wie oben im **eigenen Middleware-Slot der Route** anstatt `app.use("/*", requireAuth)` zu nutzen. `use()` deckt nur die Routen ab, die *darunter* deklariert sind, sodass eine später hinzugefügte Route – etwa in ein paar Monaten am Dateiende – unbemerkt ungeschützt bleibt.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined` und dein Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` lässt die `admin`-Rolle zu und niemanden sonst. Für eine Aktion, die eine spezifischere Rolle oder ein API-Key erreichen soll, schütze die Route mit `requireScope`. Es akzeptiert einen integrierten [Scope](/docs/backend/roles-and-scopes/) oder einen, den die App unter `auth.scopes` in der Users-Collection deklariert, wie etwa `"project:deploy": { label: "Deploy projects", target: "project" }`:`

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

Jede angemeldete Person besitzt jeden App-Scope, daher entscheidet `requireScope` bei einer Person nichts: Prüfe im Handler, ob diese Person dieses Projekt deployen darf. Was der Scope ermöglicht, ist das **Einschränken eines Keys**: Ein Key mit `project:deploy:p1` ist nur für `p1` gültig. Ein Key benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Service-Key-Authentifizierung

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in deiner `.env` für Skripte oder Server-zu-Server-Aufrufe definiert wird.

Wenn eine externe Anfrage den Service-Key über den Authorization-Header übergibt (`Authorization: Bearer <service_key>`), führt die Auth-Middleware automatisch Folgendes aus:
1. Validiert den Key mittels Constant-Time-Vergleich, um Timing-Angriffe zu verhindern.
2. Gewährt Zugriff auf Admin-Ebene und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security gilt weiterhin – sie wird für `{ uid: "service", roles: ["admin"] }` evaluiert und nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn du keinen `REBASE_SERVICE_KEY` konfiguriert hast, generiert Rebase einen zufälligen **internen Schlüssel pro Bootvorgang**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch beim Aufruf der servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`). Dadurch kann deine serverseitige Logik administrative Aufgaben auch ohne manuell konfigurierten Service-Key ausführen.

## Zugriff auf Datenbank & Services

### 1. Der benutzerspezifische Driver – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Driver zurück, der **auf den Aufrufer beschränkt ist**, sodass jeder Lese- und Schreibvorgang anhand deiner Row-Level-Security-Richtlinien als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` – es wirft eine Fehlermeldung, die das Verdrahtungsproblem benennt, anstatt zwanzig Zeilen später an einem `undefined` zu scheitern.

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

`rebase.dataAsAdmin` ist untypisiert, bis du deine [generierte `Database` registrierst](/docs/backend/typed-server-data).

### RLS-bezogener Driver vs. Rebase-Singleton

|                     | `getDriver(c)` (request-bezogen)               | `rebase.dataAsAdmin` (Service-Identität)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Wird ausgeführt als** | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung** | ✅ Ja (ausgewertet gegen den Aufrufer)          | ✅ Ja (ausgewertet gegen die Service-Identität)                   |
| **Ideal für...**    | Allgemeine Benutzer-CRUD, Suche und Abfragen   | Hintergrund-Jobs, System-Trigger, Webhooks                        |
| **API-Stil**       | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluent Collection-Accessors (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin-Rechte beschränkt, umgeht aber kein RLS**. Der Driver wird einmalig beim Booten mit `withAuth({ uid: "service", roles: ["admin"] })` konfiguriert, sodass jeder Lese- und Schreibvorgang innerhalb einer Transaktion ausgeführt wird, die mit `app.uid = 'service'` zur eingeschränkten Rolle `rebase_user` gewechselt hat. Deine Richtlinien werden ausgewertet – und zwar gegen diese Identität.

In den meisten Projekten macht sich dieser Unterschied nie bemerkbar, da die Standardrichtlinien, die Rebase in jede Collection injiziert, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er wird in dem Moment relevant, in dem du eigene Richtlinien schreibst:

- **`policy.serverContext()` ist dafür `false`.** Dieses Hilfskonstrukt kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors lautet `'service'`. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, verweigert Schreibzugriffe über `dataAsAdmin` mit dem Postgres-Fehler `42501`. Ein Lesezugriff auf eine solche Collection liefert **null Zeilen mit HTTP 200** zurück – das stille Fehlschlagen. Schreibe `rolesOverlap(["admin"])` (oder füge es hinzu), wenn du „mein Backend“ meinst.
- **Die Reichweite entspricht der eines `admin`-Benutzers.** Wenn du einem Anwendungsbenutzer die Rolle `admin` zuweist, erhält er Zugriff auf genau dieselben Zeilen, die dieser Accessor sieht. Es handelt sich um keinen privaten Kanal.

### 3. `getSql(c)` – SQL als Aufrufer

Wenn das SDK eine Abfrage oder einen Schreibvorgang nicht sauber ausdrückt – ein bedingtes Upsert, ein Compare-and-Swap-`UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, eine CTE –, schreibe das SQL und führe es als der Aufrufer aus:

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

Die Anweisung läuft in der eigenen Transaktion des Aufrufers, als die eingeschränkte Rolle `rebase_user` mit dessen Identität – der Transaktion, die der benutzerspezifische Driver öffnet –, sodass die Sicherheitsregeln deiner Collections jede Zeile entscheiden, genau wie beim SDK. Eine Abfrage, die nach allen Zeilen fragt, erhält die des Aufrufers.

- **Standardmäßig schreibgeschützt.** Übergib `{ write: true }`, um einzufügen, zu aktualisieren oder zu löschen; die Insert- und Update-Richtlinien gelten weiterhin.
- **Der Abfragetext gehört dir; Werte kommen in `params`** (`$1`, `$2`, …). Die Identität des Aufrufers steckt in Transaktionseinstellungen, die SQL ändern kann. Eine Anweisung, die das könnte – `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mehr als eine Anweisung –, wird daher mit `400 SQL_NOT_ALLOWED` abgelehnt, bevor sie läuft. Nutzereingaben in den Text zu interpolieren, würde genau diesen Schutz auf die Probe stellen; tu es nicht.
- **Was es mit dem SDK teilt.** Die Richtlinien und drei Regeln, die Postgres für beide durchsetzt: Eine [Materialized View](/docs/collections/views/#materialized-views) liefert ihre Zeilen nur an ihre `roles`, eine Zeile einer Collection mit `tenant` kann nur von einem Aufrufer aus `bypassRoles` zu einem anderen Tenant verschoben werden (`TENANT_IMMUTABLE`), und die eigenen Funktionen des Servers (`rebase.record_history`, `rebase.enqueue_job`) werden abgelehnt. Eine Spalte, die der Aufrufer nicht lesen darf – `excludeFromApi` oder ein `access.read`, das er nicht hat –, wird aus den Zeilen entfernt, so wie es die API tut, sofern sie eine einfache Referenz auf die Spalte ist (`SELECT *`, `password_hash AS h`); ein daraus *berechneter* Wert (`md5(password_hash)`) wird nicht erkannt, rechne also nicht damit.
- **Was es nicht teilt.** `beforeQuery` und `afterRead`, Validierung, Save-Callbacks und Verlauf leben in Node und laufen nicht.

Aus einem Skript heraus bietet [`openRebase`](/docs/backend/embedding-postgres-driver/) dasselbe: `(await rebase.withAuth(user)).sql(…)`.

### 4. `rebase.sql()` – Owner-SQL und der einzige reine Node-Accessor

Wenn du wirklich eine bedingungslose Umgehung benötigst, ist `rebase.sql()` die Lösung: Raw-SQL über die Owner-Verbindung, keine Richtlinien, jede Zeile. Es ist das am stärksten privilegierte Element im Kontext einer Funktion – mehr noch als der Accessor mit „admin“ im Namen.

Es ist nicht dafür gedacht, Tabellen zu erstellen. Eine Tabelle ist eine [Collection](/docs/collections/), die in `config/collections/` deklariert und beim Booten erstellt wird; eine mit `CREATE TABLE` in einer Funktion erstellte Tabelle verfügt über keinerlei Validierung, Callbacks, Sicherheitsregeln, Admin-Ansicht oder SDK-Typen. `rebase.sql()` führt eine solche Anweisung zwar aus, protokolliert jedoch eine Warnung mit dem Hinweis, welche Collection stattdessen deklariert werden sollte.

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

Es läuft über eine TCP-Verbindung zu deiner Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Bei allen heute existierenden Deployments entstehen dadurch keine Nachteile – es ist lediglich der eine Punkt, den man wissen muss, falls eine Funktion später umziehen soll. Siehe [Runtime portability](#portabilität-der-runtime).

:::caution[Direkter Drizzle-Zugriff ist nur unter Node möglich]
Du kannst auch deine eigene Drizzle-Instanz importieren und sie direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder verwalteten Node-Deployment völlig in Ordnung.

Es ist wichtig zu wissen, was das bedeutet: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine reine Node-Funktion, umgeht deine Collection-Callbacks, die `rebase.data` ausführt (keines von beiden prüft `validation`, was für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und bezieht ihre Verbindung nicht aus der Anfrage. `rebase.sql()` bietet dir dasselbe Raw-SQL über die frameworkeigene Verbindung, und `getSql(c)` bietet es dir unter den Richtlinien des Aufrufers. Bevorzuge diese Wege.
:::

## Konfiguration und Secrets

Lies die Konfiguration **innerhalb** des Handlers aus, niemals auf Modulebene:

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

Warum dies auf **jeder** Runtime wichtig ist, einschließlich Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Ein Lesevorgang auf Modulebene wird ausgewertet, wenn die Datei importiert wird, bevor irgendeine Anfrage existiert. Unter Node bedeutet dies, dass eine einzige fehlende Variable die gesamte Datei und jede darin enthaltene Route lahmlegt. Auf einem Host, der die Konfiguration an die Anfrage statt an den Prozess bindet, gibt es beim Importzeitpunkt überhaupt nichts auszulesen.

- `getEnv(c)` – jede für diese Anfrage sichtbare Variable
- `env(c, "NAME")` – eine Variable, getrimmt; leer gilt als nicht gesetzt
- `requireEnv(c, "NAME")` – dasselbe, wirft jedoch einen Fehler mit dem Namen der Variablen
- `lazyResource(factory)` – erstellt einen aufwendigen Client einmalig bei der ersten Verwendung

`rebase doctor` meldet `process.env`-Aufrufe auf Modulebene in deinem functions-Verzeichnis.

## Hintergrundarbeiten

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

Ein Promise ohne `await` sieht gleichwertig aus, ist es aber nicht. `waitUntil` bietet zwei Vorteile:

- **Unter Node** wird das Promise nachverfolgt, sodass ein Graceful Shutdown darauf wartet, anstatt dass der Prozess während eines halb gesendeten Webhooks beendet wird. Ein ungebundenes Promise geht bei `SIGTERM` einfach verloren.
- **Auf einem isolationsbasierten Host (Isolates)** wird der Host angewiesen, das Isolate am Leben zu erhalten, bis das Promise abgeschlossen ist. Ohne dies wird die Arbeit in dem Moment abgebrochen, in dem die Response aufgelöst wird – stillschweigend mit einem sauberen 200er-Status in den Logs.

Eine Rejection wird protokolliert, anstatt dem Handler für unbehandelte Rejections überlassen zu werden, sodass ein Fehler die Route benennt, von der er ausging.

Code, der außerhalb einer Anfrage ausgeführt wird, hat kein `c`, das übergeben werden könnte: ein Initialisierer auf Modulebene, ein Helper, den sich Routen und Cron-Jobs teilen, oder Arbeit, die ein Cron-Lauf startet und auf die er nicht wartet. Übergib `waitUntil` die Arbeit allein:

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

Die Arbeit wird für einen Graceful Shutdown nachverfolgt und eine Rejection wird protokolliert, genau wie mit `c`. Was sie nicht tun kann, ist, ein Isolate am Leben zu erhalten, da dies der Ausführungskontext der Anfrage ist: Übergib immer `c`, wenn eine Anfrage vorliegt. Arbeit, die ein Cron-Lauf, ein Job oder ein Queue-Handler einfach `await`en kann, sollte stattdessen erwartet werden; der Lauf selbst ist das, worauf der Shutdown wartet, und dessen Ergebnis wird damit aufgezeichnet.

Der Shutdown wartet maximal 5 Sekunden auf diese Arbeit. Arbeiten, die Minuten dauern, gehören in einen [Cron-Job](/docs/backend/cron-jobs/) oder einen [Job](/docs/backend/jobs/), welche protokolliert und neu startbar sind. Ein Cron-Job läuft zudem [instanzübergreifend immer nur einzeln](/docs/backend/cron-across-instances/#concurrency-guarding), unabhängig davon, ob er über den Zeitplan oder einen manuellen Trigger gestartet wurde.

## Portabilität der Runtime

Eine Custom Function ist eine Hono-App. Ob sie außerhalb eines Node-Prozesses ausgeführt werden kann, hängt also davon ab, was ihre Datei importiert. `rebase.sql()`, ein direkt importierter Datenbank-Client und integrierte Node-Module binden sie an Node; der Rest von `rebase` und die Web-Plattform tun dies nicht, und heute schlägt wegen beidem nichts fehl. Unter [Runtime portability](/docs/backend/runtime-portability/) ist aufgeführt, was portabel ist, wie `rebase build` und `rebase doctor` darüber berichten und wie man anhand der Runtime verzweigt.

## Reihenfolge der Routen-Registrierung

Custom Functions werden geladen und gemountet, **nachdem** `initializeRebaseBackend()` das Core-Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** – Datenbankverbindungen, Auth-Tabellen, Echtzeit-Services
2. **Auth-Routen** – `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** – `/api/storage/*`
4. **Daten-Routen** – `/api/data/*` (CRUD für Collections)
5. **Custom Functions** ← `/api/functions/*`
6. **Cron-Jobs** – `/api/admin/cron/*`
7. **WebSocket** – Realtime-Abonnements

Das bedeutet, dass deine Custom Functions Zugriff auf alle initialisierten Services haben. Registriere Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App, bevor du `initializeRebaseBackend()` aufrufst:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die du deiner eigenen App auf diese Weise hinzufügst, liegen **außerhalb** jedes Rebase-Routers, sodass für sie keine Auth-Middleware ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Schütze diese mit `requireAuth` / `requireAdmin`, importiert aus **`@rebasepro/server`** – dem Paket-Root –, welche das Token selbst verifizieren. Die Guards auf dem Subpfad `/functions` lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt vorzutäuschen, dass eine existiert.
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

Wenn Funktionen geladen werden, protokolliert der Bootvorgang `Loaded custom functions` mit deren Anzahl. Die Zeile jeder einzelnen Funktion wird unter `debug` (`LOG_LEVEL=debug`) protokolliert:

```
⚡ Loaded function route: hello
```

Wenn das Laden fehlschlägt, liefert der Loader eine Diagnoseausgabe:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Der Router wird für das **Verzeichnis** gemountet, nicht für die darin enthaltenen Funktionen. Selbst wenn jede Datei beim Import fehlschlägt – eine einzige fehlende Umgebungsvariable auf Modulebene reicht aus, um alle lahmzulegen –, antwortet `GET /api/functions` weiterhin mit `200` und einer leeren Liste plus einem `skipped`-Zähler. So lässt sich „nichts geladen“ von „dieser Build enthält keine Funktionen“ unterscheiden. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Key mit dem einfachen Scope `functions:invoke` oder den Service-Key – die Funktionen bleiben für jeden aufrufbar, den die jeweilige Funktion zulässt, aber die Übersicht über sie ist nicht öffentlich. Die Gründe dafür verbleiben im Boot-Log.

## Timeouts und Rate-Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** – standardmäßig 30 Sekunden, beantwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert ihn. Der Handler kann nicht von außen gestoppt werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504-Fehlers abgebrochen (aborted); übergib es daher an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Arbeit, der das Signal nicht übergeben wurde, läuft weiter – der Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach dem 504-Fehler *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses, keine vertragliche Garantie; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeiten).
- **Rate-Limit** – Aufrufer mit API-Key und angemeldete Benutzer teilen sich die Buckets der Daten-API. Anonyme Aufrufer erhalten ein eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Überschreibe dies mit `rateLimit.anonymousFunctions`; `null` schaltet es ab.

Unbehandelte Promise-Rejections werden protokolliert und sind nicht fatal: Ein Fire-and-Forget-Aufruf in einer Funktion würde andernfalls den gesamten Prozess beenden. Setze `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` für das Standardverhalten von Node.

In der Rebase Cloud besitzt der Edge-Layer vor deinen Funktionen eigene Limits, und Zustände auf Modulebene, das Dateisystem sowie ausgehende Ports verhalten sich auf eine Weise, die man vor dem Entwurf kennen sollte. Siehe [Managed backend runtime](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend Overview](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration
- **[Entity Callbacks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Cron Jobs](/docs/backend/cron-jobs)** – Geplante Hintergrundaufgaben
