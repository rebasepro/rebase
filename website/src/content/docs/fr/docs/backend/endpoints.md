---
sourceHash: e08fbf11c0138bb1
title: Index des points de terminaison
sidebar_label: Index des points de terminaison
description: Toutes les routes HTTP montées par un backend Rebase — données, auth, stockage, admin, méta — avec le contrôle d'accès associé et la page explicative.
---

Toutes les routes montées par le serveur, réunies dans un seul tableau, avec les conditions requises pour y accéder.

Les chemins supposent le `basePath` par défaut de `/api` ; `REBASE_BASE_PATH` les déplace tous ensemble. `/health`, `/livez` et `/metrics` se trouvent en dehors de celui-ci à dessein, car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le chemin de base. `/health` est *également* monté sous ce préfixe, de sorte que `/api/health` réponde de la même manière plutôt que de renvoyer une erreur 404 au moment précis où quelqu'un vérifie si le serveur est actif.

Un mécanisme de contrôle — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare ce tableau aux routes enregistrées par le code source, garantissant qu'aucune nouvelle surface ne peut être ajoutée sans apparaître ici.

## Contrôles d'accès

| Contrôle | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé API restreinte à l'opération |
| **admin** | Une session administrateur, une clé de service ou une clé API avec privilèges administrateur |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Données

Généré par collection, les chemins utilisent donc vos slugs plutôt qu'une liste fixe. `:slug` représente le `slug` d'une collection.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [API REST](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Requêtes](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Requêtes](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
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

Le comptage et l'agrégation sont des routes à part entière, enregistrées avant `/:id` afin qu'`aggregate` ne soit pas interprété comme un identifiant d'entité. `?select=` et `?groupBy=` sont leurs paramètres, et `select` est obligatoire sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs *sont* des paramètres de requête sur `GET /api/data/:slug` plutôt que des routes distinctes — `search`, `vector_search`, `include`, `fields`. Voir [API REST](/docs/backend/api/).

Un projet qui ne déclare aucune collection et n'en inspecte aucune dessert ce préfixe sous la forme d'un simple `404 NO_COLLECTIONS`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Authentification

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
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
| `POST` | `/api/auth/send-verification` | session | [Authentification](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un jeton de vérification) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
| `POST` | `/api/auth/anonymous` | none | Sessions invité. Désactivé sauf si `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invité) | Transforme un compte invité en compte standard |
| `POST` | `/api/auth/find-user` | session | Désactivé sauf si `AUTH_ALLOW_USER_LOOKUP` — il s'agit d'une surface d'énumération |
| `POST` | `/api/auth/:provider` | none | Un par fournisseur OAuth/OIDC configuré |
| `POST` | `/api/auth/link/:provider` | session | Associe un fournisseur au compte connecté |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (une connexion en cours) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un identifiant de challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Admin

Tout ce qui se trouve sous `/api/admin` nécessite une session administrateur, une clé de service ou une clé API avec une portée administrateur. Sans exception : une clé limitée à une collection n'accède à rien de tout cela.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et seulement tant qu'aucun administrateur n'existe | Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | admin | Gestion des utilisateurs |
| `GET` | `/api/admin/users/:uid` | admin | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | admin | Gestion des utilisateurs |
| `DELETE` | `/api/admin/users/:uid` | admin | Gestion des utilisateurs |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Émet un mot de passe temporaire |
| `GET` | `/api/admin/roles` | admin | Les rôles déclarés par le projet |
| `GET` | `/api/admin/api-keys` | admin | [Clés API](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | La clé en clair n'est renvoyée qu'une seule fois, lors de sa création |
| `GET` | `/api/admin/api-keys/:id` | admin | [Clés API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [Clés API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [Clés API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Activer ou désactiver une tâche |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Exécuter une tâche maintenant |
| `GET` | `/api/admin/backups` | admin | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | admin | Diffuse une sauvegarde en flux |
| `GET` | `/api/admin/logs` | admin | Le tampon des logs récents |
| `GET` | `/api/admin/logs/latest` | admin | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/schema/status` | admin | [Édition de schéma en direct](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Planifie une modification ; ne l'applique jamais |
| `POST` | `/api/admin/schema/apply` | admin | Désactivé sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Indique si l'éditeur est disponible, et la raison dans le cas contraire |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — réécrit le code source de la collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-mails interceptés par le transport de développement au lieu d'être envoyés |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également accessibles à leurs chemins antérieurs à la version 0.17, sans le segment `/admin`. Ces alias sont destinés aux projets qui n'ont pas encore migré ; écrivez le nouveau code en ciblant le chemin canonique.

## Stockage

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Les sources de stockage nommées desservies par ce backend |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements avec reprise : création |
| `GET` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : décalage |
| `PATCH` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : ajout |
| `DELETE` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : annulation |

Un déploiement sans stockage configuré répond sur ce préfixe par une erreur `501` indiquant la variable requise, plutôt que par une erreur 404 comme si la fonctionnalité n'existait pas.

## Fonctions

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| toutes | `/api/functions/<name>` | ce que la fonction déclare | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre projet. `GET /api/functions` ne les liste **pas** : l'inventaire des points de terminaison personnalisés d'un déploiement n'est pas public.

## Méta et opérations

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Vivacité uniquement : vérifie si le processus est en cours d'exécution. Ne sollicite pas la base de données, ce qui en fait le chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacité et disponibilité. Signale chaque source de données configurée, et pas seulement celle par défaut |
| `GET` | `/api/docs` | none (admin en production) | Le document OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Interface Swagger UI. Développement uniquement, sauf si `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | Le hash du schéma à partir duquel ce backend a été construit, et rien d'autre |
| `GET` | `/api/meta/contract` | admin | Le contrat complet des collections, pour `rebase generate-sdk --from`. `404` lorsqu'aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` lorsqu'il est défini | Les séries enregistrées derrière les graphiques de Studio. `501` sur un runtime sans backend |

Les connexions WebSocket s'effectuent via une mise à niveau HTTP sur le même serveur plutôt que sur un chemin dédié — voir [Temps réel](/docs/backend/realtime/).

## Ressources associées

- [API REST](/docs/backend/api/) — l'ensemble des routes de données : filtres, tri, pagination, erreurs
- [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) — formats des requêtes et des réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables déterminant lesquelles de ces routes sont montées

---
