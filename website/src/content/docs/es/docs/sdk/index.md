---
title: SDK del Cliente
sidebar_label: SDK del Cliente
description: Utilice el SDK del Cliente de Rebase para interactuar con su backend desde cualquier aplicación JavaScript — operaciones de datos, autenticación, almacenamiento y suscripciones en tiempo real.
---

## Overview

El paquete `@rebasepro/client` proporciona un SDK de JavaScript con tipos seguros para interactuar con su backend de Rebase. Maneja:

- **Operaciones de datos** — CRUD con filtrado, ordenación y paginación
- **Obtención de relaciones** — Incluir entidades relacionadas con `.include()`
- **Suscripciones en tiempo real** — Actualizaciones en vivo basadas en WebSocket
- **Autenticación** — Gestión de tokens, inicio de sesión, registro
- **Almacenamiento** — Carga y descarga de archivos

## Installation

```bash
pnpm add @rebasepro/client
```

## Setup

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});
```

El cliente gestiona automáticamente los tokens de autenticación — una vez que un usuario inicia sesión, todas las solicitudes posteriores incluyen el JWT.

## Data Operations

Acceda a cualquier colección a través de `client.data.<collectionName>` (camelCase) o `client.data.collection<Record<string, unknown>>("slug")` (kebab-case):

```typescript
// Property-style access (auto-converts to kebab-case)
client.data.blogPosts    // → "blog-posts"
client.data.users        // → "users"

// Dynamic access by slug
client.data.collection("blog-posts")
```

### Find (List)

```typescript
// All products (default limit: 20)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Buscar por ID

```typescript
const product = await client.data.products.findById(42);
// Entity<M> | undefined
```

### Create

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

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Delete

```typescript
await client.data.products.delete(42);
```

## Constructor de consultas fluido

Encadene métodos para consultas más expresivas:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Available Methods

| Método | Descripción | Ejemplo |
|--------|-------------|---------|
| `.where(field, op, value)` | Añadir una condición de filtro | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Ordenar resultados | `.orderBy("name", "asc")` |
| `.limit(n)` | Limitar el número de resultados | `.limit(25)` |
| `.offset(n)` | Omitir los primeros N resultados | `.offset(50)` |
| `.search(text)` | Búsqueda de texto completo | `.search("laptop")` |
| `.include(...relations)` | Incluir entidades relacionadas | `.include("author", "tags")` |
| `.find()` | Ejecutar la consulta | Devuelve `FindResult<M>` |
| `.listen(onUpdate)` | Suscribirse a actualizaciones en tiempo real | Devuelve `unsubscribe()` |

### Filter Operators

| Operador | Alias | Descripción |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | No igual |
| `">"` | `"gt"` | Mayor que |
| `">="` | `"gte"` | Mayor o igual que |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor o igual que |
| `"in"` | | Valor en array |
| `"not-in"` | `"nin"` | Valor no en array |
| `"array-contains"` | `"cs"` | Campo array contiene valor |
| `"array-contains-any"` | `"csa"` | Campo array contiene cualquiera de los valores |

## Fetching Relations

Las relaciones se pueden incluir en los resultados de la consulta para que las entidades relacionadas se devuelvan junto con los datos primarios, en lugar de solo sus IDs de clave foránea.

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

### Combinación con filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lectura de datos de relación

Cuando se incluyen relaciones, la respuesta contiene **tanto** la clave foránea escalar como el objeto de relación hidratado:

```typescript
const { data } = await client.data.posts
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.values.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.values.author?.name); // "Jane Doe"
}
```

> **Nota:** Sin `.include("author")`, solo se devuelve el campo escalar `authorId`. El objeto `author` hidratado será `undefined`.

### Relation Names

Los nombres de relación que se pasan a `include()` deben coincidir con el `relationName` definido en el array `relations` de la colección. Por ejemplo:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Suscripciones en tiempo real

Suscríbase a los cambios de colección a través de WebSocket:

```typescript
// Subscribe to all active products
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
    }
);

// Unsubscribe when done
unsubscribe();
```

Suscribirse a una sola entidad:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);
```

También puede suscribirse a través del constructor de consultas fluido:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

El cliente WebSocket gestiona la reconexión automáticamente.

## Authentication

```typescript
// Login
const session = await client.auth.signIn("user@example.com", "password");

// Register
const session = await client.auth.signUp("user@example.com", "password");

// Google OAuth
const session = await client.auth.signInWithGoogle(googleIdToken);

// Refresh token
await client.auth.refreshToken();

// Logout
await client.auth.signOut();

// Get current user
const user = client.auth.getUser();
```

## Storage

```typescript
// Upload
const result = await client.storage.uploadFile(file, "products/image.jpg");

// Get URL
const url = await client.storage.getDownloadURL("products/image.jpg");

// Delete
await client.storage.deleteFile("products/image.jpg");
```

## Custom Endpoints

Llame a endpoints de servidor personalizados (Funciones en la Nube, rutas personalizadas, etc.):

```typescript
const result = await client.call<{ summary: string }>("functions/generate-summary", {
    articleId: 42
});
```

## Uso con React

En un frontend de Rebase, el cliente se crea típicamente una vez y se comparte a través de un contexto:

```tsx
const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

// Pass to Rebase provider
<Rebase client={client} ...>
```

Acceder a él desde cualquier componente:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // Use client.data, client.auth, client.storage
}
```

## SDK Generator

Genere un SDK de cliente totalmente tipado a partir de sus definiciones de colección:

```bash
rebase generate-sdk
```

Esto crea tipos TypeScript para todas sus entidades, de modo que obtiene autocompletado y verificación de tipos al usar el cliente. Tanto las claves foráneas escalares como los objetos de relación se incluyen en los tipos `Database` generados.

## Next Steps

- **[Relaciones](/docs/collections/relations)** — Defina relaciones entre colecciones
- **[Visión general del Frontend](/docs/frontend)** — Framework y componentes de React
- **[Visión general del Backend](/docs/backend)** — Configuración del servidor
