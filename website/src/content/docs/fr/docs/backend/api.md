---
title: API REST
sidebar_label: API REST
description: Endpoints d'API REST générés automatiquement pour chaque collection, avec filtrage, tri, pagination et inclusion de relations.
---

## Vue d'ensemble

Rebase génère automatiquement une API complète à partir de vos définitions de collections :

- **API REST** — Endpoints CRUD pour chaque collection à `/api/data/:slug`
- **Spécification OpenAPI** — Spécification lisible par machine à `/api/docs`
- **Swagger UI** — Explorateur d'API interactif à `/api/swagger` (mode développement uniquement)

Aucun code n'est requis — définissez vos collections et l'API apparaît automatiquement.

## Endpoints REST

Pour chaque collection, les endpoints suivants sont générés :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités |
| `GET` | `/api/data/:slug/count` | Compter les entités |
| `GET` | `/api/data/:slug/:id` | Obtenir une seule entité |
| `POST` | `/api/data/:slug` | Créer une entité |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour une entité |
| `PUT` | `/api/data/:slug/:id` | Mettre à jour une entité |
| `DELETE` | `/api/data/:slug/:id` | Supprimer une entité |

### Routes de sous-collections

Les relations imbriquées sont accessibles via des chemins d'URL :

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post (PUT also accepted)
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mécanique de routage & analyse des segments

Pour gérer des profondeurs arbitraires de sous-collections imbriquées, Rebase route les requêtes entrantes à l'aide de la regex de paramètre `:rest{.+}` de Hono. Le moteur interne d'analyse des segments analyse les chemins en comptant les segments séparés par des barres obliques :
- **Nombre impair de segments** (par ex. `authors/42/posts` -> 3 segments) représente une requête de liste de collection.
- **Nombre pair de segments** (par ex. `authors/42/posts/7` -> 4 segments) représente une opération sur un ID d'entité spécifique. Le dernier segment est extrait comme `entityId` cible.

Le moteur filtre les espaces de noms système réservés (par ex. `history`) de l'analyse des segments de chemin afin d'éviter les collisions avec les endpoints intégrés.

## Authentification

Tous les endpoints de données requièrent une authentification par défaut. Incluez un token Bearer dans l'en-tête `Authorization` :

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Pour les appels serveur à serveur, utilisez la clé de service :

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
| `eq` | Égal (`==`) | `?active=eq.true` |
| `neq` | Différent (`!=`) | `?status=neq.draft` |
| `gt` | Supérieur à (`>`) | `?price=gt.100` |
| `gte` | Supérieur ou égal (`>=`) | `?price=gte.100` |
| `lt` | Inférieur à (`<`) | `?price=lt.50` |
| `lte` | Inférieur ou égal (`<=`) | `?price=lte.50` |
| `in` | Dans le tableau | `?status=in.(a,b,c)` |
| `nin` | Absent du tableau | `?status=nin.(a,b)` |
| `cs` | Le tableau contient | `?tags=cs.value` |
| `csa` | Le tableau contient l'un | `?tags=csa.(a,b)` |

### Opérateurs logiques

Utilisez `or` et `and` pour des conditions complexes :

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)
```

## Tri

Utilisez `orderBy` avec le format `field:direction` :

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

## Pagination

Utilisez `limit` et `offset`, ou `page` :

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses default limit of 20)
GET /api/data/products?page=3
```

La limite par défaut est **20**, le maximum est **100**.

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
        "hasMore": true
    }
}
```

Les réponses pour une seule entité renvoient un objet plat :

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "created_at": "2026-01-15T10:30:00Z"
}
```

## Recherche textuelle

Utilisez `searchString` pour la recherche en texte intégral sur les champs de type chaîne :

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Recherche vectorielle

Si une collection définit une propriété de type `vector`, vous pouvez effectuer des recherches de similarité à haute vitesse à l'aide d'opérations de distance pgvector compilées directement dans la requête de base de données.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Paramètres de requête vectorielle

| Paramètre | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | Le nom de la propriété vectorielle à interroger. |
| `vector` | `string` | Un tableau de flottants sérialisé en JSON représentant le vecteur de requête. |
| `vector_distance` | `string` | La métrique de distance à évaluer. Valeurs prises en charge : `cosine` (par défaut, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Seuil de distance maximal. Seuls les enregistrements dont la distance est inférieure à ce seuil sont renvoyés. |

## Inclusion de relations

Utilisez le paramètre `include` pour intégrer les entités liées :

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations
GET /api/data/articles?include=*
```

Les relations incluses sont intégrées directement dans la réponse :

```json
{
    "id": 1,
    "title": "Getting Started",
    "author_id": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Sélection de champs

Utilisez `fields` pour sélectionner des colonnes spécifiques :

```bash
GET /api/data/products?fields=id,name,price
```

## Pipeline de hooks du cycle de vie

Chaque opération de mutation REST (`POST`, `PUT`, `DELETE`) passe par un pipeline d'exécution de hooks strict et séquentiel :

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks bloquants vs. différés

1. **Hooks bloquants (`beforeSave`, `beforeDelete`)**
   Ces hooks sont exécutés de manière synchrone dans le cycle principal de la requête *avant* de valider la transaction de base de données. Ils peuvent modifier les charges utiles entrantes, exécuter des validations personnalisées ou interrompre entièrement la requête en levant une erreur.

2. **Hooks différés (`afterSave`, `afterDelete`)**
   Ces hooks s'exécutent de manière asynchrone après que la transaction de base de données a été validée avec succès. Ils utilisent des promesses différées (fire-and-forget), ce qui signifie qu'ils s'exécutent en arrière-plan et ne bloquent pas la réponse HTTP du client. Idéal pour envoyer des webhooks, déclencher des notifications push ou mettre en file d'attente des tâches externes.


## OpenAPI / Swagger

- **Spécification OpenAPI** : `GET /api/docs` — Renvoie la spécification JSON OpenAPI 3.0 complète
- **Swagger UI** : `GET /api/swagger` — Explorateur d'API interactif (mode développement uniquement)

La spécification OpenAPI est générée automatiquement à partir de vos définitions de collections et inclut tous les endpoints, paramètres de requête et schémas de réponse.

## Clés d'API

Les clés d'API fournissent une authentification machine-à-machine pour les agents, les serveurs MCP, les pipelines CI et les intégrations externes. Elles prennent en charge la portée des permissions par collection et un accès administrateur complet en option.

### Créer une clé d'API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

La réponse inclut la clé complète en texte clair (`rk_live_...`) **exactement une fois** — stockez-la immédiatement.

### Utiliser une clé d'API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permissions et RLS : deux barrières indépendantes

La requête d'une clé d'API passe par **deux** contrôles d'autorisation, et les deux doivent l'autoriser :

1. **La liste de permissions de la clé** — collection × opération, vérifiée au niveau de la couche de routage.
2. **Sécurité au niveau des lignes** — les clés d'API ne contournent *pas* la RLS. Une clé s'exécute en tant que
   `uid: "api-key:<id>"` avec le rôle `service` (plus `admin` lorsque
   `admin: true`). Les clés admin passent via les politiques admin intégrées ; une
   clé non-admin ne voit que les lignes qu'une règle de sécurité accorde explicitement au
   rôle `service` ou au public. Les règles de type propriétaire
   (`owner_id = auth.uid()`) ne correspondent jamais à une clé d'API.

Ainsi, une clé non-admin avec des permissions `"*"` peut tout de même obtenir des résultats vides — c'est
la RLS qui fonctionne, pas un bug. Accordez soit le rôle `service` dans les règles de sécurité des
collections concernées, soit utilisez une clé admin.

### Fonctions personnalisées

Les invocations de fonctions ont une portée comme les collections, sous l'espace de noms `functions` :
`{"collection": "functions", "operations": ["write"]}` accorde toutes les
fonctions, `"functions/<name>"` en accorde une, et le joker global `"*"` les accorde
toutes. Une clé sans une telle entrée ne peut pas invoquer de fonctions du tout.

### Stockage

Le stockage fonctionne de la même manière, sous l'espace de noms `storage` :
`{"collection": "storage", "operations": ["read", "write"]}` permet à la clé de
télécharger/lister (`read`), téléverser et créer des dossiers (`write`), et supprimer des fichiers
(`delete`). Le joker global `"*"` accorde également le stockage. Une clé sans une telle
entrée ne peut pas toucher au stockage. Les routes de téléversement reprenable TUS comptent comme `write`
à chaque étape (y compris la vérification de l'offset et l'annulation), de sorte qu'une clé à portée d'écriture
peut compléter un téléversement par elle-même.

### Agents et serveurs MCP

Un agent a besoin de la clé la *plus étroite* qui fasse son travail, pas d'une
clé admin. Commencez par une portée restreinte, et donnez-lui une expiration :

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Les opérations sont `read`, `write` et `delete`, dérivées de la méthode HTTP :
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Une clé à portée restreinte lit zéro ligne tant qu'une règle n'accorde pas `service`

C'est l'étape qui fait qu'une clé correctement restreinte a l'air cassée. Une
clé non-admin s'exécute en tant que `uid: "api-key:<id>"` avec les rôles
`["service"]`, et la politique RLS injectée par défaut dans chaque collection se
compile en :

```sql
auth.uid() IS NULL OR (string_to_array(auth.roles(), ',') && ARRAY['admin'])
```

— le contexte serveur, ou un admin. Une clé non-admin ne correspond à aucune des
deux branches : sur une collection sans `securityRules`, la requête réussit avec
un jeu de résultats vide et aucune erreur pour l'expliquer. Accordez le rôle
explicitement :

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Comme `auth.uid()` porte l'id de la clé, une règle peut aussi restreindre les
lignes à une clé précise :

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### N'utilisez pas `"*"` pour une clé en lecture seule

Le joker `"*"` ne couvre pas que les collections — il correspond aussi à
l'espace de noms `functions` et à `storage`. Un `GET` compte comme `read`, et le
handler d'une fonction personnalisée est du code arbitraire qui peut écrire :
une clé joker en lecture seule peut donc muter des données via une fonction.
Nommer les collections explicitement ne donne à la clé aucun accès aux
fonctions.

#### `--admin --full-access` : CI, migrations, outillage interne

`"admin": true` accorde à la clé le rôle admin — les routes `/api/admin/*` pour
la gestion du schéma, la gestion des utilisateurs et plus encore, plus cron,
sauvegardes et logs. Combinée à `--full-access` (`{"collection": "*",
"operations": ["read", "write", "delete"]}`), la clé détient toutes les
collections, ainsi que tout le stockage et toutes les fonctions personnalisées.
C'est la bonne forme pour la CI, les migrations et l'outillage interne de
confiance — pas pour les agents.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### Pas de temps réel avec les clés d'API

Le WebSocket temps réel n'interprète pas les jetons `rk_` — il accepte
uniquement les JWT utilisateur et la clé de service. Un agent authentifié par
une clé d'API interroge les endpoints REST au lieu de s'abonner.

### Options de la clé

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Étiquette lisible par l'humain |
| `permissions` | `ApiKeyPermission[]` | Accès par collection (`"*"` = tout ; `"functions/<name>"` = une fonction ; `"storage"` = stockage de fichiers) |
| `admin` | `boolean` | Accorder le rôle admin — routes admin + politiques admin RLS |
| `rate_limit` | `number \| null` | Requêtes par fenêtre de 15 min (`null` = la valeur par défaut du serveur, 1000) |
| `expires_at` | `string \| null` | Horodatage d'expiration ISO-8601 |

La CLI requiert une portée explicite : passez `--permissions '<json>'` ou optez pour
`--full-access` — il n'y a pas de valeur par défaut silencieuse d'accès complet.

Les clés peuvent être listées, mises à jour et révoquées via
`/api/admin/api-keys` ou les commandes CLI `rebase api-keys` — mais pas par une
clé d'API. Toute requête vers `/api/admin/api-keys` authentifiée avec une clé
`rk_` est refusée avec `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`, quel que soit
son drapeau `admin`. La gestion des clés requiert la session d'un utilisateur
admin, ou la clé de service.

## Endpoint de métadonnées

Obtenez une liste de toutes les collections disponibles et de leur structure :

```bash
GET /api/collections
```

## Étapes suivantes

- **[SDK client](/docs/sdk)** — Client typé pour l'API REST
- **[Collections](/docs/collections)** — Définissez votre schéma de données
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôlez l'accès par ligne
