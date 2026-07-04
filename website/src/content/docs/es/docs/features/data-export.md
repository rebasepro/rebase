---
title: Exportación de Datos
sidebar_label: Exportación de Datos
description: Exporta datos de la colección a formatos CSV y JSON.
---

## Visión General

Exporta datos de cualquier colección a formato CSV o JSON.

## Cómo Exportar

1. Abre una colección
2. Haz clic en el botón **Exportar** de la barra de herramientas
3. Elige el formato (CSV o JSON)
4. Opcionalmente, filtra antes de exportar para exportar un subconjunto

## Configuración

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

## Próximos Pasos

- **[Importación de Datos](/docs/features/data-import)** — Importa datos desde archivos

---
