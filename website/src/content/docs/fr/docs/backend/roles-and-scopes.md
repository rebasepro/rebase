---
sourceHash: fe0da2499f512a69
title: Rôles et portées
sidebar_label: Rôles et portées
description: "Ce qu'un appelant peut faire : le plan des données que détient chaque personne, le plan d'administration que les rôles accordent, les portées qu'une application déclare pour elle-même, et la façon dont chaque identifiant les porte."
---

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Chaque requête vers un backend Rebase pose une seule question : cet appelant peut-il faire ceci ?
La réponse est une **portée** (scope), une chaîne nommée `resource:action` : `data:read`,
`users:write`, `cron:read`. La session d'une personne, une clé API, un jeton MCP et un
rôle détiennent tous des portées, et ils utilisent tous les mêmes chaînes. Une autorisation se lit
de la même façon sur une clé, sur un rôle et sur un écran de consentement.

## Deux plans

Les portées se répartissent en deux plans, et une personne ne les détient pas de la même façon.

**Le plan des données** regroupe `data:*`, `storage:*` et `functions:invoke`. Chaque
personne connectée le détient en entier. Ce qu'une personne peut faire d'une ligne est décidé par
les [règles de sécurité](/docs/collections/security-rules/) de la collection, ligne par ligne,
et ce qu'elle peut faire d'un fichier par les [politiques de stockage](/docs/backend/storage/#per-object-authorization).
Une portée ne décide jamais cela pour une personne. Sur une clé ou un jeton, les portées du plan
des données restreignent : une clé qui ne détient que `data:read:posts` lit `posts` et rien d'autre,
quoi que les règles permettraient.

**Le plan d'administration** regroupe tout le reste : utilisateurs, schéma, base de données,
sauvegardes, cron, journaux et clés. Personne ne le détient implicitement. Le rôle intégré `admin`
le détient en entier. Tout autre rôle détient ce que l'application déclare pour lui.

## Les portées

| Portée | Plan | Cible | Ce qu'elle permet |
|---|---|---|---|
| `data:read` | données | collection | Lire des lignes, à travers la sécurité au niveau des lignes de l'appelant |
| `data:write` | données | collection | Créer et mettre à jour des lignes, à travers la sécurité au niveau des lignes de l'appelant |
| `data:delete` | données | collection | Supprimer des lignes, à travers la sécurité au niveau des lignes de l'appelant |
| `storage:read` | données | source de stockage | Lister et télécharger des fichiers |
| `storage:write` | données | source de stockage | Téléverser des fichiers et créer des dossiers |
| `storage:delete` | données | source de stockage | Supprimer des fichiers |
| `functions:invoke` | données | fonction | Appeler des fonctions personnalisées. Une fonction peut faire tout ce que fait son code |
| `users:read` | administration | — | Lister les comptes et leurs rôles |
| `users:write` | administration | — | Créer, modifier et supprimer des comptes, réinitialiser des mots de passe et des seconds facteurs, attribuer des rôles jusqu'à ceux du détenteur |
| `schema:read` | administration | — | Lire le schéma des collections, planifier des changements de schéma, lancer l'audit RLS, lire la documentation privée de l'API |
| `schema:write` | administration | — | Appliquer des changements de schéma : modifie les fichiers de collection et altère la base de données |
| `database:read` | administration | — | Lister les bases de données, les tables, les rôles Postgres et les branches |
| `database:write` | administration | — | Exécuter du SQL en tant que propriétaire de la base de données, hors de la sécurité au niveau des lignes, et créer ou supprimer des branches |
| `backups:read` | administration | — | Lister et télécharger les sauvegardes : toutes les lignes, hors de la sécurité au niveau des lignes |
| `cron:read` | administration | — | Lister les tâches cron et lire leur historique d'exécution |
| `cron:write` | administration | — | Déclencher des tâches cron et les activer ou les désactiver |
| `logs:read` | administration | — | Lire les journaux du serveur |
| `keys:read` | administration | — | Lister les clés de service du projet. Jamais attribuable à une clé |
| `keys:write` | administration | — | Créer, modifier et révoquer des clés de service. Jamais attribuable à une clé |

`GET /api/auth/scopes` renvoie cette liste pour le backend en cours d'exécution, avec les portées
propres à l'application en plus, ainsi que les portées que détient l'appelant. Tout appelant
connecté peut la lire :

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Cibles

Une portée du plan des données peut être restreinte à une cible, après un second deux-points :

- `data:read:posts` ne lit que la collection `posts`. La cible est un slug de collection.
- `storage:write:avatars` ne téléverse que vers la source de stockage `avatars`. L'identifiant
  de la source par défaut est `(default)` : `storage:read:(default)`.
- `functions:invoke:export` n'appelle que la fonction `export`.

La portée simple couvre toutes les cibles. Une portée restreinte couvre sa propre cible et rien
d'autre. Elle ne répond jamais à une question qui porte sur toutes les cibles : une clé qui détient
`data:read:posts` ne peut pas lister toutes les collections.

Les portées du plan d'administration ne prennent pas de cible. Une portée d'application en prend
une quand elle déclare une `target`, comme ci-dessous.

## Déclarer des rôles

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Les rôles se déclarent dans la collection des utilisateurs, sous `auth.roles`. Un rôle est un nom
que la base de données voit, et que les politiques RLS peuvent cibler, plus une liste de portées du
plan d'administration et de portées d'application.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"]
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"]
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: { admin: "Admin", support: "Support", developer: "Developer", editor: "Editor" }
            }
        }
    }
});
```

Une personne détient un rôle quand sa colonne `roles` le liste. Attribuez-le dans le panneau
d'administration, ou avec `PUT /api/admin/users/:uid`.

Le démarrage refuse une déclaration qui se lirait comme une autorisation qu'elle n'est pas :

- **`admin` ne peut pas être déclaré.** Il est intégré et détient toutes les portées.
- **Un rôle ne peut pas lister une portée du plan des données.** Chaque personne détient déjà le
  plan des données. `data:write` sur un rôle n'accorderait rien tout en ayant l'air d'accorder
  quelque chose. Ce qu'un rôle peut faire des lignes relève des `securityRules` de la collection.
- **Chaque portée doit exister.** Un nom inconnu fait échouer le démarrage, qui liste les noms valides.

Un rôle que vous ne déclarez pas reste un rôle. `editor` ci-dessus n'a pas d'entrée, donc il ne
détient aucune portée du plan d'administration, et une politique RLS peut quand même le cibler.

`defaultRole`, le rôle que reçoit chaque nouvel inscrit, ne peut pas être `admin` ni un rôle
déclaré qui détient une portée du plan d'administration. Un inconnu qui s'inscrit ne doit rien
détenir qui gère le projet. Le démarrage le refuse.

:::note[`schema-admin` n'existe plus]
Les versions précédentes traitaient un rôle nommé `schema-admin` comme un second administrateur. Il
ne signifie plus rien à lui seul. Si votre projet l'utilisait, déclarez-le avec les portées que vous
entendiez lui donner, par exemple
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` liste `admin` et chaque rôle déclaré avec ses portées. Il exige
`users:read` :

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Portées d'application

Une application peut nommer ses propres opérations comme portées, sous `auth.scopes` :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project"
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Le nom est `resource:action`, en minuscules, sans cible. Il ne peut pas réutiliser une ressource
intégrée : `data`, `storage`, `functions`, `users`, `schema`, `database`, `backups`, `cron`,
`logs` et `keys` sont pris. `label` est obligatoire, car c'est ce qu'une personne lit quand elle
accorde la portée. `target` nomme ce que désigne une cible, pour qu'une clé puisse détenir
`project:deploy:p1`.

Chaque personne connectée détient toutes les portées d'application. Comme pour le plan des données,
le code derrière la portée décide si cette personne peut agir. La portée existe pour qu'une clé
puisse être restreinte à cette seule action. Un rôle peut aussi lister des portées d'application.

Vérifiez-en une dans une [fonction personnalisée](/docs/backend/custom-functions/) avec `requireScope` :

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

Une clé qui détient `project:deploy:p1` passe pour `p1` et reçoit `403 SCOPE_MISSING` pour tout
autre projet. Elle a aussi besoin de `functions:invoke`, ou de `functions:invoke:<name>` pour cette
fonction, pour pouvoir atteindre la fonction. `hasScope(c, scope, target)` et `getScopes(c)`
répondent à la même question dans un gestionnaire.

## Ce que signifie admin

`admin` est le seul rôle intégré, et c'est plus qu'une liste de portées :

- Il détient toutes les portées du plan d'administration, `keys:*` compris.
- C'est un rôle que la base de données voit. Les politiques par défaut que Rebase ajoute à chaque
  collection l'admettent, donc un administrateur lit et écrit toutes les lignes d'une collection
  qui les conserve. Une collection avec `disableDefaultPolicies: true` les supprime.
- Seul un administrateur peut accorder `admin`. Un rôle qui liste toutes les portées du plan
  d'administration n'est toujours pas `admin` : il ne peut pas distribuer `admin`, et les politiques
  par défaut ne l'admettent pas.

`requireAdmin` vérifie le rôle. Préférez `requireScope` pour tout ce qu'un rôle plus restreint ou
une clé doit pouvoir faire.

## Personne n'accorde plus qu'il ne détient

Une seule règle couvre chaque porte qui distribue un accès : **rien n'est accordé au-delà de ce
que détient celui qui l'accorde.**

Pour les clés :

- Les portées d'une clé doivent être comprises dans celles de son créateur. Sinon `403 SCOPE_EXCEEDS_CREATOR`.
- Les rôles RLS d'une clé de service doivent être des rôles que détient son créateur, sauf si le
  créateur est administrateur. Sinon `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` et `keys:write` ne vont jamais sur une clé. Une clé qui gère des clés pourrait créer
  sa propre remplaçante. `400 KEY_MANAGEMENT_SCOPE`.

Pour les comptes, un détenteur de `users:write` :

- ne peut pas modifier, réinitialiser ou supprimer un compte qui détient un rôle ou une portée
  qu'il ne détient pas : `403 ACCOUNT_OUTRANKS_CALLER`. Sans cela, un rôle de support pourrait
  réinitialiser le mot de passe d'un administrateur et se connecter à sa place.
- ne peut pas accorder des rôles qui détiennent plus que lui : `403 ROLE_EXCEEDS_CALLER`.

## Comment chaque identifiant détient des portées

| Identifiant | Agit en tant que | Détient |
|---|---|---|
| La session d'une personne | la personne | le plan des données, toutes les portées d'application, et les portées de ses rôles. Un administrateur détient tout |
| [Clé de service](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, avec les rôles RLS `service` plus ses propres `roles` | exactement ses portées |
| [Clé personnelle](/docs/backend/api-keys/#personal-keys) `rk_live_…` | son propriétaire, avec les rôles du propriétaire tels qu'ils sont à chaque requête | ses portées, réduites à ce que le propriétaire détient maintenant |
| [Jeton MCP](/docs/ai/mcp/#the-remote-endpoint) | la personne qui l'a connecté | `data:read`, `data:write`, `data:delete` tels qu'accordés, éventuellement par collection |
| `REBASE_SERVICE_KEY` | `service`, avec le rôle `admin` | tout |

Une clé ou un jeton ne contourne jamais la sécurité au niveau des lignes. Ses portées sont un
plafond, et les politiques de la base de données pour l'identité au nom de laquelle il agit en sont
un autre.

## Quand une portée manque

<span class="since-badge" data-since="0.24">Depuis 0.24</span> La réponse est `403 SCOPE_MISSING`, et `details.requiredScope` nomme la portée, avec sa cible
quand il y en a une :

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Pour une personne, la solution est un rôle qui liste la portée. Pour une clé, c'est une nouvelle
clé qui la détient.

## Prochaines étapes

- [Clés API](/docs/backend/api-keys/) : clés de service, clés personnelles, et les règles de création
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : ce qu'une personne peut faire de chaque ligne
- [Index des endpoints](/docs/backend/endpoints/) : la portée qu'exige chaque route
- [Codes d'erreur](/docs/backend/errors/#authentication-and-accounts) : chaque refus ci-dessus
