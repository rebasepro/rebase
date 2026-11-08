---
sourceHash: 81a0981c41ccc947
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
                onClick: async ({ id, path, context }) => {
                    if (id === undefined || !path || !context) return;
                    await context.data.collection<Record<string, unknown>>(path)
                            .update(id, { status: "published", publishedAt: new Date().toISOString() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ row, path, context }) => {
                    if (!row || !path || !context) return;
                    // `row` is the record as the server sends it, the shape
                    // `context.data` writes: copy it, minus its id.
                    const { id, ...fields } = row;
                    await context.data.collection<Record<string, unknown>>(path)
                            .create({ ...fields, name: `${String(fields.name)} (Copy)` });
                }
            }
        ]
    }
});

```

## Qué recibe una acción

Cada callback de una acción (`onClick`, `isEnabled`, `disabledReason`) recibe el registro sobre el que se ejecuta:

| Prop | Qué es |
|------|--------|
| `row` | El registro tal como el servidor envía la fila, la forma que devuelven `useRows` y `context.data`: fechas como cadenas ISO, un belongsTo como su columna de clave foránea (`authorId`), `id` incluido. Indefinido mientras no haya un registro guardado. |
| `id` | El id del registro. |
| `path` | La ruta de la colección en la que se encuentra el registro, incluidos los segmentos de subcolecciones (`authors/7/posts`). |
| `collection`, `context` | La colección y el contexto del panel de administración: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | En el formulario de edición de un registro abierto, el formulario: sus `values` son los del formulario, incluidas las modificaciones no guardadas. Indefinido en la colección y en la vista de solo lectura. |
| `view` | `"collection"` o `"form"`. |
| `highlightEntity(id)`, `unhighlightEntity(id)` | En la colección, resalta una fila por su id y quita el resaltado. |
| `selectionController` | En la colección, su selección, por id: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (las filas marcadas, o la consulta que representa "todos los coincidentes"). |

## Dónde se muestra una acción

Una acción aparece en el registro, tanto en su formulario de edición como en su vista de solo lectura, y en las filas de la tabla de la colección. De forma predeterminada, espera en el menú desplegable (⋮) en ambos lugares.

Establece `collapsed: false` en la acción que los usuarios abren el registro para ejecutar, y obtendrá un botón propio:

- **En el registro**, se convierte en un botón con etiqueta en la barra, antes de Guardar (o Editar, en la vista de solo lectura). Cuando la barra se queda sin espacio, como en un panel lateral, un diálogo o una ventana estrecha, los botones pierden primero sus etiquetas y conservan el icono, con el nombre en un tooltip. Si aún así resulta demasiado ancho, los últimos declarados se repliegan de nuevo en el menú, así que declara los más importantes primero.
- **En una fila de la tabla**, se convierte en un icono junto a Editar mientras se pasa el cursor sobre la fila.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Reserva esto para una o dos acciones que sean el motivo principal por el que el registro está abierto. El resto se lee mejor en el menú, que las enumera en tres grupos: primero las acciones propias de la colección, en el orden en que las declaraste; luego Copiar, Historial e Inspeccionar; y por último Eliminar, separada al final.

| Propiedad | Predeterminado | Efecto |
|-----------|----------------|--------|
| `collapsed` | `true` | `false` convierte la acción en un botón en el registro y en un icono en la fila de la tabla |
| `includeInForm` | `true` | `false` mantiene la acción fuera del registro y la deja en las filas de la colección |
| `showActionsInListView` | `false` | `true` muestra la acción como un icono en cada fila de la vista de lista |
| `isEnabled` | — | Devuelve `false` para mostrar la acción deshabilitada, como botón o elemento de menú |
| `disabledReason` | — | Explica por qué una acción deshabilitada no está disponible: bajo su nombre en un menú, y como tooltip de un botón o icono deshabilitado |
| `nameKey` | — | Una clave de traducción para el nombre. El panel de administración muestra su traducción en el idioma actual, y `name` si la clave no tiene ninguna. Las acciones integradas la configuran, por lo que Editar, Copiar y Eliminar siguen el idioma del panel |

Una acción deshabilitada que no explica el motivo parece rota. `disabledReason` recibe las mismas props que `isEnabled`, por lo que puede indicar qué falta:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

En el registro, un botón cuyo `onClick` devuelve una promesa pendiente muestra un spinner y no se puede volver a presionar hasta que la promesa se resuelva. Si la acción lanza un error o su promesa es rechazada, el usuario ve el error en una notificación. La vista de solo lectura no tiene formulario, por lo que `formContext` es undefined allí.

## Acciones de colección

Para acciones a nivel de barra de herramientas que operan sobre la colección o sobre las entidades seleccionadas:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path, collection, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix.
        const rows = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const row of rows) {
            await context.data.collection(path).update(String(row.id), { status: "published" });
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

A una acción se le pasa `CollectionActionsProps`. Cada una maneja las filas tal como las envía el servidor, la forma que devuelve `useRows`:

| Prop | Qué es |
|------|--------|
| `selectionController` | La selección de la vista. `selection` es `{ type: "rows", ids, rows }` para las filas marcadas, o `{ type: "query", query, excludedIds, count }` para "todos los coincidentes"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La consulta en vivo de la vista: `rows`, `loading`, `error`, y el filtro, búsqueda y ordenación que comparte la barra de herramientas (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Dónde está la colección, su configuración y el contexto del panel de administración. |
| `openNewDocument(defaults?)` | Abre el formulario de nuevo registro, precargado. |

Para mantener algunas filas seleccionadas después de actuar sobre el resto, pasa las que deseas conservar a `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter(row => failed.has(row.id)));
}
```

![Acciones de colección](/img/collection_actions.png)

## Próximos pasos

- **[Columnas adicionales](/docs/frontend/additional-columns)** — Columnas de tabla calculadas
- **[Campos personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados
