---
sourceHash: 63a33a92e55310ba
title: API REST
sidebar_label: API REST
description: Points de terminaison d'API REST générés automatiquement pour chaque collection, avec filtrage, tri, pagination et inclusion de relations.
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
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités |
| `POST` | `/api/data/:slug/query` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> La même liste, avec ses paramètres de requête dans un corps JSON — pour une requête trop longue pour une URL. Voir [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | Compter les entités |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, optionnellement groupés. Accepte les mêmes filtres que le point de terminaison de liste, et le RLS s'applique aux lignes agrégées — voir [Requêtage](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obtenir une seule entité |
| `POST` | `/api/data/:slug` | Créer un enregistrement |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour un enregistrement (partiel — seules les propriétés envoyées sont écrites) |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs entités en une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs entités en une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs entités en une seule transaction |
| `POST` | `/api/data/_batch` | Écrire **à travers** plusieurs collections en une seule transaction |

### Routes de sous-collections

Les relations imbriquées sont accessibles via les chemins d'URL :

```
GET    /api/data/authors/42/posts         → list author's posts
POST   /api/data/authors/42/posts/query   → the same listing, parameters in the body (0.24+)
POST   /api/data/authors/42/posts/count   → the same count, parameters in the body (0.24+)
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mécanique de routage et analyse des segments

Pour gérer des profondeurs arbitraires de sous-collections imbriquées, Rebase route les requêtes entrantes à l'aide de la regex du paramètre `:rest{.+}` de Hono. Le moteur interne d'analyse des segments analyse les chemins en comptant les segments séparés par des barres obliques :
- **Nombre impair de segments** (ex. `authors/42/posts` -> 3 segments) représente une requête de liste de collection.
- **Nombre pair de segments** (ex. `authors/42/posts/7` -> 4 segments) représente une opération sur un identifiant d'entité spécifique. Le dernier segment est extrait en tant qu'`entityId` cible.

Le moteur filtre les espaces de noms système réservés (ex. `history`) de l'analyse des segments de chemin pour éviter les collisions avec les points de terminaison intégrés.

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

Le filtrage d'une liste — opérateurs `?field=op.value`, groupes `or`/`and`, le dialecte JSON `where` et leur combinaison — a [sa propre page](/docs/backend/filtering).

## Tri

Utilisez `orderBy` avec le format `field:direction` :

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Une direction manquante vaut `asc`. Une direction qui n'est ni `asc` ni `desc`, ou un champ qui n'existe pas dans la collection, renvoie une erreur **400** — et non un 200 avec les lignes dans l'ordre choisi arbitrairement par la base de données, ce qui serait impossible à distinguer d'un tri réussi.

### Plusieurs clés

La notation abrégée accepte une seule clé. Pour en spécifier plusieurs, passez un tableau JSON — la seconde clé départage les lignes jugées égales par la première :

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Les deux syntaxes sont valables sur toutes les routes listant des lignes, y compris les routes imbriquées (`/api/data/authors/:id/posts`). Chaque tri se termine par l'identifiant de la ligne par ordre décroissant, que vous l'ayez demandé ou non : c'est ce qui rend l'ordonnancement total, car paginer sur un ordre qui n'est pas total répète et saute des lignes.

Un paramètre `?orderBy=` répété ne constitue pas un tri à plusieurs clés — le dernier l'emporte, comme pour tout autre paramètre de requête. Utilisez le tableau.

### Positionnement des valeurs NULL lors du tri

Par défaut, les valeurs NULL sont triées **en dernier par ordre croissant et en premier par ordre décroissant**, ce qui correspond à la convention de Postgres. Un troisième segment séparé par deux-points permet d'en décider autrement :

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

Le format tableau JSON accepte une clé `"nulls"` pour obtenir le même comportement :

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Toute valeur autre que `first` ou `last` renvoie une erreur 400, et non un ordre silencieusement altéré. Le curseur ci-dessous respecte la déclaration du tri, de sorte que la pagination sur une clé nullable reste correcte quel que soit l'emplacement choisi.

## Pagination

Utilisez `limit` et `offset`, ou `page` — l'un ou l'autre :

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

La limite par défaut est de **50**, le maximum est de **1000**. Ces deux valeurs proviennent de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, également indiquées dans la spécification OpenAPI générée — une valeur `limit` supérieure au maximum est rejetée plutôt que tronquée.

Ces trois paramètres de fenêtre sont rejetés plutôt que corrigés automatiquement, et chacun renvoie une erreur explicite : `INVALID_LIMIT`, `INVALID_OFFSET` (un entier supérieur ou égal à 0) et `INVALID_PAGE` (un entier supérieur ou égal à 1). Une fenêtre silencieusement différente de celle demandée ne peut pas être distinguée de la fin de la collection, c'est pourquoi aucun d'eux n'est tronqué ni ignoré.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Pour la même raison, `page` et `offset` ensemble donnent un 400
`PAGE_WITH_OFFSET`, plutôt que de laisser l'un des deux l'emporter silencieusement.

### Ignorer le comptage

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `meta.total` est un `COUNT(*)` sur toutes les lignes correspondantes — sur une grande table, l'essentiel du coût
d'une requête de liste. `?count=none` (`GET /api/data/orders?count=none`) l'ignore : pas de `meta.total`, tandis que
`meta.hasMore` reste exact (la lecture demande une ligne de plus que la page). `?count=exact` est la valeur par
défaut ; toute autre valeur renvoie une erreur 400 `INVALID_COUNT`. Une lecture `?distinct=true` n'est jamais comptée, ni une recherche vectorielle avec un
`vector_threshold` (voir [Recherche vectorielle](/docs/backend/vector-search/)).

### Pagination par curseur

`offset` recompte les lignes à chaque requête, de sorte qu'une ligne insérée ou supprimée entre deux pages décale la fenêtre et le parcours saute ou répète silencieusement des lignes. `?after=` effectue plutôt une recherche directe : la page suivante commence strictement après la dernière ligne servie.

Chaque réponse de liste contient `meta.nextCursor` tant qu'il reste une page suivante. Renvoyez-le tel quel :

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Le curseur est **opaque** — il encode les clés de tri *et* les valeurs de la dernière ligne pour celles-ci — ce qui implique trois règles, chacune renvoyant une erreur 400 plutôt qu'une page incorrecte :

| Situation | Code |
|-----------|------|
| `after` avec `offset` ou `page` | `CURSOR_WITH_OFFSET` — les deux indiquent où commence la page |
| `after` avec un `orderBy` différent de celui sous lequel il a été émis | `CURSOR_ORDER_MISMATCH` |
| Un curseur que cette API n'a pas émis | `INVALID_CURSOR` |

Une requête qui ne précise aucun `orderBy` **adopte celui du curseur**, donc renvoyer `meta.nextCursor` sans redéfinir le tri fonctionne.

Les tris multi-clés et les clés nullables se paginent tous deux correctement : la comparaison est construite sur chaque clé dans l'ordre, avec le placement des NULL déclaré par le tri. Le seul ordonnancement qu'aucun curseur ne peut décrire est la pertinence (`_score`) — calculée par requête et stockée nulle part — et une telle liste ne contient tout simplement aucun `nextCursor`.

## Sélection de colonnes

`?fields=` restreint la lecture aux colonnes que vous spécifiez. Il s'agit d'une projection intégrée à la requête, et non d'un simple découpage de la réponse :

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La clé primaire est toujours retournée (une ligne qui ne peut pas être ciblée ne peut être mise à jour, supprimée ou dépassée par pagination — et le curseur en dérive), et les colonnes `excludeFromApi` restent masquées, qu'elles soient nommées ou non. Une colonne inconnue renvoie une erreur 400 `UNKNOWN_FIELD` plutôt qu'une ligne omettant discrètement un champ.

Une relation nommée dans `?include=` revient que `?fields=` la nomme ou non :
`?include=author&fields=title` renvoie `title`, la clé et `author`. Nommer
aussi la relation dans `?fields=` est permis et ne change rien.

`?distinct=true` fusionne les lignes identiques sur ces colonnes :

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Cette option est refusée (400) lorsqu'elle est utilisée avec un `searchString` ordonné ou une recherche vectorielle, qui attribuent un score par ligne rendant chaque ligne distincte par nature, ainsi que lorsque `orderBy` nomme une colonne non retournée par `fields` (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres ne peut pas ordonner une lecture DISTINCT selon une expression hors de sa clause SELECT.

`?fields=` et `?distinct=` fonctionnent également sur la route d'obtention par ID et sur les routes de sous-collections imbriquées.

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

`message` et `code` sont toujours présents. `details` apparaît lorsque le refus concerne un élément spécifique — le champ erroné, les chemins ayant échoué. `requestId` apparaît lorsque la requête comportait un en-tête `X-Request-ID` ou s'en est vu attribuer un ; il est également renvoyé dans l'en-tête de réponse, et c'est l'élément à mentionner dans un rapport de bogue.

**Faites vos branchements logiques sur `code`, jamais sur `message` ou sur le statut seul.** Les codes sont en `SCREAMING_SNAKE_CASE` et stables ; les messages sont rédigés pour une personne consultant une console et peuvent évoluer. Le statut HTTP se trouve sur la réponse, pas dans le corps.

| Statut | Code type | Signification |
|--------|--------------|-------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La requête est malformée ou demande quelque chose d'impossible |
| 401 | `UNAUTHORIZED` | Aucun identifiant fourni, ou identifiant qui ne correspond à personne |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Un identifiant qui correspond à quelqu'un ne disposant pas des droits |
| 404 | `NOT_FOUND` | L'élément ciblé n'existe pas |
| 409 | `CONFLICT` | Conflit d'état — une clé dupliquée, un arbre corrompu |
| 501 | varie | La surface existe mais n'est **pas configurée** sur ce déploiement |
| 503 | `SERVICE_UNAVAILABLE` | Une dépendance est indisponible ; la requête ne l'a jamais atteinte |

Une surface absente parce que ce déploiement ne l'a pas activée renvoie un code 501 avec un code et une raison, et non un 404 — un 404 inexpliqué sur une route que l'interface vient d'appeler évoquerait un déploiement défectueux.

Les routes ajoutent leurs propres codes plus spécifiques en plus de ceux-ci (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), considérez donc la liste des codes comme évolutive. Le SDK typé les convertit tous en une unique `RebaseApiError` contenant `status`, `code` et `details` — voir [Gestion des erreurs](/docs/backend#error-handling).

## Recherche textuelle

Utilisez `searchString` pour la recherche plein texte sur les champs de type chaîne :

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Recherche vectorielle

Une collection dotée d'une propriété `vector` accepte une recherche du plus proche voisin sur la
liste : `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, avec en option un
`vector_distance` et un `vector_threshold`. Les paramètres, les seuils et le comportement des
filtres sur l'index sont décrits dans [Recherche vectorielle](/docs/backend/vector-search/).

## Requêtes trop longues pour une URL

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `POST /api/data/:slug/query` (cette liste) et `POST /api/data/:slug/count`
prennent les paramètres de requête dans un corps JSON, pour une requête dont l'URL ne tiendrait pas — un embedding, une longue liste `in`.
Voir [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url).

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

Un nom qui ne correspond pas à une relation de la collection renvoie une erreur **400 `UNKNOWN_RELATION`**, à tous les niveaux. Auparavant, cela était ignoré et répondait 200 en omettant simplement le champ — ce qui était impossible à distinguer d'une ligne n'ayant réellement aucune ligne liée, de sorte qu'une faute de frappe ressemblait à des données vides. Un chemin de plus de trois sauts renvoie `INCLUDE_TOO_DEEP`.

### Filtrer une relation spécifique

La forme séparée par des virgules ne permet pas de définir un `limit` par relation, c'est pourquoi `include` accepte également du JSON — distingué par une accolade ouvrante :

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Clé | Signification |
|-----|---------|
| `limit` | Lignes **par ligne parente**, et non sur l'ensemble de la page. Appliquée par la requête : les lignes au-delà ne sont jamais lues dans la base de données |
| `where` | Le même dialecte de filtre que celui utilisé par le `where` de premier niveau |
| `logical` | Un groupe `or`/`and`/`not` sur les lignes liées |
| `orderBy` | La même syntaxe de tri, y compris le positionnement des NULL. En cas d'égalité, ou pour une `limit` sans `orderBy`, l'ordre suit la clé de la ligne liée, croissante |
| `fields` | Colonnes de la ligne *liée* ; sa clé primaire est toujours conservée |
| `include` | Relations de la ligne liée, à leur tour |
| `count` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> `true` renvoie aussi le total de chaque parent sous `_count` (`"_count":{"comments":37}`), compté par la même instruction. Relations vers plusieurs lignes uniquement. Voir [Compter ce qu'une limite laisse de côté](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

`true` signifie « charger en totalité », de sorte que `{"author":true}` et `author` correspondent à la même requête. Les deux syntaxes fonctionnent sur la route de liste, la route d'obtention par ID et les routes de sous-collections imbriquées.

Chaque saut correspond à une seule requête groupée pour l'ensemble de la page, jamais une par ligne.

Les relations incluses sont intégrées directement dans la réponse :

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com",
        "companyId": 7
    }
}
```

Une ligne incluse est celle que sert la route propre à sa cible (`GET /api/data/authors/42`) : mêmes colonnes et mêmes
encodages, clés étrangères sous forme de colonnes, sans objets de référence.

## Écriture

Les clés d'idempotence, les écritures conditionnelles (`ETag` / `If-Match`), les opérations sur les champs (`$inc`, `$push`, `$pull`, `$merge`), l'upsert sur une clé naturelle, `Prefer: return=minimal` ainsi que le point de terminaison multi-collections `POST /api/data/_batch` sont tous détaillés sur une page dédiée : **[Écriture via REST](/docs/backend/writes/)**.

## Pipeline des hooks de cycle de vie

Sur Postgres, chaque mutation REST (`POST`, `PATCH`, `DELETE`) exécute les callbacks de sa collection dans l'ordre, dans l'unique transaction qui porte l'écriture :

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Chaque hook est attendu, et une exception levée par l'un d'eux annule toute l'écriture :

1. **`beforeSave`, `beforeDelete`** s'exécutent avant l'écriture. Ils peuvent modifier les valeurs entrantes, valider, ou refuser la requête en levant une erreur — l'appelant reçoit **400 `CALLBACK_REJECTED`** et rien n'est écrit.
2. **`afterSave`, `afterDelete`** s'exécutent après l'écriture mais *avant* le commit. Une exception annule la ligne et répond le même 400, avec `details.stage` nommant le hook. Ils gardent la transaction ouverte pendant leur exécution : ce n'est donc pas l'endroit pour un webhook ni pour aucun autre appel réseau. [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indique où va ce travail.

## Points de terminaison système

| Méthode | Chemin | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` and `/api/health` | aucune | Vérification de liveness/readiness |
| `GET` | `/api/docs` | aucune | La spécification JSON OpenAPI 3.0 |
| `GET` | `/api/swagger` | aucune | Swagger UI. Activé en développement, désactivé en production ; `REBASE_ENABLE_SWAGGER` permet de forcer l'un ou l'autre |
| `GET` | `/api/meta/schema-version` | aucune | Le hash du schéma à partir duquel ce backend a été construit — délibérément sans authentification, et il ne retourne que ce hash |
| `GET` | `/api/meta/contract` | `schema:read` : un administrateur, la clé de service, ou une clé API qui la détient | Le contrat complet des collections, pour `rebase generate-sdk --from`. Sécurisé par défaut : `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` si défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |

## OpenAPI / Swagger

La spécification OpenAPI est générée automatiquement à partir des définitions de vos collections : elle décrit les points de terminaison de liste, de lecture, de création, de mise à jour, de suppression et en bloc de chaque collection gérée par le backend, avec leurs paramètres de requête et schémas de réponse. Il ne s'agit pas d'une cartographie complète de la surface HTTP — les routes d'authentification, de stockage, de fonctions et de cron sont documentées uniquement sur ce site — et les colonnes marquées `excludeFromApi` en sont exclues.

Pour une collection [`softDelete`](/docs/collections/soft-delete/), la spécification indique qu'une suppression, unitaire ou en bloc, déplace la ligne dans la corbeille, et documente `?hard=true` sur les deux suppressions et `?deleted=include|only` sur la liste, la lecture unitaire, le comptage et l'agrégat. L'explorateur d'API de Studio n'envoie que les paramètres que la spécification nomme : c'est donc ce qui lui permet de purger une ligne ou de lister la corbeille.

Les clients automatisés s'authentifient avec une clé restreinte plutôt qu'avec une session : [Clés API](/docs/backend/api-keys/).

## Métadonnées de schéma

Le schéma complet des collections du projet — chaque collection, propriété et relation — est accessible à un administrateur authentifié :

```bash
GET /api/meta/contract
```

Il exige la portée **`schema:read`**, que détient un administrateur, et sur un déploiement où aucune authentification n'est configurée, il n'est pas du tout accessible (404 `CONTRACT_UNAVAILABLE`) plutôt que d'exposer le schéma à tous. Son point de terminaison homologue renvoie une chaîne de version représentant le schéma sans le décrire, et est délibérément accessible sans aucun identifiant — ce qu'un job CI interroge régulièrement :

```bash
GET /api/meta/schema-version
```

Pour connaître la forme des points de terminaison plutôt que le schéma sous-jacent, le document OpenAPI est accessible via `GET /api/docs`, avec l'interface Swagger UI sur `/api/swagger` lorsque `enableSwagger` est activé.

## Prochaines étapes

- **[SDK typé](/docs/sdk)** — Client typé pour l'API REST
- **[Collections](/docs/collections)** — Définissez votre schéma de données
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôlez l'accès ligne par ligne
