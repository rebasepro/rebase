---
sourceHash: 94cc15a104ed93ec
title: Modos de visualización
sidebar_label: Modos de visualización
description: "Muestra las filas de una tabla como una lista, una hoja de cálculo, tarjetas o un tablero kanban; elige qué rellena el título, la imagen, el estado y la fecha de cada registro; y define el orden predeterminado, los filtros y los ajustes preestablecidos de filtro con un solo clic."
---

Cada colección se puede mostrar de cuatro formas, desde el selector de su barra de herramientas:

- **Tabla**: una hoja de cálculo virtualizada con edición en línea, ordenación, filtrado
  y selección múltiple. Donde se abre una colección a menos que se indique lo contrario.
- **Lista**: una línea por registro, con su imagen, título, subtítulo, estado y
  fecha.
- **Tarjetas**: una cuadrícula de tarjetas, para contenido con abundantes imágenes.
- **Kanban**: un tablero agrupado por una columna con un conjunto cerrado de valores.

Una colección también puede ofrecer modos de visualización que tú mismo escribas (un calendario, un mapa,
una galería) en el mismo selector, controlados por la misma barra de herramientas: consulta
[Modos de visualización personalizados](/docs/frontend/extending#custom-view-modes).

## Elección de las vistas

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
        __order: { hidden: true },
    },
});
```

| Opción | Efecto |
|---|---|
| `defaultViewMode` | Dónde aterriza el visitante: `"table"`, `"list"`, `"cards"`, `"kanban"` o la clave de una vista personalizada. |
| `enabledViews` | Las vistas que ofrece el selector. |
| `kanban` | `{ columnField, orderField }`: el tablero. |
| `defaultSize` | La altura de la fila, indicada más abajo. |
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

`kanban.columnField` indica la columna por la que se agrupa el tablero. Debe contener un
conjunto cerrado de cadenas de texto, un `col.enum([...])` o una columna de texto con
`.oneOf([...])`; cualquier otra cosa generará un error de tipo. Las columnas se representan en el
propio orden de la columna, o en `enumOrder`, con las etiquetas y colores de
`enumLabels`. Arrastrar una tarjeta a otra columna actualiza `columnField`.

`kanban.orderField` indica dónde se almacena la posición de una tarjeta **dentro** de una columna.
Decláralo siempre que ese orden importe: cometer cualquiera de estos tres errores producirá un tablero
que parece configurado pero no lo está.

**Sin `orderField`, solo se conserva la columna.** Una tarjeta aún se puede arrastrar entre
columnas, ya que eso actualiza `columnField`, que es todo lo que necesita un tablero de estados.
Su posición dentro de una columna no tiene dónde almacenarse, por lo que se restablece en la siguiente
lectura. El tablero advierte esto la primera vez que se suelta una tarjeta en una nueva posición dentro de
su propia columna, mediante una barra que se puede descartar; un tablero cuyas tarjetas solo se mueven
entre columnas no muestra nada.

**La columna debe ser de texto.** La reordenación escribe una clave de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), no un índice. Una columna numérica nunca puede almacenar esto, por lo que
`orderField` solo acepta una columna de texto. Es un mecanismo interno, no contenido: escóndelo,
como se muestra arriba.

**Las filas creadas fuera del CMS llegan sin clave.** Nada asigna una al insertar.
Una fila escrita por un cron, un script de inicialización (seed), una migración o la API REST
llega con `__order` en null, y el tablero muestra *"Some items don't have order
values"* con un botón **Initialize**. Un solo clic completa retrospectivamente la primera página, y
la siguiente ejecución del cron volverá a mostrar la barra. Si un backend crea filas para
un tablero, debe adjuntar la clave él mismo, utilizando el alfabeto que usa el CMS:

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

Las filas creadas a través del formulario también llegan sin clave; la única diferencia es que
verás la barra en el momento en que agregues una. **Initialize** es la solución en ese caso; en un
tablero alimentado por un backend, es una solución que se deshace en cada ejecución.

## Slots de visualización

Cada superficie que representa un registro utiliza algunos de estos seis slots: **title**,
**subtitle**, **image**, **status**, **date** y **tags**. Una fila de lista es image +
title + subtitle + status + date, una tarjeta es lo mismo con la imagen en la parte superior, un
selector de referencias es title + subtitle, y el encabezado de una página es únicamente el title.

El CMS rellena algunos slots a partir de las columnas de la tabla (consulta
[slots de visualización predeterminados](/docs/collections/#display-slots)). `display` define cualquiera
de ellos, ya sea como una ruta de campo o como una función:

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

Un slot que se omita conservará su valor derivado.

Un resolvedor (resolver) recibe `{ row, id, context }`. `row` es el registro tal como lo envía el servidor,
tipado como la fila de la tabla: fechas como cadenas ISO, un belongsTo como su columna de
clave foránea. `id` es su clave primaria como cadena de texto, con las partes de una clave compuesta
unidas por `:::`. Una relación cargada por el CMS llega anidada bajo su nombre, tal como la
devuelve el `include` de REST, de modo que un resolver puede leer el campo de un registro relacionado
sin realizar una petición propia.

Un resolver puede ser `async`, para leer algo que el registro no contenga. Mientras
la promesa está en curso, la superficie muestra el valor derivado y lo sustituye por el
resuelto cuando llega: un título nunca muestra un indicador de carga (spinner). Los resultados se almacenan en caché por
registro y slot, y las solicitudes concurrentes comparten una sola llamada.

Devuelve `undefined` cuando un registro no tenga nada para el slot; la superficie recurrirá
a lo que conoce (un encabezado utiliza el nombre de la colección en singular, un enlace utiliza
el id). Un resolver que lance una excepción se tratará como `undefined` y se registrará en los logs una sola vez.

Prefiere una ruta siempre que el valor esté en el registro: una ruta conserva la renderización propia
del campo, por lo que un estado de tipo enum se mantiene como una etiqueta coloreada y una fecha conserva su formato,
algo que un resolver que devuelve una cadena no puede hacer.

Cuando ningún slot define el título, el CMS elige uno del propio texto de la tabla.
Con `fieldOrder`, se toma el primer campo en ese orden que pueda ser un título.
De lo contrario, los candidatos se clasifican: primero el texto cuya clave designa una etiqueta (`name`,
`title`, `label`…), luego texto corto, un correo electrónico, un enum, texto largo y un
selector de usuarios. Las claves, columnas uuid, claves foráneas, relaciones, referencias, documentos
JSON, campos de archivo y campos ocultos nunca califican: una relación nombra a
otro registro, por lo que un cliente que pertenece a una agencia nunca tendrá como título el nombre de la
agencia. Una tabla que no tenga ninguno de estos se titula por su id. Un nombre que reside
dentro de una columna JSON, o una relación que realmente identifica a la fila (una
fila de unión), se especifica con `display.title`: `title: "data.name"`,
`title: "agency"`. Todo lo que contenga el título se dibuja como texto: una fecha con formato,
un array unido y una relación como el título de su fila relacionada, recurriendo a
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
| `defaultFilter` | El filtro con el que comienza el visitante y que puede modificar. |
| `fixedFilter` | Un filtro que el visitante no puede cambiar. Los filtros que aplique en otros campos se combinarán con este. |
| `filterPresets` | Filtros de un solo clic en la barra de herramientas: `{ label?, filterValues, sort? }`. Sin una etiqueta, se genera una a partir del filtro. |
| `pagination` | Cargar por páginas (`true`, o el tamaño de página), o todo a la vez (`false`). |

Cada clave se comprueba contra los campos de la tabla. La propiedad `filterOperators` propia de un campo
restringe lo que se puede filtrar en él, y `[]` desactiva el filtrado en ese campo.

Un `fixedFilter` restringe lo que el CMS *solicita*. No es un límite de seguridad: lo que
un usuario o cliente puede leer lo determina la
[seguridad a nivel de fila](/docs/collections/security-rules/) de la tabla, para cada solicitante.

## Siguientes pasos

- [customizeTable](/docs/frontend/customize-table/): todas las opciones
- [Personalizar la administración](/docs/frontend/customizing/): tus propios modos de visualización, páginas y acciones
- [Vistas de entidad](/docs/frontend/entity-views/): pestañas en un registro
- [Acciones de entidad](/docs/frontend/entity-actions/): botones en un registro
