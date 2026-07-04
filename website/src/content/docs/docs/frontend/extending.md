---
title: Extending Rebase
sidebar_label: Extending Rebase
description: A decision guide for choosing the right extension mechanism — plugins, slots, component overrides, snapshot views, actions, and more.
---

## Overview

Rebase offers roughly a dozen extension mechanisms — plugins, slots, component overrides, snapshot views, actions, custom fields, and more. Each one targets a different scope (app-wide, per-collection, per-snapshot, per-property) and a different part of the UI.

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
| Add a button to the collection toolbar | collection `Actions` | collection | [Snapshot Actions](/docs/frontend/snapshot-actions#collection-actions) |
| Inject UI at a collection toolbar slot | `collection.actions` slot | app/plugin | [Slots](/docs/frontend/slots) |
| Add a computed column to a table | `additionalFields` | collection | [Additional Columns](/docs/frontend/additional-columns) |
| Add a custom field widget for a property type | `propertyConfigs` | property type | [Custom Fields](/docs/frontend/custom-fields) |
| Add a snapshot tab | `snapshotViews` | snapshot | [Snapshot Views](/docs/frontend/snapshot-views) |
| Add a row/context action or snapshot button | `snapshotActions` | snapshot | [Snapshot Actions](/docs/frontend/snapshot-actions) |
| Inject UI at a specific chrome location | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Ship several extensions as one installable unit | `plugins` | app | [Plugins](/docs/plugins) |

## Mechanisms in Detail

### Plugins

**Scope:** app.

A plugin bundles collections, views, component overrides, slot contributions, auth, data sources, providers, hooks, and lifecycle callbacks into a single installable unit. All other mechanisms listed here can be contributed through a plugin's interface.

→ [Plugins reference](/docs/plugins)

### Slots

**Scope:** app (contributed per-slot).

Slots are named UI extension points scattered throughout the CMS chrome. You register a React component targeting a slot name, and it renders at that location. There are 29 slots covering the home page, navigation, collection views, forms, snapshot rows, dashboards, and more.

→ [Slots reference](/docs/frontend/slots)

### Component Overrides (Swizzling)

**Scope:** app-level defaults or per-collection.

Two modes: **Eject** (full replacement) or **Wrap** (augment the original).

18 overridable component names in two tiers:

**App-only (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Collection-scoped (11):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Snapshot.Form`
- `Snapshot.FormActions`
- `Snapshot.DetailView`
- `Snapshot.SidePanel`
- `Snapshot.Preview`
- `Snapshot.MissingReference`

**Precedence:** Collection-level `components` override app-level defaults for the same component name (simple object spread — collection values overwrite global values). App-only component names (`Shell.*`, `HomePage`, `Auth.*`) can only be overridden at the `<Rebase>` level.

→ [Component Overrides](/docs/frontend/component-overrides)

### Snapshot Views

**Scope:** snapshot (adds tabs).

Custom views that appear as tabs in the snapshot detail page. Can be defined globally on `<Rebase>` or per-collection.

→ [Snapshot Views](/docs/frontend/snapshot-views)

### Snapshot Actions

**Scope:** snapshot.

Custom action buttons on individual snapshots (publish, archive, clone, etc.). Can be defined globally or per-collection.

→ [Snapshot Actions](/docs/frontend/snapshot-actions)

### Collection `Actions`

**Scope:** collection.

Toolbar-level React components that receive `CollectionActionsProps` (selected snapshots, table controller, collection context). Rendered in the collection toolbar alongside built-in actions.

**Relationship with `collection.actions` slot:** Both are additive — `Actions` components render first in the toolbar, then slot contributions from `collection.actions`. They do not replace each other.

→ [Snapshot Actions — Collection Actions](/docs/frontend/snapshot-actions#collection-actions)

### `formView` {#formview}

**Scope:** collection.

Replaces the entire default snapshot form with a custom component. Set on a collection definition:

```typescript
const collection = {
    slug: "products",
    formView: {
        Builder: MyCustomProductForm,
        includeActions: true  // show save/delete bar (default: true)
    }
};
```

Use when you need a completely custom layout for one collection's snapshot editing experience. For smaller tweaks, prefer `collection.components` with `Snapshot.Form` override instead.

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
- **Collection-level `snapshotActions` and `snapshotViews` extend (not replace) global ones.**
- **Plugin contributions are merged in `key` order.**
