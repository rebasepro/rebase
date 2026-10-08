---
sourceHash: 7edfb533f917e6ae
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
| `--collections, -c` | Collections-Verzeichnis (Standard: `config/collections/`); relative Pfade werden ausgehend vom Verzeichnis aufgelöst, in dem Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden ausgehend vom Verzeichnis aufgelöst, in dem Sie den Befehl ausführen |
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

**Introspektion, gefolgt von Push, ändert nichts.** Die generierten Eigenschaften geben exakt an, was jede Spalte ist — `columnType`, `precision`/`scale`, `defaultValue`, `required`, das `isId` eines Schlüssels (`"increment"` für eine ganzzahlige Identity, `columnType: "serial"` für ein Serial, `"manual"` für einen Schlüssel ohne Default), das `onDelete` einer Relation sowie der `search`-Block einer Collection, zurückgelesen aus der Spalte, die er aufgebaut hat — daher plant `rebase db push --dry-run` direkt nach einer Introspektion keine Änderungen. Wo keine Eigenschaft eine Spalte vollständig abbilden kann — ein `timestamp` ohne Zeitzone, ein `interval`, ein `inet`, ein Enum-Typ, der nicht `<table>_<column>` heißt, ein Default wie `CURRENT_DATE` — weist die Introspektion pro Spalte darauf hin, im Terminal und am Anfang der Datei, mit dem, was ein Push damit tun würde, und, wenn vorhanden, dem Statement, das die beiden in Übereinstimmung bringt (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Eine Tabelle, deren Schlüssel aus mehr als einer Spalte besteht, kommt als ein zusammengesetzter Schlüssel zurück, wobei jede Schlüsselspalte ihr `isId` trägt. Sie wird mit ihrem Grund ausgelassen, wenn eine Schlüsselspalte kein `isId` tragen kann (etwa ein Timestamp) oder der Fremdschlüssel einer anderen Tabelle auf sie verweist, was eine einspaltige Relation nicht kann; `db push` lässt eine Tabelle, die keine Collection ist, unangetastet. Auf 0.23 kann der Push direkt nach einer Introspektion weiterhin Typänderungen, entfernte Defaults und NOT NULLs sowie einen Phantom-`id`-Schlüssel planen.

### `rebase db push`

Übertragen Sie Schemaänderungen direkt in die Datenbank ohne Migrationsdateien:

```bash
rebase db push
```

**Was er tut:**
- Liest das generierte Drizzle-Schema
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Führt den Plan zuerst als Dry-Run aus und hält vor jeder Änderung an, die Daten zerstört: eine gelöschte Tabelle, Spalte, View, ein gelöschtes Schema oder ein gelöschter Typ, ein `TRUNCATE` eine Änderung des Spaltentyps, bei der Werte verloren gehen können (`timestamptz` → `date`, `numeric` → `integer`), oder eine Änderung des Primärschlüssels – `(id)` → `(id, locale)` gibt jeder Zeile eine neue ID, sodass Links, Fremdschlüssel und anderswo gespeicherte IDs ihre Zeile nicht mehr finden. Im Terminal fragt er nach, sonst verweigert er; `--allow-destructive` (oder `--yes`) wendet die Änderung trotzdem an
- Schaltet Row-Level Security für jede Collection-Tabelle ein, Junction-Tabellen eingeschlossen, direkt nach der Schemaänderung und vor jedem Schritt, der fehlschlagen kann – ein Push, der mittendrin abbricht, hinterlässt eine neue Tabelle also verweigernd statt offen für jede Anfrage
- Wendet die RLS-Policies Ihrer Collections an und **entfernt Policies, die ein früherer Push ersetzt hat**
- Erstellt **keine** Migrationsdateien

**Die Dateien, die dabei entstehen**, alle unter `.rebase/sql/` im Backend-Verzeichnis. `db push` und `db generate` schreiben alle fünf bei jedem Lauf aus Ihren Collections, bevor sie eine davon lesen, daher würde eine committete Kopie von nichts gelesen. Das Verzeichnis bringt seine eigene `.gitignore` mit und wird nie committet.

| Datei | Enthält |
|------|-------|
| `schema.sql` | Tabellen, Spalten, Constraints und Indizes — der Soll-Zustand für Atlas und das Einzige, was Atlas vergleicht |
| `policies.sql` | Die RLS-Policies, zu denen Ihre `securityRules` kompiliert werden |
| `search.sql` | Die Volltextsuch-Funktionen und generierten Spalten für Collections mit einem `search`-Block |
| `vector.sql` | pgvector-Extensions und ANN-Indizes |
| `triggers.sql` | `rebase.set_updated_at()` und die `BEFORE UPDATE`-Trigger hinter `autoValue: "on_update"` |

Atlas verwaltet nur die erste Datei, deshalb wenden `db push` und der Schema-Abgleich beim Start die anderen vier selbst an. Ein Deployment **nur mit Migrationen** — eines, das `db migrate` ausführt und nie `db push` — muss diese vier von Hand in eine Migration übernehmen; `db generate` weist darauf hin, wenn eine Änderung für Atlas unsichtbar ist.

Hat ein Projekt diese Dateien unter einem früheren Release nach `drizzle/` committet, werden diese Kopien beim ersten Lauf gelöscht, und der Befehl nennt jede einzeln, damit Sie das Löschen committen können. Gelöscht werden nur Dateien, die mit dem Header des Generators beginnen. Eine Datei, die Sie selbst geschrieben haben, bleibt, ebenso `drizzle/migrations/`.

:::note[Eine Sicherheitsregel zu bearbeiten benennt ihre Policy um]
Eine Regel ohne expliziten `name` wird zu `<table>_<op>_<hash>` kompiliert, wobei der Hash die Semantik der Regel abdeckt — eine Regel zu *bearbeiten* (statt eine hinzuzufügen) erzeugt also eine Policy unter einem neuen Namen und lässt die alte zurück.

Früher war das sehr wichtig: Postgres verknüpft `PERMISSIVE`-Policies mit OR, daher gewährte ein ersetztes `USING (rebase.uid() IS NOT NULL)` weiterhin alles, egal wie streng seine Ersetzung war. Eine Regel zu verschärfen hatte keine Wirkung, und der Push meldete Erfolg.

`db push` gleicht das jetzt ab: Es löscht generierte Policies, die zu keiner Regel mehr passen, und meldet — ohne sie zu löschen — jede Policy mit eigenem Namen, die Ihre Collections nicht beschreiben, da sie sich nicht von SQL unterscheiden lässt, das jemand absichtlich geschrieben hat.

Um eine Datenbank zu prüfen, die vor dieser Änderung gepusht wurde, führen Sie `rebase doctor --policies` aus. Es funktioniert als CI-Gate: Es endet bei Drift mit einem Exit-Code ungleich null, und ebenso, wenn es die Prüfung gar nicht ausführen konnte — keine `DATABASE_URL`, ein `--collections`-Pfad, der sich nicht auflösen lässt, ein Lesen von `pg_policies`, das der CI-Rolle nicht erlaubt ist. Ein Gate, das nicht hinsehen konnte, hat nicht bestanden.
:::

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
- Erzeugt zeitgestempelte SQL-Migrationsdateien in `drizzle/migrations/`
- Dateien können überprüft, bearbeitet und in die Versionskontrolle committet werden

Die generierten Migrationen sind einfache SQL-Dateien — Sie können sie vor dem Anwenden inspizieren und ändern.

### `rebase db migrate`

Führen Sie alle ausstehenden Migrationen aus:

```bash
rebase db migrate
```

**Was er tut:**
- Liest `drizzle/migrations/` nach nicht angewendeten Migrationen
- Wendet sie der Reihe nach auf die Datenbank an
- Verfolgt, welche Migrationen angewendet wurden

#### Baseline für eine Datenbank, gegen die Rebase bereits gebootet hat

Jeder Rebase-Start stellt das Schema sicher, und `rebase db push` wendet es direkt an. Eine Datenbank, gegen die je eines von beiden gelaufen ist, hat die Tabellen und Typen also bereits, die die erste Migration anlegen würde — und `rebase db migrate` bricht mit `pq: type "posts_status" already exists (42710)` ab.

An der Migration ist nichts falsch: Die Datenbank wurde auf einem anderen Weg bereitgestellt. Halten Sie fest, wo sie bereits steht, und migrieren Sie dann normal:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version ist das Zahlenpräfix der Migrationsdatei, die den *aktuellen* Stand der Datenbank beschreibt. Diese Migration und alle davor gelten als angewendet; alles danach läuft. Gegen eine Datenbank, gegen die nie gebootet wurde, braucht es keine Baseline — migrieren Sie einfach direkt.

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

Generieren Sie ein typisiertes SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

**Was er tut:**
- Liest jede Collection-Datei in `config/collections/` — die Dateien, die das Backend ausliefert, unabhängig davon, ob der `index.ts`-Barrel sie auflistet — und bricht bei einer Datei ab, die nicht geladen werden kann
- Generiert TypeScript-Typen für alle Entitäten in `generated/sdk/`
- Erzeugt eine `database.types.ts`-Datei zur Verwendung mit `createRebaseClient<Database>()`

`rebase dev` führt dies beim Start und bei jedem Speichern unter
`config/collections/` für Sie aus. Selbst ausführen müssen Sie es in CI, in einem
Repository ohne Collections (siehe `--from` unten) oder überall dort, wo
`rebase dev` nicht läuft.

gilt das für das Lesen jeder Datei, das Abbrechen bei einer
defekten Datei, das Ausführen durch `rebase dev` und `--collections` bei diesem
Befehl. Auf 0.23 liest es die Dateien, die der `index.ts`-Barrel auflistet,
überspringt eine nicht ladbare mit einer Warnung und verwendet das Verzeichnis
als `--collections-dir`; `rebase dev` generiert dabei nur das Schema neu.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `-c`, `--collections` | Collections-Verzeichnis (Standard: `config/collections/`); relative Pfade werden ausgehend vom Verzeichnis aufgelöst, in dem Sie den Befehl ausführen. `--collections-dir` wird ebenfalls akzeptiert. |
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

# 4. Review the generated SQL in drizzle/migrations/
# 5. Commit the migration to version control
git add drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see the baselining section above.
rebase db migrate
```

## Fehlerbehebung

| Symptom | Lösung |
|---------|----------|
| `Could not detect an active database plugin` | Installieren Sie `@rebasepro/server-postgres` in `backend/package.json` |
| Schemadatei wird nicht aktualisiert | Prüfen Sie, ob der `--collections`-Pfad auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um den Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |
| `db migrate` scheitert mit `already exists (42710)` | Start oder `db push` haben das Schema bereits bereitgestellt — halten Sie es mit `rebase db migrate --baseline <version>` fest |

## Nächste Schritte

- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
