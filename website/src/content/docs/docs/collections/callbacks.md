---
title: Table hooks
sidebar_label: Table hooks
description: "Run server-side code at every step of a table's lifecycle with hooks: narrow reads, mask fields, validate and complete writes, react to saves and deletes, and transform single columns."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table's `hooks` run on the server at each step of a row's life: before a
read, on each row leaving the server, before and after a write, and before and
after a delete. They run for every door into the table — REST, the SDK,
realtime, MCP and server code through `rebase.data` — and their code never
leaves the server, so an API key or a `process.env` read in a hook is safe.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // Derive the slug from the title when none is given.
            const title = values.title ?? previousValues?.title;
            if (title && !values.slug && !previousValues?.slug) {
                values.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        beforeDelete: ({ values }) => {
            if (values.status === "published") {
                throw new Error("Unpublish the article before deleting it.");
            }
        },
    },
});
```

The props are typed from the table's columns: `values.title` above is a
`string`, and `values.status` is `"draft" | "published"`.

:::note[Coming from collections?]
Table hooks are the server `callbacks` of a collection, with the same
lifecycle. Each hook receives the table's descriptor as `table`, and `afterRead`
and the delete hooks receive the row as `values`. The upgrade guide for this
release lists the renames.
:::

## The seven hooks

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Hook | Runs | Returns |
|---|---|---|
| `beforeQuery` | before every read is compiled | a filter to AND into the read, or nothing |
| `afterRead` | on every row leaving the server | the row to serve |
| `beforeSave` | before a create or an update, inside its transaction | the values to write; throw to refuse |
| `afterSave` | after the write, before the commit | nothing; throw to roll the write back |
| `afterSaveError` | after a write failed and rolled back | nothing |
| `beforeDelete` | before a delete, inside its transaction | `false` or throw to refuse |
| `afterDelete` | after the delete, before the commit | nothing; throw to roll the delete back |

Every hook may be `async`. Every hook receives:

| Prop | What it is |
|---|---|
| `table` | The table as the server knows it: its descriptor, with columns, relations and the `rls` posture. |
| `path` | The path the request addressed: the slug, or a nested path. |
| `context` | The caller (`context.user`), and `context.data` scoped to them. See [The `context.data` API](/docs/collections/context-data-api/). |

One writer does not run them: **the auth system**. Registration, OAuth sign-in
and an admin's user management write the users table directly. See
[The users table](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

A table written by the CMS directly in the browser, with no Rebase server in
the request path, never reaches these hooks. The CMS has browser-side hooks of
its own for that case, described with the CMS customizations.

## `beforeQuery`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Runs **before a read is compiled**, to narrow which rows it asks for. Return
conditions to AND into the query; return nothing to add none.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text().notNull(),
        subject:  col.text().notNull(),
    },
    rls: [{ operation: "all", access: "authenticated" }],
    hooks: {
        beforeQuery: ({ operation, context }) => {
            // operation: "list" | "get" | "count" | "aggregate" | "relation"
            if (context.user?.roles?.includes("admin")) return;
            return { filter: { tenantId: ["==", String(context.user?.uid ?? "")] } };
        },
    },
});
```

- **It can only narrow.** `filter` takes the same field filters a query does;
  `logical` takes an `or`/`and` group for a scope like "mine, or shared with
  me", still ANDed in as a whole.
- **It runs on every read path**: the listing, a single get, the count, the
  aggregate, the search, the vector read, a nested-path listing, the realtime
  refetch behind a `.listen()`, and the rows loaded for a relation or an
  `?include=`, where it is the **target** table's hook that applies.
- **A filter it cannot compile refuses the request.** Naming a column the table
  does not have is a 400, never a dropped condition.
- **A write to a row it excludes is a 404.** An update or a delete addressed at
  a row outside the scope is refused before the write. Refusing a write on its
  contents is `beforeSave`.

The uniqueness check behind `.unique()` is not narrowed: narrowed, it would
answer "unique" for a value a hidden row already holds.

Row-level security is the authorization model; `beforeQuery` is application
logic on top of it. Use [`rls`](/docs/collections/security-rules/) for anything
that must hold for SQL run as the caller too.

## `beforeSave`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Runs before a row is written, and returns the values to write. `values` holds
every value on a create and the changed ones on an update; `previousValues` is
the row as it was, on an update; `status` is `"new"`, `"existing"` or `"copy"`;
`id` is absent on a create whose key the database generates.

It runs inside the write's transaction, so it holds a pooled connection for as
long as it runs. See [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Throw to **refuse the write**. Nothing reaches the database, and the caller
gets **400** with your message and the code `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

To choose the status and code — a 409 for a clash, a 422 for something
well-formed but unacceptable — throw a `RebaseApiError`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        slug:  col.text().notNull(),
        price: col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: async ({ values, context }) => {
            if (values.slug) {
                const taken = await context.data.products.count({ where: { slug: ["==", values.slug] } });
                if (taken > 0) throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
            }
            return values;
        },
    },
});
```

Import `RebaseApiError` from `@rebasepro/types`: schema files load no server
code, and it is the same class the typed SDK throws.

## `afterSave` and `afterSaveError`

<span class="since-badge" data-since="0.31">Since 0.31</span>

`afterSave` runs after the row is written and before the commit, in the same
transaction. Its `values` are the row as stored. A throw rolls the save back,
together with everything the hook wrote through `context.data`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, status, values, context }) => {
            // Commits with the order, or not at all.
            await context.data.audit_log.create({ table: "orders", rowId: String(id), action: status, state: values.status });
        },
    },
});
```

Work that leaves the database — an e-mail, a webhook — does not belong in the
hook body: it holds the transaction open for a network round trip, and nothing
takes it back if the write rolls back. Enqueue a [job](/docs/backend/jobs/)
instead; a job enqueued from a hook commits with the write.

`afterSaveError` runs when a save failed at the database or after it, once the
failed write's transaction has rolled back. It does not run for a `beforeSave`
refusal or a request refused before the write. Its `context.data` is a fresh
one for the same caller, so a job it enqueues survives the failure it reports. A
throw from it is logged, and the caller still gets the save's own error.

## `afterRead`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Runs on every row leaving the server — a read's response, a write's response,
a realtime frame, an MCP result — and returns the row to serve. `values` is the
row as stored, after [field access](/docs/collections/field-access/) has
removed what the caller may not read.

It shapes what a caller receives and nothing else: `afterSave`, the delete
hooks and [history](/docs/backend/history/) get the row as stored, so a value
masked here is never what an audit records or a revert writes back. History
*serves* its entries through `afterRead` too, so a snapshot shows the value
masked as the row does.

Rows embedded in another table's response — an `include`, a relation ref's
values, the rows a realtime frame carries for a relation — are masked one
level deep with the **target** table's `afterRead`. The order is global, then
table, then column `.transform({ afterRead })`. A realtime service with no
driver to run the hooks refuses frames for a table that has them, rather than
send them unmasked.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        email: col.text().notNull(),
        phone: col.text(),
    },
    rls: [{ operation: "select", roles: ["support", "sales"] }],
    hooks: {
        // Mask contact details for everyone but support.
        afterRead: ({ values, context }) => {
            if (context.user?.roles?.includes("support")) return values;
            return {
                ...values,
                email: values.email.replace(/^(.).*(@.*)$/, "$1***$2"),
                phone: values.phone === null ? null : "•••",
            };
        },
    },
});
```

An aggregate returns sums and counts, not rows, so it cannot pass through
`afterRead`. On a table with one, only `count()` without `groupBy` is served;
any other [aggregate](/docs/sdk/aggregates-and-search/#aggregates) is refused
with `400 AGGREGATE_MASKED_BY_AFTER_READ`.

A value a caller must never receive is better withheld than masked:
[`.access()` or `.private()`](/docs/collections/field-access/) remove the column
before any hook runs, and keep it out of filters too.

## `beforeDelete` and `afterDelete`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Both receive the row being deleted as `values`, and its `id`.

`beforeDelete` runs inside the delete's transaction. Throw to refuse the delete,
and the caller gets `400 CALLBACK_REJECTED` with your message. Returning `false`
refuses it too, as `403 CALLBACK_REJECTED` with no message of yours.

`afterDelete` runs after the row is deleted and before the commit. A throw
rolls the delete back. On a table with [soft delete](/docs/collections/soft-delete/),
a delete is a stamp, and both hooks still run.

## Field hooks: `.transform()`

<span class="since-badge" data-since="0.31">Since 0.31</span>

A column's `.transform()` takes two field-level hooks: `beforeSave` returns the
value to store, and `afterRead` returns the value to serve. They run on the
server, for every caller, and receive `value`, the whole row as `values`, and
the props every hook gets.

`value` is typed truthfully: `T | null` on a nullable column, and `T` when
`.notNull()` is written **before** `.transform()`. On a JSON field it is
`T | undefined` unless `.required()` comes first.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contacts = defineTable("contacts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => value.trim().toLowerCase(),
        }),
        iban: col.text().transform({
            afterRead: ({ value, context }) =>
                value && !context.user?.roles?.includes("finance") ? `•••• ${value.slice(-4)}` : value,
        }),
    },
    rls: "admin-only",
});
```

`.transform()` is also available on array items and on every field of a
[JSON document](/docs/schema/json/). For trimming and case, the
`trim`, `lowercase` and `uppercase` [validation rules](/docs/schema/columns/#validation)
need no code.

## Writing to other tables

<span class="since-badge" data-since="0.31">Since 0.31</span>

`context.data` reads and writes any table by its slug, as the caller and in the
same transaction as the write that ran the hook:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const submissions = defineTable("job_submissions", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        title:         col.text().notNull(),
        status:        col.enum(["pending", "approved", "rejected"]).notNull().default("pending"),
        promotedJobId: col.uuid(),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, values, previousValues, context }) => {
            // When a submission is approved, publish it as a job and link it back.
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const job = await context.data.jobs.create({ title: values.title, status: "published" });
                await context.data.job_submissions.update(id, { promotedJobId: job.id });
            }
        },
    },
});
```

The update above saves `job_submissions` again, which runs this hook again;
the status check is what stops it. [The `context.data` API](/docs/collections/context-data-api/)
covers the privileges it runs with, the transaction and nesting limits.

## Hooks for every table

<span class="since-badge" data-since="0.31">Since 0.31</span>

Hooks that apply to every table — PII masking across the schema, a global audit
log — are exported as `hooks` from `backend/hooks.ts`, in the same
`TableHooks` shape. They run before each table's own hooks, which run before
its columns' `.transform()`. See [Global hooks](/docs/backend/hooks/).

Hooks can also be attached after boot with `setTableHooks(slug, hooks)` on the
backend. That **replaces** the hooks the table declared; to add to them, pass
`composeTableHooks(declared, yours)`.

## Combining hook sets

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table has one `hooks` object. When several concerns each want a hook — a slug
generator, an audit trail, a tenant scope — write each as its own set and
combine them with `composeTableHooks` from `@rebasepro/common`:

```ts
import { defineTable, col, type TableHooks } from "@rebasepro/server/schema";
import { composeTableHooks } from "@rebasepro/common";

const auditTrail: TableHooks = {
    afterSave: async ({ table, id, status, context }) => {
        await context.data.audit_log.create({ table: table.slug, rowId: String(id), action: status });
    },
};

export const pages = defineTable("pages", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug:  col.text(),
    },
    rls: "admin-only",
    hooks: composeTableHooks(auditTrail, {
        beforeSave: ({ values }) =>
            typeof values.title === "string" && !values.slug
                ? { ...values, slug: values.title.toLowerCase().replace(/\s+/g, "-") }
                : values,
    }),
});
```

The sets run in the order given, and each hook combines the way the backend
combines its global and table tiers:

| Hook | Combined |
|---|---|
| `beforeSave` | Chained: each set sees the values the previous one returned, shallow-merged over what it was given |
| `afterRead` | Chained: each set gets the row the previous one returned |
| `beforeQuery` | ANDed: every set sees the caller's query, and a row must pass every narrowing |
| `beforeDelete` | Any `false` vetoes the delete; every set still runs |
| `afterSave`, `afterDelete` | Run in order, each awaited; a throw stops the rest |
| `afterSaveError` | Run in order; a throw does not stop the next set, and the first error is rethrown at the end |

A hook is in the result only if some set has it, and an `undefined` set is
skipped. A set written apart from its table, like `auditTrail` above, is typed
with the generic row, so read its values as `unknown` and check them.

## Testing a hook

<span class="since-badge" data-since="0.31">Since 0.31</span>

A hook is a plain function of one props object, so a unit test calls it:
`posts.config.hooks?.beforeSave?.(props)`. `createCallContext` from
`@rebasepro/server` builds the `context` prop with only the fields the test
passes; any other field throws on first use, naming itself. `table` is the
descriptor `compileTables` from `@rebasepro/common` returns for the table. To run
hooks against a real database, see [Scripts and the Console](/docs/backend/scripts/).

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [The `context.data` API](/docs/collections/context-data-api/): privileges, transactions and the connection a hook holds
- [Global hooks](/docs/backend/hooks/): hooks across every table
- [Entity history](/docs/backend/history/): an audit trail without writing hooks
