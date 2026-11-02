---
sourceHash: c7ba0e6c6150d210
title: Référence des outils MCP
sidebar_label: Référence des outils MCP
description: Tous les outils enregistrés par le serveur MCP Rebase, par groupe — ce dont chacun a besoin, ce qu'il fait, et ceux que le loopback gate refuse face à un projet non local.
---

Les outils que [`@rebasepro/mcp`](/docs/ai/mcp) met à disposition d'un assistant. Les détails sur sa connexion, les identifiants utilisés et la manière dont le [loopback gate](/docs/ai/mcp#the-loopback-gate) détermine ce que signifie ⚠ se trouvent sur la page [MCP server](/docs/ai/mcp).

53 outils, répartis en dix groupes. Les outils marqués d'un ⚠ sont refusés sur les cibles non locales, sauf désactivation explicite (opt-out).

## Schéma & base de données (13)

Exécute la CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_generate` | — | Générer le schéma Drizzle à partir des définitions de collection |
| `rebase_db_push` ⚠ | — | Appliquer le schéma directement à la base de données (raccourci de dev) |
| `rebase_schema_introspect` | — | Introspecter la base de données active vers des définitions de collection |
| `rebase_db_generate` | — | Générer les fichiers de migration SQL à partir des modifications de schéma |
| `rebase_db_migrate` ⚠ | — | Exécuter toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Générer le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecter les dérives entre les définitions, le schéma généré et la base de données active |
| `rebase_db_branch_create` ⚠ | `name` | Créer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_list` | — | Lister les branches de base de données (administrateurs uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprimer une branche de base de données (administrateurs uniquement) |
| `rebase_db_branch_info` | `name` | Informations et statut de la branche (administrateurs uniquement) |
| `rebase_db_branch_diff` | `name` | Ce qu'une branche a modifié par rapport à la base d'origine — schéma, politiques et lignes, avec les conflits ; ne modifie ni l'une ni l'autre (administrateurs uniquement) |
| `rebase_db_branch_switch` | — | Pointer cet environnement local vers une branche, ou revenir à la base de données principale (administrateurs uniquement) |

## Planification de schéma (1)

Demande au backend ce qu'une modification produirait, via `POST /api/admin/schema/plan`. Aucune CLI, et rien n'est écrit sur le disque — cela fonctionne sur la base de données de développement managée, ce que les commandes reposant sur Atlas ne peuvent pas faire.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Le SQL que la modification d'une collection exécuterait, et quelles instructions détruisent des données |

## Documents (5)

| Outil | Requis | Description |
|---|---|---|
| `list_documents` | `collection` | Lister les lignes, avec `limit`, `offset`, `orderBy`, `where` facultatifs |
| `get_document` | `collection`, `id` | Récupérer une seule ligne par son identifiant |
| `create_document` ⚠ | `collection`, `data` | Créer une ligne |
| `update_document` ⚠ | `collection`, `id`, `data` | Mettre à jour une ligne |
| `delete_document` ⚠ | `collection`, `id` | Supprimer une ligne |

## Utilisateurs & rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Lister tous les utilisateurs, rôles inclus |
| `create_user` ⚠ | `email` | Créer un utilisateur (`displayName`, `password`, `roles` facultatifs) |
| `update_user` ⚠ | `uid` | Mettre à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprimer un utilisateur |
| `list_roles` | — | Lister les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialiser un mot de passe via l'API admin |

`create_user` et `update_user` acceptent tous deux `roles`, de sorte que chacun peut attribuer des droits d'administrateur. C'est pourquoi ils sont protégés par le gate plutôt que traités comme simplement « additifs ».

## Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Lister les objets stockés |
| `storage_get_download_url` | `key` | Une URL de téléchargement temporaire signée et son expiration — pas les métadonnées de l'objet |
| `storage_delete_object` ⚠ | `key` | Supprimer un objet |

`storage_get_download_url` est classé comme une lecture car il ne modifie pas l'environnement — mais l'URL signée qu'il génère est une autorisation au porteur (bearer capability) qui persiste après l'appel de l'outil.

## Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Lister les tâches planifiées et leur statut |
| `cron_get_job` | `jobId` | Détails de la tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécuter une tâche immédiatement |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Activer ou désactiver une tâche |

`cron_toggle_job` peut désactiver silencieusement une sauvegarde ou une tâche de facturation — une modification sans erreur ni retour jusqu'à ce qu'un manque se fasse sentir ultérieurement.

## Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoquer une [fonction personnalisée](/docs/backend/custom-functions) avec n'importe quelle méthode et charge utile (payload) |

Ceci appelle du code que le serveur MCP n'a jamais vu, avec une méthode et un corps choisis par le modèle. Son rayon d'impact (blast radius) correspond à tout ce que vos fonctions sont capables de faire.

## Serveur de développement (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarrer le serveur de dev ; retourne immédiatement |
| `rebase_dev_logs` | — | Lire les sorties récentes (50 lignes par défaut, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrêter le serveur de dev |

## Registre de projets (7)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Lister les projets enregistrés et afficher le projet actif |
| `rebase_project_switch` | `name` | Changer de projet actif |
| `rebase_project_add` | `name` | Enregistrer un projet (`projectDir`, `baseUrl`, `token` facultatifs) |
| `rebase_project_remove` | `name` | Supprimer un projet (le projet par défaut ne peut pas être supprimé) |
| `rebase_project_current` | — | Afficher le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifier l'état de santé (health check) du backend actif |
| `rebase_project_use_cloud` | `project` | Cibler un projet Rebase Cloud du compte connecté par ID, slug ou nom, via le proxy Studio de la console |

`rebase_project_switch` n'est pas restreint par le gate, car il réoriente l'ensemble sans agir directement sur la cible. Un assistant peut donc basculer vers un projet distant sans déclencher le gate — il ne pourra simplement pas y exécuter d'outil destructeur par la suite. `rebase_project_use_cloud` fonctionne sur le même principe : il oriente les outils de données et d'administration vers un projet de production, où les lectures fonctionnent et le gate refuse les écritures.

## Rebase Cloud (9)

Exécute `rebase cloud … --json` dans le répertoire du projet actif, ciblant le projet auquel il est associé, avec les propres identifiants de la CLI. Consultez [Rebase Cloud](/docs/ai/mcp#rebase-cloud) pour découvrir sur quoi ils agissent et pourquoi aucun d'entre eux n'est soumis au gate.

| Outil | Requis | Description |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend opérationnel sans compte (`rebase cloud init --claim`) : l'URL de production, l'URL d'administration et une URL de revendication (`name`, `deploy`) |
| `rebase_cloud_status` | — | L'URL du projet associé, son statut, son dernier déploiement, son runtime, sa base de données, son stockage, ainsi que son URL de revendication tant qu'il n'est pas réclamé |
| `rebase_cloud_deploy` | — | Déployer et suivre le processus jusqu'à la fin (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Un instantané des journaux d'exécution, ou le dernier journal de build (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Ne suit jamais en temps réel |
| `rebase_cloud_env_list` | — | Les clés de variables, jamais les valeurs (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Définir une variable ; la valeur transite par stdin et n'est jamais renvoyée (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Déploiements récents, et ceux vers lesquels un retour arrière (rollback) est possible (`limit`) |
| `rebase_cloud_projects_list` | — | Tous les projets accessibles par le compte connecté, au sein de l'ensemble de ses organisations |
| `rebase_cloud_rollback` | — | Remettre en service un déploiement précédent ayant réussi (`deploymentId`) |

`rebase_cloud_provision` crée un projet et associe ce répertoire. Il ne lit jamais l'attribut `baseUrl` du projet actif, le gate ne le vérifie donc pas ; la CLI le refuse dans un répertoire déjà associé.
