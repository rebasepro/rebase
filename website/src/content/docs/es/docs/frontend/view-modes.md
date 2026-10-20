---
sourceHash: 608b8f9f3290a362
title: Modos de vista
sidebar_label: Modos de vista
description: Configura vistas de tabla, tarjetas y tablero Kanban para tus colecciones.
---

## Descripción general

Cada colección se puede mostrar en cuatro modos de vista:

- **Lista** — Vista de lista simple y limpia (el valor predeterminado clásico de un CMS)
- **Tabla** — Cuadrícula tipo hoja de cálculo con edición en línea, ordenamiento y filtrado
- **Tarjetas** — Cuadrícula de tarjetas para contenido visual (imágenes, vistas previas)
- **Kanban** — Tablero de arrastrar y soltar agrupado por una propiedad de tipo enum

Esas son las opciones integradas. Una colección también puede ofrecer modos de vista que tú mismo escribas — un calendario, un mapa, una galería — dentro del mismo selector, gestionados por la misma barra de herramientas: consulta [Modos de vista personalizados](/docs/frontend/extending#custom-view-modes) y la guía de calendario en [Personalizar el Admin](/docs/frontend/customizing).

## Configuración

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    // `orderProperty` and `kanban.columnProperty` are checked against these
    // keys — with an empty `properties` block they narrow to `never`.
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        status: { name: "Status", type: "string" },
        // The order key. A *string*, never a number — see "Ordering" below.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    name: "Products",
    table: "products",
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Vista de lista

La vista de lista es el modo de vista predeterminado, clásico y limpio de un CMS, que muestra entidades en un formato de lista directo sin la densidad de una hoja de cálculo.

## Vista de tabla

La vista de tabla es una hoja de cálculo virtualizada de alto rendimiento con:

- **Edición en línea** — Haz clic en cualquier celda para editar en el lugar
- **Redimensionamiento de columnas** — Arrastra los encabezados de las columnas
- **Reordenamiento de columnas** — Arrastra para reorganizar
- **Ordenamiento** — Haz clic en los encabezados de las columnas
- **Búsqueda de texto** — Búsqueda de texto completo en campos de cadena de texto
- **Filtrado** — Filtros por columna
- **Selección múltiple** — Selecciona entidades para acciones masivas

### Altura de fila

Controla la altura de las filas con `defaultSize`:

| Tamaño | Píxeles | Ideal para |
|--------|---------|------------|
| `"xs"` | 36 | Tablas de datos densas |
| `"s"` | 42 | Filas de texto compactas |
| `"m"` | 48 | Predeterminado |
| `"l"` | 96 | Miniaturas de imágenes medianas |
| `"xl"` | 160 | Miniaturas de imágenes grandes |

## Vista Kanban

Configura un tablero Kanban especificando qué propiedad enum utilizar como columnas:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "gray" },
                { id: "in_progress", label: "In Progress", color: "blue" },
                { id: "review", label: "Review", color: "orange" },
                { id: "done", label: "Done", color: "green" }
            ]
        },
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: {
            columnProperty: "status"
        }
    }
});

```

Arrastrar y soltar entre columnas actualiza automáticamente el campo enum y el orden de clasificación.

### Ordenamiento

`kanban` y `orderProperty` son dos mitades de una misma funcionalidad. Declara ambas, siempre; cometer tres errores aquí produce en todos los casos un tablero que parece configurado pero no lo está.

**`orderProperty` no es opcional.** Sin ella, una tarjeta aún se puede arrastrar entre columnas, porque eso escribe en `columnProperty`. Pero su posición *dentro* de una columna no tiene dónde almacenarse, por lo que se reinicia en la siguiente lectura y el tablero muestra una barra ámbar indicando que el ordenamiento no está configurado.

**La propiedad debe ser un `string`.** El reordenamiento escribe una clave de [indexación fraccionaria](https://github.com/rocicorp/fractional-indexing) —`"i0"`, `"i1"`, `"i0i"`—, no un índice. Una propiedad de tipo `number` nunca podrá almacenar una, por lo que un `sortOrder` numérico deja al tablero solicitando inicialización indefinidamente, y la inicialización misma falla contra una columna numérica. Declárala oculta; es mecanismo interno, no contenido:

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Las filas creadas fuera del panel de administración llegan sin una clave.** Nada asigna una al insertar. Una fila escrita por un cron, un script de seed, una migración o la API REST llega con `__order` en null, y el tablero muestra *"Some items don't have order values"* junto con un botón **Initialize**; un clic rellena la primera página, y la siguiente ejecución del cron vuelve a mostrar la barra de inmediato. Si un backend crea filas para un tablero, debe añadir la clave por sí mismo. Utiliza el mismo alfabeto que usa el admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Las filas creadas a través del formulario del admin también llegan sin clave; la única diferencia es que ves la barra en el momento en que agregas una. **Initialize** es la solución en ese caso; en un tablero alimentado por un backend es una solución que se deshará en cada ejecución.

## Vista de tarjetas

Las tarjetas muestran entidades como tarjetas visuales, muy útiles para contenido con abundantes imágenes:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Próximos pasos

- **[Personalizar el Admin](/docs/frontend/customizing)** — Tus propios modos de vista, páginas y acciones
- **[Vistas de entidad](/docs/frontend/entity-views)** — Pestañas personalizadas en formularios de entidad
- **[Acciones de entidad](/docs/frontend/entity-actions)** — Acciones de entidad personalizadas
