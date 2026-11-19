---
sourceHash: 26de566694c2cb42
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle-ORM-Schemas aus den Tabellen in backend/schema, erstellen Sie SQL-Migrationen, introspektieren Sie eine bestehende Datenbank in defineTable-Dateien und halten Sie Ihre Datenbank mit der Rebase CLI synchron.
---

## Übersicht

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der die Tabellen, die Sie mit
`defineTable` in `backend/schema/` deklarieren, die Single Source of Truth bilden. Die CLI
transformiert sie über eine deterministische Pipeline:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Tabellen → Drizzle-Schema

Die Tabellen, die `backend/schema/index.ts` exportiert, beschreiben Spalten, Typen, Relationen,
Enums und Row-Level Security. Jeder nachfolgende Befehl liest sie über denselben Loader
ein, mit dem auch das Backend startet. Ein Schema, das nicht kompiliert — eine Tabelle ohne
`rls`, `"inherit"` ohne `defaultRls`, ein `defineTable`, das der Index nicht
exportiert —, bricht den Befehl mit einem `SchemaDefinitionError` ab, der jedes Problem benennt,
und es wird nichts geschrieben. Der Befehl `schema generate` gibt daraus eine Drizzle-ORM-
Schemadatei aus.

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte,
die ihre Tabellen an einem anderen Ort aufbewahren; der Standardwert ist `backend/schema` oder der
`tables`-Schlüssel der Backend-App in `rebase.json`. Das Flag `--collections` / `-c` aus Versionen
vor 0.31 wird mit einem Hinweis auf den Codemod abgelehnt
([`rebase migrate collections-to-tables`](#rebase-migrate)), ebenso wie ein
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

**Was der Befehl tut:**
- Liest die Tabellen, die `backend/schema/index.ts` exportiert
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema`); relative Pfade werden von dem Ort aus aufgelöst, an dem Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden von dem Ort aus aufgelöst, an dem Sie den Befehl ausführen |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich — bearbeiten Sie eine Tabellendatei, und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Überprüfen Sie, ob das generierte Schema noch mit den Tabellen übereinstimmt:

```bash
rebase schema stale          # Bericht ausgeben und mit Exit-Code 1 beenden, falls etwas veraltet ist
rebase schema stale --fix    # Datei stattdessen neu generieren
```

**Was der Befehl tut:**
- Rendert das, was die Tabellen in `backend/schema/` erzeugen, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied — eine fehlende Tabelle, eine umtypisierte Spalte, einen entfernten Enum-Wert oder Fremdschlüssel, die so benannt sind, wie es ein früheres Release abgeleitet hat — und beendet mit einem Exit-Code ungleich null
- Mit `--fix` wird die Datei neu generiert, anstatt nur einen Bericht auszugeben

`rebase dev` hält die Datei automatisch aktuell, daher dient dieser Check primär einem Build-
oder CI-Schritt. Er akzeptiert `--schema-dir` und `--output` genau wie `rebase schema generate`.

### `rebase schema reconcile`

Lockern und verwerfen Sie, was der Boot-Prozess nicht automatisch bereinigt, nachdem Sie den Plan geprüft haben:

```bash
rebase schema reconcile                         # NOT NULL auf Spalten lockern, die als nullable definiert oder entfernt wurden
rebase schema reconcile --drop voice_cache.wav  # und eine Spalte verwerfen, die von keiner Tabelle deklariert wird
```

**Was der Befehl tut:**
- Bittet das laufende Backend, einen Plan gegen seine eigene Datenbank zu erstellen. Das ist das Ziel, auf das die `.env` des Backends und der Cloud-Link zeigen; es funktioniert also auch auf Rebase Cloud, wo sonst nichts die Datenbank erreicht.
- Plant `DROP NOT NULL` für jede Spalte, die eine Tabelle als nullable deklariert, die Datenbank aber noch als erforderlich markiert hat.
- Listet jede Spalte auf, die von keiner Tabelle deklariert wird. Eine Spalte, die `NOT NULL` ohne Standardwert ist, blockiert jeden Insert-Vorgang, weshalb auch sie gelockert wird und ihre Daten erhalten bleiben. Sie verwirft nur die Spalten, die Sie explizit mit `--drop <table>.<column>` angeben, und zeigt an, wie viele Zeilen in jeder Spalte einen Wert enthalten.
- Wird angewendet, sobald Sie `yes` eingeben. Der Server führt den Plan nur basierend auf dem Digest des Plans aus, den Sie gelesen haben. Haben sich die Datenbank oder die Tabellen in der Zwischenzeit geändert, verweigert er die Ausführung und Sie prüfen erneut. `--yes` überspringt die Bestätigung.

Der Boot-Prozess fügt immer nur hinzu. Wenn Sie also eine Spalte aus ihrem `defineTable` entfernen, bleibt ihre Spalte in der Datenbank samt Daten erhalten. Eine `NOT NULL`-Spalte ohne Standardwert führt dann dazu, dass jeder Insert fehlschlägt, und das Boot-Protokoll verweist auf diesen Befehl: ohne `--drop`, um die Daten zu behalten, mit `--drop`, um die Spalte zu entfernen. Deployen Sie zuerst die Tabellenänderung, da reconcile gegen das plant, was das Backend ausführt. Es erfordert `REBASE_SERVICE_KEY` in `.env`. Lokal deckt `rebase db push` dasselbe über sein Destructive-Change-Gate ab.

### `rebase schema introspect`

Schreiben Sie `defineTable`-Dateien aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was der Befehl tut:**
- Verbindet sich mit der Datenbank dieses Projekts, die von `rebase db url` ausgegeben wird (die verwaltete Instanz wird gestartet, falls es sich um diese handelt); `--database-url` gibt eine andere an und `--docker` verwendet die Compose-Instanz
- Liest jede Tabelle, Spalte, jeden Typ, Fremdschlüssel und jede Policy aus und schreibt
  `backend/schema/<table>.ts` — ein `defineTable` pro Tabelle — sowie die
  `backend/schema/index.ts`, die sie exportiert (zusammengeführt in einen Index, der
  bereits existiert)
- Deklariert jede Spalte mit ihrem Postgres-Typ: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, ein Enum mit seinen Labels und dem echten Typnamen
  (ein `pgEnum`, wenn der Typ geteilt wird), ein Array als `<item>.array()`,
  `col.vector({ dimensions })`, Identity- und Serial-Schlüssel, Defaults — genau so formuliert,
  wie Drizzle sie formuliert. Ein Typ, den kein Builder benennt, wird zu
  `col.custom({ dataType: "<sql type>" })`, was Rebase so ausliefert, wie der
  Treiber es zurückgibt; `db generate` und `db push` verweigern ihn, bis der Planner
  ihn planen kann
- Deklariert die Fremdschlüsselspalte, das `belongsTo` darauf und das umgekehrte
  `hasMany` auf dem Ziel; eine Junction-Tabelle wird zu einem `manyToMany`, deren eigene
  Spalten zum `pivot` werden
- Liest die Row-Level-Security-Policies jeder Tabelle in deren `rls` ein: Name,
  Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die `<table>_default_*`-Policies,
  die Rebase selbst hinzufügt, werden weggelassen, sodass das nachfolgende `db push`
  jede Policy genau wie zuvor wiederherstellt. Eine Tabelle mit aktivierter Row-Level Security
  ohne Policy wird als `rls: "admin-only"` geschrieben
- Liest jeden Ausdruck (das `USING` einer Policy, einen CHECK, einen Spaltenstandardwert) unter
  dem vom Server verwendeten `search_path`, `public`, ein, sodass eine Funktion im
  `rebase`-Schema als `rebase.roles()` geschrieben wird
- Wandelt einen lesbaren CHECK (`total >= 0`) in das `.validate()` der Spalte um und belässt das Constraint selbst in der Datenbank, wo der nachfolgende Push es beibehält. Jeder CHECK wird außerdem unter "Not carried over" mit seinem SQL aufgeführt: Ein Push in eine *neue* Datenbank erstellt die Validierung, nicht das Constraint
- Deklariert jeden einfachen Index (nur Spalten, btree, gin oder brin, kein Prädikat) in `indexes` der Tabelle. Ein Index nur auf einer Fremdschlüsselspalte wird der Relation überlassen, die einen erstellt
- Mit `--from supabase` werden die Konventionen von Supabase für eine Datenbank übersetzt, von der Sie migrieren: Ein Spaltenstandardwert von `auth.uid()` wird zu `.onCreateUser()` (der Server schreibt die ID des Aufrufers), eine Spalte mit einer Supabase-Benutzer-ID (dieser Standardwert oder ein Fremdschlüssel zu `auth.users`) wird zu `col.text().userId()`, da `rebase.users.id` und `rebase.uid()` Text sind, und eine Policy `TO authenticated` / `TO anon` verliert die Rolle (eine Rebase-Datenbank hat keines von beidem) und erfordert stattdessen einen angemeldeten / nicht angemeldeten Aufrufer; eine Policy nur für `service_role` wird verworfen. Jede Änderung wird oben in der Datei der Tabelle vermerkt. Ohne das Flag bleiben diese unverändert (wenn Rebase auf derselben Datenbank neben Supabase läuft, werden sie weiterhin benötigt), und der Durchlauf meldet, wann er sie gefunden hat
- Schließt mit dem ab, was **nicht** übernommen wurde: Funktionen, Trigger, Extensions, CHECKs, Indizes, die `indexes` nicht abbilden kann, Fremdschlüssel über mehrere Spalten oder in ein anderes Schema. Das SQL zur Wiederherstellung aller Elemente, die Postgres ausgeben kann, wird in `backend/sql/introspected-left-behind.sql` geschrieben, um nach dem ersten Push überprüft und angewendet zu werden (`psql "$DATABASE_URL" -f …` oder `rebase cloud db query --file …` auf Rebase Cloud)
- Erinnert Sie daran, dass `DATABASE_URL` immer noch die Datenbank benennt, die gelesen wurde: Bei einer Migration ist dies die Quelle, und ein `db push` würde nun hineinschreiben
- Schreibt Dinge, die nicht exakt angegeben werden konnten, in einen Kommentar oben in der Tabellendatei und ins Terminal — eine geschlossene Menge von Strings auf einer Textspalte, eine generierte Spalte, deren Ausdruck nicht gelesen werden konnte, ein benutzerdefinierter Typ — zusammen mit den Auswirkungen, die ein Push darauf hätte
- Mit `--data-inference` werden bis zu 100 Zeilen pro Tabelle abgetastet und gefundene Präsentationsdaten — Titel, Icons, Boards, Sortierungen, Feldoptionen — in `frontend/src/cms/<table>.tsx` als `customizeTable` geschrieben, sofern das Frontend des Projekts von `@rebasepro/cms` abhängt. Ein Headless-Projekt erhält keine
- Bei einer Datenbank, die nicht läuft, wird dasselbe Banner ausgegeben wie bei `db push`, einmalig, und es wird nichts erstellt. Das Ausgabeverzeichnis wird als absoluter Pfad ausgegeben

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Wo die Tabellendateien geschrieben werden sollen (Standard: `backend/schema`). `--output` wurde entfernt |
| `--schema` | Das zu lesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Bereits existierende Tabellendateien überschreiben; ohne dieses Flag wird eine bestehende Datei übersprungen |
| `--database-url` | Diese Datenbank anstelle der projekteigenen lesen |
| `--docker` | Die Compose-Datenbank lesen und bei Bedarf starten |
| `--from supabase` | Supabase-Konventionen (`auth.uid()`-Defaults, `auth.users`-Fremdschlüssel, `TO anon` / `TO authenticated`) für eine Rebase-Datenbank übersetzen. Weglassen, wenn Rebase auf derselben Datenbank neben Supabase betrieben wird |
| `--data-inference` / `--no-data-inference` | Bis zu 100 Zeilen pro Tabelle abtasten, um Formate, Constraints und Panel-Einstellungen zu erkennen, oder nur die Struktur einlesen. Ohne Angabe erfolgt eine Abfrage; ohne Terminal wird nur die Struktur gelesen |

Dies ist nützlich, wenn Sie Rebase auf einer bestehenden Datenbank einführen — introspektieren
Sie zuerst und bearbeiten Sie dann die generierten Tabellen. Eine Tabelle mit deaktivierter
Row-Level Security wird wie jede andere mit ihrem `rls` geschrieben; der Push schaltet RLS ein,
worauf der Dry-Run hinweist. Ein Backend, das ganz ohne `backend/schema` läuft, bedient die
Datenbank stattdessen direkt — siehe [Backend only](/docs/getting-started/headless/).
Sie wechseln von Supabase? Siehe [Migrating from Supabase](/docs/recipes/migrate-from-supabase/).

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
ändern oder eine Migration zu schreiben. Nach der Anwendung durch Ptah aktiviert Rebase Row-Level
Security, richtet Auth-Tabellen und Request-Rollen ein und speichert die
Schema-Version. Fehlende abgeleitete Fremdschlüsselindizes werden vorher
parallel erstellt.

Bei externem PostgreSQL, auch einem lokalen Docker-Compose-Dienst, kann Ptah für
`db push`, `db push --dry-run` und `db generate` SQL wiedergeben. Setzen Sie
`PTAH_DEV_SERVER_DISPOSABLE=1` nur für einen vollständig verwerfbaren Dev-Server.
Auf einem gemeinsam genutzten Server erlaubt `PTAH_TRUST_REPLAY_SQL=1` die
Wiedergabe mit den Rechten der Dev-Verbindung. Setzen Sie es nur für SQL, dem Sie
vertrauen. Verwaltetes PGlite ist bereits verwerfbar. Siehe
[Konfiguration](/docs/getting-started/configuration/).

`db push` und `db generate` aktualisieren `.rebase/sql/` aus dem aktuellen
Schema. Git ignoriert dieses Verzeichnis.

| Datei | Zweck |
|-------|-------|
| `schema.sql` | Gewünschter Ptah-Zustand der deklarierten Anwendungsobjekte |
| `search.sql` | Stellt generierte Suchspalten nach einem Fehler wieder her |
| `policies.sql`, `vector.sql`, `triggers.sql`, `views.sql` | Separate Auszüge aus dem generierten SQL |

Die CLI entfernt alte generierte SQL-Kopien aus `drizzle/` und behält `drizzle/migrations/`.

Committen Sie `backend/drizzle/ptah-managed.json` zusammen mit den Migrationen. Die
gespeicherten Namen erlauben es Rebase, auch entfernte Deklarationen einzuplanen.

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

Der Befehl schreibt die Migration nach `backend/drizzle/migrations/` und warnt vor
destruktiven Anweisungen. Ohne Änderungen schreibt er keine Migration.

Bei der ersten Migration zeigt der Befehl ein Beispiel für `--baseline <version>`.
Prüfen Sie vorher, ob die Datenbank bereits diesem Stand entspricht.

Prüfen Sie jede Migration auf `DROP CONSTRAINT`. Manuelle CHECK- und
EXCLUDE-Constraints, die nur in der wiedergegebenen Historie vorkommen, können im
Plan zum Löschen erscheinen.

### `rebase db migrate`

Führen Sie alle ausstehenden Migrationen aus:

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
  Gespeicherte. Eine Policy, die abweicht, erhält keinen Stempel, und der nächste
  Boot wendet ihre Tabelle neu an

`--refuse-destructive`
führt stattdessen zu einem Abbruch. Ausstehende Migrationen werden zuerst in einem Dry-Run simuliert.
Zerstört eine Anweisung Daten (geprüft nach denselben Kriterien wie bei `db push` und `db generate`),
werden die betroffenen Anweisungen aufgelistet und der Befehl mit Exit-Code 1 beendet. Es wird nichts
angewendet, nicht einmal die Dateien vor dieser Anweisung. Ohne dieses Flag verhält sich `db migrate`
wie bisher und wendet jede ausstehende Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht diese zuerst; daher verweigert dieses Flag
auch eine solche Migration. Prüfen Sie die ausgegebene Liste und führen Sie `rebase db migrate`
anschließend ohne das Flag aus, um sie anzuwenden.

#### Eine Datenbank baselinen, die Rebase bereits gestartet hat

Jeder Boot-Vorgang von Rebase stellt das Schema sicher, und `rebase db push` wendet es direkt an. Eine Datenbank,
auf der jemals eines von beiden ausgeführt wurde, enthält daher bereits die Tabellen und Typen, die die erste
Migration erstellen würde, und `rebase db migrate` stoppt mit `type "posts_status" already exists (42710)`.

Mit der Migration ist alles in Ordnung — die Datenbank wurde lediglich auf anderem Wege bereitgestellt.
Erfassen Sie den aktuellen Stand und migrieren Sie anschließend regulär:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version entspricht dem numerischen Präfix der Migrationsdatei, die den Zustand beschreibt,
der *jetzt* in der Datenbank vorliegt. Diese Migration und alle vorherigen werden als angewendet
protokolliert; alles danach wird regulär ausgeführt. Bei einer Datenbank, gegen die noch nie ein Boot-Prozess
lief, ist keine Baseline erforderlich — migrieren Sie direkt.

Verwenden Sie bei einer späteren Migration eine Baseline erst, wenn alle
ausstehenden Änderungen bis zu dieser Version angewendet und geprüft wurden,
einschließlich Löschungen und Datenänderungen. Eine bereits vorhandene Spalte
reicht dafür nicht aus.

### `rebase db branch`

Datenbank-Branching für die parallele Entwicklung:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (sowie `switch --off`) und `rebase db branch prune`
sind neu. `create`, `list`, `info` und `delete` wurden in Version 0.17 eingeführt.

Jeder Branch ist eine vollständige Kopie der Datenbank, die mittels `CREATE DATABASE ... TEMPLATE`
erstellt wird. Er erfordert daher einen echten PostgreSQL-Server und belegt denselben Speicherplatz wie die Quelle.

### `rebase doctor`

Erkennen Sie dreiseitigen Drift zwischen Ihren Tabellen, dem generierten Drizzle-Schema und der aktiven PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was geprüft wird:**
- Tabellen ↔ Generiertes Schema — Sind sie synchron?
- Generiertes Schema ↔ Datenbank — Gibt es nicht angewendete Änderungen?
- Tabellen ↔ Datenbank — Gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer etwas nicht synchron erscheint. Der Befehl zeigt genau, wo die Diskrepanz liegt.

Der Datenbankvergleich schließt die Prüfung ein, die der Boot-Prozess vor der Warnung durchführt,
dass `schema.generated.ts` und die Datenbank nicht übereinstimmen (ausgeführt mit demselben Code).
Jeder Unterschied, vor dem der Boot warnt, erscheint daher auch im Bericht im selben Wortlaut:
eine Spalte, die auf einer Seite NOT NULL und auf der anderen nullable ist, sowie eine Spalte,
die in der Datenbank noch vorhanden ist, in der Datei jedoch nicht mehr (der Boot-Prozess löscht niemals
Spalten, weshalb eine umbenannte Eigenschaft ihre alte Spalte zurücklässt). Jede Abweichung ist eine Warnung,
und die vorgeschlagene Behebung verweist auf `rebase db push`.

Der Datenbankvergleich liest die Projektdatenbank ein, aufgelöst wie bei `rebase db url` — bei einem frischen
Projekt die verwaltete Instanz, die `doctor` bei Bedarf startet. Kann keine Instanz aufgelöst werden,
wird diese Phase als **übersprungen** gemeldet statt als bestanden, und der Durchlauf endet nie mit
"All schemas are in sync" — eine Prüfung, die nicht stattfand, ist keine Erfolgsbestätigung.

Zudem wird jede Tabelle ohne [`search`-Block](/docs/backend/search) aufgeführt, die mehr als etwa 10.000 Zeilen
enthält. Eine Suche dort — über das Suchfeld im Admin-Bereich, `.search()`, `?searchString=` — erfolgt als
`ILIKE '%term%'` über die Textspalten, was kein Index bedienen kann. Jede Suche liest daher die gesamte
Tabelle und der Count liest sie erneut (etwa eine Drittelsekunde bei 100.000 Zeilen, mit der Tabelle wachsend).
Die Zeilenanzahl basiert auf Postgres' eigener Schätzung; die Prüfung führt keinen Scan durch. Es handelt
sich um einen Hinweis: Der Exit-Code ändert sich dadurch nicht und es wird nichts automatisch indexiert.

Der Befehl meldet eine **verwaiste Junction**: eine `public`-Tabelle mit der Struktur einer Many-to-Many-Junction,
die von keiner Tabelle deklariert wird. Diese Struktur besteht aus zwei Spalten, die zusammen den Primärschlüssel
bilden und jeweils ein Fremdschlüssel zu einer deklarierten Tabelle sind. Das Umbenennen oder Entfernen eines
`manyToMany` hinterlässt die alte Junction-Tabelle, da Push und Boot Tabellen nur erstellen und alle
Verknüpfungszeilen darin verbleiben. Dieser Hinweis dient nur der Information und ändert den Exit-Code nicht.
Die Lösung ist der Befehl `DROP TABLE`, den `doctor` anzeigt, aber niemals selbst ausführt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes SDK aus Ihren Tabellen:

```bash
rebase generate-sdk
```

**Was der Befehl tut:**
- Liest die Tabellen, die `backend/schema/index.ts` exportiert, über den Loader ein, mit dem das Backend startet,
  sodass das SDK exakt die bereitgestellten Tabellen abbildet; ein nicht kompilierbares Schema bricht den Befehl ab
- Generiert TypeScript-Typen für jede Tabelle in `generated/sdk/`
- Erzeugt eine Datei `database.types.ts` zur Verwendung mit `createRebaseClient<Database>()`:
  den Typ `Database`, `TableName` (die Union aller Slugs) und `tablesDictionary` / `TablesDictionary`,
  die Zuordnung vom Accessor zum Slug

`rebase dev` führt dies beim Start und bei jedem Speichern unter `backend/schema/` automatisch für Sie aus.
Führen Sie den Befehl manuell in CI aus, in einem Repository ohne eigene Tabellen (siehe `--from` unten)
oder überall dort, wo `rebase dev` nicht läuft.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema` oder der `tables`-Schlüssel in `rebase.json`); relative Pfade werden vom Ausführungsort aufgelöst |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Schema von einem laufenden Projekt statt aus lokalem Quellcode lesen. `link` verwendet das mit diesem Checkout verknüpfte Projekt. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |
| `--register` | Auch serverseitige Daten typisieren: Typen und eine `Register`-Deklaration nach `backend/generated/` schreiben und in `rebase.json` vermerken — siehe [Typed server-side data](/docs/backend/typed-server-data/) |

`--from` ermöglicht es einem Repository ohne eigene Tabellen — einem separaten Frontend,
einer zweiten Web-App, einer mobilen App —, einen typisierten Client aus dem Projekt zu generieren,
mit dem es kommuniziert: Es liest die `tables` des Endpunkts `/api/meta/contract` des laufenden Backends.
`REBASE_SERVICE_KEY` wird ausschließlich an das Projekt gesendet, mit dem dieser Checkout verknüpft ist;
für jeden anderen Host muss `--token` explizit übergeben werden. Der Schlüssel in `.env` gehört zu
Ihrem lokalen Backend und wird niemals übertragen.
Eine Verweigerung gibt Aufschluss über die Ursache: ein abgelehnter `--token`, ein abgelehnter Shell-Schlüssel,
ein für einen nicht verknüpften Host zurückgehaltener Schlüssel, ein Schlüssel, der nur in `.env` existiert,
oder das vollständige Fehlen eines Schlüssels.

**Verwendung nach der Generierung:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Feldnamen in den generierten Typen entsprechen denen, die die API bereitstellt. Der Wire-Name
eines Feldes ist sein Spaltenschlüssel, und die API nutzt durchgängig camelCase: Die Introspektion
schreibt eine `created_at`-Spalte als `createdAt: col.timestamp({ withTimezone: true })`, deren SQL-Name
das Snake_Case des Schlüssels ist, und liefert sie als `row.createdAt` aus. Die Spalte selbst
bleibt unberührt. Der Tabellen-*Accessor* wird auf dieselbe Weise in einen Eigenschaftsnamen
umgewandelt (`my-notes` → `client.data.myNotes`), den `tablesDictionary` wieder auf den Slug abbildet.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` migriert `config/collections` nach
`backend/schema` (ein `defineTable` pro Collection, jede Spalte explizit an
ihrer ursprünglichen Position in Drizzle-Schreibweise und `index.ts` mit
`defaultRls`) und `frontend/src/cms` (ein `customizeTable` pro angepasster
Collection, `defineFirestoreCollection`-Dateien, `ui-config.json`), schreibt
`backend/resources.ts`, `backend/storage.ts` und `backend/generated/register.ts`,
fügt `rebaseBackendGuard()` zur `vite.config.ts` eines Projekts hinzu und führt
anschließend `rebase migrate sdk-calls` aus. Letzteres schreibt `.collection(` in `.table(`,
weitere SDK-Umbenennungen und die Regelquellen `existsIn` / `membership` in Ihrem Code um
und verschiebt die Imports von Namen, die mit 0.31 in ein anderes Paket gewandert sind
([die Liste](/docs/upgrading/0-30-to-0-31-imports/)), wobei das Paket zu den Abhängigkeiten
des importierenden Moduls hinzugefügt wird ("Dependencies added": führen Sie `pnpm install` aus).
Heben Sie vor der Ausführung alle `@rebasepro`-Pakete auf Version 0.31 an.
Jeder Durchlauf prüft das Ergebnis gegen: Das generierte SQL — DDL, Policies, Suche,
Vektoren, Trigger, Views, das Drizzle-Schema — muss bytegenau identisch sein, andernfalls
wird jede Datei zurückgesetzt. Was nicht übernommen werden kann, wird unter Angabe von Datei
und Zeile abgelehnt. Was Ihrer manuellen Bearbeitung überlassen bleibt, wird in nummerierten
Schritten ausgegeben, abschließend mit `rebase skills install`, falls das Projekt Agent Skills
enthält. Eigene Module in `config/` bleiben erhalten; der Durchlauf gibt die `git rm`-Zeile
für die ersetzten Dateien aus. Der Befehl berücksichtigt auch Firestore-Collections, die durch
eine Funktion aufgebaut werden, Pfad-Aliase, ein außerhalb von `App.tsx` eingebundenes Panel
und jede ungeschützte statische App ([die vollständige Liste](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Nach dem `git rm` meldet `--check` den Status `already-migrated`.

| Flag | Wirkung |
|---|---|
| `--dry-run` | Dateien, Ablehnungen, Hinweise und manuelle Schritte anzeigen; nichts schreiben. Beginnen Sie hier. |
| `--check` | Auf einem migrierten Projekt: Nachweisen, dass `backend/schema` noch dasselbe SQL erzeugt. Beendet mit 1 bei Diffs oder wenn eine Regel ihre Bedeutung ändert. |
| `--accept-rule-changes` | Zusammen mit `--check`: Bestätigt, dass die Regeln unter "Review before deploying" geprüft wurden. |
| `--json` / `--force` / `--skip-sdk-calls` | Ausgabe als JSON (mit `ruleChanges`); auf einem unsauberen Git-Tree oder über bearbeiteten Dateien ausführen; Ihren Code unverändert lassen. |

Beachten Sie zwei Listen in der SDK-Ausgabe: **"Rewritten by name — review"** (untypisierte
Empfänger, Daten-Slots, Test-Doubles) und **"Left unchanged — check each"**
(benennen Sie diejenigen um, die zum SDK gehören; [eine Suche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) findet den Rest).

Die SQL-Prüfung beweist, dass die Konvertierung originalgetreu war, nicht jedoch, dass eine Regel noch
dasselbe bedeutet wie zuvor. Der letzte Abschnitt der Ausgabe, **"Review before deploying: these rules
change meaning"**, listet jede Regel auf, deren Policy nun andere Berechtigungen erteilt
– ein einfaches `access: "authenticated"` gewährte früher nichts und lässt jetzt jeden angemeldeten
Aufrufer zu ([die vier Ausprägungen](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Prüfen Sie anschließend gegen Ihre Datenbank: `rebase db push --dry-run` sollte "No
changes: the database already matches the declared schema." ausgeben und
`rebase doctor --policies` keinerlei Drift melden.

## Entwicklungs-Workflow

Der schnelle Iterations-Workflow für die Entwicklung:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Produktions-Workflow

Der sichere, überprüfbare Workflow für die Produktion:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Generiertes SQL in backend/drizzle/migrations/ prüfen
# 5. Migration in die Versionsverwaltung committen
git add backend/drizzle/migrations/ backend/drizzle/ptah-managed.json

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
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
| `db migrate` schlägt mit `already exists (42710)` fehl | Prüfen Sie vor der Baseline alle Änderungen bis zu dieser Version, einschließlich Löschungen und Datenänderungen. |
| `db migrate` schlägt mit `column … already exists (42701)` fehl | Prüfen Sie vor der Baseline alle Änderungen bis zu dieser Version, einschließlich Löschungen und Datenänderungen. |

## Nächste Schritte

- **[Tables](/docs/schema/)** — Definieren Sie Ihr Datenmodell
- **[CLI Reference](/docs/cli)** — Alle CLI-Befehle
- **[Typed SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
