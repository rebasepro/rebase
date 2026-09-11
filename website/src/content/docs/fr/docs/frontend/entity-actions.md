---
sourceHash: 3bf8656e3408eede
title: Actions d'Entité
sidebar_label: Actions d'Entité
description: Ajoutez des boutons d'action personnalisés aux entités pour l'archivage, la publication, l'exportation, le clonage, et plus encore.
---

## Vue d'ensemble

Les actions d'entité sont des boutons personnalisés qui apparaissent sur les entités individuelles. Utilisez-les pour des opérations telles que la publication, l'archivage, le clonage ou le déclenchement de workflows externes.

## Définition des Actions d'Entité

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

## Actions de Collection

Pour les actions au niveau de la barre d'outils qui s'appliquent à la collection ou aux entités sélectionnées :

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

// Register
const collection = defineCollection({
    admin: {
        Actions: PublishSelectedAction
    }
    // ...
});
```

![Actions de collection](/img/collection_actions.png)

## Prochaines Étapes

- **[Colonnes Supplémentaires](/docs/frontend/additional-columns)** — Colonnes de tableau calculées
- **[Champs Personnalisés](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
---
