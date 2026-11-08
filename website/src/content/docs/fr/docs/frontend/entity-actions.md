---
sourceHash: 97a837000033ac9c
title: Actions d'entité
sidebar_label: Actions d'entité
description: Ajoutez des boutons d'action personnalisés aux entités pour archiver, publier, exporter, cloner et bien plus encore.
---

## Vue d'ensemble

Les actions d'entité sont des boutons personnalisés qui apparaissent sur les entités individuelles. Utilisez-les pour des opérations telles que la publication, l'archivage, le clonage ou le déclenchement de flux de travail (workflows) externes.

## Définir des actions d'entité

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

## Ce qui est transmis à une action

Chaque callback d'une action (`onClick`, `isEnabled`, `disabledReason`) reçoit l'enregistrement sur lequel elle s'exécute :

| Propriété | Description |
|-----------|-------------|
| `row` | L'enregistrement tel que le serveur renvoie la ligne, le format retourné par `useRows` et `context.data` : dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa colonne de clé étrangère (`authorId`). Exactement les colonnes de l'enregistrement : `row.id` est une colonne `id`, lorsque la table en a une, avec le type de cette colonne. Indéfini tant qu'il n'y a pas d'enregistrement sauvegardé. |
| `id` | L'identifiant de l'enregistrement, tel que l'administration l'adresse : sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite jointes par `:::` (`"5"` pour une clé entière `5`). |
| `path` | Le chemin de collection où se trouve l'enregistrement, segments de sous-collection inclus (`authors/7/posts`). |
| `collection`, `context` | La collection, et le contexte de l'administration : `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Sur le formulaire d'édition d'un enregistrement ouvert, le formulaire : ses `values` sont celles du formulaire, modifications non enregistrées incluses. Indéfini dans la collection et sur la vue en lecture seule. |
| `view` | `"collection"` ou `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | Dans la collection, met en surbrillance une ligne par son identifiant, et retire la surbrillance. |
| `selectionController` | Dans la collection, sa sélection, par identifiant : `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (les lignes cochées, ou la requête représentée par « tous les éléments correspondants »). |

## Où s'affiche une action

Une action apparaît sur l'enregistrement, à la fois sur son formulaire d'édition et sur sa vue en lecture seule, ainsi que sur les lignes du tableau de la collection. Par défaut, elle attend dans le menu déroulant (⋮) à ces deux endroits.

Définissez `collapsed: false` sur l'action principale pour laquelle les utilisateurs ouvrent l'enregistrement afin qu'elle obtienne son propre bouton :

- **Sur l'enregistrement**, elle devient un bouton avec libellé dans la barre, avant Enregistrer (ou Modifier, sur la vue en lecture seule). Lorsque la barre manque d'espace, comme dans un panneau latéral, une boîte de dialogue ou une fenêtre étroite, les boutons perdent d'abord leur libellé pour ne garder que l'icône, avec le nom dans une info-bulle. Si l'espace est encore insuffisant, les derniers que vous avez déclarés se replient dans le menu ; déclarez donc les plus importants en premier.
- **Sur une ligne de tableau**, elle devient une icône à côté de Modifier lorsque la ligne est survolée.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Réservez cela pour une ou deux actions qui justifient l'ouverture de l'enregistrement. Le reste est plus lisible dans le menu, qui les regroupe en trois catégories : d'abord les actions propres à la collection, dans l'ordre où vous les avez déclarées ; puis Copier, Historique et Inspecter ; enfin Supprimer, en dernier et mis à l'écart.

| Propriété | Valeur par défaut | Effet |
|-----------|-------------------|-------|
| `collapsed` | `true` | `false` transforme l'action en un bouton sur l'enregistrement et en une icône sur la ligne du tableau |
| `includeInForm` | `true` | `false` retire l'action de l'enregistrement et la laisse sur les lignes de la collection |
| `showActionsInListView` | `false` | `true` affiche l'action sous forme d'icône sur chaque ligne de la vue en liste |
| `isEnabled` | — | Renvoyez `false` pour afficher l'action désactivée, sous forme de bouton ou d'élément de menu |
| `disabledReason` | — | Indique pourquoi une action désactivée est indisponible : sous son nom dans un menu, et en tant qu'info-bulle d'un bouton ou d'une icône désactivé(e) |
| `nameKey` | — | Une clé de traduction pour le nom. L'administration affiche sa traduction dans la langue courante, et `name` si la clé n'en a pas. Les actions intégrées la définissent, afin que Modifier, Copier et Supprimer suivent la langue de l'administration |

Une action désactivée qui n'explique pas pourquoi semble défectueuse. `disabledReason` reçoit les mêmes propriétés que `isEnabled`, ce qui lui permet d'indiquer précisément ce qui manque :

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Sur l'enregistrement, un bouton dont le `onClick` renvoie une promesse en attente affiche un indicateur de chargement et ne peut pas être cliqué à nouveau tant que la promesse n'est pas résolue. Si l'action lève une exception ou si sa promesse est rejetée, l'utilisateur voit l'erreur dans une notification. La vue en lecture seule n'a pas de formulaire, `formContext` y est donc indéfini.

## Actions de collection

Pour les actions au niveau de la barre d'outils qui s'appliquent à l'ensemble de la collection ou aux entités sélectionnées :

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

Une action reçoit `CollectionActionsProps`. Chacune manipule les lignes telles que le serveur les envoie, au format retourné par `useRows` :

| Propriété | Description |
|-----------|-------------|
| `selectionController` | La sélection de la vue. `selection` vaut `{ type: "rows", ids, rows }` pour les lignes cochées, ou `{ type: "query", query, excludedIds, count }` pour « tous les éléments correspondants » ; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La requête en direct de la vue : `rows`, `loading`, `error`, ainsi que le filtre, la recherche et le tri partagés par la barre d'outils (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | L'emplacement de la collection, sa configuration et le contexte de l'administration. |
| `openNewDocument(defaults?)` | Ouvre le formulaire de création d'enregistrement, pré-rempli. |

Pour conserver certaines lignes sélectionnées après avoir appliqué une action sur le reste, transmettez celles à conserver à `setSelectedRows` :

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Actions de collection](/img/collection_actions.png)

## Étapes suivantes

- **[Colonnes supplémentaires](/docs/frontend/additional-columns)** — Colonnes de tableau calculées
- **[Champs personnalisés](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
