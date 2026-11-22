---
sourceHash: cd3015585fe4e355
title: Backups und Wiederherstellung
sidebar_label: Backups
description: "Erstellen, planen, auflisten und wiederherstellen von Datenbank-Backups mit pg_dump – was ein Backup enthält, die begleitende Rollendatei und das Einzige, was nicht abgedeckt ist: Ihre hochgeladenen Dateien."
---

## Übersicht

Rebase sichert eine Postgres-Datenbank mit `pg_dump` und stellt sie mit
`pg_restore` wieder her. Sie können ein Backup manuell erstellen, eines über
einen Cron-Job planen, vorhandene Backups über das CLI oder das Studio-Panel
**Backups** auflisten und in eine neue Datenbank wiederherstellen, ohne die
aktive Datenbank anzurühren.

:::caution[Dies sichert Ihre Dateien nicht]
Ein Backup enthält die **Datenbank** und sonst nichts. Hochgeladene Dateien befinden sich in Ihrem
[Storage-Backend](/docs/backend/storage/) – einem S3- oder GCS-Bucket oder dem
Verzeichnis unter `STORAGE_PATH` – nicht in Postgres, sodass eine wiederhergestellte Datenbank auf Dateien verweist, die nur dieses Backend besitzt.
Sichern Sie den Bucket (Versionierung oder Replikation) oder das Upload-Verzeichnis
separat nach einem eigenen Zeitplan.
:::

## Schnellstart

```bash
# Back up to a local directory (custom format, compressed)
rebase db backup --out ./backups

# Back up straight to private object storage
rebase db backup --out s3://my-private-bucket/backups

# List what you have
rebase db backups list

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

Die Datenbank ist dieselbe, die jeder andere [`rebase db`-Befehl](/docs/cli/database/)
auflöst, und zwar in der gleichen Reihenfolge: `--database-url`, `DATABASE_URL` in der Shell, der
[Branch](/docs/backend/branching/), zu dem der Checkout gewechselt ist, `DATABASE_URL`
in `.env`, Postgres in Docker (`--docker` oder das letzte `rebase dev --docker`),
und schließlich die verwaltete Entwicklungsdatenbank, die von `restore` verweigert wird.

Ein relatives
`--out`, der Standardwert `./backups` und ein an `rebase db restore` übergebener Dump-Pfad
werden alle relativ zu dem Verzeichnis aufgelöst, aus dem Sie `rebase` ausführen (normalerweise das
Projekt-Root-Verzeichnis), sodass `rebase db backup` und `rebase db backups list` am selben Ort zusammenlaufen. Ein
relatives `BACKUP_DESTINATION` wird relativ zum Backend-Verzeichnis aufgelöst, wo auch der
Server es liest. Alle drei Befehle lehnen eine nicht unterstützte Option ab,
bevor irgendetwas ausgeführt wird, und schlagen diejenige vor, die Sie wahrscheinlich gemeint haben. Das Passwort geht
an `pg_dump`, `pg_dumpall` und `pg_restore` über `PGPASSWORD`, niemals über deren
Befehlszeile, sodass es in keiner Fehlermeldung oder Prozessliste sichtbar ist.

## Was ein Backup ist

`rebase db backup` führt `pg_dump` im benutzerdefinierten Format (`-Fc`) aus, das komprimiert
ist und selektiv wiederhergestellt werden kann. Dateien werden nach dem Schema
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump` benannt; der UTC-Zeitstempel im Namen dient der
Sortierung bei der Aufbewahrung (Retention) und Auflistung.

| Option | Beschreibung |
| --- | --- |
| `--out`, `-o` | Ein lokaler Pfad oder eine `s3://bucket/prefix`- / `gs://bucket/prefix`-URL. Standardmäßig `$BACKUP_DESTINATION`, danach `./backups` in dem Verzeichnis, aus dem Sie `rebase` ausführen. |
| `--exclude-schema <s>` | Ein Schema aus dem Dump ausschließen (wiederholbar). Ein Muster, das auf `rebase` zutrifft, wird abgelehnt – siehe unten. |
| `--no-owner` | Befehle zur Eigentümerschaft weglassen, um als eine andere Rolle wiederherzustellen. |
| `--enable-row-security` | Als Administrator-Subjekt sichern, anstatt an Row-Level Security zu scheitern. **Kann zu einem unvollständigen Dump führen** – siehe [Row-Level Security](#row-level-security-und-der-dump-der-unbemerkt-unvollständig-ist-row-level-security-and-the-dump-that-is-silently-short). |
| `--row-security-role <r>` | Die Rolle, als die mit dem obigen Flag gelesen werden soll. Standardmäßig `admin`. |

Ein Dump wird validiert, bevor der Befehl Erfolg meldet: `pg_restore --list`
muss in der Lage sein, das gesamte Archiv zu lesen.

Für `s3://`-Ziele erstellt das CLI seinen Storage-Client aus denselben
`S3_*`-Variablen, die auch Ihr Backend verwendet (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### Die Rollendatei

Jedes Backup schreibt eine zweite Datei neben den Dump:
`rebase-<db>-<…>Z.globals.sql`, erzeugt durch
`pg_dumpall --globals-only --no-role-passwords`. Ein datenbankspezifisches `pg_dump`
kann keine clusterweiten Rollen enthalten, und die Berechtigungen (Grants) und Row-Level-Security-Richtlinien
des Dumps benennen eine solche – `rebase_user`. Wird dies in ein neues Postgres ohne diese Rolle
wiederhergestellt, schlägt das erste `GRANT` an diese Rolle fehl und die Wiederherstellung bricht ab.

Behalten Sie die beiden Dateien zusammen. Das CLI lädt sie als Paar hoch und stellt sie wieder her, ein
geplantes Backup bereinigt sie gemeinsam, und `rebase db restore` sucht nach der `.globals.sql` im selben
Verzeichnis oder Prefix wie nach dem `.dump`. Rollen werden **ohne Passwörter** neu erstellt;
setzen Sie diese nach einer Wiederherstellung in einem neuen Cluster erneut. `PG_DUMPALL_PATH` verweist auf eine
bestimmte `pg_dumpall`-Binärdatei.

### Was enthalten ist

Die gesamte Datenbank, einschließlich des `rebase`-Schemas. Dieses Schema enthält alle
Benutzerkonten und die übrige Authentifizierung, API-Schlüssel, den Datensatzverlauf, die Job-Warteschlange,
Cron-Logs und die Funktionen, die von Ihren RLS-Richtlinien und Change-Capture-Triggern
aufgerufen werden. Ein Dump ohne dieses Schema enthält keine Benutzer und kann überhaupt nicht in eine leere
Datenbank wiederhergestellt werden: Die darin enthaltenen Tabellen besitzen Richtlinien, die Funktionen aufrufen,
die nicht vorhanden sind.

Daher
lehnt `rebase db backup` ein `--exclude-schema`, das gemäß den pg_dump-eigenen Mustervorschriften
auf `rebase` zutrifft (einschließlich `reb*` und `*`), ab, bevor irgendetwas ausgeführt wird.
Diese Regeln leiten reguläre Ausdrücke außerhalb von doppelten Anführungszeichen weiter, sodass
auch `[r]ebase` und `audit|rebase` abgelehnt werden; der Server wird vor der Ausführung von `pg_dump`
über jedes Muster mit derselben Regex-Engine abgefragt, die auch die interne Abfrage von `pg_dump`
verwendet.

Da sie sämtliche
Passwörter und Schlüssel-Hashes enthalten, werden ein lokaler Dump und seine `.globals.sql` so erstellt,
dass sie nur für ihren Eigentümer lesbar sind (0600), noch bevor `pg_dump` hineinschreibt;
dies gilt auch für die lokalen Dateien eines geplanten Backups.

## Geplante Backups

Ein geplantes Backup ist ein [Cron-Job](/docs/backend/cron-jobs/), der die
Datenbank sichert, das Ergebnis an `BACKUP_DESTINATION` hochlädt und alte Backups bereinigt.
Legen Sie eine Datei in `backend/crons/` ab, die einen solchen standardmäßig exportiert (Default Export):

```ts
// backend/crons/backup.ts
import { backupStorageFromEnv, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (!destination || destination.kind === "local") return undefined; // local: written to disk directly
    // The same S3_* (or application-default GCS) client the CLI and the Backups panel build.
    return backupStorageFromEnv(destination, process.env);
}

// With BACKUP_SCHEDULE unset, export a disabled job so discovery still works.
export default resolved.config
    ? createBackupCron({ ...resolved.config, storage: backupStorage() })
    : createBackupCron({
        schedule: "0 3 * * *",
        connectionString: process.env.DATABASE_URL ?? "",
        destination: { kind: "local", path: "./backups" },
        enabled: false
    });
```

Der Storage-Controller wird übergeben, anstatt aus dem Kontext des Jobs übernommen zu werden,
da `rebase.storage` des Kontexts die clientseitige Storage-API ist und kein
Controller für den Backup-Bucket.

Ein Backup ist nicht an die Upload-Limits des Controllers gebunden. `maxFileSize` (standardmäßig 50 MB)
und `allowedMimeTypes` gelten für Benutzer-Uploads; ein Dump beliebiger
Größe wird somit hochgeladen, ebenso wie ein Dump, der über den Controller geschrieben wird, der die Dateien
Ihrer App bereitstellt.

| Variable | Bedeutung |
| --- | --- |
| `BACKUP_SCHEDULE` | Cron-Ausdruck, z. B. `0 3 * * *` für täglich um 03:00 Uhr. Nicht gesetzt schaltet geplante Backups aus. |
| `BACKUP_DESTINATION` | Ein lokaler Pfad oder `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als diese Anzahl an Tagen sind. Nicht gesetzt oder `0` behält alles. |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens diese Anzahl der neuesten Backups behalten, egal wie alt – damit ein längerer Ausfall nicht alle Backups löscht. |

Jeder neue Dump wird validiert, **bevor** irgendetwas bereinigt wird, sodass ein beschädigter Dump
niemals der Grund dafür sein kann, dass Ihr letztes intaktes Backup gelöscht wurde. Die Bereinigung betrifft
nur Dateien, deren Namen dem Backup-Muster entsprechen; alles andere im selben
Bucket oder Prefix bleibt unberührt.

Der Cron führt `pg_dump` innerhalb des Serverprozesses aus. Das offizielle
Runtime-Image (`rebasepro/server`, siehe [Self-Hosting](/docs/deployment/self-hosting/))
liefert die PostgreSQL 18-Client-Tools dafür mit.
Überall sonst – auf einem VPS, in Ihrem eigenen Image –
installieren Sie die Client-Tools selbst (siehe nächster Abschnitt).

## Versionskompatibilität

`pg_dump` und `pg_restore` müssen **dieselbe Hauptversion (Major Version) wie der Server oder
neuer** sein. `rebase db backup` und `rebase db restore` vergleichen die Hauptversion des Clients vor
dem Sichern oder Wiederherstellen mit `server_version_num` des Live-Servers und
stoppen mit einem Lösungsvorschlag, falls sie nicht zusammenpassen oder
die Binärdatei fehlt:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Installieren Sie diese mit `brew install libpq` oder `apt-get install postgresql-client-18`
(aus dem PostgreSQL-Apt-Repository, da das von Debian älter ist) oder verweisen Sie mit
`PG_DUMP_PATH`, `PG_RESTORE_PATH` und `PG_DUMPALL_PATH` auf eine bestimmte Binärdatei.
`restore --clean` führt auch `psql` aus, das mitgeliefert wird; `PSQL_PATH` gibt
ein anderes an.

## Row-Level Security und der Dump, der unbemerkt unvollständig ist {#row-level-security-and-the-dump-that-is-silently-short}

Bei einem verwalteten Postgres – Cloud SQL, RDS und anderen – gibt es keinen Superuser,
sodass die Rolle, mit der Sie sich verbinden, in der Regel keine Ihrer Tabellen besitzt und
kein `BYPASSRLS` hat. Row-Level Security gilt für sie, und `pg_dump` verweigert den Dienst:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Diese Verweigerung ist das sichere Ergebnis. Das manuelle Hinzufügen von `--enable-row-security`
zu `pg_dump` ist der gefährliche Weg: Es ist erfolgreich, beendet mit Exit-Code 0, und der Dump enthält
stillschweigend nur die Zeilen, die durch die Richtlinien der sichernden Rolle zugelassen sind. Es gibt zwei echte Auswege:

1. **Weisen Sie der sichernden Rolle `BYPASSRLS` zu oder machen Sie sie zum Eigentümer der Tabellen.** Der
   Dump enthält dann jede Zeile.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase setzt `app.uid` und
   `app.user_roles`, sodass die generierte `admin_full_access`-Richtlinie den
   Dump zulässt, und gibt eine Warnung aus, die erklärt, welcher Kompromiss eingegangen wurde: Eine Tabelle, deren
   Richtlinien keine Admin-Regel enthalten, fällt unvollständig aus, ohne dass ein Fehler gemeldet wird.

## Wiederherstellung

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` führt `pg_restore` aus und ist destruktiv, weshalb es niemals automatisch erfolgt:
Ohne `--yes` verlangt es ein interaktives `yes`, und in einer nicht-interaktiven
Shell bricht es ab und fordert dazu auf, `--yes` zu übergeben. `<backup>` ist ein lokaler `.dump` oder ein `s3://…`- / `gs://…`-Schlüssel,
der zuerst heruntergeladen wird.

Für eine Datenbank,
die bereits enthält, was das Backup anlegt, wird `--clean` benötigt: Ohne diesen Parameter
verweigert der Befehl die Ausführung, bevor etwas gestartet wird, nennt die im Weg stehenden Schemas und Tabellen
und weist darauf hin, `--clean` zu übergeben oder mit
`--create-db --target-db <name>` in eine neue Datenbank wiederherzustellen. Die
verwaltete Entwicklungsdatenbank wird verweigert, da sie die COPY-Daten eines Dumps nicht aufnehmen kann; stellen Sie
stattdessen mit `--docker` in Postgres in Docker wieder her.

Mit `--clean`
ersetzt die Wiederherstellung die im Backup enthaltenen Objekte in einer einzigen Transaktion. Es löscht jedes
vom Backup erstellte Schema vollständig (z. B. `rebase`) sowie jede vom Backup erstellte
Tabelle in einem fremden Schema (`public`) mit `CASCADE` und stellt den Dump dann
in derselben Transaktion wieder her. Vor der Bestätigungsabfrage wird aufgelistet, was gelöscht wird, das nicht im
Backup enthalten ist – wie etwa `rebase.atlas_schema_revisions` aus
`rebase db migrate`, Funktionen, Typen oder Sequenzen in einem ersetzten Schema oder
Views bzw. Fremdschlüssel an anderer Stelle, die auf eine der Tabellen des Backups verweisen. Eine Wiederherstellung, die an irgendeiner Stelle abbricht, wird zurückgerollt, und es wird
bestätigt, dass die Datenbank ihren vorherigen Zustand behält. Der Dump wird über `psql` ausgeführt, das
zusammen mit `pg_restore` bereitgestellt wird (`PSQL_PATH` gibt ein anderes an), und wartet höchstens
15 Sekunden auf ein Lock, das von einem laufenden `rebase dev` gehalten werden kann.
`--continue-on-error` führt weiterhin das eigene `--clean` von pg_restore aus.

Vor der Wiederherstellung werden die Cluster-Rollen aus der `.globals.sql` des Backups
neu erstellt – eine bereits vorhandene Rolle wird übersprungen und erzeugt keinen Fehler –, sodass die
Grants und Richtlinien des Dumps greifen. Anschließend bricht der Vorgang beim ersten Fehler ab (`--exit-on-error`
oder `ON_ERROR_STOP` unter `--clean`): Eine Wiederherstellung, die
ein fehlgeschlagenes `GRANT` nur protokollieren und fortfahren würde, würde Erfolg melden, obwohl Row-Level
Security nicht durchgesetzt wird. Befindet sich keine `.globals.sql` neben dem Backup, warnt der Befehl, dass
Rollen fehlen könnten.

| Option | Beschreibung |
| --- | --- |
| `--target-db <name>` | In diese Datenbank wiederherstellen statt in die in `DATABASE_URL` angegebene. |
| `--create-db` | Zieldatenbank zuerst erstellen, falls sie noch nicht existiert. |
| `--clean` | Ersetzt die im Backup enthaltenen Objekte in einer einzigen Transaktion mit der Wiederherstellung: seine Schemas vollständig und seine Tabellen anderswo. Listet vorab auf, was darüber hinaus gelöscht wird. |
| `--no-owner` | Die im Dump aufgezeichnete Eigentümerschaft ignorieren. |
| `--continue-on-error` | Fehler protokollieren und fortfahren. **Kann dazu führen, dass RLS nicht durchgesetzt wird**; nur verwenden, wenn Sie den Grund dafür kennen. |
| `--yes`, `-y` | Bestätigung überspringen. |

Das sichere Vorgehen besteht darin, neben der aktiven Datenbank wiederherzustellen, diese zu überprüfen und
die App erst danach umzuziehen:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Verbinden Sie einen Testprozess (oder `psql`) mit `app_restored` und prüfen Sie Zeilenanzahlen,
   eine Anmeldung sowie die wichtigsten Tabellen.
3. Leiten Sie `DATABASE_URL` während eines kurzen Wartungsfensters darauf um
   oder benennen Sie die Datenbanken um.
4. Stellen Sie Ihre hochgeladenen Dateien aus deren eigenem Backup wieder her, und zwar so nah wie möglich
   am selben Zeitpunkt.

## Das Backups-Panel

Das Panel **Backups** in Studio, unter der Gruppe *Database*, listet die Backups unter
`BACKUP_DESTINATION` auf – die neuesten zuerst, mit Zeitstempel (und Dateigröße bei einem lokalen
Ziel). **Download**
lädt den Dump herunter; **Roles file** lädt seine `.globals.sql` herunter. Laden Sie beide Dateien herunter und
bewahren Sie sie im selben Verzeichnis auf. Ein als **No roles file** markiertes Backup besitzt keine begleitende Datei:
Erstellen Sie dessen Rollen manuell neu, bevor Sie es in ein neues Postgres wiederherstellen.

Oberhalb der Liste informiert das Panel über den geplanten Backup-Job und dessen letzte Ausführung. Ein fehlgeschlagener Durchlauf wird als
Fehler mit entsprechender Meldung angezeigt, sodass ein nächtliches Backup, das nicht ausgeführt werden konnte, direkt dort sichtbar ist,
wo die Backups aufgelistet werden, und nicht nur im Panel „Geplante Jobs“.

Was über den Job angezeigt wird:

- **Last scheduled backup** ist die letzte planmäßige Ausführung. Ein seitdem
  manuell gestarteter Durchlauf (**Run Now** in Geplante Jobs) erhält eine eigene Zeile, sodass ein
  erfolgreicher Testlauf ein fehlgeschlagenes nächtliches Backup nicht verdecken kann und ein fehlgeschlagener Testlauf nicht
  als nächtliches Backup gemeldet wird.
- Ein Job, der mit `enabled: false` deklariert ist, wird so dargestellt, dass geplante Backups **ausgeschaltet** (off) sind.
  Dies ist das, was die obige Cron-Datei exportiert, solange `BACKUP_SCHEDULE` nicht gesetzt ist;
  das Setzen von `BACKUP_SCHEDULE` schaltet sie ein. **Paused** bedeutet, dass ein Administrator den
  Job in Geplante Jobs pausiert hat; eine Fortsetzung dort schaltet ihn wieder ein.
- Ein Job, den der Scheduler aufgrund eines ungültigen Zeitplans, einer ungültigen Zeitzone oder eines Timeouts
  abgelehnt hat, wird mit dem entsprechenden Grund ausgewiesen. Er wird erst ausgeführt, wenn seine Cron-Datei korrigiert wurde.
- Wenn der Ausführungsverlauf in `rebase.cron_logs` nicht gelesen werden kann, weist das Panel
  darauf hin, anstatt anzuzeigen, dass das Backup noch nicht ausgeführt wurde.

Die Liste wird von dem Serverprozess gelesen, der `GET /api/admin/backups` beantwortet,
und das ist nicht immer der Prozess, der den Zeitplan ausführt:

- Ein `s3://`-Ziel wird über einen Client für diesen Bucket aufgelistet und heruntergeladen,
  der aus denselben `S3_*`-Variablen erstellt wird, die der Backup-Cron verwendet. Ein `gs://`-Ziel
  verwendet Application Default Credentials. Stellen Sie diese **jedem** Prozess bereit, der
  `/api/admin` bedient, einschließlich der `api`-Rolle eines
  [Split-Deployments](/docs/deployment/split-processes/), und nicht nur dem Prozess,
  der den Cron ausführt. Ein Ziel, das der Prozess nicht lesen kann, antwortet mit `503`
  samt Ziel und Grund, und das Panel zeigt dies anstelle einer leeren Liste an.
- Ein lokaler Pfad bezieht sich auf die Festplatte dieses Prozesses. Wenn der Zeitplan in einem anderen Prozess
  läuft (ein `api` mit `REBASE_CRON_SCHEDULER=false` neben einem `worker`),
  weist das Panel darauf hin, dass es die Festplatte dieses Prozesses auflistet: Die geplanten Backups erscheinen
  dort nur, wenn beide Prozesse dasselbe Verzeichnis mounten. Bei einem Split-Deployment
  sollte die Sicherung in einem Object Storage erfolgen.

Downloads werden über `GET /api/admin/backups/download?key=…` gestreamt (nur für Admins),
sodass der Bucket niemals öffentlich sein muss; ein Schlüssel außerhalb des Ziel-Prefixes wird
abgewiesen. Wenn `BACKUP_DESTINATION` nicht gesetzt ist, meldet das Panel, dass Backups nicht
konfiguriert sind.

### Ein Backup herunterladen

Ein Browser kann
bei einem Download keinen `Authorization`-Header mitsenden, weshalb Studio und das SDK zuerst einen
Link anfordern. `POST /api/admin/backups/download-url` mit `{ "key": "…" }` (gleicher
Admin-Bereich und gleiche Schlüsselprüfungen wie beim Download) antwortet mit
`{ url, token, expiresIn }`: einer URL, deren Token für 60 Sekunden anstelle des Headers für
genau dieses Backup am aktuellen Zielort fungiert. Das Token wird
an jeder anderen Stelle abgewiesen – als Sitzung, als Storage-Download-Token, für ein anderes
Backup – sowie sobald es abläuft. Der Browser streamt den Dump anschließend direkt auf die
Festplatte, sodass ein Backup in der Größe Ihrer Datenbank niemals in einen Browser-Tab passen muss.

```ts
// In a browser: the browser saves the file.
await client.backups.download(key);

// Anywhere: a link that needs no header, for 60 seconds.
const { url } = await client.backups.downloadUrl(key);

// In Node: stream the bytes to a file.
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { stream, name } = await client.backups.stream(key);
await pipeline(Readable.fromWeb(stream), createWriteStream(name));
```

`backups.download(key)` speichert die Datei im Browser und wirft andernfalls einen Fehler; verwenden Sie `stream(key)`
in Node. Bei einem Server ohne Download-Links (älter als Version 0.25 oder
ohne JWT-Secret zum Signieren) greift `download()` darauf zurück, die Bytes
selbst zu lesen.

## Backups privat halten

Ein Backup enthält alle Ihre Daten, einschließlich Zugangsdaten und personenbezogener Daten.

- Verwenden Sie niemals einen öffentlichen Bucket. Halten Sie den Zugriff privat und protokollieren Sie ihn.
- Aktivieren Sie Verschlüsselung im Ruhezustand (Encryption at Rest): S3 Server-Side Encryption, GCS Standardverschlüsselung
  oder Festplattenverschlüsselung für ein lokales Verzeichnis.
- Beschränken Sie den Lesezugriff auf den Backup-Speicherort und rotieren Sie dessen Anmeldeinformationen.
- Bevorzugen Sie einen eigenen Bucket, getrennt von Benutzer-Uploads.

## Point-in-Time-Recovery

Ein `pg_dump`-Backup stellt den Zustand zu dem Zeitpunkt wieder her, an dem der Dump ausgeführt wurde. Eine
Wiederherstellung auf eine beliebige Sekunde dazwischen erfordert WAL-Archivierung und Basis-Backups,
die von der Open-Source-Distribution nicht automatisch ausgeführt werden. Wenn Sie dies selbst gehostet benötigen,
betreiben Sie `pgBackRest` oder `wal-g` neben Ihrem Postgres und bewahren Sie diese Dumps als zweite, portable Kopie auf.
