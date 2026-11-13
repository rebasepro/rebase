---
sourceHash: 93694433369991ae
title: Layout do Formulário
sidebar_label: Layout do Formulário
description: "Organize o formulário de um registro: larguras de campos em uma grade de quatro colunas, seções com título e recolhíveis, a barra lateral de metadados e um componente que substitui o formulário gerado."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O formulário do registro é gerado a partir das colunas e relações da tabela:

- o id e os carimbos de criação e atualização vão para uma barra lateral de metadados somente leitura;
- todos os outros campos ocupam a largura total da coluna principal, exceto quando dois campos vizinhos com o mesmo editor pequeno (dois números, dois switches, duas datas do mesmo modo, dois selects com opções curtas) compartilham uma linha.

Um campo com rótulo longo, texto de ajuda com mais de 60 caracteres, `conditions`, uma [regra de acesso](/docs/collections/field-access/) a nível de coluna ou um `Field` personalizado nunca é pareado, e tampouco qualquer texto livre: nada em um esquema distingue um nome curto de branch de uma URL longa. Qualquer outra coisa é configurada no `customizeTable`, campo a campo com `span`, e para todo o formulário com `form`.

```ts
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        reference:      col.text().notNull(),
        sku:            col.text(),
        status:         col.enum(["placed", "shipped", "delivered"]).notNull().default("placed"),
        placedAt:       col.timestamp({ withTimezone: true }),
        address:        col.text(),
        carrier:        col.text(),
        trackingNumber: col.text(),
        notes:          col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/orders.tsx
import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    form: {
        sidebar: ["status", "placedAt"],
        sections: [
            { key: "identity", fields: ["reference", "sku"] },
            { key: "shipping", title: "Shipping", fields: ["address", "carrier", "trackingNumber"] },
            { key: "internal", title: "Internal notes", fields: ["notes"], collapsed: true },
        ],
    },
    fields: {
        reference: { span: 3 },
        sku:       { name: "SKU", span: 1 },
        carrier:   { span: 2 },
        trackingNumber: { span: 2 },
        notes:     { multiline: true },
    },
});
```

## Largura do campo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A largura de um campo é um **span** em uma grade de quatro colunas; `4` representa a largura total da coluna principal. Os spans se ajustam à grade, o que faz com que dois campos se alinhem independentemente da ordem em que foram declarados.

Escolha um span com base no conteúdo do campo, e não no seu tipo. Dois valores curtos que pertencem um ao outro compartilham uma linha: data de início e término, cidade e país, transportadora e código de rastreamento com `2` cada, ou um valor e seu qualificador em `3` + `1`. Números, booleanos e códigos curtos podem usar `1` ao lado de seus equivalentes. Tudo o que for longo para ler (nomes, URLs, e-mails, IDs, descrições, markdown, arquivos) mantém `4`. As linhas são preenchidas na ordem dos campos e nada expande um campo para fechar um espaço vazio, portanto, coloque os pares lado a lado e faça com que cada linha totalize 4.

Em layouts estreitos demais para duas colunas (o painel lateral, o painel dividido, um celular), a grade é reduzida a uma coluna e os spans são ignorados.

## Seções

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `form.sections` agrupa a coluna principal sob títulos. Cada seção é `{ key, title?, fields, collapsed?, collapsible?, readVariant? }`. Uma seção com título pode ser recolhida; uma sem título não pode. `readVariant: "summary"` empilha os campos da seção como linhas de rótulo e valor na visualização somente leitura do registro; o padrão, `"grid"`, usa a grade do formulário.

Um campo não especificado em nenhuma seção nunca é descartado: ele vai para a última seção sem título, ou para um grupo final sem título se não houver nenhuma. Uma coluna adicionada à tabela não fará com que um campo desapareça silenciosamente do formulário. Um erro de validação dentro de uma seção recolhida faz com que ela seja expandida.

Cada entrada é verificada em relação à tabela. Uma entrada que o servidor não fornece a este chamador, por não ter permissão de leitura dessa coluna, é ignorada.

## A barra lateral de metadados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`form.sidebar` move campos para fora da coluna principal para uma barra lateral estreita ao lado dela: status, propriedade, datas de publicação, flags. A barra lateral não usa a grade, portanto o `span` é ignorado nela. Onde não houver espaço para uma barra lateral, ela é renderizada como uma seção inicial comum.

`form.showRecordMeta` coloca o bloco somente leitura do registro (id, criado em, atualizado em) no rodapé da barra lateral. É `true` sempre que uma barra lateral é exibida. `sidebar: []` desativa a barra lateral derivada e mantém todos os campos na coluna principal. `hideIdFromForm` oculta completamente o id do formulário.

## Substituindo o formulário

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`formView` substitui o formulário gerado por um componente próprio, importado por valor. Ele recebe os mesmos `EntityCustomViewParams` que uma [visualização de entidade](/docs/frontend/entity-views/) recebe. `includeActions: true` mantém os botões Salvar e Descartar na barra do registro enquanto ele estiver na tela.

```tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { orders } from "../../../backend/schema/orders";

function OrderForm({ row, modifiedValues }: EntityCustomViewParams) {
    return <h2>{String(modifiedValues?.reference ?? row?.reference ?? "New order")}</h2>;
}

export const ordersCms = customizeTable<typeof orders>("orders", {
    formView: { Builder: OrderForm, includeActions: true },
});
```

Para uma alteração menor, sobrescreva apenas uma parte do formulário (`Entity.Form`, veja [Substituição de componentes](/docs/frontend/component-overrides/)), ou estruture alguns campos manualmente com `<RecordForm>` e `<FormField>` em uma página própria (veja [Painéis](/docs/frontend/panels/)).

## Outras opções de formulário

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Opção | Efeito |
|---|---|
| `formAutoSave` | Salva conforme o visitante digita. |
| `alwaysApplyDefaultValues` | Preenche os valores padrão declarados nos campos vazios de um registro salvo quando ele é aberto. |
| `includeJsonView` | Adiciona uma aba com o registro em JSON. |
| `localChangesBackup` | Mantém edições não salvas no armazenamento local: `"manual_apply"`, `"auto_apply"` ou `false`. |

## Relacionados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Campos personalizados](/docs/frontend/custom-fields/): os campos que um layout organiza
- [Visualizações de entidade](/docs/frontend/entity-views/): uma aba inteira própria ao lado do formulário
- [customizeTable](/docs/frontend/customize-table/#form): as opções de formulário na referência
