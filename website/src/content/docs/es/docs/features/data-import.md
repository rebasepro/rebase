---
title: Importación de Datos
sidebar_label: Importación de Datos
slug: docs/features/data-import
description: Importa datos de archivos CSV, JSON y Excel a tus colecciones con mapeo de campos y validación.
---

## Resumen

Rebase permite importar datos desde:

- archivos **CSV**
- archivos **JSON**
- archivos **Excel** (`.xlsx`)

El asistente de importación gestiona el mapeo de columnas, la coerción de tipos de datos y la validación.

## Cómo Importar

1. Abre una colección en el panel de administración
2. Haz clic en el botón **Importar** en la barra de herramientas
3. Selecciona o arrastra y suelta tu archivo
4. Mapea las columnas del archivo a las propiedades de la colección
5. Previsualiza los datos y resuelve cualquier error de validación
6. Haz clic en **Importar** para guardar todas las entidades

![Interfaz de importación de datos](/img/data_import.png)

## Configuración

Habilitar/deshabilitar la importación por colección:

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    // Import is enabled by default
    // To disable:
    // importable: false
    properties: { /* ... */ }
};
```

## Próximos Pasos

- **[Exportación de Datos](/docs/features/data-export)** — Exporta datos a CSV/JSON

---
