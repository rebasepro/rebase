---
sourceHash: 6d40635c3d2f94ea
title: Consulta de datos
sidebar_label: Consulta de datos
description: Operaciones CRUD, constructor de consultas fluido, operadores de filtrado, ordenación, selección de columnas y agregaciones con el SDK de cliente de Rebase.
---

## Acceso a colecciones

Accede a cualquier colección a través de `client.data.<collectionName>` (camelCase, convertido automáticamente a snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estricto (SDK generado):** Cuando pasas el `collectionsDictionary` generado a `createRebaseClient`, el proxy de datos valida los accesos a propiedades en tiempo de acceso. Un error tipográfico como `client.data.prodcuts` lanzará un error inmediatamente con un mensaje útil y una sugerencia de coincidencia más cercana en lugar de producir un confuso 404 más adelante. Usa `client.data.collection<Record<string, unknown>>("slug")` para omitir la validación de slugs dinámicos o determinados en tiempo de ejecución.

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

Dos métodos, porque existen dos situaciones y requieren código diferente.

`get` es para una fila que esperas que exista: el id provino de un enlace, un parámetro de ruta u otra fila. Devuelve la fila, por lo que nada posterior necesita acotarse (*narrowing*), y una fila inexistente es una excepción sobre la que puedes bifurcar:

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

`findById` es para una fila que legítimamente podría no estar allí: una búsqueda por un id que un usuario escribió, una comprobación de caché:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La seguridad a nivel de fila (*Row-level security*) hace que "no existe tal fila" y "no tienes permiso para leerla" sean la misma respuesta, deliberadamente: un 404 que las distinguiera confirmaría que la fila existe.
:::

### Escritura

`create`, `upsert`, `update`, `delete` y sus formas por lotes (*batch*) se encuentran en **[Escritura de datos](/docs/sdk/writing/)**, junto con operaciones de campo, escrituras condicionales y claves de idempotencia.

### Count (Contar)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructor de consultas fluido

Encadena métodos para realizar consultas más expresivas:

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
| `.where(field, op, value)` | Agrega una condición de filtro | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtra en una ruta de [relación](#querying-through-a-relation) o [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Agrega un [grupo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena los resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por una [agregación sobre una relación](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita la cantidad de resultados | `.limit(25)` |
| `.offset(n)` | Omite los primeros N resultados | `.offset(50)` |
| `.after(cursor)` | Continúa después de un [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Devuelve [solo estas columnas](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Colapsa filas idénticas en esas columnas | `.fields("status").distinct()` |
| `.search(text)` | Búsqueda de texto — consulta [Búsqueda](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Búsqueda de vecinos más cercanos sobre una propiedad `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carga filas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Ejecuta la consulta | Devuelve `FindResult<M>` |
| `.aggregate(params)` | [Reduce en lugar de devolver filas](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite (stream) cada fila coincidente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Recopila cada fila coincidente](#reading-everything-iterate-and-findall) | Devuelve `M[]` |
| `.count()` | Cuenta las filas coincidentes | Devuelve `number` |
| `.listen(onUpdate, onError?)` | Suscríbete a actualizaciones en tiempo real | Devuelve `unsubscribe()` |

### Operadores de filtrado

| Operador | Alias | Descripción |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | No igual |
| `">"` | `"gt"` | Mayor que |
| `">="` | `"gte"` | Mayor o igual que |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor o igual que |
| `"in"` | | Valor en el array |
| `"not-in"` | `"nin"` | Valor no en el array |
| `"array-contains"` | `"cs"` | El campo de tipo array contiene el valor |
| `"array-contains-any"` | `"csa"` | El campo de tipo array contiene cualquiera de los valores |
| `"like"` | `"like"` | Coincidencia de patrones **sensible** a mayúsculas/minúsculas; `%` y `_` son los comodines |
| `"ilike"` | `"ilike"` | Coincidencia de patrones insensible a mayúsculas/minúsculas |
| `"not-like"` | `"nlike"` | No coincide con el patrón |
| `"not-ilike"` | `"nilike"` | No coincide con el patrón, insensible a mayúsculas/minúsculas |
| `"is-null"` | `"isnull"` | La columna es `NULL`. No toma ningún valor — lo que sea que pases se normaliza y descarta |
| `"is-not-null"` | `"notnull"` | La columna no es `NULL`. No toma ningún valor |

La columna alias es la grafía **en la red** (*wire format*), utilizada en las cadenas de consulta REST. Nunca aparece en el código de la aplicación: tanto el SDK como el panel de administración utilizan el operador canónico de la izquierda.

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

> **Nota:** Las cadenas de PostgREST preserializadas (formato 2) son una vía de escape para pasar valores de filtro que ya están en formato de red. Prefiere la sintaxis de tupla para mayor seguridad de tipos y legibilidad.

## Condiciones lógicas (OR / AND / NOT)

Cada campo en `where` se une con AND. Para unir condiciones con OR, o para negar un grupo, construye una **condición lógica** con los helpers `or`, `and`, `not` y `cond` que exporta el SDK:

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

`cond` toma el operador canónico (la columna izquierda de la tabla de [Operadores de filtrado](#filter-operators)). Un operador que el dialecto no posea generará un `TypeError` cuando se serialice la consulta, en lugar de producir silenciosamente una consulta diferente.

### Negación

`not` niega la **conjunción** de sus condiciones: `not(a)` es `NOT a`, y `not(a, b)` es `NOT (a AND b)`. Los grupos se anidan, por lo que la otra mitad de De Morgan es `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Se compila a un `NOT (...)` real de SQL, no a operadores invertidos. Esa distinción no es cosmética: SQL maneja una lógica trivaluada, por lo que `NOT (a AND b)` y `(NOT a) OR (NOT b)` dejan de coincidir en cuanto interviene un `NULL`, y solo una de ellas es la consulta que escribiste.

También significa que una negación **incluye filas cuya columna es NULL**: `not(cond("status", "==", "draft"))` devuelve filas sin ningún estado. Eso es lo que significa `NOT`, y por lo general lo que deseas; si no es así, añade un `is-not-null` con AND junto a ella.

### Cómo se compone con el resto de la consulta

`where`, `logical` y `search` son tres grupos independientes, unidos entre sí mediante AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

No hay forma de aplicar OR entre `where` y `logical`. Todo lo que no sea un simple AND entre los tres debe expresarse dentro de un único árbol `logical`; mueve los campos que necesites con OR dentro de él.

### En la red (On the wire)

Un grupo lógico viaja como un único parámetro de consulta `or=`, `and=` o `not=`, en la misma sintaxis con puntos que usan los filtros de campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Solo uno de los tres se aplica por solicitud: `or` tiene prioridad sobre `and`, y ambos sobre `not`. Anida un grupo dentro de otro para combinarlos.

Vale la pena conocer tres codificaciones, ya que son aquellas en las que una cadena de consulta escrita a mano suele equivocarse:

| Condición | Formato de red | Nota |
|-----------|----------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` es una búsqueda de la cadena de cuatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` es una lista que contiene una cadena vacía, lo cual es una consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | una [ruta de relación](#querying-through-a-relation) conserva su punto |

Las comas, los paréntesis y las barras invertidas dentro de un valor se escapan con barra invertida, por lo que `cond("name", "==", "Doe, John")` viaja como `name.eq.Doe\, John` y no divide el grupo.

Los grupos pueden anidarse hasta 32 niveles de profundidad. Más allá de eso, la solicitud se rechaza con `INVALID_LOGICAL_GROUP`; aplánalo, ya que `or(a,or(b,c))` es `or(a,b,c)`.

## Paginación

Los desplazamientos (*offsets*), números de página y cursores keyset tienen su propia página: [Paginación](/docs/sdk/pagination/).

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

La dirección que omitas será `"asc"`, lo mismo que significa `?orderBy=name` sobre HTTP, independientemente de la base de datos subyacente.

### Ordenar por más de una columna

Una ordenación es una *lista* de claves. La segunda desempata las filas que la primera considera iguales, la tercera entre las filas que las dos primeras consideran iguales; por lo tanto, `orderBy` acepta una lista de pares `[field, direction]` con la misma facilidad que uno solo:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

El constructor fluido expresa lo mismo llamando a `.orderBy()` nuevamente. Cada llamada **agrega** una clave por debajo de las anteriores en lugar de reemplazarlas:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Cada ordenación finaliza con el id de la fila, de forma descendente, ya sea que lo hayas solicitado o no. Eso es lo que hace que el ordenamiento sea *total*: sin ello, dos filas que comparten un valor se devuelven en el orden que le plazca a la base de datos, y paginar sobre un orden que puede diferir entre dos ejecuciones de la misma consulta repite algunas filas y omite otras.

Una ordenación por múltiples columnas pagina correctamente bajo un [cursor](#cursor-pagination): la comparación se construye sobre cada clave, en orden. El único ordenamiento que un cursor no puede describir es **`_score`**; consulta [Búsqueda](/docs/backend/search). La relevancia se calcula por consulta en lugar de almacenarse, por lo que no hay ningún valor en la fila del cursor contra el cual comparar la página siguiente, y dicho listado no incluye `nextCursor`.

### Dónde se ordenan los NULL

Por defecto, los valores NULL se ordenan **al final de forma ascendente y al principio de forma descendente** (la propia convención de Postgres). Ese valor predeterminado es lo que coloca cada fila sin fecha en la parte superior de una lista ordenada por "más recientes primero", antes que cualquier dato real, y la única alternativa solía ser un filtro `is-not-null` que descartaba esas filas por completo.

Un tercer elemento en la clave indica dónde ubicarlos en su lugar:

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

Sobre HTTP es un tercer segmento separado por dos puntos, `?orderBy=publishedAt:desc:last`, o una clave `"nulls"` en el formato de array JSON. Cualquier valor distinto de `first`/`last` produce un 400 en lugar de un orden silenciosamente diferente.

El [cursor](#cursor-pagination) respeta lo que haya declarado la ordenación, por lo que paginar sobre una clave que admita valores nulos sigue siendo correcto bajo cualquiera de las dos ubicaciones.

## Devolver menos columnas

`fields` restringe una lectura a las columnas que especifiques. Es una proyección en la base de datos (esas son las columnas *leídas*, no las que sobreviven a un recorte de la respuesta), por lo que una consulta que necesita dos campos de una fila ancha no paga el costo del resto:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Dos cosas siempre se cumplen, sin importar lo que especifiques:

- **La clave primaria siempre se devuelve.** Una fila a la que no se puede hacer referencia no se puede actualizar, eliminar ni avanzar en la paginación; además, `meta.nextCursor` se deriva de ella, por lo que una proyección sin ella deshabilitaría silenciosamente la búsqueda.
- **Las columnas `excludeFromApi` permanecen ocultas.** Especificar una no la vuelve visible.

Una columna desconocida genera un 400 `UNKNOWN_FIELD`. Interpretada como "omítela", una errata como `fields: ["titel"]` devolvería filas sin títulos y sin ninguna indicación de por qué.

Una relación especificada en `include` se carga aparezca o no en `fields`; para restringir las columnas *dentro* de una relación, consulta [opciones por relación](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` colapsa filas que son idénticas en las columnas que se devuelven. Solo tiene sentido junto con `fields`, ya que la clave primaria siempre está en la proyección y, por lo tanto, cada fila ya es distinta de por sí:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

`meta.total` cuenta también las filas distintas, por lo que `hasMore` describe el conjunto que se está paginando. Se rechazan dos combinaciones en lugar de responder de forma inútil:

- **Una consulta que puntúa cada fila**: un `search()` con clasificación o un `vectorSearch()` adjunta un `_score`/`_distance` por fila, por lo que nunca habrá dos filas iguales y `DISTINCT` no tendría ningún efecto. (Una búsqueda de subcadenas simple no adjunta nada y funciona correctamente).
- **Ordenar por una columna que no devolviste.** Postgres no puede ordenar una lectura `DISTINCT` mediante una expresión que esté fuera de la lista de selección; la solicitud produce un 400 `DISTINCT_ORDER_BY_NOT_SELECTED` en lugar de un 500 citando código SQL que nunca escribiste.

Sobre HTTP: `?fields=status&distinct=true`.

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

Los filtros del constructor se transmiten a la agregación, lo cual suele ser la forma más concisa de expresarlo:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Las claves de resultado son **derivadas**, no elegidas: `sum(total)` se devuelve como `sum_total`, un simple `count()` como `count`. Permitir nombrarlas implicaría verificar que el nombre no sea también un campo de `groupBy`, una regla que nadie adivinaría y un valor sobreescrito silenciosamente si no se verificara.

`limit` restringe el número de **grupos** (agrupar por una columna de alta cardinalidad equivale a devolver todas las filas de una tabla completa en una sola respuesta) y se ignora sin un `groupBy`, ya que una agregación no agrupada es una sola fila. `orderBy`, `include` y la paginación no se aplican: una agregación no tiene filas para ordenar, ni relaciones que cargar, ni página para continuar.

El objetivo principal es no obtener filas para luego reducirlas. Los "ingresos por estado" sobre un millón de pedidos son aquí una sola consulta y una fila por estado, en lugar de un `findAll()` más un bucle en cualquier otro lugar, lo cual es incorrecto bajo un `limit` e inasumible sin él. Se ejecuta a través del mismo controlador con ámbito de solicitud que cualquier otra lectura, por lo que la seguridad a nivel de fila se aplica a las filas que se están agregando.

Sobre HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

El filtrado JSON, la búsqueda de texto completo y la búsqueda vectorial tienen su propia página: [Agregaciones y búsqueda](/docs/sdk/aggregates-and-search/).

La lectura de entidades relacionadas —`include` y los accesores que consultan a través de una relación— tiene su propia página: [Consulta de relaciones](/docs/sdk/relations/).

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

Ambos devuelven **el cuerpo de respuesta de la función, textualmente**. Ninguno busca dentro de él una clave `data`, por lo que una función que responde `{ data: [...] }` te entrega ese objeto y tú mismo lees `.data`.

`call()` toma una ruta completa y siempre realiza un POST; `invoke()` toma el nombre de una función y puede recibir un método, una subruta y encabezados. Usa `invoke()` a menos que estés llamando a algo que no sea una función.

## Próximos pasos

- **[Autenticación](/docs/sdk/authentication)** — Iniciar sesión, registrarse, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Subir, descargar y gestionar archivos
- **[Relaciones](/docs/collections/relations)** — Definir relaciones entre colecciones

---
