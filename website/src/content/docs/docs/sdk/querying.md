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

## Aggregates

`count`, `sum`, `avg`, `min` and `max` over the rows a filter selects, without
fetching them:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Group to get one row per value:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status
```

```json
{
  "data": [
    { "status": "paid",    "count": 96, "sum_total": 31200 },
    { "status": "pending", "count": 32, "sum_total": 9322 }
  ]
}
```

Results are keyed by function and field — `count()` becomes `count`,
`sum(total)` becomes `sum_total`.

It takes the same filters as the list endpoint, so an aggregate can be narrowed
the same way a listing is:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**Row-level security applies to the rows being aggregated.** An aggregate is an
efficient way to learn about rows you cannot read, so it runs under the caller's
own policies: someone who can select nothing counts nothing.
:::

Aggregates need a driver that implements them. On one that does not, the
endpoint answers `501` rather than an empty result — a dashboard should not be
told "no matches" when the truth is "not supported".

## Filtering Inside JSON

A `json` or `jsonb` column can be filtered by path, using Postgres's own arrow
syntax:

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Over REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

Path segments are always sent as bound parameters, never spliced into SQL.

### How values compare

`->>` yields **text**, so comparisons are text comparisons — except that an
ordering operator (`>`, `>=`, `<`, `<=`) given a **number** casts to numeric:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Rows whose value at that path is not a number are excluded from a numeric
comparison rather than failing the query. Booleans compare as `"true"` /
`"false"`, which is how `->>` renders them.

:::note
`array-contains` and the other whole-column operators are not available on a
path — they ask a question about the whole document, so use them on the column
itself.
:::

## Text Search

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

By default this is a **case-insensitive substring match** across the
collection's top-level `string` properties. It is not full-text search: it does
not reach inside `map` or `array` properties, does not stem or rank, and cannot
use an index.

A Postgres collection can opt in to real full-text search by declaring a
`search` block, which also makes results rankable by `_score`. See
[Search](/docs/backend/search).

## Vector Search

For collections with a `vector` property, order rows by similarity to a query
embedding. Rows come back closest-first, each carrying a `_distance`.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` and `orderBy` on the same query act as filters applied *before* the
ordering — this returns the nearest rows that also match, not the nearest rows
filtered afterwards. Producing `queryVector` is your job: Rebase stores and
searches embeddings, it does not compute them.

### What you have to provide

- **pgvector.** A `vector` property compiles to a `VECTOR(n)` column, and that
  type comes from the `vector` extension. Rebase will install it for you, but
  only where you say it may:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  That line is a permission rather than a request — Rebase runs
  `CREATE EXTENSION IF NOT EXISTS vector` only when something in your schema
  needs it. It is opt-in because installing an extension depends on things
  Rebase cannot see from inside the connection: the image has to ship the
  library (the scaffold's `pgvector/pgvector:pg18` does, a stock `postgres:18`
  does not), the role has to be allowed to install it, and a managed provider
  has to have it on an allow-list.

  Say nothing and Rebase installs nothing — install it once by hand instead.
  Either way the column is created, and Postgres refuses it with
  `type "vector" does not exist` on a database that has neither, naming both
  ways out.

The column, its ANN index and that `CREATE EXTENSION` are generated into
`drizzle/vector.sql`, next to `schema.sql` and `policies.sql`, and `rebase db
push` applies them for you. They have a file of their own because Atlas — the
engine behind `db push` — computes its diff by materialising `schema.sql` in a
scratch database it wipes at the start of every run, so a `VECTOR(n)` in there
is resolved against a database that can never have pgvector.

`rebase db generate` appends that file to the migration it writes, so a
migration replayed against a fresh database builds the column too. A change to
the vector property alone produces no migration, because the schema Atlas diffs
is unchanged — `db generate` says so when it happens.

### The index

Every vector column gets an HNSW index for cosine distance, created with the
table and reported at boot. Cosine because that is what `vectorSearch` measures
with unless you pass `distance` — an index serves exactly one operator, so a
`l2` query against a cosine index quietly goes back to scanning.

Tune it, or turn it off, on the property:

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Defaults: one HNSW index, cosine. Any of these may be omitted.
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` keeps the exact scan on purpose. Above 2000 dimensions pgvector
cannot build either index type, so the column is created and left unindexed, and
the boot says so — `vectorSearch` still answers, as an exact scan.

`vectorSearch` is a query, not a subscription: `.listen()` on one is refused
rather than served as a plain listing, because nothing recomputes distances on a
write.

## Fetching Relations

Relations can be included so that related entities are returned alongside the primary data, instead of just their foreign key IDs.

### Using `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations
const { data } = await client.data.posts
    .include("*")
    .find();
```

### Using `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combining with Filters

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Reading Relation Data

When relations are included, the response contains **both** the scalar foreign key and the hydrated relation object:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Note:** Without `.include("author")`, only the scalar `authorId` field is returned. The hydrated `author` object will be `undefined`.

### Relation Names

The relation names you pass to `include()` must match the `relationName` defined in the collection's `relations` array:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Querying Through a Relation

`include()` fetches related rows *after* the page has been chosen. The two
features below choose the page **with** them: they compile to SQL, so they run
before `limit` and `offset` rather than after.

This is what a queue screen needs — *who is waiting, longest first* — where both
halves of the question are answered by a related table rather than by the row
being listed.

### Filter by a column of the related row

A dotted key reaches through a relation to one of the target's columns:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

It compiles to an `EXISTS` over the related table, correlated to the row being
listed — not a join, which would multiply rows and quietly break `limit`.

Every operator works, because the thing being compared is an ordinary column:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

The negative operators — `!=`, `not-in`, `not-like`, `not-ilike` — mean **"no
related row matches"**, not "some related row differs":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

That is the reading you want, and the only one that makes `==` and `!=`
partition the rows. The other reading — "some application is not 'hired'" — is
true of nearly every candidate with more than one application, and answers
nothing anybody asked.

`is-null` and `is-not-null` are deliberately **not** a complementary pair here.
They mean "has a related row whose column is unset" and "has one where it is
set" — both true of a candidate with two applications, one of each.

A relation name that does not exist, or a column the target does not have, is a
400 naming the target's real columns. It is never a dropped condition: dropping
a filter key would *widen* the read to every row.

### Sort by an aggregate over a relation

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

The fluent builder takes the same key:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` and `avg`. `field` is required by all of them
except `count`, which counts the related rows when you leave it out and counts
the rows with a non-null column when you don't.

This is the half of a queue you cannot work around on the client. A filter can
be approximated by denormalising a flag onto the row; an ordering cannot be
approximated at all once the result set is paged, because the client only ever
holds one page and the page was chosen by the wrong order.

Rows the relation reaches nothing from land at a defined end — **last
ascending, first descending**, the placement Postgres gives a `NULL`. A `count`
of nothing is `0` rather than null, so those rows sort as zero.

Over HTTP the key is a single string, so it fits `?orderBy=` unchanged:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

Cursor pagination works over it. There is no aggregate stored on the cursor row
to compare against, so the driver recomputes the cursor row's value in SQL from
the id it does have.

### Row-level security

Both compile to a subquery that runs as the reader, so a related row your
policies hide does not match a filter and does not contribute to an aggregate.

One caveat, on the **negative** direction only: "no related row matches" and "no
related row *this reader can see* matches" are the same sentence. A target table
with row-level security and no `SELECT` policy for `rebase_user` is opaque, so
every row looks unmatched and a `!=` / `not-in` filter over-reports. Nothing
leaks — the listed table's own policies still decide which rows exist at all,
and the positive direction correctly returns nothing. The fix is a `SELECT`
policy on the target. Rebase derives one for a declared many-to-many; a
hand-written schema has to supply it.

### Engine support

Postgres only. Firestore and MongoDB declare `filterableRelationKinds: []` and
do not offer either feature — a document store links by reference and has no
subquery to compile these into. See
[data source capabilities](/docs/backend/multiple-sources).

### Why not `additionalFields`?

`AdditionalFieldDelegate.value()` is async and gets the whole context, so it
*can* read another collection — and it still cannot help here. It runs in the
browser, once per row, **after** the page has been fetched and ordered. A value
computed there can be displayed and can never be filtered, sorted or paged on.

If a derived value is not an aggregate over a relation, put it in the database —
a generated column, or a trigger-maintained one — and it becomes an ordinary
property.

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

## Next Steps

- **[Authentication](/docs/sdk/authentication)** — Sign in, sign up, OAuth, sessions
- **[Realtime Subscriptions](/docs/sdk/realtime)** — Live data with WebSockets
- **[Storage & Files](/docs/sdk/storage)** — Upload, download, and manage files
- **[Relations](/docs/collections/relations)** — Define relations between collections
