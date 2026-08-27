---
title: Columnas Adicionales
sidebar_label: Columnas Adicionales
description: Añade columnas calculadas/virtuales a las tablas de colecciones que derivan valores de los datos de la entidad.
---

## Resumen

Las columnas adicionales le permiten mostrar datos calculados o derivados en la tabla de colección sin almacenarlos en la base de datos.

## Definiendo Columnas Adicionales

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
                Builder: ({ entity }) => {
                    const total = entity.values.items?.reduce(
                        (sum, item) => sum + (item.price * item.quantity), 0
                    ) ?? 0;
                    return <span>${total.toFixed(2)}</span>;
                }
            },
            {
                key: "status_badge",
                name: "Status",
                Builder: ({ entity }) => {
                    const color = entity.values.status === "completed" ? "green" : "orange";
                    return (
                        <span style={{ color }}>
                            {entity.values.status}
                        </span>
                    );
                },
                dependencies: ["status"]  // Re-render when these fields change
            }
        ]
    }
});

```

## Props del Constructor

| Propiedad | Tipo | Descripción |
|------|------|-------------|
| `entity` | `Entity` | La entidad para esta fila |
| `context` | `RebaseContext` | Contexto completo de Rebase |

## Próximos Pasos

- **[Acciones de Entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulario personalizados

---
