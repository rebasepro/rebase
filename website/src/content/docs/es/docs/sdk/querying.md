---
sourceHash: 3cba57377cf922df
title: Consulta de datos
sidebar_label: Consulta de datos
description: Operaciones CRUD, constructor de consultas fluido, operadores de filtro, ordenación, selección de columnas y agregaciones con el SDK de cliente de Rebase.
---

## Acceso a colecciones

Accede a cualquier colección mediante `client.data.<collectionName>` (camelCase, convertido automáticamente a snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estricto (SDK generado):** Al pasar el `collectionsDictionary` generado a `createRebaseClient`, el proxy de datos valida los accesos a propiedades en el momento de la llamada. Un error tipográfico como `client.data.prodcuts` lanzará inmediatamente un error útil con una sugerencia de coincidencia cercana en lugar de producir un confuso error 404 más adelante. Usa `client.data.collection<Record<string, unknown>>("slug")` para omitir la validación en slugs dinámicos o determinados en tiempo de ejecución.

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

Existen dos métodos porque cubren dos situaciones distintas que requieren código diferente.

`get` se utiliza para una fila que esperas que exista (el ID proviene de un enlace, un parámetro de ruta u otra fila). Devuelve la fila directamente, evitando tener que acotar el tipo posteriormente, y la ausencia de la fila genera una excepción sobre la que puedes ramificar la lógica:

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

`findById` se utiliza para una fila que legítimamente podría no estar presente (una búsqueda por un ID ingresado por el usuario, una comprobación de caché):

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La seguridad a nivel de fila (RLS) hace que "la fila no existe" y "no tienes permisos para leerla" devuelvan deliberadamente la misma respuesta: un 404 que los distinguiera confirmaría la existencia de la fila.
:::

### Escritura

`create`, `upsert`, `update`, `delete` y sus variantes por lotes (batch) se encuentran en **[Escritura de datos](/docs/sdk/writing/)**, junto con las operaciones de campo, escrituras condicionales y claves de idempotencia.

### Count (Contar)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructor de consultas fluido (Query Builder)

Encadena métodos para crear consultas más expresivas:

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
| `.where(field, op, value)` | Añade una condición de filtro | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtra en una ruta de [relación](#querying-through-a-relation) o [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Añade un [grupo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena los resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por un [agregado sobre una relación](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita el número de resultados | `.limit(25)` |
| `.offset(n)` | Omite los primeros N resultados | `.offset(50)` |
| `.after(cursor)` | Continúa a partir de un [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Devuelve [únicamente estas columnas](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Agrupa filas idénticas respecto a esas columnas | `.fields("status").distinct()` |
| `.search(text)` | Búsqueda de texto — consulta [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Búsqueda por vecinos más cercanos en una propiedad `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carga filas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Ejecuta la consulta | Devuelve `FindResult<M>` |
| `.aggregate(params)` | [Aplica agregaciones en lugar de devolver filas](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite en streaming cada fila coincidente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Recupera todas las filas coincidentes](#reading-everything-iterate-and-findall) | Devuelve `M[]` |
| `.count()` | Cuenta las filas coincidentes | Devuelve `number` |
| `.listen(onUpdate, onError?)` | Se suscribe a actualizaciones en tiempo real | Devuelve `unsubscribe()` |

### Operadores de filtro

| Operador | Alias | Descripción |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | No igual |
| `">"` | `"gt"` | Mayor que |
| `">="` | `"gte"` | Mayor o igual que |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor o igual que |
| `"in"` | | Valor contenido en el array |
| `"not-in"` | `"nin"` | Valor no contenido en el array |
| `"array-contains"` | `"cs"` | El campo de tipo array contiene el valor |
| `"array-contains-any"` | `"csa"` | El campo de tipo array contiene cualquiera de los valores |
| `"like"` | `"like"` | Coincidencia de patrón sensible a mayúsculas/minúsculas (**case-sensitive**); `%` y `_` son comodines |
| `"ilike"` | `"ilike"` | Coincidencia de patrón insensible a mayúsculas/minúsculas |
| `"not-like"` | `"nlike"` | No coincide con el patrón |
| `"not-ilike"` | `"nilike"` | No coincide con el patrón, insensible a mayúsculas/minúsculas |
| `"is-null"` | `"isnull"` | La columna es `NULL`. No recibe ningún valor (cualquier valor pasado se descarta) |
| `"is-not-null"` | `"notnull"` | La columna no es `NULL`. No recibe ningún valor |

La columna de alias representa la sintaxis utilizada en la red (**wire**), empleada en las cadenas de consulta REST. Nunca aparece en el código de la aplicación: tanto el SDK como el panel de administración utilizan el operador canónico de la izquierda.

### Sintaxis de cláusulas Where

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

> **Nota:** Las cadenas de PostgREST pre-serializadas (formato 2) son una alternativa para pasar valores de filtro que ya se encuentran en el formato de la red. Se recomienda priorizar la sintaxis de tuplas para garantizar la seguridad de tipos y la legibilidad.

## Condiciones lógicas (OR / AND / NOT)

Todos los campos en `where` se combinan mediante AND. Para unir condiciones con OR, o para negar un grupo, construye una **condición lógica** con las funciones auxiliares `or`, `and`, `not` y `cond` exportadas por el SDK:

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

El constructor fluido admite la misma estructura de árbol:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` recibe el operador canónico (la columna izquierda de la tabla de [Operadores de filtro](#filter-operators)). Un operador no admitido por el dialecto generará un `TypeError` al serializar la consulta, en lugar de producir silenciosamente una consulta diferente.

### Negación

`not` niega la **conjunción** de sus condiciones: `not(a)` equivale a `NOT a`, y `not(a, b)` equivale a `NOT (a AND b)`. Los grupos pueden anidarse, de modo que la otra ley de De Morgan se expresa como `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Se compila como un `NOT (...)` real en SQL, no como operadores invertidos. Esta diferencia no es meramente cosmética: SQL utiliza lógica trivaluada, por lo que `NOT (a AND b)` y `(NOT a) OR (NOT b)` dejan de coincidir en cuanto interviene un valor `NULL`, y solo una de las dos opciones corresponde a la consulta que escribiste.

Esto también implica que una negación **incluye filas cuya columna sea NULL**: `not(cond("status", "==", "draft"))` devuelve filas que no tienen ningún estado definido. Ese es el comportamiento de `NOT` y suele ser lo deseado; si no es así, añade un `is-not-null` con AND.

### Cómo se compone con el resto de la consulta

`where`, `logical` y `search` son tres grupos independientes, combinados entre sí mediante AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

No es posible aplicar un OR entre `where` y `logical`. Cualquier lógica que no sea un AND simple entre los tres debe expresarse dentro de un único árbol `logical`: traslada los campos que necesites con OR al interior de este.

### En la red

Un grupo lógico se envía como un único parámetro de consulta `or=`, `and=` o `not=`, utilizando la misma sintaxis de puntos que los filtros de campos:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Solo uno de los tres se aplica por solicitud: `or` tiene prioridad sobre `and`, y ambos sobre `not`. Anida un grupo dentro de otro para combinarlos.

Conviene conocer tres serializaciones en particular, ya que son las que suelen escribirse incorrectamente al armar cadenas de consulta a mano:

| Condición | Formato en la red | Nota |
|-----------|-------------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` busca la cadena literal de cuatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` representa una lista que contiene una cadena vacía, lo cual es una consulta distinta |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | una [ruta de relación](#querying-through-a-relation) conserva su punto |

Las comas, paréntesis y barras invertidas dentro de un valor se escapan con barra invertida, por lo que `cond("name", "==", "Doe, John")` se transmite como `name.eq.Doe\, John` sin dividir el grupo.

Los grupos pueden anidarse hasta 32 niveles de profundidad. A partir de ese límite, la solicitud se rechaza con `INVALID_LOGICAL_GROUP`; simplifica la estructura, ya que `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginación

Los desplazamientos (offsets), números de página y cursores keyset tienen su propia sección detallada:
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

Si omites la dirección, por defecto será `"asc"`, equivalente a lo que significa `?orderBy=name` en HTTP sin importar la base de datos subyacente.

### Ordenar por más de una columna

Una ordenación es una *lista* de claves. La segunda desempata las filas que la primera considera iguales, la tercera las que empatan en las dos primeras, etc. Por lo tanto, `orderBy` admite una lista de pares `[field, direction]` con la misma facilidad que uno solo:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

El constructor fluido expresa lo mismo encadenando llamadas a `.orderBy()`. Cada llamada **añade** una clave por debajo de las anteriores en lugar de reemplazarlas:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenación concluye siempre con el ID de la fila en orden descendente, se solicite o no. Esto garantiza que el orden sea *total*: sin ello, dos filas con el mismo valor se devolverían en el orden que determine la base de datos en ese instante, y paginar sobre un orden que varía entre dos ejecuciones de la misma consulta provocaría repeticiones u omisiones de filas.

Una ordenación por múltiples columnas se pagina sin problemas mediante un [cursor](#cursor-pagination): la comparación se evalúa sobre cada clave, en orden. El único criterio de ordenación que un cursor no puede procesar es **`_score`** (consulta [Search](/docs/backend/search)). La relevancia se calcula por consulta en lugar de almacenarse, por lo que la fila del cursor no contiene un valor con el que comparar la siguiente página, y dicho listado no incluirá `nextCursor`.

### Dónde se ordenan los NULL

Por defecto, los valores NULL se ordenan **al final de forma ascendente y al principio de forma descendente**, siguiendo la convención de Postgres. Este comportamiento por defecto ubica cualquier fila sin fecha en la parte superior de una lista ordenada por "más recientes primero", por encima de los datos reales; la única forma de evitarlo solía ser aplicar un filtro `is-not-null` que descartaba esas filas por completo.

Un tercer elemento en la clave permite definir su posición:

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

En HTTP se especifica mediante un tercer segmento separado por dos puntos, `?orderBy=publishedAt:desc:last`, o mediante una clave `"nulls"` en formato de array JSON. Cualquier valor diferente a `first`/`last` devolverá un error 400 en lugar de aplicar un orden inesperado.

El [cursor](#cursor-pagination) respeta la configuración definida en la ordenación, por lo que paginar sobre una clave que admita valores nulos sigue funcionando correctamente bajo cualquiera de las dos opciones.

## Devolver menos columnas

`fields` restringe la lectura a las columnas especificadas. Es una proyección realizada directamente en la base de datos (son las columnas *leídas*, no simplemente el resultado de recortar la respuesta), por lo que una consulta que solo necesita dos campos de una fila ancha no incurre en el coste de transferir el resto:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Se aplican dos reglas constantes, independientemente de los campos indicados:

- **La clave primaria siempre se incluye.** Una fila que no se puede identificar no puede actualizarse, eliminarse ni paginarse, y `meta.nextCursor` se deriva de ella, por lo que una proyección sin ella deshabilitaría silenciosamente la navegación por cursor.
- **Las columnas con `excludeFromApi` permanecen ocultas.** Especificar su nombre no anula esta restricción.

Una columna desconocida genera un error 400 `UNKNOWN_FIELD`. Si se interpretara como "omitirla", un error tipográfico como `fields: ["titel"]` devolvería filas sin título y sin ninguna indicación del error.

Una relación incluida en `include` se cargará independientemente de si aparece en `fields`; para restringir las columnas *dentro* de una relación, consulta las [opciones por relación](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` agrupa las filas que resulten idénticas respecto a las columnas devueltas, y una lectura con distinct devuelve **únicamente** las columnas especificadas: la clave primaria se excluye de la proyección, a diferencia del resto de lecturas. Esto es necesario: una clave sustituta difiere en cada fila, por lo que conservarla haría que cada fila fuera única por definición y la consulta devolvería un 200 sin haber agrupado nada.

Por ello, solo tiene sentido cuando se utiliza junto con `fields`. Sin este, estarías solicitando todas las columnas visibles (clave incluida) y nada se agruparía:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Una lectura con distinct no identifica filas específicas (no hay una clave para referenciarlas), por lo que devuelve un conjunto de valores en lugar de filas listas para actualizar o eliminar, y no genera un `nextCursor`. Tampoco reporta **`meta.total`**: el recuento requeriría un `COUNT(DISTINCT …)` que el driver no emite, y reportar el total de filas describiría un conjunto diferente al entregado (un resultado de solo dos filas aparecería como `total: 8, hasMore: true`, provocando que el cliente pagine indefinidamente). `hasMore` se calcula a partir de la propia página.

Se rechazan dos combinaciones para evitar respuestas no deseadas:

- **Una consulta que califica cada fila:** un `search()` ponderado o un `vectorSearch()` añade un `_score`/`_distance` por fila, impidiendo que dos filas sean iguales y anulando el efecto de `DISTINCT`. (Una búsqueda simple por subcadena no añade campos y funciona sin inconvenientes).
- **Ordenar por una columna no devuelta:** Postgres no permite ordenar una lectura `DISTINCT` mediante una expresión fuera de la lista de selección; la solicitud genera un error 400 `DISTINCT_ORDER_BY_NOT_SELECTED` en lugar de un 500 citando SQL no escrito por el usuario.

En HTTP: `?fields=status&distinct=true`.

## Agregaciones

`aggregate()` consolida las filas coincidentes en lugar de devolverlas (`count`, `sum`, `avg`, `min`, `max`), opcionalmente agrupadas:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Los filtros del constructor se transmiten a la agregación, lo que suele ser la sintaxis más concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Las claves del resultado son **derivadas**, no elegidas: `sum(total)` se devuelve como `sum_total`, y un `count()` simple como `count`. Permitir nombres personalizados requeriría validar que no coincidan con campos de `groupBy` (una regla poco intuitiva que, de omitirse, sobrescribiría valores silenciosamente).

`limit` delimita el número de **grupos** (agrupar por una columna de alta cardinalidad puede generar el equivalente a una tabla completa en una sola respuesta) y se ignora si no hay un `groupBy`, ya que un agregado sin agrupar produce una única fila. `orderBy`, `include` y la paginación no se aplican: una agregación no contiene filas que ordenar, relaciones que cargar ni páginas que continuar.

El propósito principal es evitar la descarga de filas para procesarlas en memoria. Calcular los "ingresos por estado" sobre un millón de órdenes requiere aquí una sola consulta y una fila por estado, frente a un `findAll()` con un bucle en otros entornos (lo cual falla con un `limit` y resulta inasumible sin él). Se ejecuta a través del mismo contexto de solicitud que el resto de lecturas, por lo que la seguridad a nivel de fila se aplica a los registros agregados.

En HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

El filtrado JSON, la búsqueda de texto completo y la búsqueda vectorial cuentan con su propia página:
[Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/).

La lectura de entidades relacionadas (`include` y los accesores para consultar a través de una relación) dispone de su propia sección: [Consulta de relaciones](/docs/sdk/relations/).

## Endpoints personalizados

Llama a endpoints personalizados del servidor registrados a través del sistema de funciones:

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

Ambos devuelven **el cuerpo de la respuesta de la función textualmente**. Ninguno extrae automáticamente una clave `data`, por lo que una función que responda `{ data: [...] }` devolverá dicho objeto íntegro y deberás acceder a `.data` manualmente.

`call()` requiere la ruta completa y realiza siempre un POST; `invoke()` recibe el nombre de la función y permite especificar el método HTTP, una subruta y encabezados. Utiliza `invoke()` a menos que estés llamando a un recurso que no sea una función.

## Siguientes pasos

- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión, registro, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en directo con WebSockets
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Subir, descargar y gestionar archivos
- **[Relaciones](/docs/collections/relations)** — Definir relaciones entre colecciones

---
