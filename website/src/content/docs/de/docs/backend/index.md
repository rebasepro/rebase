---
sourceHash: 9be8187c5259c1dd
title: Backend-Übersicht
sidebar_label: Backend
description: Das Rebase-Backend bietet einen vollständigen Server mit REST-API, Authentifizierung, Speicher, WebSocket-Echtzeit und Entitätshistorie – alles initialisiert mit einem einzigen Funktionsaufruf.
---

## Übersicht

Das Rebase-Backend ist ein **Node.js-Server**, der auf [Hono](https://hono.dev/) basiert und Folgendes bietet:

- **REST-API** — Automatisch generierte CRUD-Endpunkte für jede Tabelle
- **Authentifizierung** — JWT-Tokens, OAuth- und OIDC-Anmeldung, Magic Links, Einmalcodes, MFA, API-Schlüssel, Benutzer-/Rollenverwaltung
- **Speicher** — Datei-Upload/-Download mit lokalem Dateisystem oder S3
- **WebSocket** — Echtzeit-Datensynchronisierung über PostgreSQL LISTEN/NOTIFY
- **Entitätshistorie** — Audit-Trail für jede Datenänderung
- **Datenbank-Branching** — Sofortige, isolierte Datenbankkopien für Entwicklung/Staging/Tests
- **Cron-Jobs** — Geplante Hintergrundaufgaben mit Überwachungs-Dashboard

Alles wird mit einer einzigen Funktion initialisiert:

:::note[Wo dies hingehört]
Der folgende Aufruf befindet sich in einem **ausgeklinkten (ejected)** Backend in `backend/src/index.ts`. In der **verwalteten Runtime** gibt es keine solche Datei: Die Runtime führt den Aufruf aus, und Sie konfigurieren sie über Umgebungsvariablen, die von `backend/schema/index.ts` exportierten Tabellen, die in `backend/resources.ts` deklarierten Ressourcen (`database()`, `bucket()`) sowie zwei Exporte, die sie einliest: `storageAuthorize` aus `backend/storage.ts` und `hooks` aus `backend/hooks.ts`. Jede Seite in diesem Abschnitt gibt an, welche der beiden Varianten für die dokumentierte Option gilt, und nennt diejenigen, für die es keine verwaltete Form gibt. Wenn Sie etwas anderes aus diesen beiden Modulen exportieren, warnt die Runtime beim Booten, anstatt es stillschweigend zu ignorieren; exportieren Sie etwas, das durch eine Ressourcendeklaration ersetzt wurde, verweigert der Bootvorgang dies namentlich zusammen mit der Zeile, die stattdessen in `backend/resources.ts` zu schreiben ist.
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

Dieser eine Aufruf ist eine Abkürzung für öffentliche Schritte: `installUnhandledRejectionHandler` verhindert, dass eine unbehandelte Rejection den Prozess beendet, `createRebaseBackend` baut das Backend, `setDefaultBackend` macht es zu demjenigen, für das die API auf Modulebene antwortet, und `mount`, `attachRealtime` sowie `start` stellen es bereit. Um nur bestimmte Routengruppen einzubinden, sie auf andere Pfade zu legen, die Timer einem anderen Prozess zu überlassen oder zwei Backends in einem Prozess auszuführen, führen Sie die Schritte selbst aus. Siehe [Benutzerdefinierte Serverintegration](/docs/backend/custom-server/).

## Wo sich die einzelnen Optionen befinden

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Dieser Aufruf entspricht der **ausgeklinkten (ejected)** Form – diejenige, die Sie nach `rebase eject` oder in einem benutzerdefinierten Server selbst schreiben. Ein neu erstelltes (scaffolded) Projekt besitzt diesen nicht: Die veröffentlichte Runtime startet das Projekt, und jede Option wird als Umgebungsvariable in `.env`, als Export aus `backend/storage.ts` oder `backend/hooks.ts` oder als Verzeichnis übergeben, das das Bundle in `rebase.json` deklariert.

Beide Pfade führen zur selben `RebaseBackendConfig`. Hier ist die vollständige Übersicht.

| Option | Verwaltete Runtime |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (Standard `/api`) |
| `tables`, `schemaDir`, `defaultRls` | das Verzeichnis `backend/schema/` (der Schlüssel `tables` in `rebase.json`): die Tabellen und das `defaultRls`, das die `index.ts` exportiert |
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
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; nicht gesetzt stellt `/api/docs` der Zielgruppe des Schema-Endpunkts bereit, `true` veröffentlicht es mit der Swagger-Benutzeroberfläche, `false` belässt es hinter dem Admin-Gate |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` und dessen `REBASE_LIVE_SCHEMA_*`-Anmeldeinformationen — nur die Repository-Form |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — siehe [Aufgeteilte Prozesse](/docs/deployment/split-processes/) |
| `corsHandled` | CORS wird von der Runtime anhand von `CORS_ORIGINS` eingerichtet |
| `schemaVersion`, `runtimeVersion` | der Build prägt beides in das Bundle ein |
| `app`, `server`, `provisioningDriverResult` | die Runtime erstellt diese |

### Optionen ohne verwaltete Route

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Für diese gibt es weder eine Umgebungsvariable noch einen Modulexport. Sie sind nur über einen manuell geschriebenen `initializeRebaseBackend`-Aufruf erreichbar – `rebase eject` oder einen [benutzerdefinierten Server](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` in Objektform (`{ retention }`)

`schemaEditor` wird in einem erstellten Bundle zwangsweise deaktiviert: Der Editor schreibt die *Quelldateien* von `backend/schema` um, und ein Bundle enthält kompilierten Output.

## Was erstellt wird

Nach der Initialisierung werden folgende Routen eingebunden:

| Pfad | Zweck |
|------|-------|
| `/api/auth/*` | Authentifizierung (Registrierung, Login, Refresh, OAuth, Magic Links, Einmalcodes, MFA) |
| `/api/admin/*` | Benutzer, Rollen, Service-Schlüssel, Cron, Backups, Protokolle und Schema, jeweils hinter einem eigenen [Scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Datei-Upload, -Download und -Löschung |
| `/api/data/:slug` | CRUD-Operationen pro Tabelle (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Entitäts-Änderungshistorie (wenn aktiviert) |
| `/api/docs` | OpenAPI-Spezifikation der Tabellen, die der Aufrufer sehen darf (öffentlich mit `enableSwagger: true`; nur für Admins mit `false`) |
| `/api/swagger` | Swagger-Benutzeroberfläche (mit `enableSwagger: true`, nur außerhalb der Produktionsumgebung) |
| `/api/schema/tables` | Die von diesem Backend bereitgestellten Tabellen, wie der Aufrufer sie sehen darf – siehe [Endpunkte](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | Die Schema-Version, die Runtime und jede Tabelle aus Administratorsicht (erfordert `schema:read`) |
| `/api/meta/schema-version` | Ein Versions-String für dieses Schema (nicht authentifiziert) |
| `/api/functions/*` | Benutzerdefinierte Funktionsrouten (wenn `functions` oder `functionsDir` gesetzt ist) |
| `/api/admin/cron/*` | Cron-Job-Verwaltung (`cron:read` / `cron:write`, wenn `crons` oder `cronsDir` gesetzt ist) |
| WebSocket on upgrade | Echtzeit-Abonnements, auf `/` für eine API unter `/api` |

---

## Der Initialisierungs-Lebenszyklus

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Sie `initializeRebaseBackend()` aufrufen, löst das Framework eine sequentielle, fünfstufige Boot-Sequenz aus:

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

**Das Booten schlägt deutlich und sofort fehl (Fail Loudly).** Wenn die Datenbank nicht erreichbar ist, die Anmeldedaten falsch sind oder das Schema nicht kompiliert oder angewendet werden kann, wirft `initializeRebaseBackend` einen Fehler, es wird nichts ausgeliefert und der Prozess wird mit dem Statuscode `1` beendet. Es gibt keinen herabgesetzten Modus (Degraded Mode) und keinen partiellen Server: Ein Container, der seine Datenbank nicht erreichen kann, startet neu, und der Fehler, der ihn beendet hat, ist der letzte Eintrag in den Logs.

Das ist beabsichtigt. Ein Server, der zwar gestartet wird und Anmeldeanfragen beantwortet, bei dem aber jede `/api/data/*`-Route fehlschlägt, ist weitaus schwieriger zu diagnostizieren als einer, der gar nicht erst startet – und ein Orchestrator kann auf einen Crash-Loop reagieren.

Vor der ersten Abfrage prüft der Bootvorgang die Verbindung und gibt die Diagnose aus: den Host und den Port, die nicht erreicht werden konnten, die Fehlermeldung des Treibers selbst (`ECONNREFUSED`, `password authentication failed for user "app"`) und den Lösungsvorschlag. Siehe [Fehlerbehebung](/docs/troubleshooting/) für eine detaillierte Liste der Fehler.

### Sobald der Server läuft: `/livez` und `/health`

Zwei Probes, die zwei unterschiedliche Fragen beantworten.

| Pfad | Greift auf die Datenbank zu | Antwortet |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, solange der Prozess läuft. Verwenden Sie diesen Endpunkt für eine Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine nicht antwortet. Verwenden Sie diesen Endpunkt für eine Readiness-Probe. |

Eine Liveness-Probe auf `/health` ist ein Fehler, der erwähnt werden sollte: Ein kurzer Datenbankaussetzer würde dazu führen, dass der Orchestrator einen ansonsten fehlerfreien Prozess beendet und so einen kurzen Ausfall in eine Neustartschleife verwandelt.

`/health` erfordert keine Authentifizierung, daher gibt es nur das Ergebnis und nicht die Ursache preis – außerhalb der Entwicklungsumgebung nennt es lediglich die beeinträchtigte Datenquelle und sonst nichts. Der Fehlertext des Treibers nennt Host, Port, Datenbankname und Rolle, was in die Protokolle geschrieben wird. `/health` wird auch unter `basePath` (`/api/health`) bereitgestellt; `/livez` hingegen nicht.

Beide Probes stammen aus der verwalteten Runtime. Ein ausgeklinktes `backend/src/index.ts` stellt `/health` und `/api/health` selbst bereit, prüft dabei nur die Standarddatenbank und besitzt kein `/livez`, bis Sie eines hinzufügen.

---

## Konfigurationsreferenz

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

Fünf davon werden leicht übersehen und verändern ein Verhalten, das man sonst nur beobachten kann:

| Schlüssel | Standard | Funktionsweise |
|---|---|---|
| `compression` | `true` | gzip/deflate für API-Antworten, ausgehandelt über `Accept-Encoding`. Bereits komprimierte, gestreamte und mit `no-transform` versehene Inhalte bleiben unberührt, ebenso Inhalte unter 1 KB (gzip erzeugt dort mehr Overhead als Ersparnis), sodass es sicher aktiviert bleiben kann – eine große JSON-Liste schrumpft typischerweise um das ~20-Fache. Setzen Sie dies auf `false`, wenn nginx, Cloudflare oder ein anderer vorgeschalteter Proxy bereits komprimiert, um doppelte Rechenlast zu vermeiden. Umgebungsvariable: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Obergrenze für Request-Bodies bei API-Routen; `0` deaktiviert sie. Storage-Uploads nutzen das eigene `maxFileSize` (50MB) der Storage-Konfiguration, das bei diesen Routen Vorrang hat. Umgebungsvariable: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | deaktiviert | **Opt-in.** Eine BaaS-API wird von mobilen Apps, SPAs auf anderen Domains und CLI-Tools aufgerufen, von denen keines einen `Origin` sendet, den eine feste Liste akzeptieren würde – daher ist dies standardmäßig deaktiviert. Aktivieren Sie es mit den Origins, die Ihre Browser-Clients verwenden. Keine Form als Umgebungsvariable vorhanden: Ejecten Sie, um dies zu konfigurieren. |
| `cronPersistence` | `true` | Legt fest, ob Ausführungsprotokolle in `rebase.cron_logs` geschrieben werden. `false` hält die Jobs am Laufen und die Historie nur im Arbeitsspeicher, welche das Studio-Panel bei einem Neustart dann verliert. |
| `schemaEditor` | außerhalb der Produktion aktiviert, wenn `schemaDir` gesetzt ist | Erzwingt die Aktivierung oder Deaktivierung der Schema-Editor-Routen. Der Editor schreibt die *Quelldateien* in `backend/schema` um, benötigt also ein Verzeichnis, in das er schreiben kann – und ein kompiliertes Bundle hat keines, weshalb ein Deployment diese Routen niemals besitzt. |

Der Rest von `RebaseBackendConfig` ist entweder auf einer eigenen Seite dokumentiert (`auth`, `storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) oder als `@internal` gekennzeichnet: `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` und `runtimeVersion` werden von `bootFromBundle` aus der Umgebung ausgefüllt; diese manuell zu übergeben, führt zu Inkonsistenzen mit der Runtime darüber, was dieser Prozess darstellt.

## Die Backend-Instanz

`initializeRebaseBackend` gibt das erstellte Backend zurück, bereits eingebunden und gestartet. Sein Typ ist `RebaseBackendInstance`, was `RebaseBackend` entspricht – dem Typ, den `createRebaseBackend` zurückgibt:

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

Es enthält außerdem `rebase` (den prozessinternen Client), `fetch(request)`, `routes` (die Routengruppen als Hono-Sub-Apps), `services`, eigene JWT-Schlüssel, Zugriffsmodell, API-Key-Store und Rate-Limiter sowie `verifyCredential(token)`; siehe [Benutzerdefinierte Serverintegration](/docs/backend/custom-server/).

> **Hinweis:** Während die `instance` diese internen Dienste bereitstellt, sollte Anwendungscode (wie benutzerdefinierte Funktionen und Cron-Jobs) das `rebase`-Singleton aus `@rebasepro/server` verwenden, um mit der Backend-API zu interagieren. Innerhalb eines Requests, eines Cron-Laufs oder Jobs ist `rebase` das Backend, das ihn verarbeitet; an anderer Stelle ist es der Prozessstandard, den `initializeRebaseBackend` auf sein Backend setzt.

## REST-API

Die REST-API wird aus Ihren Tabellen generiert. Jede Tabelle erhält diese Endpunkte:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten — Filtern, Sortieren, Paginierung und Suche erfolgen über Query-Parameter |
| `GET` | `/api/data/:slug/count` | Wie viele Zeilen dieselbe Abfrage matcht |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, optional gruppiert |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Eine neue Entität erstellen |
| `PATCH` | `/api/data/:slug/:id` | Die übergebenen Felder aktualisieren |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Zeilen in einer Transaktion löschen |

### Query-Parameter

Es gibt eine eigene Referenz dafür, und es ist nicht diese Seite. Die [REST-API](/docs/backend/api/)-Dokumentation beschreibt beide Abfragedialekte, die der Server akzeptiert – die PostgREST-artige `?column=op.value`-Form und die JSON-Form `?where=` – zusammen mit `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` und der Vektorsuche. [Endpunkte](/docs/backend/endpoints/) ist der Index aller vom Server eingebundenen Routen, einschließlich der generierten.

Ein Parameter, den der Server nicht reserviert hat, wird als Filter auf die Spalte dieses Namens interpretiert, sodass ein frei erfundener Parameter keinen Fehler auslöst: Er liefert stillschweigend keine Treffer zurück.

## WebSocket

Der WebSocket-Server dockt an denselben HTTP-Server an und bietet Echtzeit-Abonnements. Er reagiert auf Upgrades auf einem Pfad, `/` für eine API unter `/api`, wohin sich das SDK verbindet, und überlässt jeden anderen Pfad Ihren eigenen `upgrade`-Listenern:

- Abonnieren von **Tabellenänderungen** — Benachrichtigung erhalten, wenn eine beliebige Zeile in einer Tabelle erstellt, aktualisiert oder gelöscht wird
- Abonnieren von **Zeilenänderungen** — Benachrichtigung erhalten, wenn sich eine bestimmte Zeile ändert
- Automatische Handhabung von **Wiederverbindungen (Reconnection)** im typisierten SDK

Das Backend verwendet intern PostgreSQL `LISTEN/NOTIFY`. Geben Sie für Multi-Instanz-Bereitstellungen einen `connectionString` in Ihrem `PostgresBootstrapper` an, um instanzübergreifendes Broadcasting zu ermöglichen.

## Fehlerbehandlung

Jeder Fehler – von jeder Route, in jedem Subsystem – wird in einem einheitlichen Format (Envelope) zurückgegeben:

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
| `message` | ja | Geschrieben für Personen, die eine Konsole lesen. Benennt das konkrete Problem, nicht die interne Regel. |
| `code` | ja | `SCREAMING_SNAKE_CASE` und stabil. Dies ist das Feld für Verzweigungen (Conditionals). |
| `details` | nein | Strukturierte Daten, wenn sich die Ablehnung auf etwas *Konkretes* bezieht – eine Liste fehlerhafter Pfade, eine Menge unbekannter Felder. |
| `requestId` | nein | Vorhanden, wenn die Anfrage eine ID enthielt oder ihr eine zugewiesen wurde; spiegelt `X-Request-ID` wider. Geben Sie diese in Fehlerberichten an. |

Der HTTP-Status befindet sich auf der Response, nicht im Body. Verzweigen Sie anhand von `code`, nicht anhand von `message` – Nachrichten sind für Menschen formuliert und können sich ändern.

Das typisierte SDK wandelt jeden dieser Fehler in einen `RebaseApiError` um, der `status`, `code` und `details` enthält – einschließlich der Fehler, die den Server gar nicht erst erreicht haben. Eine abgewiesene Verbindung, ein DNS-Fehler, CORS oder ein Abbruch kommen als `status: 0`, `code: "NETWORK_ERROR"` mit dem runtimespezifischen Fehler in `cause` an, anstatt mit dem, womit `fetch` gerade verworfen wurde. Eine Antwort ohne Envelope – etwa ein 413 eines Proxys oder ein 502 eines Load Balancers – erhält dennoch einen `code` anhand ihres Status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), und ein Client, der außerhalb eines Browsers ohne `baseUrl` instanziiert wurde, schlägt mit `BASE_URL_REQUIRED` anstelle eines Netzwerkfehlers fehl. Ein Lesezugriff, der erfolgreich ist, aber nicht die erwartete Form aufweist – ein `204`, ein leerer Body, eine Seite ohne `data`-Liste –, schlägt mit `UNEXPECTED_RESPONSE` fehl, anstatt als „keine Zeilen“ aufgelöst zu werden; und wenn `createMany`, `updateMany`, `deleteMany` oder `batch` etwas anderes als ein Array übergeben wird, schlägt dies mit `INVALID_BULK_BODY` fehl, demselben Code, den der Server für diesen Fehler verwendet. Anwendungscode fängt daher nur eine einzige Klasse ab:

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

- **[Authentifizierung](/docs/backend/authentication)** — JWT, OAuth- und OIDC-Anbieter, MFA, API-Schlüssel, Benutzerverwaltung
- **[Speicher](/docs/backend/storage)** — Lokale und S3-Dateispeicherung
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Lifecycle-Hooks und die `context.data`-API
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Eigene API-Endpunkte hinzufügen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
- **[Datenbank-Branching](/docs/backend/branching)** — Sofortige Datenbankkopien für Entwicklung/Staging
- **[Bereitstellung](/docs/getting-started/deployment)** — Das Backend in Produktion bringen
