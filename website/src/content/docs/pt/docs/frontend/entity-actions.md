---
sourceHash: 49c04468f92c50c8
title: Ações de Entidade
sidebar_label: Ações de Entidade
description: Adicione botões de ação personalizados a entidades para arquivamento, publicação, exportação, clonagem e muito mais.
---

## Visão Geral

<span class="since-badge" data-since="0.31">A partir da versão 0.31</span>

Ações de entidade são botões em um registro: publicar, arquivar, clonar ou disparar um
fluxo de trabalho externo. Elas são declaradas por tabela em `customizeTable`, e
o `updateRecord` cobre a escrita que a maioria delas realiza.

## Definindo Ações de Entidade

<span class="since-badge" data-since="0.31">A partir da versão 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable, updateRecord, resolveSelection } from "@rebasepro/cms";
import type { CollectionActionsProps } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

function PublishSelected({ selectionController, collection, context }: CollectionActionsProps) {
    const publish = async () => {
        // `selection` is the ticked rows, or a query standing for every row
        // that matches: resolveSelection reads them, a page at a time.
        const { ids } = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const id of ids) await updateRecord(context, "products", id, { status: "active" });
        context.snackbarController?.open({ type: "success", message: `${ids.length} published` });
    };
    return <button onClick={publish}>Publish selected</button>;
}

export const productsCms = customizeTable<typeof products>("products", {
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Upload",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "active",
            disabledReason: () => "Already active",
            onClick: ({ id, context }) =>
                updateRecord<typeof products>(context, "products", id,
                    { status: "active", publishedAt: new Date().toISOString() }, "Product published"),
        },
        {
            key: "clone",
            name: "Clone",
            icon: "Copy",
            onClick: async ({ row, context }) => {
                if (!row || !context) return;
                // `row` is the record as the server sends it: copy it, minus its id.
                const { id: _id, ...fields } = row;
                await context.data.products.create({ ...fields, name: `${fields.name} (Copy)` });
            },
        },
    ],
    Actions: [PublishSelected],
});
```

Com a tabela como argumento de tipo, `row` em `onClick`, `isEnabled` e
`disabledReason` é o tipo de linha da tabela, de modo que `row?.status` é verificado contra
os valores da coluna. Uma entrada também pode ser uma string: a `key` de uma ação
registrada uma vez em `<RebaseCMS entityActions>` (ou `<Rebase entityActions>`),
para ações compartilhadas por várias tabelas.

## `updateRecord`

<span class="since-badge" data-since="0.31">A partir da versão 0.31</span>

`updateRecord(context, slug, id, patch, message?)` grava o `patch` em um
registro e, em seguida, exibe a `message` como uma notificação de sucesso, quando fornecida.

- Ele grava através de `context.data`, a mesma requisição que o formulário faz, de modo que
  os hooks do servidor e a segurança em nível de linha (RLS) se aplicam, e todas as visualizações da tabela
  são atualizadas.
- Ele recebe o que o `onClick` de uma ação recebe como está. Um `context` ou
  `id` ausente (uma ação em um registro ainda não criado) não grava nada.
- Uma gravação recusada lança um erro, e a ação relata o erro ao usuário.
- `updateRecord<typeof products>(…)` valida o `patch` contra o que uma atualização
  da tabela aceita. Uma data entra como sua string ISO, conforme o servidor espera.

## O que é passado para uma ação

Cada callback de uma ação (`onClick`, `isEnabled`, `disabledReason`) recebe o registro sobre o qual é executado:

| Prop | O que é |
|------|---------|
| `row` | O registro conforme o servidor envia a linha, o formato retornado por `useRows` e `context.data`: datas como strings ISO, uma relação belongsTo como sua coluna de chave estrangeira (`authorId`). Exatamente as colunas do registro: `row.id` é uma coluna `id`, quando a tabela possui uma, com o tipo dessa coluna. Indefinido enquanto não houver um registro salvo. |
| `id` | O id do registro, conforme o admin o endereça: sua chave primária como string, ou as partes de uma chave composta unidas por `:::` (`"5"` para uma chave inteira `5`). |
| `path` | O caminho da coleção onde o registro está localizado, incluindo segmentos de subcoleções (`authors/7/posts`). |
| `collection`, `context` | A coleção e o contexto do admin: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | No formulário de edição de um registro aberto, o formulário: seus `values` são os do formulário, edições não salvas incluídas. Indefinido na coleção e na visualização somente leitura. |
| `view` | `"collection"` ou `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | Na coleção, destaca uma linha pelo seu id e remove o destaque. |
| `selectionController` | Na coleção, a sua seleção, por id: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (as linhas marcadas ou a query que "todas correspondentes" representa). |

## Onde uma ação é exibida

Uma ação aparece no registro, tanto no seu formulário de edição quanto na sua visualização somente leitura, e nas linhas da tabela da coleção. Por padrão, ela fica no menu suspenso (⋮) em ambos os lugares.

Defina `collapsed: false` na ação que os usuários abrem o registro para executar, e ela ganhará um botão próprio:

- **No registro**, ela se torna um botão com rótulo na barra, antes de Salvar (ou Editar, na visualização somente leitura). Quando a barra fica sem espaço, como em um painel lateral, em um diálogo ou em uma janela estreita, os botões perdem seus rótulos primeiro e mantêm o ícone, com o nome em uma tooltip. Se ainda assim estiver muito largo, os últimos declarados voltam para o menu; portanto, declare os mais importantes primeiro.
- **Em uma linha da tabela**, ela se torna um ícone ao lado de Editar quando o cursor passa sobre a linha.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Mantenha isso para uma ou duas ações que são o motivo principal pelo qual o registro está aberto. O restante é mais legível no menu, que as lista em três grupos: as ações próprias da coleção primeiro, na ordem em que você as declarou; depois Copiar, Histórico e Inspecionar; e por fim Excluir, separado dos demais.

| Propriedade | Padrão | Efeito |
|-------------|--------|--------|
| `collapsed` | `true` | `false` transforma a ação em um botão no registro e em um ícone na linha da tabela |
| `includeInForm` | `true` | `false` remove a ação do registro e a mantém nas linhas da coleção |
| `showActionsInListView` | `false` | `true` exibe a ação como um ícone em cada linha da visualização em lista |
| `isEnabled` | — | Retorne `false` para exibir a ação desativada, como um botão ou item de menu |
| `disabledReason` | — | Informa por que uma ação desativada está indisponível: abaixo do seu nome em um menu e como tooltip de um botão ou ícone desativado |
| `nameKey` | — | Uma chave de tradução para o nome. O admin exibe sua tradução no idioma atual, e `name` quando a chave não tiver tradução. As ações integradas a definem, portanto Editar, Copiar e Excluir seguem o idioma do admin |

Uma ação desativada que não explica o motivo parece quebrada. `disabledReason` recebe as mesmas props que `isEnabled`, para que possa indicar o que está faltando:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

No registro, um botão cujo `onClick` retorna uma promise pendente exibe um indicador de carregamento (spinner) e não pode ser clicado novamente até que a promise seja resolvida. Se a ação lançar um erro ou sua promise for rejeitada, o usuário verá o erro em uma notificação. A visualização somente leitura não possui formulário, portanto `formContext` é indefinido nela.

## Ações de Coleção

<span class="since-badge" data-since="0.31">A partir da versão 0.31</span>

`Actions` insere componentes próprios na barra de ferramentas da coleção, para ações sobre
toda a coleção ou sobre as linhas selecionadas: como `PublishSelected` acima. Trata-se de uma
lista, permitindo a composição de vários componentes.

Uma ação recebe `CollectionActionsProps`. Cada uma trabalha com linhas conforme o servidor
as envia, no formato retornado por `useRows`:

| Prop | O que é |
|------|---------|
| `selectionController` | A seleção da visualização. `selection` é `{ type: "rows", ids, rows }` para linhas marcadas, ou `{ type: "query", query, excludedIds, count }` para "todas correspondentes"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | A query em tempo real da visualização: `rows`, `loading`, `error`, e os filtros, busca e ordenação compartilhados pela barra de ferramentas (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Onde a coleção está, sua configuração e o contexto do admin. |
| `openNewDocument(defaults?)` | Abre o formulário de novo registro, pré-preenchido. |

Para manter algumas linhas selecionadas após agir sobre as demais, passe as que deseja manter para
`setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Collection actions](/img/collection_actions.png)

## Próximos Passos

- **[customizeTable](/docs/frontend/customize-table)** — Todas as opções de tabela
- **[Colunas Adicionais](/docs/frontend/additional-columns)** — Colunas computadas da tabela
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados
