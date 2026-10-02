---
sourceHash: 1806e56473009c2c
title: Clés API
sidebar_label: Clés API
description: "Des clés de longue durée pour les scripts, la CI, les agents et les intégrations : clés de service et clés personnelles, les portées qu'elles détiennent, leur articulation avec la sécurité au niveau des lignes, et les routes qui les gèrent."
---

## Clés API

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Une clé API est un identifiant bearer de longue durée, `rk_live_…`, pour un appelant qui
n'est pas une personne dans un navigateur : un script, un job de CI, un agent, un client MCP, un autre
service. Ce qu'une clé peut faire est une liste de [portées](/docs/backend/roles-and-scopes/),
comme `data:read:orders` ou `cron:write`.

Il en existe deux types :

- Une **clé de service** est l'identité machine propre au projet. Elle agit en tant que
  `api-key:<id>`, pas en tant que personne. Quiconque détient `keys:write` les gère, sous
  `/api/admin/api-keys`.
- Une **clé personnelle** agit en tant que le compte qui l'a créée. Chaque compte gère les
  siennes, sous `/api/auth/keys`, quand l'application les active.

### Utiliser une clé

Envoyez-la comme jeton bearer, comme un jeton d'accès. `$API_URL` est l'adresse de votre
backend : ce que `rebase dev` a affiché, ou l'URL de votre déploiement.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La même clé fonctionne sur l'API REST, le stockage, les fonctions personnalisées, les surfaces
d'administration que ses portées atteignent, le WebSocket temps réel et le [point de terminaison `/mcp`](/docs/ai/mcp/#the-remote-endpoint).

## Clés de service

### En créer une

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Une clé de service a besoin d'un nom et d'au moins une portée.

```bash
# CLI: talks to the backend with the service key from .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: needs keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

Ou avec le SDK client :

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // the only time the plaintext is returned
```

La réponse inclut la clé complète en texte brut (`rk_live_...`) **exactement une fois**.
Enregistrez-la immédiatement.

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Un libellé pour les humains |
| `scopes` | `string[]` | Ce que la clé peut faire. Au moins une portée |
| `roles` | `string[]` | Rôles RLS sous lesquels la clé s'exécute, à côté de `service`. Facultatif |
| `rate_limit` | `number \| null` | Requêtes par fenêtre de 15 minutes. `null` ou absent utilise la valeur par défaut du serveur pour les clés API, 1000 |
| `expires_at` | `string \| null` | Expiration ISO-8601. Absent signifie qu'elle n'expire jamais |

### Portées et RLS : deux barrières indépendantes

Une requête faite avec une clé passe deux vérifications, et les deux doivent l'autoriser :

1. **Les portées de la clé**, vérifiées par la route : `data:write:orders` permet à la clé
   d'écrire dans `orders` et nulle part ailleurs.
2. **La sécurité au niveau des lignes (RLS)**, vérifiée par la base de données. Une clé ne la
   contourne jamais. Une clé de service s'exécute en tant que `uid: "api-key:<id>"` avec le rôle
   `service`, plus les `roles` qu'on lui a donnés. Les règles de type propriétaire
   (`owner_id = rebase.uid()`) ne lui correspondent jamais.

Ainsi, une clé qui détient `data:read` peut quand même obtenir des résultats vides. C'est le RLS
qui fonctionne, pas un bug. Accordez le rôle `service` dans les règles de sécurité de la
collection, ou donnez à la clé le rôle `admin`.

#### Une clé de service lit zéro ligne tant qu'une règle n'accorde pas `service`

C'est l'étape qui donne l'impression qu'une clé aux portées correctes ne fonctionne pas. La
politique RLS que Rebase ajoute par défaut à chaque collection compile vers :

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

C'est le contexte serveur, ou un administrateur. Une clé de service sans le rôle `admin` ne
correspond à aucune des deux branches. Sur une collection sans `securityRules`, la requête réussit
avec un résultat vide et aucune erreur qui explique pourquoi. Accordez le rôle explicitement :

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Puisque `rebase.uid()` porte l'identifiant de la clé, une règle peut aussi restreindre les lignes
à une seule clé :

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Le rôle `admin`

`roles: ["admin"]` (`--roles admin` dans le CLI) fait aussi s'exécuter la clé sous le rôle RLS
`admin` : elle passe donc les politiques admin par défaut et lit toutes les lignes de chaque
collection qui les conserve. C'est une affirmation sur les lignes. Elle n'accorde aucune
portée : la clé n'atteint toujours que ce que listent ses `scopes`.

Un créateur ne peut donner à une clé que des rôles qu'il détient lui-même, sauf s'il est
administrateur.

### Accès complet, pour la CI et les migrations

<span class="since-badge" data-since="0.24">Depuis 0.24</span> `--full-access` donne à la clé toutes les portées que détient son créateur, moins `keys:read` et
`keys:write`, qu'aucune clé ne peut détenir. Via le CLI, qui utilise la clé de service, cela fait
toutes les portées du plan des données et du plan d'administration. Ajoutez `--roles admin` et la
clé lit aussi toutes les lignes :

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

C'est la bonne configuration pour la CI, les migrations et les outils internes de confiance. Ce
n'est pas la bonne pour un agent.

## Clés personnelles

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Une clé personnelle agit **en tant que son propriétaire** : son uid, et ses rôles tels qu'ils sont à
chaque requête. Les règles de type propriétaire lui correspondent, donc elle lit exactement ce que
son propriétaire lirait, restreint par ses portées. Elle convient aux scripts d'une personne, à un
CLI sur son ordinateur portable, ou à un outil qu'elle connecte à son propre compte.

Elles sont désactivées par défaut, car chacune est un identifiant de longue durée pour un compte.
Activez-les dans le bloc auth de la collection des utilisateurs :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true, personalKeys: true },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Ensuite, un compte connecté gère ses propres clés :

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

La même chose en REST. `$ACCESS_TOKEN` est le jeton d'accès propre au compte, obtenu à la
connexion :

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Une clé personnelle accepte `name`, `scopes` et `expires_at`. Elle ne porte pas de `roles`, car
elle s'exécute avec ceux de son propriétaire, ni de `rate_limit`. Envoyer l'un ou l'autre donne
`400 INVALID_INPUT`.

Ce que détient une clé personnelle, ce sont ses portées, réduites à ce que son propriétaire
détient **maintenant**. Retirez un rôle au propriétaire et chaque clé qu'il a créée se réduit avec
lui. Supprimez le compte et ses clés cessent de fonctionner. Désactivez `personalKeys` et toutes
les clés personnelles cessent aussi de fonctionner.

Seul un compte peut avoir des clés personnelles. Une clé API, la clé de service et une session
invité sont refusées : `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` pour une clé,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` pour les deux autres. Quand la fonctionnalité est désactivée,
chaque route répond `403 PERSONAL_KEYS_DISABLED`.

## Ce que chaque portée atteint

### Données

`data:read`, `data:write` et `data:delete`, simples ou restreintes à une collection
(`data:read:posts`). L'opération vient de la méthode HTTP : `GET`, `HEAD` et `OPTIONS` lisent,
`POST`, `PUT` et `PATCH` écrivent, `DELETE` supprime. `POST /api/data/:slug/bulk/delete` compte
comme une suppression, bien que ce soit un `POST`.

Sur un chemin imbriqué, l'opération est vérifiée sur la collection où aboutit le chemin, et chaque
collection traversée exige `data:read`. Une clé qui ne détient que `data:read:posts` est refusée
sur `/api/data/authors/1/posts` tant qu'elle ne peut pas aussi lire `authors`.

### Stockage

`storage:read` liste et télécharge. `storage:write` téléverse et crée des dossiers, et couvre
chaque étape d'un téléversement avec reprise (TUS), y compris la vérification du décalage et
l'annulation. `storage:delete` supprime. La cible est un identifiant de source de stockage.
L'identifiant de la source par défaut est `(default)`, donc `storage:read:(default)` ne lit que la
source par défaut, et `storage:write:avatars` écrit dans une source nommée `avatars`.
Après la vérification de la portée, [`storageAuthorize`](/docs/backend/storage/#per-object-authorization)
s'exécute quand même, avec l'identité de la clé.

### Fonctions

`functions:invoke` appelle toutes les fonctions personnalisées. `functions:invoke:<name>` en
appelle une. Lister les fonctions sur `GET /api/functions` exige la portée simple.

Ne donnez pas `functions:invoke` à une clé que vous voulez en lecture seule. Une fonction est du
code, et elle peut écrire. Dans une fonction, `getScopes(c)` et `hasScope(c, …)` lisent ce que la
clé détient, et une application peut déclarer ses propres portées qu'une fonction vérifiera. Voir
[Fonctions personnalisées](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Surfaces d'administration

Une portée du plan d'administration sur une clé atteint la surface correspondante. Un
planificateur qui déclenche des tâches cron a besoin de `cron:write`. Un collecteur de journaux a
besoin de `logs:read`. Un job de sauvegarde a besoin de `backups:read`. L'[index des
endpoints](/docs/backend/endpoints/#admin) liste la portée qu'exige chaque route.

`keys:read` et `keys:write` ne peuvent jamais aller sur une clé. Une clé qui pourrait gérer des
clés pourrait créer sa propre remplaçante, ou s'élargir. Toute requête vers les routes des clés
faite avec une clé est refusée avec `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gérez les clés en tant
que personne qui détient `keys:write`, ou avec la clé de service.

### Temps réel

Une clé authentifie aussi le WebSocket : envoyez-la dans le message `AUTHENTICATE`. Les lectures
et les abonnements exigent `data:read` sur leur collection, les enregistrements `data:write`, les
suppressions `data:delete`. Un abonnement à un chemin imbriqué exige la portée simple. Les canaux
(diffusion et présence) sont refusés pour les clés. Les messages de l'éditeur SQL et des branches
exigent `database:read` ou `database:write`.

## Agents et serveurs MCP

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Un agent a besoin de la clé la *plus restreinte* qui fait son travail. Commencez avec des portées
limitées, et donnez-lui une expiration :

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Laissez de côté `data:delete` quand l'agent peut modifier mais ne doit pas supprimer. `delete` est
séparé de `write` précisément pour cette raison.

## Règles de création

Chaque clé est vérifiée par rapport à celui qui la crée, de la même manière sur les deux routes :

| Refus | Quand |
|---|---|
| `400 INVALID_SCOPES` | Une portée est malformée, inconnue, ou porte une cible qu'elle n'accepte pas. `details.validScopes` liste toutes les portées valides |
| `400 UNKNOWN_SCOPE_TARGET` | Une cible nomme une collection, une source de stockage ou une fonction que ce backend ne sert pas |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` ou `keys:write` a été demandée |
| `403 SCOPE_EXCEEDS_CREATOR` | Une portée que le créateur ne détient pas. Une clé ne détient jamais plus que le compte qui l'a créée |
| `403 ROLE_EXCEEDS_CREATOR` | Un rôle de clé de service que le créateur ne détient pas, quand le créateur n'est pas administrateur |

Une requête pour laquelle la clé elle-même n'a pas la portée répond `403 SCOPE_MISSING`, avec la
portée dans `details.requiredScope`. Voir [Codes d'erreur](/docs/backend/errors/#authentication-and-accounts).

## Gérer les clés

| Méthode | Chemin | Exige |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifie `name`, `scopes`, `roles`, `rate_limit` ou `expires_at`, selon les mêmes règles que la création |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Révoque |
| `GET` | `/api/auth/keys` | Un compte : ses propres clés personnelles |
| `POST` | `/api/auth/keys` | Un compte, avec `personalKeys` activé |
| `DELETE` | `/api/auth/keys/:id` | Un compte : révoque l'une des siennes |

Chaque route renvoie les clés masquées : `key_prefix`, jamais le hash. Chaque clé indique son
`kind` (`service` ou `personal`), ses `scopes`, ses `roles` et, pour une clé personnelle, son
`owner_uid`.

Le CLI couvre les clés de service : `rebase api-keys list`, `get`, `create`, `revoke`, et `scopes`,
qui liste toutes les portées que le backend connaît. Voir la
[référence du CLI](/docs/cli/#rebase-api-keys).

## Clés créées avant les portées

Les clés créées avant l'existence des portées portent une liste `permissions` et un indicateur
`admin`. Au démarrage, le store donne à chacune les portées qu'elle détient désormais. Rien ne
s'élargit ; là où une ancienne autorisation n'a pas d'équivalent exact, elle se restreint :

| Ancienne autorisation | Portées désormais |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` et `storage:<op>` pour chaque opération, plus `functions:invoke` si elle avait `write` |
| `"storage"` | `storage:<op>` pour chaque opération |
| `"functions"` | `functions:invoke`, seulement si elle avait `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, seulement si elle avait `write` |
| `admin: true` | le rôle `admin`, plus `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Le secret ne change pas, donc une intégration continue de fonctionner. Deux autorisations se
restreignent :

- Une autorisation de fonction sans `write` ne devient rien. Un `GET` comptait comme une
  lecture, mais une fonction est du code, et l'appeler n'est pas une lecture.
- Une clé admin n'obtient aucune portée `database:*`, qu'elle ne pouvait jamais atteindre
  auparavant, et aucune portée `keys:*`, qu'aucune clé ne peut détenir.

Les anciennes colonnes `permissions` et `admin` restent en place, de sorte qu'un retour à un
runtime plus ancien lit toujours ses clés. Une requête qui envoie `permissions` ou `admin` au lieu
de `scopes` est refusée avec `400 INVALID_INPUT`.

## Prochaines étapes

- [Rôles et portées](/docs/backend/roles-and-scopes/) : toutes les portées, et comment les rôles les détiennent
- [Index des endpoints](/docs/backend/endpoints/) : la portée qu'exige chaque route
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : ce que la base de données applique en plus des portées d'une clé
