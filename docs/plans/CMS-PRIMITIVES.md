# The CMS as composable primitives — plan

2026-11-07. This is a plan; nothing in it is built yet.

It answers one question: can the admin panel be rebuilt so that three groups of parts are the same parts?

- the parts a developer composes
- the parts Claude composes inside `show_app`
- the parts the admin itself is made of

Yes. Most of what it needs already exists. The work is cutting the existing monoliths along lines they already have, finishing three half-built mechanisms, and deleting the parallel copies. It needs few new names.

Inputs:
- five read-only maps of the code: collection views, the form, previews and aggregates, docs and consumers, and layout
- the public API audit (`docs/api-coherence-audit-2026-11-07.md`, branch `claude/mystifying-archimedes-116b6b`)
- an adversarial review of the first draft, which found errors in that draft; this version fixes them

References are `file:line` at HEAD `1042479575`.

---

## 1. Decisions for you

Each one changes the work. My recommendation comes first.

**D1. What shape your code receives.**
- Recommendation: data hooks and `FieldValue` speak the **flat row the server sends** (ISO dates, a belongsTo as its foreign key).
- Collection and form blocks keep the admin's vocabulary where they already have it: `onEntityClick(entity)`, `entityActions`, override props.
- Why: Claude's hooks already return those rows, `client.data` returns them, and so does the backend's `context.data`. Giving the blocks a second callback shape would create two mechanisms for one thing.

**D2. Configure or compose.**
- Recommendation: **compose.** A place takes a component: `toolbar={<CollectionToolbar/>}` or `toolbar={null}`, the way `RebaseShell`'s `appBar` already works. Data inputs stay as data: a filter, a sort, a column list.
- No `compact` flag and no `toolbar="none"` string.
- Why: it is the rule you set on 10-20, "customizing = a component in a place, never a flag per feature".

**D3. The UI kit's unused `CollectionView` set** (`packages/ui/src/views/CollectionView/`, about 2,300 lines, public, with a docs page).
- Recommendation: **deprecate it in place.** It is a second implementation with no replacement inside `@rebasepro/ui`, so there is no alias: the components warn once on mount and the docs page says to use the cms blocks.
- Deprecate with it the four cms adapters that exist only to feed it: `useCollectionDataController`, `createStaticDataController`, `mapPropertyToConfig`, `mapPropertiesToConfigs`.
- Why: the cms bindings carry permissions, slots, overrides, realtime and saved state. Two implementations of one view is what the audit flags.

**D4. Choosing columns per call.**
- The problem: `propertiesOrder`'s JSDoc promises it hides what it omits (`cms-types/src/types/admin_collection.ts:283-288`). The code appends omitted keys back on purpose (`app/src/components/common/useColumnsIds.tsx:190-217`). Dragging a column saves `propertiesOrder` as user config, and a field added later must not vanish from that table. So `propertiesOrder` cannot be both things.
- Recommendation: one new prop, `CollectionPanel.fields`, which restricts and orders. It wins over `propertiesOrder`, the saved order, `listProperties` and the card slots for that panel. Column widths still persist.
- Fix the JSDoc of `propertiesOrder` to say what it does: it reorders, never hides.

**D5. Module names inside a Claude-written app.**
- Recommendation: **the real package names**: `@rebasepro/cms`, `@rebasepro/app`, `@rebasepro/ui`. Each maps, in the view, to a curated subset of that package.
- `"@rebasepro/mcp-apps"` goes away, and so do `CollectionView`, `RecordForm` and `openRecord`.
- Why: code Claude writes pastes into a project unchanged, and one set of docs describes both. The audit flags the private-package specifier.

**D6. Aggregates skip `afterRead` masking** (`server-postgres/src/PostgresBackendDriver.ts:665-668`).
- This leaks through REST today: a field masked by a callback can be grouped by or min/max-read.
- Recommendation: **fix it now, on its own**, before anything gives aggregates to Claude. On a collection with an `afterRead` callback, allow `count` only, or refuse aggregates. You choose which.

**D7. The view's address never changes** (`ui://rebase/app.html`), so Claude runs a stale view after every deploy.
- Seen tonight: Claude last downloaded the view at 21:03 and has not downloaded the 21:49 project build.
- Recommendation: a content hash in the address. Independent of everything else, so it can land first.

**D8. plugin-insights' blocks** (`KpiTile`, `ChartCard`, `BarChart`, …).
- Recommendation: **move them to `@rebasepro/ui`**, on `Card`, `Typography variant="stat"` and `Skeleton`, with labels and icons passed in as props. The kit cannot import `useTranslation`/`getIcon` from `@rebasepro/app`.
- You decide whether `useInsightsPlugin` stays deprecated; that was done without you.
- Not on the critical path.

---

## 2. What is wrong today (verified)

### Collection view

The chain is `CollectionPanel` → `CollectionViewBinding`, which is 1,789 lines.

- **No per-call choice of columns.** See D4. `listProperties` selects list columns. Nothing selects card or kanban fields.
- **No way to hide or shrink the toolbar.**
  - Compact mode exists but is internal: `isCompact = split && selectedEntityId` (CVB:971).
  - The list view always draws a large `<h4>` title, even with `title={false}` (CVB:1395-1417).
- **No click callback on the panel.** Only a custom view's `Builder` gets `onEntityClick` (CVB:1295).
  - So `sdk.tsx:208-217` swaps the side-panel controller and calls `data.get` (`get_document`) for a row that was already loaded.
  - The tool driver's page reads never fill its row cache (`tool_driver.ts:194-201`), so that read always goes out.
- **`entityActions` draw only in the table, and in the list with `showActionsInListView`.** Cards and kanban draw none.
- **It cannot size to its content.**
  - The table is a react-window list sized to its measured box (`VirtualTable.tsx:238-243`).
  - The SDK forces `height = 420` (`sdk.tsx:204`); `screen.tsx` forces 460.
- **It writes to the host URL, and the caller's mode loses.**
  - `__view` is written even without `updateUrl` (CVB:470-506).
  - A `viewMode` the caller passes loses to one the user once picked (CVB:452-458).

### Form

The chain is `EntityFormPanel` → `EntityFormBinding` → `EntityForm` → `PropertyFieldBinding`.

- **The per-field rules are a private closure.**
  - `EntityForm.renderField` (`EntityForm.tsx:702-809`) holds the hidden and access checks, the disabled rules, label placement, autofocus, the underlying-change flag and the memoised field context.
  - The CMS `FormContext` is a prop, not a React context, so nothing outside the generated layout can place a field.
- **No field subset.**
  - Validation always covers every property (`validation.ts:90-110`).
  - So a form showing three fields would block on a hidden required fourth, with nothing highlighted. `ErrorFocus` only searches inside the generated fields' div (`ErrorFocus.tsx:22-37`).
  - The precedent for a narrower rule: the table's cell popup validates only the edited field (`resolve_cell_property.ts:67-103`).
- **`EntityFormPanel` ignores overrides for a registered collection** (`EntityFormPanel.tsx:126-130`). `CollectionPanel` honours them.
- **Two forms on one page clash on DOM ids** (`form_field_<key>`, `form_<path>`).

### Values in your own JSX

- `PropertyPreview` already renders an ISO date string, a bare relation id (it fetches the title) and an enum key as its chip (`PropertyPreview.tsx:206-294`).
- What a flat row gets wrong is the **key**: a belongsTo arrives under its foreign-key column (`author_id`), not under the property name.
- The helpers that fix that are already public in `@rebasepro/common`: `fieldKeyForColumn` (`util/relations.ts:254`) and `normalizeToEntityRelation` (`util/entities.ts:329`).

### Layout

- The CMS chooses layouts from the **window**: `useLargeLayout` is `matchMedia("(min-width: 1024px)")`.
- In a 700px frame the whole admin is in its phone layout: side panels at `100vw`, the split view stacked.
- The same assumption is in Tailwind classes. For example, `CollectionCardViewBinding` has 24 `sm:`/`md:`/`lg:` classes, and the list uses `md:px-4 lg:px-6`.
- No kit part measures its container. `useElementWidth` exists, but only in plugin-insights.
- Container queries are already in use in the form (`@container/form`).

### Data

- Aggregates exist through REST and the HTTP client (`client.data.x.aggregate`).
- They don't exist through the browser's driver or the tool driver: neither has `restFetchService`, so `useData().x.aggregate` is undefined there (`common/src/data/buildRebaseData.ts:561`).
- MCP has `count_documents` only.
- All the admin's public data hooks return `Entity`. The only flat-row hooks are the SDK's private ones.
- `wrapAsSdkData(useData())` is **not** flat in the admin: it carries Dates and `EntityRelation`s, because `useData()` converts rows to view-model values.
- **`buildSdkData(driver)` is the one that keeps the wire types** (`buildRebaseData.ts:785-803`, `:1527`).

### Duplication

- The headless `CollectionView` set (D3).
- Three hand-synced lists of app modules (audit A5).
- `FieldProps`/`FormContext` declared twice, differently (audit B1).
- The SDK's `CollectionView` and `RecordForm` shadowing real names.
- Four ways to draw a KPI.

---

## 3. The end state

Each layer is built only from the layers below it. The admin's own pages are compositions of the same parts.

```
pages    the admin's collection page, record pages, routes  — compositions, nothing private
blocks   CollectionPanel   EntityFormPanel   EntityViewPanel   CollectionToolbar   SplitView (ui)
atoms    FieldValue   FormField   PropertyPreview   PropertyFieldBinding
data     useRows  useRow  useRowCount  useAggregate  useRowWrites   — over the flat SDK layer
```

### Data: flat hooks in `@rebasepro/app`

The hooks:
- `useRows(collection, { where, orderBy, limit, searchString })` → `{ rows, total, hasMore, loadMore, loading, error, refresh }`
- `useRow(collection, id)`
- `useRowCount(collection, where)`
- `useAggregate(collection, { select, groupBy, where })`
- `useRowWrites()` → `{ create, update, remove, saving, error }`

They run over a `RebaseSdkData` (the interface `client.data` and the backend's `context.data` already implement), taken from one place:
- `useRebaseClient().data` when the app has a client. Aggregates then work through HTTP.
- Otherwise `buildSdkData(driver)` of the default data source. That keeps wire types, and has aggregates where the driver does.
- In the MCP view, `buildSdkData(toolDriver)`. The tool driver gains the driver's optional aggregate slot, backed by a new MCP tool (Phase 7, after D6).

Rows are the server's rows everywhere: one shape, three transports. `context.data` in admin callbacks does not change.

Customizations that use these hooks instead of `useRebaseClient()` work inside Claude. That is the reason the example's insight slots show "No Rebase client" today.

### Atoms

**`<FieldValue row={row} field="status" collection="orders"/>`**, in cms:
- Draws one value the way the admin does: enum chip, the date in its timezone, the relation's title, the property's own `Preview`.
- It takes the row because a belongsTo lives under its foreign-key column. It finds that column with `fieldKeyForColumn`, normalizes with `normalizeToEntityRelation`, and renders `PropertyPreview`.
- No new export from `common`.

**`<FormField name="status"/>`**, in cms:
- `EntityForm.renderField` moves into a `FormFieldsContext` that `EntityForm` provides: the memoised field context plus the per-field rules as one function.
- `FormField` reads it.
- `FormSections` and `FormRail` render through `FormField`, so a field has one path, not two.

### Blocks

**`CollectionPanel`**, two new props:
- `fields?: string[]` (D4).
- `toolbar?: ReactNode`: defaults to the full toolbar; `null` hides it. A smaller toolbar is composed from named, exported pieces (the search box, the filters, the view toggle, the add button), the same way `CollectionTableToolbar` is exported today.
  - The `"Collection.Actions"` override and the `collection.toolbar` / `collection.actions` / `collection.actions.start` slots keep working inside the default toolbar.

Prop changes:
- `onEntityClick?(entity)`: the established name from `CollectionViewProps` (`cms-types/src/types/collection_views.tsx:99`). Without it, the record opens as today.
- `highlightedEntityId`: the audit's rename of the unreleased `selectedId`, landing in Phase 0.
- Filters stay `collectionOverrides.fixedFilter` / `defaultFilter`; sort stays `sort`. No second names.

Fixes, with no new props:
- `entityActions` draw on cards and kanban cards too. That is how an app puts "Approve" on every row, with no second action mechanism.
- The panel sizes to its content up to the height it is given, then scrolls inside.
- `__view` is written only with `updateUrl`.
- A caller's `viewMode` beats saved state when the panel mounts. The person can still switch.
- `title={false}` removes the list's title.
- Saved view state works as today, including on record-page subcollection tabs.

**`EntityFormPanel`**:
- `fields?: string[]`: only these, in this order.
  - Validates only what it shows, using the cell-popup rule.
  - On create, it refuses at mount, naming the field, if a required field with no default is left out.
- `children` made of `<FormField>`s replace the generated fields, laid out by you. This is the memoised successor to `Builder`, and `Builder` keeps working.
- `collectionOverrides`, for parity with `CollectionPanel`.
- DOM ids scoped per form instance. Tests that select by id change with it (§5).
- Density does not change: `ui-components.md` fixes record fields at `size="large"`. In a narrow frame the rail already folds away below 1000px (`useRailVisible.tsx:12`).

**`EntityViewPanel`**, new in cms: the read-only twin of `EntityFormPanel`.
- It fetches by id and draws through the existing `EntityViewBinding` grid, with `fields?`.
- It applies dynamic `conditions` and field access through the same rules `FormFieldsContext` holds.
- `DetailViewBinding` becomes this panel plus its page chrome.

**`SplitView`**, new in ui:
- Props: `master`, `detail`, `onBack`, `backLabel`, `detailTitle`. Labels are props, because the kit has no i18n.
- Side by side when its own container is wide; drill-down with a back bar when it is narrow.
- Built on `ResizablePanels`' `stacked` mode, measured with `useElementWidth`, which moves into the kit.
- `SplitListView` becomes a `SplitView` plus its router wiring.

### Pages

**Collection page.** `CollectionViewBinding` is cut along the lines it already has: data controller, toolbar, view switch, dialogs, split, count. Then:
- The kanban board keeps its own data controller (`useBoardDataController`, per-column windows). `fields` and sizing reach it too.
- Every plugin slot survives the cut, and a test lists them:
  - `collection.toolbar`, `collection.actions`, `collection.actions.start`
  - `collection.widgets`, `collection.add-column`, `collection.empty-state`, `collection.error`
  - `entity.row.actions`
- The `"Collection.View"`, `"Collection.Table"` and `"Collection.Card"` overrides receive the documented props, and the override docs say an override must honour `fields`, `collectionOverrides`, `highlightedEntityId` and `onEntityClick`.

**Record pages.** `EditViewBinding` renders `EntityFormPanel`, and `DetailViewBinding` renders `EntityViewPanel`. Tabs, the identity bar and the inspector stay as page chrome.

**Window vs container.**
- The shell (drawer, app bar) keeps `useLargeLayout`.
- Inside a page, layout follows the container:
  - the JS switches read container width;
  - the matching Tailwind classes become `@container` variants, so the JS and the CSS agree;
  - this covers the side panel width, split stacking, toolbar compaction, the card grid and the table's frozen column.

### Inside Claude

- The view already runs the project's own admin app, with its custom views, fields and actions.
- Claude's apps import the same parts under the real package names (D5).
- `screen.tsx` shrinks to a composition: `CollectionPanel`, `EntityFormPanel` or the app, inside a frame that measures itself.
- Page reads fill the tool driver's row cache, so opening a loaded row costs nothing.
- `show_collection`'s page, already in the tool result for the model, also seeds the view's first read. It only applies when the arguments match.
- The view's address carries a content hash (D7).
- `SHOW_APP_CODE_GUIDE` (renamed by the audit) is checked by a test against the modules the view serves. The audit found it teaching props that do not exist.

---

## 4. Order of work

Each phase lands on its own, green, and leaves the admin working.

**Phase 0 — before anything.**
- Capture the baseline: `pnpm harness:eval` (the six `customize-*` tasks), plus MCP harness screenshots at 700px and full screen.
- Merge the audit branch: `highlightedEntityId`, `collectionOverrides`, the trimmed `./mcp-view`, the embed host made internal, the renamed MCP exports.
- Land D6 (the aggregate leak) and D7 (the versioned address).
- Record the four layers and D1/D2/D4 in `rebase-architecture.md`. Where a rule can be a test, write the test, e.g. "every `SHOW_APP_CODE_GUIDE` name is a served export".

**Phase 1 — the layout primitives.**
- Move `useElementWidth` into `@rebasepro/ui`; plugin-insights re-exports it.
- Add `SplitView`, with UIReference sections at narrow and wide widths.
- Make the side panel width follow its container.
- `CollectionViewBinding` is not touched in this phase.

**Phase 2 — flat data hooks.**
- Add `useRows` / `useRow` / `useRowCount` / `useAggregate` / `useRowWrites` over `client.data` or `buildSdkData(driver)`.
- Tests over the HTTP client, a driver, and the tool driver.
- The SDK's hooks become these. Their row shape is the same, so `SHOW_APP_CODE_GUIDE` stays true.

**Phase 3 — the collection block.**
- Cut `CollectionViewBinding`, keeping the render-loop guards its comments document (CVB:331-353, 1058-1071, 1132-1139).
- Add `fields`, `toolbar` and the exported toolbar pieces, plus `onEntityClick` on the panel.
- Draw `entityActions` on cards and kanban.
- Size to content.
- Fix `__view`, viewMode priority and the list title.
- Move the container-width switches and `@container` classes in the collection views here, so the file is opened once.
- Delete the SDK's side-panel swap. Page reads fill the row cache.
- Old saved user config must still load.

**Phase 4 — the form block.**
- Add `FormFieldsContext` and `FormField`; `FormSections` and `FormRail` render through it.
- Add `fields` with the narrower validation and the create-time refusal.
- Scope DOM ids per form instance; add `collectionOverrides`.
- The `EntityForm` tests stay green. The ones that select `#form_field_*` are updated, and §5 lists them.

**Phase 5 — values and the read-only panel** (needs Phase 4's `FormFieldsContext`).
- Add `FieldValue` and `EntityViewPanel`.
- `DetailViewBinding` and the list/card slot rendering use them.

**Phase 6 — delete the copies.**
- Deprecate the headless `CollectionView` set and its four adapters.
- Remove the stale `tooling/design-sync/previews`.
- Leave one `FieldProps`/`FormContext` and one list of app modules.

**Phase 7 — Claude.**
- D5 module names, and `screen.tsx` on the parts.
- Seed the first page.
- Rewrite and test the guide.
- Add an `aggregate_documents` tool: move the REST route's checks into `RestApiGenerator.aggregate` and reuse them.
- The tool driver's aggregate slot.
- The saas connector relays the new tool and the renamed exports.
- Check it in real Claude.

**Phase 8 — teach it, then measure.**
- Rewrite the recipes on the parts, and add two: an approval queue (`entityActions` on cards) and master-detail (`SplitView`).
- Update:
  - the README guard;
  - the `rebase-customize-admin` and `rebase-admin` skills;
  - `frontend/index.md` and `customizing.md` in six locales;
  - `ai/remote-mcp.md`, the CMS README and the CHANGELOG.
- Run `pnpm harness:eval` again against the Phase 0 baseline. If the `customize-*` tasks are not faster, with shorter code, the design is wrong somewhere, and that is the finding.

---

## 5. What must not break

**Shipped public names.**
- Each keeps working:
  - `CollectionPanel`, `EntityFormPanel`, `PropertyPreview`, `PropertyFieldBinding`;
  - the `Collection.View` / `Collection.Table` / `Collection.Card` / `Entity.Form` overrides and their props;
  - `formView.Builder`, `onEntityClick`, `highlightedEntities`, `entityActions`, `propertiesOrder`, `listProperties`, `updateUrl`.
- No public prop changes meaning.
- A rename gets a delegating alias that warns once, a test, and a `### Deprecated` entry (`coding-standards.md` §12).
- Everything added on 11-07 is unreleased and can change freely.

**Saved user state.** View mode, column order and widths, and the kanban column, including on record-page subcollection tabs (`EditViewBinding.tsx:710`, `DetailViewBinding.tsx:412`). Old entries must still load.

**Path-keyed tooling.**
- `check-bundle-budget.mjs:199,331`
- `hooks-baseline.json`, `unused-locals-baseline.json`, `untranslated-baseline.json`
- `casts.test.mjs`, `icon-button-names.test.mjs`
- `shell-static-graph.test.ts:42-49`: `CollectionViewBinding` and `EntityForm` must stay lazy.

**Tests that select by form DOM id.** These change in Phase 4:
- `tests/e2e/tests/entity-dialog.spec.ts`
- `tests/e2e/tests/form-control-height.spec.ts`
- `packages/cms/test/form/label_placement.test.tsx`

**Guards.**
- `recipes_are_public_api.test.ts`
- `override_parts_are_copyable.test.ts`
- the six `customize-*` harness tasks

**Drivers other than Postgres.** The firebase drivers (`packages/firebase`) must work with the flat hooks, through `buildSdkData`. Aggregates may answer "not supported", clearly. Mongo is out of scope.

**i18n.** Every new string goes into all seven locale files (`check:locale-parity`, `check:untranslated`).

**Security.**
- The server narrows the view's collections to what the caller may see and write. That stays the server's job.
- `narrowCollections` stays the only place the project's configs meet those grants.
- No aggregate reaches MCP before D6.

**The gate for every phase:**
- `./tooling/scripts/verify-quality.sh`
- `pnpm typecheck`
- `pnpm verify:docs:strict`
- `pnpm check:api-surface`
- the MCP harness at 700px and full screen

---

## 6. Size

| Phase | Rough size | Risk |
|---|---|---|
| 0 | 1 day | low; D6 needs your choice |
| 1 | 1 day | low |
| 2 | 1–2 days | medium: three transports, one row shape |
| 3 | 4–5 days | **high**: the 1,789-line binding, its render-loop traps, the kanban path, every slot |
| 4 | 2–3 days | **high**: the form's field path; about 90 form tests are the net |
| 5 | 1–2 days | low |
| 6 | 1 day | low |
| 7 | 2 days | medium: two repos, real Claude |
| 8 | 2 days | low |

About three and a half weeks of focused work.

Phases 3 and 4 are where it can go wrong. The existing tests are what make them safe to attempt: 25 + 22 collection-view files and 17 + 7 form files.
