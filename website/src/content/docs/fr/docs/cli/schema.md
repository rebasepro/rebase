---
sourceHash: 09be514fba53db38
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
| `--collections, -c` | Répertoire des collections (par défaut : `config/collections/`) ; les chemins relatifs sont résolus depuis l'endroit où vous lancez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus depuis l'endroit où vous lancez la commande |
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

<span class="since-badge" data-since="0.24">Depuis 0.24</span> **Introspecter, puis pousser, ne change rien.** Les propriétés générées indiquent exactement ce qu'est chaque colonne — `columnType`, `precision`/`scale`, `defaultValue`, `required`, l'`isId` d'une clé (`"increment"` pour une identité entière, `columnType: "serial"` pour un serial, `"manual"` pour une clé sans valeur par défaut), l'`onDelete` d'une relation, et le bloc `search` d'une collection relu depuis la colonne qu'il a construite — si bien que `rebase db push --dry-run` juste après une introspection ne planifie aucun changement. Lorsqu'aucune propriété ne peut représenter une colonne — un `timestamp` sans fuseau horaire, un `interval`, un `inet`, un type enum qui ne s'appelle pas `<table>_<column>`, une valeur par défaut comme `CURRENT_DATE` — l'introspection le signale, colonne par colonne, dans le terminal et en tête du fichier, avec ce qu'un push lui ferait et, quand il en existe une, l'instruction qui les met en accord (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Une table dont la clé porte sur plusieurs colonnes revient comme une clé composite, chaque colonne de la clé portant son `isId`. Elle est laissée de côté, avec sa raison, quand une colonne de la clé ne peut pas porter `isId` (un timestamp, par exemple) ou que la clé étrangère d'une autre table pointe vers elle, ce qu'une relation à une seule colonne ne peut pas faire ; `db push` laisse intacte une table qui n'est pas une collection. Sur la 0.23 le push juste après une introspection peut encore planifier des changements de type, des valeurs par défaut et des NOT NULL supprimés, et une clé `id` fantôme.

### `rebase db push`

Poussez les changements de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les changements directement à la base de données (CREATE, ALTER, DROP)
- Exécute d'abord le plan à blanc (dry run) et s'arrête avant tout ce qui détruit des données : une table, une colonne, un schéma, une vue ou un type supprimés, un `TRUNCATE`, un changement de type de colonne qui peut perdre des valeurs (`timestamptz` → `date`, `numeric` → `integer`), ou un changement de clé primaire : `(id)` → `(id, locale)` donne un nouvel id à chaque ligne, si bien que les liens, les clés étrangères et les ids conservés ailleurs ne retrouvent plus leur ligne. Il demande confirmation dans un terminal et refuse sinon ; `--allow-destructive` (ou `--yes`) l'applique quand même
- Active la sécurité au niveau des lignes sur chaque table de collection, tables de jointure comprises, juste après le changement de schéma et avant toute étape qui peut échouer : un push qui s'arrête en cours de route laisse une nouvelle table refuser toutes les requêtes plutôt que de leur être ouverte
- Applique les politiques RLS de vos collections et **supprime celles qu'un push précédent a remplacées**
- Ne crée **pas** de fichiers de migration

**Les fichiers qu'il génère au passage**, tous sous `.rebase/sql/` dans le répertoire du backend. `db push` et `db generate` écrivent les cinq à partir de vos collections à chaque exécution, avant d'en lire aucun, si bien qu'une copie commitée ne serait lue par rien. Le répertoire porte son propre `.gitignore` et n'est jamais commité.

| Fichier | Contenu |
|------|-------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état souhaité d'Atlas, et le seul qu'il compare |
| `policies.sql` | Les politiques RLS en lesquelles vos `securityRules` sont compilées |
| `search.sql` | Les fonctions de recherche plein texte et les colonnes générées, pour les collections ayant un bloc `search` |
| `vector.sql` | Les extensions pgvector et les index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les triggers `BEFORE UPDATE` derrière `autoValue: "on_update"` |

Atlas ne gère que le premier, donc `db push` et la mise en conformité du schéma au démarrage appliquent eux-mêmes les quatre autres. Un déploiement **uniquement par migrations** — qui exécute `db migrate` et jamais `db push` — doit intégrer ces quatre fichiers à une migration à la main ; `db generate` le signale quand un changement est invisible pour Atlas.

Un projet qui a commité ces fichiers dans `drizzle/` avec une version antérieure voit ces copies supprimées à sa première exécution, et la commande les nomme une à une pour que vous puissiez commiter la suppression. Elle ne supprime que les fichiers qui commencent par l'en-tête du générateur. Un fichier que vous avez écrit vous-même reste, tout comme `drizzle/migrations/`.

:::note[Modifier une règle de sécurité renomme sa politique]
Une règle sans `name` explicite est compilée en `<table>_<op>_<hash>`, où le hash couvre la sémantique de la règle — donc *modifier* une règle (plutôt qu'en ajouter une) produit une politique sous un nouveau nom et laisse l'ancienne en place.

Cela comptait beaucoup autrefois : Postgres combine les politiques `PERMISSIVE` par un OR, si bien qu'un `USING (rebase.uid() IS NOT NULL)` remplacé continuait de tout autoriser, quelle que soit la rigueur de son remplaçant. Durcir une règle n'avait aucun effet, et le push signalait un succès.

`db push` réconcilie désormais cela : il supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans la supprimer — toute politique au nom personnalisé que vos collections ne décrivent pas, car elle ne se distingue pas d'un SQL que quelqu'un a écrit délibérément.

Pour auditer une base de données poussée avant ce changement, exécutez `rebase doctor --policies`. Il fonctionne comme une vérification de CI : il se termine avec un code non nul en cas de dérive, et aussi lorsqu'il n'a pas pu effectuer la vérification — pas de `DATABASE_URL`, un chemin `--collections` qui ne se résout pas, une lecture de `pg_policies` non accordée au rôle de CI. Une vérification qui n'a pas pu regarder n'a pas réussi.
:::

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
- Produit des fichiers de migration SQL horodatés dans `drizzle/migrations/`
- Les fichiers peuvent être examinés, modifiés et validés dans le contrôle de version

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Exécutez toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit `drizzle/migrations/` pour les migrations non appliquées
- Les applique dans l'ordre à la base de données
- Suit quelles migrations ont été appliquées

#### Établir une baseline sur une base de données déjà démarrée par Rebase

Chaque démarrage de Rebase assure le schéma, et `rebase db push` l'applique directement. Une base de données sur laquelle l'un des deux a déjà tourné possède donc déjà les tables et les types que la première migration créerait, et `rebase db migrate` s'arrête sur `pq: type "posts_status" already exists (42710)`.

La migration n'a rien d'incorrect : la base a été provisionnée autrement. Enregistrez où elle en est déjà, puis migrez normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version est le préfixe numérique du fichier de migration qui décrit l'état *actuel* de la base. Cette migration et toutes celles qui la précèdent sont enregistrées comme appliquées ; tout ce qui suit s'exécute. Sur une base que rien n'a jamais démarrée, aucune baseline n'est nécessaire — migrez directement.

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

Générez un SDK typé à partir de vos définitions de collections :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit chaque fichier de collection dans `config/collections/` — les fichiers que le backend sert, qu'ils soient listés ou non par le baril `index.ts` — et s'arrête sur celui qui ne se charge pas
- Génère des types TypeScript pour toutes les entités dans `generated/sdk/`
- Produit un fichier `database.types.ts` à utiliser avec `createRebaseClient<Database>()`

`rebase dev` l'exécute pour vous au démarrage et à chaque enregistrement sous `config/collections/`. Lancez-la vous-même en CI, dans un dépôt sans collections (voir `--from` ci-dessous), ou partout où `rebase dev` ne tourne pas.

<span class="since-badge" data-since="0.24">Depuis 0.24</span> pour la lecture de chaque fichier, l'arrêt sur un fichier cassé,
l'exécution par `rebase dev` et `--collections` sur cette commande. Sur la 0.23 elle lit
les fichiers que liste le baril `index.ts`, ignore avec un avertissement celui qui ne se
charge pas, et prend le répertoire comme `--collections-dir` ; `rebase dev` ne régénère
alors que le schéma.

**Options :**

| Flag | Description |
|------|-------------|
| `-c`, `--collections` | Répertoire des collections (par défaut : `config/collections/`) ; les chemins relatifs sont résolus depuis l'endroit où vous lancez la commande. `--collections-dir` est également accepté. |
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

# 4. Review the generated SQL in drizzle/migrations/
# 5. Commit the migration to version control
git add drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see the baselining section above.
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|---------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Le fichier de schéma ne se met pas à jour | Vérifiez que le chemin `--collections` pointe vers le bon répertoire |
| La migration montre des changements inattendus | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez `db generate` + `db migrate` à la place |
| `db migrate` échoue sur `already exists (42710)` | Le démarrage ou `db push` a déjà provisionné le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |

## Étapes suivantes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes CLI
- **[SDK typé](/docs/sdk)** — Utilisez le SDK généré
