---
sourceHash: ec63c3fff5d4bc62
title: Colonnes supplémentaires
sidebar_label: Colonnes supplémentaires
description: Ajoutez des colonnes calculées/virtuelles aux tableaux de collection dérivant leurs valeurs des données d'entité.
---

## Vue d'ensemble

Les colonnes supplémentaires vous permettent d'afficher des données calculées ou dérivées dans le tableau de la collection sans les stocker dans la base de données.

## Définir des colonnes supplémentaires

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        items: {
            name: "Items",
            type: "array",
            of: {
                name: "Item",
                type: "map",
                properties: {
                    price: { name: "Price", type: "number" },
                    quantity: { name: "Quantity", type: "number" }
                }
            }
        },
        status: { name: "Status", type: "string" }
    },
    admin: {
        additionalFields: [
            {
                key: "total_display",
                name: "Total",
                Builder: ({ row }) => {
                    const items = Array.isArray(row.items) ? row.items : [];
                    const total = items.reduce(
                        (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0
                    );
                    return <span>${total.toFixed(2)}</span>;
                }
            },
            {
                key: "status_badge",
                name: "Status",
                Builder: ({ row }) => {
                    const color = row.status === "completed" ? "green" : "orange";
                    return (
                        <span style={{ color }}>
                            {String(row.status ?? "")}
                        </span>
                    );
                },
                dependencies: ["status"]  // Re-render when these fields change
            }
        ]
    }
});

```

## Props du Builder

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | L'enregistrement tel que le serveur renvoie la ligne : les dates sous forme de chaînes ISO, un belongsTo sous forme de sa colonne de clé étrangère, `id` uniquement lorsque la table possède cette colonne. Une relation chargée par l'admin est imbriquée sous son nom avec les propres colonnes de l'enregistrement associé |
| `id` | `string` | L'identifiant de l'enregistrement : sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite jointes par `:::`. L'identifiant que prennent `useSidePanel().open` et une route |
| `context` | `RebaseContext` | Contexte Rebase complet |

`value({ row, id, context })` reçoit les mêmes props.

## Prochaines étapes

- **[Actions d'entité](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Champs personnalisés](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
