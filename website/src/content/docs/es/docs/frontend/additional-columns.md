---
sourceHash: 3c089e6c404f4635
title: Columnas adicionales
sidebar_label: Columnas adicionales
description: Añade columnas calculadas/virtuales a las tablas de colección que derivan valores a partir de los datos de la entidad.
---

## Descripción general

Las columnas adicionales permiten mostrar datos calculados o derivados en la tabla de la colección sin almacenarlos en la base de datos.

Una columna calculada pertenece a la tabla. El registro ya muestra los valores a partir de los cuales se calcula, por lo que no está en el registro a menos que el formulario lo solicite: especifique su `key` en `form.sections` o `form.sidebar` (consulte [Form layout](/docs/frontend/form-layout/)), o en los `fields` proporcionados a un `RecordForm` o `RecordDetail`.

## Definición de columnas adicionales

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
| `row` | `Record<string, unknown>` | El registro tal como el servidor envía la fila: fechas como cadenas ISO, un belongsTo como su columna de clave foránea, `id` solo donde la tabla tiene esa columna. Una relación cargada por el admin se anida bajo su nombre como las columnas propias del registro relacionado |
| `id` | `string` | El id del registro: su clave primaria como una cadena, las partes de una clave compuesta unidas por `:::`. El id que toman `useSidePanel().open` y una ruta |
| `context` | `RebaseContext` | Contexto completo de Rebase |

`value({ row, id, context })` recibe las mismas props.

## Siguientes pasos

- **[Entity Actions](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Custom Fields](/docs/frontend/custom-fields)** — Campos de formulario personalizados
