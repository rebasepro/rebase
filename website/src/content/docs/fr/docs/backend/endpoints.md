---
sourceHash: 3f722457adc3d8f9
title: Index des points de terminaison
sidebar_label: Index des points de terminaison
description: Chaque route HTTP montée par un backend Rebase — données, auth, stockage, admin, méta — avec son contrôle d'accès et la page qui l'explique.
---

Chaque route montée par le serveur, dans un seul tableau, avec les conditions requises pour y accéder.

Les chemins supposent le `basePath` par défaut `/api` ; `REBASE_BASE_PATH` les déplace
tous ensemble. `/health`, `/livez` et `/metrics` se situent délibérément en dehors,
car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le chemin de
base. `/health` est *également* monté en dessous, afin que `/api/health` réponde de la
même manière au lieu de renvoyer une 404 au moment précis où quelqu'un vérifie si le serveur
est actif.

Un contrôle automatique — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare ce
tableau aux routes enregistrées par le code source, de sorte qu'une nouvelle surface ne peut pas être ajoutée
sans apparaître ici.

## Contrôles d'accès

| Contrôle | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé d'API restreinte à l'opération |
| **`resource:action`** | Un appelant qui détient cette [portée](/docs/backend/roles-and-scopes/) : un administrateur, une personne dont le rôle la déclare, une clé d'API créée avec elle, ou la clé de service |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Données

Généré par collection, les chemins utilisent donc vos slugs plutôt qu'une
liste fixe. `:slug` est le `slug` d'une collection.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [API REST](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Requêtage](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Requêtage](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsolète de `PATCH` — même écriture partielle, répond `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insérer plusieurs lignes, avec upsert optionnel — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mettre à jour plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprimer plusieurs lignes par id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écrire à travers plusieurs collections en une transaction — [Écriture via REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

Le comptage et l'agrégation sont des routes à part entière, enregistrées avant `/:id` afin
que `aggregate` ne soit pas interprété comme un id d'entité. `?select=` et `?groupBy=` sont
leurs paramètres, et `select` est requis sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs *sont* des
paramètres de requête sur `GET /api/data/:slug` plutôt que des routes distinctes — `search`,
`vector_search`, `include`, `fields`. Voir [API REST](/docs/backend/api/).

Un projet qui ne déclare aucune collection et n'en inspecte aucune sert ce préfixe
avec une simple erreur `404 NO_COLLECTIONS`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Authentification

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Ce que l'écran de connexion peut proposer : inscription, réinitialisation du mot de passe, lien magique, codes par e-mail, connexion invité, fournisseurs OAuth, et si la configuration du premier administrateur est en attente |
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
| `POST` | `/api/auth/verify-email` | none (un jeton de vérification, et une session ou le mot de passe pour la conserver) | [Vérification de l'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
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
| `POST` | `/api/auth/mfa/challenge/verify` | none (un identifiant de défi) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Toutes les portées que ce backend connaît, et celles que détient l'appelant — [Rôles et portées](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (un compte) | Les propres [clés personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant |
| `POST` | `/api/auth/keys` | session (un compte) | La clé en texte brut n'est renvoyée qu'une seule fois. `403 PERSONAL_KEYS_DISABLED` sauf si la collection des utilisateurs définit `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (un compte) | Révoque l'une des propres clés de l'appelant |
| `GET` | `/.well-known/jwks.json` | none | Le JWKS public, lorsque la [signature asymétrique](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) est configurée |

## Administration

Tout ce qui se trouve sous `/api/admin` nécessite une portée du plan d'administration, et chaque
surface nomme la sienne : `users:read` liste les comptes, `cron:write` déclenche une tâche.
Un administrateur les détient toutes, tout comme la clé de service. Une personne détient celles
que ses rôles déclarent, et une clé d'API celles avec lesquelles elle a été créée. Une clé restreinte à
une collection ne peut accéder à rien de tout cela. Voir [Rôles et portées](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et uniquement si aucun admin n'existe | Refusé en production — voir [Initialisation du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | `users:write` | Gestion des utilisateurs. Les rôles au-delà de ceux de l'appelant sont refusés |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus que l'appelant |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refusé pour un compte qui détient plus que l'appelant |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Délivre un mot de passe temporaire |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Supprime les seconds facteurs et les codes de récupération du compte, met fin à ses sessions |
| `GET` | `/api/admin/roles` | `users:read` | `admin` et les rôles déclarés par le projet, avec leurs portées |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Clés d'API](/docs/backend/api-keys/). Jamais une clé d'API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clé en texte brut n'est renvoyée qu'une seule fois, à sa création |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Clés d'API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Clés d'API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Activer ou désactiver une tâche |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Exécuter une tâche maintenant |
| `GET` | `/api/admin/backups` | `backups:read` | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | `backups:read` | Télécharge une sauvegarde en streaming |
| `GET` | `/api/admin/logs` | `logs:read` | Le tampon des logs récents |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Événements envoyés par le serveur (SSE) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Édition de schéma en direct](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifie une modification ; ne l'applique jamais |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Une personne uniquement, sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Si l'éditeur est disponible, et la raison s'il ne l'est pas |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — réécrit le code source de la collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails interceptés par le transport de développement au lieu d'être envoyés |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vide la boîte aux lettres capturée |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également
servis sur leurs chemins antérieurs à la version 0.17 sans le segment `/admin`. Ces alias sont
destinés aux projets qui n'ont pas encore migré ; écrivez le nouveau code en utilisant le chemin canonique.

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
| `OPTIONS` | `/api/storage/tus` | none | Téléversements reprenables : les versions et extensions TUS prises en charge par ce serveur |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements avec reprise : création |
| `GET` | `/api/storage/tus/:id` | propriétaire du téléversement | Téléversements avec reprise : décalage |
| `PATCH` | `/api/storage/tus/:id` | propriétaire du téléversement | Téléversements avec reprise : ajout de données |
| `DELETE` | `/api/storage/tus/:id` | propriétaire du téléversement | Téléversements avec reprise : annulation |

Un déploiement sans stockage configuré sert ce préfixe avec une erreur `501` indiquant la
variable nécessaire, plutôt que de renvoyer une 404 comme si la fonctionnalité n'existait pas.

## Fonctions

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| any | `/api/functions/<name>` | ce que la fonction déclare. Une clé d'API a aussi besoin de `functions:invoke` | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre
projet. `GET /api/functions` ne les liste **pas** : l'inventaire des
points de terminaison personnalisés d'un déploiement n'est pas public.

## Méta et opérations

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Liveness seule : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi il s'agit du chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness et readiness. Signale chaque source de données configurée, pas seulement celle par défaut |
| `GET` | `/api/docs` | none (`schema:read` en production) | Le document OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. En développement uniquement sauf si `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | Le hachage du schéma à partir duquel ce backend a été construit, et rien d'autre |
| `GET` | `/api/meta/contract` | `schema:read` | Le contrat complet des collections, pour `rebase generate-sdk --from`. `404` si aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` si défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` si défini | Les séries enregistrées alimentant les graphiques du Studio. `501` sur un runtime sans backend |

Les connexions WebSocket arrivent sous forme de mise à niveau HTTP (HTTP upgrade) sur le même serveur plutôt que sur
un chemin qui leur est propre — voir [Temps réel](/docs/backend/realtime/).

## Surface MCP

Montée uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui nécessite également
`REBASE_PUBLIC_URL` — voir
[Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivé par
défaut : aucun `REBASE_ROLE` ne l'active, car cela donne accès au projet à un
logiciel tiers et c'est une décision qui appartient à une personne.

Les documents `.well-known` se situent à la **racine (origin)**, et non sous `basePath` : la RFC 8414
et la RFC 9728 définissent ces chemins par rapport à l'origine, et un client les récupère
avant même de détenir le moindre jeton.

| Méthode | Chemin | Contrôle | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées de la RFC 9728 identifiant cette ressource et son serveur d'autorisation. Servies également sous la forme avec suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées de la RFC 8414 : les points de terminaison, types d'octroi et méthodes PKCE pris en charge par ce déploiement |
| `POST` | `/mcp` | Bearer OAuth, ou une clé d'API | Le point de terminaison du protocole MCP. Agit **en tant qu'utilisateur connecté** (ou en tant que l'identité pour laquelle la clé agit), chaque lecture et écriture est donc soumise aux mêmes RLS. Les portées `data:*` décident des outils proposés |
| `GET` | `/mcp` | Bearer OAuth, ou une clé d'API | Répond `405` avec `Allow: POST, DELETE` : ce serveur n'ouvre aucun flux initié par le serveur. Le jeton est vérifié en premier, donc un jeton manquant ou expiré reçoit plutôt le défi `401` |
| `DELETE` | `/mcp` | none | Répond `204`. Le point de terminaison ne conserve aucune session, il n'y a donc rien à terminer |
| `POST` | `/api/oauth/register` | limitation de débit | Enregistrement dynamique de client RFC 7591. Refusé lorsque `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de la personne à celui-ci — approuver ou refuser |
| `POST` | `/api/oauth/token` | identifiants client + PKCE | Échange un code d'autorisation, ou rafraîchit |
| `POST` | `/api/oauth/revoke` | identifiants client | Révocation de jeton RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quels clients cet utilisateur a approuvés |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En révoque un, afin qu'une personne puisse annuler un consentement sans admin |

## Contenu connexe

- [API REST](/docs/backend/api/) — l'ensemble complet des routes de données : filtres, tri, pagination, erreurs
- [Points de terminaison d'authentification](/docs/backend/auth-endpoints/) — formats des requêtes et réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables qui déterminent lesquelles de ces routes sont montées
