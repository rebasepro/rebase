---
title: Actions d'Entité
sidebar_label: Actions d'Entité
description: Ajoutez des boutons d'action personnalisés aux entités pour l'archivage, la publication, l'exportation, le clonage, et plus encore.
---

## Vue d'ensemble

Les actions d'entité sont des boutons personnalisés qui apparaissent sur les entités individuelles. Utilisez-les pour des opérations telles que la publication, l'archivage, le clonage ou le déclenchement de workflows externes.

## Définition des Actions d'Entité

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
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
    ],
    properties: { /* ... */ }
};
```

## Actions de Collection

Pour les actions au niveau de la barre d'outils qui s'appliquent à la collection ou aux entités sélectionnées :

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
const collection: EntityCollection = {
    Actions: PublishSelectedAction,
    // ...
};
```

![Collection actions](/img/collection_actions.png)

## Prochaines Étapes

- **[Colonnes Supplémentaires](/docs/frontend/additional-columns)** — Colonnes de tableau calculées
- **[Champs Personnalisés](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
---
