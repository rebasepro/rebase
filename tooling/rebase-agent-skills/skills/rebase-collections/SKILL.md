---
name: rebase-collections
description: How to define a Rebase data model — tables in backend/schema with defineTable / defineAuthTable / defineView (col.*, rel.*, json.*, a required rls), table hooks and column transforms, views, search and indexes — and how each table becomes a collection in the CMS, customized with customizeTable in frontend/src/cms (labels, icons, enum colours, kanban, form layout, custom fields) or declared with defineFirestoreCollection for Firestore. Use it whenever the user creates or changes a table, a column, a relation or a hook, makes a table searchable (including when search finds nothing for content stored in a JSON column), declares an index, changes how a table looks in the admin, or is migrating a project from config/collections (read references/migrate-from-collections.md for that).
---

# Rebase tables and collections

A Rebase project's data model is **tables**, declared in TypeScript in
`backend/schema/`. That declaration is the only thing the backend knows about
the data. From it Rebase generates the Postgres tables and their row-level
security policies, serves every table over REST (`/api/data/<slug>`),
realtime and MCP, and types the SDK.

The **CMS** (the admin panel) is a layer on top. It reads each table's
compiled descriptor from `GET /api/schema/tables` and derives a default
*collection* for it: a list, a form, filters, relation tabs. A project changes
how one looks with `customizeTable` in `frontend/src/cms/`. "Collection" is
the CMS's word; the backend, the SDK and the MCP tools all say "table".

| Concern | Where | Written with |
|---|---|---|
| Columns, keys, relations, validation, who reads which rows, server hooks, search, indexes | `backend/schema/<table>.ts` | `defineTable`, `col.*`, `rel.*`, `json.*` from `@rebasepro/server/schema` |
| Which tables exist, and the shared `rls` | `backend/schema/index.ts` | `export { posts } from "./posts"`, `export const defaultRls` |
| Labels, icons, groups, view modes, kanban, form layout, enum colours, custom fields, actions | `frontend/src/cms/<table>.tsx` | `customizeTable<typeof posts>("posts", { … })` from `@rebasepro/cms` |
| A Firestore collection shown in the CMS | `frontend/src/cms/<name>.ts` | `defineFirestoreCollection({ … })` from `@rebasepro/firebase` |

> **IMPORTANT FOR AGENTS:** `defineCollection`, `config/collections`,
> `properties`, `securityRules`, `callbacks`, `admin: { … }` blocks and
> `relation` properties are gone, with no aliases. If a project still has
> `config/collections/`, it has not been migrated: read
> [references/migrate-from-collections.md](references/migrate-from-collections.md)
> and run `rebase migrate collections-to-tables` instead of editing it.

## Adding a table, end to end

1. **Write the table** in `backend/schema/<table>.ts`:

```ts
// backend/schema/tasks.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const tasks = defineTable("tasks", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull().validate({ min: 3, max: 200 }),
        status: col.enum(["todo", "doing", "done"]).notNull().default("todo"),
        dueDate: col.date(),
        ownerId: col.uuid().notNull().onCreateUser(),
        createdAt: col.timestamptz().onCreateNow(),
        updatedAt: col.timestamptz().onUpdateNow(),
        __order: col.text().describe("Fractional index maintained by the Kanban board")
    },
    relations: {
        owner: rel.belongsTo(() => users)
    },
    rls: [
        { operations: ["select", "insert", "update", "delete"], ownerField: "ownerId" }
    ]
});
```

2. **Export it** from `backend/schema/index.ts`. Only what `index.ts` exports
   is served, and a `defineTable` in a sibling file that `index.ts` does not
   export is refused:

```ts no-verify
// backend/schema/index.ts
export { users } from "./users";
export { tasks } from "./tasks";
```

3. **Check it compiles**: `rebase verify` (Claude Code runs it after every edit
   under `backend/schema/` and `frontend/src/cms/`, through the post-edit hook
   `rebase init` installs). It reports every problem with the table, the column
   and what to write instead. It reads `backend/schema` only: a mistake in a
   `customizeTable` file is a type error (run the frontend's typecheck), or a
   throw when the module loads.

4. **Apply it.** With `pnpm dev` running, saving the file is the whole step:
   it regenerates `backend/src/schema.generated.ts` and the SDK types, restarts
   the backend, and boot creates the missing table, columns and policies. With
   `pnpm dev` stopped: `rebase schema generate`, then `rebase db push` in
   development, or `rebase db generate` + `rebase db migrate` for production.
   See [Applying a schema change](#applying-a-schema-change).

5. **Optionally customize it in the CMS** — it is already in the panel without
   this. `frontend/src/cms/tasks.tsx`:

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    name: "Tasks",
    singularName: "Task",
    icon: "ListTodo",
    group: "Work",
    defaultViewMode: "kanban",
    enabledViews: ["kanban", "table"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                todo: { label: "To do", color: "gray" },
                doing: { label: "Doing", color: "orange" },
                done: { label: "Done", color: "green" }
            }
        },
        __order: { hidden: true, disabled: true }
    }
});
```

   and list it in `App.tsx`: `<RebaseCMS tableCustomizations={[tasksCms]} />`
   (projects usually collect them in `frontend/src/cms/index.ts`).

6. **Use it** from code: `client.data.tasks.find()` in the browser,
   `rebase.dataAsAdmin.tasks` in functions and crons, `context.data.table("tasks")`
   in a hook. See `rebase-sdk`.

The frontend imports the table's **type** only (`import type { tasks }`). A
type import is erased from the bundle, so hooks and server code never reach
the browser. A value import from `backend/` in frontend code is the one thing
not to write; `check:templates` refuses it in the scaffolds.

## The `backend/schema` directory

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── hooks.ts          # optional: hooks for every table
├── functions/
└── crons/
```

One file per table is a convention. What counts is what `index.ts` exports:

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" }
];
```

The directory is `backend/schema` unless `rebase.json` names another one with
the `tables` key of the backend app; every CLI command that reads the tables
also takes `--schema-dir <dir>`. (`rebase.json`'s `schema` key is something
else: the generated Drizzle module.) A project with no `backend/schema/index.ts`
declares no tables: the backend reads them from the live database instead and
serves only those with row-level security enabled.

`@rebasepro/server/schema` loads no server code, so schema files are plain
TypeScript that the frontend can `import type` from.

## `defineTable(name, config)`

| Key | What it does |
|---|---|
| `columns` | **Required.** `col.*` builders by key, in physical order. At least one is `.primaryKey()`: there is no implicit `id`. |
| `rls` | **Required.** `"admin-only"`, `"inherit"`, or a non-empty list of rules. See [Row-level security](#row-level-security-rls). |
| `relations` | `rel.*` builders by relation name. See [Relations](#relations). |
| `slug` | The name in the API, the SDK and in scopes. The table's name when omitted. |
| `table` | The SQL table name, when it differs from the name. |
| `schema` | The Postgres schema. `public` when omitted. |
| `database` | A non-default Postgres database declared in `backend/resources.ts`. |
| `description` | What the table holds; shown in OpenAPI and the MCP tool descriptions. |
| `defaultPolicies` | `false` generates only your rules, without the admin baseline policies. Refused with `"admin-only"`. |
| `tenant` | `{ field, from: { claim } \| { membership: { table, userField, tenantField } }, bypassRoles? }`: every row scoped to a tenant. |
| `softDelete` | `true` or `{ field }`: a delete stamps a timestamp column (`deletedAt` by default) instead of removing the row; stamped rows are hidden from reads. |
| `history` | `true` records every write in the history table (see `rebase-entity-history`). |
| `search` | Ranked full-text search. See [Search](#search). |
| `indexes` | Indexes, each with the query it serves. See [Indexes](#indexes). |
| `hooks` | Server-side lifecycle hooks. See [Table hooks](#table-hooks). |
| `strictWrites` | `false` accepts a write naming a column the table does not declare (one filled by a trigger, say). A 400 otherwise. |
| `metadata` | Any data you want served with the table's descriptor. |

`defineAuthTable` declares the users table, `defineView` a SQL view; both are
below.

### Names

| Name | Default | Override |
|---|---|---|
| SQL table | the name | `table: "blog_posts"` |
| API slug, SDK accessor, scope target | the name | `slug: "articles"` |
| Postgres schema | `public` | `schema: "content"` |
| SQL column of a column | the snake_case of its key | `.column("legacy_name")` |

A column's key is its name on the JSON row, in the SDK, in filters and sorts;
its SQL name is the snake_case of the key (`publishDate` → `publish_date`).
`.column()` maps a key to any other SQL name, which is how a table adopts an
existing database's names without changing what clients see.

The slug matters beyond the URL: foreign-key and junction column names are
derived from it, so changing the slug of a deployed table can rename columns.
Derived names are frozen once deployed — set `slug`, `table`, `localKey`,
`through` explicitly rather than renaming.

## Columns

A column is a `col.*` builder refined by modifiers. The builder decides the
Postgres type; the modifiers say the rest. Builders are immutable, so a column
can be declared once and shared between tables.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar(32).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric(10, 2).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.array(col.text()).validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamptz().notNull().onCreateNow(),
        updatedAt: col.timestamptz().notNull().onUpdateNow()
    },
    rls: "admin-only"
});
```

### Builders

| Builder | Postgres type | Wire type |
|---|---|---|
| `col.uuid()` | `UUID` | `string` |
| `col.text()`, `col.varchar(n?)`, `col.char(n?)` | `TEXT`, `VARCHAR(n)`, `CHAR(n)` (n defaults to 255) | `string` |
| `col.enum(values, { name? })` | a Postgres enum type, `<table>_<column>` unless named | the union of `values` |
| `col.smallint()`, `col.integer()`, `col.bigint()` | `SMALLINT`, `INTEGER`, `BIGINT` | `number` |
| `col.serial()`, `col.smallserial()`, `col.bigserial()` | the serial types (for existing schemas; prefer `.identity()`) | `number` |
| `col.real()`, `col.doublePrecision()`, `col.numeric(p?, s?)` | `REAL`, `DOUBLE PRECISION`, `NUMERIC` | `number` |
| `col.boolean()` | `BOOLEAN` | `boolean` |
| `col.timestamptz()`, `col.date()`, `col.time()` | `TIMESTAMPTZ`, `DATE`, `TIME` | ISO `string` (a write also takes a `Date`) |
| `col.jsonb<T>()` / `col.jsonb(shape)` | `JSONB` | `T`, or the shape's type — see [JSON columns](#json-columns) |
| `col.json<T>()` / `col.json(shape)` | `JSON` | as `jsonb`; prefer `jsonb` |
| `col.array(inner)` | `<inner>[]` | an array of the inner wire type (no arrays of arrays) |
| `col.vector(dims, { index? })` | `vector(dims)` (pgvector), HNSW cosine index unless told otherwise | `number[]` |
| `col.bytea()` | `BYTEA` | base64 `string` |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` |
| `col.storage(options)` | `TEXT` (`.multiple()`: `TEXT[]`) | the file's path |
| `col.custom<T>("sqlType")` | any other Postgres type, as written | `T` (default `string`) |

### Modifiers

| Modifier | On | Effect |
|---|---|---|
| `.notNull()` | every column | `NOT NULL`; required on create unless it has a default. Columns are **nullable** otherwise, as in SQL. |
| `.primaryKey()` | every column | part of the primary key (several make a composite key, in declaration order) |
| `.unique()` | every column | single-column `UNIQUE`; a duplicate is a `409` |
| `.default(value)` / `.defaultSql(expr)` / `.dbDefault()` | every column | a default; the column may be left out of a create |
| `.generatedAs(expr)` | every column | `GENERATED ALWAYS AS (expr) STORED`; never writable |
| `.column(name)` | every column | the SQL column name |
| `.readOnly()` | every column | client writes refused; server code and the database still fill it |
| `.private()` | every column | never on the wire, in the SDK or OpenAPI; server code and hooks see it |
| `.access({ read?, write? })` | every column | per-role read and write (lists of role names) |
| `.describe(text)` | every column | the description in OpenAPI and MCP |
| `.validate(rules)` | every column | checked before every write; a `400` naming the column |
| `.transform({ beforeSave?, afterRead? })` | every column | field-level hooks, see [Column transforms](#column-transforms) |
| `.oneOf(values)` | text and numeric columns | only these values, typed as their union (on a text column, use it as an array item: `col.array(col.text().oneOf([...]))`; a single closed set of strings is `col.enum`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` |
| `.identity()` | integer columns | `GENERATED BY DEFAULT AS IDENTITY` — the form for an integer key |
| `.onCreateNow()` / `.onUpdateNow()` | temporal columns | the server stamps the time on create / on every write |
| `.onCreateUser()` / `.onUpdateUser()` | text columns, `col.uuid()` | the server writes the caller's id on create / on every write |
| `.userId()` | text columns, `col.uuid()`, `text[]` items | the column holds a Rebase user id: the CMS renders the user picker, and whoever may write the table may look users up |
| `.multiple()` | `col.storage()` | several files (`TEXT[]`) |

A stamp overwrites whatever the client sent. `.onCreateUser()` is how a
column that a row-level security rule compares with the caller (`ownerField`)
gets its value: a column the caller fills is a column the caller can lie about.

### Validation rules

| Rule | Text and storage | Numeric | Temporal | Arrays |
|---|---|---|---|---|
| `min`, `max` | length | inclusive bounds | earliest / latest | |
| `length` | exact length | | | |
| `matches`, `matchesFlags`, `matchesMessage` | a pattern and its error | | | |
| `email`, `url` | address / URL | | | |
| `trim`, `lowercase`, `uppercase` | normalized before storing | | | |
| `lessThan`, `moreThan`, `positive`, `negative`, `integer` | | exclusive bounds, sign, whole | | |
| `minItems`, `maxItems` | | | | item count |
| `requiredMessage` | every type | | | |

### Storage columns

`col.storage({ path, source?, accept?, maxBytes?, imageResize?, public?, fileName?, metadata?, includeBucketUrl?, storeUrl? })`
holds a file's path. `path` is required (a template: `"listings/{id}/"`), `source` names a bucket
declared in `backend/resources.ts`. The upload route enforces `accept` and
`maxBytes`. Who may upload and download which paths is the backend's
`storageAuthorize` hook (see `rebase-storage`). A file inside a JSON document is
`json.storage(options)`.

## JSON columns

`col.jsonb<T>()` types a document for TypeScript only. `col.jsonb(shape)` with
a `json.*` shape also tells the server: it validates each field, applies
defaults, stamps dates, runs field transforms, tracks `json.storage()` files,
lets `search` name a path inside it, and lets the CMS build a form for it.

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const pages = defineTable("pages", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        settings: col.jsonb<{ theme?: "light" | "dark"; pinned?: boolean }>(),
        seo: col.jsonb(json.object({
            title: json.string().validate({ max: 60 }).required(),
            canonicalUrl: json.string().validate({ url: true }),
            noIndex: json.boolean().default(false)
        })),
        blocks: col.jsonb(json.array(json.oneOf({
            text: json.string(),
            image: json.storage({ path: "pages/blocks/" })
        })))
    },
    rls: "admin-only"
});
```

Builders: `json.string()`, `json.number()`, `json.boolean()`, `json.date()`,
`json.geopoint()`, `json.storage(options)`, `json.object(fields, { additional? })`,
`json.array(of)`, `json.oneOf(variants)` (a union of `{ type, value }` blocks),
`json.unknown()`. Modifiers: `.required()`, `.default()`, `.describe()`,
`.validate()`, `.transform()`, `.oneOf()` (string and number),
`.onCreateNow()` / `.onUpdateNow()` (dates), `.onCreateUser()` /
`.onUpdateUser()` / `.userId()` (strings). Fields are optional unless
`.required()`.

Today a document is an object or an array at the top, `json.oneOf()` is only
an array item, and `json.unknown()` is only an array item; the compiler refuses
the other placements by name.

## Relations

A table's `relations` name its links to other tables, each a `rel.*` call
keyed by the relation's name: what `include` asks for and what a write names to
set the link. The target is a thunk, `() => users`, so two tables may point at
each other in either import order, with no type annotation.

| Kind | The key lives | Returns | Options |
|---|---|---|---|
| `rel.belongsTo` | on **this** table | one row | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | on the **target**, unique | one row | `foreignKey`, `sourceKey` |
| `rel.hasMany` | on the **target** | many rows | `foreignKey`, `sourceKey` |
| `rel.manyToMany` | in a **junction table** Rebase creates | many rows | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | where `steps` say | one or many | `steps` (required), `cardinality` |

Every kind also takes `access: { read?, write? }` and `private: true`.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { authors } from "./authors";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        // Bound: this is the SQL column `author_id`, the relation's localKey.
        authorId: col.uuid()
    },
    relations: {
        author: rel.belongsTo(() => authors),
        tags: rel.manyToMany(() => tags, { pivot: { sortOrder: col.integer().default(0) } })
    },
    rls: "admin-only"
});
```

```ts
// backend/schema/authors.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";

export const authors = defineTable("authors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull()
    },
    relations: {
        // reads posts.author_id
        posts: rel.hasMany(() => posts)
    },
    rls: "admin-only"
});
```

**`belongsTo` binds or derives its column.** Its SQL column is `localKey`, or
`<relation name in the singular>_id` (`author` → `author_id`). When `columns`
has a column with that SQL name, the relation uses it (its type must be the
target key's type, and its own `.notNull()` / `.unique()` say what the link
is). Otherwise the relation adds the column, served as the camelCase of its
SQL name (`authorId`), and `notNull: true` / `unique: true` on the relation
apply to it. Either way the column gets an index and a `FOREIGN KEY`.

A relation and a column may not share a key: the relation's key is what
`include` names, so the foreign-key column takes another (`authorId`, not
`author`). A `belongsTo` relation's name stands for its column in `indexes`,
`tenant` and rules (`ownerField: "author"`).

**Derived names**, when you do not write them: `hasOne` / `hasMany` read
`<singular slug of this table>_id` on the target; a junction is the two SQL
table names sorted and joined by `_` (`posts_tags`), with columns
`<singular slug>_id` and `<singular relation name>_id`.

**Delete rules**: `onDelete` defaults to `"restrict"` for a `NOT NULL` key,
`"set null"` otherwise, and `"cascade"` for a junction link. Ask for
`"cascade"` explicitly when deleting the parent should delete the rows.

**`rel.via`** reads through joins you spell out:
`rel.via(() => orders, { steps: [{ table: "order_items", on: { from: "id", to: "product_id" } }, { table: "orders", on: { from: "order_id", to: "id" } }] })`
(from `app/backend/schema/products.ts`). It is read-only, except a one-step
to-one chain (written like `hasOne`) and a two-step to-many chain through one
table (written like `manyToMany`).

**Reading and writing:** relations are not included unless asked:
`client.data.posts.include("author", "tags").find()`. A row always carries the
foreign key (`post.authorId`) and carries `post.author` only when included. A
write sets a to-one link by key (`{ author: "u7" }`) and a to-many link as a
list (`{ tags: ["t1", "t2"] }`); junction columns travel as `_pivot`. In the
CMS, every to-many relation becomes a tab under the record.

Refused when the schema compiles: a target that is not a table or view of the
schema, a relation and a column with the same key, a bound column of the wrong
type, two relations on one column, a `belongsTo` to a composite key, two
`manyToMany` resolving to one junction with different columns.

## Row-level security (`rls`)

Every table says who reaches its rows, and there is no default: leaving `rls`
out is a type error, and the compiler refuses a table without a usable posture.

| `rls` | Means |
|---|---|
| `"admin-only"` | RLS on, only the admin baseline: the `admin` role and server code reach rows. The posture to start with until you have decided. |
| `"inherit"` | The `defaultRls` exported from `backend/schema/index.ts`; refused when there is none. |
| a list of rules | The policies to generate. `[]` is refused. |

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser()
    },
    rls: [
        // Anyone reads the published ones.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] }
    ]
});
```

Rule forms: owner (`ownerField`), `access: "public" | "authenticated"` (with an
optional `condition` / `check`), structured (`condition: policy.…`), raw SQL
(`using` / `withCheck`), roles only. Every table also gets the admin baseline
policies unless `defaultPolicies: false`. The full rule reference, `policy.*`
helpers and what fails closed are in `rebase-security`; roles and the auth side
are in `rebase-auth`.

## Table hooks

`hooks` run on the server, for every door into the table (REST, SDK,
realtime, MCP, `rebase.dataAsAdmin`), and their code never leaves the server.
The auth system's own writes (sign-up, OAuth, admin user management) do not
run them.

| Hook | Runs | Returns |
|---|---|---|
| `beforeQuery` | before every read | a filter to AND in (`{ filter }` / `{ logical }`), or nothing |
| `afterRead` | on every row leaving the server | the row to serve |
| `beforeSave` | before a create or update, in its transaction | the values to write; throw to refuse (`400 CALLBACK_REJECTED`) |
| `afterSave` | after the write, before commit | nothing; a throw rolls back |
| `afterSaveError` | after a failed write rolled back | nothing |
| `beforeDelete` | before a delete, in its transaction | `false` or throw to refuse |
| `afterDelete` | after the delete, before commit | nothing; a throw rolls back |

Every hook receives `table` (the descriptor), `path` and `context`
(`context.user`, and `context.data` scoped to the caller, in the same
transaction). `beforeSave` / `afterSave` also get `id`, `values`,
`previousValues` and `status` (`"new" | "existing" | "copy"`); `afterRead` and
the delete hooks get the row as `values`. An update's `values` hold only the
changed fields: read the rest from `previousValues`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug: col.text().notNull().unique(),
        status: col.enum(["draft", "published"]).notNull().default("draft")
    },
    rls: "admin-only",
    hooks: {
        beforeSave: async ({ values, previousValues, context }) => {
            const title = values.title ?? previousValues?.title;
            if (title && !values.slug && !previousValues?.slug) {
                values.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            if (values.slug) {
                const taken = await context.data.table("articles").count({ where: { slug: ["==", values.slug] } });
                if (taken > 0 && values.slug !== previousValues?.slug) {
                    throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
                }
            }
            return values;
        },
        beforeDelete: ({ values }) => {
            if (values.status === "published") throw new Error("Unpublish the article before deleting it.");
        }
    }
});
```

Import `RebaseApiError` from `@rebasepro/types` (schema files load no server
code). `app/backend/schema/orders.ts` is a worked `afterSave` / `afterDelete`
pair that keeps another table's totals in sync through `context.data`.

- Work that leaves the database (e-mail, a webhook) does not belong in a hook
  body: enqueue a job instead (see `rebase-cron-jobs` / the jobs docs); a job
  enqueued from a hook commits with the write.
- `afterRead` masks what a caller receives; a value a caller must never see is
  better withheld with `.private()` or `.access({ read })`.
- Several concerns on one table: `hooks: composeTableHooks(auditTrail, slugify)`
  with `composeTableHooks` from `@rebasepro/common`.
- Hooks for **every** table: `export const hooks: TableHooks = { … }` from
  `backend/hooks.ts` (the `hooks` option of `initializeRebaseBackend` when
  ejected). They run before each table's own hooks, which run before column
  transforms.
- Hooks attached after boot: `backend.setTableHooks(slug, hooks)` replaces the
  table's declared hooks; pass `composeTableHooks(declared, yours)` to add.
- A hook is a plain function: test it by calling
  `tasks.config.hooks?.beforeSave?.(props)` with a `context` from
  `createCallContext` (`@rebasepro/server`).

### Column transforms

`.transform({ beforeSave, afterRead })` on a column returns the value to store
or to serve. `value` is `T | null` unless `.notNull()` comes **before**
`.transform()` (`T | undefined` on a JSON field unless `.required()` first).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contacts = defineTable("contacts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => value.trim().toLowerCase()
        }),
        iban: col.text().transform({
            afterRead: ({ value, context }) =>
                value && !context.user?.roles?.includes("finance") ? `•••• ${value.slice(-4)}` : value
        })
    },
    rls: "admin-only"
});
```

For trimming and case alone, the `trim` / `lowercase` / `uppercase`
validation rules need no code.

## The users table: `defineAuthTable`

`defineAuthTable` is a `defineTable` for the table authentication reads and
writes. It adds the auth columns you did not declare (email, password hash,
`roles`, verification state…), always adds a self-read policy and an admin-only
write gate on the privilege columns, and takes an `auth` block
(`roles`, `scopes`, `personalKeys`). A project has at most one.
`app/backend/schema/users.ts` and the scaffold's `backend/schema/users.ts` are
the worked examples; roles and scopes are in `rebase-auth`.

## Views: `defineView`

```ts
// backend/schema/artist_stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs: col.integer().notNull(),
        fame: col.integer()
    }
});
```

Export it from `index.ts` like a table. It reads like one (`find`, `count`,
`aggregate`, `listen`, REST, MCP, the CMS) and is never written: every write is
`405 TABLE_READ_ONLY`. A plain view runs as the caller (`security_invoker`),
so the base tables' policies decide its rows, and it has no `rls`.
`materialized: true` stores the rows and serves them only to `roles`
(`["admin"]` by default): never put rows in one that some of its readers may
not see. `db push` creates it after the tables; a changed query recreates it.
Reach for a view whenever an app would otherwise keep an analytic query in raw
`rebase.sql()`.

## Search

By default `.search("term")` is a case-insensitive substring match across the
table's top-level text columns. It cannot see inside `jsonb` or array columns,
does not rank and cannot use an index.

**This is the most common "search is broken" report.** If a table keeps
searchable content in a JSON column (tags, certifications, a questionnaire),
none of it is reachable by the default, and the search box returns nothing with
no error. Check where the content lives before anything else, then declare a
`search` block:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const talents = defineTable("talents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        fullName: col.text().notNull(),
        location: col.text(),
        interests: col.array(col.text()),
        questionnaire: col.jsonb(json.object({ certifications: json.string() }))
    },
    rls: "admin-only",
    search: {
        language: "spanish",     // stemming + stopwords; default "simple" (neither)
        unaccent: true,          // `auditoria` matches `auditoría`
        fuzzy: true,             // `iso14000` reaches `ISO 14001`
        fields: [
            { path: "fullName", weight: "A" },
            { path: "questionnaire.certifications", weight: "A" },
            "location",          // weight B
            "interests"          // a text[]
        ]
    }
});
```

Rows then come back with a sortable `_score`:
`client.data.talents.search("auditor iso 14001").orderBy("_score", "desc").find()`.
`search(term, { explain: true })` adds `_matches` (which field matched, with a
highlighted snippet).

- **Nothing is inferred.** A field is indexed only if named in `fields`, and a
  path that does not resolve is refused when the schema compiles.
- **A path may name** a text column, a `text[]`, a JSON column, or a dotted path
  into one; a JSON path indexes every string at or below it. Enums, uuids,
  `json` (not `jsonb`) and numeric arrays are refused — filter them with `where`.
- **Set `language`** to the content's language deliberately, and `unaccent` in
  an accented language (Postgres stems `auditoría` and `auditoria` to different
  lexemes).
- **Weights are `A`–`D`**, default `B`: names at `A`, long free text at `D`.
- **It creates schema**: a generated `tsvector` column and a GIN index (and with
  `fuzzy` a trigram column and index). Adding a stored generated column rewrites
  the table, so on a large live table treat it as a planned migration.
- For exact matching on a known field, use `where` instead.

## Indexes

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { authors } from "./authors";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamptz(),
        workspaceId: col.uuid().notNull(),
        slug: col.text().notNull()
    },
    relations: { author: rel.belongsTo(() => authors) },
    rls: "admin-only",
    indexes: [
        // One btree serves the filter and the sort.
        { columns: ["status", { column: "publishDate", direction: "desc" }],
          reason: "admin list: filter by status, newest first" },
        // Partial: only published rows.
        { columns: ["publishDate"], where: { column: "status", op: "=", value: "published" },
          reason: "public feed: published posts by date" },
        // `author` is the belongsTo: it resolves to author_id.
        { columns: ["author", { column: "publishDate", direction: "desc" }],
          reason: "an author's posts, newest first" },
        { columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }
    ]
});
```

| Field | Notes |
|---|---|
| `columns` | **Required.** Column keys or `belongsTo` relation names (never SQL names), or `{ column, direction?, nulls? }`. |
| `reason` | The query it serves, in one line. Optional but strongly recommended: `rebase doctor` prints it beside the index's usage. Not part of the index's identity. |
| `using` | `"btree"` (default), `"gin"` (containment over arrays / JSON), `"brin"`. |
| `where` | Partial index, structured: `{ column, op, value }`, `op` in `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null`, `is not null`, nested under `{ and: [...] }`. No SQL strings, no `or`. |
| `unique` | btree, composites only (single-column uniqueness is `.unique()`). |
| `include` | btree covering columns. |

- **A `belongsTo` column is indexed already.** Do not add a lone
  `{ columns: ["author"] }` "for the foreign key"; declare it only as the lead
  of a composite. A `hasMany` / `manyToMany` is refused: the key is on the other
  table, so declare the index there.
- **Order is identity.** Postgres uses a leading subset only; never reorder
  keys to tidy a declaration, and never declare a `desc` twin of an `asc` index.
- **Never a plain index for text search or embeddings**: that is `search` and
  `col.vector(dims, { index })`.
- **Do not index the primary key.**
- **Changing a declaration is a DROP and a CREATE.** Fine on a dev database;
  on a large live table, say so before suggesting the edit.
- Ownership is by name (`<table>_<columns>_ix_<7 hex>`): an index Rebase did
  not create is never touched by `db push`, so do not tell a user to re-create a
  hand-written index defensively, and never rename one to look generated.

## Several databases

A table on a non-default Postgres database names it with `database`, a
reference declared in `backend/resources.ts`:

```ts no-verify
// backend/resources.ts
import { database } from "@rebasepro/types";
export const warehouse = database("warehouse");   // DATABASE_URL__WAREHOUSE

// backend/schema/orders.ts
import { warehouse } from "../resources";
export const orders = defineTable("orders", { database: warehouse, columns: { … }, rls: "admin-only" });
```

Routing is automatic: REST, the SDK, realtime, `context.data` and the CMS all
reach the right database. Every server source is Postgres with its own RLS;
MongoDB is retired, and a `database()` with another engine is refused at boot.
Firestore is a frontend data source only — see [Firestore](#firestore-collections).

## Type inference

```ts
import type { InferRow, InferInsert, InferUpdate } from "@rebasepro/server/schema";
import type { tasks } from "./tasks";

export type Task = InferRow<typeof tasks>;         // what REST returns
export type NewTask = InferInsert<typeof tasks>;   // what a create takes
export type TaskPatch = InferUpdate<typeof tasks>; // what an update takes
```

These are wire types. A `.notNull()` column is `T` on a row, any other
`T | null`; a column with a default is optional on insert; `.private()` columns
are absent; `.readOnly()` and stamped columns are absent from `InferUpdate`.

## The CMS: how a table becomes a collection

Every table the backend serves appears in the panel with no code. The CMS
derives a collection from the descriptor: a field per column (the editor from
the column's type: enum → select, `.userId()` → user picker, `col.storage()` →
uploader, `json.*` shape → nested form), a tab per to-many relation, a picker
per `belongsTo` (it replaces its foreign-key column in the form), and columns
the server stamps or marks `.readOnly()` drawn read-only.

`customizeTable` states what should differ, and nothing else:

```tsx
// frontend/src/cms/posts.tsx  (abridged from app/frontend/src/cms/posts.tsx)
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog posts",
    singularName: "Blog post",
    icon: "FileText",
    group: "Content",
    defaultViewMode: "cards",
    display: { title: "title", subtitle: "excerpt", image: "hero_image", status: "status", date: "publish_date" },
    form: {
        sidebar: ["status", "publish_date", "author", "tags"],
        sections: [
            { key: "post", fields: ["title", "slug", "hero_image", "excerpt"] },
            { key: "body", title: "Content", fields: ["content"] }
        ]
    },
    kanban: { columnField: "status", orderField: "__order" },
    filterPresets: [{ label: "Published", filterValues: { status: ["==", "published"] }, sort: ["publish_date", "desc"] }],
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publish_date: new Date().toISOString() }, "Post published")
        }
    ],
    fields: {
        slug: { filledByServer: true },
        excerpt: { multiline: true },
        content: { oneOf: { text: { markdown: true } } },
        status: {
            enumLabels: {
                draft: { label: "Draft", color: "gray" },
                published: { label: "Published", color: "green" }
            }
        },
        publish_date: { name: "Publish date", mode: "date_time", clearable: true },
        __order: { disabled: true, hidden: true }
    }
});
```

- **The first argument is the table's slug**, and with `<typeof posts>` it,
  every field key, every enum value and each option's applicability are checked
  against the table. One type argument, even when the slug differs from the name.
- **`fields.<key>`** takes a column key or a relation name. Every field: `name`,
  `description`, `hidden`, `hiddenInForm`, `disabled`, `readOnly`, `Field`,
  `Preview`, `Filter`, `columnWidth`, `filledByServer`, `span` (1–4 of the form
  grid), `customProps`, `conditions`, `dynamicProps`. Text: `multiline`,
  `markdown`, `previewAsTag`, `clearable`, `urlPreview`, `referenceTo`. Closed
  sets: `enumLabels`, `enumOrder`. Numbers: `format`. Dates: `mode`,
  `timezone`. Storage: `storage` (browser-side upload functions). Arrays: `of`,
  `sortable`, `expanded`. JSON: `fields`, `fieldOrder`, `oneOf`, `keyValue`.
  Relations: `previewFields`, `widget`, `fixedFilter`, `renderInForm`.
- **Table options**: `name`, `singularName`, `description`, `icon` (Lucide name),
  `group`, `hideFromNavigation`, `defaultViewMode`, `enabledViews`, `kanban`,
  `customViews`, `fieldOrder`, `listFields`, `previewFields`, `display`,
  `additionalFields`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets`,
  `pagination`, `inlineEditing`, `exportable`, `openEntityMode`, `form`,
  `formView`, `includeJsonView`, `entityActions`, `disableDefaultActions`,
  `entityViews`, `Actions`, `components`, `browserCallbacks`.
- **Components are imported by value** (`Field: RatingField`), never as string
  paths or lazy thunks; `customizeTable` throws on those, on an unknown option
  (naming the nearest one, or the new name of an old `admin` option such as
  `propertiesOrder` → `fieldOrder`), and on two customizations of one slug.
- **At runtime** a customization naming a field the server does not serve to
  this caller is skipped with a development warning, not an error.
- **`browserCallbacks` run in the browser** after the server's hooks: they ship
  to every visitor and secure nothing. Validation and access belong in the table.
- **Set `span`** on the fields you customize: `2` + `2` for two short values
  that belong together, `4` for anything that reads long.

Register them on `<RebaseCMS tableCustomizations={tableCustomizations} />`,
usually collected in `frontend/src/cms/index.ts`
(`export const tableCustomizations = [postsCms, authorsCms]`, in navigation
order). Custom components, views, actions and replacing built-in parts are in
`rebase-customize-admin`; record tabs and field widgets in `rebase-custom-views`.

### Kanban boards

A board is three decisions; ship all three together:

1. **`kanban: { columnField, orderField }`.** `columnField` is a `col.enum([...])`
   (or `.oneOf` strings). Without `orderField` a card's position within a column
   has nowhere to be stored: it snaps back on the next read, and the board shows
   an amber "ordering is not configured" bar. Nothing errors.
2. **`orderField` is a text column** (`__order: col.text()` in the table,
   `fields: { __order: { hidden: true, disabled: true } }` in the
   customization). Reordering writes a `fractional-indexing` key in the base36
   lower-case alphabet `0123456789abcdefghijklmnopqrstuvwxyz`; a number column
   or a plain counter cannot hold one.
3. **Rows created outside the panel need a key.** Nothing assigns one on insert
   (not REST, the SDK, a cron or a seed), so those rows land with `__order` null
   and the board asks to "Initialize". A backend that writes rows into a board
   table assigns the key:

```ts
import { generateKeyBetween } from "fractional-indexing";

const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const leads = client.data.table("leads");

// The last key in use. `is-not-null` matters: a descending sort is NULLS FIRST.
const { data: last } = await leads.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});
let cursor: string | null = (last[0]?.__order as string | undefined) ?? null;

for (const candidate of shortlist) {
    cursor = generateKeyBetween(cursor, null, ORDER_KEY_DIGITS);
    await leads.create({ ...candidate, status: "new", __order: cursor });
}
```

Carry the cursor across the loop: `generateKeyBetween(null, null, …)` per row
hands every row the same key.

## Firestore collections

Firestore is a frontend concern: the backend knows nothing about it, and
Firestore collections are never in `backend/schema`. Declare them with
`defineFirestoreCollection` from `@rebasepro/firebase` in `frontend/src/cms/`
and pass them to `<RebaseCMS externalCollections={[…]} />`:

```ts
// frontend/src/cms/events.ts
import { defineFirestoreCollection } from "@rebasepro/firebase";

export const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
        payload: { name: "Payload", type: "map" },
        // A reference to a row of the `customers` Postgres table.
        customerId: { name: "Customer", type: "reference", target: "customers" }
    }
});
```

The browser reads and writes Firestore directly: row-level security, the REST
API, the SDK, hooks and storage authorization do not apply, and Firebase
Security Rules decide access. The data source is registered with
`useFirestoreDataSource`; see the Firebase page of the docs.

## Applying a schema change

| Situation | Command |
|---|---|
| `pnpm dev` running | Save the file. Boot creates missing tables, columns, enum types and policies. |
| Check after an edit | `rebase verify` (`--json` names each file and fix) |
| Regenerate without `pnpm dev` | `rebase schema generate` (writes `backend/src/schema.generated.ts`), then `rebase generate-sdk` |
| What boot leaves alone (rename, narrowed type, removed column) in development | `rebase db push` (`--dry-run` prints the SQL; destructive changes need `--allow-destructive`) |
| Production | `rebase db generate` (writes `drizzle/migrations/*.sql`), review, then `rebase db migrate` |
| Relax `NOT NULL` / drop columns on a deployed backend | `rebase schema reconcile` (`--drop table.column`) |
| Schema and database disagree | `rebase doctor` |
| Adopt an existing database | `rebase schema introspect` (writes `defineTable` modules with `rls: "admin-only"`) |

Every one of these compiles the tables first and stops with a
`SchemaDefinitionError` listing each problem with the table, the column or
relation, and what to write instead — e.g. a table with no primary key, or
`rls: "inherit"` with no `defaultRls` exported. All take `--schema-dir <dir>`.
Never pass `--allow-destructive` against anything but a local development
database. Never hand-edit `schema.generated.ts`.

## References

- [references/migrate-from-collections.md](references/migrate-from-collections.md) — moving a project from `config/collections` to `backend/schema` + `frontend/src/cms`
- `rebase-security` — every `rls` rule form, `policy.*`, field access, fail-closed design
- `rebase-auth` — the users table, roles, scopes
- `rebase-sdk` — reading and writing tables from code
- `rebase-customize-admin`, `rebase-custom-views` — React components in the CMS
- Docs: <https://rebase.pro/docs/schema/>, <https://rebase.pro/docs/collections/relations/>, <https://rebase.pro/docs/frontend/customize-table/>
