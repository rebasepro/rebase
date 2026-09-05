---
title: Interrogare i dati
sidebar_label: Interrogare i dati
description: Operazioni CRUD, query builder fluido, operatori di filtro, paginazione, ordinamento e caricamento delle relazioni con l'SDK Client di Rebase.
---

## Accesso alle collezioni

Accedi a qualsiasi collezione tramite `client.data.<collectionName>` (camelCase, convertito automaticamente in snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug esplicito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modalità strict (SDK generato):** Quando passi il `collectionsDictionary` generato a `createRebaseClient`, il proxy dei dati convalida gli accessi alle proprietà al momento dell'accesso. Un errore di battitura come `client.data.prodcuts` genererà immediatamente un errore con un messaggio utile e un suggerimento sulla corrispondenza più vicina, invece di produrre un confuso 404 in seguito. Usa `client.data.collection<Record<string, unknown>>("slug")` per ignorare la convalida con slug dinamici o determinati a runtime.

## Operazioni CRUD

### Find (Elenca)

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

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Trova per ID

```typescript
const product = await client.data.products.findById(42);
// Returns Entity<M> | undefined
```

### Creare

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

### Aggiornare

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Eliminare

```typescript
await client.data.products.delete(42);
```

### Contare

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Query Builder fluido

Concatena i metodi per query più espressive:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Metodi disponibili

| Metodo | Descrizione | Esempio |
|--------|-------------|---------|
| `.where(field, op, value)` | Aggiunge una condizione di filtro | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Ordina i risultati | `.orderBy("name", "asc")` |
| `.limit(n)` | Limita il numero di risultati | `.limit(25)` |
| `.offset(n)` | Salta i primi N risultati | `.offset(50)` |
| `.search(text)` | Ricerca full-text | `.search("laptop")` |
| `.include(...relations)` | Include le entità correlate | `.include("author", "tags")` |
| `.find()` | Esegue la query | Restituisce `FindResult<M>` |
| `.listen(onUpdate, onError?)` | Si iscrive agli aggiornamenti in tempo reale | Restituisce `unsubscribe()` |

### Operatori di filtro

| Operatore | Alias | Descrizione |
|----------|-------|-------------|
| `"=="` | `"eq"` | Uguale |
| `"!="` | `"neq"` | Diverso |
| `">"` | `"gt"` | Maggiore di |
| `">="` | `"gte"` | Maggiore o uguale a |
| `"<"` | `"lt"` | Minore di |
| `"<="` | `"lte"` | Minore o uguale a |
| `"in"` | | Valore in un array |
| `"not-in"` | `"nin"` | Valore non in un array |
| `"array-contains"` | `"cs"` | Il campo array contiene il valore |
| `"array-contains-any"` | `"csa"` | Il campo array contiene uno dei valori |

### Sintassi della clausola Where

Il parametro `where` di `find()` supporta due formati:

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

> **Nota:** Le stringhe PostgREST pre-serializzate (formato 2) sono una via di fuga per passare valori di filtro già in formato wire. Preferisci la sintassi a tuple per la sicurezza dei tipi e la leggibilità.

## Paginazione

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

`limit` deve essere un numero intero compreso tra 1 e 1000. Un valore maggiore —
o uno zero, un negativo o un frazionario — viene rifiutato con un 400
`INVALID_LIMIT` anziché ridotto, perché una pagina silenziosamente più piccola
non si distingue dall'ultima. Per leggere oltre questo tetto, percorri le pagine
con `iterate()` o `findAll()`.

## Ordinamento

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

## Ricerca full-text

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

## Caricamento delle relazioni

Le relazioni possono essere incluse in modo che le entità correlate vengano restituite insieme ai dati principali, invece dei soli ID di chiave esterna.

### Uso di `include()` (Fluido)

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

### Combinazione con i filtri

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lettura dei dati delle relazioni

Quando le relazioni sono incluse, la risposta contiene **sia** la chiave esterna scalare sia l'oggetto relazione idratato:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Senza `.include("author")`, viene restituito solo il campo scalare `authorId`. L'oggetto `author` idratato sarà `undefined`.

### Nomi delle relazioni

I nomi di relazione che passi a `include()` devono corrispondere al `relationName` definito nell'array `relations` della collezione:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Endpoint personalizzati

Chiama endpoint server personalizzati registrati tramite il sistema di funzioni:

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

## Prossimi passi

- **[Autenticazione](/docs/sdk/authentication)** — Accesso, registrazione, OAuth, sessioni
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in diretta con i WebSocket
- **[Archiviazione e file](/docs/sdk/storage)** — Caricare, scaricare e gestire i file
- **[Relazioni](/docs/collections/relations)** — Definire relazioni tra collezioni
