---
sourceHash: e658ebda47d3942e
title: Paginación
sidebar_label: Paginación
description: Pagina una tabla con limit/offset, números de página o un cursor keyset, y cuándo cada uno deja de ser correcto.
---

Tres formas de recorrer una tabla: un offset, un número de página y un cursor. Las
dos primeras son posicionales y la tercera no, lo cual marca toda la diferencia:
una página posicional vuelve a leer contando desde el inicio, por lo que las filas
escritas mientras paginas alteran lo que significa "fila 20".

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

Usa una o la otra. `page` y `offset` juntos describen la misma ventana
dos veces, y la lectura se rechaza con `PAGE_WITH_OFFSET` en lugar de aplicar
`page` silenciosamente. El SDK la rechaza antes de cualquier petición, sobre HTTP,
en el proceso y fuera de línea; el servidor responde a una petición directa que
envíe ambos con un 400.

`limit` debe ser un número entero entre 1 y 1000. Uno mayor —o bien cero,
negativo o fraccionario— se rechaza con un 400 `INVALID_LIMIT` en lugar de
truncarse, porque una página silenciosamente más pequeña no se puede distinguir
de la última. Para leer más allá de ese límite máximo, recorre las páginas con
`iterate()` o `findAll()`.

#### Paginación por cursor

Cada respuesta de lista incluye un `meta.nextCursor` mientras exista otra página.
Pásalo de vuelta como `after` y la siguiente página continuará **estrictamente
después de la última fila servida**, en lugar de en un *conteo* de filas que las
escrituras concurrentes ya hayan desplazado:

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

`nextCursor` está ausente en la última página y en páginas que ningún cursor
puede describir: una búsqueda ordenada por relevancia (`_score`), una búsqueda
vectorial y una proyección de `fields` que omita uno de los campos de `orderBy` —
el cursor se construye a partir de los valores de ordenación de la última fila, y
esa fila no los incluye. En esos casos `meta.hasMore` puede ser `true` sin ningún
`nextCursor`, y el bucle anterior se detiene antes de tiempo: añade los campos de
ordenación a `fields` o pagina mediante `offset`. Al recibir un `cursor`, `iterate()`
rechaza dicho listado con `cursor-missing` en lugar de detenerse. Una ordenación por un
[agregado sobre una relación](/docs/sdk/relations/) sí pagina mediante cursor.

El cursor es **opaco**. Codifica las claves de ordenación *y* los valores de la
última fila para ellas, por lo que solo puede continuar el listado del que proviene:
mantén `orderBy` idéntico entre páginas, o la petición será rechazada con
`CURSOR_ORDER_MISMATCH` en lugar de buscar en un orden que nadie solicitó. Una
petición que no especifique ningún `orderBy` adopta el del cursor, por lo que puedes
reenviarlo directamente sin volver a declarar la ordenación.

No intentes parsearlo ni construir uno: la codificación existe para poder cambiarse,
y cualquier otra cosa resultará en `INVALID_CURSOR`.

Cuatro aspectos se derivan de lo que es un cursor:

- **`after` no se puede combinar con `offset` o `page`** (400
  `CURSOR_WITH_OFFSET`). Ambos indican dónde comienza la página, y respetar ambos
  omitiría filas.
- **Tanto las ordenaciones por múltiples claves como las claves anulables funcionan.**
  La comparación se construye sobre cada clave en orden, con la
  [ubicación de NULL](/docs/sdk/querying#where-nulls-sort) declarada en la
  ordenación, no como un simple `>` sobre una sola columna.
- **La relevancia no puede ser un cursor.** Un `_score` se calcula por consulta
  y no se almacena en ninguna parte, y dos consultas con diferentes cadenas de búsqueda
  producen puntuaciones que no están en la misma escala. Dicho listado simplemente no
  lleva ningún `nextCursor`; pagínalo con `offset`. La distancia de una búsqueda vectorial
  es similar, y un cursor enviado con una es rechazado con `VECTOR_CURSOR_UNSUPPORTED`.
- **Una suscripción no puede continuar a partir de uno.** `listen()` vuelve a ejecutar
  su consulta en cada escritura, y `after` nombra un punto en una ejecución concreta de
  la misma, por lo que `listen({ after })` se rechaza con `CURSOR_NOT_LIVE` antes de
  enviar nada. Usa `offset` o `page` para una ventana en tiempo real, o `find({ after })`
  para leer la página una sola vez.

A través de HTTP es un solo parámetro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Omitir el conteo

`meta.total` es un `COUNT(*)` sobre cada fila que coincide con la consulta,
ejecutado junto con la página — y en una tabla grande cuesta más que la propia
página. Una lectura que solo avanza hacia adelante nunca lo necesita, porque
`meta.hasMore` no depende de él: pasa `count: "none"` y la lectura solicitará en
su lugar una fila más allá de la página.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Sin un conteo no hay un total que reportar: a través de HTTP `meta.total` está
ausente, y en el proceso representa las filas hasta el final de la página (`offset`
más la página). A través de HTTP se usa `?count=none`; `?count=exact` es el valor
por defecto, y cualquier otro valor da un 400 `INVALID_COUNT`. `iterate()` y
`findAll()` lo envían por sí mismos en cada página, ya que un recorrido no reporta
un total.

#### Qué lecturas están envueltas y cuáles no

Dos formatos y una regla: **una ventana está envuelta, una respuesta completa no.**

| Método | Retorna | Por qué |
|--------|---------|---------|
| `find()`, `listen()` | `{ data, meta }` | Una página. `meta.total` / `meta.hasMore` son la única forma de saber si hay más |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | No queda nada pendiente que reportar: el recorrido finalizó, o el lote *son* las filas |
| `iterate()` | una fila a la vez | Nada se materializa en memoria |
| `findById()`, `get()`, `create()`, `update()` | una fila | No es una lista |

`data` no es un contenedor que el SDK a veces añada y a veces olvide. Es el
lugar donde residen los metadatos de paginación, y está presente exactamente
cuando hay metadatos.

#### Leer todo: `iterate()` y `findAll()`

`iterate()` transmite en flujo cada fila que coincide con una consulta, una a la
vez, obteniendo una página tras otra en segundo plano. Nada se acumula, por lo que
es la opción indicada para una tabla que no cabe en memoria:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` es el mismo recorrido recolectado en un array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Ambos están disponibles también en el fluent builder, donde `.limit()` pasa a ser
el **tamaño de página** en lugar de un total:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Cuatro opciones definen el recorrido:

| Opción | Por defecto | Qué hace |
|--------|-------------|----------|
| `pageSize` | 200 | Filas por petición. |
| `cursor` | — | Exigir búsqueda por cursor: lanza un error en lugar de recurrir a offset. Ver más abajo. |
| `maxPages` | 10 000 | Límite máximo de peticiones, para que un servidor que nunca deja de responder `hasMore` no entre en un bucle infinito. |
| `maxRows` | 10 000 | Solo para `findAll()`. Superarlo **lanza un error** en lugar de devolver un array truncado como si fuera la respuesta completa. Pasa `Infinity` para desactivarlo, o usa `iterate()`. |

**El recorrido avanza por sí mismo.** Después de la primera página, devuelve
[el cursor del servidor](#paginación-por-cursor) — `meta.nextCursor` — como `after`,
de modo que cada petición solicita filas estrictamente posteriores a la última
vista. Las escrituras concurrentes antes de esa fila no pueden desplazar la
ventana, y la base de datos nunca tiene que omitir filas mediante conteo, que es
lo que hacía lentos los recorridos largos basados en offset: cada página costaba
más que la anterior.

Cuando el servidor no emite un cursor —una búsqueda ordenada por relevancia, una
búsqueda vectorial, una lectura con `distinct`, una proyección de `fields` que
omite un campo de ordenación—, el recorrido pagina por offset en su lugar, y una
fila insertada o eliminada *mientras el recorrido se ejecuta* puede hacer que se
omita o se repita una fila. Pasa `cursor` para hacer que la búsqueda por cursor
sea un requisito en lugar de una preferencia:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` indica la columna por la cual ordenar cuando la consulta no lo especifica
ya, y convierte el retroceso a offset en un error. El recorrido no construye ninguna
comparación propia, razón por la cual una ordenación por múltiples claves funciona —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— y por qué una clave de ordenación anulable también lo hace.

La ordenación aún debe ser **total**, lo que en la práctica significa única: el id
de fila desempata en última instancia, por lo que cualquier columna sirve como
criterio de desempate. Si se proporciona `cursor`, un recorrido cuyo cursor deje
de avanzar lanza `cursor-stalled` en lugar de quedar en un bucle infinito, y una
consulta que ningún cursor pueda describir (relevancia) lanza `cursor-missing`; si
omites `cursor`, el recorrido paginará esos casos por offset.

## Véase también

- [Consultar datos](/docs/sdk/querying/) — filtros, el fluent builder, ordenación.
- [Agregados y búsqueda](/docs/sdk/aggregates-and-search/) — por qué la relevancia no puede servir de clave para un cursor.
