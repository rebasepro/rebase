# Unit 7 — Full-text search and vector search

Read-only audit, 2026-08-08. Scope: `packages/server-postgres/src/schema/search-column.ts`, the
`searchString` / `vector_search` path through `packages/server/src/api/rest/query-parser.ts` and
`api-generator.ts`, `DrizzleConditionBuilder`'s search and vector builders, `FetchService`'s four
search call sites, the realtime search/vector path, and the client/admin ends.

## Verdict

The declared-`search` machinery is the strongest part of this subsystem: the spec is computed in one
place, the immutability constraints are correctly understood and worked around, the query is
parameterised everywhere it matters (`websearch_to_tsquery($1, $2)`), ranking uses the same tsquery
the rows were matched with, and RLS applies because search rides the same request-scoped read
transaction as every other read. The problems are all at the *edges* of that core. Three are serious:
every REST search or vector read silently discards the `?or=`/`?and=` group (the exact bug the route
layer fixed one hop earlier, still live one hop down); the un-opted-in `ILIKE` default interpolates
the user's search string straight into the LIKE pattern, so `%` and `_` are attacker-controlled
wildcards over an unindexed sequential scan; and a `search` block that *changes* after the generated
column exists is never applied — every writer of that column is `ADD COLUMN IF NOT EXISTS` and
nothing checks the stored expression. Vector search is the weaker half throughout: no
`CREATE EXTENSION vector` is emitted anywhere in the OSS pipeline, no ANN index is ever created, the
property name is an unvalidated key into the drizzle table object, and a `.vectorSearch(...).listen()`
subscription silently degrades to an ordinary listing.

Counts: 3 high, 6 medium, 5 low.

---

## High

### H1. Every search / vector-search read drops the `or`/`and` group

`packages/server-postgres/src/services/FetchService.ts:1452-1530` (the options type at `:1452-1465`
has no `logical`; the body never applies one), reached from
`packages/server-postgres/src/services/FetchService.ts:1258,1290`.

`fetchCollectionForRest` takes the `db.query` primary path only when there is **no** `searchString`
and **no** `vectorSearch` (`:1258`). Every search request therefore falls through to
`fetchRowsWithConditionsRaw`, which applies `relatedTo`, `searchString`, `filter` and the vector
threshold — and nothing else. `options.logical` is present on the object at runtime (it is passed
whole at `:1290`) and is simply never read.

The route above it already knows this is a bug class: `packages/server/src/api/rest/api-generator.ts:220-222`
carries the comment "`?or=`/`?and=` were parsed and then dropped right here, so a filtered read
returned every row RLS allowed." The fix landed at the route and not in this fallback.

Failure scenario: `GET /api/data/talents?searchString=auditor&or=(status.eq.published,owner_id.eq.me)`
returns every row matching "auditor" that RLS allows, ignoring the disjunction the caller wrote. The
count on the same response *does* apply it (`FetchService.ts:1137-1142`), so `meta.total` describes a
smaller set than `data` — `hasMore` goes negative-ish and pagination lies. The same hole applies to
`?vector_search=`.

Fix direction: declare `logical?: LogicalCondition` on `fetchRowsWithConditionsRaw`'s options and
push `buildLogicalConditions(...)` into `allConditions`, exactly as `fetchRowsWithConditions`
(`:866-869`) already does. A regression test asserting `search + or` narrows would pin it.

### H2. The default `ILIKE` search interpolates the user's string into the LIKE pattern

`packages/server-postgres/src/utils/drizzle-conditions.ts:1330` —
`searchConditions.push(ilike(fieldColumn, \`%${searchString}%\`))`. There is no LIKE-escape helper
anywhere in the server packages (grepped: this is the only `ilike(` call site, and no
`escapeLike`-style function exists).

The value is a bind parameter, so this is not SQL injection. It is two other things:

1. **Wildcard injection.** `%` and `_` in a user's query are LIKE metacharacters. Searching for
   `50%` returns everything; searching for `a_c` matches `abc`. The user gets results they cannot
   explain and there is no way to search for a literal `%`.
2. **Pathological patterns.** Postgres's `MatchText` is a backtracking matcher: each `%` recurses
   over every remaining offset. A caller controls the whole interior of the pattern, so
   `?searchString=a%25a%25a%25a%25a%25a%25a%25a%25b` produces `%a%a%a%…%b%`, whose cost is
   polynomial with an attacker-chosen exponent — evaluated per row, OR-ed across *every* string
   property of the collection, on a sequential scan (a leading `%` cannot use an index), with the
   default page size of 50 doing nothing to bound the work because the scan happens before the
   limit.

This is the server-side twin of the bug `packages/client/src/like-pattern-redos.test.ts` was written
for: that test hardened the offline evaluator against exactly this pattern shape ("the same
translation in the Mongo driver hands the expression to the database, where it occupies a server
thread instead"), and the Postgres driver was never given the same treatment.

Fix direction: escape `%`, `_` and the escape character in `searchString` before wrapping it in
`%…%`, and collapse runs of the user's own wildcards if they are to be honoured at all. The client's
`matchesOperator` already documents the collapse rule, so the two ends can share the semantics.

### H3. A `search` block that changes is never applied to an existing table

Both writers of the generated column are additive only:

- boot ensure: `packages/server-postgres/src/schema/ensure-collection-tables.ts:427-435` calls
  `addColumn(...)`, and `addColumn` (`:334-348`) returns early when the column name is already
  present, so the *expression* is never compared;
- the generated SQL file: `packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:321-323`
  emits `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, a no-op against an existing column.

Nothing anywhere reads `information_schema.columns.generation_expression` or `pg_attribute.attgenerated`
to detect drift (grepped: the only `is_generated` reads are in introspection, which classifies a
column as generated but never compares its body). `doctor.ts` has no search check at all.

Failure scenario: a collection ships with `fields: ["full_name"]`; three months later the author adds
`"questionnaire.certifications"`, flips `unaccent: true`, or raises `full_name` from `B` to `A`. Boot
logs nothing, `db push` plans nothing, `rebase db generate` produces no migration (the docs at
`website/src/content/docs/docs/backend/search.md:93-99` say so for the *first* application and the
same reasoning silently covers subsequent ones), and the search column keeps indexing the old field
set with the old weights forever. The failure is invisible from outside: searches for content in the
new field return nothing, which reads as "no such candidate".

Fix direction: read the stored generation expression during the ensure, compare it to
`spec.expression` / `spec.fuzzy.expression`, and either plan a `DROP COLUMN` + re-add (loud, with the
table-rewrite cost stated) or refuse to boot with a message naming the drift. At minimum, `doctor`
should report it. Note `ALTER TABLE … ALTER COLUMN … SET EXPRESSION` exists on PG17+, which is below
the pinned `postgres:18-alpine`.

---

## Medium

### M1. A `vector` property has no extension and no index

`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:216-218` emits `VECTOR(n)`, and
`generate-drizzle-schema-logic.ts:264-267` / `dynamic-tables.ts:124-128` emit the matching drizzle
column — but no `CREATE EXTENSION vector` is generated anywhere in `packages/`. The only
`CREATE EXTENSION` statements in the whole OSS pipeline are the search ones
(`search-column.ts:428-429`, for `unaccent` and `pg_trgm`). Extension management for `vector` exists
only in the cloud control plane (`cloud-fleet-safety/backend/functions/extensions.ts`) and as a
manual CLI verb (`packages/cli/src/commands/cloud/extensions.ts:73-75`).

The scaffold and self-host compose both run stock `postgres:18-alpine`
(`packages/cli/templates/template/docker-compose.yml:33`, `docker/docker-compose.selfhost.yml:29`),
which does not ship pgvector.

Failure scenario: a developer declares `{ type: "vector", dimensions: 1536 }`, runs `rebase dev`, and
the boot ensure throws `Failed to add-column public.docs.embedding: type "vector" does not exist`
(`ensure-collection-tables.ts:624-626` re-throws everything except `add-constraint`), crash-looping
the deployment with no hint that an extension is needed. The search feature installs its own
extensions automatically; vectors do not, and nothing documents the asymmetry.

Separately: no HNSW or IVFFlat index is ever created for a vector column (grepped `hnsw`,
`ivfflat`, `vector_cosine_ops` — zero hits repo-wide). Every `vectorSearch` is an exact-KNN sequential
scan that computes the distance for every row and sorts, and the distance expression is rebuilt three
times per query (`drizzle-conditions.ts:1806,1811,1813`) for SELECT, WHERE and ORDER BY.

Fix direction: emit `CREATE EXTENSION IF NOT EXISTS vector` from the same place the search extensions
come from, keyed off any collection declaring a `vector` property; add an opt-in index spec
(`hnsw (col vector_cosine_ops)`) alongside it, or document loudly that this is brute-force KNN.

### M2. A realtime `vectorSearch` subscription silently becomes an ordinary listing

`packages/server-postgres/src/services/realtimeService.ts:448` reads `request.vectorSearch` — but
only to pick the limit default. The stored `collectionRequest` (`:452-468`) has no `vectorSearch`
field, and `fetchCollectionWithAuth` (`:763-791`) has only two branches, `searchString` and plain
fetch.

Failure scenario: `client.data.docs.vectorSearch("embedding", vec).limit(10).listen(cb)` receives ten
rows in `id DESC` order with no `_distance`, forever, and no error. The limit is the vector default
(10) rather than the list default, which is the only visible trace that the parameter was ever seen.

The same function drops `logical` on the search branch (`:767-779` passes filter/orderBy/order/limit/
databaseId/searchExplain — no `logical`, no `offset`), because `DataService.searchRows`'
options type has no `logical` (`services/dataService.ts:81-94`). So H1 has a realtime twin.

Fix direction: store `vectorSearch` in `collectionRequest` and route it through the fetch that
supports it; add `logical` to `searchRows`.

### M3. Generated search columns leak through relation includes

`searchColumnNames` / `visibleColumnProjection` / `hiddenColumnsOption`
(`schema/search-column.ts:483-558`) are applied to the *top-level* table only — four call sites, all
on the queried collection (`FetchService.ts:439,660,687,824,1400,1481`). Related rows are selected
with `withConfig[rel] = true` (`FetchService.ts:275`), which selects every column of the target, and
the batch fallback uses a bare `db.select().from(targetTable)` (`RelationService.ts:416`). The row
pipeline strips only `excludeFromApi` properties from relation targets
(`services/row-pipeline.ts:119-138,104-117`).

Failure scenario: `authors` declares a `search` block; `GET /api/data/posts?include=author` returns
`author.search_vector` (the full lexeme dump) and `author.search_vector_text` (the concatenation of
every searchable field) on every row. `website/src/content/docs/docs/backend/search.md:85` states
flatly "The column is never returned by the API", which is false down this path. `isSearchIndexColumn`
would catch the tsvector generically if it were consulted here; the fuzzy `text` column would still
need the collection config.

Fix direction: apply `hiddenColumnsOption` to each `with` entry (drizzle accepts `columns` inside a
`with` config) and project the batch path in `RelationService`.

### M4. The vector `property` is an unvalidated key into the drizzle table object

`packages/server-postgres/src/utils/drizzle-conditions.ts:1772-1775` — `table[vectorSearch.property]`,
where `property` is `String(query.vector_search)` straight off the querystring
(`query-parser.ts:326`). The vector *values* are carefully validated (`:1782-1788`, with a comment
explaining why); the property name is not. Nothing checks that the named property is declared on the
collection, or that its column is a `vector` at all.

Failure scenario: `?vector_search=title&vector=[1,2]` builds `"title" <=> '[1,2]'::vector`, which the
database rejects with an operator-does-not-exist error; the driver error is not an `ApiError`, so it
surfaces as a 500 "An unexpected error occurred" with a full stack logged as an incident — the exact
outcome the parser's own comment at `query-parser.ts:288-294` says every malformed request must
avoid. Drizzle table objects also carry non-column string keys (`_`, methods), which pass the
`if (!column)` guard and produce nonsense SQL rather than a 400.

Fix direction: resolve `property` through the collection's declared properties, require
`type === "vector"`, and throw `ApiError.badRequest("UNKNOWN_VECTOR_PROPERTY")` otherwise.

### M5. Search results are not relevance-ordered by default

`FetchService.ts:1532-1542` (and `:881-892`): with a `searchString` and no explicit `orderBy`, the
only ordering pushed is `desc(idField)`. The relevance expression is computed and selected as
`_score` but is never used as the default sort.

Failure scenario: `client.data.talents.search("auditor iso 14001").find()` returns the 50 (or
`DEFAULT_LIST_LIMIT`) *newest* matching rows, not the best ones — the query is limited before
anything looks at rank, so the best match can be absent from the response entirely rather than merely
on page seven. The docs name this as a limitation of the *un-opted-in* default
(`search.md:25-26`) and every opted-in example carries an explicit `.orderBy("_score", "desc")`, so
the behaviour is consistent — but a collection that opted into ranked search and did not sort gets
the unranked answer with no warning.

Fix direction: default the sort to `_score DESC, id DESC` when a search string is present and the
collection has a spec, or reject the combination. At minimum, say so in the docs where `_score` is
introduced.

### M6. `startAfter` is declared and ignored on the REST raw path

`FetchService.ts:1460` declares `startAfter?: Record<string, unknown>` on
`fetchRowsWithConditionsRaw`'s options, and the body never builds cursor conditions — compare
`fetchRowsWithConditions` (`:894-901`), which does. Since every REST search and vector read routes
through the raw path (H1), any caller that reaches it with a cursor gets an unpaginated first page
repeated forever.

Today the REST list route passes only `limit`/`offset` (`api-generator.ts:223-224`), so the parameter
is currently unreachable from HTTP and this is a latent trap rather than a live bug — a declared
extension point nothing reads (bug class 21). The `_score` + `startAfter` combination is explicitly
refused elsewhere (`FetchService.ts:529-536`), which shows the intent was that cursors work here.

Fix direction: either apply the cursor conditions or delete the parameter from the signature.

---

## Low

### L1. `search.column` is written into generated code as a bare identifier

`generate-drizzle-schema-logic.ts:670-682` interpolates `${searchSpec.column}` as an unquoted JS
object key, while every other column in the same object literal goes through `propKey()`
(`:28`, used at `:317,341,351`), which quotes anything that is not a JS identifier. `search-column.ts:433,437`
likewise wraps the name in `"…"` for DDL with no escaping of an embedded `"`.

A `search: { column: "búsqueda" }` or `"search vector"` produces a `schema.generated.ts` that does not
parse. This is bug class 35's exact shape — a generator writing a name instead of quoting it — in a
file the class-35 sweep did not cover. Config-supplied, so the blast radius is self-inflicted, but the
fix is one call to the helper that already exists.

### L2. `CREATE INDEX CONCURRENTLY` has no invalid-index recovery

`ensure-collection-tables.ts:491-499` rewrites the index statement to `CONCURRENTLY IF NOT EXISTS`.
A concurrent build that is interrupted leaves an **invalid** index behind; `IF NOT EXISTS` then
matches it on every subsequent boot and never rebuilds it, so the GIN index exists, is never used by
the planner, and every search silently becomes a sequential scan. Nothing queries `pg_index.indisvalid`.
Also note that any failure here is re-thrown (`:624-626`), so an index build that fails for an
unrelated reason crash-loops a deployment whose tables are otherwise fine.

### L3. Two `fetchFn` closures are built and never called

`realtimeService.ts:744-756` and `:935-…` each construct a `fetchFn` and then take a different path
entirely (the transaction at `:763`). Bug class 20 — a value computed and discarded. Worth noting
beyond tidiness because the dead closure *does* pass `logical` and `searchExplain`, which the live
path (M2) does not: reading it suggests the parameters flow when they do not.

### L4. `_matches` ordering relies on an untyped parameter

`drizzle-conditions.ts:1471-1477` builds `(VALUES ($1,$2,<raw sql>), …) AS f(ord, path, txt)` with
the ordinal bound as a parameter, then `ORDER BY f.ord`. With no type context, Postgres resolves an
unknown-typed parameter in a `VALUES` list to `text`, which would sort `"10"` before `"9"`. Harmless
below ten declared search fields; above it, `_matches` no longer comes back in declared order, which
is the property `SearchHighlight.offSlotMatch` depends on. **UNCONFIRMED** — confirming needs one
`EXPLAIN`/`SELECT` against a live database with an 11-field search block, or an explicit
`${i}::int` cast to make the question moot.

### L5. Record text can forge a highlight

`packages/admin/src/components/CollectionViewBinding/SearchHighlight.tsx:20,68-86` splits the server
snippet on `/(<mark>.*?<\/mark>)/`. `ts_headline` does not escape the document, so a record whose own
text contains `<mark>…</mark>` renders as a highlight in someone else's search results. Not XSS — the
component deliberately splits and renders rather than using `dangerouslySetInnerHTML`, and the
surrounding text stays inert — but the mark is not trustworthy evidence of a match.

---

## Checked and clean

- **Parameterisation of the FTS path.** `normalizedTsQuery` (`drizzle-conditions.ts:1421-1426`) binds
  both the config and the search string; `sql.raw` is used only for the frozen helper-function
  constants (`SEARCH_UNACCENT_FN`) and for config-derived, `quote()`-escaped column expressions. The
  vector literal is raw but is guarded by an explicit finite-number check at the builder
  (`:1782-1788`) as well as at the parser (`query-parser.ts:308-313`).
- **RLS.** Search and vector reads take the same request-scoped path as any other read:
  `AuthenticatedPostgresBackendDriver.restFetchService` wraps them in
  `withTransaction(..., { accessMode: "read only" })` with `applyAuthContext` and the reader-role
  downgrade (`PostgresBackendDriver.ts:1566-1582`), and the realtime refetch does the same
  (`realtimeService.ts:763-765`). The `_matches` subquery reads only the row's own columns.
- **Immutability constraints.** The module comment's table matches what Postgres actually enforces,
  and the three unavoidable STABLE built-ins are wrapped in honestly-immutable `sql` functions with
  `STRICT`. `WITH SCHEMA public` on the extension and the schema-qualified `regdictionary` cast are
  both correct and both non-obvious (`search-column.ts:404-429`).
- **The Atlas exclusion.** `searchExcludePatterns` emits the three-part `schema.table.object` form
  and covers both columns and both indexes (`generate-postgres-ddl-logic.ts:344-358`), matching the
  known trap that the two-part form matches nothing silently.
- **Boot-time refusal of a bad `search` block.** Path resolution, enum/uuid/`json`/numeric-array
  rejection, duplicate paths, and the property-name collision all throw with actionable messages
  (`search-column.ts:234-345`), and `assertSearchIsPostgresOnly` runs inside the ensure plan
  (`ensure-collection-tables.ts:197`). Read-time falls back to ILIKE rather than throwing twice, which
  is documented.
- **`count` agrees with the listing on search.** `FetchService.count:1124-1130` builds the same
  conditions through the same helper (though see H1 for the `logical` divergence).
- **Ordering by an unknown field.** `?orderBy=_score` without a search string, and any typo, reach
  `resolveOrderByField`'s explicit 400 rather than returning unsorted rows
  (`FetchService.ts:148-200`).
- **Search-column exclusion on the top-level read.** Both the `db.query` and `db.select` paths hide
  the generated columns, and the projection is `undefined` when there is nothing to hide, so
  non-search collections compile to the same SQL as before.
- **Client serialization.** `buildQueryString` (`client/src/transport.ts:191-205`) sends
  `vector_threshold=0` for a real zero, and the server reads it as the truthy string `"0"`; the
  `vector_search`/`vector` pair is all-or-nothing on both ends. The offline evaluator's `matchesSearch`
  is a plain `includes`, not a regex (`client/src/offline-query.ts:287-289`).
- **`search` survives config validation** — it is in the collection-key allowlist
  (`packages/server/src/collections/validate-config.ts:116`).

## Open questions

1. Does anything other than the boot ensure ever create the generated search column for a project
   that deploys by migration? The docs tell the reader to append `drizzle/search.sql` to a migration
   by hand (`search.md:96-99`). If they do not, `buildFullTextCondition` returns `undefined`
   (`drizzle-conditions.ts:1367-1372`) and the collection silently serves ILIKE results with no log
   line anywhere — while `orderBy: "_score"` starts 400-ing with "unknown field". Should that
   mismatch (block declared, column absent) warn once at boot?
2. Is `search.language` ever validated against `pg_ts_config`? A typo fails loudly at column
   creation, which is fine — but on a database where the column already exists, a changed language
   (H3) leaves the column indexing the old config while `websearch_to_tsquery` uses the new one, so
   the two disagree and every search returns nothing. Worth a test.
3. In BaaS/introspected mode, the drizzle table keys come from `dynamic-tables.ts` (column names),
   while `buildSearchConditions` looks up `table[propertyKey]` (`drizzle-conditions.ts:1321`). For a
   generated schema these agree, because the generator keys by property name
   (`generate-drizzle-schema-logic.ts:351`). Do they agree for an introspected collection whose
   property name was camelCased away from its column? If not, ILIKE search silently skips those
   properties. UNCONFIRMED; a fixture with `columnName` diverging from the property key would settle it.
4. Is the `vector` extension a documented prerequisite anywhere a self-hosting user would see it?
   The website docs describe `vectorSearch` in the SDK reference
   (`website/src/content/docs/docs/sdk/querying.md:290-305`) and never mention pgvector or an image
   that carries it.
