---
sourceHash: 93c74d4bdc0c12ea
title: Eigene Server-Integration
sidebar_label: Eigener Server
description: Erstellen Sie das Rebase-Backend aus öffentlichen Bausteinen in Ihrem eigenen Server – createRebaseBackend, dessen Routengruppen, mount, attachRealtime und start – oder binden Sie den Postgres-Treiber in Express ein.
---

# Eigene Server-Integration

`initializeRebaseBackend` ist eine Abkürzung. Es erstellt das gesamte Backend, bindet
es in Ihre Hono-App unter `/api` ein, verbindet den Realtime-Socket mit Ihrem HTTP-Server
und startet die Hintergrundarbeit – alles in einem einzigen Aufruf. Wenn das genau das ist,
was Sie möchten, nutzen Sie es.

Wenn nicht, gehen Sie eine Ebene tiefer. Jeder Teil dieses Aufrufs ist ein öffentlicher
Baustein, den Sie selbst aufrufen können: Erstellen Sie das Backend, binden Sie dann alles
oder nur die gewünschten Routengruppen an den gewünschten Pfaden ein und entscheiden Sie,
welcher Prozess die Timer startet. [Einbinden des Postgres-Treibers](/docs/backend/embedding-postgres-driver/)
geht noch einen Schritt weiter und öffnet den Postgres-Treiber isoliert in einer Express-App.

## Umgebungskonfiguration

Rebase bietet ein zentrales `loadEnv()`-Utility in `@rebasepro/server`, das Ihre Umgebungsvariablen gegen ein striktes Zod-Schema validiert. Rufen Sie es **nach** dem Laden Ihrer `.env`-Datei auf:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Um eigene typisierte Variablen hinzuzufügen, erweitern Sie das Schema:

```typescript
import { loadEnv, z } from "@rebasepro/server";

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string        (validated, required)
```

:::caution[Zwei Kopien von zod]
Das gleichzeitige Laden von zwei Kopien von Zod führte früher dazu, dass dieser Aufruf stillschweigend fehlschlug. `loadEnv`
kombinierte die Schemas mit `.merge()`, was ein Schema der anderen Kopie akzeptiert
und anschließend jedes Feld mit einem `.default()` ablehnt. Der Server startete,
meldete Erfolg und führte keinen seiner Crons aus; nichts im Fehler wies auf
Zod hin.

`loadEnv` validiert nun das Basisschema und Ihr `extend`-Schema jeweils mit einem
eigenen `.parse()`, sodass ein von einer anderen Zod-Kopie erstelltes Schema funktioniert. Die Runtime
stellt `zod` bereit, und die `backend/package.json` des Scaffolds führt es in dem Bereich auf,
den `@rebasepro/server` verwendet, sodass nur eine Kopie installiert ist: Halten Sie beide identisch.
:::

**Wichtigste Verhaltensweisen:**
- Generiert `JWT_SECRET` und `REBASE_SERVICE_KEY` in der Entwicklungsumgebung, wenn sie nicht gesetzt sind, sodass Sie ohne manuelle Einrichtung starten können, und speichert sie in `.rebase-dev-secrets.json`, damit ein Neustart niemanden abmeldet.
- Blockiert automatisch generierte Secrets in der Produktion – Sie müssen sie explizit setzen.
- Validiert, dass `CORS_ORIGINS` oder `FRONTEND_URL` in der Produktion gesetzt ist.
- Verweigert einen `extend`-Wert, der kein Zod-Schema ist.
- Wirft einen `Error`, der jede fehlende oder fehlerhafte Variable benennt, wie z. B. `DATABASE_URL: is required`, mit den Zod-Issues in der `issues`-Eigenschaft.

Die vollständige Liste der unterstützten Variablen finden Sie in der `.env.example` der generierten Anwendung.

## Eine Ebene unter `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`initializeRebaseBackend` besteht nur aus diesen Aufrufen und nichts weiter:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ tables: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Das von ihr zurückgegebene `shutdown()` schließt auch den übergebenen Server. Hier ist
dasselbe als `backend/src/index.ts` eines Projekts ausgeschrieben, bereit zur Anpassung.
`rebase dev` führt diese Datei aus, wenn ein Projekt eine besitzt, anstelle des
eigenen Bootvorgangs der Runtime. Eingefügt in ein Scaffold-Projekt liefert sie das, was die Runtime geliefert hat:
die API auf dem Port, den `rebase dev` gewählt hat, Anmeldung und Registrierung mit der
Auth-Tabelle des Projekts, die Tabellen, die `backend/schema/index.ts` exportiert, die globalen
Hooks in `backend/hooks.ts`, die Funktionen in `backend/functions/`, die Cron-Jobs
in `backend/crons/`, die in `backend/resources.ts` deklarierten Buckets und das CORS,
das das Admin-Panel auf seinem eigenen Port benötigt.

```typescript
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    CORS_EXPOSED_HEADERS,
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    isLocalhostOrigin,
    loadEnv,
    logger,
    resolveStorageSources,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import {
    createPostgresAdapter,
    createPostgresDatabaseConnection,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { declaredStorageSources } from "@rebasepro/types";
import "../resources";
import { storageAuthorize } from "../storage";
import { hooks } from "../hooks";

// dotenv never overrides a variable already set, so what `rebase dev` sets wins.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cronsDir = path.join(root, "backend/crons");

installUnhandledRejectionHandler();

const app = new Hono<HonoEnv>();

// Localhost in development, and the origins in CORS_ORIGINS or FRONTEND_URL.
const origins = (env.CORS_ORIGINS || env.FRONTEND_URL || "").split(",").map((origin) => origin.trim());
app.use("/*", cors({
    origin: (origin) =>
        origins.includes(origin) || (env.NODE_ENV !== "production" && isLocalhostOrigin(origin)) ? origin : null,
    credentials: true,
    exposeHeaders: [...CORS_EXPOSED_HEADERS]
}));
app.use("/*", secureHeaders());

const server = createServer({ maxHeaderSize: 64 * 1024 }, getRequestListener(app.fetch));
const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);

const backend = await createRebaseBackend({
    schemaDir: path.join(root, "backend/schema"),
    hooks,
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        cookieAuth: { sameSite: "Lax" }
    },
    storage: resolveStorageSources(process.env, declaredStorageSources(), path.join(root, "uploads")),
    storageAuthorize,
    history: true,
    provision: true
});

setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();

// The runtime answers health on both paths; an orchestrator probes `/health`.
for (const healthPath of ["/health", "/api/health"]) {
    app.get(healthPath, async (c) => {
        const { healthy } = await backend.healthCheck();
        return c.json({ status: healthy ? "ok" : "degraded" }, healthy ? 200 : 503);
    });
}

// `rebase dev` reads this line to know the backend is up.
server.listen(env.PORT, () => logger.info(`Server running at http://localhost:${env.PORT}`));
installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
```

Die Pfade stammen aus dem Scaffold; lassen Sie den `hooks`-Import und die Option weg,
wenn das Projekt keine `backend/hooks.ts` hat. Benutzer werden in der Tabelle gespeichert,
die `backend/schema` mit `defineAuthTable` deklariert, daher nennt `auth` keine Tabelle.
Die Datei stützt sich auf das, was `rebase dev` setzt: den
in `PORT` gewählten Port, die verwaltete Datenbank in `DATABASE_URL` und die
`.env` des Projekts in `DOTENV_CONFIG_PATH`. `loadEnv()` validiert den Inhalt
und generiert `JWT_SECRET` in der Entwicklung, wenn es nicht gesetzt ist. Wenn Sie auf
einem anderen Port lauschen, kann das Admin-Panel den Server nicht erreichen; überspringen Sie `loadEnv()`
und ohne `JWT_SECRET` ist die Anmeldung deaktiviert.
`rebase dev` wartet außerdem auf die Zeile `Server running at http://localhost:<port>`,
bevor es meldet, dass das Backend bereit ist. Die `auth`-Optionen stammen aus dem Scaffold; die
Runtime liest auch die OAuth-Provider, E-Mail und die anderen `AUTH_*`-Variablen,
übergeben Sie also die, die Sie verwenden, wie unter [Authentifizierung](/docs/backend/authentication/)
beschrieben. Die Datei stellt auch nicht das kompilierte Admin-Panel in der Produktion bereit: der
Entrypoint, den [`rebase eject`](/docs/cli/) schreibt, tut dies mit `serveSPA` und öffnet
eine Verbindung pro in `backend/resources.ts` deklarierter Datenbank.

`createRebaseBackend` akzeptiert dieselben Optionen wie `initializeRebaseBackend`,
jedoch ohne `app`, `server` und `basePath`, und mit erforderlichem `provision`. Es
erstellt alles: Es öffnet die Datenbank, richtet Authentifizierung und Storage ein, lädt die
Funktionen und Cron-Jobs und erstellt jede Routengruppe sowie den In-Process-Client.
Es mountet nichts, startet keine Timer und fügt keine Process-Listener hinzu. Jeder
der verbleibenden Schritte ist ein Aufruf, den Sie selbst ausführen oder weglassen können:

| Aufruf | Funktion | Wenn weggelassen |
|---|---|---|
| `installUnhandledRejectionHandler()` | Protokolliert eine unbehandelte Promise-Rejection, wie z. B. einen Fire-and-Forget-Aufruf in einer benutzerdefinierten Funktion, anstatt Node den Prozess beenden zu lassen. Prozessweit, daher ist es die Entscheidung des Prozesses, nicht die eines Backends. Gibt eine Funktion zurück, die ihn deinstalliert, oder `undefined`, wenn bereits einer installiert war oder `REBASE_EXIT_ON_UNHANDLED_REJECTION` gesetzt ist. | Eine unbehandelte Rejection beendet den Prozess (Standardverhalten von Node) |
| `setDefaultBackend(backend)` | Macht dieses Backend zum [Prozess-Standard](#mehrere-backends-in-einem-prozess): das, wofür `import { rebase }` und der Rest der API auf Modulebene außerhalb der von einem Backend bedienten Anfragen, Cron-Läufe und Jobs antworten | Diese API hat dort kein Backend, für das sie antworten kann |
| `backend.mount(app, { basePath })` | Jede Routengruppe unter `basePath` (Standard `/api`), hinter der prozessweiten Middleware: Request-IDs, Body-Limit, Komprimierung, CSRF, das Request-Log und die JSON-Hülle für Fehler und unbekannte Pfade. Außerdem das JWKS-Dokument, der MCP-Server, die OpenAPI-Dokumentation und die Legacy-Routen-Aliase. | Über HTTP wird nichts bereitgestellt; `backend.rebase` und `backend.fetch` funktionieren weiterhin |
| `backend.attachRealtime(server, { path })` | Der Realtime-Socket auf `server`, der Upgrades nur unter `path` verarbeitet | Es gibt keine Live-Queries |
| `backend.start()` | Der Cron-Scheduler, die Job-Worker, die Bereinigung abgelaufener Tokens und des Verlaufs, der Metrik-Sampler und das geplante RLS-Audit – jeweils dort, wo `ownership` dies diesem Prozess zuweist. Sicher für mehrfache Aufrufe. | Keines davon wird ausgeführt, was genau das ist, was ein anfrageverarbeitender Prozess in einem [Split-Deployment](/docs/deployment/split-processes/) benötigt |
| `backend.shutdown(timeoutMs, { server })` | Stoppt, was `start()` und `attachRealtime()` gestartet haben, und wartet auf laufende Cron-Ausführungen und Jobs. Schließt `server` nur, wenn Sie ihn übergeben. | |

Der Standard-`path` des Sockets ist der an `mount()` übergebene Basispfad, wobei ein abschließendes
`/api` entfernt wird; `/api` ergibt also `/` und `/x/api` ergibt `/x`; ein Basispfad, der
nicht auf `/api` endet, ergibt `/`. Das ist der Pfad, den das
SDK anwählt, da es sich mit seiner `baseUrl` verbindet, während seine HTTP-Anfragen an
`${baseUrl}/api` gehen. Ein Upgrade auf jeden anderen Pfad wird den anderen
`upgrade`-Listenern des Servers überlassen, sodass Ihre App ihren eigenen WebSocket-Server auf demselben
`http.Server` betreiben kann.

### Was das Erstellen eines Backends ändern kann: `provision`

Das Erstellen eines Backends kann DDL ausführen, daher fordert `createRebaseBackend` Sie zu einer Entscheidung auf:

| `provision` | Erstellt | Geeignet für |
|---|---|---|
| `true` | Alles, was das Backend bedient: die deklarierten Tabellen und deren RLS-Policies, Change-Capture für Realtime, die Rolle, unter der Anfragen ausgeführt werden, und die eigenen Tabellen des Frameworks (API-Keys, Cron-Läufe, Jobs, Metriken). | Ein Single-Process-Deployment; das, was `initializeRebaseBackend` übergibt |
| `false` | Nichts, weder beim Booten noch später: Auch die Tabellen, die andere Backends bei der ersten Verwendung erstellen (Idempotenzschlüssel, Cron-Claims), werden nicht erstellt. Das Schema muss bereits vorhanden sein, angewendet durch `rebase db push`, eine Migration oder einen anderen Prozess. Fehlende Auth-Tabellen verweigern den Start beim Booten; eine fehlende optionale Tabelle deaktiviert die entsprechende Funktion, was im Log vermerkt wird. | Ein Skript, ein Test, ein REPL, ein reiner Lese-Prozess, eine Datenbank, die nur Ihr Change-Management-Prozess ändern darf |
| `{ tables: false, realtime: false }` | Die Tabellen des Frameworks und die Rolle, jedoch nicht das Schema der deklarierten Tabellen oder Change-Capture. | Einen Prozess, der in einem Split-Deployment nicht Eigentümer des Schemas ist |

Dies ist bewusst eine Option und kein späterer Schritt. Der Treiber liest die
Tabellen beim Öffnen aus und verbindet das Change-Capture mit den zu diesem Zeitpunkt vorhandenen Tabellen.
Ein nachträglich aufgerufenes `provision()` würde erst laufen, nachdem der Treiber bereits
entschieden hat, was existiert. `REBASE_MIGRATE_ON_BOOT=none` deaktiviert das Tabellenschema
weiterhin für jedes Backend im Prozess. `initializeRebaseBackend` übergibt
`false`, wenn `REBASE_PROVISION=false` ist.

## Nur die gewünschten Gruppen einbinden

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`backend.routes` enthält die Routengruppen. Jede ist eine Hono-Sub-App, die Sie
separat an einem beliebigen Pfad einbinden können:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` ist eine Liste von Ergebnissen aus `defineTable`, `defineAuthTable` und `defineView` – typischerweise alles, was `backend/schema/index.ts` exportiert – und `defaultRls` ist das, was dessen Tabellen mit `rls: "inherit"` übernehmen, das `defaultRls`, das dieser Index exportiert. Jede Tabelle wird kompiliert, wenn das Backend erstellt wird, und ein Problem bei einer von ihnen (kein `rls`, `"inherit"` ohne `defaultRls`, eine Relation zu einer nicht in der Liste enthaltenen Tabelle) verweigert die Erstellung mit einem `SchemaDefinitionError`, der die einzelnen Fehler benennt. Übergeben Sie stattdessen `schemaDir`, um das Verzeichnis so zu laden, wie es die Runtime tut, einschließlich der Index-Exporte und `defaultRls`; übergeben Sie beides, so wird `tables` bereitgestellt, während der Schema-Editor in `schemaDir` schreibt.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Gruppe | Normalerweise unter | Bedient |
|---|---|---|
| `routes.auth()` | `/api/auth` | Anmeldung, Sessions, OAuth, Passwort-Reset, `GET /config`, die eigenen API-Keys des Aufrufers und den Scope-Katalog |
| `routes.data()` | `/api/data` | Die REST-Routen der Tabellen und deren Verlauf |
| `routes.storage()` | `/api/storage` | Dateispeicher oder den Router, der mit `STORAGE_NOT_CONFIGURED` antwortet |
| `routes.functions()` | `/api/functions` | Ihre [benutzerdefinierten Funktionen](/docs/backend/custom-functions/) oder die Weiterleitung an den Prozess, der sie bedient |
| `routes.admin()` | `/api/admin` | Benutzer und Rollen, Service-Keys, Schemabearbeitung, Storage-Wartung, Backups, das RLS-Audit, SQL-Export, das Entwicklungs-Postfach und die Logs |
| `routes.cron()` | `/api/admin/cron` | Die Administrations-Oberfläche für Cron |
| `routes.meta()` | `/api/meta` | Den Projektvertrag, den ein generiertes SDK liest |
| `routes.schema()` | `/api/schema` | `GET /tables`: die Tabellendeskriptoren, aus denen das CMS und das Studio rendern – siehe [Endpunkte](/docs/backend/endpoints/#schema) |

Jede Gruppe enthält die Middleware, die sie benötigt: den Auth-Kontext, der
`user`, `driver` und `scopes` des Aufrufers an den Request anhängt, ihre Rate-Limits und ihren
Admin-Gate. Sie antwortet also überall gleich, wo sie eingebunden wird, auch unter einem
parametrisierten Pfad wie `/:tenant/data`. Eine Gruppe erkennt auch, wo sie
eingebunden wurde, sodass die Daten-API jede Tabelle weiterhin an ihre Datenbank weiterleitet und
die Funktionsauflistung die Pfade nennt, unter denen sie tatsächlich bereitgestellt wird.

Eine Gruppe verweigert `x-rebase-impersonate` und `x-rebase-simulate-*` außerdem selbst
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), es sei denn, es handelt sich um die
Daten- oder Funktionsgruppe, die diese berücksichtigen. `refuseUnhonouredImpersonation(honouredMounts)`
aus `@rebasepro/server` tut dasselbe für Ihre eigenen Routen.

Was eine Gruppe nicht enthält, ist die prozessweite Middleware, die `mount()` vor
alles schaltet. Wenn Sie Gruppen einzeln einbinden, fügen Sie die gewünschten Teile
selbst hinzu: ein Body-Limit (`bodyLimit` aus `hono/body-limit`), Komprimierung und
die JSON-Fehlerhülle:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Jeder Aufruf gibt einen neuen Router über denselben Handlern zurück, sodass Sie eine Gruppe an zwei Stellen einbinden können. Das Anfordern einer Gruppe, für deren Bereich dieses Backend nicht konfiguriert wurde (`surfaces: { data: false }`), wirft einen Fehler, da das Backend sie nie erstellt hat. Die OpenAPI-Dokumentation und der MCP-Server haben keine eigene Gruppe: Sie beschreiben die URLs des `mount()`-Layouts, daher werden sie nur von `mount()` bereitgestellt.

## Das Backend ohne Server

Ein erstelltes Backend kann verwendet werden, ohne überhaupt etwas zu mounten.
`backend.rebase` ist sein In-Process-Client, und `backend.fetch(request)`
beantwortet einen `Request` so, wie es `mount()` unter `/api` tun würde:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Die Control-Plane-Aufrufe auf diesem Client (`rebase.auth`, `rebase.admin`,
`rebase.functions` und `rebase.cron`) erreichen die backend-eigenen Routen
innerhalb des Prozesses. Sie funktionieren unabhängig davon, wo oder ob Sie die Gruppen gemountet haben, und
Middleware, die Sie zu Ihrer eigenen App hinzugefügt haben, wird nicht auf sie angewendet.

Für ein Skript, das lediglich Daten benötigt, öffnet [`openRebase`](/docs/backend/scripts/)
die Datenbank, ohne überhaupt ein Backend zu erstellen.

## Mehrere Backends in einem Prozess

`createRebaseBackend` schreibt keine Prozess-Globals. Jedes Backend verwaltet seinen eigenen
Zustand in `backend.services`, sodass zwei Backends in einem Prozess getrennt bleiben: Jedes
signiert und verifiziert Sessions mit seinen eigenen Schlüsseln, bewertet Scopes anhand seiner eigenen Rollen,
prüft API-Keys in seinem eigenen Store und zählt Rate-Limits in seinem eigenen Speicher.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Beschreibung |
|---|---|
| `jwt` | Der JWT-Dienst des Backends: signiert und verifiziert Sessions, Download-Links und andere Tokens und stellt sein JWKS bereit |
| `access` | Sein Zugriffsmodell (Rollen zu Scopes) und der Resolver für den Eigentümer eines persönlichen Schlüssels |
| `apiKeyStore` | Wo seine API-Keys überprüft werden |
| `rateLimitStore`, `authLimiters` | Seine Rate-Limit-Zähler und die Begrenzer auf seinen Auth-Routen |
| `tables()` | Die kompilierten Deskriptoren der Tabellen, die es bedient |
| `topics`, `queues` | Seine Topic- und Queue-Runtimes |

Ein Backend, dem kein `auth.jwtSecret` übergeben wurde (wie z. B. ein Backend, dessen `auth` ein Adapter ist),
signiert nichts Eigenes, sodass sein `services.jwt` dem Prozess-Standard folgt.

**Ressourcen gehören dem Prozess.** Die Deklarationen von `database()`, `bucket()`, `topic()` und
`queue()` in `backend/resources.ts` sind Werte auf Modulebene, und
jedes Backend im Prozess liest alle davon: Ein Backend, dessen eigenes Projekt
kein Topic deklariert, aktiviert dennoch seine Job-Queue für das Topic eines anderen Projekts
und verweigert den Start, wenn sein Treiber keines unterstützen kann. Betreiben Sie die Ressourcen
eines Projekts pro Prozess. Mehrere Backends desselben Projekts, jedes auf einer eigenen
Datenbank, sind problemlos möglich.

**Wohin `rebase` verweist.** Innerhalb eines Requests, eines Cron-Laufs oder eines Jobs, den ein Backend
bedient, verweist `rebase` (egal ob aus `@rebasepro/server` importiert oder als `ctx.rebase`
erhalten) auf dieses Backend, und dasselbe gilt für Topic-`publish` und Queue-`enqueue`.
Überall sonst (Modul-Scope, ein Skript, ein Test) antworten sie für den **Prozess-Standard**,
den `setDefaultBackend(backend)` festlegt und den
`initializeRebaseBackend` auf sein eigenes Backend setzt. Dasselbe gilt für den Rest der
API auf Modulebene: `verifyAccessToken` und die anderen JWT-Helfer,
`getAccessModel`, `verifyCredential` und `extractUserFromToken`.

Drei Komponenten arbeiten direkt auf einem Backend und eine ganz ohne Backend:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the auth table.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The auth table
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Eine erstellte Session wird bei jeder Anfrage wie jede andere überprüft, daher muss ihre UID zu einem existierenden Benutzer gehören: Bei einer UID ohne Benutzer wird die Anfrage verweigert.

`verifyCredential` kommt zu demselben Ergebnis wie die Routen: Eine Session, von der sich der Eigentümer abgemeldet hat, eine UID ohne Benutzer und ein deaktiviertes Konto geben null zurück, und die Rollen entsprechen dem aktuellen Stand des Kontos. Es wirft einen Fehler, wenn die Datenbank nicht erreichbar ist.

Jede Routengruppe setzt `c.var.services` selbst. Eine Route außerhalb der Gruppen, die `requireAuth`, `requireScope` oder einen anderen Guard aus `@rebasepro/server` verwendet, liest es dort aus und fällt auf den Prozess-Standard zurück, wenn es nicht gesetzt ist. `requireScope` bewertet den Aufrufer, den `requireAuth` identifiziert hat, und gehört daher hinter `requireAuth`: Alleine verweigert es jede Anfrage mit einem 401. Es akzeptiert einen integrierten Scope oder einen App-Scope, den das Backend unter `auth.scopes` in seiner Auth-Tabelle deklariert, wie im obigen Kommentar dargestellt.

Ein Name, der kein Scope ist, oder ein falsch geschriebener integrierter Scope wie `data:raed`, wirft an der Stelle einen Fehler, an der die Route registriert wird. Ein App-Scope, den das antwortende Backend nicht deklariert hat, antwortet jedem Aufrufer – auch einem Administrator – mit `500 SCOPE_NOT_DECLARED`.

## Herunterfahren

Übergeben Sie bei `initializeRebaseBackend` das Backend an den integrierten Helper,
anstatt einen eigenen Signal-Handler zu schreiben. Er leert laufende HTTP-Verbindungen, stoppt den Cron-Scheduler,
baut Realtime ab, schließt den SMTP-Pool, sobald nichts mehr gesendet werden kann, schützt vor
wiederholten Signalen und erzwingt das Beenden, falls der Shutdown hängt:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

Kombinieren Sie dies **nicht** mit Ihrem eigenen `server.close()`: Das `shutdown()`
dieses Backends schließt den übergebenen Server bereits, und ein zweites Schließen
führt zu einem Deadlock. Ein Backend aus `createRebaseBackend` schließt einen Server nur, wenn Sie
ihn übergeben: `backend.shutdown(timeoutMs, { server })`, wie im Beispiel oben
auf dieser Seite gezeigt.

## Einbinden des Postgres-Treibers

Noch einen Schritt weiter gedacht funktioniert `@rebasepro/server-postgres` ganz ohne den
Rebase-Server: Öffnen Sie dessen Datentreiber und Realtime-Socket innerhalb von Express, Fastify
oder reinem Node und setzen Sie den Rest selbst zusammen. Siehe
[Einbinden des Postgres-Treibers](/docs/backend/embedding-postgres-driver/).

## CORS für ein Browser-Frontend

Ein eigener Server verwaltet seine CORS-Konfiguration selbst, und ein Frontend auf einem anderen Origin kann
nur die Response-Header lesen, die er explizit freigibt. Geben Sie diejenigen frei, die das SDK liest, da
`etagOf(row)` dort sonst immer `undefined` ist – ein `ifMatch`-Schreibvorgang wird dann
ohne `If-Match` gesendet – und ein 429-Fehler verliert sein `Retry-After`:

```typescript
import express from "express";
import cors from "cors";
import { CORS_EXPOSED_HEADERS } from "@rebasepro/server";

const app = express();
app.use(cors({
    origin: ["https://app.example.com"],
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS]
}));
```

`CORS_EXPOSED_HEADERS` ist die Liste, die die Runtime selbst freigibt, sodass ein
Header, den das SDK in einer späteren Version zu lesen beginnt, Ihr Frontend ohne
eine Änderung an dieser Stelle erreicht. Dies umfasst `ETag`, `Retry-After`, `X-Request-ID`, die drei
`X-RateLimit-*`-Header und `Preference-Applied`, plus `Location`,
`Upload-Offset` und `Rebase-Upload-Result`, mit denen ein fortsetzbarer Upload (Dateien über
8 MiB) antwortet, sowie `X-Rebase-Simulated-Context`, der angibt, als wer die simulierte Anfrage
eines Administrators ausgeführt wurde. Ohne die drei Upload-Header kann das
SDK einem Upload von einem anderen Origin nicht folgen und sendet jede Datei stattdessen als
einen einzigen Multipart-Request.

Die Rebase-Runtime und das per Eject ausgelagerte Backend senden diese Liste bereits.

## Verwandte Themen

- [Einbinden des Postgres-Treibers](/docs/backend/embedding-postgres-driver/) – der Datentreiber und der Realtime-Socket isoliert in Express
- [Skripte und die Konsole](/docs/backend/scripts/) – Zugriff auf die Projektdaten über ein Skript, einen Test oder ein REPL ganz ohne Server
- [Backend-Übersicht](/docs/backend/) – wo sich jede Option befindet, wenn stattdessen die Runtime bootet
- [Getrennte Prozesse](/docs/deployment/split-processes/) – die Rollen, die ein eigener Server abbilden muss
- [Storage-Konfiguration](/docs/backend/storage/) – die Storage-Quellen, die ein eigener Server selbst auflösen muss
