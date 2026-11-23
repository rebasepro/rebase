---
sourceHash: 68aa6b76fbe1dd6b
title: Modos de visualización
sidebar_label: Modos de visualización
description: "Muestra las filas de una tabla como una lista, una hoja de cálculo, tarjetas o un tablero kanban; elige qué rellena el título, la imagen, el estado y la fecha de cada registro; y define la ordenación predeterminada, los filtros y los ajustes preestablecidos de filtro con un solo clic."
---

Cada colección se puede mostrar de cuatro formas, desde el selector en su barra de herramientas:

- **Table**: una hoja de cálculo virtualizada con edición en línea, ordenación, filtrado
  y selección múltiple. Donde se abre una colección a menos que se indique lo contrario.
- **List**: una línea por registro, con su imagen, título, subtítulo, estado y
  fecha.
- **Cards**: una cuadrícula de tarjetas, para contenido con muchas imágenes.
- **Kanban**: un tablero agrupado por una columna con un conjunto cerrado de valores.

Una colección también puede ofrecer modos de visualización creados por ti (un calendario, un mapa, una
galería) en el mismo selector, controlados por la misma barra de herramientas: consulta
[Modos de visualización personalizados](/docs/frontend/extending#custom-view-modes).

## Elegir las vistas

```ts
// backend/schema/tasks.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        title:   col.text().notNull(),
        status:  col.enum(["backlog", "in_progress", "review", "done"]).notNull().default("backlog"),
        dueDate: col.date(),
        // The board's order key: text, never a number.
        __order: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                backlog:     { label: "Backlog", color: "gray" },
                in_progress: { label: "In Progress", color: "blue" },
                review:      { label: "Review", color: "orange" },
                done:        { label: "Done", color: "green" },
            },
        },
    },
});
```

| Opción | Efecto |
|---|---|
| `defaultViewMode` | Dónde aterriza un visitante: `"table"`, `"list"`, `"cards"`, `"kanban"` o la clave de una vista personalizada. |
| `enabledViews` | Las vistas que ofrece el selector. |
| `kanban` | `{ columnField, orderField }`: el tablero. |
| `defaultSize` | La altura de la fila, descrita a continuación. |
| `customViews` | Vistas propias, por valor o por clave. |

### Altura de fila

| `defaultSize` | Píxeles | Ideal para |
|------|--------|----------|
| `"xs"` | 36 | Tablas de datos densas |
| `"s"` | 42 | Filas de texto compactas |
| `"m"` | 48 | Predeterminado |
| `"l"` | 96 | Miniaturas de imagen medianas |
| `"xl"` | 160 | Miniaturas de imagen grandes |

## Kanban

`kanban.columnField` indica la columna por la que se agrupa el tablero. Debe contener
un conjunto cerrado de cadenas de texto, un `col.enum([...])` o una columna de texto con
`.oneOf([...])`; cualquier otra cosa es un error de tipo. Las columnas se representan en el
propio orden de la columna, o en `enumOrder`, con las etiquetas y colores de
`enumLabels`. Arrastrar una tarjeta a otra columna escribe en `columnField`.

`kanban.orderField` indica dónde se almacena la posición de una tarjeta **dentro** de una columna.
Decláralo siempre que ese orden importe: cometer tres errores comunes aquí puede dar lugar a un tablero
que parece configurado pero no lo está.

**Sin `orderField`, solo se conserva la columna.** Una tarjeta aún se puede arrastrar entre
columnas, ya que eso escribe en `columnField`, que es todo lo que necesita un tablero de estados.
Su posición dentro de una columna no tiene dónde almacenarse, por lo que se restablece en la siguiente
lectura. El tablero lo advierte la primera vez que se suelta una tarjeta en un lugar nuevo dentro de su
propia columna, en una barra que se puede descartar; un tablero cuyas tarjetas solo se mueven
entre columnas no muestra nada.

**La columna debe ser de texto.** La reordenación escribe una clave de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), no un índice. Una columna numérica nunca puede almacenar una, por lo
que `orderField` solo acepta una columna de texto. Es parte de la infraestructura interna, no contenido, por lo que
nombrarla en `orderField` la oculta de la tabla y la deshabilita en el formulario.
Una entrada en `fields.__order` aún puede anular cualquiera de las dos cosas: `hidden: false` la muestra.

**Las filas creadas fuera del CMS llegan sin clave.** Nada asigna una al
insertar. Una fila escrita por un cron, un script de seed, una migración o la API REST
llega con `__order` nulo, y el tablero muestra *"Some items don't have order
values"* con un botón **Initialize**. Un solo clic completa la primera página, y
la siguiente ejecución del cron vuelve a mostrar la barra de inmediato. Si un backend crea filas para
un tablero, debe añadir la clave él mismo, utilizando el alfabeto que usa el CMS:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await client.data.tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await client.data.tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Las filas creadas a través del formulario también llegan sin clave; la única diferencia es
que ves la barra en el momento en que añades una. **Initialize** es la solución en ese caso;
en un tablero alimentado por un backend, es una solución que se deshace en cada ejecución.

## Slots de visualización

Cada superficie que renderiza un registro utiliza algunos de seis slots: **title**,
**subtitle**, **image**, **status**, **date** y **tags**. Una fila de lista es imagen +
título + subtítulo + estado + fecha, una tarjeta es lo mismo con la imagen arriba, un
selector de referencias es título + subtítulo, y un encabezado de página es solo el título.

El CMS rellena algunos slots a partir de las columnas de la tabla (consulta
[slots de visualización predeterminados](/docs/collections/#display-slots)). `display` define
cualquiera de ellos, como una ruta de campo o como una función:

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    display: {
        title: "title",
        status: "status",
        date: "dueDate",
        subtitle: ({ row }) => row.dueDate ? `Due ${row.dueDate}` : undefined,
    },
});
```

Cualquier slot que omitas conserva su valor derivado.

A un resolver se le pasa `{ row, id, context }`. `row` es el registro tal como lo
envía el servidor, tipado como la fila de la tabla: fechas como cadenas ISO, un belongsTo como su
columna de clave foránea. `id` es su clave primaria como una cadena de texto, con las partes de una clave compuesta
unidas por `:::`. Una relación cargada por el CMS llega anidada bajo su nombre, como lo
devuelve el `include` de REST, por lo que un resolver puede leer el campo de un registro relacionado
sin realizar ninguna petición propia.

Un resolver puede ser `async`, para leer datos que el registro no incluye. Mientras
la promesa está en curso, la superficie muestra el valor derivado y lo sustituye por el
resuelto cuando finaliza: un título nunca es un spinner de carga. Los resultados se guardan en caché por
registro y slot, y las peticiones concurrentes comparten una sola llamada.

Devuelve `undefined` cuando un registro no tenga nada para el slot; la superficie recurre
a lo que conoce (un encabezado usa el nombre singular de la colección, un enlace usa
el id). Si un resolver lanza un error, se trata como `undefined` y se registra en el log una sola vez.

Prefiere una ruta siempre que el valor esté en el registro: una ruta conserva la
renderización propia del campo, por lo que un estado enum se mantiene como una etiqueta de color y una fecha se mantiene formateada,
algo que un resolver que devuelve una cadena de texto no puede hacer.

Cuando ningún slot define el título, el CMS elige uno a partir del propio texto de la tabla.
Con `fieldOrder`, se toma el primer campo en ese orden que pueda ser un título.
De lo contrario, los candidatos se priorizan: primero el texto cuya clave denote una etiqueta (`name`,
`title`, `label`…), luego texto corto, un correo electrónico, un enum, texto largo y un
selector de usuarios. Las claves, columnas uuid, claves foráneas, relaciones, referencias,
documentos JSON, campos de archivo y campos ocultos nunca califican: una relación nombra a
otro registro, por lo que un cliente que pertenece a una agencia nunca tendrá como título la
agencia. Una tabla que no contenga ninguno de estos elementos se titulará por su id. Un nombre que reside
dentro de una columna JSON, o una relación que realmente es como se llama una fila (una
fila de unión), se define con `display.title`: `title: "data.name"`,
`title: "agency"`. Cualquier valor que contenga el título se dibuja como texto: una fecha formateada,
un array unido, y una relación como el título de su fila relacionada, recurriendo a
su id si no está disponible.

## Filtros, ajustes preestablecidos y ordenación

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    sort: ["dueDate", "asc"],
    defaultFilter: { status: ["!=", "done"] },
    filterPresets: [
        { label: "In review", filterValues: { status: ["==", "review"] } },
        { label: "Overdue", filterValues: { dueDate: ["<", new Date().toISOString().slice(0, 10)] }, sort: ["dueDate", "asc"] },
    ],
});
```

| Opción | Efecto |
|---|---|
| `sort` | La ordenación predeterminada: una clave y dirección, o varias en orden. |
| `defaultFilter` | El filtro con el que comienza un visitante, y que puede modificar. |
| `fixedFilter` | Un filtro que el visitante no puede modificar. Los filtros que aplique en otros campos se combinan con este. |
| `filterPresets` | Filtros de un solo clic en la barra de herramientas: `{ label?, filterValues, sort? }`. Si no se indica una etiqueta, se genera una a partir del filtro. |
| `pagination` | Cargar en páginas (`true`, o el tamaño de página), o todo a la vez (`false`). |

Cada clave se comprueba con los campos de la tabla. El `filterOperators` propio de un campo
restringe lo que se puede filtrar en él, y `[]` desactiva el filtrado en dicho campo.

Un `fixedFilter` restringe lo que el CMS *solicita*. No es un límite de seguridad: lo que un
cliente puede leer lo decide la [seguridad a nivel de fila](/docs/collections/security-rules/)
de la tabla, para cada usuario.

## Próximos pasos

- [customizeTable](/docs/frontend/customize-table/): todas las opciones
- [Personalizar el admin](/docs/frontend/customizing/): tus propios modos de visualización, páginas y acciones
- [Vistas de entidad](/docs/frontend/entity-views/): pestañas en un registro
- [Acciones de entidad](/docs/frontend/entity-actions/): botones en un registro
