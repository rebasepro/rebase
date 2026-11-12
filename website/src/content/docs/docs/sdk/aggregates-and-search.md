---
title: Aggregates and search
sidebar_label: Aggregates & search
description: "Count, sum and group with the SDK, filter inside JSON columns, and run full-text and vector search from the client."
---

## Aggregates

`count`, `sum`, `avg`, `min`, `max` and the functions below over the rows a
filter selects, without fetching them:

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

### More functions

| `select` | SDK | Result key | What it is |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Distinct non-null values |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | The most frequent value |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Continuous percentile, `p` from 0 to 1 (`0.5` is the median) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | The distinct non-null values, sorted, as an array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | A string that changes whenever a covered row does |

### Filtered aggregates and names

An aggregate can count only some of the rows: give it a `where` of its own
(SQL's `FILTER (WHERE …)`). Several of them are one query over the rows the
outer `where` chose, so a dashboard of eight counts is one scan. Name each one
with `as`, which two aggregates of the same function need:

```ts
const [stats] = await client.data.songs.aggregate({
    select: [
        { fn: "count", as: "rows" },
        { fn: "count", as: "live", where: { tags: ["!=", []] } },
        { fn: "count", as: "unplayable", where: { playable: ["==", false] } },
        { fn: "sum", field: "plays", as: "plays" }
    ]
});
// { rows: 30000, live: 21480, unplayable: 312, plays: 918211 }
```

A name used twice, or the key of a `groupBy` column, is refused
(`INVALID_AGGREGATE_SELECT`) rather than overwriting a value. Over HTTP a name
is written PostgREST's way, `select=live:count()`; an aggregate with a `where`
of its own goes as a JSON array — `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

An aggregate's `field` may be a JSON path, `props->>players`: `sum`, `avg` and
`percentile` read the value there as a number and leave out one that is not, the
others read it as text. A JSON path is also a `groupBy` entry, keyed by the path
as written:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Grouping by an expression

A `groupBy` entry can transform its column. Over HTTP it is written like a
function, in the SDK as `{ field, transform }`, and it comes back under
`<transform>_<field>` — which is also the name `orderBy` uses:

| Transform | Groups by |
|---|---|
| `lower(name)`, `upper(name)` | The column as lower- or upper-case text |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | The date, in UTC, as `2026`, `2026-11`, `2026-11-08` — or in a time zone: `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Each element of an array column: one group per element |

```ts
// How many songs carry each tag — the distinct elements of an array column.
const tags = await client.data.songs.aggregate({
    select: [{ fn: "count" }],
    groupBy: [{ field: "tags", transform: "unnest" }],
    orderBy: ["unnest_tags", "asc"]
});
// [{ unnest_tags: "pop", count: 812 }, …]

// Each artist's usual language, however the name is capitalised.
await client.data.songs.aggregate({
    select: [{ fn: "mode", field: "lang" }],
    groupBy: [{ field: "artist", transform: "lower" }]
});
```

```bash
GET /api/data/events/aggregate?select=count(),countDistinct(sid)&groupBy=day(at)&orderBy=day_at:asc
```

### Has anything changed? `fingerprint()`

`fingerprint()` answers "has this table changed since I last looked?"
without reading the rows: keep the string, ask again later, and recompute
whatever you derived from the rows only when it differs. Any insert, update or
delete of a row it covers changes it; a write that changes nothing (setting a
column to its own value) may change it too, and deleting a row you just added
brings it back. It covers what the caller can see and what the filters select,
and it can be grouped, so `groupBy=lang` gives one fingerprint per language.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

It is computed from the row versions Postgres keeps, not from the values, so it
costs a scan of the table and not a hash of every row: on 30,000 rows, 4 ms
where `md5(string_agg(...))` over the rows takes 56. It is not available on a
plain view, which stores no rows; a materialized view has one.

Groups page like a listing's rows. `limit` bounds them, `offset` (or `page`)
skips them, and `orderBy` sorts them by a `groupBy` field or a result key. The
order always ends on the group keys, so every page boundary falls in the same
place. A grouped aggregate with no `limit` is cut at the listing default (50
groups), the same as a listing. With a `limit` — the default one included — the
response says whether there are more, and the SDK's `aggregate()` hands it back
as `meta` on the result:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` or `orderBy` without a `groupBy`, or a cursor on any aggregate,
is a `400 INVALID_AGGREGATE_WINDOW`: an ungrouped aggregate has one row, and a
group is not a row a cursor can continue after.

An aggregate reads the stored values and never runs `afterRead`. So on a
table an `afterRead` hook rewrites — global, the table's own, or a column's `.transform()` —
only `count()` and `fingerprint()` without `groupBy` are served, over HTTP and in process alike;
anything else is a `400 AGGREGATE_MASKED_BY_AFTER_READ`, because a sum, a
maximum or a group would read the values the hook hides.

From the SDK, `aggregate()` takes the same `orderBy` a `find()` does — one
`[key, "asc" | "desc"]` tuple or a list of them — where the key is a `groupBy`
column or a result key. Both are typed: on a generated model, a key that is
neither does not compile. In process (`rebase.data`), the groups come back in
the same order as over HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

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
table's top-level text columns. It is not full-text search: it does
not reach inside JSON or array columns, does not stem or rank, and cannot
use an index.

A table can opt in to real full-text search by declaring a
`search` block, which also makes results rankable by `_score`. See
[Search](/docs/backend/search).

## Vector Search

For tables with a `col.vector()` column, order rows by similarity to a query
embedding. Rows come back closest-first, each carrying a `_distance`. The
distance is the order: an `orderBy` on the same query is ignored. Without a
`limit` a vector search returns 10 rows, not a listing's 50.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` on the same query is a filter on which rows are candidates — this
returns the nearest rows that also match, not the nearest rows filtered
afterwards. On the HNSW index that holds from pgvector 0.8.0 (see
[Filters on an approximate index](/docs/backend/vector-search/#filters-on-an-approximate-index));
on an older pgvector a filter that few of the nearest rows pass returns a short
page. Producing `queryVector` is your job: Rebase stores and searches
embeddings, it does not compute them.

The SDK sends a
vector search as `POST /api/data/<table>/query`, with the embedding in the
body: in the URL, 768 dimensions are about 17 KB, past what Node (16 KB) and most
proxies (nginx: 8 KB) accept. `count()` with a vector search goes the same way,
as `POST /api/data/<table>/count`. Against a server older than 0.24, which
has no such route, either falls back to the `GET` — and a long embedding there
can still be refused with a 431 or a 414.

With a `threshold`,
the result has no `meta.total` — counting the rows within a distance computes it
for every row of the table. Page with `meta.hasMore`, which stays exact.

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
`.rebase/sql/vector.sql`, next to `schema.sql` and `policies.sql`, and `rebase db
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
