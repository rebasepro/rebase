---
sourceHash: fa7350988287074c
title: Architektur-Überblick
sidebar_label: Architektur
description: Erfahren Sie, wie Backend, Frontend, Client-SDK und Datenbank von Rebase ineinandergreifen, um ein vollständiges Backend-as-a-Service zu bilden.
---

## Systemarchitektur

Rebase ist eine Full-Stack-Plattform mit vier Schichten:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Hauptkomponenten

### Datenbank-Adapter-System

Das Backend initialisiert sich über ein einheitliches Datenbank-Adapter-Muster. Die datenbankspezifische Logik ist in ein eigenes Paket ausgelagert, und der Adapter übernimmt automatisch das Connection Pooling, die Schema-Auflösung und das Routing von Echtzeit-Ereignissen.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Collections werden über die interne Dependency-Injection-Registry automatisch anhand des konfigurierten Adapters aufgelöst.

:::tip
Der `createPostgresAdapter` übernimmt automatisch das Datenbank-Connection-Pooling, die Schema-Auflösung sowie das Setup von `LISTEN/NOTIFY` in Echtzeit.
:::

### Collection-Registry

Die `BackendCollectionRegistry` ist der Laufzeitindex aller Collections, ihrer PostgreSQL-Tabellen, Enums und Drizzle-Relationen. Sie wird beim Start aus Ihren Collection-Definitionen befüllt.

### Realtime-Service

Die Echtzeitsynchronisierung nutzt den nativen `LISTEN/NOTIFY`-Mechanismus von PostgreSQL:

1. Eine Datenmutation findet statt (Insert, Update, Delete)
2. Das Backend sendet ein `NOTIFY` auf einem Kanal
3. Der `RealtimeService` empfängt die Benachrichtigung
4. Er überträgt die Änderung per Broadcast an alle verbundenen WebSocket-Clients
5. React-Komponenten werden mit den neuen Daten neu gerendert

Geben Sie bei **Multi-Instanz-Deployments** (z. B. Cloud Run mit mehreren Replikaten) einen `connectionString` in Ihrem PostgresBootstrapper an, damit alle Replikate dieselbe `LISTEN`-Verbindung gemeinsam nutzen.

### Storage-Registry

Wie Treiber werden auch Storage-Backends in einer Registry registriert. Sie können mehrere Storage-Provider (lokal, S3) verwenden und verschiedene Dateifelder mithilfe von `storageId` an unterschiedliche Backends weiterleiten.

## Paketübersicht

| Paket | Rolle | Verwendet von |
|-------|-------|---------------|
| `@rebasepro/types` | TypeScript-Schnittstellen für Collections, Eigenschaften, Entitäten, Plugins | Alles |
| `@rebasepro/server` | Backend-Server-Initialisierung, REST-API, Auth, Storage, WebSocket | Backend |
| `@rebasepro/client` | Client-SDK – HTTP-Transport, WebSocket, Auth | Frontend |
| `@rebasepro/app` | React-Framework – Scaffold, Controller, Formulare, Routen, Hooks | Frontend |
| `@rebasepro/ui` | Eigenständige UI-Komponentenbibliothek (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Login-Ansichten, Auth-Controller-Hooks, Benutzerverwaltung | Frontend |
| `@rebasepro/studio` | Collection-Editor, SQL-Konsole, JS-Konsole, RLS-Editor, Storage-Browser | Frontend |
| `@rebasepro/cli` | CLI für Schemagenerierung, DB-Migrationen, SDK-Generierung | Dev-Tooling |
| `@rebasepro/forms` | Leichtgewichtiges React-Formular-Zustandsmanagement | Frontend |
| `@rebasepro/plugin-ai` | KI-gestütztes Plugin zur automatischen Feldvervollständigung | Frontend |
| `@rebasepro/plugin-data-import-export` | CSV/JSON/Excel-Import und -Export | Frontend |
| `@rebasepro/inference` | Automatische Schemaerkennung aus vorhandenen Datenbankdaten | Backend/CLI |

## Datenfluss

### Leseablauf
1. Benutzer öffnet eine Collection im Rebase CMS
2. Client-SDK sendet `GET /api/data/:slug` + öffnet ein WebSocket-Abonnement
3. Backend fragt PostgreSQL über Drizzle ORM ab
4. Daten-Transformer deserialisiert Datenbankdatensätze in das Entitätsformat
5. Antwort wird an das Frontend gesendet, Komponenten rendern
6. WebSocket hält die Ansicht in Echtzeit synchron

### Schreibablauf
1. Benutzer bearbeitet eine Entität im Formular
2. `beforeSave`-Callbacks werden ausgeführt (Validierung, Transformation)
3. Client-SDK sendet `PATCH /api/data/:slug/:id`
4. Backend serialisiert Werte, führt Drizzle-`UPDATE` aus
5. `afterSave`-Callbacks werden ausgeführt (Nebeneffekte)
6. `NOTIFY`-Broadcast löst ein WebSocket-Update an alle Clients aus
7. Wenn der Verlauf aktiviert ist, wird ein Snapshot aufgezeichnet

## Nächste Schritte

- **[Schema as Code](/docs/architecture/schema-as-code)** — Der TypeScript-First-Ansatz
- **[Backend Overview](/docs/backend)** — Serverkonfiguration
- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenschema
