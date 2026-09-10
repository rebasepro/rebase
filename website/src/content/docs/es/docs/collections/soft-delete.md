---
sourceHash: 035955ac366c306b
title: Soft delete
sidebar_label: Soft delete
description: Convierte el borrado en una marca de tiempo, oculta las filas marcadas de cada lectura y restáuralas con una actualización ordinaria.
---

## Qué cambia

Con `softDelete` activado, un borrado **marca una columna en lugar de eliminar la fila**, y cada lectura filtra las filas marcadas. Nada más cambia en la operación: se requiere el mismo permiso, `beforeDelete` todavía puede vetarlo y `afterDelete` aún se ejecuta. Desde el punto de vista de quien realiza la llamada, la fila fue eliminada; cómo lo registra la tabla es asunto de este flag.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    softDelete: true,
    properties: {
        reference: { name: "Reference", type: "string" },
        deletedAt: { name: "Deleted at", type: "date", admin: { readOnly: true } }
    }
});
```

`true` utiliza `deletedAt` (columna `deleted_at`). La forma de objeto permite renombrarlo: `softDelete: { field: "archivedAt" }`.

:::caution[Declarar la columna es tu responsabilidad]
El flag indica lo que una columna *significa*; no crea una de la nada. Una colección que activa `softDelete` sin declarar esa propiedad `date` es rechazada al iniciar — deliberadamente temprano, porque la alternativa es que el error le ocurra a alguien que intente eliminar una fila.
:::

Solo para Postgres, al igual que la [búsqueda](/docs/backend/search) y los [índices](/docs/backend/indexes).

## Qué ve una lectura

Las filas marcadas se ocultan por defecto de `find`, `findById`, `count`, las agregaciones, el refetch en tiempo real y de esta colección cuando se carga a través de una relación. Ese comportamiento por defecto es el objetivo: el código escrito antes de que existiera este flag sigue funcionando y nadie tiene que acordarse de filtrar.

Dos parámetros de consulta permiten acceder a ellas:

| Parámetro | Qué devuelve |
|-----------|--------------|
| `?deleted=include` | Filas activas **y** marcadas |
| `?deleted=only` | Solo filas marcadas — la vista de papelera |

Cualquier otra cosa devuelve un 400 en lugar de un fallback silencioso. Que `?deleted=true` ocultara silenciosamente cada fila eliminada daría la impresión de funcionar y respondería a la pregunta opuesta.

## Restaurar y eliminar de verdad

Una **restauración** es una actualización ordinaria que vuelve a establecer el campo en `null`. No hay un verbo especial, porque no hay un estado especial: la fila nunca se fue a ningún lado.

Un `DELETE` **real** es `?hard=true` en la llamada de eliminación. Requiere exactamente el mismo permiso que un borrado ordinario: es el mismo verbo, y restringirlo por separado supondría una segunda superficie de control de acceso para una sola operación. Lo que cambia es si la fila puede recuperarse o no. Solo el valor literal `true` o `1` significa que sí; un error tipográfico devuelve un 400, porque quien realiza la llamada solicitó purgar y, si obtuviera un soft delete, creería que los datos han desaparecido.

## Siguientes pasos

- **[Definición de colecciones](/docs/collections)** — dónde se declara `softDelete`
- **[API REST](/docs/backend/api)** — los endpoints de eliminación y consulta a los que pertenecen estos parámetros
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules)** — quién puede eliminar una fila en primer lugar

---
