---
title: Component Overrides (Swizzling)
sidebar_label: Component Overrides
description: Override default UI components with custom implementations at the application or collection level.
---

## Overview

Rebase allows you to override default UI components with your own custom implementations. This implements a Docusaurus-style component swizzling model that supports two customization patterns:
- **Eject mode** (default): Your component fully replaces the built-in one.
- **Wrap mode** (`wrap: true`): Your component wraps the original. What it wraps (usually the built-in component) is passed as the `OriginalComponent` prop so you can render it inside your custom layout/logic.

Component overrides can be applied **globally** at the application level (on the `<Rebase>` provider) or **locally** at the collection level (inside individual collection definitions).

---

## Global Component Overrides

To override components globally across your entire application, pass a `components` object to the root `<Rebase>` provider.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Collection-Level Component Overrides

<span class="since-badge" data-since="0.31">Since 0.31</span>

To override components for one table only, pass `components` in its
`customizeTable`. This is useful for the empty state, the cards or the form of a
particular table. Each `Component` is the component itself, imported by value:
the file runs only in the browser.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../components/ProductCustomForm";
import { ProductsEmptyState } from "../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

A wrapping component receives what it wraps as `OriginalComponent`: the
built-in component, unless your app overrides it too (see
[When both scopes override a component](#when-both-scopes-override-a-component)):

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

A string path or a lazy `() => import(…)` thunk in `Component` throws when the
module loads, with what to write instead.

### When both scopes override a component

<span class="since-badge" data-since="0.31">Since 0.31</span>

The two scopes compose. The app-level override (`<Rebase components>`) is applied to the built-in component first, and the table's (`components` in `customizeTable`) is applied to the result:

| App level | Collection level | What renders inside that collection |
|---|---|---|
| any | none | what renders everywhere else: the app-level override, or the built-in component |
| none | wrap | the collection's wrapper around the built-in component |
| replace or wrap | wrap | the collection's wrapper around the app-level override, passed as `OriginalComponent` |
| any | replace | the collection's component alone; it replaces both |

So a collection can add something around a component your app already customises without losing that customisation. To drop the app-level version for one collection, replace instead of wrapping.

---

## Overridable Components Scopes

### App-Scoped Components (`AppComponentName`)

These components can only be overridden at the root `<Rebase>` provider level since they represent shell-level structure.

| Component Key | Description |
|---|---|
| `"Shell.AppBar"` | The header bar at the top of the page |
| `"Shell.Drawer"` | The collapsible main sidebar navigation drawer |
| `"Shell.DrawerNavigationItem"` | Individual links inside the sidebar |
| `"Shell.DrawerNavigationGroup"` | Collapsible navigation group headers in the sidebar |
| `"HomePage"` | The default content-mode home landing page |
| `"HomePage.CollectionCard"` | Individual collection cards on the home page |
| `"Auth.LoginView"` | The overlay shown when requesting authentication |

### Collection-Scoped Components (`CollectionComponentName`)

These components can be overridden globally (acting as defaults for all collections) or on individual collections.

| Component Key | Description |
|---|---|
| `"Collection.View"` | The entire collection landing page |
| `"Collection.Table"` | The default spreadsheet tabular view |
| `"Collection.Card"` | The card view item wrapper |
| `"Collection.EmptyState"` | View shown when a collection is empty |
| `"Collection.Actions"` | Toolbar buttons above the table/cards |
| `"Collection.FilterField"` | Custom filter input for a column |
| `"Entity.Form"` | The detail form for creating/updating |
| `"EditView.FormActions"` | Form submission/cancel button bar |
| `"DetailView"` | Read-only detail view |
| `"Entity.SidePanel"` | The side panel container for form/detail |
| `"EntityPreview"` | Inline reference/relation chip preview |
| `"Entity.MissingReference"` | Rendered when a referenced entity is missing |

:::note[Three keys break the `Entity.` pattern]
`"DetailView"`, `"EntityPreview"` and `"EditView.FormActions"` carry no `Entity.`
prefix. `"Entity.DetailView"`, `"Entity.Preview"` and `"Entity.FormActions"` are
not in the union — they type-error, and in plain JavaScript the override simply
never applies.
:::

Your replacement receives the same props the built-in component was given. The
override map does not name a props type per key — `ComponentOverride<P>` defaults
`P` to `Record<string, unknown>` — so type the parameter yourself, or pass a type
argument, when you want the props checked. A few of the built-ins do export a
props type you can import and reuse: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
and `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` and
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). The rest have no exported props type — write the shape you
actually read.

### What a `Collection.View` override must honour

`Collection.View` is what a `CollectionPanel` draws, so the panel's props reach
your override as `CollectionViewBindingProps` (`@rebasepro/cms`), spread over the
collection's own. A replacement that ignores them breaks every page that embeds
the collection. Honour at least these:

| Prop | What the caller expects |
|---|---|
| `collectionOverrides` | What the caller changes about the collection (a fixed filter, a sort, the view mode), applied over the registered collection |
| `fields` | Only these properties, in this order: the columns, and what list rows and cards are filled from |
| `highlightedIds` | The ids of the rows drawn as selected; `[]` for none |
| `onRowClick` | Called with the clicked row, as the server sends it, and its id, instead of opening it. The panel's own `onRowClick` |

The panel also passes `viewMode` (the mode to open in), `toolbar` (the toolbar
to draw, `null` for none) and `title` (`false` to draw no title), where its
caller set them. The built-in `CollectionViewBinding` handles all of them; an
override that wraps it rather than replacing it can pass them straight through.

To start from the built-in part rather than from nothing, copy its source into
your project and register the copy here: every part but `Collection.View`,
`DetailView` and the home page's drag-and-drop compiles with package imports.
See [Copying a built-in part](/docs/frontend/customizing#copying-a-built-in-part).

## Related

- [Extending Rebase](/docs/frontend/extending/) — the extension points that do not need an override
- [Custom Fields](/docs/frontend/custom-fields/) — replacing one property's editor rather than a component
- [Slots](/docs/frontend/slots/) — adding to a component instead of replacing it
