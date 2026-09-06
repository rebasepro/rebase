---
title: Aggregates and search
sidebar_label: Aggregates & search
description: "Count, sum and group with the SDK, filter inside JSON columns, and run full-text and vector search from the client."
---

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

## Next Steps

- [Querying Data](/docs/sdk/querying/) — the query builder these run on top of
- [Search](/docs/backend/search/) — how full-text and vector search are configured on the backend
- [REST API](/docs/backend/api/) — the same queries over HTTP
