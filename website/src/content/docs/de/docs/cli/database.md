---
sourceHash: 68cf15088ac8b29f
title: Datenbank-Befehle
sidebar_label: Datenbank-Befehle
description: Die rebase db-Befehle – push, generate und migrate, Backups und Wiederherstellungen, Abrufen einer Kopie, der Connection-String, die verwaltete Entwicklungsdatenbank und Branches.
---

## Übersicht

`rebase db` ist die Befehlsfamilie, die auf die Datenbank des Projekts zugreift. Jeder
Befehl arbeitet auf der Datenbank, die das Projekt auflöst, in der Reihenfolge,
die unter [Database Branching](/docs/backend/branching/#cli-integration) aufgeführt ist:
`--database-url`, dann `DATABASE_URL` in der Shell, der Branch, zu dem das Checkout
gewechselt ist, `DATABASE_URL` in `.env`, `--docker` und andernfalls die verwaltete
Entwicklungsdatenbank, die `rebase dev` startet. `rebase db url` gibt aus, welche
das ist.

`request-role` und `provision` sind für eine Datenbank gedacht, die Rebase nicht vollständig besitzt;
siehe [Running on an existing or shared database](/docs/deployment/existing-database/).
`push`, `generate` und `migrate` werden ausführlich unter
[Schema Generation](/docs/cli/schema/) beschrieben, und jeder weitere Befehl befindet sich in der
[CLI reference](/docs/cli/).

## Befehle

### `rebase db push`

Schema-Änderungen direkt in die Datenbank übertragen (nur Entwicklung):

```bash
rebase db push
```

`--database-url <url>` benennt die Datenbank und `--docker` die Compose-Datenbank, die
bei Bedarf gestartet wird. `generate`, `migrate`, `branch`, `backup` und `restore` akzeptieren ebenfalls beides.

Es belässt unberührt, was Ihre Tabellendeklarationen nicht beschreiben: andere Tabellen und
Views, manuell erstellte Indizes sowie CHECK- und EXCLUDE-Constraints auf einer deklarierten
Tabelle, die eine Deklaration nicht abbilden kann. Siehe
[`rebase db push`](/docs/cli/schema/#rebase-db-push) für Details dazu, was angewendet wird und
wovor der Befehl stoppt.

Das SQL, das eine Tabellendeklaration nicht ausdrücken kann (Funktionen, Trigger, CHECK-Constraints,
Grants), gehört nach `backend/sql/*.sql`. Der Push wendet diese Dateien
in alphabetischer Reihenfolge an, nach den Tabellen und Views und vor den Policies, sodass eine Policy
eine von einer Datei definierte Funktion aufrufen kann. Jede Datei wird nach Name und Hash in
`rebase.sql_files` aufgezeichnet und nur dann erneut ausgeführt, wenn sie sich ändert, jeweils in einer eigenen Transaktion:
Eine fehlschlagende Datei wird zurückgerollt und bricht den Push ab. Schreiben Sie Dateien so, dass sie
sicher erneut ausgeführt werden können (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` vor
`CREATE TRIGGER`). Eine Datei, deren Name mit `_` beginnt, ist ein Entwurf und wird nicht
angewendet. Das Löschen einer Datei macht nichts von dem rückgängig, was sie getan hat. `--dry-run` listet die Dateien auf,
die angewendet werden würden.

Ein Deploy wendet dieselben Dateien an: `rebase build` übernimmt sie in das Bundle, und
der Serverstart (Boot) führt jede neue oder geänderte Datei nach den Tabellen und Auth und
vor den Policies aus, aufgezeichnet in derselben Tabelle `rebase.sql_files`. Die Transaktion jeder Datei
fordert zuerst ein Advisory Lock an, sodass mehrere gleichzeitig startende Instanzen oder ein Push
während eines Deploys jede Datei nur einmal ausführen. Eine Datei darf bis zu 15 Minuten lang laufen. Eine Datei, die fehlschlägt, bricht den Boot ab und nennt den Dateinamen. `rebase dev` wendet sie ebenfalls beim Boot an. Eine
Anwendung, die ihr eigenes Backend baut, gibt das Verzeichnis über
`createPostgresAdapter({ sqlDir: "backend/sql" })` an. Nichts wird angewendet bei
`REBASE_PROVISION=false` oder `REBASE_MIGRATE_ON_BOOT=none`.

:::caution
`db push` modifies the database directly without migration files. Use `db generate` + `db migrate` for production.
:::

### `rebase db generate`

SQL-Migrationsdateien aus Schema-Änderungen generieren:

```bash
rebase db generate
```

Erstellt mit Zeitstempeln versehene Migrationsdateien in `backend/drizzle/migrations/`, die überprüft und committet werden können.

### `rebase db migrate`

Ausstehende Datenbankmigrationen ausführen:

```bash
rebase db migrate
```

Wendet alle noch nicht angewendeten Migrationen auf die Datenbank an.

Auf einer Datenbank, die bereits gebootet wurde, erstellt die erste Migration Tabellen, die der Boot
bereits angelegt hat. Daher stoppt das erste `db migrate` dort, bevor etwas ausgeführt wird, und
gibt die auszuführende Baseline aus. Erfassen Sie diese Migration stattdessen einmalig als angewendet:

```bash
rebase db migrate --baseline <version>
```

Die Version ist das numerische Präfix der Migrationsdatei; `db generate` gibt den
Befehl bereits mit ausgefüllter Version aus. Siehe
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) für eine Datenbank, die bereits
Migrationen erfasst.

Danach wendet `db migrate` an, was der Boot noch nicht angewendet hat – und auf einer Datenbank,
die von `rebase dev` bereitgestellt wird, ist das weniger, als es scheint. Der Boot fügt jede neue Tabelle,
Spalte und jeden Enum-Wert hinzu, sobald sich die Deklaration einer Tabelle ändert. Wenn
`db generate` also die Migration schreibt, die eine Spalte hinzufügt, ist die Spalte bereits
vorhanden: Dieses `db migrate` stoppt erneut bei `already exists` und nennt die
`--baseline <version>`, um dies zu erfassen. Jede neue Eigenschaft bedeutet eine weitere
Baseline. Erfassen Sie eine Migration nur dann, wenn der Boot jede darin enthaltene Änderung vorgenommen hat. Eine Migration,
die auch etwas löscht (drop), umbenennt oder einschränkt, enthält Anweisungen, die der Boot niemals ausführt;
das Erfassen als Baseline würde diese überspringen. In der Entwicklung ist `rebase db push` der Befehl,
der das Schema ändert; bewahren Sie `db generate` und `db migrate` für eine Datenbank auf, die der Boot
noch nicht verändert hat.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und fragt, da es destruktiv ist,
im Terminal nach der Eingabe von `yes` oder akzeptiert `--yes`; ohne Terminal und ohne
`--yes` bricht der Befehl ab mit dem Hinweis, dieses Flag zu übergeben.
Bei einer Datenbank,
die bereits enthält, was das Backup anlegt, benötigt `restore` den Parameter `--clean`. Ohne
diesen bricht der Befehl ab, bevor irgendetwas angewendet wird (einschließlich der Cluster-Rollen), und
nennt die im Weg stehenden Objekte sowie die beiden Wege darum herum: `--clean` oder
`--create-db --target-db <new name>`.
Mit `--clean`
ist die Wiederherstellung eine einzige Transaktion: Sie löscht die Schemas des Backups samt allem,
was sich darin befindet, stellt wieder her und committet erst, wenn die gesamte Wiederherstellung erfolgreich war, sodass
ein Fehler die Datenbank im vorherigen Zustand belässt. Vor der Bestätigungsfrage nennt der Befehl, was gelöscht wird,
das im Backup nicht enthalten ist. Er führt `psql` aus, das mit `pg_restore` mitgeliefert wird.
`restore` verweigert
die verwaltete Entwicklungsdatenbank: Ein Backup transportiert seine Zeilen als COPY-Daten, die
diese nicht empfangen kann.
Stellen Sie es in Postgres in Docker wieder her (`rebase db restore <dump> --docker --clean --yes`),
und kopieren Sie es anschließend mit `rebase db pull --from "$(rebase db url --docker)" --yes` in
die verwaltete Datenbank. Ein Backup der verwalteten Datenbank belässt diese unberührt.
Relative Pfade
und der Standard `./backups` werden relativ zu dem Verzeichnis aufgelöst, aus dem Sie `rebase`
ausführen, sodass die drei obigen Zeilen im selben Verzeichnis zusammenlaufen; eine Option, die ein Befehl
nicht unterstützt, wird abgelehnt, bevor irgendetwas ausgeführt wird.
Der Dump und seine Rollendatei sind nur für Sie lesbar (0600), und
bei einer Datenbank, die nicht läuft, geben `backup` und `restore` dasselbe
Banner aus wie `db push`.
Zeitplanung, die Rollendatei, die jedem Dump beiliegt, und das Wiederherstellungsverfahren finden Sie unter [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Eine andere Datenbank in die lokale Entwicklungsdatenbank kopieren:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` nimmt eine `postgres://`- oder `postgresql://`-URL oder libpqs
`host=… port=… dbname=…`-Paare als ein einziges Argument entgegen. Alles andere wird abgelehnt,
bevor etwas gelesen oder gestartet wird, ohne den Wert zu wiederholen.

`--anonymize` ersetzt personenbezogene Felder beim Import, sodass mit einer Produktionskopie
lokal gearbeitet werden kann, ohne echte Kundendaten auf ein Laptop zu übertragen. Der Abgleich
erfolgt nach Spaltennamen nach dem Best-Effort-Prinzip. Eine einfache `name`-Spalte wird nur in einer
Tabelle mit Personen ersetzt: einer Tabelle namens `users`, `authors`, `customers` oder ähnlichem, oder jeder
Tabelle, die auch eine E-Mail-Adressspalte enthält.
Eine Spalte mit einem Unique Index erhält einen eindeutigen Wert pro Zeile, und der Durchlauf ist eine
einzige Transaktion: Schlägt er fehl, werden die Tabellen, die er umgeschrieben hätte, geleert und
benannt, und der Befehl beendet sich mit 1.

Ein Flag, das `pull`
nicht unterstützt, wird abgelehnt, bevor etwas gelesen oder kopiert wird, wobei die wahrscheinlich
gemeinte Option vorgeschlagen wird: `--anonymise` antwortet mit „did you mean --anonymize?“ und
beendet sich mit 1.
Bei `pull` und bei jedem anderen Befehl liest ein Schalter, dem ein Wert übergeben wird, diesen aus:
`--anonymize=true` oder `=1` schaltet ihn ein, `--anonymize=false` oder `=0` lässt ihn aus,
und jeder andere Wert wird abgelehnt.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle,
jedoch ohne die dahinterliegenden Grants eintreffen würde – jeder Lesevorgang als `rebase_user` würde
mit `permission denied` fehlschlagen. Der Pull richtet die App-Rolle im Anschluss neu ein, wobei
dieselbe Routine verwendet wird wie beim Boot und bei `rebase db push`, sodass Rebase-interne Tabellen
wie vorgesehen entzogen bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
frei gewählt werden: `--database-url` wird abgelehnt statt akzeptiert, sodass es keine Möglichkeit gibt,
versehentlich einen „Pull in die Produktion“ auszuführen. `--from` ist die einzige Richtung.

Ein Pull ersetzt
die Inhalte der lokalen Datenbank: Er leert zunächst jedes Schema, das er kopiert, sodass eine
Tabelle, die nur lokal existiert, den Vorgang nicht überlebt. In die verwaltete Entwicklungsdatenbank
gelangen die Zeilen als `INSERT`-Anweisungen, die sie dort akzeptiert, wo `COPY`
abbrechen würde. Es wird nur ein Dump in UTF8 akzeptiert: Ein Pull aus einer Datenbank mit einer anderen
Zeichenkodierung, beispielsweise LATIN1, wird abgelehnt, bevor irgendetwas geleert wird. Ziehen Sie diese
in Postgres in Docker (`rebase db pull --docker` mit demselben `--from`) oder in ein
Postgres, das über `DATABASE_URL` angegeben wird.

### `rebase db url`

Gibt den Connection-String aus, den dieses Projekt verwendet, und sonst nichts, sodass er
per Pipe weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies benötigt: `.env` lässt
`DATABASE_URL` absichtlich auskommentiert, und der Port wird vom
Projektpfad abgeleitet, sodass nichts auf der Festplatte ihn benennt.
Sie behält diesen
Port über ein Stoppen und Starten hinweg bei, sofern er nicht anderweitig belegt wurde. Wenn Sie eine eigene
`DATABASE_URL` festgelegt haben, wird diese ausgegeben – die Auflösungsreihenfolge ist dieselbe wie
bei jedem anderen Befehl. Der Befehl startet die verwaltete Datenbank, falls sie nicht
bereits läuft.

Nach
`rebase dev --docker` verwenden `db url` und die anderen Befehle diese Docker-Datenbank
(und weisen auf stderr darauf hin), bis ein `rebase dev` ohne das Flag ausgeführt wird. Die Auswahl wird
in `.rebase/dev-database.json` gespeichert und rangiert an derselben Stelle wie `--docker`, unterhalb jedes
Connection-Strings. Ein eingegebenes `--docker`, das von einem Connection-String überstimmt wird,
startet keinen Container: Eine Zeile auf stderr meldet, dass es ignoriert wurde, nennt die vorrangige Option
und erklärt, wie Docker stattdessen erreicht werden kann. Ein auf diese Weise überstimmtes `rebase dev --docker`
behält die gespeicherte Auswahl unverändert bei, sodass die Befehle wieder Docker folgen, sobald der
Connection-String entfernt wird.

`rebase init`
weist jedem Projekt einen eigenen Compose-Port zu (von 5433–5632 basierend auf dem Projektpfad),
und `--docker` prüft, ob der antwortende Dienst der `db`-Container dieses Projekts ist.
Wenn ein anderer Container oder ein Postgres außerhalb von Docker den Port belegt, stoppt der Befehl und
benennt diesen, anstatt sich bei der Datenbank eines Fremden anzumelden. Um das Projekt
zu verschieben, ändern Sie den Host-Port des `db`-Dienstes in `docker-compose.yml` und
`DATABASE_URL`, falls `.env` diese setzt.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Sie gehört zum Projekt, nicht zu dem Befehl, der sie gestartet hat; das Stoppen von
`rebase dev` lässt sie daher für die anderen Befehle weiterlaufen. Nach 30 Minuten ohne
aktive Verbindung stoppt sie sich selbst, und der nächste Befehl, der sie benötigt, startet sie
wieder. `rebase dev`
weist beim Beenden darauf hin, zusammen mit Hinweisen, wie die Datenbank sofort gestoppt werden kann.

`db stop` bei einem
laufenden `rebase dev` meldet, dass dessen Backend die Datenbank nicht erreichen kann, bis sie
wieder verfügbar ist. Der nächste Befehl, der sie benötigt – wie etwa `rebase db url` –, startet sie auf
demselben Port, und das Backend verbindet sich ohne Neustart wieder.

### `rebase db request-role migrate`

Die Anfragen dieser Datenbank von einer Postgres-Rolle zu einer anderen migrieren:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Anfragen laufen als `rebase_user`, es sei denn, das Projekt benennt eine andere Rolle
(`REBASE_RLS_REQUEST_ROLE` oder `rls.requestRole`). Eine Rolle gehört zum gesamten
Cluster; Projekte, die sich einen Cluster teilen, sollten daher jeweils eine eigene Rolle haben. Der erste
Provisionierungs-Boot erfasst die Rolle in der Datenbank, und ein späterer Boot,
der mit einer anderen Rolle konfiguriert ist, verweigert den Start, bis die Datenbank migriert wurde.

Der Befehl migriert von der Rolle, die die Datenbank erfasst hat, oder von `rebase_user`. In
einer einzigen Transaktion erstellt er die neue Rolle, falls diese fehlt, erlaubt der Verbindung
zu ihr zu wechseln, erteilt nur in dieser Datenbank jeden Grant neu, den die alte Rolle innehatte,
biegt Policies um, die sie benennen, und zeichnet die neue Rolle auf. Die alte Rolle wird
unberührt gelassen, da eine andere Datenbank auf dem Cluster sie möglicherweise verwendet. Anschließend
gibt der Befehl die `REVOKE`-Anweisungen aus, die die Berechtigungen der alten Rolle hier entziehen,
damit sie ausgeführt werden können, sobald nichts mehr darauf angewiesen ist.

`--dry-run` gibt die Anweisungen und die `REVOKE`s aus und ändert nichts. In einem
Terminal fragt der Befehl zuerst nach; ohne Terminal verweigert er die Ausführung ohne `--yes`. Setzen Sie
anschließend `REBASE_RLS_REQUEST_ROLE` auf jedem Server, der die Datenbank verwendet, auf die neue Rolle.
Siehe [Running on an existing or shared database](/docs/deployment/existing-database/).

### `rebase db provision --print`

Das SQL ausgeben, das die Request-Rolle(n) für diese Datenbank einrichtet, damit ein
Datenbankadministrator es ausführen kann:

```bash
rebase db provision --print > request-role.sql
```

Für jede Request-Rolle gibt der Befehl die Anweisungen aus, die die Rolle erstellen, der
Verbindungsrolle das Recht geben, zu ihr zu wechseln, und ihr unter der Standardeinstellung
`grants: "schema"` Rechte für die Schemas `public` und `rebase` gewähren. Die Rollen entsprechen
`REBASE_RLS_REQUEST_ROLE`, wenn gesetzt, andernfalls denjenigen, die ein Boot in der Datenbank
aufgezeichnet hat, andernfalls `rebase_user`. Die Erklärung ist als SQL-Kommentare verfasst, sodass
die Ausgabe direkt ausgeführt werden kann. Der Befehl liest die Verbindungsrolle und führt nichts weiter aus.
`--print` ist erforderlich. Kombinieren Sie dies mit `REBASE_RLS_PROVISION_ROLE=never`, wenn Rollen
durch einen DBA oder über Infrastructure as Code erstellt werden.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch diff <name> [--json] [--sample-limit <n>]
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch eine Verbindung besteht, und
dieses „etwas anderes“ ist üblicherweise Ihr eigenes `rebase dev`. `create` und `delete` nennen
die Prozesse, die die Datenbank geöffnet halten; `--force` trennt diese Sitzungen vorher.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie aufgeräumt werden. `prune` entfernt
drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank,
deren Eintrag nie geschrieben wurde, und – nur mit `--older-than` – Branches,
die ein bestimmtes Alter überschritten haben. Es fragt vor dem Löschen nach, es sei denn, Sie übergeben `--yes`.
Ohne Terminal für Rückfragen (z. B. in CI) wird nichts entfernt, sondern zur Übergabe von
`--yes` aufgefordert und mit Exit-Code 1 beendet.
`list` und `info` lesen nur: Eine Datenbank, auf der kein Branch erstellt wurde, hat keinen, und
sie erstellen dort auch kein `rebase`-Schema.

`diff` zeigt, was ein Branch gegenüber der Datenbank geändert hat, aus der er erstellt wurde:
Hinzugefügte, gelöschte oder geänderte Tabellen, Spalten, Constraints, Indizes, Trigger, RLS-Policies, Enum-Typen,
Views und Funktionen sowie pro Tabelle die Zeilen, die
eingefügt, aktualisiert und gelöscht wurden. Zeilen, die das übergeordnete Element seitdem selbst geändert hat,
werden separat gezählt, und Zeilen, die von beiden geändert wurden, sind Konflikte. `--json` gibt das
gesamte Diff aus, mit bis zu `--sample-limit` Zeilen pro Tabelle (Standard: 100). Es liest
beide Datenbanken und ändert keine von beiden; das Zusammenführen erfolgt in Studio – siehe
[Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` speichert den Branch in `.rebase/branch.json` und verändert niemals `.env`. Es
hat Vorrang vor `DATABASE_URL` in `.env` und weicht `--database-url` oder einer
`DATABASE_URL` in der Shell, sodass ein Flag auf der Kommandozeile immer Vorrang vor einem
zuvor durchgeführten Wechsel hat. `delete` verweigert das Löschen des Branches, auf dem Sie sich gerade befinden, da jeder Befehl
im Checkout (einschließlich delete) darauf verweist: Führen Sie zuerst `switch --off` aus,
und löschen Sie ihn dann. Der gesamte Workflow ist unter [Database Branching](/docs/backend/branching/) beschrieben.

#### `rebase db branch merge`

```bash
rebase db branch merge <name> [--on-conflict abort|branch|target] [--skip-blocked] [--yes]
```

Schreibt die Zeilen, die ein Branch eingefügt, aktualisiert und gelöscht hat, in die Datenbank, aus der er erstellt wurde. Der Befehl gibt zuerst das Diff aus und fragt nach, bevor er genau dieses Diff zusammenführt: Der Merge benennt den Fingerabdruck des Diffs, sodass eine übergeordnete Datenbank, die sich seitdem geändert hat, abgewiesen statt gemergt wird. `--on-conflict` entscheidet über Zeilen, die auf beiden Seiten geändert wurden – `abort` (Standard) schreibt nichts, `branch` übernimmt die Zeile des Branches, `target` behält die der übergeordneten Datenbank – und `--skip-blocked` führt die Tabellen zusammen, bei denen dies möglich ist, und überspringt den Rest. Schema- und Policy-Änderungen werden niemals gemergt: Diese werden durch Migrationen übertragen. `delete` fragt ebenfalls vorher nach, und `--yes` bestätigt beides für Skripte.

:::note[Auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` funktionieren hier wie auf jeder anderen Datenbank.
`push` und `generate` planen ihre Änderungen mit Atlas, welches eine zweite,
leere Datenbank zum Abgleich benötigt – und das verwaltete PGlite stellt genau eine bereit. Daher
startet jeder dieser Befehle auf der verwalteten Datenbank ein zweites, temporäres PGlite im Arbeitsspeicher
für Atlas und stoppt es nach Abschluss des Befehls. Auf diese Weise wird dort eine Spalte gelöscht,
umbenannt oder eingeschränkt: `rebase dev` fügt immer nur hinzu. Die Schutzabfrage für destruktive Operationen
ist dieselbe wie überall. Damit Atlas stattdessen einen Abgleich mit einer eigenen leeren Datenbank
durchführt, setzen Sie `REBASE_ATLAS_DEV_URL` darauf; Rebase erstellt oder löscht keine auf diese
Weise benannte Datenbank.

`branch` wird dort verweigert. Ein `CREATE DATABASE ... TEMPLATE`
auf PGlite schreibt nur einen Katalogeintrag und kopiert nichts, sodass der Branch
auf die Datenbank verweisen würde, aus der er geklont wurde – jeder Schreibvorgang, den Sie isolieren wollten,
würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` stellt Ihnen einen echten
Server bereit, mit dem Branches funktionieren.
:::

## Verwandte Themen

- [CLI reference](/docs/cli/) — alle weiteren `rebase`-Befehle
- [Schema Generation](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` und `db branch` im Detail
- [Backups and restore](/docs/deployment/backups/) — Zeitplanung, die Rollendatei, Wiederherstellung
- [Database Branching](/docs/backend/branching/) — wie ein Branch erstellt wird und welche Ressourcen er beansprucht
- [Running on an existing or shared database](/docs/deployment/existing-database/) — die Request-Rolle, ihre Einstellungen und `rebase doctor --database`
- [Scripts and the Console](/docs/backend/scripts/) — dieselbe Datenbank aus einem Skript oder einer REPL
