---
sourceHash: 10463431afdfaea5
title: API REST
sidebar_label: API REST
description: Points de terminaison d'API REST auto-générés pour chaque collection, avec filtrage, tri, pagination et inclusion de relations.
---

## Aperçu

Rebase génère automatiquement une API complète à partir des définitions de vos collections :

- **API REST** — Points de terminaison CRUD pour chaque collection à `/api/data/:slug`
- **Spécification OpenAPI** — Spécification lisible par machine à `/api/docs`
- **Swagger UI** — Explorateur d'API interactif à `/api/swagger` (mode développement uniquement)

Aucun code n'est requis — définissez vos collections et l'API apparaît automatiquement.

## Points de terminaison REST

Pour chaque collection, les points de terminaison suivants sont générés. Toutes les autres routes montées par le backend — auth, stockage, admin, méta — se trouvent dans l'[index des points de terminaison](/docs/backend/endpoints/).

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités |
| `GET` | `/api/data/:slug/count` | Compter les entités |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, optionnellement groupés. Prend les mêmes filtres que le point de terminaison de liste, et le RLS s'applique aux lignes agrégées — voir [Requêtage](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obtenir une seule entité |
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

#### Mécanique de routage et analyse des segments

Pour gérer des profondeurs arbitraires de sous-collections imbriquées, Rebase route les requêtes entrantes à l'aide de l'expression régulière du paramètre `:rest{.+}` de Hono. Le moteur interne d'analyse des segments analyse les chemins en comptant les segments séparés par des barres obliques :
- **Nombre impair de segments** (ex. `authors/42/posts` -> 3 segments) représente une requête de liste de collection.
- **Nombre pair de segments** (ex. `authors/42/posts/7` -> 4 segments) représente une opération sur un identifiant d'entité spécifique. Le dernier segment est extrait en tant qu'`entityId` cible.

Le moteur filtre les espaces de noms système réservés (par ex. `history`) de l'analyse des segments de chemin afin d'éviter les collisions avec les points de terminaison intégrés.

## Authentification

Tous les points de terminaison de données nécessitent une authentification par défaut. Incluez un jeton Bearer dans l'en-tête `Authorization` :

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

### Opérateurs de filtre

| Opérateur | Signification | Exemple |
|----------|---------|---------|
| `eq` | Égal à (`==`) | `?active=eq.true` |
| `neq` | Non égal à (`!=`) | `?status=neq.draft` |
| `gt` | Supérieur à (`>`) | `?price=gt.100` |
| `gte` | Supérieur ou égal à (`>=`) | `?price=gte.100` |
| `lt` | Inférieur à (`<`) | `?price=lt.50` |
| `lte` | Inférieur ou égal à (`<=`) | `?price=lte.50` |
| `in` | Dans le tableau | `?status=in.(a,b,c)` |
| `nin` | Pas dans le tableau | `?status=nin.(a,b)` |
| `cs` | Le tableau contient | `?tags=cs.value` |
| `csa` | Le tableau contient au moins un élément | `?tags=csa.(a,b)` |
| `like` | Correspondance de motif, sensible à la casse (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondance de motif, insensible à la casse (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Ne correspond pas au motif (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Ne correspond pas, insensible à la casse (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonne est `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonne n'est pas `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` et `notnull` ignorent leur valeur — l'opérateur constitue l'intégralité de la condition, et tout ce qui suit le point est ignoré. Le SDK écrit `.null`, c'est donc la syntaxe que vous verrez sur le réseau.

:::caution[`eq.null` est la chaîne de quatre caractères, pas `IS NULL`]
`?deleted_at=eq.null` recherche le texte littéral `null`. En SQL, `= NULL` n'est jamais vrai, il n'y a donc aucune interprétation de `eq.null` qui puisse signifier le test de nullité — utilisez `isnull` pour cela. Le SDK sérialise `.where("deleted_at", "==", null)` sous la forme `isnull.null` précisément pour cette raison.
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

`not` inverse la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a,b)` équivaut à `NOT (a AND b)`. Il est compilé en un véritable `NOT (...)` SQL plutôt qu'en opérateurs inversés — le SQL ayant une logique à trois valeurs, `NOT (a AND b)` et `(NOT a) OR (NOT b)` ne concordent plus dès qu'un NULL entre en jeu. Une négation **inclut donc les lignes dont la colonne est NULL**, ce qui correspond au sens de `NOT` ; ajoutez un `notnull` à côté avec un ET logique si ce n'est pas ce que vous souhaitez.

**Un seul groupe par requête : `or` l'emporte sur `and`, et les deux l'emportent sur `not`.** Il s'agit de trois syntaxes pour le même emplacement, et non de trois filtres. Imbriquez-les plutôt :

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Les groupes peuvent être imbriqués jusqu'à 32 niveaux de profondeur ; au-delà, la requête est rejetée avec l'erreur `INVALID_LOGICAL_GROUP`.

Un groupe **restreint** les résultats conjointement avec les filtres de champ plutôt que de les remplacer — voir [Comment les filtres se combinent](#how-the-filters-combine).

### Le dialecte JSON `where`

Les filtres de champ ci-dessus sont l'une des deux manières d'envoyer un filtre. L'autre est un objet JSON unique, qui est ce que le document OpenAPI publie sur chaque `GET /api/data/{slug}` et ce que prennent les routes de sous-collections imbriquées :

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Chaque clé est un champ, chaque valeur est un tuple canonique `[opérateur, valeur]` — les mêmes tuples que ceux écrits par le SDK. Une valeur peut également être une chaîne pré-sérialisée avec point (`{"status":"eq.active"}`) ou un scalaire simple (`{"status":"active"}`) ; tous les trois se compilent dans la même condition.

La différence notable : **le JSON conserve les types.** `?price=gte.100` envoie la chaîne `"100"` et le pilote effectue la conversion selon le type de la colonne, tandis que `?where={"price":[">=",100]}` envoie un nombre. Pour une colonne dont les interprétations textuelle et numérique diffèrent — une chaîne de version, un code précédé de zéros —, c'est le paramètre à privilégier.

Un `where` malformé renvoie une erreur 400 `INVALID_WHERE`, et n'est pas un filtre ignoré en silence : l'ignorer exécuterait la lecture sans filtre et retournerait tout ce que la sécurité au niveau des lignes (RLS) autorise.

### Comment les filtres se combinent

`?field=op.value`, `?where=`, `?or=`/`?and=` et `?searchString=` sont indépendants, et chacun d'entre eux présent doit correspondre :

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Il n'est pas possible d'effectuer un OU logique (OR) entre eux. Tout ce qui n'est pas un simple ET (AND) de ces groupes doit être placé à l'intérieur d'un seul arbre `or=`/`and=`.

## Tri

Utilisez `orderBy` avec le format `champ:direction` :

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Une direction manquante vaut `asc`. Une direction qui n'est ni `asc` ni `desc`, ou un champ que la collection ne possède pas, renvoie une erreur **400** — et non un 200 avec les lignes dans l'ordre choisi par la base de données, ce qui serait impossible à distinguer d'un tri réussi.

### Plusieurs clés

La syntaxe abrégée prend en charge une seule clé. Pour en avoir plusieurs, passez un tableau JSON — la deuxième clé départage les lignes considérées comme égales par la première :

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Les deux syntaxes sont applicables à toutes les routes qui listent des lignes, y compris les routes imbriquées (`/api/data/authors/:id/posts`). Chaque tri se termine par l'identifiant de la ligne par ordre décroissant, que vous l'ayez demandé ou non : c'est ce qui rend le tri total, la pagination sur un ordre non total risquant de répéter ou de sauter des lignes.

Un paramètre `?orderBy=` répété n'est pas un tri multi-clés — le dernier prévaut, comme pour tout autre paramètre de requête. Utilisez le tableau.

### Emplacement des valeurs NULL dans le tri

Par défaut, les valeurs NULL sont triées **en dernier par ordre croissant et en premier par ordre décroissant**, ce qui correspond à la convention de Postgres. Un troisième segment séparé par deux-points permet de modifier ce comportement :

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La forme sous forme de tableau JSON accepte une clé `"nulls"` pour la même chose :

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Toute valeur autre que `first` ou `last` renvoie une 400, et non un ordre silencieusement différent. Le curseur ci-dessous respecte ce que le tri a déclaré, de sorte que la pagination sur une clé nullable reste correcte quel que soit l'emplacement choisi.

## Pagination

Utilisez `limit` et `offset`, ou `page` :

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

La limite par défaut est de **50**, le maximum est de **1000**. Les deux proviennent de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, que la spécification OpenAPI générée indique également — une valeur de `limit` supérieure au maximum est rejetée plutôt que tronquée.

Les trois paramètres de fenêtre sont refusés plutôt que corrigés, et chacun s'identifie : `INVALID_LIMIT`, `INVALID_OFFSET` (un nombre entier supérieur ou égal à 0) et `INVALID_PAGE` (un nombre entier supérieur ou égal à 1). Une fenêtre discrètement différente de celle demandée ne pourrait pas être distinguée de la fin d'une collection, c'est pourquoi aucun d'entre eux n'est tronqué ou ignoré.

### Pagination par curseur

`offset` recompte les lignes à chaque requête, de sorte qu'une ligne insérée ou supprimée entre deux pages décale la fenêtre et le parcours saute ou répète silencieusement des lignes. `?after=` effectue plutôt une recherche : la page suivante commence strictement après la dernière ligne servie.

Chaque réponse de liste contient `meta.nextCursor` tant qu'il reste une autre page. Renvoyez-le inchangé :

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Le curseur est **opaque** — il encode les clés de tri *et* les valeurs de la dernière ligne pour celles-ci — trois règles en découlent donc, chacune renvoyant une 400 plutôt qu'une mauvaise page :

| Situation | Code |
|-----------|------|
| `after` avec `offset` ou `page` | `CURSOR_WITH_OFFSET` — les deux indiquent où commence la page |
| `after` avec un `orderBy` différent de celui avec lequel il a été émis | `CURSOR_ORDER_MISMATCH` |
| Un curseur que cette API n'a pas émis | `INVALID_CURSOR` |

Une requête qui ne spécifie aucun `orderBy` **adopte celui du curseur**, ainsi renvoyer `meta.nextCursor` sans redéfinir le tri fonctionne.

Les tris multi-clés et les clés nullables se paginent tous deux correctement : la comparaison est construite sur chaque clé dans l'ordre, avec le placement des valeurs NULL déclaré par le tri. Le seul ordre qu'aucun curseur ne peut décrire est la pertinence (`_score`) — calculée par requête et stockée nulle part — et une telle liste ne comporte tout simplement aucun `nextCursor`.

## Sélection de colonnes

`?fields=` restreint une lecture aux colonnes que vous nommez. Il s'agit d'une projection intégrée à la requête, et non d'un simple rognage de la réponse :

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La clé primaire est toujours retournée (une ligne qui ne peut pas être adressée ne peut pas être mise à jour, supprimée ou dépassée par pagination — et le curseur en dérive), et les colonnes `excludeFromApi` restent masquées, qu'elles soient nommées ou non. Une colonne inconnue renvoie une erreur 400 `UNKNOWN_FIELD` plutôt qu'une ligne manquant discrètement d'un champ.

`?distinct=true` regroupe les lignes identiques sur ces colonnes :

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Il est refusé (400) lorsqu'il est associé à un `searchString` avec classement ou à une recherche vectorielle, qui attribuent un score par ligne rendant chaque ligne distincte par construction, ainsi que lorsque `orderBy` nomme une colonne que `fields` ne retourne pas (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres ne pouvant pas ordonner une lecture DISTINCT par une expression en dehors de sa liste de sélection.

`?fields=` et `?distinct=` fonctionnent également sur la route d'obtention par identifiant et sur les routes de sous-collections imbriquées.

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

`nextCursor` est présent tant que `hasMore` est vrai et que la page a retourné au moins une ligne ; il est absent sur la dernière page et sur un tri qu'aucun curseur ne peut décrire.

Les réponses pour une entité unique retournent un objet plat :

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Erreurs

Chaque échec, provenant de n'importe quelle route, est renvoyé dans une enveloppe unique :

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

`message` et `code` sont toujours présents. `details` apparaît lorsque le refus *concerne* un élément spécifique — le champ erroné, les chemins qui ont échoué. `requestId` apparaît lorsque la requête comportait un en-tête `X-Request-ID` ou qu'un identifiant lui a été attribué ; il est également renvoyé dans l'en-tête de réponse et constitue l'élément à citer dans un rapport de bug.

**Faites vos branchements logiques sur `code`, jamais sur `message` ou sur le statut seul.** Les codes sont en `SCREAMING_SNAKE_CASE` et stables ; les messages sont écrits pour un humain lisant une console et peuvent être modifiés. Le statut HTTP se trouve sur la réponse, pas dans le corps.

| Statut | Code typique | Signification |
|--------|--------------|-------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La requête est malformée ou demande quelque chose d'impossible |
| 401 | `UNAUTHORIZED` | Aucun identifiant d'authentification, ou un identifiant qui n'identifie personne |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Un identifiant qui identifie quelqu'un qui n'a pas les droits nécessaires |
| 404 | `NOT_FOUND` | L'élément ciblé n'existe pas |
| 409 | `CONFLICT` | L'état entre en conflit — une clé dupliquée, un arbre modifié |
| 501 | varie | La surface existe mais n'est **pas configurée** sur ce déploiement |
| 503 | `SERVICE_UNAVAILABLE` | Une dépendance est indisponible ; la requête ne l'a jamais atteinte |

Une surface absente parce que ce déploiement ne l'a pas activée répond par une 501 avec un code et une raison, et non par une 404 — une 404 inexpliquée sur une route que l'interface vient d'appeler s'interprète comme un déploiement défectueux.

Les routes ajoutent leurs propres codes plus spécifiques en plus de ceux-ci (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …) ; considérez donc la liste des codes comme ouverte. Le SDK client les convertit tous en une unique `RebaseApiError` contenant `status`, `code` et `details` — voir [Gestion des erreurs](/docs/backend#error-handling).

## Recherche textuelle

Utilisez `searchString` pour la recherche en texte intégral sur les champs de type chaîne de caractères :

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
| `vector_search` | `string` | Le nom de la propriété vectorielle sur laquelle effectuer la requête. |
| `vector` | `string` | Un tableau de nombres flottants sérialisé en JSON représentant le vecteur de requête. |
| `vector_distance` | `string` | La métrique de distance à évaluer. Valeurs prises en charge : `cosine` (par défaut, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Seuil de distance maximal. Seuls les enregistrements dont la distance est inférieure à ce seuil sont retournés. |

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

Un nom qui n'est pas une relation de la collection renvoie une erreur **400 `UNKNOWN_RELATION`**, à tous les niveaux. Auparavant, cela était ignoré, ce qui répondait par un 200 avec le champ simplement manquant — impossible à distinguer d'une ligne qui n'a véritablement aucune ligne liée, de sorte qu'une faute de frappe ressemblait exactement à des données vides. Un chemin de plus de trois sauts renvoie `INCLUDE_TOO_DEEP`.

### Restreindre une relation

La forme séparée par des virgules ne permet pas de définir une `limit` par relation, c'est pourquoi `include` accepte également le JSON — distingué par une accolade ouvrante :

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Clé | Signification |
|-----|---------|
| `limit` | Lignes **par ligne parente**, et non sur l'ensemble de la page |
| `where` | Le même dialecte de filtre que celui utilisé par le `where` de premier niveau |
| `logical` | Un groupe `or`/`and`/`not` sur les lignes liées |
| `orderBy` | La même syntaxe de tri, y compris l'emplacement des valeurs NULL |
| `fields` | Colonnes de la ligne *liée* ; sa clé est toujours conservée |
| `include` | Relations de la ligne liée, à leur tour |

`true` signifie « charger entièrement », donc `{"author":true}` et `author` constituent la même requête. Les deux syntaxes fonctionnent sur la route de liste, la route d'obtention par identifiant et les routes de sous-collections imbriquées.

Chaque saut correspond à une seule requête groupée (batch) pour l'ensemble de la page, jamais une par ligne.

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

Les clés d'idempotence, les écritures conditionnelles (`ETag` / `If-Match`), les opérations sur les champs (`$inc`, `$push`, `$pull`, `$merge`), l'upsert sur une clé naturelle, `Prefer: return=minimal`, ainsi que le point de terminaison trans-collection `POST /api/data/_batch` se trouvent tous sur leur propre page : **[Écriture via REST](/docs/backend/writes/)**.

## Pipeline des hooks de cycle de vie

Chaque opération de mutation REST (`POST`, `PATCH`, `DELETE`) s'exécute à travers un pipeline d'exécution de hooks strict et séquentiel :

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks bloquants vs différés

1. **Hooks bloquants (`beforeSave`, `beforeDelete`)**
   Ces hooks sont exécutés de manière synchrone dans le cycle principal de la requête *avant* de valider la transaction en base de données. Ils peuvent modifier les charges utiles entrantes, exécuter des validations personnalisées ou annuler entièrement la requête en levant une erreur.

2. **Hooks différés (`afterSave`, `afterDelete`)**
   Ces hooks s'exécutent de manière asynchrone après que la transaction en base de données a été validée avec succès. Ils utilisent des promesses différées (fire-and-forget), ce qui signifie qu'ils s'exécutent en arrière-plan et ne bloquent pas la réponse HTTP au client. Idéal pour envoyer des webhooks, déclencher des notifications push ou mettre en file d'attente des tâches externes.

## Points de terminaison système

| Méthode | Chemin | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` et `/api/health` | aucun | Vérification de vivacité/disponibilité (Liveness/readiness) |
| `GET` | `/api/docs` | aucun | La spécification JSON OpenAPI 3.0 |
| `GET` | `/api/swagger` | aucun | Swagger UI. Activé en développement, désactivé en production ; `REBASE_ENABLE_SWAGGER` permet de forcer l'un ou l'autre |
| `GET` | `/api/meta/schema-version` | aucun | Le hachage du schéma à partir duquel ce backend a été construit — délibérément non authentifié, et il retourne uniquement ce hachage |
| `GET` | `/api/meta/contract` | admin, clé de service ou clé d'API admin | Le contrat complet des collections, pour `rebase generate-sdk --from`. Sécurité par défaut (fail-closed) : `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |

## OpenAPI / Swagger

La spécification OpenAPI est générée automatiquement à partir des définitions de vos collections : elle décrit les points de terminaison de liste, de lecture, de création, de mise à jour, de suppression et d'opérations en masse de chaque collection servie par le backend, avec leurs paramètres de requête et schémas de réponse. Il ne s'agit pas d'une cartographie complète de la surface HTTP — les routes d'authentification, de stockage, de fonctions et de cron sont documentées uniquement sur ce site — et les colonnes marquées `excludeFromApi` en sont exclues.

Les appelants machines s'authentifient avec une clé restreinte plutôt qu'avec une session :
[Clés d'API](/docs/backend/api-keys/).

## Métadonnées du schéma

Le schéma complet des collections du projet — chaque collection, propriété et relation — est servi à un administrateur authentifié :

```bash
GET /api/meta/contract
```

Il est **réservé aux administrateurs**, et sur un déploiement sans authentification configurée, il n'est pas du tout servi (404 `CONTRACT_UNAVAILABLE`) plutôt que d'exposer le schéma à n'importe qui. Son équivalent retourne une chaîne de version représentant le schéma sans le décrire, et est délibérément accessible sans aucun identifiant — ce qu'un job de CI interroge :

```bash
GET /api/meta/schema-version
```

Pour la structure des points de terminaison plutôt que le schéma sous-jacent, le document OpenAPI est disponible à l'adresse `GET /api/docs`, avec Swagger UI à `/api/swagger` lorsque `enableSwagger` est activé.

## Prochaines étapes

- **[SDK Client](/docs/sdk)** — Client sécurisé au niveau des types pour l'API REST
- **[Collections](/docs/collections)** — Définissez votre schéma de données
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôlez l'accès par ligne

---
