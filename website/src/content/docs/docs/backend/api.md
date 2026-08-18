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

For each collection, the following endpoints are generated:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | List entities |
| `GET` | `/api/data/:slug/count` | Count entities |
| `GET` | `/api/data/:slug/:id` | Get a single entity |
| `POST` | `/api/data/:slug` | Create a entity |
| `PATCH` | `/api/data/:slug/:id` | Update a entity (partial — only the properties you send are written) |
| `PUT` | `/api/data/:slug/:id` | Same handler as `PATCH`, kept because every shipped SDK sends it |
| `DELETE` | `/api/data/:slug/:id` | Delete a entity |
| `POST` | `/api/data/:slug/bulk` | Create many entities in one transaction |
| `PATCH` | `/api/data/:slug/bulk` | Update many entities in one transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Delete many entities in one transaction |

### Subcollection Routes

Nested relations are accessible via URL paths:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post (PUT also accepted)
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

### Logical Operators

Use `or` and `and` for complex conditions:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)
```

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

## Pagination

Use `limit` and `offset`, or `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses default limit of 20)
GET /api/data/products?page=3
```

The default limit is **20**, the maximum is **100**.

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
        "hasMore": true
    }
}
```

Single entity responses return a flat object:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

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

# Include all relations
GET /api/data/articles?include=*
```

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

## Field Selection

Use `fields` to select specific columns:

```bash
GET /api/data/products?fields=id,name,price
```

## Lifecycle Hook Pipeline

Every REST mutation operation (`POST`, `PUT`, `DELETE`) runs through a strict, sequential hook execution pipeline:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Blocking vs. Deferred Hooks

1. **Blocking Hooks (`beforeSave`, `beforeDelete`)**
   These hooks are executed synchronously in the main request cycle *before* committing the database transaction. They can modify incoming payloads, run custom validations, or abort the request entirely by throwing an error.

2. **Deferred Hooks (`afterSave`, `afterDelete`)**
   These hooks execute asynchronously after the database transaction has successfully committed. They use deferred promises (fire-and-forget), meaning they run in the background and do not block the client's HTTP response. Ideal for sending webhooks, triggering push notifications, or queuing external tasks.


## OpenAPI / Swagger

- **OpenAPI spec**: `GET /api/docs` — Returns the full OpenAPI 3.0 JSON specification
- **Swagger UI**: `GET /api/swagger` — Interactive API explorer (dev mode only)

The OpenAPI spec is auto-generated from your collection definitions: it describes the list, read, create, update, delete and bulk endpoints of every collection the backend serves, with their query parameters and response schemas. It is not a complete map of the HTTP surface — the auth, storage, functions and cron routes are documented on this site only — and columns marked `excludeFromApi` are left out of it.

## API Keys

API keys provide machine-to-machine authentication for agents, MCP servers, CI pipelines, and external integrations. They support per-collection permission scoping and optional full admin access.

### Creating an API Key

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

The response includes the full plaintext key (`rk_live_...`) **exactly once** — store it immediately.

### Using an API Key

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permissions and RLS: two independent gates

An API key's request passes through **two** authorization checks, and both must allow it:

1. **The key's permission list** — collection × operation, checked at the route layer.
2. **Row-Level Security** — API keys do *not* bypass RLS. A key runs as
   `uid: "api-key:<id>"` with the `service` role (plus `admin` when
   `admin: true`). Admin keys pass via the built-in admin policies; a
   non-admin key only sees rows that a security rule explicitly grants to
   the `service` role or to the public. Owner-style rules
   (`owner_id = rebase.uid()`) never match an API key.

So a non-admin key with `"*"` permissions can still get empty results — that's
RLS working, not a bug. Either grant the `service` role in the relevant
collections' security rules, or use an admin key.

### Custom Functions

Function invocations are scoped like collections, under the `functions`
namespace: `{"collection": "functions", "operations": ["write"]}` grants every
function, `"functions/<name>"` grants one, and the global `"*"` wildcard grants
all. A key without such an entry cannot invoke functions at all.

### Storage

Storage works the same way, under the `storage` namespace:
`{"collection": "storage", "operations": ["read", "write"]}` lets the key
download/list (`read`), upload and create folders (`write`), and delete files
(`delete`). The global `"*"` wildcard also grants storage. A key without such
an entry cannot touch storage. TUS resumable-upload routes count as `write`
for every step (including the offset check and cancel), so a write-scoped key
can complete an upload on its own.

### Agents and MCP Servers

An agent wants the *narrowest* key that does its job, not an admin one. Start
scoped, and give it an expiry:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Operations are `read`, `write` and `delete`, derived from the HTTP method:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### A scoped key reads zero rows until a rule grants `service`

This is the step that makes a correctly scoped key look broken. A non-admin key
runs as `uid: "api-key:<id>"` with the roles `["service"]`, and the RLS policy
injected into every collection by default compiles to:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— the server context, or an admin. A non-admin key matches neither arm, so on a
collection with no `securityRules` the request succeeds with an empty result set
and no error explaining why. Grant the role explicitly:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Because `rebase.uid()` carries the key's id, a rule can also scope rows to one
specific key:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Don't use `"*"` for a read-only key

The `"*"` wildcard is not "every collection" — it also matches the `functions`
namespace and `storage`. A `GET` counts as `read`, and a custom function's
handler is arbitrary code that can write, so a wildcard "read-only" key can
mutate through a function. Naming collections explicitly gives the key no
function access at all.

#### `--admin --full-access`: CI, migrations, first-party tooling

`"admin": true` grants the key the admin role — `/api/admin/*` routes for schema
management, user management, and more, plus cron, backups, and logs. Combined
with `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`) the key holds every collection plus all storage and every custom
function. That is the right shape for CI, migrations, and trusted first-party
tooling — not for agents.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### No realtime over API keys

The realtime WebSocket does not parse `rk_` tokens — it accepts user JWTs and
the service key only. An agent authenticated with an API key polls the REST
endpoints instead of subscribing.

### Key Options

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable label |
| `permissions` | `ApiKeyPermission[]` | Per-collection access (`"*"` = everything; `"functions/<name>"` = one function; `"storage"` = file storage) |
| `admin` | `boolean` | Grant admin role — admin routes + RLS admin policies |
| `rate_limit` | `number \| null` | Requests per 15-min window (`null` = the server default, 1000) |
| `expires_at` | `string \| null` | ISO-8601 expiration timestamp |

The CLI requires an explicit scope: pass `--permissions '<json>'` or opt into
`--full-access` — there is no silent full-access default.

Keys can be listed, updated, and revoked via `/api/admin/api-keys` or the
`rebase api-keys` CLI commands — but not by an API key. Any request to
`/api/admin/api-keys` authenticated with an `rk_` key is refused with `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN`, whatever its `admin` flag. Key management
requires an admin user's session or the service key.

## Metadata Endpoint

Get a list of all available collections and their structure:

```bash
GET /api/collections
```

## Next Steps

- **[Client SDK](/docs/sdk)** — Type-safe client for the REST API
- **[Collections](/docs/collections)** — Define your data schema
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Control access per row
