---
sourceHash: e68d814b6b83ef41
title: Référence des outils MCP
sidebar_label: Référence des outils MCP
description: Chaque outil que le serveur MCP Rebase enregistre, par groupe — ce dont chacun a besoin, ce qu'il fait, et ceux que le verrou loopback refuse sur un projet non local.
---

Les outils que [`@rebasepro/mcp`](/docs/ai/mcp) propose à un assistant. La façon dont il se
connecte, l'identifiant qu'il détient et la façon dont le [verrou loopback](/docs/ai/mcp#the-loopback-gate)
décide ce que signifie ⚠ sont décrits sur la page du [serveur MCP](/docs/ai/mcp).

42 outils, répartis en neuf groupes. Les outils marqués d'un ⚠ sont refusés sur les cibles non locales
à moins que vous ne désactiviez cette protection.

## Schéma et base de données (12)

Lancent la CLI Rebase dans le répertoire du projet actif.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_generate` | — | Générer le schéma Drizzle à partir des définitions de collections |
| `rebase_db_push` ⚠ | — | Appliquer le schéma directement à la base de données (raccourci de dev) |
| `rebase_schema_introspect` | — | Introspecter la base de données en direct pour générer les définitions de collections |
| `rebase_db_generate` | — | Générer les fichiers de migration SQL à partir des modifications de schéma |
| `rebase_db_migrate` ⚠ | — | Exécuter toutes les migrations SQL en attente |
| `rebase_generate_sdk` | — | Générer le SDK TypeScript entièrement typé |
| `rebase_doctor` | — | Détecter les dérives entre les définitions, le schéma généré et la base de données en direct |
| `rebase_db_branch_create` ⚠ | `name` | Créer une branche de base de données (admins uniquement) |
| `rebase_db_branch_list` | — | Lister les branches de base de données (admins uniquement) |
| `rebase_db_branch_delete` ⚠ | `name` | Supprimer une branche de base de données (admins uniquement) |
| `rebase_db_branch_info` | `name` | Informations et statut de la branche (admins uniquement) |
| `rebase_db_branch_switch` | — | Pointer cette copie locale sur une branche, ou revenir à la base principale (admins uniquement) |

## Planification de schéma (1)

Demande au backend ce qu'impliquerait un changement, via `POST /api/admin/schema/plan`. Aucune
CLI et aucune écriture sur le disque — cela fonctionne sur la base de données de développement managée,
ce que les commandes basées sur Atlas ne peuvent pas faire.

| Outil | Requis | Description |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Le SQL que la modification d'une collection exécuterait, et les instructions qui détruisent des données |

## Documents (5)

| Outil | Requis | Description |
|---|---|---|
| `list_documents` | `collection` | Lister les lignes, avec `limit`, `offset`, `orderBy`, `where` facultatifs |
| `get_document` | `collection`, `id` | Récupérer une seule ligne par ID |
| `create_document` ⚠ | `collection`, `data` | Créer une ligne |
| `update_document` ⚠ | `collection`, `id`, `data` | Mettre à jour une ligne |
| `delete_document` ⚠ | `collection`, `id` | Supprimer une ligne |

## Utilisateurs et rôles (6)

| Outil | Requis | Description |
|---|---|---|
| `list_users` | — | Lister tous les utilisateurs, y compris les rôles |
| `create_user` ⚠ | `email` | Créer un utilisateur (`displayName`, `password`, `roles` facultatifs) |
| `update_user` ⚠ | `uid` | Mettre à jour l'e-mail, le nom d'affichage ou les rôles |
| `delete_user` ⚠ | `uid` | Supprimer un utilisateur |
| `list_roles` | — | Lister les rôles définis |
| `rebase_auth_reset_password` ⚠ | `email` | Réinitialiser un mot de passe via l'API admin |

`create_user` et `update_user` acceptent tous deux `roles`, de sorte que l'un ou l'autre peut attribuer
les droits admin. C'est pourquoi ils sont verrouillés plutôt que considérés comme simplement « additifs ».

## Stockage (3)

| Outil | Requis | Description |
|---|---|---|
| `storage_list_objects` | — | Lister les objets stockés |
| `storage_get_download_url` | `key` | Une URL de téléchargement signée temporaire et son expiration — et non les métadonnées de l'objet |
| `storage_delete_object` ⚠ | `key` | Supprimer un objet |

`storage_get_download_url` est classé comme une lecture car il ne modifie pas l'environnement — mais l'URL signée
qu'il génère est un jeton au porteur qui survit à l'appel de l'outil.

## Cron (5)

| Outil | Requis | Description |
|---|---|---|
| `cron_list_jobs` | — | Lister les tâches planifiées et leur statut |
| `cron_get_job` | `jobId` | Détails de la tâche |
| `cron_get_job_logs` | `jobId` | Journaux d'exécution |
| `cron_trigger_job` ⚠ | `jobId` | Exécuter une tâche immédiatement |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Activer ou désactiver une tâche |

`cron_toggle_job` peut désactiver silencieusement une sauvegarde ou une tâche de facturation — une modification
sans erreur ni retour jusqu'à ce que quelque chose vienne à manquer plus tard.

## Fonctions (1)

| Outil | Requis | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoquer une [fonction personnalisée](/docs/backend/custom-functions) avec n'importe quelle méthode et charge utile |

Cela exécute du code que le serveur MCP n'a jamais vu, avec une méthode et un corps choisis par le modèle.
Son rayon d'impact correspond à tout ce que vos fonctions réalisent.

## Serveur de dev (3)

| Outil | Requis | Description |
|---|---|---|
| `rebase_dev_start` | — | Démarrer le serveur de dev ; retourne immédiatement |
| `rebase_dev_logs` | — | Lire les sorties récentes (50 lignes par défaut, tampon de 500 lignes) |
| `rebase_dev_stop` | — | Arrêter le serveur de dev |

## Registre de projets (6)

| Outil | Requis | Description |
|---|---|---|
| `rebase_project_list` | — | Lister les projets enregistrés et afficher le projet actif |
| `rebase_project_switch` | `name` | Changer le projet actif |
| `rebase_project_add` | `name` | Enregistrer un projet (`baseUrl`, `projectDir` et `token` facultatifs) |
| `rebase_project_remove` | `name` | Supprimer un projet (le projet default ne peut pas être supprimé) |
| `rebase_project_current` | — | Afficher le projet actif et son statut d'authentification |
| `rebase_project_status` | — | Vérifier la santé du backend actif |

`rebase_project_switch` n'est pas verrouillé, car il réoriente tout le reste plutôt que d'agir
directement sur une cible. Un assistant peut donc basculer vers un projet distant sans déclencher
le verrou — il ne pourra simplement pas y exécuter d'outil destructeur ensuite.
