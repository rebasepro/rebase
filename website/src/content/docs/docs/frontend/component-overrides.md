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

To override components only for a specific collection, add a `components` object to its definition. This is useful for customizing empty states, cards, or detail views for particular models.

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

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
