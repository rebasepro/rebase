---
title: Data Import & Export
sidebar_label: Data Import & Export
description: Import data from CSV, JSON, and Excel files into your collections, and export collection data to CSV or JSON with optional computed fields.
---

## Overview

Rebase includes built-in data import and export tools accessible directly from the admin panel. Import supports CSV, JSON, and Excel files with a column-mapping wizard. Export supports CSV and JSON with optional computed fields.

Both are available on every collection. Export can be configured per collection with computed fields; neither can be switched off per collection.

## Importing Data

### How to Import

1. Open a collection in the admin panel
2. Click the **Import** button in the toolbar
3. Select or drag-and-drop your file
4. Map file columns to collection properties
5. Preview the data, including any values that cannot be converted
6. Click **Save data** to write the rows

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
- **Type conversion** turns each cell into the type of the property it maps to, but only when nothing is lost (see below)

### Type conversion

A cell is converted only when the property's type can hold exactly what it says:

| Property type | Converts | Does not convert |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (a leading zero would be lost), numbers with more than 15 significant digits, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, in any case | anything else |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), written-out dates (`5 Jan 2024`), `05/01/2024`, epoch seconds or milliseconds | text that names no date |

A date without a time is that day in UTC. For dates written as `05/01/2024`, the column decides the order: a first number above 12 makes the column day-first, a second number above 12 makes it month-first. When a column never says, the browser's locale decides, and when it holds both orders, a date that either order could read is not converted.

A blank cell is no value: it sets nothing, and the default you chose for that property applies.

### Values that cannot be imported

The preview lists every cell that does not convert, per column, with how many there are and the first few by row and reason. Those cells are left empty in the imported rows; nothing is turned into `0`, `false` or an empty value without being listed. Go back to map the column to another property, or correct the file and upload it again.

The collection's own rules — required fields, enum options, unique values — are checked by the server as the rows are written, 25 rows at a time. If a row is refused, the import stops and names it; the rows before it are already saved, and **Retry** resumes from the refused row.

### Creating a collection from a file

When you create a collection from a file, each column's type is inferred from its values. A column is a number only if every value in it is a number or text that converts to one exactly, so a column of zip codes, product codes with leading zeros, long SKUs or phone numbers stays text. A column that mixes types (numbers and words, booleans and numbers) is text. Blank cells do not count, so a mostly empty column is not marked required.

### Import Configuration

Import is available on every collection. There is no per-collection setting
that turns it off.

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

Export is available on every collection. `admin.exportable` configures it: give it
an `ExportConfig` to add computed columns, below. The type also accepts a boolean,
but nothing reads it — `exportable: false` does not remove the **Export** button.

### Adding Computed Fields

Use the `ExportConfig` object to add custom computed columns to your exports. These columns don't exist in the database — they are calculated at export time:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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
- **[Typed SDK](/docs/sdk)** — Programmatic data access
