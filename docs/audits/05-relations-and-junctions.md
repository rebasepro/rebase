# Unit 5 — Relations and junction tables

Read-only audit, current `main` (`c678e1745`). Scope: `validate-relations.ts`,
`RelationService`, the relation handling in `FetchService`, junction generation in
`schema/`, the derived junction RLS, and the FK naming / derived-names contract.

## Verdict

**The headline question — can including a relation return rows the caller could not
read directly? — answers NO.** Every relation read path is constructed on the
per-request transaction (`AuthenticatedPostgresBackendDriver.withTransaction`
builds `new DataService(tx, …)` at
`packages/server-postgres/src/PostgresBackendDriver.ts:1622`, and `FetchService`
hands that same handle to `RelationService` at
`packages/server-postgres/src/services/FetchService.ts:41`), so `SET LOCAL ROLE
rebase_user` binds the relation queries exactly as it binds the primary one. The
m2m batch read is an ordinary `INNER JOIN` over junction + target
(`RelationService.ts:926-930`), both RLS-filtered; the derived
`<junction>_default_edge_read` policy is a conjunction of two correlated `EXISTS`
that themselves run under the caller's role
(`packages/common/src/util/junction-policies.ts:293-300`). I found no join that
escapes RLS.

What I did find is a different failure family, and it is the one the m2m
delete-all→diff fix was an instance of: **relation work that fails, or is
truncated, or is written from a stale shape, and says nothing.** One of these
(H1) makes a documented write always fail; two more (H2, M1) turn a database
error or an oversized result into a silent 200 with data missing. And the naming
side of the contract has no collision detector at all: two relations can derive
the same junction table, the same junction columns, or the same relation name,
and the first one silently wins.

Counts: **2 high, 7 medium, 6 low.**

---

## HIGH

### H1 — `sql.join` with no separator: writing a `hasMany` with two or more children always raises a syntax error

`packages/server-postgres/src/services/RelationService.ts:1229`

```ts
.where(and(eq(fkCol, parentKeyValue), sql`${targetIdCol} NOT IN (${sql.join(parsedTargetIds)})`));
```

Drizzle's `sql.join(chunks, separator?)` inserts the separator only when one is
given (`drizzle-orm/sql/sql.js:306-315`); with it omitted the chunks are
concatenated. Rendered against the real dialect:

```
$ sql`x NOT IN (${sql.join([1,2,3])})`   →   x NOT IN ($1$2$3)      params [1,2,3]
$ sql`x NOT IN (${sql.join([1,2,3], sql`, `)})` → x NOT IN ($1, $2, $3)
```

`$1$2$3` is a syntax error in Postgres. This is the only `sql.join` in the
workspace without a separator — the other ten call sites all pass one
(`utils/drizzle-conditions.ts:383,404,409,766,877,881,900`,
`auth/services.ts:380`, `history/HistoryService.ts:76`,
`services/dataService.ts:217`), which is what marks this as a slip rather than a
convention.

**Failure scenario.** `PUT /api/data/authors/1` with body `{"posts": ["p1","p2"]}`
reaches `updateRelationsUsingJoins`'s inverse-many branch
(`RelationService.ts:1196-1235`). One id renders `NOT IN ($1)` and works; two or
more raise `42601 syntax error at or near "$2"`. The error is thrown inside the
request transaction, so the whole save aborts — and because it came back *from*
Postgres, any statement issued afterwards in that transaction returns `25P02`
(bug class 16), which is what the caller is likely to actually see.

**Why nothing caught it.** The only coverage is `where: jest.fn(() => chain)`
(`packages/server-postgres/test/relation-pipeline-gaps.test.ts:161`) — the mock
never compiles the fragment, so a malformed `SQL` object passes. Bug class 3 with
a SQL face. `test/e2e/nested-path-writes.test.ts` exercises `authors/1/posts` as a
*path*, never the `{posts: [...]}` body form, so the e2e suite does not reach the
branch either.

**Fix direction.** `sql.join(parsedTargetIds, sql\`, \`)`, or better
`not(inArray(targetIdCol, parsedTargetIds))` so the builder owns the rendering.
Then pin it with a test that renders the statement (`new
PgDialect().sqlToQuery(...)`) rather than one that records that `where` was
called — the assertion has to be on the emitted SQL, or the same class comes
back on the next hand-built fragment.

### H2 — every relation load in the REST `include` path swallows its error, including Postgres errors

`packages/server-postgres/src/services/FetchService.ts:1326`, `:1342`, `:1450`,
`:1000`, `:1027`, `:328`, `:406`

Each of these wraps a `relationService.fetchRelatedEntities` /
`batchFetchRelatedEntities…` call in `try { … } catch (e) { logger.warn(…) }` and
continues. The file already knows the rule and applies it four times —
`if (reachedDatabase(e)) throw e;` at `:681`, `:809`, `:1293`, `:1403` — but only
on the `db.query` → `db.select` fallbacks that motivated bug class 16. The
relation catches are the unswept siblings, and they are the ones on the
`?include=` path.

**Failure scenario.** `GET /api/data/posts?include=tags` where the tags load
raises anything at all — a missing junction column after a partial migration, an
id shape the target's key column cannot hold (`22P02`), a policy referencing a
table that is not there. The response is `200` with `tags` simply absent from
every row, which is indistinguishable from "these posts have no tags". Worse: the
error came back from Postgres, so the transaction is now aborted; the *next*
relation in the loop issues its query, gets `25P02`, and is swallowed too. A
caller asking for four relations gets a 200 with all four missing and one
`logger.warn` naming the first.

**Fix direction.** Add the same `if (reachedDatabase(e)) throw e;` guard to all
seven, and decide deliberately what a non-database failure means: silently
dropping a relation the caller *explicitly named in `include`* is arguably wrong
even then — a `502`/partial-response marker is more honest than an absent key.
Gate it by enumerating the call sites of the feature (every `catch` in this file
that contains a `relationService.` call) rather than by reading the guard's
implementation, per class 17's second axis.

---

## MEDIUM

### M1 — inverse relations are silently truncated at 100 rows, unordered

`packages/server-postgres/src/data-transformer.ts:425`

```ts
.limit(relation.cardinality === "one" ? 1 : 100); // Limit for one-to-one vs one-to-many
```

`parseDataFromServer` hydrates a `hasMany` property by querying the target table
with a hard `LIMIT 100` and no `ORDER BY`. An author with 140 posts gets 100 of
them, in whatever order Postgres pleases, with no `hasMore` and no warning. The
same block sits inside a `catch (e) { logger.warn }` (`:443`) that has the H2
problem as well. The `via` branch below repeats the literal (`:517`).

**Fix direction.** Either make it a declared, documented page size that the
response reports, or drop the hydration and require `include` (which goes through
the batch loaders). A magic 100 that nothing surfaces is the "field the platform
writes and never reads back" shape inverted: a bound nothing can observe.

### M2 — a nested path's intermediate hops are decorative

`packages/server-postgres/src/services/nested-path.ts:67-92`

`resolveNestedPath` walks `a/1/b/2/c` and returns only the *last* hop. Every
caller then gates on that one hop — `FetchService.ts:618`, `:1067`, `:1122`,
`:1242`, `PersistService.ts:93`, `:206` — via `relationService.isRelated(hop, id)`.
Nothing ever checks that segment `2` is related to segment `1`.

**Failure scenario.** `GET /api/data/authors/1/posts/99/comments` returns post
99's comments even when post 99 belongs to author 2. This is not an RLS escape —
the comments are still filtered by the caller's policies, so the rows are ones
they could have read at `posts/99/comments` — but the parent segment is an
authorization assertion the API accepts and does not verify. That is exactly the
defect the docblock at `RelationService.ts:555-560` says was fixed ("the parent
segment decided nothing"); it was fixed for the final hop only.

**Fix direction.** Walk the chain in `resolveNestedPath`, returning every hop, and
have the callers assert `isRelated` for each — or refuse paths deeper than one hop
outright and say so, which is cheaper and honest.

### M3 — nothing detects two relations deriving the same junction table, and the remediation text talks you into merging them

`packages/common/src/util/resolve-relation.ts:104-110`,
`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:492-503`,
`packages/common/src/util/junction-policies.ts:136-146`,
`packages/server-postgres/src/collections/validate-relations.ts:266`

`through.table` defaults to `[sourceTable, targetTable].sort().join("_")` — a
function of the two *tables only*, not of the relation. So `products` declaring
both `tags` and `featuredTags` against `tagsCollection` derives `products_tags`
twice, with `targetColumn` `tag_id` and `featured_tag_id` respectively.

Three places then take "first wins" without a word:

* `generate-postgres-ddl-logic.ts:493` — `if (!allTablesToGenerate.has(junctionTableName))`, so only the first relation's two columns are ever created. Same guard in the drizzle generator at `generate-drizzle-schema-logic.ts:618`.
* `junction-policies.ts:144` — `else if (!existing.declaringSides.some(s => s.collection === collection))`, so the second relation from the *same* collection is not even recorded as a declaring side; its write grant is never derived.
* `resolveJunctionSpecs` keys the map on the bare table name with `schema` hardcoded to `"public"` (`junction-policies.ts:123-124`), so two junctions of the same bare name in different schemas would collide too.

Boot does eventually notice, via `validate-relations.ts:258-270` — `through.targetColumn: "featured_tag_id"` is not a column on `products_tags`. But the fix text it prints is:

> set `through.targetColumn` to one of: `product_id`, `tag_id`

Following that advice points both relations at the *same* junction row set, so
`featuredTags` and `tags` become aliases of one another and each save of one
rewrites the other. That is bug class 5: remediation text whose command produces a
worse state than the one it diagnoses.

**Fix direction.** Detect the collision where it is created. `resolveJunctionSpecs`
already aggregates by table name — make a spec whose declaring sides disagree on
`{sourceColumn, targetColumn}` an error, keyed on `schema.table` rather than the
bare name, and say "two relations derive the same junction; give one an explicit
`through.table`". Then the validate-relations message never has to be right about
this case.

### M4 — two relations resolving to the same `relationName` silently overwrite

`packages/common/src/util/relations.ts:49-52`

```ts
for (const relation of collection.relations ?? []) {
    const resolved = resolveRelation(relation, collection);
    relations[resolved.relationName] = resolved;
}
```

`relationName` defaults to the target's snake-cased slug
(`resolve-relation.ts:45`), so two undeclared-name relations to the same target
collapse into one — the second wins and the first vanishes from `include`, the
admin tab, the nested path, the DDL walk and the junction spec, all at once. The
property loop below (`:60`) guards with `if (… || relations[propertyKey]) continue;`
but the array loop has no such check.

**Fix direction.** Throw on a duplicate key in the array loop, naming both
declarations. There is no case where silently discarding one is right.

### M5 — a relation whose target is on another engine emits a foreign key to a table that will never exist, and the boot check deliberately looks away

`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:589-609`,
`packages/common/src/util/junction-policies.ts:116`,
`packages/server-postgres/src/collections/validate-relations.ts:166`

Every SQL generator starts by narrowing to `relationalCollections(allCollections)`
(`generate-postgres-ddl-logic.ts:396`, `ensure-collection-tables.ts:252`,
`generate-drizzle-schema-logic.ts:521`), which is correct. But the relation walk
then reaches the target through `relInfo.target()`, which is *not* filtered, and
emits unconditionally:

```ts
fkStatements.push(`ALTER TABLE … FOREIGN KEY ("${relInfo.localKey}") REFERENCES "${targetSchema}"."${targetTable}" …`);
```

The `reference`-property branch immediately below (`:610-632`) gets this right: it
looks the target up in the already-filtered `collections` and, when it is not
there, emits the column with no constraint. The `relation` branch does not.
`resolveJunctionSpecs` has the same hole — it iterates the filtered collections but
takes `relation.target()` raw, so a m2m to a Firestore collection plans a junction
whose FK references a nonexistent table.

Boot survives this only by accident: `add-constraint` is one of two action kinds
whose failure is recorded rather than thrown
(`ensure-collection-tables.ts:805-822`), so the deployment limps on with the
constraint missing. `rebase db push` has no such escape. And
`validate-relations.ts:166` — `if (!registeredSlugs.has(targetCollection.slug))
continue;` — fails open for exactly this case, so the one thing that checks
relations at boot is guaranteed to say nothing about it.

**Fix direction.** Run the target through `isRelationalCollection` before emitting
an FK or planning a junction, and turn `validate-relations`' fail-open branch into
a *reported* defect for a cross-engine target (not fatal — say what it does and
does not do).

### M6 — the push path derives junction policies for a table that is a declared collection; the boot path does not

`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:1162-1181`
vs `:1085-1099`

`planCollectionPolicies` (boot) carries a `seen` set across both loops, so a
junction whose `schema.table` is also a declared collection's table is skipped
(`:1086-1088`). `generatePostgresPoliciesDdl` (`rebase db push`) has no such
guard: it walks every spec and emits `ENABLE ROW LEVEL SECURITY` plus the full
derived rule set for it.

**Failure scenario.** `through: { table: "memberships", … }` where `memberships` is
also a declared collection. Each derived policy is a `DROP POLICY IF EXISTS`
followed by a `CREATE POLICY` (`:126`), so on push the junction's
`memberships_default_admin_read` replaces the collection's own policy of that
name, and an extra permissive `memberships_default_edge_read` is created that
grants `SELECT` on the collection whenever both "endpoint" rows are visible —
widening a real collection's read ACL. Boot never does this, so the table's
security depends on which command touched it last. UNCONFIRMED whether the
`through.table`-is-a-collection pattern is used in the field; the docs
(`website/src/content/docs/docs/collections/relations.md:150-158`) only show
generated junctions.

Related: `ensure-collection-tables.ts:538-544` runs `addColumn` for every planned
junction column regardless of whether the table belongs to a declared collection,
so the same configuration can graft junction columns onto a real table.

**Fix direction.** Give `generatePostgresPoliciesDdl` the same `seen` guard, and
make the two producers share it rather than each carrying a copy. The
derived-names gate would catch this class automatically if the fixture in
`tooling/scripts/derived-names.mts` contained one junction pinned to a declared
collection's table — a name that appears under `[push]` only is precisely what
that contract exists to surface.

### M7 — the `hasMany` write is still delete-all-shaped, while the m2m write was converted to a diff

`packages/server-postgres/src/services/RelationService.ts:1224-1242`

`syncJunctionLinks` (`:1037-1087`) diffs, and its docblock gives three reasons:
lost update, partial-read/partial-write, junction payload columns. The inverse-many
branch twenty lines below still does the old thing — one `UPDATE … SET fk = NULL
WHERE fk = parent AND id NOT IN (…)` followed by an `UPDATE … SET fk = parent`,
computed entirely from the list the client sent.

RLS closes the partial-write half (an invisible child is not updatable either), but
the lost update stands: two editors with author 1 open, A adds post X and saves, B
saves any field and X is detached, with nothing to show for it. The empty-array
branch (`:1236-1242`) nulls every visible child unconditionally.

**Fix direction.** Same treatment: read the current children in-transaction, diff,
and issue only the two id lists that actually changed.

### M8 — `updateInverseRelations` catches and continues, per relation

`packages/server-postgres/src/services/RelationService.ts:1355-1357`

```ts
} catch (e) {
    logger.warn(`Failed to update inverse relation '${relation.relationName}'`, { error: e });
}
```

The loop body issues two or three `UPDATE`s. A failure — including a Postgres
error — is logged and the loop moves to the next relation, which then runs its
statements in an already-aborted transaction. The save returns success for a
write that did not happen (or fails later, on commit, with an error naming
neither). Bug class 4 stacked on class 16. Note that the two sibling helpers it
delegates to (`updateInverseJoinPathRelation:1447`,
`updateManyToManyInverseRelation:1497`) both *rethrow* after logging — this call
site is the outlier that does not.

**Fix direction.** Rethrow. A write that could not be performed must not report
success; if some relations are genuinely best-effort, that has to be a declared
property of the relation, not a `catch` in a loop.

---

## LOW

### L1 — a self-referential many-to-many with a default relation name derives one column twice

`resolve-relation.ts:107-109`. For `users` declaring `{ users: { kind:
"manyToMany", target: () => usersCollection } }`, `sourceColumn` and
`targetColumn` both resolve to `user_id`, and the generators emit
`CREATE TABLE "public"."users_users" ("user_id" TEXT NOT NULL, "user_id" TEXT NOT
NULL, PRIMARY KEY ("user_id","user_id"))`
(`generate-postgres-ddl-logic.ts:544-548`; the drizzle generator emits a duplicate
object key at `generate-drizzle-schema-logic.ts:670-671`). Postgres refuses with
*column "user_id" specified more than once*, and at boot `create-table` is fatal
(`ensure-collection-tables.ts:821`). Loud, but the message names neither the
relation nor the collection. Naming the relation anything else (`friends`) avoids
it entirely. **Fix:** assert `sourceColumn !== targetColumn` in `resolveRelation`
and say which relation needs an explicit `through`.

### L2 — `unwrapJunctionRow` finds the target row by "the only object among the columns"

`packages/server-postgres/src/services/row-pipeline.ts:51-56`. The nested target is
located with `Object.keys(item).find(k => typeof item[k] === "object" && …)`. A
junction carrying a payload column — a `timestamptz` comes back as a JS `Date`, a
`jsonb` as an object — puts a second object in the row. It happens to work today
because the generated column order is `sourceColumn, targetColumn, <payload>` and
`find` returns the first match, but the heuristic is one column reorder away from
returning a `Date` as the related row. This is the read counterpart of the very
case the diff-write fix was written to protect (`RelationService.ts:1029-1032`
names `position`, `role`, `created_at`). **Fix:** address the target by
`relation.through.targetColumn` — the caller already knows it.

### L3 — a regex replace that replaces nothing

`packages/server-postgres/src/services/FetchService.ts:290`:
`relation.through.targetColumn.replace(/_id$/, "_id")`. Identity. The value is in
fact correct (the generated drizzle relation on the junction is keyed by the
column name, `generate-drizzle-schema-logic.ts:791`/`:799`), so this is dead code rather
than a bug — but it reads as a transformation and invites someone to "fix" it into
`.replace(/_id$/, "")`, which would break every m2m `include`. **Fix:** delete the
replace and say in a comment why the raw column name is the relation name.

### L4 — an unknown `?include=` key is silently ignored

`FetchService.ts:1430-1431`, `:349-351`, `:249-250`: `shouldInclude` is a
membership test against the resolved relation keys, so `?include=tag` (singular,
when the relation is `tags`) yields a 200 with nothing included and no
diagnostic. Class 21 — the caller cannot tell whether the fault is theirs.
**Fix:** 400 on an `include` key that names no relation, listing the available
ones, as `fetchRelatedEntities` already does for a nested path
(`RelationService.ts:311-312`).

### L5 — a required `belongsTo` defaults to `ON DELETE CASCADE`, and the cascade is invisible to the application

`generate-postgres-ddl-logic.ts:603` — `relInfo.onDelete ?? (required ? "CASCADE" :
"SET NULL")`; same default in the drizzle generator (`:322`) and the boot plan
(`:931`). Deleting one category therefore deletes every product that required it.
`PersistService.delete` (`PersistService.ts:184-194`) issues one `DELETE` and the
driver notifies for that path and id only, so the cascaded rows get no
`afterDelete` callback, no realtime notification, and no history row. **Fix:**
this may well be the right default, but the asymmetry with the application layer
should be stated in the relations docs, and the cascade counted in the delete
result if it is going to stay silent.

### L6 — junction column names are emitted as unquoted JS object keys and unescaped SQL identifiers

`generate-drizzle-schema-logic.ts:670-671` interpolates `${sourceColumn}` directly
as an object key (`${sourceColumn}: text("${sourceColumn}")…`) and `:673` as a
`table.${sourceColumn}` member expression in the `primaryKey({ columns: […] })`
call — unlike the relation emitters at `:791`/`:799`, which do use `quote(...)`; the DDL path
wraps names in `"` but does not escape an embedded `"`
(`generate-postgres-ddl-logic.ts:545-546`). Derived names are always snake_case so
this is unreachable today, but `through.sourceColumn` is author-supplied and the
rest of the generator has already learned this lesson (class 13). **Fix:** route
these through the same `quote(...)` / `toPostgresIdentifier(...)` helpers the
neighbouring emission sites use.

---

## Checked and clean

* **RLS binding of every relation read.** `AuthenticatedPostgresBackendDriver.withTransaction` (`PostgresBackendDriver.ts:1584-1645`) builds the whole `DataService` — and therefore `FetchService` → `RelationService` — on `tx` after `applyAuthContext`, and `restFetchService` (`:1571-1581`) wraps the REST include path the same way. No relation path reaches `this.delegate.db` directly.
* **Derived junction RLS.** Baseline `default_admin_{read,write}` plus `default_edge_read` as `EXISTS(endpoint₀) AND EXISTS(endpoint₁)`, with writes inherited only from the declaring side's *explicit* permissive `update` rules and suppressed entirely when a restrictive gate cannot be embedded (`junction-policies.ts:302-352`). `embedParentExpression` refuses `raw` and refuses an `outerField` nested inside an `existsIn` (`:209-256`) — both would rebind to the junction. The failure mode is consistently "too locked".
* **Policy application fails closed.** `ensureCollectionPolicies` enables RLS *before* creating policies and records a per-table failure rather than throwing (`ensure-collection-policies.ts:81-101`), so a junction whose `edge_read` cannot be created is admin-only, not open.
* **Composite parent keys.** `parentKeyCondition` builds an OR-of-ANDs rather than an `IN` on the first key column, with the reasoning written down (`RelationService.ts:139-160`), and `assertSingleKeyAddressable` refuses a composite parent addressed through a single FK column (`:170-191`) at all four call sites (`:711`, `:771`, `:908`, `:952`).
* **`sourceKey` (natural-key joins).** Both directions of the id↔key map are built in one query (`resolveSourceKeys:224-287`), a non-unique source key is refused rather than resolved to the last row seen (`:274-282`), reads and `isRelated` translate through the *same* value so the membership gate cannot authorise rows the listing never returned (`:527-530`), and writes pass their own transaction so an uncommitted change is not read stale (`:228-231`).
* **The m2m diff write.** `syncJunctionLinks` (`:1037-1087`) keys both sides by `String(...)`, reads the existing set in-transaction under the same policies, deletes by explicit id list, and inserts `ON CONFLICT DO NOTHING`. The three write entry points (`updateRelationsUsingJoins` via/`manyToMany`, `updateInverseJoinPathRelation`, `updateManyToManyInverseRelation`) all funnel through it, and all three now read both accepted id shapes through `relationTargetIds` (`:39-54`), which refuses an element with no key rather than dropping it.
* **Delete semantics through a junction.** `PersistService.delete` unlinks rather than deleting the shared row (`PersistService.ts:104-115`), refuses to unlink through a multi-hop `via` with a message that says why, and gates on `isRelated` first. Junction rows for a deleted endpoint are removed by `ON DELETE CASCADE` on both FKs (`generate-postgres-ddl-logic.ts:550-551`, `:999-1019`), which agrees between the DDL, the drizzle schema and the boot plan.
* **Nested writes do not reparent.** `PUT authors/1/posts/43` asserts membership instead of stamping the FK (`PersistService.ts:236-242`), and the to-one case is refused outright (`nested-path.ts:assertWritableThrough`).
* **Recursion is bounded.** `toRelatedRow(..., { resolveNested: true })` resolves the target's own relations, but `parseDataFromServer` returns *references* (`createRelationRef`) rather than recursing (`data-transformer.ts:392-440`), so a self-referential `parent`/`children` relation terminates at depth two. `buildWithConfig` is one level plus the junction nesting; the batch paths pass `resolveNested: false` deliberately (`RelationService.ts:104-109`).
* **FK default rename (0.12→0.13).** `planJunctionTables` records the legacy spelling only when the current name is what the rule derives from the endpoint's slug (`generate-postgres-ddl-logic.ts:986-996`); `renameLegacyColumn` fires only when the new name is absent *and* the old one present, and renames rather than adding an empty column beside it (`ensure-collection-tables.ts:365-384`). `validate-relations` distinguishes "wrong column name" from "stale generated schema" for all three relation kinds and orders its advice regenerate-first (`validate-relations.ts:90-122`, `:367-401`).
* **`assertRelationsResolve` is fatal, not a warning** (`validate-relations.ts:357-402`), which is the right call given every one of these defects otherwise presents as an empty tab.
* **`via` join-path validation** walks the chain, checks each `on.from` against the previous table and each `on.to` against its own, checks the arities match, and checks the chain *ends* at the target's table (`validate-relations.ts:274-344`). That last one is the check that stops a chain returning some other collection's rows.
* **Orphans.** A junction row cannot dangle (both FKs exist with `ON DELETE CASCADE`). A `belongsTo` whose FK is dangling — possible only where the FK constraint was not created, i.e. M5's case — reads back as a `{__type:"relation"}` reference with no data (`RelationService.ts:758-762` simply omits the parent from the result map); no path throws.

---

## Open questions

1. **Is `through.table` naming an existing declared collection a supported pattern?** M6 and the `addColumn` note in it both hinge on this. If it is supported, both are real; if it is not, both should be a refusal at config-validation time rather than divergent behaviour between push and boot.
2. **Junction primary-key column order is walk-dependent.** `contracts/derived-names.txt:152-154` pins `PRIMARY KEY ("product_id", "category_id")` on `categories_products` — sorted table name, but PK order taken from whichever collection the walk reached first. Removing the `products` side and keeping only the `categories` side would flip it. Column order is not an identifier so the gate would not fail, and `CREATE TABLE IF NOT EXISTS` would not recreate an existing table — but two projects built from the same collections in different declaration order would get different indexes. Worth deciding whether to sort the PK columns explicitly.
3. **The derived-names fixture has no collision cases.** It covers irregular plurals, `ss` endings, acronyms, overrides and the 63-byte limit, which is exactly the right list for the naming *rule*. It has nothing for the naming *collisions* in M3/M4/M6/L1 — two m2m to one target, a junction pinned to a collection's table, a self-referential m2m. Those are the cases where boot and push can disagree, and they are cheap to add to the fixture.
4. **Are `relationName`, `through.sourceColumn` and `through.targetColumn` inside the frozen-names contract?** They are derived and written into the database, so contract 6 should cover them, but nothing in `contracts/derived-names.txt` distinguishes a junction column derived from a *relation name* (`resolve-relation.ts:109`) from one derived from a *slug*. `validate-relations.ts:254-257` and `planJunctionTables`'s `legacyFor` both assume the slug — correct only while the relation name defaults to the target slug.
5. **What happens on `saveMany` with relations?** The batch path shares one transaction (`PostgresBackendDriver.ts:1697`), so H1 or M8 firing on row 3 of 10k aborts the whole import. I did not trace whether the relation writes are issued per row inside that transaction or batched; if per row, the failure modes above are amplified by the batch size.
6. **`countRelatedEntities` drops its `filter` option.** `RelationService.ts:478-493` accepts `options.filter` and calls `countRelatedRows(..., [])`. Class 20 (a value computed and discarded) / class 17 (a parameter dropped at a hop). I did not chase whether any caller passes it — if one does, the count is of the unfiltered set.
