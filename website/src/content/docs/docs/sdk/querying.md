---
title: Querying Data
sidebar_label: Querying Data
description: CRUD operations, fluent query builder, filter operators, sorting, column selection and aggregates with the Rebase Client SDK.
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

### Writing

`create`, `upsert`, `update`, `delete` and their batch forms are on
**[Writing data](/docs/sdk/writing/)**, along with field operations, conditional
writes and idempotency keys.

### Count

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

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
| `.orderBy(field, dir, nulls?)` | Sort results | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Sort by an [aggregate over a relation](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limit result count | `.limit(25)` |
| `.offset(n)` | Skip first N results | `.offset(50)` |
| `.after(cursor)` | Continue after a [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Return [only these columns](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Collapse rows identical over those columns | `.fields("status").distinct()` |
| `.search(text)` | Text search — see [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nearest-neighbour search over a `vector` property | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Load related rows](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Execute the query | Returns `FindResult<M>` |
| `.aggregate(params)` | [Reduce instead of returning rows](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
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

## Logical Conditions (OR / AND / NOT)

Every field in `where` is AND-ed. To OR conditions together, or to negate a
group, build a **logical condition** with the `or`, `and`, `not` and `cond`
helpers the SDK exports:

```typescript
import { or, and, not, cond } from "@rebasepro/client";

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

### Negation

`not` negates the **conjunction** of its conditions: `not(a)` is `NOT a`, and
`not(a, b)` is `NOT (a AND b)`. Groups nest, so De Morgan's other half is
`not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

It compiles to a real SQL `NOT (...)`, not to inverted operators. That
distinction is not cosmetic: SQL is three-valued, so `NOT (a AND b)` and
`(NOT a) OR (NOT b)` stop agreeing the moment a `NULL` is involved, and only
one of them is the query you wrote.

It also means a negation **includes rows whose column is NULL** —
`not(cond("status", "==", "draft"))` returns rows with no status at all. That
is what `NOT` means, and usually what you want; if it is not, AND an
`is-not-null` alongside it.

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

A logical group travels as a single `or=`, `and=` or `not=` query parameter, in
the same dot-syntax the field filters use:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Only one of the three applies per request — `or` wins over `and`, and both over
`not`. Nest a group inside another to combine them.

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

Offsets, page numbers and keyset cursors have their own page:
[Pagination](/docs/sdk/pagination/).

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

A multi-column sort pages fine under a [cursor](#cursor-pagination): the
comparison is built over every key, in order. The one ordering a cursor cannot
describe is **`_score`** — see [Search](/docs/backend/search). Relevance is
computed per query rather than stored, so there is no value on the cursor row to
compare the next page against, and such a listing carries no `nextCursor`.

### Where NULLs sort

By default NULLs sort **last ascending and first descending** — Postgres's own
convention. That default is what puts every row with no date at the very top of
a "newest first" list, ahead of everything real, and the only way out used to be
an `is-not-null` filter that dropped those rows entirely.

A third element on the key says where they go instead:

```typescript
// Newest first, and the ones with no date at the end where they belong.
const { data } = await client.data.posts.find({
    orderBy: [["publishedAt", "desc", "last"]]
});
```

```typescript
const { data } = await client.data.posts
    .orderBy("publishedAt", "desc", "last")
    .find();
```

Over HTTP it is a third colon-segment, `?orderBy=publishedAt:desc:last`, or a
`"nulls"` key in the JSON array form. Anything other than `first`/`last` is a
400 rather than a silently different order.

The [cursor](#cursor-pagination) honours whatever the sort declared, so paging
over a nullable key stays correct under either placement.

## Returning fewer columns

`fields` narrows a read to the columns you name. It is a projection at the
database — those are the columns *read*, not the ones that survive a trim of the
response — so a query that needs two fields of a wide row does not pay for the
rest:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Two things always hold, whatever you name:

- **The primary key comes back.** A row that cannot be addressed cannot be
  updated, deleted, or paged past — and `meta.nextCursor` is derived from it, so
  a projection without it would silently disable seeking.
- **`excludeFromApi` columns stay hidden.** Naming one does not un-hide it.

An unknown column is a 400 `UNKNOWN_FIELD`. Read as "omit it", a mistyped
`fields: ["titel"]` would return rows with no titles and no hint why.

A relation named in `include` is loaded whether or not it appears in `fields`;
to narrow the columns *inside* a relation, see
[per-relation options](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

<span class="since-badge" data-since="0.20">Since 0.20</span>

`distinct` collapses rows that are identical over the columns being returned,
and a distinct read returns **only** the columns you name — the primary key is
left out of the projection, unlike every other read. It has to be: a surrogate
key differs on every row, so keeping it would make each row unique by
construction and the query would answer 200 having done nothing.

That makes it meaningful only alongside `fields`. Without one you are asking for
every visible column, key included, and nothing collapses:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

A distinct read addresses no rows — there is no key to address them by — so it
returns a set of values rather than a set of rows to update or delete, and it
carries no `nextCursor`. It also reports **no `meta.total`**: counting would
need a `COUNT(DISTINCT …)` the driver does not issue, and reporting the row
count instead described a different set from the one served — a complete
two-row result came back as `total: 8, hasMore: true`, which is a client paging
forever. `hasMore` comes from the page itself.

Two combinations are refused rather than answered uselessly:

- **A query that scores every row** — a ranked `search()` or a `vectorSearch()`
  attaches a `_score`/`_distance` per row, so no two rows are ever equal and
  `DISTINCT` would have no effect. (A plain substring search attaches nothing
  and is fine.)
- **Sorting by a column you did not return.** Postgres cannot order a `DISTINCT`
  read by an expression outside the select list; the request is a 400
  `DISTINCT_ORDER_BY_NOT_SELECTED` rather than a 500 quoting SQL you never
  wrote.

Over HTTP: `?fields=status&distinct=true`.

## Aggregates

`aggregate()` reduces the matching rows instead of returning them — `count`,
`sum`, `avg`, `min`, `max`, optionally grouped:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

The builder's filters carry into it, which is usually the shorter spelling:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Result keys are **derived**, not chosen: `sum(total)` comes back as `sum_total`,
a bare `count()` as `count`. Letting you name them would mean checking the name
is not also a `groupBy` field — a rule nobody would guess, and a silently
overwritten value if it went unchecked.

`limit` bounds the number of **groups** (grouping by a high-cardinality column
is a whole table's worth of rows in one response) and is ignored without a
`groupBy`, since an ungrouped aggregate is one row. `orderBy`, `include` and the
page do not apply: an aggregate has no rows to sort, no relations to load and no
page to continue.

The whole point is not to fetch rows in order to reduce them. "Revenue by
status" over a million orders is one query and one row per status here, and a
`findAll()` plus a loop everywhere else — which is wrong under a `limit` and
unaffordable without one. It runs through the same request-scoped handle as
every other read, so row-level security applies to the rows being aggregated.

Over HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

JSON filtering, full-text search and vector search have a page of their own:
[Aggregates and search](/docs/sdk/aggregates-and-search/).

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
