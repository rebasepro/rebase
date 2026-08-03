# Backups & Restore

Rebase ships first-class database backups for self-hosted PostgreSQL, built on
`pg_dump` / `pg_restore`. You get manual CLI backups, scheduled uploads to your
existing storage backend, and a safe, confirmation-gated restore path.

> **PITR is out of scope for OSS.** Continuous point-in-time recovery via WAL
> archiving is not part of the open-source distribution — see
> [Point-in-time recovery](#point-in-time-recovery-pitr) below. The commands
> here provide daily/scheduled snapshot backups, which cover the vast majority
> of self-hosted recovery needs.

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

## CLI reference

### `rebase db backup [--out <path|s3://…|gs://…>]`

Runs `pg_dump` in **custom format** (`-Fc`) — compressed and selectively
restorable. The connection string is resolved from your project's env exactly
like the other `rebase db` commands (`DATABASE_URL`, falling back to
`ADMIN_CONNECTION_STRING`).

| Option | Description |
|--------|-------------|
| `--out`, `-o` | Destination: a local path/directory, or an `s3://bucket/prefix` / `gs://bucket/prefix` URL. Defaults to `$BACKUP_DESTINATION` or `./backups`. |
| `--exclude-schema <s>` | Exclude a schema from the dump (repeatable). |
| `--no-owner` | Omit ownership commands (useful when restoring as a different role). |
| `--enable-row-security` | Dump as an admin subject instead of failing on RLS. **May produce a partial dump** — see below. |
| `--row-security-role <r>` | Role to read as with the flag above. Defaults to `admin`. |

Backup files are named `rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`. The UTC
timestamp is embedded so retention can be computed from the filename alone.

Every backup also writes a **roles sidecar** next to the dump —
`rebase-<db>-<…>Z.globals.sql`, produced by `pg_dumpall --globals-only
--no-role-passwords`. A per-database `pg_dump` cannot include cluster-wide
roles, so without this file the `rebase_user` role (and the RLS `GRANT`s that
reference it) would be missing on restore and **row-level security would be
silently lost**. Keep the `.globals.sql` file alongside its `.dump`; the CLI
uploads, lists, prunes and restores them as a pair. (Pass `PG_DUMPALL_PATH` to
point at a specific `pg_dumpall` binary. To take a role-incomplete backup on
purpose, the programmatic `createDump({ includeGlobals: false })` opt-out
exists — the CLI always captures globals.)

Freshly written dumps are validated (`pg_restore --list` must parse the
archive) before the command reports success, and — for scheduled backups —
**before any older backup is pruned**, so a corrupt-but-exit-0 dump can never
be the reason your last good backup is deleted.

For `s3://` destinations the CLI builds a storage client from the same `S3_*`
variables your backend uses (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

#### Row-level security, and the dump that is silently short

On a managed Postgres — Cloud SQL, RDS, and the rest — there is no superuser to
hand out, so the role you connect as usually owns none of your tables and has
no `BYPASSRLS`. Row-level security therefore applies to it, and `pg_dump`
refuses to run:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

**That refusal is the safe behaviour.** The obvious next move — adding
`--enable-row-security` by hand — is the dangerous one: it does not error, it
succeeds, and the dump quietly contains only the rows the dumping role's
policies admit. You get an exit code of 0, a plausible file size, and a backup
that is missing data you will not discover until you restore it.

Two real ways out, in order of preference:

1. **Grant the dumping role `BYPASSRLS`, or make it the tables' owner.** The
   dump then contains every row, which is what a backup should mean.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase sets `app.uid` and
   `app.user_roles` (via `PGOPTIONS`) so the generated `admin_full_access`
   policy admits the dump, and prints a warning saying what you have traded.
   The flag cannot be passed without that identity — the two travel together by
   construction, because `--enable-row-security` on its own is the failure mode
   above.

   The result contains exactly the rows those policies admit. A table whose
   policies include no admin rule comes out short, and nothing will say so.

### `rebase db restore <backup> [options]`

Runs `pg_restore`. **Destructive and never automatic** — without `--yes` it
requires an interactive `yes`. In non-interactive shells (CI, pipes) it aborts
unless `--yes` is passed.

Before restoring, the CLI recreates cluster roles from the backup's
`.globals.sql` sidecar (best-effort and idempotent — an already-present role is
skipped, not fatal) so the dump's `GRANT`/RLS statements apply. The restore
then runs with **`--exit-on-error` by default**: a `pg_restore` that logs and
continues past a failed `GRANT` would "succeed" with RLS un-enforced, so it
fails loudly instead. If no `.globals.sql` accompanies the backup, the CLI
warns that roles may be missing.

| Option | Description |
|--------|-------------|
| `--target-db <name>` | Restore into this database instead of the one in `DATABASE_URL`. |
| `--create-db` | Create the target database first if it doesn't exist. |
| `--clean` | Drop existing objects before recreating them (`--clean --if-exists`). |
| `--no-owner` | Ignore ownership recorded in the dump. |
| `--continue-on-error` | Log and continue past errors instead of aborting. **May leave RLS un-enforced** — use only when you understand the consequences. |
| `--yes`, `-y` | Skip the interactive confirmation. |

`<backup>` may be a local `.dump` file or an `s3://…` / `gs://…` object key
(downloaded to a temp file first). Its `.globals.sql` sidecar is resolved from
the same directory/prefix.

**Recommended:** restore into a fresh database with `--create-db --target-db`,
verify it, then repoint your app — rather than clobbering the live database.

### `rebase db backups list [--out <path|s3://…>]`

Lists available backups at the destination, newest first, with their creation
timestamps.

## Version compatibility

`pg_dump` / `pg_restore` must be the **same major version as the server or
newer**. Every command runs a pre-flight check comparing the client tool's
major version against the live server's `server_version_num` and fails with a
clear, doctor-style message if they're incompatible or the binary is missing:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Install the client tools with e.g. `brew install libpq` or
`apt-get install postgresql-client-16`. You can point the CLI at a specific
binary with `PG_DUMP_PATH` / `PG_RESTORE_PATH` / `PG_DUMPALL_PATH`.

## Scheduled backups

Scheduled backups plug into the built-in [cron system](../packages/server/src/cron).
Drop a cron file into your backend's `crons/` directory that default-exports a
backup job. The job dumps the database, uploads it via your **already-configured
storage backend**, and prunes old backups by retention policy.

```ts
// backend/crons/backup.ts
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";
import { storage } from "../src/storage"; // your configured StorageController

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

// `resolved.disabled` is true when BACKUP_SCHEDULE is unset — export a disabled
// no-op job in that case so discovery doesn't fail.
export default resolved.config
    ? createBackupCron({ ...resolved.config, storage })
    : createBackupCron({
        schedule: "0 3 * * *",
        connectionString: process.env.DATABASE_URL!,
        destination: { kind: "local", path: "./backups" },
        enabled: false
    });
```

### Configuration (env)

| Variable | Meaning |
|----------|---------|
| `BACKUP_SCHEDULE` | Cron expression, e.g. `0 3 * * *` (03:00 daily). Unset ⇒ scheduled backups disabled. |
| `BACKUP_DESTINATION` | Local path or `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Delete backups older than this many days. Unset/`0` ⇒ no pruning. |
| `BACKUP_KEEP_MINIMUM` | Always keep at least this many recent backups, even if older than the retention window. Guards against wiping everything after a long outage. |

Retention pruning only ever deletes objects whose filename matches the rebase
backup pattern — foreign files sharing a bucket/prefix are never touched.

## Studio Backups panel

The Studio ships a **Backups** panel (under the *Database* group) that lists the
backups at your configured `BACKUP_DESTINATION`, newest first, with size and
timestamp, and a per-row **Download** button. It reads from the admin route
`GET /api/admin/backups` (admin-guarded) and streams downloads through
`GET /api/admin/backups/download?key=…`, so downloads work for both local and
object-storage destinations without exposing the bucket publicly.

The panel is enabled by default. To customise the visible tools, pass the
`tools` array to `<RebaseStudio tools={[…, "backups"]}/>`. When
`BACKUP_DESTINATION` is unset the panel shows a short "not configured" hint.

## Security

Backups contain **all your data, including secrets and PII**. Treat the dump
files as sensitive credentials:

- **Never** use a public bucket. The CLI/cron default to private/octet-stream
  uploads, but bucket-level ACLs are your responsibility — keep them private.
- **Enable encryption-at-rest** on the destination (S3 SSE, GCS default
  encryption, or full-disk encryption for local storage).
- Restrict who can read the backup location and rotate storage credentials.
- Consider a dedicated, access-logged bucket separate from user uploads.

## Point-in-time recovery (PITR)

Snapshot backups (`pg_dump`) restore to the moment the dump ran. **Continuous
PITR** — replaying WAL to recover to any second — requires WAL archiving and is
**out of scope for the OSS distribution**. It needs infrastructure (a WAL
archive, base backups, `restore_command`) that is operationally heavy for
self-hosters.

PITR is the path for **Rebase managed cloud**, where the platform operates the
WAL archive and base-backup schedule on your behalf. If you need PITR
self-hosted today, run `pgBackRest` or `wal-g` alongside your Postgres instance
and use these snapshot backups as a second, portable line of defense.
