---
sourceHash: 0a2cae1ef41369b1
title: Visualizações de Entidade
sidebar_label: Visualizações de Entidade
description: Adicione abas e visualizações personalizadas às páginas de detalhes da entidade para pré-visualizações, métricas, dados relacionados ou interface personalizada.
---

## Visão Geral

As visualizações de entidade permitem adicionar **abas** personalizadas à página de detalhes da entidade, ao lado do formulário padrão. Use-as para:

- **Pré-visualizações** em tempo real (pré-visualização do site, conteúdo renderizado)
- Visualizações de **dados relacionados** (itens de pedidos, entidades filhas)
- **Métricas** ou gráficos
- **Editores personalizados** (rich text, editores de mapas)

## Adicionando Visualizações de Entidade

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    table: "articles",
    name: "Articles",
    properties: { /* ... */ },
    admin: {
        entityViews: [
            {
                key: "preview",
                name: "Preview",
                Builder: ArticlePreview
            },
            {
                key: "related",
                name: "Related Articles",
                Builder: RelatedArticlesView
            }
        ]
    }
});

```

## Construindo uma Visualização de Entidade

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

function ArticlePreview({
    row,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
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

| Propriedade | Tipo | Descrição |
|------|------|-------------|
| `row` | `Record<string, unknown>` | O registro salvo conforme o servidor envia a linha: datas como strings ISO, uma relação belongsTo como sua coluna de chave estrangeira, `id` incluído. Ausente enquanto um novo registro estiver sendo criado |
| `modifiedValues` | `EntityValues` | Valores atuais do formulário, incluindo alterações não salvas (em tempo real enquanto o usuário digita), tipados para o editor: uma data é um `Date` |
| `formContext` | `FormContext` | Contexto completo do formulário |
| `collection` | `AdminCollection` | Definição da coleção |

![Visualização de entidade com formulário secundário](/img/entity_view_secondary_form.png)

## Controlando a Posição

As visualizações aparecem como abas. Você pode configurar a posição delas:

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Appears before the default form tab
    }
]
```

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Crie campos de formulário personalizados
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Botões de ação personalizados
