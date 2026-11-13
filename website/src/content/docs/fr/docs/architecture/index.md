---
sourceHash: b58890f96ff100b4
title: Vue d'ensemble de l'architecture
sidebar_label: Architecture
description: Comprenez comment le backend, le frontend, le SDK typé et la base de données de Rebase s'intègrent pour former un Backend-as-a-Service complet.
---

## Architecture du système

Rebase est une plateforme full-stack comprenant quatre couches :

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

### Système d'adaptateurs de base de données

Le backend s'initialise via un modèle unifié d'adaptateurs de base de données. La logique spécifique à la base de données est découplée dans son propre package, et l'adaptateur gère automatiquement le pool de connexions, la résolution de schéma et le routage des événements en temps réel.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Chaque table est résolue par rapport à l'adaptateur configuré — la base de données par défaut, ou celle que son `database` désigne dans `backend/resources.ts`.

:::tip
Le `createPostgresAdapter` gère automatiquement le pool de connexions à la base de données, la résolution de schéma et la configuration de `LISTEN/NOTIFY` en temps réel.
:::

### Descripteurs de tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Au démarrage, le backend compile les tables exportées par `backend/schema/index.ts` en **descripteurs** : chaque colonne avec son type Postgres, sa nullabilité, ses règles de validation et de stockage, les relations par slug, et la posture de sécurité au niveau des lignes (row-level security). Tout problème sur une table entraîne le refus du démarrage avec une seule erreur `SchemaDefinitionError` énumérant chaque problème. Les descripteurs sont la base sur laquelle s'appuient REST, le temps réel, MCP et le document OpenAPI, sur laquelle la version du schéma est calculée, et ce que `GET /api/schema/tables` transmet au panneau d'administration et au Studio, caviardé en fonction de l'appelant. Le code des hooks ne quitte jamais le serveur. Un backend sans `backend/schema` introspecte la base de données pour générer ces mêmes descripteurs à la place.

### Service temps réel

La synchronisation en temps réel utilise le mécanisme natif `LISTEN/NOTIFY` de PostgreSQL :

1. Une mutation de données se produit (insert, update, delete) — via l'API, ou tout autre élément qui écrit dans la table : `psql`, un cron, l'éditeur SQL
2. Un déclencheur sur la table émet un `NOTIFY` sur un canal (lorsque le déclencheur ne peut pas être installé, le backend l'émet lui-même, uniquement pour les écritures effectuées via l'API)
3. Le `RealtimeService` reçoit la notification
4. Il diffuse le changement à tous les clients WebSocket connectés
5. Les composants React effectuent un nouveau rendu avec les nouvelles données

Pour les **déploiements multi-instances** (par ex. Cloud Run avec plusieurs réplicas), chaque réplica maintient sa propre connexion `LISTEN` vers la même base de données, de sorte qu'une modification parvient aux abonnés de chaque réplica. Derrière un gestionnaire de pool en mode transaction comme PgBouncer, qui ne conserve pas de `LISTEN`, définissez `DATABASE_DIRECT_URL` vers la base de données elle-même.

### Registre de stockage

Tout comme les pilotes, les backends de stockage sont enregistrés dans un registre. Vous pouvez avoir plusieurs fournisseurs de stockage (local, S3) et router différentes colonnes de stockage vers différents backends à l'aide de `col.storage({ source })`.

## Carte des packages

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Package | Rôle | Utilisé par |
|---------|------|-------------|
| `@rebasepro/types` | Les constructeurs de tables (`defineTable`, `col`, `rel`), les descripteurs et les interfaces que chaque package partage | Tout |
| `@rebasepro/server` | Initialisation du serveur backend, API REST, auth, stockage, WebSocket ; réexporte les constructeurs depuis `@rebasepro/server/schema`, un point d'entrée qui ne charge aucun code serveur | Backend |
| `@rebasepro/server-postgres` | Le pilote Postgres : planification du schéma, migrations, politiques RLS, temps réel | Backend |
| `@rebasepro/codegen` | Génération du SDK typé à partir des descripteurs de tables | Outils de dev |
| `@rebasepro/client` | SDK typé — transport HTTP, WebSocket, auth | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, contrôleurs, formulaires, routes, hooks, vues de connexion, hooks de contrôleur d'authentification | Frontend |
| `@rebasepro/ui` | Bibliothèque de composants UI autonomes (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Visualiseur et éditeur de schéma, console SQL, console JS, éditeur RLS, explorateur de stockage | Frontend |
| `@rebasepro/cli` | CLI pour la génération de schéma, migrations de BD, génération de SDK | Outils de dev |
| `@rebasepro/forms` | Gestion légère de l'état des formulaires React | Frontend |
| `@rebasepro/plugin-ai` | Plugin d'autocomplétion de champs basé sur l'IA | Frontend |
| `@rebasepro/cms` | Le panneau d'administration : une vue par table issue des descripteurs, `customizeTable`, formulaires et routage, import et export CSV/JSON/Excel | Frontend |
| `@rebasepro/cms-types` | Les types et utilitaires du panneau : options de `customizeTable`, options de champs, actions d'entité, et le modèle de vue des collections et propriétés qu'affiche le panneau (`CollectionConfig`, `StringProperty`, `CollectionCallbacks`, …) | Frontend |
| `@rebasepro/firebase` | Firestore en tant que source lue directement par le panneau : `defineFirestoreCollection` | Frontend |
| `@rebasepro/inference` | Déduction de champs à partir de lignes d'exemples (l'import « créer à partir d'un fichier » de l'admin) | Frontend |

## Flux de données

### Flux de lecture
1. L'utilisateur ouvre une table dans Rebase CMS
2. Le SDK typé envoie `GET /api/data/:slug` + ouvre un abonnement WebSocket
3. Le backend interroge PostgreSQL via Drizzle ORM
4. La réponse contient les lignes telles que l'API les sert ; le panneau construit ses valeurs de formulaire à partir de la ligne et du descripteur de la table
5. Réponse envoyée au frontend, les composants effectuent leur rendu
6. Le WebSocket maintient la vue synchronisée en temps réel

### Flux d'écriture
1. L'utilisateur modifie une ligne dans le formulaire
2. Le SDK typé envoie `PATCH /api/data/:slug/:id`
3. Le backend valide les valeurs par rapport à la table et exécute les hooks `beforeSave`
4. Il exécute l'`UPDATE` sous la sécurité au niveau des lignes de l'appelant
5. Les hooks `afterSave` s'exécutent, dans la même transaction
6. La diffusion du `NOTIFY` déclenche la mise à jour par WebSocket vers tous les clients
7. Si l'historique est activé, un instantané est enregistré

## Étapes suivantes

- **[Schema as Code](/docs/architecture/schema-as-code)** — L'approche TypeScript-first
- **[Aperçu du backend](/docs/backend)** — Configuration du serveur
- **[Tables](/docs/schema/)** — Définissez votre schéma de données
