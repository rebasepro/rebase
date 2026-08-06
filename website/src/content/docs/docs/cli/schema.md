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

To audit a database that was pushed before this landed, run `rebase doctor --policies`. It exits non-zero on drift, so it works as a CI gate.
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

### `rebase db studio`

Open Drizzle Studio to browse and edit your database visually:

```bash
rebase db studio
```

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
| `--collections` | Path to collections directory |
| `--output` | Output directory for the SDK (default: `generated/sdk/`) |

**Usage after generation:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import type { Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

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
