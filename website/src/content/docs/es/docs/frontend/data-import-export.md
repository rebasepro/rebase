---
sourceHash: 3c4991a6d78c115c
title: Importación y exportación de datos
sidebar_label: Importación y exportación de datos
description: Importa datos desde archivos CSV, JSON y Excel a tus colecciones, y exporta datos de colecciones a CSV o JSON con campos calculados opcionales.
---

## Información general

Rebase incluye herramientas integradas de importación y exportación de datos accesibles directamente desde el panel de administración. La importación admite archivos CSV, JSON y Excel con un asistente de asignación de columnas. La exportación admite CSV y JSON con campos calculados opcionales.

Ambas funciones están disponibles en todas las colecciones. La exportación se puede configurar por colección con campos calculados o desactivarse mediante `exportable: false`; la importación no se puede desactivar por colección.

## Importación de datos

### Cómo importar

1. Abre una colección en el panel de administración
2. Haz clic en el botón **Import** en la barra de herramientas
3. Selecciona o arrastra y suelta tu archivo
4. Asigna las columnas del archivo a las propiedades de la colección
5. Previsualiza los datos, incluidos los valores que no se puedan convertir
6. Haz clic en **Save data** para escribir las filas

### Formatos compatibles

| Formato | Extensiones | Notas |
|---------|-------------|-------|
| CSV | `.csv` | Detecta delimitadores automáticamente |
| JSON | `.json` | Espera un array de objetos |
| Excel | `.xlsx` | Lee la primera hoja |

### Asignación de columnas

El asistente de importación intenta automáticamente hacer coincidir las columnas del archivo con las propiedades de la colección por nombre. Puedes ajustar manualmente las asignaciones antes de importar:

- Las **coincidencias exactas** se asignan automáticamente (por ejemplo, `name` → `name`)
- Las **columnas no coincidentes** se pueden asignar manualmente o ignorar
- La **conversión de tipos** convierte cada celda al tipo de la propiedad a la que se asigna, pero solo cuando no se pierde información (consulta más abajo)

### Conversión de tipos

Una celda solo se convierte cuando el tipo de la propiedad puede almacenar exactamente lo que contiene:

| Tipo de propiedad | Convierte | No convierte |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (se perdería un cero inicial), números con más de 15 dígitos significativos, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, en cualquier combinación de mayúsculas/minúsculas | cualquier otra cosa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), fechas escritas (`5 Jan 2024`), `05/01/2024`, segundos o milisegundos epoch | texto que no represente una fecha |
| Geopoint | el objeto que escribe la exportación, `{"latitude": 41.9, "longitude": 12.5}`, o su JSON en una celda CSV | cualquier otra cosa, o una coordenada fuera de rango |
| Map sin campos declarados | un objeto, o su JSON en una celda CSV | cualquier otra cosa |
| Vector | una lista de números (`[0.1, 0.2]`, `0.1, 0.2`), o el valor de exportación `{"value": [0.1, 0.2]}` | una lista que contenga cualquier elemento que no sea un número |

Una fecha sin hora corresponde a ese día en UTC. Para fechas escritas como `05/01/2024`, la columna determina el orden: un primer número mayor de 12 hace que la columna interprete primero el día; un segundo número mayor de 12 hace que interprete primero el mes. Cuando una columna no lo define, decide la configuración regional del navegador, y cuando contiene ambos órdenes, no se convierte ninguna fecha que pueda interpretarse de ambas formas.

Una celda en blanco equivale a la ausencia de valor: no establece nada y se aplica el valor predeterminado configurado para esa propiedad.

Un archivo exportado desde una colección se vuelve a importar con los mismos valores, ya sea CSV o JSON. Un map con campos declarados se lee a razón de una columna por campo (`address.street`), tal como lo escribe la exportación; cualquier otro valor, incluidos un geopoint o un map de clave-valor, ocupa una sola columna. Un número epoch entre -100.000.000.000 y 100.000.000.000 se interpreta en segundos, por lo que una fecha entre el 31 de octubre de 1966 y el 3 de marzo de 1973 exportada como marca de tiempo no se recuperará: exporta esas fechas como texto. Un campo de hora del día interpreta un número inferior a un día (86.400.000) como los milisegundos transcurridos desde la medianoche que escribe la exportación.

### Valores que no se pueden importar

La vista previa lista cada celda que no se puede convertir, por columna, indicando la cantidad total y las primeras instancias por fila y motivo. Dichas celdas se dejan vacías en las filas importadas; nada se convierte a `0`, `false` o un valor vacío sin aparecer en la lista. Vuelve atrás para asignar la columna a otra propiedad, o corrige el archivo y súbelo de nuevo.

Las reglas propias de la colección —campos obligatorios, opciones de enum, valores únicos— son verificadas por el servidor a medida que se escriben las filas, en lotes de hasta 500 filas (menos cuando las filas son extensas, para que la solicitud se mantenga por debajo de aproximadamente 1 MB). Un lote se guarda por completo o no se guarda. Si se rechaza una fila, la importación se detiene y la especifica; los lotes anteriores ya habrán sido guardados, y la opción **Retry** se reanuda a partir de la primera fila del lote rechazado.

Una fila cuyo id ya exista en la colección actualiza dicho registro: se escriben las columnas presentes en el archivo y las demás conservan sus valores almacenados, de modo que un archivo con `id,price` actualiza los precios de productos existentes sin necesidad de repetir sus campos obligatorios. Una fila nueva sigue requiriendo todos los campos obligatorios. Un lote que combine actualizaciones y filas nuevas se procesa en dos solicitudes, por lo que una fila nueva rechazada puede dejar guardadas las actualizaciones de ese lote; la opción **Retry** las volverá a escribir con los mismos valores.

### Importación de usuarios

Una fila nueva en la colección de usuarios representa la creación de un usuario: la columna `password` se procesa mediante hash y nunca se almacena en texto plano, y una fila sin este campo recibe una contraseña generada o una invitación, al igual que cuando un administrador añade un usuario. Dado que las contraseñas de este tipo de archivos se definieron habitualmente bajo las reglas de otro sistema, la importación solicita al servidor omitir la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) para esas filas. El servidor solo lo autoriza si eres administrador; cualquier otro usuario que importe datos estará sujeto a la política, y una contraseña débil detendrá la importación con el error `WEAK_PASSWORD`.

### Creación de una colección a partir de un archivo

Cuando creas una colección a partir de un archivo, el tipo de cada columna se infiere a partir de sus valores. Una columna es de tipo numérico solo si cada valor en ella es un número o un texto que se convierte exactamente en uno; por tanto, una columna de códigos postales, códigos de producto con ceros iniciales, SKU largos o números de teléfono permanece como texto. Una columna que combine tipos (números y palabras, booleanos y números) se convierte en texto. Las celdas en blanco no se toman en cuenta, por lo que una columna mayoritariamente vacía no se marca como obligatoria. Una columna de números enteros cuyo nombre termine con una palabra que indique un momento temporal (`created_at`, `updatedAt`, `signup_date`, `timestamp`) se define como fecha cuando cada valor es una marca de tiempo epoch entre 2001 y 2103, en segundos o milisegundos; con cualquier otro nombre, o con cualquier otro valor, permanece como número.

### Configuración de importación

La importación está disponible en todas las colecciones. No existe ninguna opción por colección para desactivarla.

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
| JSON | Array de objetos, idóneo para consumo programático |

### Filtrado antes de exportar

Cualquier filtro activo en la vista de la colección se aplica a la exportación. Esto te permite exportar únicamente un subconjunto de tus datos:

- Aplica filtros de columna o términos de búsqueda en la vista de la colección
- Haz clic en **Export** — solo se incluirán las filas filtradas

### Configuración de exportación

La exportación está disponible en todas las colecciones a menos que la desactives. La propiedad `admin.exportable` permite configurarla: `exportable: false` elimina el botón **Export**, mientras que un objeto `ExportConfig` lo mantiene y añade columnas calculadas, como se muestra a continuación.

### Adición de campos calculados

Utiliza el objeto `ExportConfig` para añadir columnas calculadas personalizadas a tus exportaciones. Estas columnas no existen en la base de datos: se calculan en el momento de la exportación:

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
                    builder: ({ row }) => {
                        return `https://mystore.com/products/${String(row.id)}`;
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
| `builder` | `({ row, context }) => string \| Promise<string>` | Función que calcula el valor |

La función `builder` recibe cada registro exportado como `row`, con la estructura enviada por el servidor (fechas como cadenas ISO, relaciones belongsTo como su columna de clave foránea e `id` incluido), así como el `RebaseContext` (que incluye al usuario autenticado), permitiéndote calcular valores basados tanto en datos como en permisos.

### Campos calculados asíncronos

La función `builder` puede ser asíncrona, lo cual resulta útil cuando el valor calculado requiere una consulta a la base de datos o una llamada a una API:

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

## Próximos pasos

- **[Colecciones](/docs/collections)** — Define tu modelo de datos
- **[Visión general del frontend](/docs/frontend)** — Panel de administración y componentes de interfaz de usuario
- **[SDK tipado](/docs/sdk)** — Acceso programático a datos
