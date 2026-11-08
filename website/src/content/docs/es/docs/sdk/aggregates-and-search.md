---
sourceHash: 7715c57bf7cc986a
title: Agregados y búsqueda
sidebar_label: Agregados y búsqueda
description: "Cuenta, suma y agrupa con el SDK, filtra dentro de columnas JSON y ejecuta búsquedas de texto completo y vectoriales desde el cliente."
---

## Agregados

`count`, `sum`, `avg`, `min` y `max` sobre las filas que selecciona un filtro, sin
recuperarlas:

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

Los resultados se indexan por función y campo; `count()` se convierte en `count`,
`sum(total)` se convierte en `sum_total`.

Los grupos se paginan como las filas de un listado. `limit` los delimita, `offset` (o `page`)
los omite y `orderBy` los ordena por un campo de `groupBy` o una clave de resultado. El
orden siempre termina en las claves de grupo, por lo que cada límite de página cae en el mismo
lugar. Un agregado agrupado sin `limit` se corta en el valor predeterminado del listado (50
grupos), igual que un listado. Con un `limit`, incluido el predeterminado, la
respuesta indica si hay más, y el método `aggregate()` del SDK lo devuelve
como `meta` en el resultado:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

Un `offset`, `page` u `orderBy` sin un `groupBy`, o un cursor en cualquier agregado,
es un error `400 INVALID_AGGREGATE_WINDOW`: un agregado no agrupado tiene una sola fila, y un
grupo no es una fila después de la cual un cursor pueda continuar.

Un agregado lee los valores almacenados y nunca ejecuta `afterRead`. Por lo tanto, en una
colección que un callback `afterRead` reescribe (ya sea global, de colección o de propiedad),
solo se sirve `count()` sin `groupBy`, tanto a través de HTTP como en el proceso;
cualquier otra cosa produce un `400 AGGREGATE_MASKED_BY_AFTER_READ`, porque una suma, un
máximo o un grupo leerían los valores que el callback oculta.

Desde el SDK, `aggregate()` acepta el mismo `orderBy` que un `find()`: una
tupla `[key, "asc" | "desc"]` o una lista de ellas, donde la clave es una columna de
`groupBy` o una clave de resultado. Ambas están tipadas: en un modelo generado, una clave que
no sea ninguna de las dos no compila. En el proceso (`rebase.data`), los grupos se devuelven en
el mismo orden que a través de HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Acepta los mismos filtros que el endpoint de listado, por lo que un agregado se puede acotar
de la misma forma que un listado:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La seguridad a nivel de fila se aplica a las filas que se agregan.** Un agregado es una
forma eficiente de obtener información sobre filas que no puedes leer, por lo que se ejecuta bajo las
propias políticas de quien realiza la llamada: alguien que no puede seleccionar nada no cuenta nada.
:::

Los agregados necesitan un driver que los implemente. En uno que no lo haga, el
endpoint responde `501` en lugar de un resultado vacío: no se debería indicar a un panel de control
"sin coincidencias" cuando la verdad es "no soportado".

## Filtrar dentro de JSON

Una columna `json` o `jsonb` se puede filtrar por ruta, utilizando la sintaxis de flecha propia de Postgres:

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

Los segmentos de ruta siempre se envían como parámetros vinculados, nunca interpolados en SQL.

### Cómo se comparan los valores

`->>` produce **texto**, por lo que las comparaciones son comparaciones de texto, excepto que a un
operador de ordenamiento (`>`, `>=`, `<`, `<=`) al que se le pasa un **número** lo convierte a numérico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Las filas cuyo valor en esa ruta no sea un número se excluyen de una comparación
numérica en lugar de fallar la consulta. Los booleanos se comparan como `"true"` /
`"false"`, que es como `->>` los representa.

:::note
`array-contains` y los demás operadores de columna completa no están disponibles en una
ruta: hacen una consulta sobre el documento completo, por lo que deben usarse en la columna
misma.
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

De forma predeterminada, esto es una **coincidencia de subcadena que no distingue entre mayúsculas y minúsculas** en las
propiedades `string` de nivel superior de la colección. No es una búsqueda de texto completo: no
accede al interior de propiedades `map` o `array`, no realiza lematización ni clasificación, y no puede
utilizar un índice.

Una colección de Postgres puede habilitar la búsqueda de texto completo real declarando un
bloque `search`, lo que también permite clasificar los resultados por `_score`. Consulta
[Búsqueda](/docs/backend/search).

## Búsqueda vectorial

Para colecciones con una propiedad `vector`, ordena las filas por similitud con un
embedding de consulta. Las filas se devuelven primero las más cercanas, y cada una incluye un `_distance`. La
distancia determina el orden: cualquier `orderBy` en la misma consulta se ignora. Sin un
`limit`, una búsqueda vectorial devuelve 10 filas, no las 50 de un listado.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

Un `where` en la misma consulta es un filtro sobre qué filas son candidatas: esto
devuelve las filas más cercanas que también coinciden, no las filas más cercanas filtradas
después. En el índice HNSW esto aplica a partir de pgvector 0.8.0 (consulta
[Filters on an approximate index](/docs/backend/vector-search/#filters-on-an-approximate-index));
en una versión anterior de pgvector, un filtro que pocas de las filas más cercanas superen devuelve una página
corta. Generar el `queryVector` es tu responsabilidad: Rebase almacena y busca
embeddings, no los calcula.

El SDK envía una
búsqueda vectorial como `POST /api/data/<collection>/query`, con el embedding en el
cuerpo: en la URL, 768 dimensiones ocupan unos 17 KB, superando lo que Node (16 KB) y la mayoría de
los proxies (nginx: 8 KB) aceptan. `count()` con una búsqueda vectorial funciona de la misma manera,
como `POST /api/data/<collection>/count`. Frente a un servidor anterior a 0.24, que
no tiene dicha ruta, ambos recurren a `GET`, y un embedding largo allí
aún puede ser rechazado con un 431 o un 414.

Con un `threshold`,
el resultado no incluye `meta.total`: contar las filas dentro de una distancia requiere calcularla
para cada fila de la tabla. Pagina con `meta.hasMore`, que se mantiene exacto.

### Lo que debes proporcionar

- **pgvector.** Una propiedad `vector` se compila en una columna `VECTOR(n)`, y ese
  tipo proviene de la extensión `vector`. Rebase la instalará por ti, pero
  solo donde le autorices a hacerlo:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Esa línea es un permiso más que una solicitud: Rebase ejecuta
  `CREATE EXTENSION IF NOT EXISTS vector` solo cuando algo en tu esquema
  lo necesita. Es opcional porque instalar una extensión depende de cosas
  que Rebase no puede ver desde dentro de la conexión: la imagen debe incluir la
  biblioteca (la del scaffold `pgvector/pgvector:pg18` la incluye, un `postgres:18`
  estándar no), el rol debe tener permisos para instalarla y un proveedor administrado
  debe tenerla en una lista de permitidos.

  Si no especificas nada, Rebase no instala nada; instálala una vez a mano en su lugar.
  De cualquier manera, la columna se crea y Postgres la rechaza con
  `type "vector" does not exist` en una base de datos que no tiene ninguna de las dos cosas, señalando ambas
  soluciones.

La columna, su índice ANN y ese `CREATE EXTENSION` se generan en
`.rebase/sql/vector.sql`, junto a `schema.sql` y `policies.sql`, y `rebase db
push` los aplica por ti. Tienen un archivo propio porque Atlas (el
motor detrás de `db push`) calcula su diferencia materializando `schema.sql` en una
base de datos temporal que borra al inicio de cada ejecución, por lo que un `VECTOR(n)` allí
se resuelve contra una base de datos que nunca puede tener pgvector.

`rebase db generate` añade ese archivo a la migración que escribe, de modo que una
migración reproducida en una base de datos nueva también construye la columna. Un cambio solo en
la propiedad de vector no genera ninguna migración, porque el esquema que Atlas compara
no cambia; `db generate` lo notifica cuando esto sucede.

### El índice

Cada columna vectorial obtiene un índice HNSW para la distancia del coseno, creado con la
tabla e informado en el arranque. Coseno porque eso es con lo que mide `vectorSearch`
a menos que pases `distance`: un índice atiende exactamente a un operador, por lo que una
consulta `l2` contra un índice de coseno vuelve silenciosamente a realizar un escaneo completo.

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

`index: false` mantiene el escaneo exacto a propósito. Por encima de 2000 dimensiones, pgvector
no puede construir ningún tipo de índice, por lo que la columna se crea y se deja sin indexar, y
el arranque lo indica; `vectorSearch` sigue respondiendo, mediante un escaneo exacto.

`vectorSearch` es una consulta, no una suscripción: un `.listen()` sobre ella se rechaza
en lugar de servirse como un listado simple, porque nada recalcula las distancias en una
escritura.

## Próximos pasos

- [Consulta de datos](/docs/sdk/querying/) — el generador de consultas sobre el que se ejecutan
- [Búsqueda](/docs/backend/search/) — cómo se configuran la búsqueda de texto completo y vectorial en el backend
- [API REST](/docs/backend/api/) — las mismas consultas a través de HTTP
