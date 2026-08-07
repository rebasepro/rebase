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
// All products (default limit: 20)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["created_at", "desc"],
    limit: 25,
    offset: 0
});

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Find by ID

```typescript
const product = await client.data.products.findById(42);
// Returns Entity<M> | undefined
```

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
    where: { expires_at: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

### Retries and duplicates

A client that never sees the response cannot know whether the batch committed,
so it retries — and without a key the server cannot tell that retry from a
second genuine batch. Pass an idempotency key on anything that may be resent:

```typescript
await client.data.products.createMany(rows, { idempotencyKey: importId });
```

The offline queue sets one automatically on every replay.

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
    .orderBy("created_at", "desc")
    .limit(10)
    .find();
```

### Available Methods

| Method | Description | Example |
|--------|-------------|---------|
| `.where(field, op, value)` | Add a filter condition | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Sort results | `.orderBy("name", "asc")` |
| `.limit(n)` | Limit result count | `.limit(25)` |
| `.offset(n)` | Skip first N results | `.offset(50)` |
| `.search(text)` | Text search — see [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nearest-neighbour search over a `vector` property | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | Include related entities | `.include("author", "tags")` |
| `.find()` | Execute the query | Returns `FindResponse<M>` |
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

## Sorting

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["created_at", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

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
    .orderBy("published_at", "desc")
    .limit(10)
    .find();
```

### Reading Relation Data

When relations are included, the response contains **both** the scalar foreign key and the hydrated relation object:

```typescript
const { data } = await client.data
    .collection<{ author_id: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.author_id);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Note:** Without `.include("author")`, only the scalar `author_id` field is returned. The hydrated `author` object will be `undefined`.

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
