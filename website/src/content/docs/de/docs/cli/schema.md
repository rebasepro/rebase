---
sourceHash: 57827b30798a9e0d
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle-ORM-Schemas aus den Tabellen in backend/schema, erstellen Sie SQL-Migrationen, introspektieren Sie eine bestehende Datenbank in defineTable-Dateien und halten Sie Ihre Datenbank mit der Rebase-CLI synchron.
---

## Übersicht

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der die Tabellen, die Sie mit
`defineTable` in `backend/schema/` deklarieren, die Single Source of Truth sind. Die CLI
transformiert sie über eine deterministische Pipeline:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Tabellen → Drizzle-Schema

Die Tabellen, die `backend/schema/index.ts` exportiert, beschreiben Spalten, Typen, Relationen,
Enums und Row-Level Security. Jeder nachfolgende Befehl liest sie über den Loader ein,
mit dem das Backend startet. Ein Schema, das nicht kompiliert – eine Tabelle ohne
`rls`, `"inherit"` ohne `defaultRls`, ein `defineTable`, das der Index nicht
exportiert –, bricht den Befehl mit einem `SchemaDefinitionError` ab, der jedes Problem benennt,
und es wird nichts geschrieben. Der Befehl `schema generate` gibt daraus eine Drizzle-ORM-Schemadatei aus.

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für ein Projekt,
das seine Tabellen an einem anderen Ort verwaltet; der Standardwert ist `backend/schema` oder der
Schlüssel `tables` der Backend-App in `rebase.json`. Das Flag `--collections` / `-c` aus Versionen
vor 0.31 wird mit einer Meldung abgelehnt, die auf das Codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)) verweist, ebenso wie ein
Projekt, das noch `config/collections` enthält.

### 2. Deklariertes Schema → Migrationen

`db generate` rendert Tabellen, Policies, Funktionen, Indizes, Trigger und
Views als gewünschtes SQL-Schema für Ptah. Ptah vergleicht es mit den
Migrationen in `backend/drizzle/migrations/`, die in einer Scratch-Datenbank
wiedergegeben werden, und schreibt eine neue Migration. Rebase liest auch die
Zieldatenbank, um Objekte zu schützen, die es nicht verwaltet. Eine Spalte,
die Boot oder `db push` bereits angelegt hat, erscheint trotzdem in der
Migration: Ausgangspunkt des Diffs ist die Migrationshistorie.

### 3. Migrationen → PostgreSQL

Der Befehl `db migrate` wendet ausstehende Migrationen auf Ihre PostgreSQL-Datenbank an.

## Befehle

### `rebase schema generate`

Generieren Sie eine Drizzle-ORM-Schemadatei aus Ihren Tabellen:

```bash
rebase schema generate
```

**Was es tut:**
- Liest die Tabellen ein, die `backend/schema/index.ts` exportiert
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema`); relative Pfade werden relativ zum Ausführungsort des Befehls aufgelöst |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden relativ zum Ausführungsort des Befehls aufgelöst |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich – bearbeiten Sie eine Tabellendatei und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Prüfen Sie, ob das generierte Schema noch mit den Tabellen übereinstimmt:

```bash
rebase schema stale          # Bericht erstellen und Exit-Code 1 zurückgeben, falls etwas veraltet ist
rebase schema stale --fix    # Datei stattdessen neu generieren
```

**Was es tut:**
- Rendert das, was die Tabellen in `backend/schema/` generieren, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied – eine fehlende Tabelle, eine Spalte mit geändertem Typ, ein entferntes Enum-Label oder Fremdschlüssel, die so benannt sind, wie eine frühere Version sie abgeleitet hat – und beendet sich mit einem Exit-Code ungleich null
- Mit `--fix` wird die Datei neu generiert, anstatt nur einen Bericht auszugeben

`rebase dev` hält die Datei automatisch aktuell, daher dient dies als Prüfung für einen Build
oder einen CI-Schritt. Der Befehl akzeptiert `--schema-dir` und `--output` genau wie `rebase schema generate`.

### `rebase schema reconcile`

Lockern und entfernen Sie, was der Boot-Vorgang nicht bereinigt, nachdem Sie den Plan geprüft haben:

```bash
rebase schema reconcile                         # NOT NULL für Spalten aufheben, die nullable gemacht oder entfernt wurden
rebase schema reconcile --drop voice_cache.wav  # und eine Spalte entfernen, die von keiner Tabelle mehr deklariert wird
```

**Was es tut:**
- Fordert das laufende Backend auf, einen Plan gegen seine eigene Datenbank zu erstellen. Das ist das Backend, auf das `.env` und der Cloud-Link zeigen, sodass es auch auf Rebase Cloud funktioniert, wo sonst nichts die Datenbank erreicht.
- Plant `DROP NOT NULL` für jede Spalte, die eine Tabelle als nullable deklariert, die Datenbank aber weiterhin zwingend erfordert.
- Listet jede Spalte auf, die von keiner Tabelle deklariert wird. Eine Spalte, die `NOT NULL` ohne Standardwert ist, blockiert jedes Einfügen, daher wird auch sie gelockert und ihre Daten bleiben erhalten. Es werden nur die Spalten gelöscht, die Sie mit `--drop <table>.<column>` angeben, und es wird angezeigt, wie viele Zeilen jeweils einen Wert enthalten.
- Wird angewendet, sobald Sie `yes` eingeben. Der Server führt den Plan nur anhand des Hashwerts des von Ihnen geprüften Plans aus; falls sich die Datenbank oder die Tabellen in der Zwischenzeit geändert haben, verweigert er die Ausführung und Sie müssen erneut prüfen. `--yes` überspringt die Bestätigungsabfrage.

Der Boot-Vorgang fügt immer nur hinzu. Wenn Sie also eine Spalte aus ihrem `defineTable` entfernen, bleibt die Spalte mitsamt ihren Daten in der Datenbank erhalten. Eine `NOT NULL`-Spalte ohne Standardwert führt dann dazu, dass jedes Einfügen fehlschlägt, und das Boot-Log verweist für diesen Fall auf diesen Befehl: ohne `--drop`, um die Daten zu behalten, mit `--drop`, um die Spalte zu entfernen. Rollen Sie die Tabellenänderung zuerst aus, da Reconcile gegen das plant, was das Backend ausführt. Es erfordert `REBASE_SERVICE_KEY` in `.env`. Lokal deckt `rebase db push` dasselbe über seine Sperre für destruktive Änderungen ab.

### `rebase schema introspect`

Schreiben Sie `defineTable`-Dateien aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was es tut:**
- Verbindet sich mit der Datenbank dieses Projekts, die von `rebase db url` ausgegeben wird (die verwaltete Instanz wird gestartet, falls es sich darum handelt); `--database-url` gibt eine andere an und `--docker` verwendet die Compose-Instanz
- Liest jede Tabelle, Spalte, jeden Typ, Fremdschlüssel und jede Policy ein und schreibt
  `backend/schema/<table>.ts` – ein `defineTable` pro Tabelle – sowie die
  `backend/schema/index.ts`, die sie exportiert (zusammengeführt mit einem Index, der
  bereits vorhanden ist)
- Deklariert jede Spalte mit ihrem Postgres-Typ: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, ein Enum mit seinen Labels und dem echten Typnamen
  (ein `pgEnum`, wenn der Typ geteilt wird), ein Array als `<item>.array()`,
  `col.vector({ dimensions })`, Identity- und Serial-Schlüssel, Standardwerte – genau so
  geschrieben, wie Drizzle sie schreibt. Ein Typ, den kein Builder benennt, wird zu
  `col.custom({ dataType: "<sql type>" })`, was Rebase so bereitstellt, wie der
  Treiber es zurückgibt; `db generate` und `db push` lehnen dies ab, bis der Planner
  es planen kann
- Deklariert die Fremdschlüsselspalte, das `belongsTo` darauf und das inverse
  `hasMany` auf dem Ziel; eine Junction-Tabelle wird zu einem `manyToMany`, wobei ihre eigenen
  Spalten den `pivot` bilden
- Liest die Row-Level-Security-Policies jeder Tabelle in ihr `rls` ein: Name,
  Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die `<table>_default_*`-Policies,
  die Rebase selbst hinzufügt, werden weggelassen, sodass das nachfolgende `db push`
  jede Policy exakt wie zuvor wiederherstellt. Eine Tabelle mit aktivierter Row-Level Security
  ohne Policy wird als `rls: "admin-only"` geschrieben
- Liest jeden Ausdruck (das `USING` einer Policy, einen CHECK, einen Spalten-Standardwert) unter
  dem `search_path`, den der Server verwendet (`public`), sodass eine Funktion im Schema `rebase`
  als `rebase.roles()` geschrieben wird
- Wandelt einen lesbaren CHECK (`total >= 0`) in das `.validate()` der Spalte um und
  belässt das Constraint selbst in der Datenbank, wo der nachfolgende Push es beibehält
- Schreibt Dinge, die nicht exakt angegeben werden konnten, in einen Kommentar am Anfang der
  Tabellendatei und ins Terminal – eine geschlossene Menge von Strings auf einer Textspalte, eine
  generierte Spalte, deren Ausdruck nicht gelesen werden konnte, ein benutzerdefinierter Typ – zusammen
  mit dem Hinweis, was ein Push damit tun würde
- Erfasst mit `--data-inference` Stichproben von bis zu 100 Zeilen pro Tabelle und schreibt gefundene
  Präsentationseinstellungen – Titel, Icons, Boards, Sortierungen, Feldoptionen – nach
  `frontend/src/cms/<table>.tsx` als `customizeTable`, sofern das Frontend des Projekts
  von `@rebasepro/cms` abhängt. Ein Headless-Projekt erhält keine
- Gibt bei einer Datenbank, die nicht läuft, einmalig dasselbe Banner wie `db push`
  aus und erstellt nichts. Das Ausgabe-Verzeichnis wird als absoluter Pfad ausgegeben

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Wo die Tabellendateien geschrieben werden sollen (Standard: `backend/schema`). `--output` wurde entfernt |
| `--schema` | Das zu lesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Bereits existierende Tabellendateien überschreiben; ohne dieses Flag wird eine vorhandene Datei übersprungen |
| `--database-url` | Diese Datenbank anstelle der projekteigenen lesen |
| `--docker` | Die Compose-Datenbank lesen und bei Bedarf starten |
| `--data-inference` / `--no-data-inference` | Bis zu 100 Zeilen pro Tabelle als Stichprobe nehmen, um Formate, Constraints und Panel-Einstellungen zu erkennen, oder nur die Struktur lesen. Ohne Flag erfolgt eine Abfrage; ohne Terminal wird nur die Struktur gelesen |

Dies ist nützlich, wenn Rebase auf einer bestehenden Datenbank eingeführt wird – führen Sie
zuerst Introspect aus und bearbeiten Sie dann die generierten Tabellen. Eine Tabelle mit deaktivierter
Row-Level Security wird wie jede andere geschrieben, inklusive ihres `rls`; der Push aktiviert
RLS, und der Dry-Run weist darauf hin. Ein Backend, das ganz ohne `backend/schema` läuft,
bedient die Datenbank stattdessen direkt – siehe [Nur Backend](/docs/getting-started/headless/).

### `rebase db push`

Wenden Sie das deklarierte Schema direkt auf die Datenbank an:

```bash
rebase db push
rebase db push --dry-run
```

Rebase rendert deklarierte Tabellen, Policies, Funktionen, Such- und
Vektorindizes, Trigger und Views in eine gemeinsame SQL-Datei. Ptah Compat
plant und wendet diese Objekte zusammen an. Der Plan ist auf die Deklarationen
von Rebase begrenzt. Andere Tabellen, Views, Erweiterungen und Funktionen
bleiben unberührt. Das gilt auch für eigene Policies, Trigger, Indizes sowie
CHECK- und EXCLUDE-Constraints auf einer deklarierten Tabelle.

Der Befehl zeigt den Plan vor der Anwendung. Eine destruktive Änderung,
einschließlich `DROP EXTENSION`, erfordert eine Bestätigung oder
`--allow-destructive`. `--dry-run` zeigt den Plan, ohne die Datenbank zu
ändern oder eine Migration zu schreiben. Danach aktiviert Rebase Row-Level
Security, richtet Auth-Tabellen und Request-Rollen ein und speichert die
Schema-Version. Fehlende abgeleitete Fremdschlüsselindizes werden vorher
parallel erstellt.

Auf einem gemeinsam genutzten externen PostgreSQL-Server erfordert das
Wiedergeben von Migrationen die ausdrückliche Option
`PTAH_TRUST_REPLAY_SQL=1`. Sie ist unter
[Konfiguration](/docs/getting-started/configuration/) beschrieben. Das
verwaltete PGlite verwendet einen verwerfbaren Dev-Server und braucht sie
nicht.

`db push` und `db generate` aktualisieren `.rebase/sql/` aus dem aktuellen
Schema. Git ignoriert dieses Verzeichnis.

| Datei | Zweck |
|-------|-------|
| `schema.sql` | Gewünschter Ptah-Zustand der deklarierten Anwendungsobjekte |
| `ptah-managed.json` | Objekte, die Rebase von Ptah planen lässt |
| `policies.sql`, `search.sql`, `vector.sql` | Weiterhin für Boot und Recovery verwendete Eingaben |
| `triggers.sql`, `views.sql` | Weiterhin für Boot und Recovery verwendete Eingaben |

Die zusätzlichen SQL-Dateien werden neuen Migrationen nicht angehängt und
nicht als zweiter Teil von `db push` angewendet. Ptah plant ihre deklarierten
Objekte über `schema.sql`. Früher nach `drizzle/` kopierte generierte Dateien
können gelöscht werden; `drizzle/migrations/` bleibt bestehen.

Eine von Rebase benannte Policy wird entfernt, wenn eine neue Regel sie
ersetzt. Eine Policy mit eigenem Namen bleibt erhalten. Mit
`rebase doctor --policies` prüfen Sie Policy-Drift. Soll Rebase eine eigene
Policy verwalten, deklarieren Sie sie im `rls` der Tabelle.

:::caution
`db push` ändert die Datenbank direkt. Verwenden Sie es in der Entwicklung.
Für Produktion erstellen Sie mit `db generate` eine prüfbare Migration und
wenden sie mit `db migrate` an.
:::

### `rebase db generate`

Erstellen Sie eine SQL-Migration mit Zeitstempel:

```bash
rebase db generate
```

Ptah vergleicht das gewünschte SQL mit dem Zustand, den die Migrationen in
`backend/drizzle/migrations/` herstellen. Der Diff beginnt bei dieser
Historie, nicht bei der Live-Datenbank. Rebase liest die Live-Datenbank
dennoch, um fremde Objekte zu erkennen. Eine Spalte, die Boot oder `db push`
bereits hinzugefügt hat, erscheint daher weiterhin in der Migration.

Der Befehl schreibt die Migration nach `backend/drizzle/migrations/`, warnt
vor destruktiven Anweisungen und nennt den nächsten `db migrate`-Befehl. Bei
einer bereits provisionierten Datenbank nennt er auch
`--baseline <version>`. Ohne Diff entsteht keine Migration.

Prüfen Sie jede generierte Datei vor der Anwendung. Rebase kann den Besitzer
von beliebigem SQL in einer noch nicht angewendeten Migration nicht erkennen.

### `rebase db migrate`

Alle ausstehenden Migrationen ausführen:

```bash
rebase db migrate
```

**Was es tut:**
- Liest `drizzle/migrations/` nach noch nicht angewendeten Migrationen aus
- Wendet sie der Reihe nach auf die Datenbank an
- Verfolgt, welche Migrationen bereits angewendet wurden
- Versieht die Row-Level-Security-Policies mit denselben Stempeln wie `db push` und der Boot-Vorgang des Servers,
  sodass der erste Boot nach einem Migrate sie unberührt lässt, anstatt jede einzelne neu zu erstellen. Eine
  Migration wurde auf Basis des damaligen Tabellenstands geschrieben; eine Policy erhält daher nur dann einen
  Stempel, wenn sie exakt dem entspricht, was ihre Regel heute erzeugt: Migrate erstellt sie testweise aus ihrer
  Regel unter einem anderen Namen in einer Transaktion, die zurückgerollt wird, und vergleicht das von Postgres
  Gespeicherte – genau wie `db push --dry-run`. Eine Policy, die abweicht, erhält keinen Stempel, und der nächste
  Boot wendet ihre Tabelle neu an

`--refuse-destructive`
führt stattdessen zu einer Verweigerung. Es führt die ausstehenden Migrationen zuerst als Dry-Run aus. Zerstört
ein Statement Daten – nach denselben Kriterien wie bei `db push` und `db generate` –, listet es diese Statements
auf und beendet sich mit Exit-Code 1. Es wird nichts angewendet, nicht einmal die Dateien vor diesem Statement.
Ohne dieses Flag verhält sich `db migrate` wie bisher und wendet jede ausstehende Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht diese zuerst, weshalb dieses Flag auch diese Migration
ablehnt. Prüfen Sie die ausgegebene Liste und führen Sie `rebase db migrate` dann ohne das Flag aus, um sie anzuwenden.

#### Baselining einer Datenbank, die Rebase bereits gebootet hat

Jeder Boot-Vorgang von Rebase stellt das Schema sicher, und `rebase db push` wendet es direkt an. Eine Datenbank,
auf der jemals eines von beiden ausgeführt wurde, enthält daher bereits die Tabellen und Typen, die die erste
Migration erstellen würde, und `rebase db migrate` stoppt mit `pq: type "posts_status" already exists (42710)`.

Mit der Migration ist alles in Ordnung – die Datenbank wurde lediglich auf anderem Wege bereitgestellt. Erfassen
Sie den aktuellen Stand und migrieren Sie anschließend normal weiter:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version ist das numerische Präfix der Migrationsdatei, die den Zustand beschreibt, der sich *jetzt* in der
Datenbank befindet. Diese Migration und alle davorliegenden werden als angewendet markiert; alles danach wird
ausgeführt. Bei einer Datenbank, gegen die noch nie gebootet wurde, ist keine Baseline erforderlich – migrieren
Sie direkt.

Dasselbe geschieht später im normalen Entwicklungszyklus: Bearbeiten Sie eine Tabelle, während `rebase dev` läuft,
fügt der Boot-Vorgang die Spalte hinzu, bevor `rebase db generate` die Migration schreibt, die sie hinzufügt.
`rebase db migrate` stoppt dann mit `column … already exists (42701)`. Setzen Sie für diese Migration auf dieselbe
Weise eine Baseline. `--baseline` funktioniert auch auf einer Datenbank, die bereits Migrationen aufzeichnet: Es
markiert alles bis zu dieser Version mittels `ptah-compat migrate set` als angewendet und bestätigt dies, bzw. meldet,
dass nichts aufzuzeichnen ist, wenn die Historie diesen Stand bereits erreicht hat. Eine Version, die in keiner
Datei in `drizzle/migrations` vorkommt, wird vor der Ausführung abgelehnt, unter Nennung der vorhandenen Versionen.

### `rebase db branch`

Datenbank-Branching für parallele Entwicklung:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (und `switch --off`) sowie `rebase db branch prune`
sind neu. `create`, `list`, `info` und `delete` wurden in Version 0.17 eingeführt.

Jeder Branch ist eine vollständige Kopie der Datenbank, erstellt mit `CREATE DATABASE ... TEMPLATE`.
Er erfordert daher einen echten PostgreSQL-Server und belegt denselben Speicherplatz wie seine Quelle.

### `rebase doctor`

Erkennen Sie dreiseitige Abweichungen (Drift) zwischen Ihren Tabellen, dem generierten Drizzle-Schema und der aktiven PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was es prüft:**
- Tabellen ↔ Generiertes Schema – sind sie synchron?
- Generiertes Schema ↔ Datenbank – gibt es nicht angewendete Änderungen?
- Tabellen ↔ Datenbank – gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer etwas nicht synchron erscheint. Es zeigt exakt auf, wo die Diskrepanz liegt.

Der Datenbankvergleich umfasst denselben Check, den der Boot-Vorgang durchführt, bevor er warnt, dass
`schema.generated.ts` und die Datenbank nicht übereinstimmen (ausgeführt mit demselben Code). Jeder Unterschied,
vor dem der Boot-Vorgang warnt, ist somit im selben Wortlaut auch im Bericht enthalten: eine Spalte, die auf
einer Seite NOT NULL und auf der anderen nullable ist, sowie eine Spalte, die die Datenbank noch besitzt, die
Datei jedoch nicht mehr (der Boot-Vorgang löscht niemals Spalten, daher hinterlässt eine umbenannte Eigenschaft
ihre alte Spalte). Jeder Fund ist eine Warnung, und als Behebung wird `rebase db push` genannt.

Der Datenbankvergleich liest die Datenbank des Projekts, aufgelöst auf dieselbe Weise wie bei `rebase db url` –
bei einem frischen Scaffold die verwaltete Datenbank, die `doctor` startet. Kann keine Datenbank aufgelöst werden,
wird diese Phase als **übersprungen** gemeldet statt als bestanden, und der Lauf schließt niemals mit "All schemas
are in sync" ab – eine Prüfung, die nicht stattfand, ist kein Unbedenklichkeitsnachweis.

Zudem wird jede Tabelle ohne [`search`-Block](/docs/backend/search) aufgeführt, die mehr als etwa 10.000 Zeilen
enthält. Eine Suche dort – das Admin-Suchfeld, `.search()`, `?searchString=` – erfolgt über ein `ILIKE '%term%'`
auf den Textspalten, das kein Index bedienen kann. Jede Suche liest daher die gesamte Tabelle, und der Count liest
sie erneut (etwa ein Drittel einer Sekunde bei 100.000 Zeilen, mit der Tabelle wachsend). Die Zeilenzahl ist
eine Schätzung von Postgres selbst, der Check führt also keinen Scan durch. Es handelt sich um einen Hinweis: Er
ändert den Exit-Code nicht und es wird nichts automatisch indexiert.

Es wird auch eine **verwaiste Junction-Tabelle** gemeldet: eine Tabelle im Schema `public`, die wie eine
Many-to-Many-Junction aufgebaut ist, von keiner Tabelle jedoch deklariert wird. Dieser Aufbau besteht aus zwei
Spalten, die zusammen den Primärschlüssel bilden und jeweils ein Fremdschlüssel zu einer deklarierten Tabelle sind.
Das Umbenennen oder Entfernen eines `manyToMany` hinterlässt seine alte Junction-Tabelle, da Push und Boot
Tabellen nur erstellen und alle Verknüpfungszeilen darin verbleiben. Dieser Hinweis dient nur der Information
und ändert den Exit-Code nicht. Als Lösung wird das `DROP TABLE`-Statement angezeigt, das `doctor` jedoch niemals
selbst ausführt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes SDK aus Ihren Tabellen:

```bash
rebase generate-sdk
```

**Was es tut:**
- Liest die Tabellen ein, die `backend/schema/index.ts` exportiert, und zwar über denselben Loader, mit dem das Backend startet, sodass das SDK exakt die bereitgestellten Tabellen beschreibt; ein Schema, das nicht kompiliert, bricht den Vorgang ab
- Generiert TypeScript-Typen für jede Tabelle in `generated/sdk/`
- Erzeugt eine `database.types.ts`-Datei zur Verwendung mit `createRebaseClient<Database>()`: den `Database`-Typ, `TableName` (die Union aller Slugs) und `tablesDictionary` / `TablesDictionary`, das Mapping vom Accessor zum Slug

`rebase dev` führt dies beim Start und bei jedem Speichern unter `backend/schema/` automatisch für Sie aus.
Führen Sie es manuell in CI aus, in einem Repository, das keine eigenen Tabellen besitzt (siehe `--from` unten),
oder überall dort, wo `rebase dev` nicht läuft.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema` oder der Schlüssel `tables` in `rebase.json`); relative Pfade werden relativ zum Ausführungsort des Befehls aufgelöst |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Das Schema von einem laufenden Projekt statt aus lokalem Quellcode lesen. `link` verwendet das mit diesem Checkout verknüpfte Projekt. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |
| `--register` | Auch serverseitige Daten typisieren: schreibt die Typen und eine `Register`-Deklaration nach `backend/generated/` und vermerkt dies in `rebase.json` – siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data/) |

`--from` ermöglicht es einem Repository, das keine Tabellen enthält – einem separaten Frontend, einer zweiten
Web-App, einer mobilen App –, einen typisierten Client aus dem Projekt zu generieren, mit dem es kommuniziert:
Es liest die `tables` des Endpunkts `/api/meta/contract` des laufenden Backends aus. `REBASE_SERVICE_KEY` wird
nur an das Projekt gesendet, mit dem dieser Checkout verknüpft ist; für jeden anderen Host muss `--token` explizit
übergeben werden. Der Schlüssel in `.env` gehört zu Ihrem lokalen Backend und wird niemals übertragen.
Eine Verweigerung gibt Aufschluss darüber, was zutraf: ein abgelehnter `--token`, ein abgelehnter Shell-Schlüssel,
ein Schlüssel, der für einen nicht verknüpften Host zurückgehalten wurde, ein Schlüssel, der nur in `.env` existiert,
oder überhaupt kein Schlüssel.

**Verwendung nach der Generierung:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Volle Typsicherheit und Autovervollständigung
const { data } = await client.data.products.find();
```

Feldnamen in den generierten Typen entsprechen denen, die die API bereitstellt. Der Wire-Name eines Felds
ist sein Spaltenschlüssel, und die API verwendet durchgehend camelCase: Die Introspektion schreibt eine
`created_at`-Spalte als `createdAt: col.timestamp({ withTimezone: true })`, deren SQL-Name das snake_case
des Schlüssels ist, und gibt sie als `row.createdAt` aus. Die Spalte selbst bleibt unberührt. Der Tabellen-*Accessor*
wird auf dieselbe Weise in einen Eigenschaftsnamen umgewandelt (`my-notes` → `client.data.myNotes`), worauf
`tablesDictionary` wieder zurück auf den Slug verweist.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` migriert `config/collections` nach
`backend/schema` (ein `defineTable` pro Collection, jede Spalte explizit an
ihrer ursprünglichen Position in Drizzle-Schreibweise und `index.ts` mit
`defaultRls`) sowie nach `frontend/src/cms` (ein `customizeTable` pro angepasster
Collection, `defineFirestoreCollection`-Dateien, `ui-config.json`), schreibt
`backend/resources.ts`, `backend/storage.ts` und `backend/generated/register.ts`,
fügt `rebaseBackendGuard()` zur `vite.config.ts` eines Scaffolds hinzu und führt anschließend
`rebase migrate sdk-calls` aus. Dies schreibt `.collection(` zu `.table(` um, nimmt
die weiteren SDK-Umbenennungen sowie die Regelquellen `existsIn` / `membership` in Ihrem Code vor
und verschiebt die Imports von Namen, die in 0.31 in ein anderes Paket verschoben wurden
([die Liste](/docs/upgrading/0-30-to-0-31-imports/)), wobei das Paket zu den Abhängigkeiten
des importierenden Moduls hinzugefügt wird ("Dependencies added": führen Sie `pnpm install` aus).
Heben Sie jedes `@rebasepro`-Paket vor der Ausführung auf Version 0.31 an.
Jeder Lauf liest das Ergebnis gegen: Das generierte SQL – DDL, Policies, Suche,
Vektor, Trigger, Views, das Drizzle-Schema – muss Byte für Byte identisch sein, andernfalls wird
jede Datei wieder zurückgesetzt. Was nicht übernommen werden kann, wird unter Angabe von Datei und Zeile
abgelehnt, und was Ihnen überlassen bleibt, wird in nummerierten manuellen Schritten ausgegeben, endend mit
`rebase skills install`, falls das Projekt Agent Skills enthält. Eigene Module in
`config/` bleiben erhalten; der Lauf gibt die `git rm`-Zeile für das Ersetzte aus. Er folgt auch
Firestore-Collections, die von einer Funktion aufgebaut werden, Pfad-Aliasen, einem außerhalb von `App.tsx`
eingebundenen Panel und jeder ungeschützten statischen App ([die vollständige Liste](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Nach dem `git rm` meldet `--check` den Status `already-migrated`.

| Flag | Wirkung |
|---|---|
| `--dry-run` | Dateien, Ablehnungen, Hinweise und manuelle Schritte ausgeben; nichts schreiben. Beginnen Sie hier. |
| `--check` | Bei einem migrierten Projekt: Nachweisen, dass `backend/schema` noch immer dasselbe SQL rendert. Beendet mit Exit-Code 1 bei Diffs oder solange eine Regel ihre Bedeutung ändert. |
| `--accept-rule-changes` | Zusammen mit `--check`: Bestätigt, dass die Regeln unter "Review before deploying" geprüft wurden. |
| `--json` / `--force` / `--skip-sdk-calls` | Der Bericht als JSON (mit `ruleChanges`); auf einem unsauberen Git-Tree oder über bearbeiteter Ausgabe ausführen; Ihren Code unverändert lassen. |

Prüfen Sie zwei Listen in der SDK-Ausgabe: **"Rewritten by name — review"** (untypisierte
Empfänger, Daten-Slots, Test-Doubles) und **"Left unchanged — check each"**
(benennen Sie diejenigen um, die das SDK betreffen; [eine Suche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) findet den Rest).

Die SQL-Prüfung beweist, dass die Konvertierung originalgetreu war, nicht jedoch, dass eine Regel noch
dasselbe bedeutet wie zuvor. Der letzte Abschnitt der Ausgabe, **"Review before deploying: these rules
change meaning"**, listet jede Regel auf, deren Policy nun andere Berechtigungen erteilt
– ein einfaches `access: "authenticated"` gewährte früher nichts und lässt jetzt jeden angemeldeten
Aufrufer zu ([die vier Ausprägungen](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Prüfen Sie anschließend gegen Ihre Datenbank: `rebase db push --dry-run` sollte "No
changes: the database already matches these tables." ausgeben und
`rebase doctor --policies` keinerlei Drift melden.

## Entwicklungs-Workflow

Der Workflow für schnelle Iterationen während der Entwicklung:

```bash
# 1. Eine Tabelle in backend/schema/ bearbeiten
# 2. Drizzle-Schema generieren
rebase schema generate

# 3. Direkt auf die Entwicklungsdatenbank pushen
rebase db push
```

## Produktions-Workflow

Der sichere, überprüfbare Workflow für die Produktion:

```bash
# 1. Eine Tabelle in backend/schema/ bearbeiten
# 2. Drizzle-Schema generieren
rebase schema generate

# 3. SQL-Migrationsdateien generieren
rebase db generate

# 4. Generiertes SQL in backend/drizzle/migrations/ prüfen
# 5. Migration in die Versionsverwaltung committen
git add backend/drizzle/migrations/

# 6. In Produktion anwenden
#    Eine Datenbank, die Rebase bereits gebootet hat, benötigt beim ersten Mal eine Baseline –
#    siehe "Baselining einer Datenbank, die Rebase bereits gebootet hat" oben.
rebase db migrate
```

## Fehlerbehebung

| Symptom | Lösung |
|---------|--------|
| `Could not detect an active database plugin` | Installieren Sie `@rebasepro/server-postgres` in `backend/package.json` |
| Schemadatei aktualisiert sich nicht | Prüfen Sie, ob der Pfad `--schema-dir` (oder der Schlüssel `tables` in `rebase.json`) auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |
| Eine Migration darf in CI oder Produktion keine Daten löschen | `rebase db migrate --refuse-destructive` beendet mit Exit-Code 1 und wendet nichts an, wenn ein ausstehendes Statement Daten zerstört |
| `db migrate` schlägt mit `already exists (42710)` fehl | Der Boot-Vorgang oder `db push` hat das Schema bereits bereitgestellt – zeichnen Sie dies mit `rebase db migrate --baseline <version>` auf |
| `db migrate` schlägt mit `column … already exists (42701)` fehl | `rebase dev` hat die Spalte beim Booten hinzugefügt – setzen Sie für diese Migration auf dieselbe Weise eine Baseline |

## Nächste Schritte

- **[Tabellen](/docs/schema/)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
