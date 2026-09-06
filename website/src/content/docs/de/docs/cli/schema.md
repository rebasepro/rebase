---
sourceHash: 8a90381a6f529677
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle-ORM-Schemas aus Collection-Definitionen, erstellen Sie SQL-Migrationen und halten Sie Ihre Datenbank mit der Rebase-CLI synchron.
---

## Überblick

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der Ihre TypeScript-Collection-Definitionen die einzige Quelle der Wahrheit sind. Die CLI transformiert sie durch eine deterministische Pipeline:

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Collections → Drizzle-Schema

Ihre Collection-Definitionen in `config/collections/` beschreiben Tabellen, Spalten, Typen, Relationen und Enums. Der Befehl `schema generate` liest diese und gibt eine Drizzle-ORM-Schemadatei aus.

### 2. Drizzle-Schema → Migrationen

Aus dem generierten Drizzle-Schema vergleicht `db generate` mit dem aktuellen Datenbankzustand und erzeugt zeitgestempelte SQL-Migrationsdateien.

### 3. Migrationen → PostgreSQL

Der Befehl `db migrate` wendet ausstehende Migrationen auf Ihre PostgreSQL-Datenbank an.

## Befehle

### `rebase schema generate`

Generieren Sie eine Drizzle-ORM-Schemadatei aus Ihren Collection-Definitionen:

```bash
rebase schema generate
```

**Was er tut:**
- Liest alle Collections aus `config/collections/`
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--collections, -c` | Pfad zum Collections-Verzeichnis (Standard: `config/collections/`) |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich — bearbeiten Sie eine Collection-Datei und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema introspect`

Rekonstruieren Sie Collection-Definitionen aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was er tut:**
- Verbindet sich mit Ihrer Datenbank (mit der Verbindungszeichenfolge aus Ihrer `.env`)
- Inspiziert alle Tabellen, Spalten, Typen und Fremdschlüssel
- Generiert Collection-Definitionsdateien

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--output, -o` | Ausgabeverzeichnis für die generierten Collection-Dateien |

Dies ist nützlich, wenn Sie Rebase auf einer bestehenden Datenbank einführen — zuerst introspizieren, dann die generierten Collections anpassen.

### `rebase db push`

Übertragen Sie Schemaänderungen direkt in die Datenbank ohne Migrationsdateien:

```bash
rebase db push
```

**Was er tut:**
- Liest das generierte Drizzle-Schema
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Erstellt **keine** Migrationsdateien

:::caution
`db push` modifiziert die Datenbank direkt. Verwenden Sie es nur in der Entwicklung. Für die Produktion verwenden Sie `db generate` + `db migrate`, um überprüfbare Migrationsdateien zu erstellen.
:::

### `rebase db generate`

Generieren Sie SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

**Was er tut:**
- Vergleicht das Drizzle-Schema mit dem aktuellen Datenbankzustand
- Erzeugt zeitgestempelte SQL-Migrationsdateien im `drizzle/`-Verzeichnis
- Dateien können überprüft, bearbeitet und in die Versionskontrolle committet werden

Die generierten Migrationen sind einfache SQL-Dateien — Sie können sie vor dem Anwenden inspizieren und ändern.

### `rebase db migrate`

Führen Sie alle ausstehenden Migrationen aus:

```bash
rebase db migrate
```

**Was er tut:**
- Liest das `drizzle/`-Verzeichnis nach nicht angewendeten Migrationen
- Wendet sie der Reihe nach auf die Datenbank an
- Verfolgt, welche Migrationen angewendet wurden

### `rebase db branch`

Datenbank-Branching für parallele Entwicklung:

```bash
rebase db branch create feature_auth
rebase db branch list
rebase db branch delete feature_auth
```

### `rebase doctor`

Erkennen Sie Drei-Wege-Drift zwischen Ihren Collection-Definitionen, dem generierten Drizzle-Schema und der laufenden PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was er prüft:**
- Collections ↔ Generiertes Schema — sind sie synchron?
- Generiertes Schema ↔ Datenbank — gibt es nicht angewendete Änderungen?
- Collections ↔ Datenbank — gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer sich etwas nicht synchron anfühlt. Es zeigt genau, wo die Diskrepanz liegt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes Client-SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

**Was er tut:**
- Liest Collections aus `config/collections/` (unterstützt `index.ts`-Barrel-Exports oder einzelne Dateien)
- Generiert TypeScript-Typen für alle Entitäten in `generated/sdk/`
- Erzeugt eine `database.types.ts`-Datei zur Verwendung mit `createRebaseClient<Database>()`

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `-c`, `--collections-dir` | Pfad zum Collections-Verzeichnis (Standard: `config/collections/`) |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Liest das Schema von einem laufenden Projekt statt aus lokalem Quellcode. `link` verwendet das verknüpfte Projekt dieses Checkouts. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY`) |

Mit `--from` kann ein Repository ohne eigene Collections — ein separates Frontend, eine zweite Web-App, eine Mobile-App — einen typisierten Client für das Projekt generieren, mit dem es spricht. `REBASE_SERVICE_KEY` wird nur an das Projekt gesendet, mit dem dieses Checkout verknüpft ist; für jeden anderen Host ist `--token` explizit anzugeben.

**Verwendung nach der Generierung:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Feldnamen in den generierten Typen sind unverändert die, die die API liefert — eine Spalte `createdAt` ist `row.createdAt`. Nur der Collection-*Accessor* wird in einen Property-Namen umgewandelt (`my-notes` → `client.data.myNotes`); genau diese Zuordnung stellt `collectionsDictionary` auf den Slug zurück.

## Entwicklungs-Workflow

Der Workflow für schnelle Iteration in der Entwicklung:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Produktions-Workflow

Der sichere, überprüfbare Workflow für die Produktion:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in drizzle/
# 5. Commit the migration to version control
git add drizzle/

# 6. Apply in production
rebase db migrate
```

## Fehlerbehebung

| Symptom | Lösung |
|---------|----------|
| `Could not detect an active database plugin` | Installieren Sie `@rebasepro/server-postgres` in `backend/package.json` |
| Schemadatei wird nicht aktualisiert | Prüfen Sie, ob der `--collections`-Pfad auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um den Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |

## Nächste Schritte

- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Client-SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
