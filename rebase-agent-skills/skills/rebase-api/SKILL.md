---
name: rebase-api
description: Guide for working with Rebase's auto-generated REST API. Use this skill when the user needs to understand the API endpoints, query parameters, filtering, sorting, or pagination.
---

# Rebase Auto-Generated APIs

> **WARNING FOR AGENTS**: If you are writing a script or data task, **default to using the Rebase SDK** (`@rebasepro/client` or `@rebasepro/server`) instead of making raw REST API calls (`fetch` / `curl`). For custom backend functions, use `client.functions.invoke('function-name', payload)` — **NEVER** manually construct `/api/functions/` URLs or extract tokens from localStorage. Only use raw API calls if specifically instructed to do so or if you are demonstrating HTTP usage to the user.

Every collection defined in Rebase automatically gets full REST CRUD endpoints. No manual route creation needed.

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
| `/api/health` | Health check |
| `/api/meta/contract` | Collection contract, for remote SDK generation (admin / service-key / admin API-key gated) |
| `/api/meta/schema-version` | The schema hash this backend was built from (unauthenticated) |

### CRUD Operations

> **IMPORTANT FOR AGENTS:** Updates use `PATCH` — a partial write, only the properties you send. There is no `PUT`; it was an alias for the same handler and has been removed. `POST` returns `201`, `DELETE` returns `204` (empty body).

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| `GET` | `/api/data/{slug}` | List entities (with filtering, sorting, pagination) | `200` |
| `GET` | `/api/data/{slug}/count` | Count matching entities (with optional filters) | `200` |
| `GET` | `/api/data/{slug}/aggregate` | Aggregate over matching entities | `200` |
| `GET` | `/api/data/{slug}/:id` | Get a single entity by ID | `200` |
| `POST` | `/api/data/{slug}` | Create a new entity | `201` |
| `PATCH` | `/api/data/{slug}/:id` | Update a entity — partial, only what you send | `200` |
| `DELETE` | `/api/data/{slug}/:id` | Delete a entity | `204` |

### Subcollection Routes

For collections with relations, Rebase generates nested routes automatically. The URL pattern is `/{parent}/{parentId}/{child}`, and it supports arbitrarily deep nesting (parent/id/child/id/grandchild):

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| `GET` | `/api/data/{parent}/{parentId}/{child}` | List child entities | `200` |
| `GET` | `/api/data/{parent}/{parentId}/{child}/count` | Count child entities | `200` |
| `GET` | `/api/data/{parent}/{parentId}/{child}/:id` | Get a single child entity | `200` |
| `POST` | `/api/data/{parent}/{parentId}/{child}` | Create a child entity | `201` |
| `PATCH` | `/api/data/{parent}/{parentId}/{child}/:id` | Update a child entity | `200` |
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

### Update Response (PATCH — 200)

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

## Global callbacks

<!-- docs-verify: ignore -->

There is no `hooks.data` block and no `BackendHooks` type. Cross-cutting logic
that applies to **every** collection is configured with the top-level
`callbacks` key, whose shape is exactly a collection's own `CollectionCallbacks`
— one concept, one signature, applied at two scopes.

```typescript no-verify
await initializeRebaseBackend({
    // ...
    callbacks: {
        afterRead({ row, context }) {
            if (!context.user?.roles?.includes("admin") && row.email) {
                return { ...row, email: "***" };
            }
            return row;
        },
        beforeSave({ values, context }) {
            return { ...values, updatedBy: context.user?.uid };
        }
    }
});
```

| Callback | Trigger | Can modify? | Can abort? |
|----------|---------|-------------|------------|
| `afterRead({ row, context, … })` | Every read | Return the transformed row | No |
| `beforeSave({ values, status, context, … })` | Before every write | Return modified values | Throw → 400 |
| `afterSave({ id, values, context, … })` | After a successful write | No | No |
| `afterSaveError({ values, context, … })` | After a failed write | No | No |
| `beforeDelete({ row, id, context, … })` | Before every delete | No | Return `false` or throw |
| `afterDelete({ row, id, context, … })` | After a delete | No | No |

Every callback takes **one props object**, not positional arguments. Common
fields: `collection`, `path`, `row`, `id`, `values`, `previousValues`, `status`
(`"new" | "existing"`) and `context`. `context.user` carries `uid` and `roles`,
or is `undefined` for a public request.

> **IMPORTANT FOR AGENTS:** these are not an API-boundary interceptor. They live
> in the driver, so they fire on *every* data path — REST, WebSocket/realtime and
> server-side `rebase.dataAsAdmin` — which is what makes `afterRead` safe to rely
> on for redaction. The global callback runs first, then the collection's own.

See the **rebase-security** skill for using them as the authorization layer, and
`packages/types/src/types/entity_callbacks.ts` for the types.

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
curl -X PATCH \
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

### Health Check

```
GET /health        # what an orchestrator probes
GET /api/health    # the same answer, under basePath
```

```json
{
  "status": "ok",
  "latencyMs": 3
}
```

`status` is `"ok"` with HTTP 200, or `"degraded"` with HTTP **503**. A `details` object is included when the driver supplies one, and a `dataSources` array lists any secondary source that failed its probe.

Both paths are registered by the bundle boot path (`packages/server/src/boot/boot.ts`), not by `initializeRebaseBackend` — an orchestrator probes `/health`, so it cannot live under `basePath` alone.

`GET /livez` answers `{ "status": "ok" }` without touching the database. Use `/livez` for liveness and `/health` for readiness: a database blip should not make an orchestrator kill an otherwise healthy process.

### Collection Contract

There is no `GET /api/collections`. The equivalent is the contract endpoint, which is what a remotely generated SDK is built from:

```
GET /api/meta/contract
```

Gated — admin, a service key, or an admin API key.

```json
{
  "schemaVersion": "a1b2c3…",
  "runtime": { "version": "0.16.0", "contract": 1 },
  "collections": [ "…serialized collections, client-safe fields only…" ],
  "collectionSlugs": ["orders", "products", "users"],
  "generatedAt": "2026-08-21T10:30:00.000Z"
}
```

```
GET /api/meta/schema-version
```

Unauthenticated and deliberately tiny — `{ "schemaVersion": "a1b2c3…" }`. Use it in CI to tell whether a generated SDK is stale without holding admin credentials. Both responses also carry the value in an `x-rebase-schema` header.


## Server Configuration (RebaseBackendConfig)

The backend is configured by the object passed to `initializeRebaseBackend(config)`. The type is **`RebaseBackendConfig`**, defined in `packages/server/src/init.ts`. There is no `ApiConfig` type.

> A scaffolded project does not build this object itself. `rebase dev` and the published runtime boot from the bundle: collections and `storageAuthorize` come from `config/index.ts`, and everything else from environment variables. Pass this object directly only when embedding Rebase in a server you own.

### Required

| Option | Type | Description |
|--------|------|-------------|
| `server` | `Server` | Node HTTP server — used for the WebSocket upgrade and graceful shutdown |
| `app` | `Hono<HonoEnv>` | The Hono app the routes are mounted onto |

### Collections and routing

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `AnyCollectionConfig[]` | — | Collections to serve |
| `collectionsDir` | `string` | — | Directory to auto-discover collections from |
| `basePath` | `string` | `"/api"` | Prefix for every API route |
| ~~`dataSources`~~ | — | — | **Removed.** Declared with `database("<key>")` in `config/resources.ts`; the backend reads the declarations and refuses this key at boot |
| `surfaces` | `RuntimeSurfaceOptions` | all | Which HTTP surfaces this process mounts. Omit to mount everything |
| `ownership` | `RuntimeOwnershipOptions` | all | Which background singletons this process runs (cron scheduler, job worker) |
| `provisionSchema` | `boolean` | `true` | Whether this process creates the collection schema and its RLS policies at boot. `false` on every process but one in a split deployment |

### Database and authentication

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `database` | `DatabaseAdapter` | — | Takes precedence over `bootstrappers` |
| `bootstrappers` | `BackendBootstrapper[]` | — | Used when no `database` adapter is given |
| `auth` | `RebaseAuthConfig \| AuthAdapter` | — | **`requireAuth`, `jwtSecret`, `serviceKey`, `allowRegistration`, OAuth providers and `email` all live inside this object**, not at the top level |
| `baas` | `BaasOptions` | — | `unprotectedTables: "exclude" \| "serve"` — what to do with introspected tables that have RLS disabled |

### Storage

| Option | Type | Description |
|--------|------|-------------|
| `storage` | `BackendStorageConfig \| StorageController \| Record<string, …>` | One backend, or a map of them for multi-bucket setups |
| ~~`storageSources`~~ | — | **Removed.** Declared with `bucket("<key>")` in `config/resources.ts` |
| `storageAuthorize` | `StorageAuthorize` | Per-object access control. **In production, storage refuses to boot unless this, `storagePublicRead`, or `storageInsecureAllowAnyAuthenticated` is set** |
| `storagePublicRead` | `boolean` | Unauthenticated reads. Writes, deletes and listing still require auth |
| `storageInsecureAllowAnyAuthenticated` | `boolean` | Opts out of the boot guard: any signed-in user may touch any key. Single-tenant only |

### Functions, cron and jobs

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `functionsDir` | `string` | — | Directory of custom functions |
| `functionsTimeoutMs` | `number` | `30000` | Per-request ceiling for `/api/functions/*`. `0` disables it; a timeout answers 504 |
| `functionsSelection` | `FunctionSelection` | — | Serve only some of the bundle's functions. An unknown name fails the boot |
| `functionsUpstream` | `string` | — | Forward `/api/functions/*` elsewhere. Only consulted when the `functions` surface is off |
| `cronsDir` | `string` | — | Directory of cron definitions |
| `cronPersistence` | `boolean` | `true` | Persist cron execution logs to the database |
| `jobs` | `JobQueueOptions` | off | The durable job queue. Requires `enabled: true` and a driver that can run SQL |

### Request handling

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rateLimit` | `DataRateLimitConfig` | on, loose | Per caller: API key by id, user by uid, everyone else by IP. In-process counts unless you supply a `store` |
| `maxBodySize` | `number` | 10 MB | `0` disables it. Storage uploads use the storage config's `maxFileSize` instead |
| `compression` | `boolean` | `true` | Set `false` when a proxy already compresses |
| `csrf` | `{ origin }` | off | Opt-in. Off by default because mobile apps, cross-origin SPAs and CLIs consume the same API |
| `corsHandled` | `boolean` | `false` | Declares that the app installs its own CORS middleware, suppressing the "no CORS configuration detected" warning |

**CORS itself is not a config key.** It is set from the `CORS_ORIGINS` and `FRONTEND_URL` environment variables, and a production boot fails if neither is set.

### Everything else

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `callbacks` | `CollectionCallbacks` | — | Global lifecycle callbacks, run before per-collection ones on every data path |
| `history` | `HistoryConfig` | off | `true`, or `{ retention }` in days |
| `logging` | `{ level }` | — | `"error" \| "warn" \| "info" \| "debug"` |
| `enableSwagger` | `boolean` | dev only | Swagger UI at `/api/swagger` |
| `schemaEditor` | `boolean` | see note | Defaults to on when `collectionsDir` is set, outside production, in `cms` mode. Always `false` on a bundle boot |
| `schemaVersion` | `string` | computed | The version this deployment serves, as recorded at build time |
| `runtimeVersion` | `string` | — | Reported by the contract endpoint. Informational |

### Pagination is not configurable

There is no `pagination` option. List bounds are constants in `@rebasepro/types`:

| Constant | Value | Meaning |
|----------|-------|---------|
| `DEFAULT_LIST_LIMIT` | `50` | Page size when the client sends no `?limit` |
| `MAX_LIST_LIMIT` | `1000` | Largest `?limit` a client may ask for |
| `DEFAULT_VECTOR_LIST_LIMIT` | `10` | Default for a vector search |

A `?limit` above the maximum is a **400, not a clamp** — the request is rejected rather than quietly returning fewer rows than asked for.


## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **REST API Generator:** `packages/server/src/api/rest/api-generator.ts`
- **Query Parser:** `packages/server/src/api/rest/query-parser.ts`
- **OpenAPI Generator:** `packages/server/src/api/openapi-generator.ts`
- **Error Handling:** `packages/server/src/api/errors.ts`
- **Server Setup / config type:** `packages/server/src/init.ts`
- **Bundle boot (health, CORS, static apps):** `packages/server/src/boot/boot.ts`
- **API Types:** `packages/server/src/api/types.ts`
- **Auth Middleware:** `packages/server/src/auth/middleware.ts`
- **Callback Types:** `packages/types/src/types/entity_callbacks.ts`
