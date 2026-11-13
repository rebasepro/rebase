---
sourceHash: 8f9385dd3838df4f
title: Clés API
sidebar_label: Clés API
description: "Clés de longue durée pour les scripts, la CI, les agents et les intégrations : clés de service et clés personnelles, les scopes qu'elles détiennent, leur articulation avec la sécurité au niveau des lignes (RLS), et les routes qui les gèrent."
---

## Clés API

Une clé API est un identifiant de type bearer de longue durée, `rk_live_…`, destiné à un
appelant qui n'est pas une personne physique dans un navigateur : un script, un job de CI, un agent, un
client MCP, un autre service. Ce qu'une clé a le droit de faire est défini par une liste de [scopes](/docs/backend/roles-and-scopes/),
tels que `data:read:orders` ou `cron:write`.

Il en existe deux types :

- Une **clé de service** est l'identité machine propre au projet. Elle agit en tant
  qu'`api-key:<id>`, et non comme une personne. Toute entité détenant `keys:write` les gère, sous
  `/api/admin/api-keys`.
- Une **clé personnelle** agit au nom du compte qui l'a créée. Chaque compte gère les
  siennes, sous `/api/auth/keys`, lorsque l'application les active.

### Utiliser une clé

Envoyez-la sous la forme d'un bearer token, comme un jeton d'accès. `$API_URL` correspond à l'adresse
de votre backend : celle affichée par `rebase dev`, ou l'URL de votre déploiement.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La même clé fonctionne sur l'API REST, le stockage, les fonctions personnalisées, les
surfaces d'administration que ses scopes couvrent, le WebSocket temps réel et le [point de terminaison `/mcp`](/docs/ai/remote-mcp/).

## Clés de service

### En créer une

Une clé de service a besoin d'un nom et d'au moins un scope.

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

La réponse inclut la clé complète en clair (`rk_live_...`) **une seule et unique fois**.
Enregistrez-la immédiatement.

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Un libellé pour les humains |
| `scopes` | `string[]` | Ce que la clé peut faire. Au moins un |
| `roles` | `string[]` | Rôles RLS avec lesquels la clé s'exécute, en plus de `service`. Optionnel |
| `rate_limit` | `number \| null` | Requêtes par fenêtre de 15 minutes. `null` ou absent utilise la valeur par défaut du serveur pour les clés API, 1000. Voir [Limite de débit](#limite-de-débit) |
| `expires_at` | `string \| null` | Date d'expiration ISO-8601. Absent signifie qu'elle n'expire jamais |

### Scopes et RLS : deux barrières indépendantes

Une requête effectuée avec une clé passe deux contrôles, et les deux doivent l'autoriser :

1. **Les scopes de la clé**, vérifiés par la route : `data:write:orders` permet à la clé
   d'écrire dans `orders` et rien d'autre.
2. **La sécurité au niveau des lignes (RLS)**, vérifiée par la base de données. Une clé ne la
   contourne jamais. Une clé de service s'exécute avec `uid: "api-key:<id>"` et le rôle `service`, plus les
   `roles` qui lui ont été attribués. Les règles de type propriétaire (`owner_id = rebase.uid()`) ne
   lui correspondent jamais.

Ainsi, une clé détenant `data:read` peut quand même recevoir des résultats vides. C'est le
comportement normal de RLS, et non un bug. Accordez le rôle `service` dans les règles `rls` de la table,
ou donnez à la clé le rôle `admin`.

#### Une clé de service lit zéro ligne jusqu'à ce qu'une règle accorde `service`

C'est l'étape qui fait croire qu'une clé pourtant bien configurée est défaillante. La stratégie RLS que
Rebase applique par défaut à chaque table se compile ainsi :

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Il s'agit du contexte serveur, ou d'un administrateur. Une clé de service sans rôle `admin`
ne correspond à aucune des deux branches. Sur une table dont le `rls` est `"admin-only"`, la requête
aboutit avec un résultat vide et sans aucune erreur explicative. Accordez le rôle
explicitement, dans le `rls` de la table :

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Étant donné que `rebase.uid()` contient l'identifiant de la clé, une règle peut également restreindre des lignes à une
clé spécifique :

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Le rôle `admin`

`roles: ["admin"]` (`--roles admin` dans la CLI) permet à la clé de s'exécuter également avec le rôle
RLS `admin`, validant ainsi les stratégies admin par défaut de chaque table qui
les conserve. Ces stratégies couvrent `SELECT`, `INSERT`, `UPDATE` et `DELETE`, de sorte que la
sécurité au niveau des lignes ne limite pas les lectures, écritures ou suppressions de la clé : elle peut
lire, modifier et supprimer chaque ligne accessible par ses scopes. Ce rôle valide également les
vérifications d'administration en dehors de la base de données : `requireAdmin` dans les
[fonctions personnalisées](/docs/backend/custom-functions/), ainsi que les écritures que le stockage
réserve aux administrateurs. Il n'accorde aucun scope : la clé n'accède toujours qu'à ce que sa liste
de `scopes` énumère.

Un créateur ne peut attribuer à une clé que les rôles qu'il détient lui-même, à moins d'être
administrateur.

### Accès complet, pour la CI et les migrations

`--full-access` accorde à la clé l'ensemble des scopes détenus par son créateur, hormis `keys:read` et
`keys:write`, qu'aucune clé ne peut détenir. Via la CLI, qui utilise la clé de service,
cela comprend tous les scopes du plan de données et du plan d'administration. Ajoutez `--roles admin` et
la sécurité au niveau des lignes ne limitera plus les lignes qu'elle lit, modifie ou supprime :

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

C'est la configuration adaptée pour la CI, les migrations et les outils internes de confiance. Ce n'est
pas la configuration adaptée pour un agent.

### Limite de débit

Le `rate_limit` d'une clé correspond au nombre de requêtes qu'elle peut effectuer au cours d'une
fenêtre de 15 minutes, et chaque accès est décompté au sein d'un seul et même panier, `api-key:<id>` :

- ses requêtes HTTP vers les API de données, de stockage et de fonctions ;
- ses trames de données sur le socket temps réel : lectures (fetches), décomptes (counts), sauvegardes et suppressions,
  ainsi que les abonnements et requêtes d'historique de canal au-delà du
  [quota](/docs/backend/realtime/#what-a-write-costs-and-the-limits) de chaque socket ;
- ses requêtes vers [`/mcp`](/docs/ai/remote-mcp/).

Sans `rate_limit`, le panier applique la valeur par défaut du serveur pour les clés API, soit 1000. Une
clé personnelle ne possède pas de `rate_limit` propre et est décomptée dans son propre panier avec cette valeur par
défaut. Au-delà de la limite, une requête HTTP renvoie `429` et une trame socket
`RATE_LIMITED`.

Les routes d'administration sous `/api/admin`, ainsi que les messages d'administration du socket tels que ceux de
l'éditeur SQL, ne sont pas soumis à une limite de débit.

Un administrateur simulant une clé (« Simulate access », `x-rebase-simulate-api-key-id`)
consomme son propre quota, et non celui de la clé : l'intégration qui s'exécute sur cette clé
conserve l'intégralité de son budget. La simulation ou l'usurpation d'identité d'un utilisateur est
décomptée auprès de l'administrateur de la même manière.

## Clés personnelles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une clé personnelle agit **au nom de son propriétaire** : son uid, et ses rôles tels qu'ils sont lors
de chaque requête. Les règles de type propriétaire lui correspondent, elle lit donc exactement ce que son propriétaire
lirait, restreint par ses scopes. Elle est idéale pour les scripts propres à un individu, une CLI sur son
ordinateur portable, ou un outil connecté à son propre compte.

Elles sont désactivées par défaut, car chacune constitue un identifiant de longue durée associé à un
compte. Activez-les dans le bloc `auth` de la [table des utilisateurs](/docs/schema/auth-table/) :

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

Un compte connecté peut alors gérer ses propres clés :

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

La même opération via REST. `$ACCESS_TOKEN` est le jeton d'accès propre au compte, obtenu
lors de la connexion :

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Une clé personnelle prend `name`, `scopes` et `expires_at`. Elle ne porte aucun `roles`,
puisqu'elle s'exécute avec ceux de son propriétaire, et aucun `rate_limit`. Fournir l'un ou l'autre renvoie
une erreur `400 INVALID_INPUT`.

Ce qu'une clé personnelle détient correspond à ses scopes, restreints à ce que son propriétaire détient
**actuellement**. Retirez un rôle au propriétaire et chaque clé qu'il a créée voit ses droits réduits d'autant. Supprimez
le compte et ses clés cessent de fonctionner. Désactivez `personalKeys` et chaque clé personnelle
cesse également de fonctionner.

Seul un compte peut posséder des clés personnelles. Une clé API, la clé de service et une
session invité sont rejetées : `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` pour une clé,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` pour les deux autres. Lorsque la fonctionnalité est désactivée, chaque
route répond `403 PERSONAL_KEYS_DISABLED`.

## Ce que couvre chaque scope

### Données

`data:read`, `data:write` et `data:delete`, sous forme globale ou restreints à une table précise
(`data:read:posts`). L'opération découle de la méthode HTTP : `GET`, `HEAD`
et `OPTIONS` lisent, `POST`, `PUT` et `PATCH` écrivent, `DELETE` supprime.
`POST /api/data/:slug/bulk/delete` compte comme une suppression, bien qu'il s'agisse d'un `POST`.

Sur un chemin imbriqué, l'opération est vérifiée par rapport à la table sur laquelle se termine
le chemin, et chaque table traversée requiert `data:read`. Une clé détenant
uniquement `data:read:posts` se verra refuser l'accès à `/api/data/authors/1/posts` tant qu'elle ne pourra pas
également lire `authors`.

### Stockage

`storage:read` liste et télécharge. `storage:write` téléverse et crée des dossiers,
et couvre chaque étape d'un téléversement avec reprise (TUS), y compris la vérification de l'offset
et l'annulation. `storage:delete` supprime. La cible est l'identifiant d'une source de stockage. L'identifiant de
la source par défaut est `(default)`, ainsi `storage:read:(default)` lit uniquement la source par défaut,
et `storage:write:avatars` écrit sur une source nommée `avatars`.
Après la vérification du scope, [`storageAuthorize`](/docs/backend/storage-authorization/)
s'exécute toujours avec l'identité de la clé.

### Fonctions

`functions:invoke` appelle toutes les fonctions personnalisées. `functions:invoke:<name>` en appelle
une en particulier. Lister les fonctions via `GET /api/functions` nécessite le scope global.

N'accordez pas `functions:invoke` à une clé que vous souhaitez cantonner à la lecture seule. Une fonction est
du code, et elle peut effectuer des écritures. Au sein d'une fonction, `getScopes(c)` et `hasScope(c, …)`
permettent de lire ce que la clé détient, et une application peut déclarer ses propres scopes pour qu'une fonction
les vérifie. Voir [Fonctions personnalisées](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Surfaces d'administration

Un scope du plan d'administration présent sur une clé donne accès à la surface correspondante. Un ordonnanceur qui déclenche
des tâches cron a besoin de `cron:write`. Un collecteur de journaux a besoin de `logs:read`. Une tâche de sauvegarde a besoin de
`backups:read`. L'[index des points de terminaison](/docs/backend/endpoints/#admin) dresse la liste des
scopes requis par chaque route.

`keys:read` et `keys:write` ne peuvent jamais être accordés à une clé. Une clé capable de gérer des clés
pourrait générer son propre successeur, ou élargir ses propres droits. Toute requête vers les routes de gestion des clés
effectuée avec une clé est rejetée avec `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gérez les
clés en tant que personne physique détenant `keys:write`, ou avec la clé de service.

### Temps réel

Une clé permet également d'authentifier le WebSocket : transmettez-la dans le message `AUTHENTICATE`.
Les lectures (fetches) et abonnements requièrent `data:read` sur leur table, les sauvegardes
`data:write`, les suppressions `data:delete`. Un abonnement à un chemin imbriqué nécessite le
scope global. Les canaux (diffusion et présence) sont interdits aux clés. Les messages de l'éditeur
SQL et de gestion des branches nécessitent `database:read` ou `database:write`.

## Agents et serveurs MCP

Un agent a besoin de la clé la plus *restreinte* possible pour accomplir sa tâche. Commencez avec des scopes
limités et définissez une date d'expiration :

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Omettez `data:delete` lorsque l'agent a le droit de modifier mais ne doit pas supprimer.
`delete` est séparé de `write` précisément pour cette raison.

## Règles de création de clés

Chaque clé est validée par rapport à l'entité qui la crée, de la même manière sur les deux routes :

| Refus | Cas |
|---|---|
| `400 INVALID_SCOPES` | Un scope est malformé, inconnu ou porte une cible qu'il n'accepte pas. `details.validScopes` liste les scopes qu'une clé peut détenir. Il exclut `keys:*`, qu'aucune clé ne peut détenir |
| `400 UNKNOWN_SCOPE_TARGET` | Une cible désigne une table, une source de stockage ou une fonction que ce backend ne prend pas en charge |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` ou `keys:write` a été demandé |
| `403 SCOPE_EXCEEDS_CREATOR` | Un scope que le créateur ne détient pas. Une clé ne détient jamais plus de droits que le compte qui l'a créée |
| `403 ROLE_EXCEEDS_CREATOR` | Un rôle de clé de service que le créateur ne détient pas, lorsque le créateur n'est pas un administrateur |
| `400 INVALID_ROLE` | Un nom de rôle est vide ou contient `,` `{` `}` `"` `\` ou un caractère de contrôle, que RLS interpréterait comme d'autres rôles |
| `403 KEY_OUTRANKS_CALLER` | Lors d'une modification (`PUT`) ou d'une révocation (`DELETE`) : la clé détient déjà un rôle ou un scope que l'appelant ne détient pas, et l'appelant n'est pas un administrateur |

Une requête pour laquelle la clé elle-même manque d'un scope renvoie `403 SCOPE_MISSING`, avec le
scope indiqué dans `details.requiredScope`. Voir [Codes d'erreur](/docs/backend/errors/#authentication-and-accounts).

## Gérer les clés

| Méthode | Chemin | Requis |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifie `name`, `scopes`, `roles`, `rate_limit` ou `expires_at`, selon les mêmes règles que pour la création |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Révoque |
| `GET` | `/api/auth/keys` | Un compte : ses propres clés personnelles |
| `POST` | `/api/auth/keys` | Un compte, avec `personalKeys` activé |
| `DELETE` | `/api/auth/keys/:id` | Un compte : révoque l'une de ses propres clés |

Chaque route renvoie les clés masquées : `key_prefix`, jamais le hash. Chaque clé indique
son type `kind` (`service` ou `personal`), ses `scopes`, ses `roles` et, pour une
clé personnelle, son `owner_uid`.

La CLI prend en charge les clés de service : `rebase api-keys list`, `get`, `create`, `revoke`,
et `scopes`, qui énumère chaque scope connu du backend. Voir la
[référence de la CLI](/docs/cli/#rebase-api-keys). Elle s'authentifie avec
`REBASE_SERVICE_KEY` depuis `.env`, et ne l'envoie qu'au serveur que `rebase dev`
exécute pour ce projet ; par conséquent, si ce serveur est arrêté, elle n'envoie rien. Pour
un serveur exécuté d'une autre manière, comme `rebase start` ou un conteneur, définissez
`REBASE_BASE_URL` avec son adresse
([l'environnement propre à la CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Clés créées avant les scopes

Les clés créées avant l'apparition des scopes comportent une liste de `permissions` et un
drapeau `admin`. Au démarrage, le magasin attribue à chacune les scopes qu'elle détient désormais. Aucun droit n'est élargi ;
lorsqu'une ancienne attribution n'a pas de correspondance exacte, elle est restreinte :

| Ancienne attribution | Scopes actuels |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` et `storage:<op>` pour chaque opération, plus `functions:invoke` si elle avait `write` |
| `"storage"` | `storage:<op>` pour chaque opération |
| `"functions"` | `functions:invoke`, seulement si elle avait `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, seulement si elle avait `write` |
| `admin: true` | le rôle `admin`, plus `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Le secret ne change pas, de sorte qu'une intégration continue de fonctionner. Deux attributions sont restreintes :

- Une attribution de fonction sans `write` ne devient rien. Un `GET` comptait auparavant
  comme une lecture, mais une fonction est du code, et en exécuter une n'est pas une lecture.
- Une clé d'administration ne reçoit aucun `database:*`, auquel elle n'avait jamais accès auparavant, et aucun
  `keys:*`, qu'aucune clé ne peut détenir.

Les anciennes colonnes `permissions` et `admin` sont conservées, de sorte qu'un retour à un
runtime plus ancien continue de lire ses clés. Une requête qui transmet `permissions` ou
`admin` à la place de `scopes` est rejetée avec `400 INVALID_INPUT`.

## Prochaines étapes

- [Rôles et scopes](/docs/backend/roles-and-scopes/) : chaque scope, et comment les rôles les détiennent
- [Index des points de terminaison](/docs/backend/endpoints/) : le scope requis par chaque route
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : ce que la base de données applique en plus des scopes d'une clé
