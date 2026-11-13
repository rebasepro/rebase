---
sourceHash: 49c04468f92c50c8
title: Acciones de entidad
sidebar_label: Acciones de entidad
description: Agregue botones de acción personalizados a las entidades para archivar, publicar, exportar, clonar y más.
---

## Descripción general

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las acciones de entidad son botones en un registro: publicar, archivar, clonar o desencadenar un
flujo de trabajo externo. Se declaran por tabla en `customizeTable`, y
`updateRecord` cubre la escritura que realiza la mayoría de ellas.

## Definición de acciones de entidad

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable, updateRecord, resolveSelection } from "@rebasepro/cms";
import type { CollectionActionsProps } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

function PublishSelected({ selectionController, collection, context }: CollectionActionsProps) {
    const publish = async () => {
        // `selection` is the ticked rows, or a query standing for every row
        // that matches: resolveSelection reads them, a page at a time.
        const { ids } = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const id of ids) await updateRecord(context, "products", id, { status: "active" });
        context.snackbarController?.open({ type: "success", message: `${ids.length} published` });
    };
    return <button onClick={publish}>Publish selected</button>;
}

export const productsCms = customizeTable<typeof products>("products", {
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Upload",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "active",
            disabledReason: () => "Already active",
            onClick: ({ id, context }) =>
                updateRecord<typeof products>(context, "products", id,
                    { status: "active", publishedAt: new Date().toISOString() }, "Product published"),
        },
        {
            key: "clone",
            name: "Clone",
            icon: "Copy",
            onClick: async ({ row, context }) => {
                if (!row || !context) return;
                // `row` is the record as the server sends it: copy it, minus its id.
                const { id: _id, ...fields } = row;
                await context.data.products.create({ ...fields, name: `${fields.name} (Copy)` });
            },
        },
    ],
    Actions: [PublishSelected],
});
```

Con la tabla como argumento de tipo, `row` en `onClick`, `isEnabled` y
`disabledReason` es el tipo de fila de la tabla, por lo que `row?.status` se comprueba
frente a los valores de la columna. Una entrada también puede ser una cadena: la `key` de una acción
registrada una vez en `<RebaseCMS entityActions>` (o `<Rebase entityActions>`),
para acciones que comparten varias tablas.

## `updateRecord`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`updateRecord(context, slug, id, patch, message?)` escribe `patch` en un
registro y luego muestra `message` como una notificación de éxito cuando se proporciona.

- Escribe a través de `context.data`, la misma solicitud que realiza el formulario, por lo que
  se aplican los hooks del servidor y la seguridad a nivel de fila (RLS), y se actualiza
  cada vista de la tabla.
- Toma lo que recibe el `onClick` de una acción tal cual. Si falta `context` o
  `id` (una acción en un registro aún no creado), no escribe nada.
- Una escritura rechazada lanza un error, y la acción informa del error al usuario.
- `updateRecord<typeof products>(…)` valida `patch` contra lo que acepta una actualización
  de la tabla. Una fecha se introduce como su cadena ISO, tal como la recibe el servidor.

## Qué recibe una acción

Cada callback de una acción (`onClick`, `isEnabled`, `disabledReason`) recibe el registro sobre el que se ejecuta:

| Prop | Qué es |
|------|------------|
| `row` | El registro tal como el servidor envía la fila, con la estructura que devuelven `useRows` y `context.data`: fechas como cadenas ISO, un belongsTo como su columna de clave foránea (`authorId`). Exactamente las columnas del registro: `row.id` es una columna `id`, donde la tabla tenga una, con el tipo de esa columna. Indefinido mientras no haya un registro guardado. |
| `id` | El ID del registro, tal como lo direcciona el panel de administración: su clave primaria como cadena de texto, o las partes de una clave compuesta unidas por `:::` (`"5"` para una clave entera `5`). |
| `path` | La ruta de la colección en la que se encuentra el registro, incluidos los segmentos de subcolecciones (`authors/7/posts`). |
| `collection`, `context` | La colección y el contexto del panel de administración: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | En el formulario de edición de un registro abierto, el formulario: sus `values` son los del formulario, incluidas las modificaciones sin guardar. Indefinido en la colección y en la vista de solo lectura. |
| `view` | `"collection"` o `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | En la colección, resalta una fila por su ID y quita el resaltado. |
| `selectionController` | En la colección, su selección, por ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (las filas marcadas, o la consulta que representa "todas las coincidentes"). |

## Dónde se muestra una acción

Una acción aparece en el registro, tanto en su formulario de edición como en su vista de solo lectura, y en las filas de la tabla de la colección. Por defecto, permanece en el menú de opciones (⋮) en ambos lugares.

Establezca `collapsed: false` en la acción por la que los usuarios suelen abrir el registro para ejecutarla, y obtendrá un botón propio:

- **En el registro**, se convierte en un botón con etiqueta en la barra, delante de Guardar (o Editar, en la vista de solo lectura). Cuando la barra se queda sin espacio, como en un panel lateral, un diálogo o una ventana estrecha, los botones pierden primero sus etiquetas y conservan el icono, mostrando el nombre en un tooltip. Si aún así resulta demasiado ancho, los últimos declarados se repliegan en el menú, así que declare primero los más importantes.
- **En una fila de la tabla**, se convierte en un icono junto a Editar al pasar el cursor sobre la fila.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Reserve esto para las una o dos acciones que justifican la apertura del registro. El resto se leen mejor en el menú, que las enumera en tres grupos: primero las acciones propias de la colección, en el orden en que las declaró; luego Copiar, Historial e Inspeccionar; y finalmente Eliminar, al final y separada.

| Propiedad | Por defecto | Efecto |
|-----------|-------------|--------|
| `collapsed` | `true` | `false` convierte la acción en un botón en el registro y en un icono en la fila de la tabla |
| `includeInForm` | `true` | `false` excluye la acción del registro y la mantiene en las filas de la colección |
| `showActionsInListView` | `false` | `true` muestra la acción como un icono en cada fila de la vista de lista |
| `isEnabled` | — | Devuelva `false` para mostrar la acción deshabilitada, como botón o como elemento del menú |
| `disabledReason` | — | Indica por qué una acción deshabilitada no está disponible: debajo de su nombre en un menú, y como tooltip de un botón o icono deshabilitado |
| `nameKey` | — | Una clave de traducción para el nombre. El panel de administración muestra su traducción en el idioma actual, y `name` cuando la clave no tenga ninguna. Las acciones integradas la definen, por lo que Editar, Copiar y Eliminar siguen el idioma del administrador |

Una acción deshabilitada que no explica el motivo parece dañada. `disabledReason` recibe las mismas props que `isEnabled`, por lo que puede indicar qué es lo que falta:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

En el registro, un botón cuyo `onClick` devuelve una promesa pendiente muestra un spinner y no se puede presionar de nuevo hasta que la promesa se resuelva. Si la acción lanza una excepción o su promesa se rechaza, el usuario ve el error en una notificación. La vista de solo lectura no tiene formulario, por lo que `formContext` es undefined allí.

## Acciones de colección

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`Actions` ubica componentes personalizados en la barra de herramientas de la colección, para operar
sobre toda la colección o sobre las filas seleccionadas: como `PublishSelected` arriba. Es una
lista, por lo que se pueden componer varios.

Una acción recibe `CollectionActionsProps`. Cada una maneja las filas tal como las
envía el servidor, con la estructura que devuelve `useRows`:

| Prop | Qué es |
|------|------------|
| `selectionController` | La selección de la vista. `selection` es `{ type: "rows", ids, rows }` para filas marcadas, o `{ type: "query", query, excludedIds, count }` para "todas las coincidentes"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La consulta en vivo de la vista: `rows`, `loading`, `error`, y el filtrado, búsqueda y ordenamiento compartidos por la barra de herramientas (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | La ubicación de la colección, su configuración y el contexto del panel de administración. |
| `openNewDocument(defaults?)` | Abre el formulario de nuevo registro, prellenado. |

Para mantener algunas filas seleccionadas después de actuar sobre el resto, pase las que desea conservar a
`setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Acciones de colección](/img/collection_actions.png)

## Próximos pasos

- **[customizeTable](/docs/frontend/customize-table)** — Todas las opciones de tabla
- **[Columnas adicionales](/docs/frontend/additional-columns)** — Columnas calculadas de la tabla
- **[Campos personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados
