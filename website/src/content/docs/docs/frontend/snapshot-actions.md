---
title: Snapshot Actions
sidebar_label: Snapshot Actions
description: Add custom action buttons to snapshots for archiving, publishing, exporting, cloning, and more.
---

## Overview

Snapshot actions are custom buttons that appear on individual snapshots. Use them for operations like publishing, archiving, cloning, or triggering external workflows.

## Defining Snapshot Actions

```typescript
const articlesCollection: CollectionConfig = {
    slug: "articles",
    snapshotActions: [
        {
            name: "Publish",
            icon: "publish",
            onClick: async ({ snapshot, context }) => {
                await context.dataSource.saveEntity({
                    path: snapshot.path,
                    snapshotId: snapshot.id,
                    values: { status: "published", published_at: new Date() },
                    collection: articlesCollection
                });
                context.snackbarController.open({
                    message: "Article published!"
                });
            }
        },
        {
            name: "Clone",
            icon: "content_copy",
            onClick: async ({ snapshot, context }) => {
                const { id, ...values } = snapshot.values;
                await context.dataSource.saveEntity({
                    path: snapshot.path,
                    values: { ...values, name: values.name + " (Copy)" },
                    collection: articlesCollection
                });
            }
        }
    ],
    properties: { /* ... */ }
};
```

## Collection Actions

For toolbar-level actions that work on the collection or selected snapshots:

```tsx
function PublishSelectedAction({ selectionController, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        const selected = selectionController.selectedEntities;
        for (const snapshot of selected) {
            await context.dataSource.saveEntity({
                path: snapshot.path,
                snapshotId: snapshot.id,
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

// Register
const collection: CollectionConfig = {
    Actions: PublishSelectedAction,
    // ...
};
```

![Collection actions](/img/collection_actions.png)

## Next Steps

- **[Additional Columns](/docs/frontend/additional-columns)** — Computed table columns
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
