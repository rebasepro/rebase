---
title: Architektur-Übersicht
sidebar_label: Architektur
description: Erfahren Sie, wie sich Backend, Frontend, Client-SDK und Datenbank von Rebase zu einem vollständigen Backend-as-a-Service integrieren.
---

## Systemarchitektur

Rebase ist eine Full-Stack-Plattform mit vier Schichten:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend-Schicht                         │
│  React Admin UI  •  Custom Views  •  Plugins  •  Ihre App       │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend-Schicht                          │
│  Hono HTTP Server  •  REST API  •  Auth  •  Speicher  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Datenbank-Schicht                         │
│  PostgreSQL  •  Tabellen  •  RLS-Richtlinien  •  Echtzeitsync   │
└─────────────────────────────────────────────────────────────────┘
```

## Hauptkomponenten

### Datenbank-Adapter-System

Das Backend wird über ein einheitliches Datenbank-Adapter-Muster initialisiert. Die datenbankspezifische Logik ist in ihr eigenes Paket entkoppelt, und der Adapter kümmert sich automatisch um Connection Pooling, Schemaauflösung und Event-Routing in Echtzeit.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Sammlungen werden automatisch über die interne Dependency-Injection-Registrierung mit dem konfigurierten Adapter aufgelöst.

:::tip
Der `createPostgresAdapter` kümmert sich automatisch um Connection Pooling, Schemaauflösung und Echtzeit-`LISTEN/NOTIFY`-Konfiguration.
:::

### Sammlungsregistrierung

Das `BackendCollectionRegistry` ist der Laufzeitindex aller Sammlungen, ihrer PostgreSQL-Tabellen, Enums und Drizzle-Relationen. Es wird beim Start aus Ihren Sammlungsdefinitionen befüllt.

### Echtzeitdienst

Die Echtzeitsynchronisierung nutzt den nativen `LISTEN/NOTIFY`-Mechanismus von PostgreSQL:

1. Eine Datenmutation findet statt (Einfügen, Aktualisieren, Löschen)
2. Das Backend sendet ein `NOTIFY` auf einem Kanal
3. Der `RealtimeService` empfängt die Benachrichtigung
4. Er überträgt die Änderung an alle verbundenen WebSocket-Clients
5. React-Komponenten rendern neu mit den neuen Daten

Für **Multi-Instance-Deployments** (z.B. Cloud Run mit mehreren Replikaten) geben Sie eine `connectionString` in Ihrem PostgresBootstrapper an, damit alle Replikate dieselbe `LISTEN`-Verbindung teilen.

### Speicherregistrierung

Wie Treiber werden auch Speicher-Backends in einer Registrierung erfasst. Sie können mehrere Speicheranbieter (lokal, S3) haben und verschiedene Dateifelder über `storageId` an verschiedene Backends leiten.

## Paketübersicht

| Paket | Rolle | Verwendet von |
|-------|-------|---------------|
| `@rebasepro/types` | TypeScript-Schnittstellen für Sammlungen, Eigenschaften, Entitäten, Plugins | Alles |
| `@rebasepro/server` | Backend-Serverinitialisierung, REST-API, Auth, Speicher, WebSocket | Backend |
| `@rebasepro/client` | Client-SDK — HTTP-Transport, WebSocket, Auth | Frontend |
| `@rebasepro/app` | React-Framework — Scaffold, Controller, Formulare, Routen, Hooks | Frontend |
| `@rebasepro/ui` | Eigenständige UI-Komponentenbibliothek (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Login-Ansichten, Auth-Controller-Hooks, Benutzerverwaltung | Frontend |
| `@rebasepro/studio` | Sammlungseditor, SQL-Konsole, JS-Konsole, RLS-Editor, Speicherbrowser | Frontend |
| `@rebasepro/cli` | CLI für Schema-Generierung, DB-Migrationen, SDK-Generierung | Entwicklertools |
| `@rebasepro/forms` | Leichtes React-Formularstatusmanagement | Frontend |
| `@rebasepro/plugin-ai` | KI-gestütztes Plugin zur automatischen Feldvervollständigung | Frontend |
| `@rebasepro/plugin-data-import-export` | CSV/JSON/Excel-Import und -Export | Frontend |
| `@rebasepro/inference` | Automatische Schemaerkennung aus vorhandenen Datenbankdaten | Backend/CLI |

## Datenfluss

### Lesefluss
1. Der Benutzer öffnet eine Sammlung in der Admin-UI
2. Das Client-SDK sendet `GET /api/data/:slug` + öffnet ein WebSocket-Abonnement
3. Das Backend fragt PostgreSQL über Drizzle ORM ab
4. Der Datentransformator deserialisiert die Datenbankeinträge in das Entitätsformat
5. Die Antwort wird an das Frontend gesendet, Komponenten rendern
6. WebSocket hält die Ansicht in Echtzeit synchronisiert

### Schreibfluss
1. Der Benutzer bearbeitet eine Entität im Formular
2. `beforeSave`-Callbacks werden ausgeführt (Validierung, Transformation)
3. Das Client-SDK sendet `PATCH /api/data/:slug/:id`
4. Das Backend serialisiert die Werte, führt Drizzle `UPDATE` aus
5. `afterSave`-Callbacks werden ausgeführt (Nebeneffekte)
6. Der `NOTIFY`-Broadcast löst ein WebSocket-Update an alle Clients aus
7. Wenn der Verlauf aktiviert ist, wird ein Entity aufgezeichnet

## Nächste Schritte

- **[Schema als Code](/docs/architecture/schema-as-code)** — Der TypeScript-First-Ansatz
- **[Backend-Übersicht](/docs/backend)** — Serverkonfiguration
- **[Sammlungen](/docs/collections)** — Definieren Sie Ihr Datenschema
