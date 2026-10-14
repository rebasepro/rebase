---
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

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und benötigt, da destruktiv, `--yes`.
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

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle ankommen
würde, aber ohne die dahinterliegenden Grants — jeder Lesevorgang als `rebase_user` würde
mit `permission denied` fehlschlagen. Der Pull stellt die App-Rolle anschließend neu bereit,
wobei dieselbe Routine wie beim Booten und bei `rebase db push` verwendet wird, sodass die
internen Tabellen von Rebase wie vorgesehen gesperrt bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
ausgewählt werden: `--database-url` wird verweigert statt akzeptiert, sodass es keine Möglichkeit
gibt, "in die Produktion pullen" zu formulieren. `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Verbindungsstring aus, den dieses Projekt verwendet, und sonst nichts, sodass er
weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies erfordert: `.env` lässt
`DATABASE_URL` mit Absicht auskommentiert, und der Port wird aus dem Projektpfad
abgeleitet, sodass nichts auf der Festplatte ihn benennt. Wenn Sie eine eigene
`DATABASE_URL` festgelegt haben, wird genau diese ausgegeben — die Auflösungsreihenfolge ist
dieselbe, der auch jeder andere Befehl folgt. Startet die verwaltete Datenbank, falls sie
noch nicht läuft.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Nach `rebase dev --docker`
verwenden `db url` und die anderen Befehle diese Docker-Datenbank (und sagen das auf stderr),
bis ein `rebase dev` ohne das Flag läuft. Die Wahl wird in `.rebase/dev-database.json`
gespeichert und steht dort im Rang, wo `--docker` steht, unter jedem Verbindungsstring. Ein von
Ihnen getipptes `--docker`, das ein Verbindungsstring übertrumpft, startet keinen Container: Eine
Zeile auf stderr sagt, dass es ignoriert wurde, nennt, was gewonnen hat, und sagt, wie Sie
stattdessen Docker erreichen. Unter 0.24 braucht jeder Befehl sein eigenes `--docker`, und ein
übertrumpftes startet den Container trotzdem.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

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
<span class="since-badge" data-since="0.25">Seit 0.25</span> `push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, welches eine zweite
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
