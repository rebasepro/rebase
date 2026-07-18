---
title: API REST
sidebar_label: API REST
description: Endpoints de API REST autogenerados para cada colección, con filtrado, ordenación, paginación e inclusión de relaciones.
---

## Resumen

Rebase genera automáticamente una API completa a partir de las definiciones de sus colecciones:

- **API REST** — Endpoints CRUD para cada colección en `/api/data/:slug`
- **Especificación OpenAPI** — Especificación legible por máquina en `/api/docs`
- **Swagger UI** — Explorador de API interactivo en `/api/swagger` (solo en modo desarrollo)

No se requiere código — defina sus colecciones y la API aparece automáticamente.

## Endpoints REST

Para cada colección se generan los siguientes endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades |
| `GET` | `/api/data/:slug/count` | Contar entidades |
| `GET` | `/api/data/:slug/:id` | Obtener una sola entidad |
| `POST` | `/api/data/:slug` | Crear una entidad |
| `PUT` | `/api/data/:slug/:id` | Actualizar una entidad |
| `DELETE` | `/api/data/:slug/:id` | Eliminar una entidad |

### Rutas de Subcolecciones

Las relaciones anidadas son accesibles mediante rutas de URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PUT    /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mecánica de Enrutamiento y Análisis de Segmentos

Para manejar profundidades arbitrarias de subcolecciones anidadas, Rebase enruta las peticiones entrantes usando la regex de parámetro `:rest{.+}` de Hono. El motor interno de análisis de segmentos analiza las rutas contando los segmentos separados por barras:
- **Número impar de segmentos** (p. ej., `authors/42/posts` -> 3 segmentos) representa una petición de lista de colección.
- **Número par de segmentos** (p. ej., `authors/42/posts/7` -> 4 segmentos) representa una operación sobre un ID de entidad específico. El último segmento se extrae como el `entityId` objetivo.

El motor filtra los espacios de nombres reservados del sistema (p. ej., `history`) del análisis de segmentos de la ruta para evitar colisiones con los endpoints integrados.

## Autenticación

Todos los endpoints de datos requieren autenticación de forma predeterminada. Incluya un token Bearer en la cabecera `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Para llamadas de servidor a servidor, use la clave de servicio:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtrado

Use parámetros de consulta al estilo PostgREST para filtrar los resultados. El formato es `?field=operator.value`:

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

### Operadores de Filtro

| Operador | Significado | Ejemplo |
|----------|---------|---------|
| `eq` | Igual (`==`) | `?active=eq.true` |
| `neq` | Distinto (`!=`) | `?status=neq.draft` |
| `gt` | Mayor que (`>`) | `?price=gt.100` |
| `gte` | Mayor o igual (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor o igual (`<=`) | `?price=lte.50` |
| `in` | En array | `?status=in.(a,b,c)` |
| `nin` | No en array | `?status=nin.(a,b)` |
| `cs` | Array contiene | `?tags=cs.value` |
| `csa` | Array contiene alguno | `?tags=csa.(a,b)` |

### Operadores Lógicos

Use `or` y `and` para condiciones complejas:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)
```

## Ordenación

Use `orderBy` con el formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

## Paginación

Use `limit` y `offset`, o `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses default limit of 20)
GET /api/data/products?page=3
```

El límite predeterminado es **20**, el máximo es **100**.

### Formato de Respuesta

Las respuestas de lista incluyen metadatos de paginación:

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
        "hasMore": true
    }
}
```

Las respuestas de una sola entidad devuelven un objeto plano:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "created_at": "2026-01-15T10:30:00Z"
}
```

## Búsqueda de Texto

Use `searchString` para la búsqueda de texto completo en los campos de tipo cadena:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Búsqueda Vectorial

Si una colección define una propiedad con un tipo `vector`, puede realizar búsquedas de similitud de alta velocidad usando operaciones de distancia de pgvector compiladas directamente en la consulta de la base de datos.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parámetros de Consulta Vectorial

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `vector_search` | `string` | El nombre de la propiedad vectorial contra la que consultar. |
| `vector` | `string` | Un array de floats serializado en JSON que representa el vector de consulta. |
| `vector_distance` | `string` | La métrica de distancia a evaluar. Valores soportados: `cosine` (predeterminado, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Umbral máximo de distancia. Solo se devuelven los registros con una distancia menor que este umbral. |

## Inclusión de Relaciones

Use el parámetro `include` para incrustar entidades relacionadas:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations
GET /api/data/articles?include=*
```

Las relaciones incluidas se incrustan directamente en la respuesta:

```json
{
    "id": 1,
    "title": "Getting Started",
    "author_id": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Selección de Campos

Use `fields` para seleccionar columnas específicas:

```bash
GET /api/data/products?fields=id,name,price
```

## Pipeline de Hooks del Ciclo de Vida

Cada operación de mutación REST (`POST`, `PUT`, `DELETE`) pasa por un pipeline de ejecución de hooks estricto y secuencial:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks Bloqueantes vs. Diferidos

1. **Hooks bloqueantes (`beforeSave`, `beforeDelete`)**
   Estos hooks se ejecutan de forma síncrona en el ciclo principal de la petición *antes* de confirmar la transacción de la base de datos. Pueden modificar las cargas entrantes, ejecutar validaciones personalizadas o abortar la petición por completo lanzando un error.

2. **Hooks diferidos (`afterSave`, `afterDelete`)**
   Estos hooks se ejecutan de forma asíncrona después de que la transacción de la base de datos se ha confirmado con éxito. Usan promesas diferidas (fire-and-forget), lo que significa que se ejecutan en segundo plano y no bloquean la respuesta HTTP del cliente. Ideal para enviar webhooks, activar notificaciones push o encolar tareas externas.


## OpenAPI / Swagger

- **Especificación OpenAPI**: `GET /api/docs` — Devuelve la especificación JSON completa de OpenAPI 3.0
- **Swagger UI**: `GET /api/swagger` — Explorador de API interactivo (solo en modo desarrollo)

La especificación OpenAPI se genera automáticamente a partir de las definiciones de sus colecciones e incluye todos los endpoints, parámetros de consulta y esquemas de respuesta.

## Claves de API

Las claves de API proporcionan autenticación de máquina a máquina para agentes, servidores MCP, pipelines de CI e integraciones externas. Admiten alcance de permisos por colección y acceso de administrador completo opcional.

### Crear una Clave de API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

La respuesta incluye la clave completa en texto plano (`rk_live_...`) **exactamente una vez** — guárdela de inmediato.

### Usar una Clave de API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permisos y RLS: dos puertas independientes

La petición de una clave de API pasa por **dos** comprobaciones de autorización, y ambas deben permitirla:

1. **La lista de permisos de la clave** — colección × operación, comprobada en la capa de ruta.
2. **Seguridad a nivel de fila** — las claves de API *no* omiten la RLS. Una clave se ejecuta como
   `uid: "api-key:<id>"` con el rol `service` (más `admin` cuando
   `admin: true`). Las claves de administrador pasan a través de las políticas de administrador integradas; una
   clave no administradora solo ve las filas que una regla de seguridad concede explícitamente al
   rol `service` o al público. Las reglas de estilo propietario
   (`owner_id = auth.uid()`) nunca coinciden con una clave de API.

Por lo tanto, una clave no administradora con permisos `"*"` puede aún obtener resultados vacíos — eso es
la RLS funcionando, no un error. O bien conceda el rol `service` en las reglas de seguridad de las
colecciones pertinentes, o use una clave de administrador.

### Funciones Personalizadas

Las invocaciones de funciones tienen un alcance como las colecciones, bajo el espacio de nombres `functions`:
`{"collection": "functions", "operations": ["write"]}` concede todas las
funciones, `"functions/<name>"` concede una, y el comodín global `"*"` concede
todas. Una clave sin dicha entrada no puede invocar funciones en absoluto.

### Almacenamiento

El almacenamiento funciona de la misma manera, bajo el espacio de nombres `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` permite a la clave
descargar/listar (`read`), subir y crear carpetas (`write`), y eliminar archivos
(`delete`). El comodín global `"*"` también concede el almacenamiento. Una clave sin dicha
entrada no puede tocar el almacenamiento. Las rutas de subida reanudable TUS cuentan como `write`
en cada paso (incluidas la comprobación de offset y la cancelación), por lo que una clave con alcance de escritura
puede completar una subida por sí sola.

### Acceso de Administrador para Agentes y MCP

De forma predeterminada, las claves de API obtienen el rol `service` (solo acceso a datos). Añada `"admin": true` para conceder a la clave acceso de administrador completo — incluidas las rutas `/api/admin/*` para la gestión del esquema, la gestión de usuarios y más, además de cron, copias de seguridad y logs. Use esto para agentes, servidores MCP y CI:

```bash
# CLI
rebase api-keys create --name "My Agent" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

### Opciones de la Clave

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Etiqueta legible por humanos |
| `permissions` | `ApiKeyPermission[]` | Acceso por colección (`"*"` = todo; `"functions/<name>"` = una función; `"storage"` = almacenamiento de archivos) |
| `admin` | `boolean` | Conceder el rol de administrador — rutas de administrador + políticas de administrador RLS |
| `rate_limit` | `number \| null` | Peticiones por ventana de 15 min (`null` = el valor predeterminado del servidor, 1000) |
| `expires_at` | `string \| null` | Marca de tiempo de caducidad ISO-8601 |

La CLI requiere un alcance explícito: pase `--permissions '<json>'` u opte por
`--full-access` — no hay un valor predeterminado silencioso de acceso completo.

Las claves se pueden listar, actualizar y revocar mediante `/api/admin/api-keys` o los comandos de la CLI `rebase api-keys`.

## Endpoint de Metadatos

Obtenga una lista de todas las colecciones disponibles y su estructura:

```bash
GET /api/collections
```

## Próximos Pasos

- **[SDK del Cliente](/docs/sdk)** — Cliente con tipos seguros para la API REST
- **[Colecciones](/docs/collections)** — Defina su esquema de datos
- **[Reglas de Seguridad (RLS)](/docs/collections/security-rules)** — Controle el acceso por fila
