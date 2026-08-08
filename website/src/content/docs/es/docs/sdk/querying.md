---
title: Consultar Datos
sidebar_label: Consultar Datos
description: Operaciones CRUD, constructor de consultas fluido, operadores de filtro, paginación, ordenación y obtención de relaciones con el SDK del Cliente de Rebase.
---

## Acceso a las Colecciones

Acceda a cualquier colección mediante `client.data.<collectionName>` (camelCase, convertido automáticamente a snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estricto (SDK generado):** Cuando pasa el `collectionsDictionary` generado a `createRebaseClient`, el proxy de datos valida los accesos a propiedades en el momento del acceso. Un error tipográfico como `client.data.prodcuts` lanzará una excepción de inmediato con un mensaje útil y una sugerencia de coincidencia más cercana, en lugar de producir un confuso 404 más tarde. Use `client.data.collection<Record<string, unknown>>("slug")` para omitir la validación con slugs dinámicos o determinados en tiempo de ejecución.

## Operaciones CRUD

### Find (Listar)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["created_at", "desc"],
    limit: 25,
    offset: 0
});

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Buscar por ID

```typescript
const product = await client.data.products.findById(42);
// Returns Entity<M> | undefined
```

### Crear

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Actualizar

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Eliminar

```typescript
await client.data.products.delete(42);
```

### Contar

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructor de Consultas Fluido

Encadene métodos para consultas más expresivas:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("created_at", "desc")
    .limit(10)
    .find();
```

### Métodos Disponibles

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `.where(field, op, value)` | Añade una condición de filtro | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Ordena los resultados | `.orderBy("name", "asc")` |
| `.limit(n)` | Limita el número de resultados | `.limit(25)` |
| `.offset(n)` | Omite los primeros N resultados | `.offset(50)` |
| `.search(text)` | Búsqueda de texto completo | `.search("laptop")` |
| `.include(...relations)` | Incluye entidades relacionadas | `.include("author", "tags")` |
| `.find()` | Ejecuta la consulta | Devuelve `FindResponse<M>` |
| `.listen(onUpdate, onError?)` | Se suscribe a actualizaciones en tiempo real | Devuelve `unsubscribe()` |

### Operadores de Filtro

| Operador | Alias | Descripción |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | Distinto |
| `">"` | `"gt"` | Mayor que |
| `">="` | `"gte"` | Mayor o igual que |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor o igual que |
| `"in"` | | Valor dentro de un array |
| `"not-in"` | `"nin"` | Valor fuera de un array |
| `"array-contains"` | `"cs"` | El campo array contiene el valor |
| `"array-contains-any"` | `"csa"` | El campo array contiene alguno de los valores |

### Sintaxis de la Cláusula Where

El parámetro `where` de `find()` admite dos formatos:

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

> **Nota:** Las cadenas PostgREST preserializadas (formato 2) son una vía de escape para pasar valores de filtro que ya están en formato de transmisión. Prefiera la sintaxis de tuplas por seguridad de tipos y legibilidad.

## Paginación

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

`limit` debe ser un número entero entre 1 y 1000. Uno mayor — o un cero, un
negativo o un fraccionario — se rechaza con un 400 `INVALID_LIMIT` en lugar de
recortarse, porque una página silenciosamente más pequeña no puede distinguirse
de la última. Para leer más allá de ese techo, recorra las páginas con
`iterate()` o `findAll()`.

## Ordenación

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["created_at", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

## Búsqueda de Texto Completo

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

## Obtención de Relaciones

Las relaciones pueden incluirse para que las entidades relacionadas se devuelvan junto con los datos principales, en lugar de solo sus IDs de clave foránea.

### Uso de `include()` (Fluido)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations
const { data } = await client.data.posts
    .include("*")
    .find();
```

### Uso de `find({ include })` (Parámetros)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combinación con Filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("published_at", "desc")
    .limit(10)
    .find();
```

### Lectura de los Datos de las Relaciones

Cuando se incluyen relaciones, la respuesta contiene **tanto** la clave foránea escalar como el objeto de relación hidratado:

```typescript
const { data } = await client.data
    .collection<{ author_id: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.author_id);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Sin `.include("author")`, solo se devuelve el campo escalar `author_id`. El objeto `author` hidratado será `undefined`.

### Nombres de las Relaciones

Los nombres de relación que pasa a `include()` deben coincidir con el `relationName` definido en el array `relations` de la colección:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Endpoints Personalizados

Llame a endpoints personalizados del servidor registrados a través del sistema de funciones:

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

## Próximos Pasos

- **[Autenticación](/docs/sdk/authentication)** — Iniciar sesión, registrarse, OAuth, sesiones
- **[Suscripciones en Tiempo Real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Almacenamiento y Archivos](/docs/sdk/storage)** — Subir, descargar y gestionar archivos
- **[Relaciones](/docs/collections/relations)** — Definir relaciones entre colecciones
