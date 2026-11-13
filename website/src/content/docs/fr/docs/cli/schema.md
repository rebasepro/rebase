---
sourceHash: 98d9c2872375ef18
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des tables dans backend/schema, créez des migrations SQL, introspectez une base de données existante dans des fichiers defineTable et maintenez votre base de données synchronisée avec la CLI Rebase.
---

## Aperçu

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

Les tables exportées par `backend/schema/index.ts` décrivent les colonnes, les types, les relations,
les énumérations et la sécurité au niveau des lignes (RLS). Chaque commande ci-dessous les lit via le chargeur
utilisé lors du démarrage du backend. Ainsi, un schéma qui ne compile pas — une table sans
`rls`, `"inherit"` sans `defaultRls`, un `defineTable` non exporté par
l'index — interrompt la commande avec une erreur `SchemaDefinitionError` indiquant chaque problème,
et rien n'est écrit. La commande `schema generate` génère un fichier de schéma
Drizzle ORM à partir de celles-ci.

Toute commande lisant le schéma accepte `--schema-dir <dir>` pour les projets
qui conservent leurs tables ailleurs ; la valeur par défaut est `backend/schema`, ou la
clé `tables` de l'application backend dans `rebase.json`. `--collections` / `-c`, l'indicateur
antérieur à la version 0.31, est rejeté avec un message indiquant le codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), tout comme un
projet contenant encore `config/collections`.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` effectue un diff par rapport aux migrations déjà présentes dans `backend/drizzle/migrations/`, rejouées sur une base de données temporaire, et produit des fichiers de migration SQL horodatés. Il ne lit jamais votre base de données : une colonne déjà ajoutée au démarrage ou via `db push` apparaîtra toujours sous la forme `ADD COLUMN`.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente à votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générer un fichier de schéma Drizzle ORM à partir de vos tables :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les énumérations et les relations

**Options :**

| Option | Description |
|------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--watch, -w` | Surveiller les modifications et régénérer automatiquement |

Le **mode surveillance (watch)** est utile pendant le développement — modifiez un fichier de table et le schéma se régénère instantanément :

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Vérifier si le schéma généré correspond toujours aux tables :

```bash
rebase schema stale          # génère un rapport, et quitte avec le code 1 si des éléments sont obsolètes
rebase schema stale --fix    # régénère le fichier à la place
```

**Ce qu'elle fait :**
- Rend ce que les tables dans `backend/schema/` génèrent et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Énumère chaque différence — une table manquante, une colonne dont le type a changé, une valeur d'énumération supprimée, ou des clés étrangères nommées comme les dérivait une version antérieure — et quitte avec un code non nul
- Avec `--fix`, régénère le fichier au lieu de générer un rapport

`rebase dev` maintient le fichier à jour automatiquement ; cette commande est donc le contrôle idéal pour un build
ou une étape de CI. Elle accepte `--schema-dir` et `--output` de la même façon que `rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Assouplir et supprimer ce que le démarrage n'appliquera pas, après avoir examiné le plan :

```bash
rebase schema reconcile                         # assouplit NOT NULL sur les colonnes devenues nullables ou supprimées
rebase schema reconcile --drop voice_cache.wav  # et supprime une colonne qu'aucune table ne déclare
```

**Ce qu'elle fait :**
- Demande au backend en cours d'exécution d'établir un plan par rapport à sa propre base de données. C'est la base vers laquelle pointent le fichier `.env` du backend et la liaison cloud ; cela fonctionne donc sur Rebase Cloud, où rien d'autre ne peut atteindre la base de données.
- Prévoit un `DROP NOT NULL` pour chaque colonne déclarée nullable par une table mais toujours requise par la base de données.
- Liste chaque colonne qu'aucune table ne déclare. Une colonne `NOT NULL` sans valeur par défaut bloquant chaque insertion, elle est également assouplie et ses données sont conservées. Seules les colonnes nommées avec `--drop <table>.<column>` sont supprimées, en affichant le nombre de lignes contenant une valeur pour chacune.
- Applique les changements une fois que vous tapez `yes`. Le serveur exécute le plan uniquement sur l'empreinte (digest) de celui que vous avez examiné. Ainsi, si la base de données ou les tables ont été modifiées entre-temps, il refuse et vous devez examiner à nouveau. `--yes` permet d'ignorer la confirmation.

Le démarrage se contente uniquement d'ajouter des éléments : après la suppression d'une colonne de son `defineTable`, celle-ci reste dans la base de données avec ses données. Une colonne `NOT NULL` sans valeur par défaut fait alors échouer chaque insertion, et les journaux de démarrage mentionnent cette commande pour y remédier : sans `--drop` pour conserver les données, avec `--drop` pour supprimer la colonne. Déployez d'abord la modification de la table, car la réconciliation s'effectue par rapport à ce que le backend exécute. Elle nécessite `REBASE_SERVICE_KEY` dans le fichier `.env`. En local, `rebase db push` couvre la même chose via sa barrière de sécurité pour modifications destructives.

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générer des fichiers `defineTable` à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à la base de données du projet, celle affichée par `rebase db url` (la base gérée est démarrée s'il s'agit de celle-ci) ; `--database-url` en désigne une autre, et `--docker` utilise celle de Compose
- Lit chaque table, colonne, type, clé étrangère et politique, puis écrit
  `backend/schema/<table>.ts` — un `defineTable` par table — ainsi que le fichier
  `backend/schema/index.ts` qui les exporte (fusionné dans l'index s'il existe déjà)
- Déclare chaque colonne avec son type Postgres : `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, une énumération avec ses valeurs et son vrai nom de type
  (un `pgEnum` lorsque le type est partagé), un tableau sous la forme `<item>.array()`,
  `col.vector({ dimensions })`, les clés d'identité et de série, les valeurs par défaut — avec la syntaxe
  exacte de Drizzle. Un type qu'aucun constructeur ne gère devient
  `col.custom({ dataType: "<sql type>" })`, que Rebase transmet tel que le
  driver le renvoie ; `db generate` et `db push` le refuseront jusqu'à ce que le planificateur
  puisse le traiter
- Déclare la colonne de clé étrangère, le `belongsTo` associé et le
  `hasMany` réciproque sur la cible ; une table de jonction devient un `manyToMany`, ses propres
  colonnes formant le `pivot`
- Lit les politiques de sécurité au niveau des lignes (RLS) de chaque table dans sa configuration `rls` : nom,
  commande, mode, liste `TO`, clauses `USING` et `WITH CHECK`. Les politiques
  `<table>_default_*` ajoutées par Rebase lui-même sont exclues, afin que le `db push` qui suit
  recrée chaque politique à l'identique. Une table dont la sécurité au niveau des lignes est activée sans politique est
  écrite avec `rls: "admin-only"`
- Lit chaque expression (le `USING` d'une politique, un CHECK, une valeur par défaut de colonne) sous
  le `search_path` utilisé par le serveur, à savoir `public`, de sorte qu'une fonction dans le schéma `rebase`
  est écrite `rebase.roles()`
- Transforme un CHECK qu'il peut interpréter (`total >= 0`) en méthode `.validate()` sur la colonne, et
  conserve la contrainte elle-même dans la base de données, où le push suivant la maintiendra
- Place ce qu'il n'a pas pu déterminer avec certitude dans un commentaire en haut du fichier
  de la table et dans le terminal — un ensemble restreint de chaînes sur une colonne texte, une
  colonne générée dont l'expression n'a pas pu être lue, un type personnalisé — accompagné de ce
  qu'un push lui ferait subir
- Avec `--data-inference`, échantillonne jusqu'à 100 lignes par table et écrit ce qui
  relève de la présentation — titres, icônes, tableaux (boards), tris, options de champ — dans
  `frontend/src/cms/<table>.tsx` sous forme d'un `customizeTable`, lorsque le frontend du
  projet dépend de `@rebasepro/cms`. Un projet headless n'en reçoit aucun
- Face à une base de données qui ne fonctionne pas, affiche une unique fois la même bannière
  que `db push` et ne crée rien. Affiche le répertoire de sortie sous forme de chemin absolu

**Options :**

| Option | Description |
|------|-------------|
| `--schema-dir` | Où écrire les fichiers de tables (par défaut : `backend/schema`). `--output` a été supprimé |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écraser les fichiers de table existants ; sans cette option, un fichier existant est ignoré |
| `--database-url` | Lire cette base de données au lieu de celle du projet |
| `--docker` | Lire la base de données Compose, en la démarrant si nécessaire |
| `--data-inference` / `--no-data-inference` | Échantillonner jusqu'à 100 lignes par table pour détecter formats, contraintes et réglages de panneau, ou lire uniquement la structure. Sans l'une de ces options, la commande pose la question, et en l'absence de terminal, elle lit uniquement la structure |

Ceci est utile lors de l'adoption de Rebase sur une base de données existante — effectuez d'abord une introspection,
puis modifiez les tables générées. Une table dont la sécurité au niveau des lignes est désactivée est
écrite comme les autres, avec son `rls` ; le push activera le RLS, et l'exécution à blanc (dry run) le signalera. Un backend qui s'exécute sans aucun `backend/schema` sert
directement la base de données à la place — voir [Backend only](/docs/getting-started/headless/).

### `rebase db push`

Pousser les modifications de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les modifications directement à la base de données (CREATE, ALTER, DROP)
- Effectue d'abord une simulation du plan (dry run) et s'arrête avant toute opération destructive de données :
  suppression d'une table, d'une colonne, d'un schéma, d'une vue ou d'un type, un `TRUNCATE`, ou un changement
  de type de colonne pouvant entraîner une perte de données (`timestamptz` → `date`, `numeric` → `integer`),
  ou une modification de clé primaire — `(id)` → `(id, locale)` attribue un nouvel identifiant à chaque ligne,
  ce qui empêche les liens, clés étrangères et identifiants stockés ailleurs de retrouver leur ligne.
  Elle s'arrête également
  avant la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base de données : aucune ligne
  n'est perdue, mais la base acceptera désormais les lignes qu'elle rejetait auparavant.
  Elle demande confirmation dans un terminal, où Ctrl-C ou Ctrl-D équivaut à un refus, et rejette l'opération
  dans le cas contraire ; `--allow-destructive` force l'application dans tous les cas. `--yes` le permet également
  dans cette version, avec un avertissement de dépréciation ; à partir de la prochaine version, elle n'approuvera
  que les pushes sans destruction. Un push qui
  s'interrompt à cette étape supprime sa base de données temporaire `<db>_dev_diff` avant de quitter
- Active la sécurité au niveau des lignes pour chaque table déclarée, y compris les tables de jonction, immédiatement après
  la modification du schéma et avant toute étape susceptible d'échouer, garantissant qu'un push interrompu en cours de route laisse une nouvelle table
  en rejetant toute requête plutôt qu'en la laissant ouverte
- Applique les politiques RLS résultant de la compilation du champ `rls` de vos tables, et **supprime les politiques rendues obsolètes par un push antérieur**
- Conserve telle quelle chaque
  contrainte CHECK et EXCLUDE sur une table déclarée. Une table
  ne pouvant déclarer ni l'une ni l'autre, il s'agit de règles propres à la base de données, écrites manuellement
  ou issues d'une base adoptée via `schema introspect` ; pour en supprimer une, retirez-la
  manuellement (`ALTER TABLE … DROP CONSTRAINT …`). Les triggers et fonctions que vous avez écrits
  ne sont pas modifiés non plus
- Fait correspondre
  exactement le nom de chaque élément qu'elle conserve intact, y compris s'il contient un `.`, `[`, `]` ou `*`
- Construit tout
  [index de clé étrangère déduit par Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  manquant sur une table existante **avant** la planification, avec
  `CREATE INDEX CONCURRENTLY`, afin que les écritures sur la table continuent pendant la construction ;
  Atlas le trouve ensuite en place. `--dry-run` les énumère sans rien construire
- Applique aux
  politiques qu'elle déploie une empreinte identique à celle générée lors du démarrage du serveur, évitant ainsi que le premier démarrage après un
  push ne les recrée inutilement
- `--dry-run`
  liste les modifications de sécurité au niveau des lignes que le push effectuerait, sous la section « Planned
  row-level security changes » : les tables pour lesquelles le RLS est activé, et chaque
  politique créée, remplacée ou supprimée, déterminée selon les étapes propres au push. Le message « No changes »
  n'apparaît que si ni le schéma ni
  la sécurité au niveau des lignes ne changent. Lorsqu'une empreinte de politique ne correspond pas à sa
  règle, ou qu'elle n'en a pas (créée par `db migrate` ou écrite à la main), le dry
  run la recrée à partir de sa règle sous un autre nom, dans une transaction annulée
  par rollback, et compare ce que Postgres a stocké : un résultat identique est considéré comme
  aucun changement. Ainsi, une règle relue sous forme de SQL par `schema introspect` ne planifie rien,
  tout comme les politiques appliquées par `db migrate`. Seules celles impossibles à comparer (verrou
  de table non obtenu dans les deux secondes, par exemple) sont listées à part. Le push
  lui-même affiche une ligne résumant le décompte des modifications
- Affiche chaque
  instruction appliquée par Atlas une seule fois. Atlas se connecte sans SSL à une base de données située sur cette
  machine (`localhost`, `127.x`, `::1`) dont l'URL ne spécifie aucun `sslmode`, tout comme l'application,
  au lieu d'échouer sur `SSL is not enabled on the server` ; une URL spécifiant
  `sslmode`, ou un autre hôte, est transmise telle quelle. Une exécution d'Atlas
  qui échoue avant la planification ne laisse aucune base `<db>_dev_diff` résiduelle
- `--dry-run`
  n'écrit rien dans le projet : `src/schema.generated.ts` reste inchangé,
  et les copies `drizzle/*.sql` commitées par une ancienne version sont signalées, non
  supprimées. Seule l'entrée du plan est écrite dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Temps d'exécution.** La quasi-totalité d'un push correspond au calcul du plan par Atlas : il
construit votre schéma cible dans une base de données temporaire et calcule la différence avec la base
réelle, et ce coût augmente plus vite que le nombre de tables — sur un ordinateur portable au repos,
environ 0,25 s par plan pour 11 tables, 0,9 s pour 111 et 5,5 s pour 411. Un push sans
modification planifie une seule fois ; un push comportant des modifications planifie deux fois (le dry-run
lu par la barrière de modifications destructives, puis l'application). Ainsi, un push sur un schéma de
400 tables ou plus prend plusieurs dizaines de secondes, voire davantage sur une machine chargée ou lente.
Ce temps est imputable à Atlas, pas à votre base de données : les étapes annexes — génération du
SQL, verrou RLS, recherche textuelle, triggers, politiques, rôle — ne prennent que quelques secondes pour
cette taille, sur une seule connexion à votre base.

**Fichiers générés en cours de route**, tous situés sous `.rebase/sql/` dans le répertoire
backend. `db push` et `db generate` écrivent ces cinq fichiers à partir de vos tables à
chaque exécution, avant d'en lire le moindre, de sorte qu'une copie commitée ne serait lue
par rien. Le répertoire contient son propre `.gitignore` et n'est jamais commité.

| Fichier | Contenu |
|------|-------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état souhaité par Atlas, et le seul dont il calcule le diff |
| `policies.sql` | Les politiques RLS issues de la compilation de la configuration `rls` de vos tables |
| `search.sql` | Les fonctions de recherche en texte intégral et colonnes générées, pour les tables avec un bloc `search` |
| `vector.sql` | Extensions pgvector et index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les triggers `BEFORE UPDATE` derrière `.onUpdateNow()` |

Atlas gère le premier et rien d'autre ; `db push` et la validation du schéma
au démarrage appliquent donc les quatre autres d'eux-mêmes. Un déploiement **basé uniquement sur les migrations** — qui
exécute `db migrate` et jamais `db push` — doit intégrer manuellement ces quatre éléments dans
une migration ; `db generate` le signale lorsqu'une modification est invisible pour Atlas.

Un projet ayant commité ces fichiers dans `drizzle/` sous une version antérieure verra
ces copies supprimées lors de sa première exécution, et la commande nommera chacune d'elles afin que vous puissiez
commiter la suppression. Elle supprime uniquement les fichiers qui s'ouvrent avec l'en-tête
du générateur. Un fichier écrit par vos soins est conservé, tout comme `drizzle/migrations/`.

:::note[Modifier une règle de sécurité renomme sa politique]
Une règle dépourvue d'un `name` explicite est compilée en `<table>_<op>_<hash>`, où le hash résume la sémantique de la règle — ainsi, *modifier* une règle (plutôt qu'en ajouter une) produit une politique sous un nouveau nom et laisse subsister l'ancienne.

Auparavant, cela avait un impact majeur : Postgres combine les politiques `PERMISSIVE` avec un opérateur OR, si bien qu'une règle obsolète `USING (rebase.uid() IS NOT NULL)` continuait d'accorder tous les accès, quelle que soit la sévérité de son remplacement. Rendre une règle plus stricte n'avait aucun effet, et le push indiquait pourtant un succès.

`db push` réconcilie désormais cette situation : il supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans les supprimer — les politiques à nom personnalisé que vos tables ne décrivent pas, car elles sont indiscernables de code SQL rédigé manuellement.

Pour auditer une base de données ayant fait l'objet d'un push avant cette amélioration, exécutez `rebase doctor --policies`. Cela fonctionne comme un contrôle de CI : la commande s'interrompt avec un code non nul en cas de dérive, mais également si elle n'a pas pu effectuer la vérification — absence de `DATABASE_URL`, chemin `--schema-dir` introuvable, lecture de `pg_policies` non autorisée pour le rôle de CI. Un contrôle qui n'a pas pu s'exécuter n'est pas considéré comme validé.

`doctor` et `db push` distinguent les deux types d'éléments orphelins. Une politique portant un nom généré a été remplacée, et le prochain push la supprimera. Tout autre nom a été rédigé à la main ou par un autre outil et reste en vigueur : décrivez-la dans le `rls` de sa table pour la conserver (la vue RLS de Studio l'importe), ou supprimez-la manuellement si elle est obsolète.
:::

:::caution
`db push` modifie directement la base de données. Utilisez-le uniquement en développement. Pour la production, utilisez `db generate` + `db migrate` afin de générer des fichiers de migration pouvant être relus.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications du schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle à l'état produit par les migrations dans `drizzle/migrations/`, et non à votre base de données
- Produit des fichiers de migration SQL horodatés dans `backend/drizzle/migrations/`
- Les fichiers peuvent être examinés, modifiés et ajoutés au gestionnaire de versions
- Identifie chaque
  instruction de la nouvelle migration qui détruit des données, en utilisant la même vérification que `db push`
  effectue avant d'appliquer les changements : suppression d'une table, colonne, schéma, vue ou type, un
  `TRUNCATE`, un changement de type de colonne risquant de perdre des valeurs, une modification de
  clé primaire, ou la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base. Elle
  écrit tout de même le fichier et se termine avec le code 0, affichant un avertissement sans interrompre le processus.
- Se termine en indiquant l'étape
  suivante : `rebase db migrate`, et pour la première migration d'un projet, l'option
  `--baseline <version>` requise pour une base de données déjà initialisée par un démarrage. Une
  migration ultérieure n'affiche pas cette ligne de référence (baseline), car une migration destructive initialisée de cette façon
  ignorerait son `DROP` ; une exécution sans nouvelle migration se contente d'en informer l'utilisateur.

**Un CHECK ajouté par l'une de vos migrations est supprimé par la suivante.** `db generate`
calcule la différence entre vos fichiers de migration et non avec la base de données, et Atlas n'a aucun moyen d'exclure un
objet de cette comparaison. Par conséquent, une contrainte CHECK ou EXCLUDE ajoutée manuellement
dans une migration, et qu'aucune table ne peut déclarer, réapparaît sous la forme
`ALTER TABLE … DROP CONSTRAINT …` dans la migration suivante, intégrée dans
la même instruction que la modification réelle. Le rapport ci-dessus signale cette suppression lorsque
la base de données contient déjà la contrainte ; il ne la retire pas du
fichier. Supprimez la clause avant `rebase db migrate`, ou laissez
`rebase db migrate --refuse-destructive` bloquer l'opération. `db push` consulte la
base de données et conserve la contrainte.

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant application.

### `rebase db migrate`

Appliquer toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit `drizzle/migrations/` pour trouver les migrations non appliquées
- Les applique dans l'ordre à la base de données
- Enregistre les migrations déjà appliquées
- Applique une empreinte aux
  politiques de sécurité au niveau des lignes de la même manière que `db push` et le démarrage du serveur, évitant
  ainsi que le premier démarrage après une migration ne les recrée toutes. Une migration ayant été rédigée à partir des tables de son époque, une politique n'est
  marquée d'une empreinte que si elle correspond exactement à ce que sa règle produit aujourd'hui : la commande migrate la recrée
  à partir de sa règle sous un autre nom, dans une transaction annulée
  par rollback, et compare le résultat stocké par Postgres, comme le fait `db push --dry-run`. Une politique
  qui diffère ne reçoit aucune empreinte, et le démarrage suivant réapplique sa table

`--refuse-destructive`
provoque un refus en cas d'opération destructive. La commande simule d'abord les migrations en attente. Si une
instruction détruit des données, d'après les mêmes critères de vérification qu'utilisent `db push` et `db generate`, elle
affiche ces instructions et s'interrompt avec le code 1. Rien n'est appliqué, pas même les fichiers
précédant cette instruction. Sans cet indicateur, `db migrate` se comporte comme auparavant et
applique chaque fichier en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration reconstruisant une colonne de recherche commençant par la supprimer, cette option rejettera
également cette migration. Examinez la liste affichée, puis exécutez `rebase db migrate`
sans l'option pour l'appliquer.

#### Établir une base de référence (baseline) pour une base de données déjà démarrée par Rebase

Chaque démarrage de Rebase valide le schéma, et `rebase db push` l'applique directement. Ainsi, une base de données ayant déjà exécuté l'un ou l'autre contient déjà les tables et types que la première migration créerait, et `rebase db migrate` s'interrompt avec `pq: type "posts_status" already exists (42710)`.

Il n'y a aucun problème avec la migration — la base a simplement été approvisionnée par un autre moyen. Enregistrez son état actuel, puis migrez normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version correspond au préfixe numérique du fichier de migration décrivant l'état *actuel* de la base de données. Cette migration ainsi que toutes les précédentes sont enregistrées comme appliquées ; les suivantes sont exécutées. Sur une base de données avec laquelle aucun démarrage n'a jamais eu lieu, aucune base de référence n'est requise — migrez directement.

La même situation se produit plus tard dans le cycle classique : modifiez une table pendant que `rebase dev` tourne, et le démarrage ajoutera la colonne avant que `rebase db generate` n'écrive la migration l'ajoutant, provoquant l'interruption de `rebase db migrate` avec l'erreur `column … already exists (42701)`. Définissez la référence pour cette migration de la même manière. `--baseline` fonctionne sur une base qui enregistre déjà des migrations : elle marque tout jusqu'à la version spécifiée comme appliqué via `atlas migrate set` et l'indique, ou signale qu'il n'y a rien à enregistrer si l'historique l'atteint déjà. Une version absente des fichiers de `drizzle/migrations` est rejetée avant toute exécution, en mentionnant les versions valides.

### `rebase db branch`

Gestion des branches de base de données pour le développement parallèle :

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (et `switch --off`) ainsi que `rebase db branch prune`
sont nouveaux. Les commandes `create`, `list`, `info` et `delete` sont apparues dans la version 0.17.

Chaque branche est une copie intégrale de la base de données réalisée avec `CREATE DATABASE ... TEMPLATE`.
Elle nécessite par conséquent un vrai serveur PostgreSQL et consomme le même espace disque que sa source.

### `rebase doctor`

Détecter la dérive tripartite entre vos tables, le schéma Drizzle généré et la base de données PostgreSQL active :

```bash
rebase doctor
```

**Ce qu'elle vérifie :**
- Tables ↔ Schéma généré — sont-ils synchronisés ?
- Schéma généré ↔ Base de données — y a-t-il des modifications non appliquées ?
- Tables ↔ Base de données — y a-t-il une dérive inattendue ?

Exécutez `doctor` dès qu'un élément semble désynchronisé. Il localise précisément l'origine du décalage.

La comparaison de base de données inclut celle que le démarrage effectue avant d'émettre un avertissement indiquant que `schema.generated.ts` et la base de données ne concordent pas, via le même code. Chaque différence signalée par le démarrage apparaît donc également dans le rapport, dans les mêmes termes : une colonne NOT NULL d'un côté et nullable de l'autre, ou une colonne toujours présente dans la base mais absente du fichier (le démarrage ne supprimant jamais rien, une propriété renommée laisse son ancienne colonne en place). Chacune constitue un avertissement, et la solution proposée indique `rebase db push`.

La comparaison de la base lit la base de données du projet, résolue selon la méthode de `rebase db url` — sur un projet fraîchement initialisé, la base gérée, que `doctor` démarre. Si aucune base ne peut être résolue, cette phase est signalée comme **ignorée** plutôt que validée, et l'exécution ne se conclut jamais par « All schemas are in sync » — une vérification qui n'a pas eu lieu ne garantit pas la conformité du système.

Elle signale également chaque table sans [bloc `search`](/docs/backend/search) dont le volume dépasse environ 10 000 lignes. Une recherche sur celle-ci — le champ de recherche de l'administrateur, `.search()`, `?searchString=` — se traduit par un `ILIKE '%term%'` sur les colonnes textuelles, qu'aucun index ne peut accélérer ; chacune nécessite donc une lecture complète de la table, et le décompte total en déclenche une seconde (environ un tiers de seconde pour 100 000 lignes, augmentant avec la taille de la table). Le décompte des lignes étant l'estimation propre à Postgres, cette vérification ne réalise aucun scan. Il s'agit d'une recommandation : elle ne modifie pas le code de retour, et aucun index n'est créé automatiquement.

Elle identifie les **tables de jonction orphelines** : une table `public` ayant la structure d'une jonction many-to-many qu'aucune table ne déclare. Cette structure correspond à deux colonnes formant ensemble la clé primaire, chacune étant une clé étrangère vers une table déclarée. Renommer ou supprimer un `manyToMany` laisse l'ancienne jonction en place, car le push et le démarrage ne font que créer des tables, et chaque ligne d'association s'y trouve toujours. Cette remarque est purement informative et n'influe pas sur le code de retour. Sa solution consiste en l'instruction `DROP TABLE`, que `doctor` affiche mais n'exécute jamais.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générer un SDK typé à partir de vos tables :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`, via le chargeur utilisé par le backend au démarrage, garantissant que le SDK décrit fidèlement les tables servies ; un schéma qui ne compile pas interrompt le processus
- Génère les types TypeScript pour chaque table dans `generated/sdk/`
- Produit un fichier `database.types.ts` utilisable avec `createRebaseClient<Database>()` : le type `Database`, `TableName` (l'union de tous les slugs), et `tablesDictionary` / `TablesDictionary`, la table de correspondance de l'accesseur vers le slug

`rebase dev` l'exécute automatiquement au lancement et à chaque sauvegarde dans
`backend/schema/`. Exécutez-la vous-même en CI, dans un dépôt qui ne possède
aucune table propre (voir `--from` ci-dessous), ou dans tout environnement où `rebase dev` ne tourne pas.

**Options :**

| Option | Description |
|------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`, ou la clé `tables` dans `rebase.json`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lire le schéma depuis un projet en cours d'exécution plutôt que depuis les sources locales. `link` utilise le projet lié de cet espace de travail. |
| `--token` | Jeton Bearer pour le point de terminaison du contrat (par défaut : `$REBASE_SERVICE_KEY` depuis l'environnement shell ; `.env` n'est pas lu) |
| `--register` | Typer également les données côté serveur : écrit les types et une déclaration `Register` dans `backend/generated/`, et l'enregistre dans `rebase.json` — voir [Données côté serveur typées](/docs/backend/typed-server-data/) |

`--from` permet à un dépôt ne contenant aucune table — un frontend distinct,
une seconde application web, une application mobile — de générer un client typé à partir du
projet avec lequel il communique : il lit le champ `tables` de
`/api/meta/contract` sur le backend actif. `REBASE_SERVICE_KEY` est uniquement envoyé au projet auquel cet
espace de travail est lié ; transmettez explicitement `--token` pour tout autre hôte. La clé dans
`.env` appartient à votre backend local et n'est jamais transmise.
En cas de refus, l'erreur détaille le cas rencontré : un `--token` refusé, une clé shell refusée, une clé
retenue pour un hôte non lié, une clé présente uniquement dans `.env`, ou aucune clé renseignée.

**Utilisation après génération :**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Sécurité de typage complète et autocomplétion
const { data } = await client.data.products.find();
```

Les noms de champs dans les types générés correspondent à ceux renvoyés par l'API. Le nom de transit d'un
champ correspond à sa clé de colonne, et l'API adopte la convention camelCase : l'introspection
écrit une colonne `created_at` sous la forme `createdAt: col.timestamp({ withTimezone: true })`, dont le nom SQL
est la version snake_case de la clé, et la retourne sous `row.createdAt`. La colonne
elle-même reste inchangée. L'*accesseur* de la table est transformé en nom de propriété selon le
même procédé (`my-notes` → `client.data.myNotes`), ce que `tablesDictionary`
associe à nouveau au slug.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`rebase migrate collections-to-tables [dir]` déplace `config/collections` vers
`backend/schema` (un `defineTable` par collection, chaque colonne explicite à
sa position d'origine, dans la syntaxe Drizzle, et `index.ts` avec
`defaultRls`) et `frontend/src/cms` (un `customizeTable` par collection personnalisée,
les fichiers `defineFirestoreCollection`, `ui-config.json`), écrit
`backend/resources.ts`, `backend/storage.ts` et `backend/generated/register.ts`,
ajoute `rebaseBackendGuard()` dans le fichier `vite.config.ts` d'un scaffold, puis exécute
`rebase migrate sdk-calls`, qui remplace `.collection(` par `.table(`, applique
les autres renommages du SDK ainsi que les sources de règles `existsIn` / `membership` dans votre code,
et déplace les imports dont les noms ont migré vers un autre package en 0.31 (les types et helpers
du panneau d'administration vers `@rebasepro/cms-types`, les utilitaires de migration vers
`@rebasepro/common/migrate` — [la liste complète](/docs/upgrading/0-30-to-0-31-imports/)),
en ajoutant le package aux dépendances de l'importateur (« Dependencies added » : exécutez
`pnpm install`). Passez chaque package `@rebasepro` en version 0.31 avant de lancer cette commande.
Chaque exécution relit le résultat : le SQL généré — DDL, politiques, recherche,
vecteurs, triggers, vues, schéma Drizzle — doit être identique à l'octet près, sinon chaque
fichier est restauré. Ce qui ne peut pas être converti automatiquement est rejeté avec l'indication du fichier et de la ligne, et
ce qui reste à faire manuellement est affiché sous forme d'étapes numérotées, se terminant par
`rebase skills install` lorsque le projet contient des compétences d'agent (agent skills). Vos propres modules dans
`config/` sont conservés ; l'exécution affiche la commande `git rm` pour les éléments remplacés.

| Option | Effet |
|---|---|
| `--dry-run` | Affiche les fichiers, refus, notes et étapes manuelles sans rien écrire. Commencez par ici. |
| `--check` | Sur un projet migré : vérifie que `backend/schema` produit toujours le même SQL. Quitte avec le code 1 en affichant le diff, ou si une règle change de signification. |
| `--accept-rule-changes` | Avec `--check` : confirme que les règles sous « Review before deploying » ont bien été vérifiées. |
| `--json` / `--force` / `--skip-sdk-calls` | Rapport au format JSON (avec `ruleChanges`) ; exécute sur un arbre non propre ou sur une sortie modifiée ; préserve votre code intact. |

Lisez attentivement les deux listes de la sortie du SDK : **« Rewritten by name — review »** (appels sur un
récepteur non typé, réécrits selon son nom) et **« Left unchanged — check each »**
(appels non reconnus avec certitude comme appartenant au SDK : renommez manuellement ceux qui le sont, sous peine d'échec au runtime).

La vérification SQL garantit la conformité de la conversion, mais pas qu'une règle conserve sa
signification originale. La dernière section du rapport, **« Review before deploying: these rules
change meaning »**, répertorie chaque règle dont la politique accorde désormais des droits différents
— un simple `access: "authenticated"` n'accordait rien auparavant et accepte désormais tout
utilisateur connecté ([les quatre cas](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Vérifiez ensuite par rapport à votre base de données : `rebase db push --dry-run` doit afficher « No
changes: the database already matches these tables. », et
`rebase doctor --policies` ne doit signaler aucune dérive.

## Flux de développement

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le flux de travail à itération rapide pour le développement :

```bash
# 1. Modifier une table dans backend/schema/
# 2. Générer le schéma Drizzle
rebase schema generate

# 3. Pousser directement vers la base de données de dev
rebase db push
```

## Flux de production

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le flux de travail sécurisé et contrôlable pour la production :

```bash
# 1. Modifier une table dans backend/schema/
# 2. Générer le schéma Drizzle
rebase schema generate

# 3. Générer les fichiers de migration SQL
rebase db generate

# 4. Examiner le SQL généré dans backend/drizzle/migrations/
# 5. Commiter la migration dans le gestionnaire de versions
git add backend/drizzle/migrations/

# 6. Appliquer en production
#    Une base déjà démarrée par Rebase nécessite une initialisation de référence (baseline) la première fois —
#    voir « Établir une base de référence (baseline) pour une base de données déjà démarrée par Rebase » ci-dessus.
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|---------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Le fichier de schéma ne se met pas à jour | Vérifiez que le chemin `--schema-dir` (ou la clé `tables` dans `rebase.json`) pointe vers le bon répertoire |
| La migration montre des modifications inattendues | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez `db generate` + `db migrate` à la place |
| Une migration ne doit pas supprimer de données en CI ou en production | `rebase db migrate --refuse-destructive` renvoie le code 1 et n'applique rien lorsqu'une instruction en attente détruit des données |
| `db migrate` échoue avec `already exists (42710)` | Le démarrage ou `db push` a déjà approvisionné le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |
| `db migrate` échoue avec `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — définissez la référence pour cette migration de la même façon |
| `db push` sur la base de données gérée échoue avec `Error: EOF` | Atlas a perdu une connexion détenue par le processus `rebase dev` actif. Réessayez ; si l'erreur persiste, arrêtez `rebase dev` au préalable |

## Étapes suivantes

- **[Tables](/docs/schema/)** — Définir votre modèle de données
- **[Référence de la CLI](/docs/cli)** — Toutes les commandes de la CLI
- **[SDK typé](/docs/sdk)** — Utiliser le SDK généré
