---
sourceHash: b8fb2609d1a27893
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

Déclarez le lien sur la propriété, imbriqué sous `relation`. Choisissez le
`kind` et le type propose exactement les champs dont ce kind a besoin.

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

### 2. Tableau de Relations Explicite

Pour un lien sans propriété propre — rien pour le nommer dans le formulaire ni
dans une colonne de tableau — déclarez-le dans `relations` :

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

## Les cinq kinds

Une relation est d'un des cinq kinds. Le kind décide où vit la clé, si une ligne
ou plusieurs reviennent, et ce qu'une écriture au travers peut toucher.

| Kind | La clé vit | Renvoie | Notes |
|---|---|---|---|
| `belongsTo` | sur **cette** table | une | `localKey`, par défaut `<relationName>_id` |
| `hasOne` | sur la table de la **cible** | une | `foreignKeyOnTarget`, par défaut `<thisCollection>_id` |
| `hasMany` | sur la table de la **cible** | plusieurs | les enfants appartiennent à ce seul parent |
| `manyToMany` | dans une **table de jonction** | plusieurs | les lignes sont partagées ; le lien vous appartient |
| `via` | un `joinPath` explicite | l'un ou l'autre | lecture seule ; indiquez vous-même la `cardinality` |

Tous les champs sont optionnels sauf `kind` et `target` — le reste est déduit.

### belongsTo — la clé est sur cette table

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

### hasMany / hasOne — la clé est sur la leur

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` est le même lien avec au plus une ligne de l'autre côté.

#### Joindre sur une clé naturelle

Par défaut, la clé étrangère de la cible contient l'**id** de la ligne source.
Quand les deux côtés sont joints sur autre chose — un id d'identité externe, une
référence produit, un slug de locataire — nommez cette colonne avec
`sourceKey` :

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

`sourceKey` est le miroir de `localKey` sur `belongsTo` : celui-là nomme la
colonne que ce côté lit, celui-ci nomme la colonne que l'autre côté vise. Sans
lui, un lien comme celui ci-dessus n'est pas exprimable en `hasMany` du tout et
doit retomber sur [`via`](#via--une-chaîne-de-jointures-explicite), qui est en
lecture seule.

La colonne doit être unique. Un lien qui adresse plus d'une ligne source ne peut
pas dire à laquelle une ligne liée appartient, et Postgres n'accepte pas
davantage une clé étrangère vers une colonne non unique. Rebase le vérifie à la
lecture et refuse plutôt que d'en choisir une.

Un parent dont le `sourceKey` est `NULL` n'atteint aucune ligne, et écrire au
travers de la relation est une erreur — il n'y a rien vers quoi les lignes liées
pourraient pointer.

### manyToMany — par une table de jonction

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Les deux côtés déclarent la leur, et chacun écrit `through` **de son propre
point de vue** — `sourceColumn` nomme toujours *cette* collection :

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — une chaîne de jointures explicite

Pour les liens que les quatre formes ci-dessus ne peuvent pas exprimer : chemins
multi-sauts, clés composites, ou une jointure dont la condition n'est pas une
simple clé étrangère. En lecture seule — Rebase ne déduira pas comment écrire au
travers d'une chaîne arbitraire.

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

## Propriétés de Relation

Pour afficher un champ de relation dans un formulaire, ajoutez une propriété avec `type: "relation"` :

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

Lors de l'affichage d'un aperçu (comme dans une cellule de tableau ou une puce de référence), Rebase gère automatiquement l'hydratation.

### Le vers-un obtient un sélecteur, le multiple un onglet

La cardinalité décide de la surface, et une seule est utilisée :

- **`belongsTo` / `hasOne`** — une ligne : la propriété est donc une clé
  étrangère que l'auteur modifie. Elle s'affiche comme le sélecteur ci-dessus.
- **`hasMany` / `manyToMany`** — plusieurs lignes : la vue d'entité les liste
  donc dans un **onglet** à part. La propriété n'est pas rendue dans le
  formulaire : les enfants d'une collection sont une liste, pas une valeur que
  l'enregistrement détient, et les choisir dans un menu déroulant n'est pas
  quelque chose que le formulaire puisse offrir de façon sensée.

Déclarer une relation vers-plusieurs comme propriété reste utile : c'est elle qui
nomme l'onglet, et qui donne à la relation une colonne dans le tableau de la
collection, que le chargement de la liste hydrate pour que les lignes enfants
apparaissent en puces sur la ligne. Seul le champ de formulaire est abandonné.

Dans le tableau, une relation dotée de sa propre propriété obtient **une**
colonne : la sienne. Chaque onglet a aussi une colonne avec un bouton de saut
vers l'onglet, mais pour une relation déclarée par propriété ce bouton répétait
le même intitulé à côté d'une colonne montrant déjà les enfants : il est donc
supprimé. Masquez la colonne de la relation
(`admin: { hideFromCollection: true }`) et le bouton revient, de sorte que la
relation ne disparaît jamais entièrement du tableau.

Si vous voulez quand même le sélecteur en ligne, demandez-le :

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

## Jointures Multi-Sauts

Pour les relations qui traversent plusieurs tables, utilisez `kind: "via"` avec
un `joinPath`. Elles sont en lecture seule : Rebase ne déduira pas comment
écrire au travers d'une chaîne arbitraire.

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

### Ce que vous obtenez si vous ne dites rien

<span class="since-badge" data-since="0.18">Since 0.18</span>

La valeur par défaut d'un `belongsTo` **obligatoire** a changé. En 0.17.3 c'est
`ON DELETE CASCADE` — supprimer un parent supprime ses enfants — et à partir de
0.18 c'est `RESTRICT` : la suppression échoue et nomme la contrainte. Le reste de
cette section est inchangé, et `db push` planifie la réécriture de la contrainte
lors de la mise à niveau.

`onDelete` est optionnel, donc la plupart des relations n'en nomment jamais. La
valeur par défaut dépend du caractère obligatoire de la relation :

| Relation | `onDelete` par défaut |
|--------|----------|
| `belongsTo`, optionnelle | `"set null"` — le pointeur est vidé |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — la suppression du parent échoue |
| `manyToMany` (lignes de jonction) | `"cascade"` — le lien part, la ligne cible reste |

Une relation obligatoire n'est **pas** une cascade. `required` dit qu'un enfant
ne peut pas exister sans parent ; il ne dit pas que supprimer le parent doit
détruire l'enfant. Ce sont deux affirmations différentes, et une seule supprime
des lignes que vous n'avez pas nommées. La valeur par défaut fait donc échouer la
suppression et nomme la contrainte, et `"cascade"` est quelque chose que vous
demandez explicitement :

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // Une ligne de commande n'a aucun sens sans sa commande — dites-le.
    onDelete: "cascade"
}
```

`onUpdate` n'a pas de valeur par défaut : sans rien de défini, Postgres applique
`NO ACTION`. Mettez `"cascade"` quand la clé de la cible est modifiable par une
personne — un slug, une référence produit — pour que les pointeurs la suivent.

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

> Les noms de relation passés à `include()` doivent correspondre au `relationName` défini dans le tableau `relations` de la collection.

Pour la référence complète du constructeur de requêtes (filtrage, tri, pagination, temps réel), consultez la [documentation du SDK client](/docs/sdk).

## Les relations dans le panneau d'administration

Toute relation vers-plusieurs — `hasMany`, `manyToMany` ou un `via`
vers-plusieurs — devient un **onglet** sous un enregistrement du panneau
d'administration, listant les lignes que cet enregistrement atteint.

### Le segment de chemin est le nom de la relation

Une liste d'enfants s'adresse comme `parent/parentId/relationName` :

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

Le dernier segment est le **nom de la relation**, pas le slug de la collection
cible. Ils sont souvent identiques, parce qu'une relation sans nom prend le slug
de sa cible — mais une propriété de relation en ligne prend la *clé de la
propriété* :

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

C'est aussi ce qui fait fonctionner deux relations vers la même collection :
chacune a son propre nom, donc son propre onglet et son propre chemin.

### Lignes possédées et lignes partagées

Ce qu'un onglet vous permet de faire dépend de la façon dont la relation est
stockée, car les deux cas ne veulent pas dire la même chose :

| | Un-à-plusieurs (`foreignKeyOnTarget`) | Plusieurs-à-plusieurs (`through`) |
|---|---|---|
| L'enfant appartient à | ce seul parent | chaque parent qui le lie |
| Créer | crée la ligne sous ce parent | crée la ligne et la lie |
| Ajouter un existant | — | lie une ligne existante |
| Retirer | **supprime** la ligne | **délie** ; la ligne reste intacte |

Le panneau d'administration rend chaque cas en conséquence : un onglet
plusieurs-à-plusieurs propose **Ajouter un existant** et **Retirer de cet
enregistrement**, et jamais une suppression qui enlèverait la ligne aux autres
parents.

### Les mêmes règles en REST

Les listes d'enfants sont des requêtes de collection ordinaires restreintes à un
parent : elles acceptent donc tout ce qu'accepte une liste racine — filtres,
`orderBy`, `limit`, `offset`, `include` — et `meta.total` compte les lignes
filtrées. Filtrez soit par champ (`?field=op.value`), soit avec un objet complet
`?where={"field":["op","value"]}` ; les deux atteignent la même requête :

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Le segment parent est imposé, pas décoratif. Adresser une ligne qui n'est pas
sous ce parent renvoie `404`, et `PATCH` ne déplace jamais une ligne d'un parent
à un autre — définissez explicitement la clé étrangère si c'est ce que vous
voulez.

Pour un plusieurs-à-plusieurs, `PATCH parent/id/child/childId` est une
*appartenance d'ensemble* : il lie la ligne si elle ne l'est pas encore, et il
est idempotent. C'est ainsi que l'on rattache une ligne déjà existante.

### Ce qui ne devient pas un onglet

- **Les relations vers-un** — elles sont un champ de l'enregistrement, pas une
  liste. Écrire via un chemin vers-un est refusé : la clé étrangère vit sur la
  table du parent.
- **Les relations déclarées dans une `map`** — elles sont un champ de cette map.

## Interface de Relation Complète

`Relation` est une union fermée — un membre par kind, chacun ne portant que les
champs que ce kind possède. Il n'existe aucune combinaison de champs décrivant
deux liens différents, ni aucun champ que vous puissiez définir et que le kind
n'utilise pas.

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
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### La forme résolue

Ce que vous écrivez ci-dessus est la forme *d'écriture*. En interne, Rebase
travaille avec `ResolvedRelation` : le même lien avec toutes les valeurs par
défaut remplies et rien d'optionnel, plus `cardinality`, `targetSlug` et deux
drapeaux — `writable` (faux uniquement pour `via`) et `shared` (vrai lorsque les
lignes cibles appartiennent aussi à d'autres parents, un retrait déliant alors
au lieu de supprimer).

`sourceKey` est la seule exception à « rien d'optionnel » : sa valeur par défaut
est la clé primaire de la source, et la résoudre demande le schéma du pilote, que
la résolution n'a pas. `undefined` y signifie « la clé primaire » et rien
d'autre.

Vous n'écrivez jamais de `ResolvedRelation`. Sur une propriété de relation,
`relation` est la vôtre et `resolvedRelation` est celle qui a été remplie,
estampillée pendant la normalisation.

## Étapes Suivantes

- **[Règles de Sécurité](/docs/collections/security-rules)** — Sécurité au Niveau des Lignes
- **[Propriétés](/docs/collections/properties)** — Référence des types de propriétés
