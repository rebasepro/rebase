---
sourceHash: 640b52048be1b1c6
title: Vistas de Entidade
sidebar_label: Vistas de Entidade
description: Adicione abas e vistas personalizadas às páginas de detalhe da entidade para pré-visualizações, análises, dados relacionados ou UI personalizada.
---

## Visão Geral

As vistas de entidade permitem adicionar **abas** personalizadas à página de detalhe da entidade, juntamente com o formulário predefinido. Use-as para:

- **Pré-visualizações** ao vivo (pré-visualização de website, conteúdo renderizado)
- Vistas de **dados relacionados** (itens de pedido, entidades filhas)
- **Análises** ou gráficos
- **Editores personalizados** (texto formatado, editores de mapa)

## Adicionar Vistas de Entidade

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

## Construir uma Vista de Entidade

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

function ArticlePreview({
    entity,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values. Both it and
    // entity.values are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? entity?.values?.title ?? "");
    const content = String(modifiedValues?.content ?? entity?.values?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

| Prop | Tipo | Descrição |
|------|------|-------------|
| `entity` | `Entity` | A entidade guardada (ausente enquanto uma nova está sendo criada) |
| `modifiedValues` | `EntityValues` | Valores atuais do formulário não guardados (atualizados à medida que o utilizador digita) |
| `formContext` | `FormContext` | Contexto completo do formulário |
| `collection` | `AdminCollection` | Definição da coleção |

![Vista de entidade com formulário secundário](/img/entity_view_secondary_form.png)

## Controlar Posição

As vistas aparecem como abas. Pode configurar a sua posição:

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

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Criar campos de formulário personalizados
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Botões de ação personalizados
