---
sourceHash: 7fea9b51c30a3c41
title: Index des endpoints
sidebar_label: Index des endpoints
description: Chaque route HTTP montée par un backend Rebase — données, auth, stockage, admin, méta — avec son contrôle d'accès et la page qui l'explique.
---

Toutes les routes montées par le serveur, regroupées dans un tableau, avec les conditions requises pour y accéder.

Les chemins partent du principe que le `basePath` par défaut est `/api` ; `REBASE_BASE_PATH` les déplace tous ensemble. `/health`, `/livez` et `/metrics` sont situés en dehors intentionnellement, car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le chemin de base. `/health` est *également* monté en dessous, de sorte que `/api/health` réponde de la même manière plutôt que de renvoyer une erreur 404 au moment même où quelqu'un vérifie si le serveur est opérationnel.

Un script de contrôle — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare ce tableau aux routes enregistrées par le code source, de sorte qu'aucune nouvelle surface ne puisse être ajoutée sans apparaître ici.

## Gates

| Gate | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé d'API restreinte à l'opération |
| **`resource:action`** | Un appelant détenant ce [scope](/docs/backend/roles-and-scopes/) : un administrateur, une personne dont le rôle le déclare, une clé d'API créée avec celui-ci, ou la clé de service |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Data

Généré par table, de sorte que les chemins utilisent vos slugs plutôt qu'une liste fixe. `:slug` est le slug d'une table (son nom, sauf si `defineTable` définit `slug`).

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Requêtes](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Le listing, avec les paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Requêtes](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Le décompte, avec les paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcule une vue matérialisée, sur les vues qui sont matérialisées — [Vues](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsolète de `PATCH` — même écriture partielle, répond avec `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insère plusieurs lignes, avec upsert facultatif — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Met à jour plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprime plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écrit à travers plusieurs tables en une seule transaction — [Écriture via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

Le comptage et l'agrégation sont des routes à part entière, enregistrées avant `/:id` afin que `aggregate` ne soit pas interprété comme un identifiant d'entité. `?select=` et `?groupBy=` sont leurs paramètres, et `select` est obligatoire sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs *sont* des paramètres de requête sur `GET /api/data/:slug` plutôt que des routes — `searchString`, `vector_search`, `include`, `fields`. Voir [API REST](/docs/backend/api/).

Un projet qui ne déclare aucune table et n'en inspecte aucune sert ce préfixe sous la forme d'un unique `404 NO_TABLES`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Auth

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ce que l'écran de connexion peut proposer : inscription, réinitialisation de mot de passe, lien magique, codes par e-mail, connexion invité, fournisseurs OAuth, et si la configuration du premier administrateur est en attente |
| `POST` | `/api/auth/register` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints d'authentification](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un jeton de rafraîchissement) | [Endpoints d'authentification](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoints d'authentification](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoints d'authentification](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoints d'authentification](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoints d'authentification](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Révoque toutes les autres sessions |
| `DELETE` | `/api/auth/sessions/:id` | session | En révoque une |
| `POST` | `/api/auth/forgot-password` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un jeton de réinitialisation) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envoie un lien de confirmation par e-mail à la nouvelle adresse — [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un jeton de lien) | Transfère le compte vers la nouvelle adresse — [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentification](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un jeton de vérification) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un jeton de vérification, et une session ou le mot de passe pour la conserver) | [Vérification d'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
| `POST` | `/api/auth/device` | none | [Connexion par appareil](/docs/backend/device-sign-in/). Désactivée sauf si le backend l'active |
| `POST` | `/api/auth/device/token` | none (un code d'appareil) | [Connexion par appareil](/docs/backend/device-sign-in/) : scrutation (poll) de l'appareil |
| `GET` | `/api/auth/device/:userCode` | session | [Connexion par appareil](/docs/backend/device-sign-in/) : ce que la page d'approbation affiche |
| `POST` | `/api/auth/device/approve` | session (`aal2` avec un second facteur) | [Connexion par appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Connexion par appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessions invités. Désactivé sauf si `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invité) | Transforme un invité en compte |
| `POST` | `/api/auth/find-user` | session | Désactivé sauf si `AUTH_ALLOW_USER_LOOKUP` — c'est une surface d'énumération |
| `POST` | `/api/auth/:provider` | none | Un par fournisseur OAuth/OIDC configuré |
| `POST` | `/api/auth/link/:provider` | session | Associe un fournisseur au compte connecté |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (une connexion en cours) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un identifiant de challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tous les scopes connus par ce backend, et ceux détenus par l'appelant — [Rôles et scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un compte) | Les [clés personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant lui-même |
| `POST` | `/api/auth/keys` | session (un compte) | La clé en clair n'est retournée qu'une seule fois. `403 PERSONAL_KEYS_DISABLED` sauf si la table auth définit `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un compte) | Révoque l'une des clés personnelles de l'appelant |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Admin

Tout ce qui se trouve sous `/api/admin` nécessite un scope du plan d'administration, et chaque surface nomme le sien : `users:read` liste les comptes, `cron:write` déclenche une tâche. Un administrateur les détient tous, tout comme la clé de service. Une personne détient ceux déclarés par ses rôles, et une clé d'API ceux avec lesquels elle a été créée. Une clé limitée à une table n'accède à rien de tout cela. Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et uniquement tant qu'aucun administrateur n'existe | Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | `users:write` | Gestion des utilisateurs. Les rôles dépassant ceux de l'appelant sont refusés |
| `GET` | `/api/admin/users/pick` | `users:read`, ou accès en écriture à une table avec une colonne `.userId()` | La [lecture du sélecteur d'utilisateurs](/docs/backend/auth-endpoints/) : id, nom, e-mail et avatar uniquement. Une table dont les règles d'écriture utilisent du SQL brut ne compte pas |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Délivre un mot de passe temporaire |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Supprime les seconds facteurs et les codes de récupération du compte, met fin à ses sessions |
| `GET` | `/api/admin/guests` | `users:read` | Invités, les moins récemment vus en premier. `?lastSeenBefore=` les restreint à ce que la suppression ci-dessous prendrait en compte, et `total` les décompte |
| `DELETE` | `/api/admin/guests` | `users:write` | Supprime un lot d'invités vus pour la dernière fois avant `?lastSeenBefore=`, qui est obligatoire. Répond `{ deleted, skipped, remaining }`. Répéter tant que `remaining` n'est pas 0, avec `?offset=` défini sur le nombre d'éléments ignorés. Les comptes ne peuvent pas être atteints |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Supprime un invité. Un compte est refusé avec `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` et les rôles déclarés par le projet, avec leurs scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Clés d'API](/docs/backend/api-keys/). Jamais une clé d'API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clé en clair est retournée une seule fois, lors de la création |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Clés d'API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Active ou désactive une tâche |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Exécute une tâche maintenant. `?async=1` répond `202` une fois lancée — [API des tâches Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | `backups:read` | Diffuse une sauvegarde en flux (stream). Avec `?token=` provenant d'un lien de téléchargement, aucun en-tête n'est nécessaire, pour cette sauvegarde uniquement |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un lien vers une sauvegarde, `{ key }` → `{ url, token, expiresIn }`, valable 60 secondes — [Sauvegardes](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Démarre en arrière-plan une analyse des fichiers stockés qu'aucune ligne ne référence, `?storageId=&olderThanHours=`. Répond `202` avec l'enregistrement de l'analyse : `id`, `status` (`queued`), et `runner` (`worker` lorsqu'il s'agit d'une tâche `storage.orphans` dans la file d'attente des tâches, `in-process` lorsque le serveur l'exécute lui-même). Son enregistrement est écrit dans la source, sous le préfixe réservé `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | L'enregistrement de l'analyse, `?storageId=`. Pendant son exécution : `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` sur `collectionsTotal`, `unscanned`). Une fois `completed` : `result`, le rapport que l'ancien `GET /orphans` renvoyait. Une exécution qui a cessé de faire des rapports pendant 10 minutes est renvoyée comme `failed`. `404 STORAGE_SCAN_NOT_FOUND` lorsque la source ne contient pas cette analyse |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Supprime en arrière-plan les orphelins d'une analyse terminée, `202`. Chacun est à nouveau vérifié par rapport à chaque ligne et entrée d'historique, et re-vérifié juste avant d'être supprimé. Le résultat correspond au champ `deletion` de l'enregistrement de l'analyse. `409` avec `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsolète : l'analyse au sein de la requête, `?storageId=&olderThanHours=`. Répond avec `Deprecation: true`. Utilisez `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsolète, sans `?scan=` : analyse à nouveau et supprime au sein de la requête. `409 STORAGE_SCAN_INCOMPLETE` lorsqu'une table n'a pas pu être lue |
| `POST` | `/api/admin/storage/move` | `database:write` | Copie un dossier vers une autre source sous les mêmes clés, une page par appel — ce que `rebase storage move` envoie ; `400 STORAGE_SAME_LOCATION` pour `deleteSource` entre deux sources stockant au même endroit |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Liste à nouveau la source après un déplacement, avec le même corps, une page par appel : `{ checked, notMoved: [{ key, reason }], cursor? }` — chaque fichier toujours présent dans la source avec `deleteSource`, chaque fichier dont la cible n'a pas de copie sans celui-ci. `rebase storage move` l'interroge lorsque le déplacement est terminé |
| `GET` | `/api/admin/logs` | `logs:read` | Le tampon des logs récents |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rôles, rôles de règles des utilisateurs et clés de service actives qu'un administrateur peut simuler |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Chaque table telle que `{ role?, userId?, apiKeyId? }` y accède : lignes visibles par rapport à celles de l'appelant, masquées par le scope ou RLS, champs masqués. Session administrateur uniquement |
| `POST` | `/api/admin/sql/csv` | `database:write` | Diffuse en flux le résultat complet d'une requête en lecture seule au format CSV — « Download full result as CSV » de [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Ce qu'une [branche](/docs/backend/branching/#reviewing-and-merging-a-branch) a modifié : schéma, politiques et lignes, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Écrit les lignes de la branche dans son parent, `{ expectedFingerprint, onConflict?, skipBlocked? }` ; `409` lorsque l'un des côtés a changé depuis le diff, ou en cas de conflit de lignes |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Édition de schéma en direct](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifie une modification ; n'en applique jamais |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Une personne uniquement, sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifie l'assouplissement de `NOT NULL` et la suppression des colonnes non déclarées spécifiées dans `drop`, pour la [réconciliation de schéma](/docs/cli/schema/#rebase-schema-reconcile) ; n'en applique jamais |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applique un plan de réconciliation, uniquement si son `digest` correspond au `confirm` envoyé |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indique si l'éditeur est disponible, et la raison dans le cas contraire |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Chaque table exportée par `backend/schema/index.ts` telle que l'éditeur la lit, avec ce qui est modifié dans le code (lecture seule) et pourquoi — [Édition de schéma en direct](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }` : les fichiers que la modification écrirait, compilés ; n'écrit rien |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La même modification, écrite dans `backend/schema` ; la base de données n'est pas modifiée |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tables présentes dans la base de données et non déclarées par `backend/schema` : `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Description de l'une d'entre elles : `{ table: { …, descriptor, rlsRaised?, notes } }`, pour « Importer une table existante ». `404` si inconnue ou déjà déclarée, `400 SCHEMA_EDIT_REFUSED` sans clé primaire |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | Les appels à `defineFirestoreCollection` dans `frontend/src/cms` que l'éditeur peut réécrire (développement uniquement) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | Les fichiers qu'une modification de l'un de ces appels écrirait ; n'écrit rien |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | La même modification, écrite sur place. `409 SCHEMA_EDIT_STALE_FILE` si le fichier a changé sur le disque |
| `GET` | `/api/admin/ui-config` | session | Les préférences d'interface de l'espace de travail par table, celles de l'appelant, et si l'appelant peut écrire celles de l'espace de travail — voir [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Fusionne un delta `UiTablePreferences` dans les préférences d'espace de travail d'une table (`replace` remplace). Écrit dans `frontend/src/cms/ui-config.json` lorsque le serveur peut écrire dans les sources du projet, sinon dans `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Supprime les préférences d'espace de travail d'une table |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (une personne) | Les préférences propres à l'appelant pour une table. Une clé d'API n'en a pas : `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (une personne) | Supprime les préférences propres à l'appelant pour une table |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails capturés par le transport de développement au lieu d'être envoyés |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vide la boîte aux lettres capturée |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également servis sur leurs chemins antérieurs à la version 0.17 sans le segment `/admin`. Ces alias sont destinés aux projets qui n'ont pas encore migré ; écrivez le nouveau code en utilisant le chemin canonique.

## Schema

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, ou un identifiant avec `schema:read` ou un scope `data:*` | Toutes les tables servies par ce backend, sous la forme d'un tableau JSON de descripteurs expurgés selon l'appelant |
| `GET` | `/api/schema/tables/:slug` | comme ci-dessus | Un descripteur. `404 TABLE_NOT_FOUND` lorsque cette table n'est pas servie à cet appelant |

Les descripteurs servent de base au CMS pour restituer ses valeurs par défaut, à Studio pour générer le visualiseur de schéma et l'éditeur RLS, et aux applications MCP pour afficher les tables et les formulaires. Ils comportent les colonnes avec leurs types Postgres, la nullabilité, les règles de validation et de stockage, les relations par slug, ainsi que la posture de sécurité au niveau des lignes (RLS). Le code des hooks ne quitte jamais le serveur : un descripteur indique uniquement quels hooks possède une table.

Ce qui est servi à un appelant dépend de son identité :

| Appelant | Tables | Éléments expurgés |
|---|---|---|
| Un administrateur, un détenteur de `schema:read`, ou la clé de service | toutes les tables, y compris les vues simples | colonnes `.private()`, pour tout le monde |
| Toute autre personne connectée, invités compris | uniquement les tables qu'une règle permissive autorise pour leurs rôles (ainsi que la table auth et les vues matérialisées dont ils détiennent les `roles`) | les colonnes et relations pour lesquelles leurs rôles échouent à `access.read` ; les colonnes `.private()` ; uniquement les règles pouvant s'appliquer à leurs rôles ; les relations vers des tables qui ne leur sont pas servies ; les indicateurs de hooks ; le SQL brut dans les règles, les politiques compilées, les requêtes de vues et les index |
| Un identifiant (clé d'API, jeton MCP ou de plateforme) | les tables nommées par ses scopes `data:*`, ou toutes avec `schema:read` | comme ci-dessus, évalué selon les scopes qu'il possède |
| Personne de connecté | aucune — `401` — sauf si le backend définit `schemaTables: { public: true }` | alors les tables avec une règle `select` publique, expurgées comme pour l'appelant le moins privilégié : aucune colonne avec une liste `access.read`, pas de SQL brut, pas de politiques |

Une personne conserve `metadata`, `softDelete`, `tenant`, `history` et `search` sur les tables qui lui sont servies. `schemaTables: { persons: "all" }` dans les options du backend décrit chaque table et règle à chaque appelant connecté ; la valeur par défaut est `"granted"`. Les connexions MCP sont évaluées comme un identifiant, par le même sérialiseur.

L'identité de l'appelant provient de l'adaptateur d'authentification du backend, le même que celui interrogé par les routes de données. Ainsi, un backend doté d'un [adaptateur personnalisé](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere) est servi ici (ainsi qu'à `/api/docs` et sur chaque surface admin) avec les rôles renvoyés par son adaptateur ; un identifiant qu'il ne reconnaît pas renvoie une `401`.

Un identifiant ne détenant ni `schema:read` ni de scope `data:*` reçoit `403 SCOPE_MISSING`. Un backend sans authentification configurée répond à chaque requête par `404 SCHEMA_UNAVAILABLE` : il n'y a aucun appelant pour lequel expurger, et `auth.requireAuth: false` n'y change rien.

Les réponses comportent `ETag: W/"<schema version>-<view>"`, `Cache-Control: private, no-cache` et l'en-tête `x-rebase-schema` ; une requête dont `If-None-Match` spécifie le tag actuel reçoit `304`. Le tag change lorsque le schéma change, y compris après une modification du schéma en direct.

`schemaTables` est une option de `initializeRebaseBackend` sans variable d'environnement : un projet généré y accède en s'éjectant.

## Storage

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, par clé | [Stockage](/docs/backend/storage/#storage-endpoints) : métadonnées pour jusqu'à 100 objets |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Les sources de stockage nommées servies par ce backend |
| `OPTIONS` | `/api/storage/tus` | none | Téléversements avec reprise : les versions et extensions TUS prises en charge par ce serveur |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements avec reprise : création |
| `GET` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : décalage (offset) |
| `PATCH` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : ajout |
| `DELETE` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : annulation |

Un déploiement sans stockage configuré sert ce préfixe avec une erreur `501` indiquant la variable requise, plutôt que de renvoyer une erreur 404 comme si la fonctionnalité n'existait pas — à l'exception de `GET /api/storage/sources`, qui répond `200` avec une liste vide.

## Push

Monté uniquement avec `push: true` (`REBASE_PUSH=true`). Si le push est activé mais sans clés, chaque route répond `503 PUSH_NOT_CONFIGURED`. Les clés d'API et la clé de service sont refusées : une souscription appartient au navigateur d'une personne.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La clé publique VAPID — [Notifications push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Ce navigateur accepte les notifications, pour l'appelant — [Notifications push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Les arrête, sur le propre navigateur de l'appelant — [Notifications push](/docs/backend/push-notifications/#routes) |

## Functions

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/functions` | session | Le nom des fonctions servies, et combien de fichiers n'ont pas pu être chargés |
| n'importe laquelle | `/api/functions/<name>` | ce que la fonction déclare. Une clé d'API nécessite également `functions:invoke` | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre projet. `GET /api/functions` ne les liste qu'à un appelant connecté — une session, une clé d'API ou la clé de service — et répond à tout autre appelant par `401` : l'inventaire des points de terminaison personnalisés d'un déploiement n'est pas public.

## Meta and operations

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | État de fonctionnement (liveness) uniquement : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi il s'agit du chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness et readiness. Rapporte l'état de chaque source de données configurée, pas seulement celle par défaut |
| `GET` | `/api/docs` | l'audience de l'endpoint de schéma par défaut (401 anonyme sauf si `schemaTables.public`, 403 pour un identifiant sans scope schema ou data) ; none lorsque `enableSwagger` est `true` ; le contrôle admin lorsque `false` | Le document OpenAPI 3.0 des tables que `GET /api/schema/tables` décrit à l'appelant (toutes avec `enableSwagger: true`). `404 DOCS_UNAVAILABLE` lorsqu'aucune authentification n'est configurée |
| `GET` | `/api/swagger` | none | Swagger UI. Uniquement lorsque `enableSwagger` est `true`, et jamais en production |
| `GET` | `/api/meta/schema-version` | none | Le hachage du schéma à partir duquel ce backend a été compilé et la version du runtime, et rien d'autre |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — chaque table telle qu'un administrateur la voit, l'entrée de `rebase generate-sdk --from`. `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Les séries enregistrées derrière les graphiques de Studio. `501` sur un runtime sans backend |

Les connexions WebSocket arrivent sous la forme d'un surclassement HTTP (upgrade) sur le même serveur plutôt que sur un chemin propre — voir [Temps réel](/docs/backend/realtime/).

## MCP surface

Monté uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui nécessite également `REBASE_PUBLIC_URL` — voir [Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivé par défaut : aucun `REBASE_ROLE` ne l'active, car cela accorde l'accès au projet à un logiciel tiers, ce qui constitue une décision devant être prise par une personne.

Les documents `.well-known` se situent à l'**origine**, pas sous `basePath` : la RFC 8414 et la RFC 9728 définissent ces chemins par rapport à l'origine, et un client les récupère avant de détenir le moindre jeton.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées RFC 9728 nommant cette ressource et son serveur d'autorisation. Également servi sous la forme avec suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées RFC 8414 : les endpoints, types d'autorisation (grant types) et méthodes PKCE pris en charge par ce déploiement |
| `POST` | `/mcp` | OAuth bearer, ou une clé d'API | Le point de terminaison du protocole MCP. Agit **en tant qu'utilisateur connecté** (ou en tant que l'entité représentée par la clé), de sorte que chaque lecture et écriture est soumise aux mêmes RLS. Les scopes `data:*` déterminent les outils proposés |
| `GET` | `/mcp` | OAuth bearer, ou une clé d'API | Répond `405` avec `Allow: POST, DELETE` : ce serveur n'ouvre aucun flux initié par le serveur. Le jeton est vérifié en premier, donc un jeton manquant ou obsolète reçoit le challenge `401` à la place |
| `DELETE` | `/mcp` | none | Répond `204`. Le point de terminaison ne conserve aucune session, il n'y a donc rien à terminer |
| `POST` | `/api/oauth/register` | limitation de débit (rate-limited) | Enregistrement dynamique de client RFC 7591. Refusé lorsque `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de la personne à celui-ci — approuver ou refuser |
| `POST` | `/api/oauth/token` | identifiants client (client credentials) + PKCE | Échange un code d'autorisation, ou rafraîchit |
| `POST` | `/api/oauth/revoke` | identifiants client (client credentials) | Révocation de jeton RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Les clients que cet utilisateur a approuvés |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En retire un, afin qu'une personne puisse révoquer un consentement sans administrateur |

Le propre endpoint MCP du panneau d'administration ne fait pas partie de cette surface : il prend la session du panneau d'administration, jamais un jeton OAuth, et est monté avec les routes d'administration, que `REBASE_MCP_ENABLED` soit défini ou non, sur un pilote qui applique les RLS à chaque appel.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, jamais anonyme | **Expérimental.** Les mêmes outils que `/mcp`, pour la personne connectée, avec `data:read`, `data:write` et `data:delete`, selon ses RLS. La vue `savedAppsView` du panneau d'administration ouvre les [applications enregistrées](/docs/ai/remote-mcp/) à travers lui |

## Voir aussi

- [API REST](/docs/backend/api/) — l'ensemble des routes de données : filtres, tri, pagination, erreurs
- [Endpoints d'authentification](/docs/backend/auth-endpoints/) — formats de requête et de réponse pour la table d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables déterminant lesquelles de ces routes sont montées
