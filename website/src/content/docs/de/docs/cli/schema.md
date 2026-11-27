---
sourceHash: 0201dc1a9ce575f7
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle-ORM-Schemas aus den Tabellen in backend/schema, erstellen Sie SQL-Migrationen, introspektieren Sie eine bestehende Datenbank in defineTable-Dateien und halten Sie Ihre Datenbank mit der Rebase-CLI synchron.
---

## Übersicht

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der die Tabellen, die Sie mit
`defineTable` in `backend/schema/` deklarieren, die einzige Quelle der Wahrheit (Single Source of Truth) sind. Die CLI
transformiert sie über eine deterministische Pipeline:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Welche Variante verwende ich?

Eine Tabellenänderung gelangt auf drei Wegen nach PostgreSQL:

- **Boot, von selbst.** Das Backend wendet den additiven Teil bei jedem Start an (`REBASE_MIGRATE_ON_BOOT=ensure`, der Standardwert): fehlende Tabellen, Spalten, Enum-Typen und Row-Level-Security-Richtlinien. Unter `rebase dev` benötigt eine hinzugefügte Tabelle oder Spalte nichts weiter. Boot löscht (drop), benennt um (rename) oder verengt (narrow) niemals.
- **`rebase db push`, in der Entwicklung.** Es synchronisiert das Schema direkt mit der Datenbank, einschließlich Löschungen und Umbenennungen, abgesichert durch seine [Sperre für destruktive Änderungen](#rebase-db-push). Verwenden Sie es bei einer Datenbank, die Sie nicht über Migrationen verwalten.
- **`rebase db generate` + `rebase db migrate`, in der Produktion.** Jede Änderung ist eine geprüfte SQL-Datei in der Versionskontrolle, die der Reihe nach angewendet wird.

Eine Datenbank, die durch Boot oder `db push` bereits eingerichtet wurde, auf Migrationen umzustellen, erfordert eine Baseline, da sie die Tabellen, die die erste Migration anlegt, bereits enthält. `rebase db migrate` liest dies, bevor es etwas ausführt, stoppt und gibt den auszuführenden Befehl `rebase db migrate --baseline <version>` mit eingetragener Version aus; siehe [Erstellen einer Baseline für eine Datenbank, die Rebase bereits gebootet hat](#erstellen-einer-baseline-für-eine-datenbank-die-rebase-bereits-gebootet-hat). Umgekehrt weist `db push` auf einer Datenbank, die Migrationen aufzeichnet, in einer einzigen Zeile darauf hin: Die nächste Migration, die dieselbe Änderung vornimmt, bricht mit `already exists` ab.

## Die Pipeline

### 1. Tabellen → Drizzle-Schema

Die Tabellen, die `backend/schema/index.ts` exportiert, beschreiben Spalten, Typen, Relationen,
Enums und Row-Level-Security. Jeder der folgenden Befehle liest sie über denselben Loader ein,
von dem das Backend bootet. Ein Schema, das nicht kompiliert — eine Tabelle ohne
`rls`, `"inherit"` ohne `defaultRls`, ein `defineTable`, das der Index nicht
exportiert —, bricht den Befehl mit einem `SchemaDefinitionError` ab, der jedes Problem benennt,
und es wird nichts geschrieben. Der Befehl `schema generate` gibt daraus eine Drizzle-ORM-Schemadatei aus.

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte,
die ihre Tabellen an einem anderen Ort ablegen; der Standardwert ist `backend/schema` oder der
Schlüssel `tables` der Backend-App in `rebase.json`. Das Flag `--collections` / `-c` aus Versionen
vor 0.31 wird mit einer Meldung abgelehnt, die auf das Codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)) verweist, ebenso wie ein
Projekt, das noch `config/collections` enthält.

### 2. Drizzle-Schema → Migrationen

Ausgehend vom generierten Drizzle-Schema vergleicht `db generate` die Unterschiede (Diff) mit den Migrationen, die sich bereits in `backend/drizzle/migrations/` befinden und auf einer temporären Scratch-Datenbank wiederholt wurden, und erzeugt SQL-Migrationsdateien mit Zeitstempel. Es liest niemals Ihre Datenbank: Eine Spalte, die durch Boot oder `db push` bereits hinzugefügt wurde, wird dennoch als `ADD COLUMN` ausgegeben.

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
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema`); relative Pfade werden von dem Ort aufgelöst, an dem Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden von dem Ort aufgelöst, an dem Sie den Befehl ausführen |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich — bearbeiten Sie eine Tabellendatei und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Prüfen Sie, ob das generierte Schema noch mit den Tabellen übereinstimmt:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Was der Befehl tut:**
- Rendert, was die Tabellen in `backend/schema/` generieren, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied — eine fehlende Tabelle, eine Spalte mit geändertem Typ, ein gelöschtes Enum-Label oder Fremdschlüssel, die so benannt sind, wie eine frühere Version sie abgeleitet hat — und beendet mit einem Exit-Code ungleich null
- Mit `--fix` wird die Datei neu generiert, anstatt nur einen Bericht auszugeben

`rebase dev` hält die Datei von selbst aktuell, dies ist also die Prüfung für einen Build-
oder CI-Schritt. Es akzeptiert `--schema-dir` und `--output` wie `rebase schema generate`.

### `rebase schema reconcile`

Lockern und löschen Sie, was Boot nicht anfasst, nachdem Sie den Plan geprüft haben:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Was der Befehl tut:**
- Bittet das laufende Backend, einen Plan gegen seine eigene Datenbank zu erstellen. Das ist der Endpunkt, auf den die Backend-`.env` und der Cloud-Link zeigen, sodass dies auch auf Rebase Cloud funktioniert, wo sonst nichts die Datenbank erreicht.
- Plant `DROP NOT NULL` für jede Spalte, die eine Tabelle als nullable deklariert, die Datenbank jedoch weiterhin als Pflichtfeld erfordert.
- Listet jede Spalte auf, die keine Tabelle deklariert. Eine Spalte, die `NOT NULL` ohne Standardwert ist, blockiert jedes Einfügen (Insert), weshalb auch sie gelockert wird und ihre Daten erhalten bleiben. Es werden nur die Spalten gelöscht, die Sie mit `--drop <table>.<column>` benennen, und es wird angezeigt, wie viele Zeilen in jeder Spalte einen Wert enthalten.
- Wird angewendet, sobald Sie `yes` eingeben. Der Server führt den Plan nur auf Basis des Hashs/Digests des Plans aus, den Sie gelesen haben; falls sich die Datenbank oder die Tabellen in der Zwischenzeit geändert haben, verweigert er die Ausführung und Sie prüfen erneut. `--yes` überspringt die Bestätigungsabfrage.

Boot fügt immer nur hinzu. Wenn Sie also eine Spalte aus ihrer `defineTable` entfernen, bleibt ihre Spalte in der Datenbank mit ihren Daten erhalten. Eine `NOT NULL`-Spalte ohne Standardwert führt dann dazu, dass jedes Insert fehlschlägt, und das Boot-Protokoll verweist genau dafür auf diesen Befehl: ohne `--drop`, um die Daten zu behalten, mit `--drop`, um die Spalte zu entfernen. Deployen Sie zuerst die Tabellenänderung, da Reconcile gegen das plant, was das Backend ausführt. Es erfordert `REBASE_SERVICE_KEY` in `.env`. Lokal deckt `rebase db push` dasselbe über seine Sperre für destruktive Änderungen ab.

### `rebase schema introspect`

Erstellen Sie `defineTable`-Dateien aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was der Befehl tut:**
- Verbindet sich mit der Datenbank dieses Projekts, die von `rebase db url` ausgegeben wird (die verwaltete Instanz wird gestartet, falls es sich darum handelt); `--database-url` gibt eine andere an, und `--docker` verwendet die Compose-Datenbank
- Liest jede Tabelle, Spalte, jeden Typ, Fremdschlüssel und jede Policy und schreibt
  `backend/schema/<table>.ts` — ein `defineTable` pro Tabelle — sowie die
  `backend/schema/index.ts`, die diese exportiert (zusammengeführt mit einem Index,
  der bereits vorhanden ist)
- Deklariert jede Spalte mit ihrem Postgres-Typ: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, ein Enum mit seinen Labels und dem echten Typnamen
  (ein `pgEnum`, wenn der Typ geteilt wird), ein Array als `<item>.array()`,
  `col.vector({ dimensions })`, Identity- und Serial-Schlüssel, Standardwerte — genau so
  geschrieben, wie Drizzle sie schreibt. Ein Typ, den kein Builder benennt, wird zu
  `col.custom({ dataType: "<sql type>" })`, was Rebase so ausliefert, wie der
  Treiber es zurückgibt; `db generate` und `db push` verweigern ihn, bis der Planer
  ihn verarbeiten kann
- Deklariert die Fremdschlüsselspalte, das dazugehörige `belongsTo` und das umgekehrte
  `hasMany` auf dem Ziel; eine Zwischentabelle (Junction Table) wird zu einem `manyToMany`, deren eigene
  Spalten zum `pivot`
- Liest die Row-Level-Security-Richtlinien jeder Tabelle in ihr `rls` ein: Name,
  Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die `<table>_default_*`-Policies,
  die Rebase selbst hinzufügt, werden weggelassen, sodass das nachfolgende `db push`
  jede Policy wieder so herstellt, wie sie war. Eine Tabelle mit aktivierter Row-Level-Security
  und ohne Policy wird als `rls: "admin-only"` geschrieben
- Liest jeden Ausdruck (das `USING` einer Policy, ein CHECK, ein Spalten-Default) unter
  dem vom Server verwendeten `search_path`, `public`, sodass eine Funktion im Schema
  `rebase` als `rebase.roles()` geschrieben wird
- Wandelt ein lesbares CHECK (`total >= 0`) in das `.validate()` der Spalte um und belässt das Constraint selbst in der Datenbank, wo der nachfolgende Push es beibehält. Jedes CHECK wird außerdem unter "Not carried over" mit seinem SQL aufgeführt: Ein Push in eine *neue* Datenbank erstellt die Validierung, nicht das Constraint
- Deklariert jeden einfachen Index (nur Spalten, btree, gin oder brin, kein Prädikat) in den `indexes` der Tabelle. Ein Index nur auf einer Fremdschlüsselspalte wird der Relation überlassen, die einen erstellt
- Mit `--from supabase` übersetzt es die Konventionen von Supabase für eine Datenbank, von der Sie migrieren: Ein Spaltenstandardwert von `auth.uid()` wird zu `.onCreateUser()` (der Server schreibt die ID des Aufrufers), eine Spalte, die eine Supabase-Benutzer-ID enthält (dieser Standardwert oder ein Fremdschlüssel auf `auth.users`), wird zu `col.text().userId()`, da `rebase.users.id` und `rebase.uid()` Text sind, und eine Policy `TO authenticated` / `TO anon` verliert die Rolle (eine Rebase-Datenbank hat keines von beidem) und erfordert stattdessen einen angemeldeten / abgemeldeten Aufrufer; eine Policy nur für `service_role` wird verworfen. Jede Änderung wird oben in der Tabellendatei vermerkt. Ohne das Flag bleiben diese unverändert (Rebase, das auf derselben Datenbank neben Supabase läuft, benötigt sie weiterhin), und der Durchlauf gibt an, wann er sie gefunden hat
- Endet mit dem, was **nicht** übernommen wurde: Funktionen, Trigger, Extensions, CHECKs, Indizes, die `indexes` nicht ausdrücken kann, Fremdschlüssel über mehrere Spalten oder in ein anderes Schema. Das SQL zur Wiederherstellung jedes Elements, das Postgres ausgeben kann, wird in `backend/sql/_introspected-left-behind.sql` geschrieben, ein Entwurf: Prüfen Sie ihn, machen Sie ihn wiederholbar ausführbar und benennen Sie ihn ohne das führende `_` um; `rebase db push` und jedes Deploy wenden ihn an, wann immer er sich geändert hat
- Erinnert Sie daran, dass `DATABASE_URL` weiterhin die gelesene Datenbank benennt: Bei einer Migration ist das die Quelle, und ein `db push` würde jetzt hineinschreiben
- Ersetzt in einem Headless-Projekt die `ai-instructions.md` des Scaffolds ("the database is the schema") durch die Backend-only-Schema-in-Code-Regeln, sofern die Datei exakt so vorliegt, wie das Scaffold sie geschrieben hat; eine bearbeitete Datei bleibt unangetastet, und der Befehl gibt an, welche ihrer Regeln nicht mehr gelten
- Schreibt Dinge, die nicht exakt abgebildet werden konnten, in einen Kommentar oben in der Tabellendatei und ins Terminal — eine geschlossene Menge von Strings auf einer Textspalte, eine generierte Spalte, deren Ausdruck nicht gelesen werden konnte, ein benutzerdefinierter Typ — zusammen mit den Auswirkungen, die ein Push darauf hätte
- Liest mit `--data-inference` stichprobenartig bis zu 100 Zeilen pro Tabelle und schreibt gefundene Darstellungsdetails — Titel, Icons, Boards, Sortierungen, Feldoptionen — als `customizeTable` nach `frontend/src/cms/<table>.tsx`, sofern das Frontend des Projekts von `@rebasepro/cms` abhängt. Ein Headless-Projekt erhält nichts davon
- Gibt bei einer nicht laufenden Datenbank dasselbe Banner wie `db push` einmalig aus und erstellt nichts. Es gibt das Ausgabeverzeichnis als absoluten Pfad aus

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Speicherort der Tabellendateien (Standard: `backend/schema`). `--output` wurde entfernt |
| `--schema` | Das zu lesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Bereits vorhandene Tabellendateien überschreiben; ohne dieses Flag wird eine vorhandene Datei übersprungen |
| `--database-url` | Diese Datenbank anstelle der projekteigenen lesen |
| `--docker` | Die Compose-Datenbank lesen und bei Bedarf starten |
| `--from supabase` | Supabase-Konventionen (`auth.uid()`-Defaults, `auth.users`-Fremdschlüssel, `TO anon` / `TO authenticated`) für eine Rebase-Datenbank übersetzen. Weglassen, wenn Rebase auf derselben Datenbank neben Supabase läuft |
| `--data-inference` / `--no-data-inference` | Bis zu 100 Zeilen pro Tabelle stichprobenartig untersuchen, um Formate, Constraints und Panel-Einstellungen zu erkennen, oder nur die Struktur lesen. Ohne Angabe erfolgt eine Abfrage, und ohne Terminal wird nur die Struktur gelesen |
| `--users` | Zusätzlich `users.ts` für `rebase.users` als `defineAuthTable` schreiben, das der von Auth erstellten Tabelle entspricht: die Datei, mit der Sie der Benutzertabelle Spalten, Rollen und Hooks hinzufügen. Ohne dieses Flag wird `rebase.users` unverändert als Benutzertabelle bereitgestellt |

Dies ist nützlich bei der Einführung von Rebase auf einer bestehenden Datenbank — führen Sie zuerst Introspect aus und bearbeiten Sie dann die generierten Tabellen. Eine Tabelle mit deaktivierter Row-Level-Security wird wie jede andere geschrieben, mit ihrem `rls`; der Push schaltet RLS ein, und der Probelauf weist darauf hin. Ein Backend, das ganz ohne `backend/schema` läuft, bedient die Datenbank stattdessen direkt — siehe [Backend only](/docs/getting-started/headless/). Sie wechseln von Supabase? Siehe [Migrating from Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Schemaänderungen direkt auf die Datenbank übertragen, ohne Migrationsdateien:

```bash
rebase db push
```

**Was der Befehl tut:**
- Liest das generierte Drizzle-Schema
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Führt den Plan zuerst als Probelauf aus und stoppt vor jeder Operation, die Daten zerstört: eine
  gelöschte Tabelle, Spalte, ein gelöschtes Schema, ein gelöschter View oder Typ, ein `TRUNCATE` oder eine Spaltentypänderung,
  die Werte verlieren kann (`timestamptz` → `date`, `numeric` → `integer`),
  oder eine Änderung des Primärschlüssels — `(id)` → `(id, locale)` weist jeder Zeile eine neue ID zu, sodass
  Verknüpfungen, Fremdschlüssel und an anderer Stelle gespeicherte IDs ihre Zeile nicht mehr finden.
  Er stoppt auch vor dem Löschen eines CHECK- oder EXCLUDE-Constraints, das in der Datenbank vorhanden ist: Es geht zwar keine
  Zeile verloren, aber ab diesem Zeitpunkt akzeptiert die Datenbank Zeilen, die sie zuvor abgelehnt hat.
  Er fragt auf einem Terminal nach, wo Strg-C oder Strg-D mit Nein antwortet, und verweigert die Ausführung
  andernfalls; `--allow-destructive` wendet die Änderungen dennoch an. `--yes` tut dies in diesem Release
  ebenfalls noch, mit einer Deprecation-Warnung; ab dem nächsten Release genehmigt es nur noch
  Pushes, die nichts zerstören. Ein Push, der an dieser Stelle abbricht, löscht seine temporäre
  `<db>_dev_diff`-Datenbank beim Beenden
- Schaltet Row-Level-Security für jede deklarierte Tabelle ein, einschließlich Junctions, direkt nach der
  Schemaänderung und vor jedem Schritt, der fehlschlagen kann, sodass ein unvollständiger Push eine neue Tabelle
  hinterlässt, die jede Anfrage verweigert, anstatt für alle offen zu sein
- Wendet die RLS-Policies an, zu denen das `rls` Ihrer Tabellen kompiliert wird, und **entfernt Policies, die ein früherer Push abgelöst hat**
- Mit `--prune-policies` werden in der Transaktion, die die deklarierten Policies anwendet, auch die Policies auf deklarierten Tabellen gelöscht, die von keiner Tabelle deklariert werden — jene, die der Dry-Run als "in Kraft belassen" auflistet, wie z. B. datenbankeigene Policies, nachdem eine Tabelle auf `rls: "admin-only"` umgestellt wurde. Der Dry-Run listet jede davon unter "Planned row-level security changes" auf, und der Push sichert sie wie eine gelöschte Spalte ab (er fragt auf einem Terminal nach und erfordert andernfalls `--allow-destructive`): Das Löschen einer Policy ändert, wer die Zeilen lesen und schreiben kann, und eine gelöschte `RESTRICTIVE`-Policy erweitert den Zugriff. Eine Tabelle, die `backend/schema` nicht deklariert, sowie das `rebase`-Schema werden niemals angetastet
- Belässt jedes CHECK- und EXCLUDE-Constraint auf einer deklarierten Tabelle so, wie es ist. Eine Tabelle
  kann keines von beidem deklarieren, es handelt sich also um eigene Regeln der Datenbank, die manuell
  geschrieben oder von einer Datenbank übernommen wurden, die `schema introspect` übernommen hat; um ein Constraint
  zu entfernen, löschen Sie es manuell (`ALTER TABLE … DROP CONSTRAINT …`). Von Ihnen geschriebene Trigger und Funktionen
  werden ebenfalls nicht angetastet
- Gleicht die Namen von allem, was unverändert bleibt, exakt ab, einschließlich
  darin enthaltener `.`, `[`, `]` oder `*`
- Erstellt jeden
  [Fremdschlüsselindex, den Rebase ableitet](/docs/backend/indexes#foreign-keys-are-indexed-for-you),
  der einer bestehenden Tabelle fehlt, **vor** der Planung mit
  `CREATE INDEX CONCURRENTLY`, sodass Schreibvorgänge auf die Tabelle während des Indexaufbaus
  weiterlaufen; Atlas findet ihn dann bereits vor Ort vor. `--dry-run` benennt diese und baut nichts auf
- Versieht die angewendeten Policies mit einem Stempel, genau wie es der Server-Boot tut, sodass der
  erste Start nach einem Push sie unberührt lässt, anstatt jede einzelne neu zu erstellen
- `--dry-run` listet die Row-Level-Security-Änderungen, die der Push vornehmen würde, unter "Planned
  row-level security changes" auf: die Tabellen, für die RLS aktiviert wird, und jede Policy, die erstellt,
  ersetzt oder gelöscht wird, ermittelt nach derselben Logik, die die Schritte des Pushs anwenden. Es zeigt "No changes"
  nur an, wenn sich weder das Schema noch die Row-Level-Security ändern würden. Stimmt der Stempel einer Policy
  nicht mit ihrer Regel überein oder hat sie keinen (von `db migrate` erstellt oder manuell geschrieben), erzeugt
  der Dry-Run sie testweise unter einem anderen Namen in einer Transaktion, die zurückgerollt wird, und vergleicht das von
  Postgres Gespeicherte: Ist das Ergebnis identisch, liegt keine Änderung vor. Eine Regel, die `schema introspect`
  als SQL zurückgelesen hat, plant also nichts, ebenso wenig wie Policies, die `db migrate` angewendet hat.
  Nur Policies, die nicht verglichen werden konnten (wenn z. B. die Sperre der Tabelle nicht innerhalb von zwei Sekunden
  erteilt wurde), werden separat aufgeführt. Der Push selbst gibt eine einzelne Zeile aus, die die Änderungen zählt
- Weist darauf hin, wenn ein `rebase dev` auf derselben Datenbank läuft: Da es neue Tabellen und Spalten direkt beim Speichern anwendet, kann "No changes" bedeuten, dass sie bereits angewendet wurden
- Zeigt jede Anweisung, die Atlas anwendet, einmalig an. Atlas verbindet sich ohne SSL mit einer Datenbank auf diesem
  Rechner (`localhost`, `127.x`, `::1`), deren URL keinen `sslmode` angibt, genau wie die App, anstatt mit
  `SSL is not enabled on the server` fehlzuschlagen; eine URL, die `sslmode` oder einen anderen Host angibt,
  wird wie angegeben übergeben. Ein Atlas-Durchlauf, der vor der Planung fehlschlägt, hinterlässt keine
  `<db>_dev_diff`-Datenbank
- `--dry-run` schreibt nichts im Projekt: `src/schema.generated.ts` bleibt unberührt, und die Kopien in
  `drizzle/*.sql`, die eine ältere Version committet hat, werden benannt, nicht gelöscht. Nur die Eingabe des Plans
  wandert nach `.rebase/sql/`, was nicht committet wird
- Erstellt **keine** Migrationsdateien

**Dauer der Ausführung.** Der Großteil der Zeit eines Pushs entfällt darauf, dass Atlas den Plan berechnet: Es
baut Ihr Zielschema in einer Scratch-Datenbank auf und vergleicht es mit der echten Datenbank. Dieser Aufwand
wächst schneller als die Anzahl der Tabellen — auf einem ruhigen Laptop etwa 0,25 s pro Plan bei 11 Tabellen,
0,9 s bei 111 und 5,5 s bei 411. Ein Push, der nichts ändert, plant einmal; einer, der etwas ändert, plant zweimal
(der Dry-Run, den die Sperre für destruktive Änderungen liest, gefolgt von der Anwendung). Ein Push auf einem Schema
von 400 oder mehr Tabellen dauert daher einige Dutzend Sekunden, auf einem ausgelasteten oder langsameren Rechner
noch länger. Diese Zeit beansprucht Atlas, nicht Ihre Datenbank: Die umliegenden Schritte — Generierung des SQL,
RLS-Sperre, Suche, Trigger, Policies, Rolle — dauern bei dieser Größe über eine einzige Verbindung zu Ihrer
Datenbank nur wenige Sekunden.

**Dateien, die unterwegs generiert werden**, alle unter `.rebase/sql/` im Backend-Verzeichnis.
`db push` und `db generate` schreiben bei jedem Durchlauf alle fünf Dateien aus Ihren Tabellen neu,
bevor sie eine davon einlesen; eine committete Kopie würde also von nichts gelesen. Das Verzeichnis
enthält eine eigene `.gitignore` und wird niemals committet.

| Datei | Inhalt |
|-------|--------|
| `schema.sql` | Tabellen, Spalten, Constraints und Indizes — Atlas' Zielzustand und der einzige, den es vergleicht |
| `policies.sql` | Die RLS-Policies, zu denen das `rls` Ihrer Tabellen kompiliert |
| `search.sql` | Die Volltextsuchfunktionen und generierten Spalten für Tabellen mit einem `search`-Block |
| `vector.sql` | pgvector-Erweiterungen und ANN-Indizes |
| `triggers.sql` | `rebase.set_updated_at()` und die `BEFORE UPDATE`-Trigger hinter `.onUpdateNow()` |

Atlas verwaltet die erste Datei und sonst nichts; `db push` und das Schema-Ensure beim Booten
wenden die anderen vier daher selbst an. Ein **Migration-only**-Deployment — eines,
das `db migrate` und niemals `db push` ausführt — muss diese vier manuell in eine
Migration einbinden; `db generate` weist darauf hin, wenn eine Änderung für Atlas unsichtbar ist.

In einem Projekt, das diese Dateien unter einer früheren Version in `drizzle/` committet hat,
werden diese Kopien beim ersten Durchlauf gelöscht, und der Befehl benennt jede einzelne, damit Sie
das Löschen committen können. Es werden nur Dateien gelöscht, die mit dem Header des Generators
beginnen. Eine selbst geschriebene Datei bleibt erhalten, ebenso wie `drizzle/migrations/`.

:::note[Das Bearbeiten einer Sicherheitsregel benennt ihre Policy um]
Eine Regel ohne expliziten `name` wird zu `<table>_<op>_<hash>` kompiliert, wobei der Hash die Semantik der Regel abbildet — das *Bearbeiten* einer Regel (im Gegensatz zum Hinzufügen einer neuen) erzeugt daher eine Policy unter einem neuen Namen und lässt die alte zurück.

Das war früher von großer Bedeutung: Postgres verknüpft `PERMISSIVE`-Policies per ODER (OR). Ein abgelöstes `USING (rebase.uid() IS NOT NULL)` gewährte somit weiterhin vollen Zugriff, ganz gleich, wie restriktiv der Ersatz war. Das Verschärfen einer Regel hatte keine Auswirkung, und Push meldete Erfolg.

`db push` bereinigt dies nun: Es löscht generierte Policies, die keiner Regel mehr entsprechen, und meldet — ohne sie zu löschen — jede benutzerdefiniert benannte Policy, die Ihre Tabellen nicht beschreiben, da diese nicht von bewusst geschriebenem SQL zu unterscheiden sind.

Um eine Datenbank zu überprüfen, die vor dieser Einführung gepusht wurde, führen Sie `rebase doctor --policies` aus. Dies funktioniert als CI-Gate: Es beendet bei Drift mit einem Fehlercode ungleich null, und ebenso, wenn die Prüfung überhaupt nicht ausgeführt werden konnte — keine `DATABASE_URL`, ein `--schema-dir`-Pfad, der sich nicht auflösen lässt, oder ein Lesezugriff auf `pg_policies`, der der CI-Rolle nicht gewährt wurde. Ein Gate, das nicht prüfen konnte, gilt als nicht bestanden.

`doctor` und `db push` unterscheiden die beiden Arten von verwaisten Policies. Eine Policy mit einem generierten Namen wurde abgelöst und wird beim nächsten Push gelöscht. Jeder andere Name wurde manuell oder von einem anderen Tool geschrieben und ist weiterhin in Kraft: Beschreiben Sie sie im `rls` ihrer Tabelle, um sie zu behalten (die RLS-Ansicht von Studio importiert sie), oder löschen Sie sie mit `rebase db push --prune-policies`, falls sie veraltet ist.
:::

:::caution
`db push` modifiziert die Datenbank direkt. Verwenden Sie es nur in der Entwicklung. Erstellen Sie für die Produktion mit `db generate` + `db migrate` überprüfbare Migrationsdateien.
:::

### `rebase db generate`

SQL-Migrationsdateien aus Schemaänderungen generieren:

```bash
rebase db generate
```

**Was der Befehl tut:**
- Vergleicht das Drizzle-Schema mit dem Zustand, den die Migrationen in `drizzle/migrations/` aufbauen, nicht mit Ihrer Datenbank
- Erzeugt SQL-Migrationsdateien mit Zeitstempel in `backend/drizzle/migrations/`
- Dateien können überprüft, bearbeitet und in die Versionskontrolle eingecheckt werden
- Benennt jede Anweisung in der neuen Migration, die Daten zerstört, anhand derselben Prüfung, die `db push`
  vor dem Anwenden ausführt: eine gelöschte Tabelle, Spalte, ein gelöschtes Schema, ein gelöschter View oder Typ, ein
  `TRUNCATE`, eine Spaltentypänderung, die Werte verlieren kann, eine Primärschlüsseländerung
  oder das Löschen eines CHECK- oder EXCLUDE-Constraints, das in der Datenbank vorhanden ist. Die
  Datei wird dennoch geschrieben und mit 0 beendet; der Befehl warnt also und bricht nicht ab.
- Endet mit Hinweisen zu den nächsten Schritten: `rebase db migrate`, und bei der ersten Migration eines
  Projekts das `--baseline <version>`, das eine durch Boot bereits eingerichtete Datenbank stattdessen benötigt.
  Eine spätere Migration erhält keine Baseline-Zeile, da eine gebaselinte destruktive Migration ihr
  `DROP` überspringen würde; ein Durchlauf, der keine Migration schreibt, gibt nur dies aus.

**Ein CHECK, das eine Ihrer Migrationen hinzugefügt hat, wird von der nächsten wieder gelöscht.** `db generate`
vergleicht Ihre Migrationsdateien, nicht die Datenbank, und Atlas hat keine Möglichkeit, ein Objekt von diesem
Vergleich auszunehmen. Ein CHECK- oder EXCLUDE-Constraint, das Sie manuell in eine Migration geschrieben haben
und das keine Tabelle deklarieren kann, taucht daher in der nächsten geschriebenen Migration als
`ALTER TABLE … DROP CONSTRAINT …` auf, zusammengefasst in derselben Anweisung wie die tatsächliche Änderung.
Der obige Bericht weist auf dieses Löschen hin, wenn die Datenbank das Constraint bereits enthält; er entfernt
es jedoch nicht aus der Datei. Löschen Sie die Klausel vor `rebase db migrate`, oder lassen Sie
`rebase db migrate --refuse-destructive` daran stoppen. `db push` liest die Datenbank und behält das Constraint bei.

Die generierten Migrationen sind reine SQL-Dateien — Sie können sie vor dem Anwenden prüfen und anpassen.

### `rebase db migrate`

Alle ausstehenden Migrationen ausführen:

```bash
rebase db migrate
```

**Was der Befehl tut:**
- Durchsucht `drizzle/migrations/` nach nicht angewendeten Migrationen
- Wendet sie der Reihe nach auf die Datenbank an
- Verfolgt nach, welche Migrationen bereits angewendet wurden
- Versieht die Row-Level-Security-Policies mit einem Stempel, wie es `db push` und der Server-Boot tun,
  sodass der erste Start nach einer Migration sie unberührt lässt, anstatt jede einzelne neu zu erstellen.
  Eine Migration wurde auf Basis der Tabellen zum damaligen Zeitpunkt geschrieben; eine Policy wird
  daher nur dann gestempelt, wenn sie exakt dem entspricht, was ihre Regel heute erzeugt: Migrate
  erstellt sie testweise unter einem anderen Namen in einer Transaktion, die zurückgerollt wird, und vergleicht das
  von Postgres Gespeicherte, genau wie `db push --dry-run`. Eine abweichende Policy erhält keinen Stempel,
  und der nächste Boot wendet ihre Tabelle erneut an

`--refuse-destructive`
sorgt stattdessen für eine Verweigerung. Es führt die ausstehenden Migrationen zuerst als Probelauf aus.
Zerstört eine Anweisung Daten (nach denselben Kriterien, die `db push` und `db generate` anwenden),
listet es diese Anweisungen auf und beendet mit Exit-Code 1. Es wird nichts angewendet, nicht einmal die Dateien
vor dieser Anweisung. Ohne das Flag verhält sich `db migrate` wie gewohnt und wendet jede ausstehende Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht diese zuerst, weshalb dieses Flag auch
diese Migration verweigert. Lesen Sie die ausgegebene Liste und führen Sie dann `rebase db migrate`
ohne das Flag aus, um sie anzuwenden.

#### Erstellen einer Baseline für eine Datenbank, die Rebase bereits gebootet hat

Jeder Rebase-Boot stellt das Schema sicher (`ensure`), und `rebase db push` wendet es direkt an. Eine Datenbank, auf der jemals eines von beiden ausgeführt wurde, enthält daher bereits die Tabellen und Typen, die die erste Migration erstellen würde. Auf einer solchen Datenbank ohne Migrationshistorie führt `rebase db migrate` nichts aus: Es nennt die bereits vorhandenen Tabellen und den auszuführenden Befehl mit der Version der neuesten Migration. Es zeichnet die Baseline nicht selbstständig auf.

Mit der Migration ist alles in Ordnung — die Datenbank wurde lediglich auf anderem Wege bereitgestellt. Erfassen Sie einmalig den aktuellen Stand; derselbe Befehl führt die nachfolgenden Migrationen aus, und jedes spätere `rebase db migrate` verhält sich ganz gewöhnlich:

```bash
rebase db migrate --baseline 20260906101530
```

Die Version ist das numerische Präfix der Migrationsdatei, die den Zustand beschreibt, der sich *jetzt* in der Datenbank befindet. Diese Migration und alle vorherigen werden als angewendet markiert; alles danach wird ausgeführt. Boot löscht oder benennt niemals um; falls also eine dieser Migrationen dies tut, setzen Sie die Baseline auf die Version davor. Bei einer Datenbank, gegen die noch nie gebootet wurde, ist keine Baseline erforderlich — migrieren Sie direkt.

Dasselbe geschieht später im regulären Workflow: Wenn Sie eine Tabelle bearbeiten, während `rebase dev` läuft, fügt Boot die Spalte hinzu, bevor `rebase db generate` die Migration schreibt, die sie hinzufügt. Dadurch bricht `rebase db migrate` mit `column … already exists (42701)` ab. Setzen Sie für diese Migration auf dieselbe Weise eine Baseline. `--baseline` funktioniert auch auf einer Datenbank, die bereits Migrationen aufzeichnet: Es markiert alles bis zu dieser Version mit `atlas migrate set` als angewendet und gibt dies aus, bzw. meldet, dass nichts aufzuzeichnen ist, wenn die Historie diese Version bereits erreicht hat. Eine Version, die in keiner Datei in `drizzle/migrations` vorkommt, wird abgelehnt, bevor etwas ausgeführt wird, unter Nennung der vorhandenen Versionen.

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

`rebase db branch switch` (und `switch --off`) sowie `rebase db branch prune`
sind neu. `create`, `list`, `info` und `delete` wurden in 0.17 eingeführt.

Jeder Branch ist eine vollständige Kopie der Datenbank, die mit `CREATE DATABASE ... TEMPLATE`
erstellt wird. Er benötigt daher einen echten PostgreSQL-Server und belegt denselben Speicherplatz wie seine Quelle.

### `rebase doctor`

Erkennen Sie dreiseitigen Drift zwischen Ihren Tabellen, dem generierten Drizzle-Schema und der aktiven PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was der Befehl prüft:**
- Tabellen ↔ Generiertes Schema — sind sie synchron?
- Generiertes Schema ↔ Datenbank — gibt es nicht angewendete Änderungen?
- Tabellen ↔ Datenbank — gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer sich etwas nicht synchron anfühlt. Er zeigt genau, wo die Diskrepanz liegt.

Der Datenbankabgleich umfasst denselben Vergleich, den Boot durchführt, bevor es warnt, dass `schema.generated.ts` und die Datenbank nicht übereinstimmen — ausgeführt über denselben Code. Jeder Unterschied, vor dem Boot warnt, ist daher auch im Bericht enthalten, mit demselben Wortlaut: eine Spalte, die auf der einen Seite NOT NULL und auf der anderen nullable ist, sowie eine Spalte, die in der Datenbank noch vorhanden ist, in der Datei jedoch nicht mehr (Boot löscht niemals Spalten, sodass eine umbenannte Eigenschaft ihre alte Spalte zurücklässt). Jeder Punkt ist eine Warnung, und als Lösung wird `rebase db push` genannt.

Der Datenbankabgleich liest die Datenbank des Projekts, aufgelöst so, wie `rebase db url` sie auflöst — bei einem neuen Scaffold die verwaltete Instanz, die `doctor` startet. Kann keine aufgelöst werden, wird diese Phase als **übersprungen** (skipped) statt als bestanden gemeldet, und der Durchlauf endet niemals mit "All schemas are in sync" — eine Prüfung, die nicht stattgefunden hat, ist kein Unbedenklichkeitsnachweis.

Er benennt außerdem jede Tabelle ohne [`search`-Block](/docs/backend/search), die mehr als etwa 10.000 Zeilen enthält. Eine Suche dort — das Suchfeld im Admin, `.search()`, `?searchString=` — entspricht einem `ILIKE '%term%'` über die Textspalten, was kein Index bedienen kann. Jede Suche liest daher die gesamte Tabelle, und die Zählung (Count) liest sie erneut (etwa ein Drittel einer Sekunde bei 100.000 Zeilen, ansteigend mit der Tabellengröße). Die Zeilenzahl ist Postgres' eigene Schätzung, sodass die Prüfung keinen Scan durchführt. Es handelt sich um einen Hinweis: Er ändert den Exit-Code nicht, und es wird nichts automatisch indiziert.

Er benennt eine **verwaiste Zwischentabelle (Orphaned Junction)**: eine `public`-Tabelle in Form einer Many-to-Many-Junction, die von keiner Tabelle deklariert wird. Die Struktur besteht aus zwei Spalten, die zusammen den Primärschlüssel bilden und jeweils ein Fremdschlüssel auf eine deklarierte Tabelle sind. Das Umbenennen oder Entfernen eines `manyToMany` hinterlässt die alte Zwischentabelle, da Push und Boot nur Tabellen erstellen und alle Verknüpfungszeilen darin verbleiben. Dieser Hinweis dient nur der Information und ändert den Exit-Code nicht. Die Behebung ist die `DROP TABLE`-Anweisung, die `doctor` anzeigt und niemals selbst ausführt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes SDK aus Ihren Tabellen:

```bash
rebase generate-sdk
```

**Was der Befehl tut:**
- Liest die Tabellen, die `backend/schema/index.ts` exportiert, über den Loader, von dem das Backend bootet, sodass das SDK exakt die bereitgestellten Tabellen beschreibt; ein Schema, das nicht kompiliert, bricht den Befehl ab
- Generiert TypeScript-Typen für jede Tabelle in `generated/sdk/`
- Erzeugt eine Datei `database.types.ts` zur Verwendung mit `createRebaseClient<Database>()`: den Typ `Database`, `TableName` (die Union aller Slugs) sowie `tablesDictionary` / `TablesDictionary`, das Mapping vom Accessor zum Slug

`rebase dev` führt dies beim Start und bei jedem Speichern unter
`backend/schema/` automatisch für Sie aus. Führen Sie es selbst in CI aus, in einem Repository, das keine
eigenen Tabellen enthält (siehe `--from` unten), oder überall dort, wo `rebase dev` nicht läuft.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema` oder der Schlüssel `tables` in `rebase.json`); relative Pfade werden von dem Ort aufgelöst, an dem Sie den Befehl ausführen |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Schema von einem laufenden Projekt statt aus lokalem Quellcode lesen. `link` verwendet das mit diesem Checkout verknüpfte Projekt. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |
| `--register` | Daten auch serverseitig typisieren: Schreibt die Typen und eine `Register`-Deklaration nach `backend/generated/` und merkt sich dies in `rebase.json` — siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data/) |

`--from` ermöglicht es einem Repository, das keine Tabellen enthält — einem separaten
Frontend, einer zweiten Web-App, einer mobilen App —, einen typisierten Client aus dem
Projekt zu generieren, mit dem es kommuniziert: Es liest die `tables` des
`/api/meta/contract`-Endpunkts des laufenden Backends. `REBASE_SERVICE_KEY` wird nur an das Projekt
gesendet, mit dem dieser Checkout verknüpft ist; übergeben Sie `--token` explizit für jeden anderen Host. Der Schlüssel in
`.env` gehört zu Ihrem lokalen Backend und wird niemals übertragen.
Eine Verweigerung gibt an, was davon eingetreten ist: ein abgelehnter `--token`, ein abgelehnter Shell-Schlüssel, ein Schlüssel,
der einem nicht verknüpften Host vorenthalten wurde, ein Schlüssel, der nur in `.env` existiert, oder gar kein Schlüssel.

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

Feldnamen in den generierten Typen entsprechen denen, die die API bereitstellt. Der Übertragungsname (Wire Name)
eines Feldes ist sein Spaltenschlüssel, und die API verwendet durchgehend camelCase: Die Introspektion
schreibt eine `created_at`-Spalte als `createdAt: col.timestamp({ withTimezone: true })`, deren SQL-Name
das snake_case des Schlüssels ist, und liefert sie als `row.createdAt` aus. Die Spalte
selbst bleibt unberührt. Der Tabellen-*Accessor* wird auf dieselbe Weise in einen Eigenschaftsnamen
umgewandelt (`my-notes` → `client.data.myNotes`), den `tablesDictionary` wiederum auf den Slug zurückführt.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` verschiebt `config/collections` nach
`backend/schema` (ein `defineTable` pro Collection, jede Spalte explizit an
ihrer ursprünglichen Position in Drizzle-Schreibweise und `index.ts` mit
`defaultRls`) und `frontend/src/cms` (ein `customizeTable` pro angepasster
Collection, `defineFirestoreCollection`-Dateien, `ui-config.json`), schreibt
`backend/resources.ts`, `backend/storage.ts` und `backend/generated/register.ts`,
fügt `rebaseBackendGuard()` zur `vite.config.ts` eines Scaffolds hinzu und führt dann
`rebase migrate sdk-calls` aus. Dies schreibt `.collection(` zu `.table(` um, nimmt
die weiteren SDK-Umbenennungen und die Regelquellen `existsIn` / `membership` in Ihrem Code vor,
verschiebt die Importe von Namen, die in Version 0.31 in ein anderes Package gewandert sind
([die Liste](/docs/upgrading/0-30-to-0-31-imports/)), und fügt das Package zu den
Abhängigkeiten des Importeurs hinzu ("Dependencies added": führen Sie `pnpm install` aus). Aktualisieren Sie jedes `@rebasepro`-Package auf Version 0.31, bevor Sie den Befehl ausführen.
Jeder Durchlauf liest das Ergebnis zurück: Das generierte SQL — DDL, Policies, Suche,
Vektor, Trigger, Views, das Drizzle-Schema — muss byte-identisch sein, andernfalls wird jede
Datei zurückgesetzt. Was nicht übertragen werden kann, wird unter Angabe von Datei und Zeile abgelehnt.
Was Ihrer manuellen Bearbeitung überlassen bleibt, wird in nummerierten manuellen Schritten ausgegeben, die mit
`rebase skills install` enden, falls das Projekt Agent-Skills enthält. Ihre eigenen Module in
`config/` bleiben erhalten; der Durchlauf gibt die `git rm`-Zeile für das aus, was ersetzt wurde. Er folgt auch
Firestore-Collections, die von einer Funktion aufgebaut werden, Pfad-Aliassen, einem außerhalb
von `App.tsx` eingebundenen Panel und jeder ungeschützten statischen App ([die vollständige Liste](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Nach dem `git rm` meldet `--check` den Status `already-migrated`.

| Flag | Auswirkung |
|---|---|
| `--dry-run` | Dateien, Ablehnungen, Hinweise und manuelle Schritte ausgeben; nichts schreiben. Fangen Sie hier an. |
| `--check` | Bei einem migrierten Projekt: Nachweisen, dass `backend/schema` noch immer dasselbe SQL rendert. Beendet mit 1 bei Diffs oder wenn eine Regel ihre Bedeutung ändert. |
| `--accept-rule-changes` | Zusammen mit `--check`: Die Regeln unter "Review before deploying" wurden geprüft. |
| `--json` / `--force` / `--skip-sdk-calls` | Der Bericht als JSON (mit `ruleChanges`); auf einem unsauberen (dirty) Git-Tree oder über bearbeiteter Ausgabe ausführen; lässt Ihren Code unberührt. |

Beachten Sie zwei Listen in der SDK-Ausgabe: **"Rewritten by name — review"** (untypisierte
Empfänger, Datenslots, Test-Doubles) und **"Left unchanged — check each"**
(benennen Sie diejenigen um, die zum SDK gehören; [eine Suche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) findet den Rest).

Die SQL-Prüfung belegt, dass die Konvertierung getreu erfolgt ist, nicht aber, dass eine Regel noch immer dieselbe Bedeutung
hat wie zuvor. Der letzte Abschnitt der Ausgabe, **"Review before deploying: these rules change meaning"**,
listet jede Regel auf, deren Policy nun andere Berechtigungen erteilt
— ein einfaches `access: "authenticated"` gewährte zuvor nichts und lässt nun jeden angemeldeten
Aufrufer zu ([die vier Ausprägungen](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Prüfen Sie anschließend gegen Ihre Datenbank: `rebase db push --dry-run` sollte "No
changes: the database already matches these tables." ausgeben und
`rebase doctor --policies` keinen Drift melden.

## Entwicklungs-Workflow

Der Workflow für schnelle Iterationen in der Entwicklung:

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
|---------|----------|
| `Could not detect an active database plugin` | Installieren Sie `@rebasepro/server-postgres` in `backend/package.json` |
| Schemadatei wird nicht aktualisiert | Prüfen Sie, ob der Pfad `--schema-dir` (oder der Schlüssel `tables` in `rebase.json`) auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |
| Eine Migration darf in CI oder Produktion keine Daten löschen | `rebase db migrate --refuse-destructive` beendet mit 1 und wendet nichts an, wenn eine ausstehende Anweisung Daten zerstört |
| `db migrate` stoppt mit "already has the tables your migrations create" oder schlägt mit `already exists (42710)` fehl | Boot oder `db push` haben das Schema bereits bereitgestellt — erfassen Sie es mit dem ausgegebenen Befehl `rebase db migrate --baseline <version>` |
| `db migrate` schlägt mit `column … already exists (42701)` fehl | `rebase dev` hat die Spalte beim Booten hinzugefügt — setzen Sie für diese Migration auf dieselbe Weise eine Baseline |
| `db push` auf der verwalteten Datenbank schlägt mit `Error: EOF` fehl | Atlas hat eine Verbindung verloren, die das laufende `rebase dev` hält. Führen Sie es erneut aus; falls es weiterhin fehlschlägt, stoppen Sie zuerst `rebase dev` |

## Nächste Schritte

- **[Tabellen](/docs/schema/)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
