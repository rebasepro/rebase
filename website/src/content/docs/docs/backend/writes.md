---
title: Writing over REST
sidebar_label: Writing over REST
description: Idempotency keys, conditional writes with ETag and If-Match, field operations, upserts on a natural key, return=minimal, and cross-collection batches.
---

The verbs are on the [REST API](/docs/backend/api/) page. This one is about the
five things a write can *ask for* beyond its verb, and the endpoint that writes
across collections at once. All of them are opt-in per request: a write that
does not ask for any of this behaves exactly as it always has.

## Writing

Beyond the verbs, the write routes take five things that change how a write
behaves. All five are opt-in per request, so nothing here changes what a
request that does not ask for it does.

### Idempotency

`Idempotency-Key: <uuid>` on any write means "if you have already answered this
exact request, answer it again rather than doing it twice".

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

A client that never sees a response cannot know whether the write committed, so
it retries — and without a key the server cannot tell that retry from a second
genuine write. On a table with a server-assigned id that is a duplicate row,
because the id the client invented was never used.

A key names **one request**: it records the method, the path and the body it was
claimed for. Re-send that exact request and its answer is replayed; send a
different one under the same key and it is refused with `IDEMPOTENCY_KEY_REUSED`
(422) rather than answered with the first one's result. A retry that arrives
while the first is still in flight gets `IDEMPOTENCY_KEY_IN_PROGRESS` (409) —
send it again once the first has landed.

Honoured on `POST`, `PATCH`, `DELETE`, all three `/bulk` routes and `/_batch`.
Keys live for 24 hours and are scoped to the signed-in caller; an
unauthenticated request has no principal to scope one to, so the header is
ignored there. A backend that cannot store keys ignores the header rather than
refusing the write.

`DELETE` is the case worth reading twice. Replayed without a key, the second
attempt finds the row gone and answers `404` — which a retrying client reads as
a permanent failure for a delete that in fact succeeded. Under a key it replays
the `204`.

### Optimistic concurrency: `ETag` and `If-Match`

`GET /api/data/:slug/:id` returns an `ETag`. Send it back as `If-Match` on a
later `PATCH` or `DELETE` and the write is refused with `412` if the row has
changed in between.

```bash
# read
curl -i /api/data/docs/d1
# → ETag: "9f2c…"

# write, conditionally
curl -X PATCH /api/data/docs/d1 \
     -H 'If-Match: "9f2c…"' \
     -d '{"title": "Second draft"}'
# → 412 PRECONDITION_FAILED if somebody else edited it first
```

Without it, read-modify-write is last-writer-wins over everything the second
write did not send: two editors a second apart both succeed and the first one's
change is gone with no error anywhere.

The tag is derived from a `date` property with `autoValue: "on_update"` when the
collection declares one — that column already *is* a version — and from a stable
hash of the row otherwise. `If-Match: *` asserts only that the row exists.
Nothing is written when the precondition fails.

### Field operations

A property's value in a `PATCH` body may be an operation on the stored value
rather than a value:

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Operator | Property type | Becomes |
|----------|---------------|---------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)`, or a jsonb concatenation |
| `$pull` | `array` | `array_remove(col, …)`, or a jsonb re-aggregation |
| `$merge` | `map` | `col || '…'::jsonb` (a **shallow** merge) |

The point is the read the caller no longer makes. Expressing `views + 1` as a
value means reading it first, and two requests that each read `4`, add one and
write `5` end at `5` — with nothing in either response saying an increment went
missing. Compiled into the statement, the arithmetic happens inside the row lock
and cannot lose.

Exactly one operator per field. An operator on a property type it is not defined
on, an unknown `$operator`, or an operand of the wrong shape is a `400`
(`INVALID_FIELD_OPERATION`) naming the field — a misspelling is never written to
the column as a JSON document. Operations apply to updates only: over a row that
does not exist yet there is nothing to operate on, so they are refused on
`POST`, on `/bulk` creates, and on upserts.

### Upsert on a natural key

`POST /api/data/:slug?on_conflict=email` writes
`INSERT … ON CONFLICT (email) DO UPDATE` instead of a plain insert. The bulk
route takes the same target as `onConflict` beside `upsert: true`, and so does
each `upsert` operation of a batch.

```bash
curl -X POST '/api/data/users?on_conflict=email' \
     -d '{"email": "ada@example.com", "name": "Ada"}'

curl -X POST /api/data/users/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "slug"]
}'
```

The target must carry a uniqueness guarantee the database can match on: the
primary key (the default when none is named), a property with
`validation: { unique: true }`, or the columns of a `unique: true`
[index](/docs/backend/indexes/). Anything else is a `400`
(`INVALID_CONFLICT_TARGET`) listing the targets that do exist — Postgres would
otherwise answer *there is no unique or exclusion constraint matching the ON
CONFLICT specification* from inside a transaction that has already done work.

Naming a target without `upsert: true` on a bulk write is also a `400`: silently
ignoring it turns a re-runnable import into a duplicating one.

A row that already existed keeps its `on_create` timestamp. A conflict means the
row's creation is a fact about the past, and a nightly re-import that reset
`createdAt` on everything it touched would take every "new this week" query
with it.

### `Prefer: return=minimal`

Every write answers with the full row by default, which is what carries the
things the server decided — a serial id, an `autoValue` stamp, whatever
`beforeSave` rewrote. Send `Prefer: return=minimal` when you need none of it:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

A single write answers `204`. A `/bulk` or `/_batch` write answers `200`
carrying the **ids** rather than the rows — on a create the id is the one thing
the caller cannot compute, so discarding it would mean re-reading the table by
some natural key to learn what had just been written. A single-column key comes
back as the scalar; a composite key as an object of its columns.

## Cross-collection batches

`POST /api/data/_batch` writes across collections in one transaction, under the
caller's own role, with the same validation, callbacks and row-level security
each operation's single-row route would apply.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "collection": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "collection": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "collection": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "collection": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` is `create`, `update`, `upsert` or `delete`. `update` and `delete` need an
`id`; `create`, `update` and `upsert` need `values`; `upsert` may name an
`onConflict` target on the same terms as above. `data` is aligned to
`operations` — the written row for a create, update or upsert, and `null` for a
delete — so an index into one is an index into the other.

### `$ref`: pointing at a row the same batch created

An operation may name itself with `ref`, and any later operation may stand
`{ "$ref": "<name>.<field>" }` where a value goes — in `values` at any depth, or
as an `id`. It resolves to that field of the row the named operation wrote.

This is the reason the endpoint exists rather than being a loop: a child's
foreign key is not knowable until the parent has been inserted, so without it
the parent and the children have to be separate requests — precisely the
sequence that can half-succeed. Only **backward** references resolve; a forward
one is refused before the transaction opens.

### What is checked before anything is written

Shape, unknown collections, unknown fields, value constraints, field operations,
conflict targets and `$ref` reachability are all decided before the transaction
opens. A batch is all-or-nothing, and finding a typo at operation 40 would
otherwise cost the rollback of the 39 writes before it.

Capped at the same number of operations as a bulk write (1000 by default), since
one batch holds its locks for the whole transaction. A driver that cannot make
the batch atomic answers `BATCH_UNSUPPORTED` rather than falling back to a loop
of single writes — which would give neither the atomicity nor the single round
trip a batch is reached for.

An `update` or `delete` naming a row that does not exist fails the whole batch
with a `404`, for the same reason a partial write is refused everywhere else:
half-applied is the state with no good recovery.
