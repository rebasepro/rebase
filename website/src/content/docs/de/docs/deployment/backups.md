---
sourceHash: 0007bd5679d9971e
title: Backups und Wiederherstellung
sidebar_label: Backups
description: Datenbank-Backups mit pg_dump erstellen, planen, auflisten und wiederherstellen — was ein Backup enthält, die Rollen-Datei, die mit ihm reist, und die eine Sache, die es nicht abdeckt, Ihre hochgeladenen Dateien.
---

## Übersicht

Rebase sichert eine Postgres-Datenbank mit `pg_dump` und stellt sie mit
`pg_restore` wieder her. Sie können ein Backup manuell erstellen, eines mit
einem Cron-Job planen, Ihre vorhandenen Backups über die CLI oder das
Studio-**Backups**-Werkzeug auflisten und in eine frische Datenbank
wiederherstellen, ohne die laufende zu berühren.

:::caution[Dies sichert Ihre Dateien nicht]
Ein Backup enthält nur die **Datenbank**, nichts sonst. Hochgeladene Dateien
liegen in Ihrem [Storage-Backend](/docs/backend/storage/) — einem S3- oder
GCS-Bucket, oder dem Verzeichnis unter `STORAGE_PATH` — nicht in Postgres,
sodass eine wiederhergestellte Datenbank auf Dateien verweist, die nur dieses
Backend besitzt. Sichern Sie den Bucket (Versionierung oder Replikation) oder
das Uploads-Verzeichnis separat, nach einem eigenen Zeitplan.
:::

## Schnellstart

```bash
# Back up to a local directory (custom format, compressed)
rebase db backup --out ./backups

# Back up straight to private object storage
rebase db backup --out s3://my-private-bucket/backups

# List what you have
rebase db backups list --out ./backups

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

Die Connection-String stammt aus der Umgebung Ihres Projekts, wie bei jedem
anderen [`rebase db`-Befehl](/docs/cli/): `DATABASE_URL`, mit Rückfall auf
`ADMIN_CONNECTION_STRING`.

## Was ein Backup ist

`rebase db backup` führt `pg_dump` im Custom-Format aus (`-Fc`), das
komprimiert ist und selektiv wiederhergestellt werden kann. Dateien werden
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump` genannt; der UTC-Zeitstempel im Namen
ist das, wonach Retention und Auflistung sortieren.

| Option | Beschreibung |
| --- | --- |
| `--out`, `-o` | Ein lokaler Pfad, oder eine `s3://bucket/prefix`- / `gs://bucket/prefix`-URL. Standardmäßig `$BACKUP_DESTINATION`, dann `./backups`. |
| `--exclude-schema <s>` | Ein Schema aus dem Dump auslassen (wiederholbar). Lassen Sie `rebase` niemals aus — siehe unten. |
| `--no-owner` | Eigentumsbefehle auslassen, zum Wiederherstellen als andere Rolle. |
| `--enable-row-security` | Als Admin-Subjekt dumpen, statt an Row-Level Security zu scheitern. **Kann einen unvollständigen Dump erzeugen** — siehe [Row-Level Security](#row-level-security-und-der-dump-der-still-und-leise-unvollständig-ist). |
| `--row-security-role <r>` | Die Rolle, als die mit dem obigen Flag gelesen wird. Standardmäßig `admin`. |

Ein Dump wird validiert, bevor der Befehl Erfolg meldet: `pg_restore --list`
muss das gesamte Archiv lesen können.

Für `s3://`-Ziele baut die CLI ihren Storage-Client aus denselben
`S3_*`-Variablen, die Ihr Backend verwendet (`S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### Die Rollen-Datei

Jedes Backup schreibt eine zweite Datei neben dem Dump:
`rebase-<db>-<…>Z.globals.sql`, erzeugt von
`pg_dumpall --globals-only --no-role-passwords`. Ein `pg_dump` pro Datenbank
kann cluster-weite Rollen nicht einschließen, und die Grants und
Row-Level-Security-Policies des Dumps benennen eine — `rebase_user`. In ein
neues Postgres ohne sie wiederhergestellt, scheitert das erste `GRANT` an
diese Rolle, und die Wiederherstellung stoppt.

Halten Sie die beiden Dateien zusammen. Die CLI lädt, listet, bereinigt und
stellt sie als Paar wieder her, und `rebase db restore` sucht die
`.globals.sql` im selben Verzeichnis oder Präfix wie die `.dump`. Rollen
werden **ohne Passwörter** neu angelegt; setzen Sie diese nach einer
Wiederherstellung in einen neuen Cluster erneut. `PG_DUMPALL_PATH` verweist auf
ein bestimmtes `pg_dumpall`-Binary.

### Was darin enthalten ist

Die gesamte Datenbank, einschließlich des `rebase`-Schemas. Dieses Schema
enthält jedes Benutzerkonto und den Rest der Authentifizierung, API-Schlüssel,
Entitätshistorie, die Job-Warteschlange, Cron-Logs sowie die Funktionen, die
Ihre RLS-Policies und Change-Capture-Trigger aufrufen. Ein Dump ohne dieses
Schema hat keine Benutzer und kann überhaupt nicht in eine leere Datenbank
wiederhergestellt werden: Die Tabellen, die er enthält, besitzen Policies, die
Funktionen aufrufen, die er nicht enthält.

## Geplante Backups

Ein geplantes Backup ist ein [Cron-Job](/docs/backend/cron-jobs/), der die
Datenbank dumpt, das Ergebnis nach `BACKUP_DESTINATION` hochlädt und alte
Backups bereinigt. Legen Sie eine Datei in `backend/crons/` ab, die einen
Standardexport bereitstellt:

```ts
// backend/crons/backup.ts
import { GCSStorageController, S3StorageController, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (destination?.kind === "gcs") {
        return new GCSStorageController({ type: "gcs", bucket: destination.bucket });
    }
    if (destination?.kind !== "s3") return undefined; // local: written to disk directly
    return new S3StorageController({
        type: "s3",
        bucket: destination.bucket,
        region: process.env.S3_REGION || "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
    });
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

Der Storage-Controller wird übergeben, statt aus dem Kontext des Jobs
übernommen zu werden, weil `rebase.storage` im Kontext die clientseitige
Storage-API ist, kein Controller für den Backup-Bucket.

| Variable | Bedeutung |
| --- | --- |
| `BACKUP_SCHEDULE` | Cron-Ausdruck, z. B. `0 3 * * *` für täglich 03:00 Uhr. Nicht gesetzt schaltet geplante Backups aus. |
| `BACKUP_DESTINATION` | Ein lokaler Pfad, oder `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Backups löschen, die älter als so viele Tage sind. Nicht gesetzt oder `0` behält alles. |
| `BACKUP_KEEP_MINIMUM` | Immer mindestens so viele aktuelle Backups behalten, egal wie alt — damit ein langer Ausfall nicht alles bereinigt. |

Jeder neue Dump wird validiert, **bevor** irgendetwas bereinigt wird, sodass
ein beschädigter Dump niemals der Grund sein kann, warum Ihr letztes gutes
Backup gelöscht wurde. Die Bereinigung betrifft nur Dateien, deren Namen dem
Backup-Muster entsprechen; alles andere, das sich den Bucket oder das Präfix
teilt, bleibt unberührt.

Der Cron-Job führt `pg_dump` innerhalb des Serverprozesses aus.
liefert das
offizielle Runtime-Image (`rebasepro/server`, siehe
[Self-Hosting](/docs/deployment/self-hosting/)) die PostgreSQL-18-Client-Tools
dafür mit; auf 0.23 und früher hatte es keine, und jeder geplante Lauf
scheiterte mit `Could not find the 'pg_dump' binary`. Überall sonst — ein VPS,
Ihr eigenes Image — installieren Sie die Client-Tools selbst (siehe nächster
Abschnitt).

## Versionskompatibilität

`pg_dump` und `pg_restore` müssen **dieselbe Hauptversion wie der Server
haben, oder neuer sein**. Jeder Befehl prüft zuerst die Hauptversion des
Clients gegen die `server_version_num` des laufenden Servers und stoppt mit
der Abhilfe, wenn sie nicht zusammenpassen oder das Binary fehlt:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Installieren Sie sie mit `brew install libpq` oder
`apt-get install postgresql-client-18` (aus dem PostgreSQL-apt-Repository, in
dem Debians eigenes älter ist), oder verweisen Sie mit `PG_DUMP_PATH`,
`PG_RESTORE_PATH` und `PG_DUMPALL_PATH` auf ein bestimmtes Binary.

## Row-Level Security, und der Dump, der still und leise unvollständig ist

Bei einem verwalteten Postgres — Cloud SQL, RDS und die übrigen — gibt es
keinen Superuser, den man vergeben könnte, daher besitzt die Rolle, mit der
Sie sich verbinden, meist keine Ihrer Tabellen und hat kein `BYPASSRLS`.
Row-Level Security gilt für sie, und `pg_dump` verweigert:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Diese Verweigerung ist das sichere Ergebnis. `--enable-row-security` von Hand
zu `pg_dump` hinzuzufügen ist das gefährliche: Es gelingt, es endet mit
Exit-Code 0, und der Dump enthält still und leise nur die Zeilen, die die
Policies der dumpenden Rolle zulassen. Zwei echte Auswege:

1. **Gewähren Sie der dumpenden Rolle `BYPASSRLS`, oder machen Sie sie zum
   Eigentümer der Tabellen.** Der Dump enthält dann jede Zeile.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase setzt `app.uid` und
   `app.user_roles`, sodass die generierte `admin_full_access`-Policy den Dump
   zulässt, und gibt eine Warnung aus, die sagt, was Sie dafür eingetauscht
   haben: Eine Tabelle, deren Policies keine Admin-Regel enthalten, kommt
   unvollständig heraus, und nichts weist darauf hin.

## Wiederherstellung

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` führt `pg_restore` aus, und das ist destruktiv, daher läuft es nie
automatisch: Ohne `--yes` fragt es interaktiv nach einem `yes`, und in einer
nicht interaktiven Shell stoppt es. `<backup>` ist ein lokales `.dump` oder ein
`s3://…`- / `gs://…`-Key, der zuerst herunterladen wird.

Vor der Wiederherstellung legt es die Cluster-Rollen aus der `.globals.sql`
des Backups neu an — eine bereits vorhandene Rolle wird übersprungen, nicht
als Fehler gewertet —, damit die Grants und Policies des Dumps greifen.
Danach läuft es mit `--exit-on-error`: Eine Wiederherstellung, die ein
gescheitertes `GRANT` protokolliert hätte und fortgefahren wäre, würde Erfolg
melden, während Row-Level Security nicht durchgesetzt ist. Ohne eine
`.globals.sql` neben dem Backup warnt es, dass Rollen fehlen könnten.

| Option | Beschreibung |
| --- | --- |
| `--target-db <name>` | In diese Datenbank wiederherstellen statt in die aus `DATABASE_URL`. |
| `--create-db` | Die Zieldatenbank zuerst anlegen, falls sie nicht existiert. |
| `--clean` | Vorhandene Objekte löschen, bevor sie neu angelegt werden (`--clean --if-exists`). |
| `--no-owner` | Das im Dump festgehaltene Eigentum ignorieren. |
| `--continue-on-error` | Fehler protokollieren und fortfahren. **Kann RLS unerzwungen zurücklassen**; verwenden Sie dies nur, wenn Sie wissen, warum. |
| `--yes`, `-y` | Die Bestätigung überspringen. |

Das sichere Verfahren ist, neben der laufenden Datenbank wiederherzustellen,
sie zu prüfen und die App erst danach umzustellen:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Richten Sie einen Wegwerf-Prozess (oder `psql`) auf `app_restored` und
   prüfen Sie Zeilenzahlen, eine Anmeldung und die Tabellen, die Ihnen am
   wichtigsten sind.
3. Richten Sie `DATABASE_URL` darauf um, oder benennen Sie die Datenbanken um,
   während eines kurzen Wartungsfensters.
4. Stellen Sie Ihre hochgeladenen Dateien aus deren eigenem Backup wieder her,
   so nah wie möglich am selben Zeitpunkt.

## Das Backups-Werkzeug

Studios **Backups**-Werkzeug, in der Gruppe *Datenbank*, listet die Backups
unter `BACKUP_DESTINATION`, neueste zuerst, mit Größe und Zeitpunkt.
**Download** lädt den Dump; **Roles file** lädt dessen `.globals.sql`. Laden
Sie beide herunter und halten Sie sie in einem Verzeichnis zusammen. Ein
Backup, das als **No roles file** markiert ist, hat kein Sidecar: Legen Sie
seine Rollen von Hand neu an, bevor Sie es in ein neues Postgres
wiederherstellen.

meldet es über
der Liste den geplanten Backup-Job und seinen letzten Lauf. Ein fehlgeschlagener
Lauf wird als Fehler mit seiner Meldung angezeigt, sodass ein nächtliches
Backup, das nicht laufen kann, dort sichtbar ist, wo die Backups aufgeführt
sind, nicht nur im Cron-Jobs-Werkzeug.

sagt es über den Job Folgendes:

- **Last scheduled backup** ist der letzte Lauf, den der Zeitplan ausgeführt hat. Ein
  seitdem von Hand gestarteter Lauf (**Run Now** im Cron-Jobs-Werkzeug) bekommt eine
  eigene Zeile, sodass ein erfolgreicher Testlauf kein fehlgeschlagenes nächtliches
  Backup verdecken kann und ein fehlgeschlagener nicht als das nächtliche gemeldet wird.
- Bei einem mit `enabled: false` deklarierten Job zeigt das Werkzeug geplante Backups als
  **aus** an. Das exportiert die obige Cron-Datei, solange `BACKUP_SCHEDULE` nicht gesetzt ist, und
  das Setzen von `BACKUP_SCHEDULE` schaltet sie ein. **Pausiert** bedeutet, dass ein Admin den
  Job im Cron-Jobs-Werkzeug pausiert hat, und ihn dort fortzusetzen schaltet sie wieder ein.
- Ein Job, den der Scheduler wegen eines ungültigen Zeitplans, einer ungültigen Zeitzone
  oder eines ungültigen Timeouts abgelehnt hat, wird mit dem Grund gemeldet. Er läuft nie,
  bis seine Cron-Datei korrigiert ist.
- Wenn der Ausführungsverlauf in `rebase.cron_logs` nicht gelesen werden kann, sagt das
  Werkzeug genau das, statt zu melden, dass das Backup noch nicht gelaufen ist.

wird die Liste von
dem Server-Prozess gelesen, der `GET /api/admin/backups` beantwortet, und das ist
nicht immer der Prozess, der den Zeitplan ausführt:

- Ein `s3://`-Ziel wird über einen Client für diesen Bucket aufgelistet und
  heruntergeladen, gebaut aus denselben `S3_*`-Variablen, die der Backup-Cron verwendet.
  Ein `gs://`-Ziel verwendet Application Default Credentials. Geben Sie sie **jedem**
  Prozess, der `/api/admin` bedient, einschließlich der `api`-Rolle eines
  [aufgeteilten Deployments](/docs/deployment/split-processes/), nicht nur dem, der den
  Cron ausführt. Ein Ziel, das der Prozess nicht lesen kann, antwortet mit `503` samt Ziel
  und Grund, und das Werkzeug zeigt dies statt einer leeren Liste an.
- Ein lokaler Pfad ist die eigene Festplatte dieses Prozesses. Wenn der Zeitplan in einem
  anderen Prozess läuft (ein `api` mit `REBASE_CRON_SCHEDULER=false` neben einem `worker`),
  meldet das Werkzeug, dass es die Festplatte dieses Prozesses auflistet: Die geplanten
  Backups erscheinen dort nur, wenn beide Prozesse dasselbe Verzeichnis einbinden. Ein
  aufgeteiltes Deployment sollte in Object Storage sichern.

Downloads streamen über `GET /api/admin/backups/download?key=…`, nur für
Admins, sodass der Bucket niemals öffentlich sein muss; ein Key außerhalb des
Präfixes des Ziels wird abgelehnt. Mit nicht gesetztem `BACKUP_DESTINATION`
meldet das Werkzeug, dass keine Backups konfiguriert sind.

## Backups privat halten

Ein Backup enthält alle Ihre Daten, einschließlich Zugangsdaten und
personenbezogener Daten.

- Verwenden Sie niemals einen öffentlichen Bucket. Halten Sie den Zugriff
  privat und protokollieren Sie ihn.
- Schalten Sie Verschlüsselung im Ruhezustand ein: S3-Server-Side-Encryption,
  GCS-Standardverschlüsselung, oder Festplattenverschlüsselung für ein
  lokales Verzeichnis.
- Beschränken Sie, wer den Backup-Speicherort lesen kann, und rotieren Sie
  dessen Zugangsdaten.
- Bevorzugen Sie einen eigenen Bucket, getrennt von Benutzer-Uploads.

## Point-in-Time-Recovery

Ein `pg_dump`-Backup stellt den Zeitpunkt wieder her, zu dem der Dump lief.
Um auf eine beliebige Sekunde dazwischen wiederherzustellen, braucht es
WAL-Archivierung und Basis-Backups, die die Open-Source-Distribution nicht für
Sie ausführt. Wenn Sie dies selbst hosten müssen, führen Sie `pgBackRest` oder
`wal-g` neben Ihrem Postgres aus und behalten Sie diese Dumps als zweite,
portable Kopie.
