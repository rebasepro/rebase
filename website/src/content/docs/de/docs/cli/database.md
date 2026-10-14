---
sourceHash: 20ed1243d65e4ebe
title: Datenbank-Befehle
sidebar_label: Datenbank-Befehle
description: Die rebase-db-Befehle — push, generate und migrate, Backups und Wiederherstellungen, eine Kopie ziehen, der Verbindungsstring, die verwaltete Entwicklungsdatenbank und Branches.
---

## Übersicht

`rebase db` ist die Familie der Befehle, die die Datenbank des Projekts erreichen. Jeder
arbeitet auf der Datenbank, die das Projekt auflöst, in der Reihenfolge, die
[Datenbank-Branching](/docs/backend/branching/#cli-integration) aufführt: `--database-url`,
dann `DATABASE_URL` in der Shell, der Branch, zu dem der Checkout gewechselt hat,
`DATABASE_URL` in `.env`, `--docker` und andernfalls die verwaltete Entwicklungsdatenbank,
die `rebase dev` startet. `rebase db url` gibt aus, welche das ist.

`push`, `generate` und `migrate` werden ausführlich unter
[Schema-Generierung](/docs/cli/schema/) beschrieben, und jeder andere Befehl steht in der
[CLI-Referenz](/docs/cli/).

## Befehle

### `rebase db push`

Überträgt Schema-Änderungen direkt in die Datenbank (nur für die Entwicklung):

```bash
rebase db push
```

`--database-url <url>` benennt die Datenbank und `--docker` die aus Compose, die bei Bedarf
gestartet wird. `generate`, `migrate`, `branch`, `backup` und `restore` nehmen ebenfalls beides entgegen.

Er lässt in Ruhe, was Ihre Collections nicht beschreiben: andere Tabellen und Views, Indizes, die
Sie geschrieben haben, und die CHECK- und EXCLUDE-Constraints auf der Tabelle einer Collection,
die eine Collection nicht deklarieren kann. Was er anwendet und wovor er anhält, steht unter
[`rebase db push`](/docs/cli/schema/#rebase-db-push).

:::caution
`db push` modifiziert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

Generiert SQL-Migrationsdateien aus Schema-Änderungen:

```bash
rebase db generate
```

Erstellt mit Zeitstempeln versehene Migrationsdateien in `drizzle/migrations/`, die überprüft und committed werden können.

### `rebase db migrate`

Führt ausstehende Datenbankmigrationen aus:

```bash
rebase db migrate
```

Wendet alle noch nicht angewendeten Migrationen auf die Datenbank an.

Auf einer Datenbank, die bereits gebootet hat, legt die erste Migration Tabellen an, die der Boot
schon angelegt hat, daher hält das erste `db migrate` dort bei `already exists` an. Verzeichnen Sie
diese Migration stattdessen einmal als angewendet:

```bash
rebase db migrate --baseline <version>
```

Die Version ist das Zahlenpräfix der Migrationsdatei; `db generate` gibt den Befehl mit
eingesetzter Version aus. Siehe
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) für eine Datenbank, die bereits Migrationen
verzeichnet.

Danach wendet `db migrate` an, was der Boot nicht angewendet hat, und auf einer Datenbank, die
`rebase dev` bedient, ist das weniger, als es scheint. Der Boot fügt jede neue Tabelle, Spalte und
jeden neuen Enum-Wert hinzu, sobald sich eine Collection ändert, sodass die Spalte bereits da ist,
wenn `db generate` die Migration schreibt, die sie hinzufügt: Dieses `db migrate` hält erneut bei
`already exists` an und nennt das `--baseline <version>`, das sie verzeichnet. Jede neue Property
bedeutet eine weitere Baseline. Verzeichnen Sie eine Migration nur, wenn der Boot jede Änderung
darin vorgenommen hat. Eine, die außerdem etwas löscht, umbenennt oder verengt, enthält Statements,
die der Boot nie ausführt, und das Verzeichnen überspringt sie. In der Entwicklung ist
`rebase db push` der Befehl, der das Schema ändert; behalten Sie `db generate` und `db migrate` für
eine Datenbank, die der Boot nicht bereits verändert hat.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und verlangt, da destruktiv,
in einem Terminal ein getipptes `yes` oder nimmt `--yes` entgegen; ohne Terminal und ohne
`--yes` verweigert es und sagt, dass es zu übergeben ist.
<span class="since-badge" data-since="0.25">Seit 0.25</span> In eine Datenbank, die bereits enthält, was das Backup anlegt,
braucht `restore` `--clean`. Ohne das Flag verweigert es, bevor irgendetwas angewendet wird, die
Cluster-Rollen eingeschlossen, und nennt die Objekte, die im Weg sind, sowie beide Wege daran
vorbei: `--clean` oder `--create-db --target-db <new name>`. Unter 0.24 wendete es die Rollen an
und scheiterte dann an `schema "rebase" already exists` von pg_restore.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Mit `--clean` ist die Wiederherstellung eine einzige
Transaktion: Sie löscht die Schemas des Backups mit allem, was darin ist, stellt wieder her und
committet erst, wenn die gesamte Wiederherstellung gelungen ist, sodass ein Fehler die Datenbank
so lässt, wie sie war. Bevor sie nachfragt, nennt sie, was sie löscht, das das Backup nicht
enthält. Sie führt `psql` aus, das mit `pg_restore` ausgeliefert wird. Unter 0.24 löschte eine
`--clean`-Wiederherstellung in eine Datenbank mit einer Tabelle, die dem Backup fehlte, etwa der
Revisionstabelle von Atlas nach `db migrate`, alles und stellte nichts wieder her.
<span class="since-badge" data-since="0.25">Seit 0.25</span> `restore` verweigert die verwaltete Entwicklungsdatenbank: Ein
Backup trägt seine Zeilen als COPY-Daten, die sie nicht empfangen kann, und unter 0.24 ließ die
Wiederherstellung sie hängen, bis sie gestoppt wurde. Stellen Sie in Postgres in Docker wieder
her (`rebase db restore <dump> --docker --clean --yes`), dann kopiert
`rebase db pull --from "$(rebase db url --docker)" --yes` sie in die verwaltete Datenbank. Ein
Backup der verwalteten Datenbank lässt sie, wie sie war; unter 0.24 blieben die Einstellungen, die
`pg_dump` vorgenommen hatte, auf ihr bestehen, und jede API-Anfrage scheiterte bis `rebase db stop`.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Relative Pfade und der Standard
`./backups` werden gegen das Verzeichnis aufgelöst, aus dem Sie `rebase` ausführen, sodass sich
die drei Zeilen oben in einem Verzeichnis treffen; eine Option, die ein Befehl nicht kennt, wird
verweigert, bevor etwas läuft. Unter 0.24 ist der Standard `backend/backups`, listen Sie ihn also
mit `--out ./backups` auf.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Der Dump und seine Rollen-Datei sind
nur für Sie lesbar (0600), und gegenüber einer Datenbank, die nicht läuft, geben `backup` und
`restore` das Banner aus, das `db push` ausgibt. Unter 0.24 sind Dumps 0644.
Planung, die Rollen-Datei, die mit jedem Dump mitreist, und das Restore-Verfahren finden Sie unter
[Backups und Wiederherstellung](/docs/deployment/backups/).

### `rebase db pull`

Kopiert eine andere Datenbank in die lokale Entwicklungsdatenbank:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Importieren, sodass eine Produktionskopie
lokal bearbeitet werden kann, ohne echte Kundendaten auf einen Laptop zu übertragen. Es gleicht
Spalten nach Namen ab und arbeitet nach bestem Bemühen. <span class="since-badge" data-since="0.25">Seit 0.25</span>
Eine Spalte unter einem Unique-Index erhält pro Zeile einen eigenen Wert, und der Durchlauf ist
eine Transaktion: Schlägt er fehl, werden die Tabellen, die er umgeschrieben hätte, geleert und
namentlich genannt, und der Befehl beendet sich mit 1. Unter 0.24 scheiterte er an `token_hash`,
sobald sich Benutzer zweimal angemeldet hatten, und ließ echte Daten zurück.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Ein Flag, das `pull` nicht kennt, wird verweigert, bevor
irgendetwas gelesen oder kopiert wird, und das vermutlich gemeinte wird genannt: `--anonymise`
antwortet mit "did you mean --anonymize?" und beendet sich mit 1. Unter 0.24 wurde ein falsch
geschriebenes Flag ignoriert, sodass `--anonymise`, `--anon` oder `--schem` den Pull ohne es
ausführten und personenbezogene Daten unverändert ankamen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle ankommen
würde, aber ohne die dahinterliegenden Grants — jeder Lesevorgang als `rebase_user` würde
mit `permission denied` fehlschlagen. Der Pull stellt die App-Rolle anschließend neu bereit,
wobei dieselbe Routine wie beim Booten und bei `rebase db push` verwendet wird, sodass die
internen Tabellen von Rebase wie vorgesehen gesperrt bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
ausgewählt werden: `--database-url` wird verweigert statt akzeptiert, sodass es keine Möglichkeit
gibt, "in die Produktion pullen" zu formulieren. `--from` ist die einzige Richtung.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Ein Pull ersetzt den Inhalt der lokalen Datenbank: Er leert
zuerst jedes Schema, das er kopiert, sodass eine Tabelle, die nur lokal existiert, ihn nicht
überlebt. In die verwaltete Entwicklungsdatenbank reisen die Zeilen als `INSERT`-Anweisungen, die
sie annimmt, wo `COPY` sie anhalten würde. Unter 0.24 schlug ein Pull in die verwaltete Datenbank
bei der ersten Tabelle fehl und ließ sie nichts mehr beantworten, bis sie beendet wurde.

### `rebase db url`

Gibt den Verbindungsstring aus, den dieses Projekt verwendet, und sonst nichts, sodass er
weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies erfordert: `.env` lässt
`DATABASE_URL` mit Absicht auskommentiert, und der Port wird aus dem Projektpfad
abgeleitet, sodass nichts auf der Festplatte ihn benennt.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Die Datenbank behält diesen Port über ein Stoppen und Starten
hinweg, es sei denn, etwas anderes hat ihn belegt; unter 0.24 wählte jeder Start einen neuen.
Wenn Sie eine eigene
`DATABASE_URL` festgelegt haben, wird genau diese ausgegeben — die Auflösungsreihenfolge ist
dieselbe, der auch jeder andere Befehl folgt. Startet die verwaltete Datenbank, falls sie
noch nicht läuft.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Nach `rebase dev --docker`
verwenden `db url` und die anderen Befehle diese Docker-Datenbank (und sagen das auf stderr),
bis ein `rebase dev` ohne das Flag läuft. Die Wahl wird in `.rebase/dev-database.json`
gespeichert und steht dort im Rang, wo `--docker` steht, unter jedem Verbindungsstring. Ein von
Ihnen getipptes `--docker`, das ein Verbindungsstring übertrumpft, startet keinen Container: Eine
Zeile auf stderr sagt, dass es ignoriert wurde, nennt, was gewonnen hat, und sagt, wie Sie
stattdessen Docker erreichen. Ein so übertrumpftes `rebase dev --docker` lässt die gespeicherte
Wahl unverändert, sodass die Befehle wieder Docker folgen, sobald der Verbindungsstring weg ist.
Unter 0.24 braucht jeder Befehl sein eigenes `--docker`, und ein
übertrumpftes startet den Container trotzdem.

<span class="since-badge" data-since="0.25">Seit 0.25</span> `rebase init` gibt jedem Projekt seinen eigenen Compose-Port,
aus 5433–5632 nach dem Pfad des Projekts, und `--docker` prüft, dass das, was darauf antwortet,
der `db`-Container dieses Projekts ist. Wenn ein anderer Container oder ein Postgres außerhalb von
Docker den Port hält, hält es an und nennt, wer ihn hält, statt sich bei der Datenbank eines
anderen anzumelden. Um das Projekt zu verlegen, ändern Sie den Host-Port des `db`-Service in
`docker-compose.yml` und `DATABASE_URL`, falls `.env` eine setzt. Unter 0.24 nahm jedes Scaffold
den ersten freien Port ab 5432, sodass nebeneinander angelegte Projekte sich einen teilen konnten.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Die Datenbank gehört dem Projekt, nicht dem Befehl, der sie gestartet hat, sodass das Beenden von
`rebase dev` sie für die anderen Befehle weiterlaufen lässt. Nach 30 Minuten ohne Verbindung
stoppt sie sich selbst, und der nächste Befehl, der sie braucht, startet sie wieder.
<span class="since-badge" data-since="0.25">Seit 0.25</span> `rebase dev` sagt das beim Beenden, zusammen damit, wie Sie die
Datenbank sofort stoppen; unter 0.24 sagte es nichts.

<span class="since-badge" data-since="0.25">Seit 0.25</span> `db stop` unter einem laufenden `rebase dev` sagt, dass dessen
Backend die Datenbank nicht erreichen kann, bis sie wieder da ist. Der nächste Befehl, der sie
braucht, etwa `rebase db url`, startet sie auf demselben Port, und das Backend verbindet sich ohne
Neustart wieder. Unter 0.24 kam sie auf einem anderen Port zurück, und das Backend antwortete mit
503, bis `rebase dev` neu gestartet wurde.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch etwas verbunden ist, und
dieses "etwas" ist üblicherweise Ihr eigenes `rebase dev`. `create` und `delete` nennen
das, was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie aufgeräumt werden.
`prune` entfernt drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde,
eine Branch-Datenbank, deren Eintrag nie geschrieben wurde, und — nur mit `--older-than` — Branches,
die älter als ein von Ihnen angegebenes Alter sind. Vor dem Entfernen wird nachgefragt, es sei denn, Sie übergeben `--yes`.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Ohne Terminal, in dem nachgefragt werden
könnte, etwa in CI, entfernt es nichts, sagt, dass `--yes` zu übergeben ist, und beendet sich mit 1;
unter 0.24 sagt es „Nothing was changed.“ und beendet sich mit 0. `list` und `info` lesen nur: Eine
Datenbank, auf der kein Branch angelegt wurde, hat keine, und sie legen dort kein `rebase`-Schema an.
Unter 0.24 legen sie das Register an.

`switch` speichert den Branch in `.rebase/branch.json` und bearbeitet `.env` niemals. Es
hat Vorrang vor `DATABASE_URL` in `.env` und unterliegt `--database-url` oder einer
`DATABASE_URL` in der Shell, sodass ein Flag in der Befehlszeile immer Vorrang vor einem
zuvor durchgeführten Wechsel hat. `delete` verweigert den Branch, auf dem Sie sich befinden, da jeder
Befehl im Checkout, das Löschen eingeschlossen, auf ihn zeigt: erst `switch --off`, dann löschen.
Den gesamten Workflow finden Sie unter [Datenbank-Branching](/docs/backend/branching/).

:::note[Auf der verwalteten Entwicklungsdatenbank]
<span class="since-badge" data-since="0.25">Seit 0.25</span> `push`, `generate` und `migrate` funktionieren hier wie auf jeder Datenbank.
`push` und `generate` planen ihre Arbeit mit Atlas, welches eine zweite
leere Datenbank zum Vergleichen benötigt — und das verwaltete PGlite stellt genau eine bereit. Auf
der verwalteten Datenbank startet daher jeder dieser Befehle ein zweites, wegwerfbares PGlite im Speicher
für Atlas und stoppt es, wenn der Befehl endet. So wird dort eine Spalte gelöscht,
umbenannt oder verengt: `rebase dev` fügt immer nur hinzu. Das Destructive-Gate ist
dasselbe wie überall. Damit Atlas stattdessen gegen eine leere Datenbank von Ihnen plant,
setzen Sie `REBASE_ATLAS_DEV_URL` darauf; Rebase legt eine so benannte Datenbank weder an noch löscht es sie.

`branch` wird dort verweigert. `CREATE DATABASE ... TEMPLATE`
auf PGlite schreibt einen Katalogeintrag und kopiert nichts, sodass der Branch auf die Datenbank
verweisen würde, von der er geklont wurde — jeder Schreibvorgang, den Sie isolieren wollten,
würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` liefert Ihnen einen echten
Server, mit dem Branches funktionieren.
:::

## Verwandte Themen

- [CLI-Referenz](/docs/cli/) — jeder andere `rebase`-Befehl
- [Schema-Generierung](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` und `db branch` im Detail
- [Backups und Wiederherstellung](/docs/deployment/backups/) — Planung, die Rollen-Datei, Wiederherstellung
- [Datenbank-Branching](/docs/backend/branching/) — wie ein Branch entsteht und was er kostet
- [Skripte und die Konsole](/docs/backend/scripts/) — dieselbe Datenbank aus einem Skript oder einer REPL
