---
sourceHash: c42fc466c64146e7
title: Custom-Server-Integration
sidebar_label: Custom Server
description: Erstellen Sie das Rebase-Backend aus öffentlichen Bausteinen in Ihrem eigenen Server – createRebaseBackend, dessen Routengruppen, mount, attachRealtime und start – oder binden Sie den Postgres-Treiber in Express ein.
---

# Custom-Server-Integration

`initializeRebaseBackend` ist eine Abkürzung. Es erstellt das gesamte Backend,
bindet es in Ihre Hono-App unter `/api` ein, hängt den Realtime-Socket an Ihren
HTTP-Server an und startet die Hintergrundaufgaben – alles in einem einzigen
Aufruf. Wenn das genau das ist, was Sie wollen, verwenden Sie es.

Wenn nicht, gehen Sie einen Schritt tiefer. Jeder Teil dieses Aufrufs ist ein
öffentlicher Baustein, den Sie selbst aufrufen können: Erstellen Sie das Backend,
binden Sie dann alles oder nur die gewünschten Routengruppen unter den
gewünschten Pfaden ein und entscheiden Sie, welcher Prozess die Timer startet.
[Postgres-Treiber einbinden](/docs/backend/embedding-postgres-driver/) geht noch
einen Schritt weiter und öffnet den Postgres-Treiber isoliert in einer Express-App.

## Umgebungskonfiguration

Rebase bietet ein zentrales `loadEnv()`-Utility in `@rebasepro/server`, das Ihre Umgebungsvariablen anhand eines strikten Zod-Schemas validiert. Rufen Sie es **nach** dem Laden Ihrer `.env`-Datei auf:

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
Zwei gleichzeitig geladene Kopien von zod führten früher dazu, dass dieser Aufruf
lautlos fehlschlug. `loadEnv` kombinierte die Schemas mit `.merge()`, was ein
Schema der anderen Kopie akzeptiert und anschließend jedes Feld mit einem
`.default()` ablehnt. Der Server fuhr hoch, meldete Erfolg und führte keinen
seiner Cronjobs aus; nichts am Fehler wies auf zod hin.

`loadEnv` validiert nun das Basisschema und Ihr `extend`-Schema jeweils mit
einem eigenen `.parse()`, sodass ein Schema funktioniert, das von einer anderen
Kopie von zod erstellt wurde. Die Runtime stellt `zod` bereit, und die
`backend/package.json` des Scaffolds führt es in dem Bereich auf, den
`@rebasepro/server` verwendet, sodass nur eine Kopie installiert ist: Halten Sie
beide identisch.
:::

**Wichtigste Verhaltensweisen:**
- Generiert `JWT_SECRET` und `REBASE_SERVICE_KEY` in der Entwicklungsumgebung, wenn sie nicht gesetzt sind, sodass Sie ohne manuelle Einrichtung starten können, und speichert sie in `.rebase-dev-secrets.json`, damit ein Neustart niemanden abmeldet.
- Blockiert automatisch generierte Secrets in der Produktion – Sie müssen sie explizit setzen.
- Validates, dass in der Produktion `CORS_ORIGINS` oder `FRONTEND_URL` gesetzt ist.
- Verweigert einen `extend`-Wert, der kein Zod-Schema ist.
- Wirft einen `Error`, der jede fehlende oder fehlerhafte Variable benennt, wie z. B. `DATABASE_URL: is required`, mit den Problemen von Zod auf der Eigenschaft `issues`.

Die vollständige Liste der unterstützten Variablen finden Sie in `.env.example` der generierten App.

## Ein Schritt unter `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`initializeRebaseBackend` besteht aus diesen Aufrufen und nichts anderem:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ collections: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Das zurückgegebene `shutdown()` schließt auch den übergebenen Server. Hier ist
das Gleiche als `backend/src/index.ts` eines Projekts ausformuliert, bereit für
Anpassungen. `rebase dev` führt diese Datei aus, wenn ein Projekt eine besitzt,
anstelle des eigenen Boot-Vorgangs der Runtime. In ein Scaffold-Projekt
eingefügt, stellt es genau das bereit, was auch die Runtime bereitgestellt hat:
die API auf dem von `rebase dev` gewählten Port, Anmeldung und Registrierung über
die Auth-Tabelle des Projekts, die von `backend/schema/index.ts` exportierten
Tabellen, die globalen Hooks in `backend/hooks.ts`, die Funktionen in
`backend/functions/`, die Cronjobs in `backend/crons/`, die in
`backend/resources.ts` deklarierten Buckets sowie das CORS, das das Admin-Panel
auf seinem eigenen Port benötigt.

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

Die Pfade stammen aus dem Scaffold; lassen Sie den `hooks`-Import und die
entsprechende Option weg, wenn das Projekt keine `backend/hooks.ts` hat. Benutzer
werden in der Tabelle gespeichert, die `backend/schema` mit `defineAuthTable`
deklariert, weshalb `auth` keine Tabelle benennt. Die Datei verlässt sich auf
das, was `rebase dev` setzt: den ausgewählten Port in `PORT`, die verwaltete
Datenbank in `DATABASE_URL` und die `.env` des Projekts in `DOTENV_CONFIG_PATH`.
`loadEnv()` validiert diesen Inhalt und generiert `JWT_SECRET` in der
Entwicklung, wenn es nicht gesetzt ist. Wenn Sie auf einem anderen Port lauschen,
kann das Admin-Panel den Server nicht erreichen; überspringen Sie `loadEnv()`,
ist ohne `JWT_SECRET` die Anmeldung deaktiviert. `rebase dev` wartet zudem auf
die Zeile `Server running at http://localhost:<port>`, bevor es meldet, dass das
Backend betriebsbereit ist. Die `auth`-Optionen stammen aus dem Scaffold; die
Runtime liest auch die OAuth-Provider, E-Mail und die weiteren `AUTH_*`-Variablen
ein – übergeben Sie also diejenigen, die Sie verwenden, wie unter
[Authentifizierung](/docs/backend/authentication/) beschrieben. Die Datei
liefert in der Produktion auch nicht das kompilierte Admin-Panel aus: Der
Einstiegspunkt, den [`rebase eject`](/docs/cli/) schreibt, tut dies mit
`serveSPA` und öffnet eine Verbindung pro in `backend/resources.ts`
deklarierter Datenbank.

`createRebaseBackend` akzeptiert dieselben Optionen wie
`initializeRebaseBackend`, jedoch ohne `app`, `server` und `basePath`, und
erfordert `provision`. Es baut alles auf: Es öffnet die Datenbank, richtet
Authentifizierung und Storage ein, lädt die Funktionen und Cronjobs und
erstellt jede Routengruppe sowie den prozessinternen Client. Es bindet nichts
ein (mount), startet keine Timer und fügt keine Prozess-Listener hinzu. Jeder
weitere Schritt ist ein Aufruf, den Sie selbst ausführen oder weglassen:

| Aufruf | Funktion | Weglassen bedeutet |
|---|---|---|
| `installUnhandledRejectionHandler()` | Protokolliert eine unbehandelte Promise-Rejection (wie einen Fire-and-Forget-Aufruf in einer benutzerdefinierten Funktion), anstatt Node den Prozess beenden zu lassen. Prozessweit, daher ist dies die Entscheidung des Prozesses, nicht eines Backends. Gibt eine Funktion zurück, die den Handler deinstalliert, oder `undefined`, wenn bereits einer installiert war oder `REBASE_EXIT_ON_UNHANDLED_REJECTION` gesetzt ist. | Eine unbehandelte Rejection beendet den Prozess (Standardverhalten von Node) |
| `setDefaultBackend(backend)` | Macht dieses Backend zum [Prozess-Standard](#mehrere-backends-in-einem-prozess): worauf `import { rebase }` und der Rest der modulweiten API außerhalb der von einem Backend bedienten Anfragen, Cron-Ausführungen und Jobs antworten | Diese API hat dort kein Backend, auf das sie zugreifen kann |
| `backend.mount(app, { basePath })` | Alle Routengruppen unter `basePath` (Standard `/api`), hinter den prozessweiten Middlewares: Request-IDs, Body-Limit, Komprimierung, CSRF, Request-Log und die JSON-Hülle für Fehler und unbekannte Pfade. Außerdem das JWKS-Dokument, der MCP-Server, die OpenAPI-Dokumentation und die Legacy-Routen-Aliase. | Nichts wird über HTTP bereitgestellt; `backend.rebase` und `backend.fetch` funktionieren weiterhin |
| `backend.attachRealtime(server, { path })` | Der Realtime-Socket auf `server`, der Upgrades nur unter `path` entgegennimmt | Es gibt keine Live-Queries |
| `backend.start()` | Der Cron-Scheduler, die Job-Worker, die Bereinigung abgelaufener Tokens und des Verlaufs (History-Retention), der Metrik-Sampler und das geplante RLS-Audit – jeweils dort, wo `ownership` dies diesem Prozess zuweist. Sicher für mehrfache Aufrufe. | Nichts davon läuft, was genau dem entspricht, was ein anfrageverarbeitender Prozess in einem [Split Deployment](/docs/deployment/split-processes/) benötigt |
| `backend.shutdown(timeoutMs, { server })` | Stoppt, was `start()` und `attachRealtime()` gestartet haben, und wartet auf laufende Cronjobs und Jobs. Schließt `server` nur, wenn Sie ihn übergeben. | |

Der Standard-`path` des Sockets ist der an `mount()` übergebene Basispfad ohne
das abschließende `/api`, sodass `/api` zu `/` wird und `/x/api` zu `/x`; ein
Basispfad, der nicht auf `/api` endet, ergibt `/`. Genau dorthin verbindet sich
das SDK, da es sich mit seiner `baseUrl` verbindet, während seine HTTP-Anfragen an
`${baseUrl}/api` gehen. Ein Upgrade auf einen beliebigen anderen Pfad wird den
anderen `upgrade`-Listenern des Servers überlassen, sodass Ihre App ihren eigenen
WebSocket-Server auf demselben `http.Server` betreiben kann.

### Was das Erstellen eines Backends ändern kann: `provision`

Das Erstellen eines Backends kann DDL ausführen, daher verlangt `createRebaseBackend` eine Entscheidung von Ihnen:

| `provision` | Erstellt | Geeignet für |
|---|---|---|
| `true` | Alles, was das Backend bereitstellt: die deklarierten Tabellen und deren RLS-Richtlinien, Change Capture für Realtime, die Rolle, unter der Anfragen ausgeführt werden, und die framework-eigenen Tabellen (API-Keys, Cron-Ausführungen, Jobs, Metriken). | Ein Single-Process-Deployment; das, was `initializeRebaseBackend` übergibt |
| `false` | Nichts, weder beim Booten noch später: Tabellen, die andere Backends bei der ersten Verwendung erstellen (Idempotenzschlüssel, Cron-Claims), werden ebenfalls nicht erstellt. Das Schema muss bereits vorhanden sein – angewendet durch `rebase db push`, eine Migration oder einen anderen Prozess. Fehlende Auth-Tabellen führen zu einem Fehler beim Booten; eine fehlende optionale Tabelle deaktiviert die entsprechende Funktion, was im Log vermerkt wird. | Ein Skript, einen Test, eine REPL, einen rein lesenden Prozess oder eine Datenbank, die nur durch Ihren Änderungsprozess modifiziert werden darf |
| `{ collections: false, realtime: false }` | Die Tabellen des Frameworks und die Rolle, jedoch nicht das Schema der deklarierten Tabellen oder Change Capture. Der Schlüssel behält seinen alten Namen. | Einen Prozess, der in einem Split Deployment nicht für das Schema zuständig ist |

Dass dies eine Option und kein späterer Schritt ist, ist Absicht. Der Treiber
liest die Tabellen beim Öffnen ein und hängt Change Capture an diejenigen an, die
zu diesem Zeitpunkt existieren. Ein nachträglich aufgerufenes `provision()` würde
erst laufen, nachdem der Treiber bereits entschieden hat, was existiert.
`REBASE_MIGRATE_ON_BOOT=none` deaktiviert das Tabellenschema weiterhin für jedes
Backend im Prozess. `initializeRebaseBackend` übergibt `false`, wenn
`REBASE_PROVISION=false` gesetzt ist.

## Nur die gewünschten Gruppen einbinden

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`backend.routes` enthält die Routengruppen. Jede davon ist eine Hono-Sub-App,
die Sie separat unter einem beliebigen Pfad einbinden können:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` ist eine Liste von Ergebnissen aus `defineTable`, `defineAuthTable` und `defineView` – typischerweise alles, was `backend/schema/index.ts` exportiert – und `defaultRls` ist das, was dessen Tabellen mit `rls: "inherit"` übernehmen, also das `defaultRls`, das dieser Index exportiert. Jede Tabelle wird beim Erstellen des Backends kompiliert, und ein Problem in einer davon (kein `rls`, `"inherit"` ohne `defaultRls`, eine Relation zu einer Tabelle, die nicht in der Liste enthalten ist) lehnt die Erstellung mit einem `SchemaDefinitionError` ab, der alle Fehler benennt. Übergeben Sie stattdessen `schemaDir`, um das Verzeichnis so zu laden, wie es die Runtime tut (inklusive Index-Exporten und `defaultRls`); übergeben Sie beides, wird `tables` bereitgestellt, während der Schema-Editor in `schemaDir` schreibt.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Gruppe | Standardmäßig unter | Stellt bereit |
|---|---|---|
| `routes.auth()` | `/api/auth` | Anmeldung, Sitzungen, OAuth, Passwort-Reset, `GET /config`, die eigenen API-Keys des Aufrufers und den Scope-Katalog |
| `routes.data()` | `/api/data` | Die REST-Routen der Tabellen und deren Verlauf |
| `routes.storage()` | `/api/storage` | Dateispeicher oder den Router, der mit `STORAGE_NOT_CONFIGURED` antwortet |
| `routes.functions()` | `/api/functions` | Ihre [benutzerdefinierten Funktionen](/docs/backend/custom-functions/) oder den Forwarder zu dem Prozess, der sie ausführt |
| `routes.admin()` | `/api/admin` | Benutzer und Rollen, Service-Keys, Schemabearbeitung, Storage-Wartung, Backups, das RLS-Audit, SQL-Export, das Entwicklungs-Postfach und die Logs |
| `routes.cron()` | `/api/admin/cron` | Die Cron-Admin-Oberfläche |
| `routes.meta()` | `/api/meta` | Den Projektvertrag, den ein generiertes SDK liest |
| `routes.schema()` | `/api/schema` | `GET /tables`: die Tabellendeskriptoren, anhand derer das CMS und das Studio rendern – siehe [Endpunkte](/docs/backend/endpoints/#schema) |

Jede Gruppe bringt die Middleware mit, die sie benötigt: den
Authentifizierungskontext, der `user`, `driver` und `scopes` des Aufrufers an
den Request anhängt, ihre Rate-Limits und ihre Admin-Zugangskontrolle (Admin
Gate). Sie verhält sich also überall gleich, egal wo sie eingebunden wird – auch
unter einem parametrisierten Pfad wie `/:tenant/data`. Eine Gruppe erkennt auch,
wo sie eingebunden wurde, sodass die Daten-API weiterhin jede Tabelle an ihre
Datenbank weiterleitet und die Funktionsauflistung die tatsächlichen Pfade nennt,
unter denen sie bereitgestellt wird.

Eine Gruppe verweigert `x-rebase-impersonate` und `x-rebase-simulate-*` zudem
selbst (`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), es sei
denn, es handelt sich um die Daten- oder Funktionsgruppe, welche diese
berücksichtigen. `refuseUnhonouredImpersonation(honouredMounts)` aus
`@rebasepro/server` tut dasselbe für Ihre eigenen Routen.

Was eine Gruppe nicht mitbringt, ist die prozessweite Middleware, die `mount()`
allem voranstellt. Wenn Sie Gruppen einzeln einbinden, fügen Sie die
gewünschten Teile selbst hinzu: ein Body-Limit (`bodyLimit` aus
`hono/body-limit`), Komprimierung und die JSON-Fehlerhülle:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Jeder Aufruf gibt einen neuen Router über denselben Handlern zurück, sodass Sie eine Gruppe an zwei Stellen einbinden können. Das Anfordern einer Gruppe, ohne deren Oberfläche dieses Backend erstellt wurde (`surfaces: { data: false }`), löst einen Fehler aus, da das Backend sie nie erstellt hat. Die OpenAPI-Dokumentation und der MCP-Server haben keine eigene Gruppe: Sie beschreiben die URLs des `mount()`-Layouts, daher werden sie nur von `mount()` bereitgestellt.

## Das Backend ohne Server

Ein erstelltes Backend kann verwendet werden, ohne dass etwas eingebunden werden
muss. `backend.rebase` ist sein prozessinterner Client, und
`backend.fetch(request)` beantwortet einen `Request` so, wie `mount()` es unter
`/api` tun würde:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Die Control-Plane-Aufrufe dieses Clients (`rebase.auth`, `rebase.admin`,
`rebase.functions` und `rebase.cron`) erreichen die backend-eigenen Routen
prozessintern. Sie funktionieren unabhängig davon, wo oder ob Sie die Gruppen
eingebunden haben, und Middlewares, die Sie Ihrer eigenen App hinzugefügt haben,
werden für sie nicht ausgeführt.

Für ein Skript, das lediglich die Daten benötigt, öffnet
[`openRebase`](/docs/backend/scripts/) die Datenbank, ohne überhaupt ein Backend
aufzubauen.

## Mehrere Backends in einem Prozess

`createRebaseBackend` schreibt keine prozessweiten globalen Variablen. Jedes
Backend hält seinen eigenen Zustand in `backend.services`, sodass zwei davon in
einem Prozess getrennt bleiben: Jedes signiert und verifiziert Sitzungen mit
eigenen Schlüsseln, bewertet Scopes anhand eigener Rollen, prüft API-Keys im
eigenen Store und zählt Rate-Limits im eigenen Store.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Beschreibung |
|---|---|
| `jwt` | Der JWT-Dienst des Backends: signiert und verifiziert Sitzungen, Download-Links und andere Tokens und stellt sein JWKS bereit |
| `access` | Sein Zugriffsmodell (Rollen zu Scopes) und der Resolver für den Eigentümer eines persönlichen Schlüssels |
| `apiKeyStore` | Wo dessen API-Keys geprüft werden |
| `rateLimitStore`, `authLimiters` | Seine Rate-Limit-Zähler und die Limiter auf seinen Auth-Routen |
| `tables()` | Die kompilierten Deskriptoren der Tabellen, die es bereitstellt |
| `topics`, `queues` | Seine Topic- und Queue-Runtimes |

Ein Backend, dem kein `auth.jwtSecret` übergeben wurde (wie eines, dessen `auth`
ein Adapter ist), signiert selbst nichts, sodass dessen `services.jwt` dem
Prozess-Standard folgt.

**Ressourcen gehören dem Prozess.** Die Deklarationen von `database()`,
`bucket()`, `topic()` und `queue()` in `backend/resources.ts` sind Werte auf
Modulebene, und jedes Backend im Prozess liest alle davon: Ein Backend, dessen
eigenes Projekt kein Topic deklariert, aktiviert dennoch seine Job-Queue für das
Topic eines anderen Projekts und verweigert den Start, wenn sein Treiber keines
unterstützen kann. Führen Sie die Ressourcen eines Projekts pro Prozess aus.
Mehrere Backends desselben Projekts, jeweils auf einer eigenen Datenbank, sind
problemlos möglich.

**Wohin `rebase` verweist.** Innerhalb einer Anfrage, einer Cron-Ausführung oder
eines Jobs, den ein Backend bedient, ist `rebase` – egal ob aus
`@rebasepro/server` importiert oder als `ctx.rebase` erhalten – dieses Backend,
und dasselbe gilt für Topic-`publish` und Queue-`enqueue`. Überall sonst
(Modul-Scope, ein Skript, ein Test) verweisen sie auf den **Prozess-Standard**,
den `setDefaultBackend(backend)` festlegt und den `initializeRebaseBackend` auf
sein eigenes Backend setzt. Das Gleiche gilt für den Rest der modulweiten API:
`verifyAccessToken` und die anderen JWT-Helfer, `getAccessModel`,
`verifyCredential` und `extractUserFromToken`.

Drei Komponenten arbeiten direkt mit einem Backend, und eine ganz ohne Backend:

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

Eine generierte Sitzung wird bei jeder Anfrage wie jede andere geprüft, daher
muss ihre UID zu einem existierenden Benutzer gehören: Bei einer UID ohne
Benutzer wird die Anfrage abgelehnt.

`verifyCredential` kommt zum selben Ergebnis wie die Routen: Eine Sitzung, von
der sich der Eigentümer abgemeldet hat, eine UID ohne Benutzer und ein
deaktiviertes Konto geben `null` zurück, und die Rollen entsprechen dem
aktuellen Stand des Kontos. Es wird ein Fehler geworfen, wenn die Datenbank nicht
erreichbar ist.

Jede Routengruppe setzt `c.var.services` selbst. Eine Route außerhalb der
Gruppen, die `requireAuth`, `requireScope` oder einen anderen Guard aus
`@rebasepro/server` verwendet, liest es dort aus und fällt auf den
Prozess-Standard zurück, wenn es nicht gesetzt ist. `requireScope` beurteilt den
von `requireAuth` identifizierten Aufrufer und muss daher nach `requireAuth`
stehen: Für sich allein lehnt es jede Anfrage mit 401 ab. Es akzeptiert einen
integrierten Scope oder einen App-Scope, den das Backend unter `auth.scopes` in
seiner Auth-Tabelle deklariert, wie im obigen Kommentar gezeigt.

Ein Name, der kein Scope ist, oder ein falsch geschriebener integrierter Scope
wie `data:raed` löst an der Stelle einen Fehler aus, an der die Route registriert
wird. Bei einem App-Scope, den das antwortende Backend nicht deklariert, erhält
jeder Aufrufer – auch ein Administrator – ein `500 SCOPE_NOT_DECLARED`.

## Herunterfahren

Übergeben Sie bei `initializeRebaseBackend` das Backend an den integrierten
Helfer, anstatt einen eigenen Signal-Handler zu schreiben. Er leert laufende
HTTP-Verbindungen (Drain), stoppt den Cron-Scheduler, baut Realtime ab, schließt
den SMTP-Pool, sobald nichts mehr gesendet werden kann, schützt vor wiederholten
Signalen und erzwingt das Beenden, falls das Herunterfahren hängt:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

Kombinieren Sie dies **nicht** mit Ihrem eigenen `server.close()`: Das
`shutdown()` dieses Backends schließt den übergebenen Server bereits, und ein
zweites Schließen führt zu einem Deadlock. Ein mit `createRebaseBackend`
erstelltes Backend schließt einen Server nur dann, wenn Sie ihn übergeben:
`backend.shutdown(timeoutMs, { server })`, wie im Beispiel oben auf dieser
Seite gezeigt.

## Postgres-Treiber einbinden

Noch einen Schritt weiter unten funktioniert `@rebasepro/server-postgres`
komplett ohne den Rebase-Server: Öffnen Sie dessen Datentreiber und den
Realtime-Socket in Express, Fastify oder reinem Node und bauen Sie den Rest
selbst zusammen. Siehe
[Postgres-Treiber einbinden](/docs/backend/embedding-postgres-driver/).

## CORS für ein Browser-Frontend

Ein Custom-Server verwaltet seine eigene CORS-Konfiguration, und ein Frontend
auf einem anderen Origin kann nur diejenigen Response-Header lesen, die er
explizit freigibt (expose). Geben Sie diejenigen frei, die das SDK liest, da
andernfalls `etagOf(row)` dort immer `undefined` ist – ein `ifMatch`-Schreibvorgang
wird dann ohne `If-Match` gesendet – und bei einem 429-Fehler geht das
`Retry-After` verloren:

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

`CORS_EXPOSED_HEADERS` ist die Liste, die die Runtime selbst freigibt. Ein
Header, den das SDK in einer späteren Version zu lesen beginnt, erreicht Ihr
Frontend somit ohne Änderungen hier. Sie umfasst `ETag`, `Retry-After`,
`X-Request-ID`, die drei `X-RateLimit-*`-Header und `Preference-Applied`, plus
`Location`, `Upload-Offset` und `Rebase-Upload-Result`, mit denen ein
fortsetzbarer Upload (Dateien über 8 MiB) antwortet, sowie
`X-Rebase-Simulated-Context`, der angibt, als was die simulierte Anfrage eines
Administrators ausgeführt wurde. Ohne die drei Upload-Header kann das SDK einem
Upload von einem anderen Origin nicht folgen und sendet stattdessen jede Datei
als eine einzige Multipart-Anfrage.

Die Rebase-Runtime und das mit Eject exportierte Backend senden diese Liste bereits.

## Verwandte Themen

- [Postgres-Treiber einbinden](/docs/backend/embedding-postgres-driver/) — der Datentreiber und der Realtime-Socket allein, in Express
- [Skripte und die Konsole](/docs/backend/scripts/) — die Projektdaten aus einem Skript, einem Test oder einer REPL, ganz ohne Server
- [Backend-Übersicht](/docs/backend/) — wo sich die einzelnen Optionen befinden, wenn stattdessen die Runtime bootet
- [Aufgeteilte Prozesse](/docs/deployment/split-processes/) — die Rollen, die ein Custom-Server reproduzieren muss
- [Speicherkonfiguration](/docs/backend/storage/) — die Quellen, die ein Custom-Server selbst auflösen muss
