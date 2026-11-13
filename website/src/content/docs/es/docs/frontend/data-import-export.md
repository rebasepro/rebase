---
sourceHash: 66fc9b42bef4d463
title: Importación y exportación de datos
sidebar_label: Importación y exportación de datos
description: Importe datos desde archivos CSV, JSON y Excel a sus colecciones, y exporte datos de colecciones a CSV o JSON con campos calculados opcionales.
---

## Información general

Rebase incluye herramientas integradas de importación y exportación de datos accesibles directamente desde el panel de administración. La importación admite archivos CSV, JSON y Excel con un asistente de asignación de columnas. La exportación admite CSV y JSON con campos calculados opcionales.

Ambas funciones están disponibles en cada colección. La exportación se puede configurar por colección con campos calculados, o desactivarse con `exportable: false`; la importación no se puede desactivar por colección.

## Importación de datos

### Cómo importar

1. Abra una colección en el panel de administración
2. Haga clic en el botón **Import** en la barra de herramientas
3. Seleccione o arrastre y suelte su archivo
4. Asigne las columnas del archivo a las propiedades de la colección
5. Obtenga una vista previa de los datos, incluidos los valores que no se puedan convertir
6. Haga clic en **Save data** para escribir las filas

### Formatos admitidos

| Formato | Extensiones | Notas |
|---------|-------------|-------|
| CSV | `.csv` | Detecta delimitadores automáticamente |
| JSON | `.json` | Espera un array de objetos |
| Excel | `.xlsx` | Lee la primera hoja |

### Asignación de columnas

El asistente de importación intenta asociar automáticamente las columnas del archivo con las propiedades de la colección por nombre. Puede ajustar manualmente las asignaciones antes de importar:

- Las **coincidencias exactas** se asignan automáticamente (por ejemplo, `name` → `name`)
- Las **columnas no coincidentes** se pueden asignar manualmente o ignorar
- La **conversión de tipos** convierte cada celda al tipo de la propiedad a la que se asigna, pero solo cuando no se pierde nada (consulte más abajo)

### Conversión de tipos

Una celda solo se convierte cuando el tipo de la propiedad puede albergar exactamente lo que contiene:

| Tipo de propiedad | Se convierte | No se convierte |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (se perdería un cero inicial), números con más de 15 dígitos significativos, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, en cualquier combinación de mayúsculas/minúsculas | cualquier otra cosa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), fechas escritas (`5 Jan 2024`), `05/01/2024`, segundos o milisegundos de época (epoch) | texto que no indique una fecha |
| Geopoint | el objeto que escribe la exportación, `{"latitude": 41.9, "longitude": 12.5}`, o su JSON en una celda CSV | cualquier otra cosa, o una coordenada fuera de rango |
| Map sin campos declarados | un objeto, o su JSON en una celda CSV | cualquier otra cosa |
| Vector | una lista de números (`[0.1, 0.2]`, `0.1, 0.2`), o el `{"value": [0.1, 0.2]}` de la exportación | una lista que contenga cualquier cosa que no sea un número |

Una fecha sin hora corresponde a ese día en UTC. Para fechas escritas como `05/01/2024`, la columna determina el orden: un primer número superior a 12 hace que la columna tome primero el día; un segundo número superior a 12 hace que tome primero el mes. Cuando una columna no lo especifica nunca, la configuración regional del navegador decide, y cuando contiene ambos órdenes, una fecha que cualquiera de los dos órdenes podría interpretar no se convierte.

Una celda en blanco equivale a la ausencia de valor: no establece nada y se aplica el valor predeterminado que haya elegido para esa propiedad.

Un archivo exportado de una colección se vuelve a importar con los mismos valores, ya sea CSV o JSON. Un mapa con campos declarados se lee a razón de una columna por campo (`address.street`), tal como lo escribe la exportación; cualquier otro valor, incluidos un geopoint o un mapa clave-valor, ocupa una columna. Un número de época entre -100,000,000,000 y 100,000,000,000 se lee como segundos, por lo que una fecha entre el 31 de octubre de 1966 y el 3 de marzo de 1973 exportada como marca de tiempo no se recupera: exporte esas fechas como texto. Un campo de hora del día lee un número inferior a un día (86,400,000) como los milisegundos transcurridos desde la medianoche que escribe la exportación.

### Valores que no se pueden importar

La vista previa lista cada celda que no se convierte, por columna, indicando cuántas hay y mostrando las primeras por fila y motivo. Esas celdas se dejan vacías en las filas importadas; nada se transforma en `0`, `false` o un valor vacío sin ser listado. Vuelva atrás para asignar la columna a otra propiedad, o corrija el archivo y súbalo de nuevo.

Las reglas propias de la colección —campos obligatorios, opciones de enum, valores únicos— son comprobadas por el servidor a medida que se escriben las filas, en lotes de hasta 500 filas (menos cuando las filas son anchas, para que la solicitud se mantenga por debajo de aproximadamente 1 MB). Un lote se guarda entero o no se guarda en absoluto. Si se rechaza una fila, la importación se detiene y la señala; los lotes anteriores a ella ya están guardados, y **Retry** se reanuda a partir de la primera fila del lote de la fila rechazada.

Una fila cuyo id ya existe en la colección actualiza ese registro: las columnas que contiene el archivo se escriben y las demás conservan sus valores almacenados, de modo que un archivo de `id,price` actualiza el precio de productos existentes sin repetir sus campos obligatorios. Una fila nueva sigue requiriendo cada campo obligatorio. Un lote que mezcla actualizaciones y filas nuevas se escribe en dos solicitudes, por lo que una fila nueva rechazada puede dejar guardadas las actualizaciones de ese lote; **Retry** las escribe de nuevo con los mismos valores.

### Importación de usuarios

Una nueva fila en la tabla de usuarios representa la creación de un usuario: una columna `password` se procesa mediante hash, nunca se almacena tal como está escrita, y una fila sin ella recibe una contraseña generada o una invitación, al igual que cuando un administrador añade un usuario. Por lo general, las contraseñas en dicho archivo se establecieron según las reglas de otro sistema, por lo que la importación solicita al servidor omitir la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) para esas filas. El servidor solo accede si usted es administrador; cualquier otra persona que importe usuarios está sujeta a la directiva, y una contraseña débil detiene la importación con `WEAK_PASSWORD`.

### Creación de una colección a partir de un archivo

Cuando crea una colección a partir de un archivo, el tipo de cada columna se infiere de sus valores. Una columna es numérica solo si cada valor en ella es un número o texto que se convierte en uno exactamente, por lo que una columna de códigos postales, códigos de producto con ceros iniciales, SKUs largos o números de teléfono permanece como texto. Una columna que mezcla tipos (números y palabras, booleanos y números) es de texto. Las celdas en blanco no cuentan, por lo que una columna mayoritariamente vacía no se marca como obligatoria. Una columna de números enteros cuyo nombre termine en una palabra que indique que contiene un momento (`created_at`, `updatedAt`, `signup_date`, `timestamp`) es una fecha cuando cada valor es una marca de tiempo epoch de 2001–2103, en segundos o milisegundos; con cualquier otro nombre, o con cualquier otro valor, permanece como número.

### Configuración de la importación

La importación está disponible en todas las colecciones. No existe ningún ajuste por colección que permita desactivarla.

## Exportación de datos

### Cómo exportar

1. Abra una colección en el panel de administración
2. Opcionalmente, aplique filtros para exportar un subconjunto de datos
3. Haga clic en el botón **Export** en la barra de herramientas
4. Elija el formato: **CSV** o **JSON**
5. El archivo se descarga inmediatamente

### Formatos de exportación

| Formato | Descripción |
|---------|-------------|
| CSV | Valores separados por comas, compatible con Excel y Google Sheets |
| JSON | Array de objetos, útil para consumo programático |

### Filtrado previo a la exportación

Cualquier filtro activo en la vista de la colección se aplica a la exportación. Esto le permite exportar únicamente un subconjunto de sus datos:

- Aplique filtros de columna o términos de búsqueda en la vista de la colección
- Haga clic en **Export**: solo se incluirán las filas filtradas

### Configuración de la exportación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La exportación está disponible en todas las colecciones a menos que la desactive. `exportable` en `customizeTable` permite configurarla: `exportable: false` elimina el botón **Export**, y un `ExportConfig` lo mantiene y añade columnas calculadas.

### Adición de campos calculados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`additionalFields` añade columnas que no existen en la tabla; cada una se calcula en el momento de la exportación y puede ser asíncrona:

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    exportable: {
        additionalFields: [
            {
                key: "computed_margin",
                builder: ({ row }) => String(Number(row.price ?? 0) - Number(row.cost ?? 0))
            },
            {
                key: "full_url",
                builder: ({ id }) => `https://mystore.com/products/${id}`
            },
            {
                key: "author_name",
                builder: async ({ row, context }) => {
                    const author = await context.data.users.findById(String(row.authorId));
                    // `context.data` returns the row itself: its columns are on it.
                    return String(author?.displayName ?? "Unknown");
                }
            }
        ]
    },
});
```

Cada entrada de `additionalFields` tiene:

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `key` | `string` | Nombre de la columna en la exportación |
| `builder` | `({ row, id, context }) => string \| Promise<string>` | Función que calcula el valor |

La función `builder` recibe cada registro exportado como `row`, con la estructura que envía el servidor (fechas como cadenas ISO, un belongsTo como su columna de clave foránea), el `id` del registro junto a él (su clave primaria como una cadena, o las partes de una clave compuesta unidas por `:::`), y el `RebaseContext` (que incluye al usuario autenticado), de modo que puede calcular valores basados tanto en los datos como en los permisos.

## Próximos pasos

- **[Tablas en el CMS](/docs/collections)** — Lo que el panel muestra para cada tabla
- **[Información general del frontend](/docs/frontend)** — Panel de administración y componentes de interfaz de usuario
- **[SDK tipado](/docs/sdk)** — Acceso programático a datos
