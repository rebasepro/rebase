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
    B -->|rebase db generate| D[./drizzle/migrations/*.sql]
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
import { defineCollection } from "@rebasepro/admin-types";

const postsCollection = defineCollection({
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
            // Presentation-only options live in the property's `admin` block.
            admin: {
                clearable: true
            }
        }
    }
});

export default postsCollection;
```

`defineCollection` is an identity function at runtime; the point is the
overloads. It captures the literal property keys, so `admin.titleProperty`,
`admin.propertiesOrder` and friends complete over this collection's own
properties, and it brings the `admin` augmentation with it so a typo inside an
`admin` block is a compile error rather than a silently ignored key.

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
| `rebase db backup` | Snapshot before a risky change | Before destructive pushes |
| `rebase doctor` | Report collection ↔ table drift | Debugging, CI |

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

Relations are defined **inline on the property**: `type: "relation"` plus a
`relation` object whose `kind` says what sort of link it is.

```typescript
import { defineCollection } from "@rebasepro/admin-types";
import authorsCollection from "./authors";
import tagsCollection from "./tags";

const postsCollection = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        // This table holds the key: an `author_id` column is added for you.
        author: {
            name: "Author",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => authorsCollection
            }
        },
        // Both sides hold many: a junction table is created for you.
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tagsCollection
            }
        }
    }
});
```

`kind` is the only thing you have to choose. Everything else defaults, and the
type offers exactly the fields that kind can use:

| `kind` | Where the foreign key lives | What `schema generate` emits |
|---|---|---|
| `belongsTo` | this collection's table | a `<relationName>_id` column here — override with `localKey` |
| `hasOne` | the target's table | nothing here; read back via `foreignKeyOnTarget` |
| `hasMany` | the target's table | nothing here; read back via `foreignKeyOnTarget` |
| `manyToMany` | a junction table | the junction and its two key columns — override with `through` |
| `via` | an explicit `joinPath` | nothing — `via` is read-only |

There is no `cardinality` and no `direction` on an authored relation. `via` is
the single exception: it carries `cardinality` because a chain of joins cannot
imply whether it yields one row or many. This is a closed union, and closing it
was the fix for a real defect — when a relation was one open interface, a
`many` link carrying a `localKey` typechecked, and the write path answered it by
stamping the parent's own foreign key onto the child row. See
`packages/types/src/types/relations.ts`.

Run `rebase schema generate` → `rebase db push` (dev) or the migration workflow (prod).

## Important Notes

### Unmapped Tables Are Never Touched

`rebase db push` applies the schema with **Atlas**, which works from a desired
state — so anything in the database and absent from that state is a candidate
for a drop. Three layers stop that from reaching a table Rebase does not own:

1. **A computed `--exclude` list.** Before applying, the CLI introspects the
   database and excludes every table that is not a collection table, plus the
   search functions, indexes and triggers Rebase creates itself (Atlas cannot
   manage those, so it would plan a drop for each one).
2. **That list fails closed.** If the introspection cannot run, the push
   *aborts* — `✗ Aborting push: could not determine which tables to protect` —
   rather than applying with a partial list.
3. **A destructive-change gate.** The apply is preceded by a `--dry-run`; any
   `DROP`/destructive statement in the plan is printed and then either prompted
   for (interactive) or refused (non-interactive). `--allow-destructive` — or
   `--yes` — is the only way past it.

So you can safely keep additional tables in the same database (other
applications, legacy systems, manual SQL) and Rebase will not modify or drop
them.

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
- Check the `./drizzle/migrations` folder for existing migration files
- Clean up old migrations if needed
- Use `rebase db push` for development to avoid migration file buildup

### Tables Being Dropped Unexpectedly

The destructive-change gate prints the planned SQL before anything is applied,
so read that first — it names every drop. If a table you did not expect appears
in it:
- Check the collection's `table` — a renamed `table` reads as "drop the old one,
  create a new one", which is a data-losing rename.
- Re-run without `--allow-destructive` / `--yes` so the gate prompts instead of
  applying.
- Take a backup first: `rebase db backup`.

