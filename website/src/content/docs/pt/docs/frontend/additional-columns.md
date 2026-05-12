---
title: Colunas Adicionais
sidebar_label: Colunas Adicionais
slug: pt/docs/frontend/additional-columns
description: Adicione colunas computadas/virtuais a tabelas de coleção que derivam valores dos dados da entidade.
---

## Visão Geral

As colunas adicionais permitem exibir dados computados ou derivados na tabela de coleção sem armazená-los no banco de dados.

## Definindo Colunas Adicionais

```typescript
const ordersCollection: EntityCollection = {
    slug: "orders",
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
    ],
    properties: { /* ... */ }
};
```

## Propriedades do Builder

| Prop | Tipo | Descrição |
|------|------|-------------|
| `entity` | `Entity` | A entidade para esta linha |
| `context` | `RebaseContext` | Contexto completo do Rebase |

## Próximos Passos

- **[Ações da Entidade](/docs/frontend/entity-actions)** — Botões de ação personalizados
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados

---
