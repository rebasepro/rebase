---
title: REST API filtering
sidebar_label: Filtering
description: Filter REST list requests with PostgREST-style operators, or/and groups and the where JSON dialect, and see how the filters combine.
---

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

## Filter Operators

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

The four pattern operators match text. An enum column is matched by its value
(`?status=like.draft%25`); on a number, a date or any other column that is not
text they are a 400 `INVALID_FILTER_OPERATOR`.

`isnull` and `notnull` ignore their value — the operator is the whole condition,
and anything after the dot is discarded. The SDK writes `.null`, so that is the
spelling you will see on the wire.

:::caution[`eq.null` is the four-character string, not `IS NULL`]
`?deleted_at=eq.null` searches for the literal text `null`. SQL `= NULL` is
never true, so there is no reading of `eq.null` that could mean the null test —
use `isnull` for that. The SDK serializes `.where("deleted_at", "==", null)` as
`isnull.null` for exactly this reason.
:::

## Logical Operators

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

A condition inside a group whose operator the dialect does not have —
`?not=(title.contains.x)` — is a 400 `UNKNOWN_FILTER_OPERATOR`, as it is in a
JSON `where`. It is not read as an equality on `contains.x`, which inside `not`
would have matched every row.

A group **narrows** alongside the field filters rather than replacing them — see
[How the filters combine](#how-the-filters-combine).

## The `where` JSON dialect

The field filters above are one of two ways to send a filter. The other is a
single JSON object, which is what the OpenAPI document publishes on every
`GET /api/data/{slug}` and what the nested subcollection routes take:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Each key is a field, each value a canonical `[operator, value]` tuple — the same
tuples the SDK writes. A value may also be a pre-serialized dot-string
(`{"status":"eq.active"}`) or a bare scalar (`{"status":"active"}`); all three
compile to the same condition. An array of plain values is an implicit `in`: `{"category":["electronics","gadgets"]}` reads as
`["in", ["electronics","gadgets"]]`, while an operator-shaped first element that
is not a real operator (`["!!","x"]`) is a 400 `UNKNOWN_FILTER_OPERATOR`.

The same object is read the same way wherever it arrives: here, in the SDK's
`where`, in an MCP query, and in the realtime socket's `filter` — its list and
count requests and its live subscriptions.

The difference worth knowing: **JSON carries types.** `?price=gte.100` sends the
string `"100"` and the driver casts it by column type, while
`?where={"price":[">=",100]}` sends a number. For a column whose text and
numeric readings differ — a version string, a zero-padded code — that is the
parameter to reach for.

A malformed `where` is a 400 `INVALID_WHERE`, not a silently dropped filter:
dropping it would run the read unfiltered and return everything row-level
security happens to allow.

## How the filters combine

`?field=op.value`, `?where=`, `?or=`/`?and=` and `?searchString=` are
independent, and every one of them that is present must match:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

There is no way to OR one against another. Anything that is not a plain AND of
those groups belongs inside a single `or=`/`and=` tree.

## Next Steps

- **[REST API](/docs/backend/api)** — Endpoints, sorting, pagination and relation inclusion
- **[Querying Data](/docs/sdk/querying)** — The same filters from the typed SDK
