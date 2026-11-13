---
description: How to add tables and columns, or change a table, and apply it with migrations
---

# Rebase Schema Migration Workflow

This guide explains how to change your data model (add a table, a column, a
relation, change a type) and apply the change to your PostgreSQL database.

## Overview

The tables are TypeScript, in `backend/schema/`: one `defineTable` (or
`defineAuthTable` / `defineView`) per file, from `@rebasepro/server/schema`,
each exported from `backend/schema/index.ts`. Only what `index.ts` exports is
served; a table defined in a sibling file and not exported is an error. In
this repository `app/backend/schema/` is the worked example, and the authoring
types are in `packages/types/src/schema/`.

Applying a change is two steps:

1. **Tables → Drizzle schema**: `rebase schema generate` compiles
   `backend/schema/` and writes `backend/src/schema.generated.ts`.
2. **Drizzle schema → database**: apply it directly with `rebase db push`
   (development), or write a migration file with `rebase db generate` and run
   it with `rebase db migrate` (production).

The backend also applies the additive part itself at every boot, on any
database — missing tables, columns and enum types, and the RLS policies
(`REBASE_MIGRATE_ON_BOOT=ensure`, the default) — so under `rebase dev` an added
column or table needs neither step: saving the file regenerates the schema and
restarts the backend. Boot never drops, renames or narrows: that is what
`db push` and the migrations are for, and on a deployed backend
`rebase schema reconcile` (see "Removing a Column" below).

Every command that reads the tables (`schema generate`, `db generate`,
`db push`, `doctor`, `verify`, boot) compiles them first and stops with a
`SchemaDefinitionError` listing every problem, each with the table, the column
and what to write instead. `rebase verify` is the fast check after an edit.
All of them take `--schema-dir <dir>` for a schema directory other than
`backend/schema` (or `rebase.json`'s `apps.<backend>.tables`).

```mermaid
graph LR
    A[backend/schema/*.ts] -->|rebase schema generate| B[schema.generated.ts]
    B -->|rebase db push| C[(Dev Database)]
    B -->|rebase db generate| D[./drizzle/migrations/*.sql]
    D -->|rebase db migrate| E[(Prod Database)]
```

## Quick Start (Development)

For rapid development, use `rebase db push` which applies changes directly without migration files:

```bash
# 1. Edit the table in backend/schema/ (add a column, a relation, …)
# 2. Check it compiles
// turbo
rebase verify
# 3. Regenerate the Drizzle schema
// turbo
rebase schema generate

# 4. Push changes directly to database (prints the SQL first with --dry-run)
// turbo
rebase db push
```

> [!TIP]
> Use `rebase db push` during development for fast iteration. It directly syncs your schema to the database without creating migration files.

## Production Workflow (With Migrations)

For production deployments, use migrations for version-controlled, reviewable changes:

### 1. Change the table

Edit the table's file, e.g. `backend/schema/posts.ts`:

```typescript
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { authors } from "./authors";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        // A new column. Nullable unless `.notNull()`; a NOT NULL column added
        // to a table that has rows needs a default.
        excerpt: col.text().validate({ max: 300 }),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    relations: {
        author: rel.belongsTo(() => authors)
    },
    rls: "admin-only"
});
```

The column's key is its name on the wire and in the SDK; its SQL name is the
snake_case of the key (`createdAt` → `created_at`) unless the builder's
leading argument says otherwise (`col.text("name")`, as in Drizzle). How the column looks in the CMS — its label, a multiline
editor, enum colours — is not here: it goes in `frontend/src/cms/posts.tsx`
with `customizeTable<typeof posts>("posts", { fields: { … } })`, and needs no
migration.

### 2. Generate the Drizzle Schema

```bash
// turbo
rebase schema generate
```

### 3. Generate SQL Migration Files

```bash
// turbo
rebase db generate
```

This creates timestamped `.sql` files in `./drizzle/migrations`. **Review them before applying!**

### 4. Apply Migrations

```bash
rebase db migrate
```

`rebase db migrate --refuse-destructive` dry-runs the pending files and applies
nothing when one drops or narrows data. A database the backend has already
booted against needs `--baseline <version>` once, because boot already created
the tables the first migration would create.

> [!WARNING]
> Always backup your database before running migrations in production!

## Quick Reference

| Command | Description | When to Use |
|---------|-------------|-------------|
| `rebase verify` | Compile the tables; report what the server would refuse; check `frontend/src/cms` against them (`cms-*`) | After every edit, CI |
| `rebase schema generate` | `backend/schema` → Drizzle schema | Always first step |
| `rebase schema introspect` | DB → `defineTable` files in `backend/schema` | Adopting an existing database |
| `rebase db push` | Apply schema directly to DB | Development |
| `rebase db generate` | Create SQL migration files | Production prep |
| `rebase db migrate` | Run pending migrations | Production deploy |
| `rebase db backup` | Snapshot before a risky change | Before destructive pushes |
| `rebase doctor` | Report table ↔ database drift | Debugging, CI |
| `rebase migrate collections-to-tables` | Move a project from `config/collections` to `backend/schema`; read its "Review before deploying" section, then `rebase db push --dry-run` and `rebase doctor --policies` must show no difference | Once, on upgrade |

## Common Scenarios

### Adding a New Column

```bash
# Development
rebase schema generate && rebase db push

# Production
rebase schema generate && rebase db generate && rebase db migrate
```

### Removing a Column, or Making One Nullable

Boot never relaxes a constraint or drops a column. Dropping `.notNull()`
leaves the column `NOT NULL`, and removing a column from `columns` leaves it
behind with its data. If that column was `NOT NULL` with no default, every
insert then fails on a field nobody can send. Boot reports both on every start.

`rebase schema reconcile` is the reviewed step for these, and it works on
Rebase Cloud too, because it runs through the deployed backend rather than a
database URL:

```bash
# 1. Deploy the table change first. Reconcile plans against what the backend runs.
# 2. Review and apply: relaxes NOT NULL on nullable columns, and on undeclared columns that
#    block inserts (their data stays), and lists every undeclared column.
rebase schema reconcile
# 3. Drop a column no table declares. Name each one. The plan shows how many rows hold a value.
rebase schema reconcile --drop voice_cache.wav
```

It prints the plan and applies it only after you type `yes`. The server runs
the plan only on the digest of the plan you read, so if anything changed in
between it refuses and shows the new plan. It needs `REBASE_SERVICE_KEY` in
`.env`. Agents: show the human the plan and let them run the `--drop`. Never
pass `--yes` on their behalf.

Locally, `rebase db push` does the same through its destructive-change gate.

### Changing a Column Type

> [!CAUTION]
> Changing existing column types may cause data loss. Review the generated migration carefully!

1. Change the builder (`col.integer()` → `col.bigint({ mode: "number" })`, `col.varchar({ length: 100 })` → `col.text()`, …)
2. Run `rebase schema generate` → `rebase db generate`
3. **Review the migration SQL** for any `ALTER COLUMN` or `DROP COLUMN` statements
4. Run `rebase db migrate` only if you're satisfied with the changes

Renaming a column's key renames the SQL column too, which `db push` plans as a
drop and an add. To rename only the wire name, keep the SQL name as the
builder's leading argument: `col.text("old_name")`.

### Adding a New Table

1. Create `backend/schema/<table>.ts` with `export const <name> = defineTable("<name>", { columns, rls })`.
   At least one column is `.primaryKey()`, and `rls` is required:
   `"admin-only"` until you have decided who may read it, `"inherit"` for the
   `defaultRls` that `index.ts` exports, or a list of rules.
2. Export it from `backend/schema/index.ts`: `export { <name> } from "./<table>";`.
   The order of the exports is the order the CMS lists the tables in until a
   customization says otherwise.
3. Run `rebase schema generate` → `rebase db push` (dev) or `rebase db generate` → `rebase db migrate` (prod)
4. Optionally, `frontend/src/cms/<table>.tsx` with `customizeTable`, added to
   `<RebaseCMS tableCustomizations>`. Without it the table is shown as derived.

To remove a table, delete its file and its export.

### Adding Relations

Relations are `rel.*` calls under the table's `relations`, keyed by the
relation's name. The target is a thunk, `() => users`, so two tables may point
at each other in either import order, with no type annotation.

```typescript
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { authors } from "./authors";
import { tags } from "./tags";
import { comments } from "./comments";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        // Bound: the column whose SQL name is the relation's `localKey`
        // (`author_id`) holds the key. Leave it out and the relation derives it.
        authorId: col.uuid().notNull()
    },
    relations: {
        // This table holds the key.
        author: rel.belongsTo(() => authors),
        // The target holds a key pointing here (`comments.post_id`).
        comments: rel.hasMany(() => comments),
        // Both sides hold many: a junction table `posts_tags` is created for you.
        tags: rel.manyToMany(() => tags)
    },
    rls: "admin-only"
});
```

The kind is the only thing you have to choose. Everything else defaults:

| Kind | Where the foreign key lives | What `schema generate` emits |
|---|---|---|
| `rel.belongsTo` | this table | a `<singular relation name>_id` column here (`author` → `author_id`, served as `authorId`), bound to a column you declared with that SQL name or derived; its index; the `FOREIGN KEY` — override with `localKey`, `notNull`, `unique`, `onDelete`, `index: false`, `constraint: false` |
| `rel.hasOne` | the target's table, unique | nothing here; the target declares the `belongsTo` — `foreignKey` names its column |
| `rel.hasMany` | the target's table | nothing here; the target declares the `belongsTo` — `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | a junction table | the junction, its two key columns and its own RLS — override with `through`, `sourceKey`, `targetKey`; extra junction columns with `pivot` (read and written as `_pivot`) |
| `rel.via` | an explicit `steps` join chain | nothing — read-only except the two shapes that stand in for `hasOne` / `manyToMany`; `cardinality` is `"many"` unless `"one"` |

A relation and a column may not share a key: the relation's key is what
`include` names, so the foreign-key column takes another key (`authorId`, not
`author`). `onDelete` defaults to `restrict` for a `NOT NULL` key, `set null`
otherwise, and `cascade` for a junction link. Every kind takes
`access: { read?, write? }` and `private: true`, the way a column does. See
`packages/types/src/schema/relations.ts`.

Changing a relation's name renames a derived foreign-key column; changing a
table's `slug` renames the junction and back-reference columns derived from
it. Both are drops and adds to `db push`. Write `localKey` / `foreignKey` /
`through` to keep the existing names.

## Important Notes

### Unmapped Tables Are Never Touched

`rebase db push` applies the schema with **Atlas**, which works from a desired
state — so anything in the database and absent from that state is a candidate
for a drop. Three layers stop that from reaching a table Rebase does not own:

1. **A computed `--exclude` list.** Before applying, the CLI introspects the
   database and excludes every table that is not declared in `backend/schema`, plus the
   search functions, indexes and triggers Rebase creates itself (Atlas cannot
   manage those, so it would plan a drop for each one).
2. **That list fails closed.** If the introspection cannot run, the push
   *aborts* — `✗ Aborting push: could not determine which tables to protect` —
   rather than applying with a partial list.
3. **A destructive-change gate.** The apply is preceded by a `--dry-run`; any
   destructive statement in the plan is printed and then either prompted for
   (interactive) or refused (non-interactive). `--allow-destructive` — or
   `--yes` — is the only way past it. Destructive means `DROP TABLE`/`COLUMN`/
   `SCHEMA`/`VIEW`/`TYPE`, `TRUNCATE`, and an `ALTER COLUMN … TYPE` that can
   lose values: `timestamptz` → `date` drops the time of day, `numeric` →
   `integer` rounds. Only widenings every value survives pass without asking —
   the same type with a modifier at least as wide (`varchar(100)` →
   `varchar(255)`, `numeric(10,2)` → `numeric`), `smallint` → `integer` →
   `bigint` (or a `numeric` with room for their digits), and `varchar(n)` →
   `text`. A column push cannot find in the database is gated too. So is a
   **primary key change** — `(id)` → `(id, locale)` plans as `DROP CONSTRAINT
   "<table>_pkey", ADD PRIMARY KEY (…)`, which gives every row a new id; a new
   table's own `PRIMARY KEY` is not a change and passes.

So you can safely keep additional tables in the same database (other
applications, legacy systems, manual SQL) and Rebase will not modify or drop
them.

### Introspecting a Database

To adopt an existing database, use:
`rebase schema introspect`

This writes one `defineTable(...)` module per table into `backend/schema/`
(or `--schema-dir <dir>`), and adds an export line to `index.ts` for each, from the
tables, columns, keys and foreign keys in the database. Every table it writes
says `rls: "admin-only"`: write the real rules before anyone but an admin
needs the rows.

## Troubleshooting

### "DATABASE_URL is not set"

A scaffolded project leaves `DATABASE_URL` unset on purpose: `rebase dev` and
the `rebase db` commands find the managed development database (PGlite, under
`.rebase/`) themselves, and `rebase db url` prints the one in use. Set it only
for a PostgreSQL of your own — in the project root's `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/rebase
```

### Migration Already Applied

If you see errors about migrations already existing:
- Check the `./drizzle/migrations` folder for existing migration files
- Clean up old migrations if needed
- Use `rebase db push` for development to avoid migration file buildup

### Tables Being Dropped Unexpectedly

The destructive-change gate prints the planned SQL before anything is applied,
so read that first — it names every drop, and every type change that can lose
values with the column's old and new type. If a table you did not expect appears
in it:
- Check the table's name, `table` and `slug` — a renamed table reads as "drop
  the old one, create a new one", which is a data-losing rename. Keep the SQL
  name with `table: "old_name"`.
- Re-run without `--allow-destructive` / `--yes` so the gate prompts instead of
  applying.
- Take a backup first: `rebase db backup`.

