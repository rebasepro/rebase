---
sourceHash: c7cd1dd8eea181bf
title: Index des endpoints
sidebar_label: Index des endpoints
description: Chaque route HTTP qu'un backend Rebase monte — données, authentification, stockage, administration, méta — avec la restriction d'accès de chacune et la page qui l'explique.
---

Toutes les routes montées par le serveur, regroupées dans un seul tableau, avec les conditions nécessaires pour y accéder.

Les chemins supposent le `basePath` par défaut `/api` ; `REBASE_BASE_PATH` les déplace
tous ensemble. `/health`, `/livez` et `/metrics` se situent délibérément en dehors,
car un orchestrateur sonde `/health` et ne devrait pas avoir à connaître le chemin
de base. `/health` est *également* monté en dessous, de sorte que `/api/health` réponde
de la même manière au lieu de renvoyer une 404 au moment précis où quelqu'un vérifie
si le serveur est actif.

Un contrôle — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compare ce
tableau aux routes enregistrées par le code source, de sorte qu'une nouvelle surface ne peut pas être
ajoutée sans apparaître ici.

## Restrictions d'accès (Gates)

| Restriction | Signification |
|---|---|
| **none** | Non authentifié. Toute personne pouvant joindre l'hôte peut l'appeler |
| **session** | Un appelant connecté : un jeton d'accès ou une clé d'API restreinte à l'opération |
| **admin** | Une session administrateur, une clé de service ou une clé d'API avec portée administrateur |
| **RLS** | Authentifié, puis la base de données décide ligne par ligne — voir [Règles de sécurité](/docs/collections/security-rules/) |
| **dev** | Monté uniquement hors production |

## Données (Data)

Généré par collection, les chemins portent donc vos slugs plutôt qu'une liste
fixe. `:slug` correspond au `slug` d'une collection.

| Méthode | Chemin | Restriction | En savoir plus |
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
| `POST` | `/api/data/:slug/bulk` | RLS | Insère plusieurs lignes, avec upsert optionnel — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Met à jour plusieurs lignes par identifiant — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Supprime plusieurs lignes par identifiant — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Écrit sur plusieurs collections en une seule transaction — [Écriture via REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historique des entités](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historique des entités](/docs/backend/history/) |

Le comptage et l'agrégation sont des routes à part entière, enregistrées avant `/:id` pour
que `aggregate` ne soit pas interprété comme un identifiant d'entité. `?select=` et `?groupBy=` sont
leurs paramètres, et `select` est obligatoire sur `/aggregate`.

La recherche textuelle, la recherche vectorielle, l'inclusion de relations et la sélection de champs *sont* des
paramètres de requête sur `GET /api/data/:slug` plutôt que des routes — `search`,
`vector_search`, `include`, `fields`. Voir [API REST](/docs/backend/api/).

Un projet qui ne déclare aucune collection et n'en inspecte aucune dessert ce préfixe
avec un simple `404 NO_COLLECTIONS`. Voir [Backend uniquement](/docs/getting-started/headless/).

## Authentification (Auth)

| Méthode | Chemin | Restriction | En savoir plus |
|---|---|---|---|
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
| `POST` | `/api/auth/send-verification` | session | [Authentification](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un jeton de vérification) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un jeton de lien) | [Authentification](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Codes à usage unique par e-mail |
| `POST` | `/api/auth/otp/verify` | none (un code) | Codes à usage unique par e-mail |
| `POST` | `/api/auth/anonymous` | none | Sessions invités. Désactivé sauf si `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invité) | Transforme un invité en compte |
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

## Administration (Admin)

Tout ce qui se trouve sous `/api/admin` nécessite une session administrateur, une clé de service ou une
clé d'API avec une portée administrateur. Pas un seul privilège : une clé restreinte à une collection
n'accède à rien de tout cela.

| Méthode | Chemin | Restriction | En savoir plus |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, et seulement tant qu'aucun administrateur n'existe | Refusé en production — voir [Initialisation du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gestion des utilisateurs |
| `POST` | `/api/admin/users` | admin | Gestion des utilisateurs |
| `GET` | `/api/admin/users/:uid` | admin | Gestion des utilisateurs |
| `PUT` | `/api/admin/users/:uid` | admin | Gestion des utilisateurs |
| `DELETE` | `/api/admin/users/:uid` | admin | Gestion des utilisateurs |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Émet un mot de passe temporaire |
| `GET` | `/api/admin/roles` | admin | Les rôles déclarés par le projet |
| `GET` | `/api/admin/api-keys` | admin | [Clés d'API](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | La clé en texte brut est renvoyée une seule fois, à la création |
| `GET` | `/api/admin/api-keys/:id` | admin | [Clés d'API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [Clés d'API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [Clés d'API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Tâches Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Tâches Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Activer ou désactiver une tâche |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Tâches Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Exécuter une tâche maintenant |
| `GET` | `/api/admin/backups` | admin | Inventaire des sauvegardes |
| `GET` | `/api/admin/backups/download` | admin | Diffuse une sauvegarde en flux continu |
| `GET` | `/api/admin/logs` | admin | Le tampon des journaux récents |
| `GET` | `/api/admin/logs/latest` | admin | Les entrées les plus récentes |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | Le dernier résultat de l'audit planifié |
| `GET` | `/api/admin/schema/status` | admin | [Modification de schéma à chaud](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Planifie une modification ; n'en applique jamais |
| `POST` | `/api/admin/schema/apply` | admin | Désactivé sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Indique si l'éditeur est disponible, et la raison s'il ne l'est pas |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — réécrit le code source de la collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-mails interceptés par le transport de développement au lieu d'être envoyés |

`/api/admin/cron`, `/api/admin/logs` et `/api/admin/schema-editor` sont également
accessibles via leurs chemins antérieurs à la version 0.17, sans le segment `/admin`. Ces alias sont
destinés aux projets qui n'ont pas encore migré ; écrivez le nouveau code en utilisant le chemin canonique.

## Stockage (Storage)

| Méthode | Chemin | Restriction | En savoir plus |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Stockage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Les sources de stockage nommées desservies par ce backend |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Téléversements avec reprise : création |
| `GET` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : offset |
| `PATCH` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : ajout (append) |
| `DELETE` | `/api/storage/tus/:id` | le propriétaire du téléversement | Téléversements avec reprise : annulation |

Un déploiement sans stockage configuré dessert ce préfixe avec une erreur `501` nommant la
variable requise, plutôt que de renvoyer une erreur 404 comme si la fonctionnalité n'existait pas.

## Fonctions (Functions)

| Méthode | Chemin | Restriction | En savoir plus |
|---|---|---|---|
| any | `/api/functions/<name>` | ce que la fonction déclare | [Fonctions personnalisées](/docs/backend/custom-functions/) |

Une route par fichier sous `backend/functions/`, les chemins proviennent donc de votre
projet. `GET /api/functions` ne les liste **pas** : l'inventaire des
endpoints personnalisés d'un déploiement n'est pas public.

## Méta et opérations

| Méthode | Chemin | Restriction | En savoir plus |
|---|---|---|---|
| `GET` | `/livez` | none | Vivacité seule : ce processus est-il en cours d'exécution. Ne touche pas à la base de données, c'est pourquoi c'est le chemin de sonde qu'un conteneur doit utiliser — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacité et disponibilité (readiness). Rapporte toutes les sources de données configurées, pas seulement celle par défaut |
| `GET` | `/api/docs` | none (admin en production) | Le document OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. En développement uniquement sauf si `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | Le hachage du schéma à partir duquel ce backend a été construit, et rien d'autre |
| `GET` | `/api/meta/contract` | admin | Le contrat complet de la collection, pour `rebase generate-sdk --from`. `404` si aucune authentification n'est configurée |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` si défini | Métriques Prometheus, lorsque `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` si défini | Les séries enregistrées derrière les graphiques de Studio. `501` sur un runtime sans backend |

Les connexions WebSocket arrivent sous la forme d'une mise à niveau HTTP (upgrade) sur le même serveur plutôt que sur
un chemin dédié — voir [Temps réel](/docs/backend/realtime/).

## Surface MCP

Monté uniquement lorsque `REBASE_MCP_ENABLED=true`, ce qui nécessite également
`REBASE_PUBLIC_URL` — voir
[Configuration](/docs/getting-started/configuration/#mcp-surface). Désactivé par
défaut : aucun `REBASE_ROLE` ne l'active, car cela donne accès au projet à des
logiciels tiers et il s'agit d'une décision qui doit être prise par une personne.

Les documents `.well-known` se trouvent à l'**origine**, et non sous `basePath` : la RFC 8414
et la RFC 9728 définissent ces chemins par rapport à l'origine, et un client les récupère
avant de détenir le moindre jeton.

| Méthode | Chemin | Restriction | En savoir plus |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Métadonnées RFC 9728 nommant cette ressource et son serveur d'autorisation. Desservi également avec le suffixe de chemin |
| `GET` | `/.well-known/oauth-authorization-server` | none | Métadonnées RFC 8414 : les endpoints, types d'autorisation (grants) et méthodes PKCE pris en charge par ce déploiement |
| `POST` | `/mcp` | Bearer OAuth | L'endpoint du protocole MCP. Agit **en tant qu'utilisateur connecté**, chaque lecture et écriture est donc soumise aux mêmes RLS |
| `GET` | `/mcp` | Bearer OAuth | Le flux de server-sent events pour une session |
| `DELETE` | `/mcp` | Bearer OAuth | Met fin à une session |
| `POST` | `/api/oauth/register` | limitation de débit (rate-limited) | Enregistrement dynamique de client RFC 7591. Refusé lorsque `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | L'écran de consentement vers lequel un client est redirigé |
| `POST` | `/api/oauth/authorize/decision` | session | La réponse de l'utilisateur à cet écran — approuver ou refuser |
| `POST` | `/api/oauth/token` | identifiants client + PKCE | Échange un code d'autorisation, ou rafraîchit |
| `POST` | `/api/oauth/revoke` | identifiants client | Révocation de jeton RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quels clients cet utilisateur a approuvés |
| `DELETE` | `/api/oauth/grants/:clientId` | session | En révoque une, pour qu'une personne puisse annuler un consentement sans administrateur |

## Voir aussi

- [API REST](/docs/backend/api/) — le détail des routes de données : filtres, tri, pagination, erreurs
- [Endpoints d'authentification](/docs/backend/auth-endpoints/) — formats des requêtes et réponses pour le tableau d'authentification ci-dessus
- [Environnement et configuration](/docs/getting-started/configuration/) — les variables qui déterminent lesquels de ces éléments sont montés

---
