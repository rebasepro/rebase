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

From the generated Drizzle schema, `db generate` diffs against the current database state and produces timestamped SQL migration files.

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
| `--collections, -c` | Path to collections directory (default: `config/collections/`) |
| `--output, -o` | Output path for the generated schema file |
| `--watch, -w` | Watch for changes and regenerate automatically |

**Watch mode** is useful during development — edit a collection file and the schema regenerates instantly:

```bash
rebase schema generate --watch
```

### `rebase schema introspect`

Reverse-engineer collection definitions from an existing PostgreSQL database:

```bash
rebase schema introspect
```

**What it does:**
- Connects to your database (using the connection string from your `.env`)
- Inspects all tables, columns, types, and foreign keys
- Generates collection definition files

**Options:**

| Flag | Description |
|------|-------------|
| `--output, -o` | Output directory for generated collection files |

This is useful when adopting Rebase on an existing database — introspect first, then customize the generated collections.

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
- Applies your collections' RLS policies, and **removes policies an earlier push superseded**
- Does **not** create migration files

:::note[Editing a security rule renames its policy]
A rule without an explicit `name` compiles to `<table>_<op>_<hash>`, where the hash covers the rule's semantics — so *editing* a rule (rather than adding one) produces a policy under a new name and leaves the old one behind.

That used to matter a great deal: Postgres ORs `PERMISSIVE` policies together, so a superseded `USING (rebase.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was. Tightening a rule had no effect, and push reported success.

`db push` now reconciles this: it drops generated policies that no longer match any rule, and reports — without dropping — any custom-named policy your collections don't describe, since those are indistinguishable from SQL someone wrote deliberately.

To audit a database that was pushed before this landed, run `rebase doctor --policies`. It works as a CI gate: it exits non-zero on drift, and also when it could not run the check at all — no `DATABASE_URL`, a `--collections` path that does not resolve, a `pg_policies` read the CI role is not granted. A gate that could not look has not passed.
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
- Compares the Drizzle schema against the current database state
- Produces timestamped SQL migration files in the `drizzle/` directory
- Files can be reviewed, edited, and committed to version control

The generated migrations are plain SQL files — you can inspect and modify them before applying.

### `rebase db migrate`

Run all pending migrations:

```bash
rebase db migrate
```

**What it does:**
- Reads the `drizzle/` directory for unapplied migrations
- Applies them in order to the database
- Tracks which migrations have been applied

### `rebase db branch`

Database branching for parallel development:

```bash
rebase db branch create feature_auth
rebase db branch list
rebase db branch delete feature_auth
```

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

The database comparison needs `DATABASE_URL` (or `ADMIN_CONNECTION_STRING`). Without one, that phase is reported as **skipped** rather than passing, and the run never closes with "All schemas are in sync" — a check that did not happen is not a clean bill of health.

### `rebase generate-sdk`

Generate a typed client SDK from your collection definitions:

```bash
rebase generate-sdk
```

**What it does:**
- Reads collections from `config/collections/` (supports `index.ts` barrel exports or individual files)
- Generates TypeScript types for all entities in `generated/sdk/`
- Produces a `database.types.ts` file for use with `createRebaseClient<Database>()`

**Options:**

| Flag | Description |
|------|-------------|
| `-c`, `--collections-dir` | Path to the collections directory (default: `config/collections/`) |
| `-o`, `--output` | Output directory for the SDK (default: `generated/sdk/`) |
| `--from <link\|url>` | Read the schema from a running project instead of local source. `link` uses this checkout's linked project. |
| `--token` | Bearer token for the contract endpoint (default: `$REBASE_SERVICE_KEY`) |

`--from` is what lets a repository that contains no collections — a separate
frontend, a second web app, a mobile app — generate a typed client from the
project it talks to. `REBASE_SERVICE_KEY` is only sent to the project this
checkout is linked to; pass `--token` explicitly for any other host.

**Usage after generation:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
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

# 4. Review the generated SQL in drizzle/
# 5. Commit the migration to version control
git add drizzle/

# 6. Apply in production
rebase db migrate
```

## Troubleshooting

| Symptom | Solution |
|---------|----------|
| `Could not detect an active database plugin` | Install `@rebasepro/server-postgres` in `backend/package.json` |
| Schema file not updating | Check the `--collections` path points to the right directory |
| Migration shows unexpected changes | Run `rebase doctor` to identify drift |
| `db push` fails on production | Use `db generate` + `db migrate` instead |

## Next Steps

- **[Collections](/docs/collections)** — Define your data model
- **[CLI Reference](/docs/cli)** — All CLI commands
- **[Client SDK](/docs/sdk)** — Use the generated SDK
