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
            // Throw to block the deletion
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
  reads. What it does *not* gate is the values being written: refusing a write
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

Called after the row is written and before the commit, inside the same transaction. A throw rolls the save back — see [Transaction Semantics](#transaction-semantics).

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

Called before a record is deleted. Throw to block deletion.

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

## The `context.data` API

Every callback receives a `context` object that includes `context.data` — a unified data access layer for performing **cross-collection operations** from within lifecycle hooks.

### Accessing Collections

`context.data` uses a JavaScript Proxy, so you can access any collection by its slug as a property:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Available Methods

Each collection accessor (`context.data.<slug>`) provides these methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Query entities with filters, sorting, and pagination |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Fetch a single entity by ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Create a new entity |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Update an existing entity |
| `.delete()` | `delete(id: string \| number) → void` | Delete a record |
| `.count()` | `count(params?: FindParams) → number` | Count matching entities |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Real-time subscription (where supported) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Listen to a single entity |

### Querying with `.find()`

The `find()` method filters with `[operator, value]` tuples — the typed form of
the `?status=eq.published` query string the REST API reads:

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Creating Entities

`.create()` and `.update()` take the values to write, with the signatures above.
[Syncing Data Between Collections](#syncing-data-between-collections) uses both:
an approved submission creates a published job and is linked back to it.

### Security: which privileges `context.data` runs with

:::important
**`context.data` inherits the privileges of whatever triggered the callback.** It is not a fixed trust level.

- Triggered by a **user request** (REST, realtime, an admin-panel edit) → **user-scoped**. The callback runs inside the RLS-bound transaction opened for that request, so policies apply to reads *and* writes. A callback cannot see a row its caller could not.
- Triggered by **`rebase.dataAsAdmin` or a cron job** (the same singleton) → **admin-scoped**, not unscoped. That driver is scoped as `{ uid: "service", roles: ["admin"] }`, so the callback still runs on an RLS-bound transaction — your policies are evaluated, against that identity.
- Triggered by **the base driver** (built-in auth flows, migrations) → **unscoped**. It runs on the owner connection and bypasses RLS.
:::

This matters most in the direction that fails quietly. RLS *filters*, it does not raise — so a callback that reads a sibling row will find it when an admin task saves and may find nothing when an end user saves, with no error either way. Write callbacks that tolerate an empty result, or reach for the admin plane deliberately:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` is a second connection, not part of this write]
On Postgres, `context.client.dataAsAdmin` inside a request's callback runs in a
transaction of its own, on another pooled connection, while the triggering
write's transaction is still open. So it commits on its own, and stays if the
write rolls back. It also cannot see the row being saved, which is not committed
yet, and must not write it:

- An admin write with a foreign key back to that row (an `audit_logs.article_id`
  that references `articles`) fails its key check, and the caller's write fails
  with it.
- An admin write to the row being saved, or to any row this write has locked,
  waits for the write's lock while the write waits for the callback. Postgres
  cannot see that as a deadlock, so the request hangs until `statement_timeout`
  (30 seconds by default) and then fails.

For a record that has to reference the row, write it with `context.data`, which
rides the write's transaction, or enqueue a [job](/docs/backend/jobs): a job
enqueued from the callback commits with the write, and its handler runs after
the commit.
:::

:::caution[This page used to say the opposite]
Earlier versions of this page stated that callbacks always bypass RLS and have "full database access regardless of the triggering user's permissions". That was wrong, and wrong in the unsafe direction — it invited callbacks written on the assumption that they could always see everything.

The behaviour above is verified end-to-end against Postgres by the `"scopes context.data to the caller when a callback runs on a user request"` case in `@rebasepro/server-postgres`' RLS-enforcement suite.
:::

### Transaction Semantics

:::important
**A callback's `context.data` writes are part of the write that triggered it.** On Postgres, `beforeSave`, the save and `afterSave` — or `beforeDelete`, the delete and `afterDelete` — run inside one transaction, each callback awaited before the commit, and `context.data` writes through that same transaction.
:::

So the triggering write and everything its callbacks wrote commit together or not at all:

- A throw from `afterSave` or `afterDelete` rolls the triggering write back, along with every `context.data` write the callbacks made. The caller is answered **400 `CALLBACK_REJECTED`** with `details.stage` naming the hook — or with the error's own status when it carries one: a `RebaseApiError` you threw, a unique violation's 409.
- Realtime subscribers hear about the row only after the commit, so a write that rolled back is never announced.
- A callback holds the transaction open while it runs, so a slow one is a lock held and a pooled connection tied up.
- A `context.data` write runs the target collection's callbacks too, so an `afterSave` that updates its own row runs itself again. <span class="since-badge" data-since="0.24">Since 0.24</span> Writes nested more than 16 deep are refused with **500 `CALLBACK_RECURSION`**, naming the hook and the collection, and the whole write rolls back. Make such a write conditional, as the example below does.

Let a failure throw when the triggering write should not survive it. Catch it when it should, but only around a `context.data` **write**: a create, update or delete the database refuses (a unique or foreign key violation, a trigger) is undone on its own, and the rest commits.

Any other statement that fails on the write's transaction — a lookup, the read an update or delete makes to find its row (an id the key column cannot hold), a job enqueue the database refused — aborts that transaction in Postgres, and catching the error in JavaScript does not undo that. The write is refused with **500 `TRANSACTION_ABORTED`** and nothing is stored, rather than answering success for a write that was rolled back. Let such a failure throw, or check for the condition before running the statement.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Work that has to leave the database — an email, a webhook, a call to a third-party API — does not belong in the callback body. It would hold the transaction open for a network round trip, and nothing can take it back when the write rolls back. Enqueue a [job](/docs/backend/jobs) for it, or do it after the write returns: publish on a [realtime channel](/docs/backend/realtime), or use `waitUntil` in a [custom function](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) says which fits.

On MongoDB none of this holds. That driver runs the same callbacks without a transaction, so the write is already stored when `afterSave` runs, and a throw there reports the failure without undoing it.

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
