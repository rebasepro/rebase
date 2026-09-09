---
title: Pagination
sidebar_label: Pagination
description: Page a collection with limit/offset, page numbers, or a keyset cursor — and when each one stops being correct.
---

Three ways to walk a collection: an offset, a page number, and a cursor. The
first two are positional and the third is not, which is the whole difference —
a positional page re-reads by counting from the start, so rows written while
you page shift what "row 20" means.

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

`limit` must be a whole number between 1 and 1000. A larger one — or a zero,
negative, or fractional one — is refused with a 400 `INVALID_LIMIT` rather than
clamped, because a silently smaller page cannot be told apart from the last one.
To read past that ceiling, walk the pages with `iterate()` or `findAll()`.

#### Cursor pagination

Every list response carries a `meta.nextCursor` while there is another page.
Pass it back as `after` and the next page picks up **strictly after the last row
served**, rather than at a row *count* that concurrent writes have already
moved:

```typescript
let after: string | undefined;
do {
    const { data, meta } = await client.data.orders.find({
        orderBy: ["createdAt", "desc"],
        limit: 100,
        after
    });
    for (const order of data) await handle(order);
    after = meta.nextCursor;
} while (after);
```

The cursor is **opaque**. It encodes the sort keys *and* the last row's values
for them, so it can only continue the listing it came from: keep `orderBy`
identical across pages, or the request is refused with
`CURSOR_ORDER_MISMATCH` rather than seeked in an order nobody asked for. A
request that names no `orderBy` at all adopts the cursor's, so you can hand it
straight back without restating the sort.

Do not parse it, and do not build one: the encoding exists to be changed, and
anything else is `INVALID_CURSOR`.

Three things follow from what a cursor is:

- **`after` cannot be combined with `offset` or `page`** (400
  `CURSOR_WITH_OFFSET`). Both say where the page starts, and honouring both
  would skip rows.
- **Multi-key sorts and nullable keys both work.** The comparison is built over
  every key in order, with the [NULL placement](#where-nulls-sort) the sort
  declared — not a single `>` on one column.
- **Relevance cannot be a cursor.** A `_score` is computed per query and stored
  nowhere, and two queries with different search strings produce scores that are
  not on the same scale. Such a listing simply carries no `nextCursor`; page it
  with `offset`.

Over HTTP it is one parameter:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Which reads are wrapped, and which are not

Two shapes, and one rule: **a window is wrapped, a whole answer is not.**

| Method | Returns | Why |
|--------|---------|-----|
| `find()`, `listen()` | `{ data, meta }` | One page. `meta.total` / `meta.hasMore` are the only way to know there is more |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nothing left over to report — the walk finished, or the batch *is* the rows |
| `iterate()` | one row at a time | Nothing is materialised at all |
| `findById()`, `get()`, `create()`, `update()` | one row | Not a list |

`data` is not a wrapper the SDK sometimes adds and sometimes forgets. It is
where the pagination metadata lives, and it is there exactly when there is some.

#### Reading everything: `iterate()` and `findAll()`

`iterate()` streams every row a query matches, one at a time, fetching a page at
a time behind the scenes. Nothing accumulates, so it is the one to use for a
collection you cannot hold in memory:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` is the same walk collected into an array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Both are on the fluent builder too, where `.limit()` becomes the **page size**
rather than a total:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Three options shape the walk:

| Option | Default | What it does |
|--------|---------|--------------|
| `pageSize` | 200 | Rows per request. |
| `cursor` | — | Seek on a column instead of paging by offset. See below. |
| `maxPages` | 10 000 | Ceiling on requests, so a server that never stops saying `hasMore` cannot spin forever. |
| `maxRows` | 10 000 | `findAll()` only. Exceeding it **throws** rather than returning a truncated array as if it were the whole answer. Pass `Infinity` to opt out, or use `iterate()`. |

**Prefer `cursor` whenever the collection has a unique, sortable column.**
Offset paging re-counts rows on every request, so a row inserted or deleted
*while the walk runs* shifts the window and the walk silently skips or repeats
rows. Seeking asks for rows strictly after the last one seen, which concurrent
writes before the cursor cannot move:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` here means "seek rather than page by offset", and names the column to
sort by when the query does not already say. The seeking itself is
[the server's cursor](#cursor-pagination): the walk hands `meta.nextCursor` back
as `after` and builds no comparison of its own, which is why a multi-key sort
works —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— and why a nullable sort key does too.

The sort still has to be **total**, which in practice means unique: the row id
breaks the final tie, so any column works as a tie-breaker, but a walk whose
cursor stops advancing throws `cursor-stalled` rather than looping forever. A
query no cursor can describe (relevance) throws `cursor-missing`; drop `cursor`
and page by offset.

## See also

- [Querying data](/docs/sdk/querying/) — filters, the fluent builder, sorting.
- [Aggregates & search](/docs/sdk/aggregates-and-search/) — why relevance cannot key a cursor.
