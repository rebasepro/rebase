---
title: Schema Generation
sidebar_label: Schema Generation
description: Generate Drizzle ORM schemas from collection definitions, create SQL migrations, and keep your database in sync with the Rebase CLI.
---

## Overview

Rebase uses a **schema-as-code** pipeline where your TypeScript collection definitions are the single source of truth. The CLI transforms them through a deterministic pipeline:

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

This page covers every CLI command involved in that pipeline.

## The Pipeline

### 1. Collections → Drizzle Schema

Your collection definitions in `config/collections/` describe tables, columns, types, relations, and enums. The `schema generate` command reads these and outputs a Drizzle ORM schema file.

### 2. Drizzle Schema → Migrations

From the generated Drizzle schema, `db generate` diffs against the migrations already in `backend/drizzle/migrations/`, replayed on a scratch database, and produces timestamped SQL migration files. It never reads your database: a column boot or `db push` already added still comes out as `ADD COLUMN`.

### 3. Migrations → PostgreSQL

The `db migrate` command applies pending migrations to your PostgreSQL database.

## Commands

### `rebase schema generate`

Generate a Drizzle ORM schema file from your collection definitions:

```bash
rebase schema generate
```

**What it does:**
- Reads all collections from `config/collections/`
- Generates `backend/src/schema.generated.ts` with Drizzle table definitions, enums, and relations

**Options:**

| Flag | Description |
|------|-------------|
| `--collections, -c` | Collections directory (default: `config/collections/`); relative paths are resolved from where you run the command |
| `--output, -o` | Output path for the generated schema file; relative paths are resolved from where you run the command |
| `--watch, -w` | Watch for changes and regenerate automatically |

**Watch mode** is useful during development — edit a collection file and the schema regenerates instantly:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Check whether the generated schema still matches the collections:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**What it does:**
- Renders what the collections in `config/collections/` generate and compares it, declaration by declaration, with `backend/src/schema.generated.ts`
- Names each difference — a missing table, a retyped column, a dropped enum label, or foreign keys named the way an earlier release derived them — and exits non-zero
- With `--fix`, regenerates the file instead of reporting

`rebase dev` keeps the file current by itself, so this is the check for a build
or a CI step. It takes `--collections` and `--output` as `rebase schema generate`
does.

### `rebase schema introspect`

Reverse-engineer collection definitions from an existing PostgreSQL database:

```bash
rebase schema introspect
```

**What it does:**
- Connects to this project's database, the one `rebase db url` prints (the managed one is started if that is it); `--database-url` names another, and `--docker` uses the compose one
- Inspects all tables, columns, types, and foreign keys
- Generates collection definition files
- Reads each
  table's row-level security policies into its collection's `securityRules`:
  name, command, mode, `TO` list, `USING` and `WITH CHECK`. The
  `<table>_default_*` policies Rebase adds itself are left out. So the
  `db push` after it recreates every policy as it was. On 0.24 the policies
  stay out of the files, and a push can drop one whose name has the shape a
  generated policy has (`<table>_<op>_<hash>`)
- Reads every
  expression (a policy's `USING`, a CHECK, a column default) under the
  `search_path` the server uses, `public`, so a function in the `rebase` schema
  is written `rebase.roles()`. Connected as a role named `rebase`, the default
  path put that schema first and the rule came back as `roles()`, which the
  push could not find
- Keeps a many-to-many
  junction's policies. A junction's `<junction>_default_edge_write_*` policies
  are derived from the update rules of the collection that declares the
  relation, and a junction can inherit only a rule it can read. A role rule
  comes back as the SQL Postgres stores for it,
  `string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]`, and
  that reads as the role rule again, so the push derives the same policies.
  On 0.25.0 it read as raw SQL: the dry run
  listed the three policies as ones no collection describes, the push left them
  in force, and a later change to the rule no longer reached them
- Writes
  `disableDefaultPolicies: true` on a table that has row-level security on and
  does not hold the whole [admin baseline](/docs/collections/security-rules/#policies-a-collection-gets-without-writing-them),
  so the push adds no `<table>_default_admin_*` policy and the table's access
  stays as it was; any part of the baseline the table has is written as a rule.
  Delete the line to give the server and admins every row. A table with RLS
  off keeps the baseline, and introspection says, once, which tables those are:
  the push switches RLS on whatever a collection says. On 0.24 the push after
  an introspection added the baseline to every table
- Generates a
  table whose policies give each user their own rows (they read `rebase.uid()`,
  `app.uid` or the JWT) as an entity in the navigation, however few rows it
  has. On 0.24 a small table is a code list, and a table owned through another
  is hidden as its child
- Against a
  database that is not running, prints the same banner `db push` does, once,
  and creates nothing. It prints the output directory as an absolute path
- Leaves a
  table's CHECK and EXCLUDE constraints in the database, where the `db push`
  after it keeps them. A collection cannot declare either; a CHECK
  introspection can read (`total >= 0`) also becomes the property's
  `validation`. On 0.24 that push dropped them

**Options:**

| Flag | Description |
|------|-------------|
| `--output, -o` | Output directory for generated collection files |
| `--schema` | The Postgres schema to read (default: `public`) |
| `--force, -f` | Overwrite collection files that already exist; without it, an existing file is skipped |
| `--database-url` | Read this database instead of the project's own |
| `--docker` | Read the compose database, starting it if needed |
| `--data-inference` / `--no-data-inference` | Sample up to 100 rows per table to detect formats, constraints and UI settings, or read the structure only. Without either it asks, and without a terminal it reads the structure only |

This is useful when adopting Rebase on an existing database — introspect first, then customize the generated collections.

**Introspect, then push, changes nothing.** The generated properties say exactly what each column is — `columnType`, `precision`/`scale`, `defaultValue`, `required`, a key's `isId` (`"increment"` for an integer identity, `columnType: "serial"` for a serial, `"manual"` for a key with no default), a relation's `onDelete` — and its `index: false` where the database lacks the index Rebase would derive on the key column, since a `belongsTo` is [indexed by default](/docs/backend/indexes#foreign-keys-are-indexed-for-you). Where no index serves the column, the line says so (delete it to have one built); where another index already leads with it (`orders_customer_id_idx`, a composite, a unique one), the line names that index, and without it the push would build a second. On 0.24 it said to delete the line either way — and a collection's `search` block read back from the column it built — so `rebase db push --dry-run` right after an introspection plans no changes. The exception is a table with row-level security off: the push switches it on, and the dry run lists that and the admin baseline it adds. Where no property can state a column — a `timestamp` without time zone, an `interval`, an `inet`, an enum type not named `<table>_<column>`, a default like `CURRENT_DATE` — introspection says so, per column, on the terminal and at the top of the file, with what a push would do to it and, when there is one, the statement that makes the two agree (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). A table keyed on more than one column comes back as one composite key, every key column carrying its `isId`. It is left out, with the reason, when a key column cannot carry `isId` (a timestamp, say) or another table's foreign key points at it, which a single-column relation cannot do; `db push` leaves a table that is not a collection alone. On 0.23 the push right after an introspection can still plan type changes, dropped defaults and NOT NULLs, and a phantom `id` key.

**What the generated files look like**

Introspection writes collections against `defineCollection`, which keeps the property keys *literal* — so `propertiesOrder`, `listProperties`, `sort` and `display.title` complete over your own column names, and a key left behind by a renamed column is a compile error rather than a line that quietly does nothing. Which one it imports depends on what your project depends on, and is decided per run:

| Your project declares | Generated collections use | `admin` block |
|------|------|------|
| `@rebasepro/cms-types` (a project with the panel) | `defineCollection` from `@rebasepro/cms-types` | yes |
| `@rebasepro/common` (a `--headless` project) | `defineCollection` from `@rebasepro/common` | no |
| neither | a `PostgresCollectionConfig` annotation, with a warning | no |

A headless project has no admin panel, and the core types declare no `admin` field at all — so the block is not emitted there. It is presentation (`icon`, `propertiesOrder`, `multiline`); nothing about the schema, the API or your data depends on it.

### `rebase db push`

Push schema changes directly to the database without migration files:

```bash
rebase db push
```

**What it does:**
- Reads the generated Drizzle schema
- Applies changes directly to the database (CREATE, ALTER, DROP)
- Dry-runs the plan first and stops before anything that destroys data: a
  dropped table, column, schema, view or type, a `TRUNCATE`, or a column type
  change that can lose values (`timestamptz` → `date`, `numeric` → `integer`),
  or a primary key change — `(id)` → `(id, locale)` gives every row a new id, so
  links, foreign keys and ids stored elsewhere stop finding their row.
  It also stops
  before the drop of a CHECK or EXCLUDE constraint the database holds: no row
  is lost, but from then on the database accepts the rows it refused.
  It asks on a terminal, where Ctrl-C or Ctrl-D answers no, and refuses
  otherwise; `--allow-destructive` (or `--yes`) applies it anyway. A push that
  stops there drops its scratch `<db>_dev_diff` database on the way out
- Switches row-level security on for every collection table, junctions included, right after the
  schema change and before any step that can fail, so a push that stops part-way leaves a new table
  denying every request rather than open to it
- Applies your collections' RLS policies, and **removes policies an earlier push superseded**
- Leaves every
  CHECK and EXCLUDE constraint on a collection's table as it is. A collection
  cannot declare either, so they are the database's own rules, written by hand
  or carried by a database `schema introspect` adopted; to remove one, drop it
  by hand (`ALTER TABLE … DROP CONSTRAINT …`). Triggers and functions you wrote
  are not touched either. On 0.24 the first push after an introspection dropped
  every CHECK and EXCLUDE constraint without a prompt
- Matches the
  name of everything it leaves alone exactly, a `.`, `[`, `]` or `*` in it
  included. On 0.24 a hand-written index named like `orders_idx[v1]` was
  dropped without a prompt, and a `.` in a table's or an index's name failed
  every push with `too many parts in pattern`
- Builds any
  [foreign-key index Rebase derives](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  that an existing table is missing **before** planning, with
  `CREATE INDEX CONCURRENTLY`, so writes to the table go on during the build;
  Atlas then finds it in place. `--dry-run` names these and builds nothing
- Stamps the
  policies it applies the way the server's boot does, so the first boot after a
  push leaves them alone instead of re-creating every one
- `--dry-run`
  lists the row-level security the push would change, under "Planned
  row-level security changes": the tables it switches RLS on for, and each
  policy it creates, replaces or drops, worked out the way the push's own
  steps decide. It says "No changes" only when neither the schema nor
  row-level security would change. Where a policy's stamp does not match its
  rule, or it has none (one `db migrate` created, one written by hand), the dry
  run makes it again from its rule under another name, in a transaction it
  rolls back, and compares what Postgres stored: one that comes out the same is
  no change. So a rule `schema introspect` read back as SQL plans nothing, and
  neither do policies `db migrate` applied. Only one it could not compare (its
  table's lock not granted within two seconds, say) is listed apart. The push
  itself prints one line counting the changes. On 0.24 the dry run showed
  Atlas's plan alone, which has no policies in it
- Shows each
  statement Atlas applies once. Atlas connects without SSL to a database on this
  machine (`localhost`, `127.x`, `::1`) whose URL names no `sslmode`, as the app
  does, instead of failing on `SSL is not enabled on the server`; a URL that
  names `sslmode`, or another host, is handed over as written. An Atlas run
  that fails before it plans leaves no `<db>_dev_diff` database behind
- `--dry-run`
  writes nothing of the project's: `src/schema.generated.ts` is left as it is,
  and the `drizzle/*.sql` copies an older release committed are named, not
  deleted. Only the plan's input goes to `.rebase/sql/`, which is not committed
- Does **not** create migration files

**How long it takes.** Almost all of a push is Atlas computing the plan: it
builds your desired schema in a scratch database and diffs it against the real
one, and that cost grows faster than the number of tables — on a quiet laptop
about 0.25 s per plan at 11 tables, 0.9 s at 111 and 5.5 s at 411. A push that
changes nothing plans once; one that changes something plans twice (the dry-run
the destructive-change gate reads, then the apply). So a push on a schema of
400 or more tables takes tens of seconds, and longer on a busy or slow machine.
That time is Atlas's, not your database's: the steps around it — generating the
SQL, the RLS lock, search, triggers, policies, the role — take a few seconds at
that size, over one connection to your database.

**The files it generates on the way**, all under `.rebase/sql/` in the backend
directory. `db push` and `db generate` write all five from your collections on
every run, before reading any of them, so a committed copy would be read by
nothing. The directory carries its own `.gitignore` and is never committed.

| File | Holds |
|------|-------|
| `schema.sql` | Tables, columns, constraints and indexes — Atlas's desired state, and the only one it diffs |
| `policies.sql` | The RLS policies your `securityRules` compile to |
| `search.sql` | The full-text search functions and generated columns, for collections with a `search` block |
| `vector.sql` | pgvector extensions and ANN indexes |
| `triggers.sql` | `rebase.set_updated_at()` and the `BEFORE UPDATE` triggers behind `autoValue: "on_update"` |

Atlas manages the first and nothing else, so `db push` and the boot-time schema
ensure apply the other four themselves. A **migration-only** deployment — one
that runs `db migrate` and never `db push` — has to fold those four into a
migration by hand; `db generate` says so when a change is invisible to Atlas.

A project that committed these files to `drizzle/` under an earlier release has
those copies deleted on its first run, and the command names each one so you can
commit the deletion. It deletes only files that open with the generator's
header. A file you wrote yourself stays, and so does `drizzle/migrations/`.

:::note[Editing a security rule renames its policy]
A rule without an explicit `name` compiles to `<table>_<op>_<hash>`, where the hash covers the rule's semantics — so *editing* a rule (rather than adding one) produces a policy under a new name and leaves the old one behind.

That used to matter a great deal: Postgres ORs `PERMISSIVE` policies together, so a superseded `USING (rebase.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was. Tightening a rule had no effect, and push reported success.

`db push` now reconciles this: it drops generated policies that no longer match any rule, and reports — without dropping — any custom-named policy your collections don't describe, since those are indistinguishable from SQL someone wrote deliberately.

To audit a database that was pushed before this landed, run `rebase doctor --policies`. It works as a CI gate: it exits non-zero on drift, and also when it could not run the check at all — no `DATABASE_URL`, a `--collections` path that does not resolve, a `pg_policies` read the CI role is not granted. A gate that could not look has not passed.

`doctor` and `db push` tell the two kinds of orphan apart. A policy with a generated name was superseded, and the next push drops it. Any other name was written by hand or by another tool and is still in force: describe it in its collection's `securityRules` to keep it (Studio's RLS view imports it), or drop it by hand if it is stale. On 0.24 both are "left behind by an earlier push".
:::

:::caution
`db push` modifies the database directly. Use it only in development. For production, use `db generate` + `db migrate` to create reviewable migration files.
:::

### `rebase db generate`

Generate SQL migration files from schema changes:

```bash
rebase db generate
```

**What it does:**
- Compares the Drizzle schema against the state the migrations in `drizzle/migrations/` build, not against your database
- Produces timestamped SQL migration files in `backend/drizzle/migrations/`
- Files can be reviewed, edited, and committed to version control
- Names every
  statement in the new migration that destroys data, using the check `db push`
  runs before it applies: a dropped table, column, schema, view or type, a
  `TRUNCATE`, a column type change that can lose values, a primary key
  change, or the drop of a CHECK or EXCLUDE constraint the database holds. It
  still writes the file and exits 0, so it warns and does not refuse.
- Ends on what to
  do next: `rebase db migrate`, and for a project's first migration, the
  `--baseline <version>` a database boot has already set up needs instead. A
  later migration gets no baseline line, since a destructive one baselined would
  skip its `DROP`, and a run that writes no migration says only that.

**A CHECK a migration of yours added is dropped by the next one.** `db generate`
diffs your migration files, not the database, and Atlas has no way to leave an
object out of that diff. So a CHECK or EXCLUDE constraint that you wrote into a
migration by hand, and that no collection can declare, comes back as
`ALTER TABLE … DROP CONSTRAINT …` in the next migration it writes, folded into
the same statement as the real change. The report above names that drop when
the database already holds the constraint; it does not take it out of the
file. Delete the clause before `rebase db migrate`, or let
`rebase db migrate --refuse-destructive` stop on it. `db push` reads the
database and keeps the constraint.

The generated migrations are plain SQL files — you can inspect and modify them before applying.

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
  one. A migration was written from the collections of its day, so a policy is
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

The same happens later in the ordinary loop: edit a collection while `rebase dev` runs, and boot adds the column before `rebase db generate` writes the migration that adds it, so `rebase db migrate` stops on `column … already exists (42701)`. Baseline that migration the same way. `--baseline` works on a database that already records migrations: it marks everything up to the version as applied with `atlas migrate set`, and says so, or says there is nothing to record when the history already reaches it. On 0.24 Atlas ignores `--baseline` once any migration is recorded, so the same error comes back. A version no file in `drizzle/migrations` has is refused before anything runs, naming the versions there are.

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

Detect three-way drift between your collection definitions, the generated Drizzle schema, and the live PostgreSQL database:

```bash
rebase doctor
```

**What it checks:**
- Collections ↔ Generated schema — are they in sync?
- Generated schema ↔ Database — are there unapplied changes?
- Collections ↔ Database — is there any unexpected drift?

Run `doctor` whenever something feels out of sync. It pinpoints exactly where the mismatch is.

The database comparison includes the one boot makes before it warns that `schema.generated.ts` and the database disagree, run through the same code. So every difference boot warns about is in the report too, in the same words: a column that is NOT NULL on one side and nullable on the other, and a column the database still has that the file does not (boot never drops one, so a renamed property leaves its old column behind). Each is a warning, and the fix names `rebase db push`.

The database comparison reads the project's database, resolved the way `rebase db url` resolves it — on a fresh scaffold the managed one, which `doctor` starts. When none can be resolved, that phase is reported as **skipped** rather than passing, and the run never closes with "All schemas are in sync" — a check that did not happen is not a clean bill of health.

It also names every collection with no [`search` block](/docs/backend/search) whose table holds more than about 10,000 rows. A search there — the admin's search box, `.search()`, `?searchString=` — is `ILIKE '%term%'` over the text columns, which no index can serve, so each one reads the whole table, and its count reads it again (about a third of a second at 100,000 rows, growing with the table). The row count is Postgres's own estimate, so the check scans nothing. It is a hint: it does not change the exit code, and nothing is indexed for you.

It names an **orphaned junction**: a `public` table shaped like a many-to-many junction that no collection declares. The shape is two columns that together form the primary key, each a foreign key to a collection's table. Renaming or removing a `manyToMany` leaves its old junction behind, because push and boot only create tables, and every link row is still in it. The note is information only, so it does not change the exit code. Its fix is the `DROP TABLE` statement, which `doctor` shows and never runs.

### `rebase generate-sdk`

Generate a typed SDK from your collection definitions:

```bash
rebase generate-sdk
```

**What it does:**
- Reads every collection file in `config/collections/` — the files the backend serves, whether or not the `index.ts` barrel lists them — and stops on one that does not load
- Generates TypeScript types for all entities in `generated/sdk/`
- Produces a `database.types.ts` file for use with `createRebaseClient<Database>()`

`rebase dev` runs this for you on start and on every save under
`config/collections/`. Run it yourself in CI, in a repository that has no
collections (see `--from` below), or anywhere `rebase dev` is not running.

On 0.23 the command reads only the files the `index.ts` barrel lists, skips
one that does not load with a warning, and takes the directory as
`--collections-dir`; and `rebase dev` regenerates the schema only, so the SDK
types are yours to regenerate.

**Options:**

| Flag | Description |
|------|-------------|
| `-c`, `--collections` | Collections directory (default: `config/collections/`); relative paths are resolved from where you run the command. `--collections-dir` is accepted too. |
| `-o`, `--output` | Output directory for the SDK (default: `generated/sdk/`) |
| `--from <link\|url>` | Read the schema from a running project instead of local source. `link` uses this checkout's linked project. |
| `--token` | Bearer token for the contract endpoint (default: `$REBASE_SERVICE_KEY` from the shell; `.env` is not read) |

`--from` is what lets a repository that contains no collections — a separate
frontend, a second web app, a mobile app — generate a typed client from the
project it talks to. `REBASE_SERVICE_KEY` is only sent to the project this
checkout is linked to; pass `--token` explicitly for any other host. The key in
`.env` belongs to your local backend and is never sent.
A refusal says
which of these happened: a refused `--token`, a refused shell key, a key
withheld from a host that is not linked, a key only in `.env`, or no key at all.
On 0.24 it always says to pass `--token` or set `REBASE_SERVICE_KEY`.

**Usage after generation:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Field names in the generated types are the ones the API serves. A field's wire
name is its property key, and the API is camelCase throughout: introspection
generates a `created_at` column as a `createdAt` property carrying
`columnName: "created_at"`, and serves it as `row.createdAt`. The column itself
is untouched. The collection *accessor* is turned into a property name the same
way (`my-notes` → `client.data.myNotes`), which is what `collectionsDictionary`
maps back to the slug.

## Development Workflow

The fast-iteration workflow for development:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Production Workflow

The safe, reviewable workflow for production:

```bash
# 1. Edit your collection in config/collections/
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
| Schema file not updating | Check the `--collections` path points to the right directory |
| Migration shows unexpected changes | Run `rebase doctor` to identify drift |
| `db push` fails on production | Use `db generate` + `db migrate` instead |
| A migration must not drop data in CI or production | `rebase db migrate --refuse-destructive` exits 1 and applies nothing when a pending statement destroys data |
| `db migrate` fails with `already exists (42710)` | Boot or `db push` already provisioned the schema — record it with `rebase db migrate --baseline <version>` |
| `db migrate` fails with `column … already exists (42701)` | `rebase dev` added the column at boot — baseline that migration the same way |
| `db push` on the managed database fails with `Error: EOF` | Atlas lost a connection the running `rebase dev` holds. Run it again; if it keeps failing, stop `rebase dev` first |

## Next Steps

- **[Collections](/docs/collections)** — Define your data model
- **[CLI Reference](/docs/cli)** — All CLI commands
- **[Typed SDK](/docs/sdk)** — Use the generated SDK
