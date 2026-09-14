---
sourceHash: 3830846c0457a79f
title: Layout do Formulário
sidebar_label: Layout do Formulário
description: Controle como o formulário da entidade é organizado — larguras de colunas, seções e a barra lateral de metadados.
---

## Visão Geral

O formulário da entidade é gerado a partir de suas propriedades. Por padrão, ele deriva um layout de duas colunas a partir dos tipos de propriedade, de modo que uma coleção que não especifica nada sobre o layout ainda receba um formulário com visual estruturado, em vez de uma longa sequência de campos de largura total:

- o id e os timestamps `createdAt` / `updatedAt` vão para uma barra lateral de metadados, somente leitura
- enums curtos, booleanos, datas e números ocupam uma largura estreita
- textos longos, markdown, arrays, mapas e campos de armazenamento ocupam a largura total
- todo o restante ocupa a metade

Use `admin.form` quando o layout derivado não for adequado para o seu domínio.

## Largura do campo

A largura de um campo é um **span** em uma grade de quatro colunas. `4` representa a largura total da coluna principal.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        sku: {
            name: "SKU",
            type: "string",
            admin: { span: 1 }
        },
        name: {
            name: "Product name",
            type: "string",
            admin: { span: 3 }
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true, span: 4 }
        }
    }
});
```

Os spans se alinham a uma grade compartilhada, o que garante que dois campos fiquem alinhados independentemente da ordem em que foram declarados. Eles substituíram o `admin.widthPercentage`, cujas porcentagens brutas não se alinhavam com precisão; uma coleção que ainda o utilize deve escolher o span mais próximo (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, caso contrário `4`).

Em layouts estreitos demais para duas colunas — o painel lateral, a visualização dividida (split pane), um celular — a grade se ajusta para uma única coluna e os spans são ignorados.

## Seções

`sections` agrupa a coluna principal sob cabeçalhos. Uma seção com título pode ser recolhida; uma seção sem título, não.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    name: "Orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        placed_at: { name: "Placed at", type: "date" },
        address: { name: "Address", type: "string" },
        carrier: { name: "Carrier", type: "string" },
        tracking_number: { name: "Tracking number", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            sections: [
                { key: "identity", properties: ["reference", "placed_at"] },
                {
                    key: "shipping",
                    title: "Shipping",
                    properties: ["address", "carrier", "tracking_number"]
                },
                {
                    key: "internal",
                    title: "Internal notes",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        }
    }
});
```

Uma propriedade não atribuída a nenhuma seção nunca é descartada: ela é alocada na última seção sem título ou em um grupo final sem título caso não haja nenhum. Portanto, adicionar uma coluna ao banco de dados não fará com que um campo desapareça silenciosamente do formulário.

Um erro de validação dentro de uma seção recolhida faz com que ela seja expandida automaticamente, impedindo que um erro fique oculto sob um cabeçalho fechado.

## A barra lateral de metadados

`sidebar` move campos para fora da coluna principal e os posiciona em uma barra lateral estreita ao lado dela — status, propriedade, datas de publicação, flags.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "publishedAt", "author"],
            showRecordMeta: true
        }
    }
});
```

A barra lateral não utiliza a grade, portanto o `span` é ignorado para os campos dentro dela. Onde não houver espaço para a barra lateral, ela é renderizada como uma seção inicial comum, garantindo que nada seja perdido em telas de celular ou no painel lateral.

`showRecordMeta` exibe o bloco de registros somente leitura — id, criado, atualizado — no rodapé da barra lateral. Seu valor padrão é `true` sempre que uma barra lateral for exibida, substituindo `hideIdFromForm` na maioria das coleções: o id deixa de ser um campo no meio do formulário e passa a ser uma linha copiável de metadados.

Defina `sidebar: []` para suprimir totalmente a barra lateral derivada e manter todos os campos na coluna principal.

## Referência

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Largura do campo na grade de formulário de quatro colunas |
| `admin.form.sidebar` | `string[]` | Chaves de propriedade exibidas na barra lateral de metadados |
| `admin.form.sections` | `FormSection[]` | Grupos com título para a coluna principal |
| `admin.form.showRecordMeta` | `boolean` | Exibe id/criado/atualizado no rodapé da barra lateral |

`FormSection` é `{ key, title?, properties, collapsed?, collapsible? }`.

## Relacionado

- [Campos Personalizados](/docs/frontend/custom-fields/) — o campo que um layout está organizando
- [Visualizações de Entidade](/docs/frontend/entity-views/) — uma aba inteira própria ao lado do formulário
- [Propriedades](/docs/collections/properties/) — as opções de propriedade lidas por um layout
