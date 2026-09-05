---
title: Backend-Übersicht
sidebar_label: Backend
description: Das Rebase-Backend bietet einen vollständigen Server mit REST-API, Authentifizierung, Speicher, WebSocket-Echtzeitkommunikation und Entitätshistorie – alles mit einem einzigen Funktionsaufruf initialisiert.
---

## Überblick

Das Rebase-Backend ist ein auf [Hono](https://hono.dev/) basierender **Node.js-Server**, der Folgendes bietet:

- **REST-API** — Automatisch generierte CRUD-Endpunkte für jede Sammlung
- **Authentifizierung** — JWT-Token, OAuth- und OIDC-Anmeldung, Magic Links, Einmalcodes, MFA, API-Schlüssel, Benutzer-/Rollenverwaltung
- **Speicher** — Datei-Upload/Download mit lokalem Dateisystem oder S3
- **WebSocket** — Echtzeit-Datensynchronisation über PostgreSQL LISTEN/NOTIFY
- **Entitätshistorie** — Audit-Trail für jede Datenänderung
- **Datenbank-Verzweigung** — Sofortige, isolierte Datenbankkopien für Entwicklung/Staging/Tests
- **Cron-Jobs** — Geplante Hintergrundaufgaben mit Überwachungs-Dashboard

Alles wird mit einer einzigen Funktion initialisiert:

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

## Was erstellt wird

Nach der Initialisierung werden diese Routen gemountet:

| Pfad | Zweck |
|------|---------|
| `/api/auth/*` | Authentifizierung (Registrierung, Anmeldung, Aktualisierung, OAuth, Magic Links, Einmalcodes, MFA) |
| `/api/admin/*` | Benutzer- und Rollenverwaltung (nur für Administratoren) |
| `/api/storage/*` | Datei-Upload, -Download und -Löschung |
| `/api/data/:slug` | CRUD-Operationen pro Sammlung (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Entitätsänderungshistorie (falls aktiviert) |
| `/api/docs` | OpenAPI-Spezifikation (wenn `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (Entwicklungsmodus, wenn `enableSwagger: true`) |
| `/api/meta/contract` | Das Sammlungsschema des Projekts (nur Admin) |
| `/api/meta/schema-version` | Eine Versionszeichenfolge für dieses Schema (nicht authentifiziert) |
| `/api/functions/*` | Benutzerdefinierte Funktionsrouten (wenn `functionsDir` gesetzt ist) |
| `/api/cron/*` | Cron-Job-Verwaltung (nur für Administratoren, wenn `cronsDir` gesetzt ist) |
| WebSocket bei Upgrade | Echtzeit-Abonnements |

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

    // Bootstrappers (Databases, Auth, Realtime, etc.)
    bootstrappers: BackendBootstrapper[];

    // Authentication
    auth?: AuthConfig;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;        // Auto-load cron jobs from a directory

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

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

> **Hinweis:** Obwohl die `instance` diese internen Dienste offenlegt, sollte Anwendungscode (wie benutzerdefinierte Funktionen und Cron-Jobs) das globale `rebase`-Singleton von `@rebasepro/server` verwenden, um mit der Backend-API zu interagieren.

## REST-API

Die REST-API wird automatisch aus Ihren Sammlungen generiert. Jede Sammlung erhält diese Endpunkte:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten (mit Filter, Sortierung, Limit, Suche) |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Eine neue Entität erstellen |
| `DELETE` | `/api/data/:slug/:id` | Eine Entität löschen |

### Abfrageparameter

| Parameter | Beschreibung | Beispiel |
|-------|-------------|---------|
| `filter` | JSON-kodierte Filterbedingungen | `?filter={"active":["==",true]}` |
| `orderBy` | Sortierfeld | `?orderBy=createdAt` |
| `order` | Sortierrichtung | `?order=desc` |
| `limit` | Seitengröße | `?limit=25` |
| `startAfter` | Cursor für die Paginierung | `?startAfter=encodedCursor` |
| `search` | Volltextsuche | `?search=laptop` |

## WebSocket

Der WebSocket-Server bindet sich an denselben HTTP-Server und bietet Echtzeit-Abonnements:

- Abonnieren Sie **Sammlungsänderungen** — werden Sie benachrichtigt, wenn eine Entität in einer Sammlung erstellt, aktualisiert oder gelöscht wird
- Abonnieren Sie **Entitätsänderungen** — werden Sie benachrichtigt, wenn sich eine bestimmte Entität ändert
- Automatische **Wiederverbindungs**-Behandlung im Client-SDK

Das Backend verwendet intern PostgreSQL `LISTEN/NOTIFY`. Für Multi-Instanz-Bereitstellungen geben Sie einen `connectionString` in Ihrem `PostgresBootstrapper` an, um die Instanz-übergreifende Übertragung zu ermöglichen.

## Fehlerbehandlung

Das Backend enthält einen Fehler-Handler, der alle Ausnahmen abfängt und strukturierte Fehlerantworten zurückgibt:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Feld | Immer vorhanden | Was es ist |
|------|:---------------:|------------|
| `message` | ja | Für einen Menschen geschrieben, der es in einer Konsole liest. Benennt das Hindernis, nicht die Regel. |
| `code` | ja | `SCREAMING_SNAKE_CASE` und stabil. Auf dieses Feld verzweigt Client-Code. |
| `details` | nein | Strukturierte Nutzlast, wenn die Ablehnung *über* etwas ist — eine Liste fehlgeschlagener Pfade, eine Menge unbekannter Felder. |
| `requestId` | nein | Vorhanden, wenn die Anfrage eine trug oder eine zugewiesen bekam; spiegelt `X-Request-ID`. In einem Fehlerbericht angeben. |

Der HTTP-Status steht in der Antwort, nicht im Body. Verzweigen Sie auf `code`,
nicht auf `message` — Meldungen sind für Menschen geschrieben und dürfen sich ändern.

Schlägt die Initialisierung fehl (z. B. Datenbankverbindungsfehler), startet der Server trotzdem, gibt aber für alle API-Anfragen 503 zurück, mit einer beschreibenden Fehlermeldung in den Logs.

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication)** — JWT, OAuth- und OIDC-Provider, MFA, API-Schlüssel, Benutzerverwaltung
- **[Speicher](/docs/backend/storage)** — Lokaler und S3-Dateispeicher
- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Lebenszyklus-Hooks und `context.data`-API
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
- **[Cron-Jobs](/docs/backend/cron-jobs)** — Geplante Hintergrundaufgaben
- **[Datenbank-Verzweigung](/docs/backend/branching)** — Sofortige Datenbankkopien für Entwicklung/Staging

---
