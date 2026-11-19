---
title: Schema as Code
sidebar_label: Schema as Code
description: How Rebase uses the TypeScript tables in backend/schema as the single source of truth for your database schema, API, SDK and admin panel.
---

## The Core Idea

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

Your tables are read once and emitted twice — as a Drizzle schema the
running server queries through, and as SQL that describes the database you meant
to have. Ptah Compat plans changes from that SQL. `db push` compares it with
the live database, while `db generate` compares it with migration history:

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
  reads and writes rows through             schema.sql              ← full desired state
                                            ptah-managed.json       ← owned objects
                                            policies.sql, search.sql,
                                            vector.sql, triggers.sql,
                                            views.sql               ← boot and recovery
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Ptah plans the diff         Ptah writes the diff
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
in your repository to fall behind. Commit the migrations and `backend/drizzle/ptah-managed.json`. See
[Schema Generation](/docs/cli/schema) for every flag.

### Example

Given this table:

<!-- schema-sample: table -->
```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
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

An excerpt of the SQL that Ptah receives as the desired state:

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

The full desired file also contains declared policies, functions, search and
vector indexes, `updated_at` triggers, and views. `db push` and `db generate`
plan them together.

## Safety & Unmapped Database Objects

Rebase limits Ptah's plan to objects it declares. It records their names in
`backend/drizzle/ptah-managed.json`. Commit the file so the next checkout
can plan removals using the previously managed names.
A removed declaration can therefore produce a `DROP`; an unrelated table,
view, function, or extension stays outside the plan.

Auth provisioning and migration revisions are excluded. Rebase does include
the helper functions it declares in the `rebase` schema. On selected tables,
the CLI also protects custom policies, triggers, indexes, CHECK constraints,
and EXCLUDE constraints by name. Rebase reads the live catalog for all five.
It also reads migration files for policy, trigger, and index names. See the
[migration review step](/docs/cli/schema/#rebase-db-generate) for constraints
that exist only in history. A failed catalog read stops planning.

Before applying a change, `db push` shows the plan and gates destructive
statements, including `DROP EXTENSION`. Use `--dry-run` to inspect the plan
without applying it. See [Indexes](/docs/backend/indexes) for how Rebase
distinguishes declared and custom indexes.

## Next Steps

- **[Tables](/docs/schema/)** — Every `defineTable` option
- **[Columns](/docs/schema/columns/)** — Detailed column type mappings
- **[Indexes](/docs/backend/indexes)** — Declaring the indexes your queries need
