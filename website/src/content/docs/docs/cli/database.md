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
command with it filled in. Every `db migrate` after that is an ordinary one. See
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) for a database that already
records migrations.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` runs `pg_dump`; `restore` runs `pg_restore` and, being destructive, needs `--yes`.
<span class="since-badge" data-since="0.25">Since 0.25</span> Relative paths,
and the default `./backups`, resolve against the directory you run `rebase`
from, so the three lines above meet in one directory; an option a command does
not take is refused before anything runs. On 0.24 the default is
`backend/backups`, so list it with `--out ./backups`.
<span class="since-badge" data-since="0.25">Since 0.25</span> The dump and its roles file are readable by you only (0600), and
against a database that is not running, `backup` and `restore` print the
banner `db push` does. On 0.24 dumps are 0644.
Scheduling, the roles file that travels with each dump, and the restore procedure are in [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Copy another database into the local development one:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` replaces personal fields on the way in, so a production copy can be
worked on locally without carrying real customer data onto a laptop. It matches
columns by name and is best-effort. <span class="since-badge" data-since="0.25">Since 0.25</span>
A column under a unique index gets a distinct value per row, and the pass is one
transaction: if it fails, the tables it would have rewritten are emptied and
named, and the command exits 1. On 0.24 it failed on `token_hash` once users had
signed in twice, leaving real data behind.

`pg_dump` strips privileges, so the copy would arrive with the source's RLS
policies and none of the grants behind them — every read as `rebase_user` failing
with `permission denied`. The pull re-provisions the app role afterwards, using
the same routine boot and `rebase db push` use, so Rebase's internal tables stay
revoked as they should be.

The target is always this project's local development database and cannot be
chosen: `--database-url` is refused rather than accepted, so there is no way to
spell "pull into production". `--from` is the only direction.

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
<span class="since-badge" data-since="0.25">Since 0.25</span> It keeps that
port across a stop and a start, unless something else has taken it; on 0.24
every start picked a new one. When you have set a `DATABASE_URL`
of your own, that is what this prints — the resolution order is the same one
every other command follows. It starts the managed database if it is not
already running.

<span class="since-badge" data-since="0.25">Since 0.25</span> After
`rebase dev --docker`, `db url` and the other commands use that Docker database
(and say so on stderr) until a `rebase dev` runs without the flag. The choice is
kept in `.rebase/dev-database.json` and ranks where `--docker` does, below every
connection string. A `--docker` you type that a connection string outranks
starts no container: one line on stderr says it was ignored, names what won,
and says how to reach Docker instead. A `rebase dev --docker` outranked that
way keeps the remembered choice as it was, so once the connection string is
gone the commands follow Docker again. On 0.24 every command needs its own
`--docker`, and an outranked one still starts the container.

### `rebase db stop` / `rebase db reset`

For the managed development database only:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

It belongs to the project, not to the command that started it, so stopping
`rebase dev` leaves it running for the other commands. After 30 minutes with
nothing connected it stops itself, and the next command that needs it starts it
again. <span class="since-badge" data-since="0.25">Since 0.25</span> `rebase dev`
says so as it stops, with how to stop the database now; on 0.24 it said nothing.

<span class="since-badge" data-since="0.25">Since 0.25</span> `db stop` under a
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
<span class="since-badge" data-since="0.25">Since 0.25</span> With no terminal to ask on, such as in CI, it removes nothing, says to
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
<span class="since-badge" data-since="0.25">Since 0.25</span> `push`, `generate` and `migrate` work here as on any database.
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
