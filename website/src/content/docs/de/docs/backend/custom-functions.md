---
sourceHash: bc87b4afd43a6b60
title: Custom Functions
sidebar_label: Custom Functions
description: Fügen Sie benutzerdefinierte Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatische Erkennung aus einem Verzeichnis, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit Custom Functions können Sie neben den automatisch generierten CRUD-Endpunkten von Rebase **beliebige Hono-API-Routen** hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Collections und Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihrem Verzeichnis `functions/` ab, und Rebase bindet sie automatisch ein.

Verwenden Sie Custom Functions für:

- **Endpunkte für Geschäftslogik** — Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Integrationen von Drittanbietern** — Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** — Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregierte Abfragen** — Dashboard-Statistiken, Berichte, Analysen

## Definieren einer Custom Function

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

`POST`, da das SDK dies standardmäßig sendet — siehe [Aufruf über den Client](#aufruf-über-den-client). Eine `GET`-Route ist genauso gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis, sodass eine Datei, die während der Ausführung hinzugefügt wird, beim nächsten Neuladen eingebunden wird — kein Neustart erforderlich. (Es muss mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

## Aufruf über den Client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` erstellt die URL, hängt das Token des Aufrufers an und wirft bei einem Nicht-2xx-Status einen `RebaseApiError` — sodass die Fehlerstruktur der Funktion selbst den Aufrufer erreicht, anstelle einer reinen `fetch`-Ablehnung.

Vier Parameter, die über den Namen hinaus akzeptiert werden:

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
`client.call("functions/hello", payload)` erreicht ebenfalls eine Funktion. Es verwendet immer `POST` und gibt wie `invoke` den Body unverändert zurück — keines von beiden greift nach einem `data`-Schlüssel. Bevorzugen Sie `functions.invoke`, das eine Methode, einen Unterpfad und einen `responseType` akzeptiert; `call` existiert für Routen, die außerhalb von `/api/functions` eingebunden sind, was `invoke` nicht abbilden kann.
:::

:::important
Importieren Sie aus **`@rebasepro/server/functions`**, nicht aus `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Authoring-Oberfläche: Er bindet nichts ein, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeit ausgeführt werden kann. Das Root-Paket bindet das gesamte Framework ein — den Boot-Ablauf, die Datei-Loader, den WebSocket-Layer —, was für einen Server-Einstiegspunkt richtig ist, aber mehr als ein Route-Handler benötigt. Zudem bietet es typisierte Kontext-Accessoren (`getUser`, `getDriver`), anstatt `c.get("user")` manuell casten zu müssen.

Den vollständigen Kontrakt finden Sie unter [Laufzeit-Portabilität](#laufzeit-portabilität).
:::

## Konfiguration

:::note[Wo dies hingehört]
**Verwaltete Laufzeit:** Keine Konfiguration erforderlich — die Laufzeit erkennt `backend/functions/` selbstständig (`functions` im Eintrag `rebase.json` der Backend-App, falls Sie es verschoben haben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein Prozess mit `REBASE_ROLE=functions` bereitstellt; jede andere Rolle verweigert den Start, wenn diese gesetzt sind.
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

Rebase führt Folgendes aus:

1. Scannt das Verzeichnis nach `.ts`- / `.js`-Dateien
2. Validiert, dass jeder Standard-Export eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Bindet jede App unter `/api/functions/<filename>` ein
4. Wendet die Auth-Middleware an (siehe [Authentifizierung](#authentifizierung-und-kontext-weitergabe) unten)

### Funktionen als Werte

Ein Verzeichnis ist eine Möglichkeit, das zu erzeugen, was der Server bereitstellt: ein Record von einem URL-Segment zu einer Hono-App. Übergeben Sie dieses Record selbst als `functions` oder lesen Sie ein Verzeichnis mit `loadFunctions` ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Geben Sie entweder `functions` oder `functionsDir` an, nicht beides: Der Boot-Vorgang verweigert die Kombination. `loadFunctions(dir, { onSkip })` übergibt Ihnen jede übersprungene Datei samt Grund. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet und geben einmalig eine Warnung aus. Für sich allein bindet sich die Functions-Gruppe mit `app.route("/hooks", backend.routes.functions())` an jedem beliebigen Pfad ein, und `getUser(c)` sowie `getDriver(c)` funktionieren darin; siehe [Eigene Server-Integration](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Mapping

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **ausschließlich auf der obersten Ebene des Verzeichnisses** erkannt — es gibt keine Rekursion. `functions/admin/users.ts` wird von `rebase build` kompiliert, aber nie eingebunden; flachen Sie stattdessen den Namen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Booten gemeldet und im Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` — reserviert
- `*.test.ts` / `*.test.js` — Testdateien
- `*.d.ts` — Typdeklarationen
- Unterverzeichnisse sowie `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien — werden als Probleme gemeldet, da der Build mehr kompiliert, als die Laufzeit lädt

Der Name ist auch überall sonst die Identität der Funktion: Er ist das URL-Segment, das Ziel des Scopes `functions:invoke:<name>`, den ein Schlüssel benötigt, um sie aufzurufen, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` filtert, wenn Sie einer Funktion einen eigenen Prozess zuweisen.

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

`defineFunction` gibt genau die Hono-App zurück, die diese manuell aufbauen, sodass die drei austauschbar sind. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und übergibt Ihnen das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

In einem Monorepo lösen Ihre Funktionen möglicherweise eine andere Kopie von Hono auf als die, die Rebase verwendet. Dann ist `exported instanceof Hono` für einen funktionierenden Router falsch. Daher prüft der Loader stattdessen die Struktur (`isHonoLike`): ein Non-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Modul-Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine Datei-URL um (`pathToFileURL(filePath).href`), sodass er unter Windows und POSIX gleichermaßen importiert wird, und ruft `import(url)` über `new Function("url", "return import(url)")` auf, damit ein TypeScript-Build ihn nicht in ein `require()` umschreiben kann, das unter ESM fehlschlägt.

---

## Authentifizierung und Kontext-Weitergabe

Custom Functions werden mit **derselben Auth-Middleware** wie die Datenrouten eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgewiesen**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die Authentifizierung benötigen, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht Ihren Handler nie: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend auf eine anonyme herabgestuft wird.

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

`getUser` gibt ein eingegrenztes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig davon, welche Authentifizierungsmethode der Aufrufer verwendet hat. `getUserId(c)` und `getRoles(c)` sind Shortcuts. `getScopes(c)` liefert alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die Scopes der App selbst und die Scopes ihrer Rollen; für einen API-Schlüssel genau das, was der Schlüssel enthält.

### Das Konto des Aufrufers

`getUser(c)` liest das Zugriffstoken, und das Token enthält die ID, die Rollen und die Adresse des Aufrufers. Es gibt keinen Aufschluss darüber, wie sich das Konto anmeldet oder wie sein Anzeigename lautet. `getUserProfile(c)` liest diese aus dem Auth-Store:

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

`providers` listet auf, wie sich das Konto anmelden kann: `"password"`, wenn es eines hat, und dann jeder verknüpfte Anbieter (`"google"`, `"apple"`, …) in der Reihenfolge, in der er verknüpft wurde. Ein Gastkonto oder ein Konto, das sich nur mit einem Einmalcode anmeldet, hat eine leere Liste.

Der Lesevorgang ist für jede Anfrage frisch: Ein Anbieter, den der Aufrufer vor Kurzem verknüpft hat, wird bei seiner nächsten Anfrage angezeigt, ohne auf die Aktualisierung des Tokens warten zu müssen. Der erste Aufruf in einer Anfrage erfordert zwei Lookups über Schlüssel, die zusammen ausgeführt werden. Spätere Aufrufe in derselben Anfrage verwenden das Ergebnis wieder, und eine Anfrage, die dies nie aufruft, verursacht keine Kosten.

Es gibt `undefined` für einen anonymen Aufrufer zurück, für einen Aufrufer mit Service- oder API-Schlüssel, der nicht als Konto fungiert, und für ein Konto, das nicht mehr existiert. Es gibt auch `undefined` auf einem Backend zurück, dessen Konten bei einem externen [Auth-Adapter](/docs/backend/auth-adapters/) liegen: Fragen Sie in diesem Fall diesen Anbieter ab. Wenn ein Administrator `x-rebase-impersonate` sendet, wird das imitierte Konto zurückgegeben.

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

Platzieren Sie Guards wie oben gezeigt im **eigenen Middleware-Slot der Route** anstatt über `app.use("/*", requireAuth)`. `use()` deckt nur die Routen ab, die *darunter* deklariert sind, sodass eine Route, die später hinzugefügt wird — am Ende der Datei, Monate später —, stillschweigend ungeschützt bliebe.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined` und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` lässt die Rolle `admin` zu und niemanden sonst. Für eine Aktion, die eine engere Rolle oder ein API-Schlüssel erreichen soll, sichern Sie die Route mit `requireScope` ab. Dies akzeptiert einen integrierten [Scope](/docs/backend/roles-and-scopes/) oder einen, den die App unter `auth.scopes` in der Users-Collection deklariert, wie etwa `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Jede angemeldete Person besitzt jeden App-Scope; für eine Person entscheidet `requireScope` also nichts: Prüfen Sie im Handler, ob diese Person dieses Projekt deployen darf. Was der Scope hinzufügt, ist eine Möglichkeit, **einen Schlüssel einzuschränken**: Ein Schlüssel mit `project:deploy:p1` ist nur für `p1` gültig. Ein Schlüssel benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App-Scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Authentifizierung per Service-Key

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in Ihrer `.env` für Skript- oder Server-zu-Server-Aufrufe definiert ist.

Wenn eine externe Anfrage den Service-Schlüssel über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, führt die Auth-Middleware automatisch Folgendes aus:
1. Validiert den Schlüssel mittels Constant-Time-Vergleich, um Timing-Angriffe zu verhindern.
2. Gewährt Zugriff auf Admin-Ebene und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität scoped ist. Row-Level Security gilt weiterhin — sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet, nicht übersprungen.

### Interne Selbst-Authentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Schlüssel pro Start**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch bei Aufrufen der Control-Plane-APIs des Servers (wie `rebase.auth` oder `rebase.storage`). Das bedeutet, dass Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Schlüssel immer administrative Aufgaben ausführen kann.

## Zugriff auf die Datenbank & Services

### 1. Der benutzerbezogene Driver – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Driver zurück, der **auf den Aufrufer scoped ist**, sodass jedes Lesen und Schreiben anhand Ihrer Row-Level-Security-Richtlinien als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` ist `getDriver(c)` ohne das `!` — es wirft eine Fehlermeldung, die das Wiring-Problem benennt, anstatt zwanzig Zeilen später bei `undefined` fehlzuschlagen.

<span class="since-badge" data-since="0.31">Seit 0.31</span> `fetchCollection` und `fetchOne` geben die Zeilen zurück, die auch `GET /api/data/<table>` zurückgibt: Datumsangaben als RFC 3339-Strings, ein `belongsTo` als dessen Fremdschlüssel (`authorId`), und eine verknüpfte Zeile nur, wenn `include` sie benennt — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

`rebase.dataAsAdmin` ist untypisiert, bis Sie Ihre [generierte `Database` registrieren](/docs/backend/typed-server-data).

### RLS-Scoped Driver vs. Rebase Singleton

|                     | `getDriver(c)` (anfragebezogen)                | `rebase.dataAsAdmin` (Service-Identität)                         |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Läuft als**       | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung**| ✅ Ja (ausgewertet gegen den Aufrufer)         | ✅ Ja (ausgewertet gegen die Service-Identität)                  |
| **Ideal für...**    | Allgemeine Benutzer-CRUD, Suche und Abfragen   | Hintergrundjobs, System-Trigger, Webhooks                        |
| **API-Stil**        | Methoden auf Driver-Ebene (`fetchCollection`, `save`) | Fluente Collection-Accessoren (`rebase.dataAsAdmin.jobs.find`) |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin-Ebene scoped, umgeht aber RLS nicht**. Der Driver wird einmalig beim Start mit `withAuth({ uid: "service", roles: ["admin"] })` scoped, sodass jedes Lesen und Schreiben innerhalb einer Transaktion ausgeführt wird, die zur eingeschränkten Rolle `rebase_user` mit `app.uid = 'service'` gewechselt hat. Ihre Richtlinien werden ausgewertet — gegen diese Identität.

Bei den meisten Projekten tritt dieser Unterschied nie zutage, da die Standardrichtlinien, die Rebase in jede Collection einfügt, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Teil erfüllt. Es wird in dem Moment relevant, in dem Sie eigene Richtlinien schreiben:

- **`policy.serverContext()` ist dafür falsch.** Dieser Helper kompiliert zu `rebase.uid() IS NULL`, und die `uid` dieses Accessors ist `'service'`. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Schreibregel `serverContext()` ist, verweigert ein `dataAsAdmin`-Schreiben mit dem Postgres-Fehler `42501`, und ein Lesevorgang auf einer solchen Collection gibt **null Zeilen mit HTTP 200** zurück — die stille Variante. Schreiben Sie `rolesOverlap(["admin"])` (oder fügen Sie es daneben hinzu), wenn Sie "mein Backend" meinen.
- **Seine Reichweite entspricht der Reichweite eines `admin`-Benutzers.** Die Vergabe der Rolle `admin` an einen Anwendungsbenutzer gewährt diesem genau die Zeilen, die dieser Accessor sieht. Es ist kein privater Kanal.

### 3. `getSql(c)` – SQL als Aufrufer

Wenn das SDK eine Abfrage oder einen Schreibvorgang nicht sauber abbildet — ein bedingtes Upsert, ein Compare-and-Swap-`UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, ein CTE —, schreiben Sie das SQL und führen Sie es als Aufrufer aus:

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

Das Statement wird in der eigenen Transaktion des Aufrufers ausgeführt, als die eingeschränkte Rolle `rebase_user` mit dessen Identität — die Transaktion, die der benutzerbezogene Driver öffnet —, sodass die Sicherheitsregeln Ihrer Collections über jede Zeile entscheiden, genau wie beim SDK. Eine Abfrage, die jede Zeile abfragt, erhält die des Aufrufers.

- **Standardmäßig schreibgeschützt.** Übergeben Sie `{ write: true }` zum Einfügen, Aktualisieren oder Löschen; die Insert- und Update-Richtlinien gelten weiterhin.
- **Der Abfragetext gehört Ihnen; Werte gehören in `params`** (`$1`, `$2`, …). Die Identität des Aufrufers liegt in den Transaktionseinstellungen, die SQL ändern kann. Ein Statement, das dies tun könnte — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mehr als ein Statement —, wird daher vor der Ausführung mit `400 SQL_NOT_ALLOWED` abgewiesen. Das Interpolieren von Benutzereingaben in den Text ist der Weg, wie dieser Guard getestet würde; tun Sie das nicht.
- **Was es mit dem SDK teilt.** Die Richtlinien sowie drei Regeln, die Postgres für beide durchsetzt: Eine [materialisierte View](/docs/collections/views/#materialized-views) liefert ihre Zeilen nur an ihre `roles` aus; eine Zeile einer Tabelle, die `tenant` deklariert, kann nicht zu einem anderen Mandanten verschoben werden, außer durch einen `bypassRoles`-Aufrufer (`TENANT_IMMUTABLE`); und die servereigenen Funktionen (`rebase.record_history`, `rebase.enqueue_job`) werden verweigert. Eine Spalte, die der Aufrufer nicht lesen darf — `.private()` oder ein fehlender `.access({ read })` —, wird aus den Zeilen entfernt, so wie die API sie entfernt, wenn es sich um einen einfachen Verweis auf die Spalte handelt (`SELECT *`, `password_hash AS h`); ein daraus *berechneter* Wert (`md5(password_hash)`) wird nicht erkannt, berechnen Sie also nichts daraus.
- **Was es nicht teilt.** `beforeQuery` und `afterRead`, Validierung, Save-Hooks und Historie liegen in Node und werden nicht ausgeführt.

Aus einem Skript heraus bietet [`openRebase`](/docs/backend/embedding-postgres-driver/) dasselbe: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` – SQL als Service-Identität

Eine Funktion, die eigene Regeln (ein Ticket pro Tag, eine Zeitprüfung) über Tabellen durchsetzt, die nur Admins lesen dürfen, kann `getSql(c)` nicht verwenden: Der Aufrufer bräuchte Richtlinien, die ihn zulassen, und dieselben Richtlinien würden die Tabellen auch auf der öffentlichen Daten-API öffnen. `rebase.sqlAsAdmin` führt das Statement als `{ uid: "service", roles: ["admin"] }` aus, dieselbe Identität, die `rebase.dataAsAdmin` verwendet, unter derselben Row-Level Security:

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

Es ist `getSql(c)` mit einer anderen Identität: die eingeschränkte Anfrage-Rolle, der Admin-Zweig Ihrer Richtlinien, schreibgeschützt außer bei `{ write: true }` und derselbe `SQL_NOT_ALLOWED`-Guard. Im Gegensatz zum `rebase.sql()` des Owners kann es kein DDL ausführen, und vom Auth-Store erreicht es nur das, was ein Admin über die Users-Collection erreicht: Sitzungen, Schlüssel und MFA-Geheimnisse werden der Anfrage-Rolle vorenthalten, und ein Passwort-Hash wird aus den Zeilen entfernt. Ein einzelnes Statement kostet einen Round-Trip, genau wie `rebase.sql()`. Aus einem Skript heraus verfügt `openRebase()` ebenfalls darüber.

### 4. `rebase.sql()` – Owner-SQL und der einzige reine Node-Accessor

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Sie wirklich eine bedingungslose Umgehung benötigen, ist `rebase.sql()` das Mittel der Wahl: Raw-SQL über die Verbindung des Owners, keine Richtlinien, jede Zeile. Es ist das am stärksten privilegierte Element im Kontext einer Funktion — mehr noch als der Accessor mit "admin" im Namen.

Es ist nicht zum Erstellen von Tabellen gedacht. Eine Tabelle wird mit `defineTable` in `backend/schema/` [deklariert](/docs/schema/) und beim Booten erstellt; eine Tabelle, die mit `CREATE TABLE` in einer Funktion erstellt wird, hat keine Validierung, Hooks, Row-Level-Security-Konfiguration, Admin-Ansicht oder SDK-Typisierung. `rebase.sql()` führt ein solches Statement aus und protokolliert eine Warnung, die die stattdessen zu deklarierende Tabelle benennt.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Das kostet bei keinem heute existierenden Deployment etwas — es ist schlicht die eine Sache, die man wissen sollte, falls eine Funktion später umgezogen werden soll. Siehe [Laufzeit-Portabilität](#laufzeit-portabilität).

:::caution[Direkter Drizzle-Zugriff ist nur unter Node möglich]
Sie können auch Ihre eigene Drizzle-Instanz importieren und sie direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist bei einem selbst gehosteten oder verwalteten Node-Deployment in Ordnung.

Es lohnt sich zu wissen, was es kostet: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, ist dauerhaft eine Node-Funktion; sie umgeht Ihre Tabellen-Hooks, die `rebase.data` ausführt (keines von beiden prüft `.validate()`, was für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und sie bezieht ihre Verbindung von woanders als der Anfrage. `rebase.sql()` bietet Ihnen dasselbe Raw-SQL über die frameworkeigene Verbindung, und `getSql(c)` bietet es Ihnen unter den Richtlinien des Aufrufers. Bevorzugen Sie diese.
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

Warum dies auf **jeder** Laufzeit wichtig ist, einschließlich Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Ein Lesevorgang auf Modulebene wird ausgewertet, wenn die Datei importiert wird, bevor eine Anfrage existiert. Unter Node bedeutet dies, dass eine einzelne fehlende Variable die gesamte Datei und jede Route darin lahmlegt. Auf einem Host, der die Konfiguration an die Anfrage statt an den Prozess bindet, gibt es zur Importzeit überhaupt nichts auszulesen.

- `getEnv(c)` — jede für diese Anfrage sichtbare Variable
- `env(c, "NAME")` — eine Variable, getrimmt; leer gilt als nicht gesetzt
- `requireEnv(c, "NAME")` — dasselbe, wirft jedoch eine Fehlermeldung mit dem Namen der Variable
- `lazyResource(factory)` — erstellt einen aufwendigen Client einmalig bei der ersten Verwendung

`rebase doctor` meldet `process.env`-Lesevorgänge auf Modulebene in Ihrem functions-Verzeichnis.

## Hintergrundarbeiten

Verschoben auf eine eigene Seite: [Hintergrundarbeiten](/docs/backend/background-work/).

## Laufzeit-Portabilität

Eine Custom Function ist eine Hono-App. Ob sie woanders als in einem Node-Prozess laufen kann, hängt also davon ab, was ihre eigene Datei importiert. `rebase.sql()`, ein direkt importierter Datenbank-Client und Node-Built-ins binden sie an Node; der Rest von `rebase` und die Web-Plattform tun dies nicht, und heute schlägt nichts wegen eines von beiden fehl. Unter [Laufzeit-Portabilität](/docs/backend/runtime-portability/) wird aufgeführt, was portabel ist, wie `rebase build` und `rebase doctor` dies melden und wie Sie je nach Laufzeit verzweigen können.

## Reihenfolge der Routen-Registrierung

Custom Functions werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` das Kern-Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** — Datenbankverbindungen, Auth-Tabellen, Realtime-Services
2. **Auth-Routen** — `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** — `/api/storage/*`
4. **Daten-Routen** — `/api/data/*` (CRUD für Collections)
5. **Custom Functions** ← `/api/functions/*`
6. **Cron-Jobs** — `/api/admin/cron/*`
7. **WebSocket** — Realtime-Abonnements

Das bedeutet, dass Ihre Custom Functions Zugriff auf alle initialisierten Services haben. Registrieren Sie Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App vor dem Aufruf von `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie Ihrer eigenen App auf diese Weise hinzufügen, liegen **außerhalb** jedes Rebase-Routers, sodass keine Auth-Middleware auf ihnen ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Schützen Sie diese mit `requireAuth` / `requireAdmin`, importiert aus **`@rebasepro/server`** — dem Root-Paket —, welche das Token selbst verifizieren. Die Guards auf dem `/functions`-Subpfad lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt vorzugeben, dass eine existiert.
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

Beim Laden der Funktionen protokolliert der Boot-Vorgang `Loaded custom functions` mit deren Anzahl. Die Zeile jeder einzelnen Funktion wird unter `debug` protokolliert (`LOG_LEVEL=debug`):

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

Der Router wird für das **Verzeichnis** eingebunden, nicht für die darin enthaltenen Funktionen. Selbst wenn der Import jeder Datei fehlschlägt — eine einzige fehlende Umgebungsvariable auf Modulebene reicht aus, um alle lahmzulegen —, antwortet `GET /api/functions` weiterhin mit `200` mit einer leeren Liste plus einer `skipped`-Anzahl, sodass "nichts geladen" von "dieser Build enthielt keine Funktionen" unterscheidbar ist. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Schlüssel mit dem einfachen Scope `functions:invoke` oder den Service-Schlüssel — die Funktionen bleiben für jeden aufrufbar, den die jeweilige Funktion zulässt, das Verzeichnis aller Funktionen ist jedoch nicht öffentlich. Die Gründe verbleiben im Boot-Log.

## Timeouts und Rate-Limits

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Request-Timeout** — standardmäßig 30 Sekunden, antwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar mit `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert es. Der Handler kann nicht von außen gestoppt werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504 abgebrochen; übergeben Sie es also an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Arbeiten, denen das Signal nicht übergeben wurde, laufen weiter — das Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses, keine Garantie des Kontrakts; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeiten).
- **Rate-Limit** — Aufrufer mit API-Schlüssel und angemeldete Aufrufer teilen sich die Buckets der Daten-API. Anonyme Aufrufer erhalten ihr eigenes, viel großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Überschreiben Sie dies mit `rateLimit.anonymousFunctions`; `null` schaltet es ab.

Nicht behandelte Promise-Rejections werden protokolliert und sind nicht fatal: Ein Fire-and-Forget-Aufruf in einer Funktion würde andernfalls den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` für das Standardverhalten von Node.

In Rebase Cloud gelten für die Edge vor Ihren Funktionen eigene Limits, und modulweiter Zustand, das Dateisystem sowie ausgehende Ports verhalten sich auf eine Weise, die man vor dem Entwurf kennen sollte. Siehe [Managed Backend Runtime](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfigurationsreferenz
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
