---
title: Additional Columns
sidebar_label: Additional Columns
description: Add computed/virtual columns to collection tables that derive values from entity data.
---

## Overview

Additional columns let you display computed or derived data in the collection table without storing it in the database.

## Defining Additional Columns

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { AdditionalFieldKey } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    additionalFields: [
        {
            key: "total",
            name: "Total",
            Builder: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                const total = items.reduce(
                    (sum: number, item: { price?: number; quantity?: number }) =>
                        sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                );
                return <span>{total.toFixed(2)}</span>;
            },
            dependencies: ["items"],
            value: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                return items.length;
            }
        }
    ],
    fieldOrder: ["name", "total" as AdditionalFieldKey, "status"],
});
```

| Key | What it does |
|---|---|
| `key` | Identifies the column. Name it in `fieldOrder` or `listFields` as `"total" as AdditionalFieldKey`. |
| `name` | The header. |
| `width` | The width, in pixels. |
| `Builder` | Renders the cell. |
| `dependencies` | The fields whose change re-renders the cell; checked against the table. |
| `value` | The cell's value, for export. |

## Builder Props

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The record as the server sends the row: dates as ISO strings, a belongsTo as its foreign-key column, `id` only where the table has that column. A relation the admin loaded is nested under its name as the related record's own columns |
| `id` | `string` | The record's id: its primary key as a string, a composite key's parts joined by `:::`. The id `useSidePanel().open` and a route take |
| `context` | `RebaseContext` | Full Rebase context |

`value({ row, id, context })` receives the same props.

## Next Steps

- **[Entity Actions](/docs/frontend/entity-actions)** — Custom action buttons
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
