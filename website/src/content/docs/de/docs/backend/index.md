---
sourceHash: e399d82e853d3169
title: Backend-Übersicht
sidebar_label: Backend
description: Das Rebase-Backend bietet einen vollständigen Server mit REST-API, Authentifizierung, Speicher, WebSocket-Echtzeit und Entitäts-Historie – alles initialisiert mit einem einzigen Funktionsaufruf.
---

## Übersicht

Das Rebase-Backend ist ein **Node.js-Server**, der auf [Hono](https://hono.dev/) basiert und Folgendes bietet:

- **REST-API** — Automatisch generierte CRUD-Endpunkte für jede Tabelle
- **Authentifizierung** — JWT-Tokens, OAuth- und OIDC-Anmeldung, Magic Links, Einmalcodes, MFA, API-Schlüssel, Benutzer-/Rollenverwaltung
- **Speicher** — Datei-Upload/-Download mit lokalem Dateisystem oder S3
- **WebSocket** — Echtzeit-Datensynchronisierung über PostgreSQL LISTEN/NOTIFY
- **Entitäts-Historie** — Audit-Trail für jede Datenänderung
- **Datenbank-Branching** — Sofortige, isolierte Datenbankkopien für Entwicklung/Staging/Testing
- **Cron-Jobs** — Geplante Hintergrundaufgaben mit Monitoring-Dashboard

Alles wird mit einer einzigen Funktion initialisiert:

:::note[Wo dies hingehört]
Der folgende Aufruf befindet sich in einem **ejected** Backend in `backend/src/index.ts`. In
der **Managed Runtime** gibt es eine solche Datei nicht: Die Runtime führt den Aufruf aus, und
Sie konfigurieren ihn über Umgebungsvariablen, die Tabellen, die `backend/schema/index.ts`
exportiert, die Ressourcen, die Sie in `backend/resources.ts` deklarieren (`database()`,
`bucket()`), und zwei Exporte, die sie einliest: `storageAuthorize` aus
`backend/storage.ts` und `hooks` aus `backend/hooks.ts`. Jede Seite in diesem
Abschnitt gibt an, welche der beiden Varianten für die dokumentierte Option gilt, und nennt
diejenigen, die keine verwaltete Form haben. Exportieren Sie etwas anderes aus diesen beiden Modulen,
warnt die Runtime beim Booten, anstatt es stillschweigend zu verwerfen; exportieren Sie eine Option,
die durch eine Ressourcendeklaration ersetzt wurde, verweigert der Boot-Vorgang dies namentlich,
zusammen mit der Zeile, die stattdessen in `backend/resources.ts` geschrieben werden muss.
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
eine Abkürzung für öffentliche Schritte: `installUnhandledRejectionHandler` verhindert, dass eine
ungefangene Rejection den Prozess beendet, `createRebaseBackend` baut das Backend auf,
`setDefaultBackend` macht es zu dem Backend, für das die API auf Modulebene zuständig ist, und
`mount`, `attachRealtime` und `start` stellen es bereit. Um nur bestimmte Routengruppen
einzubinden, sie auf andere Pfade zu legen, die Timer einem anderen Prozess zu überlassen oder
zwei Backends in einem Prozess auszuführen, rufen Sie die Schritte selbst auf. Siehe
[Custom Server Integration](/docs/backend/custom-server/).

## Wo jede Option zu finden ist

Dieser Aufruf entspricht der **ejected** Form – jener, die Sie nach `rebase
eject` oder in einem Custom Server selbst schreiben. Ein neu erstelltes Projekt
hat diese nicht: Die veröffentlichte Runtime bootet das Projekt, und jede Option wird als
Umgebungsvariable in `.env`, als Export aus `backend/storage.ts` oder `backend/hooks.ts`
oder als Verzeichnis übergeben, das das Bundle in `rebase.json` deklariert.

Beide Pfade führen zur selben `RebaseBackendConfig`. Dies ist die vollständige Übersicht.

| Option | Managed Runtime |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (Standard `/api`) |
| `tables`, `schemaDir`, `defaultRls` | das `backend/schema/`-Verzeichnis (der `tables`-Schlüssel von `rebase.json`): die Tabellen und das `defaultRls`, das dessen `index.ts` exportiert |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus eine `database("<key>")`-Deklaration in `backend/resources.ts` für jede Datenbank neben der Standarddatenbank |
| `auth` | `JWT_SECRET`, die `OAUTH_*`-Variablen und die Tabelle, die `backend/schema` mit `defineAuthTable` deklariert |
| `storage` | die `STORAGE_*`-Variablen, plus eine `bucket("<key>")`-Deklaration in `backend/resources.ts` für jeden Bucket neben dem Standardbucket |
| `storageAuthorize` | `export const storageAuthorize` aus `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` aus `backend/hooks.ts` — globale Tabellen-Hooks |
| `history` | `REBASE_HISTORY` (standardmäßig aktiviert) — nur die boolesche Form |
| `push` | `REBASE_PUSH`, mit `REBASE_VAPID_*` für die Schlüssel — nur die boolesche Form |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; nicht gesetzt stellt `/api/docs` der Zielgruppe des Schema-Endpunkts bereit, `true` veröffentlicht es mit der Swagger UI, `false` behält es hinter der Admin-Schranke |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` und dessen `REBASE_LIVE_SCHEMA_*`-Zugangsdaten — nur die Repository-Form |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — siehe [Getrennte Prozesse](/docs/deployment/split-processes/) |
| `corsHandled` | CORS wird von der Runtime aus `CORS_ORIGINS` eingerichtet |
| `schemaVersion`, `runtimeVersion` | der Build stempelt beides in das Bundle |
| `app`, `server`, `provisioningDriverResult` | die Runtime erstellt sie |

### Optionen ohne Managed-Route

Diese besitzen weder eine Umgebungsvariable noch einen Modulexport. Sie sind nur
über einen handgeschriebenen `initializeRebaseBackend`-Aufruf erreichbar — `rebase eject` oder einen
[Custom Server](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` in seiner Objektform (`{ retention }`) ·
`push` in seiner Objektform (`{ allowedHosts, sender, vapid }`)

`schemaEditor` wird in einem gebauten Bundle zwingend deaktiviert: Der Editor schreibt die
`backend/schema`-Quelldateien neu, und ein Bundle enthält kompilierte Ausgaben.

## Was erstellt wird

Nach der Initialisierung werden diese Routen eingebunden:

| Pfad | Zweck |
|------|-------|
| `/api/auth/*` | Authentifizierung (Registrierung, Login, Refresh, OAuth, Magic Links, Einmalcodes, MFA) |
| `/api/admin/*` | Benutzer, Rollen, Service-Schlüssel, Cron, Backups, Logs und Schema, jeweils hinter einem eigenen [Scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Datei-Upload, -Download und -Löschung |
| `/api/data/:slug` | CRUD-Operationen pro Tabelle (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Entitätsänderungshistorie (wenn aktiviert) |
| `/api/docs` | OpenAPI-Spezifikation der Tabellen, die der Aufrufer sehen darf (öffentlich mit `enableSwagger: true`; nur für Admins mit `false`) |
| `/api/swagger` | Swagger UI (mit `enableSwagger: true`, nur außerhalb der Produktion) |
| `/api/schema/tables` | Die Tabellen, die dieses Backend bereitstellt, wie der Aufrufer sie sehen darf — siehe [Endpunkte](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | Die Schema-Version, die Runtime und jede Tabelle aus Administratorsicht (erfordert `schema:read`) |
| `/api/meta/schema-version` | Ein Versions-String für dieses Schema (nicht authentifiziert) |
| `/api/functions/*` | Benutzerdefinierte Funktionsrouten (wenn `functions` oder `functionsDir` gesetzt ist) |
| `/api/push/*` | [Push-Benachrichtigungs](/docs/backend/push-notifications/)-Abonnements (wenn `push` aktiviert ist) |
| `/api/admin/cron/*` | Cron-Job-Verwaltung (`cron:read` / `cron:write`, wenn `crons` oder `cronsDir` gesetzt ist) |
| WebSocket bei Upgrade | Echtzeit-Abonnements, auf `/` für eine API unter `/api` |

---

## Der Initialisierungs-Lebenszyklus

Wenn Sie `initializeRebaseBackend()` aufrufen, löst das Framework eine sequentielle, 5-stufige Boot-Sequenz aus:

```
[Start Boot]
     │
     ▼
1. Configuration (der Datenbank-Adapter, die übergebenen Auth- und Storage-Optionen)
     │
     ▼
2. Schema Loading (importiert backend/schema/index.ts, kompiliert jede Tabelle — ein Problem in einer verweigert den Boot)
     │
     ▼
3. Database Bootstrapping (erstellt Schemas/Auth/Hilfs-SQL-Funktionen, wie `provision` es erlaubt)
     │
     ▼
4. Service Initialization (Auth, Storage S3/lokale Client-Instanzen, Seeding des Cron-Speichers)
     │
     ▼
5. Route Mounting & Edge Loading (Hono-Controller, benutzerdefinierte Funktionen, WebSocket-Bindung)
     │
     ▼
[Boot Complete]
```

---

## Was passiert, wenn das Booten fehlschlägt

**Das Booten schlägt unüberhörbar fehl.** Wenn die Datenbank nicht erreichbar ist, die Zugangsdaten
falsch sind oder das Schema nicht kompiliert oder angewendet werden kann, wirft `initializeRebaseBackend`
einen Fehler, es wird nichts bereitgestellt und der Prozess wird mit `1` beendet. Es gibt keinen herabgesetzten Modus
und keinen Teilserver: Ein Container, der seine Datenbank nicht erreichen kann, startet neu, und
der Fehler, der ihn beendet hat, ist der letzte Eintrag in seinen Logs.

Das ist beabsichtigt. Ein Server, der startet und Anmeldungen beantwortet, während jede
`/api/data/*`-Route fehlschlägt, ist weitaus schwieriger zu diagnostizieren als einer, der gar nicht erst
hochfährt – und ein Orchestrator kann auf eine Crash-Schleife reagieren.

Vor der ersten Abfrage prüft der Boot-Vorgang die Verbindung und gibt die Diagnose aus: den
Host und Port, die nicht erreicht werden konnten, die Fehlermeldung des Treibers selbst (`ECONNREFUSED`,
`password authentication failed for user "app"`) und die Lösung. Siehe
[Fehlerbehebung](/docs/troubleshooting/) für die Liste der einzelnen Fehlerursachen.

### Sobald er Anfragen bedient: `/livez` und `/health`

Zwei Probes, die zwei unterschiedliche Fragen beantworten.

| Pfad | Berührt die Datenbank | Beantwortet |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, solange der Prozess läuft. Verwenden Sie dies als Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine es nicht tut. Verwenden Sie dies als Readiness-Probe. |

Eine Liveness-Probe auf `/health` ist ein Fehler, der erwähnt werden sollte: Ein kurzer Datenbank-Aussetzer
würde dazu führen, dass der Orchestrator einen ansonsten gesunden Prozess beendet, wodurch ein kurzer Ausfall
zu einer Neustart-Schleife wird.

`/health` erfordert keine Authentifizierung, daher gibt es das Ergebnis und nicht den Grund aus –
außerhalb der Entwicklung nennt es nur, welche Datenquelle beeinträchtigt ist, und sonst nichts. Der
Fehlertext des Treibers nennt Host, Port, Datenbankname und Rolle, und das wird in die Logs geschrieben. `/health` wird
auch unter `basePath` bereitgestellt (`/api/health`);
`/livez` hingegen nicht.

Beide Probes stammen aus der Managed Runtime. Ein ejected `backend/src/index.ts` stellt
`/health` und `/api/health` selbst bereit, prüft dabei nur die Standarddatenbank und besitzt
kein `/livez`, bis Sie eines hinzufügen.

---

## Konfigurationsreferenz

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

Fünf dieser Optionen werden leicht übersehen und ändern Verhaltensweisen, die man
sonst nur beobachten kann:

| Schlüssel | Standard | Funktion |
|---|---|---|
| `compression` | `true` | gzip/deflate bei API-Antworten, ausgehandelt über `Accept-Encoding`. Bereits komprimierte, gestreamte und `no-transform`-Bodys bleiben unberührt, ebenso wie Bodys unter 1 KB (gzip kostet dort mehr, als es spart), daher kann es bedenkenlos aktiviert bleiben – eine große JSON-Liste schrumpft typischerweise um das ~20-Fache. Setzen Sie dies auf `false`, wenn nginx, Cloudflare oder ein anderer vorgeschalteter Proxy bereits komprimiert, um doppelten Aufwand zu vermeiden. Umgebung: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Obergrenze für Request-Bodys auf API-Routen; `0` deaktiviert sie. Speicher-Uploads verwenden das eigene `maxFileSize` (50MB) der Speicherkonfiguration, das für diese Routen Vorrang hat. Umgebung: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | aus | **Opt-in.** Eine BaaS-API wird von mobilen Apps, SPAs auf anderen Domains und CLI-Tools aufgerufen, von denen keines einen `Origin` sendet, den eine feste Liste akzeptieren würde – daher ist dies standardmäßig nicht aktiviert. Aktivieren Sie es mit den Origins, die Ihre Browser-Clients verwenden. Keine Umgebungsform: Ejecten Sie, um dies zu konfigurieren. |
| `cronPersistence` | `true` | Gibt an, ob Ausführungsprotokolle in `rebase.cron_logs` geschrieben werden. `false` sorgt dafür, dass die Jobs weiterlaufen, die Historie jedoch nur im Arbeitsspeicher gehalten wird, wodurch das Studio-Panel sie bei einem Neustart verliert. |
| `schemaEditor` | außerhalb der Produktion aktiv, wenn `schemaDir` gesetzt ist | Schaltet die Schema-Editor-Routen explizit ein oder aus. Der Editor schreibt die `backend/schema`-Quelldateien neu, benötigt also ein Verzeichnis, in das er schreiben kann – und ein gebautes Bundle hat keines, weshalb ein Deployment diese Funktion niemals enthält. |

Der Rest von `RebaseBackendConfig` wird entweder auf einer eigenen Seite dokumentiert (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) oder ist als `@internal` gekennzeichnet:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` und `runtimeVersion` werden von
`bootFromBundle` aus der Umgebung ausgefüllt; sie manuell zu übergeben birgt das Risiko,
Widersprüche zur Auffassung der Runtime über diesen Prozess zu erzeugen.

## Die Backend-Instanz

`initializeRebaseBackend` gibt das erstellte Backend zurück, das bereits eingebunden und
gestartet ist. Sein Typ ist `RebaseBackendInstance`, was `RebaseBackend` entspricht –
dem Typ, den `createRebaseBackend` zurückgibt:

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

Sie enthält außerdem
`rebase`, den prozessinternen Client, `fetch(request)`, `routes`, die Routengruppen
als Hono-Sub-Apps, `services`, die eigenen JWT-Schlüssel, das Zugriffsmodell, den API-Schlüsselspeicher und
Rate-Limiter sowie `verifyCredential(token)`; siehe
[Custom Server Integration](/docs/backend/custom-server/).

> **Hinweis:** Obwohl die `instance` diese internen Dienste bereitstellt, sollte Anwendungscode (wie benutzerdefinierte Funktionen und Cron-Jobs) das `rebase`-Singleton aus `@rebasepro/server` verwenden, um mit der Backend-API zu interagieren. Innerhalb eines Requests, Cron-Laufs oder Jobs ist `rebase` das Backend, das ihn bedient; andernfalls ist es der Prozessstandard, den `initializeRebaseBackend` auf sein Backend setzt.

## REST-API

Die REST-API wird aus Ihren Tabellen generiert. Jede Tabelle erhält diese Endpunkte:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten — Filtern, Sortieren, Paging und Suche sind Abfrageparameter |
| `GET` | `/api/data/:slug/count` | Wie viele Zeilen auf dieselbe Abfrage zutreffen |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, optional gruppiert |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Eine neue Entität erstellen |
| `PATCH` | `/api/data/:slug/:id` | Die übergebenen Felder aktualisieren |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Zeilen in einer Transaktion löschen |

### Abfrageparameter

Es gibt dafür eine eigene Referenz, und das ist nicht diese Seite. [REST
API](/docs/backend/api/) dokumentiert beide Abfragedialekte, die der Server akzeptiert — die
PostgREST-artige `?column=op.value`-Form und die JSON-Form `?where=` — zusammen mit
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` und der Vektorsuche.
[Endpunkte](/docs/backend/endpoints/) ist der Index aller Routen, die der Server
bereitstellt, einschließlich der generierten.

Ein Parameter, den der Server nicht reserviert hat, wird als Filter auf die Spalte dieses
Namens interpretiert. Ein erfundener Parameter schlägt daher nicht fehl: Er liefert stillschweigend keine Treffer.

## WebSocket

Der WebSocket-Server hängt sich an denselben HTTP-Server und stellt Echtzeit-Abonnements bereit. Er beantwortet Upgrades auf einem einzigen Pfad (`/` für eine API unter `/api`, wo das SDK anfragt) und überlässt alle anderen Pfade Ihren eigenen `upgrade`-Listenern:

- Abonnieren von **Tabellenänderungen** — Benachrichtigung erhalten, wenn eine beliebige Zeile in einer Tabelle erstellt, aktualisiert oder gelöscht wird
- Abonnieren von **Zeilenänderungen** — Benachrichtigung erhalten, wenn sich eine bestimmte Zeile ändert
- Automatische Handhabung der **Wiederverbindung** im typisierten SDK

Das Backend verwendet intern PostgreSQL `LISTEN/NOTIFY`. Geben Sie für Multi-Instanz-Deployments einen `connectionString` in Ihrem `PostgresBootstrapper` an, um instanzübergreifendes Broadcasting zu ermöglichen.

## Fehlerbehandlung

Jeder Fehler — von jeder Route, in jedem Subsystem — wird in einer einheitlichen Struktur zurückgegeben:

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
| `message` | ja | Geschrieben für Personen, die eine Konsole lesen. Nennt das Hindernis, nicht die Regel. |
| `code` | ja | `SCREAMING_SNAKE_CASE` und stabil. Dies ist das Feld für Verzweigungen im Code. |
| `details` | nein | Strukturierte Nutzlast, wenn sich die Ablehnung auf etwas Konkretes *bezieht* – eine Liste fehlerhafter Pfade, eine Menge unbekannter Felder. |
| `requestId` | nein | Vorhanden, wenn die Anfrage eine ID trug oder eine zugewiesen bekam; spiegelt `X-Request-ID` wider. Bei Fehlerberichten mit angeben. |

Der HTTP-Status befindet sich in der Response, nicht im Body. Verzweigen Sie nach `code`, nicht nach
`message` — Meldungen sind für Menschen formuliert und können sich ändern.

Das typisierte SDK wandelt jeden dieser Fehler in einen `RebaseApiError` um, der
`status`, `code` und `details` enthält — einschließlich der Fehler, die einen Server
gar nicht erst erreicht haben. Eine abgewiesene Verbindung, ein DNS-Fehler, CORS oder ein Abbruch kommen als
`status: 0`, `code: "NETWORK_ERROR"` mit dem Fehler der Runtime selbst in `cause` an,
anstatt mit dem, was `fetch` gerade zurückgewiesen hat. Eine Antwort ohne
Fehlerstruktur — ein 413 eines Proxys, ein 502 eines Load Balancers — erhält dennoch einen `code` anhand ihres
Status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), und ein
Client, der außerhalb eines Browsers ohne `baseUrl` erstellt wurde, schlägt mit
`BASE_URL_REQUIRED` anstelle eines Netzwerkfehlers fehl.
Ein Lesevorgang, der einen Erfolg
ohne die erwartete Struktur erhält — ein `204`, ein leerer Body, eine Seite ohne `data`-Liste —,
schlägt mit `UNEXPECTED_RESPONSE` fehl, anstatt als "keine Zeilen" aufgelöst zu werden, und
`createMany`, `updateMany`, `deleteMany` oder `batch`, denen etwas anderes als
ein Array übergeben wurde, schlagen mit `INVALID_BULK_BODY` fehl – demselben Code, den auch der Server für diesen
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

- **[Authentifizierung](/docs/backend/authentication)** — JWT, OAuth- und OIDC-Provider, MFA, API-Schlüssel, Benutzerverwaltung
- **[Speicher](/docs/backend/storage)** — Lokaler und S3-Dateispeicher
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Lebenszyklus-Hooks und die `context.data`-API
- **[Entitäts-Historie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
- **[Datenbank-Branching](/docs/backend/branching)** — Sofortige Datenbankkopien für Entwicklung/Staging
- **[Bereitstellung](/docs/getting-started/deployment)** — Das Backend in Produktion bringen
