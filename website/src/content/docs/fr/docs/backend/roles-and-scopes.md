---
sourceHash: 3b3d8ad69537b827
title: Rôles et scopes
sidebar_label: Rôles et scopes
description: "Ce qu'un appelant peut faire : le plan de données détenu par chaque personne, le plan d'administration accordé par les rôles, les scopes qu'une application déclare pour elle-même, et la façon dont chaque identifiant les porte."
---

Chaque requête envoyée à un backend Rebase pose une seule question : cet appelant peut-il faire cela ?
La réponse est un **scope**, une chaîne au format `resource:action` : `data:read`,
`users:write`, `cron:read`. La session d'une personne, une clé d'API, un jeton MCP et un
rôle détiennent tous des scopes, et ils utilisent tous les mêmes chaînes. Une attribution se lit de la même façon
sur une clé, sur un rôle et sur un écran de consentement.

## Deux plans

Les scopes se répartissent en deux plans, et une personne les détient différemment.

**Le plan de données** comprend `data:*`, `storage:*` et `functions:invoke`. Chaque
personne connectée détient l'ensemble de ces scopes. Ce qu'une personne peut faire avec une ligne est déterminé par
la [sécurité au niveau des lignes](/docs/collections/security-rules/) de la table, ligne par ligne,
et ce qu'elle peut faire avec un fichier par les [politiques de stockage](/docs/backend/storage-authorization/).
Un scope ne décide jamais de cela pour une personne. Sur une clé ou un jeton, les scopes du plan de données
restreignent l'accès : une clé qui ne détient que `data:read:posts` lit `posts` et rien d'autre,
quelles que soient les autorisations accordées par les règles.

**Le plan d'administration** comprend tout le reste : les utilisateurs, le schéma, la base de données, les sauvegardes,
le cron, les logs et les clés. Personne ne le détient implicitement. Le rôle intégré `admin` détient
la totalité de ce plan. Tout autre rôle détient ce que l'application déclare pour lui.

## Les scopes

| Scope | Plan | Cible | Ce qu'il permet |
|---|---|---|---|
| `data:read` | données | collection | Lire des lignes, selon la sécurité au niveau des lignes de l'appelant |
| `data:write` | données | collection | Créer et modifier des lignes, selon la sécurité au niveau des lignes de l'appelant |
| `data:delete` | données | collection | Supprimer des lignes, selon la sécurité au niveau des lignes de l'appelant |
| `storage:read` | données | source de stockage | Lister et télécharger des fichiers |
| `storage:write` | données | source de stockage | Téléverser des fichiers et créer des dossiers |
| `storage:delete` | données | source de stockage | Supprimer des fichiers |
| `functions:invoke` | données | fonction | Appeler des fonctions personnalisées. Une fonction peut faire tout ce que son code fait |
| `users:read` | admin | — | Lister les comptes et leurs rôles |
| `users:write` | admin | — | Créer, modifier et supprimer des comptes, réinitialiser des mots de passe et des seconds facteurs, attribuer des rôles dans la limite de ceux du détenteur |
| `schema:read` | admin | — | Lire le schéma, planifier les modifications de schéma, exécuter l'audit RLS, lire la documentation de l'API privée |
| `schema:write` | admin | — | Appliquer les modifications de schéma : modifie les fichiers de schéma et altère la base de données |
| `database:read` | admin | — | Lister les bases de données, les tables, les rôles Postgres et les branches |
| `database:write` | admin | — | Exécuter du SQL en tant que propriétaire de la base de données, hors sécurité au niveau des lignes, et créer ou supprimer des branches |
| `backups:read` | admin | — | Lister et télécharger les sauvegardes : chaque ligne, hors sécurité au niveau des lignes |
| `cron:read` | admin | — | Lister les tâches cron et consulter leur historique d'exécution |
| `cron:write` | admin | — | Déclencher les tâches cron et les activer ou désactiver |
| `logs:read` | admin | — | Lire les logs du serveur |
| `keys:read` | admin | — | Lister les clés de service du projet. Ne peut jamais être accordé à une clé |
| `keys:write` | admin | — | Créer, modifier et révoquer les clés de service. Ne peut jamais être accordé à une clé |

`GET /api/auth/scopes` renvoie cette liste pour le backend en cours d'exécution, avec les
propres scopes de l'application ajoutés, ainsi que les scopes détenus par l'appelant. Tout appelant connecté
peut la lire :

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Cibles

Un scope du plan de données peut être restreint à une cible, après un deuxième deux-points :

- `data:read:posts` lit uniquement la table `posts`. La cible est le slug d'une table.
- `storage:write:avatars` téléverse uniquement vers la source de stockage `avatars`. L'identifiant de la source
  par défaut est `(default)` : `storage:read:(default)`.
- `functions:invoke:export` appelle uniquement la fonction `export`.

Le scope générique couvre toutes les cibles. Un scope restreint ne couvre que sa propre cible et
rien d'autre. Il ne répond jamais à une question concernant l'ensemble des cibles : une clé détenant
`data:read:posts` ne peut pas lister toutes les tables.

Les scopes du plan d'administration n'acceptent aucune cible. Un scope applicatif en accepte une lorsqu'il déclare
une propriété `target`, comme ci-dessous.

## Déclarer des rôles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les rôles sont déclarés sur la [table des utilisateurs](/docs/schema/auth-table/), sous
`auth.roles`. Un rôle est un nom visible par la base de données, auquel les politiques de
sécurité au niveau des lignes peuvent correspondre, accompagné d'une liste de scopes applicatifs et du plan d'administration.

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

Le démarrage refuse toute déclaration qui s'apparenterait à une attribution trompeuse :

- **`admin` ne peut pas être déclaré.** Il est intégré et détient tous les scopes.
- **Un rôle ne peut pas lister un scope du plan de données.** Chaque personne détient déjà le plan
  de données. `data:write` sur un rôle n'accorderait rien tout en donnant l'impression d'accorder
  quelque chose. Ce qu'un rôle peut faire avec les lignes relève de la politique [`rls`](/docs/collections/security-rules/) de la table.
- **Chaque scope doit exister.** Un nom inconnu fait échouer le démarrage et liste les noms valides.

Un rôle que vous ne déclarez pas reste un rôle. `editor` ci-dessus n'a pas d'entrée, il ne détient
donc aucun scope du plan d'administration, et une politique RLS peut toujours lui correspondre.

`defaultRole`, le rôle attribué à chaque nouvel inscrit, ne peut pas être `admin` ni un
rôle déclaré détenant un quelconque scope du plan d'administration. Un inconnu qui s'inscrit ne doit
rien détenir permettant de gérer le projet. Le démarrage le refuse.

:::note[`schema-admin` a disparu]
Les versions antérieures traitaient un rôle nommé `schema-admin` comme un second admin. Il ne
signifie désormais plus rien en lui-même. Si votre projet l'utilisait, déclarez-le avec les scopes
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

## Scopes applicatifs

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une application peut nommer ses propres opérations sous forme de scopes, sous `auth.scopes` :

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
`database`, `backups`, `cron`, `logs` et `keys` sont réservées. `label` est obligatoire,
car c'est ce qu'une personne lit lorsqu'elle accorde le scope. `target` définit la signification
d'une cible, permettant ainsi à une clé de détenir `project:deploy:p1`.

Chaque personne connectée détient tous les scopes applicatifs. Comme pour le plan de données, le code
associé au scope décide si cette personne peut agir. Le scope existe afin qu'une
clé puisse être restreinte à cette seule action. Un rôle peut également lister des scopes applicatifs.

Vérifiez-en un dans une [fonction personnalisée](/docs/backend/custom-functions/) avec `requireScope` :

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

Une clé détenant `project:deploy:p1` passe pour `p1` et reçoit un code `403 SCOPE_MISSING`
pour tout autre projet. Elle nécessite également `functions:invoke`, ou
`functions:invoke:<name>` pour cette fonction, pour simplement pouvoir atteindre la fonction.
`hasScope(c, scope, target)` et `getScopes(c)` répondent à la même question au sein d'un
gestionnaire.

`requireScope` refuse un scope que personne ne pourrait détenir. Un nom qui n'est pas un scope, ou un scope
intégré mal orthographié tel que `data:raed`, lève une erreur au chargement de la fonction. Un scope applicatif
que le backend ne déclare pas sous `auth.scopes` renvoie à chaque appelant, y compris un
administrateur, `500 SCOPE_NOT_DECLARED`.

## Ce que signifie admin

`admin` est le seul rôle intégré, et il est bien plus qu'une simple liste de scopes :

- Il détient tous les scopes du plan d'administration, y compris `keys:*`.
- C'est un rôle visible par la base de données. Les politiques par défaut ajoutées par Rebase à chaque
  table l'acceptent, ce qui permet à un admin de lire et d'écrire chaque ligne d'une table qui les
  conserve. Une table configurée avec `defaultPolicies: false` les supprime.
- Seul un admin peut accorder le rôle `admin`. Un rôle qui liste tous les scopes du plan d'administration
  n'est toujours pas `admin` : il ne peut pas distribuer `admin`, et les politiques par défaut ne
  l'admettent pas.

`requireAdmin` vérifie la présence du rôle. Privilégiez `requireScope` pour tout ce qu'un rôle plus
restreint ou une clé devrait pouvoir effectuer.

## Nul ne peut accorder plus qu'il ne détient

Une règle régit chaque point d'accès qui octroie des droits : **rien ne peut être accordé au-delà de ce que détient l'auteur de l'attribution.**

Pour les clés :

- Les scopes d'une clé doivent être inclus dans ceux de son créateur. Sinon, une erreur `403 SCOPE_EXCEEDS_CREATOR` est retournée.
- Les rôles RLS d'une clé de service doivent être des rôles que son créateur détient, à moins que le créateur
  ne soit un admin. Sinon : `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` et `keys:write` ne sont jamais attribués à une clé. Une clé gérant des clés pourrait
  générer son propre successeur : `400 KEY_MANAGEMENT_SCOPE`.
- Un détenteur de `keys:write` ne peut pas modifier ou révoquer une clé qui possède un rôle ou un
  scope qu'il ne détient pas, sauf s'il est admin : `403 KEY_OUTRANKS_CALLER`.
  Sans cela, il pourrait étendre une clé avec un rôle admin à tous les scopes de données.

Pour les comptes, un détenteur de `users:write` :

- ne peut pas modifier, réinitialiser ou supprimer un compte dont les rôles possèdent un scope qu'il ne détient pas,
  ou le rôle `admin` s'il n'est pas lui-même admin :
  `403 ACCOUNT_OUTRANKS_CALLER`. Sans cela, un rôle support pourrait réinitialiser le mot
  de passe d'un admin et se connecter à sa place.
- ne peut pas accorder de rôles détenant plus de privilèges que lui, `admin` inclus : `403 ROLE_EXCEEDS_CALLER`.

Un nom de rôle peut être n'importe quelle chaîne, sauf un nom qui pourrait être réinterprété comme d'autres
rôles : un nom vide, ou contenant `,`, `{`, `}`, `"`, `\` ou un caractère
de contrôle, est rejeté avec `400 INVALID_ROLE` partout où un rôle peut être écrit (utilisateurs,
la table des utilisateurs, clés de service).

## Comment chaque identifiant détient des scopes

| Identifiant | Agit en tant que | Détient |
|---|---|---|
| Session d'une personne | la personne | le plan de données, chaque scope applicatif et les scopes de ses rôles. Un admin détient tout |
| [Clé de service](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, avec les rôles RLS `service` plus ses propres `roles` | exactement ses scopes |
| [Clé personnelle](/docs/backend/api-keys/#personal-keys) `rk_live_…` | son propriétaire, avec les rôles du propriétaire tels qu'ils sont à chaque requête | ses scopes, limités à ce que le propriétaire détient actuellement |
| [Jeton MCP](/docs/ai/remote-mcp/) | la personne qui l'a connecté | `data:read`, `data:write`, `data:delete` tels qu'accordés, éventuellement par collection |
| `REBASE_SERVICE_KEY` | `service`, avec le rôle `admin` | tout |

Une clé ou un jeton ne contourne jamais la sécurité au niveau des lignes. Ses scopes constituent un premier plafond,
et les politiques de la base de données pour l'identité sous laquelle il agit en forment un autre.

## Lorsqu'un scope est manquant

La réponse est `403 SCOPE_MISSING`, et `details.requiredScope` indique le nom du scope,
avec sa cible s'il en a une :

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Pour une personne, la solution consiste à lui attribuer un rôle listant ce scope. Pour une clé, il faut créer une nouvelle clé
qui le détient.

## Prochaines étapes

- [Clés d'API](/docs/backend/api-keys/) : clés de service, clés personnelles et règles de génération
- [Sécurité au niveau des lignes](/docs/collections/security-rules/) : ce qu'une personne peut faire avec chaque ligne
- [Index des points de terminaison](/docs/backend/endpoints/) : le scope requis pour chaque route
- [Codes d'erreur](/docs/backend/errors/#authentication-and-accounts) : chaque refus mentionné ci-dessus
