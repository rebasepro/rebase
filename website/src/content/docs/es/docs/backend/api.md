---
sourceHash: 4fc45b4d1d08afde
title: API REST
sidebar_label: API REST
description: Endpoints de API REST autogenerados para cada tabla, con filtrado, ordenación, paginación e inclusión de relaciones.
---

## Descripción general

Rebase genera automáticamente una API completa a partir de tus tablas:

- **API REST** — Endpoints CRUD para cada tabla en `/api/data/:slug`
- **Especificación OpenAPI** — Especificación legible por máquina en `/api/docs`, servida a cada cliente autenticado para las tablas que puede ver
- **Swagger UI** — Explorador interactivo de API en `/api/swagger`, cuando publicas el documento (`REBASE_ENABLE_SWAGGER=true`, fuera de producción)

No se requiere código: [declara tus tablas](/docs/schema/) y la API aparecerá automáticamente.

## Endpoints REST

Para cada tabla, se generan los siguientes endpoints. Cualquier otra ruta que monte el backend (autenticación, almacenamiento, administración, metadatos) se encuentra en el [índice de endpoints](/docs/backend/endpoints/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades |
| `POST` | `/api/data/:slug/query` | El mismo listado, con sus parámetros de consulta en un cuerpo JSON, para una consulta demasiado larga para una URL. Consulta [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | Contar entidades |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opcionalmente agrupados. Acepta los mismos filtros que el endpoint de listado, y RLS se aplica a las filas agregadas; consulta [Consultas](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obtener una sola entidad |
| `POST` | `/api/data/:slug` | Crear un registro |
| `PATCH` | `/api/data/:slug/:id` | Actualizar un registro (parcial: solo se escriben las propiedades enviadas) |
| `DELETE` | `/api/data/:slug/:id` | Eliminar un registro |
| `POST` | `/api/data/:slug/bulk` | Crear múltiples entidades en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar múltiples entidades en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar múltiples entidades en una sola transacción |
| `POST` | `/api/data/_batch` | Escribir **entre** tablas en una sola transacción |

### Rutas anidadas

Las relaciones son accesibles a través de rutas URL:

```
GET    /api/data/authors/42/posts         → list author's posts
POST   /api/data/authors/42/posts/query   → the same listing, parameters in the body (0.24+)
POST   /api/data/authors/42/posts/count   → the same count, parameters in the body (0.24+)
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mecánica de enrutamiento y análisis de segmentos

Para manejar profundidades de anidamiento arbitrarias, Rebase enruta las solicitudes entrantes utilizando la expresión regular de parámetros `:rest{.+}` de Hono. El motor interno de análisis de segmentos examina las rutas contando los segmentos separados por barras:
- **Recuento impar de segmentos** (por ejemplo, `authors/42/posts` -> 3 segmentos) representa una solicitud de listado en la tabla relacionada.
- **Recuento par de segmentos** (por ejemplo, `authors/42/posts/7` -> 4 segmentos) representa una operación en un id de fila específico. El último segmento se extrae como el id de destino.

El motor filtra los espacios de nombres reservados del sistema (por ejemplo, `history`) del análisis de segmentos de ruta para evitar colisiones con los endpoints integrados.

## Autenticación

Todos los endpoints de datos requieren autenticación de forma predeterminada. Incluye un token Bearer en el encabezado `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Para llamadas de servidor a servidor, utiliza la clave de servicio:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

El filtrado de listas —operadores `?field=op.value`, grupos `or`/`and`, el dialecto JSON de `where` y cómo se combinan— tiene [su propia página](/docs/backend/filtering).

## Ordenación

Utiliza `orderBy` con el formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Si falta la dirección, se asume `asc`. Una dirección que no sea ni `asc` ni `desc`, o un campo que la tabla no tenga, devuelve un **400**, no un 200 con las filas en cualquier orden que la base de datos decida, lo cual sería indistinguible de una ordenación que funcionó correctamente.

### Varias claves

La sintaxis abreviada admite una sola clave. Para más claves, pasa un array JSON; la segunda clave desempatará las filas que la primera considere iguales:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Ambas sintaxis se aplican a todas las rutas que listan filas, incluidas las anidadas (`/api/data/authors/:id/posts`). Cada ordenación finaliza con el id de fila en orden descendente, se haya solicitado o no: esto es lo que hace que el orden sea total, y la paginación sobre un orden que no es total repite y omite filas.

Un parámetro `?orderBy=` repetido no es una ordenación multiclave: el último prevalece, como ocurre con cualquier otro parámetro de consulta. Utiliza el array.

### Dónde se ordenan los NULLs

De forma predeterminada, los NULLs se ordenan **al final de forma ascendente y al principio de forma descendente**, que es la propia convención de Postgres. Un tercer segmento separado por dos puntos indica lo contrario:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La variante de array JSON acepta una clave `"nulls"` para lo mismo:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Cualquier valor distinto de `first` o `last` devuelve un 400, no un orden silenciosamente diferente. El cursor que se explica a continuación respeta lo que haya declarado la ordenación, por lo que la paginación sobre una clave anulable se mantiene correcta bajo cualquiera de las dos ubicaciones.

## Paginación

Utiliza `limit` y `offset`, o `page` (uno u otro):

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

El límite predeterminado es **50** y el máximo es **1000**. Ambos provienen de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, que también informa la especificación OpenAPI generada; un `limit` superior al máximo se rechaza en lugar de ajustarse.

Los tres parámetros de ventana se rechazan en lugar de corregirse silenciosamente, y cada uno tiene su propio error: `INVALID_LIMIT`, `INVALID_OFFSET` (un número entero mayor o igual a 0) e `INVALID_PAGE` (un número entero mayor o igual a 1). Una ventana silenciosamente diferente a la solicitada no se puede distinguir de haber llegado al final de la tabla, por lo que ninguno de ellos se ajusta ni se ignora.

Por la misma razón, `page` y `offset` juntos devuelven un 400 `PAGE_WITH_OFFSET` en lugar de que uno de ellos prevalezca silenciosamente.

### Omitir el recuento

`meta.total` es un `COUNT(*)` sobre cada fila coincidente; en una tabla grande, representa la mayor parte del coste de una solicitud de listado. `?count=none` (`GET /api/data/orders?count=none`) lo omite: no hay `meta.total`, mientras que `meta.hasMore` sigue siendo exacto (la lectura solicita una fila más allá de la página). `?count=exact` es el valor predeterminado; cualquier otro valor devuelve un 400 `INVALID_COUNT`. Una lectura con `?distinct=true` nunca se cuenta, y tampoco una búsqueda vectorial con un `vector_threshold` (consulta [Búsqueda vectorial](/docs/backend/vector-search/)).

### Paginación por cursor

`offset` vuelve a contar las filas en cada solicitud, por lo que una fila insertada o eliminada entre dos páginas desplaza la ventana y el recorrido omite o repite filas silenciosamente. En su lugar, `?after=` busca directamente: la página siguiente comienza estrictamente después de la última fila servida.

Cada respuesta de listado incluye `meta.nextCursor` mientras exista otra página. Envíalo de vuelta sin cambios:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

El cursor es **opaco** (codifica las claves de ordenación *y* los valores de la última fila para ellas), por lo que se aplican tres reglas, cada una devolviendo un 400 en lugar de una página incorrecta:

| Situación | Código |
|-----------|--------|
| `after` con `offset` o `page` | `CURSOR_WITH_OFFSET` — ambos definen dónde comienza la página |
| `after` con un `orderBy` diferente al que se emitió | `CURSOR_ORDER_MISMATCH` |
| Un cursor que esta API no emitió | `INVALID_CURSOR` |

Una solicitud que no especifica `orderBy` **adopta el del cursor**, por lo que enviar `meta.nextCursor` de vuelta sin volver a indicar la ordenación funciona correctamente.

Las ordenaciones multiclave y las claves anulables paginan correctamente: la comparación se realiza sobre cada clave en orden, respetando la posición de NULL que declaró la ordenación. El único orden que ningún cursor puede describir es la relevancia (`_score`), calculada por consulta y no almacenada en ninguna parte, por lo que dicho listado simplemente no incluye `nextCursor`.

## Selección de columnas

`?fields=` restringe la lectura a las columnas indicadas. Es una proyección enviada a la consulta, no un recorte en la respuesta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La clave primaria siempre se devuelve (una fila que no se puede direccionar no se puede actualizar, eliminar ni avanzar con paginación, y el cursor se deriva de ella), y las columnas `.private()` permanecen ocultas independientemente de si se especifican o no. Una columna desconocida devuelve un 400 `UNKNOWN_FIELD` en lugar de una fila a la que silenciosamente le falte un campo.

Una relación especificada en `?include=` se devuelve independientemente de si `?fields=` la incluye o no: `?include=author&fields=title` devuelve `title`, la clave y `author`. Incluir también la relación en `?fields=` está permitido y no altera el resultado.

`?distinct=true` agrupa filas idénticas en esas columnas:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Se rechaza (400) junto con un `searchString` clasificado o una búsqueda vectorial, los cuales asignan una puntuación por fila que hace que cada fila sea distinta por diseño, y cuando `orderBy` nombra una columna que `fields` no devuelve (`DISTINCT_ORDER_BY_NOT_SELECTED`): Postgres no puede ordenar una lectura DISTINCT mediante una expresión fuera de su lista de selección.

`?fields=` y `?distinct=` también funcionan en la ruta get-by-id y en las rutas anidadas.

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

`nextCursor` está presente mientras `hasMore` sea true y la página haya devuelto al menos una fila; está ausente en la última página y en un orden que ningún cursor pueda describir.

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

Cada fallo, desde cualquier ruta, se devuelve en una misma estructura:

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

`message` y `code` siempre están presentes. `details` aparece cuando el rechazo trata *sobre* algo (el campo incorrecto, las rutas que fallaron). `requestId` aparece cuando la solicitud incluía un encabezado `X-Request-ID` o se le asignó uno; también se refleja en el encabezado de respuesta y es lo que debe indicarse en un reporte de error.

**Bifurca según el `code`, nunca según el `message` o el estado por sí solo.** Los códigos están en `SCREAMING_SNAKE_CASE` y son estables; los mensajes están escritos para una persona que lee una consola y pueden cambiar. El estado HTTP se encuentra en la respuesta, no en el cuerpo.

| Estado | Código típico | Significado |
|--------|---------------|-------------|
| 400 | `BAD_REQUEST`, `INVALID_INPUT`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La solicitud está mal formada o pide algo imposible |
| 401 | `UNAUTHORIZED` | Sin credencial, o con una que no identifica a nadie |
| 403 | `FORBIDDEN`, `SCOPE_MISSING`, `WRITE_DENIED` | Una credencial que identifica a alguien sin los permisos suficientes |
| 404 | `NOT_FOUND` | El elemento solicitado no existe |
| 409 | `CONFLICT` | El estado entra en conflicto: una clave duplicada, un árbol desincronizado |
| 501 | varía | La funcionalidad existe pero **no está configurada** en este despliegue |
| 503 | `SERVICE_UNAVAILABLE` | Una dependencia está caída; la solicitud nunca llegó a ella |

Una funcionalidad que está ausente porque este despliegue no la habilitó responde con 501 junto con un código y un motivo, no 404; un 404 inexplicable en una ruta que la interfaz de usuario acaba de llamar se interpreta como un despliegue roto.

Las rutas añaden sus propios códigos más específicos sobre estos (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), por lo que debes tratar la lista de códigos como abierta. El SDK tipado convierte todos ellos en un único `RebaseApiError` que contiene `status`, `code` y `details`; consulta [Gestión de errores](/docs/backend#error-handling).

## Búsqueda de texto

Utiliza `searchString` para búsquedas de texto completo en campos de cadena:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Búsqueda vectorial

Una tabla con una columna `col.vector()` admite una búsqueda de vecinos más cercanos en el listado: `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, con un `vector_distance` y `vector_threshold` opcionales. Los parámetros, umbrales y cómo se comportan los filtros en el índice se encuentran en [Búsqueda vectorial](/docs/backend/vector-search/).

## Consultas demasiado largas para una URL

`POST /api/data/:slug/query` (este listado) y `POST /api/data/:slug/count` aceptan los parámetros de consulta en un cuerpo JSON para consultas cuya URL no cabría (un embedding, una lista `in` larga). Consulta [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url).

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

Un nombre que no sea una relación de la tabla devuelve un **400 `UNKNOWN_RELATION`**, en cualquier nivel. Anteriormente se ignoraba, respondiendo 200 omitiendo simplemente el campo, lo que era indistinguible de una fila que genuinamente no tiene fila relacionada, haciendo que un error tipográfico pareciera datos vacíos. Una ruta con una profundidad superior a tres saltos devuelve `INCLUDE_TOO_DEEP`. Un nombre debe ser la clave exacta de la relación en el objeto `relations` de la tabla; las variantes en slug y snake_case que versiones anteriores intentaban no son válidas. Las filas relacionadas se devuelven en el [`orderBy`](/docs/collections/relations/) declarado por la relación cuando la solicitud no especifica ninguno, y una clave foránea generada por una relación en una columna `bigint` o `numeric` se devuelve como un número.

### Filtrar y limitar una relación

El formato separado por comas no permite especificar un `limit` por relación, por lo que `include` también acepta JSON, diferenciado por una llave de apertura:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Clave | Significado |
|-------|-------------|
| `limit` | Filas **por fila primaria**, no a lo largo de toda la página. Se aplica en la consulta, por lo que las filas posteriores nunca se leen de la base de datos |
| `where` | El mismo dialecto de filtrado que utiliza el `where` de nivel superior |
| `logical` | Un grupo `or`/`and`/`not` sobre las filas relacionadas |
| `orderBy` | La misma sintaxis de ordenación, incluida la posición de NULL. Los empates, y un `limit` sin `orderBy`, se ordenan por la clave de la fila relacionada en orden ascendente |
| `fields` | Columnas de la fila *relacionada*; su clave siempre se conserva |
| `include` | Relaciones de la fila relacionada, a su vez |
| `count` | `true` también devuelve el total de cada fila primaria bajo `_count` (`"_count":{"comments":37}`), contabilizado en la misma sentencia. Solo para relaciones de uno a muchos (*to-many*). Consulta [Contar lo que un límite omite](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

`true` significa "cargarla por completo", por lo que `{"author":true}` y `author` representan la misma solicitud.
Ambas sintaxis funcionan en la ruta de listado, la ruta get-by-id y las rutas anidadas.

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
        "email": "jane@example.com",
        "companyId": 7
    }
}
```

Una fila incluida es idéntica a lo que sirve la ruta propia del destino (`GET /api/data/authors/42`): las mismas columnas y codificaciones, claves foráneas como columnas y sin objetos de referencia.

## Escritura

Las claves de idempotencia, las escrituras condicionales (`ETag` / `If-Match`), las operaciones de campo (`$inc`, `$push`, `$pull`, `$merge`), el *upsert* mediante clave natural, `Prefer: return=minimal` y el endpoint entre tablas `POST /api/data/_batch` se encuentran detallados en su propia página: **[Escritura mediante REST](/docs/backend/writes/)**.

## Canalización de hooks del ciclo de vida

En Postgres, cada mutación REST (`POST`, `PATCH`, `DELETE`) ejecuta los hooks de su tabla en orden, dentro de la misma transacción que efectúa la escritura:

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Cada hook se espera con `await`, y cualquier excepción lanzada por alguno de ellos revierte la escritura por completo:

1. **`beforeSave`, `beforeDelete`** se ejecutan antes de la escritura. Pueden modificar los valores entrantes, validar o rechazar la solicitud lanzando un error: el cliente recibe un **400 `CALLBACK_REJECTED`** y no se escribe nada.
2. **`afterSave`, `afterDelete`** se ejecutan después de la escritura pero *antes* del commit. Un error revierte la fila y responde con el mismo 400, indicando el hook en `details.stage`. Mantienen la transacción abierta mientras se ejecutan, por lo que no son el lugar adecuado para webhooks ni llamadas de red externas; consulta [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) para saber dónde ubicar ese trabajo.

## Endpoints del sistema

| Método | Ruta | Autenticación | Descripción |
|--------|------|---------------|-------------|
| `GET` | `/health` y `/api/health` | ninguna | Verificación de disponibilidad/preparación (liveness/readiness) |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Desde 0.31</span> de forma predeterminada, los clientes a los que `GET /api/schema/tables` describe tablas (401 anónimo salvo que `schemaTables.public`); ninguna cuando `enableSwagger` es `true`; la restricción de administrador cuando es `false` | La especificación OpenAPI 3.0 en JSON: de forma predeterminada solo las tablas, columnas y relaciones que el endpoint de esquema describe a ese cliente. `404 DOCS_UNAVAILABLE` cuando no hay autenticación configurada |
| `GET` | `/api/swagger` | ninguna | Swagger UI. Servido solo cuando `enableSwagger` es `true` (`REBASE_ENABLE_SWAGGER=true`), y nunca en producción |
| `GET` | `/api/meta/schema-version` | ninguna | El hash del esquema a partir del cual se construyó este backend y la versión del runtime; deliberadamente sin autenticación y sin nada que describa el esquema |
| `GET` | `/api/meta/contract` | `schema:read`: un administrador, la clave de servicio o una clave de API que lo posea | La versión del esquema, el runtime y cada tabla tal como la ve un administrador, para `rebase generate-sdk --from`. Cierre por fallo (*fail-closed*): `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |

## OpenAPI / Swagger

La especificación OpenAPI se genera automáticamente a partir de tus tablas: describe los endpoints list, query, count, aggregate, read, create, update, delete y bulk de cada tabla servida por el backend, sus rutas anidadas y `_batch`, con sus parámetros de consulta y esquemas de respuesta. No es un mapa completo de toda la superficie HTTP —las rutas de autenticación, almacenamiento, funciones y tareas cron se documentan únicamente en este sitio web— y las columnas marcadas como `.private()` se excluyen de ella. El atributo `description` de una tabla y `.describe()` de una columna constituyen sus descripciones.

Para una tabla con [`softDelete`](/docs/collections/soft-delete/), la especificación indica que una eliminación (individual o masiva) mueve la fila a la papelera, y documenta `?hard=true` en ambas eliminaciones, así como `?deleted=include|only` en el listado, la lectura individual, el recuento y la agregación. El explorador de API de Studio solo envía los parámetros indicados en la especificación, por lo que esto es lo que le permite purgar una fila o listar la papelera.

Los clientes automatizados se autentican con una clave con permisos (*scoped key*) en lugar de una sesión: [Claves de API](/docs/backend/api-keys/).

## Metadatos del esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las tablas que el backend sirve se describen, por cliente, en `GET /api/schema/tables`, los descriptores a partir de los cuales se renderizan el CMS y el Studio. A cualquier cliente autenticado se le sirven las tablas que puede ver, omitiendo lo que no puede leer; [Endpoints](/docs/backend/endpoints/#schema) contiene la matriz.

El esquema completo tal como lo ve un administrador se sirve en:

```bash
GET /api/meta/contract
```

```json
{ "schemaVersion": "v2:…", "runtime": { "version": "0.30.1", "contract": 2 }, "tables": [ … ] }
```

Requiere el permiso **`schema:read`**, que posee un administrador, y en un despliegue sin autenticación configurada no se sirve en absoluto (404 `CONTRACT_UNAVAILABLE`) en lugar de exponer el esquema a cualquiera. Las versiones del esquema comienzan con `v2:` desde la versión 0.31: se calculan a partir de las tablas compiladas, por lo que la versión de cada proyecto cambió una vez. Su endpoint hermano devuelve una cadena de versión que representa el esquema sin describirlo, y es deliberadamente accesible sin credenciales, lo cual es lo que sondea una tarea de CI:

```bash
GET /api/meta/schema-version
```

Para la estructura de los endpoints en lugar del esquema subyacente, el documento OpenAPI se encuentra en `GET /api/docs`: al iniciar sesión, obtienes el documento de las tablas que puedes ver. Swagger UI en `/api/swagger` solo se sirve cuando el documento se publica con `REBASE_ENABLE_SWAGGER=true`, fuera de producción.

## Siguientes pasos

- **[SDK tipado](/docs/sdk)** — Cliente con seguridad de tipos para la API REST
- **[Tablas](/docs/schema/)** — Define tu esquema de datos
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules)** — Controla el acceso por fila
