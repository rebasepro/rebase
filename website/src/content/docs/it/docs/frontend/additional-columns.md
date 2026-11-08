---
sourceHash: ec63c3fff5d4bc62
title: Colonne aggiuntive
sidebar_label: Colonne aggiuntive
description: Aggiungi colonne calcolate/virtuali alle tabelle delle collezioni che derivano valori dai dati delle entità.
---

## Panoramica

Le colonne aggiuntive consentono di visualizzare dati calcolati o derivati nella tabella della collezione senza archiviarli nel database.

## Definizione delle colonne aggiuntive

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

## Prop di Builder

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Il record così come il server invia la riga: date come stringhe ISO, un belongsTo come colonna di foreign key, `id` solo se la tabella include tale colonna. Una relazione caricata dall'admin è annidata sotto il proprio nome come colonne del record correlato |
| `id` | `string` | L'id del record: la sua chiave primaria come stringa, oppure le parti di una chiave composita unite da `:::`. L'id che `useSidePanel().open` e una route accettano |
| `context` | `RebaseContext` | Contesto completo di Rebase |

`value({ row, id, context })` riceve le stesse prop.

## Passaggi successivi

- **[Entity Actions](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Custom Fields](/docs/frontend/custom-fields)** — Campi modulo personalizzati
