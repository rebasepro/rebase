---
sourceHash: 3bf8656e3408eede
title: Entitätsaktionen
sidebar_label: Entitätsaktionen
description: Fügen Sie Entitäten benutzerdefinierte Aktionsschaltflächen für Archivierung, Veröffentlichung, Export, Klonen und mehr hinzu.
---

## Übersicht

Entitätsaktionen sind benutzerdefinierte Schaltflächen, die bei einzelnen Entitäten angezeigt werden. Verwenden Sie sie für Operationen wie Veröffentlichen, Archivieren, Klonen oder das Auslösen externer Workflows.

## Entitätsaktionen definieren

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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

## Sammlungsaktionen

Für Aktionen auf Symbolleisten-Ebene, die für die Sammlung oder ausgewählte Entitäten gelten:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
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
