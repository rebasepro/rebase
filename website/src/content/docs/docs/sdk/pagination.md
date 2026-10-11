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

`nextCursor` is absent on the last page, and on a page no cursor can describe:
a relevance-ordered search (`_score`), a vector search, and a `fields` projection
that leaves out one of the `orderBy` fields — the cursor is built from the last
row's sort values, and that row does not carry them. There `meta.hasMore` can be
`true` with no `nextCursor`, and the loop above stops early: add the sort fields
to `fields`, or page by `offset`. `iterate()` given a `cursor` refuses such a
listing with `cursor-missing` rather than stopping. A sort by an
[aggregate over a relation](/docs/sdk/relations/) does page by cursor.

The cursor is **opaque**. It encodes the sort keys *and* the last row's values
for them, so it can only continue the listing it came from: keep `orderBy`
identical across pages, or the request is refused with
`CURSOR_ORDER_MISMATCH` rather than seeked in an order nobody asked for. A
request that names no `orderBy` at all adopts the cursor's, so you can hand it
straight back without restating the sort.

Do not parse it, and do not build one: the encoding exists to be changed, and
anything else is `INVALID_CURSOR`.

Four things follow from what a cursor is:

- **`after` cannot be combined with `offset` or `page`** (400
  `CURSOR_WITH_OFFSET`). Both say where the page starts, and honouring both
  would skip rows.
- **Multi-key sorts and nullable keys both work.** The comparison is built over
  every key in order, with the [NULL placement](/docs/sdk/querying#where-nulls-sort) the sort
  declared — not a single `>` on one column.
- **Relevance cannot be a cursor.** A `_score` is computed per query and stored
  nowhere, and two queries with different search strings produce scores that are
  not on the same scale. Such a listing simply carries no `nextCursor`; page it
  with `offset`. A vector search's distance is the same, and a cursor sent with
  one is refused with `VECTOR_CURSOR_UNSUPPORTED`.
- **A subscription cannot continue from one.** `listen()` re-runs its query on
  every write, and `after` names a place in one run of it, so `listen({ after })`
  is refused with `CURSOR_NOT_LIVE` before anything is sent. Use `offset` or
  `page` for a live window, or `find({ after })` to read the page once.

Over HTTP it is one parameter:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Skipping the count

<span class="since-badge" data-since="0.25">Since 0.25</span> `meta.total` is a `COUNT(*)` over every row the query matches, run beside the
page — and on a large table it costs more than the page does. A read that only
pages forward never needs it, because `meta.hasMore` does not depend on it:
pass `count: "none"` and the read asks for one row past the page instead.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Without a count there is no total to report: over HTTP `meta.total` is absent,
and in-process it is the rows up to the end of the page (`offset` plus the
page). Over HTTP it is `?count=none`; `?count=exact` is the default, and any
other value is a 400 `INVALID_COUNT`. `iterate()` and `findAll()` send it on
every page by themselves, since a walk reports no total.

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

Four options shape the walk:

| Option | Default | What it does |
|--------|---------|--------------|
| `pageSize` | 200 | Rows per request. |
| `cursor` | — | Require seeking: throw instead of falling back to offset. See below. |
| `maxPages` | 10 000 | Ceiling on requests, so a server that never stops saying `hasMore` cannot spin forever. |
| `maxRows` | 10 000 | `findAll()` only. Exceeding it **throws** rather than returning a truncated array as if it were the whole answer. Pass `Infinity` to opt out, or use `iterate()`. |

**The walk seeks by itself.** After the first page it hands
[the server's cursor](#cursor-pagination) — `meta.nextCursor` — back as `after`,
so each request asks for rows strictly after the last one seen. Concurrent
writes before that row cannot shift the window, and the database never has to
skip rows by count, which is what made long offset walks slow: every page cost
more than the one before it.

Where the server issues no cursor — a relevance-ordered search, a vector
search, a `distinct` read, a `fields` projection that leaves out a sort
field — the walk pages by offset instead, and a row
inserted or deleted *while the walk runs* can make it skip or repeat a row.
Pass `cursor` to make seeking a requirement rather than a preference:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` names the column to sort by when the query does not already say, and
turns the offset fallback into an error. The walk builds no comparison of its
own, which is why a multi-key sort works —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— and why a nullable sort key does too.

The sort still has to be **total**, which in practice means unique: the row id
breaks the final tie, so any column works as a tie-breaker. Given `cursor`, a
walk whose cursor stops advancing throws `cursor-stalled` rather than looping
forever, and a query no cursor can describe (relevance) throws
`cursor-missing`; drop `cursor` and the walk pages those by offset.

## See also

- [Querying data](/docs/sdk/querying/) — filters, the fluent builder, sorting.
- [Aggregates & search](/docs/sdk/aggregates-and-search/) — why relevance cannot key a cursor.
