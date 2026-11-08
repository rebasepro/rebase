---
sourceHash: 97a837000033ac9c
title: Ações de Entidade
sidebar_label: Ações de Entidade
description: Adicione botões de ação personalizados a entidades para arquivamento, publicação, exportação, clonagem e muito mais.
---

## Visão Geral

As ações de entidade são botões personalizados exibidos em entidades individuais. Use-as para operações como publicação, arquivamento, clonagem ou acionamento de fluxos de trabalho externos.

## Definindo Ações de Entidade

```typescript
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
import { iconSize } from "@rebasepro/ui";
import { Copy, Upload } from "lucide-react";

const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published At", type: "date" }
    },
    admin: {
        entityActions: [
            {
                name: "Publish",
                icon: <Upload size={iconSize.small}/>,
                onClick: async ({ id, path, context }) => {
                    if (id === undefined || !path || !context) return;
                    await context.data.collection<Record<string, unknown>>(path)
                            .update(id, { status: "published", publishedAt: new Date().toISOString() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ row, path, context }) => {
                    if (!row || !path || !context) return;
                    // `row` is the record as the server sends it, the shape
                    // `context.data` writes: copy it, minus its id.
                    const { id, ...fields } = row;
                    await context.data.collection<Record<string, unknown>>(path)
                            .create({ ...fields, name: `${String(fields.name)} (Copy)` });
                }
            }
        ]
    }
});

```

## O que é passado para uma ação

Cada callback de uma ação (`onClick`, `isEnabled`, `disabledReason`) recebe o registro no qual está sendo executado:

| Propriedade | O que é |
|-------------|---------|
| `row` | O registro conforme o servidor envia a linha, o formato retornado por `useRows` e `context.data`: datas como strings ISO, um belongsTo como sua coluna de chave estrangeira (`authorId`). Exatamente as colunas do registro: `row.id` é uma coluna `id`, quando a tabela possui uma, com o tipo dessa coluna. Indefinido enquanto não houver um registro salvo. |
| `id` | O id do registro, conforme referenciado pelo admin: sua chave primária como uma string, as partes de uma chave composta unidas por `:::` (`"5"` para uma chave de inteiro `5`). |
| `path` | O caminho da coleção onde o registro está localizado, incluindo segmentos de subcoleções (`authors/7/posts`). |
| `collection`, `context` | A coleção e o contexto do admin: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | No formulário de edição de um registro aberto, o formulário: seus `values` são os do formulário, incluindo edições não salvas. Indefinido na coleção e na visualização somente leitura. |
| `view` | `"collection"` ou `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | Na coleção, destaca uma linha pelo seu id e remove o destaque. |
| `selectionController` | Na coleção, sua seleção por id: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (as linhas marcadas ou a consulta que "all matching" representa). |

## Onde uma ação é exibida

Uma ação aparece no registro, tanto no formulário de edição quanto na visualização somente leitura, e nas linhas da tabela da coleção. Por padrão, ela fica no menu suspenso (⋮) em ambos os locais.

Defina `collapsed: false` na ação que os usuários abrem o registro para executar, e ela ganhará um botão próprio:

- **No registro**, torna-se um botão com rótulo na barra, antes de Salvar (ou Editar, na visualização somente leitura). Quando a barra fica sem espaço, como em um painel lateral, em um diálogo ou em uma janela estreita, os botões removem seus rótulos primeiro e mantêm o ícone, com o nome em um tooltip. Se ainda assim estiver muito largo, os últimos que você declarou voltam para o menu; portanto, declare os mais importantes primeiro.
- **Na linha da tabela**, torna-se um ícone ao lado de Editar quando o cursor passa sobre a linha (hover).

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Mantenha essa configuração para uma ou duas ações que são o motivo principal pelo qual o registro é aberto. As demais funcionam melhor no menu, que as lista em três grupos: as ações da própria coleção primeiro, na ordem em que foram declaradas; depois Copiar, Histórico e Inspecionar; e, por fim, Excluir, destacada no final.

| Propriedade | Padrão | Efeito |
|-------------|--------|--------|
| `collapsed` | `true` | `false` transforma a ação em um botão no registro e em um ícone na linha da tabela |
| `includeInForm` | `true` | `false` mantém a ação fora do registro e a deixa apenas nas linhas da coleção |
| `showActionsInListView` | `false` | `true` exibe a ação como um ícone em cada linha da visualização de lista |
| `isEnabled` | — | Retorne `false` para exibir a ação desabilitada, seja como um botão ou item de menu |
| `disabledReason` | — | Informa o motivo pelo qual uma ação desabilitada está indisponível: abaixo do nome em um menu e como tooltip de um botão ou ícone desabilitado |
| `nameKey` | — | Uma chave de tradução para o nome. O admin exibe sua tradução no idioma atual e o valor de `name` quando a chave não possuir tradução. As ações integradas a configuram, de modo que Editar, Copiar e Excluir acompanhem o idioma do admin |

Uma ação desabilitada sem uma explicação parecerá com defeito. `disabledReason` recebe as mesmas props que `isEnabled`, permitindo indicar o que está faltando:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

No registro, um botão cujo `onClick` retorna uma promise pendente exibe um indicador de carregamento (spinner) e não pode ser clicado novamente até que a promise seja resolvida. Se a ação lançar um erro ou a promise for rejeitada, o usuário verá o erro em uma notificação. A visualização somente leitura não possui formulário, portanto `formContext` fica indefinido lá.

## Ações de Coleção

Para ações no nível da barra de ferramentas que operam na coleção ou em entidades selecionadas:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path, collection, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix. Each row's
        // id comes beside it in `ids`, whatever the collection is keyed by.
        const { ids } = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const id of ids) {
            await context.data.collection(path).update(id, { status: "published" });
        }
    };

    return (
        <button onClick={handlePublish}>
            Publish {selectionController.selectedCount ?? "all"} selected
        </button>
    );
}

// Register — `Actions` is an array, so several can be composed.
const collection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: { /* … */ },
    admin: {
        Actions: [PublishSelectedAction]
    }
});
```

Uma ação recebe `CollectionActionsProps`. Cada uma manipula as linhas conforme o servidor as envia, no formato retornado por `useRows`:

| Propriedade | O que é |
|-------------|---------|
| `selectionController` | A seleção da visualização. `selection` é `{ type: "rows", ids, rows }` para linhas marcadas, ou `{ type: "query", query, excludedIds, count }` para "all matching"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | A consulta em tempo real da visualização: `rows`, `loading`, `error`, e o filtro, busca e ordenação compartilhados pela barra de ferramentas (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Onde a coleção está, sua configuração e o contexto do admin. |
| `openNewDocument(defaults?)` | Abre o formulário de novo registro, pré-preenchido. |

Para manter algumas linhas selecionadas após agir sobre as demais, passe as que deseja manter para `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Ações de coleção](/img/collection_actions.png)

## Próximos Passos

- **[Colunas Adicionais](/docs/frontend/additional-columns)** — Colunas computadas de tabela
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados
