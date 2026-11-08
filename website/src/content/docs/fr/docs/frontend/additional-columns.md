---
sourceHash: 6af581ed5e4c92e6
title: Colonnes additionnelles
sidebar_label: Colonnes additionnelles
description: Ajoutez des colonnes calculées/virtuelles aux tableaux de collections qui dérivent des valeurs à partir des données d'entité.
---

## Aperçu

Les colonnes additionnelles vous permettent d'afficher des données calculées ou dérivées dans le tableau de la collection sans les stocker dans la base de données.

## Définir des colonnes additionnelles

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
| `row` | `Record<string, unknown>` | L'enregistrement tel que le serveur renvoie la ligne : dates sous forme de chaînes ISO, un belongsTo sous forme de sa colonne de clé étrangère, `id` inclus |
| `context` | `RebaseContext` | Contexte Rebase complet |

`value({ row, context })` reçoit les mêmes props.

## Prochaines étapes

- **[Entity Actions](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Custom Fields](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés
