---
title: Entity Actions
sidebar_label: Entity Actions
description: Add custom action buttons to entities for archiving, publishing, exporting, cloning, and more.
---

## Overview

Entity actions are custom buttons that appear on individual entities. Use them for operations like publishing, archiving, cloning, or triggering external workflows.

## Defining Entity Actions

```typescript
import { defineCollection } from "@rebasepro/admin-types";
import { iconSize } from "@rebasepro/ui";
import { Copy, Upload } from "lucide-react";

const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published At", type: "date" }
    },
    admin: {
        entityActions: [
            {
                name: "Publish",
                icon: <Upload size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .update(entity.id, { status: "published", publishedAt: new Date() });
                    context.snackbarController.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    const { id, ...values } = entity.values;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .create({ ...values, name: values.name + " (Copy)" });
                }
            }
        ]
    }
});

```

## Collection Actions

For toolbar-level actions that work on the collection or selected entities:

```tsx
import { defineCollection } from "@rebasepro/admin-types";
function PublishSelectedAction({ selectionController, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        const selected = selectionController.selectedEntities;
        for (const entity of selected) {
            await context.data.save({
                path: entity.path,
                entityId: entity.id,
                values: { status: "published" },
                collection: context.collection
            });
        }
    };

    return (
        <button onClick={handlePublish}>
            Publish {selectionController.selectedEntities.length} selected
        </button>
    );
}

// Register — `Actions` is an array, so several can be composed.
const collection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: { /* … */ },
    admin: {
        Actions: [PublishSelectedAction]
    }
});
```

![Collection actions](/img/collection_actions.png)

## Next Steps

- **[Additional Columns](/docs/frontend/additional-columns)** — Computed table columns
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
