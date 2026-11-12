---
title: Schema as Code
sidebar_label: Schema as Code
description: How Rebase uses the TypeScript tables in backend/schema as the single source of truth for your database schema, API, SDK and admin panel.
---

## The Core Idea

<span class="since-badge" data-since="0.31">Since 0.31</span>

In Rebase, the **tables you declare with `defineTable` in `backend/schema/` are the single source of truth**. From them, Rebase generates:

- **PostgreSQL tables** via Drizzle ORM schema generation
- **RLS policies** — Row Level Security in Postgres, from each table's required `rls`
- **REST API** endpoints with filtering, sorting, and pagination, and realtime and MCP
- **Typed SDK** — type-safe data operations
- **The admin panel's defaults** — forms, lists, validation and field types, rendered from the table descriptors the backend serves at `GET /api/schema/tables`; what the panel shows beyond them lives in `frontend/src/cms/`

This means your schema is:
- **Version controlled** — every change is a git commit
- **Type-safe** — TypeScript catches errors at compile time
- **Reviewable** — schema changes go through pull requests
- **Portable** — the same definition is read by the backend, the CLI, the SDK generator and, as types, the frontend

## Visual Editing with AST Manipulation

<span class="since-badge" data-since="0.31">Since 0.31</span>

Rebase also provides a **visual schema editor** in Studio. When someone uses it to add a column:

1. The Studio does **not** directly modify the database
2. Instead, it sends the edit as a `TablePatch`, and the server uses [ts-morph](https://ts-morph.com/) to parse the table's file in `backend/schema/` as an AST
3. It inserts the new `col.*` builder precisely into the `columns` block
4. **All existing code, hooks, and custom logic are preserved untouched**; an edit that would reach into code it does not rewrite is refused
5. The file is saved, triggering hot reload

How a table *looks* in the panel is not part of this: labels, icons and views
are saved as the panel's preferences or written in `frontend/src/cms/`. See
[Live schema editing](/docs/backend/live-schema-editing/) for the edits and
what the editor refuses.

This "UI as Code Generator" approach means visual edits produce the same clean TypeScript a developer would write by hand.

## Schema Generation Pipeline

<span class="since-badge" data-since="0.31">Since 0.31</span>

Your tables are read once and emitted twice — as a Drizzle schema the
running server queries through, and as SQL that describes the database you meant
to have. It is the SQL that the database is brought into line with, by
[Atlas](https://atlasgo.io), which diffs your desired schema against the live one
and plans the change:

```
                      Tables (backend/schema)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← Atlas's desired state
                                            policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql, ← Atlas cannot manage these
                                            triggers.sql
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas plans the diff        Atlas writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` is the development loop; `db generate` + `db migrate` is the
reviewable one, and the one to use in production. Both go through the same
generated SQL, so they cannot disagree about what your tables mean, and
both write it afresh from the tables before reading it, so there is no copy
in your repository to fall behind. The migrations are what you commit. See
[Schema Generation](/docs/cli/schema) for every flag.

### Example

<span class="since-badge" data-since="0.31">Since 0.31</span>

Given this table:

<!-- schema-sample: table -->
```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().defaultSql("gen_random_uuid()::text"),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamptz().onCreateNow()
    },
    rls: "admin-only"
});
```

Rebase generates this Drizzle schema — the whole file, default policies and
all:

<!-- schema-sample: drizzle -->
```typescript
// schema.generated.ts
// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.

import { boolean, numeric, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations as drizzleRelations, sql } from 'drizzle-orm';


export const products = pgTable("products", {
    name: text("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(sql`TRUE`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`),
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["rebase_admin"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Three things in there are worth reading twice. The `id` column: the database
fills it with a uuid (`gen_random_uuid()::text`), so a row created from the
admin panel, the REST API or the SDK needs no key of its own, and a key you do
send is used as given. The `pgPolicy` block: `rls: "admin-only"` enables row
level security and generates only the baseline policies, which keep the trusted
server context and the `admin` role able to read it — and nobody else; see
[Row-level security](/docs/collections/security-rules). And `active`, which
carries the `.default(true)` you wrote as a **column** default: a literal
default compiles to a real `DEFAULT`, so a row inserted by the REST API, a seed
script or `psql` gets it too, not only one typed into the admin panel.

And this SQL, which is what Atlas is handed as the desired state:

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Policies, search columns, vector indexes and `updated_at` triggers are written to
files of their own and applied by the CLI in their own right — Atlas manages
none of the four.

## Safety & Unmapped Database Objects

When Rebase updates the database schema, it maps the tables you declare to database tables. To ensure that **unmapped database objects (e.g., tables, views, enums) are never dropped or modified**, Rebase implements several layers of safety:

1. **Unmapped Table Exclusion**: Before every push, the CLI lists every table and view in the database and hands Atlas an `--exclude` for each one that no declared table (or a declared table's junction) maps to, so Atlas never plans a change to it. If the database cannot be read, the push aborts rather than run with a partial list.
2. **Schemas Rebase Owns**: The `rebase` schema (auth tables, RLS helper functions, Atlas's revision table) and any `auth` schema are excluded whole, so a push can never plan a `DROP SCHEMA … CASCADE`.
3. **Objects Atlas Cannot Model**: Search columns, vector indexes and triggers are excluded from Atlas too, and applied from their own generated files.
4. **Destructive-Change Gate**: `rebase db push` dry-runs the plan first. A statement that destroys data — a dropped column or table, a lossy type change — stops the push: in a terminal it asks you to type `yes`, and without one (CI, scripts, agents) it refuses unless you pass `--allow-destructive`.
5. **Index Ownership by Name**: Indexes are the one object that lives *on* a mapped table, so table filtering cannot protect them — and a push used to plan `DROP INDEX` for any index missing from the desired state, which meant every hand-written one. Rebase now names the indexes it generates `<table>_<columns>_ix_<7 hex>` (`_ux_` when unique), a shape no other namer here produces, and excludes everything else from the diff by name. An index you wrote by hand, or that came in through introspection, is never touched; a declaration you delete still drops, which is the intent. See **[Indexes](/docs/backend/indexes)**.

## Next Steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- **[Tables](/docs/schema/)** — Every `defineTable` option
- **[Columns](/docs/schema/columns/)** — Detailed column type mappings
- **[Indexes](/docs/backend/indexes)** — Declaring the indexes your queries need
