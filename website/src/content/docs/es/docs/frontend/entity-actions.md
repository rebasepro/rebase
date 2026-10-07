---
sourceHash: db464576272c842b
title: Acciones de entidad
sidebar_label: Acciones de entidad
description: Añade botones de acción personalizados a las entidades para archivar, publicar, exportar, clonar y más.
---

## Descripción general

Las acciones de entidad son botones personalizados que aparecen en entidades individuales. Utilízalas para operaciones como publicar, archivar, clonar o activar flujos de trabajo externos.

## Definir acciones de entidad

```typescript
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
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
                    if (!entity || !context) return;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .update(entity.id, { status: "published", publishedAt: new Date() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    const { id, ...values } = entity.values;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .create({ ...values, name: values.name + " (Copy)" });
                }
            }
        ]
    }
});

```

## Dónde aparece una acción

Una acción aparece en el registro, tanto en su formulario de edición como en su vista de solo lectura, y en las filas de la tabla de la colección. Por defecto espera en el menú de desbordamiento (⋮) en ambos sitios.

Establezca `collapsed: false` en la acción que motiva abrir el registro y tendrá un botón propio:

- **En el registro**, se convierte en un botón con etiqueta en la barra, delante de Guardar (o de Editar, en la vista de solo lectura). Cuando falta espacio en la barra, como en un panel lateral, un diálogo o una ventana estrecha, los botones pierden primero la etiqueta y conservan el icono, con el nombre en un tooltip. Si aun así no caben, las últimas que declaró vuelven al menú, así que declare primero la más importante.
- **En una fila de la tabla**, se convierte en un icono junto a Editar mientras el puntero está sobre la fila.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // un botón en el registro, un icono en la fila
    onClick: async ({ entity, context }) => { /* … */ }
}
```

Resérvelo para las una o dos acciones que son la razón de abrir el registro. Las demás se leen mejor en el menú, que las agrupa en tres bloques: primero las acciones propias de la colección, en el orden en que las declaró; luego Copiar, Historial e Inspeccionar; y por último Eliminar, al final y separado.

| Propiedad | Por defecto | Efecto |
|-----------|-------------|--------|
| `collapsed` | `true` | `false` convierte la acción en un botón en el registro y en un icono en la fila de la tabla |
| `includeInForm` | `true` | `false` deja la acción fuera del registro y la mantiene en las filas de la colección |
| `showActionsInListView` | `false` | `true` muestra la acción como un icono en cada fila de la vista de lista |
| `isEnabled` | — | Devuelva `false` para mostrar la acción deshabilitada, como botón o como elemento del menú |
| `disabledReason` | — | Explica por qué una acción deshabilitada no está disponible: bajo su nombre en el menú y como tooltip de un botón o icono deshabilitado |

Una acción deshabilitada que no dice por qué parece rota. `disabledReason` recibe las mismas props que `isEnabled`, así que puede nombrar lo que falta:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ entity }) => Boolean(entity?.values.shopify_id),
    disabledReason: () => "Este cliente no tiene cuenta de Shopify",
    onClick: async ({ entity, context }) => { /* … */ }
}
```

En el registro, un botón cuyo `onClick` devuelve una promesa pendiente muestra un indicador de carga y no se puede volver a pulsar hasta que la promesa se resuelva. Si la acción lanza un error o su promesa se rechaza, el usuario ve el error en una notificación. La vista de solo lectura no tiene formulario, por lo que allí `formContext` es undefined.

## Acciones de colección

Para acciones a nivel de barra de herramientas que operan sobre la colección o las entidades seleccionadas:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { useData } from "@rebasepro/app";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path }: CollectionActionsProps) {
    const data = useData();
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix.
        const selected = await resolveSelection({
            selection: selectionController.selection,
            accessor: data.collection(path)
        });
        for (const entity of selected) {
            await data.collection(entity.path).update(entity.id, { status: "published" });
        }
    };

    return (
        <button onClick={handlePublish}>
            Publish {selectionController.selectedCount ?? "all"} selected
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

![Acciones de colección](/img/collection_actions.png)

## Próximos pasos

- **[Columnas adicionales](/docs/frontend/additional-columns)** — Columnas calculadas de la tabla
- **[Campos personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados
