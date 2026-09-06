---
title: Querying Data
sidebar_label: Querying Data
description: CRUD operations, fluent query builder, filter operators, pagination, sorting, and relation fetching with the Rebase Client SDK.
---

## Accessing Collections

Access any collection through `client.data.<collectionName>` (camelCase, auto-converted to snake_case) or `client.data.collection<Record<string, unknown>>("slug")` (explicit slug):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Strict mode (generated SDK):** When you pass the generated `collectionsDictionary` to `createRebaseClient`, the data proxy validates property accesses at access time. A typo like `client.data.prodcuts` will throw immediately with a helpful error and a nearest-match suggestion instead of producing a confusing 404 later. Use `client.data.collection<Record<string, unknown>>("slug")` to bypass validation for dynamic or runtime-determined slugs.

## CRUD Operations

### Find (List)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Row[] — flat rows, with the id at the top level
// meta has { total, limit, offset, hasMore }
```

### Read one by ID

Two methods, because there are two situations and they want different code.

`get` is for a row you expect to exist — the id came from a link, a route
parameter or another row. It returns the row, so nothing downstream has to
narrow, and a missing row is an exception you can branch on:

```typescript
const product = await client.data.products.get(42);
product.name;    // Row, not Row | undefined
```

```typescript
import { RebaseApiError } from "@rebasepro/client";

async function loadProduct(id: string) {
    try {
        return await client.data.products.get(id);
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

`findById` is for a row that may legitimately not be there — a lookup by an id
a user typed, a cache probe:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
Row-level security makes "no such row" and "not yours to read" the same answer,
deliberately: a 404 that distinguished them would confirm the row exists.
:::

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

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Delete

```typescript
await client.data.products.delete(42);
```

### Count

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

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

## Fluent Query Builder

Chain methods for more expressive queries:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Available Methods

| Method | Description | Example |
|--------|-------------|---------|
| `.where(field, op, value)` | Add a filter condition | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filter on a [relation](#querying-through-a-relation) or [JSON](#filtering-inside-json) path | `.where("author.name", "==", "bob")` |
| `.where(group)` | Add an [OR/AND group](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir)` | Sort results | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Sort by an [aggregate over a relation](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limit result count | `.limit(25)` |
| `.offset(n)` | Skip first N results | `.offset(50)` |
| `.search(text)` | Text search — see [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nearest-neighbour search over a `vector` property | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | Include related entities | `.include("author", "tags")` |
| `.find()` | Execute the query | Returns `FindResult<M>` |
| `.iterate(options?)` | [Stream every matching row](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Collect every matching row](#reading-everything-iterate-and-findall) | Returns `M[]` |
| `.count()` | Count the matching rows | Returns `number` |
| `.listen(onUpdate, onError?)` | Subscribe to real-time updates | Returns `unsubscribe()` |

### Filter Operators

| Operator | Alias | Description |
|----------|-------|-------------|
| `"=="` | `"eq"` | Equal |
| `"!="` | `"neq"` | Not equal |
| `">"` | `"gt"` | Greater than |
| `">="` | `"gte"` | Greater than or equal |
| `"<"` | `"lt"` | Less than |
| `"<="` | `"lte"` | Less than or equal |
| `"in"` | | Value in array |
| `"not-in"` | `"nin"` | Value not in array |
| `"array-contains"` | `"cs"` | Array field contains value |
| `"array-contains-any"` | `"csa"` | Array field contains any of values |
| `"like"` | `"like"` | Case-**sensitive** pattern match; `%` and `_` are the wildcards |
| `"ilike"` | `"ilike"` | Case-insensitive pattern match |
| `"not-like"` | `"nlike"` | Does not match the pattern |
| `"not-ilike"` | `"nilike"` | Does not match the pattern, case-insensitively |
| `"is-null"` | `"isnull"` | Column is `NULL`. Takes no value — whatever you pass is normalized away |
| `"is-not-null"` | `"notnull"` | Column is not `NULL`. Takes no value |

The alias column is the **wire** spelling, used in REST query strings. It never
appears in application code: the SDK and the admin panel both speak the
canonical operator on the left.

### Where Clause Syntaxes

The `where` parameter in `find()` supports two formats:

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Note:** Pre-serialized PostgREST strings (format 2) are an escape hatch for passing filter values that are already in wire format. Prefer tuple syntax for type safety and readability.

## Logical Conditions (OR / AND)

Every field in `where` is AND-ed. To OR conditions together, build a **logical
condition** with the `or`, `and` and `cond` helpers the SDK exports:

```typescript
import { or, and, cond } from "@rebasepro/client";

const { data } = await client.data.products.find({
    logical: or(
        cond("status", "==", "active"),
        and(
            cond("status", "==", "draft"),
            cond("authorId", "==", currentUserId)
        )
    )
});
```

The fluent builder takes the same tree:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` takes the canonical operator — the left column of the
[Filter Operators](#filter-operators) table. An operator the dialect does not
have is a `TypeError` when the query is serialized, not a silently different
query.

### How it composes with the rest of the query

`where`, `logical` and `search` are three independent groups, AND-ed with each
other:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

There is no way to OR `where` against `logical`. Anything that is not a plain
AND of the three has to be expressed inside one `logical` tree — move the
fields you need OR-ed into it.

### On the wire

A logical group travels as a single `or=` or `and=` query parameter, in the
same dot-syntax the field filters use:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
```

Three encodings are worth knowing, because they are the ones a hand-written
query string gets wrong:

| Condition | Wire form | Note |
|-----------|-----------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` is a search for the four-character string `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` is a list holding one empty string, which is a different query |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | a [relation path](#querying-through-a-relation) keeps its dot |

Commas, parentheses and backslashes inside a value are backslash-escaped, so
`cond("name", "==", "Doe, John")` travels as `name.eq.Doe\, John` and does not
split the group.

Groups may nest 32 levels deep. Past that the request is rejected with
`INVALID_LOGICAL_GROUP` — flatten it, since `or(a,or(b,c))` is `or(a,b,c)`.

## Pagination

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

### Which reads are wrapped, and which are not

Two shapes, and one rule: **a window is wrapped, a whole answer is not.**

| Method | Returns | Why |
|--------|---------|-----|
| `find()`, `listen()` | `{ data, meta }` | One page. `meta.total` / `meta.hasMore` are the only way to know there is more |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nothing left over to report — the walk finished, or the batch *is* the rows |
| `iterate()` | one row at a time | Nothing is materialised at all |
| `findById()`, `get()`, `create()`, `update()` | one row | Not a list |

`data` is not a wrapper the SDK sometimes adds and sometimes forgets. It is
where the pagination metadata lives, and it is there exactly when there is some.

### Reading everything: `iterate()` and `findAll()`

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

The column must be unique — a repeated value at a page boundary either skips
rows or stalls, and the iterator throws rather than looping — and the query is
ordered by it, so a `cursor` alongside a conflicting `orderBy` is an error
rather than a silent override.

## Sorting

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["createdAt", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

A direction you leave out is `"asc"` — the same thing `?orderBy=name` means over
HTTP, whichever database is underneath.

### Sorting by more than one column

A sort is a *list* of keys. The second decides between rows the first calls
equal, the third between rows the first two do — so `orderBy` takes a list of
`[field, direction]` pairs as readily as a single one:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

The fluent builder spells the same thing by calling `.orderBy()` again. Each
call **adds** a key under the ones before it rather than replacing them:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Every sort ends on the row id, descending, whether you asked for it or not.
That is what makes the ordering *total*: without it two rows sharing a value are
returned in whatever order the database pleased, and paging over an order that
can differ between two runs of the same query repeats some rows and skips
others.

Two things a multi-column sort cannot be combined with, both refused with a 400
rather than answered wrongly:

- **`cursor` on `iterate()`/`findAll()`.** Keyset pagination advances with one
  comparison along one column. Order by the cursor column alone, or page by
  `offset`.
- **`_score`** — see [Search](/docs/backend/search). Relevance is computed per
  query rather than stored, so there is no value on the cursor row to compare
  the next page against.

Aggregation, JSON filtering, full-text search and vector search have a page
of their own: [Aggregates and search](/docs/sdk/aggregates-and-search/).

Reading related entities — `include`, and the accessors that query through a
relation — has a page of its own: [Querying relations](/docs/sdk/relations/).

## Custom Endpoints

Call custom server endpoints registered via the functions system:

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

Both return **the function's response body, verbatim**. Neither reaches into it
for a `data` key, so a function that answers `{ data: [...] }` gives you that
object and you read `.data` yourself.

`call()` takes a full path and always POSTs; `invoke()` takes a function name
and can take a method, a sub-path and headers. Use `invoke()` unless you are
calling something that is not a function.

## Next Steps

- **[Authentication](/docs/sdk/authentication)** — Sign in, sign up, OAuth, sessions
- **[Realtime Subscriptions](/docs/sdk/realtime)** — Live data with WebSockets
- **[Storage & Files](/docs/sdk/storage)** — Upload, download, and manage files
- **[Relations](/docs/collections/relations)** — Define relations between collections
