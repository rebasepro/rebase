# Customizing the Rebase admin

The admin is built from parts you can use yourself. To customize it, you write
an ordinary React component and put it in a place. There is nothing else to
learn: **building blocks** you render, **hooks** for data and the rest of the
app, and **places** to put a component.

If a building block does not do what you need, copy its source into your project
and change it — every component here is plain React over the hooks below.

Each recipe in this folder is a working file with a test in the Rebase
repository (`packages/cms/test/recipes`). They import only the packages listed
here, so you can copy one into your project as-is. This folder ships inside
`@rebasepro/cms`, so the recipes in `node_modules/@rebasepro/cms/recipes`
always match the version you have installed.

## Recipes

| Recipe | What it shows |
|---|---|
| [Site settings singleton](site-settings.tsx) | One settings record on its own page, created on first save. A page + `EntityFormPanel` at a fixed id. |
| [Per-user preferences](my-preferences.tsx) | Each user edits their own record, keyed by their uid. |
| [Bulk set status](bulk-set-status.tsx) | A toolbar button that updates every selected row with `useRowWrites`. |
| [Approval queue](approval-queue.tsx) | The rows waiting for review, Approve and Reject on every row and card (`entityActions` through `collectionOverrides`), and a live count (`useRowCount`). |
| [Master-detail](master-detail.tsx) | `SplitView`: a `CollectionPanel` (`fields`, `onRowClick`, `highlightedIds`) beside the picked row's `EntityFormPanel` (`fields`); in a narrow container the form covers the list. |
| [Calendar view](calendar-view.tsx) | A new view mode for a collection: rows on a month grid. |
| [Orders dashboard](orders-dashboard.tsx) | A total (`useRowCount`) and a count per status (`useAggregate`), drawn with `KpiTile` and `BarChart`; each bar opens the collection filtered to it. |
| [Custom login screen](custom-login.tsx) | Replacing a built-in screen through `<Rebase components>`. |

## Which part for which job

| To… | Use |
|---|---|
| Show a collection: table, cards, board, its toolbar and record panel | `CollectionPanel`: `fields` for the columns, `collectionOverrides.fixedFilter` to narrow it, `toolbar` to change its toolbar |
| Do something with the row clicked, instead of opening it | `CollectionPanel` `onRowClick(row, id)` |
| Edit one record, or some of its fields | `EntityFormPanel` with `id`, and `fields` or `layout` of `FormField`s |
| Show one record read-only | `EntityViewPanel` |
| Show one value of a row in your own JSX | `FieldValue` |
| A list beside the picked record, folding to drill-down when narrow | `SplitView` (master-detail recipe) |
| A button on every row and card | `entityActions`: the collection's `admin.entityActions`, or one panel's `collectionOverrides.entityActions` |
| Read rows, one row, a count or an aggregate | `useRows`, `useRow`, `useRowCount`, `useAggregate` |
| Create, change or delete rows | `useRowWrites` |
| KPI figures and charts | `KpiGrid` + `KpiTile`, `ChartCard` + `BarChart` / `TimeSeriesChart`, fed by `useRowCount` / `useAggregate` |

## Building blocks

Components you render anywhere under `<Rebase>` and a router.

| Name | Package | What it is |
|---|---|---|
| `CollectionPanel` | `@rebasepro/cms` | A collection's table, cards, board or custom view, with its toolbar, filters and record panel. `fields` picks what it shows, `toolbar` replaces or removes its toolbar, `onRowClick` takes the clicked row, as `useRows` reads it, instead of opening it. It sizes to its rows. |
| `CollectionToolbar` | `@rebasepro/cms` | A collection panel's toolbar, for its `toolbar` prop: the full one, or `start` / `end` holding `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle` and `CollectionAddButton`. |
| `EntityFormPanel` | `@rebasepro/cms` | One record's form: loads it, validates, saves. Given an id no record has yet, it creates it there. `fields` shows some fields, in order; `layout` takes your own arrangement of `FormField`s; `collectionOverrides` changes the collection for this form only. It validates only the fields it shows. |
| `FormField` | `@rebasepro/cms` | One field of the record form it sits in, by property name: `<FormField name="status"/>`, inside `EntityFormPanel`'s `layout` or a `formView.Builder`. |
| `EntityViewPanel` | `@rebasepro/cms` | One record, read-only, drawn as the admin's record page draws it. Takes `fields` and `collectionOverrides` like `EntityFormPanel`, and leaves out what the form leaves out: a field a `conditions.hidden` rule hides for this record, or one the user may not read. |
| `FieldValue` | `@rebasepro/cms` | One value of a row as the server sends it (`useRows`, `client.data`), drawn as the admin draws it: `<FieldValue row={row} collection="orders" field="status"/>`. An enum is its chip, a date is in its timezone, a belongsTo is read from its foreign-key column and shown as its target's title. |
| `CollectionsProvider` | `@rebasepro/cms` | Makes collections known to the blocks in a page of your own that has no admin shell around it. |
| `SplitView` | `@rebasepro/ui` | Master beside detail when its own container is wide (768px+), the detail over the master under a back bar when narrow. `master`, `detail` (absent or `false`: the master alone), `onBack`, `detailTitle`. Fills its parent, so give the parent a height. |
| `KpiGrid` | `@rebasepro/ui` | Two to four `KpiTile`s across, as its own width allows. |
| `KpiTile` | `@rebasepro/ui` | One headline figure: `label`, `value`, `loading`, `error` (an `Error`), and `previous` for the change. |
| `ChartCard` | `@rebasepro/ui` | A chart's card: `title`, `icon`, `headline`, `action`. |
| `BarChart` | `@rebasepro/ui` | Categories by size: `bars` (`{ key, label, value }[]`), `onBarClick` makes each bar a button. `loading` / `error` / no bars draw in its place. |
| `TimeSeriesChart` | `@rebasepro/ui` | Values over time: `series` (`{ id, label, points: { at, value }[] }[]`), `at` a `Date` or an ISO string. |
| `RebaseAuthGate` | `@rebasepro/cms` | Shows the login screen until someone is signed in, then its children. |
| `LoginView` | `@rebasepro/app` | The built-in login screen, to frame or reuse. |
| `Button` | `@rebasepro/ui` | And `Card`, `Typography`, `TextField`, `Select`, `Chip`, `Container`, … — the UI kit the admin is drawn with. Use it so your pages look like the rest. |

## Hooks

| Name | Package | What it gives you |
|---|---|---|
| `useRows` | `@rebasepro/app` | `useRows("orders", { where, orderBy, limit, searchString })` → `{ rows, total, hasMore, loadMore, loading, error, refresh }`. Rows in the server's shape (see the facts below), kept current after every write. |
| `useRow` | `@rebasepro/app` | `useRow("orders", id)` → `{ row, loading, error, refresh }`. |
| `useRowCount` | `@rebasepro/app` | `useRowCount("orders", where)` → `{ count, loading, error }`, counted by the data source. |
| `useAggregate` | `@rebasepro/app` | `useAggregate("orders", { select: [{ fn: "count" }], groupBy: ["status"], orderBy: ["count", "desc"] })` → `{ result, loading, error }`: one row per group, each aggregate under its alias (`count`, `sum_total`). Computed by the data source; `error` says so where it cannot. |
| `useRowWrites` | `@rebasepro/app` | `{ create, update, remove, saving, error }`: `update("orders", id, { status: "shipped" })`. Each write is the record form's save: the collection's `browserCallbacks` run, then the server's callbacks and rules, and every view of the collection reads it again. |
| `useRebaseContext` | `@rebasepro/app` | The context: `context.data.collection("orders").find / findById / create / update / delete`, outside React state. Rows as the hooks return them; a write runs the collection's `browserCallbacks` and refreshes its views, as `useRowWrites` does. |
| `usePermissions` | `@rebasepro/app` | `canCreate(collection, path)`, `canEdit(collection, path, row)`, `canDelete(collection, path, row)`: what the signed-in user may do, by the collection's rules. |
| `useAuthController` | `@rebasepro/app` | The signed-in `user` (uid, roles), and sign-in / sign-out. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` for a toast. |
| `useSidePanel` | `@rebasepro/cms` | Open any record in the side panel: `open({ path, id })`. |
| `useUrlController` | `@rebasepro/cms` | Admin URLs and navigation: `buildUrlCollectionPath`, `navigate`. |
| `useCollectionRegistryController` | `@rebasepro/cms` | Look up a collection by slug: `getCollection("orders")`, once `initialised`. |
| `resolveSelection` | `@rebasepro/cms` | Turn a table selection — ticked rows or "all matching" — into the rows: `resolveSelection({ selection, data: context.data, collection })`. |
| `useElementWidth` | `@rebasepro/ui` | `[ref, width]`: an element's own width, to lay out by its container rather than the window. |

## Places

| To add… | Put a component in | Recipe |
|---|---|---|
| A page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` | site settings, dashboard, master-detail |
| A view mode for a collection | `collectionViews={[{ key, name, Builder }]}` + `admin.customViews: ["key"]` | calendar view |
| A button in a collection's toolbar | `admin.Actions: [Component]` | bulk set status |
| A button on a record, and on every row and card | `admin.entityActions: [{ key, name, icon, onClick, collapsed: false }]`, or for one panel `collectionOverrides.entityActions` | approval queue |
| A tab on a record | `admin.entityViews: [{ key, name, Builder }]` | |
| How one field is edited or shown | `admin.Field` / `admin.Preview` on the property | |
| Something beside a built-in part | `<Rebase slots={[{ slot, Component }]}>` (`home.cards`, `form.after`, `collection.toolbar`, …) | |
| A replacement for a built-in part | `<Rebase components={{ "Auth.LoginView": { Component } }}>` — or `wrap: true` to keep the original inside yours | custom login |

## What each place hands your component

| Place | Your component receives |
|---|---|
| A page (`views`) | Nothing: read what you need with the hooks. It renders inside the admin's router, so `useUrlController().navigate(…)` (or `react-router`) works. |
| A view mode `Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (its `rows` are the rows the toolbar's search and filters select; `loading`, `error`, …), `onRowClick(row)` to open a row the way the collection opens rows, `selectionController`, `highlightedIds`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `setSelectedRows(rows)`, `clearSelection()`), `tableController` (`rows`), `openNewDocument(defaults?)`. `context`, whose `data` reads rows. Turn `selection` into rows with `resolveSelection({ selection, data: context.data, collection })` — it may stand for "every row matching the filter", not only the ticked ones. |
| `entityActions` `onClick` | `EntityActionClickProps`: `row` (the record, as the server sends it), `id`, `path`, `collection`, `context`, `view` (`"collection"` or `"form"`). |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, the saved record (`row`, absent while it is being created), the form's values with unsaved edits (`modifiedValues`) and the form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Sign in with `authController.emailPasswordLogin?.(email, password)` (optional: present when email sign-in is enabled); a failure throws and is also on `authController.authProviderError`. Once `authController.user` is set the admin replaces your screen by itself. |
| Any other override | The props of the part it replaces; with `wrap: true`, those plus `OriginalComponent`. |

## Facts that save a trip to the source

- **Rows are the server's rows** wherever your code asks for them: `useRows`,
  `useRow`, `useRowWrites`' results, `context.data`, `resolveSelection`,
  `CollectionPanel`'s `onRowClick`, `client.data` — and what a collection's
  `browserCallbacks`, its `entityActions`, `admin.display` resolvers,
  `additionalFields`, entity views, a form's `context.row`, a view mode
  `Builder`'s `tableController.rows`, a collection action's selection and the
  slots are handed. A row is a flat object, exactly the table's columns (an
  `id` column as `row.id`, with its type), a date as an ISO string (`"2026-11-08"` for a `columnType:
  "date"` column, a full timestamp otherwise), and a belongsTo relation as its
  foreign-key column (`customerId`). A relation the admin loaded arrives nested
  under its name, as REST's `include` returns it (`row.customer` is the
  customer's row, exactly its columns, beside `customerId`). Draw a value with
  `<FieldValue row={row} collection="orders" field="customer"/>` rather than
  formatting it yourself.
- **`where` and `orderBy`** are the same everywhere: `{ status: ["==",
  "paid"], total: [">", 100] }` and `["createdAt", "desc"]`.
- **An `Entity` is the admin's own record**, handed only to a copy of one of
  its parts (`Collection.Table`, a card). It is `{ id, path, values }`: fields
  are on `entity.values`, and there dates are `Date` objects and a relation an
  `EntityRelation`. `getDatePropertyTimezone(property)` names the zone the
  admin shows any date property in.
- **Defaults for a new record:** a property's `defaultValue` applies everywhere a
  record is created; `EntityFormPanel`'s `defaultValues` apply to that form only,
  on top of them.
- **Enum fields** are `enum: [{ id: "draft", label: "Draft" }, …]` on a string
  property — see `defineCollection` and the collections docs for every property
  option.
- **A record keyed by its user:** `id={useAuthController().user?.uid}`.

The override names are `Shell.AppBar`, `Shell.Drawer`, `HomePage`,
`HomePage.CollectionCard`, `Auth.LoginView`, `Collection.View`,
`Collection.Table`, `Collection.Card`, `Collection.EmptyState`,
`Collection.Actions`, `Entity.Form`, `EditView.FormActions`, `Entity.SidePanel`
and a few more: the full list is `OverridableComponentName` in
`@rebasepro/cms-types`. A collection can override any `Collection.*` or
`Entity.*` part for itself alone with `admin.components`.

## Copying a built-in part

A copy of a built-in part compiles in your project once its relative imports
point at `@rebasepro/cms` and `@rebasepro/app`: everything it imports is a public
export. That holds for every part except three, and the three are deliberate.

- **`Collection.View`** is the composition of every view mode — list, table,
  cards, board, split — with inline editing, the popup field editor, the delete
  dialog and the view mode's URL state. What it imports is those modes'
  internals. Replace one part of it instead (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, which all
  copy), add a view mode of your own with `collectionViews`, or wrap it with
  `wrap: true`.
- **`DetailView`** is the record view's composition: identity bar, tabs,
  inspector and the split list's buttons, around tab ids that are URL values.
  Customize a record with `admin.entityViews`, `admin.entityActions`, the
  `form.*` slots, or the `Entity.Form` and `EditView.FormActions` overrides,
  which copy.
- **`HomePage`** copies but for its drag-and-drop reordering of cards and
  groups, which has no API of its own to export. A home page of your own
  composes `NavigationGroup`, `NavigationCardBinding` and `FavouritesView` over
  `useNavigationStateController().topLevelNavigation`; to add to the stock one,
  use the `home.cards` slot.

`pnpm report:override-copyability` in the Rebase repository lists what each
part imports that is not public, and a test there fails when a part that copies
stops copying.
