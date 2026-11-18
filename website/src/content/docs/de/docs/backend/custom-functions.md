---
sourceHash: 03f5153ebeb46a08
title: Benutzerdefinierte Funktionen
sidebar_label: Benutzerdefinierte Funktionen
description: Fügen Sie benutzerdefinierte Hono-API-Endpunkte neben Ihren Rebase-CRUD-Routen hinzu. Automatisch aus einem Verzeichnis erkannt, mit vollem Zugriff auf die Backend-Instanz.
---

## Übersicht

Mit benutzerdefinierten Funktionen (Custom Functions) können Sie **beliebige Hono-API-Routen** neben den automatisch generierten CRUD-Endpunkten von Rebase hinzufügen. Sie folgen demselben Muster der **dateibasierten Erkennung** wie Cron-Jobs: Legen Sie eine TypeScript-Datei in Ihrem `functions/`-Verzeichnis ab, und Rebase bindet sie automatisch ein.

Verwenden Sie benutzerdefinierte Funktionen für:

- **Endpunkte für Geschäftslogik** – Genehmigungen, Werbeaktionen, benutzerdefinierte Workflows
- **Drittanbieter-Integrationen** – Stripe-Webhooks, Slack-Befehle, externe API-Proxys
- **Öffentliche Endpunkte** – Kontaktformulare, Lead-Erfassung, Health-Checks
- **Aggregierte Abfragen** – Dashboard-Statistiken, Berichte, Analysen

## Definieren einer benutzerdefinierten Funktion

Erstellen Sie eine Datei in Ihrem `backend/functions/`-Verzeichnis, die als Default-Export eine Hono-App bereitstellt:

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

`POST`, da das SDK dies standardmäßig sendet – siehe [Aufruf über den Client](#aufruf-über-den-client). Eine `GET`-Route ist genauso gültig; der Aufrufer muss dann `{ method: "GET" }` angeben.

`rebase dev` überwacht das functions-Verzeichnis. Eine Datei, die hinzugefügt wird, während es läuft, wird beim nächsten Neuladen eingebunden – kein Neustart erforderlich. (Es muss darauf hingewiesen werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

## Aufruf über den Client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // der Dateiname ohne Erweiterung – ein Pfadsegment
    { name: "Ada" }          // JSON-Body; bei einem GET weggelassen
);
```

`invoke` baut die URL auf, hängt das Token des Aufrufers an und wirft bei Nicht-2xx-Statuscodes einen `RebaseApiError` – sodass das eigene Fehlerformat der Funktion beim Aufrufer ankommt, anstelle einer einfachen `fetch`-Rejection.

Vier Dinge, die neben dem Namen übergeben werden können:

```typescript
// Eine andere Methode. Bei GET wird der Payload verworfen, da GET keinen Body hat.
await client.functions.invoke("hello", undefined, { method: "GET" });

// Ein Sub-Pfad – `/api/functions/hello/stats`. Gehört hierhin, niemals in den Namen:
// Ein Name, der "/" enthält, wird abgewiesen, statt per Prozentkodierung zu einem 404 zu führen.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// Ein Query-String. Wird als `path` übergeben, ohne dass vor `?` ein Trennzeichen eingefügt wird.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// Eine Funktion, die Text oder eine Datei zurückgibt (`c.text(csv)`, `c.body(pdf)`).
// Die Antwort wird standardmäßig als JSON gelesen, sofern nicht anders angegeben: "text" liefert einen String,
// "blob" ein Blob, "response" das Response-Objekt selbst mit ungelesenem Body.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` erreicht eine Funktion ebenfalls. Es sendet immer per `POST` und gibt wie `invoke` den Body unverändert zurück – keines von beiden greift explizit auf einen `data`-Schlüssel zu. Bevorzugen Sie `functions.invoke`, welches eine Methode, einen Sub-Pfad und einen `responseType` akzeptiert; `call` existiert für Routen, die außerhalb von `/api/functions` eingebunden sind, was `invoke` nicht abbilden kann.
:::

:::important
Importieren Sie von **`@rebasepro/server/functions`**, nicht von `@rebasepro/server`.

Beides funktioniert. Der Subpfad ist die *portable* Authoring-Oberfläche: Er zieht nichts herein, was Node erfordert, sodass eine dagegen geschriebene Funktion auf jeder JavaScript-Laufzeitumgebung ausgeführt werden kann. Das Paket-Root greift auf das gesamte Framework zu – die Boot-Sequenz, die Datei-Loader, den WebSocket-Layer –, was für einen Server-Einstiegspunkt richtig ist, aber mehr darstellt, als ein Route-Handler benötigt. Außerdem erhalten Sie typisierte Kontext-Zugriffsfunktionen (`getUser`, `getDriver`), anstatt `c.get("user")` manuell zu casten.

Siehe [Portabilität der Laufzeitumgebung](#portabilität-der-laufzeitumgebung) für den vollständigen Vertrag.
:::

## Konfiguration

:::note[Wo dies konfiguriert wird]
**Verwaltete Laufzeitumgebung (Managed Runtime):** Nichts zu konfigurieren – die Laufzeitumgebung erkennt `backend/functions/` automatisch (`functions` im `rebase.json`-Eintrag der Backend-App, falls Sie es verschoben haben). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` schränken ein, welche Funktionen ein `REBASE_ROLE=functions`-Prozess bereitstellt; jede andere Rolle verweigert den Start, wenn diese gesetzt sind.
**Ejected:** `initializeRebaseBackend({ functionsDir })` oder `functions` (unten) in `backend/src/index.ts`.
:::

Aktivieren Sie benutzerdefinierte Funktionen, indem Sie `functionsDir` zu Ihrer Backend-Konfiguration hinzufügen:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... sonstige Konfiguration
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase wird:

1. Das Verzeichnis nach `.ts`- / `.js`-Dateien durchsuchen
2. Validieren, dass jeder Default-Export eine Hono-App ist (Duck-Typing über `.fetch()` + `.routes`)
3. Jede App unter `/api/functions/<dateiname>` einbinden
4. Die Auth-Middleware anwenden (siehe [Authentifizierung](#authentifizierung-und-kontextweitergabe) unten)

### Funktionen als Werte

Ein Verzeichnis ist eine Möglichkeit, das zu erzeugen, was der Server bereitstellt: ein Record von URL-Segmenten zu Hono-Apps. Übergeben Sie diesen Record selbst als `functions` oder lesen Sie ein Verzeichnis mit `loadFunctions` ein:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// das Gleiche wie functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Geben Sie entweder `functions` oder `functionsDir` an, nicht beides: Der Boot-Vorgang verweigert die Kombination. `loadFunctions(dir, { onSkip })` übergibt Ihnen jede übersprungene Datei samt Grund. `loadFunctionsFromDirectory` und `loadFunctionsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet (deprecated) und geben eine einmalige Warnung aus. Für sich genommen kann die Funktionsgruppe an jedem beliebigen Pfad mit `app.route("/hooks", backend.routes.functions())` eingebunden werden, und `getUser(c)` sowie `getDriver(c)` funktionieren darin; siehe [Integration in benutzerdefinierte Server](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Dateibenennung und Routen-Mapping

| Datei | Mount-Pfad |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Funktionen werden **nur auf oberster Ebene des Verzeichnisses** erkannt – es gibt keine Rekursion. `functions/admin/users.ts` wird zwar von `rebase build` kompiliert, aber niemals eingebunden; flachen Sie stattdessen den Namen ab (`functions/admin-users.ts`). Ein Unterverzeichnis wird beim Start gemeldet und auf dem Listing-Endpunkt gezählt, anstatt stillschweigend ignoriert zu werden.

Dateien, die **übersprungen** werden:

- `index.ts` / `index.js` – reserviert
- `*.test.ts` / `*.test.js` – Testdateien
- `*.d.ts` – Typdeklarationen
- Unterverzeichnisse sowie `.mts`- / `.cts`- / `.tsx`- / `.jsx`- / `.mjs`- / `.cjs`-Dateien – werden als Probleme gemeldet, da der Build mehr kompiliert, als die Laufzeitumgebung lädt

Der Name ist auch an allen anderen Stellen die Identität der Funktion: Er ist das URL-Segment, das Ziel des Scopes `functions:invoke:<name>`, den ein Schlüssel benötigt, um sie aufzurufen, und der Wert, nach dem `REBASE_FUNCTIONS_ONLY` auswählt, wenn Sie einer Funktion einen eigenen Prozess zuweisen.

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

`defineFunction` gibt genau die Hono-App zurück, die diese manuell aufbauen, sodass die drei Varianten austauschbar sind. Es erspart Ihnen die Deklaration von `Hono<HonoEnv>` und übergibt Ihnen das `rebase`-Singleton im Callback.

---

## Unter der Haube: Der Duck-Typing-Loader

In einem Monorepo lösen Ihre Funktionen möglicherweise eine andere Kopie von Hono auf als die, die Rebase verwendet, wodurch `exported instanceof Hono` bei einem funktionierenden Router `false` ergeben würde. Daher prüft der Loader stattdessen die Form (`isHonoLike`): ein Nicht-Null-Objekt mit einer `.fetch`-Methode und einem `.routes`-Array.

### ES-Modul-Compiler-Escape

Der Loader wandelt jeden Dateipfad in eine Datei-URL um (`pathToFileURL(filePath).href`), sodass der Import unter Windows und POSIX gleichermaßen funktioniert, und ruft `import(url)` über `new Function("url", "return import(url)")` auf, damit ein TypeScript-Build ihn nicht in ein `require()` umschreibt, das unter ESM fehlschlägt.

---

## Authentifizierung und Kontextweitergabe

Benutzerdefinierte Funktionen werden mit **derselben Auth-Middleware** wie die Daten-Routen eingebunden, jedoch mit `requireAuth: false`. Das bedeutet:

- Das JWT des Benutzers wird **geparst und injiziert**, sofern vorhanden
- Anfragen werden jedoch **nicht abgewiesen**, wenn kein JWT bereitgestellt wird
- Sie müssen Routen, die Authentifizierung erfordern, **explizit schützen**

Ein Aufrufer, der ein *ungültiges* Token vorlegt, erreicht Ihren Handler nie: Ein nicht verifizierbares oder abgelaufenes Token wird von der Middleware selbst mit 401 abgelehnt, sodass eine abgelaufene Sitzung niemals stillschweigend auf eine anonyme herabgestuft wird.

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

`getUser` gibt ein eingegrenztes Objekt zurück: `uid` ist ein String und `roles` ist immer ein Array, unabhängig davon, welche Authentifizierungsmethode der Aufrufer verwendet hat. `getUserId(c)` und `getRoles(c)` sind Kurzformen. `getScopes(c)` liefert alles, was der Aufrufer tun darf, als [Scope](/docs/backend/roles-and-scopes/)-Strings: für eine Person die Datenebene, die anwendungseigenen Scopes und die Scopes ihrer Rollen; für einen API-Schlüssel genau das, was der Schlüssel enthält.

### Das Konto des Aufrufers

`getUser(c)` liest das Access-Token aus, und das Token enthält die ID, die Rollen und die Adresse des Aufrufers. Es gibt keine Auskunft darüber, wie sich das Konto anmeldet oder wie sein Anzeigename lautet. `getUserProfile(c)` liest diese Angaben aus dem Auth-Store:

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

`providers` listet auf, wie sich das Konto anmelden kann: `"password"`, wenn es eines besitzt, gefolgt von jedem verknüpften Provider (`"google"`, `"apple"`, …) in der Reihenfolge der Verknüpfung. Ein Gastkonto oder ein Konto, das sich nur mit einem Einmalcode anmeldet, hat eine leere Liste.

Der Lesevorgang ist für jede Anfrage aktuell: Ein Provider, den der Aufrufer vor einem Moment verknüpft hat, wird bei seiner nächsten Anfrage angezeigt, ohne auf eine Aktualisierung des Tokens warten zu müssen. Der erste Aufruf innerhalb einer Anfrage kostet zwei schlüsselbasierte Lookups, die zusammen ausgeführt werden. Spätere Aufrufe in derselben Anfrage verwenden das Ergebnis wieder, und eine Anfrage, die dies nie aufruft, kostet nichts.

Es gibt `undefined` zurück für anonyme Aufrufer, für Service-Key- oder API-Key-Aufrufer, die keinem Konto entsprechen, und für Konten, die nicht mehr existieren. Es gibt ebenfalls `undefined` auf einem Backend zurück, dessen Konten bei einem externen [Auth-Adapter](/docs/backend/auth-adapters/) liegen: Fragen Sie in diesem Fall diesen Provider an. Wenn ein Administrator `x-rebase-impersonate` sendet, wird das imitierte Konto zurückgegeben.

### Routen schützen

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Öffentlicher Endpunkt – kein Guard, jeder kann ihn aufrufen.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 für anonyme Aufrufer.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonym, 403 ohne Admin-Rolle. Die Reihenfolge ist wichtig.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Jede der genannten Rollen.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Platzieren Sie Guards im **eigenen Middleware-Slot der Route**, wie oben gezeigt, statt `app.use("/*", requireAuth)`. `use()` deckt nur die Routen ab, die *darunter* deklariert sind; eine Route, die später hinzugefügt wird – ganz unten in der Datei, Monate später –, bliebe sonst unbemerkt ungeschützt.

:::important
Das Auslesen von `getUser(c)` ist **kein** Guard. Ein anonymer Aufrufer erhält `undefined`, und Ihr Handler wird trotzdem ausgeführt. Nur ein Guard oder ein explizites `if (!user) return 401` stoppt die Anfrage.
:::

### Scopes und App-Scopes

`requireAdmin` gewährt nur der Rolle `admin` Zugriff und sonst niemandem. Für eine Aktion, die eine spezifischere Rolle oder ein API-Schlüssel erreichen soll, sichern Sie die Route mit `requireScope` ab. Dies akzeptiert einen integrierten [Scope](/docs/backend/roles-and-scopes/) oder einen, den die Anwendung unter `auth.scopes` in der users-Collection deklariert, wie etwa `"project:deploy": { label: "Deploy projects", target: "project" }`:

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING, es sei denn, der Aufrufer besitzt project:deploy oder project:deploy:<dieses Projekt>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // Dieselbe Abfrage innerhalb eines Handlers.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Jede angemeldete Person besitzt jeden App-Scope; für eine Person entscheidet `requireScope` also nichts: Prüfen Sie im Handler, ob diese Person dieses Projekt deployen darf. Was der Scope hinzufügt, ist eine Möglichkeit, **einen Schlüssel einzuschränken**: Ein Schlüssel mit `project:deploy:p1` ist nur für `p1` gültig. Ein Schlüssel benötigt außerdem `functions:invoke` oder `functions:invoke:<name>`, bevor er die Funktion überhaupt erreicht. Siehe [App-Scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Ratenbegrenzungen (Rate Limits)

Eine Route, die pro Aufruf Ressourcen verbraucht, verwendet die `rateLimit`-Middleware, die über Replikate hinweg zählt. Siehe [Ratenbegrenzungen in Funktionen](/docs/backend/function-rate-limits/).

### Authentifizierung über Service-Keys

Rebase unterstützt einen statischen `REBASE_SERVICE_KEY`, der in Ihrer `.env` für Skripte oder Server-zu-Server-Aufrufe definiert wird.

Wenn eine externe Anfrage den Service-Key über den Authorization-Header (`Authorization: Bearer <service_key>`) übergibt, führt die Auth-Middleware automatisch Folgendes aus:
1. Validiert den Schlüssel mittels zeitkonstantem Vergleich (constant-time comparison), um Timing-Angriffe zu verhindern.
2. Gewährt Zugriff auf Admin-Ebene und setzt den Aufrufer auf `{ uid: "service", roles: ["admin"] }`.
3. Injiziert einen `DataDriver`, der auf dieselbe Service-Identität beschränkt ist. Row-Level Security gilt weiterhin – sie wird als `{ uid: "service", roles: ["admin"] }` ausgewertet und nicht übersprungen.

### Interne Selbstauthentifizierung

Wenn Sie keinen `REBASE_SERVICE_KEY` konfiguriert haben, generiert Rebase einen zufälligen **internen Schlüssel pro Start**. Das `rebase`-Singleton verwendet diesen Schlüssel automatisch bei Aufrufen der servereigenen Control-Plane-APIs (wie `rebase.auth` oder `rebase.storage`). Das bedeutet, dass Ihre serverseitige Logik auch ohne manuell konfigurierten Service-Key stets administrative Aufgaben ausführen kann.

## Zugriff auf Datenbank & Services

### 1. Der benutzerspezifische Treiber – für alles, was eine Anfrage bedient

`getDriver(c)` gibt den Treiber zurück, der **auf den Aufrufer beschränkt** ist, sodass jeder Lese- und Schreibvorgang anhand Ihrer Row-Level-Security-Richtlinien als dieser Benutzer ausgewertet wird:

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

`requireDriver(c)` entspricht `getDriver(c)` ohne das `!` – es wirft einen Fehler mit einer Meldung, die das Verdrahtungsproblem benennt, anstatt zwanzig Zeilen später an einem `undefined` zu scheitern.

`fetchCollection` und `fetchOne` geben die Zeilen zurück, die auch `GET /api/data/<table>` zurückgibt: Daten als RFC-3339-Strings, ein `belongsTo` als Fremdschlüssel (`authorId`) und eine zugehörige Zeile nur dann, wenn `include` sie benennt – `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

### RLS-bezogener Treiber vs. Rebase-Singleton

|                     | `getDriver(c)` (anfragebezogen)                | `rebase.dataAsAdmin` (Service-Identität)                         |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Ausführung als**  | Der Aufrufer (`uid`, dessen Rollen)            | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS-Durchsetzung**| ✅ Ja (wird gegen den Aufrufer ausgewertet)    | ✅ Ja (wird gegen die Service-Identität ausgewertet)             |
| **Ideal für...**    | Allgemeine Benutzer-CRUD, Suche und Abfragen   | Hintergrund-Jobs, System-Trigger, Webhooks                       |
| **API-Stil**        | Treiber-Methoden (`fetchCollection`, `save`)   | Fluente Tabellen-Accessoren (`rebase.dataAsAdmin.jobs.find`)     |

#### Was `dataAsAdmin` genau ist

`rebase.dataAsAdmin` ist **auf Admin-Rechte beschränkt, umgeht aber RLS nicht**. Der Treiber wird einmalig beim Start mit `withAuth({ uid: "service", roles: ["admin"] })` initialisiert, sodass jeder Lese- und Schreibvorgang innerhalb einer Transaktion ausgeführt wird, die mit `app.uid = 'service'` in die eingeschränkte `rebase_user`-Rolle gewechselt hat. Ihre Richtlinien werden ausgewertet – und zwar gegen diese Identität.

Bei den meisten Projekten fällt dieser Unterschied nie auf, da die Standardrichtlinien, die Rebase für jede Tabelle injiziert, `serverContext() OR rolesOverlap(['admin'])` zulassen und die Service-Identität den zweiten Zweig erfüllt. Er wird jedoch in dem Moment relevant, in dem Sie eigene Richtlinien schreiben:

- **`policy.serverContext()` ist dafür false.** Dieser Helper wird zu `rebase.uid() IS NULL` kompiliert, und die `uid` dieses Accessors ist `'service'`. Eine Tabelle mit `defaultPolicies: false`, deren einzige Schreibregel `serverContext()` ist, verweigert einen Schreibvorgang über `dataAsAdmin` mit dem Postgres-Fehler `42501`, und ein Lesevorgang auf einer solchen Tabelle liefert **null Zeilen mit HTTP 200** zurück – das stille Verhalten. Schreiben Sie `rolesOverlap(["admin"])` (oder fügen Sie es hinzu), wenn Sie "mein Backend" meinen.
- **Seine Reichweite entspricht der Reichweite eines `admin`-Benutzers.** Wenn Sie einem Anwendungsbenutzer die Rolle `admin` zuweisen, erhält dieser Zugriff auf genau dieselben Zeilen, die dieser Accessor sieht. Es handelt sich nicht um einen privaten Kanal.

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
Die Werte entsprechen denen von Postgres, wobei zwei wie von `/api/data` formatiert werden: Ein `timestamptz` ist RFC 3339 in UTC (`2026-11-18T10:52:23.500Z`), und ein `bigint` ist eine Zahl, wenn er in einen sicheren Integer passt (jenseits von 2^53 bleibt er als Ziffernfolge ein String). Ein `numeric` ist ein String, damit keine Ziffer verloren geht; casten Sie ihn in der Abfrage (`total::float8`), wenn Sie eine Zahl benötigen.

Das Statement wird in der eigenen Transaktion des Aufrufers ausgeführt, als eingeschränkte `rebase_user`-Rolle mit dessen Identität – dieselbe Transaktion, die der benutzerspezifische Treiber öffnet. Die `rls`-Regeln Ihrer Tabellen entscheiden also über jede Zeile, genau wie beim SDK. Eine Abfrage, die alle Zeilen anfordert, erhält nur die des Aufrufers.

- **Standardmäßig schreibgeschützt (Read-only).** Übergeben Sie `{ write: true }`, um Datensätze einzufügen, zu aktualisieren oder zu löschen; die Insert- und Update-Richtlinien gelten weiterhin.
- **Der Abfragetext gehört Ihnen; Werte gehören in `params`** (`$1`, `$2`, …). Die Identität des Aufrufers liegt in den Transaktionseinstellungen, die per SQL geändert werden könnten. Ein Statement, das dies tun könnte – `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mehr als ein Statement –, wird vor der Ausführung mit `400 SQL_NOT_ALLOWED` abgewiesen. Das Interpolieren von Benutzereingaben in den Text würde diesen Schutzmechanismus auf die Probe stellen; tun Sie das nicht.
- **Was es mit dem SDK teilt.** Die Richtlinien und drei Regeln, die Postgres für beide durchsetzt: Eine [materialisierte View](/docs/collections/views/#materialized-views) liefert ihre Zeilen nur an ihre `roles` aus, eine Zeile einer Tabelle mit `tenant`-Deklaration kann nicht ohne einen `bypassRoles`-Aufrufer zu einem anderen Mandanten verschoben werden (`TENANT_IMMUTABLE`), und servereigene Funktionen (`rebase.record_history`, `rebase.enqueue_job`) werden abgewiesen. Eine Spalte, die der Aufrufer nicht lesen darf – `.private()` oder ein fehlendes `.access({ read })` –, wird aus den Zeilen entfernt, so wie die API sie entfernt, sofern es sich um eine direkte Referenz auf die Spalte handelt (`SELECT *`, `password_hash AS h`). Ein daraus *berechneter* Wert (`md5(password_hash)`) wird nicht erkannt, berechnen Sie also nichts daraus.
- **Was es nicht teilt.** `beforeQuery` und `afterRead`, Validierung, Save-Hooks und die Versionshistorie liegen in Node und werden nicht ausgeführt.

In einem Skript bietet Ihnen [`openRebase`](/docs/backend/embedding-postgres-driver/) dasselbe: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` – SQL als Service-Identität

Eine Funktion, die eigene Regeln durchsetzt (ein Ticket pro Tag, eine Zeitprüfung) über Tabellen, die nur Admins lesen dürfen, kann `getSql(c)` nicht nutzen: Der Aufrufer bräuchte Richtlinien, die ihn zulassen, und dieselben Richtlinien würden die Tabellen auch in der öffentlichen Daten-API öffnen. `rebase.sqlAsAdmin` führt das Statement als `{ uid: "service", roles: ["admin"] }` aus – dieselbe Identität, die `rebase.dataAsAdmin` verwendet –, unter derselben Row-Level Security:

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

Es ist `getSql(c)` mit einer anderen Identität: die eingeschränkte Anfrage-Rolle, der Admin-Zweig Ihrer Richtlinien, schreibgeschützt außer bei `{ write: true }` und derselbe `SQL_NOT_ALLOWED`-Schutz. Im Gegensatz zu `rebase.sql()` des Owners kann es kein DDL ausführen, und vom Auth-Store erreicht es nur das, was ein Admin über die users-Collection erreicht: Sitzungen, Schlüssel und MFA-Geheimnisse werden der Anfrage-Rolle vorenthalten, und ein Passwort-Hash wird aus den Zeilen entfernt. Ein einzelnes Statement kostet einen Roundtrip, genau wie `rebase.sql()`. In einem Skript stellt `openRebase()` dies ebenfalls bereit.

### 4. `rebase.sql()` – Owner-SQL und der einzige reine Node-Accessor

Wenn Sie wirklich eine bedingungslose Umgehung benötigen, ist `rebase.sql()` das Mittel der Wahl: rohes SQL über die Owner-Verbindung, keine Richtlinien, alle Zeilen. Es ist das am stärksten privilegierte Element im Kontext einer Funktion – mehr noch als der Accessor mit "admin" im Namen.

Es ist nicht zum Erstellen von Tabellen gedacht. Eine Tabelle wird mit `defineTable` in `backend/schema/` [deklariert](/docs/schema/) und beim Booten erstellt; eine Tabelle, die mit `CREATE TABLE` in einer Funktion angelegt wird, besitzt keine Validierung, keine Hooks, keine Row-Level-Security-Konfiguration, keine Admin-Ansicht und keinen SDK-Typ. `rebase.sql()` führt ein solches Statement aus und gibt eine Warnung im Log aus, die die stattdessen zu deklarierende Tabelle benennt.

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

Es läuft über eine TCP-Verbindung zu Ihrer Datenbank, was es zum einzigen Accessor macht, der an einen Node-Prozess gebunden ist. Bei allen heute existierenden Bereitstellungen verursacht das keine Nachteile – es ist lediglich der eine Punkt, den man wissen muss, falls eine Funktion später portiert werden soll. Siehe [Portabilität der Laufzeitumgebung](#portabilität-der-laufzeitumgebung).

:::caution[Direkter Drizzle-Zugriff ist nur unter Node möglich]
Sie können auch Ihre eigene Drizzle-Instanz importieren und direkt abfragen (`db.execute(sql\`…\`)`). Das funktioniert und ist auf einem selbst gehosteten oder verwalteten Node-Deployment völlig in Ordnung.

Es ist jedoch wichtig zu wissen, was dies mit sich bringt: Eine Funktion, die `drizzle-orm` und einen `pg`-Pool importiert, bleibt dauerhaft eine Node-Funktion, umgeht Ihre Tabellen-Hooks, die `rebase.data` ausführt (keines von beiden prüft `.validate()`, was für [API-Anfragen](/docs/collections/validation-and-conditions/#where-validation-runs) gilt), und bezieht ihre Verbindung von außerhalb der Anfrage. `rebase.sql()` bietet Ihnen dasselbe rohe SQL über die frameworkeigene Verbindung, und `getSql(c)` stellt es Ihnen unter den Richtlinien des Aufrufers bereit. Bevorzugen Sie diese Varianten.
:::

## Konfiguration und Secrets

Lesen Sie Konfigurationen **innerhalb** des Handlers aus, niemals auf Modulebene:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Einmalig erstellt, bei der ersten Anfrage, die es benötigt – nicht zur Importzeit.
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
// Nicht tun. Wenn STRIPE_SECRET_KEY nicht gesetzt ist, wirft dies beim Importieren
// der Datei einen Fehler – und der Loader meldet dies als *übersprungene Funktion*. Die Route
// liefert 404, und der Grund ist in einer Boot-Log-Zeile vergraben.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Ein Lesevorgang auf Modulebene wird ausgewertet, wenn die Datei importiert wird, noch bevor eine Anfrage existiert. Unter Node bedeutet dies, dass eine einzige fehlende Variable die gesamte Datei und jede darin enthaltene Route lahmlegt. Auf einem Host, der Konfigurationen an die Anfrage statt an den Prozess bindet, gibt es zur Importzeit überhaupt nichts auszulesen.

- `getEnv(c)` – alle für diese Anfrage sichtbaren Variablen
- `env(c, "NAME")` – eine Variable, getrimmt; leer gilt als nicht gesetzt
- `requireEnv(c, "NAME")` – dasselbe, wirft jedoch einen Fehler mit dem Namen der Variablen
- `lazyResource(factory)` – erstellt einen ressourcenintensiven Client einmalig bei der ersten Verwendung

`rebase doctor` meldet `process.env`-Lesezugriffe auf Modulebene in Ihrem functions-Verzeichnis.

## Hintergrundarbeit

Auf eine eigene Seite verschoben: [Hintergrundarbeit](/docs/backend/background-work/).

## Portabilität der Laufzeitumgebung

Eine benutzerdefinierte Funktion ist eine Hono-App. Ob sie außerhalb eines Node-Prozesses ausgeführt werden kann, hängt also davon ab, was ihre eigene Datei importiert. `rebase.sql()`, ein direkt importierter Datenbank-Client und Node-Built-ins binden sie an Node; der Rest von `rebase` und die Web-Plattform tun dies nicht, und heute schlägt nichts wegen eines von beiden fehl. Unter [Portabilität der Laufzeitumgebung](/docs/backend/runtime-portability/) ist aufgeführt, was portabel ist, wie `rebase build` und `rebase doctor` dies melden und wie Sie nach Laufzeitumgebung verzweigen können.

## Reihenfolge der Routenregistrierung

Benutzerdefinierte Funktionen werden geladen und eingebunden, **nachdem** `initializeRebaseBackend()` das grundlegende Setup abgeschlossen hat. Die Initialisierungsreihenfolge lautet:

1. **Bootstrapper** – Datenbankverbindungen, Auth-Tabellen, Realtime-Dienste
2. **Auth-Routen** – `/api/auth/*`, `/api/admin/*`
3. **Storage-Routen** – `/api/storage/*`
4. **Daten-Routen** – `/api/data/*` (CRUD für Tabellen)
5. **Benutzerdefinierte Funktionen** ← `/api/functions/*`
6. **Cron-Jobs** – `/api/admin/cron/*`
7. **WebSocket** – Realtime-Abonnements

Das bedeutet, dass Ihre benutzerdefinierten Funktionen Zugriff auf alle initialisierten Dienste haben. Registrieren Sie Routen, die **vor** Rebase ausgeführt werden müssen, direkt auf der Hono-App, bevor Sie `initializeRebaseBackend()` aufrufen:

```typescript no-verify
const app = new Hono<HonoEnv>();

// Dies läuft VOR den Rebase-Routen
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase-Initialisierung – registriert alle /api/*-Routen
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routen, die Sie Ihrer eigenen App auf diese Weise hinzufügen, liegen **außerhalb** jedes Rebase-Routers, sodass auf ihnen keine Auth-Middleware ausgeführt wurde und `getDriver(c)` nicht gesetzt ist. Sichern Sie diese mit `requireAuth` / `requireAdmin` ab, importiert aus **`@rebasepro/server`** – dem Paket-Root –, welche das Token selbst verifizieren. Die Guards auf dem `/functions`-Subpfad lesen eine Identität aus, die ein Rebase-Router bereits aufgelöst hat, und antworten mit 500, anstatt vorzugeben, dass eine existiert.
:::

## Beispiel: Webhook-Handler

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Wird bei der ersten Anfrage aus der Konfiguration dieser Anfrage erstellt. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Bewusst öffentlich: Stripe sendet kein Token mit. Die Signatur ist die
    // Authentifizierung, verifizieren Sie diese daher vor allen anderen Schritten.
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
            // Die Abwicklung (Fulfilment) kann länger dauern als die Antwort; der 200-Status signalisiert Stripe, Wiederholungen einzustellen.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Debugging

Wenn Funktionen geladen werden, protokolliert der Boot-Prozess `Loaded custom functions` zusammen mit deren Anzahl. Jede einzelne Zeile einer Funktion wird auf Stufe `debug` geloggt (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Wenn das Laden fehlschlägt, gibt der Loader Diagnosemeldungen aus:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Der Router wird für das **Verzeichnis** eingebunden, nicht für die darin enthaltenen Funktionen. Wenn der Import jeder Datei fehlschlägt – eine einzige fehlende Umgebungsvariable auf Modulebene reicht aus, um alle lahmzulegen –, antwortet `GET /api/functions` dennoch mit `200` und einer leeren Liste samt einem `skipped`-Zähler, sodass "nichts geladen" von "dieser Build enthält keine Funktionen" unterschieden werden kann. Das Listing selbst erfordert einen angemeldeten Aufrufer, einen API-Schlüssel mit dem einfachen Scope `functions:invoke` oder den Service-Key – die Funktionen bleiben für jeden aufrufbar, den die jeweilige Funktion zulässt, aber die Übersicht über sie ist nicht öffentlich. Die Gründe verbleiben im Boot-Log.

## Timeouts und Ratenbegrenzungen

Für `/api/functions/*` gelten zwei Obergrenzen:

- **Anfrage-Timeout** – Standardmäßig 30 Sekunden, antwortet mit `504` und dem Code `FUNCTION_TIMEOUT`. Konfigurierbar über `functionsTimeoutMs` (oder `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` deaktiviert es. Der Handler kann nicht von außen gestoppt werden, wird jedoch benachrichtigt: `getSignal(c)` aus `@rebasepro/server/functions` wird im Moment des 504 abgebrochen, übergeben Sie es also an `fetch` und alles andere, was ein Signal akzeptiert (`fetch(url, { signal: getSignal(c) })`). Arbeiten, denen das Signal nicht übergeben wurde, laufen weiter – der Timeout gibt den Client und den Socket frei, nicht die Arbeit. Dass der Handler nach dem 504 *weiterläuft*, ist eine Eigenschaft eines langlebigen Node-Prozesses, keine vertragliche Zusicherung; alles, was zwingend abgeschlossen werden muss, gehört in [`waitUntil`](#hintergrundarbeit).
- **Ratenbegrenzung (Rate Limit)** – API-Schlüssel und angemeldete Aufrufer teilen sich die Buckets der Daten-API. Anonyme Aufrufer erhalten ein eigenes, deutlich großzügigeres Kontingent (3000 pro Zeitfenster), da dieser Router für Webhook-Empfänger standardmäßig öffentlich ist. Überschreiben Sie dies mit `rateLimit.anonymousFunctions`; `null` schaltet es ab.

Nicht behandelte Promise-Rejections werden protokolliert, statt fatal zu sein: Ein Fire-and-Forget-Aufruf in einer Funktion würde sonst den gesamten Prozess beenden. Setzen Sie `REBASE_EXIT_ON_UNHANDLED_REJECTION=1`, um das Standardverhalten von Node zu aktivieren.

In Rebase Cloud verfügt der Edge vor Ihren Funktionen über eigene Limits, und modulweiter State, das Dateisystem sowie ausgehende Ports verhalten sich auf eine Weise, die man vor dem Entwurf kennen sollte. Siehe [Verwaltete Backend-Laufzeitumgebung](/docs/deployment/managed-runtime/).

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** – Vollständige Backend-Konfigurationsreferenz
- **[Tabellen-Hooks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Cron-Jobs](/docs/backend/cron-jobs)** – Geplante Hintergrundaufgaben
