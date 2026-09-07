---
sourceHash: 08efd8549191e760
title: Vue d'ensemble de l'architecture
sidebar_label: Architecture
description: Comprenez comment le backend, le frontend, le SDK client et la base de données de Rebase s'intègrent pour former un Backend-as-a-Service complet.
---

## Architecture du système

Rebase est une plateforme full-stack composée de quatre couches :

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  React Admin UI  •  Custom Views  •  Plugins  •  Your App      │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Composants clés

### Système de bootstrappers

Le backend s'initialise via un système de bootstrappers basé sur des plugins. La logique spécifique à la base de données est découplée dans son propre package, et les bootstrappers gèrent l'initialisation de la base de données, l'authentification et les services internes.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
        connectionString: process.env.DATABASE_URL!
    })
```

Les collections se résolvent automatiquement par rapport au bootstrapper configuré via le registre d'injection de dépendances interne.

:::tip
Le `createPostgresAdapter` gère automatiquement la mise en commun des connexions à la base de données, la résolution du schéma et la configuration `LISTEN/NOTIFY` en temps réel.
:::

### Registre des collections

Le `BackendCollectionRegistry` est l'index d'exécution de toutes les collections, de leurs tables PostgreSQL, de leurs énumérations et de leurs relations Drizzle. Il est rempli au démarrage à partir de vos définitions de collections.

### Service en temps réel

La synchronisation en temps réel utilise le mécanisme natif `LISTEN/NOTIFY` de PostgreSQL :

1. Une mutation de données se produit (insertion, mise à jour, suppression)
2. Le backend émet un `NOTIFY` sur un canal
3. Le `RealtimeService` reçoit la notification
4. Il diffuse le changement à tous les clients WebSocket connectés
5. Les composants React se re-rendent avec les nouvelles données

Pour les **déploiements multi-instances** (par exemple, Cloud Run avec plusieurs réplicas), fournissez une `connectionString` dans votre PostgresBootstrapper afin que tous les réplicas partagent la même connexion `LISTEN`.

### Registre de stockage

À l'instar des pilotes, les backends de stockage sont enregistrés dans un registre. Vous pouvez avoir plusieurs fournisseurs de stockage (local, S3) et router différents champs de fichiers vers différents backends en utilisant `storageId`.

## Carte des packages

| Package | Rôle | Utilisé par |
|---------|------|---------|
| `@rebasepro/types` | Interfaces TypeScript pour les collections, les propriétés, les entités, les plugins | Tout |
| `@rebasepro/server` | Initialisation du serveur backend, API REST, authentification, stockage, WebSocket | Backend |
| `@rebasepro/client` | SDK client — Transport HTTP, WebSocket, authentification | Frontend |
| `@rebasepro/app` | Framework React — Générateur, contrôleurs, formulaires, routes, hooks | Frontend |
| `@rebasepro/ui` | Bibliothèque de composants UI autonome (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Vues de connexion, hooks du contrôleur d'authentification, gestion des utilisateurs | Frontend |
| `@rebasepro/studio` | Éditeur de collection, console SQL, console JS, éditeur RLS, navigateur de stockage | Frontend |
| `@rebasepro/cli` | CLI pour la génération de schéma, les migrations de DB, la génération de SDK | Outils de développement |
| `@rebasepro/forms` | Gestion légère de l'état des formulaires React | Frontend |
| `@rebasepro/plugin-ai` | Plugin d'auto-complétion de champ basé sur l'IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importation et exportation CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Détection automatique du schéma à partir des données de base de données existantes | Backend/CLI |

## Flux de données

### Flux de lecture
1. L'utilisateur ouvre une collection dans l'interface d'administration
2. Le SDK client envoie `GET /api/data/:slug` + ouvre une souscription WebSocket
3. Le backend interroge PostgreSQL via Drizzle ORM
4. Le transformateur de données désérialise les enregistrements de la base de données au format d'entité
5. La réponse est envoyée au frontend, les composants se rendent
6. WebSocket maintient la vue synchronisée en temps réel

### Flux d'écriture
1. L'utilisateur modifie une entité dans le formulaire
2. Les rappels `beforeSave` s'exécutent (validation, transformation)
3. Le SDK client envoie `PATCH /api/data/:slug/:id`
4. Le backend sérialise les valeurs, exécute `UPDATE` de Drizzle
5. Les rappels `afterSave` s'exécutent (effets secondaires)
6. La diffusion `NOTIFY` déclenche la mise à jour WebSocket vers tous les clients
7. Si l'historique est activé, un instantané est enregistré

## Prochaines étapes

- **[Schéma comme Code](/docs/architecture/schema-as-code)** — L'approche TypeScript-first
- **[Vue d'ensemble du Backend](/docs/backend)** — Configuration du serveur
- **[Collections](/docs/collections)** — Définissez votre schéma de données
---
