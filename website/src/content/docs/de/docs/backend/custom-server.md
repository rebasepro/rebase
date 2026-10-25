---
sourceHash: 6f3e503eb493c0cf
title: Integration eines eigenen Servers
sidebar_label: Eigener Server
description: Bauen Sie das Rebase-Backend aus öffentlichen Bausteinen in Ihrem eigenen Server – createRebaseBackend, seine Routengruppen, mount, attachRealtime und start – oder betten Sie den Postgres-Treiber in Express ein.
---

# Integration eines eigenen Servers

`initializeRebaseBackend` ist eine Abkürzung. Es baut das gesamte Backend, bindet es
unter `/api` in Ihre Hono-App ein, hängt den Realtime-Socket an Ihren HTTP-Server und
startet die Hintergrundarbeit, alles in einem Aufruf. Wenn Sie genau das möchten,
verwenden Sie es.

Wenn nicht, gehen Sie einen Schritt tiefer. Jeder Teil dieses Aufrufs ist ein
öffentlicher Baustein, den Sie selbst aufrufen können: Bauen Sie das Backend, binden Sie
dann alles oder nur die gewünschten Routengruppen unter den gewünschten Pfaden ein und
entscheiden Sie, welcher Prozess die Timer startet. Der letzte Abschnitt geht noch einen
Schritt weiter und bettet allein den Postgres-Treiber in eine Express-App ein.

## Umgebungskonfiguration

Rebase stellt mit `loadEnv()` in `@rebasepro/server` ein zentrales Hilfsprogramm bereit, das Ihre Umgebungsvariablen anhand eines strikten Zod-Schemas validiert. Rufen Sie es **nach** dem Laden Ihrer `.env`-Datei auf:

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

Der Import von `z` aus `@rebasepro/server` ist neu. In Version 0.17 und
früher exportierte das Paket kein `z`: Importieren Sie es aus `zod` passend zur Major-Version,
die die Runtime verwendet, und lassen Sie Ihren Bundler die beiden Kopien deduplizieren.

:::caution[Zwei Kopien von Zod]
Zwei gleichzeitig geladene Kopien von Zod haben diesen Aufruf früher stillschweigend kaputt gemacht. `loadEnv` kombinierte die Schemas mit `.merge()`, das ein Schema der anderen Kopie akzeptiert und anschließend jedes Feld mit einem `.default()` ablehnt. Der Server fuhr hoch, meldete Erfolg und führte keinen seiner Crons aus; keine Fehlermeldung erwähnte Zod.

`loadEnv` validiert jetzt das Basisschema und Ihr `extend`-Schema jeweils mit einem eigenen `.parse()`, sodass ein Schema, das von einer anderen Kopie von Zod erstellt wurde, funktioniert. Die Runtime stellt `zod` bereit, und die `backend/package.json` des Scaffolds führt es in dem Bereich auf, den `@rebasepro/server` verwendet, sodass eine einzige Kopie installiert wird: Halten Sie die beiden gleich.
:::

**Wichtigste Verhaltensweisen:**
- Generiert in der Entwicklungsumgebung `JWT_SECRET` und `REBASE_SERVICE_KEY`, wenn sie nicht gesetzt sind, sodass Sie ohne manuelle Einrichtung starten können, und legt sie in `.rebase-dev-secrets.json` ab, damit ein Neustart niemanden abmeldet.
- Blockiert automatisch generierte Secrets in der Produktionsumgebung – Sie müssen diese explizit setzen.
- Prüft, ob in der Produktionsumgebung `CORS_ORIGINS` oder `FRONTEND_URL` gesetzt ist.
- Verweigert einen `extend`-Wert, der kein Zod-Schema ist.
- Wirft einen `Error`, der jede fehlende oder falsche Variable nennt, etwa `DATABASE_URL: is required`, mit den Issues von Zod in seiner Eigenschaft `issues`. Unter 0.24 wirft es Zods eigenen `ZodError`, der keine Variable nennt, wenn niemand ihn abfängt.

Die vollständige Liste der unterstützten Variablen finden Sie in der `.env.example`-Datei der bereitgestellten Scaffold-App.

## Ein Schritt unter `initializeRebaseBackend`

Unter 0.24 ist
`initializeRebaseBackend` der einzige Zugang, und keiner der folgenden Bausteine
ist exportiert.

`initializeRebaseBackend` besteht aus diesen Aufrufen und aus nichts sonst:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({ ...options, provision: true });
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Das `shutdown()`, das es zurückgibt, schließt auch den Server, der ihm übergeben
wurde. Hier dasselbe, ausgeschrieben als `backend/src/index.ts` eines Projekts, bereit
zum Ändern. `rebase dev` führt diese Datei aus, wenn ein Projekt eine hat, anstelle des
eigenen Starts der Runtime. In ein Scaffold-Projekt eingefügt, liefert sie aus, was die
Runtime ausgeliefert hat: die API auf dem Port, den `rebase dev` gewählt hat, Anmeldung
und Registrierung mit der Users-Collection des Projekts, die Funktionen in
`backend/functions/`, die Cron-Jobs in `backend/crons/`, die in `config/resources.ts`
deklarierten Buckets und das CORS, das das Admin-Panel auf seinem eigenen Port braucht.

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
import "../../config/resources";
import usersCollection from "../../config/collections/users";
import { storageAuthorize } from "../../config/storage";

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
    collectionsDir: path.join(root, "config/collections"),
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        collection: usersCollection,
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

Die Pfade sind die des Scaffolds. Die Datei verlässt sich auf das, was `rebase dev`
setzt: den gewählten Port in `PORT`, die verwaltete Datenbank in `DATABASE_URL` und die
`.env` des Projekts in `DOTENV_CONFIG_PATH`. `loadEnv()` validiert, was darin steht, und
erzeugt in der Entwicklung `JWT_SECRET`, wenn es nicht gesetzt ist. Lauschen Sie auf
einem anderen Port, erreicht das Admin-Panel den Server nicht; überspringen Sie
`loadEnv()`, ist ohne `JWT_SECRET` die Anmeldung aus.
`rebase dev` wartet außerdem auf die Zeile `Server running at http://localhost:<port>`,
bevor es das Backend als gestartet meldet. Die `auth`-Optionen sind die des Scaffolds;
die Runtime liest zusätzlich die OAuth-Provider, E-Mail und die übrigen `AUTH_*`-Variablen,
geben Sie also die an, die Sie nutzen, wie [Authentifizierung](/docs/backend/authentication/)
es beschreibt. Ebenso liefert die Datei das gebaute Admin-Panel in Produktion nicht aus:
Der Entrypoint, den [`rebase eject`](/docs/cli/) schreibt, tut das mit `serveSPA` und
öffnet eine Verbindung je Datenbank, die in `config/resources.ts` deklariert ist.

`createRebaseBackend` nimmt dieselben Optionen wie `initializeRebaseBackend`, ohne
`app`, `server` und `basePath` und mit verpflichtendem `provision`. Es baut alles:
Es öffnet die Datenbank, richtet Auth und Storage ein, lädt die Funktionen und
Cron-Jobs und baut jede Routengruppe sowie den In-Process-Client. Es bindet nichts
ein, startet keinen Timer und fügt keinen Prozess-Listener hinzu. Jedes Weitere ist
ein Aufruf, den Sie machen oder weglassen:

| Aufruf | Was er tut | Lassen Sie ihn weg, und |
|---|---|---|
| `installUnhandledRejectionHandler()` | Protokolliert eine Promise-Rejection, die niemand behandelt hat, etwa ein Fire-and-forget-Aufruf in einer benutzerdefinierten Funktion, statt Node den Prozess beenden zu lassen. Prozessweit, daher ist es die Entscheidung des Prozesses, nicht eines Backends. Gibt eine Funktion zurück, die ihn wieder deinstalliert, oder `undefined`, wenn bereits einer installiert war oder `REBASE_EXIT_ON_UNHANDLED_REJECTION` gesetzt ist. | beendet eine unbehandelte Rejection den Prozess, Nodes Standard |
| `setDefaultBackend(backend)` | Macht dieses Backend zum [Prozess-Standard](#mehrere-backends-in-einem-prozess): dem Backend, für das `import { rebase }` und der Rest der API auf Modulebene antworten, wenn sie außerhalb der Requests, Cron-Läufe und Jobs aufgerufen werden, die ein Backend bedient | diese API hat dort kein Backend, für das sie antworten könnte |
| `backend.mount(app, { basePath })` | Jede Routengruppe unter `basePath` (Standard `/api`), hinter der prozessweiten Middleware: Request-IDs, das Body-Limit, Komprimierung, CSRF, das Request-Log und der JSON-Envelope für Fehler und unbekannte Pfade. Dazu das JWKS-Dokument, der MCP-Server, die OpenAPI-Docs und die alten Routen-Aliasse. | nichts wird über HTTP ausgeliefert; `backend.rebase` und `backend.fetch` funktionieren weiterhin |
| `backend.attachRealtime(server, { path })` | Der Realtime-Socket auf `server`, der Upgrades nur auf `path` beantwortet | es gibt keine Live-Abfragen |
| `backend.start()` | Der Cron-Scheduler, die Job-Worker, die Bereinigungsläufe für abgelaufene Tokens und die History-Aufbewahrung, der Metrik-Sampler und das geplante RLS-Audit, jeweils dort, wo `ownership` sie diesem Prozess zuweist. Kann gefahrlos zweimal aufgerufen werden. | keines davon läuft, was ein Prozess, der Requests bedient, in einem [getrennten Deployment](/docs/deployment/split-processes/) auch will |
| `backend.shutdown(timeoutMs, { server })` | Stoppt, was `start()` und `attachRealtime()` gestartet haben, und wartet auf laufende Cron-Läufe und Jobs. Schließt `server` nur, wenn Sie ihn übergeben. | |

Der Standard-`path` des Sockets ist der Basispfad, der an `mount()` übergeben wurde,
ohne ein abschließendes `/api`, sodass `/api` zu `/` und `/x/api` zu `/x` wird; ein Basispfad, der nicht auf `/api` endet, ergibt `/`. Dort
wählt sich das SDK ein, denn es verbindet sich mit seiner `baseUrl`, während seine
HTTP-Requests an `${baseUrl}/api` gehen. Ein Upgrade auf jeden anderen Pfad bleibt den
übrigen `upgrade`-Listenern des Servers überlassen, sodass Ihre App auf demselben
`http.Server` einen eigenen WebSocket-Server betreiben kann.

### Was das Erstellen eines Backends verändern darf: `provision`

Das Erstellen eines Backends kann DDL ausführen, daher verlangt `createRebaseBackend`
von Ihnen eine Entscheidung:

| `provision` | Legt an | Für |
|---|---|---|
| `true` | Alles, was das Backend ausliefert: die Collection-Tabellen und ihre RLS-Policies, die Änderungserfassung für Realtime, die Rolle, als die Requests laufen, und die eigenen Tabellen des Frameworks (API-Schlüssel, Cron-Läufe, Jobs, Metriken). | ein Deployment mit einem einzigen Prozess; das, was `initializeRebaseBackend` übergibt |
| `false` | Nichts, weder beim Booten noch später: Auch die Tabellen, die andere Backends bei der ersten Nutzung anlegen (Idempotenzschlüssel, Cron-Claims), werden nicht angelegt. Das Schema muss bereits vorhanden sein, angewendet durch `rebase db push`, eine Migration oder einen anderen Prozess. Fehlende Auth-Tabellen verweigern den Start; eine fehlende optionale Tabelle schaltet ihre Funktion ab und wird im Log genannt. | ein Skript, ein Test, eine REPL, ein Prozess, der nur liest, eine Datenbank, die nur Ihr Änderungsprozess ändern darf |
| `{ collections: false, realtime: false }` | Die Tabellen des Frameworks und die Rolle, aber weder das Collection-Schema noch die Änderungserfassung. | ein Prozess, der in einem getrennten Deployment das Schema nicht besitzt |

Es ist mit Absicht eine Option und kein späterer Schritt. Der Treiber liest die
Tabellen beim Öffnen und hängt die Änderungserfassung an die an, die dann existieren.
Ein danach aufgerufenes `provision()` würde laufen, nachdem der Treiber bereits
entschieden hätte, was existiert. `REBASE_MIGRATE_ON_BOOT=none` schaltet das
Collection-Schema weiterhin für jedes Backend im Prozess ab. <span class="since-badge" data-since="0.26">Seit 0.26</span> `initializeRebaseBackend` übergibt `false`, wenn `REBASE_PROVISION=false` gesetzt ist.

## Nur die gewünschten Gruppen einbinden

`backend.routes` enthält die Routengruppen. Jede ist eine Hono-Sub-App, die Sie für
sich allein unter jedem Pfad einbinden können:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, collections, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`collections` ist das Array, das die `config/collections/index.ts` eines Scaffolds exportiert. Es trägt die `defaultSecurityRules` dieses Index, wie `collectionsDir` es tut, sodass das Backend die Policies anlegt, die `rebase db push` anlegen würde. Ein eigenes Array trägt nur die Regeln, die seine Collections deklarieren, und `provision: true` macht eine Collection, die keine deklariert, nur für Admins zugänglich und verwirft die Policies, die Rebase zuvor für sie generiert hat, auf jedem Server, der die Datenbank teilt.

Der Index des Scaffolds wendet die Standards auf sein Array an. Kopieren Sie in einem unter 0.24 erstellten Projekt diese Schleife aus der `config/collections/index.ts` eines neuen Scaffolds, oder übergeben Sie `collectionsDir`.

| Gruppe | Normalerweise unter | Liefert |
|---|---|---|
| `routes.auth()` | `/api/auth` | Anmeldung, Sitzungen, OAuth, Passwort-Reset, `GET /config`, die eigenen API-Schlüssel des Aufrufers und den Scope-Katalog |
| `routes.data()` | `/api/data` | die REST-Routen der Collections und ihre History |
| `routes.storage()` | `/api/storage` | den Dateispeicher oder den Router, der `STORAGE_NOT_CONFIGURED` beantwortet |
| `routes.functions()` | `/api/functions` | Ihre [benutzerdefinierten Funktionen](/docs/backend/custom-functions/) oder den Weiterleiter an den Prozess, der sie ausliefert |
| `routes.admin()` | `/api/admin` | Benutzer und Rollen, Service-Schlüssel, Schema-Bearbeitung, Storage-Wartung, Backups, das RLS-Audit, den SQL-Export, das Entwicklungs-Postfach und die Logs |
| `routes.cron()` | `/api/admin/cron` | die Cron-Admin-Oberfläche |
| `routes.meta()` | `/api/meta` | den Projektvertrag, den ein generiertes SDK liest |

Jede Gruppe bringt die Middleware mit, die sie braucht: den Auth-Kontext, der `user`,
`driver` und `scopes` des Aufrufers an den Request hängt, ihre Rate-Limits und ihr
Admin-Gate. Daher antwortet sie überall gleich, wo sie eingebunden ist, auch unter
einem parametrisierten Pfad wie `/:tenant/data`. Eine Gruppe liest außerdem, wo sie
eingebunden wurde, sodass die Daten-API weiterhin jede Collection ihrer Datenquelle
zuordnet und die Funktionsliste die Pfade nennt, unter denen sie tatsächlich
ausgeliefert wird.

Was eine Gruppe nicht mitbringt, ist die prozessweite Middleware, die `mount()` vor
alles setzt. Wenn Sie Gruppen einzeln einbinden, fügen Sie davon selbst hinzu, was Sie
möchten: ein Body-Limit (`bodyLimit` aus `hono/body-limit`), Komprimierung und den
JSON-Fehler-Envelope:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Jeder Aufruf gibt einen frischen Router über denselben Handlern zurück, sodass Sie eine
Gruppe an zwei Stellen einbinden können. Wer eine Gruppe anfordert, deren Oberfläche bei
der Erstellung dieses Backends abgeschaltet wurde (`surfaces: { data: false }`), erhält
einen Fehler, weil das Backend sie nie gebaut hat. Die OpenAPI-Docs und der MCP-Server
haben keine Gruppe: Sie beschreiben die URLs des `mount()`-Layouts, daher liefert nur
`mount()` sie aus.

## Das Backend ohne Server

Ein gebautes Backend lässt sich nutzen, ohne etwas einzubinden. `backend.rebase` ist
sein In-Process-Client, und `backend.fetch(request)` beantwortet einen `Request`, wie es
`mount()` unter `/api` täte:

```typescript
const backend = await createRebaseBackend({ database: adapter, collections, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Die Control-Plane-Aufrufe auf diesem Client (`rebase.auth`, `rebase.admin`,
`rebase.functions` und `rebase.cron`) erreichen die eigenen Routen des Backends
In-Process. Sie funktionieren unabhängig davon, wo oder ob Sie die Gruppen eingebunden haben, und
Middleware, die Sie Ihrer eigenen App hinzugefügt haben, läuft dafür nicht.

Für ein Skript, das nur die Daten braucht, öffnet [`openRebase`](/docs/backend/scripts/)
die Datenbank, ohne überhaupt ein Backend zu bauen.

## Mehrere Backends in einem Prozess

Unter 0.24 sind die
JWT-Konfiguration, das Zugriffsmodell, der API-Schlüssel-Speicher, der
Rate-Limit-Speicher und `rebase` Prozess-Globals, und das zuletzt gebaute Backend
gewinnt sie alle.

`createRebaseBackend` schreibt kein Prozess-Global. Jedes Backend hält seinen eigenen
Zustand in `backend.services`, sodass zwei davon in einem Prozess zwei bleiben: Jedes
signiert und verifiziert Sitzungen mit seinen eigenen Schlüsseln, beurteilt Scopes nach
seinen eigenen Rollen, prüft API-Schlüssel in seinem eigenen Speicher und zählt
Rate-Limits in seinem eigenen Speicher.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, collections, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, collections, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Was es ist |
|---|---|
| `jwt` | Der JWT-Dienst des Backends: signiert und verifiziert Sitzungen, Download-Links und seine übrigen Tokens und liefert sein JWKS aus |
| `access` | Sein Zugriffsmodell (Rollen zu Scopes) und der Resolver für den Besitzer eines persönlichen Schlüssels |
| `apiKeyStore` | Wo seine API-Schlüssel geprüft werden |
| `rateLimitStore`, `authLimiters` | Seine Rate-Limit-Zähler und die Limiter auf seinen Auth-Routen |
| `collections()` | Die Collections, die es ausliefert |
| `topics`, `queues` | Seine Topic- und Queue-Runtimes |

Ein Backend ohne `auth.jwtSecret`, etwa eines, dessen `auth` ein Adapter ist, signiert
nichts selbst, daher folgt sein `services.jwt` dem Prozess-Standard.

**Wohin `rebase` geht.** Innerhalb eines Requests, eines Cron-Laufs oder eines Jobs, den
ein Backend bedient, ist `rebase`, ob aus `@rebasepro/server` importiert oder als
`ctx.rebase` erhalten, dieses Backend, und ebenso das `publish` eines Topics und das
`enqueue` einer Queue. Überall sonst (Modulebene, ein Skript, ein Test) antworten sie für
den **Prozess-Standard**, den `setDefaultBackend(backend)` setzt und den
`initializeRebaseBackend` auf sein eigenes Backend setzt. Dasselbe gilt für den Rest der
API auf Modulebene: `verifyAccessToken` und die übrigen JWT-Helfer, `getAccessModel`,
`verifyCredential` und `extractUserFromToken`.

Drei Bausteine arbeiten direkt auf einem Backend, und einer auf gar keinem:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the users collection.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The users collection
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Eine erzeugte Sitzung wird bei jeder Anfrage wie jede andere geprüft, daher muss ihre
uid ein vorhandener Benutzer sein: Bei einer uid ohne Benutzer wird die Anfrage verweigert.

`verifyCredential` kommt zum selben Urteil wie die Routen: Eine Sitzung, von der sich ihr Eigentümer abgemeldet hat, eine uid ohne Benutzer und ein deaktiviertes Konto ergeben null, und die Rollen sind die, die das Konto jetzt hält. Es wirft, wenn die Datenbank nicht erreichbar ist. Unter 0.24 prüft es nur die Signatur und liest die Rollen aus dem Token.

Jede Routengruppe setzt `c.var.services` selbst. Eine Route außerhalb der Gruppen, die
`requireAuth`, `requireScope` oder einen anderen Guard aus `@rebasepro/server` verwendet,
liest es dort und fällt auf den Prozess-Standard zurück, wenn es nicht gesetzt ist.
`requireScope` beurteilt den Aufrufer, den `requireAuth` identifiziert hat, und steht
deshalb hinter `requireAuth`: Allein verweigert es jede Anfrage mit einem 401. Es nimmt
einen integrierten Scope oder einen App-Scope, den das Backend unter `auth.scopes` in seiner
Users-Collection deklariert, wie im Kommentar oben.

Ein Name, der kein Scope ist, oder ein falsch geschriebener integrierter wie `data:raed` wirft dort, wo die Route registriert wird. Ein App-Scope, den das antwortende Backend nicht deklariert, beantwortet jeden Aufrufer, auch einen Administrator, mit `500 SCOPE_NOT_DECLARED`. Unter 0.24 antworten beide jedem Aufrufer mit `403 SCOPE_MISSING`.

## Herunterfahren

Ein Backend aus
`createRebaseBackend` ist neu; der Rest dieses Abschnitts gilt auch für 0.24.

Übergeben Sie bei `initializeRebaseBackend` das Backend an den integrierten Helper,
statt einen Signal-Handler von Hand zu schreiben. Er schließt HTTP-Verbindungen
ordnungsgemäß ab, stoppt den Cron-Scheduler, beendet Realtime-Dienste, schließt den
SMTP-Connection-Pool, sobald nichts mehr senden kann, schützt vor wiederholten Signalen
und erzwingt das Beenden, falls der Shutdown hängen bleibt:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, collections });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

Kombinieren Sie ihn **nicht** mit Ihrem eigenen `server.close()`: Das `shutdown()` dieses
Backends schließt den Server, der ihm übergeben wurde, bereits, und ein zweiter
Schließversuch führt zu einem Deadlock. Ein Backend aus `createRebaseBackend` schließt
einen Server nur, wenn Sie ihn übergeben, `backend.shutdown(timeoutMs, { server })`, wie
im Beispiel oben auf dieser Seite.

## Den Postgres-Treiber in Express einbetten

Einen Schritt weiter unten funktioniert `@rebasepro/server-postgres` ganz ohne den
Rebase-Server. Es hängt von Drizzle und Nodes `http.Server` ab, sodass Sie den
Daten-Treiber und den Realtime-Socket in Express, Fastify oder reinem Node öffnen
können. Auf dieser Ebene setzen Sie das Backend selbst zusammen: Es gibt keine
Auth-Routen, kein Storage und keine Admin-API, es sei denn, Sie bauen sie.

### 1. Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

### 2. Den Treiber und den Socket öffnen

`openPostgresDriver`
und `postgresDriverConfigFromEnv` sind exportiert. Unter 0.24 öffnen Sie den Treiber
mit `createPostgresBootstrapper(pgConfig).initializeDriver(…)`, dessen `internals`
untypisiert ist.

```typescript
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import {
    createPostgresDatabaseConnection,
    createPostgresWebSocket,
    openPostgresDriver,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { collections } from "./collections";

async function startServer() {
    const app = express();

    // The socket needs the raw http.Server, so listen on it, not on app.listen.
    // 64 KB of headers, as the Rebase runtime takes: a vector search in the URL
    // outgrows Node's 16 KB.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, app);

    const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

    // The environment, read the way the Rebase server's boot reads it:
    // DATABASE_READ_URL, DATABASE_DIRECT_URL and the REALTIME_* variables.
    // Leave this call out and the driver reads no environment variable at all.
    const pgConfig = postgresDriverConfigFromEnv({ connection: db, connectionString });

    // The collections' tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { collections });

    // The realtime socket. It answers upgrades on `path` only, so a WebSocket
    // server of your own can share the same http.Server.
    createPostgresWebSocket(
        server,
        internals.realtimeService,
        internals.driver,
        { requireAuth: true, jwtSecret: process.env.JWT_SECRET },
        undefined,
        { path: "/" }
    );

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // A write through the driver
    app.post("/api/products", async (req, res) => {
        try {
            const result = await driver.save({
                path: "products",
                values: req.body,
                status: "new"   // required: "new" | "existing" | "copy"
            });
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Drizzle directly, typed: `internals.db`, and `internals.readDb` when a
    // read replica is configured.
    app.get("/api/stats", async (req, res) => {
        const result = await internals.db.execute(sql`select count(*) from products`);
        res.json(result.rows);
    });

    const port = process.env.PORT || 3000;
    server.listen(port);

    // Graceful shutdown: stop listening, stop the LISTEN client, evict branch
    // pools, then end the main pool.
    const handleShutdown = (signal: string) => {
        console.log(`Shutdown triggered via ${signal}.`);
        server.close(async () => {
            try {
                await internals.realtimeService.stopListening();
                await internals.poolManager?.shutdown();
                await pool.end();
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

`openPostgresDriver` ist das, was `createPostgresAdapter` ausführt, wenn der
Rebase-Server bootet, nachdem `postgresDriverConfigFromEnv` die Umgebung in die
Konfiguration gelesen hat. Sein zweites Argument sagt, was geöffnet wird: die
`collections`, ob das Öffnen seine eigene DDL ausführen darf (`provision`, Standard
`true`), und welche Rolle dieser Prozess bei Realtime übernimmt (`realtime: false`
für keine).

Es legt keine Collection-Tabelle an, daher antwortet `POST /api/products` gegen eine Datenbank ohne diese Tabelle mit `500` "Table not found for collection 'products'". Legen Sie die Tabellen zuerst an. `rebase db push` tut das aus einem Rebase-Projekt, dessen `config/collections` sie deklariert. In diesem Server fügt `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` vor `openPostgresDriver` die Tabellen und Spalten hinzu, die der Datenbank fehlen, wie es der Boot des Rebase-Servers tut, und ändert nichts, was bereits existiert.

---

## Zentrale Backend-Konzepte

### Read-Replica-Verbindungen
Setzen Sie `readConnectionString` in der Treiberkonfiguration oder die Umgebungsvariable `DATABASE_READ_URL`, die der Boot des Servers und `postgresDriverConfigFromEnv` in sie einlesen, und der Treiber öffnet einen zweiten Verbindungspool gegen Ihr Read Replica, unter `internals.readDb`. Lesezugriffe gehen an das Replica; Schreibzugriffe bleiben auf dem primären Pool.

Die Option `readConnectionString` wird berücksichtigt. Unter 0.24 wurde sie deklariert und ignoriert, und nur `DATABASE_READ_URL` funktionierte.

### Drizzle-Integration
Sie müssen sich nicht zwischen Rebase und Drizzle entscheiden. Der Treiber kompiliert Ihre Schemas dynamisch, und `internals.db` ist der Drizzle-`NodePgDatabase`-Client, typisiert, für rohes SQL oder typsichere Drizzle-Builder parallel zu den REST-Diensten von Rebase.

### Geordnetes Schließen von Verbindungen (Graceful Connection Draining)
In serverlosen Umgebungen oder Orchestratoren (wie Kubernetes) kann das Beenden von Pods zu unterbrochenen Verbindungen führen. Implementieren Sie stets Signal-Handler, die `internals.realtimeService.stopListening()` (wodurch der dedizierte pg LISTEN-Client beendet wird) und `pool.end()` aufrufen, damit auf Ihrem Datenbankserver keine Verbindungsslots verloren gehen.

### CORS für ein Browser-Frontend
Ein eigener Server besitzt seine eigene CORS-Konfiguration, und ein Frontend auf einem anderen Origin kann nur die Response-Header lesen, die er freigibt. Geben Sie die frei, die das SDK liest, sonst ist `etagOf(row)` dort immer `undefined` — ein `ifMatch`-Schreibvorgang geht dann ohne `If-Match` hinaus — und ein 429 verliert sein `Retry-After`:

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
Header, den das SDK in einer späteren Version zu lesen beginnt, erreicht Ihr Frontend also ohne
Änderung an dieser Stelle. Sie besteht aus `ETag`, `Retry-After`, `X-Request-ID`, den drei
`X-RateLimit-*`-Headern und `Preference-Applied`, dazu `Location`,
`Upload-Offset` und `Rebase-Upload-Result`, worin eine fortsetzbare Übertragung (Dateien über
8 MiB) antwortet, sowie `X-Rebase-Simulated-Context`, das benennt, als was die simulierte Anfrage
eines Administrators ausgeführt wurde. Ohne die drei Upload-Header kann das SDK keine Übertragung von einem anderen Origin aus
verfolgen und sendet jede Datei stattdessen als eine einzige Multipart-Anfrage. Schreiben Sie die
Liste auf 0.24 von Hand aus.

Die Rebase-Runtime und das ejected Backend senden diese Liste bereits. Auf 0.23
geben sie keinen dieser Header frei, sodass ein Frontend auf einem anderen Origin kein `ETag` lesen kann.

## Verwandte Themen

- [Skripte und die Konsole](/docs/backend/scripts/) – Die Daten des Projekts aus einem Skript, einem Test oder einer REPL, ganz ohne Server
- [Backend-Übersicht](/docs/backend/) – Wo die einzelnen Optionen liegen, wenn stattdessen die Runtime startet
- [Getrennte Prozesse](/docs/deployment/split-processes/) – Die Rollen, die ein eigener Server reproduzieren muss
- [Storage-Konfiguration](/docs/backend/storage/) – Die Quellen, die ein eigener Server selbst auflösen muss
