---
title: Colonnes supplémentaires
sidebar_label: Colonnes supplémentaires
description: Ajoutez des colonnes calculées/virtuelles aux tableaux de collection qui dérivent des valeurs des données d'entité.
---

## Aperçu

Les colonnes supplémentaires vous permettent d'afficher des données calculées ou dérivées dans le tableau de collection sans les stocker dans la base de données.

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
                Builder: ({ entity }) => {
                    const total = entity.values.items?.reduce(
                        (sum, item) => sum + (item.price * item.quantity), 0
                    ) ?? 0;
                    return <span>${total.toFixed(2)}</span>;
                }
            },
            {
                key: "status_badge",
                name: "Status",
                Builder: ({ entity }) => {
                    const color = entity.values.status === "completed" ? "green" : "orange";
                    return (
                        <span style={{ color }}>
                            {entity.values.status}
                        </span>
                    );
                },
                dependencies: ["status"]  // Re-render when these fields change
            }
        ]
    }
});

```

## Propriétés du Builder

| Propriété | Type | Description |
|------|------|-------------|
| `entity` | `Entity` | L'entité pour cette ligne |
| `context` | `RebaseContext` | Contexte Rebase complet |

## Prochaines étapes

- **[Actions d'entité](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Champs personnalisés](/docs/frontend/custom-fields)** — Champs de formulaire personnalisés

---
