---
sourceHash: 21b1ae6712a17e38
title: Backend-Übersicht
sidebar_label: Backend
description: Das Rebase-Backend bietet einen vollständigen Server mit REST-API, Authentifizierung, Storage, WebSocket-Echtzeit und Entitätshistorie – alles initialisiert mit einem einzigen Funktionsaufruf.
---

## Übersicht

Das Rebase-Backend ist ein auf [Hono](https://hono.dev/) basierender **Node.js-Server**, der Folgendes bereitstellt:

- **REST-API** — Automatisch generierte CRUD-Endpunkte für jede Collection
- **Authentifizierung** — JWT-Tokens, OAuth- und OIDC-Anmeldung, Magic Links, Einmalcodes, MFA, API-Schlüssel, Benutzer-/Rollenverwaltung
- **Storage** — Datei-Upload/-Download über das lokale Dateisystem oder S3
- **WebSocket** — Echtzeit-Datensynchronisierung über PostgreSQL LISTEN/NOTIFY
- **Entitätshistorie** — Audit-Trail für jede Datenänderung
- **Database Branching** — Sofortige, isolierte Datenbankkopien für Dev/Staging/Testing
- **Cron-Jobs** — Geplante Hintergrundaufgaben mit Monitoring-Dashboard

Alles wird mit einer einzigen Funktion initialisiert:

:::note[Wo dies hingehört]
Der nachfolgende Aufruf ist das, was ein **ejected** Backend in `backend/src/index.ts` enthält. In der **Managed Runtime** gibt es keine solche Datei: Die Runtime führt den Aufruf aus, und Sie konfigurieren ihn über Umgebungsvariablen, die Ressourcen, die Sie in `config/resources.ts` deklarieren (`database()`, `bucket()`), und die beiden Exporte, die sie aus `config/index.ts` liest (`storageAuthorize`, `callbacks`). Jede Seite in diesem Abschnitt gibt an, welche der beiden Varianten für die dokumentierte Option gilt, und nennt diejenigen, für die es keine verwaltete Form gibt. Wenn Sie eine Option exportieren, die die Runtime nicht liest, warnt sie Sie beim Booten, anstatt sie stillschweigend zu ignorieren; wenn Sie eine exportieren, die durch eine Ressourcendeklaration ersetzt wurde, verweigert der Boot-Vorgang dies namentlich und nennt die stattdessen in `config/resources.ts` zu schreibende Zeile.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
    enableSwagger: env.NODE_ENV !== "production"
});
```

## Wo die einzelnen Optionen liegen

Dieser Aufruf entspricht der **ejected** Form – derjenigen, die Sie nach `rebase eject` oder in einem Custom Server selbst schreiben. Ein per Scaffolding erstelltes Projekt hat ihn nicht: Die bereitgestellte Runtime bootet das Projekt, und jede Option wird als Umgebungsvariable in `.env`, als Export aus `config/index.ts` oder als Verzeichnis, das das Bundle in `rebase.json` deklariert, übergeben.

Beide Pfade führen zur selben `RebaseBackendConfig`. Dies ist die vollständige Übersicht.

| Option | Managed Runtime |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (Standard: `/api`) |
| `collections`, `collectionsDir` | das von `rebase.json` deklarierte Verzeichnis `config/collections/` |
| `functionsDir` | `backend/functions/` |
| `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus eine `database("<key>")`-Deklaration in `config/resources.ts` für jede Datenbank jenseits des Standards |
| `auth` | `JWT_SECRET`, die `OAUTH_*`-Variablen und `config/collections/users` |
| `storage` | die `STORAGE_*`-Variablen, plus eine `bucket("<key>")`-Deklaration in `config/resources.ts` für jeden Bucket jenseits des Standards |
| `storageAuthorize` | `export const storageAuthorize` aus `config/index.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `callbacks` | `export const callbacks` aus `config/index.ts` |
| `history` | `REBASE_HISTORY` (standardmäßig aktiviert) — nur die boolesche Form |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; nicht gesetzt bedeutet außerhalb der Produktion aktiviert |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — siehe [Split Processes](/docs/deployment/split-processes/) |
| `corsHandled` | CORS wird von der Runtime aus `CORS_ORIGINS` installiert |
| `schemaVersion`, `runtimeVersion` | der Build stempelt beide in das Bundle ein |
| `app`, `server`, `provisioningDriverResult` | die Runtime erstellt sie |

### Optionen ohne verwalteten Pfad

Diese besitzen weder Umgebungsvariablen noch Konfigurationsexporte. Sie sind nur über einen manuell geschriebenen `initializeRebaseBackend`-Aufruf erreichbar – per `rebase eject` oder über einen [Custom Server](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` · `functionsTimeoutMs` ·
`storagePolicies` · `storageTriggers` · `baas` · `liveSchema` · `rlsAudit` ·
`history` in seiner Objektform (`{ retention }`)

`schemaEditor` wird in einem erstellten Bundle zwangsweise deaktiviert: Der Editor schreibt *Quelldateien* von Collections um, und ein Bundle enthält kompilierten Output.

## Was erstellt wird

Nach der Initialisierung werden diese Routen gemountet:

| Pfad | Zweck |
|------|-------|
| `/api/auth/*` | Authentifizierung (Registrierung, Login, Refresh, OAuth, Magic Links, Einmalcodes, MFA) |
| `/api/admin/*` | Benutzer- und Rollenverwaltung (nur Administratoren) |
| `/api/storage/*` | Datei-Upload, -Download und -Löschung |
| `/api/data/:slug` | CRUD-Operationen pro Collection (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Änderungshistorie der Entität (wenn aktiviert) |
| `/api/docs` | OpenAPI-Spezifikation (wenn `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (Dev-Modus, wenn `enableSwagger: true`) |
| `/api/meta/contract` | Das Collection-Schema des Projekts (nur Administratoren) |
| `/api/meta/schema-version` | Ein Versions-String für dieses Schema (nicht authentifiziert) |
| `/api/functions/*` | Benutzerdefinierte Funktionsrouten (wenn `functionsDir` gesetzt ist) |
| `/api/cron/*` | Cron-Job-Verwaltung (nur Administratoren, wenn `cronsDir` gesetzt ist) |
| WebSocket beim Upgrade | Echtzeit-Abonnements |

---

## Der Initialisierungslebenszyklus

Wenn Sie `initializeRebaseBackend()` aufrufen, löst das Framework eine sequentielle, 5-stufige Boot-Sequenz aus:

```
[Start Boot]
     │
     ▼
1. ENV validation (Zod parsing of jwt, databases, cors)
     │
     ▼
2. Dynamic Collection Loading (Chokidar watches .ts files, AST parsing)
     │
     ▼
3. Database Bootstrapping (Acquires advisory lock, creates schemas/auth/helper SQL functions)
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

**Der Boot-Vorgang schlägt lautstark fehl.** Wenn die Datenbank nicht erreichbar ist, die Anmeldedaten falsch sind oder das Collection-Schema nicht angewendet werden kann, wirft `initializeRebaseBackend` einen Fehler, es wird nichts ausgeliefert und der Prozess wird mit `1` beendet. Es gibt keinen herabgesetzten Modus und keinen Teil-Server: Ein Container, der seine Datenbank nicht erreichen kann, startet neu, und der Fehler, der ihn beendet hat, ist der letzte Eintrag in seinen Logs.

Das ist beabsichtigt. Ein Server, der hochfährt und Logins beantwortet, während jede `/api/data/*`-Route fehlschlägt, ist viel schwerer zu diagnostizieren als einer, der gar nicht erst startet – und ein Orchestrator kann auf einen Crash-Loop reagieren.

Vor der ersten Abfrage prüft der Boot-Vorgang die Verbindung und gibt die Diagnose aus: den Host und Port, die nicht erreicht werden konnten, die Begründung des Treibers selbst (`ECONNREFUSED`, `password authentication failed for user "app"`) sowie die Lösung. Siehe [Fehlerbehebung](/docs/troubleshooting/) für die vollständige Liste aller Fehlerfälle.

### Sobald der Server läuft: `/livez` und `/health`

Zwei Probes, die zwei unterschiedliche Fragen beantworten.

| Pfad | Greift auf die Datenbank zu | Antwortet |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, solange der Prozess läuft. Verwenden Sie dies für eine Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine nicht antwortet. Verwenden Sie dies für eine Readiness-Probe. |

Eine Liveness-Probe auf `/health` ist ein Fehler, der erwähnenswert ist: Ein kurzer Datenbank-Schluckauf würde den Orchestrator dazu veranlassen, einen ansonsten gesunden Prozess zu beenden, was einen kurzen Ausfall in eine Neustartschleife verwandeln würde.

Da `/health` nicht authentifiziert ist, gibt der Endpunkt das Ergebnis aus und nicht die Begründung – außerhalb der Entwicklungsumgebung nennt er lediglich, welche Datenquelle beeinträchtigt ist, und sonst nichts. Der Fehlertext des Treibers nennt Host, Port, Datenbankname und Rolle, und dies wird in die Logs geschrieben. Beide Pfade werden auch unter `basePath` bereitgestellt (`/api/health`).

---

## Konfigurationsreferenz

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Collections
    collections?: CollectionConfig[];  // Your collection definitions
    collectionsDir?: string;  // Auto-load collections from a directory

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

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
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

Fünf davon werden leicht übersehen und verändern Verhaltensweisen, die Sie sonst nur beobachten können:

| Schlüssel | Standard | Funktion |
|---|---|---|
| `compression` | `true` | gzip/deflate für API-Antworten, ausgehandelt über `Accept-Encoding`. Bereits komprimierte, gestreamte und mit `no-transform` versehene Payloads bleiben unberührt, sodass es sicher aktiviert bleiben kann – eine große JSON-Liste schrumpft typischerweise um das ~20-Fache. Setzen Sie dies auf `false`, wenn nginx, Cloudflare oder ein anderer vorgeschalteter Proxy bereits komprimiert, um doppelte Verarbeitung zu vermeiden. Umgebungsvariable: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Obergrenze für Request-Bodies bei API-Routen; `0` deaktiviert sie. Storage-Uploads verwenden das separate `maxFileSize` (50MB) der Storage-Konfiguration, welches für diese Routen Vorrang hat. Umgebungsvariable: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | deaktiviert | **Opt-in.** Eine BaaS-API wird von mobilen Apps, SPAs auf anderen Domains und CLI-Tools aufgerufen, von denen keines einen `Origin`-Header sendet, den eine feste Liste akzeptieren würde – daher ist dies standardmäßig nicht aktiviert. Aktivieren Sie es mit den Origins, die Ihre Browser-Clients verwenden. Keine Umgebungsvariable vorhanden: Führen Sie `rebase eject` aus, um dies zu konfigurieren. |
| `cronPersistence` | `true` | Gibt an, ob Ausführungsprotokolle in `rebase.cron_logs` geschrieben werden. Bei `false` laufen die Jobs weiter und der Verlauf verbleibt nur im Speicher, was das Studio-Panel bei einem Neustart dann verliert. |
| `schemaEditor` | außerhalb der Produktion aktiv, wenn `collectionsDir` gesetzt ist | Schaltet die Schema-Editor-Routen explizit ein oder aus. Der Editor schreibt *Quelldateien* von Collections um, benötigt also ein Verzeichnis, in das er schreiben kann – und ein erstelltes Bundle hat keines, weshalb ein Deployment diese Routen niemals besitzt. |

Der Rest von `RebaseBackendConfig` ist entweder auf einer eigenen Seite dokumentiert (`auth`, `storage`, `jobs`, `callbacks`, `liveSchema`, `rlsAudit`) oder als `@internal` markiert: `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` und `runtimeVersion` werden von `bootFromBundle` aus der Umgebung befüllt, und deren manuelle Übergabe führt zu Konflikten mit der Runtime darüber, was dieser Prozess eigentlich darstellt.

## Die Backend-Instanz

`initializeRebaseBackend` gibt eine `RebaseBackendInstance` mit Zugriff auf interne Dienste zurück:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.auth?.roleService       // Role management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.collectionRegistry  // Collection metadata
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when cronsDir is set)
```

> **Hinweis:** Obwohl die `instance` diese internen Dienste verfügbar macht, sollte Anwendungscode (wie benutzerdefinierte Funktionen und Cron-Jobs) das globale `rebase`-Singleton aus `@rebasepro/server` verwenden, um mit der Backend-API zu interagieren.

## REST-API

Die REST-API wird automatisch aus Ihren Collections generiert. Jede Collection erhält diese Endpunkte:

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten – Filtern, Sortieren, Paging und Suche erfolgen über Query-Parameter |
| `GET` | `/api/data/:slug/count` | Wie viele Zeilen auf dieselbe Abfrage zutreffen |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, optional gruppiert |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Eine neue Entität erstellen |
| `PATCH` | `/api/data/:slug/:id` | Die übergebenen Felder aktualisieren |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer einzigen Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Zeilen in einer einzigen Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Zeilen in einer einzigen Transaktion löschen |

### Query-Parameter

Es gibt eine Referenz dafür, und es ist nicht diese Seite. Die Seite [REST-API](/docs/backend/api/) dokumentiert beide Abfragedialekte, die der Server akzeptiert – das Format im PostgREST-Stil `?column=op.value` und das JSON-Format `?where=` – zusammen mit `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` und der Vektorsuche. [Endpunkte](/docs/backend/endpoints/) ist der Index aller vom Server gemounteten Routen, einschließlich der generierten.

Ein Parameter, den der Server nicht reserviert hat, wird als Filter auf die Spalte dieses Namens interpretiert. Ein erfundener Parameter schlägt daher nicht fehl: Er stimmt stillschweigend mit nichts überein.

## WebSocket

Der WebSocket-Server dockt an denselben HTTP-Server an und bietet Echtzeit-Abonnements:

- **Collection-Änderungen** abonnieren — Benachrichtigungen erhalten, wenn eine beliebige Entität in einer Collection erstellt, aktualisiert oder gelöscht wird
- **Entitätsänderungen** abonnieren — Benachrichtigungen erhalten, wenn sich eine bestimmte Entität ändert
- Automatisches **Reconnection**-Handling im Client-SDK

Das Backend verwendet intern PostgreSQL `LISTEN/NOTIFY`. Geben Sie für Multi-Instanz-Deployments einen `connectionString` in Ihrem `PostgresBootstrapper` an, um instanzübergreifendes Broadcasting zu aktivieren.

## Fehlerbehandlung

Jeder Fehler – von jeder Route, in jedem Subsystem – wird in einem einheitlichen Envelope zurückgegeben:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Feld | Immer vorhanden | Bedeutung |
|-------|:--------------:|-----------|
| `message` | ja | Geschrieben für Personen, die eine Konsole lesen. Nennt das Problem, nicht die interne Regel. |
| `code` | ja | `SCREAMING_SNAKE_CASE` und stabil. Dies ist das Feld für Verzweigungen. |
| `details` | nein | Strukturierte Nutzdaten, wenn sich die Ablehnung *auf etwas Konkretes bezieht* – eine Liste fehlerhafter Pfade, ein Satz unbekannter Felder. |
| `requestId` | nein | Vorhanden, wenn die Anfrage eine ID trug oder ihr eine zugewiesen wurde; spiegelt `X-Request-ID` wider. Geben Sie diese in einem Bug-Report an. |

Der HTTP-Status befindet sich auf der Response, nicht im Body. Verzweigen Sie basierend auf `code`, nicht auf `message` – Meldungen sind für Menschen geschrieben und können sich ändern.

Das Client-SDK wandelt jeden dieser Fehler in einen `RebaseApiError` um, der `status`, `code` und `details` enthält – einschließlich der Fehler, die den Server gar nicht erst erreicht haben. Eine abgewiesene Verbindung, ein DNS-Fehler, CORS oder ein Verbindungsabbruch kommen als `status: 0`, `code: "NETWORK_ERROR"` an, wobei der Fehler der Runtime selbst unter `cause` liegt, anstatt als beliebiger Fehler, mit dem `fetch` gerade abbrechen wollte. Daher fängt Anwendungscode eine einzige Klasse ab:

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
- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Lifecycle-Hooks und `context.data`-API
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Eigene API-Endpunkte hinzufügen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
- **[Database Branching](/docs/backend/branching)** — Sofortige Datenbankkopien für Dev/Staging
- **[Deployment](/docs/getting-started/deployment)** — Das Backend in Produktion bringen
