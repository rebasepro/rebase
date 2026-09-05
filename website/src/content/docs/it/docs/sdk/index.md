---
title: SDK Client
sidebar_label: SDK Client
description: Usa l'SDK Client Rebase per interagire con il tuo backend da qualsiasi applicazione JavaScript — operazioni sui dati, autenticazione, archiviazione e sottoscrizioni in tempo reale.
---

## Panoramica

Il pacchetto `@rebasepro/client` fornisce un SDK JavaScript type-safe per interagire con il tuo backend Rebase. Gestisce:

- **Operazioni sui dati** — CRUD con filtraggio, ordinamento e paginazione
- **Recupero relazioni** — Includi entità correlate con `.include()`
- **Sottoscrizioni in tempo reale** — Aggiornamenti live basati su WebSocket
- **Autenticazione** — Gestione token, login, registrazione
- **Archiviazione** — Caricamento e download di file

## Installazione

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

Il client gestisce automaticamente i token di autenticazione — una volta che un utente effettua il login, tutte le richieste successive includono il JWT.

## Operazioni sui Dati

Accedi a qualsiasi collezione tramite `client.data.<collectionName>` (camelCase) o `client.data.collection<Record<string, unknown>>("slug")` (kebab-case):

```typescript
// Property-style access (auto-converts to kebab-case)
client.data.blogPosts    // → "blog-posts"
client.data.users        // → "users"

// Dynamic access by slug
client.data.collection("blog-posts")
```

### Trova (Elenco)

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

### Trova per ID

```typescript
const product = await client.data.products.findById(42);
// Entity<M> | undefined
```

### Crea

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

### Aggiorna

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Elimina

```typescript
await client.data.products.delete(42);
```

## Builder di Query Fluente

Concatenare i metodi per query più espressive:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Metodi Disponibili

| Metodo | Descrizione | Esempio |
|--------|-------------|---------|
| `.where(field, op, value)` | Aggiunge una condizione di filtro | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Ordina i risultati | `.orderBy("name", "asc")` |
| `.limit(n)` | Limita il numero di risultati | `.limit(25)` |
| `.offset(n)` | Salta i primi N risultati | `.offset(50)` |
| `.search(text)` | Ricerca full-text | `.search("laptop")` |
| `.include(...relations)` | Includi entità correlate | `.include("author", "tags")` |
| `.find()` | Esegue la query | Restituisce `FindResult<M>` |
| `.listen(onUpdate)` | Sottoscrivi agli aggiornamenti in tempo reale | Restituisce `unsubscribe()` |

### Operatori di Filtro

| Operatore | Alias | Descrizione |
|----------|-------|-------------|
| `"=="` | `"eq"` | Uguale |
| `"!="` | `"neq"` | Diverso da |
| `">"` | `"gt"` | Maggiore di |
| `">="` | `"gte"` | Maggiore o uguale a |
| `"<"` | `"lt"` | Minore di |
| `"<="` | `"lte"` | Minore o uguale a |
| `"in"` | | Valore nell'array |
| `"not-in"` | `"nin"` | Valore non nell'array |
| `"array-contains"` | `"cs"` | Il campo array contiene il valore |
| `"array-contains-any"` | `"csa"` | Il campo array contiene uno qualsiasi dei valori |

## Recupero delle Relazioni

Le relazioni possono essere incluse nei risultati delle query in modo che le entità correlate vengano restituite insieme ai dati primari, invece dei soli ID della chiave esterna.

### Uso di `include()` (Fluente)

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

### Uso di `find({ include })` (Parametri)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combinazione con i Filtri

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lettura dei Dati di Relazione

Quando le relazioni sono incluse, la risposta contiene **sia** la chiave esterna scalare che l'oggetto relazione idratato:

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

> **Nota:** Senza `.include("author")`, viene restituito solo il campo scalare `authorId`. L'oggetto `author` idratato sarà `undefined`.

### Nomi delle Relazioni

I nomi delle relazioni che passi a `include()` devono corrispondere al `relationName` definito nell'array `relations` della collezione. Ad esempio:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Sottoscrizioni in Tempo Reale

Sottoscrivi ai cambiamenti della collezione tramite WebSocket:

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

Sottoscrivi a una singola entità:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);
```

Puoi anche sottoscrivere tramite il builder di query fluente:

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

Il client WebSocket gestisce automaticamente la riconnessione.

## Autenticazione

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

## Archiviazione

```typescript
// Upload
const result = await client.storage.uploadFile(file, "products/image.jpg");

// Get URL
const url = await client.storage.getDownloadURL("products/image.jpg");

// Delete
await client.storage.deleteFile("products/image.jpg");
```

## Endpoint Personalizzati

Chiama endpoint server personalizzati (Funzioni Cloud, route personalizzate, ecc.):

```typescript
const result = await client.call<{ summary: string }>("functions/generate-summary", {
    articleId: 42
});
```

## Uso con React

In un frontend Rebase, il client viene tipicamente creato una sola volta e condiviso tramite contesto:

```tsx
const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

// Pass to Rebase provider
<Rebase client={client} ...>
```

Accedilo da qualsiasi componente:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // Use client.data, client.auth, client.storage
}
```

## Generatore SDK

Genera un SDK client completamente tipizzato dalle tue definizioni di collezione:

```bash
rebase generate-sdk
```

Questo crea tipi TypeScript per tutte le tue entità, in modo da ottenere l'autocomplete e il controllo dei tipi quando usi il client. Sia le chiavi esterne scalari che gli oggetti relazione sono inclusi nei tipi `Database` generati.

## Prossimi Passi

- **[Relazioni](/docs/collections/relations)** — Definisci relazioni tra collezioni
- **[Panoramica Frontend](/docs/frontend)** — Framework e componenti React
- **[Panoramica Backend](/docs/backend)** — Configurazione del server
---
