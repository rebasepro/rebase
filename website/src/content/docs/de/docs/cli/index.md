---
title: CLI-Referenz
sidebar_label: CLI
slug: docs/cli
description: Rebase CLI-Befehle zur Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Überblick

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zur Bereitstellung.

## Installation

```bash
npm install -g @rebasepro/cli
```

Oder über `npx` verwenden:

```bash
npx @rebasepro/cli <command>
```

## Befehle

### `rebase init`

Initialisieren Sie ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend-, Backend- und Shared-Paketen ein.

### `rebase dev`

Starten Sie den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading.

### `rebase schema generate`

Generieren Sie das Drizzle ORM-Schema aus Ihren TypeScript-Sammlungen:

```bash
rebase schema generate
```

Dies liest Ihre Sammlungen aus `shared/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Übertragen Sie Schemaänderungen direkt an die Datenbank (nur Entwicklung):

```bash
rebase db push
```

:::caution
`db push` ändert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

Generieren Sie SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

Erstellt zeitgestempelte Migrationsdateien in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Führen Sie ausstehende Datenbankmigrationen aus:

```bash
rebase db migrate
```

Wendet alle noch nicht angewendeten Migrationen auf die Datenbank an.

### `rebase db studio`

Öffnen Sie Drizzle Studio, um Ihre Datenbank visuell zu durchsuchen:

```bash
rebase db studio
```

### `rebase generate_sdk`

Generieren Sie ein typisiertes Client-SDK aus Ihren Sammlungsdefinitionen:

```bash
rebase generate_sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für all Ihre Sammlungen.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth create-user --email admin@example.com --password secret
rebase auth reset-password --email admin@example.com
```

## Migrations-Workflow

Der typische Workflow für Schemaänderungen:

```bash
# 1. Edit your collection in shared/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Nächste Schritte

- **[Schema als Code](/docs/architecture/schema-as-code)** — Wie die Schema-Generierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte

---
