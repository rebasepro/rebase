---
sourceHash: 6af581ed5e4c92e6
title: Zusätzliche Spalten
sidebar_label: Zusätzliche Spalten
description: Berechnete/virtuelle Spalten zu Collection-Tabellen hinzufügen, die Werte aus Entitätsdaten ableiten.
---

## Übersicht

Zusätzliche Spalten ermöglichen es Ihnen, berechnete oder abgeleitete Daten in der Collection-Tabelle anzuzeigen, ohne sie in der Datenbank zu speichern.

## Zusätzliche Spalten definieren

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

## Builder-Props

| Prop | Typ | Beschreibung |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Der Datensatz, wie der Server die Zeile sendet: Datumsangaben als ISO-Strings, ein belongsTo als dessen Fremdschlüssel-Spalte, inklusive `id` |
| `context` | `RebaseContext` | Vollständiger Rebase-Kontext |

`value({ row, context })` erhält dieselben Props.

## Nächste Schritte

- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktions-Buttons
- **[Custom Fields](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder
