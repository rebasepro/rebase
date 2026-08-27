---
title: Relations
sidebar_label: Relations
description: Définir les relations SQL un-à-un, un-à-plusieurs et plusieurs-à-plusieurs entre les collections avec des clés étrangères, des tables de jonction et des jointures multi-sauts.
---

## Aperçu

Les relations définissent comment les collections sont connectées au niveau de la base de données. Elles permettent à Rebase de :

- Rendre les **champs de sélection de relation** dans les formulaires d'entité
- Résoudre les **entités liées** lors de l'affichage des aperçus
- Générer les **contraintes de clé étrangère** dans le schéma Drizzle
- Supporter les comportements de **suppression/mise à jour en cascade**

Les relations peuvent être définies soit en ligne dans la propriété, soit explicitement dans le tableau `relations` d'une collection :

### 1. Relations en Ligne (Recommandé)

Vous pouvez définir la relation directement sur la propriété. Le framework extrait automatiquement celles-ci dans le tableau `relations[]` de la collection au moment de la normalisation, de sorte que vous n'avez plus besoin d'une entrée `relations[]` distincte pour les propriétés.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => usersCollection,
                localKey: "author_id"
            }
        }
    }
});
```

### 2. Tableau de Relations Explicite

Pour les cas d'utilisation avancés ou lorsqu'une relation ne correspond pas directement à un champ de formulaire, vous pouvez la définir dans le tableau `relations` :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: { type: "relation", name: "Author", relationName: "author" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => usersCollection,
            localKey: "author_id"
        }
    ]
});
```

## Types de Relations

### Un-à-Un / Plusieurs-à-Un

Une clé étrangère sur **cette** table pointe vers la clé primaire d'une autre table.

```typescript
relations: [
    {
        kind: "belongsTo",           // The FK is on THIS table
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id"        // Column on the posts table
    }
]
```

Ceci crée : `posts.authorId → users.id`

### Un-à-Plusieurs (Inverse)

La clé étrangère se trouve sur la table **cible**, pointant vers cette entité.

```typescript
// On the Users collection:
relations: [
    {
        kind: "hasMany",                 // The FK is on the TARGET table
        relationName: "posts",
        target: () => postsCollection,
        foreignKeyOnTarget: "authorId"  // Column on the posts table
    }
]
```

### Plusieurs-à-Plusieurs (Table de Jonction)

Deux collections connectées via une table de jonction intermédiaire.

```typescript
// On the Users collection:
relations: [
    {
        kind: "manyToMany",
        relationName: "roles",
        target: () => rolesCollection,
        through: {
            table: "user_roles",         // Junction table name
            sourceColumn: "userId",     // FK to this collection
            targetColumn: "role_id"      // FK to target collection
        }
    }
]
```

Ceci crée :
```sql
CREATE TABLE user_roles (
    userId INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (userId, role_id)
);
```

## Propriétés de Relation

Pour afficher un champ de relation dans un formulaire, ajoutez une propriété avec `type: "relation"` :

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        target: () => usersCollection, // Target collection
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

![Champ de relation dans le formulaire](/img/features/relation-form-field.png)

Lors de l'affichage d'un aperçu (comme dans une cellule de tableau ou une puce de référence), Rebase gère automatiquement l'hydratation :

![Aperçu de la relation dans le tableau](/img/features/relation-table-preview.png)

## Jointures Multi-Sauts

Pour les relations complexes qui traversent plusieurs tables, utilisez `joinPath` :

```typescript
// Users → Permissions through Roles
relations: [
    {
        kind: "via",
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "userId" }
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }
            }
        ]
    }
]
```

### Jointures de Clés Composites

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Multiple columns
            to: ["code", "region_id"]
        }
    }
]
```

## Règles de Cascade

Contrôlez ce qui se passe lorsque les entités liées sont mises à jour ou supprimées :

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Delete posts when user is deleted
        onUpdate: "cascade"     // Update FK when user ID changes
    }
]
```

| Action | Comportement |
|--------|----------|
| `"cascade"` | Propager le changement aux lignes liées |
| `"restrict"` | Empêcher l'opération si des lignes liées existent |
| `"no action"` | Idem restrict (reporter à la vérification de contrainte) |
| `"set null"` | Définir la colonne de clé étrangère à NULL |
| `"set default"` | Définir la colonne de clé étrangère à sa valeur par défaut |

## Récupération des Relations dans le SDK

Lors de l'interrogation de données via le SDK client Rebase, les relations ne sont **pas** incluses par défaut. Utilisez la méthode `include()` pour demander les entités liées en même temps que les données primaires.

### Inclure des relations spécifiques

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Inclure toutes les relations

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Utilisation de la syntaxe des paramètres

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Structure de la réponse

Lorsqu'elles sont incluses, la réponse contient à la fois la **clé étrangère scalaire** et l'**objet de relation hydraté** :

```typescript
const { data } = await client.data.articles
    .include("author")
    .find();

for (const article of data) {
    // Scalar FK — always present
    article.values.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> Les noms de relation passés à `include()` doivent correspondre au `relationName` défini dans le tableau `relations` de la collection.

Pour la référence complète du constructeur de requêtes (filtrage, tri, pagination, temps réel), consultez la [documentation du SDK client](/docs/sdk).

## Interface de Relation Complète

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

// Every kind carries these:
interface RelationBase {
    relationName?: string;
    target: () => CollectionConfig;
    inverseRelationName?: string;
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<CollectionConfig>;
    validation?: { required?: boolean };
}

// ...and only the fields its own kind uses:
interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;      // FK naming THIS collection
        targetColumn?: string;
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];           // read-only
}
```

## Étapes Suivantes

- **[Règles de Sécurité](/docs/collections/security-rules)** — Sécurité au Niveau des Lignes
- **[Propriétés](/docs/collections/properties)** — Référence des types de propriétés
