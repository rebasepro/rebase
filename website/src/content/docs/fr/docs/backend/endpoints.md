---
sourceHash: 0496dc717e6c7873
title: Index des points de terminaison
sidebar_label: Index des points de terminaison
description: Chaque route HTTP montée par un backend Rebase — données, auth, stockage, admin, méta — avec le contrôle d'accès sur chacune et la page qui l'explique.
---

Toutes les routes montées par le serveur, dans un tableau récapitulatif, avec les conditions requises pour y accéder.

Les chemins supposent le `basePath` par défaut de `/api` ; `REBASE_BASE_PATH` les
déplace tous ensemble. `/health`, `/livez` et `/metrics` se situent
intentionnellement en dehors, car un orchestrateur sonde `/health` et ne devrait
pas avoir à connaître le chemin de base. `/health` est *également* monté sous ce
dernier, de sorte que `/api/health` réponde de la même manière plutôt que de
renvoyer une erreur 404 au moment précis où quelqu'un vérifie si le serveur est actif.

Un mécanisme de contrôle — `tooling/scripts/docs-verify/check-endpoint-index.mjs` —
compare ce tableau aux routes enregistrées par le code source, de sorte qu'une
nouvelle surface ne peut être ajoutée sans apparaître ici.

## Gates (Contrôles d'accès)

| Gate | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé API limitée à l'opération |
| **`resource:action`** | Un appelant détenant ce [scope](/docs/backend/roles-and-scopes/) : un administrateur, une personne dont le rôle le déclare, une clé API créée avec celui-ci, ou la clé de service |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir les [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Données

Généré par table, les chemins utilisent donc vos slugs plutôt qu'une liste
fixe. `:slug` est le slug d'une table (son nom, sauf si `defineTable` définit `slug`).

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogation](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | La liste, paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogation](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Le décompte, paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcule une vue matérialisée, sur les vues qui sont matérialisées — [Vues](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias déprécié de `PATCH` — même écriture partielle, répond `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insère plusieurs lignes, avec upsert optionnel — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Met à jour plusieurs lignes par identifiant — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprime plusieurs lignes par identifiant — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écrit à travers plusieurs tables dans une seule transaction — [Écriture via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

`:id` est la clé de la ligne. Sur une table avec une clé composite, il s'agit de la valeur
de chaque colonne clé, dans l'ordre de la clé, séparée par `:::` (chaque partie encodée
en URL) : une table avec comme clé `(agency_id, id)` adresse une ligne sous la forme
`/api/data/proposals/<agency_id>:::<id>`. Une adresse contenant un nombre incorrect
de parties est refusée avec `400 COMPOSITE_KEY_ADDRESS`, en indiquant les colonnes clés.

Le décompte et l'agrégation sont des routes à part entière, enregistrées avant `/:id` afin
qu'`aggregate` ne soit pas interprété comme un identifiant d'entité. `?select=` et `?groupBy=`
sont leurs paramètres, et `select` est requis sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection
de champs *sont* des paramètres de requête sur `GET /api/data/:slug` plutôt que des
routes — `searchString`, `vector_search`, `include`, `fields`. Voir [API REST](/docs/backend/api/).

Un projet qui ne déclare aucune table et n'en inspecte aucune dessert ce préfixe sous
la forme d'un unique `404 NO_TABLES`. Voir [Backend only](/docs/getting-started/headless/).

## Auth

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ce que l'écran de connexion peut proposer : inscription, réinitialisation de mot de passe, lien magique, codes par e-mail, connexion invité, fournisseurs OAuth, et si la configuration du premier administrateur est en attente |
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
| `POST` | `/api/auth/device` | none | [Connexion d'appareil](/docs/backend/device-sign-in/). Désactivé sauf si le backend l'active |
| `POST` | `/api/auth/device/token` | none (un code d'appareil) | [Connexion d'appareil](/docs/backend/device-sign-in/) : le sondage de l'appareil |
| `GET` | `/api/auth/device/:userCode` | session | [Connexion d'appareil](/docs/backend/device-sign-in/) : ce qu'affiche la page d'approbation |
| `POST` | `/api/auth/device/approve` | session (`aal2` avec un second facteur) | [Connexion d'appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Connexion d'appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessions invités. Désactivé sauf si `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invité) | Transforme un invité en compte |
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
| `GET` | `/api/auth/scopes` | session | Tous les scopes connus de ce backend, et ceux détenus par l'appelant — [Rôles et scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un compte) | Les propres [clés personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant |
| `POST` | `/api/auth/keys` | session (un compte) | La clé en texte brut n'est renvoyée qu'une seule fois. `403 PERSONAL_KEYS_DISABLED` à moins que la table d'authentification ne définisse `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un compte) | Révoque l'une des clés personnelles de l'appelant |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Admin

Tout ce qui se trouve sous `/api/admin` nécessite un scope du plan d'administration,
et chaque surface indique le sien : `users:read` liste les comptes, `cron:write`
déclenche une tâche. Un administrateur les détient tous, tout comme la clé de service.
Une personne détient ceux que ses rôles déclarent, et une clé API ceux avec lesquels
elle a été créée. Une clé limitée à une table n'accède à rien de tout cela. Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et seulement tant qu'aucun administrateur n'existe | Refusé en production — voir [Initialisation du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | `users:write` | Gestion des utilisateurs. Les rôles dépassant ceux de l'appelant sont refusés |
| `POST` | `/api/admin/users/import` | `users:write` | [Importe des comptes](/docs/backend/auth-endpoints/#importing-accounts) en conservant leurs identifiants : aucun e-mail, aucun mot de passe sauf si son hash bcrypt est fourni, identifiant ou e-mail déjà pris ignoré. Au maximum 100 par requête. Les rôles dépassant ceux de l'appelant sont refusés |
| `GET` | `/api/admin/users/pick` | `users:read`, ou accès en écriture à une table avec une colonne `.userId()` | La [lecture du sélecteur d'utilisateurs](/docs/backend/auth-endpoints/) : id, nom, e-mail et avatar uniquement. Une table dont les règles d'écriture sont en SQL brut ne compte pas |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Génère un mot de passe temporaire |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Supprime les seconds facteurs et codes de récupération du compte, met fin à ses sessions |
| `GET` | `/api/admin/guests` | `users:read` | Invités, classés des plus anciens vus aux plus récents. `?lastSeenBefore=` restreint la liste à ce que la suppression ci-dessous prendrait, et `total` les compte |
| `DELETE` | `/api/admin/guests` | `users:write` | Supprime un lot d'invités vus pour la dernière fois avant `?lastSeenBefore=`, qui est requis. Répond `{ deleted, skipped, remaining }`. Répéter tant que `remaining` n'est pas 0, avec `?offset=` défini sur le nombre d'éléments ignorés. Les comptes ne peuvent pas être atteints |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Supprime un invité. Un compte est refusé avec `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` et les rôles déclarés par le projet, avec leurs scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Clés API](/docs/backend/api-keys/). Jamais une clé API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clé en texte brut n'est renvoyée qu'une seule fois, lors de la création |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Clés API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Clés API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Clés API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Active ou désactive une tâche |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Exécute une tâche maintenant. `?async=1` répond `202` une fois qu'elle a démarré — [API des tâches Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmet une sauvegarde en flux. Avec `?token=` provenant d'un lien de téléchargement, aucun en-tête n'est nécessaire, pour cette sauvegarde uniquement |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un lien vers une sauvegarde, `{ key }` → `{ url, token, expiresIn }`, valable 60 secondes — [Sauvegardes](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Démarre une analyse en arrière-plan des fichiers stockés qu'aucune ligne ne référence, `?storageId=&olderThanHours=`. Répond `202` avec l'enregistrement du scan : `id`, `status` (`queued`), et `runner` (`worker` lorsqu'il s'agit d'une tâche `storage.orphans` dans la file de tâches, `in-process` lorsque le serveur l'exécute lui-même). Son enregistrement est écrit dans la source, sous le répertoire réservé `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | L'enregistrement du scan, `?storageId=`. Pendant son exécution : `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` sur `collectionsTotal`, `unscanned`). Une fois `completed` : `result`, le rapport que renvoyait l'ancien `GET /orphans`. Une exécution qui a cessé de faire un rapport pendant 10 minutes est considérée comme `failed`. `404 STORAGE_SCAN_NOT_FOUND` lorsque la source ne contient aucun scan de ce type |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Supprime les orphelins d'un scan terminé en arrière-plan, `202`. Chacun est à nouveau vérifié par rapport à chaque ligne et entrée d'historique, et redemandé juste avant d'être supprimé. Le résultat est le champ `deletion` de l'enregistrement du scan. `409` avec `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Déprécié : le scan à l'intérieur de la requête, `?storageId=&olderThanHours=`. Répond avec `Deprecation: true`. Utilisez `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Déprécié, sans `?scan=` : analyse à nouveau et supprime à l'intérieur de la requête. `409 STORAGE_SCAN_INCOMPLETE` lorsqu'une table n'a pas pu être lue |
| `POST` | `/api/admin/storage/move` | `database:write` | Copie un dossier vers une autre source sous les mêmes clés, une page par appel — ce que `rebase storage move` envoie ; `400 STORAGE_SAME_LOCATION` pour `deleteSource` entre deux sources qui stockent au même endroit |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Liste à nouveau la source après un déplacement, avec le même corps, une page par appel : `{ checked, notMoved: [{ key, reason }], cursor? }` — chaque fichier toujours présent dans la source avec `deleteSource`, chaque fichier dont la cible n'a pas de copie sans celui-ci. `rebase storage move` l'appelle quand le déplacement est terminé |
| `GET` | `/api/admin/logs` | `logs:read` | Le tampon des logs récents |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events (SSE) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rôles, rôles de règles des utilisateurs et clés de service actives qu'un administrateur peut simuler |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Chaque table telle que `{ role?, userId?, apiKeyId? }` y accède : lignes visibles par rapport à celles de l'appelant, masquées par un scope ou RLS, champs masqués. Session administrateur uniquement |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmet le résultat complet d'une requête en lecture seule au format CSV en flux — option « Download full result as CSV » de [Studio](/docs/studio/) |
| `GET` | `/api/admin/sql/snippets` | `database:read` | Les extraits enregistrés de la console SQL que voit l'appelant : les siens et ceux de l'équipe |
| `POST` | `/api/admin/sql/snippets` | `database:write` | Enregistre un extrait (`name`, `sql`, `visibility` : `personal` ou `team`, `favorite`) |
| `PATCH` | `/api/admin/sql/snippets/:id` | `database:write` | Modifie les champs d'un extrait ; seulement son propriétaire ou un administrateur |
| `DELETE` | `/api/admin/sql/snippets/:id` | `database:write` | Supprime un extrait ; seulement son propriétaire ou un administrateur |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Ce qu'une [branche](/docs/backend/branching/#reviewing-and-merging-a-branch) a modifié : schéma, politiques et lignes, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Écrit les lignes de la branche dans son parent, `{ expectedFingerprint, onConflict?, skipBlocked? }` ; `409` si l'un des côtés a changé depuis le diff, ou si des lignes sont en conflit |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Édition de schéma en direct](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifie une modification ; n'en applique jamais |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Une personne uniquement, sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifie l'assouplissement de `NOT NULL` et la suppression des colonnes non déclarées nommées dans `drop`, pour la [réconciliation de schéma](/docs/cli/schema/#rebase-schema-reconcile) ; n'en applique jamais |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applique un plan de réconciliation, uniquement si son `digest` correspond au `confirm` envoyé |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Ré-inspecte PostgreSQL et recharge REST, Realtime, OpenAPI, les politiques de stockage, webhooks, rôles et tâches planifiées à chaud sans redémarrage |
| `GET` | `/api/admin/db/tables` | `database:read` | Liste les tables PostgreSQL utilisateur avec leurs colonnes, index, politiques RLS et surcouches `rebase.table_meta` |
| `POST` | `/api/admin/db/tables` | `database:write` | Crée une table PostgreSQL avec des politiques RLS initiales et des métadonnées facultatives (`dryRun: true` prévisualise le SQL), puis recharge à chaud |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Renomme une table, bascule la sécurité au niveau des lignes (`rlsEnabled`), ou met à jour les paramètres de surcouche d'API `rebase.table_meta` (`meta`), puis recharge à chaud |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Supprime une table PostgreSQL (requiert `{ confirm: "<table>" }` sauf si `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Ajoute une colonne à une table PostgreSQL et recharge à chaud |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Modifie une colonne (renommage, type, nullabilité, valeur par défaut) et recharge à chaud |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Supprime une colonne (requiert `{ confirm: "<column>" }` sauf si `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Crée un index sur une table PostgreSQL |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Supprime un index sur une table PostgreSQL |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Crée une politique RLS PostgreSQL sur une table et recharge à chaud |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Supprime une politique RLS PostgreSQL sur une table et recharge à chaud |
| `GET` | `/api/admin/db/tables/:table/details` | `database:read` | Contraintes d'une table, clés étrangères dans les deux sens, triggers, droits, politiques, utilisation des index, statistiques de stockage et définition en SQL |
| `POST` | `/api/admin/db/tables/:table/constraints` | `database:write` | Ajoute une contrainte de clé étrangère, d'unicité ou de vérification (`dryRun: true` prévisualise le SQL) |
| `DELETE` | `/api/admin/db/tables/:table/constraints/:constraint` | `database:write` | Supprime une contrainte |
| `PATCH` | `/api/admin/db/tables/:table/triggers/:trigger` | `database:write` | Active ou désactive un trigger (`{ enabled }`) |
| `DELETE` | `/api/admin/db/tables/:table/triggers/:trigger` | `database:write` | Supprime un trigger |
| `POST` | `/api/admin/db/tables/:table/maintenance` | `database:write` | Exécute `ANALYZE` ou `VACUUM (ANALYZE)` sur la table (`{ action }`) |
| `POST` | `/api/admin/db/tables/:table/refresh` | `database:write` | Rafraîchit une vue matérialisée |
| `GET` | `/api/admin/db/tables/:table/rows` | `database:read` | Lignes en tant que propriétaire de la base : `limit`, `offset`, `orderBy`, `direction` et `filters` (JSON) ; `format=csv` diffuse toutes les correspondances |
| `POST` | `/api/admin/db/tables/:table/rows` | `database:write` | Insère des lignes (`{ rows }`), toutes ou aucune |
| `PATCH` | `/api/admin/db/tables/:table/rows` | `database:write` | Met à jour une ligne par sa clé primaire (`{ key, values }`) |
| `DELETE` | `/api/admin/db/tables/:table/rows` | `database:write` | Supprime des lignes par clé primaire (`{ keys }`) |
| `GET` | `/api/admin/db/insights/sources` | `database:read` | Les bases de données que la vue Base de données peut inspecter (`?source=` sur les routes ci-dessous) |
| `GET` | `/api/admin/db/insights/overview` | `database:read` | Version du serveur, taille de la base et connexions utilisées |
| `GET` | `/api/admin/db/insights/advisors` | `database:read` | Constats de sécurité de `rls-check` et de performance (index inutilisés ou en double, clés étrangères sans index, clés primaires absentes, lignes mortes) |
| `GET` | `/api/admin/db/insights/queries` | `database:read` | Les requêtes les plus lourdes de `pg_stat_statements` (`sort`, `limit`), ou pourquoi il est illisible |
| `POST` | `/api/admin/db/insights/queries/reset` | `database:write` | Réinitialise `pg_stat_statements` |
| `GET` | `/api/admin/db/insights/activity` | `database:read` | Sessions actives avec leurs attentes, durées et bloqueurs |
| `POST` | `/api/admin/db/insights/activity/:pid/cancel` | `database:write` | Annule la requête en cours d'une session (`pg_cancel_backend`) |
| `POST` | `/api/admin/db/insights/activity/:pid/terminate` | `database:write` | Met fin à une session (`pg_terminate_backend`) |
| `GET` | `/api/admin/db/catalog/functions` | `database:read` | Fonctions hors des schémas protégés, avec leurs définitions |
| `DELETE` | `/api/admin/db/catalog/functions/:schema/:name` | `database:write` | Supprime une fonction (sa signature dans le corps) |
| `GET` | `/api/admin/db/catalog/triggers` | `database:read` | Tous les triggers, avec leur table et leur fonction |
| `GET` | `/api/admin/db/catalog/types` | `database:read` | Enums avec leurs valeurs, domaines et types composites |
| `POST` | `/api/admin/db/catalog/types/:schema/:name/values` | `database:write` | Ajoute une valeur à un enum (`ALTER TYPE … ADD VALUE`) |
| `GET` | `/api/admin/db/catalog/extensions` | `database:read` | Extensions que le serveur propose, et celles installées |
| `POST` | `/api/admin/db/catalog/extensions/:name` | `database:write` | Installe une extension (`CREATE EXTENSION`) |
| `DELETE` | `/api/admin/db/catalog/extensions/:name` | `database:write` | Supprime une extension (`DROP EXTENSION`) |
| `GET` | `/api/admin/storage/policies` | `database:read` | Liste les politiques de stockage déclaratives sans code depuis `rebase.storage_policies` |
| `POST` | `/api/admin/storage/policies` | `database:write` | Crée une politique d'accès au stockage déclarative |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Met à jour une politique d'accès au stockage déclarative |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Supprime une politique d'accès au stockage déclarative |
| `GET` | `/api/admin/webhooks` | `database:read` | Liste les webhooks de base de données sans code depuis `rebase.webhooks` |
| `POST` | `/api/admin/webhooks` | `database:write` | Crée un webhook de base de données |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Met à jour un webhook de base de données |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Supprime un webhook de base de données |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Envoie un test de distribution en direct vers un point de terminaison de webhook configuré |
| `GET` | `/api/admin/roles` | `users:read` | Liste les rôles et scopes RBAC sans code depuis `rebase.roles` |
| `POST` | `/api/admin/roles` | `users:write` | Crée ou met à jour un rôle RBAC sans code |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Met à jour un rôle RBAC sans code |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Supprime un rôle RBAC sans code |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Liste les tâches planifiées SQL/HTTP sans code depuis `rebase.cron_jobs` |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Crée une tâche cron SQL ou HTTP planifiée sans code. Une tâche SQL exécute son instruction avec la propre connexion du serveur, elle nécessite donc également `database:write` |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Met à jour une tâche cron planifiée sans code ; une tâche SQL, ou qui le devient, nécessite également `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Supprime une tâche cron planifiée sans code |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indique si l'éditeur est disponible, et la raison dans le cas contraire |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Chaque table exportée par `backend/schema/index.ts` telle que l'éditeur la lit, avec ce qui est édité dans le code (lecture seule) et pourquoi — [Édition de schéma en direct](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }` : les fichiers que la modification écrirait, compilés ; n'écrit rien |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La même modification, écrite dans `backend/schema` ; la base de données n'est pas modifiée |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tables présentes dans la base de données et non déclarées par `backend/schema` : `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | L'une d'entre elles décrite : `{ table: { …, descriptor, rlsRaised?, notes } }`, pour « Importer une table existante ». `404` si inconnue ou déjà déclarée, `400 SCHEMA_EDIT_REFUSED` sans clé primaire |
| `GET` | `/api/admin/ui-config` | session | Les préférences d'interface de l'espace de travail par table, celles propres à l'appelant, et si l'appelant peut écrire celles de l'espace de travail — voir [Personnaliser une table](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Fusionne un delta `UiTablePreferences` dans les préférences d'espace de travail d'une table (`replace` remplace). Écrit dans `frontend/src/cms/ui-config.json` lorsque le serveur peut écrire dans les sources du projet, sinon dans `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Supprime les préférences d'espace de travail d'une table |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (une personne) | Les préférences propres à l'appelant pour une table. Une clé API n'en a aucune : `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (une personne) | Supprime les préférences propres à l'appelant pour une table |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails capturés par le transport de développement au lieu d'être envoyés |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vide la boîte aux lettres de capture |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également
servis sur leurs chemins antérieurs à la version 0.17 sans le segment `/admin`. Ces alias
sont destinés aux projets qui n'ont pas encore migré ; écrivez le nouveau code en
utilisant le chemin canonique.

## Schéma

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, ou un identifiant avec `schema:read` ou un scope `data:*` | Chaque table servie par ce backend, sous la forme d'un tableau JSON de descripteurs expurgés pour l'appelant |
| `GET` | `/api/schema/tables/:slug` | comme ci-dessus | Un descripteur. `404 TABLE_NOT_FOUND` lorsque cette table n'est pas servie à cet appelant |

Les descripteurs sont les éléments à partir desquels le CMS génère ses valeurs par défaut,
le Studio génère le visualiseur de schéma et l'éditeur RLS, et les applications MCP
génèrent les tables et les formulaires. Ils contiennent les colonnes avec leurs types Postgres,
la nullabilité, les règles de validation et de stockage, les relations par slug, ainsi que
la configuration de sécurité au niveau des lignes (RLS). Le code des hooks ne quitte jamais
le serveur : un descripteur indique uniquement les hooks que possède une table.

Ce qui est servi à un appelant dépend de son identité :

| Appelant | Tables | Expurgé |
|---|---|---|
| Un administrateur, un détenteur de `schema:read`, ou la clé de service | toutes les tables, vues simples incluses | colonnes `.private()`, pour tout le monde |
| Toute autre personne connectée, invités inclus | uniquement les tables qu'une règle permissive atteint pour leurs rôles (plus la table d'authentification, et les vues matérialisées dont ils détiennent les `roles`) | colonnes et relations pour lesquelles leurs rôles échouent à `access.read` ; colonnes `.private()` ; uniquement les règles applicables à leurs rôles ; relations vers des tables qui ne leur sont pas servies ; indicateurs de hooks ; SQL brut dans les règles, politiques compilées, requêtes de vues et index |
| Un identifiant d'authentification (clé API, jeton MCP ou plateforme) | les tables désignées par ses scopes `data:*`, ou toutes avec `schema:read` | comme ci-dessus, évalué selon les scopes qu'il possède |
| Personne de connecté | aucune — `401` — sauf si le backend définit `schemaTables: { public: true }` | alors les tables avec une règle `select` publique, expurgées comme pour l'appelant le moins privilégié : aucune colonne avec une liste `access.read`, pas de SQL brut, pas de politiques |

Une personne conserve `metadata`, `softDelete`, `tenant`, `history` et `search` sur
les tables qui lui sont servies. `schemaTables: { persons: "all" }` dans les options
du backend décrit chaque table et règle à chaque appelant connecté ; la valeur
par défaut est `"granted"`. Les connexions MCP sont évaluées comme un identifiant,
par le même sérialiseur.

L'identité de l'appelant provient de l'adaptateur d'authentification du backend, le même
que celui interrogé par les routes de données, de sorte qu'un backend avec un [adaptateur personnalisé](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
est servi ici (ainsi que sur `/api/docs` et chaque surface d'administration) avec les rôles
renvoyés par son adaptateur ; un identifiant qu'il ne reconnaît pas renvoie un `401`.

Un identifiant ne détenant ni `schema:read` ni un scope `data:*` reçoit
`403 SCOPE_MISSING`. Un backend sans authentification configurée répond à
chaque requête par `404 SCHEMA_UNAVAILABLE` : il n'y a aucun appelant pour lequel
expurger, et `auth.requireAuth: false` ne change rien à cela.

Les réponses portent `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` et l'en-tête `x-rebase-schema` ; une requête dont le `If-None-Match`
correspond au tag actuel reçoit un `304`. Le tag change lorsque le schéma change,
y compris après une modification du schéma en direct.

`schemaTables` est une option de `initializeRebaseBackend` sans variable d'environnement :
un projet généré y accède en s'éjectant (eject).

## Stockage

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
| `OPTIONS` | `/api/storage/tus` | none | Uploads reprenables : les versions et extensions TUS supportées par ce serveur |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads reprenables : création |
| `GET` | `/api/storage/tus/:id` | le propriétaire de l'upload | Uploads reprenables : décalage (offset) |
| `PATCH` | `/api/storage/tus/:id` | le propriétaire de l'upload | Uploads reprenables : ajout (append) |
| `DELETE` | `/api/storage/tus/:id` | le propriétaire de l'upload | Uploads reprenables : annulation |

Un déploiement sans stockage configuré sert ce préfixe avec une erreur `501` indiquant la
variable nécessaire, plutôt que de renvoyer un 404 comme si la fonctionnalité n'existait pas —
à l'exception de `GET /api/storage/sources`, qui répond `200` avec une liste vide.

## Push

Monté uniquement avec `push: true` (`REBASE_PUSH=true`). Avec le push activé mais sans clés,
chaque route répond `503 PUSH_NOT_CONFIGURED`. Les clés API et la clé de service sont
refusées : une souscription appartient au navigateur d'une personne.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La clé publique VAPID — [Notifications push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Ce navigateur reçoit les notifications, pour l'appelant — [Notifications push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Les arrête, sur le propre navigateur de l'appelant — [Notifications push](/docs/backend/push-notifications/#routes) |

## Fonctions

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/functions` | session | Les noms des fonctions servies, et le nombre de fichiers dont le chargement a échoué |
| any | `/api/functions/<name>` | ce que la fonction déclare. Une clé API nécessite également `functions:invoke` | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre
projet. `GET /api/functions` ne les liste qu'à un appelant connecté — une
session, une clé API ou la clé de service — et répond `401` à toute autre personne :
l'inventaire des points de terminaison personnalisés d'un déploiement n'est pas public.

## RPC

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | l'`access` du RPC : none pour `"public"` (limité en débit), session pour `"authenticated"` ; puis RLS à l'intérieur de la fonction. Une clé API nécessite également `data:read` (`data:write` pour un RPC `write: true`) | [Fonctions SQL en tant que RPC](/docs/backend/rpc/) |

Une route par `defineRpc` exporté depuis `backend/schema/index.ts`, les
chemins proviennent donc de votre projet. Un nom que personne n'a déclaré répond `404
RPC_NOT_FOUND`, même lorsque la base de données possède une fonction portant ce nom.

## Méta et opérations

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Liveness seule : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi il s'agit du chemin de sonde qu'un conteneur devrait utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness et readiness. Rapporte chaque source de données configurée, pas seulement celle par défaut |
| `GET` | `/api/docs` | l'audience du point de terminaison du schéma par défaut (401 anonyme sauf si `schemaTables.public`, 403 pour un identifiant sans scope de schéma ou de données) ; none quand `enableSwagger` est `true` ; le contrôle admin quand `false` | Le document OpenAPI 3.0 des tables que `GET /api/schema/tables` décrit à l'appelant (toutes avec `enableSwagger: true`). `404 DOCS_UNAVAILABLE` lorsqu'aucune authentification n'est configurée |
| `GET` | `/api/swagger` | none | Interface Swagger UI. Uniquement lorsque `enableSwagger` est `true`, et jamais en production |
| `GET` | `/api/meta/schema-version` | none | Le hash du schéma à partir duquel ce backend a été compilé et la version du runtime, et rien d'autre |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — chaque table telle qu'un administrateur la voit, l'entrée de `rebase generate-sdk --from`. `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` si défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` si défini | Les séries enregistrées derrière les graphiques de Studio. `501` sur un runtime sans backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` si défini | Jusqu'à 16 séries enregistrées à la fois, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, regroupées par buckets. Comprend les requêtes par minute et les erreurs par surface. `501` sur un runtime sans backend |

Les connexions WebSocket arrivent sous forme de mise à niveau HTTP (upgrade) sur le même
serveur plutôt que sur un chemin dédié — voir [Temps réel (Realtime)](/docs/backend/realtime/).

## Surface MCP

Monté uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui nécessite également
`REBASE_PUBLIC_URL` — voir
[Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivé par
défaut : aucun `REBASE_ROLE` ne l'active, car cela donne accès au projet à un
logiciel tiers et c'est une décision qui revient à une personne.

Les documents `.well-known` se trouvent à la **racine (origin)**, et non sous `basePath` :
la RFC 8414 et la RFC 9728 définissent ces chemins par rapport à l'origine, et un
client les récupère avant même de détenir un jeton.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées RFC 9728 nommant cette ressource et son serveur d'autorisation. Servies également sous la forme avec suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées RFC 8414 : les points de terminaison, types d'octroi (grant types) et méthodes PKCE pris en charge par ce déploiement |
| `POST` | `/mcp` | Porteur OAuth (Bearer), ou une clé API | Le point de terminaison du protocole MCP. Agit **en tant qu'utilisateur connecté** (ou en tant que l'entité représentée par la clé), de sorte que chaque lecture et écriture est soumise aux mêmes règles RLS. Les scopes `data:*` déterminent les outils proposés |
| `GET` | `/mcp` | Porteur OAuth (Bearer), ou une clé API | Répond `405` avec `Allow: POST, DELETE` : ce serveur n'ouvre aucun flux initié par le serveur. Le jeton est vérifié en premier, donc un jeton manquant ou expiré reçoit à la place le challenge `401` |
| `DELETE` | `/mcp` | none | Répond `204`. Le point de terminaison ne conserve aucune session, il n'y a donc rien à terminer |
| `POST` | `/api/oauth/register` | limité en débit | Enregistrement dynamique de client RFC 7591. Refusé lorsque `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de la personne à celui-ci — approuver ou refuser |
| `POST` | `/api/oauth/token` | identifiants client (client credentials) + PKCE | Échange un code d'autorisation, ou rafraîchit |
| `POST` | `/api/oauth/revoke` | identifiants client (client credentials) | Révocation de jeton RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quels clients cet utilisateur a approuvés |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En retire un, afin qu'une personne puisse annuler un consentement sans administrateur |

Le propre point de terminaison MCP du panneau d'administration ne fait pas partie
de cette surface : il utilise la session du panneau d'administration, jamais un jeton
OAuth, et est monté avec les routes d'administration, que `REBASE_MCP_ENABLED` soit
défini ou non, sur un pilote qui applique le RLS à chaque appel.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, jamais anonyme | **Expérimental.** Les mêmes outils que `/mcp`, pour la personne connectée, avec `data:read`, `data:write` et `data:delete`, sous son RLS. La vue `savedAppsView` du panneau d'administration ouvre les [applications enregistrées](/docs/ai/remote-mcp/) via ce biais |

## Voir aussi

- [API REST](/docs/backend/api/) — l'intégralité des routes de données : filtres, tri, pagination, erreurs
- [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) — formats de requêtes et de réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables qui déterminent lesquels de ces éléments sont montés
