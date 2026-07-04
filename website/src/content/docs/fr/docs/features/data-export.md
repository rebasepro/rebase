---
title: Exportation de données
sidebar_label: Exportation de données
description: Exporter les données de collection aux formats CSV et JSON.
---

## Vue d'ensemble

Exportez des données de n'importe quelle collection aux formats CSV ou JSON.

## Comment exporter

1.  Ouvrez une collection
2.  Cliquez sur le bouton **Exporter** dans la barre d'outils
3.  Choisissez le format (CSV ou JSON)
4.  Filtrez éventuellement avant d'exporter pour exporter un sous-ensemble

## Configuration

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

## Prochaines étapes

- **[Importation de données](/docs/features/data-import)** — Importer des données depuis des fichiers

---
