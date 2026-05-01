---
title: Client SDK
sidebar_label: Client SDK
slug: docs/sdk
description: Use the Rebase Client SDK to interact with your backend from any JavaScript application — data operations, auth, storage, and real-time subscriptions.
---

## Overview

The `@rebasepro/client` package provides a type-safe JavaScript SDK for interacting with your Rebase backend. It handles:

- **Data operations** — CRUD with filtering, sorting, and pagination
- **Relation fetching** — Include related entities with `.include()`
- **Real-time subscriptions** — WebSocket-based live updates
- **Authentication** — Token management, login, signup
- **Storage** — File upload and download

## Installation

```bash
npm install @rebasepro/client
```

## Setup

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});
```

The client automatically manages authentication tokens — once a user logs in, all subsequent requests include the JWT.

## Data Operations

Access any collection through `client.data.<collectionName>` (camelCase) or `client.data.collection("slug")` (kebab-case):

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
    where: { active: true, price: [">=", 100] },
    orderBy: "created_at:desc",
    limit: 25,
    offset: 0
});

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Find by ID

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

## Fluent Query Builder

Chain methods for more expressive queries:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("created_at", "desc")
    .limit(10)
    .find();
```

### Available Methods

| Method | Description | Example |
|--------|-------------|---------|
| `.where(field, op, value)` | Add a filter condition | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Sort results | `.orderBy("name", "asc")` |
| `.limit(n)` | Limit result count | `.limit(25)` |
| `.offset(n)` | Skip first N results | `.offset(50)` |
| `.search(text)` | Full-text search | `.search("laptop")` |
| `.include(...relations)` | Include related entities | `.include("author", "tags")` |
| `.find()` | Execute the query | Returns `FindResponse<M>` |
| `.listen(onUpdate)` | Subscribe to real-time updates | Returns `unsubscribe()` |

### Filter Operators

| Operator | Alias | Description |
|----------|-------|-------------|
| `"=="` | `"eq"` | Equal |
| `"!="` | `"neq"` | Not equal |
| `">"` | `"gt"` | Greater than |
| `">="` | `"gte"` | Greater than or equal |
| `"<"` | `"lt"` | Less than |
| `"<="` | `"lte"` | Less than or equal |
| `"in"` | | Value in array |
| `"not-in"` | `"nin"` | Value not in array |
| `"array-contains"` | `"cs"` | Array field contains value |
| `"array-contains-any"` | `"csa"` | Array field contains any of values |

## Fetching Relations

Relations can be included in query results so that related entities are returned alongside the primary data, instead of just their foreign key IDs.

### Using `include()` (Fluent)

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

### Using `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combining with Filters

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("published_at", "desc")
    .limit(10)
    .find();
```

### Reading Relation Data

When relations are included, the response contains **both** the scalar foreign key and the hydrated relation object:

```typescript
const { data } = await client.data.posts
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.values.author_id);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.values.author?.name); // "Jane Doe"
}
```

> **Note:** Without `.include("author")`, only the scalar `author_id` field is returned. The hydrated `author` object will be `undefined`.

### Relation Names

The relation names you pass to `include()` must match the `relationName` defined in the collection's `relations` array. For example:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Real-time Subscriptions

Subscribe to collection changes via WebSocket:

```typescript
// Subscribe to all active products
const unsubscribe = client.data.products.listen(
    { where: { active: true }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
    }
);

// Unsubscribe when done
unsubscribe();
```

Subscribe to a single entity:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);
```

You can also subscribe through the fluent query builder:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("created_at", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

The WebSocket client handles reconnection automatically.

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

Call custom server endpoints (Cloud Functions, custom routes, etc.):

```typescript
const result = await client.call<{ summary: string }>("generate-summary", {
    articleId: 42
});
```

## Using with React

In a Rebase frontend, the client is typically created once and shared via context:

```tsx
const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

// Pass to Rebase provider
<Rebase client={client} ...>
```

Access it from any component:

```tsx
import { useRebaseClient } from "@rebasepro/core";

function MyComponent() {
    const client = useRebaseClient();
    // Use client.data, client.auth, client.storage
}
```

## SDK Generator

Generate a fully typed client SDK from your collection definitions:

```bash
rebase generate-sdk
```

This creates TypeScript types for all your entities, so you get autocomplete and type checking when using the client. Both scalar foreign keys and relation objects are included in the generated `Database` types.

## Next Steps

- **[Relations](/docs/collections/relations)** — Define relations between collections
- **[Frontend Overview](/docs/frontend)** — React framework and components
- **[Backend Overview](/docs/backend)** — Server configuration
