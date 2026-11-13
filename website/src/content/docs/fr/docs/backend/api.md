---
sourceHash: 4fc45b4d1d08afde
title: API REST
sidebar_label: API REST
description: Points de terminaison d'API REST générés automatiquement pour chaque table, avec filtrage, tri, pagination et inclusion des relations.
---

## Vue d'ensemble

Rebase génère automatiquement une API complète à partir de vos tables :

- **API REST** — Points de terminaison CRUD pour chaque table sur `/api/data/:slug`
- **Spécification OpenAPI** — Spécification lisible par machine sur `/api/docs`, servie à chaque appelant connecté pour les tables qu'il est autorisé à voir
- **Swagger UI** — Explorateur d'API interactif sur `/api/swagger`, lorsque vous publiez le document (`REBASE_ENABLE_SWAGGER=true`, hors production)

Aucun code n'est requis — [déclarez vos tables](/docs/schema/) et l'API apparaît automatiquement.

## Points de terminaison REST

Pour chaque table, les points de terminaison suivants sont générés. Toutes les autres routes montées par le backend — auth, storage, admin, meta — se trouvent dans l'[index des points de terminaison](/docs/backend/endpoints/).

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités |
| `POST` | `/api/data/:slug/query` | Le même listage, avec ses paramètres de requête dans un corps JSON — pour une requête trop longue pour une URL. Voir [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | Compter les entités |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, éventuellement groupés. Accepte les mêmes filtres que le point de terminaison de liste, et le RLS s'applique aux lignes agrégées — voir [Interrogation](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obtenir une entité unique |
| `POST` | `/api/data/:slug` | Créer un enregistrement |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour un enregistrement (partiel — seules les propriétés envoyées sont écrites) |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs entités en une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs entités en une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs entités en une seule transaction |
| `POST` | `/api/data/_batch` | Écrire **à travers** plusieurs tables en une seule transaction |

### Routes imbriquées

Les relations sont accessibles via les chemins d'URL :

```
GET    /api/data/authors/42/posts         → list author's posts
POST   /api/data/authors/42/posts/query   → the same listing, parameters in the body (0.24+)
POST   /api/data/authors/42/posts/count   → the same count, parameters in the body (0.24+)
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mécanismes de routage et analyse des segments

Pour gérer des profondeurs d'imbrication arbitraires, Rebase route les requêtes entrantes à l'aide de l'expression régulière de paramètre `:rest{.+}` de Hono. Le moteur interne d'analyse des segments analyse les chemins en comptant les segments séparés par des barres obliques :
- **Nombre impair de segments** (par ex. `authors/42/posts` -> 3 segments) représente une requête de liste sur la table associée.
- **Nombre pair de segments** (par ex. `authors/42/posts/7` -> 4 segments) représente une opération sur un identifiant de ligne spécifique. Le dernier segment est extrait pour servir d'identifiant cible.

Le moteur exclut les espaces de noms système réservés (par ex. `history`) de l'analyse des segments de chemin afin d'éviter les collisions avec les points de terminaison intégrés.

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

Le filtrage d'une liste — opérateurs `?field=op.value`, groupes `or`/`and`, dialecte JSON `where` et leur combinaison — dispose de [sa propre page](/docs/backend/filtering).

## Tri

Utilisez `orderBy` au format `field:direction` :

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Une direction absente vaut `asc`. Une direction qui n'est ni `asc` ni `desc`, ou un champ que la table ne possède pas, renvoie un code **400** — et non un 200 avec les lignes dans l'ordre arbitraire choisi par la base de données, ce qui serait indiscernable d'un tri ayant fonctionné.

### Plusieurs clés

La syntaxe abrégée prend en charge une seule clé. Pour en utiliser davantage, passez un tableau JSON — la deuxième clé départage les lignes considérées comme égales par la première :

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Les deux syntaxes s'appliquent à chaque route qui liste des lignes, y compris les routes imbriquées (`/api/data/authors/:id/posts`). Chaque tri se termine par l'identifiant de ligne par ordre décroissant, que vous l'ayez demandé ou non : c'est ce qui rend le tri total, et paginer sur un ordre qui n'est pas total répète et saute des lignes.

Un paramètre `?orderBy=` répété ne constitue pas un tri multi-clés — le dernier l'emporte, comme pour tout autre paramètre de requête. Utilisez le tableau.

### Emplacement des valeurs NULL dans le tri

Par défaut, les valeurs NULL sont triées **en dernier par ordre croissant et en premier par ordre décroissant**, ce qui correspond à la convention propre à Postgres. Un troisième segment séparé par deux-points permet de modifier cela :

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La forme en tableau JSON accepte une clé `"nulls"` pour obtenir le même résultat :

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Toute valeur autre que `first` ou `last` renvoie une erreur 400, et non un ordre silencieusement différent. Le curseur ci-dessous respecte ce que le tri a déclaré, de sorte que la pagination sur une clé nullable reste correcte quel que soit le placement choisi.

## Pagination

Utilisez `limit` et `offset`, ou `page` — l'un ou l'autre :

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

La limite par défaut est de **50**, le maximum est de **1000**. Les deux proviennent de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, ce que la spécification OpenAPI générée indique également — une `limit` supérieure au maximum est rejetée plutôt qu'ajustée.

Les trois paramètres de fenêtre sont rejetés plutôt que corrigés, et chacun s'identifie clairement : `INVALID_LIMIT`, `INVALID_OFFSET` (un entier supérieur ou égal à 0) et `INVALID_PAGE` (un entier supérieur ou égal à 1). Une fenêtre discrètement différente de celle demandée ne peut pas être distinguée du fait d'avoir atteint la fin de la table, raison pour laquelle aucun d'eux n'est ajusté ou ignoré.

Pour la même raison, l'utilisation conjointe de `page` et `offset` renvoie un code 400 `PAGE_WITH_OFFSET` au lieu que l'un d'eux l'emporte discrètement.

### Ignorer le comptage

`meta.total` correspond à un `COUNT(*)` sur chaque ligne correspondante — sur une table volumineuse, cela représente l'essentiel du coût d'une requête de listage. `?count=none` (`GET /api/data/orders?count=none`) permet de l'ignorer : pas de `meta.total`, tandis que `meta.hasMore` reste exact (la lecture demande une ligne supplémentaire au-delà de la page). `?count=exact` est la valeur par défaut ; toute autre valeur déclenche une erreur 400 `INVALID_COUNT`. Une lecture avec `?distinct=true` n'est jamais comptée, de même qu'une recherche vectorielle avec un `vector_threshold` (voir [Recherche vectorielle](/docs/backend/vector-search/)).

### Pagination par curseur

`offset` recompte les lignes à chaque requête, de sorte qu'une ligne insérée ou supprimée entre deux pages décale la fenêtre et le parcours saute ou répète silencieusement des lignes. `?after=` effectue plutôt une recherche directe : la page suivante commence strictement après la dernière ligne servie.

Chaque réponse de liste comporte `meta.nextCursor` tant qu'il reste une autre page. Renvoyez-le tel quel :

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Le curseur est **opaque** — il encode les clés de tri *ainsi que* les valeurs de la dernière ligne pour ces clés — d'où trois règles, chacune renvoyant une erreur 400 plutôt qu'une mauvaise page :

| Situation | Code |
|-----------|------|
| `after` avec `offset` ou `page` | `CURSOR_WITH_OFFSET` — les deux définissent le début de la page |
| `after` avec un `orderBy` différent de celui avec lequel il a été émis | `CURSOR_ORDER_MISMATCH` |
| Un curseur non émis par cette API | `INVALID_CURSOR` |

Une requête qui ne spécifie aucun `orderBy` **adopte celui du curseur**, donc renvoyer `meta.nextCursor` sans redéfinir le tri fonctionne.

Les tris multi-clés et les clés nullables paginent tous deux correctement : la comparaison est construite sur chaque clé dans l'ordre, avec le placement des NULL déclaré par le tri. Le seul ordre qu'aucun curseur ne peut décrire est la pertinence (`_score`) — calculée par requête et stockée nulle part — et un tel listage ne comporte tout simplement aucun `nextCursor`.

## Sélection de colonnes

`?fields=` restreint une lecture aux colonnes spécifiées. Il s'agit d'une projection intégrée à la requête, et non d'un filtrage a posteriori de la réponse :

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La clé primaire est toujours renvoyée (une ligne qui ne peut pas être adressée ne peut être ni mise à jour, ni supprimée, ni dépassée par pagination — et le curseur en est dérivé), et les colonnes `.private()` restent masquées, qu'elles soient nommées ou non. Une colonne inconnue renvoie un code 400 `UNKNOWN_FIELD` plutôt qu'une ligne manquant discrètement d'un champ.

Une relation spécifiée dans `?include=` est renvoyée, que `?fields=` la nomme ou non : `?include=author&fields=title` renvoie `title`, la clé et `author`. Spécifier également la relation dans `?fields=` est autorisé et ne change rien.

`?distinct=true` fusionne les lignes identiques sur ces colonnes :

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Cette option est rejetée (400) en présence d'un `searchString` classé ou d'une recherche vectorielle, qui attribuent un score par ligne rendant chaque ligne distincte par définition, ainsi que lorsque `orderBy` nomme une colonne que `fields` ne renvoie pas (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres ne peut pas ordonner une lecture DISTINCT selon une expression absente de sa clause SELECT.

`?fields=` et `?distinct=` fonctionnent également sur la route de récupération par identifiant et sur les routes imbriquées.

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

`nextCursor` est présent tant que `hasMore` est vrai et que la page a renvoyé au moins une ligne ; il est absent sur la dernière page et lors d'un tri qu'aucun curseur ne peut décrire.

Les réponses pour une entité unique renvoient un objet plat :

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Erreurs

Chaque échec, provenant de n'importe quelle route, est renvoyé dans une même enveloppe :

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

`message` et `code` sont toujours présents. `details` apparaît lorsque le rejet concerne *quelque chose de précis* — le champ erroné, les chemins ayant échoué. `requestId` apparaît lorsque la requête comportait un en-tête `X-Request-ID` ou qu'un lui a été attribué ; il est également renvoyé dans l'en-tête de réponse, et c'est l'élément à citer dans un rapport de bogue.

**Effectuez vos branchements logiques sur `code`, jamais sur `message` ou sur le statut seul.** Les codes sont en `SCREAMING_SNAKE_CASE` et stables ; les messages sont rédigés pour une personne lisant une console et peuvent changer librement. Le statut HTTP se trouve sur la réponse, pas dans le corps.

| Statut | Code typique | Signification |
|--------|--------------|-------|
| 400 | `BAD_REQUEST`, `INVALID_INPUT`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La requête est mal formée ou demande une opération impossible |
| 401 | `UNAUTHORIZED` | Pas d'identifiant d'authentification, ou un identifiant qui ne correspond à personne |
| 403 | `FORBIDDEN`, `SCOPE_MISSING`, `WRITE_DENIED` | Un identifiant valide mais sans les permissions requises |
| 404 | `NOT_FOUND` | La ressource ciblée n'existe pas |
| 409 | `CONFLICT` | Conflit d'état — une clé en double, un arbre désynchronisé |
| 501 | varie | La fonctionnalité existe mais n'est **pas configurée** sur ce déploiement |
| 503 | `SERVICE_UNAVAILABLE` | Une dépendance est indisponible ; la requête ne l'a jamais atteinte |

Une fonctionnalité absente parce que ce déploiement ne l'a pas activée renvoie une erreur 501 avec un code et une raison, et non une 404 — une 404 inexpliquée sur une route que l'interface utilisateur vient d'appeler ressemble à un déploiement défectueux.

Les routes ajoutent leurs propres codes plus spécifiques en plus de ceux-ci (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), considérez donc la liste des codes comme ouverte. Le SDK typé les transforme tous en une seule erreur `RebaseApiError` comportant `status`, `code` et `details` — voir [Gestion des erreurs](/docs/backend#error-handling).

## Recherche de texte

Utilisez `searchString` pour la recherche en texte intégral sur les champs textuels :

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Recherche vectorielle

Une table dotée d'une colonne `col.vector()` prend en charge une recherche des plus proches voisins sur le listage : `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, avec `vector_distance` et `vector_threshold` optionnels. Les paramètres, les seuils et le comportement des filtres sur l'index sont détaillés sur la page [Recherche vectorielle](/docs/backend/vector-search/).

## Requêtes trop longues pour une URL

`POST /api/data/:slug/query` (ce listage) et `POST /api/data/:slug/count` prennent les paramètres de requête dans un corps JSON, pour une requête dont l'URL ne conviendrait pas — un plongement (embedding), une longue liste `in`.
Voir [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url).

## Inclusion de relations

Utilisez le paramètre `include` pour intégrer des entités associées :

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Un nom qui n'est pas une relation de la table renvoie une erreur **400 `UNKNOWN_RELATION`**, à chaque niveau. Il était auparavant ignoré, ce qui renvoyait un code 200 avec le champ simplement manquant — indiscernable d'une ligne n'ayant véritablement aucune ligne associée, de sorte qu'une faute de frappe ressemblait exactement à des données vides. Un chemin de plus de trois sauts déclenche `INCLUDE_TOO_DEEP`. Un nom correspond à la clé exacte de la relation dans les `relations` de la table ; les syntaxes en slug et en snake_case tentées par les anciennes versions ne le sont pas. Les lignes associées sont renvoyées selon le [`orderBy`](/docs/collections/relations/) déclaré de la relation lorsque la requête n'en spécifie aucun, et une clé étrangère générée par une relation sur une colonne `bigint` ou `numeric` est renvoyée sous forme de nombre.

### Restreindre une relation

La forme séparée par des virgules ne permet pas de spécifier une `limit` par relation, c'est pourquoi `include` accepte également du JSON — reconnaissable à son accolade ouvrante :

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Clé | Signification |
|-----|---------|
| `limit` | Lignes **par ligne parente**, et non sur l'ensemble de la page. Appliqué par la requête, de sorte que les lignes au-delà ne sont jamais lues depuis la base de données |
| `where` | Le même dialecte de filtrage que le `where` de premier niveau |
| `logical` | Un groupe `or`/`and`/`not` sur les lignes associées |
| `orderBy` | La même syntaxe de tri, y compris l'emplacement des NULL. Les ex æquo, ainsi qu'une `limit` sans `orderBy`, s'ordonnent selon la clé de la ligne associée, par ordre croissant |
| `fields` | Colonnes de la ligne *associée* ; sa clé est toujours conservée |
| `include` | Relations de la ligne associée, à leur tour |
| `count` | `true` renvoie également le total de chaque parent sous `_count` (`"_count":{"comments":37}`), compté par la même instruction. Relations to-many (un-à-plusieurs) uniquement. Voir [Compter ce qu'une limite exclut](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

`true` signifie « tout charger », ainsi `{"author":true}` et `author` constituent la même requête.
Les deux syntaxes fonctionnent sur la route de liste, la route de récupération par identifiant et les routes imbriquées.

Chaque saut correspond à une seule requête groupée pour toute la page, jamais une par ligne.

Les relations incluses sont directement intégrées dans la réponse :

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

Une ligne incluse correspond à ce que la route propre à la cible (`GET /api/data/authors/42`) sert : les mêmes colonnes et encodages, les clés étrangères sous forme de colonnes, sans objets de référence.

## Écriture

Les clés d'idempotence, les écritures conditionnelles (`ETag` / `If-Match`), les opérations sur les champs (`$inc`, `$push`, `$pull`, `$merge`), l'upsert sur une clé naturelle, `Prefer: return=minimal`, ainsi que le point de terminaison multi-tables `POST /api/data/_batch` sont tous détaillés sur leur propre page : **[Écriture via REST](/docs/backend/writes/)**.

## Pipeline des hooks de cycle de vie

Sur Postgres, chaque mutation REST (`POST`, `PATCH`, `DELETE`) exécute les hooks de sa table dans l'ordre, au sein de l'unique transaction qui porte l'écriture :

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Chaque hook est attendu (awaited), et une exception levée par l'un d'eux annule l'intégralité de l'écriture :

1. **`beforeSave`, `beforeDelete`** s'exécutent avant l'écriture. Ils peuvent modifier les valeurs entrantes, valider ou refuser la requête en levant une exception — l'appelant reçoit un code **400 `CALLBACK_REJECTED`** et rien n'est écrit.
2. **`afterSave`, `afterDelete`** s'exécutent après l'écriture mais *avant* le commit. Une exception annule l'opération sur la ligne (rollback) et renvoie la même erreur 400, avec `details.stage` indiquant le nom du hook. Ils maintiennent la transaction ouverte pendant leur exécution, ce qui en fait le mauvais endroit pour un webhook ou tout autre appel réseau — la page [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) explique où placer ce travail.

## Points de terminaison système

| Méthode | Chemin | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` et `/api/health` | aucun | Vérification de vivacité/disponibilité (liveness/readiness) |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> par défaut, les appelants auxquels `GET /api/schema/tables` décrit les tables (401 anonyme sauf si `schemaTables.public`) ; aucun lorsque `enableSwagger` est `true` ; la barrière admin lorsqu'il est `false` | La spécification JSON OpenAPI 3.0 — par défaut uniquement les tables, colonnes et relations que le point de terminaison de schéma décrit à cet appelant. `404 DOCS_UNAVAILABLE` lorsqu'aucune authentification n'est configurée |
| `GET` | `/api/swagger` | aucun | Swagger UI. Servi uniquement lorsque `enableSwagger` est `true` (`REBASE_ENABLE_SWAGGER=true`), et jamais en production |
| `GET` | `/api/meta/schema-version` | aucun | Le hash du schéma à partir duquel ce backend a été compilé, ainsi que la version du runtime — délibérément non authentifié, et ne contenant rien qui décrive le schéma |
| `GET` | `/api/meta/contract` | `schema:read` : un administrateur, la clé de service ou une clé d'API la détenant | La version du schéma, le runtime et chaque table telle qu'un administrateur la voit, pour `rebase generate-sdk --from`. Sécurité par défaut (fail-closed) : `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |

## OpenAPI / Swagger

La spécification OpenAPI est générée automatiquement à partir de vos tables : elle décrit les points de terminaison de liste, query, count, aggregate, lecture, création, mise à jour, suppression et opérations en masse (bulk) de chaque table servie par le backend, ses routes imbriquées et `_batch`, avec leurs paramètres de requête et schémas de réponse. Il ne s'agit pas d'une cartographie complète de l'ensemble de la surface HTTP — les routes d'authentification, de stockage, de fonctions et de cron sont documentées uniquement sur ce site — et les colonnes marquées `.private()` en sont exclues. La `description` d'une table et le `.describe()` d'une colonne constituent ses descriptions.

Pour une table avec [`softDelete`](/docs/collections/soft-delete/), la spécification indique qu'une suppression, individuelle ou en masse, déplace la ligne dans la corbeille, et documente `?hard=true` pour les deux types de suppression ainsi que `?deleted=include|only` pour la liste, la lecture unique, le comptage et l'agrégation. L'explorateur d'API de Studio n'envoie que les paramètres mentionnés dans la spécification, c'est donc ce qui lui permet de purger une ligne ou de lister la corbeille.

Les appelants automatisés (machines) s'authentifient avec une clé pourvue de portées (scopes) plutôt qu'avec une session : [Clés d'API](/docs/backend/api-keys/).

## Métadonnées du schéma

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

Les tables servies par le backend sont décrites, par appelant, sur `GET /api/schema/tables` — les descripteurs à partir desquels le CMS et le Studio effectuent leur rendu. Tout appelant connecté reçoit les tables qu'il est autorisé à voir, restreintes à ce qu'il peut lire ; la matrice est disponible sur [Points de terminaison](/docs/backend/endpoints/#schema).

L'ensemble du schéma tel qu'un administrateur le voit est servi sur :

```bash
GET /api/meta/contract
```

```json
{ "schemaVersion": "v2:…", "runtime": { "version": "0.30.1", "contract": 2 }, "tables": [ … ] }
```

Il nécessite la portée **`schema:read`**, détenue par un administrateur, et sur un déploiement où aucune authentification n'est configurée, il n'est pas du tout servi (404 `CONTRACT_UNAVAILABLE`) plutôt que d'exposer le schéma à n'importe qui. Les versions de schéma commencent par `v2:` depuis la version 0.31 : elles sont calculées à partir des tables compilées, de sorte que la version de chaque projet a changé une fois. Son homologue renvoie une chaîne de version qui représente le schéma sans le décrire, et est délibérément accessible sans identifiant — ce qu'interroge un job de CI :

```bash
GET /api/meta/schema-version
```

Pour la structure des points de terminaison plutôt que pour le schéma qui les sous-tend, le document OpenAPI est disponible sur `GET /api/docs` : une fois connecté, vous obtenez le document des tables que vous êtes autorisé à voir. Swagger UI sur `/api/swagger` n'est servi que lorsque le document est publié avec `REBASE_ENABLE_SWAGGER=true`, hors production.

## Prochaines étapes

- **[SDK typé](/docs/sdk)** — Client sécurisé au niveau des types pour l'API REST
- **[Tables](/docs/schema/)** — Définissez votre schéma de données
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôlez l'accès ligne par ligne
