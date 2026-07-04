---
title: Datenexport
sidebar_label: Datenexport
description: Exportiert Sammlungsdaten in die Formate CSV und JSON.
---

## Übersicht

Exportieren Sie Daten aus jeder Sammlung in das CSV- oder JSON-Format.

## So exportieren Sie

1. Öffnen Sie eine Sammlung
2. Klicken Sie in der Symbolleiste auf die Schaltfläche **Exportieren**
3. Wählen Sie das Format (CSV oder JSON)
4. Filtern Sie optional vor dem Export, um eine Untermenge zu exportieren

## Konfiguration

```typescript
const productsCollection: CollectionConfig = {
    slug: "products",
    exportable: true,            // Enable (default: true)
    // Or with config:
    exportable: {
        additionalFields: [
            {
                key: "computed_margin",
                title: "Margin",
                builder: ({ entity }) => {
                    return entity.values.price - entity.values.cost;
                }
            }
        ]
    },
    properties: { /* ... */ }
};
```

## Nächste Schritte

- **[Datenimport](/docs/features/data-import)** — Daten aus Dateien importieren

---
