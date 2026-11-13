---
sourceHash: faf8f760aabce923
title: Visualizações de Entidade
sidebar_label: Visualizações de Entidade
description: Adicione abas e visualizações personalizadas às páginas de detalhes da entidade para pré-visualizações, métricas, dados relacionados ou interfaces personalizadas.
---

## Visão Geral

As visualizações de entidade permitem adicionar **abas** personalizadas à página de detalhes da entidade junto ao formulário padrão. Use-as para:

- **Pré-visualizações** em tempo real (pré-visualização do site, conteúdo renderizado)
- Visualizações de **dados relacionados** (itens de pedidos, entidades filhas)
- **Métricas** ou gráficos
- **Editores personalizados** (rich text, editores de mapa)

## Adicionando Visualizações de Entidade

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ArticlePreview } from "../../../../../components/ArticlePreview";

export const productsCms = customizeTable<typeof products>("products", {
    entityViews: [
        { key: "preview", name: "Preview", Builder: ArticlePreview, position: "start" },
        "related",   // registered once on <RebaseCMS entityViews>
    ],
});
```

Uma entrada é uma visualização, ou a `key` de uma registrada uma única vez em
`<RebaseCMS entityViews>` (ou `<Rebase entityViews>`), para abas compartilhadas por
várias tabelas. Uma visualização registrada é exibida apenas nas tabelas que especificam sua chave.
`position: "start"` coloca a aba antes da do formulário; caso contrário, ela é posicionada depois.

## Construindo uma Visualização de Entidade

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `Builder` é o próprio componente, importado por valor:

```tsx
// frontend/src/components/ArticlePreview.tsx
import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

export function ArticlePreview({ row, modifiedValues }: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values; row is the saved
    // record. Both are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? row?.title ?? "");
    const content = String(modifiedValues?.content ?? row?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Prop | Tipo | Descrição |
|------|------|-------------|
| `row` | `Record<string, unknown>` | O registro salvo conforme o servidor envia a linha: datas como strings ISO, um belongsTo como sua coluna de chave estrangeira, `id` apenas onde a tabela possui essa coluna. Ausente enquanto um novo registro está sendo criado |
| `id` | `string` | O id do registro salvo, além de `row`: sua chave primária como string, as partes de uma chave composta unidas por `:::`. O que `useSidePanel().open` e `useRowWrites().update` recebem. Ausente enquanto um novo registro está sendo criado |
| `modifiedValues` | `EntityValues` | Valores atuais do formulário, incluindo edições não salvas (em tempo real conforme o usuário digita), tipados para o editor: uma data é um `Date` |
| `formContext` | `FormContext` | Contexto completo do formulário |
| `collection` | `AdminCollection` | A coleção conforme resolvida pelo CMS |

![Visualização de entidade com formulário secundário](/img/entity_view_secondary_form.png)

As relações to-many de uma tabela também se tornam abas do registro, sem necessidade de nada disso;
consulte [Relações no painel](/docs/collections/relations-in-the-admin-panel/).
`defaultSelectedView` em `customizeTable` define a aba em que o registro é aberto por padrão.

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Botões de ação personalizados
