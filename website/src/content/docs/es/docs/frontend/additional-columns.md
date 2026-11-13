---
sourceHash: 395db046e3ecafc8
title: Columnas adicionales
sidebar_label: Columnas adicionales
description: Agregue columnas calculadas/virtuales a las tablas de colecciones que derivan valores de los datos de la entidad.
---

## Descripción general

Las columnas adicionales le permiten mostrar datos calculados o derivados en la tabla de la colección sin almacenarlos en la base de datos.

## Definición de columnas adicionales

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { AdditionalFieldKey } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    additionalFields: [
        {
            key: "total",
            name: "Total",
            Builder: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                const total = items.reduce(
                    (sum: number, item: { price?: number; quantity?: number }) =>
                        sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                );
                return <span>{total.toFixed(2)}</span>;
            },
            dependencies: ["items"],
            value: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                return items.length;
            }
        }
    ],
    fieldOrder: ["name", "total" as AdditionalFieldKey, "status"],
});
```

| Clave | Qué hace |
|---|---|
| `key` | Identifica la columna. Nómbrela en `fieldOrder` o `listFields` como `"total" as AdditionalFieldKey`. |
| `name` | El encabezado. |
| `width` | El ancho, en píxeles. |
| `Builder` | Renderiza la celda. |
| `dependencies` | Los campos cuyo cambio vuelve a renderizar la celda; se verifican contra la tabla. |
| `value` | El valor de la celda, para exportación. |

## Props de Builder

| Prop | Tipo | Descripción |
|------|------|-------------|
| `row` | `Record<string, unknown>` | El registro tal como el servidor envía la fila: fechas como cadenas ISO, un belongsTo como su columna de clave foránea, `id` solo donde la tabla tenga esa columna. Una relación que el admin cargó se anida bajo su nombre como las propias columnas del registro relacionado |
| `id` | `string` | El id del registro: su clave primaria como cadena, las partes de una clave compuesta unidas por `:::`. El id que aceptan `useSidePanel().open` y una ruta |
| `context` | `RebaseContext` | Contexto completo de Rebase |

`value({ row, id, context })` recibe las mismas props.

## Próximos pasos

- **[Acciones de entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Campos personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados
