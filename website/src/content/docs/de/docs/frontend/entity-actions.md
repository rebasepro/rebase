---
title: Entitätsaktionen
sidebar_label: Entitätsaktionen
description: Fügen Sie Entitäten benutzerdefinierte Aktionsschaltflächen für Archivierung, Veröffentlichung, Export, Klonen und mehr hinzu.
---

## Übersicht

Entitätsaktionen sind benutzerdefinierte Schaltflächen, die bei einzelnen Entitäten angezeigt werden. Verwenden Sie sie für Operationen wie Veröffentlichen, Archivieren, Klonen oder das Auslösen externer Workflows.

## Entitätsaktionen definieren

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        status: { name: "Status", type: "string" },
        published_at: { name: "Published At", type: "date" }
    },
    admin: {
        entityActions: [
            {
                name: "Publish",
                icon: "publish",
                onClick: async ({ entity, context }) => {
                    await context.dataSource.saveEntity({
                        path: entity.path,
                        entityId: entity.id,
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
                onClick: async ({ entity, context }) => {
                    const { id, ...values } = entity.values;
                    await context.dataSource.saveEntity({
                        path: entity.path,
                        values: { ...values, name: values.name + " (Copy)" },
                        collection: articlesCollection
                    });
                }
            }
        ]
    }
});

```

## Sammlungsaktionen

Für Aktionen auf Symbolleisten-Ebene, die für die Sammlung oder ausgewählte Entitäten gelten:

```tsx
import { defineCollection } from "@rebasepro/admin-types";
function PublishSelectedAction({ selectionController, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        const selected = selectionController.selectedEntities;
        for (const entity of selected) {
            await context.dataSource.saveEntity({
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

// Register
const collection = defineCollection({
    admin: {
        Actions: PublishSelectedAction
    }
    // ...
});
```

![Sammlungsaktionen](/img/collection_actions.png)

## Nächste Schritte

- **[Zusätzliche Spalten](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder

---
