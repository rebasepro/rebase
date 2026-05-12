---
title: Branchement de base de données
sidebar_label: Branchement
slug: docs/backend/branching
description: Créez des branches de base de données isolées pour le développement, la pré-production et les tests en utilisant CREATE DATABASE ... TEMPLATE de PostgreSQL — des copies instantanées et fidèles sans temps d'arrêt.
---

## Vue d'ensemble

Le branchement de base de données vous permet de créer des **copies instantanées et isolées** de l'intégralité de votre base de données — schéma et données — pour le développement, la pré-production ou les tests. Chaque branche est une véritable base de données PostgreSQL créée à partir d'un modèle, il s'agit donc d'une copie fidèle sans temps d'arrêt.

Ceci est similaire au branchement Git, mais pour votre base de données. Créez une branche, expérimentez avec des migrations ou des données, et supprimez-la lorsque vous avez terminé. Votre base de données de production n'est jamais affectée.

## Fonctionnement

Rebase utilise le `CREATE DATABASE ... TEMPLATE` natif de PostgreSQL pour créer des branches. Cela signifie :

- **Instantanné** — PostgreSQL copie le modèle au niveau du système de fichiers
- **Fidèle** — schéma, données, index, contraintes, politiques RLS — tout est copié
- **Isolé** — les modifications dans la branche n'affectent pas la base de données source

Les métadonnées des branches sont stockées dans une table `rebase.branches` dans la base de données principale, de sorte que le système sache toujours quelles branches existent et d'où elles proviennent.

## API

L'API de branchement est disponible via l'interface `DatabaseAdmin` du backend :

### Créer une branche

```typescript
// Create a branch from the default database
await admin.createBranch("feature_auth");

// Create a branch from a specific source database
await admin.createBranch("staging", { source: "production" });
```

Ceci crée une nouvelle base de données PostgreSQL nommée `rb_feature_auth` (préfixée pour éviter les collisions) et l'enregistre dans la table de métadonnées.

### Lister les branches

```typescript
const branches = await admin.listBranches();
// [
//   {
//     name: "feature_auth",
//     parentDatabase: "rebase",
//     createdAt: "2026-04-15T10:30:00Z",
//     sizeBytes: 52428800
//   }
// ]
```

### Obtenir les informations de la branche

```typescript
const branch = await admin.getBranchInfo("feature_auth");
// { name: "feature_auth", parentDatabase: "rebase", createdAt: ..., sizeBytes: ... }
```

### Supprimer une branche

```typescript
await admin.deleteBranch("feature_auth");
```

Ceci supprime la base de données PostgreSQL et les métadonnées. La base de données principale ne peut jamais être supprimée.

## Configuration

Le branchement de base de données nécessite que `adminConnectionString` soit configuré dans votre bootstrapper PostgreSQL, car la création et la suppression de bases de données nécessitent des privilèges élevés :

```typescript
createPostgresBootstrapper({
    connection: db,
    schema: { tables, enums, relations },
    adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
    connectionString
})
```

Le `DatabasePoolManager` gère automatiquement la mise en commun des connexions pour les bases de données de branche. Lorsque vous basculez vers une branche, le gestionnaire de pool crée un nouveau pool de connexions ciblant cette base de données.

## Nommage des branches

Les noms de branches sont assainis pour n'autoriser que les caractères alphanumériques et les underscores. Le nom réel de la base de données PostgreSQL est préfixé par `rb_` pour éviter les collisions :

| Nom de la branche | Nom de la base de données |
|---|---|
| `feature_auth` | `rb_feature_auth` |
| `staging` | `rb_staging` |
| `v2_migration` | `rb_v2_migration` |

## Cas d'utilisation

### Environnements de prévisualisation

Créez une branche pour chaque pull request ou déploiement de prévisualisation. La branche obtient une copie complète des données de production, afin que les relecteurs puissent tester avec des données réelles.

### Test des migrations

Avant d'exécuter une migration en production, créez une branche et exécutez-y d'abord la migration. Si quelque chose ne va pas, supprimez simplement la branche.

### Expérimentations de données

Besoin de tester une transformation de données ? Créez une branche, exécutez votre script et vérifiez les résultats sans affecter la production.

## Limitations

- **Connexions actives** — PostgreSQL exige que toutes les connexions à la base de données source soient fermées avant de créer un modèle. Le service de branche déconnecte automatiquement les pools inactifs, mais les autres clients (par exemple, pgAdmin) doivent être déconnectés manuellement.
- **Espace disque** — chaque branche est une copie complète de la base de données. Surveillez l'utilisation du disque lors de la création de nombreuses branches.
- **Requêtes inter-bases de données** — les branches sont des bases de données PostgreSQL distinctes. Vous ne pouvez pas effectuer de JOIN entre une branche et la base de données principale.

## Prochaines étapes

- **[Aperçu du Backend](/docs/backend)** — Référence complète de la configuration du backend
- **[CLI](/docs/cli)** — Gérez les branches depuis la ligne de commande
- **[Historique des Entités](/docs/backend/history)** — Suivez les modifications au sein d'une branche
---
