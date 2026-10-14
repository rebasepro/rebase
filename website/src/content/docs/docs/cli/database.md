---
title: Database Commands
sidebar_label: Database Commands
description: The rebase db commands — push, generate and migrate, backups and restores, pulling a copy, the connection string, the managed development database, and branches.
---

## Overview

`rebase db` is the family of commands that reach the project's database. Each
one works on the database the project resolves, in the order
[Database Branching](/docs/backend/branching/#cli-integration) lists:
`--database-url`, then `DATABASE_URL` in the shell, the branch the checkout is
switched to, `DATABASE_URL` in `.env`, `--docker`, and otherwise the managed
development database `rebase dev` starts. `rebase db url` prints which one that
is.

`push`, `generate` and `migrate` are described in depth on
[Schema Generation](/docs/cli/schema/), and every other command is in the
[CLI reference](/docs/cli/).

## Commands

### `rebase db push`

Push schema changes directly to the database (development only):

```bash
rebase db push
```

`--database-url <url>` names the database, and `--docker` the compose one, started
if needed. `generate`, `migrate`, `branch`, `backup` and `restore` take both too.

It leaves alone what your collections do not describe: other tables and views,
indexes you wrote, and the CHECK and EXCLUDE constraints on a collection's
table, which a collection cannot declare. See
[`rebase db push`](/docs/cli/schema/#rebase-db-push) for what it applies and
what it stops before.

:::caution
`db push` modifies the database directly without migration files. Use `db generate` + `db migrate` for production.
:::

### `rebase db generate`

Generate SQL migration files from schema changes:

```bash
rebase db generate
```

Creates timestamped migration files in `drizzle/migrations/` that can be reviewed and committed.

### `rebase db migrate`

Run pending database migrations:

```bash
rebase db migrate
```

Applies all unapplied migrations to the database.

On a database that has already booted, the first migration creates tables boot
already made, so the first `db migrate` there stops on `already exists`. Record
that migration as applied instead, once:

```bash
rebase db migrate --baseline <version>
```

The version is the numeric prefix of the migration file; `db generate` prints the
command with it filled in. See
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) for a database that already
records migrations.

After that, `db migrate` applies what boot has not, and on a database
`rebase dev` serves that is less than it looks. Boot adds each new table,
column and enum value as soon as a collection changes, so by the time
`db generate` writes the migration that adds a column, the column is already
there: that `db migrate` stops on `already exists` again and names the
`--baseline <version>` that records it. Every new property means another
baseline. Record a migration only when boot made every change in it. One that
also drops, renames or narrows something holds statements boot never runs, and
recording it skips them. In development, `rebase db push` is the command that
changes the schema; keep `db generate` and `db migrate` for a database boot has
not already changed.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` runs `pg_dump`; `restore` runs `pg_restore` and, being destructive,
asks for a typed `yes` on a terminal, or takes `--yes`; with no terminal and no
`--yes` it refuses and says to pass it.
Into a database
that already holds what the backup creates, `restore` needs `--clean`. Without
it, it refuses before anything is applied, the cluster roles included, and
names the objects in the way and both ways round them: `--clean`, or
`--create-db --target-db <new name>`. On 0.24 it applied the roles and then
failed on pg_restore's `schema "rebase" already exists`.
With `--clean`
the restore is one transaction: it drops the backup's schemas with everything
in them, restores, and commits only once the whole restore has succeeded, so a
failure leaves the database as it was. Before asking, it names what it drops
that the backup does not hold. It runs `psql`, which ships with `pg_restore`.
On 0.24 a `--clean` restore into a database with a table the backup lacked, such
as Atlas's revisions table after `db migrate`, dropped everything and restored
nothing.
`restore` refuses
the managed development database: a backup carries its rows as COPY data, which
it cannot receive, and on 0.24 the restore left it hung until it was stopped.
Restore into Postgres in Docker (`rebase db restore <dump> --docker --clean --yes`),
then `rebase db pull --from "$(rebase db url --docker)" --yes` copies it into
the managed database. A backup of the managed database leaves it as it was; on
0.24 the settings `pg_dump` made stayed on it, and every API request failed
until `rebase db stop`.
Relative paths,
and the default `./backups`, resolve against the directory you run `rebase`
from, so the three lines above meet in one directory; an option a command does
not take is refused before anything runs. On 0.24 the default is
`backend/backups`, so list it with `--out ./backups`.
The dump and its roles file are readable by you only (0600), and
against a database that is not running, `backup` and `restore` print the
banner `db push` does. On 0.24 dumps are 0644.
Scheduling, the roles file that travels with each dump, and the restore procedure are in [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Copy another database into the local development one:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` takes a `postgres://` or `postgresql://` URL, or libpq's
`host=… port=… dbname=…` pairs quoted as one argument. Anything else is refused
before anything is read or started, without repeating the value.

`--anonymize` replaces personal fields on the way in, so a production copy can be
worked on locally without carrying real customer data onto a laptop. It matches
columns by name and is best-effort. A bare `name` column is replaced only on a
table of people: one called `users`, `authors`, `customers` or the like, or any
table that also holds an email address column.
A column under a unique index gets a distinct value per row, and the pass is one
transaction: if it fails, the tables it would have rewritten are emptied and
named, and the command exits 1. On 0.24 it failed on `token_hash` once users had
signed in twice, leaving real data behind.

A flag `pull`
does not take is refused before anything is read or copied, naming the one it
was probably meant to be: `--anonymise` answers "did you mean --anonymize?" and
exits 1. On 0.24 a misspelt flag was ignored, so `--anonymise`, `--anon` or
`--schem` ran the pull without it, and personal data arrived as it was.
A switch takes no value, on `pull` and on every other command: `--anonymize=false`
is refused rather than read as `--anonymize`, which is what 0.25 did. To turn a
switch off, leave it out.

`pg_dump` strips privileges, so the copy would arrive with the source's RLS
policies and none of the grants behind them — every read as `rebase_user` failing
with `permission denied`. The pull re-provisions the app role afterwards, using
the same routine boot and `rebase db push` use, so Rebase's internal tables stay
revoked as they should be.

The target is always this project's local development database and cannot be
chosen: `--database-url` is refused rather than accepted, so there is no way to
spell "pull into production". `--from` is the only direction.

A pull replaces
the local database's contents: it empties each schema it copies first, so a
table that exists only locally does not survive it. Into the managed development
database the rows travel as `INSERT` statements, which it takes where `COPY`
would stop it. On 0.24 a pull into the managed database failed at the first
table and left it answering nothing until it was killed.

### `rebase db url`

Print the connection string this project is using, and nothing else, so it
pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

The managed development database is the case that needs this: `.env` leaves
`DATABASE_URL` commented out on purpose, and the port is derived from the
project path, so nothing on disk names it.
It keeps that
port across a stop and a start, unless something else has taken it; on 0.24
every start picked a new one. When you have set a `DATABASE_URL`
of your own, that is what this prints — the resolution order is the same one
every other command follows. It starts the managed database if it is not
already running.

After
`rebase dev --docker`, `db url` and the other commands use that Docker database
(and say so on stderr) until a `rebase dev` runs without the flag. The choice is
kept in `.rebase/dev-database.json` and ranks where `--docker` does, below every
connection string. A `--docker` you type that a connection string outranks
starts no container: one line on stderr says it was ignored, names what won,
and says how to reach Docker instead. A `rebase dev --docker` outranked that
way keeps the remembered choice as it was, so once the connection string is
gone the commands follow Docker again. On 0.24 every command needs its own
`--docker`, and an outranked one still starts the container.

`rebase init`
gives each project its own compose port, from 5433–5632 by the project's path,
and `--docker` checks that what answers on it is this project's `db` container.
When another container or a Postgres outside Docker holds the port, it stops and
names it rather than logging in to someone else's database. To move the
project, change the host port of the `db` service in `docker-compose.yml`, and
`DATABASE_URL` if `.env` sets one. On 0.24 every scaffold took the first free
port from 5432, so projects made side by side could share one.

### `rebase db stop` / `rebase db reset`

For the managed development database only:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

It belongs to the project, not to the command that started it, so stopping
`rebase dev` leaves it running for the other commands. After 30 minutes with
nothing connected it stops itself, and the next command that needs it starts it
again. `rebase dev`
says so as it stops, with how to stop the database now; on 0.24 it said nothing.

`db stop` under a
running `rebase dev` says that its backend cannot reach the database until it
is back. The next command that needs it, `rebase db url` for one, starts it on
the same port, and the backend reconnects without a restart. On 0.24 it came
back on another port, and the backend answered 503 until `rebase dev` was
restarted.

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

PostgreSQL will not copy or drop a database anything else is connected to, and
the usual "anything else" is your own `rebase dev`. `create` and `delete` name
what is holding the database open; `--force` disconnects those sessions first.

Every branch is a full copy on disk, so they need clearing out. `prune` removes
three things: an entry whose database was dropped outside Rebase, a branch
database whose entry was never written, and — only with `--older-than` — branches
past an age you name. It asks before removing anything unless you pass `--yes`.
With no terminal to ask on, such as in CI, it removes nothing, says to
pass `--yes`, and exits 1; on 0.24 it says "Nothing was changed." and exits 0.
`list` and `info` only read: a database no branch was made on has none, and
they create no `rebase` schema there. On 0.24 they create the registry.

`switch` records the branch in `.rebase/branch.json` and never edits `.env`. It
takes precedence over `DATABASE_URL` in `.env` and loses to `--database-url` or a
`DATABASE_URL` in the shell, so a flag on the command line always outranks a
switch made earlier. `delete` refuses the branch you are on, since every command
in the checkout, the delete included, is pointed at it: `switch --off` first,
then delete it. The whole workflow is on [Database Branching](/docs/backend/branching/).

:::note[On the managed development database]
`push`, `generate` and `migrate` work here as on any database.
`push` and `generate` plan their work with Atlas, which needs a second
empty database to compare against — and the managed PGlite serves exactly one. So
on the managed database each of them starts a second, throwaway PGlite in memory
for Atlas, and stops it when the command ends. That is how a column is dropped,
renamed or narrowed there: `rebase dev` only ever adds. The destructive gate is the
same as everywhere. To have Atlas plan against an empty database of your own
instead, set `REBASE_ATLAS_DEV_URL` to it; Rebase neither creates nor drops a
database named that way.

`branch` is refused there. `CREATE DATABASE ... TEMPLATE`
against PGlite writes a catalog entry and copies nothing, so the branch would
resolve to the database it was cloned from — every write you meant to sandbox
would land in your development database. `rebase dev --docker` gives you a real
server that branches work against.
:::

## Related

- [CLI reference](/docs/cli/) — every other `rebase` command
- [Schema Generation](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` and `db branch` in depth
- [Backups and restore](/docs/deployment/backups/) — scheduling, the roles file, restoring
- [Database Branching](/docs/backend/branching/) — how a branch is made, and what it costs
- [Scripts and the Console](/docs/backend/scripts/) — the same database from a script or a REPL
