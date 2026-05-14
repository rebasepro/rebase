---
title: Colonne Aggiuntive
sidebar_label: Colonne Aggiuntive
description: Aggiungi colonne calcolate/virtuali alle tabelle di collezione che derivano valori dai dati dell'entità.
---

## Overview

Le colonne aggiuntive ti permettono di visualizzare dati calcolati o derivati nella tabella di collezione senza memorizzarli nel database.

## Definizione di Colonne Aggiuntive

```typescript
const ordersCollection: EntityCollection = {
    slug: "orders",
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
    ],
    properties: { /* ... */ }
};
```

## Proprietà Builder

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `entity` | `Entity` | L'entità per questa riga |
| `context` | `RebaseContext` | Contesto Rebase completo |

## Passi Successivi

- **[Azioni Entità](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Campi modulo personalizzati

---
