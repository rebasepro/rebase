---
sourceHash: 2e2dfa451a30f422
title: Importación y exportación de datos
sidebar_label: Importación y exportación de datos
description: Importa datos de archivos CSV, JSON y Excel a tus colecciones, y exporta datos de colecciones a CSV o JSON con campos calculados opcionales.
---

## Descripción general

Rebase incluye herramientas integradas de importación y exportación de datos accesibles directamente desde el panel de administración. La importación admite archivos CSV, JSON y Excel con un asistente de mapeo de columnas. La exportación admite CSV y JSON con campos calculados opcionales.

Ambas opciones están disponibles en todas las colecciones. La exportación se puede configurar por colección con campos calculados; ninguna de las dos se puede desactivar por colección.

## Importación de datos

### Cómo importar

1. Abre una colección en el panel de administración
2. Haz clic en el botón **Import** en la barra de herramientas
3. Selecciona o arrastra y suelta tu archivo
4. Mapea las columnas del archivo con las propiedades de la colección
5. Obtén una vista previa de los datos y resuelve cualquier error de validación
6. Haz clic en **Import** para guardar todas las entidades

### Formatos admitidos

| Formato | Extensiones | Notas |
|---------|-------------|-------|
| CSV | `.csv` | Detecta delimitadores automáticamente |
| JSON | `.json` | Espera un array de objetos |
| Excel | `.xlsx` | Lee la primera hoja |

### Mapeo de columnas

El asistente de importación intenta automáticamente hacer coincidir las columnas del archivo con las propiedades de la colección por su nombre. Puedes ajustar manualmente los mapeos antes de importar:

- Las **coincidencias exactas** se mapean automáticamente (p. ej., `name` → `name`)
- Las **columnas no coincidentes** se pueden mapear manualmente u omitir
- La **coerción de tipos** gestiona conversiones de cadena a número, de cadena a booleano y el procesamiento de fechas

### Validación

Antes de importar, el asistente valida todas las filas con respecto a las definiciones de propiedades de tu colección:

- Los campos obligatorios deben estar presentes
- Los valores de enumeración (enum) deben coincidir con las opciones definidas
- Los tipos de datos deben ser compatibles (p. ej., un valor de texto en un campo numérico se marcará)
- Los errores de validación se muestran fila por fila para que puedas corregirlos antes de importar

### Configuración de importación

La importación está disponible en todas las colecciones. No existe ninguna configuración por colección para desactivarla.

## Exportación de datos

### Cómo exportar

1. Abre una colección en el panel de administración
2. Opcionalmente, aplica filtros para exportar un subconjunto de datos
3. Haz clic en el botón **Export** en la barra de herramientas
4. Elige el formato: **CSV** o **JSON**
5. El archivo se descargará de inmediato

### Formatos de exportación

| Formato | Descripción |
|---------|-------------|
| CSV | Valores separados por comas, compatible con Excel y Google Sheets |
| JSON | Array de objetos, útil para el consumo programático |

### Filtrado antes de exportar

Cualquier filtro activo en la vista de la colección se aplica a la exportación. Esto te permite exportar solo un subconjunto de tus datos:

- Aplica filtros de columna o términos de búsqueda en la vista de la colección
- Haz clic en **Export**; solo se incluirán las filas filtradas

### Configuración de exportación

La exportación está disponible en todas las colecciones. `admin.exportable` la configura: asígnale un `ExportConfig` para agregar columnas calculadas, como se muestra a continuación. El tipo también acepta un booleano, pero nada lo lee; `exportable: false` no elimina el botón **Export**.

### Agregar campos calculados

Usa el objeto `ExportConfig` para agregar columnas calculadas personalizadas a tus exportaciones. Estas columnas no existen en la base de datos; se calculan en el momento de la exportación:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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
|-----------|------|-------------|
| `key` | `string` | Nombre de la columna en la exportación |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Función que calcula el valor |

La función `builder` recibe la `entity` actual y el `RebaseContext` (que incluye al usuario autenticado), por lo que puedes calcular valores basándote tanto en los datos como en los permisos.

### Campos calculados asíncronos

La función `builder` puede ser asíncrona, lo cual resulta útil cuando el valor calculado requiere una consulta a la base de datos o una llamada a la API:

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

## Próximos pasos

- **[Collections](/docs/collections)** — Define tu modelo de datos
- **[Frontend Overview](/docs/frontend)** — Panel de administración y componentes de interfaz de usuario
- **[Client SDK](/docs/sdk)** — Acceso programático a datos
