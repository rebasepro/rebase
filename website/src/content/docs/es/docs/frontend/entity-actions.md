---
title: Acciones de Entidad
sidebar_label: Acciones de Entidad
description: Añade botones de acción personalizados a las entidades para archivar, publicar, exportar, clonar y más.
---

## Resumen

Las acciones de entidad son botones personalizados que aparecen en entidades individuales. Úsalos para operaciones como publicar, archivar, clonar o activar flujos de trabajo externos.

## Definición de Acciones de Entidad

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

## Acciones de Colección

Para acciones a nivel de barra de herramientas que funcionan en la colección o en entidades seleccionadas:

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

![Acciones de colección](/img/collection_actions.png)

## Próximos Pasos

- **[Columnas Adicionales](/docs/frontend/additional-columns)** — Columnas de tabla calculadas
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados

---
