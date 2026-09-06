---
sourceHash: 4e3fb1836c39f60c
title: Référence CLI
sidebar_label: CLI
description: Commandes CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Aperçu

La CLI Rebase (`rebase`) gère votre projet de l'échafaudage au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou utilisez via `pnpm dlx` :

```bash
pnpm dlx @rebasepro/cli <command>
```

## Commandes

### `rebase init`

Initialise un nouveau projet Rebase :

```bash
rebase init [directory]
```

Met en place la structure du projet avec les packages frontend, backend et partagés.

### `rebase dev`

Démarre le serveur de développement :

```bash
rebase dev
```

Démarre le frontend et le backend avec le rechargement à chaud.

### `rebase schema generate`

Génère le schéma ORM Drizzle à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Ceci lit vos collections depuis `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables, enums et relations Drizzle.

### `rebase db push`

Pousse les modifications de schéma directement vers la base de données (développement uniquement) :

```bash
rebase db push
```

:::caution
`db push` modifie la base de données directement sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Génère des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `drizzle/` qui peuvent être examinés et commités.

### `rebase db migrate`

Exécute les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

### `rebase generate-sdk`

Génère un SDK client typé à partir de vos définitions de collection :

```bash
rebase generate-sdk
```

Crée des types TypeScript et un client sécurisé par les types pour toutes vos collections.

### `rebase doctor`

Exécutez des diagnostics pour détecter les écarts (drift) entre vos collections, le schéma généré et l'état actuel de la base de données :

```bash
rebase doctor
```

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

## Flux de travail de migration

Le flux de travail typique pour les modifications de schéma :

```bash
# 1. Modifiez votre collection dans config/collections/
# 2. Générez le schéma Drizzle
rebase schema generate

# 3. Générez la migration SQL
rebase db generate

# 4. Examinez le SQL généré dans drizzle/

# 5. Appliquez la migration
rebase db migrate
```

## Prochaines étapes

- **[Schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Pour commencer
---
