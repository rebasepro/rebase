---
title: Entity Callbacks
sidebar_label: Callbacks
description: Use lifecycle callbacks to run custom logic when entities are created, updated, read, or deleted. Includes the context.data API for cross-collection operations.
---

## Overview

Callbacks let you hook into the entity lifecycle to:

- **Sync data between collections** — copy or move entities across tables on status changes
- **Transform data** before saving (computed fields, slugification)
- **Validate** business rules beyond schema validation
- **Trigger side effects** after writes (send emails, sync APIs, update caches)
- **Narrow a read** before it is compiled, so a caller only ever sees their own rows
- **Filter/transform** data after reading
- **Cascade operations** — clean up related records on delete

## Where callbacks run

A collection has two callback blocks, and the only difference is which runtime
executes them.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Runs on | the server | the admin panel, in the browser |
| Fires for | REST, the SDK, realtime, `dataAsAdmin` | reads and writes the panel makes |
| Reaches the browser | no — bodies are stripped from the bundle | yes, in full |
| Use for | everything below | collections the panel talks to directly |

**`callbacks` is the one you want.** It runs on every data path that reaches
the server — REST, the SDK, realtime, MCP and `rebase.data` — and its body never
leaves the machine, so an API key or a `process.env` read there is safe. The
rest of this page is about `callbacks`.

One writer is not a data path: **the auth system**. Registration, OAuth sign-in
and the admin's user management write the users rows directly and run none of
their callbacks, so a welcome email in `afterSave` on `users` never fires on
sign-up. Hang it on the [auth hooks](/docs/backend/authentication/) passed in
`auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — which
take an ejected backend; boot warns when the users collection declares callbacks
sign-up will not run.

`admin.browserCallbacks` exists for one case: a collection on a `direct` or
`custom` transport, which the panel reads and writes *itself* with no Rebase
server in the request path. Nothing server-side sees those operations, so
`callbacks` can never fire for them, and this block is the only place their
lifecycle logic can live.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declared with transport: "direct"
    properties: {
        city: { name: "City", type: "string" },
        code: { name: "Code", type: "string" }
    },
    admin: {
        browserCallbacks: {
            afterRead: ({ row }) => ({ ...row, label: [row.city, row.code].join(" · ") })
        }
    }
};
```

Two rules follow from "ships to every visitor", and neither is stylistic:

1. **No secrets.** No API keys, no `process.env`, nothing you would mind a
   reader of the bundle seeing. That belongs in `callbacks`.
2. **It is not a security boundary.** A `browserCallbacks.afterRead` that
   redacts a field redacts it *after* the browser already holds the row — on a
   direct transport the raw document came straight from the store. It is
   presentation. Redaction that has to hold goes in `callbacks`, or in the
   store's own rules.

On a server-transport collection — the default, and almost certainly yours —
the server has already run `callbacks` before the row reaches the panel, so a
`browserCallbacks.afterRead` runs *in addition* to it. Write it to be
idempotent, or don't write it.

A `browserCallbacks.afterSave` runs after the write has been stored, and
nothing in the browser can roll it back. A throw from it is shown as a warning;
the save itself is reported as done, so the form does not offer to create the
record a second time.

## Defining Callbacks

```typescript
import { defineCollection } from "@rebasepro/cms-types";

// The row shape is inferred from `properties`, so `values.title` below is a
// `string` without anything being written twice.
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values, id, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            values.updatedAt = new Date().toISOString();

            return values;
        },

        afterSave: async ({ values, id }) => {
            // Send notification
            console.log(`Article ${id} saved: ${values.title}`);
        },

        beforeDelete: async ({ id }) => {
            // Prevent deletion of published articles
            // Throw (or return false) to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Callback Reference

### `beforeQuery`

Called **before a read is compiled**, to narrow which rows it asks for. Return
conditions to AND into the query; return nothing to add none.

```typescript
beforeQuery: ({
    operation,   // "list" | "get" | "count" | "aggregate" | "relation"
    query,       // the parsed read, read-only
    context
}) => {
    if (context.user?.roles?.includes("admin")) return;
    return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
}
```

`afterRead` sees rows that have already been fetched, so it can redact a value
but cannot stop the row being read. This runs earlier, and three things about it
are worth knowing:

- **It can only narrow.** The return value is a filter to AND in, and no value
  it can return widens the read. `filter` takes the same field filters a query
  does; `logical` takes an `or`/`and` group, for a scope like "mine, or shared
  with me" — still AND-ed in as a whole, so the `or` only ever chooses among
  rows the rest of the query already admits.
- **It fires on every read path.** The listing, the single get, the count, the
  aggregate, the search, the vector read, a nested-path listing, the realtime
  refetch behind a `.listen()`, and the rows loaded for a relation or an
  `?include=` — where it is the **target** collection's hook that applies,
  because those are the target's rows.
- **A filter it cannot compile refuses the request.** Naming a column the table
  does not have is a 400, never a dropped condition.
- **A write to a row it excludes is a 404.** An update or a delete addressed at
  a row outside the scope is refused before the write, with the same "no row …"
  answer a read gives — so a scope is a scope for writes too, not only for
  reads. A one-to-many membership write (`comments: [ids]` on a post) leaves a
  child the target's scope hides where it is, as it leaves an id that names no
  row. What it does *not* gate is the values being written: refusing a write
  on its contents is `beforeSave`.

One read is deliberately not narrowed: the uniqueness check behind
`validation: { unique: true }`. It asks whether a value exists anywhere in the
table, and narrowed it would answer "unique" for a value a hidden row already
holds.

:::caution[Postgres only, for now]
`beforeQuery` is implemented by `@rebasepro/server-postgres`. A collection served
by MongoDB or Firestore that declares one **fails at boot**, by name, rather
than being served with the hook silently inert — which for a row filter would
mean every row served to everybody. A [global](/docs/backend/hooks)
`beforeQuery` fails at boot the same way if any data source is not Postgres, and
so does one attached later with `setCollectionCallbacks`. Redaction that works
on every engine is [`afterRead`](#afterread).
:::

→ [Extending the server](/docs/backend/extending#2-collection-callbacks) for
where this sits among the other options.

### `beforeSave`

Called before a record is written to the database. Return the modified values.
On Postgres it runs inside the write's transaction, which has already begun, so
it holds a pooled connection for as long as it runs — see [A callback holds a
connection](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Throw an error to **block the save**. The write never reaches the database, and
the caller gets **400** with your message and the code `CALLBACK_REJECTED`:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

To choose the status and code yourself — a 409 for a clash, a 422 for something
well-formed but unacceptable — throw a `RebaseApiError`:

```typescript
import { RebaseApiError } from "@rebasepro/types";

beforeSave: async ({ values }) => {
    if (await isTaken(values.slug)) {
        throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
    }
    return values;
}
```

:::note
Import it from `@rebasepro/types`, not from `@rebasepro/server`. A collection file
is shared with the frontend — the admin panel's Vite build reads this same
directory — so it may only import packages that run in a browser. `RebaseApiError`
is the browser-safe one, and it is the same class the typed SDK throws.
:::

### `afterSave`

Called after the row is written and before the commit, inside the same transaction. A throw rolls the save back — see [Transaction Semantics](/docs/collections/context-data-api#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values: the row as stored, not afterRead's view of it
    id,             // Entity ID
    previousValues, // Previous values (undefined for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Same transaction as the save: the log row commits with the article or not at all
    await context.data.audit_log.create({ action: status, article_id: id, title: values.title });
}
```

### `afterSaveError`

Called when a save operation fails.

```typescript
afterSaveError: async ({
    values,
    id,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

It runs for a save that failed at the database or after it — not for a
`beforeSave` refusal, a request refused before the write (validation, a missing
permission, a 404), or a commit refused after the save returned ([full list](/docs/backend/hooks/#when-aftersaveerror-runs)).

On a request, it runs once the failed write's transaction has rolled back, not
inside it. Its `context.data` is a fresh one for the same caller, where each call
is a transaction of its own, so a [job](/docs/backend/jobs), queue message or
webhook it enqueues commits and survives the failure it reports. A throw from
`afterSaveError` is logged, and the caller still gets the save's own error.

### `afterRead`

Called after reading entities from the database. Transform the data for display.

It shapes what a caller receives — a read's or a write's response, and its
realtime frame — and nothing else: `afterSave`, `beforeDelete`, `afterDelete` and
[history](/docs/backend/history) get the row as stored: a value masked here is
never what an audit records or a revert writes back, and a field added here is
never written.

```typescript
afterRead: async ({
    row,    // The row to transform
    context
}) => {
    // Add computed fields
    return {
        ...row,
        displayName: `${row.first_name} ${row.last_name}`
    };
}
```

### `beforeDelete`

Called before a record is deleted. Throw to block deletion, and the caller gets `400 CALLBACK_REJECTED` with your message. Returning `false` blocks it too, as `403 CALLBACK_REJECTED` with no message of yours.

```typescript
beforeDelete: async ({
    id,
    row,
    context
}) => {
    if (row.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Called after the row is deleted and before the commit, inside the same transaction. A throw rolls the delete back.

```typescript
afterDelete: async ({
    id,
    row,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${id} deleted`);
}
```

## Property Callbacks

You can also define callbacks at the property level for field-specific transformations:

```typescript
properties: {
    email: {
        type: "string",
        name: "Email",
        callbacks: {
            beforeSave: ({ value }) => value?.toLowerCase().trim(),
            afterRead: ({ value }) => value // Could decrypt, etc.
        }
    }
}
```

Every callback also gets `context.data`, a data layer for reading and writing other collections from inside the hook — see [The `context.data` API](/docs/collections/context-data-api).

## Syncing Data Between Collections

One of the most powerful uses of callbacks is **syncing data across collections** using `context.data`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const submissionsCollection = defineCollection({
    slug: "job_submissions",
    name: "Job Submissions",
    table: "job_submissions",
    properties: {
        title: { name: "Title", type: "string" },
        description: { name: "Description", type: "string" },
        company_id: { name: "Company", type: "string" },
        status: { name: "Status", type: "string" },
        promoted_job_id: { name: "Promoted job", type: "string" }
    },
    callbacks: {
        afterSave: async ({ values, id, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Update the submission with the promoted job reference
                await context.data.collection<Record<string, unknown>>("job_submissions").update(id, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Other cross-collection patterns:

- **Cascade delete**: Use `afterDelete` to remove related records in child collections
- **Denormalization**: Use `afterSave` to update summary fields in a parent collection
- **Audit logging**: Use `afterSave` / `afterDelete` to write to an audit log collection
- **Counters**: Use `afterSave` / `afterDelete` to update count fields on related entities

## Full Context Reference

Every callback receives a `context` object of type `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** The authenticated user, if any */
    user?: User;
    /** The driver running this operation (server-side only) */
    driver?: DataDriver;
    /** The query accessor — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Functions, storage, email and dataAsAdmin — but no `data` */
    client: RebaseCallbackClient;
    /** The default storage source */
    storageSource: StorageSource;
}
```

Query through `context.data`. `context.client` has no `data`: server-side it is
the `rebase` singleton, whose only data plane is the admin-scoped `dataAsAdmin`,
so `context.client.data` is a compile error.

## Next Steps

- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Entity History](/docs/backend/history)** — Audit trail
- **[Custom Functions](/docs/backend/custom-functions)** — Add custom API endpoints
