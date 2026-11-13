---
sourceHash: 57ee5c3ecdf49419
title: Modos de vista
sidebar_label: Modos de vista
description: "Muestre las filas de una tabla como una lista, una hoja de cálculo, tarjetas o un tablero kanban; elija qué llena el título, la imagen, el estado y la fecha de cada registro; y configure la ordenación predeterminada, los filtros y los ajustes preestablecidos de filtro con un solo clic."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada colección se puede mostrar de cuatro formas, desde el selector en su barra de herramientas:

- **Tabla**: una hoja de cálculo virtualizada con edición en línea, ordenación, filtrado
  y selección múltiple. Donde se abre una colección a menos que se indique lo contrario.
- **Lista**: una línea por registro, con su imagen, título, subtítulo, estado y
  fecha.
- **Tarjetas**: una cuadrícula de tarjetas, para contenido con muchas imágenes.
- **Kanban**: un tablero agrupado por una columna con un conjunto cerrado de valores.

Una colección también puede ofrecer modos de vista que usted escriba (un calendario, un mapa, una
galería) en el mismo selector, gestionados por la misma barra de herramientas: consulte
[Modos de vista personalizados](/docs/frontend/extending#custom-view-modes).

## Elección de las vistas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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
        __order: { hidden: true, hiddenInForm: true },
    },
});
```

| Opción | Efecto |
|---|---|
| `defaultViewMode` | Dónde aterriza un visitante: `"table"`, `"list"`, `"cards"`, `"kanban"` o la clave de una vista personalizada. |
| `enabledViews` | Las vistas que ofrece el selector. |
| `kanban` | `{ columnField, orderField }`: el tablero. |
| `defaultSize` | La altura de la fila, a continuación. |
| `customViews` | Vistas propias, por valor o por clave. |

### Altura de fila

| `defaultSize` | Píxeles | Ideal para |
|------|--------|----------|
| `"xs"` | 36 | Tablas de datos densas |
| `"s"` | 42 | Filas de texto compactas |
| `"m"` | 48 | Predeterminado |
| `"l"` | 96 | Miniaturas de imágenes medianas |
| `"xl"` | 160 | Miniaturas de imágenes grandes |

## Kanban

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`kanban.columnField` indica la columna por la que se agrupa el tablero. Debe
contener un conjunto cerrado de cadenas, un `col.enum([...])` o una columna de texto
con `.oneOf([...])`; cualquier otra cosa es un error de tipo. Las columnas se representan
en el propio orden de la columna, o en `enumOrder`, con las etiquetas y colores de
`enumLabels`. Al arrastrar una tarjeta a otra columna, se escribe en `columnField`.

`kanban.orderField` indica dónde se almacena la posición de una tarjeta **dentro** de una columna.
Declárelo siempre: tres errores aquí producen un tablero que parece
configurado pero no lo está.

**`orderField` no es opcional.** Sin él, una tarjeta aún puede arrastrarse entre columnas,
porque eso escribe en `columnField`. Su posición dentro de una columna no tiene dónde
almacenarse, por lo que se restablece en la siguiente lectura, y el tablero muestra una barra ámbar
indicando que la ordenación no está configurada.

**La columna debe ser de texto.** La reordenación escribe una clave de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), no un índice. Una columna numérica nunca puede almacenar una, por
lo que `orderField` solo acepta una columna de texto. Es parte de la infraestructura interna, no contenido:
ocúltela, como se muestra arriba.

**Las filas creadas fuera del CMS llegan sin clave.** Nada asigna una al
insertar. Una fila escrita por un cron, un script de seed, una migración o la API REST
llega con `__order` nulo, y el tablero muestra *\"Some items don't have order
values\"* con un botón **Initialize**. Un solo clic rellena la primera página, y
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
que usted ve la barra en el momento en que añade una. **Initialize** es la solución en ese caso;
en un tablero alimentado por un backend, es una solución que se revierte a sí misma en cada ejecución.

## Slots de visualización

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada superficie que dibuja un registro utiliza algunos de estos seis slots: **title**,
**subtitle**, **image**, **status**, **date** y **tags**. Una fila de lista es imagen +
título + subtítulo + estado + fecha, una tarjeta es lo mismo con la imagen en la parte superior, un
selector de referencia es título + subtítulo, y el encabezado de una página es solo el título.

El CMS llena algunos slots a partir de las columnas de la tabla (consulte los
[slots de visualización predeterminados](/docs/collections/#display-slots)). `display` define cualquiera
de ellos, como una ruta de campo o como una función:

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

Un slot que se omita mantiene su valor derivado.

Un resolver recibe `{ row, id, context }`. `row` es el registro tal como lo
envía el servidor, tipado como la fila de la tabla: fechas como cadenas ISO, un belongsTo como su
columna de clave foránea. `id` es su clave primaria como una cadena, con las partes de una clave compuesta
unidas por `:::`. Una relación que el CMS cargó llega anidada bajo su nombre, tal
como la devuelve `include` de REST, por lo que un resolver puede leer el campo de un registro relacionado
sin realizar ninguna petición propia.

Un resolver puede ser `async`, para leer algo que el registro no incluye. Mientras
la promesa está en curso, la superficie muestra el valor derivado y lo sustituye por el
resuelto cuando llega: un título nunca es un indicador de carga (spinner). Los resultados se almacenan en caché por
registro y slot, y las solicitudes concurrentes comparten una sola llamada.

Devuelva `undefined` cuando un registro no tenga nada para el slot; la superficie recurre
a lo que conoce (un encabezado usa el nombre de la colección en singular, un enlace usa
el id). Un resolver que lanza un error se trata como `undefined` y se registra en los logs una sola vez.

Prefiera una ruta siempre que el valor esté en el registro: una ruta conserva la propia
representación del campo, de modo que un estado enum sigue siendo una pastilla coloreada y una fecha se mantiene formateada,
algo que un resolver que devuelve una cadena no puede hacer.

Cuando ningún slot define el título, el CMS elige uno. Con `fieldOrder`, el primer
campo en ese orden que pueda ser un título: texto, una relación de cardinalidad única o
una referencia. De lo contrario, los candidatos se clasifican: texto cuya clave nombre una etiqueta
(`name`, `title`, `label`…) primero, luego texto corto, un correo electrónico, un enum, texto largo,
una relación y una referencia. Las claves, las columnas uuid, los campos de archivo y los campos ocultos
nunca califican. Lo que contenga el título se dibuja como texto: una fecha formateada, un
array unido y una relación como el primero de `name`, `title`, `label` o
`displayName` en la fila relacionada, recurriendo a su id como alternativa.

## Filtros, ajustes preestablecidos y ordenación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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
| `defaultFilter` | El filtro desde el cual parte un visitante, y que puede cambiar. |
| `fixedFilter` | Un filtro que el visitante no puede cambiar. Los filtros que aplique en otros campos se combinan con este. |
| `filterPresets` | Filtros de un solo clic en la barra de herramientas: `{ label?, filterValues, sort? }`. Sin una etiqueta, se genera una a partir del filtro. |
| `pagination` | Cargar en páginas (`true`, o el tamaño de página), o todo a la vez (`false`). |

Cada clave se compara con los campos de la tabla. El `filterOperators` propio de un campo
restringe lo que se puede filtrar en él, y `[]` desactiva el filtrado sobre el mismo.

Un `fixedFilter` restringe lo que el CMS *solicita*. No es un límite de seguridad: lo que un
llamador puede leer lo decide la [seguridad a nivel de fila](/docs/collections/security-rules/)
de la tabla, para cada llamador.

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): todas las opciones
- [Personalización del panel de administración](/docs/frontend/customizing/): sus propios modos de vista, páginas y acciones
- [Vistas de entidad](/docs/frontend/entity-views/): pestañas en un registro
- [Acciones de entidad](/docs/frontend/entity-actions/): botones en un registro
