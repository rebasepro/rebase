---
sourceHash: 0ca75b0fa4561a93
title: Les relations dans le panneau d'administration
sidebar_label: Les relations dans le panneau d'administration
description: Comment chaque relation vers plusieurs devient un onglet sous un enregistrement — le segment de chemin, lignes possédées ou partagées, les mêmes règles via REST, et ce qui ne devient pas un onglet.
---

Toute relation vers-plusieurs — `hasMany`, `manyToMany` ou un `via`
vers-plusieurs — devient un **onglet** sous un enregistrement du panneau
d'administration, listant les lignes que cet enregistrement atteint.

## Le segment de chemin est le nom de la relation

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

## Lignes possédées et lignes partagées

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

## Les mêmes règles en REST

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

## Ce qui ne devient pas un onglet

- **Les relations vers-un** — elles sont un champ de l'enregistrement, pas une
  liste. Écrire via un chemin vers-un est refusé : la clé étrangère vit sur la
  table du parent.
- **Les relations déclarées dans une `map`** — elles sont un champ de cette map.

## Étapes Suivantes

- **[Relations](/docs/collections/relations/)** — les cinq types, et comment déclarer chacun
- **[Écrire via REST](/docs/backend/writes/)** — créer, mettre à jour et supprimer au-delà d'une liste enfant
