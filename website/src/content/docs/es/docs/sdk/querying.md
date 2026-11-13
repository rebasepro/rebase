---
sourceHash: 45064786f1785a65
title: Consultar datos
sidebar_label: Consultar datos
description: Operaciones CRUD, constructor de consultas fluido, operadores de filtrado, ordenación, selección de columnas y agregaciones con el SDK tipado de Rebase.
---

## Acceso a tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Accede a cualquier tabla mediante `client.data.<tableName>` (en camelCase, convertido automáticamente a snake_case) o `client.data.table<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.table<Record<string, unknown>>("blog_posts")
```

> **Modo estricto (SDK generado):** Cuando pasas el `tablesDictionary` generado a `createRebaseClient` como `tables`, el proxy de datos valida los accesos a propiedades en el momento del acceso. Un error tipográfico como `client.data.prodcuts` lanza `UNKNOWN_TABLE` de inmediato con una sugerencia de coincidencia más cercana en lugar de generar un confuso error 404 más adelante. Usa `client.data.table<Record<string, unknown>>("slug")` para omitir la validación en slugs dinámicos o determinados en tiempo de ejecución.

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

Existen dos métodos porque corresponden a dos situaciones distintas que requieren código diferente.

`get` es para una fila que esperas que exista: el ID provino de un enlace, un parámetro de ruta u otra fila. Devuelve la fila directamente, por lo que no es necesario acotar tipos posteriormente, y si la fila no existe, lanza una excepción sobre la que puedes ramificar:

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

`findById` es para una fila que legítimamente podría no estar allí: una búsqueda a partir de un ID escrito por el usuario o una comprobación en caché:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

`findById` acepta las relaciones que se deben cargar, al igual que `find`:
`findById(1, { include: ["tags"] })`.

:::note
La seguridad a nivel de fila (Row-level security) hace que "no existe tal fila" y "no tienes permisos para leerla" devuelvan deliberadamente la misma respuesta: un 404 que las distinguiera confirmaría la existencia de la fila.
:::

### Escritura

`create`, `upsert`, `update`, `delete` y sus variantes por lotes se encuentran en
**[Escritura de datos](/docs/sdk/writing/)**, junto con operaciones sobre campos, escrituras condicionales y claves de idempotencia.

### Count (Contar)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructor de consultas fluido (Fluent Query Builder)

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
| `.where(path, op, value)` | Filtra sobre una ruta de [relación](/docs/sdk/relations#querying-through-a-relation) o [JSON](/docs/sdk/aggregates-and-search#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Añade un [grupo OR/AND](#condiciones-lógicas-or--and--not) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena los resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por una [agregación sobre una relación](/docs/sdk/relations#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita la cantidad de resultados | `.limit(25)` |
| `.offset(n)` | Omite los primeros N resultados | `.offset(50)` |
| `.after(cursor)` | Continúa después de un [cursor](/docs/sdk/pagination#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Devuelve [únicamente estas columnas](#devolver-menos-columnas) | `.fields("id", "title")` |
| `.distinct()` | Colapsa filas que sean idénticas en esas columnas | `.fields("status").distinct()` |
| `.search(text)` | Búsqueda de texto — consulta [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Búsqueda de vecinos más cercanos sobre una propiedad `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carga filas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Ejecuta la consulta | Devuelve `FindResult<M>` |
| `.aggregate(params)` | [Reduce en lugar de devolver filas](#agregaciones) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite en streaming cada fila coincidente](/docs/sdk/pagination#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Recopila cada fila coincidente](/docs/sdk/pagination#reading-everything-iterate-and-findall) | Devuelve `M[]` |
| `.count()` | Cuenta las filas coincidentes | Devuelve `number` |
| `.listen(onUpdate, onError?)` | Se suscribe a actualizaciones en tiempo real | Devuelve `unsubscribe()` |

### Operadores de filtrado

| Operador | Alias | Descripción |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | No igual |
| `">"` | `"gt"` | Mayor que |
| `">="` | `"gte"` | Mayor o igual que |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor o igual que |
| `"in"` | | El valor está en el array |
| `"not-in"` | `"nin"` | El valor no está en el array |
| `"array-contains"` | `"cs"` | El campo array contiene el valor |
| `"array-contains-any"` | `"csa"` | El campo array contiene cualquiera de los valores |
| `"array-contains-all"` | `"csall"` | El campo array contiene todos y cada uno de los valores |
| `"array-contained-by"` | `"cd"` | El campo array solo contiene estos valores (se incluye un array vacío) |
| `"like"` | `"like"` | Coincidencia de patrones **sensible** a mayúsculas y minúsculas; `%` y `_` son comodines |
| `"ilike"` | `"ilike"` | Coincidencia de patrones insensible a mayúsculas y minúsculas |
| `"not-like"` | `"nlike"` | No coincide con el patrón |
| `"not-ilike"` | `"nilike"` | No coincide con el patrón, de forma insensible a mayúsculas y minúsculas |
| `"is-null"` | `"isnull"` | La columna es `NULL`. No recibe ningún valor: lo que pases se normaliza y descarta |
| `"is-not-null"` | `"notnull"` | La columna no es `NULL`. No recibe ningún valor |

La columna de alias corresponde a la sintaxis **de red** (wire format), utilizada en las cadenas de consulta REST. Nunca aparece en el código de la aplicación: tanto el SDK como el panel de administración utilizan el operador canónico de la izquierda.

Los cuatro operadores de array funcionan en columnas de array nativas (`text[]`, `integer[]`, …) y en arrays JSONB, y un índice GIN en la columna da soporte a todos ellos. Para listar los elementos distintos de una columna de array, agrupa una agregación mediante `unnest(<field>)` (consulta [Agregaciones](/docs/sdk/aggregates-and-search/#grouping-by-an-expression)).

Los cuatro operadores de patrones coinciden con texto. Un campo `enum` se compara por su valor, por lo que `{ status: ["like", "draft%"] }` funciona en un estado almacenado como un enum de Postgres. En un número, una fecha o cualquier otro campo que no sea texto, se rechazan con un error 400 `INVALID_FILTER_OPERATOR`.

### Ignorar mayúsculas y minúsculas: `lower(field)`

Una clave de filtro puede convertir un campo de texto a un solo formato de mayúsculas/minúsculas — `lower(artist)` o `upper(code)` — y cada operador comparará entonces el valor transformado, por lo que debes escribir los valores en dicho formato:

```typescript
await client.data.songs.find({
    where: { "lower(artist)": ["in", ["abba", "queen"]] }
});
```

Se compila a `lower(artist) = ANY($1)`: una única lista vinculada de cualquier longitud, que puede ser atendida por un índice en `lower(artist)`. A través de HTTP, la clave se escribe de la misma manera: `?lower(artist)=in.(abba,queen)`.

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

> **Nota:** Las cadenas de PostgREST preserializadas (formato 2) son un mecanismo de escape para pasar valores de filtro que ya están en formato de red. Prefiere la sintaxis de tuplas para mayor seguridad de tipos y legibilidad.

## Condiciones lógicas (OR / AND / NOT)

Cada campo en `where` se une con AND. Para unir condiciones con OR, o para negar un grupo, construye una **condición lógica** con las funciones de ayuda `or`, `and`, `not` y `cond` que exporta el SDK:

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

El constructor fluido acepta el mismo árbol:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` recibe el operador canónico: la columna izquierda de la tabla de [Operadores de filtrado](#operadores-de-filtrado). Un operador que el dialecto no posea generará un `TypeError` al serializar la consulta, en lugar de producir una consulta diferente de forma silenciosa.

En un cliente con [tipos generados](/docs/sdk#typed-sdk-generation), `logical` y `.where(group)` validan cada condición del árbol contra la fila, del mismo modo que lo hace `where`: una columna que la fila no tenga o un valor del tipo incorrecto para el operador (`cond("views", "==", "many")` en una columna numérica) es un error de compilación. Las rutas de relación o JSON (`author.name`, `metadata->>tier`) no se validan.

### Negación

`not` niega la **conjunción** de sus condiciones: `not(a)` es `NOT a`, y `not(a, b)` es `NOT (a AND b)`. Los grupos se pueden anidar, por lo que la otra mitad de las leyes de De Morgan es `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Se compila a un `NOT (...)` real de SQL, no a operadores invertidos. Esa distinción no es cosmética: SQL maneja lógica trivaluada, por lo que `NOT (a AND b)` y `(NOT a) OR (NOT b)` dejan de coincidir en el momento en que interviene un `NULL`, y solo uno de ellos representa la consulta que escribiste.

Esto también significa que una negación **incluye filas cuya columna es NULL**: `not(cond("status", "==", "draft"))` devuelve filas sin ningún estado. Eso es lo que significa `NOT` y normalmente lo que se desea; si no es así, añade un `is-not-null` con AND a su lado.

### Cómo se compone con el resto de la consulta

`where`, `logical` y `search` son tres grupos independientes, unidos mediante AND entre sí:

```
(campos where, unidos con AND)  AND  (grupo logical)  AND  (search)
```

No hay forma de aplicar un OR entre `where` y `logical`. Todo lo que no sea una simple conjunción AND entre los tres debe expresarse dentro de un único árbol `logical`; mueve los campos que necesites unir con OR a dicho árbol.

### En la transmisión de red

Un grupo lógico viaja como un único parámetro de consulta `or=`, `and=` o `not=`, utilizando la misma sintaxis con puntos que usan los filtros de campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Solo uno de los tres aplica por petición: `or` tiene prioridad sobre `and`, y ambos sobre `not`. Anida un grupo dentro de otro para combinarlos.

Vale la pena conocer tres codificaciones, ya que son aquellas en las que una cadena de consulta escrita a mano suele equivocarse:

| Condición | Formato de red | Nota |
|-----------|----------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` busca la cadena de cuatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` es una lista que contiene una cadena vacía, lo cual representa una consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | una [ruta de relación](/docs/sdk/relations#querying-through-a-relation) conserva su punto |

Las comas, los paréntesis y las barras invertidas dentro de un valor se escapan con barra invertida, por lo que `cond("name", "==", "Doe, John")` viaja como `name.eq.Doe\, John` y no divide el grupo.

Los grupos pueden anidarse hasta 32 niveles de profundidad. Más allá de eso, la petición se rechaza con `INVALID_LOGICAL_GROUP`; aplánalo, ya que `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginación

Los desplazamientos (offsets), los números de página y los cursores basados en claves (keyset cursors) tienen su propia página:
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

Si omites la dirección, se asume `"asc"`: lo mismo que significa `?orderBy=name` en HTTP, independientemente de la base de datos subyacente.

### Ordenar por más de una columna

Una ordenación es una *lista* de claves. La segunda desempata entre filas que la primera considera iguales, la tercera entre filas que las dos primeras consideran iguales; por tanto, `orderBy` acepta una lista de pares `[field, direction]` con la misma facilidad que uno solo:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

El constructor fluido expresa lo mismo llamando a `.orderBy()` nuevamente. Cada llamada **añade** una clave por debajo de las anteriores en lugar de reemplazarlas:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenación finaliza con el ID de la fila en orden descendente, lo hayas solicitado o no. Eso es lo que hace que el orden sea *total*: sin ello, dos filas que compartan un valor se devolverían en el orden que la base de datos decida, y paginar sobre un orden que puede variar entre dos ejecuciones de la misma consulta repetiría algunas filas y omitiría otras.

Una ordenación por múltiples columnas pagina perfectamente bajo un [cursor](/docs/sdk/pagination#cursor-pagination): la comparación se construye sobre cada clave, en orden. El único orden que un cursor no puede describir es **`_score`**; consulta [Search](/docs/backend/search). La relevancia se calcula por consulta en lugar de almacenarse, por lo que no hay un valor en la fila del cursor contra el cual comparar la página siguiente, y dicho listado no incluye `nextCursor`.

### Dónde se ordenan los valores NULL

Por defecto, los valores NULL se ordenan **al final de forma ascendente y al principio de forma descendente** (la convención propia de Postgres). Este comportamiento predeterminado es lo que coloca cada fila sin fecha en la parte superior de una lista de "más recientes primero", por delante de todos los datos reales, y la única forma de evitarlo solía ser un filtro `is-not-null` que descartaba esas filas por completo.

Un tercer elemento en la clave define a dónde deben ir en su lugar:

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

En HTTP se especifica como un tercer segmento separado por dos puntos, `?orderBy=publishedAt:desc:last`, o mediante una clave `"nulls"` en el formato de array JSON. Cualquier valor distinto de `first`/`last` produce un error 400 en lugar de un orden alterado silenciosamente.

El [cursor](/docs/sdk/pagination#cursor-pagination) respeta lo que haya declarado la ordenación, por lo que paginar sobre una clave que acepte nulos se mantiene correcto bajo cualquiera de las ubicaciones.

## Devolver menos columnas

`fields` restringe la lectura a las columnas que especifiques. Es una proyección a nivel de base de datos (esas son las columnas que se *leen*, no las que quedan tras recortar la respuesta), por lo que una consulta que solo necesita dos campos de una fila ancha no asume el coste del resto:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Siempre se cumplen dos condiciones, independientemente de lo que especifiques:

- **La clave primaria siempre se incluye en la respuesta.** Una fila que no se puede direccionar no se puede actualizar, eliminar ni utilizar para avanzar en la paginación, y `meta.nextCursor` se deriva de ella, por lo que una proyección sin la clave primaria deshabilitaría silenciosamente la navegación por cursor.
- **Las columnas marcadas como `excludeFromApi` permanecen ocultas.** Especificarlas no hace que se revelen.

Una columna desconocida genera un error 400 `UNKNOWN_FIELD`. Si se interpretara como "omitirla", un error tipográfico como `fields: ["titel"]` devolvería filas sin títulos y sin ninguna pista del motivo.

Una relación especificada en `include` se carga independientemente de si aparece en `fields`; para restringir las columnas *dentro* de una relación, consulta las [opciones por relación](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` colapsa las filas que son idénticas en las columnas devueltas, y una lectura distinct devuelve **únicamente** las columnas especificadas: la clave primaria se excluye de la proyección, a diferencia de cualquier otra lectura. Debe ser así: una clave subrogada es distinta en cada fila, por lo que conservarla haría que cada fila fuera única por definición y la consulta respondería 200 sin haber hecho nada.

Esto hace que solo tenga sentido junto con `fields`. Sin este parámetro, estarías solicitando todas las columnas visibles, incluida la clave primaria, y no se colapsaría nada:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Una lectura distinct no direcciona filas individuales (no existe una clave con la que direccionarlas), por lo que devuelve un conjunto de valores en lugar de un conjunto de filas para actualizar o eliminar, y no incluye `nextCursor`. Además, **no informa `meta.total`**: contar requeriría un `COUNT(DISTINCT …)` que el controlador no emite, y reportar el conteo de filas describiría un conjunto distinto al entregado (un resultado completo de dos filas devuelto como `total: 8, hasMore: true` provocaría que un cliente pagine infinitamente). `hasMore` se obtiene de la propia página.

Existen dos combinaciones que se rechazan en lugar de devolver una respuesta inservible:

- **Una consulta que califica cada fila:** una búsqueda clasificada con `search()` o un `vectorSearch()` adjunta un `_score`/`_distance` por fila, por lo que nunca habrá dos filas iguales y `DISTINCT` no tendría efecto. (Una búsqueda de subcadenas simple no adjunta nada y funciona sin problemas).
- **Ordenar por una columna que no fue devuelta.** Postgres no puede ordenar una lectura `DISTINCT` mediante una expresión fuera de la lista de selección; la petición genera un error 400 `DISTINCT_ORDER_BY_NOT_SELECTED` en lugar de un 500 citando SQL que nunca escribiste.

A través de HTTP: `?fields=status&distinct=true`.

## Agregaciones

`aggregate()` reduce las filas coincidentes en lugar de devolverlas: `count`, `sum`, `avg`, `min`, `max`, opcionalmente agrupadas:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Los filtros del constructor se transmiten a la agregación, lo cual suele ser la forma más concisa de escribirlo:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Las claves de los resultados son **derivadas**, no elegidas: `sum(total)` se devuelve como `sum_total`, un simple `count()` como `count`. Permitir nombrarlas implicaría validar que el nombre no coincida con un campo de `groupBy` (una regla difícil de prever y que sobrescribiría valores en silencio si no se verificara).

Los grupos se paginan como las filas de un listado: `limit` los delimita y `offset` los omite (agrupar por una columna de alta cardinalidad puede equivaler a las filas de una tabla completa en una sola respuesta). Una agregación agrupada sin `limit` adopta el valor predeterminado de los listados (**50 grupos** a través de HTTP), por lo que debes revisar `meta` en el resultado antes de asumir que está completo:

```typescript
const byCustomer = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }],
    groupBy: ["customerId"],
    limit: 200
});
byCustomer.meta; // { limit: 200, offset: 0, hasMore: true } — page on with offset: 200
```

El resultado sigue siendo un array de filas; `meta` es una propiedad no enumerable en él, por lo que un operador de propagación (spread) o un `JSON.stringify` solo verá las filas. Estará presente siempre que los grupos se hayan acotado mediante un `limit`. Sin un `groupBy`, solo hay una fila, `limit` no tiene efecto y `offset` se rechaza. En una función del servidor (`rebase.data`, `context.data`), una agregación agrupada sin `limit` devuelve todos los grupos. `include` no se envía con una agregación: no hay relaciones que cargar. Los grupos pueden ordenarse con `orderBy`, ya sea por una columna de `groupBy` o por la clave de una agregación; consulta [Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/).

El objetivo principal es evitar obtener filas para reducirlas posteriormente. "Ingresos por estado" sobre un millón de pedidos se resuelve aquí en una sola consulta y una fila por estado, en contraste con un `findAll()` más un bucle en otros entornos, lo cual resulta incorrecto bajo un `limit` e inviable sin él. Se ejecuta a través del mismo controlador con alcance de petición que cualquier otra lectura, por lo que la seguridad a nivel de fila se aplica a las filas que se agregan.

A través de HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

El filtrado JSON, la búsqueda de texto completo y la búsqueda vectorial tienen su propia página:
[Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/).

La lectura de entidades relacionadas (`include` y los métodos de acceso que consultan a través de una relación) tiene su propia página: [Consultar relaciones](/docs/sdk/relations/).

## Endpoints personalizados

Llama a endpoints de servidor personalizados registrados mediante el sistema de funciones:

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

Ambos devuelven **el cuerpo de respuesta de la función, textualmente**. Ninguno busca dentro de él una clave `data`, por lo que una función que responde con `{ data: [...] }` te entrega ese objeto directamente y tú accedes a `.data` por tu cuenta.

`call()` recibe una ruta completa y siempre realiza un POST; `invoke()` recibe el nombre de una función y puede recibir un método, una subruta y encabezados. Utiliza `invoke()` a menos que estés llamando a algo que no sea una función.

## Siguientes pasos

- **[Autenticación](/docs/sdk/authentication)** — Iniciar sesión, registrarse, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Subir, descargar y gestionar archivos
- **[Relaciones](/docs/collections/relations)** — Definir relaciones entre tablas
