---
sourceHash: 98d9c2872375ef18
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Drizzle ORM-Schemas aus den Tabellen in backend/schema generieren, SQL-Migrationen erstellen, eine bestehende Datenbank in defineTable-Dateien introspektieren und Ihre Datenbank mit der Rebase CLI synchron halten.
---

## Übersicht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der die Tabellen, die Sie mit
`defineTable` in `backend/schema/` deklarieren, die Single Source of Truth sind. Die CLI
transformiert sie durch eine deterministische Pipeline:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Tabellen → Drizzle-Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Tabellen, die `backend/schema/index.ts` exportiert, beschreiben Spalten, Typen, Relationen,
Enums und Row-Level Security. Jeder nachfolgende Befehl liest sie über denselben Loader
ein, mit dem das Backend startet. Ein Schema, das nicht kompiliert – eine Tabelle ohne
`rls`, `"inherit"` ohne `defaultRls`, ein `defineTable`, das vom Index nicht
exportiert wird –, bricht den Befehl daher mit einem `SchemaDefinitionError` ab, der jedes Problem
benennt, und es wird nichts geschrieben. Der Befehl `schema generate` gibt daraus eine
Drizzle-ORM-Schemadatei aus.

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte,
die ihre Tabellen an einem anderen Ort verwalten; der Standardwert ist `backend/schema` oder
der Schlüssel `tables` der Backend-App in `rebase.json`. `--collections` / `-c`, das
Flag aus Versionen vor 0.31, wird mit einer Meldung abgelehnt, die auf das Codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)) verweist, ebenso wie ein
Projekt, das noch `config/collections` enthält.

### 2. Drizzle-Schema → Migrationen

Ausgehend vom generierten Drizzle-Schema gleicht `db generate` dieses mit den bereits in `backend/drizzle/migrations/` vorhandenen Migrationen ab (die auf einer Scratch-Datenbank wiederholt abgespielt werden) und erzeugt mit Zeitstempeln versehene SQL-Migrationsdateien. Es liest niemals Ihre Datenbank: Eine Spalte, die beim Booten oder per `db push` bereits hinzugefügt wurde, wird dennoch als `ADD COLUMN` ausgegeben.

### 3. Migrationen → PostgreSQL

Der Befehl `db migrate` wendet ausstehende Migrationen auf Ihre PostgreSQL-Datenbank an.

## Befehle

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Generiert eine Drizzle-ORM-Schemadatei aus Ihren Tabellen:

```bash
rebase schema generate
```

**Was der Befehl tut:**
- Liest die Tabellen ein, die `backend/schema/index.ts` exportiert
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|--------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema`); relative Pfade werden von dort aufgelöst, wo Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden von dort aufgelöst, wo Sie den Befehl ausführen |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich – bearbeiten Sie eine Tabellendatei, und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Prüfen, ob das generierte Schema noch mit den Tabellen übereinstimmt:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Was der Befehl tut:**
- Rendert, was die Tabellen in `backend/schema/` erzeugen, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied – eine fehlende Tabelle, eine umtypisierte Spalte, ein entferntes Enum-Label oder Fremdschlüssel, die so benannt sind, wie ein früheres Release sie abgeleitet hat – und beendet mit einem Exit-Code ungleich null
- Mit `--fix` wird die Datei neu generiert, anstatt nur einen Bericht auszugeben

`rebase dev` hält die Datei von selbst aktuell; dies ist also die Prüfung für einen Build-
oder CI-Schritt. Der Befehl akzeptiert `--schema-dir` und `--output` genauso wie
`rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Lockern und verwerfen, was das Booten nicht übernimmt, nachdem Sie den Plan geprüft haben:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Was der Befehl tut:**
- Fordert das laufende Backend auf, einen Plan für seine eigene Datenbank zu erstellen. Das ist das Ziel, auf das `.env` und der Cloud-Link zeigen, sodass es auch auf Rebase Cloud funktioniert, wo nichts anderes die Datenbank erreicht.
- Plant `DROP NOT NULL` für jede Spalte, die eine Tabelle als nullable deklariert, die Datenbank jedoch weiterhin voraussetzt.
- Listet jede Spalte auf, die keine Tabelle deklariert. Eine Spalte, die `NOT NULL` ohne Standardwert ist, blockiert jedes Einfügen; daher wird sie ebenfalls gelockert, und ihre Daten bleiben erhalten. Es werden nur die Spalten verworfen, die Sie explizit mit `--drop <table>.<column>` angeben, wobei angezeigt wird, wie viele Zeilen jeweils einen Wert enthalten.
- Wird angewendet, sobald Sie `yes` eingeben. Der Server führt den Plan nur anhand des Prüfwerts (Digest) des Plans aus, den Sie gelesen haben. Falls sich die Datenbank oder die Tabellen in der Zwischenzeit geändert haben, verweigert er die Ausführung und Sie prüfen ihn erneut. `--yes` überspringt die Bestätigungsabfrage.

Das Booten fügt immer nur hinzu. Wenn Sie also eine Spalte aus ihrem `defineTable` entfernen, bleibt ihre Spalte samt Daten in der Datenbank erhalten. Eine `NOT NULL`-Spalte ohne Standardwert führt dann dazu, dass jedes Einfügen fehlschlägt, und das Boot-Log verweist auf diesen Befehl: ohne `--drop`, um die Daten zu behalten, mit `--drop`, um die Spalte zu entfernen. Deployen Sie die Tabellenänderung zuerst, da Reconcile gegen den Zustand plant, den das Backend ausführt. Es erfordert `REBASE_SERVICE_KEY` in `.env`. Lokal deckt `rebase db push` dasselbe über sein Destructive-Change-Gate ab.

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Schreibt `defineTable`-Dateien aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was der Befehl tut:**
- Verbindet sich mit der Datenbank dieses Projekts – derjenigen, die `rebase db url` ausgibt (die verwaltete Instanz wird gestartet, falls es sich um diese handelt); `--database-url` gibt eine andere an, und `--docker` nutzt die Compose-Datenbank
- Liest jede Tabelle, Spalte, jeden Typ, Fremdschlüssel und jede Policy ein und schreibt
  `backend/schema/<table>.ts` – ein `defineTable` pro Tabelle – sowie die
  `backend/schema/index.ts`, die sie exportiert (zusammengeführt mit einem Index,
  der bereits vorhanden ist)
- Deklariert jede Spalte mit ihrem Postgres-Typ: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, ein Enum mit seinen Labels und dem echten Typnamen
  (ein `pgEnum`, wenn der Typ geteilt wird), ein Array als `<item>.array()`,
  `col.vector({ dimensions })`, Identity- und Serial-Keys, Standardwerte – so geschrieben, wie
  Drizzle sie schreibt. Ein Typ, den kein Builder benennt, wird zu
  `col.custom({ dataType: "<sql type>" })`, was Rebase so bereitstellt, wie der
  Treiber es zurückgibt; `db generate` und `db push` verweigern die Ausführung, bis der Planner
  ihn verarbeiten kann
- Deklariert die Fremdschlüsselspalte, das `belongsTo` darauf und das umgekehrte
  `hasMany` auf dem Ziel; eine Junction-Tabelle wird zu einem `manyToMany`, deren eigene
  Spalten zum `pivot`
- Liest die Row-Level-Security-Policies jeder Tabelle in deren `rls` ein: Name,
  Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die `<table>_default_*`-Policies,
  die Rebase selbst hinzufügt, werden weggelassen, sodass das nachfolgende `db push`
  jede Policy exakt wie zuvor wiederherstellt. Eine Tabelle mit aktivierter Row-Level Security
  und ohne Policies wird als `rls: "admin-only"` geschrieben
- Liest jeden Ausdruck (das `USING` einer Policy, ein CHECK, ein Spaltenstandardwert) unter
  dem vom Server verwendeten `search_path` (`public`) ein, sodass eine Funktion im
  `rebase`-Schema als `rebase.roles()` geschrieben wird
- Wandelt einen lesbaren CHECK (`total >= 0`) in das `.validate()` der Spalte um und
  belässt den Constraint selbst in der Datenbank, wo der nachfolgende Push ihn
  beibehält
- Schreibt alles, was nicht exakt abgebildet werden konnte, in einen Kommentar am Anfang der
  Tabellendatei sowie ins Terminal – eine geschlossene Menge von Strings auf einer Textspalte, eine
  generierte Spalte, deren Ausdruck nicht gelesen werden konnte, einen benutzerdefinierten Typ – zusammen
  mit den Auswirkungen, die ein Push darauf hätte
- Analysiert mit `--data-inference` bis zu 100 Zeilen pro Tabelle als Stichprobe und schreibt
  erkannte Darstellungseigenschaften – Titel, Icons, Boards, Sortierungen, Feldoptionen – als
  `customizeTable` nach `frontend/src/cms/<table>.tsx`, sofern das Frontend des Projekts
  von `@rebasepro/cms` abhängt. Ein Headless-Projekt erhält keine solchen Dateien
- Gibt bei einer nicht laufenden Datenbank einmalig denselben Banner wie `db push`
  aus und erstellt nichts. Das Ausgabeverzeichnis wird als absoluter Pfad
  ausgegeben

**Optionen:**

| Flag | Beschreibung |
|------|--------------|
| `--schema-dir` | Verzeichnis, in das die Tabellendateien geschrieben werden (Standard: `backend/schema`). `--output` wurde entfernt |
| `--schema` | Das einzulesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Bereits vorhandene Tabellendateien überschreiben; ohne dieses Flag werden bestehende Dateien übersprungen |
| `--database-url` | Diese Datenbank anstelle der projekteigenen einlesen |
| `--docker` | Die Compose-Datenbank einlesen und bei Bedarf starten |
| `--data-inference` / `--no-data-inference` | Bis zu 100 Zeilen pro Tabelle stichprobenartig untersuchen, um Formate, Constraints und Panel-Einstellungen zu erkennen, oder nur die Struktur einlesen. Ohne eines dieser Flags fragt der Befehl nach; ohne Terminal wird nur die Struktur eingelesen |

Dies ist nützlich, wenn Rebase auf einer bestehenden Datenbank eingeführt wird – zuerst introspektieren,
dann die generierten Tabellen bearbeiten. Eine Tabelle mit deaktivierter Row-Level Security wird
wie jede andere mit ihrem `rls` geschrieben; der Push aktiviert RLS, worauf der Dry-Run
hinweist. Ein Backend, das ganz ohne `backend/schema` läuft, stellt stattdessen die
Datenbank direkt bereit – siehe [Nur Backend](/docs/getting-started/headless/).

### `rebase db push`

Schemaänderungen ohne Migrationsdateien direkt in die Datenbank übertragen:

```bash
rebase db push
```

**Was der Befehl tut:**
- Liest das generierte Drizzle-Schema ein
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Führt den Plan zunächst als Dry-Run aus und stoppt vor allen Operationen, die Daten zerstören: eine
  gelöschte Tabelle, Spalte, ein gelöschtes Schema, View oder Typ, ein `TRUNCATE` oder eine Spaltentypänderung,
  die zum Verlust von Werten führen kann (`timestamptz` → `date`, `numeric` → `integer`),
  oder eine Änderung des Primärschlüssels – `(id)` → `(id, locale)` weist jeder Zeile eine neue ID zu, sodass
  Verknüpfungen, Fremdschlüssel und an anderer Stelle gespeicherte IDs ihre Zeile nicht mehr finden.
  Der Befehl stoppt auch vor dem Löschen eines in der Datenbank vorhandenen CHECK- oder
  EXCLUDE-Constraints: Dabei geht zwar keine Zeile verloren, aber die Datenbank akzeptiert fortan
  Zeilen, die zuvor abgelehnt wurden.
  In einem interaktiven Terminal erfolgt eine Bestätigungsabfrage (wobei Strg-C oder Strg-D mit Nein antwortet),
  andernfalls wird die Ausführung verweigert; `--allow-destructive` wendet die Änderungen dennoch an.
  `--yes` tut dies in diesem Release ebenfalls noch (mit einer Deprecation-Warnung); ab dem nächsten Release
  bestätigt es nur noch Pushes, die nichts zerstören. Ein Push, der
  an dieser Stelle stoppt, löscht beim Beenden seine Scratch-Datenbank `<db>_dev_diff`
- Aktiviert Row-Level Security für jede deklarierte Tabelle (einschließlich Junctions) unmittelbar nach der
  Schemaänderung und vor jedem Schritt, der fehlschlagen kann. Ein Push, der auf halbem Weg abbricht, hinterlässt
  eine neue Tabelle somit in einem Zustand, in dem jede Anfrage verweigert wird, anstatt für alle offen zu sein
- Wendet die RLS-Policies an, zu denen das `rls` Ihrer Tabellen kompiliert, und **entfernt Policies, die durch einen früheren Push abgelöst wurden**
- Belässt jeden
  CHECK- und EXCLUDE-Constraint auf einer deklarierten Tabelle unverändert. Eine Tabelle
  kann weder das eine noch das andere deklarieren, es handelt sich also um datenbankeigene Regeln, die manuell
  geschrieben oder aus einer von `schema introspect` übernommenen Datenbank stammen; um einen solchen Constraint zu
  entfernen, löschen Sie ihn manuell (`ALTER TABLE … DROP CONSTRAINT …`). Von Ihnen geschriebene Trigger
  und Funktionen werden ebenfalls nicht angetastet
- Stimmt die Namen aller Elemente, die unberührt bleiben, exakt ab – einschließlich
  eventuell enthaltener Zeichen wie `.`, `[`, `]` oder `*`
- Erstellt jeden
  [von Rebase abgeleiteten Fremdschlüssel-Index](/docs/backend/indexes#foreign-keys-are-indexed-for-you),
  der einer bestehenden Tabelle fehlt, **vor** der Planung mit
  `CREATE INDEX CONCURRENTLY`, sodass Schreibvorgänge auf die Tabelle während des Erstellens weiterlaufen
  können; Atlas findet ihn anschließend an Ort und Stelle vor. `--dry-run` benennt diese Indizes und erstellt nichts
- Versieht die
  angewendeten Policies mit demselben Zeitstempel/Stempel wie beim Booten des Servers, sodass der
  erste Serverstart nach einem Push diese unberührt lässt, anstatt jede einzelne neu zu erstellen
- `--dry-run`
  listet unter „Planned row-level security changes“ die Änderungen an der Row-Level Security auf,
  die der Push vornehmen würde: die Tabellen, für die RLS aktiviert wird, sowie jede Policy, die erstellt,
  ersetzt oder gelöscht wird – ermittelt nach derselben Logik, die auch die Ausführungsschritte des Pushs bestimmt.
  „No changes“ wird nur ausgegeben, wenn sich weder das Schema noch die Row-Level Security ändern würden.
  Stimmt der Stempel einer Policy nicht mit ihrer Regel überein oder besitzt sie keinen (etwa durch `db migrate`
  erstellt oder manuell geschrieben), erzeugt der Dry-Run sie unter anderem Namen innerhalb einer Transaktion
  neu, führt ein Rollback durch und vergleicht das von Postgres Gespeicherte: Ist das Ergebnis identisch,
  liegt keine Änderung vor. Eine Regel, die `schema introspect` als SQL eingelesen hat, plant somit keine
  Änderungen, ebenso wenig wie Policies, die durch `db migrate` angewendet wurden. Nur Policies, die nicht verglichen
  werden konnten (wenn beispielsweise der Tabellen-Lock nicht innerhalb von zwei Sekunden erteilt wurde), werden
  separat aufgeführt. Der Push selbst gibt eine einzelne Zeile aus, welche die Änderungen zählt
- Zeigt jedes
  von Atlas angewendete Statement einmalig an. Atlas verbindet sich ohne SSL mit einer Datenbank auf diesem
  Rechner (`localhost`, `127.x`, `::1`), deren URL keinen `sslmode` angibt (genau wie die App), anstatt
  mit dem Fehler `SSL is not enabled on the server` abzubrechen; eine URL, die `sslmode` oder einen anderen
  Host angibt, wird exakt wie angegeben übergeben. Ein Atlas-Lauf, der vor der Planungsphase fehlschlägt,
  hinterlässt keine `<db>_dev_diff`-Datenbank
- `--dry-run`
  schreibt nichts in Projektdateien: `src/schema.generated.ts` bleibt unverändert, und die von einem
  älteren Release committeten Kopien unter `drizzle/*.sql` werden genannt, nicht gelöscht. Lediglich die
  Eingabedateien für den Plan werden nach `.rebase/sql/` geschrieben, was nicht committet wird
- Erstellt **keine** Migrationsdateien

**Wie lange es dauert.** Der Großteil der Zeit bei einem Push entfällt auf die Berechnung
des Plans durch Atlas: Es baut das gewünschte Zielschema in einer Scratch-Datenbank auf und gleicht es
mit der tatsächlichen Datenbank ab. Dieser Aufwand wächst überproportional zur Anzahl der Tabellen – auf
einem leisen Laptop etwa 0,25 s pro Plan bei 11 Tabellen, 0,9 s bei 111 und 5,5 s bei 411 Tabellen.
Ein Push, der nichts ändert, plant einmal; ein Push, der Änderungen vornimmt, plant zweimal (zuerst der
Dry-Run, den das Destructive-Change-Gate auswertet, danach das Apply). Bei einem Schema mit 400 oder
mehr Tabellen dauert ein Push daher einige Dutzend Sekunden, auf einem ausgelasteten oder langsameren
Rechner noch länger. Diese Zeit beansprucht Atlas, nicht Ihre Datenbank: Die Schritte drumherum –
Generierung des SQLs, RLS-Lock, Suche, Trigger, Policies, die Rolle – dauern bei dieser Größenordnung
über eine einzige Verbindung zu Ihrer Datenbank nur wenige Sekunden.

**Die Dateien, die dabei generiert werden**, liegen alle unter `.rebase/sql/` im Backend-Verzeichnis.
`db push` und `db generate` schreiben alle fünf Dateien bei jedem Durchlauf anhand Ihrer Tabellen, bevor sie
eine davon einlesen; eine committete Kopie würde also von nichts gelesen werden. Das Verzeichnis enthält
eine eigene `.gitignore` und wird niemals committet.

| Datei | Inhalt |
|-------|--------|
| `schema.sql` | Tabellen, Spalten, Constraints und Indizes – der Zielzustand für Atlas und der einzige, den es abgleicht |
| `policies.sql` | Die RLS-Policies, zu denen das `rls` Ihrer Tabellen kompiliert |
| `search.sql` | Die Volltextsuchfunktionen und generierten Spalten für Tabellen mit einem `search`-Block |
| `vector.sql` | pgvector-Erweiterungen und ANN-Indizes |
| `triggers.sql` | `rebase.set_updated_at()` und die `BEFORE UPDATE`-Trigger hinter `.onUpdateNow()` |

Atlas verwaltet nur die erste Datei und sonst nichts; daher wenden `db push` und das Schema-Ensure beim
Booten die anderen vier selbst an. Ein Deployment im **Migration-only**-Modus – bei dem `db migrate`
und niemals `db push` ausgeführt wird – muss diese vier manuell in eine Migration einbinden;
`db generate` weist darauf hin, wenn eine Änderung für Atlas unsichtbar ist.

Bei einem Projekt, das diese Dateien unter einem früheren Release in `drizzle/` committet hat, werden diese
Kopien beim ersten Durchlauf gelöscht, und der Befehl nennt jede einzelne Datei, damit Sie das Löschen committen
können. Es werden nur Dateien gelöscht, die mit dem Header des Generators beginnen. Eine von Ihnen selbst
geschriebene Datei bleibt erhalten, ebenso wie `drizzle/migrations/`.

:::note[Das Bearbeiten einer Sicherheitsregel benennt deren Policy um]
Eine Regel ohne expliziten `name` kompiliert zu `<table>_<op>_<hash>`, wobei der Hash die Semantik der Regel abdeckt – das *Bearbeiten* einer Regel (im Gegensatz zum Hinzufügen einer neuen) erzeugt somit eine Policy unter neuem Namen und belässt die alte in der Datenbank.

Das hatte früher erhebliche Auswirkungen: Postgres verknüpft `PERMISSIVE`-Policies per ODER (OR), sodass eine abgelöste Policy mit `USING (rebase.uid() IS NOT NULL)` weiterhin alle Zugriffe gewährte, ganz gleich wie restriktiv der Ersatz formuliert war. Ein Verschärfen einer Regel hatte keinen Effekt, und der Push meldete dennoch Erfolg.

`db push` gleicht dies nun ab: Es löscht generierte Policies, die zu keiner Regel mehr passen, und meldet – ohne sie zu löschen – alle Policies mit benutzerdefiniertem Namen, die Ihre Tabellen nicht beschreiben, da diese nicht von bewusst von Hand geschriebenem SQL unterschieden werden können.

Um eine Datenbank zu prüfen, die vor Einführung dieser Funktion gepusht wurde, führen Sie `rebase doctor --policies` aus. Dies funktioniert als CI-Gate: Es beendet mit einem Exit-Code ungleich null bei Abweichungen sowie dann, wenn die Prüfung überhaupt nicht durchgeführt werden konnte – keine `DATABASE_URL`, ein nicht auflösbarer `--schema-dir`-Pfad oder fehlende Leserechte der CI-Rolle auf `pg_policies`. Ein Gate, das nicht prüfen konnte, gilt als nicht bestanden.

`doctor` und `db push` unterscheiden zwischen den beiden Arten verwaister Policies. Eine Policy mit generiertem Namen wurde abgelöst und wird beim nächsten Push gelöscht. Jeder andere Name wurde manuell oder durch ein anderes Werkzeug erstellt und bleibt in Kraft: Beschreiben Sie sie im `rls` der jeweiligen Tabelle, um sie beizubehalten (die RLS-Ansicht von Studio importiert sie), oder löschen Sie sie manuell, falls sie veraltet ist.
:::

:::caution
`db push` modifiziert die Datenbank direkt. Verwenden Sie diesen Befehl nur in der Entwicklung. Nutzen Sie für die Produktion `db generate` + `db migrate`, um überprüfbare Migrationsdateien zu erstellen.
:::

### `rebase db generate`

SQL-Migrationsdateien aus Schemaänderungen generieren:

```bash
rebase db generate
```

**Was der Befehl tut:**
- Vergleicht das Drizzle-Schema mit dem Zustand, den die Migrationen in `drizzle/migrations/` aufbauen, nicht mit Ihrer Datenbank
- Erzeugt mit Zeitstempeln versehene SQL-Migrationsdateien in `backend/drizzle/migrations/`
- Dateien können überprüft, bearbeitet und in die Versionsverwaltung committet werden
- Benennt jedes
  Statement in der neuen Migration, das Daten zerstört, anhand derselben Prüfung, die `db push`
  vor dem Anwenden ausführt: eine gelöschte Tabelle, Spalte, ein gelöschtes Schema, View oder Typ, ein
  `TRUNCATE`, eine Spaltentypänderung mit potentiellem Datenverlust, eine Primärschlüsseländerung
  oder das Löschen eines CHECK- oder EXCLUDE-Constraints, der in der Datenbank existiert. Die Datei wird
  dennoch geschrieben und der Befehl mit Exit-Code 0 beendet; es wird also gewarnt, die Ausführung aber nicht verweigert.
- Schließt mit Hinweisen zu den
  nächsten Schritten ab: `rebase db migrate` und – für die erste Migration eines Projekts – die Option
  `--baseline <version>`, die eine bereits durch Booten eingerichtete Datenbank stattdessen benötigt. Eine
  spätere Migration erhält keine Baseline-Zeile, da eine destruktive Migration, wenn sie gebaselined wird,
  ihr `DROP` überspringen würde; ein Durchlauf, der keine Migration schreibt, gibt lediglich diesen Hinweis aus.

**Ein CHECK-Constraint, den eine Ihrer Migrationen hinzugefügt hat, wird von der nächsten wieder verworfen.** `db generate`
vergleicht Ihre Migrationsdateien, nicht die Datenbank, und Atlas bietet keine Möglichkeit, ein
Objekt von diesem Diff auszunehmen. Ein CHECK- oder EXCLUDE-Constraint, den Sie manuell in eine
Migration geschrieben haben und den keine Tabelle deklarieren kann, taucht daher in der nächsten generierten
Migration als `ALTER TABLE … DROP CONSTRAINT …` auf – zusammengefasst im selben Statement wie die eigentliche Änderung.
Der oben erwähnte Bericht benennt dieses Löschen, wenn die Datenbank den Constraint bereits enthält; er entfernt die
Klausel jedoch nicht aus der Datei. Löschen Sie die Klausel vor `rebase db migrate` heraus oder lassen Sie
`rebase db migrate --refuse-destructive` daran anhalten. `db push` liest die Datenbank ein und behält den Constraint bei.

Die generierten Migrationen sind reine SQL-Dateien – Sie können sie vor dem Anwenden prüfen und anpassen.

### `rebase db migrate`

Alle ausstehenden Migrationen ausführen:

```bash
rebase db migrate
```

**Was der Befehl tut:**
- Liest `drizzle/migrations/` nach nicht angewendeten Migrationen aus
- Wendet sie in der richtigen Reihenfolge auf die Datenbank an
- Verfolgt nach, welche Migrationen bereits angewendet wurden
- Versieht die
  Row-Level-Security-Policies mit demselben Stempel wie `db push` und das Booten des Servers,
  sodass der erste Serverstart nach einer Migration sie unberührt lässt, anstatt jede einzelne
  neu zu erstellen. Eine Migration wurde anhand der Tabellen ihres damaligen Stands verfasst; daher wird
  eine Policy nur dann gestempelt, wenn sie exakt dem entspricht, was ihre Regel heute erzeugt: migrate erstellt sie
  anhand ihrer Regel unter anderem Namen innerhalb einer Transaktion neu, führt ein Rollback durch und vergleicht das
  von Postgres Gespeicherte (genau wie `db push --dry-run`). Eine abweichende Policy erhält keinen Stempel, und beim
  nächsten Booten wird ihre Tabelle erneut angewendet

`--refuse-destructive`
sorgt stattdessen für eine Verweigerung. Es führt die ausstehenden Migrationen zunächst als Dry-Run aus. Wenn
ein Statement Daten zerstört (nach derselben Prüfung, die auch `db push` und `db generate` verwenden),
listet der Befehl diese Statements auf und beendet mit Exit-Code 1. Es wird nichts angewendet, nicht einmal die
Dateien vor diesem Statement. Ohne dieses Flag verhält sich `db migrate` wie bisher und wendet jede ausstehende
Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht diese zuerst; daher verweigert dieses Flag
auch eine solche Migration. Lesen Sie die ausgegebene Liste und führen Sie `rebase db migrate`
anschließend ohne das Flag aus, um sie anzuwenden.

#### Baselining einer Datenbank, die Rebase bereits gebootet hat

Jeder Rebase-Bootvorgang stellt das Schema sicher (`ensure`), und `rebase db push` wendet es direkt an. Eine Datenbank, auf der jemals eines von beidem ausgeführt wurde, besitzt daher bereits die Tabellen und Typen, die die erste Migration erstellen würde, und `rebase db migrate` stoppt mit dem Fehler `pq: type "posts_status" already exists (42710)`.

Mit der Migration ist alles in Ordnung – die Datenbank wurde lediglich auf anderem Wege bereitgestellt. Erfassen Sie den aktuellen Stand und migrieren Sie anschließend wie gewohnt:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version ist das numerische Präfix der Migrationsdatei, die beschreibt, was sich *jetzt* in der Datenbank befindet. Diese Migration und alle davorliegenden werden als angewendet erfasst; alles danach wird ausgeführt. Bei einer Datenbank, gegen die noch nie gebootet wurde, ist keine Baseline erforderlich – Sie können direkt migrieren.

Dasselbe geschieht später im regulären Workflow: Wenn Sie eine Tabelle bearbeiten, während `rebase dev` läuft, fügt das Booten die Spalte hinzu, bevor `rebase db generate` die entsprechende Migrationsdatei schreibt. Infolgedessen stoppt `rebase db migrate` mit `column … already exists (42701)`. Erstellen Sie für diese Migration auf dieselbe Weise eine Baseline. `--baseline` funktioniert auch bei Datenbanken, die bereits Migrationen protokollieren: Es markiert alles bis zu dieser Version mittels `atlas migrate set` als angewendet und bestätigt dies, bzw. meldet, dass nichts zu erfassen ist, wenn die Historie diese Version bereits abdeckt. Eine Version, die in keiner Datei unter `drizzle/migrations` vorkommt, wird vor der Ausführung abgelehnt, wobei die verfügbaren Versionen genannt werden.

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

`rebase db branch switch` (sowie `switch --off`) und `rebase db branch prune`
sind neu. `create`, `list`, `info` und `delete` wurden in Version 0.17 eingeführt.

Jeder Branch ist eine vollständige Kopie der Datenbank, die mit `CREATE DATABASE ... TEMPLATE`
erstellt wird. Daher wird ein echter PostgreSQL-Server benötigt und der Branch belegt denselben
Festplattenspeicher wie seine Quelle.

### `rebase doctor`

Drei-Wege-Drift zwischen Ihren Tabellen, dem generierten Drizzle-Schema und der aktiven PostgreSQL-Datenbank erkennen:

```bash
rebase doctor
```

**Was geprüft wird:**
- Tabellen ↔ Generiertes Schema – sind sie synchron?
- Generiertes Schema ↔ Datenbank – gibt es nicht angewendete Änderungen?
- Tabellen ↔ Datenbank – gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer etwas nicht synchron erscheint. Es zeigt exakt an, wo die Unstimmigkeit liegt.

Der Datenbankvergleich beinhaltet denselben Prüfschritt, den das Booten durchführt, bevor es warnt, dass `schema.generated.ts` und die Datenbank nicht übereinstimmen – ausgeführt über denselben Code. Jeder Unterschied, vor dem beim Booten gewarnt wird, ist somit auch im Bericht enthalten, und zwar mit denselben Worten: eine Spalte, die auf einer Seite NOT NULL und auf der anderen nullable ist, sowie eine Spalte, die in der Datenbank noch vorhanden ist, in der Datei jedoch nicht mehr (beim Booten wird nie etwas gelöscht; eine umbenannte Eigenschaft hinterlässt also ihre alte Spalte). Jede dieser Abweichungen ist eine Warnung, und als Lösung wird `rebase db push` empfohlen.

Der Datenbankvergleich liest die Datenbank des Projekts ein, aufgelöst auf dieselbe Weise wie bei `rebase db url` – bei einem neu erstellten Gerüst (Scaffold) die verwaltete Datenbank, die von `doctor` gestartet wird. Wenn keine Datenbank aufgelöst werden kann, wird diese Phase als **übersprungen** (skipped) statt als erfolgreich gemeldet, und der Durchlauf schließt niemals mit „All schemas are in sync“ ab – eine Prüfung, die nicht stattfand, ist schließlich kein Unbedenklichkeitsnachweis.

Außerdem wird jede Tabelle ohne [`search`-Block](/docs/backend/search) genannt, die mehr als etwa 10.000 Zeilen enthält. Eine Suche dort – über das Suchfeld im Adminbereich, `.search()`, `?searchString=` – wird als `ILIKE '%term%'` über die Textspalten ausgeführt, was von keinem Index bedient werden kann; jeder Suchvorgang liest also die gesamte Tabelle, und die Zählung (Count) liest sie ein weiteres Mal (etwa ein Drittel einer Sekunde bei 100.000 Zeilen, mit der Tabelle wachsend). Die Zeilenzahl basiert auf der Schätzung von Postgres selbst, daher führt die Prüfung keinen Scan durch. Es handelt sich um einen Hinweis: Er ändert den Exit-Code nicht und es wird nichts automatisch indiziert.

Der Befehl meldet zudem eine **verwaiste Junction-Tabelle**: eine Tabelle in `public`, die wie eine Many-to-Many-Junction aufgebaut ist, von keiner Tabelle jedoch deklariert wird. Der typische Aufbau besteht aus zwei Spalten, die zusammen den Primärschlüssel bilden und jeweils ein Fremdschlüssel zu einer deklarierten Tabelle sind. Das Umbenennen oder Entfernen eines `manyToMany` hinterlässt die alte Junction-Tabelle, da Push und Boot nur Tabellen erstellen und alle Verknüpfungszeilen darin erhalten bleiben. Der Hinweis dient lediglich der Information und ändert den Exit-Code nicht. Als Behebung wird das `DROP TABLE`-Statement angezeigt, das `doctor` jedoch niemals selbst ausführt.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein typisiertes SDK aus Ihren Tabellen generieren:

```bash
rebase generate-sdk
```

**Was der Befehl tut:**
- Liest die Tabellen ein, die `backend/schema/index.ts` exportiert – und zwar über denselben Loader, mit dem das Backend bootet, sodass das SDK exakt die bereitgestellten Tabellen beschreibt; ein Schema, das nicht kompiliert, bricht die Ausführung ab
- Generiert TypeScript-Typen für jede Tabelle in `generated/sdk/`
- Erzeugt eine `database.types.ts`-Datei zur Verwendung mit `createRebaseClient<Database>()`: den `Database`-Typ, `TableName` (die Union aller Slugs) sowie `tablesDictionary` / `TablesDictionary`, das Mapping vom Accessor zum Slug

`rebase dev` führt dies beim Start und bei jedem Speichern unter
`backend/schema/` automatisch für Sie aus. Führen Sie es manuell in der CI aus, in einem Repository, das keine
eigenen Tabellen besitzt (siehe `--from` unten), oder überall dort, wo `rebase dev` nicht läuft.

**Optionen:**

| Flag | Beschreibung |
|------|--------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema` oder der Schlüssel `tables` in `rebase.json`); relative Pfade werden von dort aufgelöst, wo Sie den Befehl ausführen |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Schema aus einem laufenden Projekt anstelle der lokalen Quelldateien einlesen. `link` verwendet das mit diesem Checkout verknüpfte Projekt. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |
| `--register` | Serverseitige Daten ebenfalls typisieren: Schreibt die Typen und eine `Register`-Deklaration nach `backend/generated/` und hinterlegt dies in `rebase.json` – siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data/) |

Mit `--from` kann ein Repository, das keine Tabellen enthält – etwa ein separates
Frontend, eine zweite Web-App oder eine mobile App –, einen typisierten Client aus dem
Projekt generieren, mit dem es kommuniziert: Es liest die `tables` aus `/api/meta/contract`
des laufenden Backends ein. `REBASE_SERVICE_KEY` wird ausschließlich an das Projekt gesendet,
mit dem dieser Checkout verknüpft ist; übergeben Sie `--token` explizit für jeden anderen Host.
Der Schlüssel in `.env` gehört zu Ihrem lokalen Backend und wird niemals übertragen.
Eine Verweigerung gibt an, welcher dieser Fälle eingetreten ist: ein abgelehnter `--token`,
ein abgelehnter Shell-Key, ein für einen nicht verknüpften Host zurückgehaltener Key,
ein Key, der nur in `.env` vorhanden ist, oder überhaupt kein Key.

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
eines Felds ist sein Spaltenschlüssel, und die API ist durchgehend in camelCase gehalten: Die
Introspektion schreibt eine `created_at`-Spalte als `createdAt: col.timestamp({ withTimezone: true })`, deren SQL-Name
das snake_case des Schlüssels ist, und liefert sie als `row.createdAt` aus. Die Spalte
selbst bleibt unangetastet. Der *Accessor* der Tabelle wird auf dieselbe Weise in einen
Eigenschaftsnamen umgewandelt (`my-notes` → `client.data.myNotes`), was `tablesDictionary`
wiederum auf den Slug zurückführt.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`rebase migrate collections-to-tables [dir]` verschiebt `config/collections` nach
`backend/schema` (ein `defineTable` pro Collection, jede Spalte explizit an ihrer
ursprünglichen Position in Drizzle-Schreibweise und `index.ts` mit
`defaultRls`) sowie nach `frontend/src/cms` (ein `customizeTable` pro angepasster
Collection, `defineFirestoreCollection`-Dateien, `ui-config.json`), schreibt
`backend/resources.ts`, `backend/storage.ts` und `backend/generated/register.ts`,
fügt `rebaseBackendGuard()` zur `vite.config.ts` eines Scaffolds hinzu und führt anschließend
`rebase migrate sdk-calls` aus. Letzteres schreibt `.collection(` zu `.table(`, die
anderen SDK-Umbennungen und die Regelquellen `existsIn` / `membership` in Ihrem Code um
und verschiebt die Imports von Bezeichnern, die in 0.31 in ein anderes Paket verlagert wurden (die Typen
und Hilfsfunktionen des Admin-Panels nach `@rebasepro/cms-types`, das Migration-Lift nach
`@rebasepro/common/migrate` – [die Übersicht](/docs/upgrading/0-30-to-0-31-imports/)),
wobei das Paket zu den Abhängigkeiten des importierenden Moduls hinzugefügt wird („Dependencies added“: führen Sie
`pnpm install` aus). Aktualisieren Sie jedes `@rebasepro`-Paket auf 0.31, bevor Sie den Befehl ausführen.
Jeder Durchlauf liest das Ergebnis gegen: Das generierte SQL – DDL, Policies, Suche,
Vektoren, Trigger, Views, das Drizzle-Schema – muss byte-identisch sein, andernfalls werden alle
Dateien zurückgesetzt. Was nicht übernommen werden kann, wird unter Angabe von Datei und Zeile abgewiesen,
und verbleibende Aufgaben werden als nummerierte manuelle Schritte ausgegeben, abschließend mit
`rebase skills install`, falls das Projekt Agent-Skills enthält. Ihre eigenen Module in
`config/` bleiben erhalten; der Durchlauf gibt die `git rm`-Zeile für ersetzte Elemente aus.

| Flag | Wirkung |
|---|---|
| `--dry-run` | Dateien, Verweigerungen, Hinweise und manuelle Schritte ausgeben; nichts schreiben. Beginnen Sie hier. |
| `--check` | Bei einem migrierten Projekt: Nachweisen, dass `backend/schema` noch dasselbe SQL erzeugt. Beendet mit 1 und dem Diff oder solange eine Regel ihre Bedeutung ändert. |
| `--accept-rule-changes` | Mit `--check`: Die Regeln unter „Review before deploying“ wurden geprüft. |
| `--json` / `--force` / `--skip-sdk-calls` | Den Bericht als JSON ausgeben (mit `ruleChanges`); auf einem dirty Tree oder über bearbeitetem Output ausführen; Ihren Code unberührt lassen. |

Beachten Sie zwei Listen in der SDK-Ausgabe: **„Rewritten by name — review“** (Aufrufe auf einem
untypisierten Empfänger, anhand des Namens umgeschrieben) und **„Left unchanged — check each“**
(Aufrufe, bei denen nicht zweifelsfrei feststeht, dass es sich um das SDK handelt: Benennen Sie diejenigen um, bei denen dies zutrifft, da sie sonst zur Laufzeit fehlschlagen).

Die SQL-Prüfung belegt die Korrektheit der Konvertierung, nicht jedoch, dass eine Regel noch dieselbe
Bedeutung wie zuvor hat. Der letzte Abschnitt der Ausgabe, **„Review before deploying: these rules
change meaning“**, listet jede Regel auf, deren Policy nun andere Berechtigungen gewährt
– ein einfaches `access: "authenticated"` gewährte zuvor nichts und lässt nun jeden angemeldeten
Aufrufer zu ([die vier Varianten](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Prüfen Sie anschließend gegen Ihre Datenbank: `rebase db push --dry-run` sollte „No
changes: the database already matches these tables.“ ausgeben und
`rebase doctor --policies` keinen Drift melden.

## Entwicklungs-Workflow

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Der Workflow für schnelle Iterationen während der Entwicklung:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Produktions-Workflow

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Der sichere, überprüfbare Workflow für die Produktion:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Fehlerbehebung

| Symptom | Lösung |
|---------|--------|
| `Could not detect an active database plugin` | `@rebasepro/server-postgres` in `backend/package.json` installieren |
| Schemadatei aktualisiert sich nicht | Prüfen, ob der Pfad in `--schema-dir` (oder der Schlüssel `tables` in `rebase.json`) auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | `rebase doctor` ausführen, um Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Stattdessen `db generate` + `db migrate` verwenden |
| Eine Migration darf in CI oder Produktion keine Daten löschen | `rebase db migrate --refuse-destructive` beendet mit Exit-Code 1 und wendet nichts an, wenn ein ausstehendes Statement Daten zerstört |
| `db migrate` schlägt mit `already exists (42710)` fehl | Booten oder `db push` hat das Schema bereits eingerichtet – mit `rebase db migrate --baseline <version>` erfassen |
| `db migrate` schlägt mit `column … already exists (42701)` fehl | `rebase dev` hat die Spalte beim Booten hinzugefügt – für diese Migration auf dieselbe Weise eine Baseline anlegen |
| `db push` auf der verwalteten Datenbank schlägt mit `Error: EOF` fehl | Atlas hat eine Verbindung verloren, die das laufende `rebase dev` hält. Führen Sie es erneut aus; falls der Fehler weiterhin auftritt, stoppen Sie zuerst `rebase dev` |

## Nächste Schritte

- **[Tabellen](/docs/schema/)** — Datenmodell definieren
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Das generierte SDK verwenden
