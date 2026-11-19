---
sourceHash: 42fbd65cd7d89699
title: Référence des outils MCP
sidebar_label: Référence des outils MCP
description: Tous les outils enregistrés par le serveur MCP Rebase, par groupe — ce dont chacun a besoin et ce qu'il fait, et ceux que la loopback gate refuse face à un projet non local.
---

Les outils que [`@rebasepro/mcp`](/docs/ai/mcp) met à la disposition d'un assistant. La façon dont il se connecte, les identifiants qu'il détient et la manière dont la [loopback gate](/docs/ai/mcp#the-loopback-gate) détermine ce que signifie ⚠ sont décrits sur la page [serveur MCP](/docs/ai/mcp).

53 outils, répartis en dix groupes. Les outils marqués d'un ⚠ sont refusés sur les cibles non locales, sauf si vous choisissez de passer outre.

Chaque outil en dehors du groupe registre de projets, de `rebase_cloud_projects_list`, `rebase_cloud_provision` et `rebase_dev_logs` accepte également un paramètre optionnel `project` (un nom enregistré, ou un slug ou ID Cloud), vérifié par rapport au lien Cloud du répertoire de session avant son exécution. Consultez [Sur quel projet un appel agit](/docs/ai/mcp#which-project-a-call-acts-on).

## Schéma et base de données (13)

Exécute la CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_generate` | — | Génère le schéma Drizzle à partir des tables dans `backend/schema` |
| `rebase_db_push` ⚠ | — | Applique le schéma directement à la base de données (raccourci de dev) |
| `rebase_schema_introspect` | — | Écrit un `defineTable` dans `backend/schema` pour chaque table présente dans la base de données active |
| `rebase_db_generate` | — | Génère des fichiers de migration SQL à partir des modifications du schéma |
| `rebase_db_migrate` ⚠ | — | Exécute toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Génère le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecte les dérives entre les tables dans `backend/schema`, le schéma généré et la base de données active |
| `rebase_db_branch_create` ⚠ | `name` | Crée une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_list` | — | Liste les branches de base de données (administrateurs uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprime une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_info` | `name` | Informations et statut de la branche (administrateurs uniquement) |
| `rebase_db_branch_diff` | `name` | Ce qu'une branche a modifié par rapport à la base de données d'origine — schéma, politiques et lignes, avec les conflits ; ne modifie ni l'un ni l'autre (administrateurs uniquement) |
| `rebase_db_branch_switch` | — | Fait pointer ce checkout vers une branche, ou le rétablit sur la base de données principale (administrateurs uniquement) |

## Planification de schéma (1)

Demande au backend ce que produirait une modification via
`POST /api/admin/schema/plan`. Aucun processus CLI n'est nécessaire et rien
n'est écrit sur le disque. Cela fonctionne aussi sur la base de données de
développement gérée.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | `patches` | Le SQL qu'une liste de modifications `TablePatch` exécuterait, et quelles instructions détruisent des données — voir [Édition de schéma en direct](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Lignes (5)

Les mêmes noms que ceux utilisés par le `/mcp` distant ; ils s'appelaient `list_documents`, `get_document`, `create_document`, `update_document` et `delete_document`, avec un argument `collection`.

| Outil | Requis | Description |
|---|---|---|
| `query_table` | `table` | Lit les lignes, avec `limit`, `offset`, `orderBy`, `where` optionnels, comme le fait `data.table(name).find()` |
| `get_row` | `table`, `id` | Récupère une seule ligne par son ID |
| `create_row` ⚠ | `table`, `data` | Crée une ligne |
| `update_row` ⚠ | `table`, `id`, `data` | Met à jour une ligne ; seules les colonnes fournies sont modifiées |
| `delete_row` ⚠ | `table`, `id` | Supprime une ligne |

## Utilisateurs et rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Liste tous les utilisateurs, rôles inclus |
| `create_user` ⚠ | `email` | Crée un utilisateur (`displayName`, `password`, `roles` optionnels) |
| `update_user` ⚠ | `uid` | Met à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprime un utilisateur |
| `list_roles` | — | Liste les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialise un mot de passe via l'API d'administration |

`create_user` et `update_user` acceptent tous deux `roles`, de sorte que chacun peut attribuer des droits d'administrateur. C'est pourquoi ils sont soumis au contrôle de la gate plutôt que considérés comme simplement « additifs ».

## Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Liste les objets stockés |
| `storage_get_download_url` | `key` | Une URL de téléchargement signée temporaire et son expiration — pas les métadonnées de l'objet |
| `storage_delete_object` ⚠ | `key` | Supprime un objet |

`storage_get_download_url` est classé comme une lecture car il ne modifie pas l'environnement — mais l'URL signée qu'il génère est un jeton d'accès au porteur qui subsiste au-delà de l'appel de l'outil.

## Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Liste les tâches planifiées et leur statut |
| `cron_get_job` | `jobId` | Détails de la tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécute une tâche immédiatement |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Active ou désactive une tâche |

`cron_toggle_job` peut désactiver silencieusement une tâche de sauvegarde ou de facturation — un changement sans erreur ni résultat immédiat, jusqu'à ce qu'un élément vienne à manquer plus tard.

## Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoque une [fonction personnalisée](/docs/backend/custom-functions) avec n'importe quelle méthode et charge utile |

Ceci appelle du code que le serveur MCP n'a jamais vu, avec une méthode et un corps choisis par le modèle. Son rayon d'impact correspond à tout ce que vos fonctions effectuent.

## Serveur de développement (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarre le serveur de dev ; retourne immédiatement |
| `rebase_dev_logs` | — | Lit la sortie récente (par défaut 50 lignes, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrête le serveur de dev |

## Registre de projets (7)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Liste les projets enregistrés et affiche le projet actif |
| `rebase_project_switch` | `name` | Change de projet actif |
| `rebase_project_add` | `name` | Enregistre un projet (`projectDir`, `baseUrl`, `token` optionnels) |
| `rebase_project_remove` | `name` | Supprime un projet (le projet par défaut ne peut pas être supprimé) |
| `rebase_project_current` | — | Affiche le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifie l'état de santé du backend actif |
| `rebase_project_use_cloud` | `project` | Cible un projet Rebase Cloud du compte connecté par ID, slug ou nom, via le proxy Studio de la console |

`rebase_project_switch` n'est pas soumis à la gate, car il redirige tout le reste au lieu d'agir directement sur une cible. Un assistant peut donc basculer vers un projet distant sans déclencher la gate — il ne pourra simplement pas y exécuter ensuite d'outil destructif. `rebase_project_use_cloud` est le même type de bascule : il fait pointer les outils de données et d'administration vers un projet de production, où les lectures fonctionnent et où la gate refuse les écritures.

## Rebase Cloud (9)

Exécute `rebase cloud … --json` dans le répertoire du projet actif, ciblant le projet auquel il est associé, avec les propres identifiants de la CLI. Consultez [Rebase Cloud](/docs/ai/mcp#rebase-cloud) pour savoir sur quoi ils agissent et pourquoi aucun d'entre eux n'est soumis à la gate.

| Outil | Requis | Description |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend actif sans compte (`rebase cloud init --claim`) : l'URL active, l'URL d'administration et une URL de revendication (`name`, `deploy`, `confirm`). Sans `confirm: true`, il indique uniquement ce qu'il ferait |
| `rebase_cloud_status` | — | L'URL du projet lié, son statut, son dernier déploiement, son runtime, sa base de données, son stockage, ainsi que son URL de revendication tant qu'il n'est pas réclamé |
| `rebase_cloud_deploy` | — | Déploie et suit le processus jusqu'à la fin (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`, `confirm`). Un déploiement en production sans `confirm: true` indique uniquement ce qu'il ferait |
| `rebase_cloud_logs` | — | Un instantané du journal d'exécution (runtime) ou du dernier journal de build (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Ne suit jamais en temps réel |
| `rebase_cloud_env_list` | — | Clés de variables, jamais les valeurs (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Définit une variable ; la valeur transite par stdin et n'est jamais renvoyée (`secret`, `preview`, `confirm`). En production, sans `confirm: true`, il indique uniquement ce qu'il ferait |
| `rebase_cloud_deployments_list` | — | Déploiements récents, et ceux vers lesquels un rollback est possible (`limit`) |
| `rebase_cloud_projects_list` | — | Tous les projets auxquels le compte connecté a accès, dans l'ensemble de ses organisations |
| `rebase_cloud_rollback` | — | Remet en service un déploiement réussi antérieur (`deploymentId`, `confirm`). Sans `confirm: true`, il indique uniquement ce qu'il ferait |

`rebase_cloud_provision` crée un projet et associe ce répertoire. Il ne lit jamais l'attribut `baseUrl` du projet actif, la gate ne le vérifie donc pas ; la CLI le refuse dans un répertoire déjà lié.
