---
title: Importación y Exportación de Datos
sidebar_label: Importación y Exportación de Datos
description: Importe datos desde archivos CSV, JSON y Excel a sus colecciones, y exporte los datos de las colecciones a CSV o JSON con campos calculados opcionales.
---

## Resumen

Rebase incluye herramientas integradas de importación y exportación de datos accesibles directamente desde el panel de administración. La importación admite archivos CSV, JSON y Excel con un asistente de mapeo de columnas. La exportación admite CSV y JSON con campos calculados opcionales.

Ambas funciones están habilitadas de forma predeterminada en todas las colecciones y pueden configurarse o desactivarse por colección.

## Importación de Datos

### Cómo Importar

1. Abra una colección en el panel de administración
2. Haga clic en el botón **Importar** en la barra de herramientas
3. Seleccione o arrastre y suelte su archivo
4. Mapee las columnas del archivo a las propiedades de la colección
5. Previsualice los datos y resuelva cualquier error de validación
6. Haga clic en **Importar** para guardar todas las entidades

### Formatos Soportados

| Formato | Extensiones | Notas |
|--------|-----------|-------|
| CSV | `.csv` | Detecta automáticamente los delimitadores |
| JSON | `.json` | Espera un array de objetos |
| Excel | `.xlsx` | Lee la primera hoja |

### Mapeo de Columnas

El asistente de importación intenta automáticamente hacer coincidir las columnas del archivo con las propiedades de la colección por nombre. Puede ajustar los mapeos manualmente antes de importar:

- Las **coincidencias exactas** se mapean automáticamente (p. ej., `name` → `name`)
- Las **columnas sin coincidencia** pueden mapearse manualmente u omitirse
- La **coerción de tipos** gestiona la conversión de string a número, de string a booleano y el parseo de fechas

### Validación

Antes de importar, el asistente valida todas las filas contra las definiciones de propiedades de su colección:

- Los campos requeridos deben estar presentes
- Los valores enum deben coincidir con las opciones definidas
- Los tipos de datos deben ser compatibles (p. ej., un valor de texto para un campo numérico se marca)
- Los errores de validación se muestran por fila para que pueda corregirlos antes de importar

### Configuración de Importación

La importación está habilitada de forma predeterminada. Para desactivarla en una colección específica, use el sub-objeto `admin`:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    // Import is enabled by default
});
```

## Exportación de Datos

### Cómo Exportar

1. Abra una colección en el panel de administración
2. Opcionalmente aplique filtros para exportar un subconjunto de datos
3. Haga clic en el botón **Exportar** en la barra de herramientas
4. Elija el formato: **CSV** o **JSON**
5. El archivo se descarga de inmediato

### Formatos de Exportación

| Formato | Descripción |
|--------|-------------|
| CSV | Valores separados por comas, compatible con Excel y Google Sheets |
| JSON | Array de objetos, útil para el consumo programático |

### Filtrado Antes de Exportar

Cualquier filtro activo en la vista de la colección se aplica a la exportación. Esto le permite exportar solo un subconjunto de sus datos:

- Aplique filtros de columna o términos de búsqueda en la vista de la colección
- Haga clic en **Exportar** — solo se incluyen las filas filtradas

### Configuración de Exportación

La exportación está habilitada de forma predeterminada. Puede configurarla con campos calculados adicionales:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: true            // Enable (default: true)
    }
});

```

Para desactivar la exportación:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: false
    }
});

```

### Añadir Campos Calculados

Use el objeto `ExportConfig` para añadir columnas calculadas personalizadas a sus exportaciones. Estas columnas no existen en la base de datos — se calculan en el momento de la exportación:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: {
            additionalFields: [
                {
                    key: "computed_margin",
                    builder: ({ entity }) => {
                        const price = entity.values.price as number;
                        const cost = entity.values.cost as number;
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ entity }) => {
                        return `https://mystore.com/products/${entity.id}`;
                    }
                }
            ]
        }
    }
});

```

Cada entrada de `additionalFields` tiene:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `key` | `string` | Nombre de la columna en la exportación |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Función que calcula el valor |

La función `builder` recibe la `entity` actual y el `RebaseContext` (que incluye el usuario autenticado), por lo que puede calcular valores basándose tanto en los datos como en los permisos.

### Campos Calculados Asíncronos

La función `builder` puede ser asíncrona, lo que es útil cuando el valor calculado requiere una consulta a la base de datos o una llamada a la API:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ entity, context }) => {
                const author = await context.data.users.findById(
                    entity.values.authorId as string
                );
                return author?.values.displayName ?? "Unknown";
            }
        }
    ]
}
```

## Próximos Pasos

- **[Colecciones](/docs/collections)** — Defina su modelo de datos
- **[Resumen del Frontend](/docs/frontend)** — Panel de administración y componentes de UI
- **[SDK del Cliente](/docs/sdk)** — Acceso programático a los datos
