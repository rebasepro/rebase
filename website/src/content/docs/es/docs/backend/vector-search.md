---
sourceHash: 333a5c7a8ba6fe64
title: Búsqueda vectorial
sidebar_label: Búsqueda vectorial
description: Búsqueda del vecino más cercano sobre una propiedad vectorial a través de la API REST — los parámetros de consulta, los umbrales, los embeddings demasiado largos para una URL y cómo se comportan los filtros en un índice HNSW.
---

Si una colección define una propiedad de tipo `vector`, puedes realizar búsquedas de similitud de alta velocidad con operaciones de distancia de pgvector compiladas directamente en la consulta a la base de datos.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Parámetros de consulta

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `vector_search` | `string` | El nombre de la propiedad vectorial sobre la que consultar. |
| `vector` | `string` | Un array de floats serializado como JSON que representa el vector de consulta. |
| `vector_distance` | `string` | La métrica de distancia a evaluar. Valores admitidos: `cosine` (por defecto, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Umbral máximo de distancia. Solo se devuelven los registros cuya distancia es menor que este umbral. |

<span class="since-badge" data-since="0.25">Desde 0.25</span> Una búsqueda vectorial con un
`vector_threshold` no tiene `meta.total`: contar las filas dentro de una distancia significa
calcular esa distancia para cada fila de la tabla, algo que ningún índice sirve — varias
veces el coste de la propia página, y crece con filas × dimensiones. `meta.hasMore` es
exacto, al leer una fila más allá de la página. Sin umbral, el recuento es el
habitual.

Un embedding es largo en una URL: 768 dimensiones son unos 17 KB de cadena de consulta y
1536 unos 33 KB. El servidor acepta hasta 64 KB de línea de petición y cabeceras
(<span class="since-badge" data-since="0.25">Desde 0.25</span>; antes eran 16 KB, un 431
a partir de 768 dimensiones), y un proxy delante suele aceptar menos — el valor por defecto de
nginx es 8 KB. Envía una búsqueda vectorial como [`POST …/query`](#consultas-demasiado-largas-para-una-url)
en su lugar; el SDK siempre lo hace.

## Filtros sobre un índice aproximado

<span class="since-badge" data-since="0.25">Desde 0.25</span> Una búsqueda vectorial que
también filtra — un `where`, una búsqueda, seguridad a nivel de fila — devuelve las filas más cercanas
que coinciden. Un índice HNSW responde con un número fijo de candidatos más cercanos
(`hnsw.ef_search`, 40 por defecto), y las demás condiciones se aplican a esos;
cuando pocos coinciden, la página volvía corta o vacía aunque muchas filas
coincidieran, y las páginas por offset se saltaban filas. Con pgvector 0.8.0 o posterior la lectura activa el
escaneo iterativo de índice de pgvector (`hnsw.iterative_scan = strict_order`, solo para la
transacción de esa lectura), que sigue escaneando hasta llenar la página, hasta
`hnsw.max_scan_tuples` (20 000 por defecto) — un filtro que casi nada coincide
cerca del vector de consulta aún puede devolver una página corta. Con un pgvector más antiguo, y con
un índice IVFFlat, una búsqueda vectorial filtrada mantiene el comportamiento de página corta; un escaneo
exacto (`index: false`) nunca lo tuvo.

## Consultas demasiado largas para una URL

<span class="since-badge" data-since="0.25">Desde 0.25</span> `POST /api/data/:slug/query`
es el listado que responde `GET /api/data/:slug`, con los parámetros de consulta en un cuerpo
JSON en lugar de la URL. Úsalo cuando la URL no cabría — el embedding de una búsqueda vectorial,
un filtro sobre una lista `in` larga. El SDK envía así toda búsqueda vectorial,
y cualquier otra consulta cuya URL pasaría de 6 KB.

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

Las claves del cuerpo son los parámetros de consulta, y el servidor las vuelve a leer como
exactamente los parámetros que lee el `GET`, con el mismo analizador — mismos filtros,
página, recuento, cursor e includes, misma seguridad a nivel de fila, mismos errores. Un valor se
escribe como lo escribe la URL: una cadena (o un número o booleano), y para un filtro
repetido en la URL una lista (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` y `vector` aceptan su propio valor JSON o ese JSON como cadena. Una
lista para un parámetro que la URL lee una sola vez, un objeto en cualquier otro sitio, o un parámetro
puesto también en la URL es un 400 `INVALID_QUERY_BODY`.

Solo lee, así que una clave de API necesita `data:read` para ello, no `data:write`, y
cuenta contra el mismo límite de tasa que el `GET`. Los listados anidados también lo tienen:
`POST /api/data/authors/42/posts/query`. Un servidor anterior a 0.24 lo responde con 404;
el SDK envía entonces el `GET`.

<span class="since-badge" data-since="0.25">Desde 0.25</span> El recuento tiene el
mismo gemelo: `POST /api/data/:slug/count` (y `POST /api/data/authors/42/posts/count`)
es `GET /api/data/:slug/count` con sus parámetros en el cuerpo, leído del mismo modo
y rechazado del mismo modo. Un recuento lleva los filtros del `find()` que describe,
así que su URL es igual de larga. El `count()` del SDK sigue la regla de `find()` — toda
búsqueda vectorial, y todo recuento cuya URL pasaría de 6 KB — y recurre al
`GET` frente a un servidor más antiguo.

## Relacionado

- [API REST](/docs/backend/api/) — cualquier otro parámetro que acepta un listado
- [Agregados y búsqueda](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` desde el SDK, y el índice que recibe una propiedad vectorial
