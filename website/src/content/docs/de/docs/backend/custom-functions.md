---
sourceHash: 981d8ad3d6e13c80
title: Benutzerdefinierte Funktionen
sidebar_label: Benutzerdefinierte Funktionen
description: Fügen Sie benutzerdefinierte Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatisch aus einem Verzeichnis erkannt, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit benutzerdefinierten Funktionen können Sie **beliebige Hono-API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihrem `functions/`-Verzeichnis ab, und Rebase bindet sie automatisch ein.

Verwenden Sie benutzerdefinierte Funktionen für:

- **Endpunkte für Geschäftslogik** – Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregationsabfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer benutzerdefinierten Funktion

Erstellen Sie eine Datei in Ihrem `backend/functions/`-Verzeichnis, die standardmäßig eine Hono-App exportiert:

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

`POST`, da dies standardmäßig vom SDK gesendet wird – siehe [Aufruf über den Client](#aufruf-über-den-client). Eine `GET`-Route ist genauso gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis, sodass eine Datei, die während der Ausführung hinzugefügt wird, beim nächsten Neuladen eingebunden wird – kein Neustart erforderlich. (Es muss mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

## Aufruf über den Client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` baut die URL auf, hängt das Token des Aufrufers an und wirft bei Nicht-2xx-Antworten einen `RebaseApiError` – sodass das eigene Fehlerformat der Funktion beim Aufrufer ankommt, anstatt einer reinen `fetch`-Zurückweisung.

Vier Parameter, die neben dem Namen übergeben werden können:

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
`client.call("functions/hello", payload)` erreicht eine Funktion ebenfalls. Es führt immer ein `POST` aus und gibt wie `invoke` den Body unverändert zurück – keines von beiden greift auf einen `data`-Schlüssel zu. Bevorzugen Sie `functions.invoke`, das eine Methode, einen Unterpfad und einen `responseType` akzeptiert; `call` existiert für Routen, die außerhalb von `/api/functions` eingebunden sind, was `invoke` nicht ausdrücken kann.
:::

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Entwicklungsfläche: Er zieht nichts herein, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeitumgebung ausgeführt werden kann. Das Paket-Root greift auf das gesamte Framework zu – die Boot-Sequenz, die Datei-Loader, den WebSocket-Layer –, was für einen Server-Einstiegspunkt passend ist, aber mehr als ein Route-Handler benötigt. Zudem bietet es Ihnen typisierte Kontext-Zugriffsmethoden (`getUser`, `getDriver`), anstatt `c.get("user")` manuell zu casten.

Siehe [Laufzeit-Portabilität](#laufzeit-portabilität) für den vollständigen Vertrag.
:::

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime:** Nichts zu konfigurieren – die Runtime erkennt `backend/functions/` von selbst (`functions` im `rebase.json`-Eintrag der Backend-App, falls Sie es verschoben haben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein `REBASE_ROLE=functions`-Prozess bedient; jede andere Rolle verweigert den Start, wenn diese gesetzt sind.
**Ejected:** `initializeRebaseBackend({ functionsDir })` oder `functions` (unten) in `backend/src/index.ts`.
:::

Aktivieren Sie benutzerdefinierte Funktionen, indem Sie Ihrer Backend-Konfiguration `functionsDir` hinzufügen:

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
3. Jede App unter `/api/functions/<filename>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontext-weitergabe) unten)

### Funktionen als Werte

Ein Verzeichnis ist eine Möglichkeit bereitzustellen, was der Server ausliefert: ein Record von URL-Segmenten zu Hono-Apps. Übergeben Sie diesen Record selbst als `functions` oder lesen Sie ein Verzeichnis mit `loadFunctions` ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Geben Sie entweder `functions` oder `functionsDir` an, nicht beides: Der Startvorgang lehnt das Paar ab. `loadFunctions(dir, { onSkip })` übergibt Ihnen jede übersprungene Datei samt Begründung. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind deprecated und geben eine einmalige Warnung aus. Für sich allein bindet sich die Funktionsgruppe mit `app.route("/hooks", backend.routes.functions())` an jedem beliebigen Pfad ein, und `getUser(c)` sowie `getDriver(c)` funktionieren darin; siehe [Custom Server Integration](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Zuordnung

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **ausschließlich auf der obersten Ebene des Verzeichnisses** erkannt – es gibt keine Rekursion. `functions/admin/users.ts` wird von `rebase build` kompiliert, aber niemals eingebunden; flachen Sie stattdessen den Namen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Start gemeldet und am Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` — reserviert
- `*.test.ts` / `*.test.js` — Testdateien
- `*.d.ts` — Typdeklarationen
- Unterverzeichnisse sowie `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien — werden als Probleme gemeldet, da der Build mehr kompiliert, als die Runtime lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, das Ziel des `functions:invoke:<name>`-Scopes, den ein Schlüssel benötigt, um sie aufzurufen, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` filtert, wenn Sie einer Funktion einen eigenen Prozess zuweisen.

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

In einem Monorepo lösen Ihre Funktionen möglicherweise eine andere Hono-Kopie auf als die, die Rebase verwendet, wodurch `exported instanceof Hono` für einen funktionierenden Router `false` ist. Daher prüft der Loader stattdessen die Struktur (`isHonoLike`): ein Nicht-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Modul Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine Datei-URL um (`pathToFileURL(filePath).href`), sodass er unter Windows und POSIX gleichermaßen importiert werden kann, und ruft `import(url)` über `new Function("url", "return import(url)")` auf, damit ein TypeScript-Build dies nicht in ein `require()` umschreiben kann, das unter ESM fehlschlägt.

---

## Authentifizierung und Kontext-Weitergabe

Benutzerdefinierte Funktionen werden mit **derselben Auth-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und in den Kontext injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgelehnt**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die eine Authentifizierung erfordern, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht Ihren Handler nie: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend zu einer anonymen herabgestuft wird.

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

`getUser` gibt ein eingegrenztes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig von der vom Aufrufer verwendeten Authentifizierungsmethode. `getUserId(c)` und `getRoles(c)` sind Shortcuts. `getScopes(c)` ist alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die App-eigenen Scopes und die Scopes ihrer Rollen; für einen API-Schlüssel genau das, was der Schlüssel enthält.

### Das Konto des Aufrufers

`getUser(c)` liest das Access-Token, und das Token enthält die ID, Rollen und Adresse des Aufrufers. Es gibt nicht an, wie sich das Konto anmeldet oder wie sein Anzeigename lautet. `getUserProfile(c)` liest diese Angaben aus dem Auth-Store:

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

`providers` listet auf, wie sich das Konto anmelden kann: `"password"`, wenn es eines hat, danach jeder verknüpfte Anbieter (`"google"`, `"apple"`, …) in der Reihenfolge der Verknüpfung. Ein Gastkonto oder ein Konto, das sich nur mit einem Einmalcode anmeldet, hat eine leere Liste.

Der Lesevorgang ist bei jeder Anfrage aktuell: Ein Anbieter, den der Aufrufer vor einem Moment verknüpft hat, wird bei seiner nächsten Anfrage angezeigt, ohne auf das Aktualisieren des Tokens warten zu müssen. Der erste Aufruf in einer Anfrage kostet zwei Keyed-Lookups, die gemeinsam durchgeführt werden. Spätere Aufrufe in derselben Anfrage verwenden das Ergebnis wieder, und eine Anfrage, die dies nie aufruft, verursacht keine Kosten.

Es gibt `undefined` für einen anonymen Aufrufer zurück, für einen Aufrufer mit Dienstschlüssel oder API-Schlüssel, der als kein Konto agiert, und für ein Konto, das nicht mehr existiert. Es gibt auch `undefined` auf einem Backend zurück, dessen Konten bei einem externen [Auth-Adapter](/docs/backend/auth-adapters/) liegen: fragen Sie stattdessen diesen Anbieter an. Wenn ein Administrator `x-rebase-impersonate` sendet, gibt es das imitierte Konto zurück.

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

Platzieren Sie Guards im **eigenen Middleware-Slot der Route**, wie oben gezeigt, anstelle von `app.use("/*", requireAuth)`. `use()` deckt nur die Routen ab, die *darunter* deklariert sind, sodass eine später hinzugefügte Route – etwa in ein paar Monaten am Ende der Datei – stillschweigend ungeschützt bleibt.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined` und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` lässt die Rolle `admin` und niemanden sonst zu. Für eine Aktion, die eine engere Rolle oder ein API-Schlüssel erreichen soll, sichern Sie die Route mit `requireScope` ab. Es nimmt einen integrierten [Scope](/docs/backend/roles-and-scopes/) entgegen oder einen, den die App unter `auth.scopes` in der Users-Collection deklariert, wie etwa `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Jede angemeldete Person besitzt jeden App-Scope, daher entscheidet `requireScope` für eine Person nichts: Prüfen Sie im Handler, ob diese Person dieses Projekt deployen darf. Was der Scope hinzufügt, ist eine Möglichkeit, **einen Schlüssel einzuschränken**: Ein Schlüssel, der `project:deploy:p1` besitzt, ist nur für `p1` gültig. Ein Schlüssel benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App-Scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Rate-Limits

Eine Route, die pro Aufruf Ressourcen verbraucht, nutzt die `rateLimit`-Middleware, die über Replikate hinweg zählt. Siehe [Rate-Limits in Funktionen](/docs/backend/function-rate-limits/).

### Service-Key-Authentifizierung

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in Ihrer `.env` für Skripte oder Server-zu-Server-Aufrufe definiert ist.

Wenn eine externe Anfrage den Service-Key über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, führt die Auth-Middleware automatisch Folgendes durch:
1. Validiert den Schlüssel mittels Constant-Time-Vergleich, um Timing-Angriffe zu verhindern.
2. Gewährt Zugriff auf Admin-Ebene und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security gilt weiterhin – sie wird für `{ uid: "service", roles: ["admin"] }` ausgewertet und nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Schlüssel pro Start**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch beim Aufruf der servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`). Das bedeutet, dass Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Key jederzeit administrative Aufgaben durchführen kann.

## Zugriff auf Datenbank und Dienste

### 1. Der benutzerbezogene Driver – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Driver zurück, der **auf den Aufrufer beschränkt** ist, sodass jeder Lese- und Schreibvorgang anhand Ihrer Row-Level-Security-Richtlinien als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` – es wirft einen Fehler mit einer Meldung, die das Verdrahtungsproblem benennt, anstatt zwanzig Zeilen später bei `undefined` fehlzuschlagen.

`fetchCollection` und `fetchOne` geben dieselben Zeilen zurück wie `GET /api/data/<table>`: Datumsangaben als RFC 3339-Strings, ein `belongsTo` als dessen Fremdschlüssel (`authorId`) und eine verknüpfte Zeile nur dann, wenn `include` sie benennt – `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

|                     | `getDriver(c)` (Request-bezogen)               | `rebase.dataAsAdmin` (Service-Identität)                         |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Wird ausgeführt als** | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung** | ✅ Ja (gegen den Aufrufer ausgewertet)         | ✅ Ja (gegen die Service-Identität ausgewertet)                   |
| **Ideal für...**    | Allgemeine Benutzer-CRUD, Suche und Abfragen   | Hintergrund-Jobs, System-Trigger, Webhooks                        |
| **API-Stil**        | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluente Tabellen-Accessoren (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Administratoren beschränkt, umgeht jedoch nicht RLS**. Der Driver wird einmalig beim Start mit `withAuth({ uid: "service", roles: ["admin"] })` initialisiert, sodass jeder Lese- und Schreibvorgang innerhalb einer Transaktion ausgeführt wird, die mit `app.uid = 'service'` zur eingeschränkten Rolle `rebase_user` gewechselt hat. Ihre Richtlinien werden ausgewertet – und zwar gegen diese Identität.

Bei den meisten Projekten fällt dieser Unterschied nie auf, da die Standardrichtlinien, die Rebase in jede Tabelle einfügt, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er wird jedoch in dem Moment relevant, in dem Sie eigene Richtlinien schreiben:

- **`policy.serverContext()` ist dafür false.** Dieser Helper kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors ist `'service'`. Eine Tabelle mit `defaultPolicies: false`, deren einzige Schreibregel `serverContext()` ist, verweigert ein Schreiben über `dataAsAdmin` mit dem Postgres-Fehler `42501`, und ein Lesevorgang auf einer solchen Collection gibt **null Zeilen mit HTTP 200** zurück – die stille Variante. Schreiben Sie `rolesOverlap(["admin"])` (oder fügen Sie es hinzu), wenn Sie „mein Backend“ meinen.
- **Seine Reichweite entspricht der eines `admin`-Benutzers.** Das Zuweisen der `admin`-Rolle an einen Anwendungsbenutzer gewährt diesem genau die Zeilen, die auch dieser Accessor sieht. Es handelt sich nicht um einen privaten Kanal.

### 3. `getSql(c)` – SQL als Aufrufer

Wenn das SDK eine Abfrage oder einen Schreibvorgang nicht sauber abbilden kann – etwa ein bedingtes Upsert, ein Compare-and-Swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, ein CTE –, schreiben Sie das SQL und führen Sie es als Aufrufer aus:

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

Das Statement wird in der eigenen Transaktion des Aufrufers als eingeschränkte `rebase_user`-Rolle mit dessen Identität ausgeführt – dieselbe Transaktion, die der benutzerbezogene Driver öffnet –, sodass die `rls`-Regeln Ihrer Tabellen über jede Zeile entscheiden, genau wie beim SDK. Eine Abfrage, die alle Zeilen anfordert, erhält nur die des Aufrufers.

- **Standardmäßig schreibgeschützt (Read-only).** Übergeben Sie `{ write: true }`, um Datensätze einzufügen, zu aktualisieren oder zu löschen; die Insert- und Update-Richtlinien gelten weiterhin.
- **Der Abfragetext gehört Ihnen; Werte gehören in `params`** (`$1`, `$2`, …). Die Identität des Aufrufers befindet sich in Transaktionseinstellungen, die durch SQL geändert werden könnten. Daher wird jedes Statement, das dies tun könnte – `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mehr als ein Statement –, vor der Ausführung mit `400 SQL_NOT_ALLOWED` abgelehnt. Benutzereingaben in den Text zu interpolieren, würde diesen Schutzmechanismus herausfordern; tun Sie das nicht.
- **Was es mit dem SDK teilt.** Die Richtlinien und drei Regeln, die Postgres für beide durchsetzt: Eine [materialisierte View](/docs/collections/views/#materialized-views) liefert ihre Zeilen nur an ihre `roles` aus, eine Zeile einer Tabelle mit `tenant`-Deklaration kann nicht zu einem anderen Mandanten verschoben werden, außer durch einen `bypassRoles`-Aufrufer (`TENANT_IMMUTABLE`), und die servereigenen Funktionen (`rebase.record_history`, `rebase.enqueue_job`) werden verweigert. Eine Spalte, die der Aufrufer nicht lesen darf – `.private()` oder ein `.access({ read })`, das ihm fehlt –, wird aus den Zeilen entfernt, genau wie es die API tut, sofern es sich um eine einfache Referenz auf die Spalte handelt (`SELECT *`, `password_hash AS h`); ein daraus *berechneter* Wert (`md5(password_hash)`) wird nicht erkannt, berechnen Sie also nichts daraus.
- **Was es nicht teilt.** `beforeQuery` und `afterRead`, Validierung, Save-Hooks und Historie befinden sich in Node und werden nicht ausgeführt.

Aus einem Skript heraus bietet [`openRebase`](/docs/backend/embedding-postgres-driver/) dasselbe: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` – SQL als Service-Identität

Eine Funktion, die eigene Regeln (ein Ticket pro Tag, eine Zeitprüfung) über Tabellen durchsetzt, die nur Admins lesen dürfen, kann `getSql(c)` nicht verwenden: Der Aufrufer müsste über Richtlinien verfügen, die ihn zulassen, und dieselben Richtlinien würden die Tabellen auch in der öffentlichen Daten-API öffnen. `rebase.sqlAsAdmin` führt das Statement als `{ uid: "service", roles: ["admin"] }` aus – die Identität, die auch `rebase.dataAsAdmin` verwendet –, unter derselben Row-Level Security:

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

Es ist `getSql(c)` mit einer anderen Identität: die eingeschränkte Request-Rolle, der Admin-Zweig Ihrer Richtlinien, schreibgeschützt außer bei `{ write: true }` und derselbe `SQL_NOT_ALLOWED`-Schutz. Im Gegensatz zum Owner-basierten `rebase.sql()` kann es kein DDL ausführen, und vom Auth-Store erreicht es nur das, was ein Admin über die Users-Collection erreicht: Sitzungen, Schlüssel und MFA-Geheimnisse werden der Request-Rolle vorenthalten, und ein Passwort-Hash wird aus den Zeilen entfernt. Ein einzelnes Statement kostet einen Roundtrip, genau wie `rebase.sql()`. In einem Skript bietet `openRebase()` dies ebenfalls.

### 4. `rebase.sql()` – Owner-SQL und der einzige reine Node-Accessor

Wenn Sie wirklich eine bedingungslose Umgehung benötigen, ist `rebase.sql()` das Mittel der Wahl: Raw-SQL über die Owner-Verbindung, keine Richtlinien, alle Zeilen. Es ist das privilegierteste Element im Kontext einer Funktion – mehr noch als der Accessor mit „admin“ im Namen.

Es ist nicht dafür gedacht, Tabellen zu erstellen. Eine Tabelle wird mit `defineTable` in `backend/schema/` [deklariert](/docs/schema/) und beim Booten erstellt; eine Tabelle, die mit `CREATE TABLE` in einer Funktion erstellt wird, besitzt keine Validierung, keine Hooks, keine Row-Level-Security-Konfiguration, keine Admin-Ansicht und keinen SDK-Typ. `rebase.sql()` führt ein solches Statement zwar aus, gibt jedoch eine Warnung im Log aus, die den Namen der stattdessen zu deklarierenden Tabelle nennt.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Das verursacht bei keinem heutigen Deployment Nachteile – es ist lediglich der eine Aspekt, den man kennen sollte, falls eine Funktion später umgezogen wird. Siehe [Laufzeit-Portabilität](#laufzeit-portabilität).

:::caution[Direkter Drizzle-Zugriff ist nur für Node verfügbar]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder verwalteten Node-Deployment völlig in Ordnung.

Es lohnt sich jedoch zu wissen, welche Konsequenzen das hat: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine Node-Funktion; sie umgeht Ihre Tabellen-Hooks, die von `rebase.data` ausgeführt werden (keines von beiden prüft `.validate()`, was für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und bezieht ihre Verbindung von außerhalb der Anfrage. `rebase.sql()` bietet Ihnen dasselbe Raw-SQL über die frameworkeigene Verbindung, und `getSql(c)` stellt es Ihnen unter den Richtlinien des Aufrufers bereit. Bevorzugen Sie diese Optionen.
:::

## Konfiguration und Secrets

Lesen Sie Konfigurationen **innerhalb** des Handlers aus, niemals auf Modul-Ebene:

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

Ein Lesevorgang auf Modul-Ebene wird ausgewertet, wenn die Datei importiert wird – bevor eine Anfrage überhaupt existiert. Unter Node bedeutet dies, dass eine einzige fehlende Variable die gesamte Datei und jede darin enthaltene Route lahmlegt. Auf einem Host, der Konfigurationen an die Anfrage statt an den Prozess bindet, kann zum Importzeitpunkt überhaupt nichts ausgelesen werden.

- `getEnv(c)` — jede für diese Anfrage sichtbare Variable
- `env(c, "NAME")` — eine Variable, getrimmt; Leerzeichen gelten als nicht gesetzt
- `requireEnv(c, "NAME")` — dasselbe, wirft jedoch einen Fehler mit dem Namen der Variablen
- `lazyResource(factory)` — erstellt einen aufwendigen Client einmalig bei der ersten Verwendung

`rebase doctor` meldet `process.env`-Lesevorgänge auf Modul-Ebene in Ihrem functions-Verzeichnis.

## Hintergrundarbeit

Auf eine eigene Seite verschoben: [Hintergrundarbeit](/docs/backend/background-work/).

## Laufzeit-Portabilität

Eine benutzerdefinierte Funktion ist eine Hono-App. Ob sie außerhalb eines Node-Prozesses ausgeführt werden kann, hängt also davon ab, was ihre eigene Datei importiert. `rebase.sql()`, ein direkt importierter Datenbank-Client und Node-Built-ins binden sie an Node; der Rest von `rebase` und der Web-Plattform tun dies nicht, und keines von beiden führt heute zu Fehlern. Unter [Laufzeit-Portabilität](/docs/backend/runtime-portability/) ist aufgeführt, was portabel ist, wie `rebase build` und `rebase doctor` darüber berichten und wie man anhand der Runtime verzweigt.

## Reihenfolge der Routen-Registrierung

Benutzerdefinierte Funktionen werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` das Core-Setup abgeschlossen hat. Die Reihenfolge der Initialisierung ist:

1. **Bootstrapper** — Datenbankverbindungen, Auth-Tabellen, Echtzeit-Dienste
2. **Auth-Routen** — `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** — `/api/storage/*`
4. **Data-Routen** — `/api/data/*` (CRUD für Tabellen)
5. **Benutzerdefinierte Funktionen** ← `/api/functions/*`
6. **Cron-Jobs** — `/api/admin/cron/*`
7. **WebSocket** — Echtzeit-Abonnements

Das bedeutet, dass Ihre benutzerdefinierten Funktionen Zugriff auf alle initialisierten Dienste haben. Registrieren Sie Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App, bevor Sie `initializeRebaseBackend()` aufrufen:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie Ihrer eigenen App auf diese Weise hinzufügen, liegen **außerhalb** jedes Rebase-Routers, sodass für sie keine Auth-Middleware ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Sichern Sie diese mit `requireAuth` / `requireAdmin` ab, importiert aus **`@rebasepro/server`** – dem Paket-Root –, die das Token selbst verifizieren. Die Guards auf dem `/functions`-Subpfad lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt vorzutäuschen, dass eine existiert.
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

Beim Laden der Funktionen protokolliert der Boot-Vorgang `Loaded custom functions` mit deren Anzahl. Die Zeile jeder einzelnen Funktion wird unter `debug` (`LOG_LEVEL=debug`) protokolliert:

```
⚡ Loaded function route: hello
```

Wenn das Laden fehlschlägt, liefert der Loader Diagnoseausgaben:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Der Router wird für das **Verzeichnis** eingebunden, nicht für die darin enthaltenen Funktionen. Selbst wenn der Import jeder einzelnen Datei fehlschlägt – eine fehlende Umgebungsvariable auf Modul-Ebene reicht aus, um alle lahmzulegen –, antwortet `GET /api/functions` weiterhin mit `200` und einer leeren Liste sowie einem `skipped`-Zähler, sodass „nichts geladen“ von „dieser Build enthält keine Funktionen“ unterscheidbar ist. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Schlüssel mit dem einfachen `functions:invoke`-Scope oder den Service-Key – die Funktionen bleiben für diejenigen aufrufbar, die jede einzelne zulässt, aber das Verzeichnis der Funktionen ist nicht öffentlich. Die Gründe verbleiben im Boot-Log.

## Timeouts und Rate-Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** — Standardmäßig 30 Sekunden, antwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert es. Der Handler kann von außen nicht gestoppt werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504 abgebrochen, übergeben Sie es also an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Arbeit, der das Signal nicht übergeben wurde, läuft weiter – der Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses und keine vertragliche Garantie; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeit).
- **Rate-Limit** — Aufrufer mit API-Schlüssel und angemeldete Benutzer teilen sich die Buckets der Daten-API. Anonyme Aufrufer erhalten ein eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Überschreiben Sie dies mit `rateLimit.anonymousFunctions`; `null` schaltet es aus.

Nicht behandelte Promise-Rejections werden protokolliert und sind nicht fatal: Ein Fire-and-Forget-Aufruf in einer Funktion würde andernfalls den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` für das Standardverhalten von Node.

In Rebase Cloud hat der Edge-Layer vor Ihren Funktionen eigene Limits, und modulweiter Zustand, das Dateisystem sowie ausgehende Ports verhalten sich auf eine Weise, die man kennen sollte, bevor man seine Architektur darauf aufbaut. Siehe [Managed Backend-Runtime](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfigurationsreferenz
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
