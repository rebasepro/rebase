---
sourceHash: 50d3082d86c52ae2
title: Référence des outils MCP
sidebar_label: Référence des outils MCP
description: Tous les outils enregistrés par le serveur MCP Rebase, par groupe — ce dont chacun a besoin et ce qu'il fait, et ceux que la barrière de bouclage (loopback gate) refuse face à un projet non local.
---

Les outils que [`@rebasepro/mcp`](/docs/ai/mcp) met à disposition d'un assistant. La façon dont il se connecte, les identifiants qu'il détient et la manière dont la [barrière de bouclage (loopback gate)](/docs/ai/mcp#the-loopback-gate) détermine la signification de ⚠ sont décrits sur la page du [serveur MCP](/docs/ai/mcp).

53 outils, répartis en dix groupes. Les outils marqués d'un ⚠ sont refusés sur les cibles non locales, sauf si vous choisissez de désactiver cette restriction.

## Schéma & base de données (13)

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Exécute la CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_generate` | — | Générer le schéma Drizzle à partir des tables dans `backend/schema` |
| `rebase_db_push` ⚠ | — | Appliquer directement le schéma à la base de données (raccourci de développement) |
| `rebase_schema_introspect` | — | Écrire un `defineTable` dans `backend/schema` pour chaque table présente dans la base de données active |
| `rebase_db_generate` | — | Générer les fichiers de migration SQL à partir des modifications de schéma |
| `rebase_db_migrate` ⚠ | — | Exécuter toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Générer le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecter les dérives entre les tables dans `backend/schema`, le schéma généré et la base de données active |
| `rebase_db_branch_create` ⚠ | `name` | Créer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_list` | — | Lister les branches de base de données (administrateurs uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprimer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_info` | `name` | Informations et statut de la branche (administrateurs uniquement) |
| `rebase_db_branch_diff` | `name` | Ce qu'une branche a modifié par rapport à la base de données d'origine — schéma, politiques et lignes, avec conflits ; ne modifie ni l'une ni l'autre (administrateurs uniquement) |
| `rebase_db_branch_switch` | — | Pointer cet espace de travail vers une branche, ou revenir à la base de données principale (administrateurs uniquement) |

## Planification de schéma (1)

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Demande au backend ce qu'une modification produirait, via `POST /api/admin/schema/plan`. Aucune CLI, et rien n'est écrit sur le disque — cela fonctionne sur la base de données de développement gérée, ce que les commandes reposant sur Atlas ne peuvent pas faire.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | `patches` | Le SQL qu'une liste de modifications `TablePatch` exécuterait, et quelles instructions détruisent des données — voir [Modification du schéma en direct](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Lignes (5)

<span class="since-badge" data-since="0.31">Depuis 0.31</span> Les mêmes noms que ceux utilisés par le `/mcp` distant ; ils s'appelaient auparavant `list_documents`, `get_document`, `create_document`, `update_document` et `delete_document`, avec un argument `collection`.

| Outil | Requis | Description |
|---|---|---|
| `query_table` | `table` | Lire les lignes, avec `limit`, `offset`, `orderBy`, `where` facultatifs, tout comme le fait `data.table(name).find()` |
| `get_row` | `table`, `id` | Récupérer une seule ligne par son identifiant |
| `create_row` ⚠ | `table`, `data` | Créer une ligne |
| `update_row` ⚠ | `table`, `id`, `data` | Mettre à jour une ligne ; seules les colonnes indiquées sont modifiées |
| `delete_row` ⚠ | `table`, `id` | Supprimer une ligne |

## Utilisateurs & rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Lister tous les utilisateurs, y compris leurs rôles |
| `create_user` ⚠ | `email` | Créer un utilisateur (`displayName`, `password`, `roles` facultatifs) |
| `update_user` ⚠ | `uid` | Mettre à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprimer un utilisateur |
| `list_roles` | — | Lister les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialiser un mot de passe via l'API d'administration |

`create_user` et `update_user` acceptent tous deux `roles`, de sorte que chacun peut attribuer des privilèges d'administrateur. C'est pourquoi ils sont restreints plutôt que simplement considérés comme « additifs ».

## Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Lister les objets stockés |
| `storage_get_download_url` | `key` | Une URL de téléchargement signée temporaire et son expiration — pas les métadonnées de l'objet |
| `storage_delete_object` ⚠ | `key` | Supprimer un objet |

`storage_get_download_url` est classé comme une lecture car il ne modifie pas l'environnement — mais l'URL signée qu'il génère est un jeton de délégation (bearer) dont la durée de vie dépasse l'appel de l'outil.

## Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Lister les tâches planifiées et leur statut |
| `cron_get_job` | `jobId` | Détails de la tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécuter immédiatement une tâche |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Activer ou désactiver une tâche |

`cron_toggle_job` peut désactiver silencieusement une sauvegarde ou une tâche de facturation — une modification sans erreur ni sortie visible jusqu'à ce que quelque chose vienne à manquer plus tard.

## Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoquer une [fonction personnalisée](/docs/backend/custom-functions) avec n'importe quelle méthode et charge utile |

Cela appelle du code que le serveur MCP n'a jamais vu, avec une méthode et un corps choisis par le modèle. Son rayon d'action correspond à tout ce que vos fonctions peuvent faire.

## Serveur de développement (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarrer le serveur de développement ; rend la main immédiatement |
| `rebase_dev_logs` | — | Lire les sorties récentes (par défaut 50 lignes, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrêter le serveur de développement |

## Registre des projets (7)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Lister les projets enregistrés et afficher celui qui est actif |
| `rebase_project_switch` | `name` | Changer le projet actif |
| `rebase_project_add` | `name` | Enregistrer un projet (`projectDir`, `baseUrl`, `token` facultatifs) |
| `rebase_project_remove` | `name` | Supprimer un projet (le projet par défaut ne peut pas être supprimé) |
| `rebase_project_current` | — | Afficher le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifier l'état de santé du backend actif |
| `rebase_project_use_cloud` | `project` | Cibler un projet Rebase Cloud du compte connecté par identifiant, slug ou nom, via le proxy Studio de la console |

`rebase_project_switch` n'est pas restreint, car il réoriente l'ensemble du contexte plutôt que d'agir directement sur une cible. Un assistant peut donc basculer vers un projet distant sans déclencher la barrière — il ne pourra simplement pas y exécuter d'outil destructeur par la suite. `rebase_project_use_cloud` applique le même principe : il fait pointer les outils de données et d'administration vers un projet de production, où les lectures fonctionnent et où la barrière refuse les écritures.

## Rebase Cloud (9)

Exécute `rebase cloud … --json` dans le répertoire du projet actif, sur le projet auquel il est lié, avec les identifiants propres à la CLI. Consultez [Rebase Cloud](/docs/ai/mcp#rebase-cloud) pour savoir sur quoi ces outils agissent et pourquoi aucun d'entre eux n'est restreint.

| Outil | Requis | Description |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend actif sans compte (`rebase cloud init --claim`) : l'URL active, l'URL d'administration et une URL de réclamation (`name`, `deploy`) |
| `rebase_cloud_status` | — | L'URL du projet lié, son statut, son dernier déploiement, son runtime, sa base de données, son stockage et son URL de réclamation tant qu'il n'est pas réclamé |
| `rebase_cloud_deploy` | — | Déployer et suivre jusqu'à la fin (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Un instantané du journal d'exécution (runtime), ou le journal du dernier build (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Ne suit jamais en flux continu |
| `rebase_cloud_env_list` | — | Clés des variables, jamais les valeurs (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Définir une variable ; la valeur transite par stdin et n'est jamais renvoyée (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Déploiements récents, et ceux vers lesquels un retour arrière (rollback) est possible (`limit`) |
| `rebase_cloud_projects_list` | — | Tous les projets auxquels le compte connecté a accès, dans l'ensemble de ses organisations |
| `rebase_cloud_rollback` | — | Remettre en service un déploiement réussi antérieur (`deploymentId`) |

`rebase_cloud_provision` crée un projet et associe ce répertoire. Il ne lit jamais la `baseUrl` du projet actif, la barrière ne le contrôle donc pas ; la CLI le refuse s'il est exécuté dans un répertoire déjà lié.
