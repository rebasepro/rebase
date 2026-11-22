---
sourceHash: c9afeee7ed06431e
title: Backend-Übersicht
sidebar_label: Backend
description: Das Rebase-Backend bietet einen vollständigen Server mit REST-API, Authentifizierung, Storage, WebSocket-Echtzeit und Entitätshistorie – alles initialisiert mit einem einzigen Funktionsaufruf.
---

## Übersicht

Das Rebase-Backend ist ein auf [Hono](https://hono.dev/) aufbauender **Node.js-Server**, der Folgendes bietet:

- **REST-API** — Automatisch generierte CRUD-Endpunkte für jede Tabelle
- **Authentifizierung** — JWT-Tokens, OAuth- und OIDC-Anmeldung, Magic Links, Einmal-Codes, MFA, API-Schlüssel, Benutzer-/Rollenverwaltung
- **Storage** — Datei-Upload/-Download über das lokale Dateisystem oder S3
- **WebSocket** — Echtzeit-Datensynchronisierung über PostgreSQL LISTEN/NOTIFY
- **Entitätshistorie** — Audit-Trail für jede Datenänderung
- **Datenbank-Branching** — Sofortige, isolierte Datenbankkopien für Entwicklung/Staging/Tests
- **Cron-Jobs** — Geplante Hintergrundaufgaben mit Monitoring-Dashboard

Alles wird mit einem einzigen Funktionsaufruf initialisiert:

:::note[Wo dies platziert wird]
Der unten stehende Aufruf befindet sich bei einem **ejected** Backend in `backend/src/index.ts`. In der **verwalteten Runtime** gibt es eine solche Datei nicht: Die Runtime führt den Aufruf aus, und Sie konfigurieren sie über Umgebungsvariablen, die von `backend/schema/index.ts` exportierten Tabellen, die in `backend/resources.ts` deklarierten Ressourcen (`database()`, `bucket()`) sowie zwei Exporte, die sie einliest: `storageAuthorize` aus `backend/storage.ts` und `hooks` aus `backend/hooks.ts`. Jede Seite in diesem Abschnitt gibt an, welche der beiden Varianten für die dokumentierte Option gilt, und nennt diejenigen, für die es keine verwaltete Form gibt. Wenn Sie etwas anderes aus diesen beiden Modulen exportieren, warnt die Runtime beim Booten davor, anstatt es stillschweigend zu ignorieren; exportieren Sie etwas, das durch eine Ressourcendeklaration ersetzt wurde, verweigert der Boot-Vorgang den Start namentlich und nennt die stattdessen in `backend/resources.ts` einzutragende Zeile.
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

Dieser eine Aufruf ist eine Abkürzung für öffentliche Einzelschritte: `installUnhandledRejectionHandler` verhindert, dass eine unbehandelte Rejection den Prozess beendet, `createRebaseBackend` erstellt das Backend, `setDefaultBackend` macht es zu dem Backend, für das die API auf Modulebene zuständig ist, und `mount`, `attachRealtime` sowie `start` stellen es bereit. Um nur bestimmte Routengruppen einzubinden, sie auf anderen Pfaden bereitzustellen, die Timer einem anderen Prozess zu überlassen oder zwei Backends in einem Prozess auszuführen, rufen Sie die Schritte selbst auf. Siehe [Integration benutzerdefinierter Server](/docs/backend/custom-server/).

## Wo sich die einzelnen Optionen befinden

Dieser Aufruf ist die **ejected** Form – diejenige, die Sie nach `rebase eject` oder in einem benutzerdefinierten Server selbst schreiben. Ein per Scaffolding erstelltes Projekt enthält sie nicht: Die veröffentlichte Runtime bootet das Projekt, und jede Option wird als Umgebungsvariable in `.env`, als Export aus `backend/storage.ts` oder `backend/hooks.ts` oder als ein vom Bundle in `rebase.json` deklariertes Verzeichnis übergeben.

Beide Pfade führen zur selben `RebaseBackendConfig`. Hier ist die vollständige Übersicht.

| Option | Verwaltete Runtime |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (Standard `/api`) |
| `tables`, `schemaDir`, `defaultRls` | das Verzeichnis `backend/schema/` (der `tables`-Schlüssel in `rebase.json`): die Tabellen und das `defaultRls`, die dessen `index.ts` exportiert |
| `rpc` | <span class="since-badge" data-since="0.35">Seit 0.35</span> die `defineRpc`-Deklarationen, die `backend/schema/index.ts` exportiert — siehe [SQL-Funktionen als RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus eine `database("<key>")`-Deklaration in `backend/resources.ts` für jede über die Standarddatenbank hinausgehende Datenbank |
| `auth` | `JWT_SECRET`, die `OAUTH_*`-Variablen und die Tabelle, die `backend/schema` mit `defineAuthTable` deklariert |
| `storage` | die `STORAGE_*`-Variablen, plus eine `bucket("<key>")`-Deklaration in `backend/resources.ts` für jeden über den Standard-Bucket hinausgehenden Bucket |
| `storageAuthorize` | `export const storageAuthorize` aus `backend/storage.ts` |
| `storagePolicies` | `STORAGE_POLICIES`, als JSON-Regeln — siehe [Storage-Autorisierung](/docs/backend/storage-authorization/#as-data-storage_policies) |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` aus `backend/hooks.ts` — globale Tabellen-Hooks |
| `history` | `REBASE_HISTORY` (standardmäßig aktiviert) — nur die boolesche Form |
| `push` | `REBASE_PUSH`, mit `REBASE_VAPID_*` für die Schlüssel — nur die boolesche Form |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; nicht gesetzt stellt `/api/docs` für das Zielpublikum des Schema-Endpunkts bereit, `true` veröffentlicht es mit der Swagger UI, `false` belässt es hinter der Admin-Schranke |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` und dessen `REBASE_LIVE_SCHEMA_*`-Zugangsdaten — nur die Repository-Form |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — siehe [Aufgeteilte Prozesse](/docs/deployment/split-processes/) |
| `corsHandled` | CORS wird von der Runtime anhand von `CORS_ORIGINS` eingerichtet |
| `schemaVersion`, `runtimeVersion` | der Build stempelt beides in das Bundle ein |
| `app`, `server`, `provisioningDriverResult` | die Runtime erstellt sie |

### Optionen ohne verwaltete Variante

Diese besitzen weder eine Umgebungsvariable noch einen Modulexport. Sie sind nur über einen manuell geschriebenen `initializeRebaseBackend`-Aufruf erreichbar — per `rebase eject` oder in einem [benutzerdefinierten Server](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` in seiner Objektform (`{ retention }`) ·
`push` in seiner Objektform (`{ allowedHosts, sender, vapid }`)

`schemaEditor` wird in einem erstellten Bundle zwangsweise deaktiviert: Der Editor schreibt die *Quelldateien* von `backend/schema` um, und ein Bundle enthält kompilierten Output.

## Was erstellt wird

Nach der Initialisierung werden folgende Routen eingebunden:

| Pfad | Zweck |
|------|---------|
| `/api/auth/*` | Authentifizierung (Registrierung, Login, Refresh, OAuth, Magic Links, Einmal-Codes, MFA) |
| `/api/admin/*` | Benutzer, Rollen, Service-Schlüssel, Cron, Backups, Logs und Schema, jeweils geschützt durch einen eigenen [Scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Datei-Upload, -Download und -Löschung |
| `/api/data/:slug` | CRUD-Operationen pro Tabelle (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Entitäts-Änderungshistorie (wenn aktiviert) |
| `/api/docs` | OpenAPI-Spezifikation der Tabellen, die der Aufrufer sehen darf (öffentlich bei `enableSwagger: true`; nur für Admins bei `false`) |
| `/api/swagger` | Swagger UI (mit `enableSwagger: true`, nur außerhalb der Produktionsumgebung) |
| `/api/schema/tables` | Die Tabellen, die dieses Backend bereitstellt, so wie der Aufrufer sie sehen darf — siehe [Endpunkte](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | Die Schema-Version, die Runtime und jede Tabelle aus Administratorsicht (erfordert `schema:read`) |
| `/api/meta/schema-version` | Ein Versionsstring für dieses Schema (unauthentifiziert) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">Seit 0.35</span> Die mit `defineRpc` deklarierten SQL-Funktionen, aufgerufen als der Aufrufer — siehe [SQL-Funktionen als RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Benutzerdefinierte Funktionsrouten (wenn `functions` oder `functionsDir` gesetzt ist) |
| `/api/push/*` | Abonnements für [Push-Benachrichtigungen](/docs/backend/push-notifications/) (wenn `push` aktiviert ist) |
| `/api/admin/cron/*` | Cron-Job-Verwaltung (`cron:read` / `cron:write`, wenn `crons` oder `cronsDir` gesetzt ist) |
| WebSocket on upgrade | Echtzeit-Abonnements, auf `/` für eine API unter `/api` |

---

## Der Initialisierungslebenszyklus

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

**Das Booten schlägt unübersehbar fehl („fail loudly“).** Wenn die Datenbank nicht erreichbar ist, die Zugangsdaten falsch sind oder das Schema nicht kompiliert oder angewendet werden kann, wirft `initializeRebaseBackend` einen Fehler, es wird nichts ausgeliefert und der Prozess beendet sich mit `1`. Es gibt keinen herabgesetzten Modus und keinen Teilbetrieb: Ein Container, der seine Datenbank nicht erreichen kann, startet neu, und der Fehler, der ihn beendet hat, ist der letzte Eintrag in seinen Logs.

Das ist beabsichtigt. Ein Server, der hochfährt und Logins beantwortet, während jede `/api/data/*`-Route fehlschlägt, ist viel schwieriger zu diagnostizieren als einer, der gar nicht erst startet – und ein Orchestrator kann auf einen Crash-Loop reagieren.

Vor der ersten Abfrage prüft der Boot-Vorgang die Verbindung und gibt die Diagnose aus: den Host und Port, die nicht erreicht werden konnten, die Fehlermeldung des Treibers selbst (`ECONNREFUSED`, `password authentication failed for user "app"`) sowie die Lösung. Siehe [Fehlerbehebung](/docs/troubleshooting/) für die Liste der einzelnen Fehlerursachen.

### Sobald die Bereitstellung läuft: `/livez` und `/health`

Zwei Probes, die zwei unterschiedliche Fragen beantworten.

| Pfad | Greift auf Datenbank zu | Antwort |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, solange der Prozess läuft. Verwenden Sie dies für eine Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine nicht antwortet. Verwenden Sie dies für eine Readiness-Probe. |

Eine Liveness-Probe auf `/health` ist ein Fehler, der ausdrücklich erwähnt werden sollte: Ein kurzer Datenbank-Schluckauf würde dazu führen, dass der Orchestrator einen ansonsten fehlerfreien Prozess beendet, wodurch ein kurzer Ausfall in eine Neustartschleife verwandelt wird.

`/health` ist unauthentifiziert, weshalb es nur das Ergebnis und nicht die Ursache preisgibt – außerhalb der Entwicklungsumgebung nennt es lediglich, welche Datenquelle herabgestuft ist, und sonst nichts. Der Fehlertext des Treibers nennt Host, Port, Datenbankname und Rolle; dies wird in die Logs geschrieben. `/health` wird auch unter `basePath` bereitgestellt (`/api/health`); `/livez` nicht.

Beide Probes stammen von der verwalteten Runtime. Ein per Eject erstelltes `backend/src/index.ts` stellt `/health` und `/api/health` selbst bereit, prüft dabei nur die Standarddatenbank und besitzt kein `/livez`, bis Sie eines hinzufügen.

---

## Konfigurationsreferenz

<span class="since-badge" data-since="0.35">Seit 0.35</span> Die nachfolgende `rpc`-Option.

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

Fünf davon werden leicht übersehen und verändern ein Verhalten, das man andernfalls nur beobachten kann:

| Schlüssel | Standard | Funktionsweise |
|---|---|---|
| `compression` | `true` | gzip/deflate bei API-Antworten, ausgehandelt über `Accept-Encoding`. Bereits komprimierte, gestreamte und `no-transform`-Bodies bleiben unberührt, ebenso wie Payloads unter 1 KB (gzip kostet dort mehr, als es spart); es kann daher sicher aktiviert bleiben – eine große JSON-Liste schrumpft typischerweise um das ~20-fache. Setzen Sie dies auf `false`, wenn nginx, Cloudflare oder ein anderer vorgeschalteter Proxy bereits komprimiert, um doppelten Aufwand zu vermeiden. Umgebung: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Obergrenze für Request-Bodies auf API-Routen; `0` deaktiviert sie. Storage-Uploads verwenden das eigene `maxFileSize` (50MB) der Storage-Konfiguration, welches für diese Routen Vorrang hat. Umgebung: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | deaktiviert | **Opt-in.** Eine BaaS-API wird von mobilen Apps, SPAs auf anderen Domains und CLI-Tools aufgerufen, von denen keines einen `Origin` sendet, den eine feste Liste akzeptieren würde – daher ist dies standardmäßig nicht aktiviert. Aktivieren Sie es mit den Origins, die Ihre Browser-Clients verwenden. Keine Umgebungsform vorhanden: Führen Sie ein Eject durch, um es zu konfigurieren. |
| `cronPersistence` | `true` | Gibt an, ob Ausführungsprotokolle in `rebase.cron_logs` geschrieben werden. `false` lässt die Jobs weiterlaufen und behält den Verlauf nur im Arbeitsspeicher, wodurch das Studio-Panel diesen bei einem Neustart verliert. |
| `schemaEditor` | aktiviert außerhalb der Produktion, wenn `schemaDir` gesetzt ist | Aktiviert oder deaktiviert die Schema-Editor-Routen explizit. Der Editor schreibt die *Quelldateien* in `backend/schema` um und benötigt daher ein Verzeichnis, in das geschrieben werden kann – und ein kompiliertes Bundle hat keines, weshalb ein Deployment dies niemals enthält. |

Der Rest von `RebaseBackendConfig` ist entweder auf einer eigenen Seite dokumentiert (`auth`, `storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) oder als `@internal` markiert: `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` und `runtimeVersion` werden von `bootFromBundle` aus der Umgebung befüllt, und eine manuelle Übergabe führt zu Konflikten mit der Runtime darüber, worum es sich bei diesem Prozess handelt.

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

Sie enthält außerdem `rebase`, den In-Process-Client, `fetch(request)`, `routes`, die Routengruppen als Hono-Sub-Apps, `services`, ihre eigenen JWT-Schlüssel, das Zugriffsmodell, den API-Schlüssel-Speicher und Rate-Limiter sowie `verifyCredential(token)`; siehe [Integration benutzerdefinierter Server](/docs/backend/custom-server/).

> **Hinweis:** Obwohl die `instance` diese internen Dienste bereitstellt, sollte Anwendungscode (wie benutzerdefinierte Funktionen und Cron-Jobs) das `rebase`-Singleton aus `@rebasepro/server` verwenden, um mit der Backend-API zu interagieren. Innerhalb eines Requests, eines Cron-Laufs oder eines Jobs ist `rebase` das Backend, das diesen bedient; andernorts ist es der Prozessstandard, den `initializeRebaseBackend` auf sein Backend setzt.

## REST-API

Die REST-API wird aus Ihren Tabellen generiert. Jede Tabelle erhält diese Endpunkte:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten — Filterung, Sortierung, Paging und Suche sind Abfrageparameter |
| `GET` | `/api/data/:slug/count` | Wie viele Zeilen der gleichen Abfrage entsprechen |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, optional gruppiert |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Eine neue Entität erstellen |
| `PATCH` | `/api/data/:slug/:id` | Die übergebenen Felder aktualisieren |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Zeilen in einer Transaktion löschen |

### Abfrageparameter (Query-Parameter)

Es gibt eine Referenz dafür, und das ist nicht diese Seite. [REST-API](/docs/backend/api/) dokumentiert beide Abfragedialekte, die der Server akzeptiert — das PostgREST-Format `?column=op.value` und das JSON-Format `?where=` — zusammen mit `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` und Vektorsuche. [Endpunkte](/docs/backend/endpoints/) ist der Index aller Routen, die der Server einbindet, einschließlich der generierten.

Ein Parameter, den der Server nicht reserviert hat, wird als Filter auf die Spalte dieses Namens interpretiert, sodass ein frei erfundener Parameter nicht fehlschlägt: Er liefert stillschweigend keine Treffer.

## WebSocket

Der WebSocket-Server dockt an denselben HTTP-Server an und bietet Echtzeit-Abonnements. Er beantwortet Upgrades auf einem einzigen Pfad (`/` für eine API unter `/api`), zu dem sich das SDK verbindet, und überlässt alle anderen Pfade Ihren eigenen `upgrade`-Listenern:

- Abonnieren von **Tabellenänderungen** — Benachrichtigung erhalten, wenn eine Zeile in einer Tabelle erstellt, aktualisiert oder gelöscht wird
- Abonnieren von **Zeilenänderungen** — Benachrichtigung erhalten, wenn sich eine bestimmte Zeile ändert
- Automatische **Wiederverbindungslogik** im typisierten SDK

Das Backend nutzt intern PostgreSQL `LISTEN/NOTIFY`. Für Multi-Instanz-Deployments geben Sie einen `connectionString` in Ihrem `PostgresBootstrapper` an, um instanzübergreifendes Broadcasting zu ermöglichen.

## Fehlerbehandlung

Jeder Fehler — von jeder Route und in jedem Subsystem — wird im selben Umschlagformat (Envelope) zurückgegeben:

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
| `message` | ja | Für Menschen lesbar formuliert. Benennt das Hindernis, nicht die Regel. |
| `code` | ja | `SCREAMING_SNAKE_CASE` und stabil. Dies ist das Feld, anhand dessen verzweigt werden sollte. |
| `details` | nein | Strukturierte Payload, wenn sich die Verweigerung auf etwas Konkretes bezieht — eine Liste fehlerhafter Pfade, eine Menge unbekannter Felder. |
| `requestId` | nein | Vorhanden, wenn die Anfrage eine ID enthielt oder zugewiesen bekam; spiegelt `X-Request-ID` wider. Geben Sie diese in einem Fehlerbericht an. |

Der HTTP-Status befindet sich auf der Response, nicht im Body. Verzweigen Sie anhand von `code`, nicht anhand von `message` – Nachrichten sind für Menschen geschrieben und können sich jederzeit ändern.

Das typisierte SDK wandelt jeden dieser Fehler in einen `RebaseApiError` um, der `status`, `code` und `details` enthält – einschließlich Fehlern, die den Server gar nicht erst erreicht haben. Eine verweigerte Verbindung, ein DNS-Fehler, CORS oder ein Abbruch kommt als `status: 0`, `code: "NETWORK_ERROR"` mit dem Fehler der Runtime selbst unter `cause` an, anstatt mit dem, was `fetch` gerade zurückgewiesen hat. Eine Antwort ohne Envelope – das 413 eines Proxys, das 502 eines Load Balancers – erhält dennoch einen `code` basierend auf ihrem Status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), und ein Client, der außerhalb eines Browsers ohne `baseUrl` initialisiert wird, schlägt mit `BASE_URL_REQUIRED` statt eines Netzwerkfehlers fehl. Ein Lesevorgang, der eine erfolgreiche Antwort erhält, die jedoch nicht der erwarteten Struktur entspricht – ein `204`, ein leerer Body, eine Seite ohne `data`-Liste –, schlägt mit `UNEXPECTED_RESPONSE` fehl, anstatt als „keine Zeilen“ aufgelöst zu werden, und `createMany`, `updateMany`, `deleteMany` oder `batch`, denen etwas anderes als ein Array übergeben wurde, schlagen mit `INVALID_BULK_BODY` fehl – demselben Code, den der Server für denselben Fehler verwendet. Der Anwendungscode fängt somit eine einzige Klasse ab:

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

- **[Authentifizierung](/docs/backend/authentication)** — JWT, OAuth- und OIDC-Provider, MFA, API-Schlüssel, Benutzerverwaltung
- **[Storage](/docs/backend/storage)** — Lokaler und S3-Dateispeicher
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Lifecycle-Hooks und die `context.data`-API
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
- **[SQL-Funktionen als RPC](/docs/backend/rpc)** — Eine Postgres-Funktion unter `/api/rpc/<name>` im Kontext des Aufrufers aufrufen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
- **[Datenbank-Branching](/docs/backend/branching)** — Sofortige Datenbankkopien für Entwicklung/Staging
- **[Deployment](/docs/getting-started/deployment)** — Das Backend in die Produktion überführen
