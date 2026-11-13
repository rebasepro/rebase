---
sourceHash: 92edb85e26e286c4
title: Clés API
sidebar_label: Clés API
description: "Clés à longue durée de vie pour les scripts, la CI, les agents et les intégrations : clés de service et clés personnelles, les scopes qu'elles détiennent, leur composition avec la sécurité au niveau des lignes (RLS), et les routes qui les gèrent."
---

## Clés API

Une clé API est un identifiant porteur (bearer credential) à longue durée de vie, `rk_live_…`, pour un appelant qui n'est pas une personne dans un navigateur : un script, un job CI, un agent, un client MCP, un autre service. Ce qu'une clé est autorisée à faire est défini par une liste de [scopes](/docs/backend/roles-and-scopes/), tels que `data:read:orders` ou `cron:write`.

Il en existe deux types :

- Une **clé de service** est l'identité machine propre au projet. Elle agit en tant qu'`api-key:<id>`, et non en tant que personne. Toute personne détenant `keys:write` les gère, sous `/api/admin/api-keys`.
- Une **clé personnelle** agit en tant que compte qui l'a créée. Chaque compte gère les siennes, sous `/api/auth/keys`, lorsque l'application les active.

### Utilisation d'une clé

Envoyez-la en tant que jeton porteur (bearer token), comme un jeton d'accès. `$API_URL` est l'adresse de votre backend : celle affichée par `rebase dev` ou l'URL de votre déploiement.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La même clé fonctionne sur l'API REST, le stockage, les fonctions personnalisées, les surfaces d'administration couvertes par ses scopes, le WebSocket temps réel et le [point de terminaison `/mcp`](/docs/ai/remote-mcp/).

## Clés de service

### En créer une

Une clé de service nécessite un nom et au moins un scope.

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

La réponse inclut la clé complète en clair (`rk_live_...`) **exactement une seule fois**. Conservez-la immédiatement.

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Un libellé lisible par des humains |
| `scopes` | `string[]` | Ce que la clé peut faire. Au moins un |
| `roles` | `string[]` | Rôles RLS sous lesquels la clé s'exécute, en plus de `service`. Facultatif |
| `rate_limit` | `number \| null` | Requêtes par fenêtre de 15 minutes. `null` ou absent utilise la valeur par défaut du serveur pour les clés API, 1000. Voir [Limite de débit](#limite-de-débit) |
| `expires_at` | `string \| null` | Expiration ISO-8601. Absent signifie qu'elle n'expire jamais |

### Scopes et RLS : deux barrières indépendantes

Une requête effectuée avec une clé passe par deux vérifications, et les deux doivent l'autoriser :

1. **Les scopes de la clé**, vérifiés par la route : `data:write:orders` permet à la clé d'écrire dans `orders` et rien d'autre.
2. **La sécurité au niveau des lignes (RLS)**, vérifiée par la base de données. Une clé ne la contourne jamais. Une clé de service s'exécute en tant que `uid: "api-key:<id>"` avec le rôle `service`, plus les `roles` qui lui ont été attribués. Les règles de type propriétaire (`owner_id = rebase.uid()`) ne lui correspondent jamais.

Ainsi, une clé détenant `data:read` peut tout de même obtenir des résultats vides. C'est la RLS à l'œuvre, pas un bug. Accordez le rôle `service` dans les règles de sécurité de la collection, ou attribuez à la clé le rôle `admin`.

#### Une clé de service ne lit aucune ligne tant qu'une règle n'accorde pas `service`

C'est cette étape qui donne l'impression qu'une clé correctement configurée est défaillante. La stratégie RLS que Rebase ajoute par défaut à chaque table compile en :

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Il s'agit du contexte serveur ou d'un administrateur. Une clé de service sans rôle `admin` ne correspond à aucune des deux branches. Sur une table dont le `rls` est `"admin-only"`, la requête réussit avec un résultat vide et sans erreur explicative. Accordez le rôle explicitement dans le `rls` de la table :

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Puisque `rebase.uid()` contient l'identifiant de la clé, une règle peut également restreindre les lignes à une clé spécifique :

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Le rôle `admin`

`roles: ["admin"]` (`--roles admin` sur le CLI) permet à la clé de s'exécuter également avec le rôle RLS `admin`, validant ainsi les stratégies d'administration par défaut de chaque collection qui les conserve. Ces stratégies couvrent `SELECT`, `INSERT`, `UPDATE` et `DELETE`, de sorte que la sécurité au niveau des lignes ne limite pas les lectures, écritures ou suppressions de la clé : elle peut lire, modifier et supprimer chaque ligne que ses scopes atteignent. Le rôle valide également les contrôles administrateur en dehors de la base de données : `requireAdmin` dans les [fonctions personnalisées](/docs/backend/custom-functions/), et les écritures de stockage réservées aux administrateurs. Il n'accorde aucun scope : la clé n'accède toujours qu'à ce que ses `scopes` listent.

Un créateur ne peut attribuer à une clé que les rôles qu'il détient lui-même, sauf s'il est administrateur.

### Accès complet, pour la CI et les migrations

`--full-access` donne à la clé chaque scope détenu par son créateur, à l'exception de `keys:read` et `keys:write`, qu'aucune clé ne peut détenir. Via le CLI, qui utilise la clé de service, cela correspond à chaque scope du plan de données et du plan d'administration. Ajoutez `--roles admin` et la sécurité au niveau des lignes ne limite plus les lignes qu'elle peut lire, modifier ou supprimer :

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

C'est la configuration adaptée pour la CI, les migrations et les outils internes de confiance. Ce n'est pas la configuration adaptée pour un agent.

### Limite de débit

Le `rate_limit` d'une clé correspond au nombre de requêtes qu'elle peut effectuer dans une fenêtre de 15 minutes, et chaque accès est décompté dans un bucket unique, `api-key:<id>` :

- ses requêtes HTTP vers les API de données, de stockage et de fonctions ;
- ses trames de données sur le socket temps réel : lectures (fetches), comptages, enregistrements et suppressions, ainsi que les abonnements et les requêtes d'historique de canal au-delà du [quota](/docs/backend/realtime/#what-a-write-costs-and-the-limits) de chaque socket ;
- ses requêtes vers [`/mcp`](/docs/ai/remote-mcp/).

Sans `rate_limit`, le bucket applique la valeur par défaut du serveur pour les clés API, soit 1000. Une clé personnelle n'a pas de `rate_limit` propre et est comptabilisée dans son propre bucket avec cette valeur par défaut. Au-delà de la limite, une requête HTTP renvoie `429` et une trame de socket `RATE_LIMITED`.

Les routes d'administration sous `/api/admin` et les messages d'administration du socket, tels que ceux de l'éditeur SQL, ne sont pas soumis à une limite de débit.

Un administrateur simulant une clé (« Simuler l'accès », `x-rebase-simulate-api-key-id`) consomme son propre quota, et non celui de la clé : l'intégration s'exécutant sur cette clé conserve l'intégralité de son budget. La simulation ou l'usurpation d'un utilisateur est imputée à l'administrateur de la même manière.

## Clés personnelles

<span class="since-badge" data-since="0.31">Since 0.31</span>

Une clé personnelle agit **en tant que son propriétaire** : son uid, et ses rôles tels qu'ils sont lors de chaque requête. Les règles de type propriétaire lui correspondent, elle lit donc exactement ce que son propriétaire lirait, restreint par ses scopes. Elle convient aux scripts personnels, à un CLI sur son ordinateur portable ou à un outil connecté à son propre compte.

Elles sont désactivées par défaut, car chacune d'elles est un identifiant à longue durée de vie pour un compte. Activez-les dans le bloc `auth` de la [table des utilisateurs](/docs/schema/auth-table/) :

```typescript
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique()
    },
    rls: "admin-only",
    auth: { personalKeys: true }
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

La même chose via REST. `$ACCESS_TOKEN` est le jeton d'accès propre au compte, obtenu lors de la connexion :

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Une clé personnelle accepte `name`, `scopes` et `expires_at`. Elle ne comporte aucun `roles`, car elle s'exécute avec ceux de son propriétaire, et aucun `rate_limit`. Envoyer l'un ou l'autre renvoie une erreur `400 INVALID_INPUT`.

Ce qu'une clé personnelle détient correspond à ses scopes, restreints à ce que son propriétaire détient **actuellement**. Retirez un rôle au propriétaire et chaque clé créée par celui-ci voit ses privilèges réduits d'autant. Supprimez le compte et ses clés cessent de fonctionner. Désactivez `personalKeys` et chaque clé personnelle cesse également de fonctionner.

Seul un compte peut posséder des clés personnelles. Une clé API, la clé de service et une session invité sont refusées : `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` pour une clé, `403 PERSONAL_KEY_NEEDS_ACCOUNT` pour les deux autres. Lorsque la fonctionnalité est désactivée, chaque route renvoie `403 PERSONAL_KEYS_DISABLED`.

## Ce que chaque scope couvre

### Données

`data:read`, `data:write` et `data:delete`, globaux ou restreints à une collection (`data:read:posts`). L'opération provient de la méthode HTTP : `GET`, `HEAD` et `OPTIONS` lisent, `POST`, `PUT` et `PATCH` écrivent, `DELETE` supprime. `POST /api/data/:slug/bulk/delete` compte comme une suppression, bien qu'il s'agisse d'un `POST`.

Sur un chemin imbriqué, l'opération est vérifiée par rapport à la collection à laquelle le chemin aboutit, et chaque collection traversée nécessite `data:read`. Une clé détenant uniquement `data:read:posts` se verra refuser `/api/data/authors/1/posts` tant qu'elle ne peut pas également lire `authors`.

### Stockage

`storage:read` liste et télécharge. `storage:write` téléverse et crée des dossiers, et couvre chaque étape d'un téléversement reprenable (TUS), y compris la vérification de décalage (offset) et l'annulation. `storage:delete` supprime. La cible est l'identifiant d'une source de stockage. L'identifiant de la source par défaut est `(default)`, donc `storage:read:(default)` lit uniquement la source par défaut, et `storage:write:avatars` écrit dans une source nommée `avatars`. Après la vérification du scope, [`storageAuthorize`](/docs/backend/storage-authorization/) s'exécute tout de même, avec l'identité de la clé.

### Fonctions

`functions:invoke` appelle chaque fonction personnalisée. `functions:invoke:<name>` en appelle une seule. Lister les fonctions via `GET /api/functions` nécessite le scope global.

N'attribuez pas `functions:invoke` à une clé que vous souhaitez restreindre à la lecture seule. Une fonction est du code, et elle peut effectuer des écritures. À l'intérieur d'une fonction, `getScopes(c)` et `hasScope(c, …)` lisent les autorisations de la clé, et une application peut déclarer ses propres scopes qu'une fonction vérifiera. Voir [Fonctions personnalisées](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Surfaces d'administration

Un scope du plan d'administration sur une clé donne accès à cette surface. Un ordonnanceur qui déclenche des tâches cron a besoin de `cron:write`. Un collecteur de logs a besoin de `logs:read`. Une tâche de sauvegarde a besoin de `backups:read`. L'[index des points de terminaison](/docs/backend/endpoints/#admin) liste le scope requis par chaque route.

`keys:read` et `keys:write` ne peuvent jamais être attribués à une clé. Une clé capable de gérer des clés pourrait créer son propre successeur ou étendre ses propres privilèges. Toute requête vers les routes de gestion des clés effectuée avec une clé est rejetée avec `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gérez les clés en tant que personne détenant `keys:write`, ou à l'aide de la clé de service.

### Temps réel

Une clé permet également d'authentifier le WebSocket : envoyez-la dans le message `AUTHENTICATE`. Les lectures (fetches) et abonnements nécessitent `data:read` sur leur collection, les sauvegardes `data:write`, les suppressions `data:delete`. Un abonnement à un chemin imbriqué nécessite le scope global. Les canaux (diffusion et présence) sont refusés pour les clés. L'éditeur SQL et les messages de branche nécessitent `database:read` ou `database:write`.

## Agents et serveurs MCP

Un agent requiert la clé la plus *restreinte* possible pour accomplir sa tâche. Commencez avec des scopes limités et définissez une date d'expiration :

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Omettez `data:delete` lorsque l'agent est autorisé à modifier mais ne doit pas supprimer. L'opération `delete` est distincte de `write` précisément pour cette raison.

## Règles de création

Chaque clé est vérifiée par rapport à son créateur, de la même manière sur les deux routes :

| Refus | Quand |
|---|---|
| `400 INVALID_SCOPES` | Un scope est malformé, inconnu ou comporte une cible qu'il n'accepte pas. `details.validScopes` liste les scopes qu'une clé peut détenir. Il exclut `keys:*`, qu'aucune clé ne peut détenir |
| `400 UNKNOWN_SCOPE_TARGET` | Une cible nomme une collection, une source de stockage ou une fonction que ce backend ne dessert pas |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` ou `keys:write` a été demandé |
| `403 SCOPE_EXCEEDS_CREATOR` | Un scope que le créateur ne détient pas. Une clé ne détient jamais plus que le compte qui l'a créée |
| `403 ROLE_EXCEEDS_CREATOR` | Un rôle de clé de service que le créateur ne détient pas, lorsque le créateur n'est pas administrateur |
| `400 INVALID_ROLE` | Un nom de rôle est vide ou contient `,` `{` `}` `"` `\` ou un caractère de contrôle, que la RLS interpréterait comme d'autres rôles |
| `403 KEY_OUTRANKS_CALLER` | Lors d'une modification (`PUT`) ou d'une révocation (`DELETE`) : la clé détient déjà un rôle ou un scope que l'appelant ne possède pas, et l'appelant n'est pas administrateur |

Une requête pour laquelle la clé elle-même ne dispose pas du scope requis répond `403 SCOPE_MISSING`, avec le scope indiqué dans `details.requiredScope`. Voir [Codes d'erreur](/docs/backend/errors/#authentication-and-accounts).

## Gestion des clés

| Méthode | Chemin | Requis |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifie `name`, `scopes`, `roles`, `rate_limit` ou `expires_at`, selon les mêmes règles que la création |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Révoque |
| `GET` | `/api/auth/keys` | Un compte : ses propres clés personnelles |
| `POST` | `/api/auth/keys` | Un compte, avec `personalKeys` activé |
| `DELETE` | `/api/auth/keys/:id` | Un compte : révoque l'une des siennes |

Chaque route renvoie les clés masquées : `key_prefix`, jamais le hash. Chaque clé indique son `kind` (`service` ou `personal`), ses `scopes`, ses `roles` et, pour une clé personnelle, son `owner_uid`.

Le CLI prend en charge les clés de service : `rebase api-keys list`, `get`, `create`, `revoke` et `scopes`, qui liste chaque scope connu du backend. Voir la [référence du CLI](/docs/cli/#rebase-api-keys). Il s'authentifie avec `REBASE_SERVICE_KEY` depuis `.env`, et ne l'envoie qu'au serveur que `rebase dev` exécute pour ce projet ; si ce serveur est arrêté, il n'envoie donc rien. Pour un serveur exécuté autrement, tel que `rebase start` ou un conteneur, définissez `REBASE_BASE_URL` avec son adresse ([l'environnement propre au CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Clés créées avant les scopes

Les clés créées avant l'existence des scopes comportent une liste de `permissions` et un indicateur `admin`. Au démarrage, le magasin attribue à chacune les scopes qu'elle détient désormais. Aucun privilège n'est étendu ; lorsqu'une ancienne autorisation n'a pas de correspondance exacte, elle est restreinte :

| Ancienne autorisation | Scopes actuels |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` et `storage:<op>` pour chaque opération, plus `functions:invoke` si elle avait `write` |
| `"storage"` | `storage:<op>` pour chaque opération |
| `"functions"` | `functions:invoke`, uniquement si elle avait `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, uniquement si elle avait `write` |
| `admin: true` | le rôle `admin`, plus `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Le secret ne change pas, de sorte qu'une intégration continue de fonctionner. Deux autorisations sont réduites :

- Une autorisation de fonction sans `write` devient nulle. Un `GET` comptait auparavant comme une lecture, mais une fonction est du code, et en appeler une n'est pas une lecture.
- Une clé admin n'obtient aucun `database:*`, auquel elle n'avait jamais accès auparavant, et aucun `keys:*`, qu'aucune clé ne peut détenir.

Les anciennes colonnes `permissions` et `admin` sont conservées, de sorte qu'un retour à une version antérieure du runtime lit toujours ses clés. Une requête envoyant `permissions` ou `admin` au lieu de `scopes` est rejetée avec `400 INVALID_INPUT`.

## Prochaines étapes

- [Rôles et scopes](/docs/backend/roles-and-scopes/) : chaque scope, et comment les rôles les détiennent
- [Index des points de terminaison](/docs/backend/endpoints/) : le scope requis par chaque route
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : ce que la base de données applique en plus des scopes d'une clé
