---
sourceHash: 35d04e650c33c5cb
title: SDK Client
sidebar_label: SDK Client
description: Utilisez le SDK Client Rebase pour interagir avec votre backend depuis n'importe quelle application JavaScript — opérations de données, authentification, stockage et abonnements en temps réel.
---

## Aperçu

Le package `@rebasepro/client` fournit un SDK JavaScript typé pour interagir avec votre backend Rebase. Il gère :

- **Opérations sur les données** — CRUD avec filtrage, tri et pagination
- **Récupération des relations** — Inclure les entités liées avec `.include()`
- **Abonnements en temps réel** — Mises à jour en direct basées sur WebSocket
- **Authentification** — Gestion des jetons, connexion, inscription
- **Stockage** — Téléchargement et envoi de fichiers

## Installation

```bash
pnpm add @rebasepro/client
```

## Configuration

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL
});
```

Le client gère automatiquement les jetons d'authentification — une fois qu'un utilisateur est connecté, toutes les requêtes subséquentes incluent le JWT.

## Opérations sur les données

Accédez à toute collection via `client.data.<collectionName>` (camelCase) ou `client.data.collection<Record<string, unknown>>("slug")` (kebab-case) :

```typescript
// Property-style access (auto-converts to kebab-case)
client.data.blogPosts    // → "blog-posts"
client.data.users        // → "users"

// Dynamic access by slug
client.data.collection("blog-posts")
```

### Rechercher (Liste)

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

### Rechercher par ID

```typescript
const product = await client.data.products.findById(42);
// Entity<M> | undefined
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

## Constructeur de Requêtes Fluide

Chaînez les méthodes pour des requêtes plus expressives :

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Méthodes Disponibles

| Méthode | Description | Exemple |
|--------|-------------|---------|
| `.where(field, op, value)` | Ajoute une condition de filtre | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Trie les résultats | `.orderBy("name", "asc")` |
| `.limit(n)` | Limite le nombre de résultats | `.limit(25)` |
| `.offset(n)` | Saute les N premiers résultats | `.offset(50)` |
| `.search(text)` | Recherche plein texte | `.search("laptop")` |
| `.include(...relations)` | Inclut les entités liées | `.include("author", "tags")` |
| `.find()` | Exécute la requête | Retourne `FindResult<M>` |
| `.listen(onUpdate)` | S'abonne aux mises à jour en temps réel | Retourne `unsubscribe()` |

### Opérateurs de Filtre

| Opérateur | Alias | Description |
|----------|-------|-------------|
| `"=="` | `"eq"` | Égal à |
| `"!="` | `"neq"` | Différent de |
| `">"` | `"gt"` | Supérieur à |
| `">="` | `"gte"` | Supérieur ou égal à |
| `"<"` | `"lt"` | Inférieur à |
| `"<="` | `"lte"` | Inférieur ou égal à |
| `"in"` | | Valeur dans le tableau |
| `"not-in"` | `"nin"` | Valeur non présente dans le tableau |
| `"array-contains"` | `"cs"` | Champ tableau contient la valeur |
| `"array-contains-any"` | `"csa"` | Champ tableau contient l'une des valeurs |

## Récupération des Relations

Les relations peuvent être incluses dans les résultats de requête afin que les entités liées soient retournées avec les données primaires, au lieu de leurs seuls IDs de clé étrangère.

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

### Combinaison avec les Filtres

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lecture des Données de Relation

Lorsque les relations sont incluses, la réponse contient **à la fois** la clé étrangère scalaire et l'objet de relation hydraté :

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

> **Note :** Sans `.include("author")`, seul le champ scalaire `authorId` est retourné. L'objet `author` hydraté sera `undefined`.

### Noms des Relations

Les noms de relation que vous passez à `include()` doivent correspondre au `relationName` défini dans le tableau `relations` de la collection. Par exemple :

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Abonnements en Temps Réel

Abonnez-vous aux changements de collection via WebSocket :

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

Abonnez-vous à une seule entité :

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);
```

Vous pouvez également vous abonner via le constructeur de requêtes fluide :

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

Le client WebSocket gère la reconnexion automatiquement.

## Authentification

```typescript
// Connexion
const session = await client.auth.signIn("user@example.com", "password");

// Inscription
const session = await client.auth.signUp("user@example.com", "password");

// OAuth Google
const session = await client.auth.signInWithGoogle(googleIdToken);

// Rafraîchir le jeton
await client.auth.refreshToken();

// Déconnexion
await client.auth.signOut();

// Obtenir l'utilisateur actuel
const user = client.auth.getUser();
```

## Stockage

```typescript
// Télécharger
const result = await client.storage.uploadFile(file, "products/image.jpg");

// Obtenir l'URL
const url = await client.storage.getDownloadURL("products/image.jpg");

// Supprimer
await client.storage.deleteFile("products/image.jpg");
```

## Points de Terminaison Personnalisés

Appelez les points de terminaison de serveur personnalisés (Fonctions Cloud, routes personnalisées, etc.) :

```typescript
const result = await client.call<{ summary: string }>("functions/generate-summary", {
    articleId: 42
});
```

## Utilisation avec React

Dans un frontend Rebase, le client est typiquement créé une seule fois et partagé via un contexte :

```tsx
const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

// Pass to Rebase provider
<Rebase client={client} ...>
```

Accédez-y depuis n'importe quel composant :

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // Utilisez client.data, client.auth, client.storage
}
```

## Générateur de SDK

Générez un SDK client entièrement typé à partir de vos définitions de collection :

```bash
rebase generate-sdk
```

Cela crée des types TypeScript pour toutes vos entités, vous bénéficiez ainsi de l'autocomplétion et de la vérification de type lors de l'utilisation du client. Les clés étrangères scalaires et les objets de relation sont inclus dans les types `Database` générés.

## Prochaines Étapes

- **[Relations](/docs/collections/relations)** — Définir les relations entre les collections
- **[Aperçu du Frontend](/docs/frontend)** — Framework et composants React
- **[Aperçu du Backend](/docs/backend)** — Configuration du serveur
