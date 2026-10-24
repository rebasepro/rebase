---
name: rebase-customize-admin
description: How to customize the Rebase admin panel by writing React components — singletons and settings pages, per-user settings, dashboards, custom pages, bulk actions, toolbar buttons, record buttons and tabs, new collection view modes (calendar, map, gallery), custom fields, replacing the login screen or any built-in part. Use this skill whenever a user asks for something the admin does not do out of the box, before reaching for configuration options.
---

# Customizing the Rebase admin

The admin is built from parts you can use yourself. **Customizing it means
writing an ordinary React component and putting it in a place.** Do not look
for a configuration flag for the feature (there is no `singleton: true`, no
`calendar` view type, no `bulkEdit` option) — build it.

There are three things to know:

1. **Building blocks** you render: `CollectionPanel`, `EntityFormPanel`,
   `CollectionsProvider`, `RebaseAuthGate` (`@rebasepro/cms`), `LoginView`
   (`@rebasepro/app`) and the UI kit (`@rebasepro/ui`: `Button`, `Card`,
   `Typography`, `TextField`, `Select`, `Chip`, `Container`, …).
2. **Hooks**: `useData`, `useCollection`, `useFetch`, `useAuthController`,
   `useSnackbarController` (`@rebasepro/app`); `useSidePanel`,
   `useUrlController`, `useCollectionRegistryController`, `resolveSelection`
   (`@rebasepro/cms`).
3. **Places**: a page (`<RebaseCMS views>`), a collection view mode
   (`collectionViews` + `admin.customViews`), a toolbar button
   (`admin.Actions`), a record button (`admin.entityActions`), a record tab
   (`admin.entityViews`), a field (`admin.Field` / `admin.Preview`), something
   beside a built-in part (`<Rebase slots>`), or a replacement for a built-in
   part (`<Rebase components>`, `wrap: true` to keep the original inside).

## Start from a recipe

Tested recipes ship inside the installed package. **Read the matching one
before writing anything** — it uses the APIs of the version the project has:

```
node_modules/@rebasepro/cms/recipes/README.md         ← the full reference
node_modules/@rebasepro/cms/recipes/site-settings.tsx  ← singleton / settings page
node_modules/@rebasepro/cms/recipes/my-preferences.tsx ← per-user settings (record keyed by uid)
node_modules/@rebasepro/cms/recipes/bulk-set-status.tsx ← toolbar action over selected rows
node_modules/@rebasepro/cms/recipes/calendar-view.tsx  ← a new collection view mode
node_modules/@rebasepro/cms/recipes/orders-dashboard.tsx ← a data page with a chart
node_modules/@rebasepro/cms/recipes/custom-login.tsx   ← replacing a built-in screen
```

Copy the closest recipe into the project's frontend, rename, adapt. Recipes
import only package entry points, so they compile as copied.

## Rules

- **A singleton is a normal collection + a page with `EntityFormPanel` at a
  fixed `entityId`.** The form creates the record under that id on first save;
  nothing needs seeding. Hide the collection from navigation with
  `admin.hideFromNavigation: true`.
- **Read and write through `useData()`.** Writes go through the server, so
  collection callbacks and security rules apply. Don't call `fetch` on the REST
  API from admin code.
- **Draw with `@rebasepro/ui`** so the page matches the admin (see the
  `rebase-design-language` skill). A chart library is fine if the project has
  one; plain divs are fine if it does not.
- **When a built-in part almost fits, override or wrap it** with
  `<Rebase components={{ "<Name>": { Component, wrap? } }}>`. The names are
  `OverridableComponentName` in `@rebasepro/cms-types`. Prefer `wrap: true`:
  you keep the original inside yours and still get its fixes on upgrade. When
  wrapping is not enough, copy the original and change the copy — see
  "Copying a built-in part" below. The props your component receives are the
  original's.
- **Server-side behaviour (validation that must hold, derived fields, side
  effects) belongs in collection `callbacks`**, not only in a component — see
  the `rebase-collections` skill.

## Copying a built-in part

The npm packages ship `dist`, not source. The source of a part, at the version
the project has, is in https://github.com/rebasepro/rebase at tag
`v<installed version>` (read the version from `node_modules/@rebasepro/cms/package.json`).
The table and the copyability below are 0.26+; at an older tag most parts
import internals, and a file may sit elsewhere — find it by its
`useComponentOverride("<Name>", Default)` call.


| Override name | Default component | Source file |
|---|---|---|
| `Auth.LoginView` | `LoginView` | `packages/app/src/components/LoginView/LoginView.tsx` |
| `Collection.Actions` | `CollectionViewActions` | `packages/cms/src/components/CollectionViewBinding/CollectionViewActions.tsx` |
| `Collection.Card` | `EntityCardBinding` | `packages/cms/src/components/CollectionViewBinding/EntityCardBinding.tsx` |
| `Collection.EmptyState` | `DefaultCollectionEmptyState` | `packages/cms/src/components/CollectionViewBinding/DefaultCollectionEmptyState.tsx` |
| `Collection.FilterField` | `DefaultFilterField` | `packages/cms/src/components/SelectableTable/filters/FilterFieldBinding.tsx` |
| `Collection.Table` | `CollectionTableBinding` | `packages/cms/src/components/CollectionTableBinding/CollectionTableBinding.tsx` |
| `Collection.View` | `CollectionViewBinding` | `packages/cms/src/components/CollectionViewBinding/CollectionViewBinding.tsx` |
| `DetailView` | `DetailViewBinding` | `packages/cms/src/components/DetailViewBinding.tsx` |
| `EditView.FormActions` | `EditFormActions` | `packages/cms/src/components/EditFormActions.tsx` |
| `Entity.Form` | `EntityFormBinding` | `packages/cms/src/form/EntityFormBinding.tsx` |
| `Entity.MissingReference` | `DefaultMissingReference` | `packages/cms/src/components/DefaultMissingReference.tsx` |
| `Entity.SidePanel` | `SidePanelBinding` | `packages/cms/src/components/SidePanelBinding.tsx` |
| `EntityPreview` | `EntityPreviewBinding` | `packages/cms/src/components/EntityPreviewBinding.tsx` |
| `HomePage` | `ContentHomePage` | `packages/cms/src/components/HomePage/ContentHomePage.tsx` |
| `HomePage.CollectionCard` | `NavigationCardBinding` | `packages/cms/src/components/HomePage/NavigationCardBinding.tsx` |
| `Shell.AppBar` | `DefaultAppBar` | `packages/cms/src/components/DefaultAppBar.tsx` |
| `Shell.Drawer` | `Drawer` | `packages/cms/src/components/app/Drawer.tsx` |
| `Shell.DrawerNavigationGroup` | `DrawerNavigationGroup` | `packages/cms/src/components/DrawerNavigationGroup.tsx` |
| `Shell.DrawerNavigationItem` | `DrawerNavigationItem` | `packages/cms/src/components/DrawerNavigationItem.tsx` |

`Shell.Drawer`'s default is a thin wrapper: the drawer itself is
`DefaultDrawer`, in `packages/cms/src/components/DefaultDrawer.tsx`, and copies
the same way.

To copy one: put the file in the project's frontend, rewrite each relative
import (`../hooks/…`, `./drawer_expansion`, …) to `@rebasepro/cms` or
`@rebasepro/app` — everything the file imports is exported from one of them —
change what you came to change, and register the copy under its name in
`<Rebase components>` (or a collection's `admin.components` for the
collection-scoped names: `Collection.*`, `Entity.*`, `EditView.FormActions`,
`DetailView` and `EntityPreview`). Keep the copy small: change the part, not its neighbours.

Three parts are deliberately **not** copyable, because what they import are
internals of a composition, not building blocks. Do not try to export or
reimplement those internals; customize around them:

- **`Collection.View`** — every view mode with inline editing, the popup field
  editor, the delete dialog and the view mode's URL state. Replace one of its
  parts instead (`Collection.Table`, `Collection.Card`, `Collection.Actions`,
  `Collection.EmptyState`, all copyable), add a view mode with
  `collectionViews`, or `wrap: true`.
- **`DetailView`** — the record view: identity bar, tabs, inspector, split-list
  buttons, around tab ids that are URL values. Use `admin.entityViews`,
  `admin.entityActions`, the `form.*` slots, or the copyable `Entity.Form` and
  `EditView.FormActions`.
- **`HomePage`** — copyable except its drag-and-drop reordering. A home page of
  your own composes `NavigationGroup`, `NavigationCardBinding` and
  `FavouritesView` (`@rebasepro/cms`) over
  `useNavigationStateController().topLevelNavigation`; to add to the stock one,
  use the `home.cards` slot.

