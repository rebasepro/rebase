# Unit 51 — reference and relation UI

Read-only audit, 2026-08-08. Scope: `packages/cms/src/components/ReferenceWidget.tsx`,
`RelationSelector.tsx`, `ReferenceTable/**`, `SelectableTable/**`, `UserSelector.tsx`,
`InlineEntityPreview.tsx`, `EntityPreviewNesting.tsx`, the previews they render
(`preview/components/RelationPreview.tsx`, `ReferencePreview.tsx`), the hook behind the
picker (`packages/app/src/hooks/data/useRelationSelector.tsx`), and the junction write
path they drive (`packages/server-postgres/src/services/RelationService.ts`).

## Verdict

The relation half of this unit is in noticeably better shape than the reference half.
`RelationSelector` normalises the wire shape, debounces and cancels its type-ahead,
paginates server-side, and reads `usePortalContainer` so its list scrolls inside a modal
(class 32 already closed, and the code says so). `EntityPreviewNesting` bounds recursion
by construction — depth 1 collapses to `InlineEntityPreview`, which renders text and
never recurses — and `InlineEntityPreviewMissing` is a real "missing" state that the
previews do reach. The reference half has not had the same attention: `ReferenceWidget`
is exported publicly, has no internal caller, and has two paths that render *nothing at
all* — no chip, no button, no way to open the picker. And two things cut across both
halves. First, a relation cell in the collection table mounts a **live picker per visible
row**, so opening a table with a relation column fires one subscription per row against
the target collection before the user has clicked anything. Second, `RelationPreview` and
`ReferencePreview` each keep a module-level `Map` that is written on every successful
fetch and never invalidated, so a target row that is deleted keeps rendering as a live
card for the rest of the session — which is the answer to "what happens when a reference
points at a deleted row", and it is the wrong one.

On the questions asked: the picker's list goes through the ordinary authenticated data
client, so RLS is the gate and there is no enumeration leak beyond it — but the picker
never consults `canRead`, which the drawer does, so a collection hidden from navigation
still gets a working picker. Pagination and search are server-side. Debouncing and
cancellation are correct in `useRelationSelector` and **absent in `UserSelector`**.
Many-to-many adds and removes in one session produce correct junction writes, but the
save is a delete-all-then-reinsert of whatever the client read, which is a lost update
between two concurrent editors of the same parent. Dialog layering is fine; focus
restoration is not.

---

## Findings

### HIGH

#### H1. Every relation cell in the table mounts a live picker, which fetches (or subscribes) on mount

`packages/cms/src/components/CollectionTableBinding/table_bindings.tsx:236-247`
`packages/cms/src/components/CollectionTableBinding/PropertyTableCell.tsx:255-281`
`packages/app/src/hooks/data/useRelationSelector.tsx:233-239`

`getTableBindingForProperty` gates most editors on `selected` — `else if (selected &&
property.type === "number")` at line 91, and the same for strings. The relation branch at
line 236 is **not** gated: it returns `RelationSelectorBindingComponent` whether or not
the cell is selected. `PropertyTableCell` then renders it as `innerComponent` for every
visible row (line 256-272), because the only thing that suppresses it is `readonly`,
which is `!inlineEditing` — and `inlineEditing` defaults to *true*
(`CollectionViewBinding.tsx:244`: `collection.inlineEditing === undefined ||
collection.inlineEditing`).

Each of those mounted `RelationSelector`s calls `useRelationSelector`, whose
`useEffect(() => { fetchData(); … }, [fetchData])` (line 233) runs unconditionally on
mount — it is not gated on the popover being open. `fetchData` prefers
`accessor.listen(…)` when the client has a socket (line 167), so the admin's realtime
path is taken.

Failure scenario: a collection with one relation column, default page of rows. Opening
the table view opens one realtime subscription per row against the *target* collection,
each with `limit: 10` and `include: ["*"]`, and holds them for as long as the table is
mounted. Scrolling a second page adds more. None of that data is displayed until someone
clicks a cell. This is class 24 along the "call sites of the feature" axis — the work is
proportional to rendered rows rather than to anything the user asked for.

Fix direction: gate the relation branch on `selected`, the way the number and string
branches already are, and render `PropertyPreview` otherwise. Independently, make
`useRelationSelector` lazy — take an `enabled` flag and skip `fetchData` until the
popover has been opened once — so the same mistake at a future call site costs nothing.

#### H2. `relationsCache` / `referencesCache` are never invalidated, so a deleted target keeps rendering as live

`packages/cms/src/preview/components/RelationPreview.tsx:192-196,270`
`packages/cms/src/preview/components/ReferencePreview.tsx:160-164,238`

```
if (entity) relationsCache.set(relation.pathWithId, entity);
const usedEntity = passedEntity ?? entity ?? relationsCache.get(relation.pathWithId);
…
const relationsCache = new Map<string, Entity<any>>();
```

`useFetch` handles deletion correctly — `onEntityUpdate(undefined)` clears its own
`CACHE` entry and sets `entity` to `undefined`
(`packages/app/src/hooks/data/useFetch.tsx:93-98`). The preview then falls through to
`relationsCache.get(...)`, which still holds the row from before it was deleted. Nothing
ever deletes from that map.

Failure scenario: open a record whose `author` relation points at author 42; the card
renders and 42 is cached. Delete author 42 in another tab (or another user does). The
first tab's realtime update arrives, `useFetch` reports the row is gone — and the card
keeps showing "Jane Doe" with a working "open" button that leads to a 404 panel. The
`InlineEntityPreviewMissing` / "Entity not found" branches at lines 234-246 are
unreachable for any target that was ever rendered in this session.

Two further consequences of the same map: it is module-level and unbounded, so a long
admin session over a large collection accumulates every entity it has previewed; and it
is not cleared on sign-out, so after a user switch in the same tab the new user can see
the previous user's cached previews.

Fix direction: drop the local map and rely on `useFetch`'s own cache, which already
handles the delete; or, if the map exists to avoid a skeleton flash, delete the key
whenever `useFetch` reports `entity === undefined` for an id it was asked for, cap it
(LRU), and clear it on auth state change.

#### H3. `UserSelector` shows an empty picker for any user outside the loaded page

`packages/cms/src/components/UserSelector.tsx:200-204,112-114`

```
const selectedUser: User | null = value ? getUser(value) ?? null : null;
const resolvedUser: User | null = selectedUser
    ?? (value ? availableItems.find(i => i.uid === value)?.user ?? null : null);
```

`getUser` reads `userCacheRef`, which is populated **only** by `fetchUsers` — the first
page of 10 users, plus whatever paging and searching have loaded. There is no
fetch-by-uid for the current value. When the value names a user who is not in that set,
`resolvedUser` is `null` and the trigger renders `resolvedPlaceholder` (line 346-348) —
the same `EmptyValue` it shows when nothing is selected.

Failure scenario: an installation with 200 users; a record's `assignee` is user #147. The
form opens and the assignee field reads as empty. The value is not lost — nothing calls
`onValueChange` — but an editor looking at a field that says "no value" will set one, and
the previous assignment is overwritten by a UI that lied about the current state. This is
the silent-empty-picker shape the audit brief names, in the one picker that does not
resolve its own value.

Fix direction: resolve the selected uid explicitly when it is absent from the cache — a
`GET /admin/users/:uid`, or `?search=<uid>` — the way `RelationSelector` resolves its
`selectedItems` in the effect at `RelationSelector.tsx:216-314`. Failing that, render the
raw uid rather than the empty placeholder, so the field never claims to be unset when it
is not.

#### H4. `UserSelector` type-ahead has neither debouncing nor request cancellation

`packages/cms/src/components/UserSelector.tsx:50-95,102-106`

```
const search = useCallback((searchStr: string) => {
    setCurrentSearch(searchStr);
    offsetRef.current = 0;
    fetchUsers(searchStr, 0, false);
}, [fetchUsers]);
```

`handleSearchChange` (line 254-257) calls this on every keystroke. `fetchUsers` issues
the request immediately and, when it resolves, does `setItems(prev => append ? … :
newItems)` (line 87) with no check that this response is still the one wanted.

Failure scenario: typing "alice" issues five requests. The response for "al" arrives
after the response for "alice" — routine on a loaded server, since neither request is
cancelled and they complete out of order — and the list is replaced with the results for
"al" while the input reads "alice". `offsetRef.current` is also stamped by whichever
response lands last (line 89), so the next "load more" pages from the wrong offset.

`useRelationSelector` already solves both halves for the relation picker: a 300 ms
debounce (line 211-222) and a `cancelled` flag that disowns a superseded response (line
184-204), with a comment explaining exactly this race. `UserSelector` predates or
ignores it.

Fix direction: lift the same debounce-and-disown shape out of `useRelationSelector` into
something both hooks call, rather than writing it twice — the two pickers are otherwise
near-identical files and will keep diverging.

---

### MEDIUM

#### M1. `ReferenceWidget` renders nothing — no preview and no button — for two reachable values

`packages/cms/src/components/ReferenceWidget.tsx:114-153`

```
if (Array.isArray(value)) { child = …previews… }
else if (value?.isEntityReference && value?.isEntityReference()) { child = …preview… }
…
{child}
{!value && <div …><Button onClick={onEntryClick}>Edit {name}</Button></div>}
```

Two values fall between the two branches:

* **An empty array.** `[]` is truthy, so `!value` is false and the "Edit" button is not
  rendered; the array branch maps zero previews. The widget renders an empty `div`. A
  multiselect reference field that has been cleared can never be re-opened.
* **A plain wire-shape reference.** `value.isEntityReference` only exists on an
  `EntityReference` *instance*. A `{ __type: "reference", id, path }` object off a
  freshly-read row is not one, so neither branch matches and again nothing renders.
  `RelationSelector` handles exactly this case by calling `normalizeToEntityRelation` on
  every incoming value (`RelationSelector.tsx:192-196`), and `RelationFieldBinding` does
  the same (`RelationFieldBinding.tsx:71,127`); `ReferenceWidget` normalises nothing.

`ReferenceWidget` is exported from `packages/cms/src/index.ts:28` and
`components/index.ts:27` and has no caller inside the repo, so nothing in the admin
exercises it — it is a public API component whose two dead paths only a framework user
will find.

Fix direction: compute `hasValue` as "a non-empty array, or a normalisable reference",
normalise through the shared helper before rendering, and key the button off `!hasValue`
rather than off `!value`.

#### M2. `ReferenceWidget`'s `useCallback` dependency lists name the wrong callback

`packages/cms/src/components/ReferenceWidget.tsx:75-85,97-104`

```
const onMultipleEntitiesSelected = useCallback((entities) => {
    …
    onMultipleReferenceSelected({ references, entities });
}, [disabled, onReferenceSelected]);          // ← reads onMultipleReferenceSelected

const clearValue = useCallback((e) => {
    … onMultipleEntitiesSelected([]) … onSingleEntitySelected(null) …
}, [onReferenceSelected]);                    // ← reads neither
```

Failure scenario: a parent that passes a fresh `onMultipleReferenceSelected` (an inline
arrow closing over current state — the common case) while keeping
`onReferenceSelected` stable or undefined. The memoised callback is never rebuilt, so the
selection is delivered to a closure over stale state. `clearValue` has the same problem
one level up and additionally will not see a new `multiselect`.

This is the JSX face of class 12 — the wrong identifier in a position the compiler does
not check. `react-hooks/exhaustive-deps` reports it; the finding survives because lint
runs `--quiet` (see bug-classes §20).

Fix direction: correct both lists. Worth a sweep of `useCallback` lists in this package
for a dependency that does not appear in the body.

#### M3. A many-to-many save deletes every junction row and re-inserts what the client read

`packages/server-postgres/src/services/RelationService.ts:1077-1092,1115-1130`

```
await tx.delete(junctionTable).where(eq(sourceJunctionColumn, parsedParentId));
… if (targetEntityIds.length > 0) { … await tx.insert(junctionTable).values(newLinks); }
```

This is a full replacement of the membership set from a list the browser assembled out of
a read it did earlier. `PersistService.save` only reaches it for keys actually present in
the payload (`PersistService.ts:285-296`, gated on `hasOwnProperty`), which correctly
protects a row saved without its relations. Within one session, adding and removing in
the `RelationSelector` produces the right final set — `onItemClick` toggles against
`selectedItems` and emits the whole list (`RelationSelector.tsx:382-400`), and the server
writes exactly that. The problems are at the edges:

* **Lost update between two editors.** A and B both open post 7. A adds tag X and saves;
  B, whose form still holds the pre-A list, saves any field of post 7 and the whole
  junction is rewritten without X. There is no version check, no `ON CONFLICT`, and no
  diff — the last save wins the entire set, and neither user is told.
* **A partially-read set is a partially-deleted set.** The read that fills the form runs
  under RLS (`batchFetchRelatedEntitiesMany`, `RelationService.ts:839`), so a user who
  can edit the parent but cannot *see* some target rows gets a shorter list; saving
  writes that shorter list back and the invisible links are gone. The same holds if the
  batch read throws: `FetchService.ts:1027-1029` logs a warning and continues, so the key
  is simply absent — that case is safe by the `hasOwnProperty` gate — but a *partial*
  result is not distinguishable from a complete one.
* **Junction payload columns are destroyed.** A junction carrying its own columns
  (`position`, `role`, `created_at`) loses them on every save of the parent, because the
  rows are re-inserted with only the two key columns (line 1084-1087, 1122-1125).

Fix direction: diff rather than replace — delete the ids that left, insert the ids that
arrived with `ON CONFLICT DO NOTHING`, and leave the rest untouched. That fixes all three
at once: unchanged rows keep their payload columns, invisible rows are never named so
never deleted, and two editors touching disjoint tags no longer clobber each other.

#### M4. Both previews compute `dataLoadingError` and throw it away

`packages/cms/src/preview/components/RelationPreview.tsx:181-190`
`packages/cms/src/preview/components/ReferencePreview.tsx:148-157`

`dataLoadingError` is destructured out of `useFetch` in both files and referenced nowhere
below (grep confirms one occurrence each). `useFetch` sets it and also clears `entity`
(`useFetch.tsx:100-105`), so an errored fetch lands in the `!usedEntity` branch and
renders **"Entity not found"**.

Failure scenario: an RLS policy denies the target row, or the API is briefly 500ing. The
card says the row does not exist. A developer chasing "my relation disappeared" is sent
after a deletion that never happened; the real error is in `console.error` at
`useFetch.tsx:101`.

This is class 20 exactly — a value computed and discarded — and it is one of the 155
`no-unused-vars` "assigned but never used" findings the `--quiet` flag hides.

Fix direction: branch on it. "Could not load" with the error in a tooltip is a different
state from "not found", and `InlineEntityPreviewMissing` already takes a `tooltip`.

#### M5. `RelationSelector` ignores the picker's error, so a failed list reads as an empty one

`packages/app/src/hooks/data/useRelationSelector.tsx:46-54,157-161`
`packages/cms/src/components/RelationSelector.tsx:143-155,669-674`

`RelationSelectorController` declares `error: Error | undefined`, the hook sets it on
every failure, and the destructure in `RelationSelector` takes `items`, `isLoading`,
`hasMore`, `search`, `loadMore`, `entityToRelationItem` — not `error`. The render then
shows `noResultsText` ("No relations found.") for `!isLoading && availableItems.length ===
0`, which is the state a failed fetch leaves behind.

Failure scenario: the target collection 403s under RLS, or the search string trips a
server error. The dropdown says there are no rows to pick. Nothing distinguishes "this
collection is empty", "your filter matched nothing" and "the request failed".

This is a declared field with no reader — bug-classes §21 — and the fix is small because
the value already exists.

Fix direction: render an error state when `error` is set, with a retry.

#### M6. Neither picker restores focus when it closes

`packages/cms/src/components/RelationSelector.tsx:618-620`
`packages/cms/src/components/UserSelector.tsx:378-380`

```
onCloseAutoFocus={(e) => { e.preventDefault(); }}
```

Radix returns focus to the trigger on close; `preventDefault` cancels that, and neither
component focuses anything itself. Combined with the manual Escape handler (below), a
keyboard user who opens the picker, presses Escape, and then Tab resumes from
`document.body` — at the top of the page, not at the field they were editing. The popover
is `modal={false}` and there is no focus trap while it is open either, so Tab from the
search input walks into the form behind the list.

Fix direction: drop the `preventDefault`, or call `localTriggerRef.current?.focus()` on
every close path (`closePopover`, the outside-click handler, the Escape handler, and the
single-select branch of `onItemClick`).

#### M7. The pickers' Escape handlers do not claim the key, against this repo's own documented idiom

`packages/cms/src/components/RelationSelector.tsx:443-452`
`packages/cms/src/components/UserSelector.tsx:293-298`

Both register `document.addEventListener("keydown", handleKey, true)` — the capture-on-
document half of the idiom — and neither calls `stopPropagation()`.
`packages/cms/test/components/escape_key_ownership.test.tsx` pins precisely why that is
not enough: capture-on-document *plus* `stopPropagation` is what stops a window-bubble
listener on a lower layer. `EntityInspector.tsx:94` does it correctly, and its comment at
line 82 claims it is "the same idiom the selectors already use to own the key" — which is
what makes this easy to miss: the comment asserts the property, and the selectors do not
have it.

Failure scenario: `SplitListView` has a record open and registers a window-bubble Escape
handler (`SplitListView.tsx:351`) that closes the detail panel; `SelectableTable`
registers a document-bubble one (`SelectableTable.tsx:222`) that clears the selected
cell. The user selects a relation cell, opens the dropdown, presses Escape to dismiss it
— and the dropdown closes, the cell is deselected, and the record panel closes, all from
one keystroke.

Fix direction: `ev.stopPropagation()` in both handlers, and correct the `EntityInspector`
comment so it stops vouching for code that does not do this.

---

### LOW

#### L1. `loadMore` re-fetches the whole prefix instead of the next page

`packages/app/src/hooks/data/useRelationSelector.tsx:225-230,185-192`

`loadMore` does `setLimit(prev => prev + pageSize)` and `fetchData` re-issues the query
with `offset: 0` and the larger limit, replacing `items` wholesale. Paging through *n*
pages transfers `pageSize · n(n+1)/2` rows instead of `pageSize · n`, and on the realtime
path tears down and re-establishes the subscription each time. Bearable at the default 10
× a few pages; not a shape to leave in a picker aimed at large collections.

Fix direction: fetch `offset: items.length, limit: pageSize` and append.

#### L2. `fixedFilter` restricts the picker's list and nothing else

`packages/cms/src/components/ReferenceWidget.tsx:28-31` ("Allow selection of entities
that pass the given filter only"), `RelationFieldBinding.tsx:100`,
`useRelationSelector.tsx:148`

The filter is applied as a `where` on the list query. `updateRelationsUsingJoins` never
sees it — it is not sent with the write and the server has no record of it
(`RelationService.ts:1019-1130`). Any client can write a relation to a target the filter
excludes. That is defensible for a *presentation* filter, but the prop's documentation
says "allow selection of ... only", which reads as a constraint.

Fix direction: reword the doc to say it narrows what is offered and is not enforced, and
point authors at a `securityRules` `WITH CHECK` for the enforcing version.

#### L3. The picker never consults `canRead`

`packages/cms/src/hooks/navigation/useNavigationResolution.ts:20` is the only caller of
`canReadCollection`; `usePermissions` exposes `canRead`
(`packages/app/src/hooks/usePermissions.ts:33-43`) and neither `SelectionTableBinding`
(which does use `canCreate`, line 348) nor `RelationSelector` asks it.

This is **not** an enumeration leak: `checkOperation` evaluates the same security rules
that are compiled to RLS (`packages/common/src/util/permissions.ts:88-131`), so a
collection `canRead` refuses is one whose rows Postgres also refuses. The result is a
consistency problem rather than a security one — a collection hidden from the drawer
still opens a picker, which then lists nothing, and the user cannot tell why.

Fix direction: refuse the picker with a stated reason when `canRead(collection, path)` is
false.

#### L4. `entityToRelationItem` omits `path` from its dependencies

`packages/app/src/hooks/data/useRelationSelector.tsx:92-128`

The body builds `new EntityRelation(entity.id, path)` (line 126); the dependency list is
`[getLabelFromEntity, getDescriptionFromEntity, descriptionProperty]`. A `path` change
without one of those changing yields relations pointing at the previous collection. The
callback is also exported through the controller and captured into a ref by
`RelationSelector` (line 177-178), so the stale value travels.

#### L5. `UserSelector`'s catch swallows every failure

`packages/cms/src/components/UserSelector.tsx:90-92`

```
} catch { setHasMore(false); }
```

No error state, no log, no message. A 401 on the token refresh, a 404 on the route (which
the comment at line 61-65 records as having happened once already) and an empty user table
are all rendered as "No users found." — class 4, in a component whose whole job is to show
a list.

#### L6. `RelationSelector`'s `fixedFilter` prop is an identity trap for external callers

`packages/app/src/hooks/data/useRelationSelector.tsx:208,233-239`

`fetchData` lists `fixedFilter` in its dependencies and the effect depends on `fetchData`.
Every in-repo caller passes either `undefined` or `property.admin?.fixedFilter` — both
referentially stable — so nothing breaks today. An external caller of the exported
`RelationSelector` passing an inline object literal gets a fetch on every render, and on
the realtime path a subscribe/unsubscribe cycle with it. `getRelationIncludeParams` was
given a module-level constant specifically to avoid this
(`packages/app/src/util/previews.ts:96-98`); the prop next to it has no such protection.

Fix direction: memoise on a serialised form of the filter rather than its identity.

---

## Checked and clean

* **Nested preview recursion is bounded.** `NestedEntityPreviewBoundary` wraps the body
  of `EntityPreviewBinding` (`EntityPreviewBinding.tsx:145,258`), and every preview that
  can appear inside it reads `useIsNestedEntityPreview` and renders `InlineEntityPreview`
  instead (`RelationPreview.tsx:175-179,248-255`, `ReferencePreview.tsx`,
  `ArrayOfRelationsPreview.tsx:20`, `ArrayOfReferencesPreview.tsx:18`,
  `PropertyPreview.tsx:40`). `InlineEntityPreview` renders a link glyph and a title
  string and instantiates no further preview, so the maximum depth is 2 by construction
  rather than by a counter. `RootEntityPreviewBoundary` resets it for surfaces that open
  a fresh context. No unbounded recursion, no cycle risk on a self-referencing relation.
* **Portal container / class 32.** `RelationSelector.tsx:472` and `UserSelector.tsx:308`
  both read `usePortalContainer()` before falling back to `document.body`, with the
  post-mortem in the comment. `Sheet` supplies one (`packages/ui/src/components/Sheet.tsx:120`)
  and so does `Dialog` (`Dialog.tsx:143`), so a picker opened from a side panel portals
  inside the scroll lock and its list scrolls.
* **Class 25 (painted under the thing that opened it).** The popover content carries
  `z-50` and is portalled *into* the sheet's own content element, so it is stacked within
  that subtree rather than competing with it. Nothing observed painting behind the panel.
* **Server-side pagination and search.** `useRelationSelector` sends `limit` and
  `searchString` to the driver (`useRelationSelector.tsx:167-192`); nothing pulls a whole
  collection into the browser. `CommandPrimitive shouldFilter={false}`
  (`RelationSelector.tsx:623`) correctly disables cmdk's client-side filter so the
  server's result set is what is shown.
* **Relation type-ahead debounce and cancellation.** 300 ms debounce with a 0 ms path for
  clearing (`useRelationSelector.tsx:211-222`); the non-socket branch disowns a superseded
  response (line 184-204) and the socket branch unsubscribes (line 131-136). Both are
  documented with the race they prevent.
* **The write/read shape asymmetry in the relation path.** `RelationSelector` normalises
  every incoming value through `normalizeToEntityRelation` (line 192-196) and additionally
  accepts a bare id or a `{ id, path, data }` object in its resolution effect (line
  242-301), falling back to `findById` for anything it cannot resolve locally.
  `RelationFieldBinding` normalises on both its single-value paths (lines 71, 127).
  `normalizeToEntityRelation` itself handles instance, `__type` tag, duck-typed method,
  and bare-primitive-with-target-path, and treats `""` as unset rather than as row `""`
  (`packages/common/src/util/entities.ts:155-181`). This is the one place the asymmetry
  was expected to bite and it does not.
* **Bare-id and `{id}` shapes on the junction write.** `relationTargetIds`
  (`RelationService.ts:39-54`) accepts both and *throws* on an element with no id rather
  than silently shortening the membership list, with the post-mortem in its docblock.
* **`PersistService` only touches a junction for keys actually sent.**
  `Object.prototype.hasOwnProperty.call(otherValues, key)` at `PersistService.ts:292`, so
  a row saved without its relation keys keeps its links. This is what keeps M3 from being
  a data-loss bug on every ordinary save.
* **Adding and removing in one session.** `onItemClick` toggles against `selectedItems`
  and emits the full list; `handleRemoveItem` and `handleClear` do the same
  (`RelationSelector.tsx:382-413`). The emitted list is what the server writes. Correct.
* **Filter-field multiplicity.** `RelationFilterField` takes multiplicity from the
  *operator* rather than the relation's cardinality and coerces the held value on the same
  test (`RelationFilterField.tsx:120-146,195-201`), so `==` can never be handed an array.
  Pinned by `relation-filter-multiplicity.test.tsx`.
* **`useId` on the null-filter checkboxes.** Both filter fields use `useId()`
  (`RelationFilterField.tsx:113`, `ReferenceFilterField.tsx:144`) after the literal
  `"null-filter"` collision; the filters dialog renders every property at once, so this
  matters.
* **The picker's list is RLS-bound.** It goes through `useData()` → the ordinary
  authenticated accessor, not a service credential. Combined with
  `canReadCollection` evaluating the same rule set that is compiled to RLS, there is no
  path by which the picker lists rows the caller could not read through the API directly.
* **No unbounded `include` fan-out per row in the picker.** `getRelationIncludeParams`
  returns a shared constant and only when the target has relations at all
  (`packages/app/src/util/previews.ts:96-116`), so the eager load is one request rather
  than N.
* **`SelectionTableBinding` initial-selection fetch.** The element is constructed once at
  `sideDialogsController.open` time (`useSelectionDialog.tsx:35-40`), so the inline
  `selectedEntityIds` array in `MultipleRelationFieldBinding.tsx:66` is stable for the
  dialog's life and the effect at `SelectionTableBinding.tsx:152-181` does not loop. It
  does issue one `findById` per selected id in parallel, which is worth watching on a
  field with hundreds of members, but it is not the render-loop it looks like.

---

## Open questions

1. **Is `inlineEditing` on for the collections people actually ship?** H1's cost is
   proportional to it. The default is on (`CollectionViewBinding.tsx:244`) and the
   collection editor's copy calls it the default too
   (`DisplaySettingsForm.tsx:285-287`), so I have assumed it is the normal case — but a
   count over the demo and dogfood apps would size the finding properly.

2. **Does the relation cell's picker actually open a socket subscription in the deployed
   admin, or does the client fall through to `find`?** `useRelationSelector` branches on
   `accessor.listen` being present (line 167). I did not trace which accessors the admin's
   client builds at runtime. The finding holds either way — 50 REST requests or 50
   subscriptions — but the severity of the sustained cost differs.

3. **Can a junction carrying its own payload columns be declared today?** M3's third bullet
   assumes yes. The `manyToMany` config names only `table`, `sourceColumn` and
   `targetColumn` (`RelationService.ts:1095-1102`), so extra columns would be schema-level
   rather than declared, and I did not check whether the introspection path can produce
   one.

4. **How does `Sheet`'s `transform-gpu` interact with the popover's positioning?** A
   `position: fixed` descendant of a transformed element is positioned against that
   element, not the viewport. `Sheet`'s content carries `transform`, `transform-gpu` and
   `will-change-transform` (`Sheet.tsx:107-110`) and is the portal host for the picker.
   Class 32 was clearly closed with real testing, so I expect this is fine in practice —
   but I could not verify it by reading, and it is the kind of thing that regresses when
   the sheet's animation changes.

5. **Is `ReferenceWidget` used by anyone outside this repo?** It is exported from the
   package index and has no internal caller, so M1 and M2 are either live bugs for
   framework users or dead code. If it is genuinely unused, deleting it is a better fix
   than repairing it, and `RelationSelector` is the component to point people at.
