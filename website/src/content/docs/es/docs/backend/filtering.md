---
sourceHash: ebc75b9bd33595a6
title: Filtrado en la API REST
sidebar_label: Filtrado
description: Filtra las listas de la API REST con operadores al estilo PostgREST, grupos or/and y el dialecto JSON where, y cómo se combinan los filtros.
---

Utiliza parámetros de consulta al estilo PostgREST para filtrar resultados. El formato es `?field=operator.value`:

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)
```

## Operadores de filtrado

| Operador | Significado | Ejemplo |
|----------|-------------|---------|
| `eq` | Es igual a (`==`) | `?active=eq.true` |
| `neq` | No es igual a (`!=`) | `?status=neq.draft` |
| `gt` | Mayor que (`>`) | `?price=gt.100` |
| `gte` | Mayor o igual que (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor o igual que (`<=`) | `?price=lte.50` |
| `in` | En el array | `?status=in.(a,b,c)` |
| `nin` | No en el array | `?status=nin.(a,b)` |
| `cs` | El array contiene | `?tags=cs.value` |
| `csa` | El array contiene alguno | `?tags=csa.(a,b)` |
| `like` | Coincidencia de patrón, sensible a mayúsculas y minúsculas (`like`) | `?sku=like.AB-%` |
| `ilike` | Coincidencia de patrón, insensible a mayúsculas y minúsculas (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | No coincide con el patrón (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | No coincide con el patrón, insensible a mayúsculas y minúsculas (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La columna es `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La columna no es `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Los cuatro operadores de patrón comparan texto. Una columna enum se compara por su valor
(`?status=like.draft%25`); en un número, una fecha o cualquier otra columna que no sea texto
son un 400 `INVALID_FILTER_OPERATOR`.

`isnull` y `notnull` ignoran su valor: el operador es la condición completa y todo lo que esté después del punto se descarta. El SDK escribe `.null`, por lo que esa es la sintaxis que verás transmitida.

:::caution[`eq.null` es la cadena de cuatro caracteres, no `IS NULL`]
`?deleted_at=eq.null` busca el texto literal `null`. SQL `= NULL` nunca es verdadero, por lo que ninguna interpretación de `eq.null` podría significar la comprobación de nulidad; utiliza `isnull` para ello. El SDK serializa `.where("deleted_at", "==", null)` como `isnull.null` exactamente por esta razón.
:::

## Operadores lógicos

Utiliza `or`, `and` y `not` para condiciones complejas:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` niega la **conjunción** de sus condiciones: `not(a)` es `NOT a`, y `not(a,b)` es `NOT (a AND b)`. Se compila en un `NOT (...)` de SQL real en lugar de operadores invertidos; SQL tiene lógica trivaluada, por lo que `NOT (a AND b)` y `(NOT a) OR (NOT b)` dejan de coincidir en el momento en que hay un NULL involucrado. Por lo tanto, una negación **incluye filas cuya columna es NULL**, que es lo que significa `NOT`; añade un `notnull` junto con él si eso no es lo que deseas.

**Un grupo por solicitud: `or` tiene prioridad sobre `and`, y ambos sobre `not`.** Son tres formas de expresar la misma ranura, no tres filtros. En su lugar, anídalos:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Los grupos pueden anidarse hasta 32 niveles de profundidad; más allá de eso, la solicitud se rechaza con `INVALID_LOGICAL_GROUP`.

Una condición dentro de un grupo cuyo operador el dialecto no tiene —
`?not=(title.contains.x)` — es un 400 `UNKNOWN_FILTER_OPERATOR`, igual que en un `where`
JSON. No se lee como una igualdad sobre `contains.x`, que dentro de `not` habría
coincidido con todas las filas.

Un grupo **restringe** los resultados junto con los filtros de campo en lugar de reemplazarlos; consulta [Cómo se combinan los filtros](#cómo-se-combinan-los-filtros).

## El dialecto JSON `where`

Los filtros de campo anteriores son una de las dos formas de enviar un filtro. La otra es un único objeto JSON, que es lo que el documento de OpenAPI publica en cada `GET /api/data/{slug}` y lo que aceptan las rutas de subcolecciones anidadas:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Cada clave es un campo, y cada valor es una tupla canónica `[operator, value]`, las mismas tuplas que escribe el SDK. Un valor también puede ser una cadena con punto preserializada (`{"status":"eq.active"}`) o un escalar simple (`{"status":"active"}`); las tres se compilan en la misma condición. Un array de valores simples es un `in` implícito: `{"category":["electronics","gadgets"]}` se lee como `["in", ["electronics","gadgets"]]`, mientras que un primer elemento con forma de operador que no es un operador real (`["!!","x"]`) es un 400 `UNKNOWN_FILTER_OPERATOR`.

El mismo objeto se lee igual dondequiera que llegue: aquí, en el `where` del SDK, en una consulta MCP y en el `filter` del socket en tiempo real — sus solicitudes de lista y de recuento y sus suscripciones en vivo.

La diferencia que vale la pena conocer: **JSON preserva los tipos.** `?price=gte.100` envía la cadena `"100"` y el controlador realiza el cast según el tipo de columna, mientras que `?where={"price":[">=",100]}` envía un número. Para una columna cuyas lecturas textuales y numéricas difieran (una cadena de versión, un código con ceros a la izquierda), ese es el parámetro adecuado a utilizar.

Un `where` mal formado devuelve un error 400 `INVALID_WHERE`, no un filtro descartado silenciosamente: descartarlo ejecutaría la lectura sin filtros y devolvería todo lo que la seguridad a nivel de fila (RLS) permita.

## Cómo se combinan los filtros

`?field=op.value`, `?where=`, `?or=`/`?and=` y `?searchString=` son independientes, y cada uno de los que esté presente debe coincidir:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

No hay forma de aplicar un OR entre ellos. Cualquier condición que no sea un AND directo de esos grupos debe ubicarse dentro de un único árbol `or=`/`and=`.

## Próximos pasos

- **[API REST](/docs/backend/api)** — Endpoints, ordenación, paginación e inclusión de relaciones
- **[Consulta de datos](/docs/sdk/querying)** — Los mismos filtros desde el SDK tipado
