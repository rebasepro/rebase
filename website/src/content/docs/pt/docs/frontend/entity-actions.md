---
sourceHash: 5bea8df7e8fceb05
title: Ações de Entidade
sidebar_label: Ações de Entidade
description: Adicione botões de ação personalizados a entidades para arquivar, publicar, exportar, clonar e muito mais.
---

## Visão Geral

Ações de entidade são botões personalizados que aparecem em entidades individuais. Use-as para operações como publicação, arquivamento, clonagem ou acionamento de fluxos de trabalho externos.

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
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .update(entity.id, { status: "published", publishedAt: new Date() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    const { id, ...values } = entity.values;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .create({ ...values, name: values.name + " (Copy)" });
                }
            }
        ]
    }
});

```

## Onde uma ação aparece

Uma ação aparece no registro, tanto no formulário de edição quanto na visualização somente leitura, e nas linhas da tabela da coleção. Por padrão, ela fica no menu de transbordamento (⋮) nos dois lugares.

Defina `collapsed: false` na ação que é o motivo de abrir o registro, e ela ganha um botão próprio:

- **No registro**, ela vira um botão com rótulo na barra, antes de Salvar (ou de Editar, na visualização somente leitura). Quando falta espaço na barra, como em um painel lateral, um diálogo ou uma janela estreita, os botões perdem primeiro o rótulo e mantêm o ícone, com o nome em um tooltip. Se ainda assim não couber, as últimas declaradas voltam para o menu, então declare a mais importante primeiro.
- **Em uma linha da tabela**, ela vira um ícone ao lado de Editar enquanto o ponteiro está sobre a linha.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // um botão no registro, um ícone na linha
    onClick: async ({ entity, context }) => { /* … */ }
}
```

Reserve isso para a uma ou duas ações que são a razão de abrir o registro. As demais ficam mais legíveis no menu, que as organiza em três grupos: primeiro as ações próprias da coleção, na ordem em que você as declarou; depois Copiar, Histórico e Inspecionar; e por fim Excluir, no final e separado.

| Propriedade | Padrão | Efeito |
|-------------|--------|--------|
| `collapsed` | `true` | `false` transforma a ação em um botão no registro e em um ícone na linha da tabela |
| `includeInForm` | `true` | `false` mantém a ação fora do registro e a deixa nas linhas da coleção |
| `showActionsInListView` | `false` | `true` mostra a ação como um ícone em cada linha da visualização em lista |
| `isEnabled` | — | Retorne `false` para mostrar a ação desabilitada, como botão ou como item de menu |

No registro, um botão cujo `onClick` retorna uma promise pendente mostra um indicador de carregamento e não pode ser pressionado de novo até a promise ser concluída. Se a ação lançar um erro ou sua promise for rejeitada, o usuário vê o erro em uma notificação. A visualização somente leitura não tem formulário, então ali `formContext` é undefined.

## Ações de Coleção

Para ações no nível da barra de ferramentas que operam na coleção ou em entidades selecionadas:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { useData } from "@rebasepro/app";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path }: CollectionActionsProps) {
    const data = useData();
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix.
        const selected = await resolveSelection({
            selection: selectionController.selection,
            accessor: data.collection(path)
        });
        for (const entity of selected) {
            await data.collection(entity.path).update(entity.id, { status: "published" });
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

![Ações de coleção](/img/collection_actions.png)

## Próximos Passos

- **[Colunas Adicionais](/docs/frontend/additional-columns)** — Colunas de tabela computadas
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados
