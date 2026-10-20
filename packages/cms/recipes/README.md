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
| [Bulk set status](bulk-set-status.tsx) | A toolbar button that updates every selected row. |
| [Calendar view](calendar-view.tsx) | A new view mode for a collection: rows on a month grid. |
| [Orders dashboard](orders-dashboard.tsx) | A page that reads data, draws a chart and links into the admin. |
| [Custom login screen](custom-login.tsx) | Replacing a built-in screen through `<Rebase components>`. |

## Building blocks

Components you render anywhere under `<Rebase>` and a router.

| Name | Package | What it is |
|---|---|---|
| `CollectionPanel` | `@rebasepro/cms` | A collection's table, cards, board or custom view, with its toolbar, filters and record panel. |
| `EntityFormPanel` | `@rebasepro/cms` | One record's form: loads it, validates, saves. Given an id no record has yet, it creates it there. |
| `CollectionsProvider` | `@rebasepro/cms` | Makes collections known to the blocks in a page of your own that has no admin shell around it. |
| `RebaseAuthGate` | `@rebasepro/cms` | Shows the login screen until someone is signed in, then its children. |
| `LoginView` | `@rebasepro/app` | The built-in login screen, to frame or reuse. |
| `Button` | `@rebasepro/ui` | And `Card`, `Typography`, `TextField`, `Select`, `Chip`, `Container`, … — the UI kit the admin is drawn with. Use it so your pages look like the rest. |

## Hooks

| Name | Package | What it gives you |
|---|---|---|
| `useData` | `@rebasepro/app` | The data layer: `useData().collection("orders").find / findById / create / update / delete`. Saves go through the server, so callbacks and security rules apply. |
| `useCollection` | `@rebasepro/app` | A live list of a collection's rows, re-rendering on change. |
| `useFetch` | `@rebasepro/app` | One record, live. |
| `useAuthController` | `@rebasepro/app` | The signed-in `user` (uid, roles), and sign-in / sign-out. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` for a toast. |
| `useSidePanel` | `@rebasepro/cms` | Open any record in the side panel: `open({ path, entityId })`. |
| `useUrlController` | `@rebasepro/cms` | Admin URLs and navigation: `buildUrlCollectionPath`, `navigate`. |
| `useCollectionRegistryController` | `@rebasepro/cms` | Look up a collection by slug. |
| `resolveSelection` | `@rebasepro/cms` | Turn a table selection — ticked rows or "all matching" — into the rows. |

## Places

| To add… | Put a component in | Recipe |
|---|---|---|
| A page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` | site settings, dashboard |
| A view mode for a collection | `collectionViews={[{ key, name, Builder }]}` + `admin.customViews: ["key"]` | calendar view |
| A button in a collection's toolbar | `admin.Actions: [Component]` | bulk set status |
| A button on a record | `admin.entityActions: [{ key, name, onClick }]` | |
| A tab on a record | `admin.entityViews: [{ key, name, Builder }]` | |
| How one field is edited or shown | `admin.Field` / `admin.Preview` on the property | |
| Something beside a built-in part | `<Rebase slots={[{ slot, Component }]}>` (`home.cards`, `form.after`, `collection.toolbar`, …) | |
| A replacement for a built-in part | `<Rebase components={{ "Auth.LoginView": { Component } }}>` — or `wrap: true` to keep the original inside yours | custom login |

## What each place hands your component

| Place | Your component receives |
|---|---|
| A page (`views`) | Nothing: read what you need with the hooks. It renders inside the admin's router, so `useUrlController().navigate(…)` (or `react-router`) works. |
| A view mode `Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (its `data` is the rows the toolbar's search and filters select, `dataLoading`, …), `onEntityClick(entity)` to open a row the way the collection opens rows, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Turn `selection` into rows with `resolveSelection({ selection, accessor: useData().collection(path) })` — it may stand for "every row matching the filter", not only the ticked ones. |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, the record (`entity`, absent while it is being created), its unsaved values (`modifiedValues`) and the form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Sign in with `authController.emailPasswordLogin?.(email, password)` (optional: present when email sign-in is enabled); a failure throws and is also on `authController.authProviderError`. Once `authController.user` is set the admin replaces your screen by itself. |
| Any other override | The props of the part it replaces; with `wrap: true`, those plus `OriginalComponent`. |

## Facts that save a trip to the source

- **Rows are `Entity` objects.** `useData().collection("orders").find()` resolves to
  `{ data: Entity[], meta }`; a row's fields are on `row.values`, its id is
  `row.id`. `find({ limit, offset, where: { status: ["==", "paid"] }, orderBy: ["createdAt", "desc"] })`.
- **Dates in `values` are `Date` objects** in the admin, not strings.
- **Defaults for a new record:** a property's `defaultValue` applies everywhere a
  record is created; `EntityFormPanel`'s `defaultValues` apply to that form only,
  on top of them.
- **Enum fields** are `enum: [{ id: "draft", label: "Draft" }, …]` on a string
  property — see `defineCollection` and the collections docs for every property
  option.
- **A record keyed by its user:** `entityId={useAuthController().user?.uid}`.

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
