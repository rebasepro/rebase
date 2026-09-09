---
sourceHash: b480967e0adbfeed
title: API REST
sidebar_label: API REST
description: Points de terminaison d'API REST auto-générés pour chaque collection, avec filtrage, tri, pagination et inclusion de relations.
---

## Vue d'ensemble

Rebase génère automatiquement une API complète à partir des définitions de vos collections :

- **API REST** — Points de terminaison CRUD pour chaque collection sur `/api/data/:slug`
- **Spécification OpenAPI** — Spécification lisible par machine sur `/api/docs`
- **Swagger UI** — Explorateur d'API interactif sur `/api/swagger` (mode dev uniquement)

Aucun code n'est requis — définissez vos collections et l'API apparaît automatiquement.

## Points de terminaison REST

Pour chaque collection, les points de terminaison suivants sont générés. Toutes les autres routes montées par le backend — auth, stockage, admin, méta — se trouvent dans l'[index des points de terminaison](/docs/backend/endpoints/).

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités |
| `GET` | `/api/data/:slug/count` | Compter les entités |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, facultativement groupés. Accepte les mêmes filtres que le point de terminaison de liste, et les RLS s'appliquent aux lignes agrégées — voir [Requêtage](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Récupérer une entité unique |
| `POST` | `/api/data/:slug` | Créer un enregistrement |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour un enregistrement (partiel — seules les propriétés envoyées sont écrites) |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs entités dans une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs entités dans une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs entités dans une seule transaction |
| `POST` | `/api/data/_batch` | Écrire **à travers** plusieurs collections dans une seule transaction |

### Routes de sous-collections

Les relations imbriquées sont accessibles via les chemins d'URL :

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mécanismes de routage et analyse des segments

Pour gérer des niveaux arbitraires d'imbrication de sous-collections, Rebase route les requêtes entrantes à l'aide de la regex de paramètre `:rest{.+}` de Hono. Le moteur interne d'analyse de segments évalue les chemins en comptant les segments séparés par des barres obliques :
- **Nombre impair de segments** (par ex., `authors/42/posts` -> 3 segments) représente une requête de liste de collection.
- **Nombre pair de segments** (par ex., `authors/42/posts/7` -> 4 segments) représente une opération sur un identifiant d'entité spécifique. Le dernier segment est extrait comme `entityId` cible.

Le moteur exclut les espaces de noms système réservés (par ex., `history`) de l'analyse des segments de chemin pour éviter les collisions avec les points de terminaison intégrés.

## Authentification

Tous les points de terminaison de données requièrent une authentification par défaut. Incluez un jeton Bearer dans l'en-tête `Authorization` :

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Pour les appels de serveur à serveur, utilisez la clé de service :

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtrage

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

### Opérateurs de filtrage

| Opérateur | Signification | Exemple |
|-----------|---------------|---------|
| `eq` | Égal (`==`) | `?active=eq.true` |
| `neq` | Différent (`!=`) | `?status=neq.draft` |
| `gt` | Supérieur strict (`>`) | `?price=gt.100` |
| `gte` | Supérieur ou égal (`>=`) | `?price=gte.100` |
| `lt` | Inférieur strict (`<`) | `?price=lt.50` |
| `lte` | Inférieur ou égal (`<=`) | `?price=lte.50` |
| `in` | Dans le tableau | `?status=in.(a,b,c)` |
| `nin` | Pas dans le tableau | `?status=nin.(a,b)` |
| `cs` | Le tableau contient | `?tags=cs.value` |
| `csa` | Le tableau contient l'un des éléments | `?tags=csa.(a,b)` |
| `like` | Correspondance de motif, sensible à la casse (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondance de motif, insensible à la casse (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Ne correspond pas au motif (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Ne correspond pas au motif, insensible à la casse (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonne est `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonne n'est pas `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` et `notnull` ignorent leur valeur — l'opérateur constitue l'intégralité de la condition, et tout ce qui suit le point est ignoré. Le SDK écrit `.null`, c'est donc la syntaxe que vous verrez passer sur le réseau.

:::caution[`eq.null` est la chaîne de quatre caractères, pas `IS NULL`]
`?deleted_at=eq.null` recherche la chaîne littérale `null`. En SQL, `= NULL` n'est jamais vrai, il n'y a donc aucune interprétation d'`eq.null` qui puisse correspondre au test de nullité — utilisez `isnull` pour cela. Le SDK sérialise `.where("deleted_at", "==", null)` sous la forme `isnull.null` précisément pour cette raison.
:::

### Opérateurs logiques

Utilisez `or`, `and` et `not` pour les conditions complexes :

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` nie la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a,b)` à `NOT (a AND b)`. Il se compile en un véritable `NOT (...)` SQL plutôt qu'en opérateurs inversés — la logique SQL étant à trois valeurs, `NOT (a AND b)` et `(NOT a) OR (NOT b)` cessent de concorder dès qu'un NULL entre en jeu. Une négation **inclut donc les lignes dont la colonne est NULL**, ce qui correspond au comportement de `NOT` ; ajoutez un `and` avec `notnull` si ce n'est pas ce que vous souhaitez.

**Un seul groupe par requête : `or` l'emporte sur `and`, et tous deux sur `not`.** Il s'agit de trois variantes du même emplacement, et non de trois filtres distincts. Imbriquez-les plutôt :

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Les groupes peuvent être imbriqués jusqu'à 32 niveaux de profondeur ; au-delà, la requête est rejetée avec `INVALID_LOGICAL_GROUP`.

Un groupe **affine** les filtres de champ plutôt que de les remplacer — voir [Comment les filtres se combinent](#how-the-filters-combine).

### Le dialecte JSON `where`

Les filtres de champs ci-dessus représentent l'une des deux manières d'envoyer un filtre. L'autre consiste en un objet JSON unique, ce que le document OpenAPI publie sur chaque `GET /api/data/{slug}` et ce que les routes de sous-collections imbriquées acceptent :

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Chaque clé est un champ, chaque valeur un tuple canonique `[operator, value]` — les mêmes tuples que ceux écrits par le SDK. Une valeur peut également être une chaîne avec point pré-sérialisée (`{"status":"eq.active"}`) ou un scalaire simple (`{"status":"active"}`) ; les trois se compilent vers la même condition.

La différence notable : **le JSON conserve les types.** `?price=gte.100` envoie la chaîne `"100"` et le pilote effectue un transtypage selon le type de la colonne, tandis que `?where={"price":[">=",100]}` envoie un nombre. Pour une colonne dont les interprétations textuelle et numérique diffèrent — une chaîne de version, un code complété par des zéros — c'est le paramètre à privilégier.

Un paramètre `where` mal formé renvoie un 400 `INVALID_WHERE` et n'est pas silencieusement ignoré : l'ignorer exécuterait la lecture sans filtre et retournerait tout ce que la sécurité au niveau des lignes (RLS) autorise.

### Comment les filtres se combinent

`?field=op.value`, `?where=`, `?or=`/`?and=` et `?searchString=` sont indépendants, et chacun d'entre eux présent doit correspondre :

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Il n'est pas possible d'appliquer un OU entre eux. Tout ce qui n'est pas un simple ET de ces groupes doit se trouver dans un même arbre `or=`/`and=`.

## Tri

Utilisez `orderBy` avec le format `field:direction` :

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Une direction absente vaut `asc`. Une direction qui n'est ni `asc` ni `desc`, ou un champ qui n'existe pas dans la collection, renvoie une erreur **400** — et non un 200 avec les lignes retournées dans l'ordre choisi par la base de données, ce qui serait impossible à distinguer d'un tri ayant fonctionné.

### Clés multiples

La syntaxe raccourcie prend une seule clé. Pour en spécifier plusieurs, passez un tableau JSON — la deuxième clé départagera les lignes considérées comme égales par la première :

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Les deux syntaxes sont utilisables sur toutes les routes qui listent des lignes, y compris les routes imbriquées (`/api/data/authors/:id/posts`). Chaque tri se termine par l'id de la ligne par ordre décroissant, que vous l'ayez demandé ou non : c'est ce qui rend le tri total, la pagination sur un ordre non total risquant de répéter ou de sauter des lignes.

Un paramètre `?orderBy=` répété n'effectue pas un tri multi-clés — le dernier l'emporte, comme pour tout autre paramètre de requête. Utilisez le tableau.

### Emplacement des valeurs NULL dans le tri

Par défaut, les valeurs NULL sont triées **en dernier dans l'ordre croissant et en premier dans l'ordre décroissant**, ce qui correspond à la convention de Postgres. Un troisième segment séparé par deux-points permet de modifier ce comportement :

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La forme tableau JSON accepte une clé `"nulls"` pour faire la même chose :

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Toute valeur autre que `first` ou `last` renvoie une erreur 400, et non un ordre silencieusement différent. Le curseur ci-dessous respecte ce que le tri a déclaré, de sorte que la pagination sur une clé nullable reste correcte quel que soit le placement.

## Pagination

Utilisez `limit` et `offset`, ou `page` :

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

La limite par défaut est de **50**, le maximum est de **1000**. Ces valeurs proviennent de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, également indiquées dans la spécification OpenAPI générée — une `limit` supérieure au maximum est rejetée plutôt que tronquée.

Tous les trois paramètres de fenêtre sont rejetés plutôt que corrigés, et chacun précise son erreur : `INVALID_LIMIT`, `INVALID_OFFSET` (un entier supérieur ou égal à 0) et `INVALID_PAGE` (un entier supérieur ou égal à 1). Une fenêtre discrètement différente de celle demandée ne pourrait être distinguée de la fin de la collection, c'est pourquoi aucun d'eux n'est tronqué ni ignoré.

### Pagination par curseur

`offset` recompte les lignes à chaque requête ; ainsi, une ligne insérée ou supprimée entre deux pages décale la fenêtre et le parcours saute ou répète silencieusement des lignes. `?after=` effectue plutôt un déplacement direct : la page suivante commence strictement après la dernière ligne servie.

Chaque réponse de liste inclut `meta.nextCursor` tant qu'il y a une page suivante. Renvoyez-le sans modification :

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Le curseur est **opaque** — il encode les clés de tri *et* les valeurs de la dernière ligne pour celles-ci — d'où trois règles, chacune renvoyant une 400 plutôt qu'une mauvaise page :

| Situation | Code |
|-----------|------|
| `after` avec `offset` ou `page` | `CURSOR_WITH_OFFSET` — les deux indiquent où la page commence |
| `after` avec un `orderBy` différent de celui avec lequel il a été émis | `CURSOR_ORDER_MISMATCH` |
| Un curseur que cette API n'a pas émis | `INVALID_CURSOR` |

Une requête qui ne spécifie aucun `orderBy` **adopte celui du curseur**, de sorte que renvoyer `meta.nextCursor` sans redéfinir le tri fonctionne.

Les tris multi-clés et les clés nullables paginent tous deux correctement : la comparaison est construite sur chaque clé dans l'ordre, avec le positionnement de NULL déclaré lors du tri. Le seul ordre qu'aucun curseur ne peut décrire est la pertinence (`_score`) — calculée par requête et stockée nulle part — et une telle liste ne contient tout simplement pas de `nextCursor`.

## Sélection des colonnes

<span class="since-badge" data-since="0.20">Depuis 0.20</span>

`?fields=` restreint la lecture aux colonnes que vous nommez. Il s'agit d'une projection intégrée directement dans la requête, et non d'un filtrage a posteriori de la réponse :

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La clé primaire est toujours renvoyée (une ligne qui ne peut pas être ciblée ne peut être ni mise à jour, ni supprimée, ni paginée — et le curseur en dérive), et les colonnes `excludeFromApi` restent masquées, qu'elles soient nommées ou non. Une colonne inconnue renvoie une erreur 400 `UNKNOWN_FIELD` plutôt qu'une ligne manquant discrètement un champ.

`?distinct=true` regroupe les lignes identiques sur ces colonnes :

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Il est rejeté (400) lorsqu'il est combiné à une recherche `searchString` ordonnée par pertinence ou à une recherche vectorielle, qui attribuent un score par ligne rendant chaque ligne distincte par construction, et lorsque `orderBy` mentionne une colonne que `fields` ne retourne pas (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres ne pouvant ordonner une lecture DISTINCT sur une expression hors de sa liste SELECT.

`?fields=` et `?distinct=` fonctionnent également sur la route de récupération par identifiant ainsi que sur les routes de sous-collections imbriquées.

### Format de réponse

Les réponses de liste incluent des métadonnées de pagination :

```json
{
    "data": [
        { "id": 1, "name": "Widget", "price": 29.99 },
        { "id": 2, "name": "Gadget", "price": 49.99 }
    ],
    "meta": {
        "total": 150,
        "limit": 20,
        "offset": 0,
        "hasMore": true,
        "nextCursor": "eyJrIjpbWyJpZCIsImRlc2MiXV0sInYiOnsiaWQiOjJ9LCJpIjoyfQ"
    }
}
```

`nextCursor` est présent tant que `hasMore` est vrai et que la page a retourné au moins une ligne ; il est absent sur la dernière page et lors d'un ordonnancement qu'aucun curseur ne peut décrire.

Les réponses d'une entité unique renvoient un objet plat :

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Erreurs

Chaque échec, quelle que soit la route, est renvoyé dans une enveloppe unique :

```json
{
    "error": {
        "message": "Unknown filter operator 'contains' on field 'title'.",
        "code": "UNKNOWN_FILTER_OPERATOR",
        "details": { "field": "title", "operator": "contains" },
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

`message` et `code` sont toujours présents. `details` apparaît lorsque le rejet *concerne* un élément spécifique — le champ erroné, les chemins ayant échoué. `requestId` apparaît lorsque la requête comportait un en-tête `X-Request-ID` ou qu'un lui a été assigné ; il est également renvoyé dans l'en-tête de réponse, et c'est l'élément à mentionner dans un rapport de bug.

**Faites vos branchements logiques sur `code`, jamais sur `message` ou sur le seul statut HTTP.** Les codes sont en `SCREAMING_SNAKE_CASE` et stables ; les messages sont rédigés pour une personne consultant une console et peuvent changer. Le statut HTTP se trouve dans la réponse, pas dans le corps.

| Statut | Code typique | Signification |
|--------|--------------|---------------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La requête est mal formée ou demande quelque chose d'impossible |
| 401 | `UNAUTHORIZED` | Aucun identifiant, ou un identifiant qui n'identifie personne |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Un identifiant qui correspond à un utilisateur sans les droits nécessaires |
| 404 | `NOT_FOUND` | La ressource ciblée n'existe pas |
| 409 | `CONFLICT` | Conflit d'état — une clé dupliquée, un arbre modifié |
| 501 | varie | La surface existe mais n'est **pas configurée** sur ce déploiement |
| 503 | `SERVICE_UNAVAILABLE` | Une dépendance est inaccessible ; la requête ne l'a jamais atteinte |

Une surface d'API absente parce que ce déploiement ne l'a pas activée répond par une 501 avec un code et une raison, et non par une 404 — une erreur 404 inexpliquée sur une route que l'UI vient d'appeler évoquerait un déploiement défectueux.

Les routes ajoutent leurs propres codes plus spécifiques en plus de ceux-ci (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), considérez donc la liste des codes comme ouverte. Le SDK client les convertit tous en une unique `RebaseApiError` comportant `status`, `code` et `details` — voir [Gestion des erreurs](/docs/backend#error-handling).

## Recherche textuelle

Utilisez `searchString` pour effectuer une recherche plein texte sur les champs de type chaîne de caractères :

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Recherche vectorielle

Si une collection définit une propriété de type `vector`, vous pouvez effectuer des recherches de similarité à grande vitesse à l'aide des opérations de distance pgvector compilées directement dans la requête de base de données.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Paramètres de requête vectorielle

| Paramètre | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | Le nom de la propriété vectorielle sur laquelle effectuer la recherche. |
| `vector` | `string` | Un tableau JSON de nombres à virgule flottante représentant le vecteur de requête. |
| `vector_distance` | `string` | La métrique de distance à évaluer. Valeurs prises en charge : `cosine` (par défaut, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Seuil de distance maximal. Seuls les enregistrements dont la distance est inférieure à ce seuil sont renvoyés. |

## Inclusion de relations

Utilisez le paramètre `include` pour intégrer des entités liées :

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Un nom qui n'est pas une relation de la collection renvoie une erreur **400 `UNKNOWN_RELATION`**, à chaque niveau. Il était auparavant ignoré, renvoyant un 200 avec le champ simplement manquant — impossible à distinguer d'une ligne n'ayant véritablement aucune ligne liée, de sorte qu'une faute de frappe ressemblait exactement à des données vides. Un chemin de plus de trois sauts renvoie `INCLUDE_TOO_DEEP`.

### Restreindre une relation

La forme séparée par des virgules n'offre aucun moyen de spécifier une `limit` par relation ; `include` accepte donc également du JSON — identifié par une accolade ouvrante :

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Clé | Signification |
|-----|---------------|
| `limit` | Lignes **par ligne parente**, et non sur toute la page |
| `where` | Le même dialecte de filtrage que le `where` de premier niveau |
| `logical` | Un groupe `or`/`and`/`not` sur les lignes liées |
| `orderBy` | La même syntaxe de tri, y compris le positionnement des NULL |
| `fields` | Colonnes de la ligne *liée* ; sa clé est toujours conservée |
| `include` | Relations de la ligne liée, à leur tour |

`true` signifie « charger en entier », ainsi `{"author":true}` et `author` correspondent à la même requête. Les deux syntaxes fonctionnent sur la route de liste, la route de récupération par identifiant et les routes de sous-collections imbriquées.

Chaque saut correspond à une seule requête groupée (batch) pour toute la page, jamais une par ligne.

Les relations incluses sont directement intégrées dans la réponse :

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Écriture

Les clés d'idempotence, les écritures conditionnelles (`ETag` / `If-Match`), les opérations sur les champs (`$inc`, `$push`, `$pull`, `$merge`), l'upsert sur une clé naturelle, `Prefer: return=minimal`, et le point de terminaison multi-collections `POST /api/data/_batch` sont tous détaillés sur leur propre page : **[Écriture via REST](/docs/backend/writes/)**.

## Pipeline de hooks de cycle de vie

Chaque opération de mutation REST (`POST`, `PATCH`, `DELETE`) passe par un pipeline d'exécution de hooks séquentiel et strict :

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks bloquants vs différés

1. **Hooks bloquants (`beforeSave`, `beforeDelete`)**
   Ces hooks sont exécutés de façon synchrone dans le cycle principal de la requête *avant* de valider la transaction en base de données. Ils peuvent modifier les charges utiles entrantes, exécuter des validations personnalisées ou interrompre entièrement la requête en levant une erreur.

2. **Hooks différés (`afterSave`, `afterDelete`)**
   Ces hooks s'exécutent de façon asynchrone après que la transaction en base de données a été validée avec succès. Ils utilisent des promesses différées (fire-and-forget), ce qui signifie qu'ils tournent en arrière-plan et ne bloquent pas la réponse HTTP au client. Idéal pour envoyer des webhooks, déclencher des notifications push ou mettre en file d'attente des tâches externes.


## Points de terminaison système

| Méthode | Chemin | Authentification | Description |
|---------|--------|------------------|-------------|
| `GET` | `/health` and `/api/health` | aucune | Vérification de l'état de fonctionnement (liveness/readiness) |
| `GET` | `/api/docs` | aucune | La spécification JSON OpenAPI 3.0 |
| `GET` | `/api/swagger` | aucune | Swagger UI. Activé en développement, désactivé en production ; `REBASE_ENABLE_SWAGGER` permet de forcer l'un ou l'autre |
| `GET` | `/api/meta/schema-version` | aucune | Le hash du schéma à partir duquel ce backend a été construit — délibérément non authentifié, et ne retourne que ce hash |
| `GET` | `/api/meta/contract` | admin, clé de service ou clé API admin | Le contrat complet des collections, pour `rebase generate-sdk --from`. Sécurité par défaut (fail-closed) : `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` si défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |

## OpenAPI / Swagger

La spécification OpenAPI est générée automatiquement à partir des définitions de vos collections : elle décrit les points de terminaison de liste, de lecture, de création, de mise à jour, de suppression et d'opérations en masse de chaque collection servie par le backend, avec leurs paramètres de requête et leurs schémas de réponse. Il ne s'agit pas d'une cartographie complète de l'ensemble de l'API HTTP — les routes d'authentification, de stockage, de fonctions et de cron sont documentées uniquement sur ce site — et les colonnes marquées `excludeFromApi` en sont exclues.

Les clients automatisés s'authentifient avec une clé restreinte plutôt qu'avec une session :
[Clés API](/docs/backend/api-keys/).

## Métadonnées de schéma

Le schéma complet des collections du projet — chaque collection, propriété et relation — est mis à disposition d'un administrateur authentifié :

```bash
GET /api/meta/contract
```

Il est **réservé aux administrateurs**, et sur un déploiement sans authentification configurée, il n'est pas servi du tout (404 `CONTRACT_UNAVAILABLE`) plutôt que d'exposer le schéma à quiconque. Son homologue renvoie une chaîne de version représentant le schéma sans le décrire, et est délibérément accessible sans identifiant — ce qui permet à un job de CI de le sonder :

```bash
GET /api/meta/schema-version
```

Pour la structure des points de terminaison plutôt que le schéma sous-jacent, le document OpenAPI est accessible sur `GET /api/docs`, et l'interface Swagger UI sur `/api/swagger` lorsque `enableSwagger` est activé.

## Prochaines étapes

- **[SDK Client](/docs/sdk)** — Client typé pour l'API REST
- **[Collections](/docs/collections)** — Définissez votre schéma de données
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôlez l'accès ligne par ligne

---
