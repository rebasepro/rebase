---
sourceHash: fef2eb56c7043526
title: Layout do Formulário
sidebar_label: Layout do Formulário
description: Controle como o formulário da entidade é organizado — larguras de colunas, seções e a barra lateral de metadados.
---

## Visão geral

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

O formulário da entidade é gerado a partir das suas propriedades:

- o id e os timestamps `createdAt` / `updatedAt` vão para uma barra lateral de metadados, como somente leitura
- todos os outros campos ocupam a largura total da coluna principal, exceto quando dois
  campos vizinhos com o mesmo editor pequeno — dois números, dois interruptores,
  duas datas do mesmo modo, duas seleções com opções curtas — compartilham uma linha

Um campo com um rótulo longo, texto de ajuda com mais de 60 caracteres, `conditions` ou um
`Field` customizado nunca é pareado, assim como nenhum texto livre: nada em
um schema diferencia o nome curto de uma branch de uma URL longa. O formulário nunca analisa
qual propriedade é o título. Quaisquer outras colunas são algo que a collection solicita,
campo por campo, com `admin.span` — definido com base no que cada campo contém, conforme
abaixo. Use `admin.form` para
agrupar campos em seções e movê-los para a barra lateral.

## Largura do campo

A largura de um campo é um **span** em uma grade de quatro colunas. `4` é a largura total
da coluna principal.

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

Os spans se ajustam a uma grade compartilhada, o que faz com que dois campos se alinhem
independentemente da ordem em que foram declarados. Eles substituíram `admin.widthPercentage`,
cujas porcentagens brutas não conseguiam se alinhar com nada; uma collection que ainda
carregue essa propriedade deve escolher o span mais próximo (≤30 → `1`, ≤55 → `2`, ≤80 → `3`,
caso contrário `4`).

Escolha um span com base no conteúdo do campo, não no seu tipo. Dois valores curtos
que pertencem um ao outro compartilham uma linha — data de início e término, cidade e país,
provedor e região com `2` cada, ou um valor e seu qualificador em `3` + `1`.
Números, booleanos e códigos curtos podem usar `1` ao lado de seus irmãos. Qualquer item
de leitura longa — nomes, URLs, e-mails, IDs, descrições, markdown, arquivos —
mantém `4`. As linhas são preenchidas na ordem de declaração e nada alarga um campo para preencher
um espaço vazio, portanto, declare os pares lado a lado e faça com que cada linha totalize 4.

Em layouts estreitos demais para duas colunas — o painel lateral, o painel dividido, um celular
— a grade se reduz a uma única coluna e os spans são ignorados.

## Seções

`sections` agrupa a coluna principal sob títulos. Uma seção com título pode ser
recolhida; uma sem título, não.

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

Uma propriedade não mencionada em nenhuma seção nunca é descartada: ela vai para a última
seção sem título, ou para um grupo final sem título se não houver nenhuma. Adicionar uma coluna
ao banco de dados, portanto, não fará com que um campo desapareça silenciosamente do formulário.

Um erro de validação dentro de uma seção recolhida faz com que ela se expanda, de modo que um erro
nunca fique oculto atrás de um cabeçalho fechado.

## A barra lateral de metadados

`sidebar` move campos para fora da coluna principal e os coloca em uma barra estreita ao lado —
status, autoria, datas de publicação, sinalizadores.

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

A barra lateral não usa a grade, portanto o `span` é ignorado para os campos nela contidos. Onde
não há espaço para uma barra lateral, ela é renderizada como uma seção inicial comum, de modo que
nada é perdido em um celular ou no painel lateral.

`showRecordMeta` coloca o bloco de registro somente leitura — id, criado, atualizado — no
rodapé da barra lateral. O valor padrão é `true` sempre que uma barra lateral for exibida, e é o
que substitui `hideIdFromForm` na maioria das collections: o id deixa de ser um campo no
meio do formulário e se torna uma linha de metadados copiável.

Defina `sidebar: []` para suprimir totalmente a barra lateral derivada e manter todos os campos
na coluna principal.

## Referência

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Largura do campo na grade de quatro colunas do formulário |
| `admin.form.sidebar` | `string[]` | Chaves de propriedades exibidas na barra lateral de metadados |
| `admin.form.sections` | `FormSection[]` | Grupos com título para a coluna principal |
| `admin.form.showRecordMeta` | `boolean` | Exibir id/criado/atualizado no rodapé da barra lateral |

`FormSection` é `{ key, title?, properties, collapsed?, collapsible? }`.

## Relacionados

- [Custom Fields](/docs/frontend/custom-fields/) — o campo que o layout está organizando
- [Entity Views](/docs/frontend/entity-views/) — uma aba inteiramente sua ao lado do formulário
- [Properties](/docs/collections/properties/) — as opções de propriedade lidas por um layout
