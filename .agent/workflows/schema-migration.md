---
description: How to add new properties or make schema changes with database migrations
---

# Rebase Schema Migration Workflow

This guide explains how to modify your data model (add properties, change collections, etc.) and apply those changes to your PostgreSQL database.

## Overview

Rebase uses a **two-step schema generation process**:

1. **Rebase Collections → Drizzle Schema**: The `rebase schema generate` command reads your Rebase collection definitions and generates a Drizzle ORM schema file.
2. **Drizzle Schema → Database**: Either apply directly with `rebase db push` (development) or generate migration files with `rebase db generate` (production).

```mermaid
graph LR
    A[config/collections/*.ts] -->|rebase schema generate| B[schema.generated.ts]
    B -->|rebase db push| C[(Dev Database)]
    B -->|rebase db generate| D[./drizzle/*.sql]
    D -->|rebase db migrate| E[(Prod Database)]
```

## Quick Start (Development)

For rapid development, use `rebase db push` which applies changes directly without migration files:

```bash
# 1. Modify your collection (add property, relation, etc.)
# 2. Regenerate the Drizzle schema
// turbo
rebase schema generate

# 3. Push changes directly to database
// turbo
rebase db push
```

> [!TIP]
> Use `rebase db push` during development for fast iteration. It directly syncs your schema to the database without creating migration files.

## Production Workflow (With Migrations)

For production deployments, use migrations for version-controlled, reviewable changes:

### 1. Modify Your Collection Definitions

Edit your collection file (e.g., `config/collections/posts.ts`):

```typescript
import { PostgresCollection } from "@rebasepro/types";

const postsCollection: PostgresCollection = {
    name: "Posts",
    singularName: "Post",
    slug: "posts",
    table: "posts",
    properties: {
        // ...existing properties
        
        // NEW: Add your new property
        published_at: {
            name: "Published At",
            type: "date",
            mode: "date",
            clearable: true
        }
    }
};

export default postsCollection;
```

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

This creates timestamped `.sql` files in `./drizzle`. **Review them before applying!**

### 4. Apply Migrations

```bash
rebase db migrate
```

> [!WARNING]
> Always backup your database before running migrations in production!

## Quick Reference

| Command | Description | When to Use |
|---------|-------------|-------------|
| `rebase schema generate` | Collections → Drizzle schema | Always first step |
| `rebase schema introspect` | DB → Rebase collections | Legacy DB import (Preferred) |
| `rebase db push` | Apply schema directly to DB | Development |
| `rebase db generate` | Create SQL migration files | Production prep |
| `rebase db migrate` | Run pending migrations | Production deploy |
| `rebase db studio` | Visual database browser | Debugging |

## Common Scenarios

### Adding a New Property

```bash
# Development
rebase schema generate && rebase db push

# Production
rebase schema generate && rebase db generate && rebase db migrate
```

### Changing a Property Type

> [!CAUTION]
> Changing existing column types may cause data loss. Review the generated migration carefully!

1. Modify the property type in your collection
2. Run `rebase schema generate` → `rebase db generate`
3. **Review the migration SQL** for any `ALTER COLUMN` or `DROP COLUMN` statements
4. Run `rebase db migrate` only if you're satisfied with the changes

### Adding a New Collection

1. Create the collection definition as a new file in `config/collections/`
2. Export it from `config/collections/index.ts`
3. Run `rebase schema generate` → `rebase db push` (dev) or `rebase db generate` → `rebase db migrate` (prod)

### Adding Relations

Relations are defined **inline on the property** using `type: "relation"`:

```typescript
import { PostgresCollection } from "@rebasepro/types";
import authorsCollection from "./authors";
import tagsCollection from "./tags";

const postsCollection: PostgresCollection = {
    name: "Posts",
    table: "posts",
    properties: {
        // Many-to-One: each post has one author
        author: {
            name: "Author",
            type: "relation",
            target: () => authorsCollection,
            cardinality: "one",
            direction: "owning"
        },
        // Many-to-Many: posts can have multiple tags
        tags: {
            name: "Tags",
            type: "relation",
            target: () => tagsCollection,
            cardinality: "many",
            direction: "owning"
        }
    }
};
```

- For `owning` relations with `cardinality: "one"`, the foreign key column is added automatically.
- For `owning` relations with `cardinality: "many"`, a junction table is created automatically.
- Run `rebase schema generate` → `rebase db push` (dev) or the migration workflow (prod).

## Important Notes

### Unmapped Tables Are Never Touched

The `drizzle.config.ts` includes multiple layers of safety to ensure tables/objects in the database that are **not** part of the Rebase schema are never modified or dropped:

1. **`tablesFilter`** — Only tables exported from `schema.generated.ts` are managed. All other tables are invisible to drizzle-kit.
2. **`schemaFilter: ["public"]`** — Restricts drizzle-kit to the `public` PostgreSQL schema. Tables in other schemas (e.g. `rebase`, extension schemas) are untouched.
3. **`entities.roles: false`** — Prevents drizzle-kit from managing database roles.
4. **`extensionsFilters: ["postgis"]`** — Ignores helper tables created by PostGIS and similar extensions.
5. **`--strict --verbose` flags on `db push`** — Always prompts before destructive operations and shows all SQL being executed.

This means you can safely have additional tables in your database (from other applications, legacy systems, manual SQL, etc.) and Rebase will never attempt to modify or drop them.

### Introspecting a Database

To introspect an existing database and create Rebase collections, use:
`rebase schema introspect`

This will generate TypeScript collection definitions in your `config/collections/` directory based on the tables in the database.

## Troubleshooting

### "DATABASE_URL is not set"

Make sure your `.env` file exists in the project root folder and contains:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/rebase
```

### Migration Already Applied

If you see errors about migrations already existing:
- Check `./drizzle` folder for existing migration files
- Clean up old migrations if needed
- Use `rebase db push` for development to avoid migration file buildup

### Tables Being Dropped Unexpectedly

This should not happen with the current config. If it does:
- Verify `tablesFilter` in `drizzle.config.ts` includes your tables
- Ensure the schema file exports a `tables` object with all your tables
- Check that `schemaFilter` is set to `["public"]`
- Review the generated migration SQL before applying

