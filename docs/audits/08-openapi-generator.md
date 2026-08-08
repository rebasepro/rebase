# Unit 8 — the OpenAPI generator

Read-only audit, 2026-08-08. Scope: `packages/server/src/api/openapi-generator.ts`
checked against `packages/server/src/api/rest/api-generator.ts`,
`packages/server/src/api/rest/query-parser.ts`,
`packages/server/src/api/rest/write-validation.ts`, `packages/server/src/init.ts`,
`packages/server/src/init/docs.ts`, and the auth/storage/functions/cron/history
route files under `packages/server/src`.

## Verdict

The generator is *structurally* clean — it builds a plain object and lets
`JSON.stringify` escape it, which is why the 2026-08-08 generator sweep
(`docs/bug-classes.md`, class 35) recorded it as needing nothing. That verdict was
about injection, not about truth, and truth is where it fails. The emitted document
describes the `/data/*` family and nothing else: `GET /data/{slug}/count` is served
and undocumented, every nested write verb is served and undocumented, and the entire
auth, storage, functions, cron, api-keys and history surface — roughly forty routes —
is absent. In the other direction the spec over-promises: it declares a `?token=`
query security scheme that the data middleware refuses by design and that the query
parser will turn into a 400; it publishes CRUD paths for collections whose data source
has no server transport, which `init.ts` deliberately does not route; and — the one
finding I would fix today — it publishes every `excludeFromApi` column, including the
scaffolded `users` collection's `passwordHash` and `emailVerificationToken`, in the
read schema, both write schemas and the filter parameters, on an endpoint that carries
no auth middleware at all. Nothing validates the document as OpenAPI anywhere in CI;
the three jest tests that exist (`openapi-relations`, `openapi-parameter-fidelity`,
`openapi-update-contract`) each pin one previously-fixed defect and assert nothing
about the surface as a whole. It is consumed by the Studio API Explorer and by Swagger
UI, so drift ships silently to the two places a developer is most likely to trust.

Counts: 3 high, 10 medium, 11 low.

---

## HIGH

### H1. `excludeFromApi` columns are published — schema, input, update and filters — on an unauthenticated endpoint

`packages/server/src/api/openapi-generator.ts:642` (read schema),
`:729` (input schema), `:964` (filter parameters);
`packages/server/src/init/docs.ts:19`;
`packages/server-postgres/src/services/row-pipeline.ts:96-116`;
`packages/cli/templates/template/config/collections/users.ts:67,87`.

`buildCollectionSchema`, `buildCollectionInputSchema` and `buildFilterParameters`
iterate `Object.entries(collection.properties)` and skip exactly one thing —
`property.type === "relation"`. Nothing consults `excludeFromApi`, whose contract
(`packages/types/src/types/properties.ts:220-232`) is *"stripped from every row the
API serves, for every caller, including admins and service keys"*, enforced in
`stripExcluded`.

`app.get(`${basePath}/docs`, …)` is registered on `config.app`, not on the
`dataRouter`. The only middleware matching `${basePath}/*` is requestId,
compression, bodyLimit, csrf and logging (`packages/server/src/init/middlewares.ts:35-93`);
the auth middleware is scoped to `${basePath}/data` (`init.ts:1408-1420`). The Studio
already knows this — `ApiExplorer.tsx:47` says *"The spec endpoint itself is public on
a stock backend"*.

**Failure scenario.** `curl https://app.example.com/api/docs | jq '.components.schemas.User'`
on any project scaffolded by `rebase init` returns
`passwordHash: {type: "string", description: "Password Hash"}` and
`emailVerificationToken`, both listed as writable in `UserInput`/`UserUpdate` and both
offered as `?passwordHash=eq.…` filter parameters. No token needed. The values never
come back — `stripExcluded` holds — but the existence, the exact property name and the
suggestion that they are readable and filterable are disclosed to anyone, and a
generated client will emit a `passwordHash` field on its `User` model that is silently
always `undefined`. This is the same defect the class-35 sweep found in the SDK
generator (*"`excludeFromApi` columns typed as readable (the scaffolded `users`
collection says its own password hash comes back)"*) surviving in the sibling
generator.

**Fix direction.** Skip `property.excludeFromApi` in all three builders — the read
schema unconditionally, the input/update schemas unless there is a reason to keep them
writable (there is not: they are server-written), and the filter parameters, since a
filter on a column you cannot read is an oracle. Add a test that feeds the template
`users.ts` through the generator and asserts neither name appears anywhere in
`JSON.stringify(spec)`.

### H2. The `queryToken` security scheme does not exist on any route it is declared for

`packages/server/src/api/openapi-generator.ts:202-212`;
`packages/server/src/auth/middleware.ts:76-93` and `:316`;
`packages/server/src/auth/adapter-middleware.ts:59`;
`packages/server/src/api/rest/query-parser.ts:247`.

The generator declares a global `security: [{bearerAuth: []}, {queryToken: []}]` with
`queryToken` an `apiKey` in `query` named `token`, described as *"Alternative: pass the
JWT or service key as a `token` query parameter."* Global security applies to every
operation in the document.

The data routes do not accept it. `createAuthMiddleware` reads
`extractBearerToken(c.req.header("authorization"))` and nothing else
(`middleware.ts:316`); `createAdapterAuthMiddleware` likewise (`adapter-middleware.ts:59`).
`requireAuth`'s own docstring is explicit: *"Query-string tokens (`?token=`) are
intentionally NOT accepted here because URLs leak into access logs, proxies, Referer
headers, and browser history"*. `queryTokenAuth` — the middleware that does accept it —
is imported in exactly one place, `packages/server/src/storage/routes.ts:17`, for
`<img src>` file serving.

**Failure scenario.** A caller follows the published scheme:
`GET /api/data/posts?token=eyJ…`. Two things go wrong at once. The request is
unauthenticated, so on a `requireAuth` backend it is a 401 — and `token` is not in
`reservedQueryKeys` (`query-parser.ts:247`), so the parser hands it to
`deserializeFilter` as a filter on a column named `token`, which is a 400
`UNKNOWN_FILTER_FIELD` on any collection that has no such column. The developer gets a
400 complaining about a field they never meant to filter on, from a parameter the
server's own spec told them to send. Worse on a `requireAuth: false` backend, where the
401 does not fire and the caller believes the token was honoured. The scheme also
actively teaches the practice the middleware's docstring exists to prevent.

**Fix direction.** Delete the `queryToken` scheme and the second entry in `security`.
If storage routes are ever added to the spec, declare it there, per-operation.

### H3. Collections without a server transport get full CRUD paths that are never routed

`packages/server/src/init.ts:1443-1452` vs `:1460`;
`packages/server/src/api/openapi-generator.ts:220`.

The router is built from a filtered list:

```ts
const serverCollections = activeCollections.filter(
    (collection) => resolveDataSource(collection, dataSourceRegistry).transport === "server"
);
```

with the comment *"Collections on a direct/custom transport are client-only — the
backend must not expose a (mis-engined) endpoint for them."* Eight lines later the spec
is generated from the **unfiltered** `activeCollections`.

**Failure scenario.** A project with a Firestore-backed collection
(`transport: "direct"`, `packages/types/src/types/data_source.ts:113-123`) publishes
`/data/orders`, `/data/orders/{id}`, `/data/orders/bulk`, `/data/orders/bulk/delete`
and the nested listings in `/api/docs`. Every one 404s. The API Explorer lists them
with a Try-It button; a generated client compiles a full `OrdersApi` class whose every
method fails at runtime. The one collection the backend deliberately refuses to expose
is the one the document advertises hardest.

**Fix direction.** Pass the same filtered list to `mountOpenApiDocs`, or move the
filter inside it. `mountOpenApiDocs` should take `serverCollections`.

---

## MEDIUM

### M1. `GET /data/{slug}/count` is served and absent from the spec

`packages/server/src/api/rest/api-generator.ts:188-197` (root) and `:817-833` (nested);
absent from `openapi-generator.ts`.

Both count routes honour the full filter set (`where`, per-field, `or`/`and`,
`searchString`) and answer `{ count: number }`. Neither appears in the document. The
handwritten docs *do* list it (`website/src/content/docs/docs/backend/api.md:24`), which
is the tell: the surface is known, the generator simply never grew a case for it.

**Failure scenario.** A generated client has no way to ask for a total without fetching
a page. The nested `/count` — which also forwards `logical`, per the comment at
`api-generator.ts:826-830` — is doubly invisible.

**Fix direction.** Emit `/data/{slug}/count` and `/data/{slug}/{parentId}/{rel}/count`
with `listQueryParameters()` minus `limit`/`offset`/`page`/`orderBy`/`fields`, and a
`{count: integer}` response.

### M2. Every nested write verb, and the nested single-entity read, are undocumented

`packages/server/src/api/rest/api-generator.ts:834-856` (nested GET by id), `:913-940`
(POST), `:944-976` (PATCH/PUT), `:979-1011` (DELETE); `openapi-generator.ts:568-624`
emits only `get` on the nested path.

The subcollection loop builds one operation — the list. The router serves
`GET /a/1/b/{id}`, `POST /a/1/b`, `PATCH|PUT /a/1/b/{id}` and `DELETE /a/1/b/{id}`, all
with write validation (`resolveNestedWriteCollection` + `assertKnownWriteFields`) and
field projection.

**Failure scenario.** `POST /api/data/authors/7/posts` is the idiomatic way to create a
child row; a client generated from the spec cannot express it, so callers fall back to
`POST /data/posts` with a manual FK — which is exactly the read/write shape confusion
recorded in the "Relation write shape != read shape" note.

**Fix direction.** Mirror the root entity operations onto the nested path, `$ref`-ing
the target's `Input`/`Update` schemas.

### M3. `id` is declared required on reads and offered on writes for collections that have no `id`

`packages/server/src/api/openapi-generator.ts:636-640` and `:746-749`;
`packages/server/src/api/rest/write-validation.ts:53-64`.

`buildCollectionSchema` seeds `properties.id` and `required = ["id"]` unconditionally.
`buildCollectionInputSchema` appends `properties.id = {type: "string", description:
"Optional: client-assigned ID. If omitted, the server generates one."}` unconditionally.
The server disagrees on both counts: rows are flat and carry only their columns (the
delete handlers at `api-generator.ts:726-737` and `:998-1006` exist precisely because
`existingEntity.id` is `undefined` on a table not keyed on `id`), and
`assertKnownWriteFields` has a dedicated error for the write case:

```
'sku_items' has no 'id' column — it is keyed on 'sku'. The `id` argument of
`create(data, id)` is written as an `id` column, so for this collection put the key
in `data` instead.
```

**Failure scenario.** A collection keyed on `sku` or on `user_id + role_id`. The spec
says every response object has a required `id`; responses have none, so a
spec-validating gateway rejects the server's own answers and a generated client's
non-nullable `id` field is always absent. In the other direction the spec invites
`POST {"id": "abc", …}`, which is a hard 400 `VALIDATION_UNKNOWN_FIELDS`.

**Fix direction.** Derive the key from `resolvePrimaryKeys(collection)` — the same
helper `projectResponseFields` uses at `write-validation.ts:142` — and emit the real
key column(s) as required; only offer `id` on input when the collection actually has an
`id` property.

### M4. belongsTo foreign-key columns are in every row and in no schema

`packages/server/src/api/openapi-generator.ts:642-646` and `:961-968`;
`packages/server/src/api/rest/write-validation.ts:39-41`.

`buildCollectionSchema`'s docstring claims *"All fields are included (including relation
foreign keys)"*. It is not true: the loop `continue`s on `type === "relation"` and never
looks at the resolved relations, so the local FK column an owning relation stores
(`author_id`) appears in neither the read schema, the input schemas, nor
`buildFilterParameters`. The write path explicitly allows it —
`assertKnownWriteFields` adds `(relation as ResolvedBelongsTo).localKey` to the known
set — and the read path returns it as an ordinary column.

**Failure scenario.** `?author_id=eq.5` is the canonical way to filter posts by author
and is not in the parameter list, so it is unreachable from a generated client and
absent from the API Explorer's form. A generated `Post` model has no `author_id`, so
round-tripping a fetched row through the typed model drops the association.

**Fix direction.** After the property loop, walk `resolveCollectionRelations(collection)`
and emit the `localKey` of each `belongsTo` as a scalar property plus a filter
parameter, unless a declared property already owns that name.

### M5. Property names colliding with reserved query keys produce duplicate parameters and advertise filters that cannot fire

`packages/server/src/api/openapi-generator.ts:961-984` vs
`packages/server/src/api/rest/query-parser.ts:247`.

`buildFilterParameters` emits one `in: "query"` parameter per non-relation,
non-map/array/geopoint property, with no awareness of the fourteen names
`listQueryParameters()` already occupies. The parser reserves exactly those names:

```ts
const reservedQueryKeys = ["limit", "offset", "page", "orderBy", "include", "fields",
  "searchString", "searchExplain", "vector_search", "vector", "vector_distance",
  "vector_threshold", "or", "and", "where"];
```

**Failure scenario.** A `plans` collection with a `limit` column, or an `embeddings`
collection with a `vector` column, or a form-builder `fields` column. Two things break.
The document becomes *invalid* OpenAPI — a parameter is identified by the pair
(`name`, `in`), and the same pair now appears twice on one operation; Swagger UI renders
a duplicate and several generators abort. And the second, filter-flavoured parameter can
never work: `?limit=gte.100` is consumed as pagination, so the column is simply
unfilterable while the spec documents how to filter it.

**Fix direction.** Detect the collision. Either skip the filter parameter and note in
the collection's description that the column is unfilterable over the wire, or — better —
give per-field filters a namespace the reserved list cannot reach.

### M6. The nested path segment is `relationName`; the router matches the resolved-relations map key

`packages/server/src/api/openapi-generator.ts:574-579` vs
`packages/common/src/util/relations.ts:50-64`,
`packages/common/src/util/resolve-relation.ts:45`,
`packages/server-postgres/src/services/nested-path.ts:71`,
`packages/server/src/api/rest/api-generator.ts:155`.

The generator's own comment claims *"These are the same resolved names the nested-path
router matches, so the spec and the routes cannot drift apart."* They can. A relation
declared in `collection.relations[]` is keyed by `resolved.relationName`, so the two
agree. A relation declared **inline on a property** is keyed by the *property key*:

```ts
relations[propertyKey] = resolveRelation(declared, collection, propertyKey);
```

while `relationName` resolves as `relation.relationName ?? propertyKey ?? snake(targetSlug)`.
When an inline relation spells out a `relationName` different from its property key, the
map key and the `relationName` diverge — and both the driver (`nested-path.ts:71`) and
`resolveNestedWriteCollection` (`api-generator.ts:155`) look up by map key via
`findRelation`, which only normalises `-`/`_`.

**Failure scenario.**

```ts
properties: {
  writtenPosts: { type: "relation",
    relation: { kind: "hasMany", relationName: "posts", target: () => posts } }
}
```

The spec documents `GET /data/authors/{parentId}/posts`; the route that works is
`/data/authors/{parentId}/writtenPosts`. `openapi-relations.test.ts` covers the two
cases where no name is spelled out and passes, which is why this survives.

**Fix direction.** Iterate `Object.entries(resolveCollectionRelations(collection))` and
build the path from the **key**, not from `relation.relationName`. Add a fixture with a
divergent inline `relationName`.

### M7. `toPascalCase` can return the empty string, and can collide

`packages/server/src/api/openapi-generator.ts:1025-1032`, used at `:221`, `:230-237`,
`:570`, and in every `operationId` and `$ref`.

```ts
str.replace(/[^a-zA-Z0-9]+/g, " ").split(" ").filter(Boolean)
   .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("")
```

Three problems. A name with no ASCII letters — `singularName: "Заказ"`, `"注文"`,
`"Pedido"` is fine but `"Артикул"` is not — reduces to `""`, so the component is stored
under `schemas[""]`, every `$ref` becomes `"#/components/schemas/"` (an unresolvable
pointer), and `operationId` becomes `"list"`. Two such collections overwrite each other.
Second, two collections whose singular names PascalCase identically (`blog_posts`
singular "Post" alongside `posts` singular "Post") silently share one component and one
set of `operationId`s — the second `schemas[schemaName] = …` wins and the first
collection's paths `$ref` the wrong shape. Third, `.toLowerCase()` on the tail mangles
acronyms: `"API Key"` → `ApiKey`.

**Failure scenario.** A non-English project (`docs` ships in six locales, so this is not
hypothetical) publishes a document where half the `$ref`s dangle. Swagger UI renders the
schema as empty; `openapi-generator-cli` fails resolution outright.

**Fix direction.** Fall back to `toPascalCase(collection.slug)` and then to a sanitised
slug when the result is empty, and keep a `Set` of assigned schema names with a numeric
suffix on collision — the same discipline `introspect-db-logic.ts` applies to relation
keys (class 13 sweep, 2026-08-03).

### M8. Nothing is nullable

`packages/server/src/api/openapi-generator.ts:761-941` — `nullable` appears nowhere in
the file.

A property without `validation.required` maps to a nullable column, and Postgres returns
`null` for it. OpenAPI 3.0.3 requires `nullable: true` for that; `type: "string"` alone
forbids null. `coerceDeclaredNumber` (`row-pipeline.ts:74-76`) even *produces* `null`
deliberately for an unparseable numeric.

**Failure scenario.** A spec-validating gateway rejects the server's own successful
responses for any row with a null column. Strongly-typed generated clients (Java, Rust,
Kotlin) deserialize into a non-optional field and throw. The class-35 sweep found the
same omission in the SDK generator (*"nullable columns typed as merely absent"*); this
is its sibling.

**Fix direction.** Emit `nullable: true` on any property not in `required`, on the read
schema at minimum.

### M9. The bulk routes' specific 400 description is overwritten by the generic one

`packages/server/src/api/openapi-generator.ts:314-324`.

```ts
const bulkErrors = {
    400: { description: "Malformed body, an unknown field, or more rows than the per-batch limit", … },
    409: { … },
    ...errorResponses(requireAuth)      // ← also defines 400
};
```

`errorResponses` returns `{400: {description: "Bad request"}, 500, 401, 403}`
(`:989-1013`), and the spread comes last, so the carefully written description — the one
that tells a caller the batch cap exists — is discarded. Class 20, "a value computed and
then discarded".

**Fix direction.** Spread `errorResponses(requireAuth)` first, then the specific codes.

### M10. `Idempotency-Key` and its 409 are documented only on the bulk routes, though the plain create honours both

`packages/server/src/api/rest/api-generator.ts:599-617` vs
`packages/server/src/api/openapi-generator.ts:272-295`.

`POST /data/{slug}` runs the same claim-before-write dance, replays on a repeat, and
throws `ApiError.conflict(…, "IDEMPOTENCY_KEY_IN_PROGRESS")` while one is in flight. The
spec attaches the `idempotencyHeader` parameter and the 409 response only to
`/bulk`, `/bulk` PATCH and `/bulk/delete`.

**Failure scenario.** A retrying client cannot discover the header for single creates —
the case where duplicate rows are most commonly reported — and a generated client has no
409 branch, so it surfaces the conflict as an unmapped error. Note the deliberate
asymmetry to preserve: the auth-signup branch (`api-generator.ts:556-593`) skips
idempotency on purpose, so the header should not be advertised on an auth collection.

**Fix direction.** Add the header parameter and the 409 to the root `post`, except for
collections with `auth` enabled.

---

## LOW

### L1. A `RegExp` `matches` becomes a `pattern` with the delimiters in it
`openapi-generator.ts:787-789`. `PropertyValidationSchema.matches` is
`string | RegExp` (`packages/types/src/types/properties.ts:777`), and the generator does
`base.pattern = String(sp.validation.matches)`. `/^[A-Z]{3}$/` stringifies to
`"/^[A-Z]{3}$/"` — a JSON Schema pattern that requires literal slashes, so it matches
nothing; with flags, `"/abc/i"`. Fix: `matches instanceof RegExp ? matches.source : matches`,
and drop or translate the flags.

### L2. Numeric-keyed enums land on string-typed schemas
`openapi-generator.ts:946-955`. `resolveEnumValues` converts any numeric-looking record
key to a `number`, regardless of the property's type. A `StringProperty` with
`enum: {0: "No", 1: "Yes"}` emits `{type: "string", enum: [0, 1]}` — enum values that
cannot validate against the declared type. Fix: coerce to the property's own type.

### L3. The documented default `limit` is wrong for a vector search
`openapi-generator.ts:50` states `default: DEFAULT_LIST_LIMIT` (50) unconditionally, but
`resolveClientListLimit` falls back to `DEFAULT_VECTOR_LIST_LIMIT` (10) when
`vectorSearch` is set (`packages/types/src/controllers/data_driver.ts:88-97`). A caller
following the spec expects 50 rows from a nearest-neighbour query and gets 10. Fix: say
so in the description.

### L4. `searchExplain` is accepted and undocumented
`api-generator.ts:205-209` reads `?searchExplain=true`; it is in `reservedQueryKeys`
(`query-parser.ts:247`) and in no parameter list. The generator documents the sibling
`searchString` in detail. Same class as the `or`/`and` omission that
`openapi-parameter-fidelity.test.ts` was written for — the test pinned the two
parameters that had been found, not the rule.

### L5. `_score` and `_distance` are described in prose and absent from the schemas
`openapi-generator.ts:100-137` tells the reader rows "carry a `_score`" and a
`_distance`, but `buildCollectionSchema` never adds them. Harmless under OpenAPI 3.0's
permissive `additionalProperties` default, invisible to a generated model.

### L6. 429 is never declared
`init.ts:1426-1429` mounts `createDataRateLimiter` on the whole data router when
`rateLimitConfig` is set; `errorResponses` (`openapi-generator.ts:989-1013`) lists 400,
500, 401, 403 only. A generated client has no branch for the one error it will meet
under load.

### L7. `geopoint` is documented and has no Postgres column
`openapi-generator.ts:846-853` emits `{latitude, longitude}` with both required.
`getDrizzleColumn` (`packages/server-postgres/src/schema/generate-drizzle-schema-logic.ts:110-345`)
has cases for string, number, boolean, date, map, array, vector, binary, relation and
reference — `geopoint` falls to `default: return null`, so no column is created. The spec
advertises a create field whose write reaches Postgres as a nonexistent column. The root
defect is in the driver, but the spec is what tells a developer to try.

### L8. `listLimits` is a parameter no caller passes
`openapi-generator.ts:18-28` carries a nine-line comment explaining why the bounds must
come from the REST layer rather than be hardcoded — and `init/docs.ts:20-23`, the only
production caller, passes only `basePath` and `requireAuth`. It happens to be harmless
today because `RestApiGenerator` is *also* constructed without limits
(`init.ts:1449-1452`) so both sides fall back to the same constants. The moment either
becomes configurable, the spec silently states the wrong ceiling — which is the exact
defect the option was added to fix. Class 21, "a declared extension point that nothing
reads".

### L9. The spec is rebuilt from scratch on every unauthenticated request
`init/docs.ts:19-25` calls `generateOpenApiSpec` inside the handler. For an introspected
BaaS project the collection count is the table count (the class-13 sweep exercised
MusicBrainz at 339 collections), and each request rebuilds three component schemas and
~14+N query parameters per path. Unauthenticated and uncached, that is free CPU for
anyone who wants it. Fix: build once at mount, or memoise on the collections array.

### L10. Nothing validates the document, in CI or anywhere else
`.github/workflows/ci.yml` delegates entirely to `verify.yml`, whose only relevant step
is `pnpm test` (line 231). The three jest suites under `packages/server/test/openapi-*`
do run there, but they assert single previously-broken facts — the `limit` bounds, the
presence of `or`/`and`, the nested parameter count, the `Update` schema's missing
`required`, three nested-path names. No dependency in the repo can parse an OpenAPI
document (`grep` for `swagger-parser`, `openapi`, `ajv` in any `package.json` returns
nothing). M5's duplicate parameters and M7's empty `$ref` are both *invalid OpenAPI* and
both would be caught by one `SwaggerParser.validate()` call over a fixture. Fix: add a
dev dependency and one test that validates the spec for a hostile fixture — non-ASCII
collection name, a property named `limit`, a key column that is not `id`.

### L11. Small consumer-side drift
`packages/studio/src/components/ApiExplorer/parseSpec.ts:24` does
`path.replace(/^\/api\/data/, "")`, but the generator emits paths as `/data/{slug}` with
`/api` living in `servers[0].url` (`openapi-generator.ts:149-154`), so the replace never
fires and the sidebar shows `/data/posts` where it means to show `/posts`. Separately,
`TryItPanel.tsx:113-114` filters parameters to `in: "path"` and `in: "query"` only, so
the `Idempotency-Key` header parameter is silently dropped from the Try-It form.
And `website/src/content/docs/docs/backend/api.md:263` claims the spec *"includes all
endpoints, query parameters, and response schemas"* — false on all three counts per M1,
M2, L4 and H1; six locales carry the same sentence.

---

## Checked and clean

- **No injection surface.** The generator builds a plain object and returns it;
  `c.json` serialises. No template assembly, no interpolation into names, literals or
  comments. The class-35 sweep's verdict holds and I confirmed it line by line.
- **Property-type coverage is total.** Every member of the `Property` union
  (`packages/types/src/types/properties.ts:50-61`) has a case in
  `convertPropertyToSchema`; the `default:` branch is unreachable.
- **PATCH/PUT semantics are honest.** `updateOperation` uses `<Name>Update`
  (`buildCollectionUpdateSchema`, which *derives* from the input schema by dropping
  `required` rather than rebuilding it), PUT is the same operation marked `deprecated`
  with a distinct `operationId`, and both match the merge the handler performs
  (`api-generator.ts:646-707`). `openapi-update-contract.test.ts` pins it.
- **Subcollection schemas resolve.** The second pass over collections runs after every
  component schema exists, so a subcollection whose target appears later in the array
  still `$ref`s the real shape rather than degrading to `{type: "object"}`
  (`openapi-generator.ts:550-624`).
- **To-one relations are correctly excluded from the nested listings.**
- **The error envelope matches.** `ErrorResponse` is `{error: {message, code, details?}}`
  with `message` and `code` required — exactly what `ApiError` and the Hono error handler
  emit (`packages/server/src/api/errors.ts:56-80`, `init.ts:1306-1330`).
- **Pagination meta matches.** `PaginationMeta`'s `{total, limit, offset, hasMore}` is
  byte-for-byte the object both the root and nested list handlers build
  (`api-generator.ts:244-249`, `:902-907`).
- **Property keys are the wire names.** The generated Drizzle table uses the property key
  as the JS key and `columnName`/`toSnakeCase` only for the SQL column
  (`generate-drizzle-schema-logic.ts:39-44`, `:110-113`, `:351`), so a property declaring
  `columnName: "email_verified"` under key `emailVerified` is returned as `emailVerified`
  — which is what the spec names. No drift here.
- **The `where`/per-field precedence claim is true.** The spec says the per-field
  parameter wins on the same field; `query-parser.ts:255-259` spreads
  `deserializeFilter(filterDict)` after `parseWhereParam`.
- **The bulk descriptions are accurate** about all-or-nothing semantics, the `{id, data}`
  shape, and why delete is a POST — all confirmed against `api-generator.ts:369-516`.
- **`enableSwagger === false` and the zero-collection case both short-circuit cleanly**,
  and Swagger UI is dev-only (`init/docs.ts:13`, `:27`).

## Open questions

1. **Is `/api/docs` meant to be public?** The Studio comment says it is *"public on a
   stock backend"*, and there is a defensible reading where the spec is the API's front
   door. But nothing in `boot/env.ts` or the docs says so deliberately, and H1 makes the
   answer matter. If the intent is public, `excludeFromApi` must be honoured; if the
   intent is authenticated, the endpoint needs the same middleware `${basePath}/data`
   gets.
2. **Should the spec cover anything beyond `/data`?** Auth, storage, functions, cron,
   api-keys, admin-users, MFA and magic-link are all stable HTTP surfaces with no
   machine-readable description at all — roughly forty routes. They are not
   collection-derived, so they would need a hand-maintained fragment merged in, which
   raises the class-34 question of who keeps it honest. Worth deciding explicitly rather
   than by omission.
3. **What is the intended relationship between the generator and `docs/backend/api.md`?**
   Today they are two independent descriptions of one surface that already disagree
   (`/count` in the prose and not the spec; H1's columns in the spec and not the prose).
   Either the prose should be generated from the spec, or `verify:docs` should diff them.
4. **Is `requireAuth` really a per-document constant?** It is resolved once from
   `config.auth` and applied as global security, but access is genuinely per-collection
   and per-row through RLS. A public-read collection currently claims to require a bearer
   token. I did not chase whether a per-collection override exists — UNCONFIRMED.
5. **Does anything outside this repo generate a client from `/api/docs`?** The two
   in-repo consumers (Studio API Explorer, Swagger UI) are forgiving; a strict generator
   is what turns M5 and M7 from cosmetic into fatal. The severity of several findings
   above depends on that answer.
