---
sourceHash: 06945ca1e787897f
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle ORM-Schemas aus den Tabellen in backend/schema, erstellen Sie SQL-Migrationen, introspektieren Sie eine bestehende Datenbank in defineTable-Dateien und halten Sie Ihre Datenbank mit der Rebase CLI synchron.
---

## Übersicht

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der die Tabellen, die Sie mit
`defineTable` in `backend/schema/` deklarieren, die einzige Quelle der Wahrheit (Single Source of Truth) sind. Die CLI
transformiert sie über eine deterministische Pipeline:

```
Tabellen (backend/schema) → Drizzle-Schema → SQL-Migrationen → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Tabellen → Drizzle-Schema

Die Tabellen, die `backend/schema/index.ts` exportiert, beschreiben Spalten, Typen, Relationen,
Enums und Row-Level Security. Jeder nachfolgende Befehl liest sie über denselben Loader,
mit dem das Backend startet. Ein Schema, das nicht kompiliert — eine Tabelle ohne
`rls`, `"inherit"` ohne `defaultRls`, ein `defineTable`, das der Index nicht
exportiert —, bricht den Befehl mit einem `SchemaDefinitionError` ab, der jedes Problem benennt,
und es wird nichts geschrieben. Der Befehl `schema generate` gibt daraus eine Drizzle ORM-Schemadatei
aus.

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für ein Projekt,
das seine Tabellen an einem anderen Ort aufbewahrt; der Standardwert ist `backend/schema` oder der
Schlüssel `tables` der Backend-App in `rebase.json`. Das Flag `--collections` / `-c` aus Versionen
vor 0.31 wird mit einer Meldung abgelehnt, die auf das Codemod verweist
([`rebase migrate collections-to-tables`](#rebase-migrate)), ebenso wie ein
Projekt, das noch `config/collections` enthält.

### 2. Drizzle-Schema → Migrationen

Aus dem generierten Drizzle-Schema ermittelt `db generate` die Differenz zu den bereits in `backend/drizzle/migrations/` vorhandenen Migrationen, die auf einer Scratch-Datenbank wiederholt abgespielt werden, und erzeugt mit Zeitstempeln versehene SQL-Migrationsdateien. Es liest niemals Ihre Datenbank: Eine Spalte, die der Boot-Vorgang oder `db push` bereits hinzugefügt hat, wird weiterhin als `ADD COLUMN` ausgegeben.

### 3. Migrationen → PostgreSQL

Der Befehl `db migrate` wendet ausstehende Migrationen auf Ihre PostgreSQL-Datenbank an.

## Befehle

### `rebase schema generate`

Generieren Sie eine Drizzle ORM-Schemadatei aus Ihren Tabellen:

```bash
rebase schema generate
```

**Was der Befehl tut:**
- Liest die von `backend/schema/index.ts` exportierten Tabellen
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema`); relative Pfade werden von dem Ort aufgelöst, an dem Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden von dem Ort aufgelöst, an dem Sie den Befehl ausführen |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich — bearbeiten Sie eine Tabellendatei, und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Prüfen Sie, ob das generierte Schema noch mit den Tabellen übereinstimmt:

```bash
rebase schema stale          # Bericht erstellen und mit Exit-Code 1 beenden, falls etwas veraltet ist
rebase schema stale --fix    # Stattdessen die Datei neu generieren
```

**Was der Befehl tut:**
- Rendert das, was die Tabellen in `backend/schema/` generieren, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied — eine fehlende Tabelle, eine Spalte mit geändertem Typ, ein entferntes Enum-Label oder Fremdschlüssel, die so benannt sind, wie es ein früheres Release abgeleitet hat — und beendet sich mit einem Exit-Code ungleich null
- Mit `--fix` wird die Datei neu generiert, anstatt nur einen Bericht auszugeben

`rebase dev` hält die Datei von selbst aktuell; dieser Befehl dient also der Überprüfung im Build-
oder CI-Schritt. Er akzeptiert `--schema-dir` und `--output` genau wie `rebase schema generate`.

### `rebase schema reconcile`

Lockern und verwerfen Sie, was der Boot-Vorgang nicht bereinigt, nachdem Sie den Plan geprüft haben:

```bash
rebase schema reconcile                         # NOT NULL für Spalten lockern, die als nullable definiert oder entfernt wurden
rebase schema reconcile --drop voice_cache.wav  # und eine Spalte verwerfen, die von keiner Tabelle deklariert wird
```

**Was der Befehl tut:**
- Bittet das laufende Backend, einen Plan gegen seine eigene Datenbank zu erstellen. Das ist die Datenbank, auf die `.env` und der Cloud-Link zeigen; es funktioniert also auch auf Rebase Cloud, wo sonst nichts die Datenbank erreicht.
- Plant `DROP NOT NULL` für jede Spalte, die eine Tabelle als nullable deklariert, die Datenbank aber noch zwingend erfordert.
- Listet jede Spalte auf, die von keiner Tabelle deklariert wird. Eine Spalte, die `NOT NULL` ohne Standardwert ist, blockiert jedes Einfügen; daher wird sie ebenfalls gelockert, während ihre Daten erhalten bleiben. Es werden nur die Spalten gelöscht, die Sie mit `--drop <table>.<column>` angeben, und es wird angezeigt, wie viele Zeilen in jeder Spalte einen Wert enthalten.
- Wird angewendet, sobald Sie `yes` eingeben. Der Server führt den Plan nur basierend auf dem Digest des Plans aus, den Sie geprüft haben. Wenn sich die Datenbank oder die Tabellen in der Zwischenzeit geändert haben, verweigert er die Ausführung und Sie müssen erneut prüfen. `--yes` überspringt die Abfrage.

Der Boot-Vorgang fügt immer nur hinzu. Wenn Sie also eine Spalte aus ihrer `defineTable` entfernen, bleibt ihre Spalte in der Datenbank samt Daten erhalten. Eine `NOT NULL`-Spalte ohne Standardwert führt dann dazu, dass jedes Einfügen fehlschlägt, und das Boot-Protokoll empfiehlt diesen Befehl dafür: ohne `--drop`, um die Daten zu behalten, mit `--drop`, um die Spalte zu entfernen. Rollen Sie die Tabellenänderung zuerst aus, da Reconcile gegen das plant, was das Backend ausführt. Es erfordert `REBASE_SERVICE_KEY` in `.env`. Lokal deckt `rebase db push` denselben Vorgang über seine Schranke für destruktive Änderungen ab.

### `rebase schema introspect`

Schreiben Sie `defineTable`-Dateien aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was der Befehl tut:**
- Verbindet sich mit der Datenbank dieses Projekts, die von `rebase db url` ausgegeben wird (die verwaltete Datenbank wird gestartet, falls es sich um diese handelt); `--database-url` gibt eine andere an, und `--docker` verwendet die Compose-Datenbank
- Liest jede Tabelle, Spalte, jeden Typ, Fremdschlüssel und jede Policy aus und schreibt
  `backend/schema/<table>.ts` — ein `defineTable` pro Tabelle — sowie die
  `backend/schema/index.ts`, die sie exportiert (zusammengeführt mit einem Index, der
  bereits vorhanden ist)
- Deklariert jede Spalte mit ihrem Postgres-Typ: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, ein Enum mit seinen Labels und dem echten Typnamen
  (ein `pgEnum`, wenn der Typ geteilt wird), ein Array als `<item>.array()`,
  `col.vector({ dimensions })`, Identity- und Serial-Schlüssel, Standardwerte — in der Schreibweise,
  wie Drizzle sie verwendet. Ein Typ, den kein Builder benennt, wird zu
  `col.custom({ dataType: "<sql type>" })`, was Rebase so ausliefert, wie der
  Treiber es zurückgibt; `db generate` und `db push` lehnen ihn ab, bis der Planner
  ihn verarbeiten kann
- Deklariert die Fremdschlüsselspalte, das `belongsTo` darauf und das umgekehrte
  `hasMany` auf dem Ziel; eine Verknüpfungstabelle wird zu einem `manyToMany`, deren eigene
  Spalten zum `pivot` werden
- Liest die Row-Level-Security-Policies jeder Tabelle in ihr `rls` ein: Name,
  Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die `<table>_default_*`-Policies,
  die Rebase selbst hinzufügt, werden weggelassen, sodass das nachfolgende `db push`
  jede Policy genau so wiederherstellt, wie sie war. Eine Tabelle mit aktivierter Row-Level Security
  und ohne Policy wird als `rls: "admin-only"` geschrieben
- Liest jeden Ausdruck (das `USING` einer Policy, ein CHECK, einen Spaltenstandardwert) unter
  dem `search_path`, den der Server verwendet (`public`), sodass eine Funktion im Schema `rebase`
  als `rebase.roles()` geschrieben wird
- Wandelt ein lesbares CHECK (`total >= 0`) in das `.validate()` der Spalte um und belässt das Constraint selbst in der Datenbank, wo der nachfolgende Push es beibehält. Jedes CHECK wird auch unter "Not carried over" mit seinem SQL aufgeführt: Ein Push in eine *neue* Datenbank erstellt die Validierung, nicht das Constraint
- Deklariert jeden einfachen Index (nur Spalten, btree, gin oder brin, kein Prädikat) in den `indexes` der Tabelle. Ein Index nur auf einer Fremdschlüsselspalte wird der Relation überlassen, die einen erstellt
- Übersetzt mit `--from supabase` die Konventionen von Supabase für eine Datenbank, die Sie migrieren: Ein Spaltenstandardwert von `auth.uid()` wird zu `.onCreateUser()` (der Server schreibt die ID des Aufrufers), eine Spalte, die eine Supabase-Benutzer-ID enthält (dieser Standardwert oder ein Fremdschlüssel zu `auth.users`), wird zu `col.text().userId()`, da `rebase.users.id` und `rebase.uid()` Text sind, und eine Policy `TO authenticated` / `TO anon` verliert die Rolle (eine Rebase-Datenbank hat keines von beiden) und erfordert stattdessen einen angemeldeten / nicht angemeldeten Aufrufer; eine Policy nur für `service_role` wird verworfen. Jede Änderung wird oben in der Datei der Tabelle vermerkt. Ohne das Flag bleiben diese unverändert (Rebase, das auf derselben Datenbank neben Supabase läuft, benötigt sie weiterhin), und der Durchlauf gibt an, wann sie gefunden wurden
- Endet mit dem, was **nicht** übernommen wurde: Funktionen, Trigger, Extensions, CHECKs, Indizes, die `indexes` nicht abbilden kann, Fremdschlüssel über mehrere Spalten oder in ein anderes Schema. Das SQL, das jedes davon wiederherstellt, sofern Postgres es ausgeben kann, wird in `backend/sql/_introspected-left-behind.sql` als Entwurf geschrieben: Überprüfen Sie es, machen Sie es für erneute Ausführungen sicher und benennen Sie es ohne das führende `_` um; `rebase db push` und jedes Deployment wenden es an, sobald es sich geändert hat
- Erinnert Sie daran, dass `DATABASE_URL` weiterhin die Datenbank benennt, die eingelesen wurde: Bei einer Migration ist dies die Quelle, und ein jetziges `db push` würde in diese schreiben
- Ersetzt in einem Headless-Projekt die `ai-instructions.md` des Scaffolds ("the database is the schema") durch die Backend-only-Schema-in-Code-Regeln, sofern die Datei exakt dem Stand des Scaffolds entspricht; eine bearbeitete Datei wird nicht angetastet, und der Befehl gibt an, welche ihrer Regeln nicht mehr gelten
- Schreibt das, was nicht exakt bestimmt werden konnte, in einen Kommentar oben in der Datei der Tabelle und auf das Terminal — eine geschlossene Menge von Strings in einer Textspalte, eine generierte Spalte, deren Ausdruck nicht gelesen werden konnte, ein benutzerdefinierter Typ — zusammen mit den Auswirkungen, die ein Push darauf hätte
- Liest mit `--data-inference` bis zu 100 Zeilen pro Tabelle stichprobenartig ein und schreibt gefundene Darstellungsoptionen — Titel, Icons, Boards, Sortierungen, Feldoptionen — als `customizeTable` nach `frontend/src/cms/<table>.tsx`, sofern das Frontend des Projekts von `@rebasepro/cms` abhängt. Ein Headless-Projekt erhält keine solchen Dateien
- Gibt bei einer Datenbank, die nicht läuft, einmalig dasselbe Banner wie `db push` aus und erstellt nichts. Das Ausgabeverzeichnis wird als absoluter Pfad ausgegeben

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Speicherort für die Tabellendateien (Standard: `backend/schema`). `--output` wurde entfernt |
| `--schema` | Das einzulesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Bereits existierende Tabellendateien überschreiben; ohne dieses Flag wird eine bestehende Datei übersprungen |
| `--database-url` | Diese Datenbank anstelle der projekteigenen einlesen |
| `--docker` | Die Compose-Datenbank einlesen und bei Bedarf starten |
| `--from supabase` | Supabase-Konventionen (`auth.uid()`-Standardwerte, `auth.users`-Fremdschlüssel, `TO anon` / `TO authenticated`) für eine Rebase-Datenbank übersetzen. Weglassen, wenn Rebase auf derselben Datenbank neben Supabase läuft |
| `--data-inference` / `--no-data-inference` | Bis zu 100 Zeilen pro Tabelle abfragen, um Formate, Constraints und Panel-Einstellungen zu erkennen, oder nur die Struktur einlesen. Ohne Angabe erfolgt eine interaktive Abfrage; ohne Terminal wird nur die Struktur eingelesen |
| `--users` | Zusätzlich `users.ts` für `rebase.users` als `defineAuthTable` schreiben, das der von Auth erstellten Tabelle entspricht. Zeigt Benutzer im Admin-Bereich als Tabelle an, zu der Spalten hinzugefügt werden können. Ohne dieses Flag werden Konten in Users & Roles von Studio verwaltet |

Dies ist nützlich bei der Einführung von Rebase auf einer bestehenden Datenbank — führen Sie zuerst Introspect
aus und bearbeiten Sie dann die generierten Tabellen. Eine Tabelle mit deaktivierter Row-Level Security wird
wie jede andere mit ihrem `rls` geschrieben; der Push schaltet RLS ein, worauf der Probelauf
hinweist. Ein Backend, das ganz ohne `backend/schema` läuft, bedient die
Datenbank stattdessen direkt — siehe [Backend only](/docs/getting-started/headless/).
Sie wechseln von Supabase? Siehe [Migration von Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Übertragen Sie Schemaänderungen direkt auf die Datenbank ohne Migrationsdateien:

```bash
rebase db push
```

**Was der Befehl tut:**
- Liest das generierte Drizzle-Schema
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Führt den Plan zuerst als Probelauf aus und stoppt vor jeder Operation, die Daten zerstört: eine
  gelöschte Tabelle, Spalte, ein Schema, View oder Typ, ein `TRUNCATE` oder eine Änderung des
  Spaltentyps, die zum Verlust von Werten führen kann (`timestamptz` → `date`, `numeric` → `integer`),
  oder eine Änderung des Primärschlüssels — `(id)` → `(id, locale)` weist jeder Zeile eine neue ID zu, sodass
  Links, Fremdschlüssel und an anderer Stelle gespeicherte IDs ihre Zeile nicht mehr finden.
  Er stoppt auch
  vor dem Löschen eines CHECK- oder EXCLUDE-Constraints, das in der Datenbank vorhanden ist: Es geht keine
  Zeile verloren, aber fortan akzeptiert die Datenbank Zeilen, die sie zuvor abgelehnt hat.
  In einem Terminal erfolgt eine Abfrage, bei der Strg-C oder Strg-D mit „Nein“ antwortet; andernfalls wird
  die Ausführung verweigert; `--allow-destructive` wendet die Änderungen dennoch an. `--yes` tut dies in
  diesem Release ebenfalls noch mit einer Deprecation-Warnung; ab dem nächsten Release genehmigt es nur noch
  Pushes, die nichts zerstören. Ein Push, der
  an dieser Stelle stoppt, löscht beim Beenden seine Scratch-Datenbank `<db>_dev_diff`
- Schaltet Row-Level Security für jede deklarierte Tabelle (einschließlich Verknüpfungstabellen) direkt nach der
  Schemaänderung und vor jedem potenziell fehlschlagenden Schritt ein. So verweigert eine neue Tabelle bei einem
  teilweise abgebrochenen Push alle Anfragen, anstatt für jeden offen zu sein
- Wendet die RLS-Policies an, zu denen das `rls` Ihrer Tabellen kompiliert wird, und **entfernt Policies, die ein früherer Push abgelöst hat**
- <span class="since-badge" data-since="0.35">Seit 0.35</span> Mit `--prune-policies` werden auch die Policies auf deklarierten Tabellen gelöscht, die von keiner Tabelle deklariert werden — diejenigen, die der Probelauf als "left in force" aufführt, wie z. B. datenbankeigene Policies, nachdem eine Tabelle auf `rls: "admin-only"` umgestellt wurde —, und zwar innerhalb der Transaktion, die die deklarierten anwendet. Der Probelauf listet jede davon unter "Planned row-level security changes" auf, und der Push schützt sie wie eine gelöschte Spalte (er fragt im Terminal nach und erfordert anderswo `--allow-destructive`): Das Löschen einer Policy ändert, wer die Zeilen lesen und schreiben darf, und eine gelöschte `RESTRICTIVE`-Policy erweitert den Zugriff. Eine Tabelle, die `backend/schema` nicht deklariert, sowie das Schema `rebase` werden niemals angetastet
- Belässt jedes
  CHECK- und EXCLUDE-Constraint auf einer deklarierten Tabelle unverändert. Eine Tabelle
  kann keines von beiden deklarieren; es handelt sich also um datenbankeigene Regeln, die manuell
  geschrieben oder von einer durch `schema introspect` übernommenen Datenbank mitgebracht wurden; um eines zu entfernen,
  löschen Sie es manuell (`ALTER TABLE … DROP CONSTRAINT …`). Von Ihnen geschriebene Trigger und Funktionen
  werden ebenfalls nicht angetastet
- Stimmt mit dem
  Namen von allem, was unverändert bleibt, exakt überein, einschließlich eines
  `.`, `[`, `]` oder `*` darin
- Erstellt jeden
  [von Rebase abgeleiteten Fremdschlüssel-Index](/docs/backend/indexes#foreign-keys-are-indexed-for-you),
  der einer bestehenden Tabelle fehlt, **bevor** die Planung beginnt, mittels
  `CREATE INDEX CONCURRENTLY`, sodass Schreibvorgänge auf die Tabelle während der Erstellung fortgesetzt werden können;
  Atlas findet ihn dann bereits vor. `--dry-run` benennt diese und baut nichts
- Versieht die angewendeten
  Policies mit Stempeln, genau wie es der Boot-Vorgang des Servers tut, sodass der erste Start nach einem
  Push sie unberührt lässt, anstatt jede einzelne neu zu erstellen
- `--dry-run`
  listet die Row-Level Security auf, die der Push ändern würde, unter "Planned
  row-level security changes": die Tabellen, für die RLS aktiviert wird, und jede
  Policy, die erstellt, ersetzt oder gelöscht wird, ermittelt nach derselben Logik,
  die auch die Schritte des Pushs anwenden. Es wird nur dann "No changes" ausgegeben, wenn sich weder das Schema noch
  die Row-Level Security ändern würden. Stimmt der Stempel einer Policy nicht mit ihrer
  Regel überein oder hat sie keinen (von `db migrate` erstellt oder manuell geschrieben), erzeugt der Probelauf
  sie erneut aus ihrer Regel unter einem anderen Namen in einer Transaktion, die zurückgerollt wird,
  und vergleicht das von Postgres Gespeicherte: Ist das Ergebnis identisch, liegt keine
  Änderung vor. Eine Regel, die `schema introspect` als SQL eingelesen hat, plant somit nichts,
  ebenso wenig wie von `db migrate` angewendete Policies. Nur Policies, die nicht verglichen werden konnten
  (z. B. wenn der Lock der Tabelle nicht innerhalb von zwei Sekunden erteilt wurde), werden separat aufgeführt. Der Push
  selbst gibt eine Zeile aus, die die Anzahl der Änderungen zählt
- Weist darauf hin, wenn ein `rebase dev` auf derselben Datenbank läuft: Da dieser neue Tabellen und Spalten direkt beim Speichern anwendet, kann "No changes" bedeuten, dass er sie bereits angewendet hat
- Zeigt jedes
  Statement, das Atlas anwendet, einmal an. Atlas verbindet sich ohne SSL mit einer Datenbank auf diesem
  Rechner (`localhost`, `127.x`, `::1`), deren URL kein `sslmode` angibt (genau wie die App), anstatt mit
  `SSL is not enabled on the server` fehlzuschlagen; eine URL, die `sslmode` angibt, oder ein anderer Host
  wird unverändert übergeben. Ein Atlas-Durchlauf,
  der vor der Planung fehlschlägt, hinterlässt keine `<db>_dev_diff`-Datenbank
- `--dry-run`
  schreibt keine projekteigenen Daten: `src/schema.generated.ts` bleibt unberührt,
  und die Kopien unter `drizzle/*.sql`, die ein älteres Release committet hat, werden benannt, nicht
  gelöscht. Nur die Eingabe des Plans wird nach `.rebase/sql/` geschrieben, was nicht committet wird
- Erstellt **keine** Migrationsdateien

**Dauer.** Fast die gesamte Zeit eines Pushs entfällt darauf, dass Atlas den Plan berechnet: Es
baut Ihr gewünschtes Schema in einer Scratch-Datenbank auf und gleicht es mit der echten
ab. Dieser Aufwand wächst schneller als die Anzahl der Tabellen — auf einem wenig ausgelasteten Laptop
dauert es etwa 0,25 s pro Plan bei 11 Tabellen, 0,9 s bei 111 und 5,5 s bei 411. Ein Push, der
nichts ändert, plant einmal; ein Push, der etwas ändert, plant zweimal (der Probelauf,
den die Schranke für destruktive Änderungen liest, gefolgt von der Anwendung). Ein Push auf einem Schema mit
400 oder mehr Tabellen dauert daher mehrere zehn Sekunden, auf einem ausgelasteten oder langsamen Rechner länger.
Diese Zeit benötigt Atlas, nicht Ihre Datenbank: Die Schritte drumherum — Generieren des
SQL, der RLS-Lock, Suche, Trigger, Policies, die Rolle — dauern bei dieser Größe
über eine einzige Verbindung zu Ihrer Datenbank nur wenige Sekunden.

**Die Dateien, die auf dem Weg generiert werden**, befinden sich alle unter `.rebase/sql/` im Backend-Verzeichnis.
`db push` und `db generate` schreiben bei jedem Durchlauf alle fünf Dateien aus Ihren Tabellen neu,
bevor sie eine davon einlesen; eine versionierte Kopie würde von nichts gelesen werden.
Das Verzeichnis enthält eine eigene `.gitignore` und wird niemals committet.

| Datei | Inhalt |
|------|-------|
| `schema.sql` | Tabellen, Spalten, Constraints und Indizes — Atlas' Soll-Zustand und der einzige, den es abgleicht |
| `policies.sql` | Die RLS-Policies, zu denen das `rls` Ihrer Tabellen kompiliert wird |
| `search.sql` | Die Volltextsuchfunktionen und generierten Spalten für Tabellen mit einem `search`-Block |
| `vector.sql` | pgvector-Extensions und ANN-Indizes |
| `triggers.sql` | `rebase.set_updated_at()` und die `BEFORE UPDATE`-Trigger hinter `.onUpdateNow()` |

Atlas verwaltet nur die erste Datei und sonst nichts; daher wenden `db push` und das Boot-Schema
die anderen vier selbst an. Ein **Migration-only**-Deployment — eines,
das `db migrate` und niemals `db push` ausführt — muss diese vier Dateien manuell in eine
Migration einbinden; `db generate` weist darauf hin, wenn eine Änderung für Atlas unsichtbar ist.

Ein Projekt, das diese Dateien unter einem früheren Release in `drizzle/` committet hat,
lässt diese Kopien beim ersten Durchlauf löschen. Der Befehl nennt jede einzelne Datei, damit Sie
die Löschung committen können. Es werden nur Dateien gelöscht, die mit dem Header des Generators
beginnen. Eine Datei, die Sie selbst geschrieben haben, bleibt erhalten, ebenso wie `drizzle/migrations/`.

:::note[Das Bearbeiten einer Sicherheitsregel benennt ihre Policy um]
Eine Regel ohne expliziten `name` kompiliert zu `<table>_<op>_<hash>`, wobei der Hash die Semantik der Regel abdeckt — das *Bearbeiten* einer Regel (im Gegensatz zum Hinzufügen einer neuen) erzeugt also eine Policy unter einem neuen Namen und lässt die alte zurück.

Das war früher von großer Bedeutung: Postgres verknüpft `PERMISSIVE`-Policies mit ODER (OR), sodass ein überholtes `USING (rebase.uid() IS NOT NULL)` weiterhin alle Rechte gewährte, ganz gleich, wie restriktiv der Ersatz war. Das Verschärfen einer Regel hatte keine Auswirkung, und der Push meldete Erfolg.

`db push` bereinigt dies nun: Es löscht generierte Policies, die zu keiner Regel mehr passen, und meldet — ohne sie zu löschen — jede benutzerdefiniert benannte Policy, die Ihre Tabellen nicht beschreiben, da diese nicht von bewusst geschriebenem SQL zu unterscheiden sind.

Um eine Datenbank zu prüfen, auf die vor dieser Änderung gepusht wurde, führen Sie `rebase doctor --policies` aus. Dies funktioniert als CI-Gate: Es beendet sich mit einem Exit-Code ungleich null bei Abweichungen sowie dann, wenn die Prüfung überhaupt nicht durchgeführt werden konnte — keine `DATABASE_URL`, ein nicht auflösbarer `--schema-dir`-Pfad oder fehlende Leserechte für `pg_policies` für die CI-Rolle. Ein Gate, das nicht prüfen konnte, gilt als nicht bestanden.

`doctor` und `db push` unterscheiden zwischen den beiden Arten verwaister Einträge. Eine Policy mit einem generierten Namen wurde abgelöst und wird beim nächsten Push gelöscht. Jeder andere Name wurde manuell oder von einem anderen Tool erstellt und bleibt in Kraft: Beschreiben Sie ihn im `rls` der jeweiligen Tabelle, um ihn zu behalten (die RLS-Ansicht von Studio importiert ihn), oder löschen Sie ihn mit `rebase db push --prune-policies`, falls er veraltet ist.
:::

:::caution
`db push` modifiziert die Datenbank direkt. Verwenden Sie diesen Befehl nur in der Entwicklung. Erstellen Sie für die Produktion überprüfbare Migrationsdateien mittels `db generate` + `db migrate`.
:::

### `rebase db generate`

Generieren Sie SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

**Was der Befehl tut:**
- Vergleicht das Drizzle-Schema mit dem Zustand, den die Migrationen in `drizzle/migrations/` aufbauen, nicht mit Ihrer Datenbank
- Erzeugt mit Zeitstempeln versehene SQL-Migrationsdateien in `backend/drizzle/migrations/`
- Dateien können überprüft, bearbeitet und in die Versionsverwaltung committet werden
- Nennt jedes
  Statement in der neuen Migration, das Daten zerstört, unter Verwendung derselben Prüfung, die `db push`
  vor der Ausführung vornimmt: eine gelöschte Tabelle, Spalte, ein Schema, View oder Typ, ein
  `TRUNCATE`, eine Spaltentypänderung mit möglichem Datenverlust, eine Primärschlüsseländerung
  oder das Löschen eines CHECK- oder EXCLUDE-Constraints, das die Datenbank enthält. Die Datei
  wird dennoch geschrieben und der Befehl beendet sich mit Exit-Code 0; es wird also gewarnt und nicht abgebrochen.
- Schließt mit Hinweisen zu den
  nächsten Schritten ab: `rebase db migrate` und für die erste Migration eines Projekts
  der Hinweis auf `--baseline <version>`, den eine bereits durch den Boot-Vorgang vorbereitete Datenbank stattdessen benötigt. Eine
  spätere Migration erhält keine Baseline-Zeile, da ein destruktiver baselined Schritt sein `DROP`
  überspringen würde. Ein Durchlauf, der keine Migration schreibt, gibt nur dies aus.

**Ein CHECK, das eine Ihrer Migrationen hinzugefügt hat, wird von der nächsten gelöscht.** `db generate`
ermittelt das Diff anhand Ihrer Migrationsdateien, nicht anhand der Datenbank, und Atlas hat keine Möglichkeit, ein
Objekt von diesem Diff auszunehmen. Ein CHECK- oder EXCLUDE-Constraint, das Sie manuell in eine
Migration geschrieben haben und das keine Tabelle deklarieren kann, taucht in der nächsten generierten Migration als
`ALTER TABLE … DROP CONSTRAINT …` auf, zusammengefasst in
demselben Statement wie die eigentliche Änderung. Der obige Bericht benennt diesen Drop, wenn
die Datenbank das Constraint bereits enthält; er entfernt ihn jedoch nicht aus der
Datei. Löschen Sie die Klausel vor `rebase db migrate` oder lassen Sie
`rebase db migrate --refuse-destructive` daran stoppen. `db push` liest die
Datenbank und behält das Constraint bei.

Die generierten Migrationen sind reine SQL-Dateien — Sie können sie vor dem Anwenden prüfen und modifizieren.

### `rebase db migrate`

Führen Sie alle ausstehenden Migrationen aus:

```bash
rebase db migrate
```

**Was der Befehl tut:**
- Liest `drizzle/migrations/` auf nicht angewendete Migrationen aus
- Wendet sie der Reihe nach auf die Datenbank an
- Protokolliert, welche Migrationen bereits angewendet wurden
- Versieht die
  Row-Level-Security-Policies mit Stempeln, genau wie `db push` und der Boot-Vorgang des Servers,
  sodass der erste Start nach einer Migration sie unberührt lässt, anstatt jede einzelne neu zu
  erstellen. Eine Migration wurde aus den Tabellen ihrer damaligen Zeit geschrieben; daher wird eine Policy
  nur dann gestempelt, wenn sie exakt dem entspricht, was ihre Regel heute ergibt: Migrate erzeugt sie
  erneut aus ihrer Regel unter einem anderen Namen in einer Transaktion, die zurückgerollt wird, und
  vergleicht das von Postgres Gespeicherte (wie bei `db push --dry-run`). Eine abweichende
  Policy erhält keinen Stempel, und der nächste Boot-Vorgang wendet ihre Tabelle erneut an

`--refuse-destructive`
führt stattdessen zu einem Abbruch. Es führt die ausstehenden Migrationen zunächst als Probelauf aus. Falls ein
Statement Daten zerstört (nach derselben Prüfung, die `db push` und `db generate` verwenden),
listet es diese Statements auf und beendet sich mit 1. Es wird nichts angewendet, nicht einmal die Dateien
vor diesem Statement. Ohne das Flag verhält sich `db migrate` wie bisher und
wendet jede ausstehende Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht diese zuerst; daher verweigert dieses Flag
auch diese Migration. Prüfen Sie die ausgegebene Liste und führen Sie dann `rebase db migrate`
ohne das Flag aus, um sie anzuwenden.

#### Baselining einer Datenbank, die Rebase bereits gestartet hat

Jeder Start von Rebase stellt das Schema sicher, und `rebase db push` wendet es direkt an. Eine Datenbank, auf der jemals eines von beiden ausgeführt wurde, enthält daher bereits die Tabellen und Typen, die die erste Migration erstellen würde, und `rebase db migrate` stoppt mit der Meldung `pq: type "posts_status" already exists (42710)`.

Mit der Migration ist alles in Ordnung — die Datenbank wurde lediglich auf anderem Wege bereitgestellt. Erfassen Sie den aktuellen Stand und migrieren Sie anschließend wie gewohnt:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version ist das numerische Präfix der Migrationsdatei, die beschreibt, was sich *jetzt* in der Datenbank befindet. Diese Migration und alles davor werden als angewendet markiert; alles danach wird regulär ausgeführt. Bei einer Datenbank, gegen die noch nie ein Boot-Vorgang ausgeführt wurde, ist keine Baseline erforderlich — migrieren Sie direkt.

Dasselbe geschieht später im gewöhnlichen Workflow: Bearbeiten Sie eine Tabelle, während `rebase dev` läuft, fügt der Boot-Vorgang die Spalte hinzu, bevor `rebase db generate` die Migration schreibt, die sie hinzufügt. Folglich stoppt `rebase db migrate` mit `column … already exists (42701)`. Erstellen Sie für diese Migration auf dieselbe Weise eine Baseline. `--baseline` funktioniert auf einer Datenbank, die bereits Migrationen aufzeichnet: Es markiert mittels `atlas migrate set` alles bis zu dieser Version als angewendet und meldet dies, oder teilt mit, dass es nichts aufzuzeichnen gibt, wenn die Historie diese Version bereits umfasst. Eine Version, die in keiner Datei in `drizzle/migrations` vorkommt, wird vor der Ausführung abgelehnt, unter Nennung der vorhandenen Versionen.

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
sind neu. `create`, `list`, `info` und `delete` wurden in Version 0.17 eingeführt.

Jeder Branch ist eine vollständige Kopie der Datenbank, die mit `CREATE DATABASE ... TEMPLATE`
erstellt wird; er erfordert daher einen echten PostgreSQL-Server und belegt denselben Speicherplatz wie die Quelle.

### `rebase doctor`

Erkennen Sie dreiseitige Abweichungen (Drift) zwischen Ihren Tabellen, dem generierten Drizzle-Schema und der aktiven PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was geprüft wird:**
- Tabellen ↔ Generiertes Schema — sind sie synchron?
- Generiertes Schema ↔ Datenbank — gibt es nicht angewendete Änderungen?
- Tabellen ↔ Datenbank — gibt es unerwartete Abweichungen?

Führen Sie `doctor` aus, wann immer etwas nicht synchron erscheint. Der Befehl zeigt genau auf, wo die Diskrepanz liegt.

Der Datenbankvergleich beinhaltet denselben Abgleich, den auch der Boot-Vorgang vornimmt, bevor er warnt, dass `schema.generated.ts` und die Datenbank nicht übereinstimmen, ausgeführt über denselben Code. Jeder Unterschied, vor dem der Boot-Vorgang warnt, findet sich daher auch im Bericht wieder, im selben Wortlaut: eine Spalte, die auf einer Seite NOT NULL und auf der anderen nullable ist, sowie eine Spalte, die in der Datenbank noch vorhanden ist, in der Datei jedoch nicht (der Boot-Vorgang löscht niemals eine Spalte; eine umbenannte Eigenschaft lässt also ihre alte Spalte zurück). Jeder dieser Fälle ist eine Warnung, und die Lösung verweist auf `rebase db push`.

Der Datenbankvergleich liest die Projektdatenbank ein, aufgelöst nach der Logik von `rebase db url` — bei einem neuen Scaffold die verwaltete Datenbank, die von `doctor` gestartet wird. Kann keine Datenbank aufgelöst werden, wird diese Phase als **übersprungen** (skipped) gemeldet, anstatt als bestanden gewertet zu werden, und der Durchlauf endet nie mit "All schemas are in sync" — eine nicht durchgeführte Prüfung ist kein Beleg für Fehlerfreiheit.

Der Befehl nennt außerdem jede Tabelle ohne [`search`-Block](/docs/backend/search), die mehr als etwa 10.000 Zeilen enthält. Eine Suche dort — über das Suchfeld des Admins, `.search()`, `?searchString=` — wird als `ILIKE '%term%'` über die Textspalten ausgeführt, was kein Index bedienen kann. Jede Suche liest daher die gesamte Tabelle, und der Count-Befehl liest sie erneut (etwa ein Drittel einer Sekunde bei 100.000 Zeilen, mit der Tabellengröße wachsend). Die Zeilenzahl ist eine Schätzung von Postgres selbst, sodass die Prüfung keine Scans durchführt. Es handelt sich um einen Hinweis: Er ändert den Exit-Code nicht und es wird nichts automatisch indiziert.

Er meldet eine **verwaiste Verknüpfungstabelle (orphaned junction)**: eine `public`-Tabelle mit der Struktur einer Many-to-Many-Verknüpfung, die von keiner Tabelle deklariert wird. Die Struktur besteht aus zwei Spalten, die zusammen den Primärschlüssel bilden, jeweils ein Fremdschlüssel zu einer deklarierten Tabelle. Das Umbenennen oder Entfernen eines `manyToMany` hinterlässt seine alte Verknüpfungstabelle, da Push und Boot Tabellen immer nur erstellen, und jede Verknüpfungszeile befindet sich weiterhin darin. Dieser Hinweis dient nur der Information und ändert den Exit-Code nicht. Die Lösung ist das `DROP TABLE`-Statement, das `doctor` anzeigt, aber niemals selbst ausführt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes SDK aus Ihren Tabellen:

```bash
rebase generate-sdk
```

**Was der Befehl tut:**
- Liest die von `backend/schema/index.ts` exportierten Tabellen über denselben Loader ein, mit dem das Backend startet, sodass das SDK exakt die bereitgestellten Tabellen beschreibt; ein Schema, das nicht kompiliert, bricht den Vorgang ab
- Generiert TypeScript-Typen für jede Tabelle in `generated/sdk/`
- Erzeugt eine Datei `database.types.ts` zur Verwendung mit `createRebaseClient<Database>()`: den Typ `Database`, `TableName` (die Union aller Slugs) und `tablesDictionary` / `TablesDictionary`, das Mapping vom Accessor zum Slug

`rebase dev` führt diesen Schritt beim Start und bei jedem Speichern unter
`backend/schema/` automatisch für Sie aus. Führen Sie ihn selbst in der CI aus, in einem Repository, das keine
eigenen Tabellen enthält (siehe `--from` unten), oder überall dort, wo `rebase dev` nicht läuft.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--schema-dir` | Das Schema-Verzeichnis (Standard: `backend/schema` oder der Schlüssel `tables` in `rebase.json`); relative Pfade werden von dem Ort aufgelöst, an dem Sie den Befehl ausführen |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Liest das Schema aus einem laufenden Projekt statt aus lokalen Quelldateien. `link` verwendet das verknüpfte Projekt dieses Checkouts. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |
| `--register` | Server-seitige Daten ebenfalls typisieren: Schreibt die Typen und eine `Register`-Deklaration nach `backend/generated/` und vermerkt dies in `rebase.json` — siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data/) |

`--from` ermöglicht es einem Repository, das keine Tabellen enthält — z. B. einem separaten
Frontend, einer zweiten Web-App, einer mobilen App —, einen typisierten Client aus dem
Projekt zu generieren, mit dem es kommuniziert: Es liest die `tables` vom Endpunkt
`/api/meta/contract` des laufenden Backends. `REBASE_SERVICE_KEY` wird nur an das Projekt gesendet,
mit dem dieser Checkout verknüpft ist; übergeben Sie `--token` explizit für jeden anderen Host. Der Schlüssel in
`.env` gehört zu Ihrem lokalen Backend und wird niemals übertragen.
Eine Ablehnung gibt Aufschluss darüber,
welcher Fall vorlag: ein abgelehnter `--token`, ein abgelehnter Shell-Schlüssel, ein für einen nicht verknüpften Host
zurückgehaltener Schlüssel, ein Schlüssel, der nur in `.env` existiert, oder gar kein Schlüssel.

**Verwendung nach der Generierung:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Vollständige Typsicherheit und Autovervollständigung
const { data } = await client.data.products.find();
```

Feldnamen in den generierten Typen entsprechen denen, die die API bereitstellt. Der Wire-Name
eines Feldes ist sein Spaltenschlüssel, und die API verwendet durchgehend camelCase: Die Introspektion
schreibt eine Spalte `created_at` als `createdAt: col.timestamp({ withTimezone: true })`, deren SQL-Name
die Snake_Case-Variante des Schlüssels ist, und liefert sie als `row.createdAt` aus. Die Spalte
selbst bleibt unberührt. Der *Accessor* der Tabelle wird auf dieselbe Weise
in einen Eigenschaftsnamen umgewandelt (`my-notes` → `client.data.myNotes`), den `tablesDictionary`
wieder auf den Slug zurückführt.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` verschiebt `config/collections` nach
`backend/schema` (ein `defineTable` pro Collection, jede Spalte explizit an
ihrer ursprünglichen Position in der Drizzle-Schreibweise und `index.ts` mit
`defaultRls`) und `frontend/src/cms` (ein `customizeTable` pro angepasster
Collection, `defineFirestoreCollection`-Dateien, `ui-config.json`), schreibt
`backend/resources.ts`, `backend/storage.ts` und `backend/generated/register.ts`,
fügt `rebaseBackendGuard()` zur `vite.config.ts` eines Scaffolds hinzu und führt anschließend
`rebase migrate sdk-calls` aus, was `.collection(` in `.table(`, die
weiteren SDK-Umbenennungen und die Regelquellen `existsIn` / `membership` in Ihrem Code umschreibt,
die Importe von Namen verschiebt, die in Version 0.31 in ein anderes Paket gewandert sind
([die Liste](/docs/upgrading/0-30-to-0-31-imports/)), und das Paket zu den
Abhängigkeiten des Importeurs hinzufügt ("Dependencies added": führen Sie `pnpm install` aus). Aktualisieren Sie jedes `@rebasepro`-Paket auf Version 0.31, bevor Sie den Befehl ausführen.
Jeder Durchlauf liest das Ergebnis gegen: Das generierte SQL — DDL, Policies, Suche,
Vektoren, Trigger, Views, das Drizzle-Schema — muss bytegenau identisch sein, andernfalls wird jede
Datei zurückgesetzt. Was nicht übernommen werden kann, wird unter Angabe von Datei und Zeile abgelehnt, und
was Ihnen überlassen bleibt, wird in nummerierten manuellen Schritten ausgegeben, endend mit
`rebase skills install`, falls das Projekt Agent Skills enthält. Ihre eigenen Module in
`config/` bleiben erhalten; der Durchlauf gibt die `git rm`-Zeile für das Ersetzte aus. Er
folgt auch Firestore-Collections, die von einer Funktion erstellt werden, Pfad-Aliases, einem außerhalb
von `App.tsx` eingebundenen Panel und jeder ungeschützten statischen App ([die vollständige Liste](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Nach dem `git rm` meldet `--check` den Status `already-migrated`.

| Flag | Wirkung |
|---|---|
| `--dry-run` | Dateien, Ablehnungen, Notizen und manuelle Schritte ausgeben; nichts schreiben. Beginnen Sie hier. |
| `--check` | Auf einem migrierten Projekt: Nachweisen, dass `backend/schema` noch dasselbe SQL rendert. Beendet sich mit 1 bei Diffs oder wenn eine Regel ihre Bedeutung ändert. |
| `--accept-rule-changes` | Zusammen mit `--check`: Bestätigt, dass die Regeln unter "Review before deploying" geprüft wurden. |
| `--json` / `--force` / `--skip-sdk-calls` | Bericht als JSON (mit `ruleChanges`); auf einem unsauberen Git-Tree oder über bearbeiteter Ausgabe ausführen; Ihren Code unverändert lassen. |

Prüfen Sie zwei Listen in der SDK-Ausgabe: **"Rewritten by name — review"** (untypisierte
Empfänger, Daten-Slots, Test-Doubles) und **"Left unchanged — check each"**
(benennen Sie diejenigen um, die das SDK betreffen; [eine Suche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) findet den Rest).

Die SQL-Prüfung belegt die Korrektheit der Konvertierung, nicht jedoch, dass eine Regel noch dasselbe
bedeutet wie zuvor. Der letzte Abschnitt der Ausgabe, **"Review before deploying: these rules
change meaning"**, listet jede Regel auf, deren Policy nun andere Berechtigungen erteilt
— ein einfaches `access: "authenticated"` gewährte früher nichts und lässt nun jeden angemeldeten
Aufrufer zu ([die vier Ausprägungen](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Prüfen Sie anschließend gegen Ihre Datenbank: `rebase db push --dry-run` sollte "No
changes: the database already matches these tables." ausgeben und
`rebase doctor --policies` keine Abweichungen anzeigen.

## Entwicklungs-Workflow

Der schnelle Iterations-Workflow für die Entwicklung:

```bash
# 1. Eine Tabelle in backend/schema/ bearbeiten
# 2. Das Drizzle-Schema generieren
rebase schema generate

# 3. Direkt in die Entwicklungsdatenbank pushen
rebase db push
```

## Produktions-Workflow

Der sichere, überprüfbare Workflow für die Produktion:

```bash
# 1. Eine Tabelle in backend/schema/ bearbeiten
# 2. Das Drizzle-Schema generieren
rebase schema generate

# 3. SQL-Migrationsdateien generieren
rebase db generate

# 4. Das generierte SQL in backend/drizzle/migrations/ überprüfen
# 5. Die Migration in die Versionsverwaltung committen
git add backend/drizzle/migrations/

# 6. In der Produktion anwenden
#    Eine Datenbank, die Rebase bereits gestartet hat, benötigt beim ersten Mal eine Baseline —
#    siehe "Baselining einer Datenbank, die Rebase bereits gestartet hat" oben.
rebase db migrate
```

## Fehlerbehebung

| Symptom | Lösung |
|---------|----------|
| `Could not detect an active database plugin` | Installieren Sie `@rebasepro/server-postgres` in `backend/package.json` |
| Schemadatei aktualisiert sich nicht | Prüfen Sie, ob der Pfad `--schema-dir` (oder der Schlüssel `tables` in `rebase.json`) auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um Abweichungen zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |
| Eine Migration darf in CI oder Produktion keine Daten löschen | `rebase db migrate --refuse-destructive` beendet sich mit 1 und wendet nichts an, wenn ein ausstehendes Statement Daten zerstört |
| `db migrate` schlägt mit `already exists (42710)` fehl | Der Boot-Vorgang oder `db push` hat das Schema bereits bereitgestellt — erfassen Sie dies mit `rebase db migrate --baseline <version>` |
| `db migrate` schlägt mit `column … already exists (42701)` fehl | `rebase dev` hat die Spalte beim Start hinzugefügt — setzen Sie für diese Migration auf dieselbe Weise eine Baseline |
| `db push` auf der verwalteten Datenbank schlägt mit `Error: EOF` fehl | Atlas hat eine Verbindung verloren, die das laufende `rebase dev` hält. Führen Sie den Befehl erneut aus; falls der Fehler bestehen bleibt, stoppen Sie zuerst `rebase dev` |

## Nächste Schritte

- **[Tabellen](/docs/schema/)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
