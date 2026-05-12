---
title: Zusätzliche Spalten
sidebar_label: Zusätzliche Spalten
slug: de/docs/frontend/additional-columns
description: Fügen Sie berechnete/virtuelle Spalten zu Sammlungstabellen hinzu, die Werte aus Entitätsdaten ableiten.
---

## Übersicht

Zusätzliche Spalten ermöglichen es Ihnen, berechnete oder abgeleitete Daten in der Sammlungstabelle anzuzeigen, ohne sie in der Datenbank zu speichern.

## Definieren zusätzlicher Spalten

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

## Builder-Eigenschaften

| Eigenschaft | Typ | Beschreibung |
|------|------|-------------|
| `entity` | `Entity` | Die Entität für diese Zeile |
| `context` | `RebaseContext` | Voller Rebase-Kontext |

## Nächste Schritte

- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
- **[Custom Fields](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder

---
