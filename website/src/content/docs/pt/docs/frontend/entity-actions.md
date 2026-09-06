---
sourceHash: 3bf8656e3408eede
title: Ações de Entidade
sidebar_label: Ações de Entidade
description: Adicione botões de ação personalizados a entidades para arquivamento, publicação, exportação, clonagem e muito mais.
---

## Visão Geral

Ações de entidade são botões personalizados que aparecem em entidades individuais. Use-os para operações como publicação, arquivamento, clonagem ou para acionar fluxos de trabalho externos.

## Definindo Ações de Entidade

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .update(entity.id, { status: "published", publishedAt: new Date() });
                    context.snackbarController.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    const { id, ...values } = entity.values;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .create({ ...values, name: values.name + " (Copy)" });
                }
            }
        ]
    }
});

```

## Ações de Coleção

Para ações de nível de barra de ferramentas que funcionam na coleção ou em entidades selecionadas:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
function PublishSelectedAction({ selectionController, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        const selected = selectionController.selectedEntities;
        for (const entity of selected) {
            await context.data.save({
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
const collection = defineCollection({
    admin: {
        Actions: PublishSelectedAction
    }
    // ...
});
```

![Ações da coleção](/img/collection_actions.png)

## Próximos Passos

- **[Colunas Adicionais](/docs/frontend/additional-columns)** — Colunas de tabela computadas
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Campos de formulário personalizados

---
