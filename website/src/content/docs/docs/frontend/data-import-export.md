---
title: Data Import & Export
sidebar_label: Data Import & Export
description: Import data from CSV, JSON, and Excel files into your collections, and export collection data to CSV or JSON with optional computed fields.
---

## Overview

Rebase includes built-in data import and export tools accessible directly from the admin panel. Import supports CSV, JSON, and Excel files with a column-mapping wizard. Export supports CSV and JSON with optional computed fields.

Both features are enabled by default on all collections and can be configured or disabled per collection.

## Importing Data

### How to Import

1. Open a collection in the admin panel
2. Click the **Import** button in the toolbar
3. Select or drag-and-drop your file
4. Map file columns to collection properties
5. Preview the data and resolve any validation errors
6. Click **Import** to save all entities

### Supported Formats

| Format | Extensions | Notes |
|--------|-----------|-------|
| CSV | `.csv` | Auto-detects delimiters |
| JSON | `.json` | Expects an array of objects |
| Excel | `.xlsx` | Reads the first sheet |

### Column Mapping

The import wizard automatically attempts to match file columns to collection properties by name. You can manually adjust mappings before importing:

- **Exact matches** are mapped automatically (e.g. `name` → `name`)
- **Unmatched columns** can be mapped manually or skipped
- **Type coercion** handles string-to-number, string-to-boolean, and date parsing

### Validation

Before importing, the wizard validates all rows against your collection's property definitions:

- Required fields must be present
- Enum values must match defined options
- Data types must be compatible (e.g. a text value for a number field is flagged)
- Validation errors are shown per-row so you can fix them before importing

### Import Configuration

Import is enabled by default. To disable it on a specific collection, use the `admin` sub-object:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    // Import is enabled by default
});
```

## Exporting Data

### How to Export

1. Open a collection in the admin panel
2. Optionally apply filters to export a subset of data
3. Click the **Export** button in the toolbar
4. Choose the format: **CSV** or **JSON**
5. The file downloads immediately

### Export Formats

| Format | Description |
|--------|-------------|
| CSV | Comma-separated values, compatible with Excel and Google Sheets |
| JSON | Array of objects, useful for programmatic consumption |

### Filtering Before Export

Any active filters in the collection view are applied to the export. This lets you export only a subset of your data:

- Apply column filters or search terms in the collection view
- Click **Export** — only the filtered rows are included

### Export Configuration

Export is enabled by default. You can configure it with additional computed fields:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: true            // Enable (default: true)
    }
});

```

To disable export:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: false
    }
});

```

### Adding Computed Fields

Use the `ExportConfig` object to add custom computed columns to your exports. These columns don't exist in the database — they are calculated at export time:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: {
            additionalFields: [
                {
                    key: "computed_margin",
                    builder: ({ entity }) => {
                        const price = entity.values.price as number;
                        const cost = entity.values.cost as number;
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ entity }) => {
                        return `https://mystore.com/products/${entity.id}`;
                    }
                }
            ]
        }
    }
});

```

Each `additionalFields` entry has:

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Column name in the export |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Function that computes the value |

The `builder` function receives the current `entity` and the `RebaseContext` (which includes the authenticated user), so you can compute values based on both data and permissions.

### Async Computed Fields

The `builder` function can be async, which is useful when the computed value requires a database lookup or API call:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ entity, context }) => {
                const author = await context.data.users.findById(
                    entity.values.authorId as string
                );
                return author?.values.displayName ?? "Unknown";
            }
        }
    ]
}
```

## Next Steps

- **[Collections](/docs/collections)** — Define your data model
- **[Frontend Overview](/docs/frontend)** — Admin panel and UI components
- **[Client SDK](/docs/sdk)** — Programmatic data access
