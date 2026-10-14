---
sourceHash: 36aded03c38207a4
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

À partir du schéma Drizzle généré, `db generate` compare avec les migrations déjà présentes dans `drizzle/migrations/`, rejouées sur une base de données jetable, et produit des fichiers de migration SQL horodatés. Elle ne lit jamais votre base de données : une colonne que le démarrage ou `db push` a déjà ajoutée ressort quand même en `ADD COLUMN`.

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
- Lit les politiques
  de sécurité au niveau des lignes de chaque table dans les `securityRules` de sa collection :
  nom, commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques
  `<table>_default_*` que Rebase ajoute lui-même sont laissées de côté. Le
  `db push` qui suit recrée donc chaque politique telle qu'elle était. En 0.24, les politiques
  restent hors des fichiers, et un push peut en supprimer une dont le nom a la forme de celui
  d'une politique générée (`<table>_<op>_<hash>`)
- Lit chaque
  expression (le `USING` d'une politique, un CHECK, la valeur par défaut d'une colonne) sous le
  `search_path` qu'utilise le serveur, `public`, si bien qu'une fonction du schéma `rebase`
  s'écrit `rebase.roles()`. Connecté avec un rôle nommé `rebase`, le chemin par défaut plaçait ce
  schéma en premier et la règle revenait sous la forme `roles()`, que le push ne trouvait pas
- Conserve les politiques d'une
  table de jonction many-to-many. Les politiques `<junction>_default_edge_write_*` d'une jonction
  sont dérivées des règles de mise à jour de la collection qui déclare la
  relation, et une jonction ne peut hériter que d'une règle qu'elle sait lire. Une règle de rôle
  revient sous la forme du SQL que Postgres stocke pour elle,
  `string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]`, et
  ce SQL se lit de nouveau comme la règle de rôle, si bien que le push dérive les mêmes politiques.
  En 0.25.0, il se lisait comme du SQL brut : le dry run
  listait les trois politiques comme des politiques qu'aucune collection ne décrit, le push les
  laissait en vigueur, et une modification ultérieure de la règle ne les atteignait plus
- Écrit
  `disableDefaultPolicies: true` sur une table dont la sécurité au niveau des lignes est activée et
  qui ne détient pas toute la [base administrateur](/docs/collections/security-rules/#policies-a-collection-gets-without-writing-them),
  de sorte que le push n'ajoute aucune politique `<table>_default_admin_*` et que l'accès à la table
  reste tel qu'il était ; toute partie de la base que la table possède est écrite comme une règle.
  Supprimez la ligne pour donner au serveur et aux administrateurs toutes les lignes. Une table dont
  la RLS est désactivée garde la base, et l'introspection dit, une seule fois, de quelles tables il
  s'agit : le push active la RLS, quoi que dise une collection. En 0.24, le push qui suivait une
  introspection ajoutait la base à chaque table
- Génère comme
  une entité de la navigation une table dont les politiques donnent à chaque utilisateur ses propres lignes (elles lisent `rebase.uid()`,
  `app.uid` ou le JWT), même si elle compte très peu de lignes. En 0.24, une petite table est une liste de codes,
  et une table possédée par l'intermédiaire d'une autre est masquée comme son enfant
- Face à une
  base de données qui ne tourne pas, affiche une fois la même bannière que `db push`,
  et ne crée rien. Elle affiche le répertoire de sortie sous forme de chemin absolu
- Laisse les contraintes CHECK et EXCLUDE d'une
  table dans la base de données, là où le `db push` qui suit les conserve. Une collection ne peut
  déclarer ni l'une ni l'autre ; un CHECK que l'introspection sait lire (`total >= 0`) devient
  aussi la `validation` de la propriété. En 0.24, ce push les supprimait

**Options :**

| Flag | Description |
|------|-------------|
| `--output, -o` | Répertoire de sortie pour les fichiers de collections générés |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écrase les fichiers de collections qui existent déjà ; sans cette option, un fichier existant est ignoré |

C'est utile lors de l'adoption de Rebase sur une base de données existante — introspectez d'abord, puis personnalisez les collections générées.

**Introspecter, puis pousser, ne change rien.** Les propriétés générées indiquent exactement ce qu'est chaque colonne — `columnType`, `precision`/`scale`, `defaultValue`, `required`, l'`isId` d'une clé (`"increment"` pour une identité entière, `columnType: "serial"` pour un serial, `"manual"` pour une clé sans valeur par défaut), l'`onDelete` d'une relation — et son `index: false` là où il manque à la base de données l'index que Rebase dériverait sur la colonne de la clé, puisqu'un `belongsTo` est [indexé par défaut](/docs/backend/indexes#foreign-keys-are-indexed-for-you). Là où aucun index ne sert la colonne, la ligne le dit (supprimez-la pour qu'il en soit construit un) ; là où un autre index commence déjà par elle (`orders_customer_id_idx`, un index composite, un index unique), la ligne nomme cet index, et sans elle le push en construirait un second. En 0.24, elle disait de supprimer la ligne dans les deux cas — et le bloc `search` d'une collection relu depuis la colonne qu'il a construite — si bien que `rebase db push --dry-run` juste après une introspection ne planifie aucun changement. L'exception est une table dont la sécurité au niveau des lignes est désactivée : le push l'active, et le dry run le liste, ainsi que la base administrateur qu'il ajoute. Lorsqu'aucune propriété ne peut représenter une colonne — un `timestamp` sans fuseau horaire, un `interval`, un `inet`, un type enum qui ne s'appelle pas `<table>_<column>`, une valeur par défaut comme `CURRENT_DATE` — l'introspection le signale, colonne par colonne, dans le terminal et en tête du fichier, avec ce qu'un push lui ferait et, quand il en existe une, l'instruction qui les met en accord (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Une table dont la clé porte sur plusieurs colonnes revient comme une clé composite, chaque colonne de la clé portant son `isId`. Elle est laissée de côté, avec sa raison, quand une colonne de la clé ne peut pas porter `isId` (un timestamp, par exemple) ou que la clé étrangère d'une autre table pointe vers elle, ce qu'une relation à une seule colonne ne peut pas faire ; `db push` laisse intacte une table qui n'est pas une collection. Sur la 0.23 le push juste après une introspection peut encore planifier des changements de type, des valeurs par défaut et des NOT NULL supprimés, et une clé `id` fantôme.

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
- Exécute d'abord le plan à blanc (dry run) et s'arrête avant tout ce qui détruit des données : une table, une colonne, un schéma, une vue ou un type supprimés, un `TRUNCATE`, un changement de type de colonne qui peut perdre des valeurs (`timestamptz` → `date`, `numeric` → `integer`), ou un changement de clé primaire : `(id)` → `(id, locale)` donne un nouvel id à chaque ligne, si bien que les liens, les clés étrangères et les ids conservés ailleurs ne retrouvent plus leur ligne. Il s'arrête aussi avant la suppression d'une contrainte CHECK ou EXCLUDE que la base de données détient : aucune ligne n'est perdue, mais dès lors la base accepte des lignes qu'elle refusait. Il demande confirmation dans un terminal, où Ctrl-C ou Ctrl-D répond non, et refuse sinon ; `--allow-destructive` (ou `--yes`) l'applique quand même. Un push qui s'arrête là supprime en sortant sa base temporaire `<db>_dev_diff`
- Active la sécurité au niveau des lignes sur chaque table de collection, tables de jointure comprises, juste après le changement de schéma et avant toute étape qui peut échouer : un push qui s'arrête en cours de route laisse une nouvelle table refuser toutes les requêtes plutôt que de leur être ouverte
- Applique les politiques RLS de vos collections et **supprime celles qu'un push précédent a remplacées**
- Laisse telles quelles toutes les contraintes CHECK et EXCLUDE de la table d'une collection. Une collection ne peut déclarer ni l'une ni l'autre : ce sont donc les règles propres de la base de données, écrites à la main ou apportées par une base que `schema introspect` a adoptée ; pour en retirer une, supprimez-la à la main (`ALTER TABLE … DROP CONSTRAINT …`). Les triggers et les fonctions que vous avez écrits ne sont pas touchés non plus. En 0.24, le premier push après une introspection supprimait toutes les contraintes CHECK et EXCLUDE sans confirmation
- Reconnaît par son nom exact tout ce qu'il laisse tranquille, même si ce nom contient un `.`, `[`, `]` ou `*`. En 0.24, un index écrit à la main et nommé comme `orders_idx[v1]` était supprimé sans confirmation, et un `.` dans le nom d'une table ou d'un index faisait échouer chaque push avec `too many parts in pattern`
- Construit, **avant** de planifier, tout [index de clé étrangère que Rebase dérive](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  et qui manque à une table existante, avec `CREATE INDEX CONCURRENTLY`, de sorte que les écritures sur la
  table continuent pendant la construction ; Atlas le trouve ensuite en place. `--dry-run` les nomme et ne
  construit rien
- Estampille les politiques qu'il applique comme le fait le démarrage du serveur, de sorte que le premier
  démarrage après un push les laisse tranquilles au lieu de recréer chacune d'elles
- `--dry-run`
  liste la sécurité au niveau des lignes que le push modifierait, sous « Planned row-level security
  changes » : les tables pour lesquelles il active la RLS, et chaque politique qu'il crée, remplace
  ou supprime, déterminées comme les décident les propres étapes du push. Il ne dit « No changes »
  que lorsque ni le schéma ni la sécurité au niveau des lignes ne changeraient. Là où l'estampille
  d'une politique ne correspond pas à sa règle, ou qu'elle n'en a aucune (une politique créée par
  `db migrate`, une politique écrite à la main), le dry run la recrée à partir de sa règle sous un
  autre nom, dans une transaction qu'il annule, et compare ce que Postgres a stocké : une politique
  qui ressort identique n'est pas un changement. Ainsi, une règle que `schema introspect` a relue
  sous forme de SQL ne planifie rien, pas plus que les politiques appliquées par `db migrate`. Seule
  une politique qu'il n'a pas pu comparer (le verrou de sa table non accordé en deux secondes, par
  exemple) est listée à part. Le push lui-même affiche une ligne qui compte les changements. En 0.24, le dry run ne montrait que le plan d'Atlas, qui ne
  contient aucune politique
- Affiche une seule fois
  chaque instruction qu'applique Atlas. Atlas se connecte sans SSL à une base de données sur cette
  machine (`localhost`, `127.x`, `::1`) dont l'URL ne nomme aucun `sslmode`, comme le fait
  l'application, au lieu d'échouer sur `SSL is not enabled on the server` ; une URL qui nomme
  `sslmode`, ou un autre hôte, est transmise telle qu'elle est écrite. Une exécution d'Atlas qui
  échoue avant de planifier ne laisse derrière elle aucune base `<db>_dev_diff`
- `--dry-run` n'écrit rien du projet : `src/schema.generated.ts` reste tel quel, et les copies
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

`doctor` et `db push` distinguent les deux sortes d'orphelines. Une politique au nom généré a été remplacée, et le prochain push la supprime. Tout autre nom a été écrit à la main ou par un autre outil et reste en vigueur : décrivez-la dans les `securityRules` de sa collection pour la conserver (la vue RLS de Studio l'importe), ou supprimez-la à la main si elle est périmée. En 0.24, les deux sont « laissées derrière par un push précédent ».
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
- Compare le schéma Drizzle avec l'état que construisent les migrations de `drizzle/migrations/`, pas avec votre base de données
- Produit des fichiers de migration SQL horodatés dans `drizzle/migrations/`
- Les fichiers peuvent être examinés, modifiés et validés dans le contrôle de version
- Nomme chaque
  instruction de la nouvelle migration qui détruit des données, avec la vérification
  que `db push` exécute avant d'appliquer : une table, colonne, schéma, vue ou type
  supprimé, un `TRUNCATE`, un changement de type de colonne pouvant perdre des valeurs,
  un changement de clé primaire, ou la suppression d'une contrainte CHECK ou EXCLUDE que la
  base de données détient. Elle écrit quand même le fichier et se termine
  avec le code 0 : elle avertit, elle ne refuse pas.
- Se termine sur ce qu'il faut
  faire ensuite : `rebase db migrate`, et pour la première migration d'un projet, le
  `--baseline <version>` dont a besoin à la place une base de données que le démarrage a déjà
  préparée. Une migration ultérieure ne reçoit aucune ligne de baseline, puisqu'une migration
  destructive enregistrée par baseline sauterait son `DROP`, et une exécution qui n'écrit aucune
  migration ne dit que cela.

**Un CHECK qu'une de vos migrations a ajouté est supprimé par la suivante.** `db generate`
compare vos fichiers de migration, pas la base de données, et Atlas n'a aucun moyen d'exclure
un objet de cette comparaison. Une contrainte CHECK ou EXCLUDE que vous avez écrite à la main
dans une migration, et qu'aucune collection ne peut déclarer, revient donc sous la forme
`ALTER TABLE … DROP CONSTRAINT …` dans la prochaine migration qu'elle écrit, fondue dans la
même instruction que le vrai changement. Le rapport ci-dessus nomme cette suppression lorsque la
base de données détient déjà la contrainte ; il ne la retire pas du fichier. Supprimez la clause
avant `rebase db migrate`, ou laissez `rebase db migrate --refuse-destructive` s'arrêter dessus.
`db push` lit la base de données et conserve la contrainte.

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
- Estampille les
  politiques de sécurité au niveau des lignes comme le font `db push` et le démarrage du serveur,
  de sorte que le premier démarrage après un migrate les laisse tranquilles au lieu de recréer
  chacune d'elles. Une migration a été écrite à partir des collections de son époque : une politique
  n'est donc estampillée que lorsqu'elle est exactement ce que sa règle produit aujourd'hui. La
  commande la recrée à partir de sa règle sous un autre nom, dans une transaction qu'elle annule,
  et compare ce que Postgres a stocké, comme le fait `db push --dry-run`. Une politique qui
  diffère ne reçoit aucune estampille, et le démarrage suivant réapplique sa table

`--refuse-destructive`
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

La même chose arrive plus tard dans la boucle ordinaire : modifiez une collection pendant que `rebase dev` tourne, et le démarrage ajoute la colonne avant que `rebase db generate` n'écrive la migration qui l'ajoute, si bien que `rebase db migrate` s'arrête sur `column … already exists (42701)`. Établissez une baseline sur cette migration de la même façon. `--baseline` fonctionne sur une base qui enregistre déjà des migrations : elle marque tout jusqu'à la version comme appliqué avec `atlas migrate set`, et le dit, ou dit qu'il n'y a rien à enregistrer lorsque l'historique l'atteint déjà. En 0.24, Atlas ignore `--baseline` dès qu'une migration est enregistrée, et la même erreur revient. Une version qu'aucun fichier de `drizzle/migrations` ne porte est refusée avant que quoi que ce soit ne s'exécute, et le refus nomme les versions qui s'y trouvent.

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

La comparaison avec la base de données inclut celle que fait le démarrage avant d'avertir que `schema.generated.ts` et la base de données divergent, exécutée par le même code. Chaque différence dont le démarrage avertit figure donc aussi dans le rapport, dans les mêmes termes : une colonne NOT NULL d'un côté et nullable de l'autre, et une colonne que la base de données possède encore mais que le fichier n'a plus (le démarrage n'en supprime jamais, si bien qu'une propriété renommée laisse derrière elle son ancienne colonne). Chacune est un avertissement, et le correctif nomme `rebase db push`.

La comparaison avec la base de données nécessite `DATABASE_URL` (ou `ADMIN_CONNECTION_STRING`). Sans l'une d'elles, cette phase est signalée comme **ignorée** plutôt que réussie, et l'exécution ne se termine jamais par « All schemas are in sync » — une vérification qui n'a pas eu lieu n'est pas un certificat de bonne santé.

Il nomme aussi chaque collection sans [bloc `search`](/docs/backend/search) dont la table contient plus d'environ 10 000 lignes. Une recherche dans ce cas — la zone de recherche de l'admin, `.search()`, `?searchString=` — est un `ILIKE '%term%'` sur les colonnes de texte, qu'aucun index ne peut servir ; chacune lit donc toute la table, et son comptage la relit (environ un tiers de seconde pour 100 000 lignes, croissant avec la table). Le nombre de lignes est l'estimation de Postgres lui-même, la vérification ne parcourt donc rien. C'est une indication : elle ne change pas le code de sortie, et rien n'est indexé pour vous.

Il nomme une **jonction orpheline** : une table `public` qui a la forme d'une jonction many-to-many qu'aucune collection ne déclare. Cette forme, ce sont deux colonnes qui forment ensemble la clé primaire, chacune clé étrangère vers la table d'une collection. Renommer ou supprimer une `manyToMany` laisse son ancienne jonction derrière, car push et le démarrage ne font que créer des tables, et chaque ligne de lien y est toujours. La note est purement informative, elle ne change donc pas le code de sortie. Sa solution est l'instruction `DROP TABLE`, que `doctor` affiche et n'exécute jamais.

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
Un refus indique
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
| Une migration ne doit pas supprimer de données en CI ou en production | `rebase db migrate --refuse-destructive` se termine avec le code 1 et n'applique rien quand une instruction en attente détruit des données |
| `db migrate` échoue sur `already exists (42710)` | Le démarrage ou `db push` a déjà provisionné le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |
| `db migrate` échoue sur `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — établissez une baseline sur cette migration de la même façon |
| `db push` sur la base gérée échoue avec `Error: EOF` | Atlas a perdu une connexion que détient le `rebase dev` en cours d'exécution. Relancez-le ; s'il échoue encore, arrêtez d'abord `rebase dev` |

## Étapes suivantes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes CLI
- **[SDK typé](/docs/sdk)** — Utilisez le SDK généré
