---
title: Additional Columns
sidebar_label: Additional Columns
description: Add computed/virtual columns to collection tables that derive values from snapshot data.
---

## Overview

Additional columns let you display computed or derived data in the collection table without storing it in the database.

## Defining Additional Columns

```typescript
const ordersCollection: CollectionConfig = {
    slug: "orders",
    additionalFields: [
        {
            key: "total_display",
            name: "Total",
            Builder: ({ snapshot }) => {
                const total = snapshot.values.items?.reduce(
                    (sum, item) => sum + (item.price * item.quantity), 0
                ) ?? 0;
                return <span>${total.toFixed(2)}</span>;
            }
        },
        {
            key: "status_badge",
            name: "Status",
            Builder: ({ snapshot }) => {
                const color = snapshot.values.status === "completed" ? "green" : "orange";
                return (
                    <span style={{ color }}>
                        {snapshot.values.status}
                    </span>
                );
            },
            dependencies: ["status"]  // Re-render when these fields change
        }
    ],
    properties: { /* ... */ }
};
```

## Builder Props

| Prop | Type | Description |
|------|------|-------------|
| `snapshot` | `Snapshot` | The snapshot for this row |
| `context` | `RebaseContext` | Full Rebase context |

## Next Steps

- **[Snapshot Actions](/docs/frontend/snapshot-actions)** — Custom action buttons
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
