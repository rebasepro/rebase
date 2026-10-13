---
sourceHash: d2dda811dc43afa7
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

### `rebase schema stale`

Vérifiez si le schéma généré correspond encore aux collections :

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Ce qu'elle fait :**
- Calcule ce que génèrent les collections de `config/collections/` et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Nomme chaque différence — une table manquante, une colonne dont le type a changé, un libellé d'enum supprimé, ou des clés étrangères nommées comme les dérivait une version antérieure — et se termine avec un code non nul
- Avec `--fix`, régénère le fichier au lieu de signaler

`rebase dev` tient le fichier à jour tout seul : c'est donc la vérification pour un build
ou une étape de CI. Elle accepte `--collections` et `--output` comme le fait `rebase schema generate`.

### `rebase schema introspect`

Effectuez de l'ingénierie inverse sur les définitions de collections à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à votre base de données (en utilisant la chaîne de connexion de votre `.env`)
- Inspecte toutes les tables, colonnes, types et clés étrangères
- Génère des fichiers de définition de collections
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> Lit les politiques
  de sécurité au niveau des lignes de chaque table dans les `securityRules` de sa collection :
  nom, commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques
  `<table>_default_*` que Rebase ajoute lui-même sont laissées de côté. Le
  `db push` qui suit recrée donc chaque politique telle qu'elle était. En 0.24, les politiques
  restent hors des fichiers, et un push peut en supprimer une dont le nom a la forme de celui
  d'une politique générée (`<table>_<op>_<hash>`)
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> Génère comme
  une entité de la navigation une table dont les politiques donnent à chaque utilisateur ses propres lignes (elles lisent `rebase.uid()`,
  `app.uid` ou le JWT), même si elle compte très peu de lignes. En 0.24, une petite table est une liste de codes,
  et une table possédée par l'intermédiaire d'une autre est masquée comme son enfant
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> Face à une
  base de données qui ne tourne pas, affiche une fois la même bannière que `db push`,
  et ne crée rien. Elle affiche le répertoire de sortie sous forme de chemin absolu

**Options :**

| Flag | Description |
|------|-------------|
| `--output, -o` | Répertoire de sortie pour les fichiers de collections générés |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écrase les fichiers de collections qui existent déjà ; sans cette option, un fichier existant est ignoré |

C'est utile lors de l'adoption de Rebase sur une base de données existante — introspectez d'abord, puis personnalisez les collections générées.

**Introspecter, puis pousser, ne change rien.** Les propriétés générées indiquent exactement ce qu'est chaque colonne — `columnType`, `precision`/`scale`, `defaultValue`, `required`, l'`isId` d'une clé (`"increment"` pour une identité entière, `columnType: "serial"` pour un serial, `"manual"` pour une clé sans valeur par défaut), l'`onDelete` d'une relation — et son `index: false` là où la base de données n'a aucun index sur la colonne de la clé, puisqu'un `belongsTo` est [indexé par défaut](/docs/backend/indexes#foreign-keys-are-indexed-for-you) (supprimez la ligne pour qu'il en soit construit un) — et le bloc `search` d'une collection relu depuis la colonne qu'il a construite — si bien que `rebase db push --dry-run` juste après une introspection ne planifie aucun changement. Lorsqu'aucune propriété ne peut représenter une colonne — un `timestamp` sans fuseau horaire, un `interval`, un `inet`, un type enum qui ne s'appelle pas `<table>_<column>`, une valeur par défaut comme `CURRENT_DATE` — l'introspection le signale, colonne par colonne, dans le terminal et en tête du fichier, avec ce qu'un push lui ferait et, quand il en existe une, l'instruction qui les met en accord (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Une table dont la clé porte sur plusieurs colonnes revient comme une clé composite, chaque colonne de la clé portant son `isId`. Elle est laissée de côté, avec sa raison, quand une colonne de la clé ne peut pas porter `isId` (un timestamp, par exemple) ou que la clé étrangère d'une autre table pointe vers elle, ce qu'une relation à une seule colonne ne peut pas faire ; `db push` laisse intacte une table qui n'est pas une collection. Sur la 0.23 le push juste après une introspection peut encore planifier des changements de type, des valeurs par défaut et des NOT NULL supprimés, et une clé `id` fantôme.

**À quoi ressemblent les fichiers générés**

L'introspection écrit les collections avec `defineCollection`, qui garde les clés de propriété *littérales* — de sorte que `propertiesOrder`, `listProperties`, `sort` et `display.title` complètent sur les noms de vos propres colonnes, et qu'une clé laissée derrière par une colonne renommée est une erreur de compilation plutôt qu'une ligne qui ne fait silencieusement rien. L'import utilisé dépend de ce dont votre projet dépend, et se décide à chaque exécution :

| Votre projet déclare | Les collections générées utilisent | Bloc `admin` |
|------|------|------|
| `@rebasepro/cms-types` (un projet avec le panneau) | `defineCollection` de `@rebasepro/cms-types` | oui |
| `@rebasepro/common` (un projet `--headless`) | `defineCollection` de `@rebasepro/common` | non |
| ni l'un ni l'autre | une annotation `PostgresCollectionConfig`, avec un avertissement | non |

Un projet headless n'a pas de panneau d'administration, et les types du noyau ne déclarent aucun champ `admin` — le bloc n'y est donc pas émis. C'est de la présentation (`icon`, `propertiesOrder`, `multiline`) ; rien dans le schéma, l'API ou vos données n'en dépend.

### `rebase db push`

Poussez les changements de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les changements directement à la base de données (CREATE, ALTER, DROP)
- Exécute d'abord le plan à blanc (dry run) et s'arrête avant tout ce qui détruit des données : une table, une colonne, un schéma, une vue ou un type supprimés, un `TRUNCATE`, un changement de type de colonne qui peut perdre des valeurs (`timestamptz` → `date`, `numeric` → `integer`), ou un changement de clé primaire : `(id)` → `(id, locale)` donne un nouvel id à chaque ligne, si bien que les liens, les clés étrangères et les ids conservés ailleurs ne retrouvent plus leur ligne. Il demande confirmation dans un terminal, où Ctrl-C ou Ctrl-D répond non, et refuse sinon ; `--allow-destructive` (ou `--yes`) l'applique quand même. Un push qui s'arrête là supprime en sortant sa base temporaire `<db>_dev_diff`
- Active la sécurité au niveau des lignes sur chaque table de collection, tables de jointure comprises, juste après le changement de schéma et avant toute étape qui peut échouer : un push qui s'arrête en cours de route laisse une nouvelle table refuser toutes les requêtes plutôt que de leur être ouverte
- Applique les politiques RLS de vos collections et **supprime celles qu'un push précédent a remplacées**
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> Construit, **avant** de planifier, tout [index de clé étrangère que Rebase dérive](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  et qui manque à une table existante, avec `CREATE INDEX CONCURRENTLY`, de sorte que les écritures sur la
  table continuent pendant la construction ; Atlas le trouve ensuite en place. `--dry-run` les nomme et ne
  construit rien
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> Estampille les politiques qu'il applique comme le fait le démarrage du serveur, de sorte que le premier
  démarrage après un push les laisse tranquilles au lieu de recréer chacune d'elles
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> `--dry-run` n'écrit rien du projet : `src/schema.generated.ts` reste tel quel, et les copies
  `drizzle/*.sql` qu'une version antérieure avait commitées sont nommées, pas supprimées. Seule l'entrée du
  plan va dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Combien de temps cela prend.** Presque tout un push est Atlas qui calcule le plan : il construit votre schéma
souhaité dans une base de données temporaire et le compare à la base réelle, et ce coût croît plus vite que le
nombre de tables — sur un ordinateur portable au repos, environ 0,25 s par plan pour 11 tables, 0,9 s pour 111
et 5,5 s pour 411. Un push qui ne change rien planifie une fois ; un push qui change quelque chose planifie
deux fois (le dry run que lit la garde contre les changements destructifs, puis l'application). Un push sur
un schéma de 400 tables ou plus prend donc des dizaines de secondes, et davantage sur une machine chargée ou
lente. Ce temps est celui d'Atlas, pas celui de votre base de données : les étapes qui l'entourent — génération
du SQL, verrou RLS, recherche, triggers, politiques, rôle — prennent quelques secondes à cette taille, sur
une seule connexion à votre base de données.

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

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `doctor` et `db push` distinguent les deux sortes d'orphelines. Une politique au nom généré a été remplacée, et le prochain push la supprime. Tout autre nom a été écrit à la main ou par un autre outil et reste en vigueur : décrivez-la dans les `securityRules` de sa collection pour la conserver (la vue RLS de Studio l'importe), ou supprimez-la à la main si elle est périmée. En 0.24, les deux sont « laissées derrière par un push précédent ».
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
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> Nomme chaque
  instruction de la nouvelle migration qui détruit des données, avec la vérification
  que `db push` exécute avant d'appliquer : une table, colonne, schéma, vue ou type
  supprimé, un `TRUNCATE`, un changement de type de colonne pouvant perdre des valeurs,
  ou un changement de clé primaire. Elle écrit quand même le fichier et se termine
  avec le code 0 : elle avertit, elle ne refuse pas.

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

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `--refuse-destructive`
la fait refuser à la place. Elle exécute d'abord à blanc les migrations en attente. Si une
instruction détruit des données, selon la même vérification que `db push` et
`db generate`, elle liste ces instructions et se termine avec le code 1. Elle n'applique
rien, pas même les fichiers qui précèdent cette instruction. Sans l'option, `db migrate`
se comporte comme avant et applique chaque fichier en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration qui reconstruit une colonne de recherche la supprime d'abord, donc cette
option refuse aussi cette migration. Lisez la liste qu'elle affiche, puis exécutez
`rebase db migrate` sans l'option pour l'appliquer.

#### Établir une baseline sur une base de données déjà démarrée par Rebase

Chaque démarrage de Rebase assure le schéma, et `rebase db push` l'applique directement. Une base de données sur laquelle l'un des deux a déjà tourné possède donc déjà les tables et les types que la première migration créerait, et `rebase db migrate` s'arrête sur `pq: type "posts_status" already exists (42710)`.

La migration n'a rien d'incorrect : la base a été provisionnée autrement. Enregistrez où elle en est déjà, puis migrez normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version est le préfixe numérique du fichier de migration qui décrit l'état *actuel* de la base. Cette migration et toutes celles qui la précèdent sont enregistrées comme appliquées ; tout ce qui suit s'exécute. Sur une base que rien n'a jamais démarrée, aucune baseline n'est nécessaire — migrez directement.

La même chose arrive plus tard dans la boucle ordinaire : modifiez une collection pendant que `rebase dev` tourne, et le démarrage ajoute la colonne avant que `rebase db generate` n'écrive la migration qui l'ajoute, si bien que `rebase db migrate` s'arrête sur `column … already exists (42701)`. Établissez une baseline sur cette migration de la même façon. <span class="since-badge" data-since="0.25">Depuis 0.25</span> `--baseline` fonctionne sur une base qui enregistre déjà des migrations : elle marque tout jusqu'à la version comme appliqué avec `atlas migrate set`, et le dit, ou dit qu'il n'y a rien à enregistrer lorsque l'historique l'atteint déjà. En 0.24, Atlas ignore `--baseline` dès qu'une migration est enregistrée, et la même erreur revient.

### `rebase db branch`

Branchement de base de données pour le développement parallèle :

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (et `switch --off`) et `rebase db branch prune`
sont nouveaux. `create`, `list`, `info` et `delete` existent depuis la 0.17.

Chaque branche est une copie complète de la base de données réalisée avec `CREATE DATABASE ... TEMPLATE`,
elle exige donc un véritable serveur PostgreSQL et coûte le même espace disque que sa source.

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

La comparaison avec la base de données nécessite `DATABASE_URL` (ou `ADMIN_CONNECTION_STRING`). Sans l'une d'elles, cette phase est signalée comme **ignorée** plutôt que réussie, et l'exécution ne se termine jamais par « All schemas are in sync » — une vérification qui n'a pas eu lieu n'est pas un certificat de bonne santé.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Il nomme aussi chaque collection sans [bloc `search`](/docs/backend/search) dont la table contient plus d'environ 10 000 lignes. Une recherche dans ce cas — la zone de recherche de l'admin, `.search()`, `?searchString=` — est un `ILIKE '%term%'` sur les colonnes de texte, qu'aucun index ne peut servir ; chacune lit donc toute la table, et son comptage la relit (environ un tiers de seconde pour 100 000 lignes, croissant avec la table). Le nombre de lignes est l'estimation de Postgres lui-même, la vérification ne parcourt donc rien. C'est une indication : elle ne change pas le code de sortie, et rien n'est indexé pour vous.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Il nomme une **jonction orpheline** : une table `public` qui a la forme d'une jonction many-to-many qu'aucune collection ne déclare. Cette forme, ce sont deux colonnes qui forment ensemble la clé primaire, chacune clé étrangère vers la table d'une collection. Renommer ou supprimer une `manyToMany` laisse son ancienne jonction derrière, car push et le démarrage ne font que créer des tables, et chaque ligne de lien y est toujours. La note est purement informative, elle ne change donc pas le code de sortie. Sa solution est l'instruction `DROP TABLE`, que `doctor` affiche et n'exécute jamais.

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

Sur la 0.23, la commande ne lit que les fichiers que liste le baril `index.ts`, ignore
avec un avertissement celui qui ne se charge pas, et prend le répertoire comme
`--collections-dir` ; et `rebase dev` ne régénère que le schéma : les types du SDK sont
donc à régénérer vous-même.

**Options :**

| Flag | Description |
|------|-------------|
| `-c`, `--collections` | Répertoire des collections (par défaut : `config/collections/`) ; les chemins relatifs sont résolus depuis l'endroit où vous lancez la commande. `--collections-dir` est également accepté. |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lit le schéma depuis un projet en cours d'exécution plutôt que depuis le code local. `link` utilise le projet lié à ce checkout. |
| `--token` | Jeton Bearer pour le point de terminaison de contrat (par défaut : `$REBASE_SERVICE_KEY` depuis le shell ; `.env` n'est pas lu) |

`--from` permet à un dépôt sans collections — un frontend séparé, une deuxième application web, une application mobile — de générer un client typé à partir du projet auquel il parle. `REBASE_SERVICE_KEY` n'est envoyé qu'au projet lié à ce checkout ; pour tout autre hôte, passez `--token` explicitement. La clé de `.env` appartient à votre backend local et n'est jamais envoyée.
<span class="since-badge" data-since="0.25">Depuis 0.25</span> Un refus indique
lequel de ces cas s'est produit : un `--token` refusé, une clé du shell refusée, une clé
retenue pour un hôte qui n'est pas lié, une clé présente seulement dans `.env`, ou aucune clé.
En 0.24, il dit toujours de passer `--token` ou de définir `REBASE_SERVICE_KEY`.

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

Les noms de champs dans les types générés sont ceux que l'API sert. Le nom d'un champ
sur le réseau est sa clé de propriété, et l'API est en camelCase de bout en bout :
l'introspection génère une colonne `created_at` comme une propriété `createdAt` portant
`columnName: "created_at"`, et la sert comme `row.createdAt`. La colonne elle-même
n'est pas modifiée. L'*accesseur* de collection est transformé de la même façon en nom
de propriété (`my-notes` → `client.data.myNotes`), ce que `collectionsDictionary`
remappe vers le slug.

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
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|---------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Le fichier de schéma ne se met pas à jour | Vérifiez que le chemin `--collections` pointe vers le bon répertoire |
| La migration montre des changements inattendus | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez `db generate` + `db migrate` à la place |
| Une migration ne doit pas supprimer de données en CI ou en production | <span class="since-badge" data-since="0.25">Depuis 0.25</span> `rebase db migrate --refuse-destructive` se termine avec le code 1 et n'applique rien quand une instruction en attente détruit des données |
| `db migrate` échoue sur `already exists (42710)` | Le démarrage ou `db push` a déjà provisionné le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |
| `db migrate` échoue sur `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — établissez une baseline sur cette migration de la même façon |
| `db push` sur la base gérée échoue avec `Error: EOF` | Atlas a perdu une connexion que détient le `rebase dev` en cours d'exécution. Relancez-le ; s'il échoue encore, arrêtez d'abord `rebase dev` |

## Étapes suivantes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes CLI
- **[SDK typé](/docs/sdk)** — Utilisez le SDK généré
