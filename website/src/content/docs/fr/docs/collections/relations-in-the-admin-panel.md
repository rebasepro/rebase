---
sourceHash: 8f8ab97f8302c1f8
title: Les relations dans le panneau d'administration
sidebar_label: Les relations dans le panneau d'administration
description: "Comment le CMS affiche les relations d'une table : un sélecteur pour un belongsTo, un onglet sous l'enregistrement pour chaque relation to-many, lignes exclusives vs partagées, les mêmes règles via REST, et les options customizeTable pour les champs de relation."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le CMS lit les [relations](/docs/collections/relations/) d'une table à partir de son
descripteur et affiche chacune d'elles en fonction de sa nature :

| Relation | Dans l'enregistrement |
|---|---|
| `belongsTo` | un sélecteur de la ligne associée, à la place de sa colonne de clé étrangère |
| `hasOne` | un sélecteur de l'unique ligne associée |
| `hasMany`, `manyToMany`, un `via` to-many | un **onglet** listant les lignes associées |
| un `via` qui n'est pas modifiable | en lecture seule |

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const articles = defineTable("articles", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author:       rel.belongsTo(() => users, { notNull: true }),
        tags:         rel.manyToMany(() => tags),
        featuredTags: rel.manyToMany(() => tags, { through: "articles_featured_tags" }),
    },
    rls: "admin-only",
});
```

Le formulaire affiche **Author** sous la forme d'un sélecteur d'utilisateur et aucun champ `authorId` : le
sélecteur modifie cette colonne. Il est obligatoire, car la clé étrangère est
`NOT NULL` sans valeur par défaut. Une clé étrangère faisant partie de la clé primaire de la table
reste un champ distinct à côté du sélecteur. **Tags** et **Featured Tags** sont
des onglets de l'enregistrement.

Une relation dont la cible n'est pas accessible à l'appelant est omise : le CMS ne peut pas
ouvrir une table dont il ne dispose pas. Un `belongsTo` laisse alors sa clé étrangère sous la
forme d'un champ standard, afin que la valeur reste visible et modifiable. Un `belongsTo` dont
l'appelant n'a pas les droits de lecture sur la clé étrangère est également omis.

## Le segment de chemin correspond au nom de la relation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les lignes d'un onglet sont ciblées sous la forme `parent/parentId/relationName` :

```text
/c/authors/a-1/posts            the posts of author a-1
/c/articles/p-1/featuredTags    the featured tags of article p-1
```

Le dernier segment est le **nom de la relation**, la clé dans `relations`, et non
le slug de la cible. C'est ce qui permet à deux relations vers une même table de fonctionner : chacune a
son propre nom, et obtient donc son propre onglet et son propre chemin.

## Lignes exclusives vs lignes partagées

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Ce qu'un onglet vous permet de faire dépend de la manière dont la relation est stockée :

| | Un-à-plusieurs (`hasMany`) | Plusieurs-à-plusieurs (`manyToMany`) |
|---|---|---|
| L'enfant appartient à | ce parent uniquement | chaque parent qui le lie |
| Créer | crée la ligne sous ce parent | crée la ligne et la lie |
| Ajouter un élément existant | — | lie une ligne existante |
| Retirer | **supprime** la ligne | la **délie** ; la ligne reste intacte |

Un onglet many-to-many propose **Add existing** et **Remove from this record**, et
jamais une suppression qui retirerait la ligne des autres parents.

## Les mêmes règles via REST

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un onglet est une requête ordinaire restreinte à un parent, il accepte donc tout ce qu'une
liste racine accepte (filtres, `orderBy`, `limit`, `offset`, `include`) et
`meta.total` compte les lignes filtrées. Filtrez par champ (`?field=op.value`) ou
avec un objet complet `?where={"field":["op","value"]}` :

```text
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Le segment parent est strictement appliqué. Cibler une ligne qui ne se trouve pas sous ce parent
renvoie une erreur `404`, et `PATCH` ne déplace jamais une ligne d'un parent à un autre : définissez
explicitement la clé étrangère si c'est ce que vous souhaitez faire.

Pour une relation many-to-many, `PATCH parent/id/child/childId` correspond à une *appartenance à un ensemble* : cela lie
la ligne si elle n'est pas encore liée, et l'opération est idempotente. C'est ainsi que vous rattachez une ligne
qui existe déjà.

## Ce qui ne devient pas un onglet

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- **Relations to-one** : un `belongsTo` ou un `hasOne` est un champ de l'enregistrement, pas
  une liste. L'écriture via un chemin to-one est rejetée.
- **Une table avec `hideFromEntityViews`** dans son `customizeTable` n'est pas proposée
  sous forme d'onglet sur les enregistrements des tables qui lui sont associées.

## Personnaliser les champs de relation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```tsx
// frontend/src/cms/articles.tsx
import { customizeTable } from "@rebasepro/cms";
import type { articles } from "../../../backend/schema/articles";

export const articlesCms = customizeTable<typeof articles>("articles", {
    fields: {
        author: {
            previewFields: ["displayName", "email"],
            widget: "dialog",
            includeEntityLink: true,
        },
        featuredTags: {
            name: "Featured",
            renderInForm: true,
            overrides: { name: "Featured tags", defaultViewMode: "cards" },
        },
    },
});
```

| Option | Effet |
|---|---|
| `previewFields` | Les champs de la cible affichés dans la pastille (chip) pour une ligne associée. Trois au maximum peuvent y figurer. |
| `widget` | `"select"` sélectionne depuis un menu déroulant, `"dialog"` depuis un tableau avec recherche. |
| `fixedFilter` | Ne propose que les lignes qui correspondent à ce filtre. |
| `includeId` | Affiche l'identifiant (id) de la ligne associée dans les aperçus. |
| `includeEntityLink` | Affiche un lien permettant d'ouvrir la ligne associée. |
| `renderInForm` | Affiche également une relation to-many sous forme de sélecteur dans le formulaire, à côté de son onglet. |
| `overrides` | Comment la cible est présentée dans l'onglet de cette relation : n'importe quelle option de table à l'exception de `fields`. |

`overrides` redéfinit le style de l'onglet, pas les champs de la cible. Ceux-ci
dépendent du `customizeTable` propre à la table cible, et définir `fields`
dans `overrides` lève une erreur.

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Relations](/docs/collections/relations/) : les cinq types, et comment déclarer chacun d'eux
- [customizeTable](/docs/frontend/customize-table/#relations) : les options de relation dans la référence
- [Écrire via REST](/docs/backend/writes/) : création, mise à jour et suppression au-delà d'un onglet
