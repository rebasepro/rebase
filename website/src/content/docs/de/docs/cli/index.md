---
sourceHash: 95791116fe38fd07
title: CLI-Referenz
sidebar_label: CLI
description: Rebase CLI-Befehle zur Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Überblick

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zur Bereitstellung.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder über `pnpm dlx` verwenden:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Maschinenlesbare Ausgabe

`--json` ist der Schalter, und außerhalb der `cloud`-Familie ist er der einzige:
`rebase status --json`, `rebase resources --json` und `rebase apps list --json`
schreiben **einen JSON-Wert nach stdout** — das Ergebnis im Erfolgsfall und im
Fehlerfall eine Hülle `{"error": {"message", "code", "hint", "issues"}}` mit
einem Exit-Code ungleich null. Das gilt bei jedem Ausgang des Befehls, sodass
ein Aufrufer stdout bedingungslos parsen kann. Ohne `--json` schreiben diese
Befehle menschenlesbaren Text, und ein Fehler geht nach stderr.

`rebase cloud` ist die Ausnahme, und zwar bewusst: es verwendet dieselbe Hülle,
schaltet aber auch von sich aus auf JSON um, **wenn stdout kein TTY ist** oder
wenn `REBASE_JSON=1` gesetzt ist. `rebase cloud status | cat` ist also JSON,
`rebase status | cat` nicht. Wer skriptet, übergibt `--json` besser explizit,
statt sich auf eine der beiden Regeln zu verlassen.

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

Dies liest Ihre Sammlungen aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

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

### `rebase generate-sdk`

Generieren Sie ein typisiertes Client-SDK aus Ihren Sammlungsdefinitionen:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für all Ihre Sammlungen.

### `rebase doctor`

Führen Sie Diagnosen aus, um Abweichungen (Drift) zwischen Ihren Sammlungen, dem generierten Schema und dem aktuellen Datenbankzustand zu erkennen:

```bash
rebase doctor
```

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

## Migrations-Workflow

Der typische Workflow für Schemaänderungen:

```bash
# 1. Edit your collection in config/collections/
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
