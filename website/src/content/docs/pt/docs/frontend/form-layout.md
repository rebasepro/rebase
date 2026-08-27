---
title: Layout do Formulário
sidebar_label: Layout do Formulário
description: Controle como o formulário da entidade é organizado — larguras de colunas, seções e o painel lateral de metadados.
---

## Visão geral

O formulário da entidade é gerado a partir das suas propriedades. Por padrão, ele deriva um layout de duas colunas a partir dos tipos de propriedade, para que uma coleção que não especifique nada sobre layout ainda obtenha um formulário legível e organizado, em vez de uma longa sequência de campos com largura total:

- o id e os carimbos de data/hora `createdAt` / `updatedAt` vão para um painel lateral de metadados, em modo somente leitura
- enums curtos, booleanos, datas e números ocupam uma largura estreita
- texto longo, markdown, arrays, maps e campos de armazenamento ocupam a largura total
- todo o resto ocupa a metade

Use `admin.form` quando a resposta derivada não for adequada para o seu domínio.

## Largura do campo

A largura de um campo é um **span** (extensão) em uma grade de quatro colunas. `4` é a largura total da coluna principal.

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

Os spans se ajustam a uma grade compartilhada, o que faz com que dois campos se alinhem independentemente da ordem em que foram declarados. Eles substituíram o `admin.widthPercentage`, cujas porcentagens brutas não conseguiam se alinhar com nada; uma coleção que ainda utilize essa propriedade deve escolher o span mais próximo (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, caso contrário `4`).

Em layouts muito estreitos para duas colunas — o painel lateral, o painel dividido, um celular —, a grade é recolhida para uma única coluna e os spans são ignorados.

## Seções

`sections` agrupa a coluna principal sob títulos. Uma seção com título pode ser recolhida; uma sem título não pode.

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

Uma propriedade não nomeada em nenhuma seção nunca é descartada: ela vai para a última seção sem título ou para um grupo final sem título se não houver nenhuma. Portanto, adicionar uma coluna ao banco de dados não fará com que um campo desapareça silenciosamente do formulário.

Um erro de validação dentro de uma seção recolhida a expande, para que um erro nunca fique escondido atrás de um título fechado.

## O painel lateral de metadados

`sidebar` move os campos para fora da coluna principal e os coloca em um painel lateral estreito ao lado dela — status, propriedade, datas de publicação, sinalizadores.

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

O painel lateral não usa a grade, portanto o `span` é ignorado para os campos contidos nele. Onde não há espaço para um painel lateral, ele é renderizado como uma seção inicial comum, para que nada seja perdido em um celular ou no painel lateral.

`showRecordMeta` coloca o bloco do registro em modo somente leitura — id, criado em, atualizado em — no rodapé do painel lateral. O valor padrão é `true` sempre que um painel lateral é exibido, substituindo o `hideIdFromForm` na maioria das coleções: o id deixa de ser um campo no meio do formulário e se torna uma linha de metadados copiável.

Defina `sidebar: []` para suprimir totalmente o painel lateral derivado e manter todos os campos na coluna principal.

## Referência

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Largura do campo na grade de quatro colunas do formulário |
| `admin.form.sidebar` | `string[]` | Chaves de propriedades exibidas no painel lateral de metadados |
| `admin.form.sections` | `FormSection[]` | Grupos com título para a coluna principal |
| `admin.form.showRecordMeta` | `boolean` | Exibe id/criado/atualizado no rodapé do painel lateral |

`FormSection` é `{ key, title?, properties, collapsed?, collapsible? }`.
