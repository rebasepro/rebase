---
sourceHash: b11f6c3760378ade
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle-ORM-Schemas aus den Tabellen in backend/schema, erstellen Sie SQL-Migrationen, introspektieren Sie eine bestehende Datenbank in defineTable-Dateien und halten Sie Ihre Datenbank mit der Rebase-CLI synchron.
---

## Übersicht

Rebase nutzt eine **Schema-as-Code**-Pipeline, bei der die Tabellen, die Sie mit
`defineTable` in `backend/schema/` deklarieren, die Single Source of Truth bilden. Die CLI
transformiert sie über eine deterministische Pipeline:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Tabellen → Drizzle-Schema

Die Tabellen, die `backend/schema/index.ts` exportiert, beschreiben Spalten, Typen, Relationen,
Enums und Row-Level Security. Jeder nachfolgende Befehl liest sie über den Loader
ein, mit dem das Backend startet. Ein Schema, das nicht kompiliert — eine Tabelle ohne
`rls`, `"inherit"` ohne `defaultRls`, ein `defineTable`, das vom Index nicht
exportiert wird —, bricht den Befehl daher mit einem `SchemaDefinitionError` ab, der jedes Problem benennt,
und es wird nichts geschrieben. Der Befehl `schema generate` erzeugt daraus eine
Drizzle-ORM-Schema-Datei.

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte,
die ihre Tabellen an einem anderen Ort ablegen; der Standardwert ist `backend/schema` oder der
`tables`-Schlüssel der Backend-App in `rebase.json`. Das Flag `--collections` / `-c` aus Versionen
vor 0.31 wird mit einer Meldung abgelehnt, die auf den Codemod verweist
([`rebase migrate collections-to-tables`](#rebase-migrate)); dies gilt ebenso für
Projekte, die noch `config/collections` besitzen.

### 2. Drizzle-Schema → Migrationen

Ausgehend vom generierten Drizzle-Schema gleicht `db generate` dieses mit den Migrationen ab, die sich bereits in `backend/drizzle/migrations/` befinden (wiedergegeben auf einer Scratch-Datenbank), und erzeugt mit Zeitstempeln versehene SQL-Migrationsdateien. Die eigentliche Datenbank wird dabei nie ausgelesen: Eine Spalte, die der Bootvorgang oder `db push` bereits hinzugefügt hat, wird dennoch als `ADD COLUMN` ausgegeben.

### 3. Migrationen → PostgreSQL

Der Befehl `db migrate` wendet ausstehende Migrationen auf Ihre PostgreSQL-Datenbank an.

## Befehle

### `rebase schema generate`

Generieren Sie eine Drizzle-ORM-Schema-Datei aus Ihren Tabellen:

```bash
rebase schema generate
```

**Was er tut:**
- Liest die Tabellen ein, die `backend/schema/index.ts` exportiert
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema`); relative Pfade werden von dort aufgelöst, wo Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schema-Datei; relative Pfade werden von dort aufgelöst, wo Sie den Befehl ausführen |
| `--watch, -w` | Auf Änderungen überwachen und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich — bearbeiten Sie eine Tabellendatei, und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Prüfen Sie, ob das generierte Schema noch mit den Tabellen übereinstimmt:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Was er tut:**
- Rendert das, was die Tabellen in `backend/schema/` generieren, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied — eine fehlende Tabelle, eine Spalte mit neuem Typ, ein gelöschtes Enum-Label oder Fremdschlüssel, die so benannt sind, wie sie ein früheres Release abgeleitet hat — und beendet den Prozess mit einem Exit-Code ungleich null
- Generiert mit `--fix` die Datei neu, anstatt nur Bericht zu erstatten

`rebase dev` hält die Datei automatisch aktuell; dies ist also die Prüfung für einen Build-
oder CI-Schritt. Der Befehl unterstützt `--schema-dir` und `--output` genau wie
`rebase schema generate`.

### `rebase schema reconcile`

Lockern und verwerfen Sie, was der Boot-Vorgang nicht bereinigt, nachdem Sie den Plan geprüft haben:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Was er tut:**
- Fordert das laufende Backend auf, einen Plan gegen seine eigene Datenbank zu erstellen. Das ist das Backend, auf das `.env` und der Cloud-Link zeigen; daher funktioniert dies auch auf Rebase Cloud, wo sonst nichts die Datenbank erreicht.
- Plant `DROP NOT NULL` für jede Spalte, die eine Tabelle als nullable deklariert, die Datenbank aber noch zwingend erfordert.
- Listet jede Spalte auf, die von keiner Tabelle deklariert wird. Eine Spalte, die `NOT NULL` ohne Standardwert ist, blockiert jedes Einfügen, weshalb auch sie gelockert wird und ihre Daten erhalten bleiben. Es werden nur die Spalten verworfen, die Sie explizit mit `--drop <table>.<column>` angeben, wobei angezeigt wird, wie viele Zeilen jeweils einen Wert enthalten.
- Wird angewendet, sobald Sie `yes` eingeben. Der Server führt den Plan nur anhand des Prüfwerts (Digest) des Plans aus, den Sie gelesen haben. Haben sich Datenbank oder Tabellen in der Zwischenzeit geändert, verweigert er die Ausführung und Sie prüfen erneut. `--yes` überspringt die Bestätigungsabfrage.

Der Boot-Vorgang fügt immer nur hinzu. Wenn Sie also eine Spalte aus ihrem `defineTable` entfernen, bleibt diese Spalte samt Daten in der Datenbank bestehen. Eine `NOT NULL`-Spalte ohne Standardwert führt dann dazu, dass jedes Einfügen fehlschlägt, und das Boot-Log verweist auf diesen Befehl: ohne `--drop`, um die Daten zu behalten, mit `--drop`, um die Spalte zu entfernen. Deployen Sie die Tabellenänderung zuerst, da der Abgleich (reconcile) auf Basis dessen plant, was das Backend ausführt. Er erfordert `REBASE_SERVICE_KEY` in `.env`. Lokal deckt `rebase db push` dasselbe über sein Kontrollgate für destruktive Änderungen ab.

### `rebase schema introspect`

Schreiben Sie `defineTable`-Dateien aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was er tut:**
- Verbindet sich mit der Datenbank dieses Projekts, derjenigen, die `rebase db url` ausgibt (die verwaltete wird gestartet, falls es sich um diese handelt); `--database-url` gibt eine andere an und `--docker` nutzt die Compose-Datenbank
- Liest jede Tabelle, Spalte, jeden Typ, Fremdschlüssel und jede Policy aus und schreibt
  `backend/schema/<table>.ts` — ein `defineTable` pro Tabelle — sowie die
  `backend/schema/index.ts`, die diese exportiert (zusammengeführt mit einem Index, der
  bereits existiert)
- Deklariert jede Spalte mit ihrem Postgres-Typ: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, ein Enum mit seinen Labels und dem echten Typnamen
  (ein `pgEnum`, wenn der Typ geteilt wird), ein Array als `<item>.array()`,
  `col.vector({ dimensions })`, Identity- und Serial-Schlüssel, Defaults — genau so formuliert,
  wie Drizzle sie schreibt. Ein Typ, den kein Builder benennt, wird zu
  `col.custom({ dataType: "<sql type>" })`, was Rebase so ausliefert, wie der
  Treiber es zurückgibt; `db generate` und `db push` verweigern dies, bis der Planer
  es planen kann
- Deklariert die Fremdschlüssel-Spalte, das `belongsTo` darauf und das umgekehrte
  `hasMany` auf dem Ziel; eine Zwischentabelle (Junction Table) wird zu einem `manyToMany`, deren eigene
  Spalten zum `pivot`
- Liest die Row-Level-Security-Policies jeder Tabelle in ihr `rls` ein: Name,
  Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die `<table>_default_*`-Policies,
  die Rebase selbst hinzufügt, werden weggelassen, sodass das nachfolgende `db push`
  jede Policy so wie zuvor wiederherstellt. Eine Tabelle mit aktivierter Row-Level Security und ohne Policy
  wird als `rls: "admin-only"` geschrieben
- Liest jeden Ausdruck (das `USING` einer Policy, einen CHECK, einen Spalten-Standardwert) unter
  dem vom Server verwendeten `search_path`, `public`, ein, sodass eine Funktion im Schema `rebase`
  als `rebase.roles()` geschrieben wird
- Wandelt einen lesbaren CHECK (`total >= 0`) in das `.validate()` der Spalte um und belässt den Constraint selbst in der Datenbank, wo der nachfolgende Push ihn beibehält. Jeder CHECK wird zudem unter „Not carried over“ mit seinem SQL aufgeführt: Ein Push in eine *neue* Datenbank erstellt die Validierung, nicht den Constraint
- Deklariert jeden einfachen Index (nur Spalten, btree, gin oder brin, kein Prädikat) in den `indexes` der Tabelle. Ein Index nur auf einer Fremdschlüsselspalte wird der Relation überlassen, die einen erstellt
- Mit `--from supabase` werden die Konventionen von Supabase für eine Datenbank übersetzt, von der Sie migrieren: Ein Spalten-Standardwert von `auth.uid()` wird zu `.onCreateUser()` (der Server schreibt die ID des Aufrufers), eine Spalte, die eine Supabase-Benutzer-ID enthält (dieser Standardwert oder ein Fremdschlüssel zu `auth.users`), wird zu `col.text().userId()`, da `rebase.users.id` und `rebase.uid()` Text sind, und eine Policy `TO authenticated` / `TO anon` verliert die Rolle (eine Rebase-Datenbank hat keine von beiden) und erfordert stattdessen einen angemeldeten / abgemeldeten Aufrufer; eine Policy nur für `service_role` wird verworfen. Jede Änderung wird oben in der Datei der Tabelle vermerkt. Ohne das Flag bleiben diese unverändert (Rebase, das auf derselben Datenbank neben Supabase läuft, benötigt sie weiterhin), und die Ausführung gibt an, wann sie gefunden wurden
- Schließt mit dem ab, was **nicht** übernommen wurde: Funktionen, Trigger, Extensions, CHECKs, Indizes, die `indexes` nicht darstellen kann, Fremdschlüssel über mehrere Spalten oder in ein anderes Schema. Das SQL zur Wiederherstellung jedes Elements, das Postgres ausgeben kann, wird in `backend/sql/_introspected-left-behind.sql` geschrieben, einen Entwurf: Prüfen Sie ihn, machen Sie ihn gefahrlos wiederholbar und benennen Sie ihn ohne das führende `_` um, dann wenden `rebase db push` und jeder Deploy ihn an, sobald er sich geändert hat
- Erinnert Sie daran, dass `DATABASE_URL` weiterhin die ausgelesene Datenbank bezeichnet: In einer Migration ist dies die Quelle, und ein jetziges `db push` würde hineinschreiben
- Ersetzt in einem Headless-Projekt die `ai-instructions.md` des Scaffolds („the database is the schema“) durch die reinen Backend-Schema-in-Code-Regeln, sofern die Datei exakt dem Original des Scaffolds entspricht; eine bearbeitete Datei bleibt unangetastet, und der Befehl gibt an, welche ihrer Regeln nicht mehr gelten
- Schreibt das, was nicht exakt bestimmt werden konnte, in einen Kommentar oben in der Tabellendatei und ins Terminal — eine geschlossene Menge von Strings auf einer Textspalte, eine generierte Spalte, deren Ausdruck nicht gelesen werden konnte, ein benutzerdefinierter Typ — zusammen mit den Auswirkungen, die ein Push darauf hätte
- Liest mit `--data-inference` bis zu 100 Zeilen pro Tabelle stichprobenartig aus und schreibt gefundene
  Darstellungsdaten — Titel, Icons, Boards, Sortierungen, Feldoptionen — als
  `customizeTable` in `frontend/src/cms/<table>.tsx`, sofern das Frontend des Projekts
  von `@rebasepro/cms` abhängt. Ein Headless-Projekt erhält keine davon
- Gibt bei einer nicht laufenden Datenbank einmalig denselben Banner wie `db push`
  aus und erstellt nichts. Das Ausgabeverzeichnis wird als
  absoluter Pfad ausgegeben

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Speicherort für die Tabellendateien (Standard: `backend/schema`). `--output` wurde entfernt |
| `--schema` | Das zu lesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Bereits existierende Tabellendateien überschreiben; ohne dieses Flag wird eine vorhandene Datei übersprungen |
| `--database-url` | Diese Datenbank anstelle der projekteigenen lesen |
| `--docker` | Die Compose-Datenbank lesen und bei Bedarf starten |
| `--from supabase` | Übersetzt Konventionen von Supabase (`auth.uid()`-Defaults, `auth.users`-Fremdschlüssel, `TO anon` / `TO authenticated`) für eine Rebase-Datenbank. Weglassen, wenn Rebase auf derselben Datenbank neben Supabase betrieben wird |
| `--data-inference` / `--no-data-inference` | Bis zu 100 Zeilen pro Tabelle abtasten, um Formate, Constraints und Panel-Einstellungen zu erkennen, oder nur die Struktur lesen. Ohne Flag erfolgt eine interaktive Abfrage; ohne Terminal wird nur die Struktur gelesen |

Dies ist nützlich bei der Einführung von Rebase auf einer bestehenden Datenbank — führen Sie zuerst
Introspect aus und bearbeiten Sie dann die generierten Tabellen. Eine Tabelle mit deaktivierter Row-Level Security
wird wie jede andere mit ihrem `rls` geschrieben; der Push aktiviert RLS, worauf der
Dry-Run hinweist. Ein Backend, das ganz ohne `backend/schema` läuft, stellt stattdessen
die Datenbank direkt bereit — siehe [Nur Backend](/docs/getting-started/headless/).
Sie migrieren von Supabase? Siehe [Migration von Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Schema-Änderungen ohne Migrationsdateien direkt in die Datenbank übertragen:

```bash
rebase db push
```

**Was er tut:**
- Liest das generierte Drizzle-Schema
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Führt den Plan zuerst als Dry-Run aus und stoppt vor allen Vorgängen, die Daten zerstören: eine
  gelöschte Tabelle, Spalte, ein gelöschtes Schema, ein gelöschter View oder Typ, ein `TRUNCATE` oder eine
  Änderung des Spaltentyps, die Werte verlieren kann (`timestamptz` → `date`, `numeric` → `integer`),
  oder eine Änderung des Primärschlüssels — `(id)` → `(id, locale)` gibt jeder Zeile eine neue ID, sodass
  Verlinkungen, Fremdschlüssel und an anderer Stelle gespeicherte IDs ihre Zeile nicht mehr finden.
  Er stoppt auch vor dem Löschen eines CHECK- oder EXCLUDE-Constraints, das die Datenbank enthält: Es gehen keine Zeilen
  verloren, aber von da an akzeptiert die Datenbank Zeilen, die sie zuvor abgelehnt hat.
  Im Terminal erfolgt eine Bestätigungsabfrage (Strg-C oder Strg-D antwortet mit Nein),
  andernfalls wird die Ausführung verweigert; `--allow-destructive` wendet die Änderungen dennoch an. `--yes` tut dies
  in diesem Release ebenfalls noch (mit einer Deprecation-Warnung); ab dem nächsten Release genehmigt
  es nur noch Pushes, die nichts zerstören. Ein Push, der an dieser Stelle abbricht,
  löscht seine Scratch-Datenbank `<db>_dev_diff` beim Beenden
- Aktiviert Row-Level Security für jede deklarierte Tabelle (einschließlich Zwischentabellen) direkt nach der
  Schemaänderung und vor jedem Schritt, der fehlschlagen könnte, sodass ein unvollständiger Push eine neue Tabelle
  so hinterlässt, dass alle Anfragen verweigert werden, anstatt offen zu sein
- Wendet die RLS-Policies an, zu denen das `rls` Ihrer Tabellen kompiliert wird, und **entfernt Policies, die ein früherer Push abgelöst hat**
- <span class="since-badge" data-since="0.35">Seit 0.35</span> Verwirft mit `--prune-policies` auch diejenigen Policies auf deklarierten Tabellen, die von keiner Tabelle mehr deklariert werden — also jene, die der Dry-Run als „in Kraft belassen“ aufführt, wie z. B. datenbankeigene Policies, nachdem eine Tabelle auf `rls: "admin-only"` umgestellt wurde — innerhalb der Transaktion, die die deklarierten anwendet. Der Dry-Run listet jede davon unter „Planned row-level security changes“ auf, und der Push sichert sie wie eine gelöschte Spalte ab (er fragt im Terminal nach und erfordert ansonsten `--allow-destructive`): Das Löschen einer Policy ändert, wer die Zeilen lesen und schreiben darf, und das Löschen einer `RESTRICTIVE`-Policy erweitert den Zugriff. Tabellen, die `backend/schema` nicht deklariert, sowie das `rebase`-Schema werden niemals angetastet
- Belässt jedes
  CHECK- und EXCLUDE-Constraint auf einer deklarierten Tabelle unverändert. Da eine Tabelle
  keines von beiden deklarieren kann, handelt es sich um datenbankeigene Regeln, die manuell
  geschrieben oder von einer über `schema introspect` übernommenen Datenbank mitgebracht wurden; um ein solches zu entfernen, löschen Sie es manuell (`ALTER TABLE … DROP CONSTRAINT …`). Von Ihnen geschriebene Trigger und Funktionen werden ebenfalls nicht angetastet
- Gleicht den
  Namen aller unberührten Objekte exakt ab, einschließlich darin enthaltener `.`, `[`, `]` oder `*`
- Erstellt jeden
  [Fremdschlüssel-Index, den Rebase ableitet](/docs/backend/indexes#foreign-keys-are-indexed-for-you),
  der einer bestehenden Tabelle fehlt, **vor** der Planung mittels
  `CREATE INDEX CONCURRENTLY`, sodass Schreibvorgänge auf die Tabelle während der Erstellung weiterlaufen können;
  Atlas findet ihn dann bereits vor. `--dry-run` benennt diese und baut nichts
- Versieht die angewendeten Policies mit einem Stempel, wie es auch der Server-Boot tut,
  sodass der erste Start nach einem Push sie unberührt lässt, anstatt jede einzelne neu zu erstellen
- `--dry-run`
  listet die Row-Level-Security-Änderungen, die der Push durchführen würde, unter „Planned
  row-level security changes“ auf: die Tabellen, für die RLS aktiviert wird, und jede
  Policy, die erstellt, ersetzt oder gelöscht wird, ermittelt nach der Logik der Push-Schritte selbst.
  Es wird nur dann „No changes“ gemeldet, wenn sich weder das Schema noch
  die Row-Level Security ändern würden. Stimmt der Stempel einer Policy nicht mit ihrer
  Regel überein oder ist gar keiner vorhanden (durch `db migrate` erstellt oder manuell geschrieben), erzeugt
  der Dry-Run sie unter einem anderen Namen erneut aus ihrer Regel in einer Transaktion,
  die zurückgerollt wird, und vergleicht das von Postgres Gespeicherte: Ist das Ergebnis identisch,
  liegt keine Änderung vor. Eine Regel, die `schema introspect` als SQL eingelesen hat, plant also nichts,
  und von `db migrate` angewendete Policies ebenfalls nicht. Nur Policies, die nicht verglichen werden konnten (wenn
  etwa die Sperre für die Tabelle nicht innerhalb von zwei Sekunden erteilt wurde), werden separat aufgeführt. Der Push
  selbst gibt eine einzige Zeile mit der Anzahl der Änderungen aus
- Weist darauf hin, wenn ein `rebase dev` auf derselben Datenbank läuft: Da dieser neue Tabellen und Spalten beim Speichern sofort anwendet, kann „No changes“ bedeuten, dass er sie bereits übernommen hat
- Zeigt jedes
  von Atlas angewendete Statement einmal an. Atlas verbindet sich ohne SSL mit einer Datenbank auf diesem
  Rechner (`localhost`, `127.x`, `::1`), deren URL keinen `sslmode` angibt (so wie es auch die App tut),
  anstatt mit `SSL is not enabled on the server` fehlzuschlagen; eine URL, die einen
  `sslmode` oder einen anderen Host angibt, wird exakt wie angegeben übergeben. Ein Atlas-Durchlauf,
  der vor der Planung fehlschlägt, hinterlässt keine `<db>_dev_diff`-Datenbank
- `--dry-run`
  schreibt nichts in das Projekt: `src/schema.generated.ts` bleibt unberührt,
  und die Kopien in `drizzle/*.sql`, die ein älteres Release committet hat, werden benannt, nicht
  gelöscht. Lediglich die Eingabe für den Plan gelangt nach `.rebase/sql/`, was nicht committet wird
- Erstellt **keine** Migrationsdateien

**Wie lange es dauert.** Fast der gesamte Push-Vorgang besteht darin, dass Atlas den Plan berechnet: Es
baut Ihr Zielschema in einer Scratch-Datenbank auf, vergleicht es mit der echten
Datenbank, und dieser Aufwand wächst schneller als die Anzahl der Tabellen — auf einem ruhigen Laptop
etwa 0,25 s pro Plan bei 11 Tabellen, 0,9 s bei 111 und 5,5 s bei 411. Ein Push, der
nichts ändert, plant einmal; einer, der etwas ändert, plant zweimal (der Dry-Run,
den das Gate für destruktive Änderungen liest, gefolgt vom Anwenden). Ein Push auf ein Schema mit
400 oder mehr Tabellen dauert daher mehrere zehn Sekunden, auf einer ausgelasteten oder langsameren Maschine auch länger.
Diese Zeit beansprucht Atlas, nicht Ihre Datenbank: Die begleitenden Schritte — Generierung des
SQL, RLS-Sperre, Suche, Trigger, Policies, die Rolle — dauern bei dieser Größe
über eine einzige Verbindung zu Ihrer Datenbank nur wenige Sekunden.

**Die Dateien, die dabei generiert werden**, befinden sich alle unter `.rebase/sql/` im Backend-Verzeichnis.
`db push` und `db generate` schreiben bei jedem Durchlauf alle fünf Dateien aus Ihren Tabellen neu,
bevor sie überhaupt gelesen werden; eine comittete Kopie würde also von nichts
gelesen werden. Das Verzeichnis enthält seine eigene `.gitignore` und wird nie committet.

| Datei | Inhalt |
|------|-------|
| `schema.sql` | Tabellen, Spalten, Constraints und Indizes — Atlas' Soll-Zustand und der einzige, den es abgleicht |
| `policies.sql` | Die RLS-Policies, zu denen das `rls` Ihrer Tabellen kompiliert wird |
| `search.sql` | Die Volltextsuch-Funktionen und generierten Spalten für Tabellen mit einem `search`-Block |
| `vector.sql` | pgvector-Extensions und ANN-Indizes |
| `triggers.sql` | `rebase.set_updated_at()` und die `BEFORE UPDATE`-Trigger hinter `.onUpdateNow()` |

Atlas verwaltet nur die erste Datei und sonst nichts; `db push` und die Schema-Sicherstellung
beim Booten wenden die anderen vier daher selbst an. Ein **Migration-only**-Deployment — eines,
das `db migrate` und niemals `db push` ausführt — muss diese vier Dateien manuell in eine
Migration einbinden; `db generate` weist darauf hin, wenn eine Änderung für Atlas unsichtbar ist.

Bei einem Projekt, das diese Dateien unter einem früheren Release in `drizzle/` committet hatte, werden
diese Kopien beim ersten Durchlauf gelöscht. Der Befehl benennt jede einzelne Datei, damit Sie
die Löschung committen können. Es werden nur Dateien gelöscht, die mit dem Header des
Generators beginnen. Eine selbst geschriebene Datei bleibt erhalten, ebenso wie `drizzle/migrations/`.

:::note[Das Bearbeiten einer Sicherheitsregel benennt ihre Policy um]
Eine Regel ohne expliziten `name` kompiliert zu `<table>_<op>_<hash>`, wobei der Hash die Semantik der Regel abdeckt — das *Bearbeiten* einer Regel (anstelle des Hinzufügens) erzeugt also eine Policy unter einem neuen Namen und lässt die alte zurück.

Das war früher äußerst heikel: Da Postgres `PERMISSIVE`-Policies per ODER verknüpft, gewährte ein abgelöstes `USING (rebase.uid() IS NOT NULL)` weiterhin vollen Zugriff, ganz gleich, wie restriktiv der Ersatz war. Das Verschärfen einer Regel zeigte keine Wirkung, und der Push meldete dennoch Erfolg.

`db push` gleicht dies nun ab: Es löscht generierte Policies, die zu keiner Regel mehr passen, und meldet — ohne sie zu löschen — alle individuell benannten Policies, die Ihre Tabellen nicht beschreiben, da diese nicht von bewusst geschriebenem SQL unterschieden werden können.

Um eine Datenbank zu prüfen, die vor Einführung dieser Funktion gepusht wurde, führen Sie `rebase doctor --policies` aus. Dies funktioniert als CI-Gate: Es schlägt bei Abweichungen fehl (Exit-Code ungleich null) sowie dann, wenn die Prüfung überhaupt nicht durchgeführt werden konnte — keine `DATABASE_URL`, ein nicht auflösbarer `--schema-dir`-Pfad oder fehlende Leserechte der CI-Rolle auf `pg_policies`. Ein Gate, das nicht prüfen konnte, gilt als nicht bestanden.

`doctor` und `db push` unterscheiden zwischen den beiden Arten verwaister Einträge. Eine Policy mit generiertem Namen wurde abgelöst und wird beim nächsten Push gelöscht. Jeder andere Name wurde manuell oder durch ein anderes Tool erstellt und ist weiterhin in Kraft: Beschreiben Sie ihn im `rls` der entsprechenden Tabelle, um ihn beizubehalten (die RLS-Ansicht des Studios importiert ihn), oder entfernen Sie ihn mit `rebase db push --prune-policies`, falls er veraltet ist.
:::

:::caution
`db push` ändert die Datenbank direkt. Verwenden Sie diesen Befehl nur in der Entwicklung. Nutzen Sie für die Produktion `db generate` + `db migrate`, um überprüfbare Migrationsdateien zu erstellen.
:::

### `rebase db generate`

Generieren Sie SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

**Was er tut:**
- Vergleicht das Drizzle-Schema mit dem Zustand, den die Migrationen in `drizzle/migrations/` aufbauen, nicht mit Ihrer Datenbank
- Erzeugt mit Zeitstempeln versehene SQL-Migrationsdateien in `backend/drizzle/migrations/`
- Dateien können überprüft, bearbeitet und in die Versionskontrolle committet werden
- Benennt jedes
  Statement in der neuen Migration, das Daten zerstört, unter Verwendung derselben Prüfung, die `db push`
  vor dem Anwenden ausführt: eine gelöschte Tabelle, Spalte, ein gelöschtes Schema, ein gelöschter View oder Typ, ein
  `TRUNCATE`, eine Spaltentypänderung, die Werte verlieren kann, eine Primärschlüsseländerung
  oder das Löschen eines CHECK- oder EXCLUDE-Constraints, das die Datenbank enthält. Die Datei
  wird dennoch geschrieben und der Prozess beendet mit 0, es wird also gewarnt, aber nicht abgebrochen.
- Schließt mit Hinweisen zum
  weiteren Vorgehen ab: `rebase db migrate` und für die erste Migration eines Projekts
  die Angabe `--baseline <version>`, die eine bereits per Boot initialisierte Datenbank stattdessen benötigt. Eine
  spätere Migration erhält keine Baseline-Zeile, da eine destruktive Migration mit gesetzter Baseline
  ihr `DROP` überspringen würde; ein Durchlauf, der keine Migration schreibt, gibt lediglich dies an.

**Ein CHECK, den eine Ihrer Migrationen hinzugefügt hat, wird von der nächsten verworfen.** `db generate`
vergleicht Ihre Migrationsdateien, nicht die Datenbank, und Atlas hat keine Möglichkeit, ein
Objekt von diesem Diff auszunehmen. Ein CHECK- oder EXCLUDE-Constraint, den Sie manuell in eine
Migration geschrieben haben und den keine Tabelle deklarieren kann, kehrt daher in der nächsten
geschriebenen Migration als `ALTER TABLE … DROP CONSTRAINT …` zurück – zusammengefasst im selben
Statement wie die eigentliche Änderung. Der obige Bericht benennt diesen Drop, wenn die
Datenbank das Constraint bereits enthält; er entfernt ihn jedoch nicht aus der Datei.
Löschen Sie die Klausel vor `rebase db migrate` oder lassen Sie
`rebase db migrate --refuse-destructive` daran stoppen. `db push` liest die
Datenbank und behält das Constraint bei.

Die generierten Migrationen sind reine SQL-Dateien — Sie können sie vor dem Anwenden einsehen und anpassen.

### `rebase db migrate`

Führen Sie alle ausstehenden Migrationen aus:

```bash
rebase db migrate
```

**Was er tut:**
- Durchsucht `drizzle/migrations/` nach noch nicht angewendeten Migrationen
- Wendet diese der Reihe nach auf die Datenbank an
- Protokolliert, welche Migrationen bereits angewendet wurden
- Versieht die
  Row-Level-Security-Policies mit einem Stempel, wie es auch `db push` und der Server-Boot tun,
  sodass der erste Start nach einer Migration sie unberührt lässt, anstatt jede einzelne
  neu zu erstellen. Da eine Migration auf Basis des damaligen Tabellenstands geschrieben wurde, wird
  eine Policy nur dann gestempelt, wenn sie exakt dem entspricht, was ihre Regel heute erzeugt: migrate erstellt sie
  unter anderem Namen erneut aus ihrer Regel in einer Transaktion, die zurückgerollt wird,
  und vergleicht das von Postgres Gespeicherte (genau wie `db push --dry-run`). Eine Policy, die
  abweicht, erhält keinen Stempel, und der nächste Boot wendet ihre Tabelle erneut an

`--refuse-destructive`
veranlasst den Befehl stattdessen abzubrechen. Er führt die ausstehenden Migrationen zunächst als Dry-Run aus. Zerstört
irgendein Statement Daten (anhand derselben Prüfung, die auch `db push` und `db generate` nutzen),
listet er diese Statements auf und beendet mit Exit-Code 1. Es wird nichts angewendet, nicht einmal
die Dateien vor diesem Statement. Ohne das Flag verhält sich `db migrate` wie bisher und
wendet jede ausstehende Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht diese zuerst, weshalb dieses Flag
auch eine solche Migration ablehnt. Prüfen Sie die ausgegebene Liste und führen Sie `rebase db migrate`
anschließend ohne das Flag aus, um sie anzuwenden.

#### Baseline-Erstellung für eine Datenbank, die Rebase bereits gestartet hat

Jeder Rebase-Boot stellt das Schema sicher, und `rebase db push` wendet es direkt an. Eine Datenbank, auf der jemals eines von beiden ausgeführt wurde, enthält daher bereits die Tabellen und Typen, die die erste Migration erstellen würde, und `rebase db migrate` bricht mit `pq: type "posts_status" already exists (42710)` ab.

Mit der Migration ist alles in Ordnung — die Datenbank wurde lediglich auf anderem Wege bereitgestellt. Erfassen Sie den aktuellen Stand und migrieren Sie anschließend normal weiter:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version entspricht dem numerischen Präfix der Migrationsdatei, die den Zustand beschreibt, der *jetzt* in der Datenbank existiert. Diese Migration und alle vorherigen werden als angewendet markiert; alle nachfolgenden werden regulär ausgeführt. Bei einer Datenbank, gegen die noch nie ein Boot-Vorgang lief, ist keine Baseline erforderlich — migrieren Sie direkt.

Dasselbe geschieht später im regulären Ablauf: Bearbeiten Sie eine Tabelle, während `rebase dev` läuft, fügt der Boot-Vorgang die Spalte hinzu, bevor `rebase db generate` die Migration schreibt, die sie hinzufügt. Folglich stoppt `rebase db migrate` mit `column … already exists (42701)`. Erstellen Sie für diese Migration auf dieselbe Weise eine Baseline. `--baseline` funktioniert auf einer Datenbank, die bereits Migrationen aufzeichnet: Es markiert mittels `atlas migrate set` alles bis zu dieser Version als angewendet und bestätigt dies, bzw. meldet, dass nichts zu erfassen ist, wenn die Historie diesen Stand bereits umfasst. Eine Version, die in keiner Datei unter `drizzle/migrations` vorkommt, wird vor jeglicher Ausführung unter Nennung der vorhandenen Versionen abgelehnt.

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

Jeder Branch ist eine vollständige Kopie der Datenbank, die mittels `CREATE DATABASE ... TEMPLATE`
erstellt wird; er erfordert daher einen echten PostgreSQL-Server und belegt denselben Speicherplatz wie seine Quelle.

### `rebase doctor`

Erkennen Sie Drei-Wege-Drift zwischen Ihren Tabellen, dem generierten Drizzle-Schema und der aktiven PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was geprüft wird:**
- Tabellen ↔ Generiertes Schema — Sind sie synchron?
- Generiertes Schema ↔ Datenbank — Gibt es nicht angewendete Änderungen?
- Tabellen ↔ Datenbank — Gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer sich etwas nicht synchron anfühlt. Er zeigt genau an, wo die Unstimmigkeit liegt.

Der Datenbankvergleich beinhaltet denselben Abgleich, den der Boot-Vorgang durchführt, bevor er warnt, dass `schema.generated.ts` und die Datenbank nicht übereinstimmen (ausgeführt über denselben Code). Jeder Unterschied, vor dem der Boot-Vorgang warnt, ist somit auch im Bericht enthalten, mit exakt demselben Wortlaut: eine Spalte, die auf der einen Seite NOT NULL und auf der anderen nullable ist, sowie eine Spalte, die in der Datenbank noch existiert, in der Datei jedoch nicht mehr (der Boot-Vorgang löscht niemals Spalten; eine umbenannte Property lässt also ihre alte Spalte zurück). Jeder dieser Fälle ist eine Warnung, und als Behebung wird `rebase db push` vorgeschlagen.

Der Datenbankvergleich liest die Projektdatenbank ein, aufgelöst auf dieselbe Weise, wie `rebase db url` sie auflöst — bei einem frischen Scaffold ist dies die verwaltete Datenbank, die `doctor` startet. Kann keine Datenbank ermittelt werden, wird diese Phase als **übersprungen** gemeldet statt als bestanden, und der Durchlauf schließt niemals mit „All schemas are in sync“ ab — eine Prüfung, die nicht stattgefunden hat, ist kein Nachweis für Fehlerfreiheit.

Außerdem wird jede Tabelle ohne [`search`-Block](/docs/backend/search) aufgeführt, die mehr als etwa 10.000 Zeilen enthält. Eine Suche dort — über das Suchfeld des Admins, `.search()`, `?searchString=` — wird als `ILIKE '%term%'` über die Textspalten ausgeführt, was kein Index bedienen kann. Jeder Suchvorgang liest daher die gesamte Tabelle, und die Zählung liest sie erneut (etwa eine Drittel Sekunde bei 100.000 Zeilen, mit der Tabelle wachsend). Die Zeilenzahl ist Postgres' eigene Schätzung, die Prüfung scannt also nichts. Es handelt sich um einen Hinweis: Er ändert den Exit-Code nicht und es wird nichts automatisch für Sie indiziert.

Er benennt **verwaiste Zwischentabellen (Junctions)**: eine Tabelle in `public`, die wie eine Many-to-Many-Zwischentabelle aufgebaut ist, von keiner Tabelle jedoch deklariert wird. Die Struktur besteht aus zwei Spalten, die zusammen den Primärschlüssel bilden und jeweils ein Fremdschlüssel zu einer deklarierten Tabelle sind. Das Umbenennen oder Entfernen eines `manyToMany` hinterlässt seine alte Zwischentabelle, da Push und Boot Tabellen nur erstellen und jede Verknüpfungszeile noch darin enthalten ist. Dieser Hinweis dient nur der Information und ändert den Exit-Code nicht. Die Behebung ist das `DROP TABLE`-Statement, das `doctor` anzeigt, aber niemals selbst ausführt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes SDK aus Ihren Tabellen:

```bash
rebase generate-sdk
```

**Was er tut:**
- Liest die Tabellen ein, die `backend/schema/index.ts` exportiert, und zwar über den Loader, mit dem das Backend startet, sodass das SDK exakt die bereitgestellten Tabellen beschreibt; ein Schema, das nicht kompiliert, bricht den Vorgang ab
- Generiert TypeScript-Typen für jede Tabelle in `generated/sdk/`
- Erzeugt eine Datei `database.types.ts` zur Verwendung mit `createRebaseClient<Database>()`: den `Database`-Typ, `TableName` (die Union aller Slugs) und `tablesDictionary` / `TablesDictionary` (das Mapping vom Accessor zum Slug)

`rebase dev` führt dies beim Start sowie bei jedem Speichern unter
`backend/schema/` automatisch für Sie aus. Führen Sie es selbst in der CI aus, in einem Repository,
das keine eigenen Tabellen enthält (siehe `--from` unten), oder überall dort, wo `rebase dev` nicht läuft.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema` oder der Schlüssel `tables` in `rebase.json`); relative Pfade werden von dort aufgelöst, wo Sie den Befehl ausführen |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Liest das Schema von einem laufenden Projekt anstelle des lokalen Quellcodes. `link` verwendet das mit diesem Checkout verknüpfte Projekt. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |
| `--register` | Typisiert auch serverseitige Daten: Schreibt die Typen und eine `Register`-Deklaration nach `backend/generated/` und vermerkt dies in `rebase.json` — siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data/) |

Mit `--from` kann ein Repository, das keine Tabellen enthält — ein separates
Frontend, eine zweite Web-App, eine mobile App —, einen typisierten Client aus dem
Projekt generieren, mit dem es kommuniziert: Es liest die `tables` von
`/api/meta/contract` des laufenden Backends. `REBASE_SERVICE_KEY` wird nur an das Projekt
gesendet, mit dem dieser Checkout verknüpft ist; übergeben Sie `--token` für jeden anderen Host explizit. Der Schlüssel
in `.env` gehört zu Ihrem lokalen Backend und wird niemals übertragen.
Wird der Zugriff verweigert, gibt die Meldung Aufschluss über die Ursache: ein abgelehnter `--token`,
ein abgelehnter Shell-Key, ein gegenüber einem nicht verknüpften Host zurückgehaltener Schlüssel,
ein Schlüssel, der nur in `.env` existiert, oder gar kein Schlüssel.

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
eines Feldes ist sein Spaltenschlüssel, und die API verwendet durchgehend camelCase: Die Introspektion
schreibt eine Spalte `created_at` als `createdAt: col.timestamp({ withTimezone: true })`, deren SQL-Name
das snake_case des Schlüssels ist, und liefert sie als `row.createdAt` aus. Die Spalte
selbst bleibt unberührt. Der Tabellen-*Accessor* wird auf dieselbe Weise
in einen Eigenschaftsnamen umgewandelt (`my-notes` → `client.data.myNotes`), worauf `tablesDictionary`
wieder auf den Slug zurückverweist.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` verschiebt `config/collections` nach
`backend/schema` (ein `defineTable` pro Collection, jede Spalte explizit an
ihrer ursprünglichen Position in Drizzle-Schreibweise sowie `index.ts` mit
`defaultRls`) und `frontend/src/cms` (ein `customizeTable` pro angepasster
Collection, `defineFirestoreCollection`-Dateien, `ui-config.json`), schreibt
`backend/resources.ts`, `backend/storage.ts` und `backend/generated/register.ts`,
fügt `rebaseBackendGuard()` zur `vite.config.ts` eines Scaffolds hinzu und führt anschließend
`rebase migrate sdk-calls` aus. Letzteres schreibt `.collection(` zu `.table(` um,
übernimmt die weiteren SDK-Umbenennungen sowie die Regelquellen `existsIn` / `membership` in Ihrem Code
und verschiebt die Importe von Namen, die mit 0.31 in ein anderes Paket gewandert sind
([die Liste](/docs/upgrading/0-30-to-0-31-imports/)), wobei das Paket zu den
Abhängigkeiten des Importeurs hinzugefügt wird („Dependencies added“: führen Sie `pnpm install` aus). Heben Sie alle `@rebasepro`-Pakete auf Version 0.31 an, bevor Sie dies ausführen.
Jeder Durchlauf liest das Ergebnis gegen: Das generierte SQL — DDL, Policies, Suche,
Vektor, Trigger, Views, das Drizzle-Schema — muss Byte für Byte identisch sein, andernfalls
wird jede Datei zurückgesetzt. Was nicht übertragen werden kann, wird unter Angabe von Datei und Zeile abgelehnt,
und was Ihnen überlassen bleibt, wird als nummerierte manuelle Schritte ausgegeben, endend mit
`rebase skills install`, falls das Projekt Agent Skills enthält. Eigene Module in
`config/` bleiben erhalten; der Durchlauf gibt die `git rm`-Befehlszeile für das aus, was ersetzt wurde. Er
berücksichtigt auch Firestore-Collections, die von einer Funktion erzeugt werden, Pfad-Aliase, ein außerhalb
von `App.tsx` eingebundenes Panel und jede ungeschützte statische App ([die vollständige Liste](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Nach dem `git rm` meldet `--check` den Status `already-migrated`.

| Flag | Auswirkung |
|---|---|
| `--dry-run` | Dateien, Ablehnungen, Hinweise und manuelle Schritte ausgeben; nichts schreiben. Beginnen Sie hier. |
| `--check` | Bei einem migrierten Projekt: Nachweisen, dass `backend/schema` noch dasselbe SQL generiert. Beendet mit Exit 1 bei Diffs oder wenn eine Regel ihre Bedeutung ändert. |
| `--accept-rule-changes` | Zusammen mit `--check`: Die Regeln unter „Review before deploying“ wurden überprüft. |
| `--json` / `--force` / `--skip-sdk-calls` | Der Bericht als JSON (mit `ruleChanges`); auf einem unsauberen Arbeitsverzeichnis oder über bearbeitetem Output ausführen; Ihren Code unberührt lassen. |

Prüfen Sie zwei Listen in der SDK-Ausgabe: **„Rewritten by name — review“** (untypisierte
Empfänger, Daten-Slots, Test-Doubles) und **„Left unchanged — check each“**
(benennen Sie jene um, die das SDK betreffen; [eine Suche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) findet den Rest).

Die SQL-Prüfung belegt die Korrektheit der Konvertierung, nicht jedoch, dass eine Regel noch dasselbe
bedeutet wie zuvor. Der letzte Abschnitt der Ausgabe, **„Review before deploying: these rules
change meaning“**, listet jede Regel auf, deren Policy nun andere Berechtigungen gewährt
— ein einfaches `access: "authenticated"` gewährte früher nichts und lässt nun jeden angemeldeten
Aufrufer zu ([die vier Ausprägungen](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Prüfen Sie anschließend gegen Ihre Datenbank: `rebase db push --dry-run` sollte „No
changes: the database already matches these tables.“ ausgeben und
`rebase doctor --policies` keinerlei Drift melden.

## Entwicklungs-Workflow

Der iterative Schnelldurchlauf für die Entwicklung:

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
| Schema-Datei aktualisiert sich nicht | Prüfen Sie, ob der Pfad `--schema-dir` (oder der Schlüssel `tables` in `rebase.json`) auf das richtige Verzeichnis verweist |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |
| Eine Migration darf in CI oder Produktion keine Daten löschen | `rebase db migrate --refuse-destructive` beendet mit Exit-Code 1 und wendet nichts an, wenn ein ausstehendes Statement Daten zerstört |
| `db migrate` schlägt mit `already exists (42710)` fehl | Boot oder `db push` haben das Schema bereits bereitgestellt — erfassen Sie es mit `rebase db migrate --baseline <version>` |
| `db migrate` schlägt mit `column … already exists (42701)` fehl | `rebase dev` hat die Spalte beim Booten hinzugefügt — setzen Sie für diese Migration auf dieselbe Weise eine Baseline |
| `db push` auf der verwalteten Datenbank schlägt mit `Error: EOF` fehl | Atlas hat eine Verbindung verloren, die das laufende `rebase dev` hält. Führen Sie es erneut aus; schlägt es weiterhin fehl, stoppen Sie zuerst `rebase dev` |

## Nächste Schritte

- **[Tabellen](/docs/schema/)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Nutzen Sie das generierte SDK
