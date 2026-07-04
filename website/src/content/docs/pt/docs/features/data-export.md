---
title: Exportação de Dados
sidebar_label: Exportação de Dados
description: Exporte dados de coleções para os formatos CSV e JSON.
---

## Visão Geral

Exporte dados de qualquer coleção para o formato CSV ou JSON.

## Como Exportar

1. Abra uma coleção
2. Clique no botão **Exportar** na barra de ferramentas
3. Escolha o formato (CSV ou JSON)
4. Opcionalmente, filtre antes de exportar para exportar um subconjunto

## Configuração

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

## Próximos Passos

- **[Importação de Dados](/docs/features/data-import)** — Importe dados de arquivos

---
