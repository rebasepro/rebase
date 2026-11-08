---
sourceHash: 6af581ed5e4c92e6
title: Colonne aggiuntive
sidebar_label: Colonne aggiuntive
description: Aggiungi alle tabelle delle collezioni colonne calcolate/virtuali che derivano valori dai dati dell'entità.
---

## Panoramica

Le colonne aggiuntive consentono di visualizzare dati calcolati o derivati nella tabella della collezione senza archiviarli nel database.

## Definire colonne aggiuntive

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

## Props di Builder

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Il record così come il server invia la riga: date come stringhe ISO, un belongsTo come relativa colonna di chiave esterna, `id` incluso |
| `context` | `RebaseContext` | Contesto Rebase completo |

`value({ row, context })` riceve le stesse prop.

## Prossimi passi

- **[Azioni entità](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Campi personalizzati](/docs/frontend/custom-fields)** — Campi del modulo personalizzati
