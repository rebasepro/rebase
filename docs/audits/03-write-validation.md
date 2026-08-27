# Audit — Unit 3: write validation & coercion

Read-only audit of `packages/server/src/api/rest/write-validation.ts`,
`packages/server-postgres/src/data-transformer.ts`, the write routes in
`packages/server/src/api/rest/api-generator.ts`, and the pipeline they call into
(`PostgresBackendDriver.save/saveMany/updateMany` → `PersistService.save` →
Drizzle). 2026-08-08.

## Verdict

There is no value validation on the write path. `assertKnownWriteFields` checks
that a *key* is declared and nothing checks the *value*: not its type, not its
range, not `validation.min/max/matches/positive/integer`, not the property's
`defaultValue`. Everything below the key check is either passed through to
Postgres verbatim or silently coerced by `serializePropertyToServer` /
`sanitizeAndConvertDates`. Three of those coercions destroy caller data without
an error — an array property handed a non-array becomes `[]`
(data-transformer.ts:252), the string `"Nan"` on any property becomes `NULL`
(data-transformer.ts:57), and `{ field: undefined }` through the in-process SDK
becomes an explicit `NULL` (data-transformer.ts:49). Worse, the premise
`assertKnownWriteFields` is built on is false: its own doc comment says unknown
keys "used to travel all the way into the INSERT, where Postgres rejected them",
but Drizzle builds INSERT and UPDATE from the *table's* column list, so an
unknown key is silently dropped and the request answers 201 — I verified this
against the installed `drizzle-orm@0.45.2` (see Finding 1). That makes the key
check the only thing between a typo and a silent no-op, and it is disabled on
four separate paths, including the `strictWrites: false` escape hatch whose
documented purpose (writing to a column the config never declared) cannot work
at all. The same silent-drop mechanism makes `geopoint` — a first-class,
documented property type with an admin field binding, an OpenAPI schema and a
codegen type — completely unpersistable on Postgres: the Drizzle generator emits
no column for it and every write to it is discarded with a 201. Meanwhile the
published OpenAPI spec advertises `minimum`, `maximum`, `minLength`, `maxLength`
and `pattern` that no layer enforces. Validation errors, where they exist, are
good: they name the field, the row index and the known-field list — but that
list includes `excludeFromApi` columns, so a typo tells the caller that
`passwordHash` exists.

---

## Critical

None. The two highest-impact defects below are silent data loss, not privilege
escalation: the auth-collection restrictive RLS gate
(`packages/common/src/util/auth-default-policies.ts:123-129`) does hold, so a
non-admin cannot reach `passwordHash` or `roles` even though both are writable
field names.

---

## High

### 1. Unknown keys are silently dropped by Drizzle, not rejected by Postgres — so every path that skips `assertKnownWriteFields` loses data with a 201

`packages/server/src/api/rest/write-validation.ts:8-11` (the premise),
`packages/server/src/api/rest/api-generator.ts:146-149` (the same premise
repeated), `packages/types/src/types/collections.ts:210-220` (the escape hatch
built on it).

Both comments assert that an unknown key reaches the INSERT and comes back as a
Postgres error. It does not. `drizzle-orm@0.45.2`'s
`PgDialect.buildInsertQuery` iterates `Object.entries(table[Symbol.Columns])`
(`node_modules/.pnpm/drizzle-orm@0.45.2_*/node_modules/drizzle-orm/pg-core/dialect.cjs:360-361`)
and `buildUpdateSet` iterates `Object.keys(tableColumns)` (same file, :103-106).
Keys absent from the table are never emitted. Verified by building the SQL
without a database:

```
db.insert(posts).values({ id:"1", title:"a", titel:"typo", geo:{lat:1} }).toSQL()
→ insert into "posts" ("id", "title") values ($1, $2)   -- titel, geo gone, no error
```

`assertKnownWriteFields` is therefore the *only* guard, and it is skipped on
four paths: `collection.strictWrites === false` (write-validation.ts:27), a
collection with no declared properties (:33), an auth collection whose adapter
returns `{ validate: false }` — which the built-in adapter does for any
collection configuring `onCreateUser`
(`packages/server/src/auth/builtin-auth-adapter.ts:273-274`), and a nested route
whose target collection cannot be walked (`api-generator.ts:927, :959`, guarded
by `if (targetCollection)`).

The `strictWrites: false` doc is the sharpest case. It says the flag exists for
"where a column really does exist that the config never declared, populated by a
trigger or a default". The Drizzle table is generated *from* the config
(`packages/server-postgres/src/collections/buildRegistry.ts:43-49` registers the
tables from `schema.generated.ts`), so an undeclared column is not in the table
object and the value is dropped before SQL is built. The escape hatch cannot do
the one thing it was added for on the declared-collection path. (In pure BaaS
mode, where the tables are introspected from the live database, it would work —
which is presumably where the belief came from.)

Failure scenario: a collection sets `strictWrites: false` to write a
trigger-populated `search_rank` column. `POST /docs {"title":"x","search_rank":5}`
→ `201 Created`, `search_rank` never written, no log line, no error. Or:
`rebase.dataAsAdmin.posts.update(id, { titel: "x" })` → the UPDATE builds as
`update "posts" set  where "posts"."id" = $1` (verified) → Postgres syntax error
→ `toUserFriendlyError` sees SQLSTATE 42601, which is not class 22/23, so it
returns a bare `Error` → **500** for what is a caller typo.

Fix direction: correct both comments. Then make the key check the driver's job
rather than the REST layer's — `PersistService.save` knows the Drizzle table and
can diff `Object.keys(entityData)` against `table[Symbol.Columns]` and raise a
400 naming the dropped keys. That closes all four bypasses at once, and gives
`strictWrites: false` a truthful implementation (allow the key, but only if the
column actually exists on the table).

### 2. `geopoint` is a supported, documented property type that Postgres silently discards on every write

`packages/server-postgres/src/schema/generate-drizzle-schema-logic.ts:111` (the
switch), `:343` (`default: return null`), `:661` (`if (columnString)
columns.add(columnString)`).

`getDrizzleColumn` has cases for string, number, boolean, date, map, array,
vector, binary, relation and reference. `geopoint` falls to `default: return
null`, and the caller drops a `null` column **without a warning**. The DDL
generator, by contrast, does emit a column: `getSqlColumnType`
(`generate-postgres-ddl-logic.ts:142`) also has no `geopoint` case and falls to
`default: return "TEXT"` (:246). So the database gets a `TEXT` column and the
runtime's Drizzle table gets nothing.

Everything upstream says the type works: `PropertyType` includes it
(`packages/types/src/types/properties.ts:42, :455`), `validate-config.ts:175`
allows it, the OpenAPI generator emits a `{latitude, longitude}` object schema
(`packages/server/src/api/openapi-generator.ts:846-853`), codegen emits a TS type
(`packages/codegen/src/generate-types.ts:86`), the admin ships
`GeopointFieldBinding.tsx`, and the docs table promises `geopoint` → `jsonb`
(`website/src/content/docs/docs/collections/properties.mdx:27`).

Failure scenario: a collection declares `location: { type: "geopoint", name:
"Location" }`. `POST /places {"name":"X","location":{"latitude":1,"longitude":2}}`
→ `assertKnownWriteFields` passes (it is a declared property) → Drizzle omits
the key → `201 Created` with `location` absent from the response and `NULL` in
the database. Every write, forever, with no log line. The admin's geopoint field
appears to save and the value is gone on refresh.

Fix direction: either add a `geopoint` case to both generators (jsonb, matching
the doc) plus a `serializePropertyToServer`/`parsePropertyFromServer` pair, or
make `getDrizzleColumn` returning `null` a hard startup error rather than a
silent skip. The second is the class-21 fix and would have caught this the day
the type was added.

### 3. A non-array value on an `array` property is silently replaced with `[]`

`packages/server-postgres/src/data-transformer.ts:252-254`.

```ts
// Non-array value for an array property — coerce to avoid .map() crashes downstream
logger.warn(`Expected array value for array property, got ${typeof value}. Coercing to empty array.`);
return [];
```

This is bug class 23 exactly: a limit that clamps instead of rejecting. The
caller's value is destroyed rather than refused, the response is 201/200, and
the only signal is a `logger.warn` that names neither the collection, the
property, nor the value — three tests enshrine the behaviour
(`packages/server-postgres/test/data-transformer.test.ts:168, :201, :205, :210`,
`test/array-null-safety.test.ts:110-124`), which is class 7 on top.

Failure scenario: `POST /posts {"title":"x","tags":"news"}` (a client that sent a
single tag as a scalar, or a CSV import that did not split a column) → `201
Created`, `tags` stored as `[]`. The caller has no way to distinguish "I sent a
scalar and you dropped it" from "you stored an empty list", and re-reading the
row confirms the empty list. On a `text[]` column this is unrecoverable data
loss on import.

Fix direction: `throw ApiError.badRequest` naming the property and the received
type. The stated reason for coercing — "avoid `.map()` crashes downstream" — is
solved better by rejecting at the boundary. The read-side twin
(`data-transformer.ts:600-604`, non-array from the DB → `[]` or `[value]`) is
defensible because a row already in the database is not the caller's fault; the
write side is.

### 4. `{ field: undefined }` through the in-process SDK writes `NULL`

`packages/server-postgres/src/data-transformer.ts:49-51`, reached from
`packages/server-postgres/src/services/PersistService.ts:308`.

`sanitizeAndConvertDates` maps `undefined` to `null`. `serializeDataToServer`
copies every own key of the input including ones whose value is `undefined`
(:135, `Object.entries(row)`), so the key survives into `entityData` with the
value `null`, and `buildUpdateSet`'s `set[colName] !== void 0` test then sees a
present value and emits `col = NULL`.

Over HTTP this is unreachable (JSON has no `undefined`), but the in-process data
API passes the caller's object straight through:
`packages/common/src/data/buildRebaseData.ts:265-273` →
`driver.save({ values: data, status: "existing" })`. Its signature is
`Partial<EntityValues<M>>`, and without `exactOptionalPropertyTypes` TypeScript
accepts an explicit `undefined` for every optional key.

Failure scenario: inside a function or a cron job,

```ts
await rebase.dataAsAdmin.posts.update(id, { title: payload.title, subtitle: payload.subtitle });
```

where `payload.subtitle` is absent. Every developer reads this as "leave
`subtitle` alone" — Drizzle itself would skip an `undefined` value. Rebase nulls
the column. On a `NOT NULL` column it is a confusing 400 blaming a field the
caller never meant to touch; on a nullable one it is silent data loss on every
partial update built by spreading an optional object.

Fix direction: drop keys whose value is `undefined` in `serializeDataToServer`
before they reach `sanitizeAndConvertDates`, and keep `undefined → null` only
for values nested inside a JSON payload (where it is a real JSON constraint).

---

## Medium

### 5. `validation.min/max/matches/positive/negative/lessThan/moreThan` and the date/array bounds are enforced nowhere — but the OpenAPI spec advertises them

`packages/server/src/api/openapi-generator.ts:780-790` (string
`minLength`/`maxLength`/`pattern`) and `:811-822` (number
`minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`).

Grepping every read of these fields across the repo returns only three
consumers: the DDL/Drizzle generators reading `validation.integer` to choose
`INTEGER` vs `NUMERIC`, `resolveStringColumnLength` reading `validation.max` for
`varchar`/`char` widths, and the admin's client-side form. Nothing on the server
write path reads any of them, and `generate-postgres-ddl-logic.ts` emits no
`CHECK` constraint at all (the only `CHECK` in that file, :127, is an RLS `WITH
CHECK`). Only `required` (→ `NOT NULL`, :653) and `unique` (→ `UNIQUE`, :642)
reach the database.

`validation.max` on a string is enforced only when `columnType` is `varchar` or
`char`; the default is `TEXT` (`generate-postgres-ddl-logic.ts:166-170`), so the
common case is unbounded. The comment on `resolveStringColumnLength`
(`packages/common/src/util/string-column-length.ts:21-24`) claims the column
width "keeps the constraint the database enforces in step with the one the app
enforces" — the app enforces nothing.

Failure scenario: the docs' own example
(`website/src/content/docs/docs/collections/properties.mdx:227`) is
`price: { type: "number", validation: { required: true, min: 0 } }`. The
generated OpenAPI says `"minimum": 0`. `POST /products {"price": -5000}` →
`201 Created`. A spec-validating gateway in front of the API would reject what
the server accepts, and any client generated from the spec believes the server
checks. Same for `matches` on a string used as a slug or a phone number.

Fix direction: either enforce them in a value-validation pass on the write path
(a per-property check next to `assertKnownWriteFields`, reporting one 400 that
names every failing field), or emit `CHECK` constraints, or — at minimum — stop
publishing the constraints in the OpenAPI schema and document `validation` as
admin-form-only. Publishing an unenforced contract is the worst of the three.

### 6. `defaultValue` is applied by the admin form and by nothing else

`packages/types/src/types/properties.ts:279, :351, :389, …` declare a typed
`defaultValue` on every concrete property type. The only implementation is
`getDefaultValuesFor` in the admin form
(`packages/cms/src/form/form_utils.ts:209-210`). A repo-wide grep for
`defaultValue` under `packages/server/src` and `packages/server-postgres/src`
returns exactly one hit — the allow-list entry in
`validate-config.ts:158` — so the server never applies it, and neither generator
turns it into a SQL `DEFAULT`.

Failure scenario: the scaffolded `users` collection declares
`emailVerified: { type: "boolean", defaultValue: false }`
(`packages/common/src/collections/default-collections.ts:72-77`). Creating a user
through the admin form gives `false`. Creating the same user through
`POST /users` or `rebase.dataAsAdmin.users.create({...})` gives `NULL`. Two
creation paths on one collection config produce two different rows — class 2 —
and downstream code doing `if (!user.emailVerified)` happens to survive while
`user.emailVerified === false` does not.

Fix direction: apply defaults server-side for absent keys on `status: "new"`
(next to `updateDateAutoValues`, which is the existing precedent for
"application layer fills a column in"), or emit them as SQL `DEFAULT`s so both
paths agree.

### 7. A bulk upsert re-stamps `createdAt` on rows that already existed

`packages/server-postgres/src/PostgresBackendDriver.ts:852-868` (bulk rows are
saved with `status: "new"` plus `upsert`), `:643-652` (`updateDateAutoValues`
runs before the write), `packages/common/src/util/entities.ts:86-94` (status
`"new"` stamps both `on_create` *and* `on_update` properties),
`packages/server-postgres/src/services/PersistService.ts:376-385` (`set` is
`{...dataForInsert}` minus key columns, so the stamped `created_at` is in the
conflict-update).

The `status: "new"` choice is deliberate and documented at :859-864 (an import's
rows carry a natural key for rows that may not exist). But it also means the
`on_create` timestamp is computed for every row, and `onConflictDoUpdate` then
writes it over the existing row's value.

Failure scenario: a nightly `POST /products/bulk {"rows":[…], "upsert":true}`
re-import. Every product that already existed has `createdAt` reset to the
import time. Any "new this week" query, cohort report, or ordering by creation
date is wrong after the first re-run, and nothing in the response says so.

Fix direction: strip `on_create` properties from the `set` object in the
conflict-update branch, or compute the auto-values per row after the insert/
update decision is known.

### 8. A JSON body that is not an object is either a 500 or a silently created empty row

`packages/server/src/api/rest/api-generator.ts:18-26`.

`parseJsonBody` returns `JSON.parse(raw)` cast to `Record<string, unknown>` with
no check that the parse produced an object.

- Body `null` → `assertKnownWriteFields(null, …)` → `Object.keys(null)` throws
  `TypeError: Cannot convert undefined or null to object` (verified) → 500.
- Body `123` or `[]` → `Object.keys` yields `[]` → the check passes → `driver.save`
  with `values: 123` → `serializeDataToServer` yields `{}` → Drizzle builds
  `insert into "posts" ("id","title") values (default, default)` (verified) →
  **201 Created, with a row of database defaults inserted**.
- Body `"abc"` → `Object.keys("abc")` is `["0","1","2"]` → 400 complaining the
  collection has no fields `'0','1','2'`, which is a baffling message for
  `Content-Type: application/json` with a bare string.

Fix direction: one guard in `parseJsonBody` — reject anything that is not a
plain object with `ApiError.badRequest("Expected a JSON object body.")`. Cheap,
and it fixes all four shapes.

### 9. The unknown-field error discloses `excludeFromApi` column names

`packages/server/src/api/rest/write-validation.ts:66-71` builds `known` from
every declared property (:35) and prints the whole set.

`excludeFromApi` is documented as a server-side guarantee that a column "is
stripped from every row the API serves, for every caller, including admins and
service keys" (`packages/types/src/types/properties.ts:220-232`), and
`stripExcluded` (`packages/server-postgres/src/services/row-pipeline.ts:104-117`)
honours that on reads. The write-side error hands the names back.

Failure scenario: `POST /users {"emial":"a@b.c"}` →
`400 'users' has no field 'emial'. Known fields: 'createdAt', 'displayName',
'email', 'emailVerificationSentAt', 'emailVerificationToken', 'emailVerified',
'id', 'metadata', 'passwordHash', 'photoURL', 'roles', 'updatedAt'.` The check
runs before `driver.save`, so RLS has not yet had a say — any caller who gets
past `enforceApiKeyPermission` learns the full schema including the two secret
columns, and learns that `passwordHash` is a writable field name. (Whether an
*anonymous* caller reaches this depends on `dataRequireAuth`
(`packages/server/src/init.ts:1405-1421`) — UNCONFIRMED for the default config;
confirming would mean checking `resolveRequireAuth`'s default.)

Related, and worth deciding explicitly rather than by omission: `excludeFromApi`
columns *are* writable by design — `packages/codegen/src/generate-types.ts:381-382`
states "they are stripped from *responses*, not from writes". For the built-in
`users` collection the restrictive admin-write policy
(`packages/common/src/util/auth-default-policies.ts:123-129`) makes that safe.
For a non-auth collection with a permissive "owner may update their own row"
rule and an `excludeFromApi` secret, it is not.

Fix direction: omit `excludeFromApi` properties from the printed known-field
list (they are not fields a caller should be sending anyway), and consider
rejecting writes to them unless the write comes from the server context.

### 10. `reference` and `geopoint` have no write serializer, so the documented value shape fails while `relation`'s succeeds

`packages/server-postgres/src/data-transformer.ts:213-298`. The switch handles
`relation`, `array`, `map`, `vector`, `binary` and `string`/default. There is no
case for `reference`, `geopoint`, `boolean`, `number` or `date`.

For `relation`, an object value is unwrapped to its `id` (:224-226). For
`reference` — whose `defaultValue` is typed `EntityReference`
(`packages/types/src/types/properties.ts:487`) and which gets a real
`INTEGER`/`UUID`/`TEXT` column in both generators
(`generate-postgres-ddl-logic.ts:239-245`,
`generate-drizzle-schema-logic.ts:319`) — the object falls to `default:` and is
passed through, reaching an integer or uuid column as a stringified object.

Also within `relation`: the unwrap is `"id" in value`. A `belongsTo` whose target
is keyed on something other than `id` (a `sku`, a composite key) does not match,
so the whole object is written to the FK column. This makes a read-then-write
round trip fail: `GET /orders/1?include=product` inlines the product's columns
under `product` (`row-pipeline.ts:232-233`), and `PUT`ing that body back writes
the object rather than the key.

Failure scenario: `POST /docs {"owner":{"id":"u1","path":"users"}}` on a
`reference` property → node-postgres serialises the object → `22P02 invalid
input syntax for type uuid` → 400 with a Postgres message, for the exact value
shape the type definition documents.

Fix direction: give `reference` the same unwrap `relation` has, and make
`relation`'s unwrap key off the target collection's resolved primary key rather
than the literal name `id`.

---

## Low

### 11. `"NaN"` in any string field becomes `NULL`

`packages/server-postgres/src/data-transformer.ts:57-59`:

```ts
if (typeof obj === "string" && obj.toLowerCase() === "nan") return null;
```

`sanitizeAndConvertDates` runs over the whole serialised row
(`PersistService.ts:308`), untyped — it does not know which property it is
looking at. The `toLowerCase()` widens the match well past the JS `NaN`
sentinel. A test pins it (`test/data-transformer-hardening.test.ts:220`).

Failure scenario: `POST /contacts {"firstName":"Nan","lastName":"Smith"}` —
"Nan" is a real given name and a very common grandmother nickname. The row is
stored with `first_name = NULL`. If the column is `NOT NULL` the caller gets a
400 saying `null value in column "first_name" violates not-null constraint`,
blaming a field they did in fact send a value for. It also fires on a `sku`,
`code` or `slug` column whose value happens to be the three letters.

Ranked low only because the blast radius is narrow; it is the same class as
finding 3 and should be fixed with it. Fix direction: apply the NaN check only
to values whose property is `type: "number"`, which means moving it into
`serializePropertyToServer` where the property is in scope.

### 12. Any ISO-8601 string is rewritten on any property

`packages/server-postgres/src/data-transformer.ts:85-94`. The same untyped walk
rewrites a string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$` (or
the JS `Date.toString()` form) into `new Date(v).toISOString()`.

Failure scenario: a `text` column storing an externally supplied identifier or a
raw log line that happens to be an ISO timestamp — `POST /events
{"external_id":"2024-01-01T00:00:00Z"}` stores `"2024-01-01T00:00:00.000Z"`. The
value read back is not the value written, and a lookup by the original string
misses. Same fix as 11: scope the conversion to `type: "date"` properties.

### 13. Bulk envelope errors do not name the offending index

`packages/server/src/api/rest/api-generator.ts:350-355`:
`"Every entry in \`rows\` must be an object."` — with a 1000-row cap, that is
unactionable. The neighbouring checks get this right: `assertKnownWriteFields`
takes a `rowIndex` (write-validation.ts:48), the `updates` shape check names
`Entry ${rowIndex}` (:443, :450), and `saveMany` labels the failing row
(`PostgresBackendDriver.ts:873-881`). Fix direction: `findIndex` instead of
`some`, and report it.

### 14. The coercion warnings identify nothing

`data-transformer.ts:253` and `:602` log `"Expected array value for array
property, got string"` with no collection, property key, row id or value. In a
log stream from a bulk import there is no way to tell which of 1000 rows and
which of 12 properties it refers to — the warning is the only trace the data
loss leaves, and it is not enough to find it. `serializePropertyToServer`'s
signature does not carry the key, which is why; passing it is a one-line change.

---

## Checked and clean

- **Prototype pollution on writes.** `isPrototypePollutingKey` is applied in
  both `sanitizeAndConvertDates` (:79) and `serializeDataToServer` (:138), with
  the `JSON.parse`-creates-`__proto__`-as-own-property reasoning spelled out and
  covered by `test/write-prototype-safety.test.ts`.
- **Bulk paths run the full pipeline.** `saveMany`, `updateMany` and `deleteMany`
  loop the single-row driver methods inside one transaction rather than emitting
  a single statement, so `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`,
  history and realtime all run identically to a single write
  (`PostgresBackendDriver.ts:831-1010`). The comment at :963-973 makes the
  reasoning explicit. `updateMany` reads first so a missing id is a 404 rather
  than a silent no-op (:926-936).
- **Field-name validation on the bulk paths.** `POST /bulk` and `PATCH /bulk`
  both call `assertKnownWriteFields` for every row *before* the transaction
  opens, with the row index in the message (api-generator.ts:394-395, :454).
- **Nested writes no longer reparent.** `PersistService.save` checks membership
  for an update through a parent path rather than injecting the FK
  (`PersistService.ts:232-241`); the comment names the `PUT authors/1/posts/43`
  theft it fixed.
- **Error classification.** `toUserFriendlyError` (`PersistService.ts:468-509`)
  keeps an existing `ApiError` intact (matched by name as well as `instanceof`,
  for the duplicated-module case), maps SQLSTATE class 22/23 to 400/409 and
  leaves everything else a 500. That is the right split and the comment argues
  it well.
- **`assertKnownWriteFields`' own logic.** Owning-relation local keys are added
  to the known set (:39-41), auth credential fields come from the adapter
  contract rather than a hardcoded list (:43, api-generator.ts:548-553), and the
  `id`-on-a-non-`id`-keyed-collection case gets a dedicated message naming the
  real key columns (:53-64). The empty-`properties` bail (:33) is correctly
  reasoned.
- **`projectResponseFields`** rejects unknown `fields` with a named error and
  always keeps the collection's real primary keys, not a literal `id`
  (write-validation.ts:139-143).
- **Auth-collection privilege escalation via writable columns.** The restrictive
  `<table>_require_admin_write` policy is AND'd with every permissive rule
  (`packages/common/src/util/auth-default-policies.ts:120-129`), so a user with
  an "edit your own row" rule still cannot write `roles`, `passwordHash` or
  `emailVerified`. The reasoning is documented at :30-34.
- **Enums are enforced.** A string or number property with `enum` gets a real
  Postgres `CREATE TYPE … AS ENUM` (`generate-postgres-ddl-logic.ts:428-437`), so
  an out-of-set value is a 22P02 → 400. This is the one property-level
  constraint the platform actually enforces end to end.
- **Idempotency on writes.** The single-create path claims before the write and
  releases on failure (api-generator.ts:599-639), and the auth-signup branch is
  deliberately excluded because its response can carry a temporary password
  (:595-598).

---

## Open questions

1. **Is `dataRequireAuth` false by default?** Finding 9's severity depends on
   whether an unauthenticated caller reaches the write routes at all. Confirming
   means reading `resolveRequireAuth` in `packages/server/src/init.ts` and the
   `auth` config default.
2. **What does BaaS/introspected mode do with `strictWrites: false`?** In that
   mode the Drizzle tables are introspected from the live database
   (`buildRegistry.ts:9-12`), so undeclared columns *are* on the table object and
   the escape hatch would work. If so, finding 1's escape-hatch half is
   declared-collections-only and the doc needs to say which mode it describes.
   UNCONFIRMED — I did not exercise the introspection path.
3. **Does an `INTEGER` column reject `3.7`, or round it?** A `number` property
   with `validation: { integer: true }` becomes `INTEGER`. Whether node-postgres
   sends `3.7` as an untyped parameter (Postgres then errors, 22P02) or as a
   typed one (Postgres rounds to 4, silently) decides whether this is a fourth
   silent coercion. Confirming needs one round trip against a real database,
   which is outside this audit's remit.
4. **Should `validation` be enforced at all, or renamed?** Finding 5 has two
   honest resolutions and they point in opposite directions. If the intent is
   "these are form hints", the OpenAPI emission is the bug and the docs need a
   sentence. If the intent is "these are the contract", the write path needs a
   value-validation pass and the admin's yup schema should be derived from the
   same source so the two cannot drift. Someone has to pick.
5. **Is there an admin CSV/import path that does not go through these routes?** I
   found no server-side import endpoint — the admin appears to write through the
   same REST bulk routes — but I did not read the admin's import UI, so a
   direct-driver import path would be a fifth `assertKnownWriteFields` bypass.
