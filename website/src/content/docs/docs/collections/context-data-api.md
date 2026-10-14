---
title: The context.data API
sidebar_label: context.data API
description: Read and write other collections from inside a callback with context.data — its methods, the privileges it runs with, transaction semantics, and the connection a callback holds.
---

Every callback receives a `context` object that includes `context.data` — a unified data access layer for performing **cross-collection operations** from within lifecycle hooks.

## Accessing Collections

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

A property is the collection's accessor, the name the generated SDK gives it:
`context.data.myNotes` is the `my-notes` collection, whatever table it is
stored in. A name that is no collection's accessor is read as its snake_case,
so `context.data.auditLog` is `audit_log`.

Rows are untyped (`Record<string, unknown>`) until the project registers its
generated `Database`; then every accessor is typed from it. See
[Typed server-side data](/docs/backend/typed-server-data).

## Available Methods

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
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | The rows a [soft delete](/docs/collections/soft-delete#from-the-sdk) stamped |

## Querying with `.find()`

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

## Creating Entities

`.create()` and `.update()` take the values to write, with the signatures above.
[Syncing Data Between Collections](/docs/collections/callbacks#syncing-data-between-collections) uses both:
an approved submission creates a published job and is linked back to it.

## Security: which privileges `context.data` runs with

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

## Transaction Semantics

:::important
**A callback's `context.data` writes are part of the write that triggered it.** On Postgres, `beforeSave`, the save and `afterSave` — or `beforeDelete`, the delete and `afterDelete` — run inside one transaction, each callback awaited before the commit, and `context.data` writes through that same transaction.
:::

So the triggering write and everything its callbacks wrote commit together or not at all:

- A throw from `afterSave` or `afterDelete` rolls the triggering write back, along with every `context.data` write the callbacks made. The caller is answered **400 `CALLBACK_REJECTED`** with `details.stage` naming the hook — or with the error's own status when it carries one: a `RebaseApiError` you threw, a unique violation's 409.
- Realtime subscribers hear about the row only after the commit, so a write that rolled back is never announced.
- A callback holds the transaction open while it runs, so a slow one is a lock held and a pooled connection tied up — `beforeSave` and `beforeDelete` as much as the `after` hooks. See [A callback holds a connection](#a-callback-holds-a-connection).
- A `context.data` write runs the target collection's callbacks too, so an `afterSave` that updates its own row runs itself again. Writes nested more than 16 deep are refused with **500 `CALLBACK_RECURSION`**, naming the hook and the collection, and the whole write rolls back. Make such a write conditional, as the example below does.

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

## A callback holds a connection

On Postgres a write runs on one connection checked out of the database pool,
and every callback runs on it: `beforeSave` and `beforeDelete` after the
transaction has begun, `afterSave` and `afterDelete` before it commits. For as
long as a callback runs — awaiting a lookup, a computation, anything — that
connection serves nothing else, and the locks the write has taken stay taken:
in `afterSave`, the row just written; in a bulk or [`_batch`](/docs/backend/writes/#cross-collection-batches)
write, every row the transaction wrote before it.

The cost is the callback's own duration, and concurrent writes add it up:

- The pool holds 20 connections by default (`DB_POOL_MAX`). 25 saves at once
  whose `beforeSave` awaited 300 ms made an unrelated one-row read take 290 ms,
  nearly all of it spent waiting for a connection.
- A bulk create of 100 rows whose `beforeSave` awaits 50 ms is one transaction
  open for 5.3 s, holding its connection and the locks of every row written so
  far for all of it.

So:

- Keep anything slow out of callbacks. A call to another service belongs in a
  [job](/docs/backend/jobs), or after the write returns.
- Look up what a hook needs before the write when you can — in the client, or
  in a [custom function](/docs/backend/custom-functions) that then writes.
- Send rows whose hooks are slow in smaller bulks.
- If many slow hooks run at once by design, raise `DB_POOL_MAX`, within what
  the database's `max_connections` allows for every instance.
- With
  `REBASE_METRICS=true`, `/metrics` reports `rebase_db_pool_wait_ms`: how long
  each query waited for a connection. A healthy pool keeps it near zero; a tail
  that grows with traffic is requests queueing for connections that callbacks
  hold. See [Metrics](/docs/deployment/self-hosting/#metrics).
