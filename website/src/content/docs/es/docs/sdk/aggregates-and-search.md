---
sourceHash: 598d10fdd9ac95db
title: Agregaciones y búsqueda
sidebar_label: Agregaciones y búsqueda
description: "Cuenta, suma y agrupa con el SDK, filtra dentro de columnas JSON y ejecuta búsquedas de texto completo y vectoriales desde el cliente."
---

## Agregaciones

`count`, `sum`, `avg`, `min`, `max` y las siguientes funciones sobre las filas que selecciona un filtro, sin necesidad de recuperarlas:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Agrupa para obtener una fila por valor:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status
```

```json
{
  "data": [
    { "status": "paid",    "count": 96, "sum_total": 31200 },
    { "status": "pending", "count": 32, "sum_total": 9322 }
  ]
}
```

Los resultados se indexan por función y campo: `count()` pasa a ser `count`, `sum(total)` pasa a ser `sum_total`.

### Más funciones

| `select` | SDK | Clave de resultado | Qué es |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Valores no nulos distintos |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | El valor más frecuente |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Percentil continuo, `p` de 0 a 1 (`0.5` es la mediana) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | Los valores no nulos distintos, ordenados, como un array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Una cadena que cambia cada vez que lo hace una fila cubierta |

### Agregaciones filtradas y nombres

Una agregación puede contar solo algunas de las filas: asígnale su propio `where` (`FILTER (WHERE …)` de SQL). Varias de ellas conforman una sola consulta sobre las filas elegidas por el `where` externo, por lo que un panel de control con ocho recuentos es un solo escaneo. Nombra cada una con `as`, lo cual es necesario cuando hay dos agregaciones de la misma función:

```ts
const [stats] = await client.data.songs.aggregate({
    select: [
        { fn: "count", as: "rows" },
        { fn: "count", as: "live", where: { tags: ["!=", []] } },
        { fn: "count", as: "unplayable", where: { playable: ["==", false] } },
        { fn: "sum", field: "plays", as: "plays" }
    ]
});
// { rows: 30000, live: 21480, unplayable: 312, plays: 918211 }
```

Un nombre utilizado dos veces, o la clave de una columna `groupBy`, es rechazado (`INVALID_AGGREGATE_SELECT`) en lugar de sobrescribir un valor. A través de HTTP, un nombre se escribe al estilo de PostgREST, `select=live:count()`; una agregación con su propio `where` se envía como un array JSON: `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

El `field` de una agregación puede ser una ruta JSON, `props->>players`: `sum`, `avg` y `percentile` leen el valor en dicha ruta como un número y omiten los que no lo sean; las demás funciones lo leen como texto. Una ruta JSON también es una entrada válida para `groupBy`, identificada por la ruta tal como está escrita:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Agrupación por una expresión

Una entrada de `groupBy` puede transformar su columna. A través de HTTP se escribe como una función, en el SDK como `{ field, transform }`, y se devuelve bajo `<transform>_<field>`, que también es el nombre que utiliza `orderBy`:

| Transformación | Agrupa por |
|---|---|
| `lower(name)`, `upper(name)` | La columna como texto en minúsculas o mayúsculas |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | La fecha, en UTC, como `2026`, `2026-11`, `2026-11-08` — o en una zona horaria: `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Cada elemento de una columna de tipo array: un grupo por elemento |

```ts
// How many songs carry each tag — the distinct elements of an array column.
const tags = await client.data.songs.aggregate({
    select: [{ fn: "count" }],
    groupBy: [{ field: "tags", transform: "unnest" }],
    orderBy: ["unnest_tags", "asc"]
});
// [{ unnest_tags: "pop", count: 812 }, …]

// Each artist's usual language, however the name is capitalised.
await client.data.songs.aggregate({
    select: [{ fn: "mode", field: "lang" }],
    groupBy: [{ field: "artist", transform: "lower" }]
});
```

```bash
GET /api/data/events/aggregate?select=count(),countDistinct(sid)&groupBy=day(at)&orderBy=day_at:asc
```

### ¿Ha cambiado algo? `fingerprint()`

`fingerprint()` responde a la pregunta "¿ha cambiado esta tabla desde la última vez que la consulté?" sin leer las filas: guarda la cadena, vuelve a consultar más tarde y recalcula lo que hayas derivado de las filas solo cuando difiera. Cualquier inserción, actualización o eliminación de una fila que cubra lo modificará; una escritura que no cambie nada (asignar a una columna su propio valor) también puede cambiarlo, y eliminar una fila recién agregada lo restaura. Cubre lo que el emisor puede ver y lo que los filtros seleccionan, y se puede agrupar, de modo que `groupBy=lang` genera una huella digital (*fingerprint*) por idioma.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Se calcula a partir de las versiones de fila que mantiene Postgres, no de los valores, por lo que cuesta un escaneo de la tabla y no un hash de cada fila: en 30 000 filas, tarda 4 ms donde `md5(string_agg(...))` sobre las filas tarda 56. No está disponible en una vista simple, que no almacena filas; una vista materializada sí dispone de ella.

Los grupos se paginan como las filas de un listado. `limit` los delimita, `offset` (o `page`) los omite y `orderBy` los ordena según un campo de `groupBy` o una clave de resultado. El orden siempre finaliza en las claves de grupo, por lo que los límites de cada página siempre caen en el mismo lugar. Una agregación agrupada sin `limit` se corta en el valor predeterminado del listado (50 grupos), igual que en un listado. Con un `limit` —incluido el predeterminado—, la respuesta indica si hay más, y el método `aggregate()` del SDK lo devuelve como `meta` en el resultado:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

Un `offset`, `page` u `orderBy` sin un `groupBy`, o un cursor en cualquier agregación, devuelve un `400 INVALID_AGGREGATE_WINDOW`: una agregación no agrupada tiene una sola fila, y un grupo no es una fila a partir de la cual un cursor pueda continuar.

Una agregación lee los valores almacenados y nunca ejecuta `afterRead`. Por lo tanto, en una tabla que un hook `afterRead` reescribe —ya sea global, propio de la tabla o el `.transform()` de una columna—, solo se admiten `count()` y `fingerprint()` sin `groupBy`, tanto a través de HTTP como en el mismo proceso; cualquier otra cosa devuelve un `400 AGGREGATE_MASKED_BY_AFTER_READ`, ya que una suma, un máximo o un grupo leerían los valores que el hook oculta.

Desde el SDK, `aggregate()` admite el mismo `orderBy` que un `find()` —una tupla `[key, "asc" | "desc"]` o una lista de ellas— donde la clave es una columna de `groupBy` o una clave de resultado. Ambas están tipadas: en un modelo generado, una clave que no sea ninguna de las dos no compilará. En el proceso (`rebase.data`), los grupos se devuelven en el mismo orden que a través de HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Acepta los mismos filtros que el endpoint de listado, por lo que una agregación se puede acotar de la misma manera que un listado:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La seguridad a nivel de fila (RLS) se aplica a las filas agregadas.** Una agregación es una forma eficiente de obtener información sobre filas que no puedes leer, por lo que se ejecuta bajo las propias políticas del emisor: alguien que no puede seleccionar nada, no cuenta nada.
:::

Las agregaciones requieren un controlador (*driver*) que las implemente. En uno que no lo haga, el endpoint responde con `501` en lugar de un resultado vacío: no se le debería decir a un panel "no hay coincidencias" cuando la realidad es "no soportado".

## Filtrado dentro de JSON

Una columna `json` o `jsonb` se puede filtrar por ruta, usando la propia sintaxis de flecha de Postgres:

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

A través de REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

Los segmentos de la ruta siempre se envían como parámetros vinculados (*bound parameters*), nunca interpolados directamente en el SQL.

### Cómo se comparan los valores

`->>` produce **texto**, por lo que las comparaciones son de texto —excepto que un operador de ordenación (`>`, `>=`, `<`, `<=`) al recibir un **número** hace un cast a numérico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Las filas cuyo valor en esa ruta no sea un número se excluyen de la comparación numérica en lugar de hacer fallar la consulta. Los booleanos se comparan como `"true"` / `"false"`, que es como `->>` los representa.

:::note
`array-contains` y los demás operadores de columna completa no están disponibles en una ruta: hacen una consulta sobre el documento completo, así que úsalos sobre la columna misma.
:::

## Búsqueda de texto

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

Por defecto, se trata de una **coincidencia de subcadena insensible a mayúsculas y minúsculas** (*case-insensitive*) en las columnas de texto de nivel superior de la tabla. No es una búsqueda de texto completo (*full-text search*): no accede al interior de columnas JSON o de tipo array, no realiza derivación léxica (*stemming*) ni clasificación por relevancia (*ranking*), y no puede usar un índice.

Una tabla puede habilitar la búsqueda de texto completo real declarando un bloque `search`, lo que también permite ordenar los resultados por relevancia con `_score`. Consulta [Search](/docs/backend/search).

## Búsqueda vectorial

Para tablas con una columna `col.vector()`, ordena las filas por similitud con un embedding de consulta. Las filas se devuelven primero las más cercanas, cada una con un `_distance`. La distancia define el orden: se ignora cualquier `orderBy` en la misma consulta. Sin un `limit`, una búsqueda vectorial devuelve 10 filas, no las 50 de un listado.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

Un `where` en la misma consulta actúa como filtro sobre qué filas son candidatas: esto devuelve las filas más cercanas que también coincidan, no las filas más cercanas filtradas a posteriori. En el índice HNSW esto aplica a partir de pgvector 0.8.0 (consulta [Filters on an approximate index](/docs/backend/vector-search/#filters-on-an-approximate-index)); en un pgvector más antiguo, un filtro que pocas de las filas más cercanas superen devolverá una página corta. Generar `queryVector` es responsabilidad tuya: Rebase almacena y busca embeddings, no los calcula.

El SDK envía una búsqueda vectorial como `POST /api/data/<table>/query`, con el embedding en el cuerpo: en la URL, 768 dimensiones ocupan unos 17 KB, superando lo que aceptan Node (16 KB) y la mayoría de los proxies (nginx: 8 KB). `count()` con una búsqueda vectorial funciona igual, como `POST /api/data/<table>/count`. Frente a un servidor anterior a la versión 0.24, que carece de dicha ruta, cualquiera de los dos recurre a `GET` — y en ese caso, un embedding largo aún puede ser rechazado con un error 431 o 414.

Con un `threshold`, el resultado no incluye `meta.total`: contar las filas dentro de una distancia lo calcula para cada fila de la tabla. Pagina con `meta.hasMore`, que sigue siendo exacto.

### Lo que debes proporcionar

- **pgvector.** Una propiedad `vector` compila en una columna `VECTOR(n)`, y ese tipo proviene de la extensión `vector`. Rebase la instalará por ti, pero solo donde indiques que puede hacerlo:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Esa línea es un permiso más que una solicitud: Rebase ejecuta `CREATE EXTENSION IF NOT EXISTS vector` solo cuando algo en tu esquema lo necesita. Es opcional (*opt-in*) porque instalar una extensión depende de factores que Rebase no puede comprobar desde dentro de la conexión: la imagen debe incluir la biblioteca (el entorno generado `pgvector/pgvector:pg18` lo hace, un `postgres:18` estándar no), el rol debe tener permisos para instalarla y un proveedor gestionado debe tenerla en su lista de permitidos.

  Si no especificas nada, Rebase no instala nada; instálala tú manualmente una vez. De cualquier manera la columna se crea, y Postgres la rechazará con `type "vector" does not exist` en una base de datos que no disponga de ninguna de las dos opciones, indicando ambas soluciones.

La columna, su índice ANN y ese `CREATE EXTENSION` se generan en `.rebase/sql/vector.sql`, junto a `schema.sql` y `policies.sql`, y `rebase db push` los aplica por ti. Tienen un archivo propio porque Atlas —el motor detrás de `db push`— calcula sus diferencias materializando `schema.sql` en una base de datos temporal que borra al inicio de cada ejecución, por lo que un `VECTOR(n)` allí se resuelve contra una base de datos que nunca puede tener pgvector.

`rebase db generate` añade ese archivo a la migración que escribe, de modo que una migración reproducida contra una base de datos nueva también construye la columna. Un cambio exclusivo en la propiedad de vector no produce ninguna migración, porque el esquema que compara Atlas no cambia; `db generate` lo notificará cuando ocurra.

### El índice

Cada columna vectorial obtiene un índice HNSW para distancia coseno, creado junto con la tabla y reportado al iniciar. Se utiliza coseno porque es con lo que mide `vectorSearch` a menos que pases `distance`; un índice sirve exactamente para un operador, por lo que una consulta `l2` contra un índice de coseno volverá silenciosamente a un escaneo completo.

Ajústalo o desactívalo en la propiedad:

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Defaults: one HNSW index, cosine. Any of these may be omitted.
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` mantiene el escaneo exacto de forma intencionada. Por encima de 2000 dimensiones, pgvector no puede construir ningún tipo de índice, por lo que la columna se crea y se deja sin indexar, notificándolo en el inicio; `vectorSearch` sigue respondiendo, como un escaneo exacto.

`vectorSearch` es una consulta, no una suscripción: `.listen()` en una de ellas es rechazado en lugar de responderse como un listado simple, ya que nada recalcula las distancias durante una escritura.

## Siguientes pasos

- [Querying Data](/docs/sdk/querying/) — el constructor de consultas sobre el que operan
- [Search](/docs/backend/search/) — cómo se configuran las búsquedas vectorial y de texto completo en el backend
- [REST API](/docs/backend/api/) — las mismas consultas a través de HTTP
