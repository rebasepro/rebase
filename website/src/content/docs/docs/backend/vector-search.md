---
title: Vector Search
sidebar_label: Vector Search
description: Nearest-neighbour search over a vector property through the REST API — the query parameters, thresholds, embeddings too long for a URL, and how filters behave on an HNSW index.
---

If a collection defines a property with a type of `vector`, you can perform high-speed similarity searches using pgvector distance operations compiled directly in the database query.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | The name of the vector property to query against. |
| `vector` | `string` | A JSON-serialized array of floats representing the query vector. |
| `vector_distance` | `string` | The distance metric to evaluate. Supported values: `cosine` (default, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximum distance threshold. Only records with distance less than this threshold are returned. |

A vector search with a
`vector_threshold` has no `meta.total`: counting the rows within a distance means
computing that distance for every row of the table, which no index serves — several
times the cost of the page itself, growing with rows × dimensions. `meta.hasMore` is
exact, from reading one row past the page. Without a threshold the count is the
ordinary one.

An embedding is long in a URL: 768 dimensions are about 17 KB of query string and
1,536 about 33 KB. The server accepts up to 64 KB of request line and headers
(; 16 KB before, a 431
from 768 dimensions up), and a proxy in front of it usually accepts less — nginx's
default is 8 KB. Send a vector search as [`POST …/query`](#queries-too-long-for-a-url)
instead; the SDK always does.

## Filters on an approximate index

A vector search that
also filters — a `where`, a search, row-level security — returns the nearest rows
that match. An HNSW index answers with a fixed number of nearest candidates
(`hnsw.ef_search`, 40 by default), and the other conditions are applied to those;
when few of them match, the page came back short or empty though plenty of rows
did, and offset pages skipped rows. With pgvector 0.8.0 or later the read turns on
pgvector's iterative index scan (`hnsw.iterative_scan = strict_order`, for that
read's transaction only), which keeps scanning until the page is full, up to
`hnsw.max_scan_tuples` (20,000 by default) — a filter that matches almost nothing
near the query vector can still return a short page. On an older pgvector, and on
an IVFFlat index, a filtered vector search keeps the short-page behaviour; an exact
scan (`index: false`) never had it.

## Queries too long for a URL

`POST /api/data/:slug/query`
is the listing `GET /api/data/:slug` answers, with the query parameters in a JSON
body instead of the URL. Use it when the URL would not fit — a vector search's
embedding, a filter on a long `in` list. The SDK sends every vector search this way,
and any other query whose URL would pass 6 KB.

```bash
POST /api/data/docs/query
Content-Type: application/json

{
  "vector_search": "embedding",
  "vector": [0.15, 0.22, -0.05],
  "vector_threshold": 0.8,
  "where": { "status": ["==", "published"] },
  "limit": 10
}
```

The body's keys are the query parameters, and the server reads them back into
exactly the parameters the `GET` reads, through the same parser — same filters,
page, count, cursor and includes, same row-level security, same errors. A value is
spelled as the URL spells it: a string (or a number or boolean), and for a filter
repeated in the URL a list (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` and `vector` take their JSON value itself or that JSON as a string. A
list for a parameter the URL reads once, an object anywhere else, or a parameter
also put on the URL is a 400 `INVALID_QUERY_BODY`.

It only reads, so an API key needs `data:read` for it, not `data:write`, and it
counts against the same rate limit as the `GET`. Nested listings have it too:
`POST /api/data/authors/42/posts/query`. A server older than 0.24 answers it 404;
the SDK then sends the `GET`.

The count has the
same twin: `POST /api/data/:slug/count` (and `POST /api/data/authors/42/posts/count`)
is `GET /api/data/:slug/count` with its parameters in the body, read the same way
and refused the same way. A count carries the filters of the `find()` it describes,
so its URL is as long. The SDK's `count()` follows the rule `find()` does — every
vector search, and any count whose URL would pass 6 KB — and falls back to the
`GET` against an older server.

## Related

- [REST API](/docs/backend/api/) — every other parameter a listing takes
- [Aggregates & search](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` from the SDK, and the index a vector property gets
