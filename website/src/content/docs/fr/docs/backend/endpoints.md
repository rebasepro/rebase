---
sourceHash: fbd8c85494a26511
title: Index des points de terminaison
sidebar_label: Index des points de terminaison
description: Chaque route HTTP montée par un backend Rebase — données, auth, stockage, admin, méta — avec la règle d'accès associée et la page d'explication.
---

Chaque route montée par le serveur, regroupée dans un tableau unique, avec les prérequis nécessaires pour y accéder.

Les chemins supposent le `basePath` par défaut `/api` ; `REBASE_BASE_PATH` les
déplace tous ensemble. `/health`, `/livez` et `/metrics` se situent intentionnellement
en dehors, car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le
chemin de base. `/health` est *également* monté sous ce préfixe, de sorte que `/api/health`
réponde de la même manière au lieu de renvoyer une erreur 404 au moment précis où quelqu'un
vérifie si le serveur est opérationnel.

Un contrôle de validation (gate) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare ce
tableau aux routes enregistrées par le code source, garantissant qu'aucune nouvelle surface ne puisse
être ajoutée sans figurer ici.

## Contrôles d'accès (Gates)

| Contrôle | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant atteindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé API limitée à l'opération |
| **`resource:action`** | Un appelant détenant ce [scope](/docs/backend/roles-and-scopes/) : un administrateur, une personne dont le rôle le déclare, une clé API créée avec ce scope, ou la clé de service |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir les [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Données

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

Généré par table, les chemins contiennent donc vos slugs plutôt qu'une liste
fixe. `:slug` est le slug d'une table (son nom, sauf si `defineTable` définit `slug`).

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Requêtes](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | La liste, avec les paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Requêtes](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Le décompte, avec les paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalculer une vue matérialisée, sur les vues qui sont matérialisées — [Vues](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias déprécié de `PATCH` — même écriture partielle, répond avec `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insérer plusieurs lignes, avec upsert optionnel — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mettre à jour plusieurs lignes par identifiant — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprimer plusieurs lignes par identifiant — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écrire sur plusieurs tables dans une seule transaction — [Écriture via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

Le décompte et l'agrégation sont des routes à part entière, enregistrées avant `/:id` afin
que `aggregate` ne soit pas interprété comme un identifiant d'entité. `?select=` et `?groupBy=` sont
leurs paramètres, et `select` est obligatoire sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs
*sont* des paramètres de requête sur `GET /api/data/:slug` plutôt que des routes distinctes — `searchString`,
`vector_search`, `include`, `fields`. Voir l'[API REST](/docs/backend/api/).

Un projet qui ne déclare aucune table et n'en inspecte aucune sert ce préfixe
avec une simple erreur `404 NO_TABLES`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Auth

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ce que l'écran de connexion peut proposer : inscription, réinitialisation de mot de passe, lien magique (magic link), codes par e-mail, connexion invité, fournisseurs OAuth, et si la configuration du premier administrateur est en attente |
| `POST` | `/api/auth/register` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un jeton de rafraîchissement) | [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Révoque toutes les autres sessions |
| `DELETE` | `/api/auth/sessions/:id` | session | En révoque une |
| `POST` | `/api/auth/forgot-password` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un jeton de réinitialisation) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envoie un lien de confirmation à la nouvelle adresse — [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un jeton de lien) | Bascule le compte sur la nouvelle adresse — [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentification](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un jeton de vérification) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un jeton de vérification, et une session ou le mot de passe pour la conserver) | [Vérification d'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> [Connexion par appareil](/docs/backend/device-sign-in/). Désactivé sauf si le backend l'active |
| `POST` | `/api/auth/device/token` | none (un code d'appareil) | [Connexion par appareil](/docs/backend/device-sign-in/) : le sondage (poll) de l'appareil |
| `GET` | `/api/auth/device/:userCode` | session | [Connexion par appareil](/docs/backend/device-sign-in/) : ce qu'affiche la page d'approbation |
| `POST` | `/api/auth/device/approve` | session (`aal2` avec un second facteur) | [Connexion par appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Connexion par appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessions d'invités. Désactivé sauf si `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invité) | Transforme un invité en compte utilisateur |
| `POST` | `/api/auth/find-user` | session | Désactivé sauf si `AUTH_ALLOW_USER_LOOKUP` — il s'agit d'une surface d'énumération |
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
| `GET` | `/api/auth/keys` | session (un compte) | Les propres [clés personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant |
| `POST` | `/api/auth/keys` | session (un compte) | La clé en clair n'est retournée qu'une seule fois. `403 PERSONAL_KEYS_DISABLED` à moins que la table d'authentification ne définisse `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un compte) | Révoque l'une des clés personnelles de l'appelant |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Admin

Tout ce qui se trouve sous `/api/admin` nécessite un scope du plan d'administration, et chaque
surface nomme le sien : `users:read` liste les comptes, `cron:write` déclenche une tâche.
Un administrateur les détient tous, tout comme la clé de service. Une personne détient ceux
que ses rôles déclarent, et une clé API ceux avec lesquels elle a été créée. Une clé limitée
à une table n'accède à rien de tout cela. Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et uniquement tant qu'aucun administrateur n'existe | Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | `users:write` | Gestion des utilisateurs. Les rôles dépassant ceux de l'appelant sont refusés |
| `GET` | `/api/admin/users/pick` | `users:read`, ou accès en écriture à une table avec une colonne `.userId()` | La [lecture du sélecteur d'utilisateurs](/docs/backend/auth-endpoints/) : id, nom, e-mail et avatar uniquement. Une table dont les règles d'écriture sont en SQL brut ne compte pas |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Génère un mot de passe temporaire |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Supprime les seconds facteurs et les codes de récupération du compte, met fin à ses sessions |
| `GET` | `/api/admin/guests` | `users:read` | Invités, triés des plus anciens vus aux plus récents. `?lastSeenBefore=` restreint la liste à ce que la suppression ci-dessous prendrait, et `total` les compte |
| `DELETE` | `/api/admin/guests` | `users:write` | Supprime un lot d'invités vus pour la dernière fois avant `?lastSeenBefore=`, qui est obligatoire. Répond `{ deleted, skipped, remaining }`. Répéter tant que `remaining` n'est pas 0, avec `?offset=` défini sur le nombre d'éléments ignorés. Les comptes ne peuvent pas être atteints |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Supprime un invité. Un compte standard est refusé avec `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` et les rôles déclarés par le projet, avec leurs scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Clés API](/docs/backend/api-keys/). Jamais une clé API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clé en clair n'est retournée qu'une seule fois, lors de la création |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Clés API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Clés API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Clés API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Activer ou désactiver une tâche |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Exécuter une tâche maintenant. `?async=1` répond `202` une fois qu'elle a démarré — [API des tâches Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | `backups:read` | Diffuse une sauvegarde en flux continu. Avec le paramètre `?token=` issu d'un lien de téléchargement, aucun en-tête n'est requis, pour cette sauvegarde uniquement |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un lien vers une sauvegarde, `{ key }` → `{ url, token, expiresIn }`, valable 60 secondes — [Sauvegardes](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Démarre une analyse en arrière-plan des fichiers stockés sans aucune référence en ligne, `?storageId=&olderThanHours=`. Répond `202` avec l'enregistrement de l'analyse : `id`, `status` (`queued`) et `runner` (`worker` lorsqu'il s'agit d'une tâche `storage.orphans` sur la file d'attente des tâches, `in-process` lorsque le serveur l'exécute lui-même). L'enregistrement est inscrit dans la source, sous le répertoire réservé `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | L'enregistrement de l'analyse, `?storageId=`. Pendant son exécution : `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` sur `collectionsTotal`, `unscanned`). Une fois `completed` : `result`, le rapport que renvoyait l'ancien `GET /orphans`. Une exécution n'ayant pas rapporté d'activité pendant 10 minutes est déclarée comme `failed`. `404 STORAGE_SCAN_NOT_FOUND` lorsque la source ne contient aucune analyse de ce type |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Supprime en arrière-plan les fichiers orphelins d'une analyse terminée, `202`. Chacun est à nouveau comparé à chaque ligne et entrée d'historique, et vérifié juste avant sa suppression. Le résultat correspond au champ `deletion` de l'enregistrement d'analyse. `409` avec `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Déprécié : l'analyse au sein de la requête, `?storageId=&olderThanHours=`. Répond avec `Deprecation: true`. Utilisez `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Déprécié, sans `?scan=` : analyse à nouveau et supprime au cours de la requête. `409 STORAGE_SCAN_INCOMPLETE` lorsqu'une table n'a pas pu être lue |
| `POST` | `/api/admin/storage/move` | `database:write` | Copie un dossier vers une autre source sous les mêmes clés, une page par appel — ce que transmet `rebase storage move` ; `400 STORAGE_SAME_LOCATION` pour `deleteSource` entre deux sources stockées au même endroit |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Liste à nouveau la source après un déplacement, avec le même corps, une page par appel : `{ checked, notMoved: [{ key, reason }], cursor? }` — chaque fichier toujours présent dans la source avec `deleteSource`, chaque fichier dont la cible n'a pas de copie sans celui-ci. `rebase storage move` l'interroge quand le déplacement est terminé |
| `GET` | `/api/admin/logs` | `logs:read` | Le tampon des journaux récents |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Les entrées de journal les plus récentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Événements envoyés par le serveur (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rôles, rôles de règles des utilisateurs et clés de service actives qu'un administrateur peut simuler |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Chaque table telle qu'accessible par `{ role?, userId?, apiKeyId? }` : lignes visibles comparées à celles de l'appelant, masquées par scope ou RLS, champs masqués. Session d'administrateur requise |
| `POST` | `/api/admin/sql/csv` | `database:write` | Diffuse en continu le résultat complet d'une requête en lecture seule sous forme de CSV — "Télécharger le résultat complet en CSV" du [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Ce qu'une [branche](/docs/backend/branching/#reviewing-and-merging-a-branch) a modifié : schéma, politiques et lignes, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Écrit les lignes de la branche vers son parent, `{ expectedFingerprint, onConflict?, skipBlocked? }` ; `409` si l'un des côtés a changé depuis le diff, ou si les lignes entrent en conflit |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Édition de schéma en direct](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifie une modification ; n'en applique jamais |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Une personne uniquement, sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifie l'assouplissement de `NOT NULL` et la suppression des colonnes non déclarées nommées dans `drop`, pour la [réconciliation de schéma](/docs/cli/schema/#rebase-schema-reconcile) ; n'en applique jamais |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applique un plan de réconciliation, uniquement si son `digest` correspond au `confirm` transmis |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indique si l'éditeur est disponible, ainsi que la raison s'il ne l'est pas |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Chaque table exportée par `backend/schema/index.ts` telle que lue par l'éditeur, avec ce qui est modifié dans le code (lecture seule) et pourquoi — [Édition de schéma en direct](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> `{ patches: TablePatch[] }` : les fichiers que la modification écrirait, compilés ; n'écrit rien |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> La même modification, écrite dans `backend/schema` ; la base de données n'est pas modifiée |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Les tables présentes dans la base de données mais non déclarées par `backend/schema` : `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Description de l'une d'entre elles : `{ table: { …, descriptor, rlsRaised?, notes } }`, pour "Importer une table existante". `404` si inconnue ou déjà déclarée, `400 SCHEMA_EDIT_REFUSED` sans clé primaire |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Les appels `defineFirestoreCollection` dans `frontend/src/cms` que l'éditeur peut réécrire (développement uniquement) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Les fichiers qu'une modification de l'un de ces appels écrirait ; n'écrit rien |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> La même modification, appliquée sur place. `409 SCHEMA_EDIT_STALE_FILE` si le fichier a changé sur le disque |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Les préférences d'interface de l'espace de travail par table, celles de l'appelant, et si l'appelant est autorisé à modifier celles de l'espace de travail — voir le [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Fusionner un delta `UiTablePreferences` dans les préférences d'espace de travail d'une table (`replace` remplace tout). Écrit dans `frontend/src/cms/ui-config.json` si le serveur peut écrire dans le code source du projet, sinon dans `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Supprimer les préférences d'espace de travail d'une table |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (une personne) | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Les préférences personnelles de l'appelant pour une table. Une clé API n'en possède aucune : `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (une personne) | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> Supprimer les préférences personnelles de l'appelant pour une table |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails interceptés par le système d'envoi en développement au lieu d'être envoyés |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vide la boîte de réception capturée |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également
disponibles sur leurs chemins antérieurs à la version 0.17, sans le segment `/admin`. Ces alias sont
conservés pour les projets qui n'ont pas encore migré ; écrivez le nouveau code en ciblant le chemin canonique.

## Schéma

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, ou identifiant avec `schema:read` ou un scope `data:*` | Chaque table servie par ce backend, sous la forme d'un tableau JSON de descripteurs expurgés selon les droits de l'appelant |
| `GET` | `/api/schema/tables/:slug` | identique ci-dessus | Un descripteur. `404 TABLE_NOT_FOUND` si cette table n'est pas servie à cet appelant |

Les descripteurs constituent la source utilisée par le CMS pour générer ses valeurs par défaut,
par le Studio pour tracer le visualiseur de schéma et l'éditeur RLS, et par les applications MCP
pour afficher les tables et les formulaires. Ils contiennent les colonnes avec leurs types Postgres,
leur nullabilité, les règles de validation et de stockage, les relations par slug et la
posture de sécurité au niveau des lignes (RLS). Le code des hooks ne quitte jamais le serveur : un
descripteur indique uniquement les hooks présents sur une table.

Ce qui est renvoyé à un appelant dépend de son identité :

| Appelant | Tables | Éléments expurgés |
|---|---|---|
| Un administrateur, un détenteur de `schema:read`, ou la clé de service | toutes les tables, vues simples incluses | les colonnes `.private()`, pour tout le monde |
| Toute autre personne connectée, invités inclus | uniquement les tables qu'une règle permissive autorise pour ses rôles (plus la table d'authentification et les vues matérialisées dont elle détient les `roles`) | les colonnes et relations pour lesquelles ses rôles échouent à `access.read` ; les colonnes `.private()` ; uniquement les règles applicables à ses rôles ; les relations vers des tables non servies ; les indicateurs de hooks ; le SQL brut dans les règles, les politiques compilées, les requêtes de vues et les index |
| Un identifiant d'accès (clé API, jeton MCP ou plateforme) | les tables désignées par ses scopes `data:*`, ou toutes avec `schema:read` | identique ci-dessus, évalué selon les scopes qu'il possède |
| Aucun utilisateur connecté | aucune — `401` — sauf si le backend définit `schemaTables: { public: true }` | dans ce cas, les tables dotées d'une règle `select` publique, expurgées selon le profil le moins privilégié : aucune colonne avec une liste `access.read`, pas de SQL brut, pas de politiques |

Une personne conserve `metadata`, `softDelete`, `tenant`, `history` et `search` sur
les tables qui lui sont servies. L'option `schemaTables: { persons: "all" }` dans la configuration
du backend décrit chaque table et règle à tout appelant connecté ; la
valeur par défaut est `"granted"`. Les connexions MCP sont évaluées comme un
identifiant d'accès technique (credential), par le même sérialiseur.

Un identifiant ne possédant ni `schema:read` ni un scope `data:*` reçoit
une erreur `403 SCOPE_MISSING`. Un backend sans authentification configurée répond
à chaque requête par `404 SCHEMA_UNAVAILABLE` : il n'y a aucun appelant pour lequel expurger, et
`auth.requireAuth: false` ne change rien à cela.

Les réponses incluent les en-têtes `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` et `x-rebase-schema` ; une requête dont le `If-None-Match`
mentionne le tag actuel reçoit un statut `304`. Le tag change lorsque le schéma est modifié,
y compris après une édition de schéma en direct.

`schemaTables` est une option de `initializeRebaseBackend` sans variable d'environnement :
un projet généré y accède en s'éjectant (eject).

## Stockage

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, par clé | [Stockage](/docs/backend/storage/#storage-endpoints) : métadonnées pour un maximum de 100 objets |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Les sources de stockage nommées que ce backend gère |
| `OPTIONS` | `/api/storage/tus` | none | Téléversements avec reprise : versions TUS et extensions supportées par ce serveur |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements avec reprise : création |
| `GET` | `/api/storage/tus/:id` | propriétaire du téléversement | Téléversements avec reprise : décalage (offset) |
| `PATCH` | `/api/storage/tus/:id` | propriétaire du téléversement | Téléversements avec reprise : ajout (append) |
| `DELETE` | `/api/storage/tus/:id` | propriétaire du téléversement | Téléversements avec reprise : annulation |

Un déploiement sans stockage configuré sert ce préfixe avec un code `501` indiquant la
variable requise, plutôt qu'une erreur 404 qui ferait croire que la fonctionnalité n'existe pas —
à l'exception de `GET /api/storage/sources`, qui répond `200` avec une liste vide.

## Fonctions

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/functions` | session | Les noms des fonctions servies, et le nombre de fichiers n'ayant pas pu se charger |
| any | `/api/functions/<name>` | selon les déclarations de la fonction. Une clé API requiert également `functions:invoke` | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de
votre projet. `GET /api/functions` ne les liste qu'à un appelant connecté — une
session, une clé API ou la clé de service — et renvoie `401` à tout autre utilisateur :
l'inventaire des points de terminaison personnalisés d'un déploiement n'est pas public.

## Méta et opérations

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Test de vie seul : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi c'est le chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Disponibilité et opérabilité (Liveness et readiness). Fait un rapport sur chaque source de données configurée, pas seulement celle par défaut |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Depuis la version 0.31</span> le public du point de terminaison de schéma par défaut (401 anonyme sauf si `schemaTables.public`, 403 pour un identifiant sans scope schéma ou données) ; none quand `enableSwagger` vaut `true` ; contrôle admin quand `false` | Le document OpenAPI 3.0 des tables que `GET /api/schema/tables` décrit à l'appelant (toutes si `enableSwagger: true`). `404 DOCS_UNAVAILABLE` si aucune authentification n'est configurée |
| `GET` | `/api/swagger` | none | Interface Swagger. Uniquement lorsque `enableSwagger` est `true`, et jamais en production |
| `GET` | `/api/meta/schema-version` | none | Le hash du schéma à partir duquel ce backend a été compilé et la version du runtime, et rien d'autre |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — chaque table telle qu'un administrateur la voit, en entrée de `rebase generate-sdk --from`. `404` quand aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` si défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` si défini | L'historique des séries temporelles derrière les graphiques du Studio. `501` sur un runtime sans backend |

Les connexions WebSocket s'établissent via une mise à niveau du protocole HTTP sur le même serveur plutôt qu'à
un chemin dédié — voir [Temps réel](/docs/backend/realtime/).

## Surface MCP

Monté uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui requiert également
`REBASE_PUBLIC_URL` — voir
[Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivé par
défaut : aucun `REBASE_ROLE` ne l'active de façon implicite, car cela accorde l'accès au projet à un
logiciel tiers, ce qui constitue une décision humaine explicite.

Les documents `.well-known` se situent à la **racine de l'hôte (origin)**, et non sous `basePath` : la RFC 8414
et la RFC 9728 définissent ces chemins par rapport à l'origine, et un client les récupère
avant même de détenir le moindre jeton.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées de la RFC 9728 identifiant cette ressource et son serveur d'autorisation. Également servi sous la forme avec suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées de la RFC 8414 : les points de terminaison, types d'octroi (grants) et méthodes PKCE supportés par ce déploiement |
| `POST` | `/mcp` | Bearer OAuth, ou une clé API | Le point de terminaison du protocole MCP. Agit **en tant qu'utilisateur connecté** (ou en tant que l'entité représentée par la clé), donc chaque lecture et écriture est soumise au même RLS. Les scopes `data:*` déterminent les outils proposés |
| `GET` | `/mcp` | Bearer OAuth, ou une clé API | Répond `405` avec `Allow: POST, DELETE` : ce serveur n'ouvre aucun flux initié par le serveur. Le jeton est vérifié d'abord, donc un jeton manquant ou expiré reçoit le défi `401` à la place |
| `DELETE` | `/mcp` | none | Répond `204`. Le point de terminaison ne maintient aucune session, il n'y a donc rien à interrompre |
| `POST` | `/api/oauth/register` | limitation de débit | Enregistrement dynamique de client RFC 7591. Refusé si `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de l'utilisateur — approuver ou refuser |
| `POST` | `/api/oauth/token` | identifiants client + PKCE | Échange un code d'autorisation, ou rafraîchit le jeton |
| `POST` | `/api/oauth/revoke` | identifiants client | Révocation de jeton selon la RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Les clients autorisés par cet utilisateur |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En révoque un, permettant à une personne d'annuler son consentement sans solliciter d'administrateur |

Le point de terminaison MCP propre au panneau d'administration ne fait pas partie de cette surface : il utilise
la session du panneau d'administration, jamais un jeton OAuth, et est monté avec les routes d'administration,
que `REBASE_MCP_ENABLED` soit défini ou non, via un pilote qui restreint chaque appel aux règles RLS.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, jamais anonyme | **Expérimental.** Les mêmes outils que `/mcp`, pour la personne connectée, avec `data:read`, `data:write` et `data:delete`, sous ses règles RLS. Le `savedAppsView` du panneau d'administration ouvre les [applications enregistrées](/docs/ai/remote-mcp/) par ce biais |

## Voir aussi

- [API REST](/docs/backend/api/) — le détail complet des routes de données : filtres, tri, pagination, erreurs
- [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) — formats de requêtes et de réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables qui déterminent quelles routes sont montées
