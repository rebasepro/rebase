---
sourceHash: 395db046e3ecafc8
title: Colunas Adicionais
sidebar_label: Colunas Adicionais
description: Adicione colunas computadas/virtuais a tabelas de coleções que derivam valores de dados da entidade.
---

## Visão Geral

As colunas adicionais permitem exibir dados computados ou derivados na tabela da coleção sem armazená-los no banco de dados.

## Definindo Colunas Adicionais

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

| Chave | O que faz |
|---|---|
| `key` | Identifica a coluna. Declare-a em `fieldOrder` ou `listFields` como `"total" as AdditionalFieldKey`. |
| `name` | O cabeçalho. |
| `width` | A largura, em pixels. |
| `Builder` | Renderiza a célula. |
| `dependencies` | Os campos cuja alteração renderiza a célula novamente; verificado em relação à tabela. |
| `value` | O valor da célula, para exportação. |

## Props do Builder

| Prop | Tipo | Descrição |
|------|------|-------------|
| `row` | `Record<string, unknown>` | O registro conforme o servidor envia a linha: datas como strings ISO, um belongsTo como sua coluna de chave estrangeira, `id` apenas onde a tabela possui essa coluna. Uma relação carregada pelo admin é aninhada sob seu nome como as próprias colunas do registro relacionado |
| `id` | `string` | O id do registro: sua chave primária como uma string, as partes de uma chave composta unidas por `:::`. O id que `useSidePanel().open` e uma rota recebem |
| `context` | `RebaseContext` | Contexto completo do Rebase |

`value({ row, id, context })` recebe as mesmas props.

## Próximos Passos

- **[Ações de Entidade](/docs/frontend/entity-actions)** — Botões de ação personalizados
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados
