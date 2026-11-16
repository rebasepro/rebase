---
title: Schema Generation
sidebar_label: Schema Generation
description: Generate Drizzle ORM schemas from the tables in backend/schema, create SQL migrations, introspect an existing database into defineTable files, and keep your database in sync with the Rebase CLI.
---

## Overview

Rebase uses a **schema-as-code** pipeline where the tables you declare with
`defineTable` in `backend/schema/` are the single source of truth. The CLI
transforms them through a deterministic pipeline:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

This page covers every CLI command involved in that pipeline.

## The Pipeline

### 1. Tables → Drizzle Schema

The tables `backend/schema/index.ts` exports describe columns, types, relations,
enums and row-level security. Every command below reads them through the loader
the backend boots from, so a schema that does not compile — a table with no
`rls`, `"inherit"` with no `defaultRls`, a `defineTable` the index does not
export — stops the command with a `SchemaDefinitionError` naming each problem,
and nothing is written. The `schema generate` command outputs a Drizzle ORM
schema file from them.

Every command that reads the schema takes `--schema-dir <dir>` for a project
that keeps its tables somewhere else; the default is `backend/schema`, or the
`tables` key of the backend app in `rebase.json`. `--collections` / `-c`, the
pre-0.31 flag, is refused with a message naming the codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), and so is a
project that still has `config/collections`.

### 2. Drizzle Schema → Migrations

`db generate` renders the declared tables, policies, functions, indexes,
triggers and views into Ptah's desired SQL. Ptah compares that SQL with the
migrations in `backend/drizzle/migrations/`, replayed on a scratch database,
and writes a timestamped migration. Rebase also reads the target database to
protect objects it does not own. A column already added by boot or `db push`
still appears in the migration because the diff starts from migration history.

### 3. Migrations → PostgreSQL

The `db migrate` command applies pending migrations to your PostgreSQL database.

## Commands

### `rebase schema generate`

Generate a Drizzle ORM schema file from your tables:

```bash
rebase schema generate
```

**What it does:**
- Reads the tables `backend/schema/index.ts` exports
- Generates `backend/src/schema.generated.ts` with Drizzle table definitions, enums, and relations

**Options:**

| Flag | Description |
|------|-------------|
| `--schema-dir` | The schema directory (default: `backend/schema`); relative paths are resolved from where you run the command |
| `--output, -o` | Output path for the generated schema file; relative paths are resolved from where you run the command |
| `--watch, -w` | Watch for changes and regenerate automatically |

**Watch mode** is useful during development — edit a table file and the schema regenerates instantly:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Check whether the generated schema still matches the tables:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**What it does:**
- Renders what the tables in `backend/schema/` generate and compares it, declaration by declaration, with `backend/src/schema.generated.ts`
- Names each difference — a missing table, a retyped column, a dropped enum label, or foreign keys named the way an earlier release derived them — and exits non-zero
- With `--fix`, regenerates the file instead of reporting

`rebase dev` keeps the file current by itself, so this is the check for a build
or a CI step. It takes `--schema-dir` and `--output` as `rebase schema generate`
does.

### `rebase schema reconcile`

Relax and drop what boot will not, after you have read the plan:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**What it does:**
- Asks the running backend to plan against its own database. That's the backend `.env` and the cloud link point at, so it works on Rebase Cloud, where nothing else reaches the database.
- Plans `DROP NOT NULL` for every column a table declares nullable that the database still requires.
- Lists every column no table declares. One that is `NOT NULL` with no default blocks every insert, so it is relaxed too, and its data stays. It drops only the columns you name with `--drop <table>.<column>`, and shows how many rows hold a value in each.
- Applies once you type `yes`. The server runs the plan only on the digest of the one you read, so if the database or the tables changed in between, it refuses and you review again. `--yes` skips the prompt.

Boot only ever adds, so after you remove a column from its `defineTable` its column stays in the database, with its data. A `NOT NULL` column with no default then makes every insert fail, and boot's log names this command for it: without `--drop` to keep the data, with it to remove the column. Deploy the table change first, because reconcile plans against what the backend runs. It needs `REBASE_SERVICE_KEY` in `.env`. Locally, `rebase db push` covers the same through its destructive-change gate.

### `rebase schema introspect`

Write `defineTable` files from an existing PostgreSQL database:

```bash
rebase schema introspect
```

**What it does:**
- Connects to this project's database, the one `rebase db url` prints (the managed one is started if that is it); `--database-url` names another, and `--docker` uses the compose one
- Reads every table, column, type, foreign key and policy, and writes
  `backend/schema/<table>.ts` — one `defineTable` per table — and the
  `backend/schema/index.ts` that exports them (merged into an index that is
  already there)
- Declares each column with its Postgres type: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, an enum with its labels and real type name
  (a `pgEnum` when the type is shared), an array as `<item>.array()`,
  `col.vector({ dimensions })`, identity and serial keys, defaults — spelled as
  Drizzle spells them. A type no builder names becomes
  `col.custom({ dataType: "<sql type>" })`, which Rebase serves as the
  driver returns it; `db generate` and `db push` refuse it until the planner
  can plan it
- Declares the foreign-key column, the `belongsTo` on it and the reverse
  `hasMany` on the target; a junction table becomes a `manyToMany`, its own
  columns the `pivot`
- Reads each table's row-level security policies into its `rls`: name,
  command, mode, `TO` list, `USING` and `WITH CHECK`. The `<table>_default_*`
  policies Rebase adds itself are left out, so the `db push` after it recreates
  every policy as it was. A table with row-level security on and no policy is
  written `rls: "admin-only"`
- Reads every expression (a policy's `USING`, a CHECK, a column default) under
  the `search_path` the server uses, `public`, so a function in the `rebase`
  schema is written `rebase.roles()`
- Turns a CHECK it can read (`total >= 0`) into the column's `.validate()`, and
  leaves the constraint itself in the database, where the push after it keeps
  it
- Puts what it could not state exactly in a comment at the top of the table's
  file and on the terminal — a closed set of strings on a text column, a
  generated column whose expression it did not read, a custom type — with what
  a push would do to it
- With `--data-inference`, samples up to 100 rows per table and writes what it
  found that is presentation — titles, icons, boards, sorts, field options — to
  `frontend/src/cms/<table>.tsx` as a `customizeTable`, when the project's
  frontend depends on `@rebasepro/cms`. A headless project gets none
- Against a database that is not running, prints the same banner `db push`
  does, once, and creates nothing. It prints the output directory as an
  absolute path

**Options:**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Where to write the table files (default: `backend/schema`). `--output` was removed |
| `--schema` | The Postgres schema to read (default: `public`) |
| `--force, -f` | Overwrite table files that already exist; without it, an existing file is skipped |
| `--database-url` | Read this database instead of the project's own |
| `--docker` | Read the compose database, starting it if needed |
| `--data-inference` / `--no-data-inference` | Sample up to 100 rows per table to detect formats, constraints and panel settings, or read the structure only. Without either it asks, and without a terminal it reads the structure only |

This is useful when adopting Rebase on an existing database — introspect
first, then edit the generated tables. A table with row-level security off is
written like any other, with its `rls`; the push switches RLS on, and the dry
run says so. A backend that runs with no `backend/schema` at all serves the
database directly instead — see [Backend only](/docs/getting-started/headless/).

### `rebase db push`

Apply the declared schema directly to the database:

```bash
rebase db push
rebase db push --dry-run
```

Rebase renders the declared tables, policies, functions, search and vector
indexes, triggers, and views into one desired SQL file. Ptah Compat plans and
applies those objects together. The plan is limited to Rebase's declarations.
Unrelated tables, views, extensions, and functions stay outside it. Custom
policies, triggers, indexes, CHECK constraints, and EXCLUDE constraints on a
declared table are protected too.

The command shows the plan before applying it. A destructive change, including
`DROP EXTENSION`, requires confirmation or `--allow-destructive`. `--dry-run`
shows the plan without changing the database or writing a migration. After
Ptah applies the plan, Rebase enables row-level security, provisions its auth
tables and request roles, and records the schema version. Missing derived
foreign-key indexes are built concurrently before the apply.

On a shared external PostgreSQL server, migration replay requires the explicit
`PTAH_TRUST_REPLAY_SQL=1` opt-in described in
[configuration](/docs/getting-started/configuration/). Managed PGlite uses a
disposable dev server and needs no trust opt-in.

Both `db push` and `db generate` refresh `.rebase/sql/` from the current
schema. The directory is ignored by Git.

| File | Purpose |
|------|---------|
| `schema.sql` | Ptah's desired state for declared application objects |
| `ptah-managed.json` | The objects Rebase allows Ptah to plan |
| `policies.sql`, `search.sql`, `vector.sql` | Inputs still used by boot and recovery |
| `triggers.sql`, `views.sql` | Inputs still used by boot and recovery |

The sidecar files are not appended to new migrations or applied as a second
part of `db push`. Ptah plans their declared objects through `schema.sql`.
A project that committed generated SQL copies to `drizzle/` under an earlier
release can delete those copies; `drizzle/migrations/` stays intact.

A policy whose name Rebase generated is removed when its rule is superseded.
A custom-named policy stays in force. Use `rebase doctor --policies` to audit
policy drift. If a custom policy should belong to Rebase, declare it in the
table's `rls`.

:::caution
`db push` modifies the database directly. Use it in development. For
production, create a reviewable migration with `db generate` and apply it with
`db migrate`.
:::

### `rebase db generate`

Create a timestamped SQL migration from the declared schema:

```bash
rebase db generate
```

Ptah compares the desired SQL with the state built by replaying
`backend/drizzle/migrations/`. The diff starts from that history, not from the
live database. Rebase still reads the live database to identify objects it
does not own. A column already added by boot or `db push` therefore still
appears in the generated migration.

The command writes the migration to `backend/drizzle/migrations/`, warns about
destructive statements, and names the next `db migrate` command. It also names
`--baseline <version>` when a database has already been provisioned by boot
or `db push`. A run with no diff writes no migration.

Review each generated file before applying it. Rebase cannot infer ownership
from arbitrary SQL added to a migration that the live database has not
applied.

### `rebase db migrate`

Run all pending migrations:

```bash
rebase db migrate
```

**What it does:**
- Reads `drizzle/migrations/` for unapplied migrations
- Applies them in order to the database
- Tracks which migrations have been applied
- Stamps the
  row-level security policies the way `db push` and the server's boot do, so
  the first boot after a migrate leaves them alone instead of re-creating every
  one. A migration was written from the tables of its day, so a policy is
  stamped only when it is exactly what its rule makes now: migrate makes it
  again from its rule under another name, in a transaction it rolls back, and
  compares what Postgres stored, as `db push --dry-run` does. A policy that
  differs gets no stamp, and the next boot re-applies its table

`--refuse-destructive`
makes it refuse instead. It dry-runs the pending migrations first. If any
statement destroys data, by the same check `db push` and `db generate` use, it
lists those statements and exits 1. It applies nothing, not even the files
before that statement. Without the flag, `db migrate` behaves as before and
applies every pending file:

```bash
rebase db migrate --refuse-destructive
```

A migration that rebuilds a search column drops it first, so this flag refuses
that migration too. Read the list it prints, then run `rebase db migrate`
without the flag to apply it.

#### Baselining a database Rebase has already booted

Every Rebase boot ensures the schema, and `rebase db push` applies it directly. So a database that has ever run either one already has the tables and types the first migration would create, and `rebase db migrate` stops on `pq: type "posts_status" already exists (42710)`.

Nothing is wrong with the migration — the database was provisioned another way. Record where it already is, then migrate normally:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

The version is the numeric prefix of the migration file that describes what is in the database *now*. That migration and everything before it are recorded as applied; everything after it runs. On a database nothing has ever booted against, no baseline is needed — migrate straight away.

The same happens later in the ordinary loop: edit a table while `rebase dev` runs, and boot adds the column before `rebase db generate` writes the migration that adds it, so `rebase db migrate` stops on `column … already exists (42701)`. Baseline that migration the same way. `--baseline` works on a database that already records migrations: it marks everything up to the version as applied with `ptah-compat migrate set`, and says so, or says there is nothing to record when the history already reaches it. A version no file in `drizzle/migrations` has is refused before anything runs, naming the versions there are.

### `rebase db branch`

Database branching for parallel development:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (and `switch --off`) and `rebase db branch prune`
are new. `create`, `list`, `info` and `delete` shipped in 0.17.

Each branch is a full copy of the database made with `CREATE DATABASE ... TEMPLATE`,
so it needs a real PostgreSQL server and it costs the same disk as its source.

### `rebase doctor`

Detect three-way drift between your tables, the generated Drizzle schema, and the live PostgreSQL database:

```bash
rebase doctor
```

**What it checks:**
- Tables ↔ Generated schema — are they in sync?
- Generated schema ↔ Database — are there unapplied changes?
- Tables ↔ Database — is there any unexpected drift?

Run `doctor` whenever something feels out of sync. It pinpoints exactly where the mismatch is.

The database comparison includes the one boot makes before it warns that `schema.generated.ts` and the database disagree, run through the same code. So every difference boot warns about is in the report too, in the same words: a column that is NOT NULL on one side and nullable on the other, and a column the database still has that the file does not (boot never drops one, so a renamed property leaves its old column behind). Each is a warning, and the fix names `rebase db push`.

The database comparison reads the project's database, resolved the way `rebase db url` resolves it — on a fresh scaffold the managed one, which `doctor` starts. When none can be resolved, that phase is reported as **skipped** rather than passing, and the run never closes with "All schemas are in sync" — a check that did not happen is not a clean bill of health.

It also names every table with no [`search` block](/docs/backend/search) whose table holds more than about 10,000 rows. A search there — the admin's search box, `.search()`, `?searchString=` — is `ILIKE '%term%'` over the text columns, which no index can serve, so each one reads the whole table, and its count reads it again (about a third of a second at 100,000 rows, growing with the table). The row count is Postgres's own estimate, so the check scans nothing. It is a hint: it does not change the exit code, and nothing is indexed for you.

It names an **orphaned junction**: a `public` table shaped like a many-to-many junction that no table declares. The shape is two columns that together form the primary key, each a foreign key to a declared table. Renaming or removing a `manyToMany` leaves its old junction behind, because push and boot only create tables, and every link row is still in it. The note is information only, so it does not change the exit code. Its fix is the `DROP TABLE` statement, which `doctor` shows and never runs.

### `rebase generate-sdk`

Generate a typed SDK from your tables:

```bash
rebase generate-sdk
```

**What it does:**
- Reads the tables `backend/schema/index.ts` exports, through the loader the backend boots from, so the SDK describes exactly the tables served; a schema that does not compile stops it
- Generates TypeScript types for every table in `generated/sdk/`
- Produces a `database.types.ts` file for use with `createRebaseClient<Database>()`: the `Database` type, `TableName` (the union of every slug), and `tablesDictionary` / `TablesDictionary`, the map from accessor to slug

`rebase dev` runs this for you on start and on every save under
`backend/schema/`. Run it yourself in CI, in a repository that has no
tables of its own (see `--from` below), or anywhere `rebase dev` is not running.

**Options:**

| Flag | Description |
|------|-------------|
| `--schema-dir` | The schema directory (default: `backend/schema`, or the `tables` key in `rebase.json`); relative paths are resolved from where you run the command |
| `-o`, `--output` | Output directory for the SDK (default: `generated/sdk/`) |
| `--from <link\|url>` | Read the schema from a running project instead of local source. `link` uses this checkout's linked project. |
| `--token` | Bearer token for the contract endpoint (default: `$REBASE_SERVICE_KEY` from the shell; `.env` is not read) |
| `--register` | Also type server-side data: write the types and a `Register` declaration to `backend/generated/`, and remember it in `rebase.json` — see [Typed server-side data](/docs/backend/typed-server-data/) |

`--from` is what lets a repository that contains no tables — a separate
frontend, a second web app, a mobile app — generate a typed client from the
project it talks to: it reads the `tables` of the running backend's
`/api/meta/contract`. `REBASE_SERVICE_KEY` is only sent to the project this
checkout is linked to; pass `--token` explicitly for any other host. The key in
`.env` belongs to your local backend and is never sent.
A refusal says
which of these happened: a refused `--token`, a refused shell key, a key
withheld from a host that is not linked, a key only in `.env`, or no key at all.

**Usage after generation:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Field names in the generated types are the ones the API serves. A field's wire
name is its column key, and the API is camelCase throughout: introspection
writes a `created_at` column as `createdAt: col.timestamp({ withTimezone: true })`, whose SQL name
is the snake_case of the key, and serves it as `row.createdAt`. The column
itself is untouched. The table *accessor* is turned into a property name the
same way (`my-notes` → `client.data.myNotes`), which is what `tablesDictionary`
maps back to the slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` moves `config/collections` to
`backend/schema` (one `defineTable` per collection, every column explicit at
its original position, in the Drizzle spelling, and `index.ts` with
`defaultRls`) and `frontend/src/cms` (a `customizeTable` per customized
collection, `defineFirestoreCollection` files, `ui-config.json`), writes
`backend/resources.ts`, `backend/storage.ts` and `backend/generated/register.ts`,
adds `rebaseBackendGuard()` to a scaffold's `vite.config.ts`, then runs
`rebase migrate sdk-calls`, which rewrites `.collection(` to `.table(`, the
other SDK renames and the rule sources `existsIn` / `membership` in your code,
and moves the imports of names 0.31 moved to another package
([the list](/docs/upgrading/0-30-to-0-31-imports/)), adding the package to the
importer's dependencies ("Dependencies added": run `pnpm install`). Bump every `@rebasepro` package to 0.31 before running it.
Every run reads the result back: the generated SQL — DDL, policies, search,
vector, triggers, views, the Drizzle schema — must be byte-identical, or every
file is put back. What it cannot carry is refused with its file and line, and
what it leaves to you is printed as numbered manual steps, ending with
`rebase skills install` when the project holds agent skills. Your own modules in
`config/` stay; the run prints the `git rm` line for what it replaced. It also
follows Firestore collections a function builds, path aliases, a panel mounted
outside `App.tsx` and every unguarded static app ([the full list](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
After the `git rm`, `--check` reports `already-migrated`.

| Flag | Effect |
|---|---|
| `--dry-run` | Print files, refusals, notes and manual steps; write nothing. Start here. |
| `--check` | On a migrated project: prove `backend/schema` still renders the same SQL. Exits 1 with the diff, or while a rule changes meaning. |
| `--accept-rule-changes` | With `--check`: the rules under "Review before deploying" were reviewed. |
| `--json` / `--force` / `--skip-sdk-calls` | The report as JSON (with `ruleChanges`); run on a dirty tree or over edited output; leave your code alone. |

Read two lists in its SDK output: **"Rewritten by name — review"** (untyped
receivers, data slots, test doubles) and **"Left unchanged — check each"**
(rename those that are the SDK; [a search](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) finds the rest).

The SQL check proves the conversion faithful, not that a rule still means what
it did. The last section of the output, **"Review before deploying: these rules
change meaning"**, lists every rule whose policy now grants something different
— a bare `access: "authenticated"` granted nothing and admits every signed-in
caller now ([the four shapes](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Then check against your database: `rebase db push --dry-run` should print "No
changes: the database already matches these tables.", and
`rebase doctor --policies` no drift.

## Development Workflow

The fast-iteration workflow for development:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Production Workflow

The safe, reviewable workflow for production:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Troubleshooting

| Symptom | Solution |
|---------|----------|
| `Could not detect an active database plugin` | Install `@rebasepro/server-postgres` in `backend/package.json` |
| Schema file not updating | Check the `--schema-dir` path (or the `tables` key in `rebase.json`) points to the right directory |
| Migration shows unexpected changes | Run `rebase doctor` to identify drift |
| `db push` fails on production | Use `db generate` + `db migrate` instead |
| A migration must not drop data in CI or production | `rebase db migrate --refuse-destructive` exits 1 and applies nothing when a pending statement destroys data |
| `db migrate` fails with `already exists (42710)` | Boot or `db push` already provisioned the schema — record it with `rebase db migrate --baseline <version>` |
| `db migrate` fails with `column … already exists (42701)` | `rebase dev` added the column at boot — baseline that migration the same way |

## Next Steps

- **[Tables](/docs/schema/)** — Define your data model
- **[CLI Reference](/docs/cli)** — All CLI commands
- **[Typed SDK](/docs/sdk)** — Use the generated SDK
