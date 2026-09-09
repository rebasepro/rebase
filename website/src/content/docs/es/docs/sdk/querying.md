---
sourceHash: 72b63305690d555c
title: Consultar datos
sidebar_label: Consultar datos
description: Operaciones CRUD, generador de consultas fluido, operadores de filtrado, ordenación, selección de columnas y agregaciones con el SDK de cliente de Rebase.
---

## Acceso a colecciones

Accede a cualquier colección mediante `client.data.<collectionName>` (en camelCase, convertido automáticamente a snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estricto (SDK generado):** Cuando pasas el `collectionsDictionary` generado a `createRebaseClient`, el proxy de datos valida los accesos a propiedades en el momento de invocación. Un error tipográfico como `client.data.prodcuts` lanzará inmediatamente un error explicativo junto con una sugerencia de coincidencia cercana en lugar de producir un confuso error 404 más adelante. Utiliza `client.data.collection<Record<string, unknown>>("slug")` para omitir la validación en slugs dinámicos o determinados en tiempo de ejecución.

## Operaciones CRUD

### Find (Listar)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Row[] — flat rows, with the id at the top level
// meta has { total, limit, offset, hasMore }
```

### Leer uno por ID

Existen dos métodos, ya que corresponden a dos situaciones distintas que requieren un código diferente.

`get` está pensado para una fila cuya existencia se asume con certeza: el ID provino de un enlace, de un parámetro de ruta o de otra fila. Devuelve la fila directamente, evitando tener que estrechar tipos posteriormente, y la ausencia de la fila genera una excepción sobre la que se puede bifurcar la lógica:

```typescript
const product = await client.data.products.get(42);
product.name;    // Row, not Row | undefined
```

```typescript
import { RebaseApiError } from "@rebasepro/client";

async function loadProduct(id: string) {
    try {
        return await client.data.products.get(id);
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

`findById` está pensado para una fila que legítimamente podría no existir: una búsqueda mediante un ID ingresado por un usuario, una comprobación de caché, etc.:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La seguridad a nivel de fila (Row-level security) hace que "no existe tal fila" y "no tienes permisos para leerla" devuelvan deliberadamente la misma respuesta: un 404 que las distinguiera confirmaría la existencia de la fila.
:::

### Escritura

`create`, `upsert`, `update`, `delete` y sus variantes por lotes se detallan en **[Escritura de datos](/docs/sdk/writing/)**, junto con operaciones de campos, escrituras condicionales y claves de idempotencia.

### Contar (Count)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Generador de consultas fluido (Fluent Query Builder)

Encadena métodos para construir consultas más expresivas:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Métodos disponibles

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `.where(field, op, value)` | Agrega una condición de filtrado | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtra sobre una ruta de [relación](#querying-through-a-relation) o [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Agrega un [grupo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena los resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por una [agregación sobre una relación](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita el número de resultados | `.limit(25)` |
| `.offset(n)` | Omite los primeros N resultados | `.offset(50)` |
| `.after(cursor)` | Continúa a partir de un [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Devuelve [únicamente estas columnas](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Colapsa filas idénticas en función de esas columnas | `.fields("status").distinct()` |
| `.search(text)` | Búsqueda de texto — consulta [Búsqueda](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Búsqueda por vecinos más cercanos sobre una propiedad `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carga filas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Ejecuta la consulta | Devuelve `FindResult<M>` |
| `.aggregate(params)` | [Aplica agregaciones en lugar de retornar filas](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite en streaming cada fila coincidente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Recopila cada fila coincidente](#reading-everything-iterate-and-findall) | Devuelve `M[]` |
| `.count()` | Cuenta las filas coincidentes | Devuelve `number` |
| `.listen(onUpdate, onError?)` | Se suscribe a actualizaciones en tiempo real | Devuelve `unsubscribe()` |

### Operadores de filtrado

| Operador | Alias | Descripción |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | Distinto |
| `">"` | `"gt"` | Mayor que |
| `">="` | `"gte"` | Mayor o igual que |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor o igual que |
| `"in"` | | El valor está en el array |
| `"not-in"` | `"nin"` | El valor no está en el array |
| `"array-contains"` | `"cs"` | El campo de tipo array contiene el valor |
| `"array-contains-any"` | `"csa"` | El campo de tipo array contiene alguno de los valores |
| `"like"` | `"like"` | Coincidencia de patrones sensible a mayúsculas/minúsculas; `%` y `_` actúan como comodines |
| `"ilike"` | `"ilike"` | Coincidencia de patrones insensible a mayúsculas/minúsculas |
| `"not-like"` | `"nlike"` | No coincide con el patrón |
| `"not-ilike"` | `"nilike"` | No coincide con el patrón de forma insensible a mayúsculas/minúsculas |
| `"is-null"` | `"isnull"` | La columna es `NULL`. No recibe ningún valor: cualquier valor que se envíe se descarta en la normalización |
| `"is-not-null"` | `"notnull"` | La columna no es `NULL`. No recibe ningún valor |

La columna de alias representa la forma en formato **wire**, empleada en las cadenas de consulta REST. Nunca se utiliza en el código de la aplicación: tanto el SDK como el panel de administración utilizan el operador canónico de la izquierda.

### Sintaxis de la cláusula Where

El parámetro `where` en `find()` admite dos formatos:

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Nota:** Las cadenas pre-serializadas de PostgREST (formato 2) son una alternativa para pasar valores de filtro que ya se encuentran en formato wire. Es preferible utilizar la sintaxis de tupla por seguridad de tipos y legibilidad.

## Condiciones lógicas (OR / AND / NOT)

Cada campo en `where` se evalúa mediante un operador AND. Para combinar condiciones mediante OR, o para negar un grupo, construye una **condición lógica** utilizando las funciones auxiliares `or`, `and`, `not` y `cond` provistas por el SDK:

```typescript
import { or, and, not, cond } from "@rebasepro/client";

const { data } = await client.data.products.find({
    logical: or(
        cond("status", "==", "active"),
        and(
            cond("status", "==", "draft"),
            cond("authorId", "==", currentUserId)
        )
    )
});
```

El generador fluido acepta el mismo árbol de condiciones:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` toma el operador canónico, es decir, la columna izquierda de la tabla de [Operadores de filtrado](#filter-operators). Pasar un operador no soportado por el dialecto generará un `TypeError` al serializar la consulta, en lugar de producir silenciosamente una consulta distinta.

### Negación

`not` niega la **conjunción** de sus condiciones: `not(a)` equivale a `NOT a`, y `not(a, b)` equivale a `NOT (a AND b)`. Los grupos se pueden anidar, por lo que la otra ley de De Morgan se expresa como `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Esto se compila en una cláusula SQL `NOT (...)` real, sin invertir los operadores. Dicha distinción no es puramente cosmética: la lógica en SQL es trivaluada, por lo que `NOT (a AND b)` y `(NOT a) OR (NOT b)` dejan de coincidir en cuanto interviene un valor `NULL`, y solo uno de ellos representa la consulta que escribiste.

Esto también implica que una negación **incluye filas cuya columna sea NULL**; por ejemplo, `not(cond("status", "==", "draft"))` devuelve filas que no tienen ningún estado definido. Ese es el comportamiento esperado de `NOT` y suele ser lo deseado; si no es tu caso, añade un `is-not-null` mediante AND en la consulta.

### Cómo se combina con el resto de la consulta

`where`, `logical` y `search` son tres grupos independientes, combinados entre sí mediante AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

No existe forma de combinar `where` con `logical` mediante un operador OR. Cualquier expresión que no sea un AND simple entre estos tres componentes debe definirse dentro de un mismo árbol `logical`; traslada a este árbol los campos que requieran ser combinados con OR.

### En el formato de transmisión (wire)

Un grupo lógico viaja como un único parámetro de consulta `or=`, `and=` o `not=`, utilizando la misma sintaxis con puntos que los filtros de campos:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Solo uno de los tres aplica por petición: `or` tiene prioridad sobre `and`, y ambos sobre `not`. Para combinarlos, anida un grupo dentro de otro.

Conviene conocer tres codificaciones particulares, ya que son las que habitualmente se escriben de forma errónea al armar cadenas de consulta manualmente:

| Condición | Formato wire | Nota |
|-----------|--------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` busca la cadena de cuatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` es una lista que contiene una única cadena vacía, lo cual representa una consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | una [ruta de relación](#querying-through-a-relation) conserva su punto |

Las comas, paréntesis y barras invertidas dentro de un valor se escapan con una barra invertida, por lo que `cond("name", "==", "Doe, John")` se transmite como `name.eq.Doe\, John` y no divide el grupo.

Los grupos pueden anidarse hasta un máximo de 32 niveles de profundidad. Más allá de ese límite, la petición es rechazada con el error `INVALID_LOGICAL_GROUP`; si esto ocurre, aplana la estructura, ya que `or(a,or(b,c))` es equivalente a `or(a,b,c)`.

## Paginación

Los offsets, números de página y cursores por keyset se explican en su propia sección:
[Paginación](/docs/sdk/pagination/).

## Ordenación

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["createdAt", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

Si omites la dirección, se asume `"asc"` por defecto, que equivale al comportamiento de `?orderBy=name` vía HTTP, independientemente de la base de datos subyacente.

### Ordenación por múltiples columnas

El ordenamiento consiste en una *lista* de claves. La segunda desempata las filas consideradas iguales por la primera, la tercera desempata las que resulten iguales en las dos anteriores, y así sucesivamente; por lo tanto, `orderBy` admite una lista de pares `[field, direction]` con la misma facilidad que un solo par:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

En el generador fluido se expresa encadenando llamadas a `.orderBy()`. Cada invocación **agrega** una clave detrás de las anteriores en lugar de reemplazarlas:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenación concluye con el ID de la fila en orden descendente, se haya solicitado explícitamente o no. Esto garantiza que el orden sea *total*: sin este criterio, dos filas con el mismo valor se devolverían en el orden arbitrario que determine la base de datos, y paginar sobre un orden que puede diferir entre dos ejecuciones de la misma consulta provocaría la repetición de algunas filas y la omisión de otras.

Una ordenación multicolumna funciona correctamente bajo la paginación con [cursor](#cursor-pagination): la comparación se construye considerando cada una de las claves en secuencia. La única ordenación que un cursor no puede representar es **`_score`** (consulta [Búsqueda](/docs/backend/search)). La relevancia se calcula por consulta en lugar de almacenarse, por lo que no existe ningún valor en la fila del cursor contra el cual comparar la siguiente página, y dicho listado no incluirá un `nextCursor`.

### Posición de los valores NULL

Por defecto, los valores NULL se ordenan **al final de forma ascendente y al principio de forma descendente**, siguiendo la convención propia de Postgres. Esta configuración predeterminada hace que las filas sin fecha aparezcan en la parte superior de una lista ordenada como "más recientes primero", por delante de las entradas con datos reales, y la única alternativa anterior consistía en usar un filtro `is-not-null` para descartar dichas filas por completo.

Un tercer elemento en la clave permite especificar su posición:

```typescript
// Newest first, and the ones with no date at the end where they belong.
const { data } = await client.data.posts.find({
    orderBy: [["publishedAt", "desc", "last"]]
});
```

```typescript
const { data } = await client.data.posts
    .orderBy("publishedAt", "desc", "last")
    .find();
```

En HTTP se especifica mediante un tercer segmento separado por dos puntos, `?orderBy=publishedAt:desc:last`, o mediante la clave `"nulls"` en el formato de array JSON. Cualquier valor distinto de `first`/`last` produce un error 400 en lugar de aplicar un orden diferente de forma silenciosa.

El [cursor](#cursor-pagination) respeta la configuración de orden declarada, garantizando una paginación correcta sobre claves con valores nulos bajo cualquiera de las dos ubicaciones.

## Devolver menos columnas

`fields` restringe la lectura a las columnas que especifiques. Se trata de una proyección en la propia base de datos: son las columnas *leídas*, no las que sobreviven tras un recorte de la respuesta, de modo que una consulta que solo requiere dos campos de una fila ancha no incurre en el coste de transferir los restantes:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Independientemente de las columnas indicadas, se cumplen siempre dos reglas:

- **La clave primaria siempre se incluye en la respuesta.** Una fila que no se puede direccionar no puede actualizarse, eliminarse ni utilizarse para paginar; además, `meta.nextCursor` se deriva de ella, por lo que una proyección que la omitiese desactivaría silenciosamente la navegación por cursor.
- **Las columnas marcadas con `excludeFromApi` permanecen ocultas.** Especificar su nombre no las hace visibles.

Solicitar una columna desconocida genera un error 400 `UNKNOWN_FIELD`. Si se interpretara como "ignorar el campo", una errata como `fields: ["titel"]` devolvería filas sin título sin advertir el motivo.

Las relaciones especificadas en `include` se cargan independientemente de si aparecen o no en `fields`; para limitar las columnas *dentro* de una relación, consulta [opciones por relación](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

<span class="since-badge" data-since="0.20">Since 0.20</span>

`distinct` agrupa filas que resulten idénticas en las columnas devueltas, y una lectura distintiva retorna **únicamente** las columnas especificadas: la clave primaria se omite de la proyección, a diferencia del resto de lecturas. Esto es indispensable: una clave subrogada es distinta en cada fila, por lo que conservarla haría que cada fila fuera única por definición y la consulta respondería 200 sin haber surtido efecto.

Por esta razón, solo tiene sentido utilizarlo junto con `fields`. Sin este parámetro se solicitan todas las columnas visibles, incluida la clave primaria, y no se agrupará ninguna fila:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Una lectura con distinct no referencia filas concretas —no hay clave mediante la cual direccionarlas—, por lo que devuelve un conjunto de valores en lugar de filas aptas para ser modificadas o eliminadas, y carece de `nextCursor`. Asimismo, **no reporta `meta.total`**: contabilizarlo requeriría un `COUNT(DISTINCT …)` que el driver no emite, y reportar el conteo de filas en su lugar describiría un conjunto distinto al servido (un resultado completo de dos filas se devolvía como `total: 8, hasMore: true`, lo cual inducía a un cliente a paginar indefinidamente). `hasMore` se deduce a partir de la propia página.

Se rechazan deliberadamente dos combinaciones en lugar de devolver respuestas inútiles:

- **Una consulta que puntúa cada fila:** un `search()` ponderado o un `vectorSearch()` asigna un `_score`/`_distance` a cada fila, por lo que no habrá dos filas iguales y `DISTINCT` carecería de efecto. (Una búsqueda simple por subcadena no asigna puntuación y funciona sin problemas).
- **Ordenar por una columna no devuelta:** Postgres no puede ordenar una lectura `DISTINCT` según una expresión externa a la lista del select; la solicitud genera un 400 `DISTINCT_ORDER_BY_NOT_SELECTED` en lugar de un error 500 con código SQL que nunca escribiste.

Vía HTTP: `?fields=status&distinct=true`.

## Agregaciones

`aggregate()` reduce las filas coincidentes en lugar de devolverlas: admite `count`, `sum`, `avg`, `min`, `max`, opcionalmente agrupadas:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Los filtros del generador de consultas se trasladan a la agregación, lo cual suele ser la alternativa más concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Las claves del resultado son **derivadas**, no configurables: `sum(total)` se devuelve como `sum_total`, y un `count()` simple como `count`. Permitir asignarles un nombre obligaría a verificar que dicho nombre no coincida con un campo de `groupBy` —una regla contraintuitiva que, sin validación, provocaría sobrescrituras silenciosas de valores—.

`limit` restringe el número de **grupos** devueltos (agrupar por una columna con alta cardinalidad puede abarcar el contenido equivalente a una tabla completa en una sola respuesta) y se ignora si no hay un `groupBy`, dado que una agregación sin agrupar produce una única fila. `orderBy`, `include` y la paginación no aplican: una agregación no tiene filas que ordenar, relaciones que cargar ni páginas que continuar.

El objetivo principal es evitar la transferencia innecesaria de filas con el fin de calcular métricas. Obtener los "ingresos por estado" sobre un millón de pedidos se resuelve aquí mediante una única consulta y una fila por estado, en contraposición a ejecutar un `findAll()` con bucles manuales, lo cual resulta erróneo bajo un `limit` e inviable sin él. Se procesa a través del mismo contexto de petición que el resto de lecturas, aplicando la seguridad a nivel de fila a los datos agregados.

Vía HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

El filtrado JSON, la búsqueda de texto completo y la búsqueda vectorial disponen de una página dedicada:
[Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/).

La lectura de entidades relacionadas (`include` y los métodos de acceso que consultan mediante relaciones) se describe en: [Consultar relaciones](/docs/sdk/relations/).

## Endpoints personalizados

Invoca endpoints de servidor personalizados registrados a través del sistema de funciones:

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

Ambos devuelven **el cuerpo de la respuesta de la función textualmente**. Ninguno busca internamente una clave `data`, por lo que si una función responde `{ data: [...] }`, recibirás ese objeto completo y deberás acceder a `.data` por tu cuenta.

`call()` requiere una ruta completa y realiza siempre peticiones POST; `invoke()` recibe el nombre de una función y admite método, subruta y encabezados. Utiliza `invoke()` a menos que estés realizando una llamada a un recurso que no sea una función.

## Pasos siguientes

- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión, registro, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en tiempo real con WebSockets
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Subida, descarga y administración de archivos
- **[Relaciones](/docs/collections/relations)** — Definir relaciones entre colecciones

---
