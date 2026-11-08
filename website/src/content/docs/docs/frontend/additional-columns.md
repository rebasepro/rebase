---
title: Additional Columns
sidebar_label: Additional Columns
description: Add computed/virtual columns to collection tables that derive values from entity data.
---

## Overview

Additional columns let you display computed or derived data in the collection table without storing it in the database.

## Defining Additional Columns

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        items: {
            name: "Items",
            type: "array",
            of: {
                name: "Item",
                type: "map",
                properties: {
                    price: { name: "Price", type: "number" },
                    quantity: { name: "Quantity", type: "number" }
                }
            }
        },
        status: { name: "Status", type: "string" }
    },
    admin: {
        additionalFields: [
            {
                key: "total_display",
                name: "Total",
                Builder: ({ row }) => {
                    const items = Array.isArray(row.items) ? row.items : [];
                    const total = items.reduce(
                        (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                    );
                    return <span>${total.toFixed(2)}</span>;
                }
            },
            {
                key: "status_badge",
                name: "Status",
                Builder: ({ row }) => {
                    const color = row.status === "completed" ? "green" : "orange";
                    return (
                        <span style={{ color }}>
                            {String(row.status ?? "")}
                        </span>
                    );
                },
                dependencies: ["status"]  // Re-render when these fields change
            }
        ]
    }
});

```

## Builder Props

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The record as the server sends the row: dates as ISO strings, a belongsTo as its foreign-key column, `id` included |
| `context` | `RebaseContext` | Full Rebase context |

`value({ row, context })` receives the same props.

## Next Steps

- **[Entity Actions](/docs/frontend/entity-actions)** — Custom action buttons
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
