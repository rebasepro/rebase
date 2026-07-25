---
title: Azioni Entità
sidebar_label: Azioni Entità
description: Aggiungi pulsanti di azione personalizzati alle entità per archiviazione, pubblicazione, esportazione, clonazione e altro.
---

## Panoramica

Le azioni entità sono pulsanti personalizzati che appaiono sulle singole entità. Usali per operazioni come pubblicazione, archiviazione, clonazione o attivazione di flussi di lavoro esterni.

## Definizione delle Azioni Entità

```typescript
const articlesCollection: CollectionConfig = {
    slug: "articles",
    properties: { /* ... */ },
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
};

```

## Azioni della Collezione

Per le azioni a livello di barra degli strumenti che operano sulla collezione o sulle entità selezionate:

```tsx
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
const collection: CollectionConfig = {
    admin: {
        Actions: PublishSelectedAction
    }
    // ...
};
```

![Azioni collezione](/img/collection_actions.png)

## Prossimi Passi

- **[Colonne Aggiuntive](/docs/frontend/additional-columns)** — Colonne di tabella calcolate
- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Campi del modulo personalizzati

---
