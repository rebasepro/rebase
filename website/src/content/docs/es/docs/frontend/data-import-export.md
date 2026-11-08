---
sourceHash: 8df0ef82748b614e
title: Importación y exportación de datos
sidebar_label: Importación y exportación de datos
description: Importa datos de archivos CSV, JSON y Excel a tus colecciones, y exporta datos de colecciones a CSV o JSON con campos calculados opcionales.
---

## Descripción general

Rebase incluye herramientas integradas de importación y exportación de datos accesibles directamente desde el panel de administración. La importación admite archivos CSV, JSON y Excel con un asistente de mapeo de columnas. La exportación admite CSV y JSON con campos calculados opcionales.

Ambas opciones están disponibles en cada colección. La exportación se puede configurar por colección con campos calculados, o desactivarse con `exportable: false`; la importación no se puede desactivar por colección.

## Importación de datos

### Cómo importar

1. Abre una colección en el panel de administración
2. Haz clic en el botón **Import** en la barra de herramientas
3. Selecciona o arrastra y suelta tu archivo
4. Mapea las columnas del archivo con las propiedades de la colección
5. Previsualiza los datos, incluidos los valores que no se puedan convertir
6. Haz clic en **Save data** para guardar las filas

### Formatos admitidos

| Formato | Extensiones | Notas |
|---------|-------------|-------|
| CSV | `.csv` | Detecta delimitadores automáticamente |
| JSON | `.json` | Espera un array de objetos |
| Excel | `.xlsx` | Lee la primera hoja |

### Mapeo de columnas

El asistente de importación intenta automáticamente hacer coincidir las columnas del archivo con las propiedades de la colección por su nombre. Puedes ajustar manualmente los mapeos antes de importar:

- **Las coincidencias exactas** se mapean automáticamente (por ejemplo, `name` → `name`)
- **Las columnas no coincidentes** se pueden mapear manualmente u omitir
- **La conversión de tipos** transforma cada celda al tipo de la propiedad a la que se mapea, pero solo cuando no se pierde nada (ver más abajo)

### Conversión de tipos

Una celda solo se convierte cuando el tipo de la propiedad puede contener exactamente lo que indica:

| Tipo de propiedad | Se convierte | No se convierte |
|---|---|---|
| Número | `12`, `-3.5`, `10.00`, `1e3` | `02134` (se perdería un cero a la izquierda), números con más de 15 dígitos significativos, `1,234`, `$5.00`, `12%`, `N/A` |
| Booleano | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, sin distinguir mayúsculas de minúsculas | cualquier otra cosa |
| Fecha | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), fechas escritas (`5 Jan 2024`), `05/01/2024`, segundos o milisegundos de época (epoch) | texto que no indique una fecha |
| Geopoint | el objeto que escribe la exportación, `{"latitude": 41.9, "longitude": 12.5}`, o su JSON en una celda CSV | cualquier otra cosa, o una coordenada fuera de rango |
| Map sin campos declarados | un objeto, o su JSON en una celda CSV | cualquier otra cosa |
| Vector | una lista de números (`[0.1, 0.2]`, `0.1, 0.2`), o el `{"value": [0.1, 0.2]}` de la exportación | una lista que contenga cualquier cosa que no sea un número |

Una fecha sin hora corresponde a ese día en UTC. Para fechas escritas como `05/01/2024`, la columna decide el orden: un primer número mayor de 12 hace que la columna coloque primero el día; un segundo número mayor de 12 hace que coloque primero el mes. Cuando una columna no lo determina en ningún momento, la configuración regional (locale) del navegador decide, y cuando contiene ambos órdenes, una fecha que cualquiera de los órdenes podría interpretar no se convierte.

Una celda en blanco equivale a la ausencia de valor: no establece nada y se aplica el valor por defecto que hayas elegido para esa propiedad.

Un archivo exportado desde una colección se vuelve a importar con los mismos valores, ya sea CSV o JSON. Un map con campos declarados se lee con una columna por campo (`address.street`), tal como lo escribe la exportación; cualquier otro valor, incluidos los geopoints o los maps de clave-valor, ocupa una sola columna. Un número de época (epoch) entre -100,000,000,000 y 100,000,000,000 se lee en segundos, por lo que una fecha entre el 31 de octubre de 1966 y el 3 de marzo de 1973 exportada como marca de tiempo (timestamp) no se recupera: exporta esas fechas como texto. Un campo de hora del día lee un número menor a un día (86,400,000) como los milisegundos desde la medianoche que escribe la exportación.

### Valores que no se pueden importar

La vista previa enumera cada celda que no se convierte, por columna, indicando cuántas hay y las primeras de ellas por fila y motivo. Esas celdas se dejan vacías en las filas importadas; nada se convierte en `0`, `false` o un valor vacío sin ser listado. Vuelve atrás para mapear la columna a otra propiedad, o corrige el archivo y súbelo de nuevo.

Las propias reglas de la colección —campos obligatorios, opciones de enum, valores únicos— son verificadas por el servidor a medida que se escriben las filas, en lotes de hasta 500 filas (menos si las filas son anchas, para que la solicitud se mantenga por debajo de aproximadamente 1 MB). Un lote se guarda en su totalidad o no se guarda en absoluto. Si se rechaza una fila, la importación se detiene y la señala; los lotes anteriores ya están guardados y **Retry** reanuda desde la primera fila del lote de la fila rechazada.

Una fila cuyo id ya está en la colección actualiza ese registro: las columnas que contiene el archivo se escriben y las demás conservan sus valores almacenados, de modo que un archivo con `id,price` actualiza los precios de productos existentes sin necesidad de repetir sus campos obligatorios. Una fila nueva sigue necesitando cada campo obligatorio. Un lote que combina actualizaciones y filas nuevas se escribe en dos solicitudes, por lo que una fila nueva rechazada puede dejar guardadas las actualizaciones de ese lote; **Retry** las vuelve a escribir con los mismos valores.

### Importación de usuarios

Una fila nueva en la colección de usuarios representa la creación de un usuario: la columna `password` se procesa mediante hash, nunca se almacena tal como está escrita, y una fila sin ella recibe una contraseña generada o una invitación, al igual que cuando un administrador agrega un usuario. Las contraseñas en dicho archivo generalmente se definieron bajo las reglas de otro sistema, por lo que la importación solicita al servidor omitir la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) para esas filas. El servidor solo lo permite si eres un administrador; a cualquier otra persona que importe usuarios se le exige cumplir con la política, y una contraseña débil detendrá la importación con `WEAK_PASSWORD`.

### Creación de una colección a partir de un archivo

Cuando creas una colección a partir de un archivo, el tipo de cada columna se infiere a partir de sus valores. Una columna es de tipo numérico solo si cada valor en ella es un número o un texto que se convierte exactamente en uno; por lo tanto, una columna de códigos postales, códigos de producto con ceros a la izquierda, SKUs largos o números de teléfono se mantiene como texto. Una columna que mezcla tipos (números y palabras, booleanos y números) es de tipo texto. Las celdas en blanco no cuentan, por lo que una columna mayormente vacía no se marca como obligatoria. Una columna de números enteros cuyo nombre termina en una palabra que indica que representa un momento (`created_at`, `updatedAt`, `signup_date`, `timestamp`) es de tipo fecha cuando cada valor es una marca de tiempo epoch entre 2001 y 2103, en segundos o milisegundos; con cualquier otro nombre, o con cualquier otro valor, se mantiene como un número.

### Configuración de importación

La importación está disponible en cada colección. No existe una opción de configuración por colección que la desactive.

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

Cualquier filtro activo en la vista de la colección se aplica a la exportación. Esto te permite exportar únicamente un subconjunto de tus datos:

- Aplica filtros de columna o términos de búsqueda en la vista de la colección
- Haz clic en **Export** — solo se incluirán las filas filtradas

### Configuración de exportación

La exportación está disponible en cada colección a menos que la desactives. `admin.exportable` permite configurarla: `exportable: false` elimina el botón **Export**, y un `ExportConfig` lo mantiene y agrega columnas calculadas, como se muestra a continuación.

### Adición de campos calculados

Usa el objeto `ExportConfig` para agregar columnas calculadas personalizadas a tus exportaciones. Estas columnas no existen en la base de datos: se calculan en el momento de la exportación:

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
                    builder: ({ row }) => {
                        const price = Number(row.price ?? 0);
                        const cost = Number(row.cost ?? 0);
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ id }) => {
                        return `https://mystore.com/products/${id}`;
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
| `builder` | `({ row, id, context }) => string \| Promise<string>` | Función que calcula el valor |

La función `builder` recibe cada registro exportado como `row`, con la estructura enviada por el servidor (fechas como cadenas ISO, una relación belongsTo como su columna de clave foránea, `id` solo donde la tabla tenga esa columna), el `id` del registro junto a él (su clave primaria como una cadena de texto, o las partes de una clave compuesta unidas por `:::`), y el `RebaseContext` (que incluye al usuario autenticado), de modo que puedas calcular valores basados tanto en los datos como en los permisos.

### Campos calculados asíncronos

La función `builder` puede ser asíncrona (`async`), lo cual es útil cuando el valor calculado requiere una consulta a la base de datos o una llamada a una API:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ row, context }) => {
                const author = await context.data.users.findById(String(row.authorId));
                // `context.data` returns the row itself: its columns are on it.
                return String(author?.displayName ?? "Unknown");
            }
        }
    ]
}
```

## Pasos siguientes

- **[Colecciones](/docs/collections)** — Define tu modelo de datos
- **[Descripción general del Frontend](/docs/frontend)** — Panel de administración y componentes de interfaz de usuario
- **[SDK con tipos](/docs/sdk)** — Acceso programático a datos
