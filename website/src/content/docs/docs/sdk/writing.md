---
title: Writing data
sidebar_label: Writing data
description: create, upsert, update and delete with the SDK — field operations, conditional writes, idempotency keys, batch writes, and writing across collections in one transaction.
---

Reads are on [Querying data](/docs/sdk/querying/). This page is the other half:
everything that changes a row.

Every method here goes through the same pipeline a write from anywhere else
does — [callbacks](/docs/collections/callbacks/),
[relations](/docs/collections/relations/) and
[row-level security](/docs/collections/security-rules/) all still apply. None of
it is a shortcut past your own rules; what these options buy is a round trip, a
transaction, or a race you no longer have to lose.

## Single-row writes

### Create

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Upsert

Insert the row, or replace the one already occupying its key:

```typescript
await client.data.users.upsert(
    { email: "ada@example.com", name: "Ada" },
    { onConflict: ["email"] }
);
```

One statement server-side (`INSERT … ON CONFLICT DO UPDATE`), so unlike a
`findById` followed by `create`-or-`update` it cannot lose the race between the
two, and unlike `create` it does not fail when the row is already there.

`onConflict` defaults to the primary key, which is the wrong target for most of
the writes an upsert is reached for: keyed on a serial id that is a plain
insert, because the caller does not know the id — so a re-runnable import
duplicates every row on the second run. Name the natural key instead. It must
carry a uniqueness guarantee the database can match on — `validation: { unique:
true }` on the property, or the columns of a `unique: true`
[index](/docs/backend/indexes/) — and anything else is a 400 listing the targets
that do exist, rather than an error raised from inside a transaction.

The `on_create` timestamp of a row that already existed is left alone: a
conflict means its creation is a fact about the past.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Field operations

A value may be an operation on the *stored* value instead:

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Operator | Property type | Meaning |
|----------|---------------|---------|
| `$inc` | `number` | add (negative to subtract) |
| `$push` | `array` | append one value, or each of an array of values |
| `$pull` | `array` | remove every occurrence of a value |
| `$merge` | `map` | shallow-merge an object in |

The reason to reach for them is the read you no longer make, and the race that
read opens. `views = current + 1` means fetching `current` first, and two
requests that each read `4` both write `5` — an increment is lost and neither
response says so. Compiled into the statement, the arithmetic happens inside the
row lock.

Exactly one operator per field, and only on an update: over a row that does not
exist yet there is nothing to operate on, so an operation in a `create`,
`createMany` or `upsert` is a 400. An operator on the wrong property type, or a
misspelled `$operator`, is a 400 naming the field — never a JSON document
written into the column.

While offline they are refused rather than queued: an operation is evaluated
against a stored value the device has no current copy of, and an optimistic row
could only show the marker itself until the queue drained.

### Delete

```typescript
await client.data.products.delete(42);
```

### Conditional writes

`update` and `delete` take an `ifMatch`, so a write is refused when the row has
changed since you read it:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Without it, read-modify-write is last-writer-wins over everything you did not
send: two editors a second apart both succeed, and the first one's change is
gone with no error anywhere.

`etagOf(row)` reads the version off a row that came from `findById`/`get`. It
lives on a non-enumerable key, so it never enters the generated `Row` type, a
`JSON.stringify`, or a spread into the next update body. It is `undefined` for a
row from `find()`, from the offline cache, or from a server that sends no
`ETag` — and passing `undefined` sends no precondition, so the call above
degrades to an ordinary update rather than throwing.

### Skipping the response

Every write resolves to the row it wrote. Pass `{ returning: false }` when you
do not need it:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

That sends `Prefer: return=minimal`; the server answers `204` for a single write
and the ids only for a batch. The method then resolves to `undefined` (or `[]`),
so you cannot accidentally use a row the server never sent. Worth it on imports
and fire-and-forget writes — the default is the row because it carries what the
*server* decided.

## Batch Writes

Three operations write many rows in a **single request and a single
transaction**. Every row still runs the normal pipeline — callbacks, relations,
row-level security — so a batch is not a shortcut past your own rules; the win
is one round trip and one transaction instead of N of each.

All three are **all-or-nothing**. If any row is rejected, none of them land and
the error names the offending index.

```typescript
// Create
await client.data.products.createMany([
    { name: "Widget", price: 9.99 },
    { name: "Gadget", price: 19.99 }
]);

// Update — each entry names its row and the fields to change
await client.data.orders.updateMany([
    { id: "o-1", data: { status: "shipped" } },
    { id: "o-2", data: { status: "shipped" } }
]);

// Delete — by id
await client.data.sessions.deleteMany(["s-1", "s-2"]);
```

### Why `{ id, data }` rather than flat rows

`createMany` takes flat rows because a row being created *is* its columns.
`updateMany` names the address separately, because on a table keyed on something
other than `id` — a `sku`, a composite key — a flat row cannot say whether a
column is the address or a value to write. This mirrors single-row
`update(id, data)` exactly.

### Why `deleteMany` takes ids, not a filter

A filter-shaped bulk delete is a different and far more dangerous operation: the
failure mode is an omitted or mistyped condition emptying a table, and it cannot
be reviewed at the call site the way an explicit list can. Read first, then pass
the ids you meant:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

### Retries and duplicates

A client that never sees the response cannot know whether the batch committed,
so it retries — and without a key the server cannot tell that retry from a
second genuine batch. Pass an idempotency key on anything that may be resent:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

A key names one request, not a job: it is recorded against the method, the path
and the body it was sent with. Re-sending that exact request replays its answer;
the same key on a different request is refused with `IDEMPOTENCY_KEY_REUSED`
(422). So mint one per call rather than reusing a business id — an `importId`
shared by the `createMany` and the `deleteMany` of one import would leave the
delete silently unperformed.

A retry that arrives while the first attempt is still being answered gets
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): send it again, and it will be answered with
the first attempt's result once that lands. Keys are honoured for 24 hours, and
only for a signed-in caller — there is no principal to scope one to otherwise.

The offline queue sets a key automatically on every replay.

### Limits

Batches are capped server-side (1000 rows by default), because one batch holds
its locks for the whole transaction. Going over is a `BULK_TOO_LARGE` error that
names both the limit and your row count, so chunk to it:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

A data source that cannot write atomically reports `BULK_UNSUPPORTED` rather
than quietly looping single writes — which would give you neither the atomicity
nor the single round trip you reached for a batch to get.

## Writing across collections

`createMany` and friends are one collection at a time. `client.batch()` is the
cross-collection form: one request, one transaction, all of it or none.

```typescript
const result = await client.batch([
    { op: "create", collection: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", collection: "order_items",
      values: { order_id: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` is `create`, `update`, `upsert` or `delete`, and `collection` narrows
`values` to that collection's generated `Insert` or `Update` shape. Every
operation runs the pipeline its single-row equivalent runs — the same
validation, callbacks and row-level security, as the same user.

### `$ref`

An operation may name itself with `ref`; a later one may stand
`{ $ref: "<name>.<field>" }` wherever a value goes, including as an `id` and at
any depth inside `values`. It resolves to that field of the row the named
operation wrote.

This is why the method exists rather than a loop over `createMany`: the child's
foreign key does not exist until the parent is inserted, so the two would have
to be separate requests — and separate requests can half-succeed. The recovery
from that (read back, work out which half landed, undo it) is code nobody
writes.

Only backward references resolve. A forward one is refused before the
transaction opens, along with unknown collections, unknown fields, illegal field
operations and ineligible conflict targets — because finding a mistake at
operation 40 would otherwise cost the rollback of the 39 writes before it.

### Limits and failures

The same 1000-operation cap as a bulk write, for the same reason: one batch
holds its locks for the whole transaction. An `update` or `delete` naming a row
that does not exist fails the whole batch with a 404. A backend whose driver
cannot make it atomic answers `BATCH_UNSUPPORTED` rather than looping.

`idempotencyKey` and `returning` work as they do on every other write.
