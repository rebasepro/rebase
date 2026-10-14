---
title: Backups and restore
sidebar_label: Backups
description: Take, schedule, list and restore database backups with pg_dump — what a backup contains, the roles file that travels with it, and the one thing it does not cover, your uploaded files.
---

## Overview

Rebase backs up a Postgres database with `pg_dump` and restores it with
`pg_restore`. You can take a backup by hand, schedule one with a cron job,
list what you have from the CLI or the Studio **Backups** panel, and restore
into a fresh database without touching the live one.

:::caution[This does not back up your files]
A backup holds the **database** and nothing else. Uploaded files live in your
[storage backend](/docs/backend/storage/) — an S3 or GCS bucket, or the
directory at `STORAGE_PATH` — not in Postgres, so a restored database points at files only that backend has.
Back up the bucket (versioning or replication) or the uploads directory
separately, on a schedule of its own.
:::

## Quick start

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

The database is the one every other [`rebase db` command](/docs/cli/database/)
resolves, in the same order: `--database-url`, `DATABASE_URL` in the shell, the
[branch](/docs/backend/branching/) the checkout is switched to, `DATABASE_URL`
in `.env`, Postgres in Docker (`--docker`, or the last `rebase dev --docker`),
then the managed development database, which `restore` refuses.

<span class="since-badge" data-since="0.25">Since 0.25</span> A relative
`--out`, the default `./backups` and a dump path given to `rebase db restore`
all resolve against the directory you run `rebase` from, normally the project
root, so `rebase db backup` and `rebase db backups list` meet in one place. A
relative `BACKUP_DESTINATION` resolves against the backend directory, where the
server reads it too. All three commands refuse an option they do not take
before running anything, and name the one you probably meant. The password goes
to `pg_dump`, `pg_dumpall` and `pg_restore` in `PGPASSWORD`, never on their
command line, so no error message or process list shows it. On 0.24 the default
was `backend/backups`, a misspelled option was ignored, and a failed restore
printed the connection string with its password.

## What a backup is

`rebase db backup` runs `pg_dump` in custom format (`-Fc`), which is compressed
and can be restored selectively. Files are named
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; the UTC timestamp in the name is what
retention and listing sort by.

| Option | Description |
| --- | --- |
| `--out`, `-o` | A local path, or an `s3://bucket/prefix` / `gs://bucket/prefix` URL. Defaults to `$BACKUP_DESTINATION`, then `./backups` in the directory you run `rebase` from. |
| `--exclude-schema <s>` | Leave a schema out of the dump (repeatable). A pattern that matches `rebase` is refused — see below. |
| `--no-owner` | Omit ownership commands, for restoring as a different role. |
| `--enable-row-security` | Dump as an admin subject instead of failing on row-level security. **May produce a partial dump** — see [Row-level security](#row-level-security-and-the-dump-that-is-silently-short). |
| `--row-security-role <r>` | The role to read as with the flag above. Defaults to `admin`. |

A dump is validated before the command reports success: `pg_restore --list`
must be able to read the whole archive.

For `s3://` destinations the CLI builds its storage client from the same
`S3_*` variables your backend uses (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### The roles file

Every backup writes a second file beside the dump:
`rebase-<db>-<…>Z.globals.sql`, produced by
`pg_dumpall --globals-only --no-role-passwords`. A per-database `pg_dump`
cannot include cluster-wide roles, and the dump's grants and row-level-security
policies name one — `rebase_user`. Restored into a new Postgres without it, the
first `GRANT` to that role fails and the restore stops.

Keep the two files together. The CLI uploads, lists, prunes and restores them
as a pair, and `rebase db restore` looks for the `.globals.sql` in the same
directory or prefix as the `.dump`. Roles are recreated **without passwords**;
set them again after a restore into a new cluster. `PG_DUMPALL_PATH` points at a
specific `pg_dumpall` binary.

### What is in it

All of the database, the `rebase` schema included. That schema holds every
user account and the rest of auth, API keys, record history, the job queue,
cron logs, and the functions your RLS policies and change-capture triggers
call. A dump without it has no users, and cannot be restored into an empty
database at all: the tables it does contain have policies that call functions
it does not.

<span class="since-badge" data-since="0.25">Since 0.25</span> So
`rebase db backup` refuses an `--exclude-schema` that matches `rebase`, by
pg_dump's own pattern rules (`reb*` and `*` included), before it runs anything.
On 0.24 it wrote the dump and validated it, and only the restore failed.

<span class="since-badge" data-since="0.25">Since 0.25</span> Because it holds
every password and key hash, a local dump and its `.globals.sql` are created
readable by their owner only (0600), before `pg_dump` writes to them; a
scheduled backup's local files are too. On 0.24 they are 0644.

## Scheduled backups

A scheduled backup is a [cron job](/docs/backend/cron-jobs/) that dumps the
database, uploads the result to `BACKUP_DESTINATION` and prunes old backups.
Drop a file into `backend/crons/` that default-exports one:

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

The storage controller is passed in rather than taken from the job's context,
because the context's `rebase.storage` is the client-side storage API, not a
controller for the backup bucket.

A backup is not held to the controller's upload limits. `maxFileSize` (50 MB
unless set) and `allowedMimeTypes` apply to what users upload, so a dump of any
size uploads, and so does one written through the controller that serves your
app's files.

| Variable | Meaning |
| --- | --- |
| `BACKUP_SCHEDULE` | Cron expression, e.g. `0 3 * * *` for 03:00 daily. Unset turns scheduled backups off. |
| `BACKUP_DESTINATION` | A local path, or `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Delete backups older than this many days. Unset or `0` keeps everything. |
| `BACKUP_KEEP_MINIMUM` | Always keep at least this many recent backups, however old — so a long outage does not prune everything. |

Each new dump is validated **before** anything is pruned, so a corrupt dump
can never be the reason your last good backup was deleted. Pruning touches
only files whose names match the backup pattern; anything else sharing the
bucket or prefix is left alone.

The cron runs `pg_dump` inside the server process. The official
runtime image (`rebasepro/server`, see [Self-hosting](/docs/deployment/self-hosting/))
ships the PostgreSQL 18 client tools for it;
on 0.23 and earlier it had none, and every scheduled run failed with
`Could not find the 'pg_dump' binary`. Anywhere else — a VPS, your own image —
install the client tools yourself (see the next section).

## Version compatibility

`pg_dump` and `pg_restore` must be the **same major version as the server, or
newer**. Every command checks the client's major against the live server's
`server_version_num` first and stops with the remedy if they do not fit, or if
the binary is missing:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Install them with `brew install libpq` or `apt-get install postgresql-client-18`
(from the PostgreSQL apt repository, where Debian's own is older), or point at a
specific binary with `PG_DUMP_PATH`, `PG_RESTORE_PATH` and `PG_DUMPALL_PATH`.
`restore --clean` also runs `psql`, which ships with them; `PSQL_PATH` names
another one.

## Row-level security, and the dump that is silently short

On a managed Postgres — Cloud SQL, RDS and the rest — there is no superuser to
hand out, so the role you connect as usually owns none of your tables and has
no `BYPASSRLS`. Row-level security applies to it, and `pg_dump` refuses:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

That refusal is the safe outcome. Adding `--enable-row-security` to `pg_dump`
by hand is the dangerous one: it succeeds, exits 0, and the dump quietly holds
only the rows the dumping role's policies admit. Two real ways out:

1. **Grant the dumping role `BYPASSRLS`, or make it the tables' owner.** The
   dump then holds every row.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase sets `app.uid` and
   `app.user_roles` so the generated `admin_full_access` policy admits the
   dump, and prints a warning saying what you have traded: a table whose
   policies include no admin rule comes out short, and nothing says so.

## Restore

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` runs `pg_restore`, and it is destructive, so it is never automatic:
without `--yes` it asks for an interactive `yes`, and in a non-interactive
shell it stops and says to pass `--yes`. `<backup>` is a local `.dump` or an `s3://…` / `gs://…` key,
downloaded first.

<span class="since-badge" data-since="0.25">Since 0.25</span> Into a database
that already holds what the backup creates, it needs `--clean`: without it,
it refuses before anything runs, naming the schemas and tables in the way, and
says to pass `--clean` or restore into a new database with
`--create-db --target-db <name>`. On 0.24 it recreated the roles and then
stopped on pg_restore's `schema "rebase" already exists`. It refuses the
managed development database, which cannot take a dump's COPY data; restore
into Postgres in Docker with `--docker` instead.

<span class="since-badge" data-since="0.25">Since 0.25</span> With `--clean`,
the restore replaces what the backup holds as one transaction. It drops each
schema the backup creates whole (`rebase`, say), and each table the backup
creates in a schema it does not (`public`), with `CASCADE`, then restores the
dump in the same transaction. Before it asks, it names what that drops that the
backup does not hold, such as `rebase.atlas_schema_revisions` from
`rebase db migrate`, a function, type or sequence in a replaced schema, or a
view or foreign key elsewhere that references one of the backup's tables. A restore that stops anywhere is rolled back, and it says
the database holds what it held before. It runs the dump through `psql`, which
ships with `pg_restore` (`PSQL_PATH` names another one), and waits at most
15 seconds for a lock, which a running `rebase dev` can hold. On 0.24, `--clean`
was pg_restore's own, one statement at a time: a table the backup lacked in
`rebase` stopped it at `DROP SCHEMA rebase`, after every table had been dropped.
`--continue-on-error` still runs pg_restore's own `--clean`.

Before restoring, it recreates the cluster roles from the backup's
`.globals.sql` — an existing role is skipped, not an error — so the dump's
grants and policies apply. It then runs with `--exit-on-error`: a restore that
logged a failed `GRANT` and carried on would report success with row-level
security not enforced. Without a `.globals.sql` beside the backup it warns that
roles may be missing.

| Option | Description |
| --- | --- |
| `--target-db <name>` | Restore into this database instead of the one in `DATABASE_URL`. |
| `--create-db` | Create the target database first if it does not exist. |
| `--clean` | Replace what the backup holds, in one transaction with the restore: its schemas whole, and its tables elsewhere. Says first what that drops beyond the backup. |
| `--no-owner` | Ignore the ownership recorded in the dump. |
| `--continue-on-error` | Log and continue past errors. **May leave RLS unenforced**; use it only when you know why. |
| `--yes`, `-y` | Skip the confirmation. |

The safe procedure is to restore beside the live database, check it, and only
then move the app:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Point a scratch process (or `psql`) at `app_restored` and check row counts,
   a sign-in, and the tables you care about most.
3. Repoint `DATABASE_URL` at it, or rename the databases, during a short
   maintenance window.
4. Restore your uploaded files from their own backup, to the same point in time
   as closely as you can.

## The Backups panel

Studio's **Backups** panel, in the *Database* group, lists the backups at
`BACKUP_DESTINATION`, newest first, with their size and time. **Download**
fetches the dump; **Roles file** fetches its `.globals.sql`. Download both and
keep them in one directory. A backup marked **No roles file** has no sidecar:
recreate its roles by hand before restoring it into a new Postgres.

Above the list, the panel reports the scheduled backup job and its last run. A failed run is shown as an
error with its message, so a nightly backup that cannot run is visible where
the backups are listed, not only in the Cron Jobs panel.

What it says about the job:

- **Last scheduled backup** is the last run the schedule made. A run started
  by hand since then (**Run Now** in Cron Jobs) gets a line of its own, so a
  test run that worked cannot hide a failed nightly, and one that failed is not
  reported as the nightly.
- A job declared `enabled: false` reads as scheduled backups being **off**.
  That is what the cron file above exports while `BACKUP_SCHEDULE` is unset, and
  setting `BACKUP_SCHEDULE` turns them on. **Paused** means an admin paused the
  job in Cron Jobs, and resuming it there turns it back on.
- A job the scheduler refused, for an invalid schedule, timezone or timeout,
  is reported with the reason. It never runs until its cron file is fixed.
- When the run history in `rebase.cron_logs` cannot be read, the panel says
  so, rather than that the backup has not run yet.

The list is read by the server process that answers `GET /api/admin/backups`,
and that is not always the process that runs the schedule:

- An `s3://` destination is listed and downloaded through a client for that
  bucket, built from the same `S3_*` variables the backup cron uses. A `gs://`
  one uses application default credentials. Give them to **every** process that
  serves `/api/admin`, the `api` role of a
  [split deployment](/docs/deployment/split-processes/) included, not only the
  one that runs the cron. A destination the process cannot read answers `503`
  with the destination and the reason, and the panel shows that instead of an
  empty list.
- A local path is that process's own disk. When the schedule runs in another
  process (an `api` with `REBASE_CRON_SCHEDULER=false` beside a `worker`), the
  panel says it is listing this process's disk: the scheduled backups appear
  there only if both processes mount the same directory. A split deployment
  should back up to object storage.

Downloads stream through `GET /api/admin/backups/download?key=…`, admin-only,
so the bucket never has to be public; a key outside the destination's prefix is
refused. With `BACKUP_DESTINATION` unset the panel says backups are not
configured.

### Download a backup

<span class="since-badge" data-since="0.25">Since 0.25</span> A browser cannot
put an `Authorization` header on a download, so Studio and the SDK ask for a
link first. `POST /api/admin/backups/download-url` with `{ "key": "…" }` (same
admin scope and key checks as the download) answers
`{ url, token, expiresIn }`: a URL whose token stands in for the header, for
that one backup at the current destination, for 60 seconds. The token is
refused anywhere else — as a session, as a storage download token, for another
backup — and once it expires. The browser then streams the dump straight to
disk, so a backup the size of your database never has to fit in a tab.

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

Before 0.24, `backups.download(key)` answered a `Blob` holding the whole dump.
It now saves the file in a browser and throws elsewhere; use `stream(key)`
in Node. Against a server without download links (one older than 0.24, or one
with no JWT secret to sign them), `download()` falls back to reading the bytes
itself.

## Keep backups private

A backup holds all of your data, credentials and personal data included.

- Never use a public bucket. Keep its access private and log it.
- Turn on encryption at rest: S3 server-side encryption, GCS default
  encryption, or disk encryption for a local directory.
- Restrict who can read the backup location, and rotate its credentials.
- Prefer a bucket of its own, separate from user uploads.

## Point-in-time recovery

A `pg_dump` backup restores to the moment the dump ran. Recovering to any
second in between needs WAL archiving and base backups, which the open-source
distribution does not run for you. If you need it self-hosted, run `pgBackRest`
or `wal-g` beside your Postgres and keep these dumps as a second, portable copy.
