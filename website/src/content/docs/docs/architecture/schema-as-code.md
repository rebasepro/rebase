---
title: Schema as Code
sidebar_label: Schema as Code
description: How Rebase uses TypeScript collections as the single source of truth for your database schema, UI, and API.
---

## The Core Idea

In Rebase, your **TypeScript collection definitions are the single source of truth**. From one set of TypeScript objects, Rebase generates:

- **PostgreSQL tables** via Drizzle ORM schema generation
- **CRUD UI** — forms, tables, validation, field types
- **REST API** endpoints with filtering, sorting, and pagination
- **Client SDK** — type-safe data operations
- **RLS policies** — Row Level Security in Postgres

This means your schema is:
- **Version controlled** — every change is a git commit
- **Type-safe** — TypeScript catches errors at compile time
- **Reviewable** — schema changes go through pull requests
- **Portable** — the same definition works across frontend, backend, and CLI

## Visual Editing with AST Manipulation

Rebase also provides a **visual collection editor** in Studio mode. When a non-developer uses the visual editor to add a field:

1. The Studio does **not** directly modify the database
2. Instead, it uses [ts-morph](https://ts-morph.com/) to parse your TypeScript source file as an AST
3. It inserts the new property definition precisely into the `properties` block
4. **All existing code, callbacks, and custom logic are preserved untouched**
5. The file is saved, triggering hot reload

This "UI as Code Generator" approach means visual edits produce the same clean TypeScript a developer would write by hand.

## Schema Generation Pipeline

```
TypeScript Collections
        │
        ▼
  rebase schema generate
        │
        ▼
  Drizzle Schema (schema.generated.ts)
        │
        ▼
  rebase db generate
        │
        ▼
  SQL Migration Files
        │
        ▼
  rebase db migrate
        │
        ▼
  PostgreSQL Tables
```

### Example

Given this collection:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        createdAt: { type: "date", name: "Created", autoValue: "on_create" }
    }
});
```

Rebase generates this Drizzle schema:

```typescript
// schema.generated.ts
import { pgTable, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at").defaultNow()
});
```

Which produces this SQL:

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    price NUMERIC,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Safety & Unmapped Database Objects

When Rebase updates the database schema, it maps TypeScript collection definitions to database tables. To ensure that **unmapped database objects (e.g., tables, views, enums) are never dropped or modified**, Rebase implements several layers of safety:

1. **Strict Table Filtering (`tablesFilter`)**: The generated Drizzle configuration dynamically restricts synchronization to only the tables exported in the generated schema. Any unrecognized tables or legacy systems' tables existing in the database are ignored by the sync engine.
2. **Schema Restrictions (`schemaFilter`)**: The DB sync is restricted exclusively to the `public` schema. Internal database tables, custom schemas, and extension-specific tables are left untouched.
3. **Roles and Extension Protection**: Drizzle is configured not to manage database roles (`entities.roles: false`) or helper tables from extensions like PostGIS.
4. **Interactive Dev Mode Confirmation**: When running `rebase db push` in development, the CLI executes with `--strict` and `--verbose` flags, which ensures that developers must explicitly review and approve any destructive SQL actions before they are executed.
5. **Index Ownership by Name**: Indexes are the one object that lives *on* a mapped table, so table filtering cannot protect them — and a push used to plan `DROP INDEX` for any index missing from the desired state, which meant every hand-written one. Rebase now names the indexes it generates `<table>_<columns>_ix_<7 hex>` (`_ux_` when unique), a shape no other namer here produces, and excludes everything else from the diff by name. An index you wrote by hand, or that came in through introspection, is never touched; a declaration you delete still drops, which is the intent. See **[Indexes](/docs/backend/indexes)**.

## Next Steps

- **[Collections](/docs/collections)** — Full collection configuration reference
- **[Properties](/docs/collections/properties)** — Detailed column type mappings
- **[Indexes](/docs/backend/indexes)** — Declaring the indexes your queries need
