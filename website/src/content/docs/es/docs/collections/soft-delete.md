---
sourceHash: a289b69be61220df
title: Soft delete
sidebar_label: Soft delete
description: "softDelete en una tabla convierte la eliminación en una marca de tiempo, oculta las filas marcadas de cada lectura y las restaura con una actualización ordinaria."
---

## Qué cambia

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Con `softDelete` activado, una eliminación **marca una columna en lugar de eliminar la fila**,
y cada lectura filtra y excluye las filas marcadas. Nada más de la operación
cambia: se requiere el mismo permiso, `beforeDelete` aún puede vetarla y
`afterDelete` sigue ejecutándose. Desde el punto de vista del llamador, la fila fue eliminada;
cómo lo registra la tabla es asunto de este flag.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        reference: col.text().notNull(),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    softDelete: true,
    rls: "admin-only",
});
```

`true` utiliza la columna `deletedAt` (en SQL `deleted_at`). La forma de objeto especifica
otra: `softDelete: { field: "archivedAt" }`. Los tipos verifican que el campo
exista entre las columnas de la tabla.

:::caution[La columna debe ser declarada por ti]
El flag indica lo que una columna *significa*; no añade una. Una tabla que activa
`softDelete` sin declarar esa columna, o con una columna que no es de tipo
`timestamptz`, `date` o `time`, es rechazada cuando se compila el esquema — antes
de que alguien intente eliminar una fila.
:::

## Qué ve una lectura

Las filas marcadas se ocultan por defecto de `find`, `findById`, `count`, los
agregados, el refetch en tiempo real y de esta tabla cuando se carga a través de
una relación. Ese comportamiento por defecto es el objetivo: el código escrito antes de que existiera
el flag sigue funcionando, y nadie tiene que acordarse de filtrar.

Dos parámetros de consulta permiten abrirlo:

| Parámetro | Respuestas |
|-----------|------------|
| `?deleted=include` | Filas activas **y** marcadas |
| `?deleted=only` | Solo filas marcadas — la vista de papelera |

Cualquier otra cosa devuelve un 400 en lugar de recurrir silenciosamente a un valor por defecto. Que `?deleted=true`
ocultara silenciosamente cada fila eliminada parecería que funcionó y respondería a la
pregunta contraria.

## Restaurar y eliminar de verdad

Una **restauración** es una actualización ordinaria que vuelve a establecer el campo en `null`. No hay
un verbo especial, porque no hay un estado especial — la fila nunca se fue a ninguna parte.
A través de REST es un `PATCH` — individual, `/bulk` o `_batch` — cuyo cuerpo establece el
campo en `null`:

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

Esa actualización es la única que alcanza a una fila marcada. Cualquier otra edición sobre ella responde
con `404`, al igual que la fila responde a cada lectura por defecto; restáurala primero.

La operación inversa no es una actualización. Intentar establecer el campo con un valor es rechazado con `400`
`FIELD_NOT_WRITABLE` — elimina la fila en su lugar — para que el permiso `delete`,
`beforeDelete` y `afterDelete` siempre se apliquen a ella. Un upsert puede crear una fila
que ya esté marcada, pero nunca marca una que ya estaba almacenada.

Tampoco un upsert escribe en una fila que está en la papelera: cuando su clave pertenece a
una fila marcada, se rechaza con `409` `ROW_IN_TRASH` y no se escribe nada.
Restaura la fila primero, o púr嗤ala con `?hard=true` y vuelve a hacer el upsert.

Una eliminación a través de una ruta de muchos a muchos, como `DELETE /api/data/posts/1/tags/5`,
elimina el enlace del post 1 con la etiqueta. No aplica soft-delete a la etiqueta, la cual
otros posts aún utilizan.

Un `DELETE` **real** es `?hard=true` en la llamada de eliminación. Requiere exactamente
el mismo permiso que una eliminación ordinaria: es el mismo verbo, y restringirlo
por separado supondría una segunda superficie de control de acceso para una sola operación. Lo que
cambia es si la fila puede recuperarse. Solo el valor literal `true` o `1` significa
sí; un error tipográfico devuelve un 400, porque un llamador que pidió purgar y obtuvo un soft delete
creerá que los datos han desaparecido.

## Desde el SDK

El cliente tipado accede a la papelera a través de `trash` en cada tabla. Envía
las solicitudes mencionadas anteriormente: `?deleted=only` en las lecturas, la actualización a `null` para una
restauración, y `?hard=true` para una purga.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` y `trash.count` aceptan los mismos parámetros que `find` y `count`.
Una restauración establece `deletedAt` a menos que nombres el campo: una tabla declarada
con `softDelete: { field: "archivedAt" }` se restaura con
`trash.restore(7, { field: "archivedAt" })`. El cliente no puede leer el nombre
del campo desde el servidor.

Utiliza `trash` en una tabla que declare `softDelete`. En una que no lo haga,
el servidor ignora `?deleted=`, por lo que `trash.find` devuelve las filas activas y
`trash.purge` es una eliminación ordinaria.

El código del servidor tiene el mismo `trash`: `context.data.invoices.trash` en un hook,
y `rebase.data.invoices.trash` en una función o un cron. Lee y purga
a través del driver, con los privilegios del llamador, al igual que el resto de
[`context.data`](/docs/collections/context-data-api).

Con [offline](/docs/sdk/offline) habilitado, la papelera nunca se guarda en caché y nada
en ella entra en cola. Cada llamada necesita al servidor, y falla con el error `OFFLINE`
sin él. Una fila restaurada se incorpora a la base de datos local, y una purgada la abandona.

## Siguientes pasos

- **[Tablas](/docs/schema/)** — donde se declara `softDelete`
- **[API REST](/docs/backend/api)** — los endpoints de eliminación y consulta a los que pertenecen estos parámetros
- **[Seguridad a nivel de fila](/docs/collections/security-rules/)** — quién puede eliminar una fila en primer lugar
