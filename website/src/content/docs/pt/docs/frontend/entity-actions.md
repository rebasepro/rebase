---
title: Ações de Entidade
sidebar_label: Ações de Entidade
description: Adicione botões de ação personalizados a entidades para arquivamento, publicação, exportação, clonagem e muito mais.
---

## Visão Geral

Ações de entidade são botões personalizados que aparecem em entidades individuais. Use-os para operações como publicação, arquivamento, clonagem ou para acionar fluxos de trabalho externos.

## Definindo Ações de Entidade

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    entityActions: [
        {
            name: "Publish",
            icon: "publish",
            onClick: async ({ entity, context }) => {
                await context.dataSource.saveEntity({
                    path: entity.path,
                    entityId: entity.id,
                    values: { status: "published", published_at: new Date() },
                    collection: articlesCollection
                });
                context.snackbarController.open({
                    message: "Article published!"
                });
            }
        },
        {
            name: "Clone",
            icon: "content_copy",
            onClick: async ({ entity, context }) => {
                const { id, ...values } = entity.values;
                await context.dataSource.saveEntity({
                    path: entity.path,
                    values: { ...values, name: values.name + " (Copy)" },
                    collection: articlesCollection
                });
            }
        }
    ],
    properties: { /* ... */ }
};
```

## Ações de Coleção

Para ações de nível de barra de ferramentas que funcionam na coleção ou em entidades selecionadas:

```tsx
function PublishSelectedAction({ selectionController, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        const selected = selectionController.selectedEntities;
        for (const entity of selected) {
            await context.dataSource.saveEntity({
                path: entity.path,
                entityId: entity.id,
                values: { status: "published" },
                collection: context.collection
            });
        }
    };

    return (
        <button onClick={handlePublish}>
            Publish {selectionController.selectedEntities.length} selected
        </button>
    );
}

// Register
const collection: EntityCollection = {
    Actions: PublishSelectedAction,
    // ...
};
```

![Collection actions](/img/collection_actions.png)

## Próximos Passos

- **[Colunas Adicionais](/docs/frontend/additional-columns)** — Colunas de tabela computadas
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados

---
