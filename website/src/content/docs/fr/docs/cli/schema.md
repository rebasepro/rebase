---
sourceHash: 8a90381a6f529677
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des définitions de collections, créez des migrations SQL et gardez votre base de données synchronisée avec la CLI Rebase.
---

## Vue d'ensemble

Rebase utilise un pipeline **schéma-en-tant-que-code** où vos définitions de collections TypeScript sont l'unique source de vérité. La CLI les transforme via un pipeline déterministe :

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Cette page couvre chaque commande CLI impliquée dans ce pipeline.

## Le pipeline

### 1. Collections → Schéma Drizzle

Vos définitions de collections dans `config/collections/` décrivent les tables, colonnes, types, relations et enums. La commande `schema generate` les lit et produit un fichier de schéma Drizzle ORM.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` compare avec l'état actuel de la base de données et produit des fichiers de migration SQL horodatés.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente à votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

Générez un fichier de schéma Drizzle ORM à partir de vos définitions de collections :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit toutes les collections depuis `config/collections/`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les enums et les relations

**Options :**

| Flag | Description |
|------|-------------|
| `--collections, -c` | Chemin vers le répertoire des collections (par défaut : `config/collections/`) |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré |
| `--watch, -w` | Surveiller les changements et régénérer automatiquement |

Le **mode watch** est utile pendant le développement — modifiez un fichier de collection et le schéma est régénéré instantanément :

```bash
rebase schema generate --watch
```

### `rebase schema introspect`

Effectuez de l'ingénierie inverse sur les définitions de collections à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à votre base de données (en utilisant la chaîne de connexion de votre `.env`)
- Inspecte toutes les tables, colonnes, types et clés étrangères
- Génère des fichiers de définition de collections

**Options :**

| Flag | Description |
|------|-------------|
| `--output, -o` | Répertoire de sortie pour les fichiers de collections générés |

C'est utile lors de l'adoption de Rebase sur une base de données existante — introspectez d'abord, puis personnalisez les collections générées.

### `rebase db push`

Poussez les changements de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les changements directement à la base de données (CREATE, ALTER, DROP)
- Ne crée **pas** de fichiers de migration

:::caution
`db push` modifie la base de données directement. Utilisez-le uniquement en développement. Pour la production, utilisez `db generate` + `db migrate` afin de créer des fichiers de migration examinables.
:::

### `rebase db generate`

Générez des fichiers de migration SQL à partir des changements de schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle avec l'état actuel de la base de données
- Produit des fichiers de migration SQL horodatés dans le répertoire `drizzle/`
- Les fichiers peuvent être examinés, modifiés et validés dans le contrôle de version

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Exécutez toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit le répertoire `drizzle/` pour les migrations non appliquées
- Les applique dans l'ordre à la base de données
- Suit quelles migrations ont été appliquées

### `rebase db branch`

Branchement de base de données pour le développement parallèle :

```bash
rebase db branch create feature_auth
rebase db branch list
rebase db branch delete feature_auth
```

### `rebase doctor`

Détectez la dérive à trois voies entre vos définitions de collections, le schéma Drizzle généré et la base de données PostgreSQL en direct :

```bash
rebase doctor
```

**Ce qu'elle vérifie :**
- Collections ↔ Schéma généré — sont-ils synchronisés ?
- Schéma généré ↔ Base de données — y a-t-il des changements non appliqués ?
- Collections ↔ Base de données — y a-t-il une dérive inattendue ?

Exécutez `doctor` chaque fois que quelque chose semble désynchronisé. Il indique précisément où se situe l'incohérence.

### `rebase generate-sdk`

Générez un SDK client typé à partir de vos définitions de collections :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les collections depuis `config/collections/` (prend en charge les exports de baril `index.ts` ou les fichiers individuels)
- Génère des types TypeScript pour toutes les entités dans `generated/sdk/`
- Produit un fichier `database.types.ts` à utiliser avec `createRebaseClient<Database>()`

**Options :**

| Flag | Description |
|------|-------------|
| `-c`, `--collections-dir` | Chemin vers le répertoire des collections (par défaut : `config/collections/`) |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lit le schéma depuis un projet en cours d'exécution plutôt que depuis le code local. `link` utilise le projet lié à ce checkout. |
| `--token` | Jeton Bearer pour le point de terminaison de contrat (par défaut : `$REBASE_SERVICE_KEY`) |

`--from` permet à un dépôt sans collections — un frontend séparé, une deuxième application web, une application mobile — de générer un client typé à partir du projet auquel il parle. `REBASE_SERVICE_KEY` n'est envoyé qu'au projet lié à ce checkout ; pour tout autre hôte, passez `--token` explicitement.

**Utilisation après la génération :**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Les noms de champs dans les types générés sont ceux que l'API sert, inchangés : une colonne `createdAt` est `row.createdAt`. Seul l'*accesseur* de collection devient un nom de propriété (`my-notes` → `client.data.myNotes`), ce que `collectionsDictionary` remappe vers le slug.

## Flux de travail de développement

Le flux de travail d'itération rapide pour le développement :

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flux de travail de production

Le flux de travail sûr et examinable pour la production :

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in drizzle/
# 5. Commit the migration to version control
git add drizzle/

# 6. Apply in production
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|---------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Le fichier de schéma ne se met pas à jour | Vérifiez que le chemin `--collections` pointe vers le bon répertoire |
| La migration montre des changements inattendus | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez `db generate` + `db migrate` à la place |

## Étapes suivantes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes CLI
- **[SDK client](/docs/sdk)** — Utilisez le SDK généré
