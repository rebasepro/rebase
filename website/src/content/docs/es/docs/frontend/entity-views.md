---
sourceHash: faf8f760aabce923
title: Entity Views
sidebar_label: Entity Views
description: Añade pestañas y vistas personalizadas a las páginas de detalles de entidades para previsualizaciones, analíticas, datos relacionados o interfaces de usuario personalizadas.
---

## Información general

Las vistas de entidad te permiten añadir **pestañas** personalizadas a la página de detalles de la entidad junto al formulario predeterminado. Utilízalas para:

- **Previsualizaciones** en vivo (vista previa del sitio web, contenido renderizado)
- Vistas de **datos relacionados** (artículos de un pedido, entidades secundarias)
- **Analíticas** o gráficos
- **Editores personalizados** (texto enriquecido, editores de mapas)

## Añadir vistas de entidad

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ArticlePreview } from "../../../../../components/ArticlePreview";

export const productsCms = customizeTable<typeof products>("products", {
    entityViews: [
        { key: "preview", name: "Preview", Builder: ArticlePreview, position: "start" },
        "related",   // registered once on <RebaseCMS entityViews>
    ],
});
```

Una entrada es una vista, o la `key` de una registrada una sola vez en
`<RebaseCMS entityViews>` (o `<Rebase entityViews>`), para pestañas que varias
tablas comparten. Una vista registrada solo se muestra en las tablas que nombran su clave.
`position: "start"` coloca la pestaña antes de la del formulario; de lo contrario, se coloca después.

## Construir una vista de entidad

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`Builder` es el componente en sí, importado por valor:

```tsx
// frontend/src/components/ArticlePreview.tsx
import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

export function ArticlePreview({ row, modifiedValues }: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values; row is the saved
    // record. Both are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? row?.title ?? "");
    const content = String(modifiedValues?.content ?? row?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Prop | Tipo | Descripción |
|------|------|-------------|
| `row` | `Record<string, unknown>` | El registro guardado tal como el servidor envía la fila: fechas como cadenas ISO, un belongsTo como su columna de clave foránea, `id` solo donde la tabla tenga esa columna. Ausente mientras se está creando uno nuevo |
| `id` | `string` | El id del registro guardado, además de `row`: su clave primaria como una cadena, las partes de una compuesta unidas por `:::`. Lo que reciben `useSidePanel().open` y `useRowWrites().update`. Ausente mientras se está creando uno nuevo |
| `modifiedValues` | `EntityValues` | Valores actuales del formulario, incluidas las modificaciones no guardadas (en vivo a medida que el usuario escribe), tipados para el editor: una fecha es un `Date` |
| `formContext` | `FormContext` | Contexto completo del formulario |
| `collection` | `AdminCollection` | La colección tal como la resolvió el CMS |

![Entity view with secondary form](/img/entity_view_secondary_form.png)

Las relaciones uno a muchos (to-many) de una tabla también son pestañas del registro, sin necesidad de nada de esto;
consulta [Relaciones en el panel](/docs/collections/relations-in-the-admin-panel/).
`defaultSelectedView` en `customizeTable` establece la pestaña en la que se abre un registro.

## Siguientes pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Acciones de entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados
