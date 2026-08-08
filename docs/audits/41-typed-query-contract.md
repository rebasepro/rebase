# Unit 41 — The typed query contract

Read-only audit, 2026-08-08. Scope: `packages/client/src/query-contract.types.ts`,
`query_builder.ts`, `sdk_query_builder.ts` and the types they are built on
(`packages/types/src/controllers/data.ts`, `packages/types/src/types/filter-operators.ts`), against
the runtime authorities they are supposed to mirror — `packages/server/src/api/rest/query-parser.ts`
plus the two compilers it feeds (`packages/server-postgres/src/utils/drizzle-conditions.ts`,
`packages/server-mongo/src/db/MongoConditionBuilder.ts`), the wire codec
(`packages/common/src/data/filter-dialect.ts`, `sort-dialect.ts`), the realtime path, and the
offline evaluator.

## Verdict

The contract has a real gate — `query-contract.types.ts` is a plain module under `packages/client/src`,
`tsconfig.typecheck.json` includes that directory, and CI runs it (`verify.yml:57`), so the file is
enforced exactly as its docblock claims. The warning about inert test assertions is accurate for
`packages/client`, `packages/server` and `packages/server-postgres` — those `*.test.ts` are excluded
from `tsconfig.typecheck.json` and are not in `tsconfig.tests.json` either, so they are typechecked by
nothing — but it is *not* universal: `tsconfig.tests.json` does typecheck `packages/types/test` and
`packages/common/test`, and the `WhereFilterOp`-duplication guard there is a live runtime string
comparison that runs in CI. The two `WhereFilterOp` unions currently agree, sixteen members each, and
the client uses the `@rebasepro/types` copy.

What the gate does not cover is the operator/value axis, and that is where the contract is broken. The
enforced assertions are entirely about `orderBy` and the computed fields — nothing pins the
*operator* half. `WhereValue<T> = T | T[] | null` is operator-blind, so the type layer and the parser
disagree in both directions at once: `array-contains`, the one operator whose value is an *element* of
the column rather than the column's own type, is uncallable from any generated SDK (proven with
`tsc`), and the spelling that does compile builds a query that matches nothing; meanwhile `==`, `>`
and `<` happily accept an array. Underneath that, three separate runtimes implement the same
`FilterValues` grammar and only one of them implements all of it: the Mongo compiler has no branch for
the array-of-tuples form, so `.where("age", ">=", 18).where("age", "<", 65)` — a shape `FilterValues`
documents and Postgres handles — drops *both* conditions and widens the read to the whole collection.
The `orderBy` story has the same shape one layer down: the `field:direction` shorthand never reaches
the direction validator, so `?orderBy=created_at:DESC` sorts ascending and answers 200, which is the
`order-by-silently-unsorted` bug wearing a different hat.

Counts: 2 high, 6 medium, 8 low.

---

## High

### H1. `array-contains` cannot be called from a typed SDK, and the spelling that compiles matches nothing

`packages/types/src/controllers/data.ts:6` (`WhereValue`), used at `:173`, `:286`, `:478`, `:778`;
implemented at `packages/client/src/sdk_query_builder.ts:40` and
`packages/common/src/data/query_builder.ts:44`. Runtime authority:
`packages/server-postgres/src/utils/drizzle-conditions.ts:791-798`.

`WhereValue<T> = T | T[] | null` is a single value type for all sixteen operators. It is correct for
the comparison operators (`T`) and for `in`/`not-in` (`T[]`), and it is wrong for exactly one
operator: `array-contains` takes an *element* of an array column, not the column's own type. On a
generated SDK row — where an `array` property is emitted as `Array<X>`
(`packages/codegen/src/generate-types.ts:110-114`) — `M["tags"]` is `string[]`, so
`WhereValue<M["tags"]>` is `string[] | string[][] | null` and the documented call is a compile error.

Confirmed with a scoped `tsc --noEmit` against `packages/types/src`:

```
probe.ts(6,92): error TS2345: Argument of type '"featured"' is not assignable to parameter of type 'WhereValue<string[]>'.
```

The object form escapes it, because `FilterValues` types the value as `unknown`
(`packages/types/src/types/filter-operators.ts:107`) — which is why
`{ tags: ["array-contains", "featured"] }`, the example in that file's own docblock at `:97`, compiles
while the fluent form of the identical query does not. Class 11 exactly: two declarations of one call,
disagreeing, each internally consistent.

The relation case is the same defect and is worse, because it is the case the runtime was
*specifically* built for. `generate-types.ts:363-366` emits relation keys onto the row typed as
`Array<TargetRow>` for a to-many relation, and `drizzle-conditions.ts:706-729` exists to answer
`array-contains` / `in` / `==` on precisely those keys ("they reach here because the admin offers them
for a property that is an *array of* relations"). From a generated SDK,
`.where("tags", "array-contains", tagId)` does not compile: the type wants an `Array<TagsRow>`.

**Failure scenario.** A developer follows `docs/sdk/querying.md` ("Array field contains value"), writes
`client.data.posts.where("tags", "array-contains", "featured")`, gets TS2345, and "fixes" it the only
way the error message suggests — by wrapping the value: `["featured"]`. That compiles. At runtime the
Postgres branch builds `` sql`${column} @> ARRAY[${value}]` `` with the whole JS array bound as the
single element, which is not the query they asked for and returns no rows. (The zero-row outcome is
read from the code, not executed — **UNCONFIRMED**. The type rejection is confirmed.) There is no
error anywhere: a filtered list is simply empty, forever.

**Fix direction.** Correlate the value type with the operator. A `WhereValueFor<Op, T>` conditional —
`array-contains` → `ElementOf<T>`; `in`/`not-in`/`array-contains-any` → `readonly ElementOf<T>[] | T[]`;
`is-null`/`is-not-null` → `null | undefined`; everything else → `T` — and a `where<K, Op extends
WhereFilterOp>(column: K, operator: Op, value: WhereValueFor<Op, M[K]>)` overload on all four
declarations. Then add the operator × property-type cells to `query-contract.types.ts`, which today
asserts nothing about operators at all.

### H2. The Mongo compiler drops a multi-condition filter entirely, widening the read

`packages/server-mongo/src/db/MongoConditionBuilder.ts:78-87`. Contrast
`packages/server-postgres/src/utils/drizzle-conditions.ts:493-496`.

`FilterValues` declares two shapes per field: one tuple, or an array of tuples
(`filter-operators.ts:106-107`, documented at `:90` — `{ age: [[">=", 18], ["<", 65]] }`). Postgres
branches on both. Mongo does not:

```ts
const [op, value] = filterParam as [WhereFilterOp, any];
const condition = this.buildCondition(field, op, value);
if (condition) conditions.push(condition);
```

Given `[[">=", 18], ["<", 65]]`, `op` binds to the array `[">=", 18]` and `value` to `["<", 65]`.
`buildCondition` then misses every early return, `REBASE_TO_MONGO_OP[op]` stringifies the array to
`">=,18"` and yields `undefined`, and `:116-119` logs a warning and returns `undefined` — so the
caller pushes nothing and **both** conditions are lost. The read runs without them.

The same hole is reachable through the fluent builder, which is how the shape is normally produced:
`sdk_query_builder.ts:58-68` merges a second `.where()` on the same column into an array of tuples.

**Failure scenario.** On a Mongo-backed project, `client.data.users.where("age", ">=", 18).where("age",
"<", 65).find()` returns every user, of every age, up to the page limit. A warning goes to the server
log; the caller gets a 200. This is the "a dropped filter widens the result set, which is the direction
that does not announce itself" failure the Postgres path has guards for and this one does not.

**Fix direction.** Lift the `paramsList` normalisation out of `DrizzleConditionBuilder` into a shared
helper in `@rebasepro/common` (it is the grammar, not a driver detail) and call it from both
compilers. Failing that, at minimum make an unrecognised operator throw rather than return `undefined`
— a filter that cannot be compiled must not compile to "no filter".

---

## Medium

### M1. `?orderBy=created_at:DESC` sorts ascending; `:sideways` is accepted silently

`packages/server/src/api/rest/query-parser.ts:110-115`, `:99-107`;
`packages/common/src/data/sort-dialect.ts:49-56`.

`toDirection` exists to refuse "a direction that does not exist" and lowercases its input, so the JSON
array dialect accepts `"DESC"` and rejects `"sideways"` with a 400. The `field:direction` shorthand —
the spelling the SDK itself emits (`sort-dialect.ts:35`) and the one the OpenAPI document advertises —
never reaches it. `toOrderByEntry` runs the raw string through `deserializeOrderBy` first, and that
function has already collapsed the direction to `dir === "desc" ? "desc" : "asc"`. By the time
`toDirection(tuple[1])` is called the value is always a valid direction, so that call is dead code for
this path.

**Failure scenario.** A REST caller (or anyone hand-writing a URL, or a generated client that upcases)
sends `?orderBy=created_at:DESC`. The server answers 200 with rows in *ascending* order. Paging over
it is coherent but backwards; a "newest first" list shows the oldest rows and nothing anywhere reports
a problem. `?orderBy=created_at:descending` behaves identically. This is the family of
`order-by-silently-unsorted`, and the same argument applies — a sort that quietly means something else
is worse than an error.

**Fix direction.** Have the shorthand path split the string itself and pass the raw direction token to
`toDirection`, or give `deserializeOrderBy` a strict mode that returns the token unnormalised for the
server to validate. The leniency belongs at the client end of the codec, not at the ingress.

### M2. `FieldPath<M>` blesses dotted jsonb paths that no runtime accepts — and the fluent builder refuses the ones the object form allows

`packages/types/src/types/filter-operators.ts:126-128`; used at
`packages/types/src/controllers/data.ts:80` (`where`) and `:91` (`orderBy`).

`FieldPath` deliberately admits `"meta.tag"` and its docblock gives the reason: "rejecting paths we
cannot verify would make jsonb columns unqueryable". Nothing downstream implements them.
`drizzle-conditions.ts:385-390` resolves a filter field with a flat `columnAt(field)` lookup and
throws `UNKNOWN_FILTER_FIELD` otherwise; `FetchService.ts:153-157` does the same for `orderBy` and
throws `UNKNOWN_ORDER_BY_FIELD`. There is no `->>`, no `split(".")` and no jsonb path anywhere in
either compiler (the only dotted-string handling in `drizzle-conditions.ts` is
`getTableNamesFromColumns` at `:1739`, which is about table-qualified names). The offline evaluator
reads `row[field]` (`packages/client/src/offline-query.ts:256`), so it silently matches nothing rather
than erroring.

The two client-side declarations of the same query then disagree with *each other*: `FindParams.where`
is keyed by `FieldPath<M>` (dotted allowed), while every `where()` overload is keyed by
`keyof M & string` (dotted rejected). Both confirmed with `tsc`:

```
probe.ts(18,66): error TS2345: Argument of type '"meta.tag"' is not assignable to parameter of type '"id" | "title" | "tags" | "meta" | "age"'.
probe.ts(24,68): error TS2345: Argument of type '"meta.tag"' is not assignable to parameter of type '"_score" | "id" | ...'.
```

`{ where: { "meta.tag": ["==", "x"] } }` compiled without complaint in the same program.

**Failure scenario.** A developer with a `map` column reads the `FieldPath` docblock, writes
`find({ where: { "settings.theme": ["==", "dark"] } })`, and gets a 400 `UNKNOWN_FILTER_FIELD` at
runtime with a "valid fields" list that does not explain why the type accepted it. Trying the fluent
form instead produces a compile error, which reads as the two APIs having different capabilities
rather than as one shared gap.

**Fix direction.** Pick one. Either implement dotted paths in both compilers (jsonb `->>` for map
columns) and widen the `where()`/`orderBy()` overloads to `FieldPath<M>`, or narrow `FieldPath` to
`Extract<keyof M, string>` and say plainly that jsonb interiors are not queryable. The current state
is the worst of the three — documented, typed, unimplemented.

### M3. A scalar value wrapped in parentheses round-trips as a list

`packages/common/src/data/filter-dialect.ts:153` (serialise) and `:247-250` (deserialise);
consumed at `packages/server-postgres/src/utils/drizzle-conditions.ts:761-765`.

`serializeTuple` only parenthesises *array* values, but `deserializeSingle` treats any value that
starts with `(` and ends with `)` as a list. The pair is not a bijection.
`.where("status", "==", "(none)")` serialises to `eq.(none)` and deserialises to `["==", ["none"]]` —
operator preserved, value silently promoted from a string to a one-element array. `eq(column, ["none"])`
then compares a text column against an array parameter.

**Failure scenario.** A CMS with a literal status value like `"(draft)"`, or any free-text column
whose value happens to be fully parenthesised, filters to zero rows with a 200 and no diagnostic.

**Fix direction.** Escape a leading `(` on the scalar path the way `escapeListItem` already escapes
commas, or mark list values explicitly (the operator already tells you: only `in`, `not-in` and
`array-contains-any` take lists, so the parenthesis heuristic is unnecessary for the rest).

### M4. `listen()` accepts parameters the socket path never carries — `vectorSearch` and `include`

`packages/client/src/collection.ts:419-435`; server side
`packages/server-postgres/src/services/realtimeService.ts:447-468`.

`SDKQueryBuilderInterface` is one interface for `find()`, `count()` and `listen()`, so
`.vectorSearch(...).listen(cb)` and `.include("author").listen(cb)` both typecheck —
`query-contract.types.ts:80-81` even asserts the `vectorSearch` chain compiles. The client's
`listenCollection` call forwards `where`, `logical`, `limit`, `offset`, `orderBy`, `order`,
`searchString` and `searchExplain`, and stops. `include` is not even a member of
`FetchCollectionProps` (`packages/types/src/controllers/data_driver.ts:103-125`), so relations can
never be populated over the socket. `vectorSearch` *is* a member, and the server reads it at
`realtimeService.ts:447` — but only to pick the default page size (`vectorSearch: !!request.vectorSearch`)
— and then omits it from the `collectionRequest` it stores at `:457-468`. A field consulted for one
purpose and dropped for its actual one.

**Failure scenario.** `client.data.docs.vectorSearch("embedding", v, { threshold: 0.3 }).listen(cb)`
delivers an arbitrary page of documents that looks like a nearest-neighbour result. `observe()` makes
it intermittent rather than constant: `collection.ts:333-336` fires a `find()` alongside the
subscription, so the first callback carries correct vector-ordered rows and the first socket push
replaces them with unordered ones.

(The vector half of this overlaps `docs/audits/07-search-and-vector.md`; the `include` half and the
half-consumed field on the server are additional.)

**Fix direction.** Either thread both through `ListenCollectionProps` and the stored request, or make
`listen()` reject a params object carrying a parameter the socket cannot honour — silently serving a
different query than the one asked for is the outcome that must not survive.

### M5. `.vectorSearch(...).count()` counts the whole collection

`packages/server/src/api/rest/api-generator.ts:1053-1064` (`countRawEntities`), reached from the count
route at `:188-196` and from the list route's `total` at `:235`.

`countRawEntities` forwards `filter`, `logical` and `searchString`. It does not forward
`vectorSearch`, which carries a `threshold` that removes rows. `SDKQueryBuilder.count()`
(`sdk_query_builder.ts:179-184`) hands over the same params object `find()` uses, so the call
typechecks and returns a number that describes a different query.

**Failure scenario.** A semantic-search UI shows "1,284 results" for a threshold-filtered vector query
that returns 7 rows, and `meta.hasMore` on the list response is computed from the same wrong total, so
paging offers pages that do not exist.

**Fix direction.** Forward `vectorSearch` into the count path (the threshold is a `WHERE` clause; the
ordering is irrelevant to a count), or refuse `count()` on a vector query rather than answering with a
number that is not the answer.

### M6. A column whose name collides with a reserved query key has its filter silently discarded

`packages/server/src/api/rest/query-parser.ts:247`.

```ts
const reservedQueryKeys = ["limit", "offset", "page", "orderBy", "include", "fields", "searchString",
    "searchExplain", "vector_search", "vector", "vector_distance", "vector_threshold", "or", "and", "where"];
```

A collection with a column called `page`, `fields`, `include`, `limit`, `offset` or `vector` — all
plausible; `vector` especially so on an embeddings table — types perfectly: it is a real key of `M`, so
`where: { page: ["==", 3] }` compiles. `buildQueryString` (`packages/client/src/transport.ts:220-227`)
emits `page=eq.3`, the parser skips it as reserved, and the filter is gone. The read runs wider than
asked. `where` itself was added to this list precisely because leaving it out let the documented JSON
dialect "compile as a filter on a nonexistent field" (`:242-246`) — but that case now *errors*, while
these cases drop.

Pagination is corrupted at the same time: `?page=eq.3` reaches `parseInt("eq.3")` → `NaN` at `:213`, so
`options.offset` is `NaN` and `meta.offset` serialises as `null`. `?limit=eq.5` degrades quietly to the
default (`resolveClientListLimit` rejects the non-finite parse at
`packages/types/src/controllers/data_driver.ts:91`).

**Failure scenario.** A `documents` collection with a `page` integer column. `where: { page: ["==", 1] }`
returns every document in the collection, at a broken offset, with a 200.

**Fix direction.** Validate the *field* namespace against the reserved list at collection-registration
time (fail the boot with a clear message, the way derived-name collisions are handled), or move filters
into a namespaced parameter so the two namespaces cannot collide at all.

---

## Low

- **L1. `orderBy: ["_score", …]` typechecks unconditionally but 400s without a search.**
  `ComputedSortField` is unconditional on `FindParams.orderBy`
  (`packages/types/src/controllers/data.ts:91`), while `FetchService.ts:141` only resolves `_score`
  when the collection has a `search` block *and* the request carried a `searchString`; otherwise it
  falls through to `UNKNOWN_ORDER_BY_FIELD`. `query-contract.types.ts:51-54` pairs them by convention
  but the type does not enforce it. Correlating them is expressible (a union of
  `{ searchString: string; orderBy: OrderByTuple<... | ComputedSortField> }` with the plain variant),
  though the ergonomics may not be worth it.

- **L2. Multi-column `orderBy` is parsed and then truncated without a word.** `parseOrderByParam`
  returns `OrderByEntry[]` (`query-parser.ts:146-175`) and every consumer reads `[0]` only
  (`api-generator.ts:225`, `:876`, `:1042`). `?orderBy=[{"field":"a"},{"field":"b"}]` sorts by `a` and
  discards `b` silently. `OrderByTuple`'s docblock names this ("server consumes only the first"), so it
  is known — but a parameter that is accepted and dropped is the shape this codebase has been burned by
  repeatedly. A 400 naming the limit would cost nothing.

- **L3. `==`, `!=`, `>`, `>=`, `<`, `<=` accept an array value.** Same root as H1: `WhereValue<T>`
  includes `T[]` for every operator so that `in` works. `.where("title", "==", ["a", "b"])` compiles
  and reaches `eq(column, ["a","b"])` (`drizzle-conditions.ts:761-765`). Subsumed by the H1 fix.

- **L4. `like`/`ilike` are unusable on non-string columns from a typed SDK.** `WhereValue<number>`
  refuses `"%3%"` (confirmed: `probe.ts(30,81): error TS2345`). The server accepts it and Postgres
  casts. This is the types being *stricter* than the runtime, which is the safe direction, but it is a
  real DX cliff for `like` on a numeric or date column — and it is not documented anywhere.

- **L5. A filter whose value does not fit the column's type is a 500, not a 400.** `FetchService`
  never calls `pgErrorToFriendlyMessage` (`packages/server-postgres/src/utils/pg-error-utils.ts:187`
  is reached only from `PersistService` and `BranchService`), so `?age=eq.abc` (PG `22P02`) or a
  `like` on an integer column (`42883`) propagates as a bare error and, per the reasoning already
  written at `query-parser.ts:289-294`, becomes a 500 "An unexpected error occurred". The type layer
  cannot help here: with the default untyped client `M` is `Record<string, unknown>`, so `M[K]` is
  `unknown` and `WhereValue<unknown>` accepts everything. Every REST caller and every non-generated
  SDK user is in this bucket.

- **L6. The Mongo driver still has the `orderBy` bug that was fixed on Postgres.**
  `MongoConditionBuilder.buildSort` (`:285-291`) is `{ [orderBy]: order === "desc" ? -1 : 1 }` with no
  schema check, and `MongoConditionBuilder` has no `UNKNOWN_FILTER_FIELD` equivalent either. On Mongo,
  `?orderBy=titel` is still 200 with rows in arbitrary order — the exact behaviour
  `FetchService.ts:186-228` was rewritten to eliminate. The `unknownFilterFields` switch that
  `FetchService` honours has no Mongo counterpart.

- **L7. `FindParams` cannot express `?fields=`.** The server parses it
  (`query-parser.ts:282-286`), projects it (`api-generator.ts:236` via `projectResponseFields`) and
  publishes it on every endpoint in the OpenAPI document, but there is no `fields` on `FindParams`
  and `buildQueryString` (`transport.ts:178-232`) never emits one. The codegen has internalised the
  gap as a fact: `generate-types.ts:299` — "There is no field selection in the query API, so every
  column of a row comes back on every read". A capability the runtime has, that no typed caller can
  reach.

- **L8. Two hand-maintained copies of the same builder.**
  `packages/common/src/data/query_builder.ts:29-167` and
  `packages/client/src/sdk_query_builder.ts:25-198` implement the same `where` merge, the same
  `orderBy`/`limit`/`offset`/`search`/`vectorSearch`/`include`, differing only in the result type and
  in `SDKQueryBuilder` having `count()`. ~150 near-identical lines with no shared base and no test
  asserting they agree — the setup that produced the `_score` divergence in the first place. Also
  minor: `packages/ui/src/components/VirtualTable/VirtualTableProps.d.ts` is a gitignored stale build
  artifact declaring a ten-member `WhereFilterOp`; the duplication guard reads the `.tsx` and cannot
  see it. Harmless in CI (untracked), confusing locally.

---

## Checked and clean

- **The two `WhereFilterOp` unions agree.** `packages/types/src/types/filter-operators.ts:61-77` and
  `packages/ui/src/components/VirtualTable/VirtualTableProps.tsx:291-311` both declare the same
  sixteen members. `packages/types/test/filter-operators-duplication.test.ts` compares them by parsing
  both source files, refuses to pass vacuously on an emptied union, and runs in CI (`pnpm -r test`;
  `packages/types` has a `test` script). The client and every driver use the `@rebasepro/types` copy;
  the UI copy is reached only through `VirtualTable`.
- **`query-contract.types.ts` is genuinely enforced.** `tsconfig.typecheck.json` includes
  `packages/client/src` and excludes only `**/*.test.ts`; `verify.yml:57` runs `pnpm run typecheck` as
  a required gate. The five `@ts-expect-error` directives in that file are live, and the fixture's
  no-index-signature design is what makes them meaningful. Its own analysis of why a `.test.ts` would
  be inert is correct for `packages/client`.
- **The filter wire codec round-trips.** `serializeFilter`/`deserializeFilter` agree on canonical
  tuples, arrays of tuples, list values with escaped commas and backslashes
  (`filter-dialect.ts:57-103`), null-op normalisation (`:242-244`), and the dotted-value defence
  (`:230-238`). Repeated query parameters survive because the REST layer uses `c.req.queries()`
  (`api-generator.ts:190`), not `c.req.query()` — so `age=gte.18&age=lt.65` reaches
  `deserializeFilter` as a two-element array and is correctly read as two conditions (`:294-296`).
  The one asymmetry found is M3.
- **Empty and null list operands.** `in []` → `FALSE`, `not-in []` → `TRUE`, `in null` → `IS NULL`,
  `not-in null` → `IS NOT NULL`, `array-contains-any []` → `FALSE`
  (`drizzle-conditions.ts:766-830`). Each is the non-widening reading and each carries the comment
  explaining why. The relation-filter mirror at `:697-706` matches.
- **The past failures named in the brief are closed on the paths audited.** A bare string in `where` is
  rejected by `FilterValues` (only the `@internal` `WireFilterValues` admits it), `logical`/`fields`
  are forwarded by every REST call site, and an unresolvable `orderBy` field is a 400 on Postgres —
  though M1 reopens the *direction* half of that and L6 shows the Mongo half was never closed.
- **The offline evaluator is honest about what it cannot do.** `isExactlyEvaluable`
  (`offline-query.ts:358-368`) refuses `include`, `searchString` and `vectorSearch` with the correct
  reasoning for each; `resolvePagination` delegates to the shared window resolver rather than keeping
  a local default; `matchesWhere` filters non-tuples out rather than guessing
  (`:245-260`); an unknown operator returns `true` (does not drop rows) at `:233-236`.
- **`QueryComputedFields` is a `type` alias, not an interface,** with the implicit-index-signature
  reasoning documented at `data.ts:356-364` and pinned by `rowStaysIndexable` in the contract file.

## Open questions

1. Is dotted-path querying (M2) meant to exist? `FieldPath`'s docblock argues for it in the
   present tense, but no engine implements it and no test exercises it. If it was aspirational, the
   type should be narrowed; if a driver once supported it, that regression predates this audit.
2. Was the Mongo compiler's missing array-of-tuples branch (H2) ever exercised? There is no
   `packages/server-mongo` entry in `tsconfig.typecheck.json`'s test coverage beyond
   `packages/server-mongo/test` in `tsconfig.tests.json`, and I did not run the suite. A test asserting
   `{ a: [[">=",1],["<",9]] }` compiles to `$and` would have caught it.
3. `array-contains` on a **jsonb** array column builds `` @> ${JSON.stringify([value])} ``
   (`drizzle-conditions.ts:796`) while a native array builds `@> ARRAY[...]`. Both take the element
   form, which confirms the H1 diagnosis — but whether the jsonb branch is reachable at all depends on
   whether `array` properties ever land as jsonb rather than `PgArray`. Not established here.
4. The direction-normalising leniency in `deserializeOrderBy` (M1) is shared by the admin panel and
   the SDK. Tightening the server means auditing whoever relies on `?orderBy=x:DESC` working at all —
   it currently "works" in the sense of returning 200.
5. Does any downstream project already depend on the `["featured"]` spelling from H1 as a workaround?
   Fixing the type would break their build (correctly), but it is worth knowing before the change
   ships.
