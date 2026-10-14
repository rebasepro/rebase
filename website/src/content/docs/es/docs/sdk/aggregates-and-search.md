---
sourceHash: 6304a2aeeb6a8bcf
title: Agregaciones y búsqueda
sidebar_label: Agregaciones y búsqueda
description: "Cuenta, suma y agrupa con el SDK, filtra dentro de columnas JSON y ejecuta búsquedas de texto completo y vectoriales desde el cliente."
---

## Agregaciones

`count`, `sum`, `avg`, `min` y `max` sobre las filas que selecciona un filtro, sin necesidad de obtenerlas:

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

Los resultados se indexan por función y campo; `count()` se convierte en `count`, `sum(total)` se convierte en `sum_total`.

Los grupos se paginan como las filas de un listado. `limit` los limita, `offset` (o `page`) los salta y `orderBy` los ordena por un campo de `groupBy` o por una clave del resultado. El orden siempre termina en las claves del grupo, así que cada límite de página cae en el mismo lugar. Una agregación agrupada sin `limit` se corta en el límite por defecto del listado (50 grupos), igual que un listado. Con un `limit` — incluido el predeterminado — la respuesta indica si hay más, y el `aggregate()` del SDK lo devuelve como `meta` en el resultado:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` u `orderBy` sin `groupBy`, o un cursor en cualquier agregación, es un `400 INVALID_AGGREGATE_WINDOW`: una agregación sin agrupar tiene una fila, y un grupo no es una fila tras la que un cursor pueda continuar.

Desde el SDK, `aggregate()` acepta el mismo `orderBy` que `find()` — una tupla
`[key, "asc" | "desc"]` o una lista de ellas — donde la clave es una columna de `groupBy`
o una clave de resultado. Ambas están tipadas: en un modelo generado, una clave que no es
ninguna de las dos no compila. En proceso (`rebase.data`), los grupos vuelven en el
mismo orden que por HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Admite los mismos filtros que el endpoint de listado, por lo que una agregación se puede restringir de la misma manera que un listado:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La seguridad a nivel de fila se aplica a las filas que se agregan.** Una agregación es una forma eficiente de obtener información sobre filas que no puedes leer, por lo que se ejecuta bajo las propias políticas de quien llama: alguien que no puede seleccionar nada, no cuenta nada.
:::

Las agregaciones necesitan un driver que las implemente. En uno que no lo haga, el endpoint responde con un `501` en lugar de un resultado vacío; a un dashboard no se le debe decir «no hay coincidencias» cuando la realidad es «no compatible».

## Filtrado dentro de JSON

Una columna `json` o `jsonb` se puede filtrar por ruta, utilizando la propia sintaxis de flecha de Postgres:

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

Los segmentos de ruta siempre se envían como parámetros vinculados, nunca interpolados directamente en SQL.

### Cómo se comparan los valores

`->>` devuelve **texto**, por lo que las comparaciones son de texto; excepto cuando a un operador de ordenamiento (`>`, `>=`, `<`, `<=`) se le proporciona un **número**, en cuyo caso se convierte a numérico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Las filas cuyo valor en esa ruta no sea un número se excluyen de la comparación numérica en lugar de hacer que la consulta falle. Los booleanos se comparan como `"true"` / `"false"`, que es como los representa `->>`.

:::note
`array-contains` y los demás operadores de columna completa no están disponibles en una ruta; consultan sobre todo el documento, así que úsalos sobre la columna en sí.
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

Por defecto, esta es una **coincidencia de subcadena insensible a mayúsculas y minúsculas** en las propiedades `string` de nivel superior de la colección. No es una búsqueda de texto completo: no accede al interior de las propiedades `map` o `array`, no realiza derivación léxica (stemming) ni clasificación (ranking), y no puede usar un índice.

Una colección de Postgres puede habilitar la búsqueda de texto completo real declarando un bloque `search`, lo que también permite ordenar los resultados por `_score`. Consulta [Búsqueda](/docs/backend/search).

## Búsqueda vectorial

Para colecciones con una propiedad `vector`, ordena las filas por similitud con un embedding de consulta. Las filas se devuelven ordenadas de más cercana a más lejana, cada una con un `_distance`. La
distancia es el orden: un `orderBy` en la misma consulta se ignora. Sin un
`limit`, una búsqueda vectorial devuelve 10 filas, no las 50 de un listado.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` en la misma consulta es un filtro sobre qué filas son candidatas; esto
devuelve las filas más cercanas que también coinciden, no las filas más cercanas
filtradas después. En el índice HNSW eso se cumple desde pgvector 0.8.0 (consulta
[Filtros en un índice aproximado](/docs/backend/vector-search/#filters-on-an-approximate-index));
en un pgvector más antiguo, un filtro que pocas de las filas más cercanas superan devuelve una
página corta. Producir `queryVector` es tu responsabilidad: Rebase almacena y busca
embeddings, no los calcula.

El SDK envía una
búsqueda vectorial como `POST /api/data/<collection>/query`, con el embedding en el
cuerpo: en la URL, 768 dimensiones son unos 17 KB, más de lo que aceptan Node (16 KB) y la mayoría de los
proxies (nginx: 8 KB). `count()` con una búsqueda vectorial va por el mismo camino,
como `POST /api/data/<collection>/count`. Frente a un servidor anterior a la 0.24, que
no tiene esa ruta, cualquiera de las dos recurre al `GET` — y allí un embedding largo
aún puede ser rechazado con un 431 o un 414.

Con un `threshold`,
el resultado no tiene `meta.total` — contar las filas dentro de una distancia lo calcula
para cada fila de la tabla. Pagina con `meta.hasMore`, que sigue siendo exacto.

### Lo que debes proporcionar

- **pgvector.** Una propiedad `vector` se compila en una columna `VECTOR(n)`, y ese tipo proviene de la extensión `vector`. Rebase la instalará por ti, pero solo donde tú le indiques que puede hacerlo:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Esa línea es un permiso más que una solicitud: Rebase ejecuta `CREATE EXTENSION IF NOT EXISTS vector` solo cuando algo en tu esquema lo necesita. Es opcional (opt-in) porque la instalación de una extensión depende de cosas que Rebase no puede ver desde dentro de la conexión: la imagen debe incluir la biblioteca (la plantilla predeterminada `pgvector/pgvector:pg18` lo hace, un `postgres:18` estándar no), el rol debe tener permisos para instalarla y un proveedor administrado debe tenerla en una lista de permitidos.

  Si no indicas nada, Rebase no instala nada; instálala tú manualmente una vez. De cualquier manera, la columna se crea, y Postgres la rechazará con `type "vector" does not exist` en una base de datos que no tenga ninguna de las dos opciones, indicando ambas soluciones.

La columna, su índice ANN y ese `CREATE EXTENSION` se generan en `.rebase/sql/vector.sql`, junto a `schema.sql` y `policies.sql`, y `rebase db push` los aplica por ti. Tienen un archivo propio porque Atlas —el motor detrás de `db push`— calcula sus diferencias materializando `schema.sql` en una base de datos temporal que borra al inicio de cada ejecución, por lo que un `VECTOR(n)` allí se resuelve contra una base de datos que nunca puede tener pgvector.

`rebase db generate` añade ese archivo a la migración que escribe, de modo que una migración reproducida contra una base de datos limpia también crea la columna. Un cambio exclusivo en la propiedad vector no genera ninguna migración, porque el esquema que Atlas compara no ha cambiado; `db generate` lo notificará cuando esto ocurra.

### El índice

Cada columna vectorial obtiene un índice HNSW para distancia coseno, creado junto con la tabla y reportado al iniciar. Coseno porque eso es con lo que mide `vectorSearch` a menos que pases `distance`; un índice sirve exactamente para un operador, por lo que una consulta `l2` contra un índice de coseno volverá silenciosamente a un escaneo completo.

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

`index: false` mantiene el escaneo exacto a propósito. Por encima de 2000 dimensiones, pgvector no puede construir ningún tipo de índice, por lo que la columna se crea y se deja sin indexar, y el arranque lo informa; `vectorSearch` seguirá respondiendo, como un escaneo exacto.

`vectorSearch` es una consulta, no una suscripción: `.listen()` en una de ellas se rechaza en lugar de servirse como un listado simple, porque nada recalcula las distancias tras una escritura.

## Próximos pasos

- [Consultar datos](/docs/sdk/querying/) — el constructor de consultas sobre el que se ejecutan
- [Búsqueda](/docs/backend/search/) — cómo se configuran las búsquedas de texto completo y vectoriales en el backend
- [API REST](/docs/backend/api/) — las mismas consultas a través de HTTP
