---
title: Esportazione Dati
sidebar_label: Esportazione Dati
slug: docs/features/data-export
description: Esporta i dati della collezione nei formati CSV e JSON.
---

## Panoramica

Esporta i dati da qualsiasi collezione nei formati CSV o JSON.

## Come Esportare

1. Apri una collezione
2. Clicca il pulsante **Esporta** nella barra degli strumenti
3. Scegli il formato (CSV o JSON)
4. Facoltativamente, filtra prima dell'esportazione per esportare un sottoinsieme

## Configurazione

```typescript
const productsCollection: EntityCollection = {
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

## Prossimi Passi

- **[Importazione Dati](/docs/features/data-import)** — Importa dati da file

---
