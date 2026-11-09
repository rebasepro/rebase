---
sourceHash: 86856f16dce196a2
title: Relations
sidebar_label: Relations
description: Définissez des relations SQL un-à-un, un-à-plusieurs et plusieurs-à-plusieurs entre collections avec des clés étrangères, des tables de jonction et des jointures multi-sauts.
---

## Vue d'ensemble

Les relations définissent la manière dont les collections sont connectées au niveau de la base de données. Elles permettent à Rebase de :

- Afficher des **champs de sélection de relation** dans les formulaires d'entité
- Résoudre les **entités associées** lors de l'affichage des aperçus
- Générer des **contraintes de clé étrangère** dans le schéma Drizzle
- Prendre en charge les comportements de **suppression/mise à jour en cascade**

Les relations peuvent être définies soit en ligne au sein de la propriété, soit explicitement dans le tableau `relations` d'une collection :

### 1. Relations en ligne (recommandé)

Déclarez le lien sur la propriété, imbriqué sous `relation`. Choisissez le `kind` et le type proposera exactement les champs dont ce type a besoin.

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
                target: () => usersCollection
            }
        }
    }
});
```

### 2. Tableau de relations explicites

Pour un lien qui n'a pas de propriété propre — rien pour le nommer dans le formulaire ou dans une colonne de table — déclarez-le dans `relations` :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    properties: {
        name: { type: "string", name: "Name" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection
        }
    ]
});
```

## Les cinq types

Une relation appartient à l'un des cinq types. Le type détermine où réside la clé, si une seule ligne ou plusieurs sont retournées, et ce qu'une écriture à travers elle peut modifier.

| Kind | Emplacement de la clé | Retourne | Notes |
|---|---|---|---|
| `belongsTo` | sur **cette** table | un | `localKey`, valeur par défaut : `<relationName>_id` |
| `hasOne` | sur la table **cible** | un | `foreignKeyOnTarget`, prend par défaut le singulier de cette collection suivi de `_id` (`users` → `user_id`) |
| `hasMany` | sur la table **cible** | plusieurs | les enfants appartiennent uniquement à ce parent |
| `manyToMany` | dans une **table de jonction** | plusieurs | les lignes sont partagées ; vous possédez le lien |
| `via` | un `joinPath` explicite | l'un ou l'autre | modifiable en écriture si saut unique, lecture seule sinon ; définissez vous-même la `cardinality` |

Chaque champ est optionnel à l'exception de `kind` et `target` (ainsi que, pour `via`, `cardinality` et `joinPath`) — le reste est déduit.

### belongsTo — la clé se trouve sur cette table

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

La colonne est indexée automatiquement : Postgres indexe la clé vers laquelle pointe une clé étrangère, jamais la colonne qui la détient. Ainsi, sans index, chaque inclusion `hasMany` et listing imbriqué depuis l'autre côté effectue un scan de cette table. `index: false` conserve la contrainte et supprime l'index — consultez [Les clés étrangères sont indexées pour vous](/docs/backend/indexes#foreign-keys-are-indexed-for-you) pour savoir quand cela est judicieux et quand Rebase l'ignore de lui-même car un autre index couvre déjà la colonne.

### hasMany / hasOne — la clé se trouve sur la leur

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` représente le même lien, avec au plus une ligne de l'autre côté.

#### Jointure sur une clé naturelle

Par défaut, la clé étrangère de la cible contient l'**id** de la ligne source. Lorsque les deux côtés sont joints sur autre chose — un identifiant d'identité externe, un SKU, un slug de tenant — nommez cette colonne avec `sourceKey` :

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // column on THIS table
        foreignKeyOnTarget: "auth_user_id"  // column on the TARGET's table
    }
]
// → reads applications.auth_user_id = talents.auth_user_id
```

`sourceKey` est le pendant de `localKey` sur `belongsTo` : ce dernier nomme la colonne *depuis* laquelle ce côté lit, tandis que `sourceKey` nomme la colonne *vers* laquelle l'autre côté pointe. Sans lui, un lien comme celui ci-dessus ne peut pas du tout s'exprimer sous forme de `hasMany` et doit se rabattre sur [`via`](#via--une-chaîne-de-jointure-explicite), qui est en lecture seule pour une chaîne comme celle-ci.

La colonne doit être unique. Un lien qui cible plus d'une ligne source ne peut pas déterminer à laquelle une ligne liée appartient, et Postgres n'acceptera pas non plus de clé étrangère sur une colonne non unique. Rebase vérifie cela au moment de la lecture et refuse l'opération plutôt que de choisir une ligne au hasard.

Un parent dont la `sourceKey` est `NULL` n'atteint aucune ligne, et écrire à travers la relation génère une erreur — les lignes associées n'ont rien vers quoi pointer.

### manyToMany — via une table de jonction

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Chaque côté déclare sa propre relation, et chacun écrit `through` **de son propre point de vue** — `sourceColumn` désigne toujours *cette* collection :

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — une chaîne de jointure explicite

Pour les liens que les quatre formes ci-dessus ne peuvent pas exprimer : chemins multi-sauts, clés composites ou jointures dont la condition n'est pas une simple clé étrangère.

Une chaîne à **saut unique** est modifiable en écriture lors d'une création ou d'une mise à jour, de la même manière que le type qu'elle remplace :

- une chaîne **to-one** d'**une seule étape** — la ligne cible détient la clé, donc `{ badge: "b-1" }` fait pointer la colonne de cette ligne vers celle-ci, et `null` supprime le lien, tout comme le fait une écriture `hasOne` ;
- une chaîne **to-many** de **deux étapes à travers une table** entre les extrémités — cette table contient les liens, donc `{ tags: ["t-1", "t-2"] }` les définit comme ses lignes, tout comme le fait une écriture `manyToMany` (un `via` ne comporte aucun `_pivot`).

Toute chaîne plus longue est en **lecture seule** : Rebase ne déduira pas comment écrire à travers une chaîne arbitraire. Une création ou une mise à jour en désignant une est rejetée avec l'erreur `400 RELATION_NOT_WRITABLE`, et le formulaire d'administration affiche le champ sans sélecteur. Une écriture imbriquée (`PATCH users/1/permissions/3`) à travers n'importe quel `via` est refusée de la même façon.

```typescript
{
    kind: "via",
    relationName: "permissions",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        { table: "user_roles",       on: { from: "id",            to: "user_id" } },
        { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
        { table: "permissions",      on: { from: "permission_id", to: "id" } }
    ]
}
```

## Propriétés de relation

Pour afficher un champ de relation dans un formulaire, ajoutez une propriété avec `type: "relation"` :

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        // Which control draws it is presentation, so it goes in the admin block:
        // "select" (dropdown) or "dialog" (full picker).
        admin: { widget: "select" }
    }
}
```

Lors de l'affichage d'un aperçu (comme dans une cellule de tableau ou une pastille de référence), Rebase gère l'hydratation automatiquement.

### Les relations to-one obtiennent un sélecteur, les relations to-many un onglet

La cardinalité détermine la surface d'affichage, et une seule surface est utilisée :

- **`belongsTo` / `hasOne`** — une seule ligne, la propriété est donc une clé étrangère modifiée par l'auteur. Elle s'affiche sous forme du sélecteur ci-dessus.
- **`hasMany` / `manyToMany`** — plusieurs lignes, la vue de l'entité les liste donc dans un **onglet** dédié. La propriété n'est pas rendue dans le formulaire : les enfants d'une collection forment une liste et non une valeur que l'enregistrement contient, et les sélectionner depuis un menu déroulant n'est pas une option pertinente à proposer dans le formulaire.

Déclarer une relation « many » en tant que propriété reste utile : c'est ce qui nomme l'onglet et attribue à la relation une colonne dans la table de la collection, que la récupération de la liste hydrate pour que les lignes enfants apparaissent sous forme de pastilles sur la ligne. Seul le champ du formulaire est omis.

Dans la table, une relation dotée de sa propre propriété obtient **une seule** colonne : la sienne. Chaque onglet dispose également d'une colonne de bouton pour basculer vers l'onglet, mais pour une relation déclarée par une propriété, ce bouton répétait le même intitulé à côté d'une colonne affichant déjà les enfants ; il est donc supprimé. Si vous masquez la colonne de la relation (`admin: { hideFromCollection: true }`), le bouton réapparaît, afin que la relation ne disparaisse jamais totalement du tableau.

Masquer la colonne n'arrête pas la récupération des données. La lecture de liste de la collection intègre chaque relation déclarée par une propriété, qu'elle soit masquée ou non. Ainsi, le code qui lit les lignes de la liste — `additionalFields`, résolveurs d'affichage, actions d'entité, actions de collection via `tableController.rows`, emplacements de plugins — y trouve les lignes associées, imbriquées sous le nom de la relation comme le retourne le paramètre `include` de REST, à côté de la colonne de clé étrangère. Un callback `browserCallbacks.afterRead` reçoit la même ligne. Une relation déclarée uniquement dans le tableau `relations` de la collection, sans propriété, n'est pas intégrée dans la liste ; ses lignes se chargent lors de l'ouverture de son onglet.

Si vous souhaitez tout de même le sélecteur intégré, vous pouvez le demander explicitement :

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // off by default; the tab is the default treatment
    }
}
```

## Jointures multi-sauts

Pour les relations qui traversent plusieurs tables, utilisez `kind: "via"` avec un `joinPath`.
Une chaîne de plus d'un maillon est en lecture seule : Rebase ne déduira pas comment écrire à travers une chaîne arbitraire (consultez [via](#via--une-chaîne-de-jointure-explicite) pour les chaînes à un seul saut qu'il prend en charge en écriture).

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
                on: { from: "id", to: "user_id" }
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

### Jointures sur clés composites

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

### Correspondance avec l'une ou l'autre de deux colonnes

Une liste dans `on` effectue une jointure avec une ligne satisfaisant **n'importe laquelle** des conditions — un lien maintenu dans `a` ou `b`. C'est en **lecture seule**.

```typescript
joinPath: [{ table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }]
```

L'ajout d'une deuxième étape vers `people` (`on: [{ from: "a", to: "id" }, { from: "b", to: "id" }]`) correspond également à la propre colonne du parent, de sorte que chaque personne apparaît comme son propre ami : listez les lignes d'amitié ou filtrez la personne.

## Règles de cascade

Contrôlez ce qui se produit lorsque des entités associées sont mises à jour ou supprimées :

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
|--------|--------------|
| `"cascade"` | Propage la modification aux lignes associées |
| `"restrict"` | Empêche l'opération si des lignes associées existent |
| `"no action"` | Identique à restrict (s'en remet à la vérification de la contrainte) |
| `"set null"` | Définit la colonne de la clé étrangère sur NULL |
| `"set default"` | Définit la colonne de la clé étrangère sur sa valeur par défaut |

### Comportement par défaut sans configuration

`onDelete` est optionnel, donc la plupart des relations n'en définissent pas. La valeur par défaut dépend du fait que la relation soit requise ou non :

| Relation | `onDelete` par défaut |
|--------|----------------------|
| `belongsTo`, optionnel | `"set null"` — le pointeur est vidé |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — la suppression du parent échoue |
| `manyToMany` (lignes de jonction) | `"cascade"` — le lien disparaît, la cible reste |

Une relation requise n'est **pas** une cascade. `required` indique qu'un enfant ne peut pas exister sans parent ; cela n'implique pas que supprimer le parent doive détruire l'enfant. Ce sont deux assertions différentes, et une seule d'entre elles supprime des lignes que vous n'avez pas expressément désignées. Par conséquent, le comportement par défaut fait échouer la suppression et indique la contrainte, tandis que `"cascade"` est une option que vous devez demander explicitement :

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // A line item is meaningless without its order — say so.
    onDelete: "cascade"
}
```

`onUpdate` n'a pas de valeur par défaut : si rien n'est défini, Postgres applique `NO ACTION`. Définissez `"cascade"` lorsque la clé de la cible est un élément qu'une personne peut modifier — un slug, un SKU — afin que les pointeurs la suivent.

## Récupérer des relations dans le SDK

Lors de l'interrogation de données via le SDK typé de Rebase, les relations ne sont **pas** incluses par défaut. Utilisez la méthode `include()` pour demander les entités associées en même temps que les données principales.

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

### Utiliser la syntaxe avec paramètres

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Structure de la réponse

Lorsqu'elle est incluse, la réponse contient à la fois la **clé étrangère scalaire** et l'**objet relationnel hydraté** :

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// The SDK returns flat rows — there is no `.values` wrapper. (`Entity`, with
// `id`/`path`/`values`, is an admin-UI view model, not what the client hands back.)
for (const article of data) {
    // Scalar FK — always present
    article.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.author?.name;  // "Jane Doe"
}
```

> Les noms de relations transmis à `include()` doivent correspondre au nom de la relation : le `relationName` d'une entrée dans le tableau `relations` de la collection, ou la clé de la propriété qui la déclare en ligne.

Pour la référence complète du constructeur de requêtes (filtrage, tri, pagination, temps réel), consultez la [documentation du SDK typé](/docs/sdk).

## Relations dans le panneau d'administration

Chaque relation to-many (`hasMany`, `manyToMany` ou un `via` to-many) devient un onglet sous un enregistrement dans le panneau d'administration, accessible via le nom de la relation. [Relations dans le panneau d'administration](/docs/collections/relations-in-the-admin-panel/) détaille les chemins, ce qu'un onglet crée, lie, délie ou supprime, les mêmes règles via REST, ainsi que ce qui ne devient pas un onglet.

## Interface complète de Relation

`Relation` est une union fermée — un membre par `kind`, chacun ne comportant que les champs que ce type possède. Il n'existe aucune combinaison de champs décrivant deux liens différents, et aucun champ que vous puissiez définir que le type n'utilise pas.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // defaults to the property key, then the target's slug
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // applied when rendered as a tab
}
// `required` is not here. It is `validation: { required: true }` on the
// property that declares the relation, the same key every other field uses.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
    index?: boolean;                // btree on localKey; defaults to true
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;
        targetColumn?: string;
        properties?: Properties;    // extra columns on the junction row, served under `_pivot`
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### La forme résolue

Ce que vous écrivez ci-dessus est la forme *d'édition*. En interne, Rebase fonctionne avec `ResolvedRelation` : le même lien avec toutes les valeurs par défaut renseignées et rien d'optionnel, en plus de `cardinality`, `targetSlug` et deux indicateurs — `writable` (faux uniquement pour un `via` multi-sauts ou avec une étape correspondant à l'une de plusieurs conditions) et `shared` (vrai lorsque les lignes cibles appartiennent également à d'autres parents, de sorte qu'une suppression délie au lieu de supprimer).

`sourceKey` est la seule exception au principe de « rien d'optionnel » : sa valeur par défaut est la clé primaire de la source, et sa résolution nécessite le schéma du pilote, auquel la résolution n'a pas accès. `undefined` signifie ici « la clé primaire » et rien d'autre.

Vous n'écrivez jamais de `ResolvedRelation`. Sur une propriété de relation, `relation` est la vôtre et `resolvedRelation` est celle complétée, générée lors de la normalisation.

## Prochaines étapes

- **[Règles de sécurité](/docs/collections/security-rules)** — Row Level Security
- **[Propriétés](/docs/collections/properties)** — Référence des types de propriétés
