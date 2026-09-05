---
title: Extending Rebase
sidebar_label: Extending Rebase
description: A decision guide for choosing the right extension mechanism — plugins, slots, component overrides, entity views, actions, and more.
---

## Overview

Rebase offers roughly a dozen extension mechanisms — plugins, slots, component overrides, entity views, actions, custom fields, and more. Each one targets a different scope (app-wide, per-collection, per-entity, per-property) and a different part of the UI.

This guide helps you pick the right mechanism for your use case, then links to the detailed reference for each.

## Decision Table

| I want to… | Mechanism | Scope | Reference |
|---|---|---|---|
| Replace the app bar | `components` (`Shell.AppBar`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Replace the login page | `components` (`Auth.LoginView`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Replace the home page | `components` (`HomePage`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Change how one collection's form looks entirely | `formView` | collection | [below](#formview) |
| Swap one component inside one collection | `collection.components` | collection | [Component Overrides](/docs/frontend/component-overrides) |
| Set default component overrides for all collections | `components` (collection-scoped names) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Add a button to the collection toolbar | collection `Actions` | collection | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| Inject UI at a collection toolbar slot | `collection.actions` slot | app/plugin | [Slots](/docs/frontend/slots) |
| Add a computed column to a table | `additionalFields` | collection | [Additional Columns](/docs/frontend/additional-columns) |
| Add a custom field widget for a property type | `propertyConfigs` | property type | [Custom Fields](/docs/frontend/custom-fields) |
| Add an entity tab | `entityViews` | entity | [Entity Views](/docs/frontend/entity-views) |
| Render one collection's rows a different way | `admin.customViews` | collection | [below](#customviews) |
| Add a row/context action or entity button | `entityActions` | entity | [Entity Actions](/docs/frontend/entity-actions) |
| Inject UI at a specific chrome location | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Ship several extensions as one installable unit | `plugins` | app | [Plugins](/docs/plugins) |
| Style the thing I just built | `@rebasepro/ui` + theme tokens | any | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Whatever you pick, build it from the kit]
Every mechanism below hands you a React component and says nothing about what to
fill it with. Use `@rebasepro/ui` components and the theme's colour tokens rather
than hand-written CSS — a custom view is still an admin view, and a hardcoded
colour is invisible in one of the two themes. See
[Styling Custom UI](/docs/frontend/styling).
:::

## Mechanisms in Detail

### Plugins

**Scope:** app.

A plugin bundles collections, views, component overrides, slot contributions, auth, data sources, providers, hooks, and lifecycle callbacks into a single installable unit. All other mechanisms listed here can be contributed through a plugin's interface.

→ [Plugins reference](/docs/plugins)

### Slots

**Scope:** app (contributed per-slot).

Slots are named UI extension points scattered throughout the CMS chrome. You register a React component targeting a slot name, and it renders at that location. There are 29 slots covering the home page, navigation, collection views, forms, entity rows, dashboards, and more.

→ [Slots reference](/docs/frontend/slots)

### Component Overrides (Swizzling)

**Scope:** app-level defaults or per-collection.

Two modes: **Eject** (full replacement) or **Wrap** (augment the original).

19 overridable component names in two tiers:

**App-only (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Collection-scoped (12):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Precedence:** Collection-level `components` override app-level defaults for the same component name (simple object spread — collection values overwrite global values). App-only component names (`Shell.*`, `HomePage`, `Auth.*`) can only be overridden at the `<Rebase>` level.

→ [Component Overrides](/docs/frontend/component-overrides)

### Entity Views

**Scope:** entity (adds tabs).

Custom views that appear as tabs in the entity detail page. Can be defined globally on `<Rebase>` or per-collection.

→ [Entity Views](/docs/frontend/entity-views)

### Entity Actions

**Scope:** entity.

Custom action buttons on individual entities (publish, archive, clone, etc.). Can be defined globally or per-collection.

→ [Entity Actions](/docs/frontend/entity-actions)

### Collection `Actions`

**Scope:** collection.

Toolbar-level React components that receive `CollectionActionsProps` (selected entities, table controller, collection context). Rendered in the collection toolbar alongside built-in actions.

**Relationship with `collection.actions` slot:** Both are additive — `Actions` components render first in the toolbar, then slot contributions from `collection.actions`. They do not replace each other.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Custom view modes {#customviews}

**Scope:** collection (adds a view mode).

A map, a calendar, a gallery, a timeline — another rendering of *the same rows*,
offered in the collection's view switcher beside List, Table, Cards and Board.

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

Or register the component once and name it by key, which is also what makes it
selectable from the collection editor:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` receives the live `tableController`, so the view inherits the
collection's filters, the search box, sorting, pagination, permission checks
and the entity side panel — that is the whole reason to declare one instead of
building an `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Choosing the view updates `?__view=`, survives a reload, and persists per user.
Declaring one is enough to offer it — `enabledViews` only needs setting when you
want to *take built-ins away*. With a single entry the switcher is hidden.

**This is not a way to build a view spanning several collections.** A view mode
is another rendering of one collection's query. If your component ignores
`tableController` and fetches four tables of its own, it wants to be an
[`AppView`](/docs/frontend#custom-views) — the toolbar above it, with its search
box and its record count, would be describing a query it does not render.

### `formView` {#formview}

**Scope:** collection.

Replaces the entire default entity form with a custom component. Set on a collection definition:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // show save/delete bar (default: true)
        }
    }
};

```

Use when you need a completely custom layout for one collection's entity editing experience. For smaller tweaks, prefer `collection.components` with `Entity.Form` override instead.

### `additionalFields`

**Scope:** collection.

Computed/virtual columns displayed in the collection table. These don't correspond to stored properties — they're calculated at render time.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** property type.

Custom field widgets for specific property types, providing custom form fields and preview components.

→ [Custom Fields](/docs/frontend/custom-fields)

## Precedence Summary

- **`collection.components` beats global `components`** inside that collection (simple spread merge in `DataCollectionView`).
- **Collection `Actions` and `collection.actions` slot are additive** — `Actions` render first, then slot contributions.
- **Collection-level `entityActions` and `entityViews` extend (not replace) global ones.**
- **Plugin contributions are merged in `key` order.**
