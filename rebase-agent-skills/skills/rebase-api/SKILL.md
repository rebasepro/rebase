---
name: rebase-api
description: Guide for working with Rebase auto-generated REST and GraphQL APIs. Use this skill when the user needs to understand the API endpoints, query parameters, filtering, sorting, pagination, or GraphQL schema.
---

# Rebase Auto-Generated APIs

> **WARNING FOR AGENTS**: If you are writing a script or data task, **default to using the Rebase SDK** (`@rebasepro/client` or `@rebasepro/server`) instead of making raw REST or GraphQL API calls (`fetch` / `curl`). For custom backend functions, use `client.functions.invoke('function-name', payload)` — **NEVER** manually construct `/api/functions/` URLs or extract tokens from localStorage. Only use raw API calls if specifically instructed to do so or if you are demonstrating HTTP usage to the user.

Every collection defined in Rebase automatically gets full REST CRUD and GraphQL endpoints. No manual route creation needed.

## REST API

### Base Paths

All data routes are mounted under `/api/data/`. Other route categories:

| Base Path | Purpose |
|-----------|---------|
| `/api/data/{slug}` | Collection CRUD (auto-generated) |
| `/api/data/{slug}/count` | Count matching entities |
| `/api/data/{slug}/aggregate` | count/sum/avg/min/max, optionally grouped |
| `/api/data/{parent}/{parentId}/{child}` | Subcollection routes |
| `/api/auth/*` | Authentication (login, register, refresh, OAuth) |
| `/api/admin/*` | User & role management |
| `/api/admin/api-keys` | Service API key management |
| `/api/storage/*` | File uploads and downloads |
| `/api/functions/{name}` | Custom backend functions |
| `/api/schema-editor/*` | Visual schema editor (dev only) |
| `/api/docs` | OpenAPI 3.0.3 JSON spec |
| `/api/swagger` | Swagger UI (dev only) |
| `/api/graphql` | GraphQL endpoint (when enabled) |
| `/api/graphiql` | GraphiQL IDE (dev only, when GraphQL enabled) |
| `/api/health` | Health check (when using `RebaseApiServer`) |
| `/api/collections` | Collections metadata (when using `RebaseApiServer`) |

### CRUD Operations

> **IMPORTANT FOR AGENTS:** There is NO `PATCH` method. Updates use `PUT` only. `POST` returns `201`, `DELETE` returns `204` (empty body).

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| `GET` | `/api/data/{slug}` | List entities (with filtering, sorting, pagination) | `200` |
| `GET` | `/api/data/{slug}/count` | Count matching entities (with optional filters) | `200` |
| `GET` | `/api/data/{slug}/aggregate` | Aggregate over matching entities | `200` |
| `GET` | `/api/data/{slug}/:id` | Get a single entity by ID | `200` |
| `POST` | `/api/data/{slug}` | Create a new entity | `201` |
| `PUT` | `/api/data/{slug}/:id` | Update a entity | `200` |
| `DELETE` | `/api/data/{slug}/:id` | Delete a entity | `204` |

### Subcollection Routes

For collections with relations, Rebase generates nested routes automatically. The URL pattern is `/{parent}/{parentId}/{child}`, and it supports arbitrarily deep nesting (parent/id/child/id/grandchild):

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| `GET` | `/api/data/{parent}/{parentId}/{child}` | List child entities | `200` |
| `GET` | `/api/data/{parent}/{parentId}/{child}/count` | Count child entities | `200` |
| `GET` | `/api/data/{parent}/{parentId}/{child}/:id` | Get a single child entity | `200` |
| `POST` | `/api/data/{parent}/{parentId}/{child}` | Create a child entity | `201` |
| `PUT` | `/api/data/{parent}/{parentId}/{child}/:id` | Update a child entity | `200` |
| `DELETE` | `/api/data/{parent}/{parentId}/{child}/:id` | Delete a child entity | `204` |

**Example:** List all posts by author `111094`:
```bash
GET /api/data/authors/111094/posts
```

## Query Parameters

### Pagination

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `20` | Max results per page (max: `100`) |
| `offset` | integer | `0` | Number of records to skip |
| `page` | integer | — | Page number (alternative to offset). Calculates offset as `(page - 1) * limit` |

> **IMPORTANT FOR AGENTS:** The default limit is **20**, NOT 25. The max limit is **100**.

### Sorting

Use the `orderBy` parameter. Two formats are supported:

**Simple format:**
```
?orderBy=field:direction
```

**JSON array format (for multi-column sort):**
```
?orderBy=[{"field":"createdAt","direction":"desc"},{"field":"name","direction":"asc"}]
```

The keys apply in the order given: the second decides between rows the first
calls equal. `direction` may be omitted and defaults to `asc`.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `orderBy` | string | Sort field and direction | `?orderBy=createdAt:desc` |

What an agent has to know before constructing one:

- **A repeated `?orderBy=` is not a multi-key sort.** The last value wins, as
  for every query parameter. Use the JSON array.
- **The whole shape is validated.** A bare object (`?orderBy={"field":"name"}`),
  a bare `["name"]`, a number, or a direction that is not `asc`/`desc` is a
  **400**, not a 200 with unsorted rows. So is a field the collection does not
  have (`UNKNOWN_ORDER_BY_FIELD`), and a to-many relation, which has no single
  value per row to order by (`ORDER_BY_FIELD_NOT_SORTABLE`).
- **Every sort ends on the row id descending**, whether asked for or not. That
  is what makes the ordering total; paging with `offset` over an order that is
  not total repeats some rows and skips others.
- Both spellings work on nested routes too — `/api/data/authors/:id/posts`.

### Filtering (PostgREST-Style)

> **IMPORTANT FOR AGENTS:** Filters use PostgREST-style syntax: `?field=op.value`. This is NOT bracket syntax. For example: `?status=eq.active`, NOT `?filter[status][eq]=active`.

Every field in the collection can be used as a query parameter with an operator prefix:

```
?{field}={operator}.{value}
```

**Implicit equality:** A plain value without an operator prefix implies equality:
```
?status=active          →  status == "active"
?price=29.99            →  price == 29.99
```

### Filter Operators

| Operator | Mapped To | Description | Example |
|----------|-----------|-------------|---------|
| `eq` | `==` | Equal | `?status=eq.active` |
| `neq` | `!=` | Not equal | `?status=neq.archived` |
| `gt` | `>` | Greater than | `?price=gt.50` |
| `gte` | `>=` | Greater than or equal | `?price=gte.50` |
| `lt` | `<` | Less than | `?price=lt.100` |
| `lte` | `<=` | Less than or equal | `?price=lte.100` |
| `in` | `in` | Value in list | `?status=in.(active,published)` |
| `nin` | `not-in` | Value not in list | `?status=nin.(archived,deleted)` |
| `cs` | `array-contains` | Array contains value | `?tags=cs.javascript` |
| `csa` | `array-contains-any` | Array contains any of values | `?tags=csa.(javascript,typescript)` |

> **WARNING FOR AGENTS:** There is NO `like` operator. Use `searchString` for text search instead — and read the Text Search section below before telling a user what it will match, because by default it does not see inside JSONB.

**Array values** for `in`, `nin`, and `csa` use parenthesized comma-separated lists: `(val1,val2,val3)`.

**Automatic type coercion:** The values `true`, `false`, `null`, and numeric strings are automatically parsed to their corresponding types.

### Logical Operators (or / and)

For complex conditions, use the `or` and `and` query parameters with nested condition strings:

```
?or=(status.eq.active,status.eq.pending)
?and=(price.gte.10,price.lte.100)
```

Nested logical conditions are also supported:

```
?or=(status.eq.active,and(price.gte.10,price.lte.50))
```

### Text Search

| Parameter | Type | Description |
|-----------|------|-------------|
| `searchString` | string | Text search. Substring by default; ranked full-text if the collection declares a `search` block |

```
?searchString=widget
```

By default this is `ILIKE '%widget%'` OR-ed across the collection's top-level
string properties — it does **not** reach inside `map`/JSONB or array
properties, and does not rank. A collection that declares a `search` block gets
ranked full-text matching over the fields it names, and rows carry a `_score`
that `orderBy` accepts:

```
?searchString=auditor%20iso%2014001&orderBy=_score:desc
```

`orderBy=_score` returns 400 on a collection without the block, or without a
`searchString`.

### Vector Search

Nearest-neighbour search over a property of type `vector`. All four parameters
below work together; `vector_search` and `vector` are both required.

| Parameter | Type | Description |
|-----------|------|-------------|
| `vector_search` | string | Name of the `vector` property |
| `vector` | JSON array | Query embedding, e.g. `[0.12,-0.04,0.98]`. Length must match the property's `dimensions` |
| `vector_distance` | string | `cosine` (default), `l2`, or `inner_product` |
| `vector_threshold` | number | Drop rows farther than this |

```
?vector_search=embedding&vector=%5B0.12%2C-0.04%5D&vector_threshold=0.35
```

Rows come back closest-first, each with a `_distance`. Other filters apply
before the ordering.

### Relation Includes (Eager Loading)

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `include` | string | Comma-separated list of relations to eager-load | `?include=author,tags` |

Use `*` to include all relations:
```
?include=*
```

### Field Selection

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `fields` | string | Comma-separated list of fields to return | `?fields=id,name,price` |

### Vector Similarity Search

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `vector_search` | string | Name of the vector property to search | `?vector_search=embedding` |
| `vector` | string | JSON array of numbers (query vector) | `?vector=[0.1,0.2,0.3]` |
| `vector_distance` | string | Distance function: `cosine`, `l2`, or `inner_product` (default: `cosine`) | `?vector_distance=cosine` |
| `vector_threshold` | number | Optional similarity threshold | `?vector_threshold=0.8` |

**Example — vector similarity search:**
```
?vector_search=embedding&vector=[0.1,0.2,0.3,0.4]&vector_distance=cosine&vector_threshold=0.5
```

### Reserved Query Keys

These parameter names are reserved and will NOT be interpreted as filter fields:

`limit`, `offset`, `page`, `orderBy`, `include`, `fields`, `searchString`, `vector_search`, `vector`, `vector_distance`, `vector_threshold`, `or`, `and`

## Response Format

### List Response (GET collection)

```json
{
  "data": [
    { "id": "uuid-1", "name": "Product A", "price": 29.99 },
    { "id": "uuid-2", "name": "Product B", "price": 49.99 }
  ],
  "meta": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

> **IMPORTANT FOR AGENTS:** The pagination envelope key is `meta`, NOT `pagination`.

### Single Entity Response (GET by ID)

Returns the flat entity object directly (no `data` wrapper):

```json
{
  "id": "uuid-1",
  "name": "Product A",
  "price": 29.99,
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

### Create Response (POST — 201)

Returns the created entity as a flat object:

```json
{
  "id": "generated-uuid",
  "name": "New Product",
  "price": 19.99
}
```

### Update Response (PUT — 200)

Returns the updated entity as a flat object.

### Delete Response (DELETE — 204)

Returns an empty body with status `204 No Content`.

### Count Response

```json
{
  "count": 42
}
```

## Error Handling

All errors follow the canonical shape:

```json
{
  "error": {
    "message": "Human-readable error description",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

The `details` field is optional and only present when additional context is available.

### Error Codes and HTTP Status Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| `400` | `BAD_REQUEST` | Invalid input or malformed request |
| `400` | `INVALID_INPUT` | Validation failure |
| `401` | `UNAUTHORIZED` | Missing or invalid authentication token |
| `401` | `INVALID_CREDENTIALS` | Wrong email/password |
| `401` | `INVALID_TOKEN` | Expired or malformed JWT |
| `403` | `FORBIDDEN` | Insufficient permissions (e.g., API key lacks permission) |
| `403` | `API_KEY_FORBIDDEN` | API key does not have permission for this operation |
| `404` | `NOT_FOUND` | Entity not found |
| `409` | `CONFLICT` | Duplicate resource (e.g., email exists) |
| `409` | `EMAIL_EXISTS` | Registration with existing email |
| `413` | `PAYLOAD_TOO_LARGE` | Request body exceeds max size (default 10MB) |
| `500` | `INTERNAL_ERROR` | Unexpected server error |
| `503` | `SERVICE_UNAVAILABLE` | Service not available |

### ApiError Factory Methods

The backend uses `ApiError` static methods to throw typed errors:

```typescript
ApiError.badRequest("Invalid email format", "INVALID_INPUT");
ApiError.unauthorized("Token expired");
ApiError.forbidden("Admin access required");
ApiError.notFound("Entity not found");
ApiError.conflict("Email already registered", "EMAIL_EXISTS");
ApiError.internal("Database connection failed");
ApiError.serviceUnavailable("Service is down");
```

## Authentication

### Bearer Token (JWT)

```
Authorization: Bearer <jwt-token>
```

### Query Parameter Token

As an alternative to the Authorization header, pass the token as a query parameter:

```
?token=<jwt-token>
```

### Service Key

A static secret key for server-to-server or script authentication. When a request sends a Bearer token matching the service key, it is granted admin-level access (`userId: "service"`, `roles: ["admin"]`) without JWT verification.

```
Authorization: Bearer <service-key>
```

### API Keys (rk_ prefix)

Service API keys start with the `rk_` prefix and are validated against the database. API keys have per-collection permissions controlling which CRUD operations are allowed:

```
Authorization: Bearer rk_live_abc123...
```

If an API key lacks the required permission for an operation, a `403 API_KEY_FORBIDDEN` error is returned.

Beyond collections, the permission list also covers custom functions
(`"functions"` for all, `"functions/<name>"` for one) and file storage
(`"storage"`); the global `"*"` wildcard grants all three. API keys do NOT
bypass RLS: admin keys pass via the built-in admin policies, while non-admin
keys only see rows a security rule grants to the `service` role or the public.

**Admin API keys** — set `"admin": true` when creating a key to grant it the `admin` role. This gives access to all `/api/admin/*` routes (schema, users, other API keys, etc.) plus cron, backups, and logs. Use this for agents, MCP servers, and CI pipelines:

```bash
# CLI (an explicit scope is required: --permissions '<json>' or --full-access)
rebase api-keys create --name "My Agent" --admin --full-access

# REST
POST /api/admin/api-keys
{ "name": "My Agent", "admin": true, "permissions": [{ "collection": "*", "operations": ["read","write","delete"] }] }
```

### Authentication Enforcement

- **Default:** Auth is required (`requireAuth: true`). Requests without a valid token receive `401`.
- **Public access:** Set `requireAuth: false` to allow anonymous access. Access control is then fully delegated to Postgres Row-Level Security (RLS) policies.
- **Fail-closed:** The raw unscoped driver is never placed in the request context. Every request is either RLS-scoped or rejected.

## DataHooks Lifecycle

DataHooks run at the REST API boundary (after DB operations, before response) and apply to **all** collections. They are configured via `hooks.data` in the backend config.

| Hook | Trigger | Can Modify? | Can Abort? |
|------|---------|-------------|------------|
| `afterRead(slug, entity, ctx)` | GET (list & single) | Return modified entity, or `null` to filter it out | No |
| `beforeSave(slug, values, entityId, ctx)` | POST and PUT, before DB write | Return modified values | Throw to abort |
| `afterSave(slug, entity, ctx)` | POST and PUT, after DB write | No (fire-and-forget) | No |
| `beforeDelete(slug, entityId, ctx)` | DELETE, before DB delete | No | Throw to abort |
| `afterDelete(slug, entityId, ctx)` | DELETE, after DB delete | No (fire-and-forget) | No |

The `BackendHookContext` provides:

```typescript
interface BackendHookContext {
  requestUser?: { userId: string; roles: string[] };
  method: "GET" | "POST" | "PUT" | "DELETE";
}
```

> **IMPORTANT FOR AGENTS:** `afterSave` and `afterDelete` are fire-and-forget — they run asynchronously and do not block the response. Errors in these hooks are logged but not returned to the client.

**Example — masking PII for non-admin users:**

```typescript
const hooks: BackendHooks = {
  data: {
    afterRead(slug, entity, ctx) {
      if (!ctx.requestUser?.roles.includes("admin") && entity.email) {
        return { ...entity, email: "***" };
      }
      return entity;
    },
    beforeSave(slug, values, entityId, ctx) {
      // Add audit trail
      return { ...values, updatedBy: ctx.requestUser?.userId };
    }
  }
};
```

## REST API Examples

### List with filtering, sorting, and pagination

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/products?status=eq.active&price=gte.50&orderBy=createdAt:desc&limit=10&offset=0&include=category"
```

### Create a entity

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "New Widget", "price": 19.99, "status": "draft"}' \
  "https://example.com/api/data/products"
```

### Update a entity

```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Widget", "price": 24.99, "status": "active"}' \
  "https://example.com/api/data/products/uuid-123"
```

### Delete a entity

```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/products/uuid-123"
```

### Count with filters

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/products/count?status=eq.active"
```

### Aggregates

`count`, `sum`, `avg`, `min` and `max` over the rows a filter selects, without
fetching them. Takes the same filters as the list endpoint.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/orders/aggregate?select=count(),sum(total)&status=eq.paid"
```

```json
{ "data": [{ "count": 96, "sum_total": 31200 }] }
```

Add `groupBy` for one row per value:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/orders/aggregate?select=count(),sum(total)&groupBy=status"
```

Results are keyed by function and field — `count()` becomes `count`,
`sum(total)` becomes `sum_total`.

**Row-level security applies to the rows being aggregated.** An aggregate is an
efficient way to learn about rows you cannot read, so it runs under the caller's
own policies: someone who can select nothing counts nothing. A driver that does
not implement aggregates answers **501** rather than an empty result — a
dashboard should not be told "no matches" when the truth is "not supported".

### Logical OR filtering

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/products?or=(status.eq.active,status.eq.pending)"
```

### Subcollection listing

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://example.com/api/data/authors/111094/posts?orderBy=createdAt:desc&limit=5"
```

## GraphQL API

### Endpoint

```
POST /api/graphql
```

GraphQL is **enabled by default** (`enableGraphQL: true` in `ApiConfig`). In non-production environments, a GraphiQL IDE is also available at `/api/graphiql`.

### Auto-Generated Schema

For each collection, Rebase generates the following GraphQL types and operations:

**Types:**
- `{TypeName}` — Entity output type (e.g., `Product`, `BlogPost`)
- `{TypeName}Input` — Input type for create/update mutations

The type name is derived from `collection.singularName` (spaces removed) or by removing the last character of `collection.name`.

**Queries:**

| Query | Arguments | Returns | Description |
|-------|-----------|---------|-------------|
| `{typeName}` (lowercase) | `id: String!` | `{TypeName}` | Get single entity |
| `{collection.slug}` | `limit: Int = 20`, `offset: Int = 0`, `where: String`, `orderBy: String` | `[{TypeName}]` | List entities |

**Mutations:**

| Mutation | Arguments | Returns | Description |
|----------|-----------|---------|-------------|
| `create{TypeName}` | `input: {TypeName}Input!` | `{TypeName}` | Create entity |
| `update{TypeName}` | `id: String!`, `input: {TypeName}Input!` | `{TypeName}` | Update entity |
| `delete{TypeName}` | `id: String!` | `Boolean` | Delete entity (returns `true`/`false`) |

### GraphQL Type Mapping

| Rebase Property Type | GraphQL Type |
|---------------------|--------------|
| `string` | `String` |
| `binary` | `String` |
| `number` | `Float` |
| `boolean` | `Boolean` |
| `date` | `String` |
| `array` | `[String]` |
| `vector` | `[Float]` |
| All others | `String` |

Fields with `validation.required` are wrapped in `GraphQLNonNull`.

### GraphQL Query Examples

**List products with filters:**

```graphql
query {
  products(
    limit: 10,
    offset: 0,
    where: "{\"status\":[\"==\",\"active\"]}",
    orderBy: "createdAt"
  ) {
    id
    name
    price
    status
    createdAt
  }
}
```

> **IMPORTANT FOR AGENTS:** The `where` argument is a JSON **string**, not an object. It must be a valid JSON object where keys are field names and values are `[operator, value]` tuples. The `orderBy` argument is a plain field name string.

**Get single product:**

```graphql
query {
  product(id: "uuid-123") {
    id
    name
    price
    category
  }
}
```

**Create product:**

```graphql
mutation {
  createProduct(input: {
    name: "New Widget",
    price: 19.99,
    status: "draft"
  }) {
    id
    name
    price
  }
}
```

**Update product:**

```graphql
mutation {
  updateProduct(id: "uuid-123", input: {
    name: "Updated Widget",
    price: 24.99
  }) {
    id
    name
    price
  }
}
```

**Delete product:**

```graphql
mutation {
  deleteProduct(id: "uuid-123")
}
```

## OpenAPI / Swagger

### OpenAPI 3.0.3 Spec

Available at `GET /api/docs`. Returns a JSON OpenAPI specification that mirrors the REST API exactly.

The spec includes:
- All collection CRUD routes with parameters and schemas
- PostgREST-style filter parameters per field
- Subcollection routes for relations
- Component schemas for each collection (output and input)
- `PaginationMeta` and `ErrorResponse` component schemas
- Security schemes (`bearerAuth` and `queryToken`) when auth is enabled
- Proper `201` for POST and `204` for DELETE

### Swagger UI

Available at `GET /api/swagger` in non-production environments. Renders an interactive Swagger UI that loads the spec from `/api/docs`.

## Metadata Endpoints

### Health Check (RebaseApiServer only)

```
GET /api/health
```

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "collections": ["products", "users", "orders"],
  "driver": "postgres"
}
```

### Collections Metadata (RebaseApiServer only)

```
GET /api/collections
```

```json
{
  "data": [
    {
      "slug": "products",
      "name": "Products",
      "singularName": "Product",
      "description": "Product catalog",
      "properties": ["name", "price", "status", "createdAt"],
      "relations": [
        {
          "relationName": "category",
          "target": "categories",
          "cardinality": "many_to_one",
          "direction": "outbound"
        }
      ]
    }
  ]
}
```

## Server Configuration (ApiConfig)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `"/api"` | Base path for all API routes |
| `enableGraphQL` | `boolean` | `true` | Enable GraphQL endpoint |
| `enableREST` | `boolean` | `true` | Enable REST CRUD endpoints |
| `requireAuth` | `boolean` | `true` | Require authentication for API endpoints |
| `pagination.defaultLimit` | `number` | `20` | Default page size |
| `pagination.maxLimit` | `number` | `100` | Maximum allowed page size |
| `cors.origin` | `string \| string[] \| boolean` | — | CORS origin configuration |
| `cors.credentials` | `boolean` | `false` | Allow credentials in CORS |
| `collections` | `CollectionConfig[]` | `[]` | Collections to generate APIs for |
| `collectionsDir` | `string` | — | Directory to auto-discover collections |

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **REST API Generator:** `packages/server/src/api/rest/api-generator.ts`
- **Query Parser:** `packages/server/src/api/rest/query-parser.ts`
- **GraphQL Generator:** `packages/server/src/api/graphql/graphql-schema-generator.ts`
- **OpenAPI Generator:** `packages/server/src/api/openapi-generator.ts`
- **Error Handling:** `packages/server/src/api/errors.ts`
- **Server Setup:** `packages/server/src/api/server.ts`
- **API Types:** `packages/server/src/api/types.ts`
- **Auth Middleware:** `packages/server/src/auth/middleware.ts`
- **DataHooks Types:** `packages/types/src/types/backend_hooks.ts`
