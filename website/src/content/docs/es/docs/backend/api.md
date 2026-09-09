---
sourceHash: 10463431afdfaea5
title: API REST
sidebar_label: API REST
description: Endpoints de API REST generados automáticamente para cada colección, con filtrado, ordenación, paginación e inclusión de relaciones.
---

## Resumen

Rebase genera automáticamente una API completa a partir de las definiciones de tus colecciones:

- **API REST** — Endpoints CRUD para cada colección en `/api/data/:slug`
- **Especificación OpenAPI** — Especificación legible por máquina en `/api/docs`
- **Swagger UI** — Explorador interactivo de la API en `/api/swagger` (solo en modo de desarrollo)

No se requiere código: define tus colecciones y la API aparecerá automáticamente.

## Endpoints REST

Para cada colección, se generan los siguientes endpoints. Cualquier otra ruta que monte el backend (auth, storage, admin, meta) se encuentra en el [índice de endpoints](/docs/backend/endpoints/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades |
| `GET` | `/api/data/:slug/count` | Contar entidades |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opcionalmente agrupados. Acepta los mismos filtros que el endpoint de listado, y RLS se aplica a las filas que se agregan; consulta [Consultas](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obtener una sola entidad |
| `POST` | `/api/data/:slug` | Crear un registro |
| `PATCH` | `/api/data/:slug/:id` | Actualizar un registro (parcial: solo se escriben las propiedades enviadas) |
| `DELETE` | `/api/data/:slug/:id` | Eliminar un registro |
| `POST` | `/api/data/:slug/bulk` | Crear múltiples entidades en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar múltiples entidades en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar múltiples entidades en una sola transacción |
| `POST` | `/api/data/_batch` | Escribir **entre** colecciones en una sola transacción |

### Rutas de subcolecciones

Las relaciones anidadas son accesibles a través de rutas de URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mecánica de enrutamiento y análisis de segmentos

Para manejar profundidades arbitrarias de subcolecciones anidadas, Rebase enruta las solicitudes entrantes utilizando la expresión regular del parámetro `:rest{.+}` de Hono. El motor interno de análisis de segmentos analiza las rutas contando los segmentos separados por barras:
- **Recuento impar de segmentos** (ej., `authors/42/posts` -> 3 segmentos) representa una solicitud de listado de colección.
- **Recuento par de segmentos** (ej., `authors/42/posts/7` -> 4 segmentos) representa una operación sobre un ID de entidad específico. El último segmento se extrae como el `entityId` de destino.

El motor filtra los espacios de nombres reservados del sistema (ej., `history`) del análisis de segmentos de ruta para evitar colisiones con los endpoints integrados.

## Autenticación

Todos los endpoints de datos requieren autenticación por defecto. Incluye un token Bearer en el encabezado `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Para llamadas de servidor a servidor, utiliza la clave de servicio:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtrado

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

### Operadores de filtro

| Operador | Significado | Ejemplo |
|----------|-------------|---------|
| `eq` | Igual (`==`) | `?active=eq.true` |
| `neq` | No igual (`!=`) | `?status=neq.draft` |
| `gt` | Mayor que (`>`) | `?price=gt.100` |
| `gte` | Mayor o igual (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor o igual (`<=`) | `?price=lte.50` |
| `in` | En el array | `?status=in.(a,b,c)` |
| `nin` | No en el array | `?status=nin.(a,b)` |
| `cs` | El array contiene | `?tags=cs.value` |
| `csa` | El array contiene alguno | `?tags=csa.(a,b)` |
| `like` | Coincidencia de patrón, sensible a mayúsculas y minúsculas (`like`) | `?sku=like.AB-%` |
| `ilike` | Coincidencia de patrón, insensible a mayúsculas y minúsculas (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | No coincide con el patrón (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | No coincide, insensible a mayúsculas y minúsculas (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La columna es `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La columna no es `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` y `notnull` ignoran su valor: el operador es la condición completa, y cualquier cosa después del punto se descarta. El SDK escribe `.null`, por lo que esa es la sintaxis que verás en la red.

:::caution[`eq.null` es la cadena de cuatro caracteres, no `IS NULL`]
`?deleted_at=eq.null` busca el texto literal `null`. SQL `= NULL` nunca es verdadero, por lo que no hay interpretación de `eq.null` que signifique la comprobación de nulos; utiliza `isnull` para ello. El SDK serializa `.where("deleted_at", "==", null)` como `isnull.null` exactamente por esta razón.
:::

### Operadores lógicos

Utiliza `or`, `and` y `not` para condiciones complejas:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` niega la **conjunción** de sus condiciones: `not(a)` es `NOT a`, y `not(a,b)` es `NOT (a AND b)`. Se compila a un `NOT (...)` real de SQL en lugar de a operadores invertidos: la lógica de SQL es trivaluada, por lo que `NOT (a AND b)` y `(NOT a) OR (NOT b)` dejan de coincidir en el momento en que interviene un NULL. Por lo tanto, una negación **incluye filas cuya columna es NULL**, que es lo que significa `NOT`; añade un `notnull` con AND junto a él si no es eso lo que deseas.

**Un grupo por solicitud: `or` tiene prioridad sobre `and`, y ambos sobre `not`.** Son tres formas de escribir el mismo espacio, no tres filtros. En su lugar, anídalos:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Los grupos pueden anidarse hasta 32 niveles de profundidad; más allá de eso, la solicitud se rechaza con `INVALID_LOGICAL_GROUP`.

Un grupo **restringe** junto con los filtros de campo en lugar de reemplazarlos; consulta [Cómo se combinan los filtros](#cómo-se-combinan-los-filtros).

### El dialecto JSON de `where`

Los filtros de campo anteriores son una de las dos formas de enviar un filtro. La otra es un único objeto JSON, que es lo que el documento OpenAPI publica en cada `GET /api/data/{slug}` y lo que aceptan las rutas de subcolecciones anidadas:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Cada clave es un campo y cada valor es una tupla canónica `[operator, value]`, las mismas tuplas que escribe el SDK. Un valor también puede ser una cadena con punto pre-serializada (`{"status":"eq.active"}`) o un escalar simple (`{"status":"active"}`); las tres compilan a la misma condición.

La diferencia que vale la pena conocer: **JSON conserva los tipos.** `?price=gte.100` envía la cadena `"100"` y el controlador la convierte según el tipo de columna, mientras que `?where={"price":[">=",100]}` envía un número. Para una columna cuyas interpretaciones de texto y numéricas difieren (una cadena de versión, un código con ceros a la izquierda), ese es el parámetro adecuado.

Un `where` mal formado devuelve un error 400 `INVALID_WHERE`, no un filtro descartado silenciosamente: descartarlo ejecutaría la lectura sin filtros y devolvería todo lo que la seguridad a nivel de fila (RLS) permita.

### Cómo se combinan los filtros

`?field=op.value`, `?where=`, `?or=`/`?and=` y `?searchString=` son independientes, y cada uno de los que esté presente debe coincidir:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

No hay forma de aplicar un OR entre ellos. Cualquier cosa que no sea un AND simple de esos grupos debe ir dentro de un único árbol `or=`/`and=`.

## Ordenación

Utiliza `orderBy` con el formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

La dirección por defecto es `asc`. Una dirección que no sea ni `asc` ni `desc`, o un campo que la colección no tenga, devuelve un **400**, no un 200 con las filas en el orden que la base de datos decida, lo cual es indistinguible de una ordenación que funcionó correctamente.

### Varias claves

La sintaxis abreviada admite una clave. Para más claves, pasa un array JSON; la segunda clave desempatará las filas que la primera considere iguales:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Ambas sintaxis funcionan en todas las rutas que listan filas, incluidas las anidadas (`/api/data/authors/:id/posts`). Toda ordenación finaliza con el id de la fila en orden descendente, se haya solicitado o no: esto es lo que hace que la ordenación sea total, y paginar sobre un orden que no es total repite y omite filas.

Un parámetro `?orderBy=` repetido no es una ordenación de múltiples claves: el último prevalece, como ocurre con cualquier otro parámetro de consulta. Utiliza el array.

### Dónde se ordenan los valores NULL

Por defecto, los valores NULL se ordenan **al final de forma ascendente y al principio de forma descendente**, que es la convención propia de Postgres. Un tercer segmento separado por dos puntos permite cambiar esto:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

El formato de array JSON acepta una clave `"nulls"` para lo mismo:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Cualquier valor distinto de `first` o `last` devuelve un 400, no un orden silenciosamente diferente. El cursor descrito a continuación respeta lo que haya declarado la ordenación, por lo que la paginación sobre una clave que admite nulos sigue siendo correcta bajo cualquier ubicación.

## Paginación

Utiliza `limit` y `offset`, o `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

El límite por defecto es **50** y el máximo es **1000**. Ambos provienen de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, que la especificación OpenAPI generada también reporta; un `limit` superior al máximo se rechaza en lugar de ajustarse.

Los tres parámetros de ventana se rechazan en lugar de corregirse, y cada uno se identifica a sí mismo: `INVALID_LIMIT`, `INVALID_OFFSET` (un número entero mayor o igual a 0) e `INVALID_PAGE` (un número entero mayor o igual a 1). Una ventana silenciosamente diferente a la solicitada no se puede distinguir de haber llegado al final de la colección, razón por la cual ninguno de ellos se ajusta ni se ignora.

### Paginación por cursor

`offset` vuelve a contar las filas en cada solicitud, por lo que una fila insertada o eliminada entre dos páginas desplaza la ventana y el recorrido omite o repite filas silenciosamente. En su lugar, `?after=` busca por posición: la página siguiente comienza estrictamente después de la última fila servida.

Cada respuesta de listado incluye `meta.nextCursor` mientras haya otra página. Envíalo de vuelta sin modificaciones:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

El cursor es **opaco** (codifica las claves de ordenación *y* los valores de la última fila para ellas), por lo que se aplican tres reglas, cada una resultando en un 400 en lugar de una página incorrecta:

| Situación | Código |
|-----------|--------|
| `after` con `offset` o `page` | `CURSOR_WITH_OFFSET`: ambos indican dónde comienza la página |
| `after` con un `orderBy` diferente al que se emitió | `CURSOR_ORDER_MISMATCH` |
| Un cursor que esta API no emitió | `INVALID_CURSOR` |

Una solicitud que no especifique ningún `orderBy` **adopta el del cursor**, por lo que reenviar `meta.nextCursor` sin volver a definir la ordenación funciona.

Tanto las ordenaciones de múltiples claves como las claves que admiten nulos se paginan correctamente: la comparación se construye sobre cada clave en orden, con la ubicación de NULL que declaró la ordenación. La única ordenación que ningún cursor puede describir es la relevancia (`_score`), calculada por consulta y no almacenada en ninguna parte, por lo que dicho listado simplemente no incluye `nextCursor`.

## Selección de columnas

`?fields=` restringe una lectura a las columnas que especifiques. Es una proyección insertada en la consulta, no un recorte de la respuesta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La clave primaria siempre se devuelve (una fila que no se puede direccionar no se puede actualizar, eliminar ni paginar, y el cursor se deriva de ella), y las columnas `excludeFromApi` permanecen ocultas se hayan especificado o no. Una columna desconocida devuelve un 400 `UNKNOWN_FIELD` en lugar de una fila a la que silenciosamente le falta un campo.

`?distinct=true` colapsa filas idénticas en esas columnas:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Se rechaza (400) cuando se usa junto con un `searchString` clasificado o una búsqueda vectorial, que adjuntan una puntuación por fila haciendo que cada fila sea distinta por definición, y cuando `orderBy` nombra una columna que `fields` no devuelve (`DISTINCT_ORDER_BY_NOT_SELECTED`): Postgres no puede ordenar una lectura DISTINCT por una expresión fuera de su lista de selección.

`?fields=` y `?distinct=` también funcionan en la ruta de obtención por ID y en las rutas de subcolecciones anidadas.

### Formato de respuesta

Las respuestas de listado incluyen metadatos de paginación:

```json
{
    "data": [
        { "id": 1, "name": "Widget", "price": 29.99 },
        { "id": 2, "name": "Gadget", "price": 49.99 }
    ],
    "meta": {
        "total": 150,
        "limit": 20,
        "offset": 0,
        "hasMore": true,
        "nextCursor": "eyJrIjpbWyJpZCIsImRlc2MiXV0sInYiOnsiaWQiOjJ9LCJpIjoyfQ"
    }
}
```

`nextCursor` está presente mientras `hasMore` sea verdadero y la página haya devuelto al menos una fila; está ausente en la última página y en una ordenación que ningún cursor pueda describir.

Las respuestas de una sola entidad devuelven un objeto plano:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Errores

Cada fallo, de cualquier ruta, se devuelve en una única estructura envolvente:

```json
{
    "error": {
        "message": "Unknown filter operator 'contains' on field 'title'.",
        "code": "UNKNOWN_FILTER_OPERATOR",
        "details": { "field": "title", "operator": "contains" },
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

`message` y `code` siempre están presentes. `details` aparece cuando el rechazo trata *sobre* algo en concreto (el campo que era incorrecto, las rutas que fallaron). `requestId` aparece cuando la solicitud incluía un encabezado `X-Request-ID` o se le asignó uno; también se refleja en el encabezado de respuesta y es lo que se debe citar en un informe de errores.

**Bifurca tu lógica según `code`, nunca según `message` o solo por el estado HTTP.** Los códigos están en `SCREAMING_SNAKE_CASE` y son estables; los mensajes están escritos para una persona que lee una consola y pueden cambiar. El estado HTTP se encuentra en la respuesta, no en el cuerpo.

| Estado | Código típico | Significado |
|--------|---------------|-------------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La solicitud está mal formada o pide algo imposible |
| 401 | `UNAUTHORIZED` | Sin credencial, o con una que no identifica a nadie |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Una credencial que identifica a alguien sin los permisos necesarios |
| 404 | `NOT_FOUND` | El recurso solicitado no existe |
| 409 | `CONFLICT` | El estado entra en conflicto: una clave duplicada, un árbol desincronizado |
| 501 | varía | La superficie existe pero **no está configurada** en este despliegue |
| 503 | `SERVICE_UNAVAILABLE` | Una dependencia está caída; la solicitud nunca llegó a ella |

Una superficie que está ausente porque este despliegue no la habilitó responde 501 con un código y un motivo, no 404; un 404 inexplicado en una ruta a la que la interfaz de usuario acaba de llamar se interpreta como un despliegue defectuoso.

Las rutas agregan sus propios códigos más específicos sobre estos (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), así que considera la lista de códigos como abierta. El SDK del cliente los transforma a todos en un único `RebaseApiError` que contiene `status`, `code` y `details`; consulta [Manejo de errores](/docs/backend#error-handling).

## Búsqueda de texto

Utiliza `searchString` para búsquedas de texto completo en campos de texto:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Búsqueda vectorial

Si una colección define una propiedad de tipo `vector`, puedes realizar búsquedas de similitud de alta velocidad utilizando operaciones de distancia de pgvector compiladas directamente en la consulta a la base de datos.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parámetros de consulta vectorial

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `vector_search` | `string` | El nombre de la propiedad vectorial sobre la que se realiza la consulta. |
| `vector` | `string` | Un array de números decimales (floats) serializado en JSON que representa el vector de consulta. |
| `vector_distance` | `string` | La métrica de distancia a evaluar. Valores admitidos: `cosine` (por defecto, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Umbral de distancia máxima. Solo se devuelven los registros con una distancia menor a este umbral. |

## Inclusión de relaciones

Utiliza el parámetro `include` para incrustar entidades relacionadas:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Un nombre que no sea una relación de la colección devuelve un **400 `UNKNOWN_RELATION`**, en todos los niveles. Anteriormente se ignoraba, respondiendo 200 con el campo simplemente ausente, indistinguible de una fila que realmente no tiene una fila relacionada, por lo que un error tipográfico parecía exactamente datos vacíos. Una ruta con más de tres saltos devuelve `INCLUDE_TOO_DEEP`.

### Restringir una relación

El formato separado por comas no tiene dónde colocar un `limit` por relación, por lo que `include` también acepta JSON, reconocible por una llave inicial:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Clave | Significado |
|-------|-------------|
| `limit` | Filas **por fila primaria**, no en toda la página |
| `where` | El mismo dialecto de filtro que utiliza el `where` de nivel superior |
| `logical` | Un grupo `or`/`and`/`not` sobre las filas relacionadas |
| `orderBy` | La misma sintaxis de ordenación, incluida la ubicación de NULL |
| `fields` | Columnas de la fila *relacionada*; su clave primaria siempre se conserva |
| `include` | Relaciones de la fila relacionada, a su vez |

`true` significa "cargarla por completo", por lo que `{"author":true}` y `author` son la misma solicitud. Ambas sintaxis funcionan en la ruta de listado, en la ruta de obtención por ID y en las rutas de subcolecciones anidadas.

Cada salto es una única consulta por lotes para toda la página, nunca una por fila.

Las relaciones incluidas se incrustan directamente en la respuesta:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Escritura

Las claves de idempotencia, las escrituras condicionales (`ETag` / `If-Match`), las operaciones de campo (`$inc`, `$push`, `$pull`, `$merge`), el upsert sobre una clave natural, `Prefer: return=minimal` y el endpoint entre colecciones `POST /api/data/_batch` se encuentran en su propia página: **[Escritura a través de REST](/docs/backend/writes/)**.

## Canalización de hooks del ciclo de vida

Cada operación de mutación REST (`POST`, `PATCH`, `DELETE`) se ejecuta a través de una canalización de ejecución de hooks secuencial y estricta:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks bloqueantes frente a diferidos

1. **Hooks bloqueantes (`beforeSave`, `beforeDelete`)**
   Estos hooks se ejecutan de forma sincrónica en el ciclo principal de la solicitud *antes* de confirmar la transacción de la base de datos. Pueden modificar los datos entrantes (payloads), ejecutar validaciones personalizadas o abortar la solicitud por completo lanzando un error.

2. **Hooks diferidos (`afterSave`, `afterDelete`)**
   Estos hooks se ejecutan de forma asíncrona después de que la transacción de la base de datos se haya confirmado exitosamente. Utilizan promesas diferidas (fire-and-forget), lo que significa que se ejecutan en segundo plano y no bloquean la respuesta HTTP al cliente. Son ideales para enviar webhooks, activar notificaciones push o poner tareas externas en cola.

## Endpoints del sistema

| Método | Ruta | Autenticación | Descripción |
|--------|------|---------------|-------------|
| `GET` | `/health` y `/api/health` | ninguna | Verificación de disponibilidad y preparación (liveness/readiness) |
| `GET` | `/api/docs` | ninguna | La especificación OpenAPI 3.0 en formato JSON |
| `GET` | `/api/swagger` | ninguna | Swagger UI. Activado en desarrollo, desactivado en producción; `REBASE_ENABLE_SWAGGER` lo anula en cualquier caso |
| `GET` | `/api/meta/schema-version` | ninguna | El hash del esquema a partir del cual se construyó este backend: deliberadamente sin autenticación, y solo devuelve dicho hash |
| `GET` | `/api/meta/contract` | admin, clave de servicio o clave de API de admin | El contrato completo de colecciones, para `rebase generate-sdk --from`. Cierre seguro por fallo (fail-closed): `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |

## OpenAPI / Swagger

La especificación OpenAPI se genera automáticamente a partir de las definiciones de tus colecciones: describe los endpoints de listado, lectura, creación, actualización, eliminación y operaciones masivas de cada colección que sirve el backend, con sus parámetros de consulta y esquemas de respuesta. No es un mapa completo de toda la superficie HTTP (las rutas de autenticación, almacenamiento, funciones y cron se documentan únicamente en este sitio) y las columnas marcadas como `excludeFromApi` quedan excluidas de ella.

Los clientes automatizados se autentican con una clave con permisos delimitados en lugar de una sesión: [Claves de API](/docs/backend/api-keys/).

## Metadatos del esquema

El esquema completo de colecciones del proyecto (cada colección, propiedad y relación) se sirve a un administrador autenticado:

```bash
GET /api/meta/contract
```

Es **solo para administradores**, y en un despliegue sin autenticación configurada no se sirve en absoluto (404 `CONTRACT_UNAVAILABLE`) en lugar de exponer el esquema a cualquiera. Su endpoint hermano devuelve una cadena de versión que representa el esquema sin describirlo, y es deliberadamente accesible sin credenciales, que es lo que sondea un trabajo de CI:

```bash
GET /api/meta/schema-version
```

Para conocer la estructura de los endpoints en lugar del esquema subyacente, el documento OpenAPI se encuentra en `GET /api/docs`, con Swagger UI en `/api/swagger` cuando `enableSwagger` está habilitado.

## Próximos pasos

- **[SDK del cliente](/docs/sdk)** — Cliente con seguridad de tipos para la API REST
- **[Colecciones](/docs/collections)** — Define tu esquema de datos
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules)** — Controla el acceso por fila

---
