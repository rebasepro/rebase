---
sourceHash: 169899c54121eb6e
title: Index des points de terminaison
sidebar_label: Index des points de terminaison
description: Chaque route HTTP montée par un backend Rebase — données, authentification, stockage, administration, méta — avec le contrôle d'accès de chacune et la page qui l'explique.
---

Toutes les routes montées par le serveur, dans un seul tableau, avec les conditions requises pour y accéder.

Les chemins partent du principe que le `basePath` par défaut est `/api` ; `REBASE_BASE_PATH` les déplace tous ensemble. `/health`, `/livez` et `/metrics` se situent intentionnellement en dehors, car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le chemin de base. `/health` est *également* monté en dessous, de sorte que `/api/health` répond de la même manière au lieu de renvoyer une erreur 404 au moment précis où quelqu'un vérifie si le serveur est actif.

Un contrôle de validation — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare ce tableau aux routes enregistrées par le code source, afin qu'une nouvelle surface ne puisse pas être ajoutée sans apparaître ici.

## Contrôles d'accès

| Contrôle | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé d'API restreinte à l'opération |
| **`resource:action`** | Un appelant disposant de cette [portée](/docs/backend/roles-and-scopes/) : un administrateur, une personne dont le rôle la déclare, une clé d'API créée avec celle-ci, ou la clé de service |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Données

Généré par collection, de sorte que les chemins contiennent vos slugs plutôt qu'une liste fixe. `:slug` est le `slug` d'une collection.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Interrogation](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Le listing, paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Interrogation](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Le décompte, paramètres de requête dans le corps — [Requêtes trop longues pour une URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsolète de `PATCH` — même écriture partielle, répond `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insère plusieurs lignes, avec upsert facultatif — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Met à jour plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprime plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écriture à travers plusieurs collections dans une seule transaction — [Écriture via REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

Le décompte et l'agrégation sont des routes à part entière, enregistrées avant `/:id` pour éviter qu'`aggregate` ne soit interprété comme un identifiant d'entité. `?select=` et `?groupBy=` sont leurs paramètres, et `select` est requis sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs *sont* des paramètres de requête sur `GET /api/data/:slug` plutôt que des routes — `searchString`, `vector_search`, `include`, `fields`. Voir [API REST](/docs/backend/api/).

Un projet qui ne déclare aucune collection et n'en inspecte aucune sert ce préfixe sous la forme d'un unique `404 NO_COLLECTIONS`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Authentification

| Méthode | Chemin | Contrôle | En savoir plus |
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
| `POST` | `/api/auth/change-email` | session | Envoie un lien de confirmation par e-mail à la nouvelle adresse — [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un jeton de lien) | Associe le compte à la nouvelle adresse — [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentification](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un jeton de vérification) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un jeton de vérification, et une session ou le mot de passe pour la conserver) | [Vérification par e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
| `POST` | `/api/auth/anonymous` | none | Sessions invités. Désactivé sauf si `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invité) | Transforme un invité en compte |
| `POST` | `/api/auth/find-user` | session | Désactivé sauf si `AUTH_ALLOW_USER_LOOKUP` — il s'agit d'une surface d'énumération |
| `POST` | `/api/auth/:provider` | none | Un par fournisseur OAuth/OIDC configuré |
| `POST` | `/api/auth/link/:provider` | session | Lie un fournisseur au compte connecté |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (une connexion en cours) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un identifiant de challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Toutes les portées connues de ce backend, et celles que détient l'appelant — [Rôles et portées](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un compte) | Les [clés personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant lui-même |
| `POST` | `/api/auth/keys` | session (un compte) | La clé en texte clair n'est retournée qu'une seule fois. `403 PERSONAL_KEYS_DISABLED` sauf si la collection des utilisateurs définit `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un compte) | Révoque l'une des clés personnelles de l'appelant |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Administration

Tout ce qui se trouve sous `/api/admin` nécessite une portée du plan d'administration, et chaque surface nomme la sienne : `users:read` liste les comptes, `cron:write` déclenche une tâche. Un administrateur les détient toutes, tout comme la clé de service. Une personne détient celles que ses rôles déclarent, et une clé d'API celles avec lesquelles elle a été créée. Une clé restreinte à une collection n'a accès à rien de tout cela. Voir [Rôles et portées](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et uniquement tant qu'aucun administrateur n'existe | Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | `users:write` | Gestion des utilisateurs. Les rôles supérieurs à ceux de l'appelant sont refusés |
| `GET` | `/api/admin/users/pick` | `users:read`, ou accès en écriture à une collection dotée d'un champ `userSelect` | La [lecture du sélecteur d'utilisateurs](/docs/backend/auth-endpoints/) : id, nom, e-mail et avatar uniquement. Une collection dont les règles d'écriture utilisent du SQL brut ne compte pas |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus de privilèges que l'appelant |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Délivre un mot de passe temporaire |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Supprime les seconds facteurs et les codes de récupération du compte, met fin à ses sessions |
| `GET` | `/api/admin/guests` | `users:read` | <span class="since-badge" data-since="0.27">Depuis 0.27</span> Invités, classés par dernière activité la plus ancienne en premier. `?lastSeenBefore=` les filtre selon ce que la suppression ci-dessous prendrait en compte, et `total` les dénombre |
| `DELETE` | `/api/admin/guests` | `users:write` | <span class="since-badge" data-since="0.27">Depuis 0.27</span> Supprime un lot d'invités vus pour la dernière fois avant `?lastSeenBefore=`, qui est requis. Répond `{ deleted, skipped, remaining }`. Répéter tant que `remaining` n'est pas 0, avec `?offset=` défini sur le nombre d'éléments ignorés. Les comptes ne peuvent pas être atteints |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | <span class="since-badge" data-since="0.27">Depuis 0.27</span> Supprime un invité. Un compte est refusé avec `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` et les rôles déclarés par le projet, avec leurs portées |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Clés d'API](/docs/backend/api-keys/). Jamais une clé d'API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clé en texte clair est renvoyée une seule fois, lors de sa création |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Clés d'API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Active ou désactive une tâche |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Exécute une tâche maintenant. `?async=1` répond `202` dès qu'elle a démarré — [API des tâches Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | `backups:read` | Diffuse une sauvegarde en flux. Avec `?token=` provenant d'un lien de téléchargement, aucun en-tête n'est requis, pour cette sauvegarde uniquement |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un lien vers une sauvegarde, `{ key }` → `{ url, token, expiresIn }`, valable pendant 60 secondes — [Sauvegardes](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Démarre en arrière-plan une analyse des fichiers stockés qu'aucune ligne ne référence, `?storageId=&olderThanHours=`. Répond `202` avec l'enregistrement de l'analyse : `id`, `status` (`queued`) et `runner` (`worker` lorsqu'il s'agit d'une tâche `storage.orphans` sur la file d'attente des tâches, `in-process` lorsque le serveur l'exécute lui-même). Son enregistrement est écrit dans la source, sous le chemin réservé `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | L'enregistrement de l'analyse, `?storageId=`. Pendant son exécution : `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` sur `collectionsTotal`, `unscanned`). Une fois `completed` : `result`, le rapport que l'ancien `GET /orphans` renvoyait. Une exécution qui a cessé de faire un rapport pendant 10 minutes reçoit une réponse `failed`. `404 STORAGE_SCAN_NOT_FOUND` lorsque la source ne contient aucune analyse de ce type |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Supprime en arrière-plan les orphelins d'une analyse terminée, `202`. Chacun est à nouveau vérifié par rapport à chaque ligne et entrée d'historique, et re-vérifié juste avant d'être supprimé. Le résultat correspond au champ `deletion` de l'enregistrement de l'analyse. `409` avec `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsolète : l'analyse dans la requête, `?storageId=&olderThanHours=`. Répond avec `Deprecation: true`. Utilisez `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsolète, sans `?scan=` : analyse à nouveau et supprime dans la requête. `409 STORAGE_SCAN_INCOMPLETE` lorsqu'une collection n'a pas pu être lue |
| `POST` | `/api/admin/storage/move` | `database:write` | Copie un dossier vers une autre source sous les mêmes clés, une page par appel — ce que `rebase storage move` envoie ; `400 STORAGE_SAME_LOCATION` pour `deleteSource` entre deux sources qui stockent au même emplacement |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Liste à nouveau la source après un déplacement, avec le même corps, une page par appel : `{ checked, notMoved: [{ key, reason }], cursor? }` — chaque fichier encore dans la source avec `deleteSource`, chaque fichier dont la cible n'a pas de copie sans celui-ci. `rebase storage move` l'interroge une fois le déplacement terminé |
| `GET` | `/api/admin/logs` | `logs:read` | Le tampon des journaux récents |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Événements envoyés par le serveur (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rôles, rôles de règles des utilisateurs et clés de service actives qu'un administrateur peut simuler |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Chaque collection telle que `{ role?, userId?, apiKeyId? }` y accède : lignes visibles par rapport à celles de l'appelant, masquées par la portée ou le RLS, champs masqués. Session administrateur uniquement |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmet l'intégralité du résultat d'une requête en lecture seule sous forme de flux CSV — « Télécharger le résultat complet en CSV » de [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Ce qu'une [branche](/docs/backend/branching/#reviewing-and-merging-a-branch) a modifié : schéma, politiques et lignes, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Écrit les lignes de la branche dans son parent, `{ expectedFingerprint, onConflict?, skipBlocked? }` ; `409` si l'un des deux côtés a changé depuis le diff, ou en cas de conflit de lignes |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Modification de schéma à chaud](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifie une modification ; n'en applique jamais |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Une personne uniquement, sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indique si l'éditeur est disponible, et la raison dans le cas contraire |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — réécrit le code source de la collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails capturés par le transport de développement au lieu d'être envoyés |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vide la boîte aux lettres capturée |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également servis sur leurs chemins antérieurs à la version 0.17 sans le segment `/admin`. Ces alias sont destinés aux projets qui n'ont pas encore migré ; écrivez le nouveau code en utilisant le chemin canonique.

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
| `GET` | `/api/storage/sources` | session | Les sources de stockage nommées servies par ce backend |
| `OPTIONS` | `/api/storage/tus` | none | Téléversements avec reprise : les versions et extensions TUS prises en charge par ce serveur |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements avec reprise : création |
| `GET` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : offset |
| `PATCH` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : ajout |
| `DELETE` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : annulation |

Un déploiement sans stockage configuré répond sur ce préfixe par un code `501` nommant la variable requise, plutôt que par une erreur 404 comme si la fonctionnalité n'existait pas — à l'exception de `GET /api/storage/sources`, qui répond `200` avec une liste vide.

## Fonctions

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/functions` | session | Les noms des fonctions servies, et le nombre de fichiers dont le chargement a échoué |
| any | `/api/functions/<name>` | ce que la fonction déclare. Une clé d'API nécessite également `functions:invoke` | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre projet. `GET /api/functions` ne les liste qu'à un appelant connecté — une session, une clé d'API ou la clé de service — et renvoie `401` à toute autre personne : l'inventaire des points de terminaison personnalisés d'un déploiement n'est pas public.

## Méta et opérations

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Test de vivacité seul : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi il s'agit du chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacité et disponibilité. Rapporte toutes les sources de données configurées, pas seulement celle par défaut |
| `GET` | `/api/docs` | none (`schema:read` lorsque `enableSwagger` est `false`, le réglage par défaut du runtime en production) | Le document OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Hors production uniquement ; `REBASE_ENABLE_SWAGGER` ne peut pas l'activer en production. N'est pas servi lorsque `enableSwagger` est `false`, y compris en développement |
| `GET` | `/api/meta/schema-version` | none | Le hachage du schéma à partir duquel ce backend a été compilé et la version du runtime, et rien d'autre |
| `GET` | `/api/meta/contract` | `schema:read` | Le contrat complet des collections, pour `rebase generate-sdk --from`. `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Les séries enregistrées derrière les graphiques de Studio. `501` sur un runtime sans backend |

Les connexions WebSocket arrivent sous forme de mise à niveau HTTP (upgrade) sur le même serveur plutôt que sur un chemin dédié — voir [Temps réel](/docs/backend/realtime/).

## Surface MCP

Monté uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui nécessite également `REBASE_PUBLIC_URL` — voir [Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivé par défaut : aucun `REBASE_ROLE` ne l'active, car cela donne accès au projet à des logiciels tiers et c'est une décision qui revient à un humain.

Les documents `.well-known` se trouvent à l'**origine**, et non sous `basePath` : la RFC 8414 et la RFC 9728 définissent ces chemins par rapport à l'origine, et un client les récupère avant de posséder le moindre jeton.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées RFC 9728 désignant cette ressource et son serveur d'autorisation. Également servi sous la forme avec suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées RFC 8414 : les points de terminaison, types d'autorisation et méthodes PKCE pris en charge par ce déploiement |
| `POST` | `/mcp` | Bearer OAuth, ou une clé d'API | Le point de terminaison du protocole MCP. Agit **en tant qu'utilisateur connecté** (ou en tant que l'entité représentée par la clé), donc chaque lecture et écriture est soumise au même RLS. Les portées `data:*` déterminent quels outils sont proposés |
| `GET` | `/mcp` | Bearer OAuth, ou une clé d'API | Répond `405` avec `Allow: POST, DELETE` : ce serveur n'ouvre aucun flux initié par le serveur. Le jeton est vérifié en premier, donc un jeton manquant ou périmé recevra plutôt le challenge `401` |
| `DELETE` | `/mcp` | none | Répond `204`. Le point de terminaison ne conserve aucune session, il n'y a donc rien à terminer |
| `POST` | `/api/oauth/register` | limité en débit | Enregistrement dynamique de client RFC 7591. Refusé lorsque `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de la personne à celui-ci — approuver ou refuser |
| `POST` | `/api/oauth/token` | identifiants client (client credentials) + PKCE | Échange un code d'autorisation, ou rafraîchit |
| `POST` | `/api/oauth/revoke` | identifiants client (client credentials) | Révocation de jeton RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quels clients cet utilisateur a approuvés |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En retire un, afin qu'une personne puisse révoquer un consentement sans intervention d'un administrateur |

## Voir aussi

- [API REST](/docs/backend/api/) — le détail complet des routes de données : filtres, tri, pagination, erreurs
- [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) — formats des requêtes et réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables qui déterminent lesquelles de ces routes sont montées
