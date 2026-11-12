---
title: Tables
sidebar_label: Tables
description: "Declare Postgres tables in backend/schema with defineTable: columns, relations and a mandatory row-level security posture. Each table becomes SQL, policies, REST, realtime and MCP routes, and SDK types."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table is declared once, in TypeScript, in the `backend/schema/` directory.
That declaration is the only thing the backend knows about your data. From it,
Rebase generates the table and its row-level security policies in Postgres,
serves the table over REST, realtime and MCP, and types the SDK.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        status:      col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

Three things are worth reading off this example before anything else:

- **Columns are nullable unless you say otherwise**, as in SQL. `.notNull()`
  makes a column `NOT NULL` and required on create. See [Columns](/docs/schema/columns/).
- **The foreign key is declared by the relation.** `author` derives an
  `author_id` column, its constraint and its index. See
  [Relations](/docs/collections/relations/).
- **`rls` is required.** A table without a row-level security posture is a type
  error, and it is refused when the schema is compiled. See
  [Row-level security](/docs/collections/security-rules/).

:::note[Coming from collections?]
Tables replace the `config/collections` files of earlier releases. The CMS
reads its defaults from the tables; its own customizations live in the
frontend. The upgrade guide for this release covers the move.
:::

## The `backend/schema` directory

<span class="since-badge" data-since="0.31">Since 0.31</span>

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── functions/
└── crons/
```

One file per table is a convention, not a rule. What counts is
`backend/schema/index.ts`: the backend reads the tables and views it exports,
and nothing else.

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
];
```

`defaultRls` is optional. It is only read by tables that say
`rls: "inherit"`; a project that never writes `"inherit"` does not need it.

The directory is `backend/schema` unless `rebase.json` names another one with
the `tables` key. The `schema` key keeps its old meaning: the generated Drizzle
module.

```json
{
    "apps": {
        "backend": {
            "type": "backend",
            "runtime": "managed",
            "tables": "backend/schema"
        }
    }
}
```

A project without `backend/schema/index.ts` declares no tables. The backend
then reads the tables from the live database at boot, and serves only those
with row-level security enabled. See [Backend only](/docs/getting-started/headless/).

The schema files are plain TypeScript with no server dependencies:
`@rebasepro/server/schema` loads nothing of the server. A frontend can
`import type { posts } from "../../backend/schema/posts"` to type its own code
against a table, without pulling backend code into the browser bundle.

## What a table becomes

<span class="since-badge" data-since="0.31">Since 0.31</span>

| From the declaration | Rebase generates |
|---|---|
| `columns`, `relations`, `indexes` | the `CREATE TABLE`, foreign keys, junction tables and indexes, written to `schema.sql` by `rebase db push` and `rebase db generate` |
| `rls`, `tenant`, the auth table | `ENABLE ROW LEVEL SECURITY` and one `CREATE POLICY` per rule and operation, in `policies.sql` |
| `search`, vector columns | the generated `tsvector` column and the GIN and ANN indexes |
| the slug | the REST routes under `/api/data/<slug>`, realtime subscriptions, the MCP tools and the OpenAPI document |
| the columns' types and modifiers | the SDK's `Row`, `Insert` and `Update` types, and the [inferred types](/docs/schema/types/) you can use in your own code |

Every surface reads the same compiled form of the table, called its
descriptor: columns with their Postgres types, nullability, validation and
storage rules, relations resolved to slugs, and the row-level security
posture. Hook code never leaves the server; the descriptor only says which
hooks exist. The backend serves the descriptors at `GET /api/schema/tables`,
which is what the CMS, the Studio and the MCP apps render from.

The pipeline from declaration to database is described in
[Schema as code](/docs/architecture/schema-as-code/).

## `defineTable` options

<span class="since-badge" data-since="0.31">Since 0.31</span>

`defineTable(name, config)` takes the table's name and these keys:

| Key | What it does |
|---|---|
| `columns` | **Required.** `col.*` builders by key, in physical order. At least one must be `.primaryKey()`. See [Columns](/docs/schema/columns/). |
| `rls` | **Required.** `"admin-only"`, `"inherit"`, or a non-empty list of rules. See [Row-level security](/docs/collections/security-rules/). |
| `relations` | `rel.*` builders by relation name. See [Relations](/docs/collections/relations/). |
| `slug` | The name in the API, the SDK and in scopes. The table's name when omitted. |
| `table` | The SQL table name, when it differs from the name. |
| `schema` | The Postgres schema. `public` when omitted. |
| `database` | A non-default Postgres database, declared in `backend/resources.ts`. See [Multiple sources](/docs/backend/multiple-sources/). |
| `description` | What the table holds. Shown in OpenAPI and in the MCP tool descriptions. |
| `defaultPolicies` | `false` generates only your rules, without the admin baseline policies. Refused with `rls: "admin-only"`. |
| `tenant` | Scope every row to a tenant. See [Tenancy](/docs/collections/tenancy/). |
| `softDelete` | `true` or `{ field }`: a delete stamps a timestamp instead of removing the row. See [Soft delete](/docs/collections/soft-delete/). |
| `history` | `true` records every write in the history table. See [Entity history](/docs/backend/history/). |
| `search` | Ranked full-text search over the columns named. See [Search](/docs/backend/search/). |
| `indexes` | Indexes, each with the query it serves. See [Indexes](/docs/backend/indexes/). |
| `hooks` | Server-side lifecycle hooks. See [Table hooks](/docs/collections/callbacks/). |
| `strictWrites` | A write naming a column the table does not declare is a 400. `false` accepts it, for a column that exists in the database without being declared (filled by a trigger, say). The column still has to exist. |
| `metadata` | Any data you want served with the table's descriptor. Rebase does not read it. |

Two more definitions share most of these keys:
[`defineAuthTable`](/docs/schema/auth-table/) for the table users are stored
in, and [`defineView`](/docs/collections/views/) for SQL views.

## Names

<span class="since-badge" data-since="0.31">Since 0.31</span>

The first argument of `defineTable` is the table's name, and it is the default
for everything else:

| Name | Default | Override |
|---|---|---|
| SQL table | the name | `table: "blog_posts"` |
| API slug, SDK accessor, scope target | the name | `slug: "articles"` |
| Postgres schema | `public` | `schema: "content"` |
| SQL column of a column | the snake_case of its key | the builder's first argument: `col.text("legacy_name")` |

A column's key is its name on the JSON row, in the SDK and in filters and
sorts. Its SQL name is the snake_case of the key: `publishDate` is the column
`publish_date`, and `photoURL` is `photo_url`. A builder's first argument maps
a key to any other SQL name, as in Drizzle (`col.text("legacy_name")`), which
is how a table adopts an existing database's names without changing what
clients see.

`table` and `schema` must be plain SQL identifiers. Two definitions may not
share a name, a slug or a SQL table. The slug matters beyond the URL: foreign
key and junction column names are derived from it, so changing the slug of a
table that is already deployed can rename columns. Set `slug` explicitly when it
should differ from the table's name, and leave it alone afterwards.

## Primary keys

<span class="since-badge" data-since="0.31">Since 0.31</span>

There is no implicit `id` column. Every table marks at least one column
`.primaryKey()`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        number: col.integer().notNull().unique(),
    },
    rls: "admin-only",
});

// Several key columns form a composite key, in declaration order.
export const dailyStats = defineTable("daily_stats", {
    columns: {
        siteId: col.uuid().primaryKey(),
        day:    col.date().primaryKey(),
        views:  col.integer().notNull().default(0),
    },
    rls: "admin-only",
});
```

A key column is `NOT NULL` by definition. A `uuid` key usually takes
`.defaultRandom()`; an integer key takes `.generatedByDefaultAsIdentity()`. A key without a
default is supplied by the caller on create. A key column cannot be
`.private()`, and cannot be a `timestamptz` or `time`.

## When a definition is refused

<span class="since-badge" data-since="0.31">Since 0.31</span>

A schema that would leave a table unprotected or unservable never reaches the
database. It is refused at three points:

1. **In the editor.** `rls` and `columns` are required by the types, and
   `rls: []` is not a valid posture. A `tenant` or `softDelete` field, or an
   index column written as a plain key, that names no column is a type error.
2. **When the module loads.** `defineTable` throws on a table with no columns,
   a column that is not a `col.*` builder, a relation that is not a `rel.*`
   result, a relation with the same key as a column, or no usable `rls`. This
   also catches JavaScript code and casts that the types cannot see.
3. **When the schema is compiled.** `rebase db generate`, `rebase db push`,
   `rebase doctor` and server boot compile every table together and stop with
   a `SchemaDefinitionError` that lists every problem, each with the table, the
   column or relation, and what to write instead:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

The compile step checks what needs every table at once: relation targets and
their key types, junction tables two relations both claim, slugs and SQL names
that collide (including names that collide once Postgres truncates them to 63
bytes), rules that name a column the table does not have, and `"inherit"`
without a `defaultRls`. A table exported from a file next to `index.ts` but not
from `index.ts` itself is refused too: the index is the list of tables.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Columns](/docs/schema/columns/): every `col.*` builder and modifier
- [JSON documents](/docs/schema/json/): typed and validated `jsonb` with `json.*`
- [Relations](/docs/collections/relations/): the five `rel.*` kinds
- [Row-level security](/docs/collections/security-rules/): the `rls` posture and its rules
- [Table hooks](/docs/collections/callbacks/): server-side lifecycle hooks
- [Type inference](/docs/schema/types/): `InferRow`, `InferInsert` and `InferUpdate`
