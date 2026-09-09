---
title: REST API
sidebar_label: REST API
description: Auto-generated REST API endpoints for every collection, with filtering, sorting, pagination, and relation inclusion.
---

## Overview

Rebase automatically generates a complete API from your collection definitions:

- **REST API** — CRUD endpoints for every collection at `/api/data/:slug`
- **OpenAPI spec** — Machine-readable spec at `/api/docs`
- **Swagger UI** — Interactive API explorer at `/api/swagger` (dev mode only)

No code is required — define your collections and the API appears automatically.

## REST Endpoints

For each collection, the following endpoints are generated. Every other route the backend mounts — auth, storage, admin, meta — is in the [endpoint index](/docs/backend/endpoints/).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | List entities |
| `GET` | `/api/data/:slug/count` | Count entities |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, optionally grouped. Takes the same filters as the list endpoint, and RLS applies to the rows being aggregated — see [Querying](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Get a single entity |
| `POST` | `/api/data/:slug` | Create a record |
| `PATCH` | `/api/data/:slug/:id` | Update a record (partial — only the properties you send are written) |
| `DELETE` | `/api/data/:slug/:id` | Delete a record |
| `POST` | `/api/data/:slug/bulk` | Create many entities in one transaction |
| `PATCH` | `/api/data/:slug/bulk` | Update many entities in one transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Delete many entities in one transaction |
| `POST` | `/api/data/_batch` | Write **across** collections in one transaction |

### Subcollection Routes

Nested relations are accessible via URL paths:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Routing Mechanics & Segment Parsing

To handle arbitrary nested subcollection depths, Rebase routes incoming requests using Hono's `:rest{.+}` parameter regex. The internal segment parsing engine analyzes paths by counting slash-separated segments:
- **Odd segment count** (e.g., `authors/42/posts` -> 3 segments) represents a collection list request.
- **Even segment count** (e.g., `authors/42/posts/7` -> 4 segments) represents an operation on a specific entity ID. The last segment is popped as the target `entityId`.

The engine filters out reserved system namespaces (e.g., `history`) from the path segment analysis to prevent collisions with built-in endpoints.

## Authentication

All data endpoints require authentication by default. Include a Bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

For server-to-server calls, use the service key:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtering

Use PostgREST-style query parameters to filter results. The format is `?field=operator.value`:

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)
```

### Filter Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `eq` | Equals (`==`) | `?active=eq.true` |
| `neq` | Not equals (`!=`) | `?status=neq.draft` |
| `gt` | Greater than (`>`) | `?price=gt.100` |
| `gte` | Greater or equal (`>=`) | `?price=gte.100` |
| `lt` | Less than (`<`) | `?price=lt.50` |
| `lte` | Less or equal (`<=`) | `?price=lte.50` |
| `in` | In array | `?status=in.(a,b,c)` |
| `nin` | Not in array | `?status=nin.(a,b)` |
| `cs` | Array contains | `?tags=cs.value` |
| `csa` | Array contains any | `?tags=csa.(a,b)` |
| `like` | Pattern match, case-sensitive (`like`) | `?sku=like.AB-%` |
| `ilike` | Pattern match, case-insensitive (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Does not match the pattern (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Does not match, case-insensitively (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | Column is `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | Column is not `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` and `notnull` ignore their value — the operator is the whole condition,
and anything after the dot is discarded. The SDK writes `.null`, so that is the
spelling you will see on the wire.

:::caution[`eq.null` is the four-character string, not `IS NULL`]
`?deleted_at=eq.null` searches for the literal text `null`. SQL `= NULL` is
never true, so there is no reading of `eq.null` that could mean the null test —
use `isnull` for that. The SDK serializes `.where("deleted_at", "==", null)` as
`isnull.null` for exactly this reason.
:::

### Logical Operators

Use `or`, `and` and `not` for complex conditions:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` negates the **conjunction** of its conditions: `not(a)` is `NOT a`, and
`not(a,b)` is `NOT (a AND b)`. It compiles to a real SQL `NOT (...)` rather than
to inverted operators — SQL is three-valued, so `NOT (a AND b)` and
`(NOT a) OR (NOT b)` stop agreeing the moment a NULL is involved. A negation
therefore **includes rows whose column is NULL**, which is what `NOT` means; AND
a `notnull` alongside it if that is not what you want.

**One group per request: `or` wins over `and`, and both over `not`.** They are
three spellings of the same slot, not three filters. Nest instead:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Groups may nest 32 levels deep; past that the request is refused with
`INVALID_LOGICAL_GROUP`.

A group **narrows** alongside the field filters rather than replacing them — see
[How the filters combine](#how-the-filters-combine).

### The `where` JSON dialect

The field filters above are one of two ways to send a filter. The other is a
single JSON object, which is what the OpenAPI document publishes on every
`GET /api/data/{slug}` and what the nested subcollection routes take:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Each key is a field, each value a canonical `[operator, value]` tuple — the same
tuples the SDK writes. A value may also be a pre-serialized dot-string
(`{"status":"eq.active"}`) or a bare scalar (`{"status":"active"}`); all three
compile to the same condition.

The difference worth knowing: **JSON carries types.** `?price=gte.100` sends the
string `"100"` and the driver casts it by column type, while
`?where={"price":[">=",100]}` sends a number. For a column whose text and
numeric readings differ — a version string, a zero-padded code — that is the
parameter to reach for.

A malformed `where` is a 400 `INVALID_WHERE`, not a silently dropped filter:
dropping it would run the read unfiltered and return everything row-level
security happens to allow.

### How the filters combine

`?field=op.value`, `?where=`, `?or=`/`?and=` and `?searchString=` are
independent, and every one of them that is present must match:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

There is no way to OR one against another. Anything that is not a plain AND of
those groups belongs inside a single `or=`/`and=` tree.

## Sorting

Use `orderBy` with the format `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

A missing direction is `asc`. A direction that is neither `asc` nor `desc`, or a
field the collection does not have, is a **400** — not a 200 with the rows in
whatever order the database pleased, which is indistinguishable from a sort that
worked.

### Several keys

The shorthand carries one key. For more, pass a JSON array — the second key
decides between rows the first calls equal:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Both spellings reach every route that lists rows, including nested ones
(`/api/data/authors/:id/posts`). Every sort ends on the row id descending
whether you asked for it or not: that is what makes the ordering total, and
paging over an order that is not total repeats and skips rows.

A repeated `?orderBy=` parameter is not a multi-key sort — the last one wins, as
it does for every other query parameter. Use the array.

### Where NULLs sort

By default NULLs sort **last ascending and first descending**, which is
Postgres's own convention. A third colon-segment says otherwise:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

The JSON array form takes a `"nulls"` key for the same thing:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Anything other than `first` or `last` is a 400, not a silently different order.
The cursor below honours whatever the sort declared, so paging over a nullable
key stays correct under either placement.

## Pagination

Use `limit` and `offset`, or `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

The default limit is **50**, the maximum is **1000**. Both come from `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, which the generated OpenAPI spec reports too — a `limit` above the maximum is rejected rather than clamped.

All three window parameters are refused rather than repaired, and each names
itself: `INVALID_LIMIT`, `INVALID_OFFSET` (a whole number of 0 or more) and
`INVALID_PAGE` (a whole number of 1 or more). A window quietly different from
the one asked for cannot be told apart from having reached the end of the
collection, which is why none of them is clamped or ignored.

### Cursor pagination

`offset` re-counts rows on every request, so a row inserted or deleted between
two pages shifts the window and the walk silently skips or repeats rows.
`?after=` seeks instead: the next page starts strictly after the last row
served.

Every list response carries `meta.nextCursor` while there is another page. Send
it back unchanged:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

The cursor is **opaque** — it encodes the sort keys *and* the last row's values
for them — so three rules follow, each a 400 rather than a wrong page:

| Situation | Code |
|-----------|------|
| `after` with `offset` or `page` | `CURSOR_WITH_OFFSET` — both say where the page starts |
| `after` with a different `orderBy` than it was issued under | `CURSOR_ORDER_MISMATCH` |
| A cursor this API did not issue | `INVALID_CURSOR` |

A request that names no `orderBy` **adopts the cursor's**, so passing
`meta.nextCursor` back without restating the sort works.

Multi-key sorts and nullable keys both page correctly: the comparison is built
over every key in order, with the NULL placement the sort declared. The one
ordering no cursor can describe is relevance (`_score`) — computed per query and
stored nowhere — and such a listing simply carries no `nextCursor`.

## Selecting columns

`?fields=` narrows a read to the columns you name. It is a projection pushed
into the query, not a trim of the response:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

The primary key always comes back (a row that cannot be addressed cannot be
updated, deleted, or paged past — and the cursor is derived from it), and
`excludeFromApi` columns stay hidden whether or not they are named. An unknown
column is a 400 `UNKNOWN_FIELD` rather than a row quietly missing a field.

`?distinct=true` collapses rows identical over those columns:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

It is refused (400) alongside a ranked `searchString` or a vector search, which
attach a per-row score that makes every row distinct by construction, and when
`orderBy` names a column `fields` does not return
(`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres cannot order a DISTINCT read by an
expression outside its select list.

`?fields=` and `?distinct=` work on the get-by-id route and the nested
subcollection routes too.

### Response Format

List responses include pagination metadata:

```json
{
    "data": [
        { "id": 1, "name": "Widget", "price": 29.99 },
        { "id": 2, "name": "Gadget", "price": 49.99 }
    ],
    "meta": {
        "total": 150,
        "limit": 20,
        "offset": 0,
        "hasMore": true,
        "nextCursor": "eyJrIjpbWyJpZCIsImRlc2MiXV0sInYiOnsiaWQiOjJ9LCJpIjoyfQ"
    }
}
```

`nextCursor` is present while `hasMore` is true and the page returned at least
one row; it is absent on the last page and on an ordering no cursor can
describe.

Single entity responses return a flat object:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Errors

Every failure, from every route, comes back in one envelope:

```json
{
    "error": {
        "message": "Unknown filter operator 'contains' on field 'title'.",
        "code": "UNKNOWN_FILTER_OPERATOR",
        "details": { "field": "title", "operator": "contains" },
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

`message` and `code` are always present. `details` appears when the refusal is
*about* something — the field that was wrong, the paths that failed. `requestId`
appears when the request carried an `X-Request-ID` header or was assigned one;
it is echoed on the response header too, and it is the thing to quote in a bug
report.

**Branch on `code`, never on `message` or on the status alone.** Codes are
`SCREAMING_SNAKE_CASE` and stable; messages are written for a person reading a
console and are free to change. The HTTP status is on the response, not in the
body.

| Status | Typical code | Means |
|--------|--------------|-------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | The request is malformed or asks for something impossible |
| 401 | `UNAUTHORIZED` | No credential, or one that identifies nobody |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | A credential that identifies somebody without the right |
| 404 | `NOT_FOUND` | The thing addressed does not exist |
| 409 | `CONFLICT` | The state conflicts — a duplicate key, a dirty tree |
| 501 | varies | The surface exists but is **not configured** on this deployment |
| 503 | `SERVICE_UNAVAILABLE` | A dependency is down; the request never reached it |

A surface that is absent because this deployment did not enable it answers 501
with a code and a reason, not 404 — an unexplained 404 on a route the UI just
called reads as a broken deploy.

Routes add their own more specific codes on top of these (`EMAIL_EXISTS`,
`TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), so treat the list of codes as
open. The client SDK turns all of them into a single `RebaseApiError` carrying
`status`, `code` and `details` — see
[Error handling](/docs/backend#error-handling).

## Text Search

Use `searchString` for full-text search across string fields:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Vector Search

If a collection defines a property with a type of `vector`, you can perform high-speed similarity searches using pgvector distance operations compiled directly in the database query.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Vector Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | The name of the vector property to query against. |
| `vector` | `string` | A JSON-serialized array of floats representing the query vector. |
| `vector_distance` | `string` | The distance metric to evaluate. Supported values: `cosine` (default, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximum distance threshold. Only records with distance less than this threshold are returned. |

## Relation Inclusion

Use the `include` parameter to embed related entities:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

A name that is not a relation of the collection is a **400
`UNKNOWN_RELATION`**, at every level. It used to be ignored, which answers 200
with the field simply missing — indistinguishable from a row that genuinely has
no related row, so a typo looked exactly like empty data. A path deeper than
three hops is `INCLUDE_TOO_DEEP`.

### Narrowing one relation

The comma-separated form has nowhere to put a per-relation `limit`, so
`include` also accepts JSON — told apart by a leading brace:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Key | Meaning |
|-----|---------|
| `limit` | Rows **per parent row**, not across the page |
| `where` | The same filter dialect the top-level `where` uses |
| `logical` | An `or`/`and`/`not` group over the related rows |
| `orderBy` | The same sort spelling, including the NULL placement |
| `fields` | Columns of the *related* row; its key always survives |
| `include` | Relations of the related row, in turn |

`true` means "load it whole", so `{"author":true}` and `author` are the same
request. Both spellings work on the list route, the get-by-id route and the
nested subcollection routes.

Each hop is one batched query for the whole page, never one per row.

Included relations are embedded directly in the response:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Writing

Idempotency keys, conditional writes (`ETag` / `If-Match`), field operations
(`$inc`, `$push`, `$pull`, `$merge`), upserting on a natural key,
`Prefer: return=minimal`, and the cross-collection `POST /api/data/_batch`
endpoint are all on their own page: **[Writing over
REST](/docs/backend/writes/)**.

## Lifecycle Hook Pipeline

Every REST mutation operation (`POST`, `PATCH`, `DELETE`) runs through a strict, sequential hook execution pipeline:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Blocking vs. Deferred Hooks

1. **Blocking Hooks (`beforeSave`, `beforeDelete`)**
   These hooks are executed synchronously in the main request cycle *before* committing the database transaction. They can modify incoming payloads, run custom validations, or abort the request entirely by throwing an error.

2. **Deferred Hooks (`afterSave`, `afterDelete`)**
   These hooks execute asynchronously after the database transaction has successfully committed. They use deferred promises (fire-and-forget), meaning they run in the background and do not block the client's HTTP response. Ideal for sending webhooks, triggering push notifications, or queuing external tasks.


## System endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` and `/api/health` | none | Liveness/readiness check |
| `GET` | `/api/docs` | none | The OpenAPI 3.0 JSON specification |
| `GET` | `/api/swagger` | none | Swagger UI. On in development, off in production; `REBASE_ENABLE_SWAGGER` overrides either way |
| `GET` | `/api/meta/schema-version` | none | The schema hash this backend was built from — deliberately unauthenticated, and it returns only that hash |
| `GET` | `/api/meta/contract` | admin, service key or admin API key | The full collection contract, for `rebase generate-sdk --from`. Fail-closed: `404` when no auth is configured |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` when set | Prometheus metrics, when `REBASE_METRICS=true` |

## OpenAPI / Swagger

The OpenAPI spec is auto-generated from your collection definitions: it describes the list, read, create, update, delete and bulk endpoints of every collection the backend serves, with their query parameters and response schemas. It is not a complete map of the HTTP surface — the auth, storage, functions and cron routes are documented on this site only — and columns marked `excludeFromApi` are left out of it.

Machine callers authenticate with a scoped key rather than a session:
[API keys](/docs/backend/api-keys/).

## Schema Metadata

The project's full collection schema — every collection, property and relation —
is served to an authenticated admin:

```bash
GET /api/meta/contract
```

It is **admin-only**, and on a deployment with no authentication configured it
is not served at all (404 `CONTRACT_UNAVAILABLE`) rather than exposing the
schema to anyone. Its sibling returns a version string that stands for the
schema without describing it, and is deliberately reachable with no credential
— which is what a CI job polls:

```bash
GET /api/meta/schema-version
```

For the shape of the endpoints rather than the schema behind them, the OpenAPI
document is at `GET /api/docs`, with Swagger UI at `/api/swagger` when
`enableSwagger` is on.

## Next Steps

- **[Client SDK](/docs/sdk)** — Type-safe client for the REST API
- **[Collections](/docs/collections)** — Define your data schema
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Control access per row
