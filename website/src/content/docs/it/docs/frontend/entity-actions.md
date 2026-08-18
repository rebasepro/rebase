---
title: Azioni Entità
sidebar_label: Azioni Entità
description: Aggiungi pulsanti di azione personalizzati alle entità per archiviazione, pubblicazione, esportazione, clonazione e altro.
---

## Panoramica

Le azioni entità sono pulsanti personalizzati che appaiono sulle singole entità. Usali per operazioni come pubblicazione, archiviazione, clonazione o attivazione di flussi di lavoro esterni.

## Definizione delle Azioni Entità

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

## Azioni della Collezione

Per le azioni a livello di barra degli strumenti che operano sulla collezione o sulle entità selezionate:

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

// Register
const collection = defineCollection({
    admin: {
        Actions: PublishSelectedAction
    }
    // ...
});
```

![Azioni collezione](/img/collection_actions.png)

## Prossimi Passi

- **[Colonne Aggiuntive](/docs/frontend/additional-columns)** — Colonne di tabella calcolate
- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Campi del modulo personalizzati

---
