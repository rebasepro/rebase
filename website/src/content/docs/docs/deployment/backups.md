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
rebase db backups list --out ./backups

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

The connection string comes from your project's environment, as for every
other [`rebase db` command](/docs/cli/): `DATABASE_URL`, falling
back to `ADMIN_CONNECTION_STRING`.

## What a backup is

`rebase db backup` runs `pg_dump` in custom format (`-Fc`), which is compressed
and can be restored selectively. Files are named
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; the UTC timestamp in the name is what
retention and listing sort by.

| Option | Description |
| --- | --- |
| `--out`, `-o` | A local path, or an `s3://bucket/prefix` / `gs://bucket/prefix` URL. Defaults to `$BACKUP_DESTINATION`, then `./backups`. |
| `--exclude-schema <s>` | Leave a schema out of the dump (repeatable). Never leave out `rebase` — see below. |
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

The cron runs `pg_dump` inside the server process.
the official
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
shell it stops. `<backup>` is a local `.dump` or an `s3://…` / `gs://…` key,
downloaded first.

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
| `--clean` | Drop existing objects before recreating them (`--clean --if-exists`). |
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

above the list it
reports the scheduled backup job and its last run. A failed run is shown as an
error with its message, so a nightly backup that cannot run is visible where
the backups are listed, not only in the Cron Jobs panel.

what it says about the job:

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

the list is read
by the server process that answers `GET /api/admin/backups`, and that is not
always the process that runs the schedule:

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
