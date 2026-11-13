---
sourceHash: 889a7fb508265011
title: Búsqueda vectorial
sidebar_label: Búsqueda vectorial
description: Búsqueda de vecinos más cercanos sobre una columna col.vector() a través de la API REST — los parámetros de consulta, umbrales, embeddings demasiado largos para una URL y cómo se comportan los filtros en un índice HNSW.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una tabla con una columna `col.vector()` se puede buscar por similitud: las filas
más cercanas a un vector de consulta, mediante una distancia de pgvector calculada en la consulta de la base de datos.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Declarar la columna

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        name:      col.text().notNull(),
        embedding: col.vector({ dimensions: 1536, index: { method: "hnsw", metric: ["cosine", "l2"] } }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

`col.vector({ dimensions })` es una columna pgvector de tipo `vector(dimensions)`, leída
y escrita como un `number[]`. Obtiene un índice de vecinos más cercanos aproximados a menos
que `index` indique lo contrario:

| Opción de `index` | Por defecto | Qué hace |
|---|---|---|
| `method` | `"hnsw"` | `"hnsw"` o `"ivfflat"`. |
| `metric` | `"cosine"` | `"cosine"`, `"l2"` o `"ip"` (producto interno), o una lista: se construye un índice por métrica. |
| `m` | El de pgvector | HNSW: conexiones por capa. |
| `efConstruction` | El de pgvector | HNSW: tamaño de la lista de candidatos durante la construcción. |
| `lists` | El de pgvector | IVFFlat: número de listas. |

`index: false` no crea ningún índice, por lo que cada búsqueda vectorial es un escaneo
exacto. Una búsqueda por una distancia que no tiene un índice propio también es un escaneo
exacto, así que indexe cada métrica con la que realice consultas. El parámetro de consulta
escribe el producto interno como `inner_product`; la opción de la columna lo escribe como `ip`.


## Parámetros de consulta

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `vector_search` | `string` | La clave de la columna vectorial sobre la que se realizará la consulta. |
| `vector` | `string` | Un array de números flotantes serializado en JSON que representa el vector de consulta. |
| `vector_distance` | `string` | La métrica de distancia a evaluar. Valores admitidos: `cosine` (por defecto, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Umbral máximo de distancia. Solo se devuelven los registros con una distancia menor a este umbral. |

Una búsqueda vectorial con un
`vector_threshold` no tiene `meta.total`: contar las filas dentro de una distancia implica
calcular esa distancia para cada fila de la tabla, algo para lo que ningún índice sirve —varias
veces el costo de la página en sí, aumentando con filas × dimensiones. `meta.hasMore` es
exacto, al leer una fila más allá de la página. Sin un umbral, el recuento es el
habitual.

Un embedding es largo en una URL: 768 dimensiones representan aproximadamente 17 KB de cadena de consulta y
1536 alrededor de 33 KB. El servidor acepta hasta 64 KB de línea de solicitud y encabezados
(antes 16 KB, un error 431
a partir de 768 dimensiones), y un proxy situado delante suele aceptar menos: el valor por
defecto de nginx es de 8 KB. En su lugar, envíe una búsqueda vectorial como [`POST …/query`](#consultas-demasiado-largas-para-una-url);
el SDK siempre lo hace.

## Filtros en un índice aproximado

Una búsqueda vectorial que
también filtra —un `where`, una búsqueda, seguridad a nivel de fila— devuelve las filas más
cercanas que coincidan. Un índice HNSW responde con un número fijo de candidatos más cercanos
(`hnsw.ef_search`, 40 por defecto), y las demás condiciones se aplican sobre ellos;
cuando pocos de ellos coincidían, la página resultaba incompleta o vacía aunque muchas filas
sí coincidieran, y las páginas con desplazamiento saltaban filas. Con pgvector 0.8.0 o posterior,
la lectura activa el escaneo iterativo de índices de pgvector (`hnsw.iterative_scan = strict_order`,
solo para la transacción de esa lectura), el cual continúa escaneando hasta que la página se llena,
hasta un máximo de `hnsw.max_scan_tuples` (20.000 por defecto); un filtro que casi no coincida con
nada cerca del vector de consulta aún puede devolver una página incompleta. En una versión más antigua
de pgvector y en un índice IVFFlat, una búsqueda vectorial filtrada mantiene el comportamiento de página
incompleta; un escaneo exacto (`index: false`) nunca lo tuvo.

## Consultas demasiado largas para una URL

`POST /api/data/:slug/query`
es el listado al que responde `GET /api/data/:slug`, con los parámetros de consulta en un
cuerpo JSON en lugar de la URL. Utilícelo cuando la URL no quepa: el embedding de una
búsqueda vectorial, un filtro en una lista `in` larga. El SDK envía todas las búsquedas vectoriales
de esta manera, así como cualquier otra consulta cuya URL supere los 6 KB.

```bash
POST /api/data/docs/query
Content-Type: application/json

{
  "vector_search": "embedding",
  "vector": [0.15, 0.22, -0.05],
  "vector_threshold": 0.8,
  "where": { "status": ["==", "published"] },
  "limit": 10
}
```

Las claves del cuerpo son los parámetros de consulta, y el servidor las interpreta de nuevo
exactamente en los parámetros que lee el `GET`, a través del mismo analizador: los mismos filtros,
página, recuento, cursor e inclusiones, la misma seguridad a nivel de fila y los mismos errores. Los valores
se escriben tal como se escribirían en la URL: una cadena (o un número o booleano), y para un filtro
repetido en la URL, una lista (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` y `vector` aceptan su propio valor JSON o ese JSON como una cadena. Pasar una
lista para un parámetro que la URL solo lee una vez, un objeto en cualquier otro lugar o un parámetro
también incluido en la URL devuelve un 400 `INVALID_QUERY_BODY`.

Solo realiza lecturas, por lo que una clave de API necesita `data:read` para ello, no `data:write`, y
cuenta para el mismo límite de tasa que el `GET`. Los listados anidados también disponen de esto:
`POST /api/data/authors/42/posts/query`. Un servidor anterior a 0.24 responde con un 404;
en ese caso, el SDK envía el `GET`.

El recuento tiene
el mismo equivalente: `POST /api/data/:slug/count` (y `POST /api/data/authors/42/posts/count`)
es `GET /api/data/:slug/count` con sus parámetros en el cuerpo, procesados y rechazados
de la misma manera. Un recuento lleva los filtros del `find()` que describe, por lo que su URL
es igual de larga. La función `count()` del SDK sigue la misma regla que `find()` —todas las
búsquedas vectoriales y cualquier recuento cuya URL supere los 6 KB— y recurre al
`GET` frente a un servidor más antiguo.

## Relacionado

- [API REST](/docs/backend/api/) — todos los demás parámetros que acepta un listado
- [Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` desde el SDK
