---
sourceHash: 78c09101b46f0864
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des tables dans backend/schema, créez des migrations SQL, introspectez une base de données existante dans des fichiers defineTable, et maintenez votre base de données synchronisée avec la CLI Rebase.
---

## Vue d'ensemble

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Rebase utilise un pipeline **schema-as-code** où les tables que vous déclarez avec
`defineTable` dans `backend/schema/` constituent l'unique source de vérité. La CLI
les transforme à travers un pipeline déterministe :

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Cette page couvre chaque commande de la CLI impliquée dans ce pipeline.

## Le pipeline

### 1. Tables → Schéma Drizzle

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les tables exportées par `backend/schema/index.ts` décrivent les colonnes, types, relations,
enums et la sécurité au niveau des lignes (row-level security ou RLS). Chaque commande ci-dessous les lit via le chargeur
à partir duquel le backend démarre. Ainsi, un schéma qui ne compile pas — une table sans
`rls`, `"inherit"` sans `defaultRls`, un `defineTable` que l'index n'exporte pas —
interrompt la commande avec une `SchemaDefinitionError` nommant chaque problème,
et rien n'est écrit. La commande `schema generate` produit un fichier de schéma Drizzle ORM
à partir de celles-ci.

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet
qui conserve ses tables ailleurs ; la valeur par défaut est `backend/schema`, ou la
clé `tables` de l'application backend dans `rebase.json`. `--collections` / `-c`, le
flag antérieur à la version 0.31, est refusé avec un message mentionnant le codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), tout comme un
projet qui possède encore `config/collections`.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` effectue un diff par rapport aux migrations déjà présentes dans `backend/drizzle/migrations/`, rejouées sur une base de données temporaire (scratch database), et produit des fichiers de migration SQL horodatés. La commande ne lit jamais votre base de données : une colonne que le démarrage (boot) ou que `db push` a déjà ajoutée ressortira tout de même sous la forme `ADD COLUMN`.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente à votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générez un fichier de schéma Drizzle ORM à partir de vos tables :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les enums et les relations

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--watch, -w` | Surveille les modifications et régénère automatiquement |

Le **mode watch** est utile pendant le développement — modifiez un fichier de table et le schéma se régénère instantanément :

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Vérifie si le schéma généré correspond toujours aux tables :

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Ce qu'elle fait :**
- Génère le rendu de ce que les tables dans `backend/schema/` produisent et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Nomme chaque différence — une table manquante, une colonne dont le type a changé, un label d'enum supprimé, ou des clés étrangères nommées selon la convention d'une version antérieure — et quitte avec un code de sortie non nul
- Avec `--fix`, régénère le fichier au lieu de simplement rapporter les écarts

`rebase dev` maintient le fichier à jour de lui-même, il s'agit donc de la vérification recommandée pour un build
ou une étape de CI. Elle prend `--schema-dir` et `--output` tout comme
`rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Assouplissez et supprimez ce que le démarrage ne prend pas en charge, après avoir examiné le plan :

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Ce qu'elle fait :**
- Demande au backend en cours d'exécution d'établir un plan par rapport à sa propre base de données. C'est le backend vers lequel pointent le fichier `.env` et le lien cloud, ce qui permet de fonctionner sur Rebase Cloud, où rien d'autre n'accède à la base de données.
- Planifie un `DROP NOT NULL` pour chaque colonne qu'une table déclare comme nullable alors que la base de données l'exige encore.
- Liste chaque colonne qu'aucune table ne déclare. Une colonne `NOT NULL` sans valeur par défaut bloque chaque insertion, elle est donc également assouplie, et ses données sont conservées. La commande ne supprime que les colonnes spécifiées avec `--drop <table>.<column>`, et affiche combien de lignes contiennent une valeur pour chacune.
- S'applique une fois que vous tapez `yes`. Le serveur n'exécute le plan que sur le condensé (digest) de celui que vous avez examiné, de sorte que si la base de données ou les tables ont changé entre-temps, il refuse et vous devez examiner à nouveau. `--yes` ignore l'invite de confirmation.

Le démarrage ne fait qu'ajouter des éléments ; ainsi, après avoir supprimé une colonne de son `defineTable`, la colonne subsiste dans la base de données avec ses données. Une colonne `NOT NULL` sans valeur par défaut fait alors échouer chaque insertion, et les journaux de démarrage mentionnent cette commande à cet effet : sans `--drop` pour conserver les données, avec `--drop` pour supprimer la colonne. Déployez d'abord la modification de la table, car reconcile planifie par rapport à ce que le backend exécute. Cela nécessite `REBASE_SERVICE_KEY` dans `.env`. En local, `rebase db push` couvre les mêmes besoins grâce à son garde-fou contre les modifications destructives (destructive-change gate).

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générez des fichiers `defineTable` à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à la base de données de ce projet, celle affichée par `rebase db url` (la base gérée est démarrée s'il s'agit d'elle) ; `--database-url` en désigne une autre, et `--docker` utilise celle de Compose
- Lit chaque table, colonne, type, clé étrangère et politique, et écrit
  `backend/schema/<table>.ts` — un `defineTable` par table — ainsi que le
  `backend/schema/index.ts` qui les exporte (fusionné dans un index déjà existant)
- Déclare chaque colonne avec son type Postgres : `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, une enum avec ses valeurs (labels) et son vrai nom de type
  (un `pgEnum` lorsque le type est partagé), un tableau sous la forme `<item>.array()`,
  `col.vector({ dimensions })`, les clés d'identité et serial, les valeurs par défaut — orthographiés selon
  la syntaxe de Drizzle. Un type qu'aucun builder ne nomme devient
  `col.custom({ dataType: "<sql type>" })`, que Rebase transmet tel que le
  driver le renvoie ; `db generate` et `db push` le refusent tant que le planificateur
  n'est pas capable de le planifier
- Déclare la colonne de clé étrangère, le `belongsTo` correspondant et le
  `hasMany` inverse sur la cible ; une table de jonction devient un `manyToMany`, ses propres
  colonnes constituant le `pivot`
- Lit les politiques de sécurité au niveau des lignes de chaque table dans son `rls` : nom,
  commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques
  `<table>_default_*` que Rebase ajoute lui-même sont exclues, afin que le `db push`
  suivant recrée chaque politique telle qu'elle était. Une table dont la sécurité au niveau des lignes
  est activée sans politique est écrite avec `rls: "admin-only"`
- Lit chaque expression (le `USING` d'une politique, un CHECK, une valeur par défaut de colonne) sous
  le `search_path` utilisé par le serveur, `public`, de sorte qu'une fonction dans le schéma
  `rebase` est écrite `rebase.roles()`
- Transforme un CHECK lisible (`total >= 0`) en `.validate()` sur la colonne, et
  laisse la contrainte telle quelle dans la base de données, où le push suivant la
  conservera
- Place ce qu'elle n'a pas pu déterminer exactement dans un commentaire en haut du
  fichier de la table et sur le terminal — un ensemble fermé de chaînes sur une colonne de texte, une
  colonne générée dont l'expression n'a pas été lue, un type personnalisé — accompagné de ce
  qu'un push lui ferait subir
- Avec `--data-inference`, échantillonne jusqu'à 100 lignes par table et écrit ce qui relève de la
  présentation — titres, icônes, tableaux (boards), tris, options de champ — dans
  `frontend/src/cms/<table>.tsx` sous forme de `customizeTable`, lorsque le frontend du
  projet dépend de `@rebasepro/cms`. Un projet headless n'en reçoit aucun
- Face à une base de données qui n'est pas en cours d'exécution, affiche une seule fois la même bannière
  que `db push`, et ne crée rien. La commande affiche le répertoire de sortie sous la
  forme d'un chemin absolu

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Où écrire les fichiers de tables (par défaut : `backend/schema`). `--output` a été supprimé |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écraser les fichiers de tables déjà existants ; sans cette option, un fichier existant est ignoré |
| `--database-url` | Lire cette base de données au lieu de celle du projet |
| `--docker` | Lire la base de données Compose, en la démarrant si nécessaire |
| `--data-inference` / `--no-data-inference` | Échantillonner jusqu'à 100 lignes par table pour détecter les formats, les contraintes et les paramètres du panneau, ou lire uniquement la structure. Sans l'une de ces options, la commande pose la question, et sans terminal elle lit uniquement la structure |

C'est utile lors de l'adoption de Rebase sur une base de données existante — introspectez
d'abord, puis modifiez les tables générées. Une table dont la sécurité au niveau des lignes est désactivée est
écrite comme n'importe quelle autre, avec son `rls` ; le push active RLS, et l'exécution
à blanc (dry run) le signale. Un backend qui s'exécute sans aucun `backend/schema` dessert
directement la base de données à la place — voir [Backend seul](/docs/getting-started/headless/).

### `rebase db push`

Poussez les modifications de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les modifications directement à la base de données (CREATE, ALTER, DROP)
- Exécute d'abord le plan à blanc (dry-run) et s'arrête avant toute opération destructrice de données : une
  table, une colonne, un schéma, une vue ou un type supprimé, un `TRUNCATE`, ou un changement de type de colonne
  susceptible d'entraîner une perte de valeurs (`timestamptz` → `date`, `numeric` → `integer`),
  ou un changement de clé primaire — `(id)` → `(id, locale)` attribue un nouvel identifiant à chaque ligne, de sorte que les
  liens, clés étrangères et identifiants stockés ailleurs ne retrouvent plus leur ligne.
  La commande s'arrête également
  avant la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base de données : aucune ligne
  n'est perdue, mais la base accepte désormais les lignes qu'elle refusait auparavant.
  Une confirmation est demandée sur le terminal (où Ctrl-C ou Ctrl-D répond non) et l'opération est refusée
  dans le cas contraire ; `--allow-destructive` l'applique malgré tout. `--yes` le fait également dans
  cette version, avec un avertissement de dépréciation ; à partir de la prochaine version, il n'approuvera
  que les pushs qui ne détruisent rien. Un push qui
  s'arrête à ce stade supprime sa base temporaire `<db>_dev_diff` en quittant
- Active la sécurité au niveau des lignes pour chaque table déclarée, jonctions incluses, juste après la
  modification du schéma et avant toute étape susceptible d'échouer, de sorte qu'un push interrompu en cours de route laisse une nouvelle table
  en refusant toute requête plutôt qu'en y étant ouverte
- Applique les politiques RLS issues de la compilation du `rls` de vos tables, et **supprime les politiques qu'un push antérieur a rendues obsolètes**
- Conserve chaque
  contrainte CHECK et EXCLUDE sur une table déclarée telle quelle. Une table
  ne pouvant déclarer ni l'une ni l'autre, il s'agit de règles propres à la base de données, rédigées manuellement
  ou héritées d'une base de données adoptée via `schema introspect` ; pour en supprimer une, supprimez-la
  manuellement (`ALTER TABLE … DROP CONSTRAINT …`). Les déclencheurs (triggers) et les fonctions que vous avez écrits
  ne sont pas modifiés non plus
- Fait correspondre
  exactement le nom de tout ce qu'elle laisse intact, y compris s'il contient
  un `.`, `[`, `]` ou `*`
- Crée tout
  [index de clé étrangère déduit par Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  manquant sur une table existante **avant** la planification, avec
  `CREATE INDEX CONCURRENTLY`, afin que les écritures sur la table continuent pendant la construction ;
  Atlas le trouve ensuite en place. `--dry-run` les liste sans rien construire
- Estampille les
  politiques qu'elle applique de la même manière que le démarrage du serveur, afin que le premier démarrage après un
  push ne les recrée pas inutilement
- `--dry-run`
  liste les modifications de sécurité au niveau des lignes que le push apporterait, sous « Planned
  row-level security changes » : les tables pour lesquelles RLS est activé, et chaque
  politique créée, remplacée ou supprimée, calculée selon la logique propre aux
  étapes du push. La mention « No changes » n'apparaît que si ni le schéma ni la
  sécurité au niveau des lignes ne changent. Lorsqu'une estampille de politique ne correspond pas à sa
  règle, ou qu'elle n'en a pas (créée par `db migrate` ou écrite à la main), l'exécution
  à blanc la recrée à partir de sa règle sous un autre nom, dans une transaction qu'elle
  annule (rollback), et compare ce que Postgres a stocké : un résultat identique ne donne
  aucun changement. Ainsi, une règle lue par `schema introspect` sous forme de SQL ne planifie rien, et
  les politiques appliquées par `db migrate` non plus. Seule une politique qu'elle n'a pas pu comparer (le
  verrou de sa table n'ayant pas été accordé en deux secondes, par exemple) est listée à part. Le push
  lui-même affiche une ligne résumant le nombre de modifications
- Affiche une fois
  chaque instruction qu'Atlas applique. Atlas se connecte sans SSL à une base de données sur cette
  machine (`localhost`, `127.x`, `::1`) dont l'URL ne spécifie aucun `sslmode`, comme le fait
  l'application, au lieu d'échouer sur `SSL is not enabled on the server` ; une URL qui
  spécifie `sslmode`, ou un autre hôte, est transmise telle quelle. Une exécution d'Atlas
  qui échoue avant la planification ne laisse aucune base `<db>_dev_diff` résiduelle
- `--dry-run`
  n'écrit aucun fichier du projet : `src/schema.generated.ts` reste intact,
  et les copies `drizzle/*.sql` commitées par une version antérieure sont listées mais non
  supprimées. Seule l'entrée du plan est écrite dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Temps d'exécution.** La quasi-totalité d'un push est consacrée au calcul du plan par Atlas : il
construit le schéma cible dans une base temporaire et calcule le diff par rapport à la base
réelle, et ce coût augmente plus vite que le nombre de tables — sur un ordinateur portable au repos,
environ 0,25 s par plan pour 11 tables, 0,9 s pour 111 et 5,5 s pour 411. Un push qui
ne modifie rien planifie une seule fois ; un push qui apporte des modifications planifie deux fois (l'exécution à blanc
que lit le garde-fou des modifications destructives, puis l'application). Ainsi, un push sur un schéma de
400 tables ou plus prend plusieurs dizaines de secondes, et davantage sur une machine lente ou occupée.
Ce temps est imputable à Atlas, et non à votre base de données : les étapes annexes — génération du
SQL, verrou RLS, recherche, déclencheurs, politiques, rôle — prennent quelques secondes pour
cette taille, sur une seule connexion à votre base de données.

**Les fichiers générés en cours de route**, tous situés sous `.rebase/sql/` dans le répertoire
backend. `db push` et `db generate` écrivent l'ensemble de ces cinq fichiers à partir de vos tables
à chaque exécution, avant d'en lire un quelconque, de sorte qu'une copie commitée ne serait lue par
rien. Le répertoire possède son propre `.gitignore` et n'est jamais commité.

| Fichier | Contenu |
|---------|---------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état souhaité pour Atlas, et le seul sur lequel il effectue un diff |
| `policies.sql` | Les politiques RLS issues de la compilation du `rls` de vos tables |
| `search.sql` | Les fonctions de recherche en texte intégral et colonnes générées, pour les tables avec un bloc `search` |
| `vector.sql` | Extensions pgvector et index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les déclencheurs `BEFORE UPDATE` sous-jacents à `.onUpdateNow()` |

Atlas ne gère que le premier fichier et rien d'autre ; `db push` et le schéma au
démarrage appliquent donc les quatre autres eux-mêmes. Un déploiement **basé uniquement sur les migrations** — qui
exécute `db migrate` et jamais `db push` — doit intégrer manuellement ces quatre éléments dans une
migration ; `db generate` vous en avertit lorsqu'un changement est invisible pour Atlas.

Un projet ayant commité ces fichiers dans `drizzle/` sous une version antérieure voit
ces copies supprimées dès sa première exécution, et la commande nomme chacun d'eux afin que vous puissiez
commiter la suppression. Elle ne supprime que les fichiers commençant par l'en-tête
du générateur. Un fichier que vous avez écrit vous-même est conservé, tout comme `drizzle/migrations/`.

:::note[La modification d'une règle de sécurité renomme sa politique]
Une règle sans `name` explicite compile en `<table>_<op>_<hash>`, où le hachage couvre la sémantique de la règle — ainsi, *modifier* une règle (plutôt qu'en ajouter une) produit une politique sous un nouveau nom et laisse subsister l'ancienne.

Auparavant, cela avait un impact majeur : Postgres combine les politiques `PERMISSIVE` avec un OU logique (OR), de sorte qu'un `USING (rebase.uid() IS NOT NULL)` devenu obsolète continuait d'accorder tous les accès, quelle que soit la rigueur de la politique de remplacement. Renforcer une règle n'avait aucun effet, et push indiquait un succès.

`db push` réconcilie désormais cela : il supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans les supprimer — les politiques dotées d'un nom personnalisé que vos tables ne décrivent pas, car elles sont indiscernables d'instructions SQL écrites intentionnellement.

Pour auditer une base de données sur laquelle un push a été effectué avant l'introduction de ce comportement, exécutez `rebase doctor --policies`. Cela fonctionne comme un garde-fou de CI : la commande se termine avec un code de sortie non nul en cas de dérive (drift), ainsi que lorsqu'elle n'a pas pu exécuter la vérification — absence de `DATABASE_URL`, chemin `--schema-dir` introuvable, lecture de `pg_policies` non accordée au rôle de CI. Une vérification qui n'a pas pu avoir lieu n'est pas considérée comme réussie.

`doctor` et `db push` distinguent les deux types d'orphelines. Une politique avec un nom généré a été supplantée, et le prochain push la supprimera. Tout autre nom a été écrit manuellement ou par un autre outil et reste en vigueur : décrivez-le dans le `rls` de sa table pour le conserver (la vue RLS de Studio l'importe), ou supprimez-le manuellement s'il est obsolète.
:::

:::caution
`db push` modifie directement la base de données. Utilisez-le uniquement en développement. Pour la production, utilisez `db generate` + `db migrate` pour créer des fichiers de migration examinables.
:::

### `rebase db generate`

Générez des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle à l'état produit par les migrations dans `drizzle/migrations/`, et non à votre base de données
- Produit des fichiers de migration SQL horodatés dans `backend/drizzle/migrations/`
- Les fichiers peuvent être examinés, modifiés et commités dans le gestionnaire de versions
- Liste chaque
  instruction de la nouvelle migration qui détruit des données, en utilisant la même vérification que celle exécutée par `db push`
  avant application : suppression d'une table, colonne, schéma, vue ou type, un
  `TRUNCATE`, changement de type de colonne avec perte de valeurs possible, modification de clé
  primaire, ou suppression d'une contrainte CHECK ou EXCLUDE présente dans la base. Le
  fichier est tout de même écrit et la commande renvoie 0 : il s'agit d'un avertissement sans refus.
- Se termine par les étapes
  suivantes : `rebase db migrate`, et pour la première migration d'un projet, le
  `--baseline <version>` requis pour une base de données déjà configurée par un démarrage. Une
  migration ultérieure n'obtient aucune ligne de baseline, car baseliner une migration destructive
  ignorerait son `DROP`, et une exécution qui n'écrit aucune migration se contente de le mentionner.

**Un CHECK ajouté par l'une de vos migrations est supprimé par la suivante.** `db generate`
compare vos fichiers de migration et non la base de données, et Atlas n'a aucun moyen d'exclure un
objet de ce diff. Par conséquent, une contrainte CHECK ou EXCLUDE que vous avez rédigée à la
main dans une migration, et qu'aucune table ne peut déclarer, réapparaît sous la forme
`ALTER TABLE … DROP CONSTRAINT …` dans la migration suivante qu'il écrit, regroupée dans
la même instruction que la modification réelle. Le rapport ci-dessus signale cette suppression lorsque
la base de données contient déjà la contrainte ; il ne la retire pas du
fichier. Supprimez la clause avant `rebase db migrate`, ou laissez
`rebase db migrate --refuse-destructive` s'interrompre dessus. `db push` lit la
base de données et conserve la contrainte.

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Exécutez toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit `drizzle/migrations/` pour trouver les migrations non appliquées
- Les applique dans l'ordre à la base de données
- Suit les migrations ayant été appliquées
- Estampille les
  politiques de sécurité au niveau des lignes de la même manière que `db push` et le démarrage du serveur, afin
  que le premier démarrage après un migrate ne les recrée pas inutilement.
  Une migration ayant été écrite d'après les tables de son époque, une politique n'est
  estampillée que lorsqu'elle correspond exactement à ce que sa règle produit aujourd'hui : migrate la recrée
  à partir de sa règle sous un autre nom, dans une transaction qu'elle annule (rollback), et
  compare ce que Postgres a stocké, comme le fait `db push --dry-run`. Une politique qui
  diffère ne reçoit aucune estampille, et le démarrage suivant réapplique sa table

`--refuse-destructive`
entraîne un refus à la place. L'option effectue d'abord une simulation à blanc des migrations en attente. Si une
instruction détruit des données, selon la même vérification que celle employée par `db push` et `db generate`, elle
liste ces instructions et quitte avec le code 1. Elle n'applique rien, pas même les fichiers
situés avant cette instruction. Sans ce flag, `db migrate` se comporte comme d'habitude et
applique chaque fichier en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration qui reconstruit une colonne de recherche commence par la supprimer ; ce flag refusera
donc également cette migration. Lisez la liste affichée, puis exécutez `rebase db migrate`
sans le flag pour l'appliquer.

#### Définition d'une baseline pour une base de données déjà démarrée par Rebase

Chaque démarrage de Rebase s'assure du schéma, et `rebase db push` l'applique directement. Ainsi, une base de données ayant déjà exécuté l'un ou l'autre possède déjà les tables et types que la première migration créerait, et `rebase db migrate` s'arrête sur `pq: type "posts_status" already exists (42710)`.

La migration n'a aucun problème — la base de données a été provisionnée d'une autre manière. Enregistrez son état actuel, puis effectuez la migration normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version correspond au préfixe numérique du fichier de migration qui décrit ce qui se trouve *actuellement* dans la base de données. Cette migration ainsi que toutes celles qui la précèdent sont enregistrées comme appliquées ; tout ce qui suit sera exécuté. Sur une base de données contre laquelle aucun démarrage n'a jamais eu lieu, aucune baseline n'est nécessaire — effectuez la migration directement.

La même chose se produit plus tard dans le cycle classique : modifiez une table pendant que `rebase dev` tourne, et le démarrage ajoutera la colonne avant que `rebase db generate` n'écrive la migration qui l'ajoute, de sorte que `rebase db migrate` s'arrête sur `column … already exists (42701)`. Définissez la baseline pour cette migration de la même manière. `--baseline` fonctionne sur une base de données enregistrant déjà des migrations : elle marque tout jusqu'à cette version comme appliqué avec `atlas migrate set`, et l'indique, ou signale qu'il n'y a rien à enregistrer lorsque l'historique l'atteint déjà. Une version qu'aucun fichier dans `drizzle/migrations` ne possède est refusée avant toute exécution, en mentionnant les versions existantes.

### `rebase db branch`

Branching de base de données pour le développement parallèle :

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (et `switch --off`) ainsi que `rebase db branch prune`
sont nouveaux. `create`, `list`, `info` et `delete` sont apparus dans la version 0.17.

Chaque branche est une copie complète de la base de données créée avec `CREATE DATABASE ... TEMPLATE` ;
elle nécessite donc un véritable serveur PostgreSQL et occupe le même espace disque que sa source.

### `rebase doctor`

Détectez les dérives tripartites entre vos tables, le schéma Drizzle généré et la base de données PostgreSQL en direct :

```bash
rebase doctor
```

**Ce qu'elle vérifie :**
- Tables ↔ Schéma généré — sont-ils synchronisés ?
- Schéma généré ↔ Base de données — y a-t-il des modifications non appliquées ?
- Tables ↔ Base de données — y a-t-il une dérive inattendue ?

Exécutez `doctor` dès que quelque chose semble désynchronisé. La commande indique précisément où se situe le décalage.

La comparaison de la base de données inclut celle effectuée par le démarrage avant de signaler que `schema.generated.ts` et la base de données ne concordent pas, en exécutant le même code. Ainsi, chaque différence signalée par le démarrage figure également dans le rapport, dans les mêmes termes : une colonne NOT NULL d'un côté et nullable de l'autre, et une colonne toujours présente dans la base de données mais absente du fichier (le démarrage ne supprimant jamais rien, une propriété renommée laisse subsister son ancienne colonne). Chacune constitue un avertissement, et la solution préconise `rebase db push`.

La comparaison lit la base de données du projet, résolue de la même façon que `rebase db url` le fait — sur un projet fraîchement initialisé (scaffold), il s'agit de la base gérée, que `doctor` démarre. Lorsqu'aucune base ne peut être résolue, cette phase est signalée comme **ignorée** plutôt que réussie, et l'exécution ne se termine jamais par « All schemas are in sync » — une vérification qui n'a pas pu être effectuée n'équivaut pas à une validation.

Elle signale également chaque table dépourvue de [bloc `search`](/docs/backend/search) contenant plus d'environ 10 000 lignes. Une recherche sur celle-ci — le champ de recherche de l'administration, `.search()`, `?searchString=` — se traduit par un `ILIKE '%term%'` sur les colonnes de texte, qu'aucun index ne peut optimiser, de sorte que chacune parcourt l'intégralité de la table, et son décompte la parcourt à nouveau (environ un tiers de seconde pour 100 000 lignes, croissant avec la taille de la table). Le nombre de lignes provient de l'estimation interne de Postgres, de sorte que la vérification ne scanne rien. Il s'agit d'une indication : elle ne modifie pas le code de sortie, et rien n'est indexé automatiquement.

Elle signale une **jonction orpheline** : une table `public` ayant la forme d'une jonction many-to-many qu'aucune table ne déclare. Cette structure est composée de deux colonnes formant ensemble la clé primaire, chacune étant une clé étrangère vers une table déclarée. Renommer ou supprimer un `manyToMany` laisse subsister son ancienne table de jonction, car push et boot ne font que créer des tables, et chaque ligne d'association s'y trouve encore. Cette remarque est purement informative et ne modifie pas le code de sortie. Sa résolution passe par l'instruction `DROP TABLE`, que `doctor` affiche mais n'exécute jamais.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générez un SDK typé à partir de vos tables :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`, via le chargeur à partir duquel le backend démarre, de sorte que le SDK décrive exactement les tables servies ; un schéma qui ne compile pas l'interrompt
- Génère les types TypeScript pour chaque table dans `generated/sdk/`
- Produit un fichier `database.types.ts` destiné à être utilisé avec `createRebaseClient<Database>()` : le type `Database`, `TableName` (l'union de tous les slugs), et `tablesDictionary` / `TablesDictionary`, la correspondance entre accesseur et slug

`rebase dev` l'exécute pour vous au démarrage et à chaque enregistrement sous
`backend/schema/`. Exécutez-la vous-même en CI, dans un dépôt qui ne possède pas ses
propres tables (voir `--from` ci-dessous), ou partout où `rebase dev` ne tourne pas.

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`, ou la clé `tables` dans `rebase.json`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lit le schéma depuis un projet en cours d'exécution au lieu de la source locale. `link` utilise le projet lié à cet environnement. |
| `--token` | Jeton porteur (Bearer token) pour le point de terminaison de contrat (par défaut : `$REBASE_SERVICE_KEY` depuis le shell ; `.env` n'est pas lu) |
| `--register` | Type également les données côté serveur : écrit les types et une déclaration `Register` dans `backend/generated/`, et l'enregistre dans `rebase.json` — voir [Données typées côté serveur](/docs/backend/typed-server-data/) |

`--from` permet à un dépôt ne contenant aucune table — un frontend séparé,
une deuxième application web, une application mobile — de générer un client typé à partir du
projet avec lequel il communique : il lit les `tables` depuis `/api/meta/contract`
du backend en cours d'exécution. `REBASE_SERVICE_KEY` n'est envoyée qu'au projet auquel
cet environnement est lié ; passez `--token` explicitement pour tout autre hôte. La clé dans
`.env` appartient à votre backend local et n'est jamais envoyée.
Un refus précise la situation rencontrée : un `--token` refusé, une clé de shell refusée, une clé
retenue pour un hôte non lié, une clé présente uniquement dans `.env`, ou aucune clé.

**Utilisation après génération :**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Les noms de champs dans les types générés correspondent à ceux fournis par l'API. Le nom d'un champ sur le
réseau (wire name) est la clé de sa colonne, et l'API adopte le camelCase partout : l'introspection
écrit une colonne `created_at` sous la forme `createdAt: col.timestamp({ withTimezone: true })`, dont le nom SQL
est le snake_case de la clé, et la sert sous la forme `row.createdAt`. La colonne
elle-même n'est pas modifiée. L'*accesseur* de table est converti en nom de propriété de
la même façon (`my-notes` → `client.data.myNotes`), ce que `tablesDictionary`
fait correspondre au slug.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`rebase migrate collections-to-tables [dir]` déplace `config/collections` vers
`backend/schema` (un `defineTable` par collection, chaque colonne explicite à sa position d'origine,
selon la syntaxe Drizzle, et `index.ts` avec `defaultRls`) et `frontend/src/cms` (un `customizeTable`
par collection personnalisée, les fichiers `defineFirestoreCollection`, `ui-config.json`), écrit
`backend/resources.ts`, `backend/storage.ts` et `backend/generated/register.ts`,
ajoute `rebaseBackendGuard()` au `vite.config.ts` d'un projet généré, puis exécute
`rebase migrate sdk-calls`, qui réécrit `.collection(` en `.table(`, applique les
autres renommages du SDK ainsi que les sources de règles `existsIn` / `membership` dans votre code,
et déplace les imports des éléments que la version 0.31 a transférés vers un autre paquet
([la liste](/docs/upgrading/0-30-to-0-31-imports/)), en ajoutant le paquet aux dépendances du code
importateur (« Dependencies added » : exécutez `pnpm install`). Mettez à niveau chaque paquet `@rebasepro` vers la version 0.31 avant de l'exécuter.
Chaque exécution relit le résultat : le SQL généré — DDL, politiques, recherche,
vector, déclencheurs, vues, schéma Drizzle — doit être identique à l'octet près, sinon chaque
fichier est restauré. Ce qu'elle ne peut pas migrer est refusé avec l'indication du fichier et de la ligne, et
ce qu'elle vous laisse à faire est affiché sous forme d'étapes manuelles numérotées, se terminant par
`rebase skills install` lorsque le projet contient des compétences d'agent (agent skills). Vos propres modules dans
`config/` sont conservés ; l'exécution affiche la commande `git rm` pour ce qui a été remplacé. Elle
prend également en compte les collections Firestore construites par une fonction, les alias de chemins, un panneau monté
en dehors de `App.tsx` et toute application statique non protégée ([la liste complète](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Après le `git rm`, `--check` signale `already-migrated`.

| Option | Effet |
|---|---|
| `--dry-run` | Affiche les fichiers, refus, notes et étapes manuelles ; n'écrit rien. Commencez par là. |
| `--check` | Sur un projet migré : prouve que `backend/schema` produit toujours le même SQL. Quitte avec le code 1 et le diff, ou tant qu'une règle change de signification. |
| `--accept-rule-changes` | Avec `--check` : confirme que les règles sous « Review before deploying » ont été examinées. |
| `--json` / `--force` / `--skip-sdk-calls` | Le rapport au format JSON (avec `ruleChanges`) ; exécuter sur un arbre de travail modifié ou par-dessus une sortie éditée ; laisse votre code intact. |

Consultez deux listes dans la sortie du SDK : **« Rewritten by name — review »** (récepteurs
non typés, emplacements de données, doublures de test) et **« Left unchanged — check each »**
(renommez ceux qui appartiennent au SDK ; [une recherche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) trouve le reste).

La vérification SQL garantit la fidélité de la conversion, mais pas qu'une règle conserve son
sens d'origine. La dernière section de la sortie, **« Review before deploying: these rules change meaning »**,
liste chaque règle dont la politique accorde désormais des droits différents
— un simple `access: "authenticated"` n'accordait rien et autorise désormais tout appelant
connecté ([les quatre cas](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Vérifiez ensuite par rapport à votre base de données : `rebase db push --dry-run` doit afficher « No
changes: the database already matches these tables. », et
`rebase doctor --policies` aucune dérive.

## Flux de travail en développement

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le flux de travail à itération rapide pour le développement :

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flux de travail en production

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le flux de travail sécurisé et vérifiable pour la production :

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|----------|----------|
| `Could not detect an active database plugin` | Installer `@rebasepro/server-postgres` dans `backend/package.json` |
| Schéma non mis à jour | Vérifier que le chemin `--schema-dir` (ou la clé `tables` dans `rebase.json`) pointe vers le bon répertoire |
| La migration affiche des modifications inattendues | Exécuter `rebase doctor` pour identifier la dérive |
| Échec de `db push` en production | Utiliser `db generate` + `db migrate` à la place |
| Une migration ne doit pas supprimer de données en CI ou en production | `rebase db migrate --refuse-destructive` quitte avec le code 1 et n'applique rien lorsqu'une instruction en attente détruit des données |
| Échec de `db migrate` avec `already exists (42710)` | Le démarrage ou `db push` a déjà provisionné le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |
| Échec de `db migrate` avec `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — baselinez cette migration de la même façon |
| `db push` sur la base de données gérée échoue avec `Error: EOF` | Atlas a perdu une connexion détenue par l'instance active de `rebase dev`. Réexécutez la commande ; si l'erreur persiste, arrêtez d'abord `rebase dev` |

## Prochaines étapes

- **[Tables](/docs/schema/)** — Définissez votre modèle de données
- **[Référence de la CLI](/docs/cli)** — Toutes les commandes de la CLI
- **[SDK typé](/docs/sdk)** — Utilisez le SDK généré
