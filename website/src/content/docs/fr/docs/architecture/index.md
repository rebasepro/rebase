---
sourceHash: fa7350988287074c
title: Aperçu de l'architecture
sidebar_label: Architecture
description: Comprenez comment le backend, le frontend, le SDK client et la base de données de Rebase s'intègrent pour former un Backend-as-a-Service complet.
---

## Architecture du système

Rebase est une plateforme full-stack articulée autour de quatre couches :

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Composants clés

### Système d'adaptateur de base de données

Le backend s'initialise via un modèle unifié d'adaptateur de base de données. La logique spécifique à la base de données est découplée dans son propre package, et l'adaptateur gère automatiquement le pooling de connexions, la résolution de schéma et le routage des événements en temps réel.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Les collections se résolvent automatiquement par rapport à l'adaptateur configuré via le registre interne d'injection de dépendances.

:::tip
Le `createPostgresAdapter` gère automatiquement le pooling de connexions à la base de données, la résolution de schéma et la configuration de `LISTEN/NOTIFY` en temps réel.
:::

### Registre des collections

Le `BackendCollectionRegistry` est l'index d'exécution de toutes les collections, de leurs tables PostgreSQL, de leurs enums et de leurs relations Drizzle. Il est alimenté au démarrage à partir de vos définitions de collections.

### Service en temps réel

La synchronisation en temps réel utilise le mécanisme natif `LISTEN/NOTIFY` de PostgreSQL :

1. Une mutation de données se produit (insertion, mise à jour, suppression)
2. Le backend émet un `NOTIFY` sur un canal
3. Le `RealtimeService` reçoit la notification
4. Il diffuse le changement à tous les clients WebSocket connectés
5. Les composants React effectuent un nouveau rendu avec les nouvelles données

Pour les **déploiements multi-instances** (par exemple, Cloud Run avec plusieurs réplicas), fournissez une `connectionString` dans votre PostgresBootstrapper afin que tous les réplicas partagent la même connexion `LISTEN`.

### Registre de stockage

Tout comme les pilotes, les backends de stockage sont enregistrés dans un registre. Vous pouvez avoir plusieurs fournisseurs de stockage (local, S3) et router différents champs de fichiers vers différents backends à l'aide de `storageId`.

## Carte des packages

| Package | Rôle | Utilisé par |
|---------|------|---------|
| `@rebasepro/types` | Interfaces TypeScript pour les collections, propriétés, entités, plugins | Tout |
| `@rebasepro/server` | Initialisation du serveur backend, API REST, authentification, stockage, WebSocket | Backend |
| `@rebasepro/client` | SDK client — Transport HTTP, WebSocket, authentification | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, contrôleurs, formulaires, routes, hooks | Frontend |
| `@rebasepro/ui` | Bibliothèque de composants d'interface utilisateur autonome (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Vues de connexion, hooks de contrôleur d'authentification, gestion des utilisateurs | Frontend |
| `@rebasepro/studio` | Éditeur de collection, console SQL, console JS, éditeur RLS, explorateur de stockage | Frontend |
| `@rebasepro/cli` | CLI pour la génération de schéma, les migrations de base de données, la génération de SDK | Outils de dév |
| `@rebasepro/forms` | Gestion d'état de formulaire React légère | Frontend |
| `@rebasepro/plugin-ai` | Plugin d'autocomplétion de champs alimenté par l'IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importation et exportation CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Détection automatique de schéma à partir des données existantes de la base de données | Backend/CLI |

## Flux de données

### Flux de lecture
1. L'utilisateur ouvre une collection dans Rebase CMS
2. Le SDK client envoie `GET /api/data/:slug` + ouvre une souscription WebSocket
3. Le backend interroge PostgreSQL via Drizzle ORM
4. Le transformateur de données désérialise les enregistrements de la base de données au format entité
5. La réponse est envoyée au frontend, les composants effectuent le rendu
6. WebSocket maintient la vue synchronisée en temps réel

### Flux d'écriture
1. L'utilisateur modifie une entité dans le formulaire
2. Les callbacks `beforeSave` s'exécutent (validation, transformation)
3. Le SDK client envoie `PATCH /api/data/:slug/:id`
4. Le backend sérialise les valeurs, exécute l'`UPDATE` Drizzle
5. Les callbacks `afterSave` s'exécutent (effets secondaires)
6. La diffusion `NOTIFY` déclenche la mise à jour WebSocket vers tous les clients
7. Si l'historique est activé, un instantané est enregistré

## Étapes suivantes

- **[Schema as Code](/docs/architecture/schema-as-code)** — L'approche axée sur TypeScript
- **[Backend Overview](/docs/backend)** — Configuration du serveur
- **[Collections](/docs/collections)** — Définissez votre schéma de données
