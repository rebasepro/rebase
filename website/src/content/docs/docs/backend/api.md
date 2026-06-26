---
title: REST & GraphQL API
sidebar_label: REST & GraphQL API
description: Auto-generated REST and GraphQL API endpoints for every collection, with filtering, sorting, pagination, and relation inclusion.
---

## Overview

Rebase automatically generates a complete API from your collection definitions:

- **REST API** — CRUD endpoints for every collection at `/api/data/:slug`
- **GraphQL API** — Auto-generated schema at `/api/graphql`
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
| `POST` | `/api/data/:slug` | Create an entity |
| `PUT` | `/api/data/:slug/:id` | Update an entity |
| `DELETE` | `/api/data/:slug/:id` | Delete an entity |

### Subcollection Routes

Nested relations are accessible via URL paths:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PUT    /api/data/authors/42/posts/7       → update the post
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
    "created_at": "2026-01-15T10:30:00Z"
}
```

## Text Search

Use `searchString` for full-text search across string fields:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Vector Search

If a collection defines a property with a type of `vector`, you can perform high-speed similarity searches using pgvector cosine distance operations compiled directly in the database query.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Vector Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | The name of the vector property to query against. |
| `vector` | `string` | A JSON-serialized array of floats representing the query vector. |
| `vector_distance` | `string` | The distance metric to evaluate. Supported value: `cosine` (compiles to Postgres `embedding <=> query_vector`). |
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
    "author_id": 42,
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

## GraphQL API

A GraphQL endpoint is automatically generated at `/api/graphql`. The schema is compiled dynamically on startup from your collections configuration.

```graphql
query {
    products(limit: 10, orderBy: "price:desc") {
        id
        name
        price
        category {
            id
            name
        }
    }
}
```

### Type Mapping

TypeScript collection property types map to GraphQL types as follows:

| Property Type | GraphQL Type |
|---------------|--------------|
| `string` / `binary` / `date` | `GraphQLString` |
| `number` | `GraphQLFloat` (or `GraphQLInt` if `integer` validation is set) |
| `boolean` | `GraphQLBoolean` |
| `array` | `GraphQLList(GraphQLString)` |
| `vector` | `GraphQLList(GraphQLFloat)` |

### RLS Integration

GraphQL resolvers access the database using `context.driver` (a Postgres driver scoped dynamically by Hono's authentication middleware). Because resolver calls use the transaction-local session state populated with `app.user_id` and `app.user_roles`, all GraphQL queries and mutations automatically enforce Row-Level Security (RLS) constraints.

In development mode, an interactive GraphiQL IDE is available at `/api/graphiql`.

## OpenAPI / Swagger

- **OpenAPI spec**: `GET /api/docs` — Returns the full OpenAPI 3.0 JSON specification
- **Swagger UI**: `GET /api/swagger` — Interactive API explorer (dev mode only)

The OpenAPI spec is auto-generated from your collection definitions and includes all endpoints, query parameters, and response schemas.

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

### Admin Access for Agents and MCP

By default, API keys get the `service` role (data access only). Add `"admin": true` to grant the key full admin access — including `/api/admin/*` routes for schema management, user management, and more. Use this for agents, MCP servers, and CI:

```bash
# CLI
rebase api-keys create --name "My Agent" --admin

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

### Key Options

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable label |
| `permissions` | `ApiKeyPermission[]` | Per-collection access (`"*"` = all collections) |
| `admin` | `boolean` | Grant admin role — access to all admin routes |
| `rate_limit` | `number \| null` | Requests per 15-min window (`null` = unlimited) |
| `expires_at` | `string \| null` | ISO-8601 expiration timestamp |

Keys can be listed, updated, and revoked via `/api/admin/api-keys` or the `rebase api-keys` CLI commands.

## Metadata Endpoint

Get a list of all available collections and their structure:

```bash
GET /api/collections
```

## Next Steps

- **[Client SDK](/docs/sdk)** — Type-safe client for the REST API
- **[Collections](/docs/collections)** — Define your data schema
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Control access per row
