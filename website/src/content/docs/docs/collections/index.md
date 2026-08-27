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

## Declaring one: `defineCollection`

Wrap the literal in `defineCollection`. At runtime it is the identity function — it
returns the object unchanged — so it costs nothing. What it buys is inference: a `const`
type parameter captures your `properties` keys as literal types, and the key-shaped
fields of the `admin` block are then checked against them. A name that is not one of
your properties is a **compile error**, not just a missing suggestion.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },  // completion: "name" | "price"
        sort: ["price", "asc"],      // completion on the first element
        propertiesOrder: ["name", "price"]
    }
});
```

```typescript
    admin: {
        display: { title: "nmae" }
        //                ~~~~~~ Type '"nmae"' is not assignable to type
        //                       'PropertyPath<…>'. Did you mean '"name"'?
    }
```

The checked fields are `display`, `sort`, `propertiesOrder` and `listProperties`.
Three forms are accepted besides a plain property key:

| Form | Example | Notes |
| --- | --- | --- |
| Dotted path into a `map` | `"profile.displayName"` | The **root** must be a real property; the path below it is not checked. |
| Child-collection column | `"subcollection:orders"` | `propertiesOrder` / `listProperties` only. |
| An `additionalFields` key | `"score" as AdditionalFieldKey` | Needs the cast — see below. |

`AdditionalFieldDelegate.key` is a plain `string`, so the type system has no way to know
which extra keys a collection declares. Rather than reopen these fields to every string,
the cast makes the exception explicit:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Import it from `@rebasepro/cms-types` in a project that has an admin panel — that is
the copy that also typechecks the `admin` block. A headless BaaS project, which has no
admin block and no React, imports the same function from `@rebasepro/common` instead.

Annotating the type directly still works and is still checked:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

but an annotation only *validates the shape* — it cannot see your property names, so the
`admin` key fields fall back to accepting any string. Prefer `defineCollection` unless you
need to name the type.

:::note
`buildCollection` and `buildProperty` no longer exist. `buildCollection` is
`defineCollection` without the inference; `buildProperty` wrapped a property in a type it
already had. See the [changelog](/docs/changelog) for the one-line migration.
:::

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

### The `admin` block exists only if you install the admin types

`@rebasepro/types` declares no `admin` field — not on a collection, not on a property. In
a BaaS project, writing one is a **type error**. `@rebasepro/cms-types` adds it back by
declaration merging, so one line per project turns it on:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

After that, plain core types carry a fully typed block — a typo like `icoon` is an error,
and you get completion:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const posts = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText" }
});
```

<!-- docs-verify: ignore -->
An augmentation applies to the whole TypeScript *program*, and `config/` and `frontend/`
are separate programs — which is why the reference belongs in the config package. There
is no `AdminCollectionConfig` wrapper type: with the field merged in, `CollectionConfig`
is the authoring type.

:::note[Why a BaaS project pays nothing]
A property type in a BaaS install has no `Field`, no `columnWidth`, no
`hideFromCollection` — those live in `AdminPropertyOptions` in the admin package. The
guarantee is asserted, not claimed: `e2e/baas-typecheck/src/admin_absent.ts` uses
`@ts-expect-error` on `admin`, so the build fails if the field ever becomes writable in
core again.
:::

### Migrating from a flat collection

Before 0.11 these fields sat at the top level. To move them:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

It reports anything it cannot move safely — notably presentation inside
`relations[].overrides`, which needs `overrides: { admin: { … } }` by hand.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
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
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

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
| `indexes` | `CollectionIndex[]` | Postgres indexes this table needs. See [Indexes](/docs/backend/indexes). |
| `search` | `SearchConfig` | Ranked full-text search over the fields you name, including JSONB and array content. Postgres only. See [Search](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Mark collection as authentication collection (user management, reset password, etc.) |

### UI Configuration

All of the following go inside `admin`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Default view mode |
| `enabledViews` | `ViewMode[]` | All four | Which view modes are available |
| `kanban` | `KanbanConfig` | — | Kanban configuration (column property). Always pair with `orderProperty` — see [View Modes](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Key of the **string** property holding the drag-and-drop order key. Required for a working Kanban board |
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
| `includeJsonView` | `boolean` | `true` | Offer the raw values in the record inspector |
| `history` | `boolean` | `false` | Track changes in entity history |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Apply default values on every save |
| `previewProperties` | `string[]` | — | Properties to display in reference previews |
| `display` | `EntityDisplay` | — | What fills each display role — see [Entity display](#entity-display) |

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

## Entity display

Every surface that draws a record draws some subset of six roles: **title**,
**subtitle**, **image**, **status**, **date** and **tags**. A list row is image +
title + subtitle + status + date, a card is the same with the image on top, a
reference picker is title + subtitle, and a page heading is the title alone.

Each role is derived from your properties, and each can be stated instead — as a
property path, or as a function:

```typescript
const exercises = defineCollection({
    name: "Exercises",
    slug: "exercises",
    table: "exercises",
    properties: {
        name: { name: "Name", type: "string" },
        cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
        city: { name: "City", type: "string" }
    },
    admin: {
        display: {
            title: "name",                                  // a property path
            image: "cover",
            subtitle: ({ entity }) => `in ${entity.values.city}`   // computed
        }
    }
});
```

Anything you leave out keeps its derived value, so stating one role does not
mean stating all six.

### Computed and async roles

A resolver may be `async`, which is what lets a role read something the record
does not carry — a document in a subcollection, a value behind an API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ entity, context }) => {
            const locale = await context.data.exercise_locales.get(`${entity.id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

While the promise is in flight the surface shows the derived value and swaps the
resolved one in when it lands — a title is never a spinner. Results are cached
per record and per role, and concurrent asks for the same pair share one call, so
a list of fifty rows resolves each row once rather than once per render.

Return `undefined` when a record has nothing for the role; the surface's own
fallback is better informed about what belongs there instead (a heading uses the
singular collection name, a link uses the id). A resolver that throws is treated
as `undefined` and logged once — a title that cannot be fetched must not take
down the row that shows it.

Prefer a path whenever the value is on the record: a path keeps the property's
own rendering, so an enum status stays a coloured chip and a date stays
formatted, which a resolver returning a bare string cannot express.

:::note[Replaced `titleProperty`]
`admin.titleProperty` was removed in favour of `admin.display.title`. The same
string works there, and the new field also takes a resolver. A collection still
carrying the old key is rejected by `defineCollection` with the usual
unknown-key error.
:::

### Title Property Selection
When `display.title` is not set, the property used as the entity's display title (previews, headers) is resolved automatically:
1. If `propertiesOrder` is explicitly defined, the first non-ID property that is either a `relation` or `string` type is chosen as the title.
2. If no `propertiesOrder` is defined, the framework searches the properties in order and picks the first string type property.

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
    sort: ["createdAt", "desc"]
}
```

## Next Steps

- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks for syncing data between collections, validation, side effects
- **[Properties](/docs/collections/properties)** — All property types and options
- **[Relations](/docs/collections/relations)** — Foreign keys, junction tables, joins
- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[View Modes](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
