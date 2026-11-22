---
sourceHash: 3d3fc39a95926201
title: Backend-Übersicht
sidebar_label: Backend
description: Das Rebase-Backend bietet einen vollständigen Server mit REST-API, Authentifizierung, Storage, WebSocket-Echtzeit und Entitäts-Historie – alles initialisiert mit einem einzigen Funktionsaufruf.
---

## Übersicht

Das Rebase-Backend ist ein auf [Hono](https://hono.dev/) basierender **Node.js-Server**, der Folgendes bietet:

- **REST-API** — Automatisch generierte CRUD-Endpunkte für jede Tabelle
- **Authentifizierung** — JWT-Tokens, OAuth- und OIDC-Anmeldung, Magic Links, Einmal-Codes, MFA, API-Schlüssel, Benutzer-/Rollenverwaltung
- **Storage** — Datei-Upload/-Download mit lokalem Dateisystem oder S3
- **WebSocket** — Echtzeit-Datensynchronisierung über PostgreSQL LISTEN/NOTIFY
- **Entitäts-Historie** — Audit-Trail für jede Datenänderung
- **Datenbank-Branching** — Sofortige, isolierte Datenbankkopien für Dev/Staging/Testing
- **Cron-Jobs** — Geplante Hintergrundaufgaben mit Monitoring-Dashboard

Alles wird mit einem einzigen Funktionsaufruf initialisiert:

:::note[Wo dieser Code hingehört]
Der folgende Aufruf ist das, was ein **ejected** Backend in `backend/src/index.ts` enthält. In
der **Managed Runtime** gibt es keine solche Datei: Die Runtime führt den Aufruf aus, und
Sie konfigurieren sie über Umgebungsvariablen, die Tabellen, die `backend/schema/index.ts`
exportiert, die Ressourcen, die Sie in `backend/resources.ts` deklarieren (`database()`,
`bucket()`), und zwei Exporte, die sie liest: `storageAuthorize` aus
`backend/storage.ts` und `hooks` aus `backend/hooks.ts`. Jede Seite in diesem
Abschnitt gibt an, welches von beiden für die dokumentierte Option gilt, und nennt diejenigen,
die keine verwaltete Form haben. Exportieren Sie etwas anderes aus diesen beiden Modulen,
warnt die Runtime beim Booten davor, anstatt es stillschweigend zu ignorieren; exportieren Sie etwas,
das durch eine Ressourcendeklaration ersetzt wurde, verweigert der Bootvorgang dies namentlich zusammen mit der
Zeile, die stattdessen in `backend/resources.ts` geschrieben werden muss.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import path from "node:path";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    schemaDir: path.resolve(__dirname, "../schema"),
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true
});
```

Dieser eine Aufruf ist
eine Abkürzung für öffentliche Schritte: `installUnhandledRejectionHandler` verhindert, dass ein unbehandelter Rejection-Fehler den Prozess beendet, `createRebaseBackend` erstellt das Backend,
`setDefaultBackend` macht es zu demjenigen, für das die API auf Modulebene antwortet, und
`mount`, `attachRealtime` und `start` stellen es bereit. Um nur bestimmte Routengruppen
einzubinden, sie auf anderen Pfaden bereitzustellen, die Timer einem anderen Prozess zu überlassen oder zwei
Backends in einem Prozess auszuführen, rufen Sie die Schritte selbst auf. Siehe
[Integration benutzerdefinierter Server](/docs/backend/custom-server/).

## Wo sich die einzelnen Optionen befinden

Dieser Aufruf ist die **ejected** Form – diejenige, die Sie nach `rebase
eject` oder in einem benutzerdefinierten Server selbst schreiben. Ein per Scaffolding
erstelltes Projekt enthält ihn nicht: Die veröffentlichte Runtime bootet das Projekt, und jede Option
wird als Umgebungsvariable in `.env`, als Export aus `backend/storage.ts` oder `backend/hooks.ts`
oder als ein Verzeichnis übergeben, das das Bundle in `rebase.json` deklariert.

Beide Wege führen zur selben `RebaseBackendConfig`. Dies ist die vollständige Übersicht.

| Option | Managed Runtime |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (Standard `/api`) |
| `tables`, `schemaDir`, `defaultRls` | das Verzeichnis `backend/schema/` (der Schlüssel `tables` in `rebase.json`): die Tabellen und das `defaultRls`, das dessen `index.ts` exportiert |
| `rpc` | <span class="since-badge" data-since="0.35">Seit 0.35</span> die `defineRpc`-Deklarationen, die `backend/schema/index.ts` exportiert — siehe [SQL-Funktionen als RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus eine `database("<key>")`-Deklaration in `backend/resources.ts` für jede Datenbank über die Standarddatenbank hinaus |
| `auth` | `JWT_SECRET`, die `OAUTH_*`-Variablen und die Tabelle, die `backend/schema` mit `defineAuthTable` deklariert |
| `storage` | die `STORAGE_*`-Variablen, plus eine `bucket("<key>")`-Deklaration in `backend/resources.ts` für jeden Bucket über den Standard-Bucket hinaus |
| `storageAuthorize` | `export const storageAuthorize` aus `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` aus `backend/hooks.ts` — globale Tabellen-Hooks |
| `history` | `REBASE_HISTORY` (standardmäßig aktiviert) — nur die boolesche Form |
| `push` | `REBASE_PUSH`, mit `REBASE_VAPID_*` für die Schlüssel — nur die boolesche Form |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; nicht gesetzt stellt `/api/docs` für die Zielgruppe des Schema-Endpunkts bereit, `true` veröffentlicht es mit der Swagger UI, `false` belässt es hinter dem Admin-Gate |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` und seine `REBASE_LIVE_SCHEMA_*`-Anmeldeinformationen — nur die Repository-Form |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — siehe [Getrennte Prozesse](/docs/deployment/split-processes/) |
| `corsHandled` | CORS wird von der Runtime anhand von `CORS_ORIGINS` eingerichtet |
| `schemaVersion`, `runtimeVersion` | der Build stempelt beides in das Bundle ein |
| `app`, `server`, `provisioningDriverResult` | die Runtime erstellt sie |

### Optionen ohne verwaltete Route

Diese verfügen über keine Umgebungsvariable und keinen Modul-Export. Sie sind
nur über einen manuell geschriebenen Aufruf von `initializeRebaseBackend` erreichbar – `rebase eject` oder ein
[benutzerdefinierter Server](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` in seiner Objektform (`{ retention }`) ·
`push` in seiner Objektform (`{ allowedHosts, sender, vapid }`)

`schemaEditor` ist in einem erstellten Bundle zwangsweise deaktiviert: Der Editor schreibt die
*Quelldateien* in `backend/schema` neu, und ein Bundle enthält kompilierten Output.

## Was erstellt wird

Nach der Initialisierung werden diese Routen bereitgestellt:

| Pfad | Zweck |
|------|---------|
| `/api/auth/*` | Authentifizierung (Registrierung, Login, Refresh, OAuth, Magic Links, Einmal-Codes, MFA) |
| `/api/admin/*` | Benutzer, Rollen, Service-Schlüssel, Cron, Backups, Logs und Schema, jeweils hinter einem eigenen [Scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Datei-Upload, -Download und -Löschung |
| `/api/data/:slug` | CRUD-Operationen pro Tabelle (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Änderungshistorie der Entität (wenn aktiviert) |
| `/api/docs` | OpenAPI-Spezifikation der Tabellen, die der Aufrufer sehen darf (öffentlich mit `enableSwagger: true`; nur für Admins mit `false`) |
| `/api/swagger` | Swagger UI (mit `enableSwagger: true`, nur außerhalb der Produktion) |
| `/api/schema/tables` | Die Tabellen, die dieses Backend bereitstellt, so wie der Aufrufer sie sehen darf — siehe [Endpunkte](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | Die Schema-Version, die Runtime und jede Tabelle so, wie ein Administrator sie sieht (erfordert `schema:read`) |
| `/api/meta/schema-version` | Ein Versions-String für dieses Schema (nicht authentifiziert) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">Seit 0.35</span> Die mit `defineRpc` deklarierten SQL-Funktionen, aufgerufen als der Aufrufer — siehe [SQL-Funktionen als RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Benutzerdefinierte Funktionsrouten (wenn `functions` oder `functionsDir` gesetzt ist) |
| `/api/push/*` | [Push-Benachrichtigungs-Abonnements](/docs/backend/push-notifications/) (wenn `push` aktiviert ist) |
| `/api/admin/cron/*` | Cron-Job-Verwaltung (`cron:read` / `cron:write`, wenn `crons` oder `cronsDir` gesetzt ist) |
| WebSocket on upgrade | Echtzeit-Abonnements, auf `/` für eine API unter `/api` |

---

## Der Initialisierungslebenszyklus

Wenn Sie `initializeRebaseBackend()` aufrufen, löst das Framework eine sequentielle, 5-stufige Boot-Sequenz aus:

```
[Start Boot]
     │
     ▼
1. Configuration (the database adapter, the auth and storage options you passed)
     │
     ▼
2. Schema Loading (imports backend/schema/index.ts, compiles every table — a problem in any refuses the boot)
     │
     ▼
3. Database Bootstrapping (creates schemas/auth/helper SQL functions, as `provision` allows)
     │
     ▼
4. Service Initialization (Auth, Storage S3/Local client instances, Cron store seeding)
     │
     ▼
5. Route Mounting & Edge Loading (Hono controllers, custom functions, WebSocket binding)
     │
     ▼
[Boot Complete]
```

---

## Was passiert, wenn das Booten fehlschlägt

**Das Booten schlägt unübersehbar fehl („fail loud“).** Wenn die Datenbank nicht erreichbar ist, die Anmeldedaten
falsch sind oder das Schema nicht kompiliert oder angewendet werden kann, wirft `initializeRebaseBackend`
einen Fehler, es wird nichts ausgeliefert und der Prozess wird mit Exit-Code `1` beendet. Es gibt keinen herabgesetzten Modus
und keinen Teilserver: Ein Container, der seine Datenbank nicht erreichen kann, startet neu, und
der Fehler, der ihn beendet hat, ist der letzte Eintrag in seinen Logs.

Das ist beabsichtigt. Ein Server, der hochfährt und Sign-ins beantwortet, während jede
`/api/data/*`-Route fehlschlägt, ist viel schwerer zu diagnostizieren als einer, der gar nicht erst
hochfährt – und ein Orchestrator kann auf einen Crash-Loop reagieren.

Vor der ersten Abfrage prüft der Bootvorgang die Verbindung und gibt die Diagnose aus: den
Host und Port, die nicht erreicht werden konnten, die Begründung des Treibers selbst (`ECONNREFUSED`,
`password authentication failed for user "app"`) und die Lösung. Siehe
[Fehlerbehebung](/docs/troubleshooting/) für die vollständige Fehlerliste.

### Sobald der Server läuft: `/livez` und `/health`

Zwei Probes, die zwei unterschiedliche Fragen beantworten.

| Pfad | Greift auf die Datenbank zu | Antwortet |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, während der Prozess läuft. Verwenden Sie dies für eine Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine dies nicht tut. Verwenden Sie dies für eine Readiness-Probe. |

Eine Liveness-Probe auf `/health` ist ein erwähnenswerter Fehler: Ein kurzer Datenbankaussetzer würde
dazu führen, dass der Orchestrator einen ansonsten fehlerfreien Prozess beendet, wodurch ein kurzer Ausfall
in eine Neustart-Schleife verwandelt wird.

`/health` erfordert keine Authentifizierung, daher wird nur das Ergebnis und nicht die Ursache veröffentlicht –
außerhalb der Entwicklungsumgebung wird lediglich genannt, welche Datenquelle beeinträchtigt ist, und sonst nichts. Der
Fehlertext des Treibers nennt Host, Port, Datenbankname und Rolle, und dies wird in den
Logs protokolliert. `/health` wird auch unter `basePath` (`/api/health`) bereitgestellt;
`/livez` nicht.

Beide Probes stammen aus der Managed Runtime. Ein ejected `backend/src/index.ts` stellt
`/health` und `/api/health` selbst bereit, prüft nur die Standarddatenbank und
verfügt über kein `/livez`, bis Sie eines hinzufügen.

---

## Konfigurationsreferenz

<span class="since-badge" data-since="0.35">Seit 0.35</span> Die `rpc`-Option unten.

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Tables
    tables?: (AnyTableDef | AnyViewDef)[]; // defineTable / defineAuthTable / defineView results
    defaultRls?: DefaultRls;  // What `rls: "inherit"` tables take, when you pass `tables`
    schemaDir?: string;       // The backend/schema directory: loaded when `tables` is absent, and what the schema editor writes
    hooks?: TableHooks;       // Global table hooks, run for every table

    // Database adapter (PostgreSQL, SQLite, etc.)
    database?: DatabaseAdapter;

    // Authentication configuration or custom adapter
    auth?: RebaseAuthConfig | AuthAdapter;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // SQL functions served at /api/rpc/<name> (defineRpc). Read from the
    // schemaDir index when the tables are; pass them as values otherwise.
    rpc?: AnyRpcDef[];

    // Custom API endpoints: values, or a directory of files (not both)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks: values, or a directory of files (not both)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
    cronsDir?: string;         // Auto-load cron jobs from a directory
    cronPersistence?: boolean; // Write run logs to rebase.cron_logs (default: true)

    // HTTP behaviour
    compression?: boolean;     // gzip/deflate for API responses (default: true)
    maxBodySize?: number;      // Request-body ceiling in bytes (default: 10MB; 0 disables)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Schema editing
    schemaEditor?: boolean;   // Force the schema-editor routes on or off

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Fünf davon werden leicht übersehen und verändern ein Verhalten, das Sie andernfalls nur
beobachten können:

| Schlüssel | Standard | Was es tut |
|---|---|---|
| `compression` | `true` | gzip/deflate bei API-Antworten, ausgehandelt über `Accept-Encoding`. Bereits komprimierte, gestreamte und `no-transform`-Bodies bleiben unberührt, ebenso Bodies unter 1 KB (gzip kostet dort mehr als es einspart), daher kann es bedenkenlos aktiviert bleiben – eine große JSON-Liste schrumpft typischerweise um das ca. 20-fache. Setzen Sie dies auf `false`, wenn nginx, Cloudflare oder ein anderer vorgeschalteter Proxy bereits komprimiert, um doppelte Verarbeitung zu vermeiden. Umgebungsvariable: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Obergrenze für Request-Bodies bei API-Routen; `0` deaktiviert sie. Storage-Uploads nutzen das eigene `maxFileSize` (50MB) der Storage-Konfiguration, welches für diese Routen vorrangig ist. Umgebungsvariable: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | aus | **Opt-in.** Eine BaaS-API wird von mobilen Apps, SPAs auf anderen Domains und CLI-Tools aufgerufen, von denen keines einen `Origin` sendet, den eine feste Liste akzeptieren würde – daher ist dies standardmäßig nicht aktiviert. Aktivieren Sie es mit den Origins, die Ihre Browser-Clients verwenden. Keine Umgebungsvariablen-Form: ejecten Sie, um dies zu konfigurieren. |
| `cronPersistence` | `true` | Ob Ausführungsprotokolle in `rebase.cron_logs` geschrieben werden. `false` lässt die Jobs weiterlaufen, behält den Verlauf jedoch nur im Speicher, wodurch das Studio-Panel ihn bei einem Neustart verliert. |
| `schemaEditor` | aktiv außerhalb der Produktion, wenn `schemaDir` gesetzt ist | Erzwingt die Aktivierung oder Deaktivierung der Schema-Editor-Routen. Der Editor schreibt die *Quelldateien* in `backend/schema` um, benötigt also ein Verzeichnis, in das geschrieben werden kann – und ein kompiliertes Bundle hat keines, weshalb ein Deployment ihn niemals enthält. |

Der Rest von `RebaseBackendConfig` ist entweder auf einer eigenen Seite dokumentiert (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) oder als `@internal` markiert:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` und `runtimeVersion` werden von
`bootFromBundle` aus der Umgebung ausgefüllt; die manuelle Übergabe führt zu
Unstimmigkeiten mit der Runtime darüber, was dieser Prozess darstellt.

## Die Backend-Instanz

`initializeRebaseBackend` gibt das erstellte Backend zurück, bereits eingebunden und
gestartet. Sein Typ ist `RebaseBackendInstance`, was `RebaseBackend` entspricht – dem
Typ, den `createRebaseBackend` zurückgibt:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.getTableDescriptors() // The compiled tables, as GET /api/schema/tables serves them
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when crons or cronsDir is set)
instance.jobQueue            // Durable job queue (when jobs are enabled)
instance.setTableHooks(slug, hooks) // Replace a table's hooks
instance.shutdown()          // Drain and stop; also closes the server it was given
```

Es enthält außerdem
`rebase`, den In-Process-Client, `fetch(request)`, `routes`, die Routengruppen
als Hono-Sub-Apps, `services`, eigene JWT-Schlüssel, das Zugriffsmodell, den API-Schlüssel-Speicher und
Rate-Limiter sowie `verifyCredential(token)`; siehe
[Integration benutzerdefinierter Server](/docs/backend/custom-server/).

> **Hinweis:** Obwohl die `instance` diese internen Dienste offenlegt, sollte Anwendungscode (wie benutzerdefinierte Funktionen und Cron-Jobs) das `rebase`-Singleton aus `@rebasepro/server` verwenden, um mit der Backend-API zu interagieren. Innerhalb eines Requests, eines Cron-Laufs oder Jobs ist `rebase` das Backend, das diesen bedient; andernorts ist es der Prozessstandard, den `initializeRebaseBackend` auf sein Backend setzt.

## REST-API

Die REST-API wird aus Ihren Tabellen generiert. Jede Tabelle erhält diese Endpunkte:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten — Filtern, Sortieren, Paginierung und Suche sind Query-Parameter |
| `GET` | `/api/data/:slug/count` | Wie viele Zeilen dieselbe Abfrage matcht |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, optional gruppiert |
| `GET` | `/api/data/:slug/:id` | Einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Neue Entität erstellen |
| `PATCH` | `/api/data/:slug/:id` | Die gesendeten Felder aktualisieren |
| `DELETE` | `/api/data/:slug/:id` | Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer einzigen Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer einzigen Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Zeilen in einer einzigen Transaktion löschen |

### Query-Parameter

Es gibt eine eigene Referenz dafür, und es ist nicht diese Seite. Die [REST-API](/docs/backend/api/) dokumentiert beide Abfragedialekte, die der Server akzeptiert – das
PostgREST-ähnliche Format `?column=op.value` und das JSON-Format `?where=` – zusammen mit
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` und Vektorsuche.
[Endpunkte](/docs/backend/endpoints/) ist der Index aller vom Server bereitgestellten Routen,
einschließlich der generierten.

Ein Parameter, den der Server nicht reserviert, wird als Filter auf die Spalte dieses
Namens interpretiert, sodass ein frei erfundener Parameter nicht fehlschlägt: Er liefert stillschweigend keine Treffer zurück.

## WebSocket

Der WebSocket-Server dockt an denselben HTTP-Server an und bietet Echtzeit-Abonnements. Er reagiert auf Upgrades auf einem einzigen Pfad, `/` für eine API unter `/api`, wohin sich das SDK verbindet, und überlässt jeden anderen Pfad Ihren eigenen `upgrade`-Listenern:

- Abonnieren von **Tabellenänderungen** — Benachrichtigung erhalten, wenn eine beliebige Zeile in einer Tabelle erstellt, aktualisiert oder gelöscht wird
- Abonnieren von **Zeilenänderungen** — Benachrichtigung erhalten, wenn sich eine bestimmte Zeile ändert
- Automatische Handhabung von **Wiederverbindungen** im typisierten SDK

Das Backend nutzt intern PostgreSQL `LISTEN/NOTIFY`. Geben Sie für Deployments mit mehreren Instanzen einen `connectionString` in Ihrem `PostgresBootstrapper` an, um instanzübergreifendes Broadcasting zu ermöglichen.

## Fehlerbehandlung

Jeder Fehler – von jeder Route, in jedem Subsystem – wird in einem einheitlichen Umschlag („envelope“) zurückgegeben:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Feld | Immer vorhanden | Beschreibung |
|-------|:--------------:|------------|
| `message` | ja | Für Personen verfasst, die eine Konsole lesen. Nennt das konkrete Problem, nicht die abstrakte Regel. |
| `code` | ja | `SCREAMING_SNAKE_CASE` und stabil. Dies ist das Feld für Fallunterscheidungen im Code. |
| `details` | nein | Strukturierte Nutzdaten, wenn sich die Ablehnung auf etwas Konkretes bezieht – eine Liste fehlschlagender Pfade, eine Menge unbekannter Felder. |
| `requestId` | nein | Vorhanden, wenn die Anfrage eine ID mitgeführt hat oder ihr eine zugewiesen wurde; spiegelt `X-Request-ID` wider. Geben Sie diese in einem Fehlerbericht an. |

Der HTTP-Status befindet sich auf der Response, nicht im Body. Unterscheiden Sie nach `code`, nicht nach
`message` – Nachrichten sind für Menschen geschrieben und können sich jederzeit ändern.

Das typisierte SDK wandelt jeden dieser Fehler in einen `RebaseApiError` um, der
`status`, `code` und `details` enthält – einschließlich der Fehler, die einen
Server gar nicht erst erreicht haben. Eine abgewiesene Verbindung, ein DNS-Fehler, CORS oder ein Abbruch
kommen als `status: 0`, `code: "NETWORK_ERROR"` an, wobei der eigene Fehler der Runtime in `cause` enthalten ist,
anstatt beliebig abzuweisen, womit `fetch` gerade verwirft. Eine Antwort ohne
Envelope – das 413 eines Proxys, das 502 eines Load Balancers – erhält dennoch einen `code` aus ihrem
Status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), und ein
Client, der außerhalb eines Browsers ohne `baseUrl` erstellt wurde, schlägt mit
`BASE_URL_REQUIRED` statt eines Netzwerkfehlers fehl.
Ein Lesezugriff, der erfolgreich ist,
aber nicht die erwartete Struktur aufweist – ein `204`, ein leerer Body, eine Seite ohne `data`-Liste –,
schlägt mit `UNEXPECTED_RESPONSE` fehl, anstatt als „keine Zeilen“ aufgelöst zu werden, und
`createMany`, `updateMany`, `deleteMany` oder `batch`, denen etwas anderes als
ein Array übergeben wird, schlagen mit `INVALID_BULK_BODY` fehl – dem Code, den der Server für denselben
Fehler verwendet. Anwendungscode fängt somit eine einzige Klasse ab:

```typescript
async function setPrice(id: string, price: number) {
    try {
        return await client.data.products.update(id, { price });
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication)** — JWT-, OAuth- und OIDC-Provider, MFA, API-Schlüssel, Benutzerverwaltung
- **[Storage](/docs/backend/storage)** — Lokaler und S3-Dateispeicher
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Lifecycle-Hooks und die `context.data`-API
- **[Entitäts-Historie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
- **[SQL-Funktionen als RPC](/docs/backend/rpc)** — Eine Postgres-Funktion unter `/api/rpc/<name>` im Namen des Aufrufers aufrufen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
- **[Datenbank-Branching](/docs/backend/branching)** — Sofortige Datenbankkopien für Dev/Staging
- **[Deployment](/docs/getting-started/deployment)** — Das Backend in Produktion bringen
