---
title: Collections
sidebar_label: Collections
description: Collections are the core building block of Rebase — each collection maps to a database table and defines its schema, relations, security, and UI behavior.
---

## What is a Collection?

A **collection** is a TypeScript object that describes a database table and how it should appear in the admin UI. It defines:

- **Schema** — Properties (columns), their types, and validation rules
- **Relations** — Foreign keys, junction tables, and join paths
- **Security** — Row Level Security policies
- **Lifecycle hooks** — Callbacks for create, update, delete operations
- **Admin UI behavior** — View modes, inline editing, entity views, actions — all under `admin`

## Anatomy: the contract, and the panel

One file, two audiences. Everything the *database and the API* care about sits at the
top level; everything the *admin panel* renders sits inside `admin`.

```typescript
const posts = {
    // ── The backend reads these ──────────────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── The admin panel reads these ──────────────────────────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

The split is not cosmetic. It is what lets Rebase be a backend on its own:

- A **BaaS or headless** project never writes an `admin` block. Its collections — or no
  collections at all, since BaaS mode introspects the database — describe data and
  authorization, nothing else. `@rebasepro/types` contains no React, so there is no
  React anywhere in the dependency tree.
- The **backend never reads inside the block**. It is dropped before a collection is
  serialized to the contract endpoint or into a build bundle, and it is excluded from
  the schema version — so changing an icon does not report every generated SDK as
  stale.

### Getting the block type-checked

`CollectionConfig` types `admin` opaquely, which means a typo inside it compiles. Annotate
with `AdminCollectionConfig` — a **type-only** import, so nothing is added to your
backend's module graph:

```typescript
import type { AdminCollectionConfig } from "@rebasepro/admin-types";

const posts: AdminCollectionConfig = {
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    admin: { icon: "FileText" }   // `icoon` is now an error
};
```

In frontend-only code, `defineCollection` from `@rebasepro/admin-types` gives the same
checking plus completion on `admin.titleProperty` and `admin.propertiesOrder` over your
own property keys. It is a value import, so do not use it in a file the backend loads.

### Migrating from a flat collection

Before 0.11 these fields sat at the top level. To move them:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

It reports anything it cannot move safely — notably presentation inside
`relations[].overrides`, which needs `overrides: { admin: { … } }` by hand.

```typescript
import { CollectionConfig } from "@rebasepro/types";

export const productsCollection: CollectionConfig = {
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blueDark" },
                { id: "clothing", label: "Clothing", color: "pinkLight" },
                { id: "books", label: "Books", color: "orangeDark" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            ui: { readOnly: true }
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
};

```

## Key Properties

### Identification

| Property | Type | Description |
|----------|------|-------------|
| `slug` | `string` | **Required.** URL-safe identifier. Used in the admin UI URL and REST API path (`/api/data/{slug}`). |
| `name` | `string` | **Required.** Display name (plural). Shown in navigation and page headers. |
| `singularName` | `string` | Display name for a single entity. Used in "New Product", "Edit Product", etc. |
| `table` | `string` | **Required.** PostgreSQL table name. If different from `slug`, allows you to decouple URLs from table names. |
| `admin.icon` | `string` | Icon key. See [Google Fonts Icons](https://fonts.google.com/icons). |

### Schema

| Property | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | **Required.** Map of property key → property definition. Each key becomes a database column. |
| `relations` | `Relation[]` | SQL relations — foreign keys, junction tables. See [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Row Level Security policies. See [Security Rules](/docs/collections/security-rules). |
| `auth` | `boolean | AuthCollectionConfig` | Mark collection as authentication collection (user management, reset password, etc.) |

### UI Configuration

All of the following go inside `admin`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Default view mode |
| `enabledViews` | `ViewMode[]` | All four | Which view modes are available |
| `kanban` | `KanbanConfig` | — | Kanban configuration (column property) |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | How entities open for editing |
| `sideDialogWidth` | `number \| string` | — | Width of the side dialog |
| `inlineEditing` | `boolean` | `true` | Enable inline editing in the spreadsheet view |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Default row height in the table |
| `pagination` | `boolean \| number` | `true` (50) | Enable pagination and/or set page size |
| `listProperties` | `string[]` | — | Properties to display in the list view |
| `propertiesOrder` | `string[]` | — | Column order in the table view |
| `selectionEnabled` | `boolean` | `true` | Enable row selection |
| `hideFromNavigation` | `boolean` | `false` | Hide from the sidebar navigation |
| `defaultSelectedView` | `string \| function` | — | Default view or subcollection to open |

### Entity Options

Inside `admin`, except `history`, which is a backend feature and stays at the top level.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Auto-save on field change |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Backup unsaved changes |
| `hideIdFromForm` | `boolean` | `false` | Hide the entity ID from the form |
| `hideIdFromCollection` | `boolean` | `false` | Hide the ID column from the table |
| `includeJsonView` | `boolean` | `false` | Show a JSON tab in the entity view |
| `history` | `boolean` | `false` | Track changes in entity history |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Apply default values on every save |
| `previewProperties` | `string[]` | — | Properties to display in reference previews |
| `titleProperty` | `string` | — | Property to use as the entity title |

### Advanced

| Property | Type | Description |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Lifecycle hooks (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Custom actions on entities (archive, publish, etc.) |
| `Actions` | `React.ComponentType` | Custom toolbar actions component |
| `entityViews` | `EntityCustomView[]` | Custom tabs in the entity detail view |
| `additionalFields` | `AdditionalFieldDelegate[]` | Computed/virtual columns |
| `childCollections` | `() => CollectionConfig[]` | Nested child collections |
| `subcollections` | `() => CollectionConfig[]` | Nested collections (e.g., order → line items) |
| `exportable` | `boolean \| ExportConfig` | Enable data export |
| `ownerId` | `string` | Owner user ID (used by plugins/custom code) |
| `overrides` | `EntityOverrides` | Overrides for the entity view |
| `components` | `CollectionComponentOverrideMap` | Collection-scoped UI component overrides |
| `driver` | `string` | Database driver to use (default: `"(default)"`) |
| `databaseId` | `string` | Database/schema ID within the driver |

## Entity Previews & Title Resolution

### Title Property Selection
By default, the property used as the entity's display title (previews, headers) is resolved automatically:
1. If `titleProperty` is explicitly specified on the collection, it is used.
2. If `propertiesOrder` is explicitly defined, the first non-ID property that is either a `relation` or `string` type is chosen as the title.
3. If no `propertiesOrder` is defined, the framework searches the properties in order and picks the first string type property.

### Relation Previews in Tables
When `propertiesOrder` is explicitly set, relation properties are **not** automatically filtered out of the default preview columns (whereas they are excluded from unordered defaults to avoid slow join operations).

### resolveTitleToString Utility
Rebase provides a `resolveTitleToString(title: any): string` helper to turn complex entity title values (including dates, arrays, or relation shapes like `{ __type: "relation", id, data: { values } }`) into clean, human-readable strings. It prioritizes common fields like `name`, `title`, `label`, and `displayName` from nested relation data.

## Collection Builder

For dynamic collections that change based on the user or external data, use a builder function:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    if (authController.extra?.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtering and Sorting

You can set default or forced filters:

```typescript
{
    // Default filter — users can change it
    defaultFilter: { active: ["==", true] },

    // Fixed filter — cannot be changed
    fixedFilter: { tenant_id: ["==", currentTenantId] },

    // Default sort
    sort: ["created_at", "desc"]
}
```

## Next Steps

- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks for syncing data between collections, validation, side effects
- **[Properties](/docs/collections/properties)** — All property types and options
- **[Relations](/docs/collections/relations)** — Foreign keys, junction tables, joins
- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[View Modes](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
