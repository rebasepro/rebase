---
sourceHash: 2cf8f0e1f2cb33d7
title: Modos de Vista
sidebar_label: Modos de Vista
description: Configure vistas de tabla, tarjetas y tablero Kanban para sus colecciones.
---

## Resumen

Cada colección puede mostrarse en cuatro modos de vista:

- **Lista** — Vista de lista simple y limpia (el valor predeterminado clásico del CMS)
- **Tabla** — Cuadrícula estilo hoja de cálculo con edición en línea, clasificación, filtrado
- **Tarjetas** — Cuadrícula de tarjetas para contenido visual (imágenes, previsualizaciones)
- **Kanban** — Tablero de arrastrar y soltar agrupado por una propiedad de enumeración

## Configuración

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Vista predeterminada
        enabledViews: ["list", "table", "kanban"],    // Vistas disponibles
        orderProperty: "__order",           // Propiedad para el ordenamiento de arrastrar y soltar
        kanban: {
            columnProperty: "status"         // Propiedad de enumeración para columnas
        }
    }
});

```

## Vista de Lista

La vista de lista es el modo de vista predeterminado clásico y limpio del CMS, que muestra las entidades en un formato de lista directo sin la densidad de una hoja de cálculo.

## Vista de Tabla

La vista predeterminada es una hoja de cálculo virtualizada de alto rendimiento con:

- **Edición en línea** — Haga clic en cualquier celda para editar in situ
- **Redimensionamiento de columnas** — Arrastre los encabezados de las columnas
- **Reordenación de columnas** — Arrastre para reorganizar
- **Clasificación** — Haga clic en los encabezados de las columnas
- **Búsqueda de texto** — Búsqueda de texto completo en campos de cadena
- **Filtrado** — Filtros por columna
- **Selección múltiple** — Seleccione entidades para acciones masivas

### Altura de Fila

Controle la altura de la fila con `defaultSize`:

| Tamaño | Píxeles | Ideal para |
|------|--------|----------|
| `"xs"` | 40 | Tablas de datos densos |
| `"s"` | 54 | Predeterminado |
| `"m"` | 80 | Con miniaturas de imágenes |
| `"l"` | 120 | Tarjetas con previsualizaciones |
| `"xl"` | 260 | Previsualizaciones de contenido enriquecido |

## Vista Kanban

Configure un tablero Kanban especificando qué propiedad de enumeración usar como columnas:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Título" },
        status: {
            type: "string",
            name: "Estado",
            enum: [
                { id: "backlog", label: "Pendientes", color: "gray" },
                { id: "in_progress", label: "En Progreso", color: "blue" },
                { id: "review", label: "Revisión", color: "orange" },
                { id: "done", label: "Hecho", color: "green" }
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

Arrastrar y soltar entre columnas actualiza automáticamente el campo de enumeración y el orden de clasificación.

### Ordenamiento

`kanban` y `orderProperty` son dos mitades de una misma función. Declara siempre
ambas — tres descuidos aquí producen un tablero que *parece* configurado y no lo
está.

**`orderProperty` no es opcional.** Sin ella una tarjeta se sigue arrastrando
entre columnas, porque eso escribe `columnProperty`. Su posición *dentro* de una
columna no tiene dónde guardarse: vuelve a su sitio en la siguiente lectura, y el
tablero muestra una barra ámbar avisando de que el ordenamiento no está
configurado.

**La propiedad debe ser un `string`.** Reordenar escribe una clave de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`,
`"i1"`, `"i0i"` — no un índice. Una propiedad `number` nunca puede contenerla: un
`sortOrder` numérico deja el tablero pidiendo inicializarse para siempre, y la
propia inicialización falla contra una columna numérica. Decláralo oculto: es
maquinaria, no contenido.

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Las filas creadas fuera del admin llegan sin clave.** Nadie la asigna al
insertar. Una fila escrita por un cron, un script de seed, una migración o la API
REST llega con `__order` en null, y el tablero muestra *"Some items don't have
order values"* con un botón **Initialize** — un clic rellena la primera página, y
la siguiente ejecución del cron devuelve la barra. Si un backend crea filas para
un tablero, debe asignar la clave él mismo, con el mismo alfabeto que usa el
admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, minúsculas. Quien ordena es Postgres, cuya collation por defecto no es
// el orden de bytes: omitir este tercer argumento produce claves base62 como
// "a0" que el tablero rechaza.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// La última clave en uso. `is-not-null` no es opcional: un orden descendente es
// NULLS FIRST, así que sin él esto relee una de las filas que precisamente no
// tienen clave y cada inserción cae en el mismo "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(last[0]?.__order ?? null, null, ORDER_KEY_DIGITS)
});
```

## Vista de Tarjetas

Las tarjetas muestran las entidades como tarjetas visuales — útiles para contenido con muchas imágenes:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Título" },
        cover: {
            type: "string",
            name: "Imagen de Portada",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Próximos Pasos

- **[Vistas de Entidad](/docs/frontend/entity-views)** — Pestañas personalizadas en formularios de entidad
- **[Acciones de Entidad](/docs/frontend/entity-actions)** — Acciones de entidad personalizadas

---
