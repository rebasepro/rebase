---
sourceHash: 3c089e6c404f4635
title: Colonnes supplémentaires
sidebar_label: Colonnes supplémentaires
description: Ajoutez des colonnes calculées/virtuelles aux tables de collection qui dérivent des valeurs à partir des données de l'entité.
---

## Aperçu

Les colonnes supplémentaires vous permettent d'afficher des données calculées ou dérivées dans la table de collection sans les stocker dans la base de données.

Une colonne calculée appartient à la table. L'enregistrement affiche déjà les valeurs à partir desquelles elle est calculée, elle ne figure donc pas sur l'enregistrement à moins que le formulaire ne le demande : indiquez sa `key` dans `form.sections` ou `form.sidebar` (voir [Form layout](/docs/frontend/form-layout/)), ou dans les `fields` fournis à un `RecordForm` ou `RecordDetail`.

## Définir des colonnes supplémentaires

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { AdditionalFieldKey } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    additionalFields: [
        {
            key: "total",
            name: "Total",
            Builder: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                const total = items.reduce(
                    (sum: number, item: { price?: number; quantity?: number }) =>
                        sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                );
                return <span>{total.toFixed(2)}</span>;
            },
            dependencies: ["items"],
            value: ({ row }) => {
                const items = Array.isArray(row.items) ? row.items : [];
                return items.length;
            }
        }
    ],
    fieldOrder: ["name", "total" as AdditionalFieldKey, "status"],
});
```

| Clé | Ce qu'elle fait |
|---|---|
| `key` | Identifie la colonne. Spécifiez-la dans `fieldOrder` ou `listFields` sous la forme `"total" as AdditionalFieldKey`. |
| `name` | L'en-tête. |
| `width` | La largeur, en pixels. |
| `Builder` | Rend la cellule. |
| `dependencies` | Les champs dont la modification déclenche un nouveau rendu de la cellule ; vérifiés par rapport à la table. |
| `value` | La valeur de la cellule, pour l'exportation. |

## Props de Builder

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | L'enregistrement tel que le serveur envoie la ligne : les dates sous forme de chaînes ISO, un belongsTo sous sa colonne de clé étrangère, `id` uniquement lorsque la table possède cette colonne. Une relation chargée par l'administrateur est imbriquée sous son nom sous forme des propres colonnes de l'enregistrement associé |
| `id` | `string` | L'identifiant de l'enregistrement : sa clé primaire sous forme de chaîne, les parties d'une clé composite étant jointes par `:::`. L'identifiant que prennent `useSidePanel().open` et une route |
| `context` | `RebaseContext` | Contexte Rebase complet |

`value({ row, id, context })` reçoit les mêmes props.

## Prochaines étapes

- **[Entity Actions](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Custom Fields](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
