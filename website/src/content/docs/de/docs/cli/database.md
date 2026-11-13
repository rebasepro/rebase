---
sourceHash: 6d4d1426d30011ff
title: Datenbankbefehle
sidebar_label: Datenbankbefehle
description: Die rebase db-Befehle — push, generate und migrate, Backups und Wiederherstellungen, Abrufen einer Kopie, der Verbindungs-String, die verwaltete Entwicklungsdatenbank und Branches.
---

## Übersicht

`rebase db` ist die Befehlsfamilie, die auf die Datenbank des Projekts zugreift. Jeder
Befehl arbeitet auf der Datenbank, die das Projekt auflöst, in der Reihenfolge, die unter
[Database Branching](/docs/backend/branching/#cli-integration) aufgeführt ist:
`--database-url`, dann `DATABASE_URL` in der Shell, der Branch, zu dem das Checkout
gewechselt ist, `DATABASE_URL` in `.env`, `--docker` und andernfalls die verwaltete
Entwicklungsdatenbank, die `rebase dev` startet. `rebase db url` gibt aus, um welche es
sich handelt.

`request-role` und `provision` sind für eine Datenbank gedacht, die Rebase nicht vollständig gehört;
siehe [Ausführen auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).
`push`, `generate` und `migrate` werden unter
[Schema-Generierung](/docs/cli/schema/) ausführlich beschrieben, und alle anderen Befehle finden sich in der
[CLI-Referenz](/docs/cli/).

## Befehle

### `rebase db push`

Schemaänderungen direkt auf die Datenbank übertragen (nur Entwicklung):

```bash
rebase db push
```

`--database-url <url>` benennt die Datenbank und `--docker` die Compose-Datenbank, die bei Bedarf
gestartet wird. `generate`, `migrate`, `branch`, `backup` und `restore` akzeptieren ebenfalls beides.

Es lässt unberührt, was deine Tabellendeklarationen nicht beschreiben: andere Tabellen und
Views, selbst geschriebene Indizes sowie die CHECK- und EXCLUDE-Constraints auf einer deklarierten
Tabelle, die eine Deklaration nicht ausdrücken kann. Siehe
[`rebase db push`](/docs/cli/schema/#rebase-db-push) für Details darüber, was angewendet wird und
wovor gestoppt wird.

:::caution
`db push` ändert die Datenbank direkt ohne Migrationsdateien. Verwende `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

SQL-Migrationsdateien aus Schemaänderungen generieren:

```bash
rebase db generate
```

Erstellt mit einem Zeitstempel versehene Migrationsdateien in `backend/drizzle/migrations/`, die überprüft und committet werden können.

### `rebase db migrate`

Ausstehende Datenbankmigrationen ausführen:

```bash
rebase db migrate
```

Wendet alle noch nicht angewendeten Migrationen auf die Datenbank an.

Auf einer Datenbank, die bereits gestartet wurde (booted), erstellt die erste Migration Tabellen,
die der Boot-Vorgang bereits angelegt hat, sodass das erste `db migrate` dort mit `already exists`
abbricht. Erfasse diese Migration stattdessen einmalig als angewendet:

```bash
rebase db migrate --baseline <version>
```

Die Version ist das numerische Präfix der Migrationsdatei; `db generate` gibt den
Befehl mit bereits ausgefüllter Version aus. Siehe
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) für eine Datenbank, die bereits
Migrationen erfasst.

Danach wendet `db migrate` an, was der Boot-Vorgang nicht angewendet hat – und auf einer von
`rebase dev` bereitgestellten Datenbank ist das weniger, als es scheint. Der Boot-Vorgang fügt jede neue Tabelle,
Spalte und jeden neuen Enum-Wert hinzu, sobald sich die Deklaration einer Tabelle ändert. Bis
`db generate` die Migration schreibt, die eine Spalte hinzufügt, existiert die Spalte also bereits:
Jenes `db migrate` bricht erneut mit `already exists` ab und nennt das
`--baseline <version>`, das sie erfasst. Jede neue Eigenschaft bedeutet eine weitere
Baseline. Erfasse eine Migration nur dann, wenn der Boot-Vorgang jede darin enthaltene Änderung vorgenommen hat.
Eine Migration, die auch etwas löscht (drop), umbenennt oder einschränkt, enthält Anweisungen, die der Boot-Vorgang
niemals ausführt, und das Erfassen würde diese überspringen. In der Entwicklung ist `rebase db push` der Befehl,
der das Schema ändert; behalte `db generate` und `db migrate` für eine Datenbank vor, die der Boot-Vorgang
noch nicht verändert hat.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und fragt, da es destruktiv ist,
im Terminal nach einem eingegebenen `yes` oder akzeptiert `--yes`; ohne Terminal und ohne
`--yes` verweigert es die Ausführung und weist darauf hin, das Flag zu übergeben.
In eine Datenbank,
die bereits das enthält, was das Backup erstellt, erfordert `restore` die Option `--clean`. Ohne
diese verweigert es die Ausführung, bevor irgendetwas angewendet wird (einschließlich der Cluster-Rollen),
und nennt die im Weg stehenden Objekte sowie beide Auswege darum herum: `--clean` oder
`--create-db --target-db <neuer Name>`.
Mit `--clean`
ist die Wiederherstellung eine einzige Transaktion: Es löscht die Schemas des Backups mit allem,
was darin enthalten ist, stellt wieder her und committet erst, wenn die gesamte Wiederherstellung
erfolgreich war, sodass ein Fehler die Datenbank im vorherigen Zustand belässt. Vor der Bestätigungsabfrage
listet es auf, was es löscht, das nicht im Backup enthalten ist. Es führt `psql` aus, das mit `pg_restore` mitgeliefert wird.
`restore` verweigert
die verwaltete Entwicklungsdatenbank: Ein Backup transportiert seine Zeilen als COPY-Daten,
die diese nicht empfangen kann.
Stelle die Daten in Postgres in Docker wieder her (`rebase db restore <dump> --docker --clean --yes`),
danach kopiert `rebase db pull --from "$(rebase db url --docker)" --yes` sie in
die verwaltete Datenbank. Ein Backup der verwalteten Datenbank belässt sie unverändert.
Relative Pfade
und der Standardpfad `./backups` werden relativ zu dem Verzeichnis aufgelöst, aus dem du `rebase`
ausführst, sodass die drei oben genannten Zeilen in einem Verzeichnis zusammentreffen; eine Option, die ein Befehl
nicht unterstützt, wird abgewiesen, bevor irgendetwas ausgeführt wird.
Der Dump und seine Rollendatei sind nur für dich lesbar (0600), und
gegen eine nicht laufende Datenbank geben `backup` und `restore` dasselbe
Banner aus wie `db push`.
Zeitplanung, die Rollendatei, die mit jedem Dump transportiert wird, und das Wiederherstellungsverfahren werden unter [Backups und Wiederherstellung](/docs/deployment/backups/) beschrieben.

### `rebase db pull`

Eine andere Datenbank in die lokale Entwicklungsdatenbank kopieren:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` nimmt eine `postgres://`- oder `postgresql://`-URL entgegen oder libpqs
`host=… port=… dbname=…`-Paare, die als ein einziges Argument in Anführungszeichen gesetzt sind. Alles andere wird abgewiesen,
bevor etwas gelesen oder gestartet wird, ohne den Wert zu wiederholen.

`--anonymize` ersetzt personenbezogene Felder beim Import, sodass eine Produktionskopie
lokal bearbeitet werden kann, ohne echte Kundendaten auf ein Notebook zu übertragen. Der Abgleich
von Spalten erfolgt nach Namen und nach bestem Bemühen (Best-Effort). Eine bloße `name`-Spalte wird nur in einer
Personentabelle ersetzt: einer Tabelle namens `users`, `authors`, `customers` oder ähnlich, oder jeder
Tabelle, die auch eine E-Mail-Adressspalte enthält.
Eine Spalte unter einem Unique-Index erhält einen eindeutigen Wert pro Zeile, und der Durchlauf ist eine
einzige Transaktion: Schlägt er fehl, werden die Tabellen, die umgeschrieben worden wären, geleert und
benannt, und der Befehl wird mit Statuscode 1 beendet.

Ein Flag, das `pull`
nicht unterstützt, wird abgewiesen, bevor etwas gelesen oder kopiert wird, wobei das wahrscheinlich
beabsichtigte Flag vorgeschlagen wird: `--anonymise` antwortet mit „did you mean --anonymize?“ und
beendet mit Statuscode 1.
Bei `pull` und bei jedem anderen Befehl liest ein Schalter, dem ein Wert übergeben wird, diesen aus:
`--anonymize=true` oder `=1` schaltet ihn ein, `--anonymize=false` oder `=0` lässt ihn aus,
und jeder andere Wert wird abgewiesen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle, aber ohne die
dahinterliegenden Berechtigungen ankommen würde — jeder Lesevorgang als `rebase_user` würde mit
`permission denied` fehlschlagen. Der Pull richtet die App-Rolle anschließend neu ein, unter
Verwendung derselben Routine, die auch der Boot-Vorgang und `rebase db push` verwenden, sodass die internen Tabellen von Rebase
wie vorgesehen entzogen (revoked) bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
ausgewählt werden: `--database-url` wird abgewiesen statt akzeptiert, sodass es keine Möglichkeit gibt,
versehentlich einen Pull in die Produktion auszuführen („pull into production“). `--from` ist die einzige Richtung.

Ein Pull ersetzt
die Inhalte der lokalen Datenbank: Zunächst leert er jedes Schema, das er kopiert, sodass eine
Tabelle, die nur lokal existiert, diesen Vorgang nicht überlebt. In die verwaltete Entwicklungsdatenbank
gelangen die Zeilen als `INSERT`-Anweisungen, die sie dort akzeptiert, wo `COPY`
sie stoppen würde.

### `rebase db url`

Gibt den Verbindungs-String aus, den dieses Projekt verwendet, und sonst nichts, sodass er
über Pipes weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies erfordert: In `.env` bleibt
`DATABASE_URL` absichtlich auskommentiert, und der Port wird vom
Projektpfad abgeleitet, sodass nichts auf der Festplatte ihn explizit nennt.
Sie behält diesen
Port über ein Beenden und Starten hinweg bei, es sei denn, ein anderer Prozess hat ihn belegt. Wenn du eine eigene `DATABASE_URL`
festgelegt hast, wird diese ausgegeben — die Auflösungsreihenfolge ist dieselbe, der
jeder andere Befehl folgt. Der Befehl startet die verwaltete Datenbank, falls sie nicht
bereits läuft.

Nach
`rebase dev --docker` verwenden `db url` und die anderen Befehle diese Docker-Datenbank
(und weisen auf stderr darauf hin), bis ein `rebase dev` ohne dieses Flag ausgeführt wird. Die Auswahl wird
in `.rebase/dev-database.json` gespeichert und rangiert an derselben Stelle wie `--docker`, unterhalb jedes
Verbindungs-Strings. Ein eingegebenes `--docker`, das von einem Verbindungs-String überstimmt wird,
startet keinen Container: Eine Zeile auf stderr meldet, dass es ignoriert wurde, nennt die vorrangige Option
und erklärt, wie Docker stattdessen erreicht werden kann. Ein auf diese Weise überstimmtes `rebase dev --docker`
behält die gemerkte Auswahl bei, sodass die Befehle wieder Docker folgen, sobald der Verbindungs-String
entfernt wurde.

`rebase init`
weist jedem Projekt einen eigenen Compose-Port zu, basierend auf dem Projektpfad im Bereich 5433–5632,
und `--docker` prüft, ob der antwortende Dienst tatsächlich der `db`-Container dieses Projekts ist.
Wenn ein anderer Container oder ein Postgres außerhalb von Docker den Port belegt, bricht der Befehl ab und
nennt diesen, anstatt sich bei der Datenbank eines Drittanbieters anzumelden. Um das
Projekt zu verschieben, ändere den Host-Port des `db`-Dienstes in `docker-compose.yml` sowie
`DATABASE_URL`, falls in `.env` festgelegt.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Sie gehört zum Projekt, nicht zu dem Befehl, der sie gestartet hat; das Beenden von
`rebase dev` lässt sie daher für die anderen Befehle weiterlaufen. Nach 30 Minuten ohne
aktive Verbindung stoppt sie sich selbst, und der nächste Befehl, der sie benötigt, startet sie
wieder. `rebase dev`
weist beim Beenden darauf hin und erklärt, wie die Datenbank sofort gestoppt werden kann.

`db stop` bei laufendem
`rebase dev` meldet, dass dessen Backend die Datenbank nicht erreichen kann, bis sie
wieder da ist. Der nächste Befehl, der sie benötigt (unter anderem `rebase db url`), startet sie auf
demselben Port, und das Backend verbindet sich ohne Neustart wieder.

### `rebase db request-role migrate`

Anfragen dieser Datenbank von einer Postgres-Rolle auf eine andere migrieren:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Anfragen werden als `rebase_user` ausgeführt, es sei denn, das Projekt gibt eine andere Rolle an
(`REBASE_RLS_REQUEST_ROLE` oder `rls.requestRole`). Eine Rolle gehört zum gesamten
Cluster, daher sollten Projekte, die sich einen Cluster teilen, jeweils ihre eigene Rolle besitzen. Der erste
Boot-Vorgang bei der Bereitstellung erfasst die Rolle in der Datenbank, und ein späterer Start
mit einer anderen konfigurierten Rolle verweigert den Dienst, bis die Datenbank migriert wurde.

Der Befehl migriert von der Rolle, die die Datenbank erfasst hat, oder von `rebase_user`. In
einer einzigen Transaktion erstellt er die neue Rolle, falls sie fehlt, erlaubt der Verbindung
den Wechsel zu ihr, vergibt nur in dieser Datenbank jedes Grant neu, das die alte Rolle innehatte,
passt Policies an, die sie benennen, und erfasst die neue Rolle. Die alte Rolle wird
unverändert belassen, da eine andere Datenbank auf dem Cluster sie möglicherweise verwendet. Danach
gibt der Befehl die `REVOKE`-Anweisungen aus, die die Berechtigungen der alten Rolle hier entziehen,
um ausgeführt zu werden, sobald sie nicht mehr benötigt werden.

`--dry-run` gibt die Anweisungen und die `REVOKE`s aus und ändert nichts. Im
Terminal wird zuvor eine Bestätigung verlangt; ohne Terminal bricht der Befehl ohne `--yes` ab. Setze anschließend
`REBASE_RLS_REQUEST_ROLE` auf die neue Rolle auf jedem Server, der die
Datenbank verwendet. Siehe [Ausführen auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase db provision --print`

Das SQL ausgeben, das die Request-Rolle(n) für diese Datenbank einrichtet, damit ein
Datenbankadministrator es ausführen kann:

```bash
rebase db provision --print > request-role.sql
```

Für jede Request-Rolle werden die Anweisungen ausgegeben, die die Rolle erstellen, der
Verbindungsrolle das Recht gewähren, zu ihr zu wechseln, und ihr unter dem Standard
`grants: "schema"` Rechte für die Schemas `public` und `rebase` erteilen. Die Rollen entsprechen
`REBASE_RLS_REQUEST_ROLE`, falls gesetzt, andernfalls den Rollen, die ein Boot-Vorgang in der
Datenbank erfasst hat, andernfalls `rebase_user`. Die Erklärung ist als SQL-Kommentare verfasst, sodass
die Ausgabe direkt ausgeführt werden kann. Der Befehl liest die Verbindungsrolle aus und führt sonst nichts aus.
`--print` ist erforderlich. Kombiniere dies mit `REBASE_RLS_PROVISION_ROLE=never`, wenn Rollen
von einem DBA oder über Infrastructure-as-Code erstellt werden.

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
das übliche „irgendetwas anderes“ ist dein eigenes `rebase dev`. `create` und `delete` benennen,
was die Datenbank offen hält; `--force` trennt diese Sitzungen zuvor.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie aufgeräumt werden. `prune` entfernt
drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine
Branch-Datenbank, deren Eintrag nie geschrieben wurde, und — nur mit `--older-than` — Branches,
die ein bestimmtes Alter überschritten haben. Es fragt vor dem Löschen nach einer Bestätigung, es sei denn, `--yes` wird übergeben.
Ohne Terminal für die Abfrage, wie etwa in CI, entfernt es nichts, weist darauf hin,
`--yes` zu übergeben, und beendet mit Statuscode 1.
`list` und `info` lesen nur: Eine Datenbank, auf der kein Branch erstellt wurde, hat keine, und
sie erstellen dort kein `rebase`-Schema.

`diff` zeigt, was ein Branch gegenüber der Datenbank geändert hat, aus der er erstellt wurde:
Tabellen, Spalten, Constraints, Indizes, Trigger, RLS-Policies, Enum-Typen,
Views und Funktionen, die hinzugefügt, gelöscht oder geändert wurden, sowie pro Tabelle die Zeilen, die
eingefügt, aktualisiert und gelöscht wurden. Zeilen, die die übergeordnete Datenbank seitdem selbst geändert hat,
werden separat gezählt, und Zeilen, die von beiden geändert wurden, gelten als Konflikte. `--json` gibt das
gesamte Diff aus, mit bis zu `--sample-limit` Zeilen pro Tabelle (Standard: 100). Es liest
beide Datenbanken und ändert keine von beiden; das Mergen erfolgt in Studio — siehe
[Überprüfen und Zusammenführen eines Branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` speichert den Branch in `.rebase/branch.json` und ändert niemals `.env`. Es
hat Vorrang vor `DATABASE_URL` in `.env` und weicht `--database-url` oder einer
`DATABASE_URL` in der Shell, sodass ein Flag in der Befehlszeile immer Vorrang vor einem
zuvor vorgenommenen Wechsel hat. `delete` verweigert den Branch, auf dem du dich gerade befindest, da jeder Befehl
im Checkout (einschließlich des Löschens) darauf ausgerichtet ist: Führe zuerst `switch --off` aus
und lösche ihn dann. Der gesamte Workflow ist unter [Database Branching](/docs/backend/branching/) beschrieben.

:::note[Auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` funktionieren hier wie auf jeder Datenbank.
`push` und `generate` planen ihre Änderungen mit Atlas, das eine zweite
leere Datenbank zum Vergleichen benötigt — und das verwaltete PGlite stellt genau eine bereit. Daher
startet jeder dieser Befehle auf der verwalteten Datenbank ein zweites, temporäres PGlite im Arbeitsspeicher
für Atlas und stoppt es, sobald der Befehl beendet ist. Auf diese Weise wird dort eine Spalte gelöscht,
umbenannt oder eingeschränkt: `rebase dev` fügt immer nur hinzu. Die Schutzschranke für destruktive Änderungen ist dieselbe
wie überall. Um Atlas stattdessen gegen eine eigene leere Datenbank planen zu lassen,
setze `REBASE_ATLAS_DEV_URL` darauf; Rebase erstellt oder löscht keine
so benannte Datenbank.

`branch` wird dort abgewiesen. `CREATE DATABASE ... TEMPLATE`
erzeugt unter PGlite lediglich einen Katalogeintrag und kopiert nichts, sodass der Branch auf
die Datenbank verweisen würde, von der er geklont wurde — jeder Schreibvorgang, den du isolieren
wolltest, würde in deiner Entwicklungsdatenbank landen. `rebase dev --docker` stellt einen echten
Server bereit, mit dem Branches funktionieren.
:::

## Verwandte Themen

- [CLI-Referenz](/docs/cli/) — alle anderen `rebase`-Befehle
- [Schema-Generierung](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` und `db branch` im Detail
- [Backups und Wiederherstellung](/docs/deployment/backups/) — Zeitplanung, die Rollendatei, Wiederherstellung
- [Database Branching](/docs/backend/branching/) — wie ein Branch erstellt wird und was er an Ressourcen kostet
- [Ausführen auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/) — die Request-Rolle, ihre Einstellungen und `rebase doctor --database`
- [Skripte und die Konsole](/docs/backend/scripts/) — dieselbe Datenbank über ein Skript oder eine REPL
