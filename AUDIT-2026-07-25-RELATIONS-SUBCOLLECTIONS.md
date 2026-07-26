# Audit: the relations model and its projection onto subcollections

Date: 2026-07-25
Scope: `packages/types` (Relation, CollectionConfig), `packages/common` (CollectionRegistry,
relations/resolutions utils), `packages/server` (REST route generation),
`packages/server-postgres` (FetchService, PersistService, RelationService),
`packages/app` + `packages/admin` (navigation, subcollection tabs).

---

## Summary

The model has **two path grammars for the same URL**, and nothing reconciles them.

- The **frontend** treats the third path segment as a *child collection slug*.
- The **backend** treats it as a *relation key*.

They coincide only when a relation's name happens to equal its target collection's slug.
The default (`sanitizeRelation` sets `relationName = toSnakeCase(target.slug)`) makes that
true often enough that the seam is invisible in the demo apps — and false for the most
common authoring style, an inline relation property, whose relation name defaults to the
*property key*.

Everything below flows from that single unreconciled projection, plus a nested read/write
pipeline that was built as an afterthought to the root-collection one.

---

## A. Root cause: the child collection is stamped with the target's slug — **FIXED**

`CollectionRegistry.normalizeCollection` builds `childCollections` from many-relations at
[CollectionRegistry.ts:287](packages/common/src/collections/CollectionRegistry.ts:287):

```ts
result.childCollections = () => manyRelations.map((r: Relation) => {
    const target = r.target();
    return r.overrides ? mergeDeep(target, r.overrides) : target;
});
```

The child is the **target collection verbatim** — so its `slug` is the target's slug.

There is a second, *different* implementation of the same projection in
[resolutions.ts:362-391](packages/common/src/util/resolutions.ts:362), which does the right
thing — it overrides `slug` with the relation key and pulls the display name off the
declaring property. It is **unreachable** for anything that went through the registry,
because `getSubcollections` short-circuits on `childCollections` at
[resolutions.ts:353](packages/common/src/util/resolutions.ts:353).

Consumers then split:

| Consumer | Reads the segment as | Site |
|---|---|---|
| `resolvePathToCollections` | child collection **slug** | [CollectionRegistry.ts:521](packages/common/src/collections/CollectionRegistry.ts:521) |
| `getCollectionByPath` | **relation key** (`findRelation`) | [CollectionRegistry.ts:446](packages/common/src/collections/CollectionRegistry.ts:446) |
| `FetchService.fetchCollectionFromPath` | **relation key** | [FetchService.ts:830](packages/server-postgres/src/services/FetchService.ts:830) |
| `PersistService.save` | **relation key** | [PersistService.ts:147](packages/server-postgres/src/services/PersistService.ts:147) |
| `RelationService.fetchRelatedEntities` | **relation key** | [RelationService.ts:167](packages/server-postgres/src/services/RelationService.ts:167) |
| admin subcollection tab | child **slug** | [DetailViewBinding.tsx:354](packages/admin/src/components/DetailViewBinding.tsx:354) |

Reproduced (`posts` has one many-relation `featured_tags` → `tags`):

```
child slugs:                                   [{ slug: 'tags', name: 'Featured tags' }]
resolvePathToCollections("posts/1/tags")       => "tags"
resolvePathToCollections("posts/1/featured_tags") THREW => Subcollection 'featured_tags' not found in posts
getCollectionByPath("posts/1/tags")            THREW => Relation 'tags' not found in collection 'posts'
getCollectionByPath("posts/1/featured_tags")   => "tags"
```

Exactly one of the two resolves any given URL. The admin builds
`` `${path}/${entityId}/${getCollectionDataPath(subcollection)}` `` — the target slug — so
opening the subcollection tab produces a request the backend rejects with
*"Relation 'tags' not found in collection 'posts'"*.

**Fixed.** The duplicated projection in `normalizeCollection` is gone; `getEntityChildViews`
in [resolutions.ts](packages/common/src/util/resolutions.ts) is the single derivation, and it
keys each child by the **relation key** — the name `findRelation` matches a path segment
against. `resolvePathToCollections` and `getCollectionByPath` now accept and reject the same
paths by construction.

**This is not an exotic config.** `extractRelationsFromProperties`
([CollectionRegistry.ts:312](packages/common/src/collections/CollectionRegistry.ts:312))
defaults `relationName` to the property key, so the idiomatic

```ts
properties: {
    featuredTags: { type: "relation", target: () => tags, cardinality: "many" }
}
```

produces relation `featuredTags` → child slug `tags` → broken.

---

## B. Two relations to the same target collapse into one — **FIXED**

Same probe with `featured_tags` and `archived_tags`, both targeting `tags`:

```
TWO-RELATION subs: [ { slug: 'tags', ... }, { slug: 'tags', ... } ]
```

Consequences:
- `getSubcollectionColumnId` ([common.tsx:72](packages/admin/src/components/CollectionTableBinding/internal/common.tsx:72))
  returns `subcollection:tags` for both — duplicate React keys, duplicate columns.
- `resolvePathToCollections` uses `.find(c => c.slug === segment)` — the second relation is
  permanently unreachable.
- Both tabs point at the same URL.

There is no way to express two named links to the same collection.

**Fixed.** Each view is keyed by its own relation, so two relations to one target are two
tabs, two column ids and two distinct URLs.

---

## C. A relation name that collides with a root slug resolves to the wrong collection — **FIXED**

[CollectionRegistry.ts:454-458](packages/common/src/collections/CollectionRegistry.ts:454):

```ts
const targetRelationKey = relation.relationName || target.slug;
const targetSlug = relation.overrides?.slug ?? targetRelationKey;
currentCollection = this.get(targetSlug) || this.normalizeCollection(target);
```

`this.get(relationName)` searches the **global** slug map. Reproduced — `docs` has a
relation named `people` targeting `notes`, and an unrelated root collection `people` exists:

```
getCollectionByPath("docs/1/people") -> should be notes => "people"
```

The relation's own `target()` is discarded in favour of a name collision. This is reached on
the write path via `PostgresBackendDriver.resolveCollectionCallbacks`
([PostgresBackendDriver.ts:168](packages/server-postgres/src/PostgresBackendDriver.ts:168)),
so a nested write can run **the wrong collection's `beforeSave`/`afterSave` and property
callbacks**, against the wrong `properties` schema.

**Fixed.** The walk follows `relation.target()` and looks the registered instance up by
*table name*, never by the relation's name.

---

## D. `relation.overrides` are dropped by path resolution — **FIXED**

`resolvePathToCollections` finds the merged child, then throws it away:

```ts
currentCollection = this.get(subcollection.slug) || this.normalizeCollection(subcollection);
```
([CollectionRegistry.ts:530](packages/common/src/collections/CollectionRegistry.ts:530))

`this.get(slug)` returns the registered root target, without the merge. Reproduced:

```
override in childCollections:            "Featured tags"
override after resolvePathToCollections: "Tags"
```

So `overrides` works for rendering the tab list and silently stops working once you navigate
into it. Anything security- or presentation-relevant put in `overrides` (a narrowed
`properties` set, a filter preset, a different name) does not survive.

**Fixed.** The resolved child is normalized as-is rather than re-looked-up in the global slug
map, so the merge survives the navigation.

---

## E. The nested read pipeline silently discards almost every query option — **FIXED**

Compare the root list route ([api-generator.ts:167](packages/server/src/api/rest/api-generator.ts:167))
with the nested one ([api-generator.ts:563](packages/server/src/api/rest/api-generator.ts:563)):

1. **`offset` is never passed.** The route omits it from the `fetchCollection` call, yet
   still reports it in `meta` and computes `hasMore` from it. `FetchService.fetchCollectionFromPath`
   doesn't accept it either ([FetchService.ts:807](packages/server-postgres/src/services/FetchService.ts:807)).
   **Subcollection lists cannot paginate — page 2 returns page 1.**
2. **`filter` is never applied.** `fetchEntitiesUsingJoins` builds `additionalFilters` from
   `searchString` only ([RelationService.ts:263-282](packages/server-postgres/src/services/RelationService.ts:263));
   `options.filter` is accepted and never read. `?where=status:eq.published` on a nested path
   returns drafts.
3. **`orderBy` / `order` are never applied** on either branch.
4. **The `joinPath` branch ignores `searchString` too** ([RelationService.ts:208-257](packages/server-postgres/src/services/RelationService.ts:208)) — only `limit` survives.
5. **`count` ignores everything.** `countRelatedEntities` declares `{ filter, databaseId }`,
   passes a hardcoded empty `additionalFilters: SQL[] = []`
   ([RelationService.ts:354](packages/server-postgres/src/services/RelationService.ts:354)),
   and never sees `searchString` at all. So `total` disagrees with `data` whenever the client
   filters or searches, and `hasMore` stays true forever.
6. **`?include=` doesn't work.** Nested GET bypasses `restFetchService` entirely and calls the
   raw driver.

All of this fails **silently** — the caller gets 200 with wrong data, not a 400.

**Fixed, by deleting the second pipeline.** `DrizzleConditionBuilder.buildRelationScopeCondition`
expresses "reachable from this parent" as a plain `WHERE` condition on the target table — an
inverse FK becomes a column comparison, a junction or a `joinPath` becomes a correlated
`EXISTS`. A nested listing is now the ordinary collection query with one more condition, so it
inherits `offset`, `filter`, `orderBy`, `include` and a `count` that agrees with it, and
`fetchCollectionFromPath` / `countEntitiesFromPath` / `fetchEntitiesUsingJoins` are gone from
the listing path. The junction is reached with `EXISTS` rather than the old `INNER JOIN`
precisely so it cannot multiply rows and break `limit`/`offset`.

---

## F. Nested writes skip write validation — **FIXED**

`assertKnownWriteFields` is called at lines 270, 308, 312 and 405 — all inside
`createCollectionRoutes` (140-470). `createSubcollectionRoutes` (490-684) never calls it.

`strictWrites` (documented as default-`true` in
[collections.ts:196](packages/types/src/types/collections.ts:196)) is **not enforced on any
nested path**. `POST /authors/1/posts {"tiitle": "x"}` bypasses the guard that
`POST /posts` applies.

**Fixed.** `RestApiGenerator.resolveNestedWriteCollection` walks the path to the collection the
write lands in, and the nested `POST`/`PUT` routes check the body against it, as the root ones
do.

---

## G. Nested single-entity operations are not scoped to the parent — **FIXED**

`fetchOne` resolves the collection through the path and then filters on the primary key alone
([FetchService.ts:402-427](packages/server-postgres/src/services/FetchService.ts:402)). Same
for `PersistService.delete` ([PersistService.ts:83](packages/server-postgres/src/services/PersistService.ts:83)).

- `GET /authors/1/posts/43` returns post 43 even when it belongs to author 2.
- `DELETE /authors/1/posts/43` deletes it.
- `PUT /authors/1/posts/43` is worse: the nested branch **injects the parent FK into the
  values** ([PersistService.ts:207](packages/server-postgres/src/services/PersistService.ts:207)),
  so it silently **reparents** post 43 to author 1.

RLS still gates row visibility, so this is not an auth bypass — but the parent segment in a
nested URL is decorative for read/update/delete. Only create honours it.

**Fixed.** The path walk that every consumer duplicated now lives once in
[nested-path.ts](packages/server-postgres/src/services/nested-path.ts).
`RelationService.isRelated` answers membership with the *same* join the listing uses, and
`FetchService.fetchOne`/`fetchOneForRest` report a non-member as absent, while
`PersistService.save`/`delete` reject it. Update no longer injects the parent foreign key:
the parent segment is read as an assertion about where the row already lives, not an
instruction to move it there.

---

## H. Many-to-many subcollections are semantically wrong, and destructive — **FIXED**

`cardinality: "many"` is projected to a subcollection regardless of whether it is a
one-to-many (child rows owned by this parent) or a many-to-many (a shared set). Only the
first is really a subcollection. The UI renders them identically, and the write path then
does the wrong thing for m2m:

- **DELETE removes the target row, not the link.** `DELETE /posts/1/tags/5` resolves to the
  `tags` table and deletes tag 5 globally. In the admin, "remove this tag from this post"
  **deletes the tag from every post.**
- **You cannot link an existing row.** The junction insert is gated on create only:
  `if (junctionTableInfo && !id)` ([PersistService.ts:376](packages/server-postgres/src/services/PersistService.ts:376)).
  A `PUT` through an m2m path silently ignores the parent — no junction row is written.

So an m2m subcollection view can only ever create brand-new target rows, and its delete is a
global delete.

**Fixed, both halves.** A junction-backed relation now unlinks — `RelationService.unlinkRelatedEntity`
removes the junction row and leaves the shared target alone. A multi-hop `joinPath`, which has
no single link to remove, is rejected with a 400 rather than falling through to a row delete.

And a junction path now reads as *set membership* on write: `PUT parent/id/child/childId`
links the row if it is not linked yet, idempotently, which is how an **existing** row gets
attached. Unlike an owning foreign key this takes the row from nobody — its other parents keep
it — which is why linking is safe here where reparenting is not. The admin surfaces it as
**Add existing** on a linked tab, opening the picker over the whole target collection.

---

## I. To-one relations are navigable, and writing through them corrupts the target — **FIXED**

Nothing restricts the third segment to a many-relation — `findRelation` matches any relation,
and the route accepts any odd-length path. `POST /posts/1/author` reaches
[PersistService.ts:176](packages/server-postgres/src/services/PersistService.ts:176):

```ts
if (relation.localKey)            targetColumnName = relation.localKey;
else if (relation.foreignKeyOnTarget) targetColumnName = relation.foreignKeyOnTarget;
```

`localKey` is a column on the **source** table, and it is written onto the **target** row —
producing `INSERT INTO authors (author_id, ...)`. Either an opaque Postgres error, or a silent
wrong write if a column of that name happens to exist on the target.

**Fixed.** `assertWritableThrough` rejects a nested write whose final segment is a to-one
relation, with a message naming where the foreign key actually lives. `localKey` is no longer
consulted when resolving the child's parent column; a many-relation that declares neither
`foreignKeyOnTarget` nor `joinPath` is now a 400 instead of a guess. Reads through a to-one
path are unaffected.

---

## J. The Firestore/Postgres asymmetry is unmodelled — **FIXED**

`childCollections` carries two different meanings with no discriminant:

- **Firestore** — `subcollections` thunk ([collections.ts:329](packages/types/src/types/collections.ts:329)).
  The segment is a real Firestore path component. Coherent end to end.
- **Postgres** — the many-relation projection. The segment is a relation key that must be
  resolved against the parent's relation map.

`getDeclaredSubcollections` ([collections.ts:451](packages/types/src/types/collections.ts:451))
reads `subcollections` off *any* collection via a cast, gated only by a capability lookup at
each call site — so the gate is re-implemented per caller rather than enforced by the type.

**Fixed, by naming the distinction instead of erasing it.** `ChildViewSource` in
[collections.ts](packages/types/src/types/collections.ts) discriminates `subcollection`
(containment — what Firestore has, unchanged) from `relation`, and a relation carries
`mode: "owned" | "linked"`. The admin reads it through `useChildViewSource`, derived from the
path so it reaches the collection view, the entity form and a deep link alike: a junction-backed
tab offers "Remove from this record", not "Delete".

Minor, related — **also fixed**: `extractRelationsFromProperties` recurses into `map`
properties ([CollectionRegistry.ts:328](packages/common/src/collections/CollectionRegistry.ts:328))
and hoists nested relations to the collection's top-level `relations[]`, so a many-relation
declared inside a map became a top-level tab keyed by the inner property key. The hoisting is
still needed to stamp the nested property, so `getEntityChildViews` now excludes identities
that appear *only* below the top level — the shape of `properties` being the last remaining
evidence of which is which.

---

## K. None of this is documented — **FIXED**

[relations.md](website/src/content/docs/docs/collections/relations.md) (304 lines) never
mentions that a many-relation becomes a subcollection, that nested REST paths exist, or what
the path segment must be. `docs/data-sources.md` mentions "relations vs subcollections" only
as an engine-capability axis.

**Fixed.** A "Relations in the admin panel" section now covers the tab projection, that the
path segment is the relation *name* (with the inline-property case spelled out), the
owned-versus-shared table with what create / add-existing / remove each mean, the nested REST
surface and its enforcement, and what does not become a tab. `pnpm verify:docs` reports no new
findings for the file.

---

## Recommendations, in order

### Done

- ~~Scope nested `fetchOne`/`update`/`delete` by the parent (G)~~
- ~~Unlink instead of delete for many-to-many (H)~~ — link-an-existing-row still open
- ~~Reject non-many relations as write path segments (I)~~
- ~~Make the nested read pipeline reuse the root one (E)~~ — via the relation-scope condition
- ~~Call `assertKnownWriteFields` in the subcollection routes (F)~~

Covered by [test/e2e/nested-path-writes.test.ts](packages/server-postgres/test/e2e/nested-path-writes.test.ts)
— 15 cases against a real Postgres. Ten assert new behaviour and fail against the pre-fix
code; five are regression guards (create-under-parent, own-child update/delete, m2m
create+link) that pass on both.

- ~~Pick one grammar: the relation key (A, B, D)~~
- ~~Stop resolving relation targets by global slug lookup (C)~~
- ~~Split the config concept: `ChildViewSource` (J)~~
- ~~Give the admin mode-aware affordances (J)~~

Also covered by [entity_child_views.test.ts](packages/common/test/entity_child_views.test.ts)
— 7 cases pinning the key, the two grammars agreeing, overrides surviving, two relations to
one target staying apart, the target-not-name lookup, `owned` vs `linked`, and a Firestore
subcollection staying containment.

- ~~Link an existing row through a many-to-many tab (H)~~
- ~~Stop map-nested relations becoming top-level tabs (J)~~
- ~~Document the projection and the path grammar (K)~~

### Still open

Nothing from this audit. The `Relation` type itself remains over-general — five overlapping
ways to express a link, resolved by ~200 lines of inference in `sanitizeRelation` — which is a
design question rather than a defect; a tagged union (`belongsTo | hasMany | hasOne |
manyToMany | via`) would state in the type what its JSDoc currently states in prose.

---

## Reproduction

The probe used above is at
`/private/tmp/claude-501/-Users-francesco-rebase/2cfa4dec-e99c-4ba8-81a3-9258d82e5be3/scratchpad/probe_subcollections.test.ts`.
Copy it into `packages/common/test/` and run `npx jest test/probe_subcollections.test.ts`
from `packages/common`.
