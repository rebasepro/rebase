---
sourceHash: f4fe63c58f66c539
title: Filtrage dans l'API REST
sidebar_label: Filtrage
description: Filtrez les listes de l'API REST avec des opérateurs de style PostgREST, des groupes or/and et le dialecte JSON where, et voyez comment les filtres se combinent.
---

Utilisez des paramètres de requête de style PostgREST pour filtrer les résultats. Le format est `?field=operator.value` :

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)
```

## Opérateurs de filtrage

| Opérateur | Signification | Exemple |
|----------|---------|---------|
| `eq` | Égal à (`==`) | `?active=eq.true` |
| `neq` | Non égal à (`!=`) | `?status=neq.draft` |
| `gt` | Supérieur à (`>`) | `?price=gt.100` |
| `gte` | Supérieur ou égal à (`>=`) | `?price=gte.100` |
| `lt` | Inférieur à (`<`) | `?price=lt.50` |
| `lte` | Inférieur ou égal à (`<=`) | `?price=lte.50` |
| `in` | Présent dans le tableau | `?status=in.(a,b,c)` |
| `nin` | Absent du tableau | `?status=nin.(a,b)` |
| `cs` | Le tableau contient | `?tags=cs.value` |
| `csa` | Le tableau contient l'un des éléments | `?tags=csa.(a,b)` |
| `like` | Correspondance de motif, sensible à la casse (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondance de motif, insensible à la casse (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Ne correspond pas au motif (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Ne correspond pas au motif, insensible à la casse (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonne est `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonne n'est pas `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Les quatre opérateurs de motif comparent du texte. Une colonne enum se compare par sa valeur
(`?status=like.draft%25`) ; sur un nombre, une date ou toute autre colonne qui n'est pas du
texte, ils renvoient une erreur 400 `INVALID_FILTER_OPERATOR`.

`isnull` et `notnull` ne prennent aucun opérande — l'opérateur constitue toute la condition, et `.null`, `.true`, `.false` ou rien après le point signifient tous la même chose. Le SDK écrit `.null`, c'est donc la syntaxe que vous verrez passer sur le réseau. Tout le reste après le point n'est pas un opérande qu'ils possèdent, la chaîne entière est donc lue comme une valeur : `?reason=notnull.reason` correspond au texte `notnull.reason`.

:::caution[`eq.null` est la chaîne de quatre caractères, pas `IS NULL`]
`?deleted_at=eq.null` recherche le texte littéral `null`. En SQL, `= NULL` n'est jamais vrai, il n'existe donc aucune interprétation d'`eq.null` qui puisse correspondre au test de nullité — utilisez `isnull` pour cela. C'est exactement pour cette raison que le SDK sérialise `.where("deleted_at", "==", null)` sous la forme `isnull.null`.
:::

## Opérateurs logiques

Utilisez `or`, `and` et `not` pour les conditions complexes :

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` inverse la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a,b)` à `NOT (a AND b)`. Il compile vers un véritable `NOT (...)` SQL plutôt que vers des opérateurs inversés — la logique SQL étant trivaluée, `NOT (a AND b)` et `(NOT a) OR (NOT b)` cessent de concorder dès qu'un NULL entre en jeu. Une négation **inclut donc les lignes dont la colonne est NULL**, ce qui correspond au comportement de `NOT` ; ajoutez un `notnull` avec un AND si ce n'est pas ce que vous souhaitez.

**Un seul groupe par requête : `or` l'emporte sur `and`, et les deux sur `not`.** Il s'agit de trois manières d'écrire le même emplacement, pas de trois filtres distincts. Imbriquez-les plutôt :

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Les groupes peuvent être imbriqués jusqu'à 32 niveaux de profondeur ; au-delà, la requête est rejetée avec `INVALID_LOGICAL_GROUP`.

Une condition à l'intérieur d'un groupe dont l'opérateur n'existe pas dans le dialecte —
`?not=(title.contains.x)` — renvoie une erreur 400 `UNKNOWN_FILTER_OPERATOR`, comme dans un `where`
JSON. Elle n'est pas lue comme une égalité sur `contains.x`, ce qui, dans un `not`, aurait
correspondu à toutes les lignes.

Un groupe vient **restreindre** les filtres de champ plutôt que de les remplacer — voir [Comment les filtres se combinent](#comment-les-filtres-se-combinent).

## Le dialecte JSON `where`

Les filtres de champ ci-dessus sont l'une des deux manières d'envoyer un filtre. L'autre consiste à utiliser un objet JSON unique, ce que le document OpenAPI publie sur chaque `GET /api/data/{slug}` et ce qu'acceptent les routes de sous-collections imbriquées :

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Chaque clé est un champ, chaque valeur est un tuple canonique `[opérateur, valeur]` — les mêmes tuples que le SDK produit. Une valeur peut également être une chaîne avec point pré-sérialisée (`{"status":"eq.active"}`) ou un scalaire brut (`{"status":"active"}`) ; tous les trois compilent vers la même condition. Un tableau de valeurs simples est un `in` implicite : `{"category":["electronics","gadgets"]}` se lit comme
`["in", ["electronics","gadgets"]]`, tandis qu'un premier élément en forme d'opérateur mais qui n'est pas un véritable
opérateur (`["!!","x"]`) donne une 400 `UNKNOWN_FILTER_OPERATOR`.

Le même objet est lu de la même façon où qu'il arrive : ici, dans le `where` du SDK, dans une requête MCP, et dans le
`filter` du socket temps réel — ses requêtes de liste et de comptage et ses abonnements en direct.

La différence notable : **le JSON transporte les types.** `?price=gte.100` envoie la chaîne `"100"` et le pilote la convertit selon le type de la colonne, tandis que `?where={"price":[">=",100]}` envoie un nombre. Pour une colonne dont les interprétations textuelles et numériques diffèrent — une chaîne de version, un code préfixé de zéros — c'est le paramètre à privilégier.

Un `where` malformé renvoie une erreur 400 `INVALID_WHERE`, plutôt qu'un filtre ignoré en silence : l'ignorer exécuterait la lecture sans filtre et retournerait tout ce que la sécurité au niveau des lignes (RLS) autorise.

## Comment les filtres se combinent

`?field=op.value`, `?where=`, `?or=`/`?and=`/`?not=` et `?searchString=` sont indépendants, et chacun d'eux présent doit correspondre :

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

La seule exception est un champ nommé à la fois dans `?field=op.value` et dans `where` : le paramètre de requête **remplace** alors la condition `where` sur ce champ, étant la demande la plus précise, au lieu d'être combiné avec elle par un AND.

Il n'y a aucun moyen de combiner l'un avec l'autre via un OU (OR). Tout ce qui n'est pas un simple ET (AND) de ces groupes doit se trouver à l'intérieur d'un seul arbre `or=`/`and=`.

## Prochaines étapes

- **[API REST](/docs/backend/api)** — Points de terminaison, tri, pagination et inclusion des relations
- **[Interroger les données](/docs/sdk/querying)** — Les mêmes filtres depuis le SDK typé
