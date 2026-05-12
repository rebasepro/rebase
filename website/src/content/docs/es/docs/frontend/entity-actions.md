---
title: Acciones de Entidad
sidebar_label: Acciones de Entidad
slug: docs/frontend/entity-actions
description: Añade botones de acción personalizados a las entidades para archivar, publicar, exportar, clonar y más.
---

## Resumen

Las acciones de entidad son botones personalizados que aparecen en entidades individuales. Úsalos para operaciones como publicar, archivar, clonar o activar flujos de trabajo externos.

## Definición de Acciones de Entidad

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

## Acciones de Colección

Para acciones a nivel de barra de herramientas que funcionan en la colección o en entidades seleccionadas:

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

![Acciones de colección](/img/collection_actions.png)

## Próximos Pasos

- **[Columnas Adicionales](/docs/frontend/additional-columns)** — Columnas de tabla calculadas
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados

---
