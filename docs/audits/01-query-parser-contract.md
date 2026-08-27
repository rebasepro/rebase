# Unit 1 — the query parser and the where-clause contract, end to end

Read-only audit, current `main` (`c678e1745`). Scope: `packages/server/src/api/rest/query-parser.ts`,
the REST routes that consume it, `@rebasepro/common`'s filter/sort dialects and
`filter-conditions.ts`, the client transport + `SDKQueryBuilder` + the typed query
contract, and the three compilers that consume `FilterValues` —
`server-postgres/src/utils/drizzle-conditions.ts`,
`server-mongo/src/db/MongoConditionBuilder.ts`, and the offline evaluator
`client/src/offline-query.ts`.

Findings marked **empirically confirmed** were reproduced by running the built
`@rebasepro/common` codec (`packages/common/dist/index.es.js`) directly; everything
else is read from source and cited by line.

---

## Verdict

**The parser layer is in good shape. The wire *codec* underneath it is not.**

`query-parser.ts` itself is close to exemplary: `limit` is refused rather than
clamped, `orderBy` shape and field are both 400s, `?where=` refuses malformed JSON,
the logical parser has a depth bound, and the vector parameters all carry
`ApiError.badRequest`. The Postgres compiler is equally careful — unknown filter
field is a 400, empty `in` is `FALSE` not "no condition", `!=` on a to-many is
`NOT EXISTS` of the positive.

The defects are one layer below and one layer to the side:

1. **The flat REST filter codec is asymmetric.** `serializeFilter` and
   `deserializeFilter` do not round-trip three ordinary values — `null`, an empty
   list, and any scalar wrapped in parentheses. Each one is emitted by the SDK's
   own documented API, each one is decoded as something else, and each one has a
   unit test pinning only the *encoder* half. The carefully-written null and
   empty-list branches in `buildSingleFilterCondition` are unreachable from HTTP.
2. **The fail-closed guarantee is Postgres-only.** `UnknownFilterFieldsMode` is a
   `server-postgres` module global wired from `pgConfig`. The Mongo compiler has no
   equivalent, and on Mongo a filter on a field that does not exist does not narrow
   — `is-null`, `!=` and `not-in` on a missing field match *every* document.
3. **Class 17 is still live in six places** between the route and the driver, and
   in one of them (`buildRebaseData.find`) it silently discards `vectorSearch`.
4. **`offset`/`page` are the unchecked twin of `limit`** (class 31): `Number` with
   full validation on one, bare `parseInt` with no validation on the other two,
   twelve lines apart.

Counts: **4 high, 11 medium, 11 low**.

---

## The matrix

### Operator × layer

Read: **P** = `DrizzleConditionBuilder.buildSingleFilterCondition`
(`packages/server-postgres/src/utils/drizzle-conditions.ts:813`), **M** =
`MongoConditionBuilder.buildCondition` (`packages/server-mongo/src/db/MongoConditionBuilder.ts:106`),
**O** = `matchesOperator` (`packages/client/src/offline-query.ts:185`),
**T** = `WhereValueFor` (`packages/types/src/controllers/data.ts:67`).

| canonical | REST | parser | P | M | O | T value | disagreements |
|---|---|---|---|---|---|---|---|
| `==` | `eq` | ✓ | `= v`, `IS NULL` on null | `$eq` | loose eq | `T \| null` | **null lost on the wire (H1)**; paren-wrapped scalar becomes a list (M3) |
| `!=` | `neq` | ✓ | `!= v`, `IS NOT NULL` on null | `$ne` | false on null row | `T \| null` | **null lost (H1)**; M matches every doc when the field is absent (**H3**) |
| `>` `>=` `<` `<=` | `gt` `gte` `lt` `lte` | ✓ | bare `>` etc., **no null branch** | `$gt` … | `compareValues`, false if incomparable | `T \| null` | P binds `NULL`/arrays straight through (L11); wire can hand these a list (L10) |
| `in` | `in` | ✓ | null→`IS NULL`, `[]`→`FALSE`, scalar→1-elt | `$in` | `asArray`, false on null row | `elt[] \| elt \| null` | **`[]` and `null` both unreachable over HTTP (H1, H2)**; O returns false for a null row where P returns true |
| `not-in` | `nin` | ✓ | null→`IS NOT NULL`, `[]`→`TRUE` | `$nin` | false on null row | same | same as `in`; O excludes null rows where P includes them |
| `array-contains` | `cs` | ✓ | `@> ARRAY[v]` / jsonb `@>` | `$elemMatch` | `Array.isArray` guard | `WhereElementOf<T>` | O returns false for a jsonb scalar P would match |
| `array-contains-any` | `csa` | ✓ | `&&` / `?\|`, `[]`→`FALSE` | `$in` (**not** overlap) | overlap | `elt[] \| elt \| null` | M compiles overlap-of-arrays as scalar membership — wrong on an array column (M11) |
| `like` `ilike` `not-like` `not-ilike` | `like` `ilike` `nlike` `nilike` | ✓ | `String(value)` | anchored regex | anchored regex | `string` | `String(["a","b"])` = `"a,b"` when the wire hands a list (L10); M collapses only *consecutive* `%` (L9) |
| `is-null` `is-not-null` | `isnull` `notnull` | ✓, value normalised to `null` | `IS NULL` | `$eq: null` | `isNullish` | `null \| undefined` | **`undefined` type-legal, runtime-rejected (L1)**; M matches all docs on a missing field (**H3**) |
| *unknown* | — | flat: whole string becomes an `==` value; group: **silently becomes `==`** | **warn + drop** | 400 | returns `true` | — | three different answers to the same typo (**M1**, M8) |

### Property type × wire

| value shape | wire | decoded as | outcome |
|---|---|---|---|
| `"active"` | `eq.active` | `["==","active"]` | ✓ |
| `18` (number) | `gte.18` | `[">=","18"]` | ✓ string, driver casts (documented) |
| `true` | `eq.true` | `["==","true"]` | ✓ |
| `null` | `eq.null` | `["==","null"]` | ✗ **H1** |
| `""` | `eq.` | `["==",""]` | ✓ |
| `"a,b"` | `eq.a,b` | `["==","a,b"]` | ✓ (flat values are not comma-split) |
| `"(hello)"` | `eq.(hello)` | `["==",["hello"]]` | ✗ **M3** |
| `"C:\x"` | `eq.C:\x` | `["==","C:\\x"]` | ✓ |
| `["a,b","c"]` | `in.(a\,b,c)` | `["in",["a,b","c"]]` | ✓ (recent fix holds) |
| `["(x)","y"]` | `in.(\(x\),y)` | `["in",["(x)","y"]]` | ✓ |
| `[]` | `in.()` | `["in",[""]]` | ✗ **H2** |
| `EntityRelation` | `eq.<id>` | `["==","<id>"]` | ✓ |

---

## HIGH

### H1 — `null` does not survive the REST wire; `= 'null'` is what reaches SQL

**`packages/common/src/data/filter-dialect.ts:44-49`** (encode) and
**`:274-307`** (decode); consumers at
`packages/client/src/transport.ts:217-229`,
`packages/server/src/api/rest/query-parser.ts:290`.

`stringifyValue(null)` returns the literal string `"null"` — documented, deliberate.
`deserializeSingle` has no inverse: `NULL_OPS` normalisation covers only
`is-null`/`is-not-null` (`filter-dialect.ts:296`), so `eq.null` decodes to
`["==", "null"]`, the string.

Empirically confirmed: `serializeFilter({x:["==",null]})` → `{"x":"eq.null"}` →
`deserializeFilter` → `{"x":["==","null"]}`.

Failure scenario: `client.data.posts.where("deleted_at", "==", null).find()`.
`WhereValueFor` explicitly permits `T | null` (`data.ts:76`) and
`buildSingleFilterCondition` explicitly implements it — `if (value === null …) return
sql\`${column} IS NULL\`` (`drizzle-conditions.ts:821`). Over HTTP that branch never
runs. On a `text` column the query becomes `deleted_at = 'null'` and returns rows whose
column literally holds the four characters `null`; on a `timestamp`/`uuid`/`int`
column Postgres raises an invalid-input-syntax error and the caller gets a 500 for a
query the type checker approved (SQLSTATE UNCONFIRMED — 22007/22P02 by inspection).
`["!=", null]`, `["in", null]` and `["not-in", null]` lose their null identically,
and the `in`/`not-in` null branches (`drizzle-conditions.ts:845`, `:895`) carry
docblocks explaining the admin control they exist for — that control now emits
`is-null` (`packages/cms/src/components/SelectableTable/filters/null_filter.ts:27`),
so those branches are reachable in-process and dead over HTTP.

The JSON dialect disagrees with the dot dialect on the same query:
`?where={"deleted_at":["==",null]}` decodes correctly, because JSON carries the type
and `deserializeFilter` short-circuits on a canonical tuple (`filter-dialect.ts:331`).
Two documented spellings of one filter, two different result sets.

The existing test pins only the encoder — `array-null-safety.test.ts:102` asserts
`?status=eq.null` and stops there.

Fix direction: give `null` a wire spelling the decoder can recognise and that a
string value cannot collide with — the cleanest is to refuse it in
`serializeTuple` for the comparison operators and require `is-null`/`is-not-null`
(the SDK can rewrite `["==", null]` → `["is-null", null]` at the boundary, which is
what the admin already does). Whatever is chosen, pin the **round trip**
(`deserializeFilter(serializeFilter(x)) ≡ x`) rather than the encoder output, for the
whole value matrix above.

### H2 — an empty `in` list round-trips to `IN ('')`

**`packages/common/src/data/filter-dialect.ts:202-205`** (encode `[]` → `in.()`),
**`:301-304`** (decode `()` → `splitListItems("")` → `[""]`).

Empirically confirmed: `{x:["in",[]]}` → `"in.()"` → `{"x":["in",[""]]}`.

`splitListItems` always pushes a final accumulator (`:127`), so the empty string
between the parens becomes a one-element list. Failure scenario:
`client.data.rows.where("id", "in", teamIds).find()` with `teamIds === []` — the
documented "ask for nothing" idiom, called out by name in the compiler's own comment
(`drizzle-conditions.ts:851-854`: *"`filter: { id: ["in", teamIds] }` with no teams is
how a caller asks for nothing, and it answered with the whole table"*). The compiler's
fix (`values.length === 0 ? sql\`FALSE\``) is correct and unreachable from HTTP: what
arrives is `["in", [""]]`, which compiles to `id IN ('')` — zero rows on a `text` id
(accidentally right), and an invalid-input-syntax 500 on a `uuid`/`int` id
(wrong, and the wrong *kind* of wrong: a 500 on a legitimate query). `not-in []`
is worse: `NOT IN ('')` excludes nothing but is not the `TRUE` the compiler intends,
and on a typed column it is again a 500.

Encoder-only test at `array-null-safety.test.ts:125`.

Fix direction: the list grammar needs a distinct empty spelling, or
`deserializeSingle` must read `in.()` as `[]`. The second is a one-line change and is
what the encoder already means; guard it so `in.(,)` and `in.()` do not become the
same thing by accident, and pin the round trip.

### H3 — on Mongo, a filter on a field that does not exist *widens* the read

**`packages/server-mongo/src/db/MongoConditionBuilder.ts:106-144`** —
`buildCondition` builds `{ [field]: … }` for any string, with no schema check
anywhere in the file.

`UnknownFilterFieldsMode` — the whole fail-closed design, its docblock
(`drizzle-conditions.ts:24-36`) explaining that a dropped condition "can only ever
widen the result set" — lives in `server-postgres` as a module global, configured from
`pgConfig.unknownFilterFields` (`PostgresBootstrapper.ts:156`). There is no Mongo
counterpart, and `?field=…` on an unknown field is not refused at the parser either.

Failure scenario: a collection is served by the Mongo driver, a client (or a
renamed column) sends `?deleted_att=isnull.null`. Mongo's `{deleted_att: {$eq:
null}}` matches every document that lacks the field — i.e. all of them — so the
filter that was meant to *exclude* deleted rows admits the entire collection, at 200.
`?status_typo=neq.archived` (`$ne`) and `?role_typo=nin.(admin)` (`$nin`) do the same.
The Postgres path answers 400 `UNKNOWN_FILTER_FIELD` for the identical request. The
same asymmetry applies to `orderBy` (`FetchService.resolveOrderByField` 400s;
`MongoConditionBuilder.buildSort:302` accepts anything) and to `logical` group leaves.

Fix direction: the check belongs above the driver, not inside one — validate filter
and sort field names against `collection.properties` + `resolveCollectionRelations`
in the parser (or in a shared helper both compilers call), so the guarantee is a
platform guarantee rather than a Postgres one. Move `UnknownFilterFieldsMode` to the
shared config while doing it.

### H4 — the in-process accessor drops `vectorSearch` and `searchExplain` (class 17)

**`packages/common/src/data/buildRebaseData.ts:183-209`.**

`find()` hand-lists the fields it forwards on *both* branches — `filter`, `logical`,
`limit`, `offset`, `orderBy`, `order`, `searchString`. `FindParams` has ten fields;
`vectorSearch` and `searchExplain` are not among the seven.

Failure scenario: server-side code (a collection callback, a function, anything
holding `rebase.data`) calls
`rebase.data.docs.vectorSearch("embedding", queryVector, { threshold: 0.3 }).limit(10).find()`.
`SDKQueryBuilder.vectorSearch` sets `params.vectorSearch`
(`packages/client/src/sdk_query_builder.ts:147`), every boundary type-checks, and the
read runs as an ordinary unordered page: no distance ordering, no `_distance` on the
rows, no threshold, no error. The HTTP transport does forward it
(`transport.ts:199-205`), so the same SDK call is correct over the network and
silently wrong in-process — the hardest shape to notice.

`listen()` **eleven lines later** in the same file forwards `searchExplain`
(`buildRebaseData.ts:336`) while `find()` does not: the "one checked, one not"
pairing class 31 describes, on a class-17 axis.

Fix direction: forward the object. `const { where, include, ...rest } = params ?? {}`
and spread `rest`, exactly as `MongoDriver.fetchCollection` was fixed
(`MongoDriver.ts:117-121`). Gate it by asserting the *whole* params object arrived at
the driver, not seven named fields.

---

## MEDIUM

### M1 — an unknown operator on a Postgres column is warned about and dropped

**`packages/server-postgres/src/utils/drizzle-conditions.ts:914-917`.**

```ts
default:
    logger.warn(`Unsupported filter operation: ${op}`);
    return null;
```

`buildFilterConditions` skips a `null` (`:542`), so the condition disappears and the
read widens. This is the one remaining drop in a file that otherwise refuses
everything: the *relation* branch of the same class throws 400
`UNSUPPORTED_RELATION_FILTER_OPERATOR` (`:793`), Mongo throws 400
`UNSUPPORTED_FILTER_OPERATOR` (`:132`), and unknown *fields* throw 400. Inside a
`logical` group it is worse — `buildLogicalConditions` filters `null` out of the
disjunction (`:563`), so an `or(...)` loses a branch and the surviving branches match
on their own.

Reachability from HTTP is limited (the dot dialect maps an unrecognised prefix to an
`==` value rather than to a bad operator), but it is wide open from the in-process
accessor, from a driver-level caller, and from any `FilterValues` built by
`@ts-ignore`'d or generated code.

Fix direction: `throw ApiError.badRequest(...)` with the same code Mongo uses. The
`default:` in a switch over a closed union is also where a *newly added* operator will
land until the compiler is updated — silently, today.

### M2 — repeated query parameters fork on whether the first value contains a dot

**`packages/common/src/data/filter-dialect.ts:349`.**

```ts
if (typeof raw[0] === "string" && raw[0].includes(".")) { /* array of tuples */ }
else { result[field] = ["in", raw]; }
```

Empirically confirmed:

- `?tag=a&tag=b` → `{"tag":["in",["a","b"]]}` — AND-free membership.
- `?email=a@b.com&email=c@d.com` → `{"email":[["==","a@b.com"],["==","c@d.com"]]}` —
  two equalities on one column, AND-ed, which no row can satisfy.

So `GET /users?email=a@b.com&email=c@d.com` answers 200 with an empty page while the
identical shape on a dot-free column answers with both rows. The discriminator is the
presence of `.` in the value, not whether the prefix is an operator —
`deserializeSingle` already answers that question correctly twenty lines above
(`REST_OP_LOOKUP[prefix]`, `:287`).

Fix direction: discriminate on `REST_OP_LOOKUP[raw[0].split(".")[0]] !== undefined`,
not on `includes(".")`. Same predicate, already written, one function away.

### M3 — a scalar wrapped in parentheses is decoded as a one-element list

**`packages/common/src/data/filter-dialect.ts:207`** (scalar emitted unescaped) vs
**`:301`** (a value starting `(` and ending `)` is read as a list).

Empirically confirmed: `{note:["==","(hello)"]}` → `?note=eq.(hello)` →
`{"note":["==",["hello"]]}`.

`serializeTuple` escapes list items (`:203`) and leaves scalars raw (`:207`). The
group serializer had exactly this bug and was fixed — `serializeLogicalCondition:397-400`
now escapes a scalar "like a list item… a scalar inside a group sits between the same
delimiters a list item does". The flat serializer is the un-swept sibling of that fix,
and the delimiters that matter there are the parens rather than the comma.

Downstream, `eq(column, ["hello"])` binds a Postgres array: on `text` the comparison
becomes `= '{hello}'` and matches nothing; on a typed column it is an
invalid-input-syntax error. Any value a user can type that begins `(` and ends `)` —
`"(draft)"`, `"(none)"`, a phone number, a parenthesised note — hits it.

Fix direction: `escapeWireValue(stringifyValue(value))` on the scalar branch of
`serializeTuple`, matching `serializeLogicalCondition`; `unescapeWireValue` on the
scalar branch of `deserializeSingle` to match. Then sweep the *shape*: any place a
value is written between structural delimiters must escape, and there are exactly two.

### M4 — reserved query keys silently shadow real columns

**`packages/server/src/api/rest/query-parser.ts:279-284`.**

```ts
const reservedQueryKeys = ["limit","offset","page","orderBy","include","fields",
  "searchString","searchExplain","vector_search","vector","vector_distance",
  "vector_threshold","or","and","where"];
for (const [key, rawValue] of Object.entries(query)) {
    if (reservedQueryKeys.includes(key)) continue;   // no warning, no error
```

Fifteen column names are unfilterable through the dot dialect, and the drop is silent
— in a parser whose entire design is that a dropped condition widens the read (the
comment three lines up says so about `where` specifically).

Failure scenarios, by how loudly they fail:

- `page`, `offset`: `?page=2` on a collection with a `page` column drops the filter
  **and** applies pagination. `parseInt("eq.2")` is `NaN`, so the offset is dropped
  too (see M6) — the request is a plain unfiltered first page, at 200.
- `include`, `or`, `and`, `vector`, `searchString`: the filter is dropped and the
  value is reinterpreted as the reserved parameter. `?include=eq.x` asks to eager-load
  a relation named `eq.x`, which is silently ignored (M10).
- `limit`, `fields`: fails loudly but misleadingly — `?limit=eq.5` is
  `400 INVALID_LIMIT`, `?fields=eq.x` is `400 UNKNOWN_RESPONSE_FIELD`.

There is an escape hatch (`?where={"page":["==","2"]}` works, because `parseWhereParam`
runs before the reserved filter), and the SDK's `.where("page","==",2)` goes through
`serializeFilter` and lands in the shadowed dot dialect, not in `where`.

Fix direction: at minimum, when a reserved key is also a declared property of the
collection, refuse the request naming the collision and the `?where=` spelling that
expresses it — silence is the bug here, as class 21 puts it. Better: have the SDK's
`buildQueryString` emit any filter whose field is reserved into `?where=` instead.

### M5 — `orderBy` parses N entries and every driver consumes one

**`packages/server/src/api/rest/query-parser.ts:154-183`** (parses and validates a
list) vs **`api-generator.ts:249-250, 920-921, 1092-1093`** (`queryOptions.orderBy?.[0]?.field`).

`FetchCollectionProps.orderBy` is `string` (`packages/types/src/controllers/data_driver.ts:170`)
and `OrderByTuple`'s docblock says so out loud —
*"the natural extension for multi-column sort is `OrderByTuple[]` — not implemented yet
(server consumes only the first)"* (`filter-operators.ts:49`).

The parser does not agree. `?orderBy=[{"field":"status"},{"field":"created_at","direction":"desc"}]`
is accepted, both entries are validated (a typo in the *second* field is a 400), and
only the first is applied — so the caller is given every signal that the request was
understood and gets rows sorted by one column. Paging over a non-unique first sort key
repeats and skips rows, which is the exact harm `resolveOrderByField`'s docblock cites
as the reason unknown sort fields are refused.

Fix direction: either refuse a list longer than one at the parser (naming the
limitation), or thread `orderBy` through as a list. Refusing is a five-line change and
is honest; the current state is the worst of both.

### M6 — `offset` and `page` are `parseInt` with no validation (class 31)

**`packages/server/src/api/rest/query-parser.ts:240-254`.**

```ts
const offsetVal = getLastValue(query.offset);
if (offsetVal) options.offset = parseInt(String(offsetVal));
const pageVal = getLastValue(query.page);
if (pageVal) { const page = parseInt(String(pageVal)); … options.offset = (page - 1) * limit; }
```

`limit`, resolved 140 lines below through `resolveClientListLimit`, is validated to
the letter — `Number` not `parseInt` ("`parseInt("50rows")` is 50, which silently reads
a typo as a window the caller never wrote"), integer, `>= 1`, `<= maxLimit`, refused
not clamped, with a bespoke error class. `offset` and `page` get none of it. This is
the paired shape class 31 describes, and the doc's own table already lists a twin from
this same file (`?where=` checked, `?orderBy=` not).

Concrete outcomes, all 200:

| input | `options.offset` | served |
|---|---|---|
| `?offset=abc` | `NaN` | page one (`options.offset && options.offset > 0` is false at `FetchService.ts:909`) |
| `?offset=-5` | `-5` | page one |
| `?offset=20rows` | `20` | rows 21+ — a typo silently accepted as a window |
| `?page=0` | `-limit` | page one |
| `?page=abc` | `NaN` | page one |
| `?page=1e3` | `1` → offset `0` | page one (`parseInt("1e3")` is 1) |

`meta.offset` is echoed back verbatim, so `NaN` serialises to JSON `null` — a client
computing its next request from `meta.offset` gets `null`. And `hasMore` uses
`(queryOptions.offset || 0)` (`api-generator.ts:272`), which quietly re-reads `NaN` as
0 rather than noticing it.

Fix direction: route both through a shared validator beside `resolveListLimitParam` —
non-negative integer for `offset`, integer `>= 1` for `page`, 400 otherwise.
`resolveFindWindow` (`packages/common/src/data/paginate.ts:89`) already clamps `page`
to `Math.max(0, …)` on the client; the two ends should share one rule.

### M7 — `page` and `offset` can disagree, silently

**`packages/server/src/api/rest/query-parser.ts:240-254`** — `offset` is assigned
first, `page` overwrites it unconditionally.

`?offset=100&page=2&limit=10` serves rows 11–20 and reports `meta.offset: 10`.
`FindParams.page`'s docblock and the OpenAPI description both say `page` wins, so the
precedence is right; what is missing is that the client *sends both* when both are set
(`transport.ts:182-184` pushes `limit`, `offset` and `page` independently), so a caller
who sets `offset` and later sets `page` on the same builder gets no indication that the
first was discarded.

Fix direction: refuse the combination at the parser (400, naming both), and have
`buildQueryString` emit only the winner.

### M8 — an unknown operator inside `or()`/`and()` silently becomes `==`

**`packages/common/src/data/filter-dialect.ts:471`** —
`const operator = toCanonicalOp(opStr) ?? "==";`

`?or=(views.gtee.10,status.eq.draft)` compiles to `views == "10" OR status == "draft"`.
No warning, no 400; the disjunction just means something else. The flat dialect
answers the same typo differently again — `?views=gtee.10` becomes
`["==", "gtee.10"]`, the whole string as a value.

The neighbouring fallback has the same flavour: a group item with no dot at all becomes
`{column: str, operator: "==", value: true}` (`:457`) — the fabricated `" John" == true`
condition the comma-splitting fix was written for still exists as the *documented*
behaviour of a bare token.

Fix direction: throw from `deserializeLogicalCondition` on an unrecognised operator
token; `parseLogicalGroup` already wraps it in `400 INVALID_LOGICAL_GROUP`
(`query-parser.ts:41`), so the plumbing is there.

### M9 — `count` ignores `vectorSearch`, so `meta.total` and `hasMore` describe a different query

**`packages/server/src/api/rest/api-generator.ts:1105-1115`** and
**`packages/server-postgres/src/PostgresBackendDriver.ts:1186-1202`** — both hand-list
`filter`, `logical`, `searchString` out of an 11-field `FetchCollectionProps`.

`vector_threshold` is applied to the listing as a `WHERE`
(`drizzle-conditions.ts:1887-1888`) and not to the count. `GET
/docs?vector_search=embedding&vector=[…]&vector_threshold=0.2` therefore returns 3 rows
beside `meta.total: 40000` and `hasMore: true`. An `iterate()` walk over that query
sees `hasMore: true` on every page (`paginate.ts:243`) and keeps requesting until it
hits `max-pages` at 10,000 requests — the empty-page guard at `:233` only helps once
the offset runs past the *unfiltered* set.

Fix direction: forward the whole props object into `count`, and decide explicitly
whether a distance threshold is countable. If it is not, refuse `?vector_threshold=`
on `/count` rather than answering with a number about a different query.

### M10 — `?include=` fails open on a typo while every sibling parameter 400s

**`packages/server-postgres/src/services/FetchService.ts:1309`, `:1428`** —
`include[0] === "*" || include.includes(key)`, filtering over declared relations.

An `include` naming nothing simply matches nothing. `?include=authr` returns the rows
with no relation and no error. `?fields=authr` is `400 UNKNOWN_RESPONSE_FIELD`
(`write-validation.ts:332`), `?orderBy=authr` is `400`, `?authr=eq.1` is `400`. One
parameter out of four still behaves the way all of them used to.

Related, in the same neighbourhood: a relation load that *throws* is caught,
`logger.warn`ed and dropped (`FetchService.ts:1327`, `:1343`, `:1451`) — class 4, a 200
with a missing relation.

Fix direction: validate `include` against `resolveCollectionRelations(collection)`
keys at the same place `fields` is validated, honouring the same
`unknownFilterFields` switch.

### M11 — Mongo compiles `array-contains-any` as scalar membership

**`packages/server-mongo/src/db/MongoConditionBuilder.ts:24`** —
`"array-contains-any": "$in"`, then `{ [field]: { $in: value } }` at `:143`.

On an array column Mongo's `$in` does happen to match if any element is in the list,
so the common case is right by accident; but `array-contains` is given the explicit
`$elemMatch` treatment two lines above precisely because the naive form is wrong, and
the two operators are documented as the same question over one value vs. a list. The
Postgres compiler uses `&&` (native array overlap) or `?|` (jsonb) and treats a
non-array operand as `array-contains` (`drizzle-conditions.ts:865-889`); Mongo's
`{$in: "scalar"}` is a Mongo error, not the one-element list Postgres reads it as.
Empty list: Postgres `FALSE`, Mongo `{$in: []}` matches nothing (agrees), offline
`false` (agrees).

Fix direction: normalise the operand with a shared `toMembershipList` in the Mongo
builder too, and confirm the array-column semantics against a real array field — the
current mapping table has no test that distinguishes it from `in`.

---

## LOW

**L1 — `["is-null", undefined]` is type-legal and runtime-rejected.**
`WhereValueFor` gives `is-null`/`is-not-null` the value type `null | undefined`
(`packages/types/src/controllers/data.ts:75`), and
`assertNoUndefinedFilterValues` throws `RebaseClientError` for any tuple whose value is
`undefined`, with no exemption for the null operators
(`packages/client/src/transport.ts:170-171`). `qb.where("x","is-null",undefined)`
compiles and throws.

**L2 — `ListLimitOptions` is a declared extension point nothing sets** (class 21).
`RestApiGenerator`'s fifth parameter (`api-generator.ts:75`) and
`generateOpenApiSpec`'s `listLimits` (`openapi-generator.ts:28`) are both optional and
both defaulted; the single production construction site passes three arguments
(`packages/server/src/init.ts:1486-1489`), and no `RebaseServerConfig` field feeds
them. `ListLimitBounds.vectorDefaultLimit` is likewise never passed by
`resolveListLimitParam` (`query-parser.ts:384-388`), so a REST vector search always
uses the built-in 10.

**L3 — the WebSocket ingress bounds `limit` with the built-in ceiling, not the
generator's.** `packages/server-postgres/src/websocket.ts:371-374` calls
`resolveClientListLimit(request.limit, { vectorSearch })` with no bounds, so if L2 is
ever wired a deployment-configured `maxLimit` would apply to REST and not to
`FETCH_COLLECTION`. Same file casts the raw socket payload straight to
`FetchCollectionProps` (`:360`) and spreads it into the driver, so `offset` reaches the
driver entirely unvalidated on that transport.

**L4 — `searchExplain` is honoured on one route, absent from `QueryOptions`, and
undocumented.** It is read directly out of `queryDict` in the root list handler
(`api-generator.ts:232-233`), is not a field of `QueryOptions`
(`packages/server/src/api/types.ts:42-53`), is not forwarded by the subcollection list
(`:913-923`) or by `fetchRawCollection` (`:1082-1097`), and does not appear in
`listQueryParameters()` (`openapi-generator.ts:49-138`) despite being in
`reservedQueryKeys`.

**L5 — `?or=` + `?and=` silently drops the `and`.** `query-parser.ts:259-265` is an
`if/else if` over one `logical` slot, and the group that loses is the narrowing one.
Documented in the OpenAPI description ("Ignored when `or` is also present"), silent at
runtime. Repeated `?or=` params likewise keep only the last (`getLastValue`).

**L6 — a half-specified vector search is silently ignored.**
`if (vectorSearchVal && vectorVal)` (`query-parser.ts:329`) — `?vector_search=embedding`
without `?vector=` returns an ordinary unordered page with no `_distance` and no error,
and `?vector_threshold=` alone is discarded. Both names are reserved, so neither is
readable as a filter either.

**L7 — the in-process `listen` does not normalise a wire-form `where` while `find` and
`count` do.** `buildRebaseData.ts:164` and `:307` call `deserializeFilter(params.where)`;
`:331` passes `params?.where` raw. `toFilterTuples` returns `[]` for a non-array
(`packages/common/src/data/filter-conditions.ts:38`), so a
`{status: "eq.active"}` filter on the listen path is dropped and the subscription
receives every row. `WireFilterValues` is `@internal`, so reachability is limited to
untyped callers.

**L8 — Mongo realtime cannot carry `logical` or `offset` at all.**
`CollectionSubscriptionConfig` (`packages/types/src/types/backend.ts:236-248`) declares
neither; `MongoDriver.listenCollection` destructures ten named fields
(`packages/server-mongo/src/services/MongoDriver.ts:178-189`) and
`MongoRealtimeService.fetchAndNotifyCollection` re-lists seven
(`MongoRealtimeService.ts:158-166`). So `.where(or(…)).listen()` against a Mongo
backend pushes every row the policies allow. Postgres carries both through
`StoredCollectionRequest` (`realtimeService.ts:85-97`) — the asymmetry is in the shared
type, which is why no boundary objects.

**L9 — the Mongo LIKE→regex translation collapses only *consecutive* wildcards.**
`likePatternToRegExp` (`MongoConditionBuilder.ts:37-57`) turns runs of `%` into one
`.*`, which closes the `%%%%X` case, but `%_%_%_%_X` alternates and produces adjacent
`.*` / `.` quantifiers that the collapse does not see. The expression is handed to
MongoDB as `$regex`, so the cost lands on a database thread (class 24). UNCONFIRMED —
not measured, and the offline evaluator (`offline-query.ts:146-176`) has the identical
shape.

**L10 — a list operand reaches operators that take a scalar.** `?age=gt.(1,2)` decodes
to `[">", ["1","2"]]` (empirically confirmed) and `buildSingleFilterCondition`
binds the array into `column > $1`; `?title=like.(a,b)` reaches
`sql\`${column} LIKE ${String(value)}\`` as the pattern `"a,b"` (`:903`). The type layer
refuses both (`query-contract.types.ts:138`), so this is wire-only.

**L11 — comparison operators have no null branch.** `>` `>=` `<` `<=` bind whatever
they are given (`drizzle-conditions.ts:830-837`), so `[">", null]` becomes
`column > NULL` — always unknown, zero rows, no error. `==`/`!=`/`in`/`not-in` all have
explicit null handling; these four are the gap in the same switch.

---

## Checked and clean

- **`limit`** — `resolveClientListLimit` (`packages/types/src/controllers/data_driver.ts:122`)
  is genuinely airtight: `Number` not `parseInt`, integer, `[1, maxLimit]`, refused not
  clamped, absent falls back to the mode-correct default, and every REST ingress plus
  the WebSocket ingress routes through it. `ListLimitError` carries `status` and is
  converted to `ApiError.badRequest` at the HTTP boundary (`query-parser.ts:216-228`).
- **`orderBy` shape and direction** — `parseOrderByParam` refuses an object, a number,
  a boolean, `null`, and `["name"]`; `toDirection` refuses anything that is not
  `asc`/`desc` in any case, and the parser deliberately does *not* route through
  `deserializeOrderBy` (which would collapse `:DESC` to `asc`). The docblock at
  `query-parser.ts:135-153` documents the earlier failure accurately.
- **`orderBy` field, Postgres** — unknown field is a 400 with the valid list, a to-many
  relation gets its own distinct 400, `_score` is accepted only with a `search` block
  *and* a search string, and an owning relation resolves through the relation's own
  `localKey` before falling back to guesses (`FetchService.ts:135-220`).
- **Unknown filter field, Postgres** — 400 `UNKNOWN_FILTER_FIELD` with the valid list;
  the `warn` mode is opt-in and logs. The `logical` leaf path resolves through the same
  function with the same mode (`drizzle-conditions.ts:571-578`).
- **`?where=` JSON dialect** — malformed JSON, a non-object and an array are all 400
  `INVALID_WHERE`; canonical tuples short-circuit `deserializeFilter` so JSON types
  (numbers, booleans, `null`) survive; merging with the dot dialect is per-field with
  the explicit parameter winning, as documented.
- **Comma and paren escaping inside lists and groups** — `escapeWireValue` /
  `unescapeWireValue` / `splitListItems` / `splitGroupItems` round-trip
  `["a,b","c"]` and `["(x)","y"]` correctly (empirically confirmed), and
  `unescapeWireValue` is conservative about a stray backslash for the cross-version
  reason its docblock gives.
- **Nesting depth** — `MAX_LOGICAL_NESTING_DEPTH = 32`, counted on a parameter that
  cannot be shadowed by the paren counter, surfaced as 400 `INVALID_LOGICAL_GROUP`.
- **Vector parameter validation** — non-array, non-numeric, bad distance function and
  non-numeric threshold are all 400s, and the array check sits outside the `try` so its
  `ApiError` is not swallowed by the JSON catch.
- **`?fields=`** — validated against declared properties + relations + `include` names,
  400 `UNKNOWN_RESPONSE_FIELD`, and primary keys are always retained
  (`write-validation.ts:303-354`).
- **Empty `in` / `not-in` / `array-contains-any` at the compiler** — `FALSE` / `TRUE` /
  `FALSE` respectively, never "no condition"; the reasoning is written down
  (`drizzle-conditions.ts:838-901`). Correct — just unreachable over HTTP (H2).
- **Relation filters** — `!=` compiles to `NOT EXISTS` of the positive predicate rather
  than `EXISTS` of the negated one; junction columns are referenced by identifier
  against a local alias so they cannot be mis-qualified; an operator the shape cannot
  express is a 400 rather than a drop.
- **Multiple tuples on one field** — `toFilterTuples` reads `[[">=",18],["<",65]]`
  correctly in all three compilers, and the client's `where()` accumulates into that
  shape (`sdk_query_builder.ts:56-68`).
- **`buildQueryString`** — forwards all ten `FindParams` fields (the one hop in this
  unit where class 17 does *not* apply).
- **`paginateFind`** — `IterateParams` omits `limit`/`offset`/`page` at the type level,
  the walk advances by rows received rather than page size, never infers `hasMore` from
  `rows.length`, and has both a page cap and a row cap with named error codes.
- **The typed query contract** — `packages/client/src/query-contract.types.ts` is a
  genuine gate (a real `src` module, not a `.test.ts`), its fixture has no index
  signature, and its `@ts-expect-error`s cover the operator-value correlation, `_score`,
  and relation-by-id.
- **`escapeLikePattern`** — the `searchString` path escapes `\`, `%` and `_` in the
  right order; the `like` *operator* deliberately does not, which is correct.

---

## Open questions

1. **Is the dot dialect's "unknown prefix → equality value" fallback still the right
   default?** `?slug=eq.something` cannot express the literal value `eq.something`, and
   `?note=gt.foo` silently becomes a comparison. Both have a `?where=` escape hatch, but
   nothing tells a caller that. Worth a documented note at minimum.
2. **Should the offline evaluator's `default: return true`
   (`offline-query.ts:235`) really widen?** The comment argues an unknown operator must
   not drop rows, which is the opposite of the choice every server-side compiler makes.
   One of the two is wrong; the local one is at least not a security boundary.
3. **`in`/`not-in` against a null row value diverge between Postgres and the offline
   evaluator.** `["in", null]` is `IS NULL` in Postgres and `false` offline
   (`offline-query.ts:209`); `not-in []` is `TRUE` in Postgres and `false` for null rows
   offline. A cached read and a live read answer differently. Is the offline evaluator
   meant to be SQL-faithful?
4. **Does anything constrain query-parameter *keys* before they reach Mongo?** With no
   field validation (H3), a `$`-prefixed key like `?$and=eq.1` becomes
   `{$and: {$eq: "1"}}` and reaches the server as a MongoServerError → 500 rather than
   400. I found no path to a *useful* operator injection (every value is wrapped in an
   operator object), but the boundary is unguarded and I did not test it against a live
   Mongo. UNCONFIRMED.
5. **Is `?include=` supposed to work on the non-Postgres fallback at all?**
   `fetchRawCollection` (`api-generator.ts:1082-1097`) does not forward it, and
   `FetchCollectionProps` has no `include` field — so on Mongo/Firebase the parameter is
   parsed, used only for `projectResponseFields`' allowlist, and never eager-loads
   anything. Deliberate, or the last surviving instance of the `?fields=`-on-two-of-four
   defect?
6. **How many collections in the wild actually have a column named `page`, `include`,
   `or`, `and`, `fields` or `vector`?** M4's severity turns entirely on that. A one-off
   scan of the introspection fixtures and the examples would settle it.
