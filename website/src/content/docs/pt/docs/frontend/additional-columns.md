---
sourceHash: 6af581ed5e4c92e6
title: Colunas Adicionais
sidebar_label: Colunas Adicionais
description: Adicione colunas computadas/virtuais a tabelas de coleções que derivam valores de dados da entidade.
---

## Visão Geral

As colunas adicionais permitem exibir dados computados ou derivados na tabela da coleção sem armazená-los no banco de dados.

## Definindo Colunas Adicionais

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

## Props do Builder

| Prop | Tipo | Descrição |
|------|------|-----------|
| `row` | `Record<string, unknown>` | O registro conforme o servidor envia a linha: datas como strings ISO, um belongsTo como sua coluna de chave estrangeira, `id` incluído |
| `context` | `RebaseContext` | Contexto completo do Rebase |

`value({ row, context })` recebe as mesmas props.

## Próximos Passos

- **[Entity Actions](/docs/frontend/entity-actions)** — Botões de ação personalizados
- **[Custom Fields](/docs/frontend/custom-fields)** — Campos de formulário personalizados
