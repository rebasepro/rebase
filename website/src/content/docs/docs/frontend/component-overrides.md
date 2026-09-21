---
title: Component Overrides (Swizzling)
sidebar_label: Component Overrides
description: Override default UI components with custom implementations at the application or collection level.
---

## Overview

Rebase allows you to override default UI components with your own custom implementations. This implements a Docusaurus-style component swizzling model that supports two customization patterns:
- **Eject mode** (default): Your component fully replaces the built-in one.
- **Wrap mode** (`wrap: true`): Your component wraps the original. The built-in component is passed as the `OriginalComponent` prop so you can render it inside your custom layout/logic.

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

To override components only for a specific collection, add a `components` object under its `admin` block. This is useful for customizing empty states, cards, or detail views for particular models.

In the default scaffold, `config/collections/` is loaded by **both** the admin panel and the backend, which reads the same files to derive the schema and the API. So point at each component by **module path** rather than importing it. `Component` takes the same forms as `admin.Field` and `entityViews[].Builder`: a path, a lazy `import()`, or the component itself.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

The wrapping component lives with the rest of your frontend code, and receives the built-in one as `OriginalComponent`:

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Each module needs a **default export**. The collections Vite plugin rewrites a path into a lazy import, so the component is its own chunk and loads the first time the override renders. That rewrite covers the files inside the configured `collectionsDir`. A path in a file outside it reaches the admin as a bare string: the console says so, and the built-in component renders in its place. Outside `collectionsDir`, write the lazy import yourself: `Component: () => import("../../frontend/src/ProductCustomForm")`.

A direct reference (`Component: ProductCustomForm`) also works, but only in a collection file nothing on the server loads, because importing the component also imports React and everything it pulls in.

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
`CollectionEmptyStateProps`, `CollectionActionsProps` and
`FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` and
`EntityFormActionsProps` (`@rebasepro/cms`). The rest have no exported props
type — write the shape you actually read.

## Related

- [Extending Rebase](/docs/frontend/extending/) — the extension points that do not need an override
- [Custom Fields](/docs/frontend/custom-fields/) — replacing one property's editor rather than a component
- [Slots](/docs/frontend/slots/) — adding to a component instead of replacing it
