---
sourceHash: a0b64d909e3d8229
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
5. Obtén una vista previa de los datos, incluidos los valores que no se puedan convertir
6. Haz clic en **Save data** para escribir las filas

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
- La **conversión de tipos** convierte cada celda al tipo de la propiedad con la que se mapea, pero solo cuando no se pierde nada (ver más abajo)

### Conversión de tipos

Una celda se convierte solo cuando el tipo de la propiedad puede contener exactamente lo que dice:

| Tipo de propiedad | Convierte | No convierte |
|---|---|---|
| Número | `12`, `-3.5`, `10.00`, `1e3` | `02134` (se perdería el cero inicial), números con más de 15 cifras significativas, `1,234`, `$5.00`, `12%`, `N/A` |
| Booleano | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, en cualquier combinación de mayúsculas y minúsculas | cualquier otra cosa |
| Fecha | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), fechas escritas (`5 Jan 2024`), `05/01/2024`, segundos o milisegundos desde el epoch | texto que no nombra ninguna fecha |

Una fecha sin hora es ese día en UTC. Para fechas escritas como `05/01/2024`, la columna decide el orden: un primer número superior a 12 hace que la columna sea día-primero, un segundo número superior a 12 hace que sea mes-primero. Cuando una columna nunca lo indica, decide el idioma/región (locale) del navegador, y cuando contiene ambos órdenes, una fecha que cualquiera de los dos órdenes podría leer no se convierte.

Una celda en blanco no es un valor: no establece nada, y se aplica el valor por defecto que elegiste para esa propiedad.

### Valores que no se pueden importar

La vista previa enumera cada celda que no se convierte, por columna, con cuántas hay y las primeras por fila y motivo. Esas celdas se dejan vacías en las filas importadas; nada se convierte en `0`, `false` o un valor vacío sin aparecer en la lista. Vuelve atrás para mapear la columna con otra propiedad, o corrige el archivo y vuelve a subirlo.

Las propias reglas de la colección — campos obligatorios, opciones de enum, valores únicos — las comprueba el servidor a medida que se escriben las filas, de 25 en 25. Si se rechaza una fila, la importación se detiene y la identifica; las filas anteriores a ella ya están guardadas, y **Retry** continúa desde la fila rechazada.

### Crear una colección a partir de un archivo

Cuando creas una colección a partir de un archivo, el tipo de cada columna se infiere a partir de sus valores. Una columna es numérica solo si todos sus valores son un número o un texto que se convierte en uno exactamente, así que una columna de códigos postales, códigos de producto con ceros iniciales, SKU largos o números de teléfono se queda como texto. Una columna que mezcla tipos (números y palabras, booleanos y números) es texto. Las celdas en blanco no cuentan, así que una columna casi vacía no se marca como obligatoria.

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
- **[SDK tipado](/docs/sdk)** — Acceso programático a datos
