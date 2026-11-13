---
sourceHash: 41e067cb49021d45
title: Custom Functions
sidebar_label: Custom Functions
description: Fügen Sie benutzerdefinierte Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit Custom Functions können Sie neben den automatisch generierten CRUD-Endpunkten von Rebase **beliebige Hono-API-Routen** hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihrem `functions/`-Verzeichnis ab, und Rebase bindet sie automatisch ein.

Verwenden Sie Custom Functions für:

- **Business-Logic-Endpunkte** – Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregat-Abfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer Custom Function

Erstellen Sie eine Datei in Ihrem `backend/functions/`-Verzeichnis, die als Default-Export eine Hono-App exportiert:

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

`POST`, da dies der Standard des SDKs ist – siehe [Vom Client aus aufrufen](#vom-client-aufrufen). Eine `GET`-Route ist genauso gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das Functions-Verzeichnis. Eine Datei, die während der Ausführung hinzugefügt wird, wird beim nächsten Neuladen eingebunden – kein Neustart erforderlich. (Dies muss angestoßen werden: Das Verzeichnis wird gescannt statt importiert, weshalb der Watcher dies nicht ableiten kann.)

## Vom Client aufrufen

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` erstellt die URL, hängt das Token des Aufrufers an und wirft bei einem Nicht-2xx-Status einen `RebaseApiError` – sodass die eigene Fehlerstruktur der Funktion den Aufrufer erreicht, anstatt einer bloßen `fetch`-Zurückweisung.

Vier Dinge, die über den Namen hinaus übergeben werden können:

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
`client.call("functions/hello", payload)` erreicht ebenfalls eine Funktion. Es sendet immer per `POST` und gibt wie `invoke` den Body unverändert zurück – keines von beiden greift auf einen `data`-Schlüssel zu. Bevorzugen Sie `functions.invoke`, das eine Methode, einen Sub-Pfad und einen `responseType` akzeptiert; `call` existiert für Routen, die außerhalb von `/api/functions` eingebunden sind, was `invoke` nicht ausdrücken kann.
:::

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Autorenoberfläche: Er lädt nichts, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeitumgebung ausgeführt werden kann. Das Paket-Root greift auf das gesamte Framework zu – die Boot-Sequenz, die Datei-Loader, den WebSocket-Layer –, was für einen Server-Einstiegspunkt passend ist, aber mehr als ein Routen-Handler benötigt. Zudem bietet er Ihnen typisierte Kontext-Zugriffsfunktionen (`getUser`, `getDriver`), anstatt `c.get("user")` manuell zu casten.

Den vollständigen Vertrag finden Sie unter [Runtime portability](#runtime-portabilität).
:::

## Konfiguration

:::note[Wo dies konfiguriert wird]
**Managed Runtime:** Nichts zu konfigurieren – die Runtime erkennt `backend/functions/` von selbst (`functions` im `rebase.json`-Eintrag der Backend-App, falls Sie es verschoben haben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein `REBASE_ROLE=functions`-Prozess bedient; jede andere Rolle verweigert den Start, wenn diese gesetzt sind.
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

Rebase führt folgende Schritte aus:

1. Das Verzeichnis nach `.ts`- / `.js`-Dateien durchsuchen
2. Validieren, dass jeder Default-Export eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontext-weitergabe) unten)

### Funktionen als Werte

Ein Verzeichnis ist eine Möglichkeit zu definieren, was der Server bereitstellt: ein Record von URL-Segmenten zu Hono-Apps. Übergeben Sie dieses Record selbst als `functions` oder lesen Sie ein Verzeichnis mit `loadFunctions` ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Geben Sie entweder `functions` oder `functionsDir` an, nicht beides: Beim Start wird die Kombination abgelehnt. `loadFunctions(dir, { onSkip })` übergibt Ihnen jede übersprungene Datei samt Grund. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet und geben eine einmalige Warnung aus. Für sich allein bindet sich die Functions-Gruppe mit `app.route("/hooks", backend.routes.functions())` an jedem beliebigen Pfad ein, und `getUser(c)` sowie `getDriver(c)` funktionieren darin; siehe [Custom Server Integration](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Mapping

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **nur auf der obersten Ebene des Verzeichnisses** erkannt – es gibt keine Rekursion. `functions/admin/users.ts` wird von `rebase build` kompiliert, aber niemals eingebunden; flachen Sie stattdessen den Namen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Booten gemeldet und im Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen werden**:

- `index.ts` / `index.js` – reserviert
- `*.test.ts` / `*.test.js` – Testdateien
- `*.d.ts` – Typdeklarationen
- Unterverzeichnisse sowie `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien – werden als Probleme gemeldet, da der Build mehr kompiliert, als die Runtime lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, das Ziel des `functions:invoke:<name>`-Scopes, den ein Key für den Aufruf benötigt, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` auswählt, wenn Sie einer Funktion einen eigenen Prozess zuweisen.

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

`defineFunction` gibt exakt die Hono-App zurück, die diese manuell erstellen, sodass die drei austauschbar sind. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und übergibt Ihnen das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

In einem Monorepo lösen Ihre Funktionen möglicherweise eine andere Hono-Kopie auf als die von Rebase verwendete, wodurch `exported instanceof Hono` für einen funktionierenden Router `false` ist. Daher prüft der Loader stattdessen die Struktur (`isHonoLike`): ein Nicht-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Module-Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine Datei-URL um (`pathToFileURL(filePath).href`), sodass der Import unter Windows und POSIX gleichermaßen funktioniert, und ruft `import(url)` über `new Function("url", "return import(url)")` auf, damit ein TypeScript-Build dies nicht in ein `require()` umschreiben kann, das unter ESM fehlschlägt.

---

## Authentifizierung und Kontext-Weitergabe

Custom Functions werden mit der **gleichen Auth-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgelehnt**, wenn kein JWT übergeben wird
- Sie müssen Routen, die eine Authentifizierung erfordern, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht Ihren Handler niemals: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgewiesen, sodass eine abgelaufene Sitzung niemals stillschweigend zu einer anonymen herabgestuft wird.

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

`getUser` gibt ein eingegrenztes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig von der verwendeten Authentifizierungsmethode des Aufrufers. `getUserId(c)` und `getRoles(c)` sind Shortcuts. `getScopes(c)` ist alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die anwendungseigenen Scopes und die Scopes ihrer Rollen; für einen API-Key genau das, was der Key beinhaltet.

### Das Konto des Aufrufers

`getUser(c)` liest das Access-Token aus, und das Token enthält die ID, Rollen und Adresse des Aufrufers. Es gibt keinen Aufschluss darüber, wie sich das Konto anmeldet oder wie sein Anzeigename lautet. `getUserProfile(c)` liest diese Werte aus dem Auth-Speicher:

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

`providers` listet auf, wie sich das Konto anmelden kann: `"password"`, wenn ein Passwort vorhanden ist, gefolgt von jedem verknüpften Anbieter (`"google"`, `"apple"`, …) in der Reihenfolge der Verknüpfung. Ein Gastkonto oder ein Konto, das sich nur mit einem Einmalcode anmeldet, hat eine leere Liste.

Das Auslesen erfolgt für jede Anfrage aktuell: Ein Anbieter, den der Aufrufer vor Kurzem verknüpft hat, wird bei seiner nächsten Anfrage angezeigt, ohne auf die Aktualisierung des Tokens warten zu müssen. Der erste Aufruf in einer Anfrage erfordert zwei Lookups über Schlüssel, die zusammen ausgeführt werden. Nachfolgende Aufrufe in derselben Anfrage verwenden das Ergebnis wieder, und eine Anfrage, die dies nie aufruft, verursacht keinerlei Aufwand.

Es gibt `undefined` für anonyme Aufrufer zurück, ebenso für Service-Key- oder API-Key-Aufrufer, die als kein bestimmtes Konto agieren, sowie für Konten, die nicht mehr existieren. Es gibt auch `undefined` auf einem Backend zurück, dessen Konten bei einem externen [Auth-Adapter](/docs/backend/auth-adapters/) liegen: Fragen Sie in diesem Fall stattdessen diesen Anbieter ab. Wenn ein Administrator `x-rebase-impersonate` sendet, wird das imitierte Konto zurückgegeben.

### Schützen von Routen

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

Platzieren Sie Guards im **eigenen Middleware-Slot der Route**, wie oben gezeigt, anstatt `app.use("/*", requireAuth)` zu verwenden. `use()` deckt nur die Routen ab, die *darunter* deklariert sind; eine Route, die später – in einigen Monaten ganz unten in der Datei – hinzugefügt wird, bliebe so stillschweigend ungeschützt.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined` und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` lässt ausschließlich die Rolle `admin` zu. Für eine Aktion, die einer enger gefassten Rolle oder einem API-Key zugänglich sein soll, sichern Sie die Route mit `requireScope` ab. Dies nimmt einen integrierten [Scope](/docs/backend/roles-and-scopes/) entgegen oder einen, den die App unter `auth.scopes` in der Users-Collection deklariert, wie etwa `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Jede angemeldete Person besitzt jeden App-Scope; für eine Person entscheidet `requireScope` daher nichts: Prüfen Sie im Handler, ob diese Person dieses Projekt deployen darf. Was der Scope ermöglicht, ist das **Einschränken eines Keys**: Ein Key mit `project:deploy:p1` ist nur für `p1` gültig. Ein Key benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App-Scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Authentifizierung per Service-Key

Rebase unterstützt einen statischen, in Ihrer `.env` definierten `REBASE_SERVICE_KEY` für Skripte oder Server-zu-Server-Aufrufe.

Wenn eine externe Anfrage den Service-Key über den Authorization-Header übergibt (`Authorization: Bearer <service_key>`), führt die Auth-Middleware automatisch Folgendes aus:
1. Validiert den Key mittels Constant-Time-Vergleich, um Timing-Angriffe zu verhindern.
2. Gewährt Administratorzugriff und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security greift weiterhin – sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet und nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Per-Boot-Schlüssel**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch, wenn es die servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`) aufruft. Das bedeutet, dass Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Key jederzeit administrative Aufgaben ausführen kann.

## Zugriff auf Datenbank & Services

### 1. Der benutzerspezifische Driver – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Driver zurück, der **auf den Aufrufer beschränkt** ist, sodass jeder Lese- und Schreibvorgang anhand Ihrer Row-Level-Security-Richtlinien für diesen Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` – es wirft einen Fehler mit einer Meldung, die das Konfigurationsproblem benennt, anstatt zwanzig Zeilen später an einem `undefined` zu scheitern.

<span class="since-badge" data-since="0.31">Seit 0.31</span> `fetchCollection` und `fetchOne` geben die Zeilen zurück, die auch `GET /api/data/<table>` zurückgibt: Datumsangaben als RFC-3339-Strings, ein `belongsTo` als dessen Fremdschlüssel (`authorId`) und eine verknüpfte Zeile nur dann, wenn `include` sie benennt – `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` – für vertrauenswürdige Hintergrundarbeiten

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

`rebase.dataAsAdmin` ist nicht typisiert, bis Sie Ihre [generierte `Database` registrieren](/docs/backend/typed-server-data).

### RLS-bezogener Driver vs. Rebase-Singleton

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Wird ausgeführt als** | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung** | ✅ Ja (wird gegen den Aufrufer ausgewertet)    | ✅ Ja (wird gegen die Service-Identität ausgewertet)             |
| **Ideal für...**    | Allgemeine Benutzer-CRUD-Operationen, Suche und Abfragen | Hintergrundjobs, System-Trigger, Webhooks                        |
| **API-Stil**       | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluent-Tabellen-Accessoren (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin-Ebene beschränkt, umgeht RLS jedoch nicht**. Der Driver wird einmalig beim Booten mit `withAuth({ uid: "service", roles: ["admin"] })` initialisiert, sodass jeder Lese- und Schreibvorgang innerhalb einer Transaktion ausgeführt wird, die auf die eingeschränkte Rolle `rebase_user` mit `app.uid = 'service'` gewechselt hat. Ihre Richtlinien (Policies) werden ausgewertet – und zwar gegen diese Identität.

Für die meisten Projekte wird dieser Unterschied nie sichtbar, da die von Rebase für jede Tabelle standardmäßig injizierten Richtlinien `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er wird jedoch in dem Moment relevant, in dem Sie eigene Richtlinien schreiben:

- **`policy.serverContext()` ist dafür false.** Dieser Helper kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors lautet `'service'`. Eine Tabelle mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, verweigert einen `dataAsAdmin`-Schreibvorgang mit dem Postgres-Fehler `42501`, und ein Lesevorgang auf einer solchen Collection gibt **null Zeilen mit HTTP 200** zurück – der stille Pfad. Verwenden Sie `rolesOverlap(["admin"])` (oder ergänzen Sie es daneben), wenn Sie "mein Backend" meinen.
- **Seine Reichweite entspricht der eines `admin`-Benutzers.** Wenn Sie einem Anwendungsbenutzer die Rolle `admin` zuweisen, erhält dieser Zugriff auf exakt dieselben Zeilen, die dieser Accessor sieht. Es handelt sich nicht um einen privaten Kanal.

### 3. `getSql(c)` – SQL als Aufrufer

Wenn das SDK eine Abfrage oder einen Schreibvorgang nicht sauber abbilden kann – ein bedingtes Upsert, ein Compare-and-Swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, ein CTE –, schreiben Sie das SQL und führen Sie es als Aufrufer aus:

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

Das Statement wird in der eigenen Transaktion des Aufrufers ausgeführt, als die eingeschränkte Rolle `rebase_user` mit dessen Identität – dieselbe Transaktion, die der benutzerspezifische Driver öffnet –, sodass die `rls`-Regeln Ihrer Tabellen über jede Zeile entscheiden, genau wie beim SDK. Eine Abfrage, die alle Zeilen anfordert, erhält nur diejenigen des Aufrufers.

- **Standardmäßig schreibgeschützt (Read-only).** Übergeben Sie `{ write: true }`, um Datensätze einzufügen, zu aktualisieren oder zu löschen; die Insert- und Update-Richtlinien gelten weiterhin.
- **Der Query-Text stammt von Ihnen; Werte gehören in `params`** (`$1`, `$2`, …). Die Identität des Aufrufers befindet sich in Transaktionseinstellungen, die per SQL geändert werden könnten; ein Statement, das dies tun könnte – `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mehr als ein Statement –, wird vor der Ausführung mit `400 SQL_NOT_ALLOWED` abgewiesen. Das Interpolieren von Benutzereingaben in den Text würde diesen Schutzmechanismus auf die Probe stellen; tun Sie dies nicht.
- **Was es mit dem SDK teilt:** Die Richtlinien und drei Regeln, die Postgres für beide durchsetzt: Eine [materialisierte View](/docs/collections/views/#materialized-views) liefert ihre Zeilen nur an ihre berechtigten `roles` aus; eine Zeile einer Tabelle, die `tenant` deklariert, kann nicht zu einem anderen Mandanten verschoben werden, außer durch einen `bypassRoles`-Aufrufer (`TENANT_IMMUTABLE`); und die servereigenen Funktionen (`rebase.record_history`, `rebase.enqueue_job`) werden abgelehnt. Eine Spalte, die der Aufrufer nicht lesen darf – `.private()` oder ein fehlendes `.access({ read })` –, wird aus den Zeilen entfernt, so wie es die API tut, wenn es sich um eine einfache Referenz auf die Spalte handelt (`SELECT *`, `password_hash AS h`); ein daraus *berechneter* Wert (`md5(password_hash)`) wird nicht erkannt, berechnen Sie also nichts daraus.
- **Was es nicht teilt:** `beforeQuery` und `afterRead`, Validierung, Save-Hooks und die Historie laufen in Node und werden hierbei nicht ausgeführt.

Aus einem Skript heraus bietet [`openRebase`](/docs/backend/embedding-postgres-driver/) dasselbe: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` – SQL als Service-Identität

Eine Funktion, die eigene Regeln (ein Ticket pro Tag, eine Zeitprüfung) über Tabellen durchsetzt, die nur Admins lesen dürfen, kann `getSql(c)` nicht verwenden: Der Aufrufer bräuchte Richtlinien, die ihn zulassen, und dieselben Richtlinien würden die Tabellen auch in der öffentlichen Daten-API öffnen. `rebase.sqlAsAdmin` führt das Statement als `{ uid: "service", roles: ["admin"] }` aus, also mit der Identität, die `rebase.dataAsAdmin` verwendet, unter derselben Row-Level Security:

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

Es entspricht `getSql(c)` mit einer anderen Identität: die eingeschränkte Request-Rolle, der Admin-Zweig Ihrer Richtlinien, schreibgeschützt, sofern nicht `{ write: true }` übergeben wird, und derselbe `SQL_NOT_ALLOWED`-Schutz. Im Gegensatz zum Owner-basierten `rebase.sql()` kann es kein DDL ausführen, und vom Auth-Speicher erreicht es nur das, was ein Admin über die Users-Collection erreicht: Sessions, Keys und MFA-Geheimnisse werden der Request-Rolle vorenthalten, und ein Passwort-Hash wird aus den Zeilen entfernt. Ein einzelnes Statement verursacht einen Roundtrip, genau wie `rebase.sql()`. Aus einem Skript heraus bietet `openRebase()` dies ebenfalls.

### 4. `rebase.sql()` – Owner-SQL und der einzige reine Node-Accessor

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Sie wirklich eine bedingungslose Umgehung benötigen, ist `rebase.sql()` die Lösung: rohes SQL über die Owner-Verbindung, keine Richtlinien, alle Zeilen. Es ist das am stärksten privilegierte Element im Kontext einer Funktion – mehr noch als der Accessor mit "admin" im Namen.

Es ist nicht zum Erstellen von Tabellen gedacht. Eine Tabelle wird mit `defineTable` in `backend/schema/` [deklariert](/docs/schema/) und beim Booten erstellt; eine Tabelle, die per `CREATE TABLE` in einer Funktion erzeugt wird, verfügt über keinerlei Validierung, Hooks, Row-Level-Security-Konfiguration, Admin-Ansicht oder SDK-Typen. `rebase.sql()` führt ein solches Statement zwar aus, protokolliert jedoch eine Warnung mit dem Hinweis auf die stattdessen zu deklarierende Tabelle.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Bei allen heute existierenden Deployments hat dies keine Nachteile – es ist lediglich der eine Punkt, den man wissen muss, falls eine Funktion später umziehen soll. Siehe [Runtime portability](#runtime-portabilität).

:::caution[Direkter Drizzle-Zugriff ist Node-exklusiv]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder gemanagten Node-Deployment in Ordnung.

Es lohnt sich jedoch zu wissen, welche Konsequenzen dies hat: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine Node-Funktion; sie umgeht Ihre Tabellen-Hooks, die `rebase.data` ausführt (weder das eine noch das andere prüft `.validate()`, was für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und bezieht ihre Verbindung von außerhalb der Anfrage. `rebase.sql()` bietet Ihnen dasselbe rohe SQL über die frameworkeigene Verbindung, und `getSql(c)` stellt es Ihnen unter den Richtlinien des Aufrufers bereit. Bevorzugen Sie diese Varianten.
:::

## Konfiguration und Secrets

Lesen Sie Konfigurationswerte **innerhalb** des Handlers aus, niemals auf Modulebene:

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

Ein Auslesen auf Modulebene wird ausgewertet, sobald die Datei importiert wird – noch bevor eine Anfrage existiert. Unter Node bedeutet dies, dass eine einzige fehlende Variable die gesamte Datei und jede darin enthaltene Route lahmlegt. Auf einem Host, der Konfigurationswerte an den Request statt an den Prozess bindet, gibt es zum Importzeitpunkt überhaupt nichts auszulesen.

- `getEnv(c)` – jede Variable, die für diese Anfrage sichtbar ist
- `env(c, "NAME")` – eine Variable, getrimmt; leer gilt als nicht gesetzt
- `requireEnv(c, "NAME")` – dasselbe, wirft jedoch einen Fehler mit dem Namen der Variablen
- `lazyResource(factory)` – erstellt einen aufwendigen Client einmalig bei der ersten Verwendung

`rebase doctor` meldet Auslesevorgänge von `process.env` auf Modulebene in Ihrem Functions-Verzeichnis.

## Hintergrundarbeiten

Auf eine eigene Seite verschoben: [Hintergrundarbeiten](/docs/backend/background-work/).

## Runtime-Portabilität

Eine Custom Function ist eine Hono-App. Ob sie außerhalb eines Node-Prozesses laufen kann, hängt folglich davon ab, was ihre eigene Datei importiert. `rebase.sql()`, ein direkt importierter Datenbank-Client und Node-Built-ins binden sie an Node; der Rest von `rebase` und die Web-Plattform tun dies nicht, und keines von beidem verursacht heute Fehler. Unter [Runtime-Portabilität](/docs/backend/runtime-portability/) wird aufgeführt, was portabel ist, wie `rebase build` und `rebase doctor` darüber berichten und wie man anhand der Runtime verzweigt.

## Reihenfolge der Routenregistrierung

Custom Functions werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` das Core-Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** – Datenbankverbindungen, Auth-Tabellen, Realtime-Services
2. **Auth-Routen** – `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** – `/api/storage/*`
4. **Datenrouten** – `/api/data/*` (CRUD für Tabellen)
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
Routen, die Sie auf diese Weise zu Ihrer eigenen App hinzufügen, befinden sich **außerhalb** jedes Rebase-Routers, sodass auf ihnen keine Auth-Middleware ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Sichern Sie diese mit `requireAuth` / `requireAdmin` ab, die aus **`@rebasepro/server`** – dem Paket-Root – importiert werden, da diese das Token selbst verifizieren. Die Guards auf dem `/functions`-Subpfad lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt vorzutäuschen, dass eine existiert.
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

## Debugging

Beim Laden von Funktionen protokolliert der Boot-Vorgang `Loaded custom functions` mit deren Anzahl. Für jede Funktion wird eine eigene Zeile auf `debug`-Level (`LOG_LEVEL=debug`) ausgegeben:

```
⚡ Loaded function route: hello
```

Schlägt das Laden fehl, liefert der Loader Diagnoseausgaben:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Der Router wird für das **Verzeichnis** eingebunden, nicht für die darin enthaltenen Funktionen. Falls der Import jeder einzelnen Datei fehlschlägt – eine fehlende Umgebungsvariable auf Modulebene reicht aus, um alle lahmzulegen –, antwortet `GET /api/functions` dennoch mit `200` und einer leeren Liste samt einem `skipped`-Zähler. So lässt sich "nichts geladen" von "dieser Build enthält keine Funktionen" unterscheiden. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Key mit dem einfachen `functions:invoke`-Scope oder den Service-Key – die Funktionen bleiben für jeden aufrufbar, den die jeweilige Funktion zulässt, aber die Übersicht über sie ist nicht öffentlich. Die Gründe verbleiben im Boot-Log.

## Timeouts und Rate-Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** – standardmäßig 30 Sekunden, antwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert ihn. Der Handler kann nicht von außen gestoppt werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504 abgebrochen. Übergeben Sie dieses daher an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Aufgaben, denen das Signal nicht übergeben wurde, laufen weiter – das Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses, keine vertragliche Garantie; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeiten).
- **Rate-Limit** – API-Key- und angemeldete Aufrufer teilen sich die Buckets der Daten-API. Anonyme Aufrufer erhalten ihr eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router standardmäßig für Webhook-Empfänger öffentlich ist. Überschreibbar mit `rateLimit.anonymousFunctions`; `null` schaltet es ab.

Nicht abgefangene Promise-Rejections werden protokolliert, anstatt fatal zu sein: Ein Fire-and-Forget-Aufruf in einer Funktion würde andernfalls den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`, um das Standardverhalten von Node wiederherzustellen.

Auf Rebase Cloud hat das Edge-Netzwerk vor Ihren Funktionen eigene Limits, und Status auf Modulebene, das Dateisystem sowie ausgehende Ports verhalten sich auf eine Weise, die man kennen sollte, bevor man seine Architektur darauf ausrichtet. Siehe [Managed Backend Runtime](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration
- **[Tabellen-Hooks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** – Geplante Hintergrundaufgaben
