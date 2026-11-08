---
sourceHash: 6af581ed5e4c92e6
title: Columnas adicionales
sidebar_label: Columnas adicionales
description: Agrega columnas calculadas/virtuales a las tablas de colección que derivan valores a partir de los datos de la entidad.
---

## Descripción general

Las columnas adicionales permiten mostrar datos calculados o derivados en la tabla de colección sin almacenarlos en la base de datos.

## Definición de columnas adicionales

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        items: {
            name: "Items",
            type: "array",
            of: {
                name: "Item",
                type: "map",
                properties: {
                    price: { name: "Price", type: "number" },
                    quantity: { name: "Quantity", type: "number" }
                }
            }
        },
        status: { name: "Status", type: "string" }
    },
    admin: {
        additionalFields: [
            {
                key: "total_display",
                name: "Total",
                Builder: ({ row }) => {
                    const items = Array.isArray(row.items) ? row.items : [];
                    const total = items.reduce(
                        (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                    );
                    return <span>${total.toFixed(2)}</span>;
                }
            },
            {
                key: "status_badge",
                name: "Status",
                Builder: ({ row }) => {
                    const color = row.status === "completed" ? "green" : "orange";
                    return (
                        <span style={{ color }}>
                            {String(row.status ?? "")}
                        </span>
                    );
                },
                dependencies: ["status"]  // Re-render when these fields change
            }
        ]
    }
});

```

## Props de Builder

| Prop | Tipo | Descripción |
|------|------|-------------|
| `row` | `Record<string, unknown>` | El registro tal como el servidor envía la fila: fechas como cadenas ISO, un belongsTo como su columna de clave foránea, `id` incluido |
| `context` | `RebaseContext` | Contexto completo de Rebase |

`value({ row, context })` recibe las mismas props.

## Próximos pasos

- **[Acciones de entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Campos personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados
