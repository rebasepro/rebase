---
title: Interroger les données
sidebar_label: Interroger les données
description: Opérations CRUD, constructeur de requêtes fluide, opérateurs de filtre, pagination, tri et chargement des relations avec le SDK Client de Rebase.
---

## Accéder aux collections

Accédez à n'importe quelle collection via `client.data.<collectionName>` (camelCase, converti automatiquement en snake_case) ou `client.data.collection<Record<string, unknown>>("slug")` (slug explicite) :

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Mode strict (SDK généré) :** Lorsque vous passez le `collectionsDictionary` généré à `createRebaseClient`, le proxy de données valide les accès aux propriétés au moment de l'accès. Une faute de frappe comme `client.data.prodcuts` lèvera immédiatement une erreur avec un message utile et une suggestion de correspondance la plus proche, au lieu de produire un 404 déroutant plus tard. Utilisez `client.data.collection<Record<string, unknown>>("slug")` pour contourner la validation avec des slugs dynamiques ou déterminés à l'exécution.

## Opérations CRUD

### Find (Lister)

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

### Rechercher par ID

```typescript
const product = await client.data.products.findById(42);
// Returns Entity<M> | undefined
```

### Créer

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

### Mettre à jour

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Supprimer

```typescript
await client.data.products.delete(42);
```

### Compter

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructeur de requêtes fluide

Enchaînez les méthodes pour des requêtes plus expressives :

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("created_at", "desc")
    .limit(10)
    .find();
```

### Méthodes disponibles

| Méthode | Description | Exemple |
|--------|-------------|---------|
| `.where(field, op, value)` | Ajoute une condition de filtre | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Trie les résultats | `.orderBy("name", "asc")` |
| `.limit(n)` | Limite le nombre de résultats | `.limit(25)` |
| `.offset(n)` | Ignore les N premiers résultats | `.offset(50)` |
| `.search(text)` | Recherche en texte intégral | `.search("laptop")` |
| `.include(...relations)` | Inclut les entités liées | `.include("author", "tags")` |
| `.find()` | Exécute la requête | Renvoie `FindResponse<M>` |
| `.listen(onUpdate, onError?)` | S'abonne aux mises à jour en temps réel | Renvoie `unsubscribe()` |

### Opérateurs de filtre

| Opérateur | Alias | Description |
|----------|-------|-------------|
| `"=="` | `"eq"` | Égal |
| `"!="` | `"neq"` | Différent |
| `">"` | `"gt"` | Supérieur à |
| `">="` | `"gte"` | Supérieur ou égal à |
| `"<"` | `"lt"` | Inférieur à |
| `"<="` | `"lte"` | Inférieur ou égal à |
| `"in"` | | Valeur dans un tableau |
| `"not-in"` | `"nin"` | Valeur absente d'un tableau |
| `"array-contains"` | `"cs"` | Le champ tableau contient la valeur |
| `"array-contains-any"` | `"csa"` | Le champ tableau contient l'une des valeurs |

### Syntaxes de la clause Where

Le paramètre `where` de `find()` prend en charge deux formats :

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

> **Remarque :** Les chaînes PostgREST présérialisées (format 2) sont une échappatoire pour transmettre des valeurs de filtre déjà au format de transmission. Préférez la syntaxe de tuples pour la sûreté du typage et la lisibilité.

## Pagination

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

`limit` doit être un entier compris entre 1 et 1000. Une valeur supérieure — ou
nulle, négative ou fractionnaire — est refusée par un 400 `INVALID_LIMIT` plutôt
que ramenée au plafond, car une page silencieusement plus petite ne se distingue
pas de la dernière. Pour lire au-delà de ce plafond, parcourez les pages avec
`iterate()` ou `findAll()`.

## Tri

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

## Recherche en texte intégral

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

## Chargement des relations

Les relations peuvent être incluses afin que les entités liées soient renvoyées avec les données principales, au lieu de leurs seuls ID de clé étrangère.

### Utilisation de `include()` (Fluide)

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

### Utilisation de `find({ include })` (Paramètres)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combinaison avec des filtres

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("published_at", "desc")
    .limit(10)
    .find();
```

### Lire les données des relations

Lorsque des relations sont incluses, la réponse contient **à la fois** la clé étrangère scalaire et l'objet de relation hydraté :

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

> **Remarque :** Sans `.include("author")`, seul le champ scalaire `author_id` est renvoyé. L'objet `author` hydraté sera `undefined`.

### Noms des relations

Les noms de relation que vous passez à `include()` doivent correspondre au `relationName` défini dans le tableau `relations` de la collection :

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Endpoints personnalisés

Appelez des endpoints serveur personnalisés enregistrés via le système de fonctions :

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

## Étapes suivantes

- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct avec WebSockets
- **[Stockage et fichiers](/docs/sdk/storage)** — Téléverser, télécharger et gérer des fichiers
- **[Relations](/docs/collections/relations)** — Définir des relations entre collections
