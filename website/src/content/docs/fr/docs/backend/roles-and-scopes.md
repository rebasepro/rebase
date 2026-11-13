---
sourceHash: 1610ca294114442e
title: Rôles et scopes
sidebar_label: Rôles et scopes
description: "Ce qu'un appelant peut faire : le plan de données dont chaque personne dispose, le plan d'administration octroyé par les rôles, les scopes qu'une application déclare pour elle-même et comment chaque identifiant les transporte."
---

Chaque requête adressée à un backend Rebase pose une question : cet appelant peut-il faire cela ?
La réponse est un **scope**, une chaîne au format `resource:action` : `data:read`,
`users:write`, `cron:read`. La session d'une personne, une clé d'API, un jeton MCP et un
rôle détiennent tous des scopes, et ils utilisent tous les mêmes chaînes. Une attribution se lit de la même
manière sur une clé, sur un rôle et sur un écran de consentement.

## Deux plans

Les scopes se répartissent en deux plans, et une personne ne les détient pas de la même façon.

**Le plan de données** comprend `data:*`, `storage:*` et `functions:invoke`. Chaque
personne connectée en dispose dans sa totalité. Ce qu'une personne peut faire avec une ligne est déterminé par
la [sécurité au niveau des lignes](/docs/collections/security-rules/) de la table, ligne par ligne,
et ce qu'elle peut faire avec un fichier par les [politiques de stockage](/docs/backend/storage-authorization/).
Un scope ne décide jamais de cela pour une personne. Sur une clé ou un jeton, les scopes du plan de données
se restreignent : une clé qui ne détient que `data:read:posts` lit `posts` et rien d'autre,
quelles que soient les permissions accordées par les règles.

**Le plan d'administration** comprend tout le reste : utilisateurs, schéma, base de données, sauvegardes,
tâches cron, journaux et clés. Personne ne le détient implicitement. Le rôle intégré `admin`
en détient la totalité. Tout autre rôle détient ce que l'application déclare pour lui.

## Les scopes

| Scope | Plan | Cible | Ce qu'il autorise |
|---|---|---|---|
| `data:read` | data | collection | Lire des lignes, selon la sécurité au niveau des lignes de l'appelant |
| `data:write` | data | collection | Créer et mettre à jour des lignes, selon la sécurité au niveau des lignes de l'appelant |
| `data:delete` | data | collection | Supprimer des lignes, selon la sécurité au niveau des lignes de l'appelant |
| `storage:read` | data | storage source | Lister et télécharger des fichiers |
| `storage:write` | data | storage source | Téléverser des fichiers et créer des dossiers |
| `storage:delete` | data | storage source | Supprimer des fichiers |
| `functions:invoke` | data | function | Appeler des fonctions personnalisées. Une fonction peut faire tout ce que son code fait |
| `users:read` | admin | — | Lister les comptes et leurs rôles |
| `users:write` | admin | — | Créer, modifier et supprimer des comptes, réinitialiser les mots de passe et les seconds facteurs, attribuer des rôles jusqu'à ceux du détenteur |
| `schema:read` | admin | — | Lire le schéma, planifier les modifications de schéma, exécuter l'audit RLS, lire la documentation de l'API privée |
| `schema:write` | admin | — | Appliquer les modifications de schéma : modifie les fichiers de schéma et altère la base de données |
| `database:read` | admin | — | Lister les bases de données, tables, rôles Postgres et branches |
| `database:write` | admin | — | Exécuter du SQL en tant que propriétaire de la base de données, en dehors de la sécurité au niveau des lignes, et créer ou supprimer des branches |
| `backups:read` | admin | — | Lister et télécharger les sauvegardes : chaque ligne, en dehors de la sécurité au niveau des lignes |
| `cron:read` | admin | — | Lister les tâches cron et consulter leur historique d'exécution |
| `cron:write` | admin | — | Déclencher des tâches cron et les activer ou désactiver |
| `logs:read` | admin | — | Lire les journaux du serveur |
| `keys:read` | admin | — | Lister les clés de service du projet. Ne peut jamais être accordé à une clé |
| `keys:write` | admin | — | Créer, modifier et révoquer des clés de service. Ne peut jamais être accordé à une clé |

`GET /api/auth/scopes` renvoie cette liste pour le backend en cours d'exécution, avec les scopes
propres à l'application ajoutés, plus les scopes que détient l'appelant. Tout appelant connecté peut la
lire :

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Cibles

Un scope du plan de données peut être restreint à une seule cible, après un second deux-points :

- `data:read:posts` lit uniquement la table `posts`. La cible est le slug d'une table.
- `storage:write:avatars` téléverse uniquement vers la source de stockage `avatars`. L'identifiant de la source
  par défaut est `(default)` : `storage:read:(default)`.
- `functions:invoke:export` appelle uniquement la fonction `export`.

Le scope générique couvre toutes les cibles. Un scope restreint couvre sa propre cible et
rien d'autre. Il ne répond jamais à une question concernant toutes les cibles : une clé détenant
`data:read:posts` ne peut pas lister toutes les tables.

Les scopes du plan d'administration ne prennent aucune cible. Un scope d'application en prend une lorsqu'il déclare un
`target`, comme ci-dessous.

## Déclarer des rôles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les rôles sont déclarés sur la [table des utilisateurs](/docs/schema/auth-table/), sous
`auth.roles`. Un rôle est un nom visible par la base de données, auquel les politiques
de sécurité au niveau des lignes peuvent correspondre, accompagné d'une liste de scopes du plan d'administration et de l'application.

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        roles: col.text({ enum: ["admin", "support", "developer", "editor"] }).array(),
    },
    rls: "admin-only",
    auth: {
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"],
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"],
            },
        },
    },
});
```

Une personne détient un rôle lorsque sa colonne `roles` le liste. Attribuez-le dans le panneau
d'administration, ou avec `PUT /api/admin/users/:uid`.

Le démarrage refuse toute déclaration qui s'apparenterait à une autorisation trompeuse :

- **`admin` ne peut pas être déclaré.** Il est intégré et détient tous les scopes.
- **Un rôle ne peut pas lister un scope du plan de données.** Chaque personne détient déjà le plan
  de données. `data:write` sur un rôle n'accorderait rien tout en donnant l'impression d'accorder
  quelque chose. Ce qu'un rôle peut faire avec les lignes relève de la configuration [`rls`](/docs/collections/security-rules/) de la table.
- **Chaque scope doit exister.** Un nom inconnu fait échouer le démarrage et liste les scopes valides.

Un rôle que vous ne déclarez pas reste un rôle. `editor` ci-dessus n'a pas d'entrée, il ne détient
donc aucun scope du plan d'administration, et une politique RLS peut toujours lui correspondre.

`defaultRole`, le rôle attribué à chaque nouvel inscrit, ne peut pas être `admin` ni un
rôle déclaré détenant un quelconque scope du plan d'administration. Un inconnu qui s'inscrit ne doit
rien détenir permettant de gérer le projet. Le démarrage le refuse.

:::note[`schema-admin` a été supprimé]
Les anciennes versions traitaient un rôle nommé `schema-admin` comme un second administrateur. Il n'a
désormais plus aucune signification en soi. Si votre projet l'utilisait, déclarez-le avec les scopes
souhaités, par exemple
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` liste `admin` ainsi que chaque rôle déclaré avec ses scopes. Il
nécessite `users:read` :

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Scopes de l'application

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une application peut définir ses propres opérations sous forme de scopes, sous `auth.scopes` :

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project",
            },
        },
    },
});
```

Le nom est sous la forme `resource:action`, en minuscules, sans cible. Il ne peut pas réutiliser une
ressource intégrée : `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` et `keys` sont déjà prises. `label` est obligatoire,
car c'est ce qu'une personne lit lorsqu'elle accorde le scope. `target` précise la signification
d'une cible, afin qu'une clé puisse par exemple détenir `project:deploy:p1`.

Chaque personne connectée détient tous les scopes de l'application. Comme pour le plan de données, le code
qui gère le scope détermine si cette personne a le droit d'agir. Le scope existe afin qu'une
clé puisse être restreinte à cette seule action. Un rôle peut également lister des scopes d'application.

Vérifiez un scope dans une [fonction personnalisée](/docs/backend/custom-functions/) avec `requireScope` :

```typescript
import { defineFunction, requireAuth, requireScope, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post(
        "/:project",
        requireAuth,
        requireScope("project:deploy", c => c.req.param("project")),
        async (c) => {
            // A person always passes requireScope. Decide here whether
            // this person may deploy this project.
            return c.json({ project: c.req.param("project"), by: getUserId(c) });
        }
    );
});
```

Une clé détenant `project:deploy:p1` est acceptée pour `p1` et reçoit `403 SCOPE_MISSING`
pour tout autre projet. Elle nécessite également `functions:invoke`, ou
`functions:invoke:<name>` pour cette fonction, pour pouvoir simplement atteindre la fonction.
`hasScope(c, scope, target)` et `getScopes(c)` répondent à la même question au sein d'un
gestionnaire.

`requireScope`
refuse un scope que personne ne pourrait détenir. Un nom qui n'est pas un scope, ou un scope
intégré mal orthographié tel que `data:raed`, lève une erreur au chargement de la fonction. Un scope d'application
que le backend ne déclare pas sous `auth.scopes` renvoie à chaque appelant, y compris à un
administrateur, `500 SCOPE_NOT_DECLARED`.

## Ce que signifie admin

`admin` est le seul rôle intégré, et il représente bien plus qu'une simple liste de scopes :

- Il détient chaque scope du plan d'administration, `keys:*` inclus.
- C'est un rôle visible par la base de données. Les politiques par défaut ajoutées par Rebase à chaque
  table l'autorisent, de sorte qu'un administrateur lit et écrit chaque ligne d'une table qui les
  conserve. Une table avec `defaultPolicies: false` les supprime.
- Seul un administrateur peut accorder le rôle `admin`. Un rôle qui listerait tous les scopes du plan d'administration n'est
  toujours pas `admin` : il ne peut pas attribuer `admin`, et les politiques par défaut ne
  l'autorisent pas.

`requireAdmin` vérifie la présence du rôle. Privilégiez `requireScope` pour tout ce qu'un rôle
plus restreint ou une clé devrait pouvoir effectuer.

## Nul ne peut accorder plus qu'il ne détient

Une règle régit toutes les voies d'accès : **rien n'est accordé au-delà de ce que détient l'octroyant.**

Pour les clés :

- Les scopes d'une clé doivent être inclus dans ceux de son créateur. Sinon : `403 SCOPE_EXCEEDS_CREATOR`.
- Les rôles RLS d'une clé de service doivent être des rôles que son créateur détient, sauf si le créateur
  est un administrateur. Sinon : `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` et `keys:write` ne sont jamais attribués à une clé. Une clé gérant les clés pourrait
  émettre son propre successeur. `400 KEY_MANAGEMENT_SCOPE`.
- Le détenteur de `keys:write` ne peut pas modifier ou révoquer une clé qui détient un rôle ou
  un scope qu'il ne possède pas, sauf s'il est administrateur : `403 KEY_OUTRANKS_CALLER`.
  Sans cela, il pourrait étendre une clé ayant le rôle admin à l'ensemble des scopes de données.

Pour les comptes, le détenteur de `users:write` :

- ne peut pas modifier, réinitialiser ou supprimer un compte dont les rôles détiennent un scope qu'il ne possède pas,
  ou `admin` s'il n'est pas lui-même administrateur :
  `403 ACCOUNT_OUTRANKS_CALLER`. Sans cela, un rôle de support pourrait réinitialiser le mot de passe
  d'un administrateur et se connecter à sa place.
- ne peut pas attribuer de rôles qui détiennent plus qu'il ne détient, `admin` inclus : `403 ROLE_EXCEEDS_CALLER`.

Un nom de rôle peut être n'importe quoi, sauf un nom qui risquerait d'être interprété comme d'autres
rôles : un nom vide, ou contenant `,`, `{`, `}`, `"`, `\` ou un caractère de contrôle,
est refusé avec `400 INVALID_ROLE` partout où un rôle est spécifié (utilisateurs,
table des utilisateurs, clés de service).

## Comment chaque identifiant détient les scopes

| Identifiant | Agit en tant que | Détient |
|---|---|---|
| Session d'une personne | la personne | le plan de données, chaque scope d'application et les scopes de ses rôles. Un administrateur détient tout |
| [Clé de service](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, avec les rôles RLS `service` plus ses propres `roles` | exactement ses scopes |
| [Clé personnelle](/docs/backend/api-keys/#personal-keys) `rk_live_…` | son propriétaire, avec les rôles du propriétaire tels qu'ils sont à chaque requête | ses scopes, restreints à ce que le propriétaire détient actuellement |
| [Jeton MCP](/docs/ai/remote-mcp/) | la personne qui l'a connecté | `data:read`, `data:write`, `data:delete` selon ce qui a été accordé, facultativement par table |
| `REBASE_SERVICE_KEY` | `service`, avec le rôle `admin` | tout |

Une clé ou un jeton ne contourne jamais la sécurité au niveau des lignes. Ses scopes constituent un plafond,
et les politiques de la base de données pour l'identité sous laquelle il agit en constituent un autre.

## Lorsqu'un scope est manquant

La réponse est `403 SCOPE_MISSING`, et `details.requiredScope` indique le nom du scope,
avec sa cible le cas échéant :

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Pour une personne, la solution consiste à lui attribuer un rôle listant ce scope. Pour une clé, il s'agit d'en créer une nouvelle
qui le détient.

## Prochaines étapes

- [Clés d'API](/docs/backend/api-keys/) : clés de service, clés personnelles et règles d'émission
- [Sécurité au niveau des lignes](/docs/collections/security-rules/) : ce qu'une personne peut faire avec chaque ligne
- [Index des points de terminaison](/docs/backend/endpoints/) : le scope requis par chaque route
- [Codes d'erreur](/docs/backend/errors/#authentication-and-accounts) : tous les cas de refus ci-dessus
