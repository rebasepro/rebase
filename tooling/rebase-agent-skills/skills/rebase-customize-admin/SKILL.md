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
  it does not fit at all, write your own component for that name — the props
  it receives are the original's. The original's source, at the version the
  project has, is `packages/cms/src` in https://github.com/rebasepro/rebase at
  tag `v<installed version>`; its relative imports must be rewritten to package
  imports when you copy it.
- **Server-side behaviour (validation that must hold, derived fields, side
  effects) belongs in collection `callbacks`**, not only in a component — see
  the `rebase-collections` skill.
