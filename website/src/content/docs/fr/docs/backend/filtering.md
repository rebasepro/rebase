---
sourceHash: d75d6ec231ad3911
title: Filtrage de l'API REST
sidebar_label: Filtrage
description: Filtrez les requêtes de liste REST avec des opérateurs de style PostgREST, des groupes or/and et le dialecte JSON where, et découvrez comment les filtres se combinent.
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

# Array contains all
GET /api/data/products?tags=csall.(electronics,refurbished)

# Array holds nothing outside the list
GET /api/data/products?tags=cd.(electronics,books,toys)
```

## Opérateurs de filtrage

| Opérateur | Signification | Exemple |
|-----------|---------------|---------|
| `eq` | Égal (`==`) | `?active=eq.true` |
| `neq` | Non égal (`!=`) | `?status=neq.draft` |
| `gt` | Supérieur strict (`>`) | `?price=gt.100` |
| `gte` | Supérieur ou égal (`>=`) | `?price=gte.100` |
| `lt` | Inférieur strict (`<`) | `?price=lt.50` |
| `lte` | Inférieur ou égal (`<=`) | `?price=lte.50` |
| `in` | Dans le tableau | `?status=in.(a,b,c)` |
| `nin` | Pas dans le tableau | `?status=nin.(a,b)` |
| `cs` | Le tableau contient | `?tags=cs.value` |
| `csa` | Le tableau contient au moins un élément | `?tags=csa.(a,b)` |
| `csall` | Le tableau contient tous les éléments | `?tags=csall.(a,b)` |
| `cd` | Tableau contenu par : aucun élément hors de la liste | `?tags=cd.(a,b)` |
| `like` | Correspondance de motif, sensible à la casse (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondance de motif, insensible à la casse (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Ne correspond pas au motif (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Ne correspond pas, insensible à la casse (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonne est `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonne n'est pas `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Les quatre opérateurs de motif correspondent à du texte. Une colonne de type enum est mise en correspondance par sa valeur
(`?status=like.draft%25`) ; sur un nombre, une date ou toute autre colonne qui n'est pas
du texte, ils renvoient une erreur 400 `INVALID_FILTER_OPERATOR`.

`isnull` et `notnull` ne prennent aucun opérande — l'opérateur constitue toute la condition, et
`.null`, `.true`, `.false` ou rien du tout après le point signifient la même chose. Le SDK
écrit `.null`, c'est donc cette syntaxe que vous verrez passer sur le réseau. Tout autre élément
après le point n'étant pas un opérande valide pour eux, la chaîne entière est lue comme une
valeur : `?reason=notnull.reason` correspond au texte `notnull.reason`.

:::caution[`eq.null` correspond à la chaîne de quatre caractères, pas à `IS NULL`]
`?deleted_at=eq.null` recherche la chaîne littérale `null`. En SQL, `= NULL` n'est
jamais vrai, il n'y a donc aucune interprétation de `eq.null` qui pourrait signifier le test de nullité —
utilisez `isnull` pour cela. Le SDK sérialise `.where("deleted_at", "==", null)` sous la forme
`isnull.null` précisément pour cette raison.
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

`not` nie la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et
`not(a,b)` équivaut à `NOT (a AND b)`. Il est compilé en un véritable `NOT (...)` SQL plutôt
qu'en opérateurs inversés — la logique SQL étant à trois valeurs, `NOT (a AND b)` et
`(NOT a) OR (NOT b)` cessent de concorder dès qu'un NULL entre en jeu. Une négation
**inclut donc les lignes dont la colonne est NULL**, ce qui correspond au sens de `NOT` ; combinez-le avec
un `notnull` via AND si ce n'est pas ce que vous souhaitez.

**Un seul groupe par requête : `or` l'emporte sur `and`, et les deux sur `not`.** Il s'agit de
trois syntaxes pour le même emplacement, pas de trois filtres distincts. Imbriquez-les plutôt :

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Les groupes peuvent être imbriqués jusqu'à 32 niveaux de profondeur ; au-delà, la requête est rejetée avec
`INVALID_LOGICAL_GROUP`.

Une condition à l'intérieur d'un groupe dont l'opérateur n'existe pas dans le dialecte —
`?not=(title.contains.x)` — renvoie une erreur 400 `UNKNOWN_FILTER_OPERATOR`, tout comme dans un
`where` JSON. Elle n'est pas interprétée comme une égalité sur `contains.x`, ce qui à l'intérieur de `not`
aurait correspondu à chaque ligne.

Un groupe **restreint** les résultats aux côtés des filtres de champ plutôt que de les remplacer — voir
[Combinaison des filtres](#combinaison-des-filtres).

## Le dialecte JSON `where`

Les filtres de champ ci-dessus représentent l'une des deux façons d'envoyer un filtre. L'autre est un
objet JSON unique, qui correspond à ce que le document OpenAPI publie sur chaque
`GET /api/data/{slug}` et à ce que les routes imbriquées acceptent :

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Chaque clé est un champ, chaque valeur un tuple canonique `[opérateur, valeur]` — les mêmes
tuples que ceux écrits par le SDK. Une valeur peut également être une chaîne avec notation pointée pré-sérialisée
(`{"status":"eq.active"}`) ou un scalaire brut (`{"status":"active"}`) ; tous trois
se compilent en la même condition. Un tableau de valeurs simples représente un `in` implicite : `{"category":["electronics","gadgets"]}` est interprété comme
`["in", ["electronics","gadgets"]]`, tandis qu'un premier élément semblable à un opérateur mais qui
n'en est pas un vrai (`["!!","x"]`) renvoie une erreur 400 `UNKNOWN_FILTER_OPERATOR`.

Le même objet est interprété de la même manière d'où qu'il vienne : ici, dans le
`where` du SDK, dans une requête MCP, et dans le paramètre `filter` du socket temps réel — pour ses requêtes de liste
et de comptage ainsi que ses abonnements en direct.

La différence importante à noter : **le JSON transporte les types.** `?price=gte.100` envoie la
chaîne `"100"` et le pilote effectue un transtypage selon le type de la colonne, tandis que
`?where={"price":[">=",100]}` envoie un nombre. Pour une colonne dont les interprétations textuelle et
numérique diffèrent — une chaîne de version, un code préfixé de zéros — c'est le
paramètre vers lequel se tourner.

Un `where` malformé renvoie une erreur 400 `INVALID_WHERE`, et n'est pas un filtre ignoré silencieusement :
l'ignorer exécuterait la lecture sans filtrage et renverrait tout ce que la sécurité au niveau des lignes
(RLS) autorise.

## Combinaison des filtres

`?field=op.value`, `?where=`, `?or=`/`?and=`/`?not=` et `?searchString=` sont
indépendants, et chacun de ceux qui est présent doit correspondre :

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

La seule exception concerne un champ nommé à la fois dans `?field=op.value` et dans `where` : dans ce
cas, le paramètre de requête **remplace** la condition `where` sur ce champ, étant la
requête la plus spécifique, au lieu d'être combiné avec elle via un AND.

Il n'y a aucun moyen d'appliquer un opérateur OR entre eux. Tout ce qui n'est pas un simple AND de
ces groupes doit être placé à l'intérieur d'un même arbre `or=`/`and=`.

## Étapes suivantes

- **[API REST](/docs/backend/api)** — Points de terminaison, tri, pagination et inclusion de relations
- **[Interrogation des données](/docs/sdk/querying)** — Les mêmes filtres depuis le SDK typé
