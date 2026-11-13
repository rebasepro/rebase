---
sourceHash: 49c04468f92c50c8
title: Actions d'entité
sidebar_label: Actions d'entité
description: Ajoutez des boutons d'action personnalisés aux entités pour archiver, publier, exporter, cloner, et plus encore.
---

## Vue d'ensemble

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les actions d'entité sont des boutons sur un enregistrement : publier, archiver, cloner ou déclencher un
workflow externe. Elles sont déclarées par table dans `customizeTable`, et
`updateRecord` gère l'écriture que la plupart d'entre elles effectuent.

## Définir des actions d'entité

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

Avec la table comme argument de type, `row` dans `onClick`, `isEnabled` et
`disabledReason` correspond au type de ligne de la table, donc `row?.status` est vérifié par rapport
aux valeurs de la colonne. Une entrée peut également être une chaîne : la clé `key` d'une action
enregistrée une seule fois sur `<RebaseCMS entityActions>` (ou `<Rebase entityActions>`),
pour les actions partagées par plusieurs tables.

## `updateRecord`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`updateRecord(context, slug, id, patch, message?)` écrit `patch` sur un
enregistrement, puis affiche `message` sous forme de notification de succès lorsqu'il est fourni.

- Il écrit via `context.data`, la même requête que celle effectuée par le formulaire, de sorte que les
  hooks du serveur et la sécurité au niveau des lignes (RLS) s'appliquent, et chaque vue de la table
  s'actualise.
- Il prend tel quel ce que le `onClick` d'une action reçoit. Un `context` ou un
  `id` manquant (une action sur un enregistrement pas encore créé) n'écrit rien.
- Une écriture refusée lève une exception, et l'action signale l'erreur à l'utilisateur.
- `updateRecord<typeof products>(…)` vérifie `patch` par rapport à ce qu'une mise à jour de
  la table accepte. Une date est transmise sous forme de chaîne ISO, telle que le serveur l'attend.

## Ce qui est transmis à une action

Chaque callback d'une action (`onClick`, `isEnabled`, `disabledReason`) reçoit l'enregistrement sur lequel il s'exécute :

| Propriété | Ce que c'est |
|-----------|--------------|
| `row` | L'enregistrement tel que le serveur renvoie la ligne, la forme retournée par `useRows` et `context.data` : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa colonne de clé étrangère (`authorId`). Exactement les colonnes de l'enregistrement : `row.id` est une colonne `id`, lorsque la table en a une, avec le type de cette colonne. Indéfini tant qu'il n'y a pas d'enregistrement enregistré. |
| `id` | L'identifiant de l'enregistrement, tel que l'admin l'adresse : sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite jointes par `:::` (`"5"` pour une clé entière `5`). |
| `path` | Le chemin de collection où se trouve l'enregistrement, segments de sous-collection inclus (`authors/7/posts`). |
| `collection`, `context` | La collection, et le contexte de l'admin : `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Sur le formulaire d'édition d'un enregistrement ouvert, le formulaire : ses `values` sont celles du formulaire, modifications non enregistrées incluses. Indéfini dans la collection et sur la vue en lecture seule. |
| `view` | `"collection"` ou `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | Dans la collection, met en surbrillance une ligne par son identifiant, et retire la surbrillance. |
| `selectionController` | Dans la collection, sa sélection, par identifiant : `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (les lignes cochées, ou la requête représentée par "tous les éléments correspondants"). |

## Où apparaît une action

Une action apparaît sur l'enregistrement, aussi bien sur son formulaire d'édition que sur sa vue en lecture seule, et sur les lignes de la table de la collection. Par défaut, elle attend dans le menu de débordement (⋮) à ces deux endroits.

Définissez `collapsed: false` sur l'action pour laquelle les utilisateurs ouvrent l'enregistrement, et elle obtiendra son propre bouton :

- **Sur l'enregistrement**, elle devient un bouton avec libellé dans la barre, avant Enregistrer (ou Modifier, sur la vue en lecture seule). Lorsque la barre manque de place, comme dans un panneau latéral, une boîte de dialogue ou une fenêtre étroite, les boutons perdent d'abord leurs libellés et conservent l'icône, avec le nom dans une infobulle. Si l'espace est encore insuffisant, les derniers déclarés se replient dans le menu ; déclarez donc les plus importants en premier.
- **Sur une ligne de table**, elle devient une icône à côté de Modifier au survol de la ligne.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Réservez cela pour la ou les deux actions qui justifient l'ouverture de l'enregistrement. Le reste est plus lisible dans le menu, qui les liste en trois groupes : les actions propres à la collection d'abord, dans l'ordre où vous les avez déclarées ; puis Copier, Historique et Inspecter ; puis Supprimer, en dernier et séparé.

| Propriété | Valeur par défaut | Effet |
|-----------|-------------------|-------|
| `collapsed` | `true` | `false` transforme l'action en bouton sur l'enregistrement et en icône sur la ligne de table |
| `includeInForm` | `true` | `false` exclut l'action de l'enregistrement et la laisse sur les lignes de la collection |
| `showActionsInListView` | `false` | `true` affiche l'action sous forme d'icône sur chaque ligne de la vue en liste |
| `isEnabled` | — | Renvoyez `false` pour afficher l'action désactivée, sous forme de bouton ou d'élément de menu |
| `disabledReason` | — | Indique pourquoi une action désactivée n'est pas disponible : sous son nom dans un menu, et sous forme d'infobulle pour un bouton ou une icône désactivé(e) |
| `nameKey` | — | Une clé de traduction pour le nom. L'admin affiche sa traduction dans la langue actuelle, et `name` lorsque la clé n'en a pas. Les actions intégrées la définissent, afin que Modifier, Copier et Supprimer suivent la langue de l'admin |

Une action désactivée qui n'indique pas pourquoi semble défectueuse. `disabledReason` reçoit les mêmes props que `isEnabled`, afin de pouvoir préciser ce qui manque :

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Sur l'enregistrement, un bouton dont le `onClick` retourne une promesse en attente affiche un indicateur de chargement et ne peut pas être cliqué à nouveau tant que la promesse n'est pas résolue. Si l'action lève une exception ou si sa promesse est rejetée, l'utilisateur voit l'erreur dans une notification. La vue en lecture seule ne comporte pas de formulaire, donc `formContext` y est indéfini.

## Actions de collection

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`Actions` place vos propres composants dans la barre d'outils de la collection, pour agir sur
l'ensemble de la collection ou sur les lignes sélectionnées : voir `PublishSelected` plus haut. Il s'agit d'une
liste, plusieurs actions peuvent donc être composées.

Une action reçoit `CollectionActionsProps`. Chacune manipule les lignes telles que le serveur
les envoie, la forme retournée par `useRows` :

| Propriété | Ce que c'est |
|-----------|--------------|
| `selectionController` | La sélection de la vue. `selection` est `{ type: "rows", ids, rows }` pour les lignes cochées, ou `{ type: "query", query, excludedIds, count }` pour "tous les éléments correspondants" ; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La requête en direct de la vue : `rows`, `loading`, `error`, ainsi que le filtre, la recherche et le tri que la barre d'outils partage (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | L'emplacement de la collection, sa configuration et le contexte de l'admin. |
| `openNewDocument(defaults?)` | Ouvre le formulaire de nouvel enregistrement, pré-rempli. |

Pour conserver certaines lignes sélectionnées après avoir agi sur le reste, transmettez celles à conserver à
`setSelectedRows` :

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Actions de collection](/img/collection_actions.png)

## Prochaines étapes

- **[customizeTable](/docs/frontend/customize-table)** — Toutes les options de table
- **[Additional Columns](/docs/frontend/additional-columns)** — Colonnes de table calculées
- **[Custom Fields](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
