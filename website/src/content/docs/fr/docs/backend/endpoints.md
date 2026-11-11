---
sourceHash: 7410dc424b969f2a
title: Index des points de terminaison
sidebar_label: Index des points de terminaison
description: Toutes les routes HTTP montées par un backend Rebase — données, auth, stockage, admin, méta — avec le contrôle d'accès de chacune et la page qui l'explique.
---

Toutes les routes montées par le serveur, dans un seul tableau, avec les conditions requises pour les atteindre.

Les chemins supposent le `basePath` par défaut `/api` ; `REBASE_BASE_PATH` les déplace
tous ensemble. `/health`, `/livez` et `/metrics` se trouvent en dehors intentionnellement,
car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le chemin
de base. `/health` est *également* monté en dessous, de sorte que `/api/health` réponde
de la même manière au lieu de renvoyer une erreur 404 au moment même où quelqu'un vérifie
si le serveur est actif.

Un mécanisme de contrôle (gate) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare
ce tableau aux routes enregistrées par le code source, afin qu'aucune nouvelle surface ne puisse
être ajoutée sans figurer ici.

## Gates

| Gate | Signification |
|---|---|
| **none** | Non authentifié. Quiconque peut joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé d'API restreinte à l'opération |
| **`resource:action`** | Un appelant disposant de ce [scope](/docs/backend/roles-and-scopes/) : un administrateur, une personne dont le rôle le déclare, une clé d'API créée avec celui-ci, ou la clé de service |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir les [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement en dehors de la production |

## Données

Généré par collection, les chemins utilisent donc vos slugs plutôt qu'une liste
fixe. `:slug` correspond au `slug` d'une collection.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogation](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Le listing, les paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogation](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Le décompte, les paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcule une collection de vue matérialisée, sur les collections qui en fournissent une — [Vues](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias déprécié de `PATCH` — même écriture partielle, répond `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insère plusieurs lignes, avec upsert facultatif — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Met à jour plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprime plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écrit sur plusieurs collections dans une seule transaction — [Écriture via REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

Le décompte et l'agrégation sont des routes à part entière, enregistrées avant `/:id` afin
que `aggregate` ne soit pas interprété comme un id d'entité. `?select=` et `?groupBy=` sont
leurs paramètres, et `select` est obligatoire sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs *sont* des
paramètres de requête sur `GET /api/data/:slug` plutôt que des routes — `searchString`,
`vector_search`, `include`, `fields`. Voir l'[API REST](/docs/backend/api/).

Un projet qui ne déclare aucune collection et n'en inspecte aucune dessert ce préfixe
avec une simple réponse `404 NO_COLLECTIONS`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Auth

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ce que l'écran de connexion peut proposer : inscription, réinitialisation du mot de passe, magic link, codes par e-mail, connexion invité, fournisseurs OAuth, et si la configuration du premier administrateur est en attente |
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
| `POST` | `/api/auth/change-email` | session | Envoie un lien de confirmation à la nouvelle adresse — [Modification d'une adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un jeton de lien) | Fait basculer le compte sur la nouvelle adresse — [Modification d'une adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentification](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un jeton de vérification) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un jeton de vérification, et une session ou le mot de passe pour la conserver) | [Vérification d'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Depuis 0.31</span> [Connexion par appareil](/docs/backend/device-sign-in/). Désactivé sauf si le backend l'active |
| `POST` | `/api/auth/device/token` | none (un code d'appareil) | [Connexion par appareil](/docs/backend/device-sign-in/) : le sondage (poll) de l'appareil |
| `GET` | `/api/auth/device/:userCode` | session | [Connexion par appareil](/docs/backend/device-sign-in/) : ce que la page d'approbation affiche |
| `POST` | `/api/auth/device/approve` | session (`aal2` avec un second facteur) | [Connexion par appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Connexion par appareil](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessions d'invités. Désactivé sauf si `ALLOW_ANONYMOUS` |
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
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id de challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Tous les scopes connus de ce backend, et ceux détenus par l'appelant — [Rôles et scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un compte) | Les propres [clés personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant |
| `POST` | `/api/auth/keys` | session (un compte) | La clé en texte brut n'est renvoyée qu'une seule fois. `403 PERSONAL_KEYS_DISABLED` à moins que la collection des utilisateurs ne définisse `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un compte) | Révoque l'une des propres clés de l'appelant |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Admin

Tout ce qui se trouve sous `/api/admin` nécessite un scope du plan d'administration, et chaque
surface nomme le sien : `users:read` liste les comptes, `cron:write` déclenche une tâche.
Un administrateur les possède tous, tout comme la clé de service. Une personne détient ceux
que déclarent ses rôles, et une clé d'API ceux avec lesquels elle a été créée. Une clé limitée à
une collection n'accède à rien de tout cela. Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et uniquement tant qu'aucun admin n'existe | Refusé en production — voir [Initialisation du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | `users:write` | Gestion des utilisateurs. Les rôles dépassant ceux de l'appelant sont refusés |
| `GET` | `/api/admin/users/pick` | `users:read`, ou accès en écriture à une collection avec un champ `userSelect` | La [lecture du sélecteur d'utilisateurs](/docs/backend/auth-endpoints/) : id, nom, e-mail et avatar uniquement. Une collection dont les règles d'écriture sont en SQL brut ne compte pas |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Émet un mot de passe temporaire |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Supprime les seconds facteurs et les codes de récupération du compte, met fin à ses sessions |
| `GET` | `/api/admin/guests` | `users:read` | Invités, classés par date de dernière activité de la plus ancienne à la plus récente. `?lastSeenBefore=` les filtre selon ce que la suppression ci-dessous prendrait, et `total` les compte |
| `DELETE` | `/api/admin/guests` | `users:write` | Supprime un lot des invités vus pour la dernière fois avant `?lastSeenBefore=`, qui est obligatoire. Répond `{ deleted, skipped, remaining }`. Répéter tant que `remaining` n'est pas 0, avec `?offset=` défini sur le nombre d'éléments ignorés. Les comptes ne peuvent pas être atteints |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Supprime un invité. Un compte standard est refusé avec `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` et les rôles déclarés par le projet, avec leurs scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Clés d'API](/docs/backend/api-keys/). Jamais une clé d'API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clé en texte brut n'est renvoyée qu'une fois, à la création |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Clés d'API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tâches cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tâches cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Active ou désactive une tâche |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tâches cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Exécute une tâche maintenant. `?async=1` répond `202` dès qu'elle a démarré — [API des tâches cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | `backups:read` | Diffuse une sauvegarde en flux continu. Avec `?token=` issu d'un lien de téléchargement, aucun en-tête n'est requis, pour cette sauvegarde uniquement |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un lien vers une sauvegarde, `{ key }` → `{ url, token, expiresIn }`, valide pendant 60 secondes — [Sauvegardes](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Démarre en arrière-plan une analyse des fichiers stockés qu'aucune ligne ne référence, `?storageId=&olderThanHours=`. Répond `202` avec l'enregistrement de l'analyse : `id`, `status` (`queued`) et `runner` (`worker` lorsqu'il s'agit d'une tâche `storage.orphans` dans la file d'attente de jobs, `in-process` quand le serveur l'exécute lui-même). Son enregistrement est écrit dans la source, sous l'espace réservé `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | L'enregistrement de l'analyse, `?storageId=`. Pendant son exécution : `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` sur `collectionsTotal`, `unscanned`). Une fois `completed` : `result`, le rapport que l'ancien `GET /orphans` renvoyait. Une exécution qui cesse de rapporter pendant 10 minutes est considérée comme `failed`. `404 STORAGE_SCAN_NOT_FOUND` lorsque la source ne contient aucune analyse de ce type |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Supprime en arrière-plan les orphelins d'une analyse terminée, `202`. Chacun est vérifié à nouveau par rapport à chaque ligne et entrée d'historique, et redemandé juste avant d'être supprimé. Le résultat est la propriété `deletion` de l'enregistrement d'analyse. `409` avec `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Déprécié : l'analyse dans la requête, `?storageId=&olderThanHours=`. Répond avec `Deprecation: true`. Utilisez `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Déprécié, sans `?scan=` : analyse à nouveau et supprime dans la requête. `409 STORAGE_SCAN_INCOMPLETE` lorsqu'une collection n'a pas pu être lue |
| `POST` | `/api/admin/storage/move` | `database:write` | Copie un dossier vers une autre source sous les mêmes clés, une page par appel — ce que `rebase storage move` envoie ; `400 STORAGE_SAME_LOCATION` pour `deleteSource` entre deux sources qui stockent au même endroit |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Liste à nouveau la source après un déplacement, avec le même corps, une page par appel : `{ checked, notMoved: [{ key, reason }], cursor? }` — chaque fichier encore présent dans la source avec `deleteSource`, chaque fichier dont la cible n'a pas de copie sans celui-ci. `rebase storage move` l'interroge lorsque le déplacement est terminé |
| `GET` | `/api/admin/logs` | `logs:read` | Le tampon des logs récents |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Événements envoyés par le serveur (Server-Sent Events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rôles, rôles de règles des utilisateurs et clés de service actives qu'un administrateur peut simuler |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Chaque collection telle que `{ role?, userId?, apiKeyId? }` l'atteint : lignes visibles par rapport à celles de l'appelant, masquées par scope ou RLS, champs masqués. Session d'administrateur uniquement |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmet l'intégralité du résultat d'une requête en lecture seule sous forme de CSV en streaming — « Download full result as CSV » dans [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Ce qu'une [branche](/docs/backend/branching/#reviewing-and-merging-a-branch) a modifié : schéma, politiques et lignes, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Écrit les lignes de la branche dans son parent, `{ expectedFingerprint, onConflict?, skipBlocked? }` ; `409` si l'un des côtés a changé depuis le diff, ou si des lignes sont en conflit |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modification de schéma en direct](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifie une modification ; n'en applique jamais |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Une personne uniquement, sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifie l'assouplissement de `NOT NULL` et la suppression des colonnes non déclarées nommées dans `drop`, pour la [réconciliation de schéma](/docs/cli/schema/#rebase-schema-reconcile) ; n'en applique jamais |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applique un plan de réconciliation, uniquement si son `digest` correspond au `confirm` envoyé |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indique si l'éditeur est disponible, et la raison dans le cas contraire |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — réécrit la source de la collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails interceptés par le transport de développement au lieu d'être envoyés |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vide la boîte de réception des e-mails interceptés |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également
disponibles sur leurs chemins antérieurs à la version 0.17 sans le segment `/admin`. Ces alias sont
destinés aux projets qui n'ont pas encore migré ; écrivez votre nouveau code en utilisant le chemin canonique.

## Stockage

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, par clé | [Stockage](/docs/backend/storage/#storage-endpoints) : métadonnées pour un maximum de 100 objets |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Les sources de stockage nommées desservies par ce backend |
| `OPTIONS` | `/api/storage/tus` | none | Téléversements reprenables : les versions et extensions TUS prises en charge par ce serveur |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements reprenables : création |
| `GET` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements reprenables : décalage (offset) |
| `PATCH` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements reprenables : ajout (append) |
| `DELETE` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements reprenables : annulation |

Un déploiement sans stockage configuré dessert ce préfixe avec une erreur `501` indiquant la
variable requise, plutôt que de renvoyer une 404 comme si la fonctionnalité n'existait pas —
à l'exception de `GET /api/storage/sources`, qui répond `200` avec une liste vide.

## Fonctions

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/api/functions` | session | Les noms des fonctions desservies, et le nombre de fichiers dont le chargement a échoué |
| any | `/api/functions/<name>` | ce que la fonction déclare. Une clé d'API a également besoin de `functions:invoke` | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre
projet. `GET /api/functions` ne les liste qu'à un appelant connecté — une
session, une clé d'API ou la clé de service — et renvoie `401` à tout autre appelant :
l'inventaire des points de terminaison personnalisés d'un déploiement n'est pas public.

## Méta et opérations

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Vivacité seule : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi il s'agit du chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacité et disponibilité (liveness et readiness). Rend compte de chaque source de données configurée, et pas seulement de celle par défaut |
| `GET` | `/api/docs` | none (`schema:read` lorsque `enableSwagger` est `false`, la valeur par défaut du runtime en production) | Le document OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Uniquement hors production ; `REBASE_ENABLE_SWAGGER` ne peut pas l'activer en production. Non desservi lorsque `enableSwagger` est `false`, y compris en développement |
| `GET` | `/api/meta/schema-version` | none | Le hachage du schéma à partir duquel ce backend a été compilé et la version du runtime, et rien d'autre |
| `GET` | `/api/meta/contract` | `schema:read` | Le contrat complet de la collection, pour `rebase generate-sdk --from`. `404` si aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Les séries enregistrées sous-jacentes aux graphiques de Studio. `501` sur un runtime sans backend |

Les connexions WebSocket arrivent sous forme d'une mise à niveau (upgrade) HTTP sur le même serveur plutôt que sur
un chemin dédié — voir [Temps réel](/docs/backend/realtime/).

## Surface MCP

Montée uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui nécessite également
`REBASE_PUBLIC_URL` — voir
[Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivée par
défaut : aucun `REBASE_ROLE` ne l'active, car cela donne un accès au projet à
un logiciel tiers et il s'agit d'une décision qui appartient à une personne.

Les documents `.well-known` se trouvent à **l'origine**, et non sous `basePath` : la RFC 8414
et la RFC 9728 définissent ces chemins par rapport à l'origine, et un client les récupère
avant de détenir le moindre jeton.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées RFC 9728 désignant cette ressource et son serveur d'autorisation. Desservi également sous la forme avec suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées RFC 8414 : les points de terminaison, types de grant et méthodes PKCE pris en charge par ce déploiement |
| `POST` | `/mcp` | Bearer OAuth ou clé d'API | Le point de terminaison du protocole MCP. Agit **en tant qu'utilisateur connecté** (ou en tant que l'entité représentée par la clé), donc chaque lecture et écriture est soumise aux mêmes RLS. Les scopes `data:*` déterminent les outils proposés |
| `GET` | `/mcp` | Bearer OAuth ou clé d'API | Répond `405` avec `Allow: POST, DELETE` : ce serveur n'ouvre aucun flux initié par le serveur. Le jeton est vérifié en premier, de sorte qu'un jeton manquant ou expiré reçoit plutôt le challenge `401` |
| `DELETE` | `/mcp` | none | Répond `204`. Le point de terminaison ne conserve aucune session, il n'y a donc rien à terminer |
| `POST` | `/api/oauth/register` | rate-limited | Enregistrement dynamique de client RFC 7591. Refusé lorsque `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de la personne à celui-ci — approuver ou refuser |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Échange un code d'autorisation, ou rafraîchit |
| `POST` | `/api/oauth/revoke` | client credentials | Révocation de jeton RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Les clients que cet utilisateur a approuvés |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En révoque un, afin qu'une personne puisse annuler un consentement sans administrateur |

Le propre point de terminaison MCP du panneau d'administration ne fait pas partie de cette surface : il prend la
session du panneau d'administration, jamais un jeton OAuth, et est monté avec les
routes d'administration, que `REBASE_MCP_ENABLED` soit défini ou non, sur un pilote qui applique le RLS à chaque
appel.

| Méthode | Chemin | Gate | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, jamais anonyme | **Expérimental.** Les mêmes outils que `/mcp`, pour la personne connectée, avec `data:read`, `data:write` et `data:delete`, sous ses règles RLS. La vue `savedAppsView` du panneau d'administration ouvre les [applications enregistrées](/docs/ai/remote-mcp/) par son intermédiaire |

## Voir aussi

- [API REST](/docs/backend/api/) — l'ensemble des routes de données : filtres, tri, pagination, erreurs
- [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) — formats des requêtes et réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables qui déterminent lesquelles de ces routes sont montées
