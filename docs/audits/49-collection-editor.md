# Unit 49 — the in-app collection/schema editor

Read-only audit, 2026-08-08. Scope: `packages/admin/src/collection_editor/**`,
`packages/admin/src/collection_editor_ui.ts`, `packages/server/src/api/ast-schema-editor.ts`,
`packages/server/src/api/schema-editor-routes.ts`, `packages/server/src/collections/validate-config.ts`,
`packages/studio`.

---

## Verdict

Authorization is the one thing this subsystem gets right: the schema-editor routes are
mounted into a pre-gated router (`init.ts:1212`), the gate is auth + admin role, and the
comment above it records the exact regression — an ungated `POST /collection/save` — that
the current shape was written to close. Everything downstream of that gate is worse than
it looks. The writer, `AstSchemaEditor`, can only see a collection declared as
`const x: CollectionConfig = { … }`; **every collection `rebase init` scaffolds is declared
`defineCollection({ … })`**, a call expression the AST walk cannot open. On those files —
which is to say on every stock project — `getCollectionObject` returns `null`, and the three
entry points diverge into three different wrong answers: `saveProperty` throws,
`deleteProperty` reports success and does nothing, and `saveCollection` falls through to the
"create a new file" branch and rewrites the collection from scratch with `overwrite: true`,
losing the imports, the callbacks and the relation targets. The suite in
`packages/server/test/ast-schema-editor*.ts` is green because every fixture it writes uses the
bare-object-literal shape that only `rebase introspect` produces — class 7, a test and the
code agreeing on a fiction, with the shape the product's own `init.test.ts:294` calls "the
idiom we actually recommend" never exercised.

Beneath that sit two independent silent-discard bugs of the kind classes 11 and 27 name.
The panel and the file writer both nest presentation keys into `admin`, in two functions with
**opposite precedence** (`toAdminCollectionConfig` prefers the top-level value,
`nestAdminKeys` prefers the existing block), so a presentation edit made in the panel is
resolved in favour of the value the user just changed away from. And every partial save the
panel issues — `{ collectionData: { propertiesOrder } }`, which is what adding or deleting a
single property sends — is interpreted by `saveCollection` as a *whole-collection* save with
everything else absent: it deletes the collection's `securityRules` from the file and replaces
its `admin` block with a one-key object. Deleting `securityRules` is not merely lossy, because
`applyCollectionDefaults` then grants the collection the directory default, which in the
scaffold is `{ operation: "select", access: "public" }`. Adding a column from the data table
widens who can read the collection.

Nothing in this subsystem touches the database, which is the one piece of good news about
destructive changes: a delete or a rename cannot lose a row today. It also cannot *apply* one,
the CLI's destructive-push gate never sees these edits, and the confirmation the panel shows
("This will **not delete any data**") is a promise about the current release rather than about
the `rebase db push` the user will run next.

---

## CRITICAL

### C1. `defineCollection(...)` is invisible to the AST editor, and the three call sites fail three different ways

`packages/server/src/api/ast-schema-editor.ts:83-106`, `:192-194`, `:236-238`, `:259-267`

`getCollectionObject` resolves the default export, follows the identifier to its variable
declaration, and then requires the initializer to be an object literal:

```ts
const varDecl = file.getVariableDeclaration(varName);
return varDecl?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression) || null;
```

The fallback (`:100-104`) loops the file's variable declarations looking for the same thing.
Every scaffolded collection is
`const postsCollection = defineCollection({ … })`
(`packages/cli/templates/template/config/collections/posts.ts:5`; identically in
`authors.ts:3`, `tags.ts:3`, `users.ts:3`, `presets/ecommerce/{products,orders,categories}.ts`),
whose initializer is a `CallExpression`. `getInitializerIfKind` returns `undefined`, the
fallback finds nothing, and the function returns `null`.

`defineCollection` is not incidental: `packages/cli/src/commands/init.test.ts:290-302` pins it
as "the idiom we actually recommend", explicitly in preference to a bare
`const x: CollectionConfig = {…}`. Meanwhile `rebase introspect` emits the bare form
(`packages/server-postgres/src/schema/introspect-db-logic.ts:1157`), which is the *only* form
this editor handles — and the only form its tests use
(`packages/server/test/ast-schema-editor-admin.test.ts:114-129`).

The three consumers then diverge:

| entry point | line | behaviour on `null` |
|---|---|---|
| `saveProperty` | `:194` | `throw new Error("Collection ${id} not found in ATS workspace.")` — 500 to the panel, "ATS" is a typo for AST |
| `deleteProperty` | `:238` | `if (!collectionObj) return;` — the route still answers `{ success: true }` (`schema-editor-routes.ts:21-22`) |
| `saveCollection` | `:263-267` | falls into the **create-a-new-file** branch and calls `createSourceFile(..., { overwrite: true })` |

**Failure scenario.** `rebase init`, `rebase dev`, open Posts in the collection editor, change
the description, Save. `saveCollection` receives the whole collection, cannot find an object to
patch, and overwrites `config/collections/posts.ts` with a freshly generated file:
`import { CollectionConfig } from "@rebasepro/types"` and a bare object literal. Gone: the
`defineCollection` wrapper, `import authorsCollection from "./authors.js"` and
`import tagsCollection from "./tags.js"`, and — because the client `JSON.stringify`s the payload
(`useLocalCollectionsConfigController.tsx:88`) — every function-valued key, including the
relation `target` thunks that referenced those imports. There is no `oldAstNode` passed on this
branch (`:267`), so `convertJsonToAstString`'s preservation logic (`:134-165`) never runs. The
file no longer compiles; the backend's loader throws for the whole directory
(`packages/server/src/collections/loader.ts:141-147`) and the Vite virtual module fails to
resolve. One click, one unrecoverable file, no warning.

Separately, deleting a property looks like it worked and did not: the dialog closes, the
snackbar is green, and the property is back on reload.

**Fix direction.** `getCollectionObject` must unwrap a call expression whose callee is
`defineCollection` (and, defensively, `satisfies`/`as` expressions) before giving up. Then make
"could not find an object literal" a hard, explicit refusal at *all three* call sites rather
than three different silences — in particular `saveCollection` must never take the create
branch for a `collectionId` whose file already exists, and `deleteProperty` must not report
success for a no-op. Gate it by running the existing suite against a fixture written the way
`init` writes them; `init.test.ts` already knows what that is.

---

### C2. A partial `/collection/save` deletes `securityRules`, which silently widens access

`packages/server/src/api/ast-schema-editor.ts:270-282`

```ts
if (!("securityRules" in collectionData) || collectionData.securityRules === undefined || (Array.isArray(...) && length === 0)) {
    const srProp = collectionObj.getProperty("securityRules");
    if (srProp) srProp.remove();
```

"Absent from this payload" is read as "the user cleared it". But the panel routinely sends
payloads that are not whole collections. `useLocalCollectionsConfigController.tsx:205-221`:

```ts
saveProperty: async ({ path, propertyKey, property, newPropertiesOrder }) => {
    await request("/property/save", { collectionId: path, propertyKey, propertyConfig: property });
    if (newPropertiesOrder) {
        await request("/collection/save", { collectionId: path, collectionData: { propertiesOrder: newPropertiesOrder } });
    }
},
```

`deleteProperty` (`:214-221`) and `updateCollection`/`updatePropertiesOrder` (`:223-227`) do the
same. `newPropertiesOrder` is supplied whenever a property is *added* or *deleted* through the
standalone property dialog — `ConfigControllerProvider.tsx:316` and `:332` — which is the
dialog the data table's "+ add column" button opens
(`ui/PropertyAddColumnComponent.tsx:36-40`).

**Failure scenario.** A collection declares
`securityRules: [{ operation: "select", ownerField: "author_id" }, …]` — rows are visible only
to their owner. An admin clicks "+" on the table view and adds a `notes` column. Two requests
go out; the second carries only `propertiesOrder`. `securityRules` is removed from
`posts.ts`. At the next boot `applyCollectionDefaults`
(`packages/server/src/collections/loader.ts:73-82`) sees a collection with no rules of its own
and assigns the directory default from `config/collections/index.ts` — in the scaffold,
`{ operation: "select", access: "public" }`
(`packages/cli/templates/template/config/collections/index.ts:29-32`). The next
`rebase db push` writes that as the live policy. An owner-scoped collection becomes readable by
every authenticated user, and the only trace is a diff line in a file nobody re-reads after a
column add.

Note the comment at `:278-280` reasons about this deliberately ("if it's `[]`, omitting it
entirely … correctly triggers 'unmapped policies'"). The reasoning is sound for a *full* save
and wrong for a partial one; the function cannot tell them apart because the wire format does
not say.

**Fix direction.** Distinguish the two operations at the protocol level rather than by
inference — a `PATCH`-shaped route (or an explicit `clear: ["securityRules"]`) for the partial
writes, and keep the delete-on-absent rule only for a save that declares itself complete. The
partial writers all have exactly one field to set; a dedicated `/collection/properties-order`
would be the smallest honest fix.

---

## HIGH

### H1. The same partial save replaces the whole `admin` block with one key

`packages/server/src/api/ast-schema-editor.ts:289-310`, `:134-165`

After the `securityRules` removal, `collectionData` (`{ propertiesOrder }`) goes through
`nestAdminKeys` and becomes `{ admin: { propertiesOrder } }` — `propertiesOrder` is in
`ADMIN_COLLECTION_KEYS` (`packages/types/src/types/admin_block.ts:66`). The loop at `:291`
finds the existing `admin` property and calls `prop.setInitializer(newInit)` with
`convertJsonToAstString({ propertiesOrder }, 1, oldAdminBlockAst)`.

The preservation branch (`:146-161`) keeps an old key only when its initializer is code
(`ArrowFunction`, `FunctionExpression`, `Identifier`, `CallExpression`, `JsxElement`) or its
name is one of `target`/`callbacks`/`permissions`/`securityRules`. `icon: "FileText"` is a
string literal. `listProperties: ["title"]` is an array literal. `group`, `defaultViewMode`,
`defaultSize`, `sort`, `filterPresets`, `kanban`, `pagination` — all data, none preserved.

**Failure scenario.** Add one column from the table view. The collection's icon, its navigation
group, its list columns, its default view mode and its kanban configuration are all deleted
from the source file in the same write that deleted its security rules. The panel re-reads the
file and renders the collection with a default icon, ungrouped, showing every column.

**Fix direction.** Same as C2 — the partial writers must not be handled by the whole-collection
writer. Failing that, `convertJsonToAstString` needs a "merge, do not replace" mode for the
`admin` block, but that only moves the ambiguity rather than removing it.

---

### H2. The property editor writes `ui.*`, which is dead *and* fatal at the next boot

`packages/admin/src/collection_editor/ui/collection_editor/properties/advanced/AdvancedPropertyValidation.tsx:10-11`
and `properties/MapPropertyField.tsx:114`

```ts
const hideFromCollection = "ui.hideFromCollection";
const readOnly = "ui.readOnly";
```
```ts
onValueChange={(v) => setFieldValue("ui.spreadChildren", v)}
```

`ui` was renamed to `admin` in 0.11. The runtime reads the new name — `property.admin?.readOnly`
(`packages/app/src/components/common/useColumnsIds.tsx:112`), `property.admin?.hideFromCollection`
(`:46`, `:94`, `:128`), `property.admin?.spreadChildren` (`:72`, `:99`) — so all three toggles do
nothing. Worse, the boot validator classifies `ui` as a **known-removed** key, which is fatal by
design (`packages/server/src/collections/validate-config.ts:253-255`, dispatched at `:420`,
thrown at `:539-565`, called from `packages/server/src/init.ts:619`):

> `ui` was renamed to `admin` in 0.11, to match the collection's block — rename the key

**Failure scenario.** A user opens a property, ticks "Read only", saves. `AstSchemaEditor.saveProperty`
writes `ui: { readOnly: true }` into the property config verbatim — there is no property-level
equivalent of `nestAdminKeys` anywhere in the repo (grep for `ADMIN_PROPERTY_KEYS` finds only
core, the admin-types assertion and the boot validator). The field is still editable in the
panel. On the next restart the backend refuses to boot with
`1 problem(s) in the collection config`, pointing at a key the user never typed. On a stock
project this compounds with C1: the same save also rewrote the file.

**Fix direction.** Change the three field paths to `admin.*`, and add the property-level
counterpart of `nestAdminKeys` to `saveProperty` so a flat `readOnly` from any other caller
lands in the block rather than at the top of the property (where `PROPERTY_MIGRATIONS` will also
make it fatal — `validate-config.ts:261-263`). A round-trip test through the real boot validator
is the gate: assert that whatever the editor writes, `assertCollectionConfigs` accepts.

---

### H3. Two nesting functions for one job, with opposite precedence

`packages/admin-types/src/admin_collection.ts:716-732` vs
`packages/server/src/api/ast-schema-editor.ts:15-31`

```ts
// toAdminCollectionConfig — the top-level value wins
const block = { ...(source.admin ?? {}) };
for (const [key, value] of Object.entries(source)) {
    if (ADMIN_COLLECTION_KEYS.includes(key)) block[key] = value;   // overwrites the block
```
```ts
// nestAdminKeys — the existing block wins
const merged = { ...block, ...existingBlock };
```

This is class 11 in its purest form: one hop, two declarations of the same rule, agreeing on
nothing. The panel's forms bind to the **flat** names —
`setFieldValue("icon", …)` (`GeneralSettingsForm.tsx:246`),
`setFieldValue("defaultViewMode", …)` (`DisplaySettingsForm.tsx:93`),
`openEntityMode` (`:87`), `orderProperty` (`:116`), `sideDialogWidth` (`:263`),
`inlineEditing` (`:286`), `includeJsonView` (`:299`) — while `values.admin` still holds the
object the collection was loaded with. `nestAdminKeys` resolves that conflict in favour of the
stale copy.

**Failure scenario.** A collection declares `admin: { defaultViewMode: "table" }`. The user opens
the Display tab, switches to "cards", saves. The payload carries
`{ defaultViewMode: "cards", admin: { defaultViewMode: "table" } }`. `merged` prefers
`existingBlock`, the file keeps `"table"`, and the panel snaps back on reload. Indistinguishable
from a broken save button — which is precisely the failure the test file's own docblock
(`ast-schema-editor-admin.test.ts:9-15`) says it exists to prevent. The test at `:60-70` asserts
the wrong direction, and its comment ("The block is what the file said") describes a read-back,
not an edit.

**Fix direction.** Delete `nestAdminKeys` and import `toAdminCollectionConfig`, or — since
`@rebasepro/server` must not depend on `@rebasepro/admin-types` — move the single implementation
next to `ADMIN_COLLECTION_KEYS` in `@rebasepro/types` and have both packages call it. Then pin
*agreement* rather than behaviour: a test that flattens, edits the flat copy, nests, and asserts
the edit survived.

---

### H4. Every edit in the Relations tab is discarded by the writer

`packages/server/src/api/ast-schema-editor.ts:292`

```ts
for (const key of Object.keys(collectionData)) {
    if (key === "relations") continue; // Kept via other AST functions or handled separately.
```

There are no other AST functions. `AstSchemaEditor` exposes exactly four methods —
`saveProperty`, `deleteProperty`, `saveCollection`, `deleteCollection` — and none of them
mentions `relations`. The tab writes into form state normally
(`CollectionRelationsTab.tsx:173`, `:188`: `setFieldValue("relations", newRelations)`), the
value reaches the server inside `collectionData`, and the loop steps over it.

**Failure scenario.** A user adds a `hasMany` relation in the Relations tab and saves. The dialog
closes cleanly. The relation is not in the file, not in the generated schema, not in the SDK.
Nothing anywhere reports a problem. Class 21 — a declared surface that nothing reads — with the
comment that made it look handled.

**Fix direction.** Either write `relations` like any other key (its values are plain data except
for `target`, which the existing `preservedProps` path at `:156` already protects by name), or
make the tab read-only with a message saying relations are edited in code. The silence is the
bug; either resolution removes it.

---

### H5. The studio's RLS editor calls the schema editor without a token, so it always 401s

`packages/studio/src/components/RLSEditor/RLSEditor.tsx:791-798` and `:990-997`

```ts
const response = await fetch(`${apiBase}/schema-editor/collection/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ … })
});
if (!response.ok) throw new Error("Failed to save policy");
```

No `Authorization` header. The route is behind `applyAdminGate` → `createRequireAuth` →
`requireAdmin` (`packages/server/src/init.ts:1122`), and `createRequireAuth` accepts a bearer
token only (`packages/server/src/auth/middleware.ts:137-146`) — there is no cookie fallback. The
response is a 401 every time.

Every other authenticated fetch in `packages/studio` gets this right —
`LogsExplorer.tsx:83-86`, `StorageView.tsx:727-733`, `ApiExplorer.tsx:53` all resolve
`apiConfig.getAuthToken()` first. These two are the outliers, which is class 17 along its
second axis: a feature applied at most of its call sites.

**Failure scenario.** In `rebase dev`, open Studio → RLS, pick a table backed by a collection,
click "Create Policy", fill it in, Save. "Failed to save policy", with no clue why — the code
throws a fixed string and never reads the 401 body. "Import to codebase" on a live policy fails
identically. Both are broken for every mapped table, which is most of them, and the surrounding
comments show both paths were reasoned about carefully and then shipped unauthenticated.

**Fix direction.** Attach the token as the neighbouring components do, and surface the response
body instead of a constant string — a 401 and a 501 `SCHEMA_EDITOR_*` mean different things to
the user.

---

## MEDIUM

### M1. The local controller drops three declared parameters

`packages/admin/src/collection_editor/useLocalCollectionsConfigController.tsx:193-227` vs
`packages/admin/src/collection_editor/types/config_controller.tsx:64-94`

`SaveCollectionParams`/`UpdateCollectionParams` declare `previousId` and `parentCollectionSlugs`;
`SavePropertyParams`/`DeletePropertyParams` declare `namespace` and `parentCollectionSlugs`. The
file-backed controller destructures none of them. `useJsonCollectionsConfigController` honours
`previousId` (`:131`, `:134`, `:148-150`, including deleting the old key). Class 17: one
parameter object, two implementations, one of them hand-listing a subset.

Consequences, in order of severity:

* **`namespace` dropped.** `ConfigControllerProvider.tsx:179-189` sets `namespace` to everything
  before the last dot when editing a nested map sub-property. Without it,
  `AstSchemaEditor.saveProperty` writes the leaf key at the *top level* of `properties`, creating a
  bogus sibling column while the nested property is untouched.
* **`previousId` dropped.** `CollectionEditorDialog.tsx:420-427` passes it, and `saveCollection`
  keys on `updatedCollection.slug`. Changing a collection's slug therefore creates
  `<newSlug>.ts` and leaves `<oldSlug>.ts` in place. Both are globbed by the loader
  (`loader.ts:129`), so the project now has two collections where the user renamed one.
* **`parentCollectionSlugs` dropped.** Subcollection edits address the top-level file named by
  the subcollection's own slug, which either does not exist (create a spurious root collection)
  or is a different collection entirely.

**Fix direction.** Forward the object rather than re-listing it, and give the routes the fields
they need to address a nested target. The narrower issue — a controller interface where one
implementation silently ignores half the contract — wants a shared conformance test over both
implementations.

### M2. The editor opens the *un-flattened* collection, so presentation fields render blank

`packages/admin/src/hooks/navigation/useBuildCollectionRegistryController.tsx:113` vs `:99`, `:188`

`getCollection` and the `collections` array both pass through `resolveAdminCollection`;
`getRawCollection` returns `registry.getRaw(...)` and merely *casts* to `AdminCollection`
(`CollectionRegistry.ts:331` returns "the pristine, un-normalized collection"). The editor
deliberately prefers `getRawCollection` (`CollectionEditorDialog.tsx:221-229`) to avoid
serializing injected runtime `relations` back to disk — a good reason with an unhandled
side-effect: `values.icon`, `values.defaultViewMode`, `values.listProperties` are all `undefined`
even when the file declares them inside `admin`.

**Failure scenario.** Open a collection that declares `admin: { icon: "FileText", group: "Content" }`.
The icon picker shows a blank, the group field is empty. The user re-picks the icon to fix it —
and H3 then throws that away. The two bugs conceal each other: the field looked unset, so the
revert reads as "it never saved".

**Fix direction.** Flatten for display and keep the authoring shape for the write — that is
exactly the `AdminCollection` contract described at `admin_collection.ts:635-655`. Applying
`resolveAdminCollection` in `getRawCollection` while continuing to strip injected relations is
the shape that satisfies both.

### M3. Deleting a collection breaks the project build

`packages/server/src/api/ast-schema-editor.ts:318-323` — `file.deleteImmediatelySync()`.

The scaffold's `config/collections/index.ts` statically imports every collection
(`import postsCollection from "./posts.js";` …, template `index.ts:1-7`). The backend loader
globs the directory and skips `index.ts` (`loader.ts:31-41`, `:129`), but the frontend's Vite
plugin eagerly globs *including* the index in order to read `defaultSecurityRules` and the
declared order (`packages/app/src/vitePlugin.ts:154`, `:161-176`). After the delete, `index.ts`
imports a file that no longer exists.

**Failure scenario.** Delete a collection from the editor. The confirmation says "This will not
delete any data, only the stored config, and reset to the code state"
(`CollectionEditorDialog.tsx:998-1004`). The dev server's next reload fails to resolve
`./posts.js`, and the whole admin panel goes blank — not just the deleted collection. Recovery
requires hand-editing a file the user was told was not involved.

Creation has the mirror gap: the new file is picked up by both globs (so it does work), but it
is absent from `index.ts`'s `collections` array and therefore sorted last in navigation
(`vitePlugin.ts:171-177`).

**Fix direction.** `deleteCollection` should also remove the import and the array entry from
`index.ts` — ts-morph is already loaded and this is a two-node edit — or the scaffold's
`index.ts` should stop statically importing what the glob already finds.

### M4. Destructive changes never reach the database, and the confirmation copy says so too confidently

The editor writes files only. `rebase dev` does not push: the watcher runs
`schema generate` + `generate-sdk` at most, and only under `--generate`
(`packages/cli/src/commands/dev.ts:485-529`); the default path prints a box telling the user to
run `rebase db push` themselves (`:554-583`). Boot-time reconciliation is additive by contract —
`packages/server-postgres/src/schema/ensure-collection-tables.ts:12-23` states it "will never
drop a table or a column, narrow a type, or alter a constraint", and the only DDL it emits is
`CREATE TYPE` (`:213`), `CREATE TABLE IF NOT EXISTS` (`:282`), `ADD COLUMN IF NOT EXISTS`
(`:346`), and a `RENAME COLUMN` (`:329`) reserved for the framework's own `legacyName`
migrations (`generate-postgres-ddl-logic.ts:960-965`), never for a user rename.

So: **no DDL preview anywhere in the editor** (grep of `collection_editor/**` for SQL turns up
only `CollectionRLSTab.tsx:135-147` reading `pg_policies`), and the destructive-push gate —
`decidePushSafety` in `packages/server-postgres/src/schema/destructive-sql.ts:84-93`, enforced at
`packages/server-postgres/src/cli.ts:236-271` — is only ever reached from a human typing
`rebase db push`. The editor's writes are invisible to it until then.

The consequences are drift rather than loss, but they are shaped to surprise:

* **Delete a property** → column and data remain, orphaned. `rebase doctor` will not report it:
  its finding types (`packages/server-postgres/src/schema/doctor.ts:40`) have no
  "extra/orphaned column" category.
* **Rename a property** → `ADD COLUMN` for the new name at the next boot; the populated old
  column stays and the app reads the new, empty one. This is the exact failure `renameLegacyColumn`
  exists to prevent for the framework's own renames, and it is unavailable to users.
* **Change a property's type** → no `ALTER TYPE`, no warning, no dialog anywhere.

Meanwhile the property-delete confirmation reads (`PropertyEditView.tsx:662-669`):

> This will **not delete any data**, only modify the collection.

True today; false the moment someone runs `rebase db push`, at which point Atlas plans the
`DROP COLUMN` that `destructive-sql.ts:6-9` describes as destroying data. Class 5 — remediation
text nobody tested, inverted: reassurance nobody tested.

**Fix direction.** Say what actually happens: "the column stays in your database until you run
`rebase db push`, which will ask before dropping it". For renames, the honest fix is to emit a
`legacyName` on the property so `ensureCollectionSchema`'s existing rename path applies.

### M5. Renaming a property key from the standalone dialog leaves the old key behind

`packages/admin/src/collection_editor/ConfigControllerProvider.tsx:305-328` calls
`saveProperty({ propertyKey: id, … })` with the **new** id and never reads `previousId`.
`AstSchemaEditor.saveProperty` looks the key up, misses, and takes the add branch
(`ast-schema-editor.ts:221-225`). The collection now declares both. The dialog path inside
`CollectionPropertiesEditorForm.tsx:340-372` handles this correctly — it clears the old key in
form state and the whole-object rewrite drops it — so the two entry points for the same user
action disagree.

Mitigating: `PropertyEditView.tsx:630` disables the id field for existing properties
(`disabledId={existing}`), which blocks the common route to this. The `previousId` machinery is
live wherever `existing` is false.

---

## LOW

### L1. A collection whose filename is not its slug gets a duplicate file

`getCollectionFile` resolves `${sanitizedCollectionId}.ts` at the root of `collectionsDir`
(`ast-schema-editor.ts:72-81`), even though the project loads sources recursively at `:44`.
A collection in a subdirectory, or in a file whose name differs from the slug, is not found —
and `saveCollection` then creates a second file at the root with the same slug. The scaffold's
`presets/ecommerce/*.ts` are exactly this shape (they are copied to the root by `rebase init`,
so the risk is to hand-organised projects). Resolve the file by *scanning the loaded project for
the collection whose `slug` matches*, rather than by filename convention.

### L2. `sanitizeCollectionId` rejects `/`, so a subcollection id 500s rather than 400s

`ast-schema-editor.ts:53-59` throws a plain `Error` for any id containing a separator. Combined
with M1's dropped `parentCollectionSlugs`, a subcollection edit produces a 500 with
`Invalid collection ID` rather than a route-level 400 explaining that subcollections are not
addressable. Cosmetic next to M1, but it is the message a user will see.

---

## Checked and clean

* **Authorization on the schema-editor routes.** `packages/server/src/init.ts:1201-1236` builds a
  fresh `Hono`, applies `applyAdminGate` (auth via `createRequireAuth` + `requireAdmin`,
  `:1094-1123`) and only then routes the editor into it. The comment at `:1202-1211` documents the
  Hono ordering trap (class: middleware appended after routes never runs) that previously left
  `POST /collection/save` open, and the current shape avoids it. `createSchemaEditorRoutes` has no
  gate of its own (`schema-editor-routes.ts`), which is safe only because `init.ts` is its sole
  mounting site — verified by grep. `requireAdmin` accepts `admin` or `schema-admin`
  (`auth/middleware.ts:190-192`); an absent token fails closed at `:139-146`.
* **Availability advertised by the server, not guessed by the client.**
  `GET /schema-editor/status` (`init.ts:1216-1220`) and the reasons enumerated at `:1143-1168`
  are read by `useLocalCollectionsConfigController.tsx:120-180`, which re-asks on identity change
  (`authKey`) and falls back to the old build-mode guess only for a 404. This is the class-2 fix
  applied correctly: one predicate, one reader.
* **Path traversal.** `sanitizeCollectionId` (`:53-59`) plus `safePath` (`:64-70`) is
  belt-and-braces; the allowlist alone already forecloses it.
* **`validate-config.ts` is a validator, not a stripper.** Despite the known "collection-key
  allowlist drops features" class, this file only *reports*: unknown keys warn
  (`:490-500`, escalating via `REBASE_STRICT_COLLECTION_CONFIG`), known-moved keys error, and
  nothing is removed from the object. `COLLECTION_KEY_LIST` cannot drift from the config types —
  `_EveryCollectionKeyIsListed` (`:139-149`) is a compile-time exhaustiveness check, and
  `ADMIN_COLLECTION_KEYS`/`ADMIN_PROPERTY_KEYS` are imported from core rather than copied. This
  is the strongest file in the unit.
* **`convertJsonToAstString` quotes correctly.** Keys are tested against
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/` and `JSON.stringify`d otherwise (`:158`, `:170`, `:223`), and
  string values always go through `JSON.stringify` (`:120`). No hand-rolled quoting, and no
  `.includes()` predicate over emitted text — the class-13 traps are absent here.
* **`nestAdminKeys` sources its list from core**, so a new `AdminCollectionOptions` field cannot
  leave the writer behind (`ast-schema-editor.ts:8-14`, `:16`). The mechanism is right; only the
  precedence (H3) is wrong.

---

## Expressiveness gap

**Backend supports, UI cannot express.** Zero references anywhere under
`packages/admin/src/collection_editor/` (verified by grep for the quoted key name):
`strictWrites`, `disableDefaultPolicies`, `dataSource`, `engine` (read via `values.engine` for
capability gating, never editable), `search`, `ownerId`, `listProperties`, and the property-level
`excludeFromApi`. `schema` is referenced only in the duplicate-collection comment
(`CollectionEditorDialog.tsx:262-266`), which notes explicitly that "`schema` has no field
anywhere in the editor". `callbacks` and `auth` appear only as keys to preserve or to strip.

**UI offers, backend drops.** `relations` — the entire tab (H4).

**Round trip.** Not lossless in either direction:

1. Opening a collection loads the un-flattened config, so presentation fields display as unset (M2).
2. Saving it resolves presentation conflicts against the user's edit (H3).
3. Any partial save deletes `securityRules` (C2) and the `admin` block (H1).
4. Property-level presentation is written under a key that is fatal at boot (H2).
5. On a `defineCollection` file — every scaffolded project — the whole file is rewritten from the
   JSON payload, losing imports, callbacks and relation targets (C1).

The `admin`-block half of the round trip *is* tested
(`packages/server/test/ast-schema-editor-admin.test.ts`), and the test is what pins the wrong
precedence in place. Its fixtures use the bare-object-literal shape, so C1 is invisible to it.

---

## Open questions

1. **Was `defineCollection` adopted after the AST editor was written?** `init.test.ts:290-302`
   calls it "the idiom we actually recommend" and argues against the bare form; the editor only
   handles the bare form. If the scaffold changed and this was not swept, the same question
   applies to every other consumer that pattern-matches collection source — the codemods under
   `scripts/codemod/` are the obvious next place to check. **UNCONFIRMED** — I did not read them.
2. **Is the schema editor reachable in the hosted console at all?** `RLSEditor.tsx:761-769`
   states the routes are not mounted under `NODE_ENV=production`, yet `hasCodebase`
   (`useStudioCapabilities`) still gates a UI branch that POSTs to them. Whether any deployment
   sets both `hasCodebase` and a non-production `NODE_ENV` decides whether H5 is "broken feature"
   or "dead branch".
3. **Does `updatePropertiesOrder` on the controller interface have any caller?** A grep found
   only the identically-named *local helper* inside `CollectionPropertiesEditorForm.tsx:277-283`,
   which shadows it and only touches form state. If the controller method is genuinely dead, it is
   a class-21 entry; if some plugin calls it, it is a fourth route into C2/H1.
4. **What happens to a collection whose `admin` block is code-valued throughout** (e.g.
   `admin: { Actions: MyActions, entityViews: [MyView] }`)? The preservation branch keeps
   identifiers, so the block survives H1 — but the client's `JSON.stringify` will have already
   turned `entityViews: [{ … }]` object entries into data. I did not trace which admin fields
   survive the wire in practice.
5. **Is there any writer for property-level `admin` nesting that I missed?** I found none, which
   makes H2 a total gap rather than a path gap — but `ADMIN_PROPERTY_KEYS` has three declared
   runtime consumers and I only located two (core's validator and the admin-types assertion).
