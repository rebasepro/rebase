---
title: Customizing the Admin
sidebar_label: Customizing the Admin
description: How to customize the Rebase admin — building blocks, hooks and places, with tested recipes for singletons, per-user settings, bulk actions, calendar views, dashboards and custom login screens.
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

The admin is built from parts you can use yourself. To customize it you write
an ordinary React component and put it in a place. That is the whole model:

- **Building blocks** you render — a collection's table, one record's form, the UI kit.
- **Hooks** for data, the signed-in user, toasts and navigation.
- **Places** to put a component — a page, a view mode, a toolbar button, a record tab, a field, a slot beside a built-in part, or an override that replaces one.

If a building block does not do what you need, copy its source into your project
and change it — see [Copying a built-in part](#copying-a-built-in-part). Nothing
here needs a configuration option to exist first. The per-table places are
options of [`customizeTable`](/docs/frontend/customize-table/).

## Recipes

Working, tested examples ship inside `@rebasepro/cms`, so the ones in
`node_modules/@rebasepro/cms/recipes` always match your installed version. They
import only public packages: copy one into your project as-is.

| Recipe | What it shows |
|---|---|
| `site-settings.tsx` | A singleton: one settings record on its own page, created on first save. |
| `my-preferences.tsx` | Per-user settings: each user edits the record keyed by their uid. |
| `bulk-set-status.tsx` | A toolbar button that updates every selected row. |
| `calendar-view.tsx` | A new view mode: a collection's rows on a month grid. |
| `orders-dashboard.tsx` | A page that reads data, draws a chart and links into the admin. |
| `custom-login.tsx` | Replacing the login screen. |

The `README.md` beside them is the full reference of building blocks, hooks and places.

## Example: a singleton

<span class="since-badge" data-since="0.31">Since 0.31</span>

A singleton is not a special kind of table. It is an ordinary table whose page
always opens the same row. `RecordForm` given an id edits that record, and
creates it under that id the first time, so nothing needs seeding.

```ts
// backend/schema/site_settings.ts: `rebase db push` creates the table.
import { defineTable, col } from "@rebasepro/server/schema";

export const siteSettings = defineTable("site_settings", {
    columns: {
        id:              col.text().primaryKey(),
        siteName:        col.text().notNull(),
        maintenanceMode: col.boolean().notNull().default(false),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/site_settings.tsx
import React from "react";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import type { AppView } from "@rebasepro/cms-types";
import { Container, Typography } from "@rebasepro/ui";
import type { siteSettings } from "../../../backend/schema/site_settings";

// Reachable only through the page below, not from the drawer.
export const siteSettingsCms = customizeTable<typeof siteSettings>("site_settings", {
    name: "Site settings",
    hideFromNavigation: true,
    hideIdFromForm: true,
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={"site_settings"} id={"site"}/>
        </Container>
    )
};
```

The same shape with `id={user.uid}` (from `useAuthController()`) is a
per-user settings page.

To show some of
the fields, pass `fields={["siteName"]}`. To arrange them yourself, pass
`layout` with `<FormField name="…"/>`s in your own JSX. Either way the form
validates only what it shows — see
[Panels in a page of your own](/docs/frontend/panels).

## Places

<span class="since-badge" data-since="0.31">Since 0.31</span>

| To add… | Put a component in |
|---|---|
| A page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| A view mode for a table | `customViews` in its `customizeTable`, or `<RebaseCMS collectionViews>` and the key — see [Custom view modes](/docs/frontend/extending#custom-view-modes) |
| A button in a collection's toolbar | `Actions: [Component]` in `customizeTable` |
| A button on a record | `entityActions` in `customizeTable` — see [Entity Actions](/docs/frontend/entity-actions) |
| A tab on a record | `entityViews` in `customizeTable` — see [Entity Views](/docs/frontend/entity-views) |
| How one field is edited or shown | `Field` / `Preview` on the field in `customizeTable` — see [Custom Fields](/docs/frontend/custom-fields) |
| Something beside a built-in part | `<Rebase slots>` — see [Slots](/docs/frontend/slots) |
| A replacement for a built-in part | `<Rebase components>` — see [Component Overrides](/docs/frontend/component-overrides) |

## What each place hands your component

| Place | Your component receives |
|---|---|
| A page (`views`) | Nothing: read what you need with the hooks. It renders inside the admin's router, so `useUrlController().navigate(…)` (or `react-router`) works. |
| A view mode `Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (its `rows` are the rows the toolbar's search and filters select, as the server sends them; `loading`, `error`, …), `onRowClick(row)` to open a row the way the collection opens rows, `selectionController`, `highlightedIds` (ids as strings), `emptyComponent`. |
| `Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, and their `ids`), `openNewDocument(defaults?)`, `context`. Turn `selection` into rows and their ids with `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — it may stand for "every row matching the filter", not only the ticked ones. |
| `entityViews` `Builder` | `EntityCustomViewParams`: `collection`, the saved record (`row`) and its id (`id`), both absent while it is being created, its unsaved values (`modifiedValues`) and the form (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Sign in with `authController.emailPasswordLogin?.(email, password)` (optional: present when email sign-in is enabled); a failure throws and is also on `authController.authProviderError`. Once `authController.user` is set the admin replaces your screen by itself. |
| Any other override | The props of the part it replaces; with `wrap: true`, those plus `OriginalComponent`. |

## Hooks

| Hook | Package | Gives you |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | A live list of rows / one live row, as the server sends them. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, through the server, so table hooks and row-level security apply. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.orders.find / findById / create / update / delete`, for code outside React state; the same rows, and writes that run the same hooks. |
| `useAuthController` | `@rebasepro/app` | The signed-in `user` (uid, roles), sign-in and sign-out. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` for a toast. |
| `useSidePanel` | `@rebasepro/cms` | Open any record in the side panel. |
| `useUrlController` | `@rebasepro/cms` | Admin URLs and navigation. |
| `resolveSelection` | `@rebasepro/cms` | A table selection — ticked rows or "all matching" — as rows and their ids: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copying a built-in part

When a built-in part is close to what you want, copy its source from the
`@rebasepro/cms` (or `@rebasepro/app`) repository into your project, point its
relative imports at the packages, change it, and register it under its name in
`<Rebase components>`. Everything a part imports is a public export, so the copy
compiles — for every part except three, and the three are deliberate:

- **`Collection.View`** is the composition of every view mode — list, table,
  cards, board, split — with inline editing, the popup field editor, the delete
  dialog and the view mode's URL state. What it imports is those modes'
  internals. Replace one part of it instead (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, which all
  copy), add a [view mode](/docs/frontend/view-modes) of your own, or wrap it
  with `wrap: true`.
- **`DetailView`** is the record view's composition: identity bar, tabs,
  inspector and the split list's buttons, around tab ids that are URL values.
  Customize a record with [entity views](/docs/frontend/entity-views),
  [entity actions](/docs/frontend/entity-actions), the `form.*`
  [slots](/docs/frontend/slots), or the `Entity.Form` and
  `EditView.FormActions` overrides, which copy.
- **`HomePage`** copies but for its drag-and-drop reordering of cards and
  groups, which has no API of its own to export. A home page of your own
  composes `NavigationGroup`, `NavigationCardBinding` and `FavouritesView` over
  `useNavigationStateController().topLevelNavigation`; to add to the stock one,
  use the `home.cards` slot.
