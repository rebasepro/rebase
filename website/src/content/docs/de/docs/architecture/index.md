---
sourceHash: b58890f96ff100b4
title: Architektur-Übersicht
sidebar_label: Architektur
description: Erfahren Sie, wie Backend, Frontend, typisiertes SDK und Datenbank von Rebase zusammenwirken, um ein vollständiges Backend-as-a-Service zu bilden.
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

Das Backend wird über ein einheitliches Datenbank-Adapter-Muster initialisiert. Die datenbankspezifische Logik ist in ein eigenes Paket ausgelagert, und der Adapter übernimmt das Connection-Pooling, die Schema-Auflösung sowie das Routing von Echtzeit-Events automatisch.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Jede Tabelle wird über den konfigurierten Adapter aufgelöst – die Standarddatenbank oder diejenige, die ihre `database`-Eigenschaft in `backend/resources.ts` benennt.

:::tip
Der `createPostgresAdapter` übernimmt automatisch das Connection-Pooling der Datenbank, die Schema-Auflösung und die Einrichtung von `LISTEN/NOTIFY` in Echtzeit.
:::

### Tabellen-Deskriptoren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Beim Start kompiliert das Backend die von `backend/schema/index.ts` exportierten Tabellen in
**Deskriptoren**: jede Spalte mit ihrem Postgres-Typ, ihrer Nullability, ihren Validierungs- und
Speicherregeln, den Relationen nach Slug und der Konfiguration der Row-Level Security. Ein
Problem in einer beliebigen Tabelle bricht den Boot-Vorgang mit einem `SchemaDefinitionError` ab,
der alle Probleme auflistet. Die Deskriptoren bilden die Grundlage für REST, Realtime, MCP und
das OpenAPI-Dokument, dienen zur Berechnung der Schema-Version und werden von `GET /api/schema/tables`
an das Admin-Panel und das Studio übergeben (je nach Aufrufer bereinigt). Hook-Code verlässt niemals
den Server. Ein Backend ohne `backend/schema` liest stattdessen die Datenbank per Introspektion in
dieselben Deskriptoren ein.

### Realtime-Service

Die Echtzeitsynchronisierung nutzt den nativen `LISTEN/NOTIFY`-Mechanismus von PostgreSQL:

1. Eine Datenmutation tritt auf (Insert, Update, Delete) – über die API oder einen beliebigen anderen Schreibvorgang auf der Tabelle: `psql`, ein Cron-Job, der SQL-Editor
2. Ein Trigger auf der Tabelle sendet ein `NOTIFY` auf einem Channel (wo der Trigger nicht installiert werden kann, sendet das Backend dieses, allerdings nur bei Schreibvorgängen über die API)
3. Der `RealtimeService` empfängt die Benachrichtigung
4. Er sendet die Änderung per Broadcast an alle verbundenen WebSocket-Clients
5. React-Komponenten rendern sich mit den neuen Daten neu

Bei **Multi-Instanz-Deployments** (z. B. Cloud Run mit mehreren Replikaten) hält jedes Replikat seine eigene `LISTEN`-Verbindung zur selben Datenbank, sodass eine Änderung die Abonnenten jedes Replikats erreicht. Hinter einem Pooler im Transaktionsmodus wie PgBouncer, der keine `LISTEN`-Verbindungen aufrechterhält, setzen Sie `DATABASE_DIRECT_URL` direkt auf die Datenbank selbst.

### Storage-Registry

Ähnlich wie Treiber werden Storage-Backends in einer Registry registriert. Sie können mehrere Storage-Provider (lokal, S3) verwenden und unterschiedliche Storage-Spalten mit `col.storage({ source })` an verschiedene Backends routen.

## Paketübersicht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Paket | Rolle | Verwendet von |
|-------|-------|---------------|
| `@rebasepro/types` | Die Tabellen-Builder (`defineTable`, `col`, `rel`), die Deskriptoren und die Schnittstellen, die alle Pakete gemeinsam nutzen | Überall |
| `@rebasepro/server` | Backend-Server-Initialisierung, REST-API, Auth, Storage, WebSocket; re-exportiert die Builder aus `@rebasepro/server/schema`, einem Einstiegspunkt, der keinen Server-Code lädt | Backend |
| `@rebasepro/server-postgres` | Der Postgres-Treiber: Schema-Planung, Migrationen, RLS-Policies, Realtime | Backend |
| `@rebasepro/codegen` | Generierung des typisierten SDKs aus den Tabellen-Deskriptoren | Dev-Tools |
| `@rebasepro/client` | Typisiertes SDK – HTTP-Transport, WebSocket, Auth | Frontend |
| `@rebasepro/app` | React-Framework – Scaffold, Controller, Formulare, Routen, Hooks, Login-Ansichten, Auth-Controller-Hooks | Frontend |
| `@rebasepro/ui` | Eigenständige UI-Komponentenbibliothek (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Schema-Visualisierer und -Editor, SQL-Konsole, JS-Konsole, RLS-Editor, Storage-Browser | Frontend |
| `@rebasepro/cli` | CLI für Schema-Generierung, DB-Migrationen, SDK-Generierung | Dev-Tools |
| `@rebasepro/forms` | Leichtgewichtiges React-Formular-Zustandsmanagement | Frontend |
| `@rebasepro/plugin-ai` | KI-gestütztes Plugin zur automatischen Feldvervollständigung | Frontend |
| `@rebasepro/cms` | Das Admin-Panel: Eine Ansicht pro Tabelle basierend auf den Deskriptoren, `customizeTable`, Formulare und Routing, CSV/JSON/Excel-Import und -Export | Frontend |
| `@rebasepro/cms-types` | Typen und Hilfsfunktionen des Panels: `customizeTable`-Optionen, Feld-Optionen, Entity-Aktionen sowie das Collection- und Property-View-Modell, das das Panel darstellt (`CollectionConfig`, `StringProperty`, `CollectionCallbacks`, …) | Frontend |
| `@rebasepro/firebase` | Firestore als Quelle, die das Panel direkt liest: `defineFirestoreCollection` | Frontend |
| `@rebasepro/inference` | Felder aus Beispielzeilen ableiten (der „Aus Datei erstellen“-Import des Admins) | Frontend |

## Datenfluss

### Leseablauf
1. Der Benutzer öffnet eine Tabelle im Rebase CMS
2. Das typisierte SDK sendet `GET /api/data/:slug` + öffnet ein WebSocket-Abonnement
3. Das Backend fragt PostgreSQL über Drizzle ORM ab
4. Die Antwort enthält die Zeilen, wie sie von der API bereitgestellt werden; das Panel baut seine Formularwerte aus der Zeile und dem Deskriptor der Tabelle auf
5. Die Antwort wird an das Frontend gesendet, Komponenten werden gerendert
6. WebSocket hält die Ansicht in Echtzeit synchron

### Schreibablauf
1. Der Benutzer bearbeitet eine Zeile im Formular
2. Das typisierte SDK sendet `PATCH /api/data/:slug/:id`
3. Das Backend validiert die Werte anhand der Tabelle und führt die `beforeSave`-Hooks aus
4. Es führt das `UPDATE` unter Berücksichtigung der Row-Level Security des Aufrufers aus
5. `afterSave`-Hooks werden innerhalb derselben Transaktion ausgeführt
6. Der `NOTIFY`-Broadcast löst ein WebSocket-Update für alle Clients aus
7. Falls der Verlauf aktiviert ist, wird ein Snapshot aufgezeichnet

## Nächste Schritte

- **[Schema as Code](/docs/architecture/schema-as-code)** — Der TypeScript-First-Ansatz
- **[Backend-Übersicht](/docs/backend)** — Serverkonfiguration
- **[Tabellen](/docs/schema/)** — Definieren Sie Ihr Datenschema
