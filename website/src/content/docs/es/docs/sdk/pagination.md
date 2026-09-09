---
sourceHash: f040abfe0eee948c
title: Paginación
sidebar_label: Paginación
description: Pagina una colección con limit/offset, números de página o un cursor keyset — y cuándo cada uno deja de ser correcto.
---

Tres formas de recorrer una colección: un offset, un número de página y un cursor. Las dos primeras son posicionales y la tercera no, lo cual marca toda la diferencia: una página posicional vuelve a leer contando desde el inicio, por lo que las filas escritas mientras paginas alteran lo que significa la «fila 20».

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

`limit` debe ser un número entero entre 1 y 1000. Un valor mayor —o cero, negativo o fraccionario— se rechaza con un 400 `INVALID_LIMIT` en lugar de ajustarse automáticamente, ya que una página silenciosamente más pequeña no se puede distinguir de la última. Para leer más allá de ese límite superior, recorre las páginas con `iterate()` o `findAll()`.

#### Paginación por cursor

Cada respuesta de lista incluye un `meta.nextCursor` mientras exista otra página. Envíalo de vuelta como `after` y la siguiente página continuará **estrictamente después de la última fila servida**, en lugar de basarse en un *conteo* de filas que las escrituras concurrentes ya hayan desplazado:

```typescript
let after: string | undefined;
do {
    const { data, meta } = await client.data.orders.find({
        orderBy: ["createdAt", "desc"],
        limit: 100,
        after
    });
    for (const order of data) await handle(order);
    after = meta.nextCursor;
} while (after);
```

El cursor es **opaco**. Codifica las claves de ordenación *y* los valores de la última fila para ellas, por lo que solo puede continuar la lista de la que provino: mantén `orderBy` idéntico en todas las páginas, o la solicitud será rechazada con `CURSOR_ORDER_MISMATCH` en lugar de buscarse en un orden que nadie solicitó. Una solicitud que no especifique ningún `orderBy` adopta el del cursor, por lo que puedes reenviarlo directamente sin tener que volver a definir el orden.

No intentes analizarlo ni construir uno: la codificación existe sujeta a cambios, y cualquier otra cosa generará un `INVALID_CURSOR`.

De la naturaleza de un cursor se desprenden tres cosas:

- **`after` no se puede combinar con `offset` o `page`** (400 `CURSOR_WITH_OFFSET`). Ambos definen dónde comienza la página, y respetar ambos omitiría filas.
- **Tanto las ordenaciones por múltiples claves como las claves que admiten nulos funcionan.** La comparación se construye sobre cada clave en orden, con la [ubicación de los NULL](#where-nulls-sort) que declaró la ordenación, no un simple `>` sobre una sola columna.
- **La relevancia no puede ser un cursor.** El `_score` se calcula por consulta y no se almacena en ninguna parte, y dos consultas con diferentes cadenas de búsqueda producen puntuaciones que no están en la misma escala. Dicho listado simplemente no incluye `nextCursor`; pagínalo con `offset`.

A través de HTTP es un solo parámetro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Qué lecturas están envueltas y cuáles no

Dos formas y una regla: **una ventana está envuelta, una respuesta completa no.**

| Método | Devuelve | Por qué |
|--------|----------|---------|
| `find()`, `listen()` | `{ data, meta }` | Una página. `meta.total` / `meta.hasMore` son la única forma de saber si hay más |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nada pendiente por reportar: el recorrido finalizó o el lote *son* las filas |
| `iterate()` | una fila a la vez | No se materializa nada en absoluto |
| `findById()`, `get()`, `create()`, `update()` | una fila | No es una lista |

`data` no es un contenedor que el SDK a veces añade y a veces olvida. Es donde reside la metadata de paginación, y está ahí exactamente cuando hay información disponible.

#### Leerlo todo: `iterate()` y `findAll()`

`iterate()` transmite mediante streaming cada fila que coincide con una consulta, una a la vez, obteniendo una página a la vez en segundo plano. No acumula nada, por lo que es la opción a utilizar para una colección que no puedes mantener en memoria:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` es el mismo recorrido recopilado en un array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Ambos también están disponibles en el constructor fluido, donde `.limit()` pasa a ser el **tamaño de página** en lugar de un total:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Tres opciones configuran el recorrido:

| Opción | Por defecto | Qué hace |
|--------|-------------|----------|
| `pageSize` | 200 | Filas por solicitud. |
| `cursor` | — | Busca en una columna en lugar de paginar por offset. Ver más abajo. |
| `maxPages` | 10 000 | Límite máximo de solicitudes, para que un servidor que nunca deja de responder `hasMore` no entre en un bucle infinito. |
| `maxRows` | 10 000 | Solo en `findAll()`. Superarlo **lanza un error** en lugar de devolver un array truncado como si fuera la respuesta completa. Pasa `Infinity` para desactivar este límite o usa `iterate()`. |

**Prefiere `cursor` siempre que la colección tenga una columna única y ordenable.** La paginación por offset vuelve a contar las filas en cada solicitud, por lo que una fila insertada o eliminada *mientras se ejecuta el recorrido* desplaza la ventana y el recorrido omite o repite filas de forma silenciosa. La búsqueda por cursor solicita filas estrictamente posteriores a la última vista, lo que evita que las escrituras concurrentes anteriores al cursor alteren los resultados:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

Aquí, `cursor` significa «buscar en lugar de paginar por offset», e indica la columna por la cual ordenar cuando la consulta no lo especifica previamente. La búsqueda en sí es [el cursor del servidor](#cursor-pagination): el recorrido devuelve `meta.nextCursor` como `after` y no construye ninguna comparación propia, razón por la cual funciona la ordenación por múltiples claves —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— y por qué también funciona una clave de ordenación que admite nulos.

La ordenación aún debe ser **total**, lo que en la práctica significa única: el id de la fila resuelve el desempate final, por lo que cualquier columna funciona como criterio de desempate, pero un recorrido cuyo cursor deja de avanzar lanza `cursor-stalled` en lugar de entrar en un bucle infinito. Una consulta que ningún cursor puede describir (como la relevancia) lanza `cursor-missing`; elimina `cursor` y pagina mediante offset.

## Véase también

- [Consulta de datos](/docs/sdk/querying/) — filtros, el constructor fluido, ordenación.
- [Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/) — por qué la relevancia no puede servir como clave para un cursor.

---
