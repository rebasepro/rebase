---
sourceHash: 79d8123106a0fa90
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des tables dans backend/schema, créez des migrations SQL, introspectez une base de données existante dans des fichiers defineTable, et maintenez votre base de données synchronisée avec le CLI Rebase.
---

## Aperçu

Rebase utilise un pipeline **schema-as-code** dans lequel les tables que vous déclarez avec
`defineTable` dans `backend/schema/` constituent l'unique source de vérité. Le CLI
les transforme à travers un pipeline déterministe :

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Cette page couvre chaque commande du CLI impliquée dans ce pipeline.

## Le pipeline

### 1. Tables → Drizzle Schema

Les tables exportées par `backend/schema/index.ts` décrivent les colonnes, les types, les relations,
les énumérations et la sécurité au niveau des lignes (RLS). Chaque commande ci-dessous les lit via
le chargeur utilisé au démarrage du backend ; ainsi, un schéma qui ne compile pas — une table sans
`rls`, `"inherit"` sans `defaultRls`, un `defineTable` que l'index n'exporte pas — interrompt la
commande avec une `SchemaDefinitionError` indiquant chaque problème, et rien n'est écrit. La
commande `schema generate` génère un fichier de schéma Drizzle ORM à partir de celles-ci.

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet qui conserve ses
tables ailleurs ; la valeur par défaut est `backend/schema`, ou la clé `tables` de l'application
backend dans `rebase.json`. `--collections` / `-c`, le flag antérieur à la version 0.31, est refusé
avec un message indiquant le codemod ([`rebase migrate collections-to-tables`](#rebase-migrate)),
tout comme un projet contenant encore `config/collections`.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` calcule le différentiel par rapport aux migrations
déjà présentes dans `backend/drizzle/migrations/`, rejouées sur une base de données temporaire (scratch),
et produit des fichiers de migration SQL horodatés. Il ne lit jamais votre base de données : une
colonne déjà ajoutée par le démarrage ou par `db push` apparaît tout de même sous forme d'`ADD COLUMN`.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente sur votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

Générez un fichier de schéma Drizzle ORM à partir de vos tables :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables, les énumérations et les relations Drizzle

**Options :**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--watch, -w` | Surveiller les changements et régénérer automatiquement |

Le **mode watch** est utile pendant le développement — modifiez un fichier de table et le schéma se régénère instantanément :

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Vérifiez si le schéma généré correspond toujours aux tables :

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Ce qu'elle fait :**
- Génère le rendu des tables dans `backend/schema/` et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Indique chaque différence — une table manquante, une colonne dont le type a changé, un label d'énumération supprimé, ou des clés étrangères nommées selon la convention d'une version antérieure — et se termine avec un code de sortie non nul
- Avec `--fix`, régénère le fichier au lieu d'effectuer un simple rapport

`rebase dev` maintient le fichier à jour de lui-même, il s'agit donc de la vérification destinée à
un build ou à une étape de CI. Elle accepte `--schema-dir` et `--output` tout comme
`rebase schema generate`.

### `rebase schema reconcile`

Assouplissez et supprimez ce que le démarrage (boot) ne prend pas en charge, après avoir examiné le plan :

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Ce qu'elle fait :**
- Demande au backend en cours d'exécution de planifier les modifications sur sa propre base de données. C'est le backend vers lequel pointent le fichier `.env` et le lien cloud, ce qui permet de fonctionner sur Rebase Cloud, où rien d'autre ne peut accéder à la base de données.
- Planifie un `DROP NOT NULL` pour chaque colonne qu'une table déclare comme nullable alors que la base de données l'exige encore comme obligatoire.
- Liste chaque colonne qu'aucune table ne déclare. Une colonne `NOT NULL` sans valeur par défaut bloquant chaque insertion, elle est également assouplie et ses données sont conservées. Elle ne supprime que les colonnes spécifiées avec `--drop <table>.<column>`, et affiche le nombre de lignes contenant une valeur pour chacune d'elles.
- Applique les changements dès que vous saisissez `yes`. Le serveur n'exécute le plan que sur l'empreinte (digest) de celui que vous avez examiné : ainsi, si la base de données ou les tables ont changé entre-temps, il refuse et vous devez examiner à nouveau. `--yes` ignore la demande de confirmation.

Le boot ne fait qu'ajouter des éléments : par conséquent, après avoir supprimé une colonne de son `defineTable`, sa colonne subsiste dans la base de données, avec ses données. Une colonne `NOT NULL` sans valeur par défaut fait alors échouer chaque insertion, et les logs de démarrage indiquent cette commande pour y remédier : sans `--drop` pour conserver les données, avec `--drop` pour supprimer la colonne. Déployez d'abord la modification de la table, car reconcile planifie en fonction de ce que le backend exécute. Il requiert `REBASE_SERVICE_KEY` dans le fichier `.env`. En local, `rebase db push` couvre le même cas grâce à sa barrière de sécurité pour les changements destructifs.

### `rebase schema introspect`

Générez des fichiers `defineTable` à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à la base de données de ce projet, celle affichée par `rebase db url` (l'instance gérée est démarrée s'il s'agit d'elle) ; `--database-url` en désigne une autre, et `--docker` utilise celle de Docker Compose
- Lit chaque table, colonne, type, clé étrangère et politique de sécurité, puis écrit
  `backend/schema/<table>.ts` — un `defineTable` par table — ainsi que le fichier
  `backend/schema/index.ts` qui les exporte (fusionné dans un index déjà existant)
- Déclare chaque colonne avec son type Postgres : `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, une énumération avec ses valeurs et son vrai nom de type
  (un `pgEnum` quand le type est partagé), un tableau sous la forme `<item>.array()`,
  `col.vector({ dimensions })`, les clés d'identité et de série, les valeurs par défaut —
  orthographiées comme Drizzle les écrit. Un type qu'aucun constructeur ne désigne devient
  `col.custom({ dataType: "<sql type>" })`, que Rebase renvoie tel que le pilote le retourne ;
  `db generate` et `db push` le refusent jusqu'à ce que le planificateur puisse le prendre en charge
- Déclare la colonne de clé étrangère, le `belongsTo` associé et le `hasMany` inverse sur la cible ;
  une table de jonction devient un `manyToMany`, ses propres colonnes constituant le `pivot`
- Lit les politiques de sécurité au niveau des lignes de chaque table dans son `rls` : nom,
  commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques `<table>_default_*`
  que Rebase ajoute lui-même sont exclues, afin que le `db push` qui suit recrée
  chaque politique telle qu'elle était. Une table avec la sécurité au niveau des lignes activée et sans
  politique est écrite sous la forme `rls: "admin-only"`
- Lit chaque expression (le `USING` d'une politique, un CHECK, une valeur par défaut de colonne) sous
  le `search_path` qu'utilise le serveur, `public`, de sorte qu'une fonction dans le schéma `rebase`
  est écrite `rebase.roles()`
- Transforme un CHECK qu'elle peut lire (`total >= 0`) en `.validate()` sur la colonne, et laisse la
  contrainte elle-même dans la base de données, où le push ultérieur la conserve. Chaque CHECK est
  également listé sous "Not carried over" avec son code SQL : un push dans une *nouvelle* base de
  données crée la validation, et non la contrainte
- Déclare chaque index standard (colonnes uniquement, btree, gin ou brin, sans prédicat) dans les
  `indexes` de la table. Un index portant uniquement sur une colonne de clé étrangère est laissé à la
  relation, qui en crée un
- Avec `--from supabase`, traduit les conventions de Supabase pour une base de données que vous quittez :
  une valeur par défaut de colonne définie à `auth.uid()` devient `.onCreateUser()` (le serveur écrit
  l'ID de l'appelant), une colonne contenant un identifiant utilisateur Supabase (cette valeur par défaut,
  ou une clé étrangère vers `auth.users`) devient `col.text().userId()`, car `rebase.users.id` et
  `rebase.uid()` sont de type text, et une politique `TO authenticated` / `TO anon` perd son rôle
  (une base de données Rebase ne possède ni l'un ni l'autre) et exige à la place un appelant
  authentifié / non-authentifié ; une politique destinée uniquement à `service_role` est supprimée.
  Chaque modification est mentionnée en haut du fichier de la table. Sans ce flag, ils sont laissés tels
  quels (Rebase s'exécutant sur la même base de données aux côtés de Supabase en a encore besoin), et
  l'exécution indique quand elle les a rencontrés
- Se termine par ce qu'elle n'a **pas** repris : fonctions, déclencheurs (triggers), extensions,
  contraintes CHECK, index que `indexes` ne peut exprimer, clés étrangères multi-colonnes ou pointant
  vers un autre schéma. Le SQL permettant de recréer chacun de ceux que Postgres peut afficher est
  écrit dans `backend/sql/introspected-left-behind.sql`, pour révision et application après le premier
  push (`psql "$DATABASE_URL" -f …`, ou `rebase cloud db query --file …` sur Rebase Cloud)
- Vous rappelle que `DATABASE_URL` désigne toujours la base de données qu'elle a lue : dans le cadre
  d'une migration, il s'agit de la source, et un `db push` exécuté à ce stade écrirait dedans
- Place ce qu'elle n'a pas pu déclarer avec exactitude dans un commentaire en haut du fichier de la
  table et sur le terminal — un ensemble fermé de chaînes sur une colonne texte, une colonne générée
  dont elle n'a pas pu lire l'expression, un type personnalisé — accompagné de ce qu'un push lui ferait subir
- Avec `--data-inference`, échantillonne jusqu'à 100 lignes par table et écrit ce qu'elle a identifié
  comme relevant de la présentation — titres, icônes, tableaux (boards), tris, options de champ — dans
  `frontend/src/cms/<table>.tsx` sous forme de `customizeTable`, lorsque le frontend du projet dépend
  de `@rebasepro/cms`. Un projet headless n'en reçoit aucun
- Face à une base de données qui n'est pas en cours d'exécution, affiche une seule fois la même bannière
  que `db push` et ne crée rien. Elle affiche le répertoire de sortie sous forme de chemin absolu

**Options :**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Où écrire les fichiers de tables (par défaut : `backend/schema`). `--output` a été supprimé |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écraser les fichiers de tables déjà existants ; sans ce flag, un fichier existant est ignoré |
| `--database-url` | Lire cette base de données au lieu de celle du projet |
| `--docker` | Lire la base de données Docker Compose, en la démarrant si nécessaire |
| `--from supabase` | Traduire les conventions de Supabase (valeurs par défaut `auth.uid()`, clés étrangères `auth.users`, `TO anon` / `TO authenticated`) pour une base de données Rebase. Laissez-le désactivé lorsque Rebase tourne sur la même base de données aux côtés de Supabase |
| `--data-inference` / `--no-data-inference` | Échantillonner jusqu'à 100 lignes par table pour détecter les formats, les contraintes et les paramètres de panneau, ou lire uniquement la structure. Sans l'un ou l'autre, la commande pose la question, et en l'absence de terminal, elle lit uniquement la structure |

Cela est utile lors de l'adoption de Rebase sur une base de données existante — introspectez d'abord,
puis modifiez les tables générées. Une table dont la sécurité au niveau des lignes est désactivée est
écrite comme n'importe quelle autre, avec son `rls` ; le push active le RLS, et l'exécution à blanc
(dry run) le signale. Un backend qui s'exécute sans aucun `backend/schema` sert directement la base de
données à la place — voir [Backend only](/docs/getting-started/headless/). Vous quittez Supabase ?
Voir [Migration depuis Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Poussez les modifications de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique directement les modifications à la base de données (CREATE, ALTER, DROP)
- Exécute d'abord le plan à blanc (dry-run) et s'arrête avant toute opération susceptible de détruire
  des données : une table, une colonne, un schéma, une vue ou un type supprimé, un `TRUNCATE`, un
  changement de type de colonne pouvant entraîner une perte de valeurs (`timestamptz` → `date`,
  `numeric` → `integer`), ou un changement de clé primaire — `(id)` → `(id, locale)` attribue à chaque
  ligne un nouvel id, de sorte que les liens, clés étrangères et identifiants stockés ailleurs ne
  retrouvent plus leur ligne. Elle s'arrête également avant la suppression d'une contrainte CHECK ou
  EXCLUDE présente dans la base de données : aucune ligne n'est perdue, mais la base de données acceptera
  désormais les lignes qu'elle refusait auparavant. Elle demande confirmation dans un terminal, où
  Ctrl-C ou Ctrl-D répond par la négative, et refuse dans le cas contraire ; `--allow-destructive`
  l'applique malgré tout. `--yes` le fait également dans cette version, avec un avertissement
  d'obsolescence ; à partir de la prochaine version, il n'approuvera que les pushs qui ne détruisent rien.
  Un push qui s'arrête à ce stade supprime sa base de données temporaire `<db>_dev_diff` en quittant.
- Active la sécurité au niveau des lignes pour chaque table déclarée, jonctions comprises, immédiatement
  après le changement de schéma et avant toute étape susceptible d'échouer, de sorte qu'un push qui
  s'arrête en cours de route laisse une nouvelle table en refusant chaque requête au lieu de la laisser
  ouverte à tous
- Applique les politiques RLS issues de la compilation du `rls` de vos tables, et **supprime les politiques remplacées par un push antérieur**
- Laisse intacte chaque contrainte CHECK et EXCLUDE sur une table déclarée. Une table ne pouvant déclarer
  ni l'une ni l'autre, il s'agit de règles propres à la base de données, écrites à la main ou issues d'une
  base de données adoptée par `schema introspect` ; pour en supprimer une, retirez-la manuellement
  (`ALTER TABLE … DROP CONSTRAINT …`). Les déclencheurs (triggers) et fonctions que vous avez écrits ne
  sont pas modifiés non plus
- Fait correspondre exactement le nom de tout ce qu'elle laisse intact, y compris s'il contient un
  `.`, `[`, `]` ou `*`
- Construit tout [index de clé étrangère dérivé par Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  qui manquerait à une table existante **avant** la planification, avec `CREATE INDEX CONCURRENTLY`, de
  sorte que les écritures sur la table continuent pendant la construction ; Atlas le trouve ensuite en place.
  `--dry-run` les liste et ne construit rien
- Estampille les politiques qu'elle applique de la même manière que le démarrage du serveur, afin que
  le premier démarrage après un push ne les modifie pas au lieu de recréer chacune d'elles
- `--dry-run` liste les modifications de sécurité au niveau des lignes que le push effectuerait, sous
  "Planned row-level security changes" : les tables pour lesquelles il active le RLS, et chaque
  politique qu'il crée, remplace ou supprime, déterminées selon la logique propre aux étapes du push.
  Il n'affiche "No changes" que lorsque ni le schéma ni la sécurité au niveau des lignes ne changent.
  Lorsqu'une estampille de politique ne correspond pas à sa règle, ou lorsqu'elle n'en a aucune (créée par
  `db migrate`, écrite à la main), l'exécution à blanc la recrée à partir de sa règle sous un autre nom,
  dans une transaction annulée (rollback), et compare ce que Postgres a stocké : un résultat identique
  ne donne lieu à aucun changement. Ainsi, une règle lue sous forme de SQL par `schema introspect` ne
  planifie rien, pas plus que les politiques appliquées par `db migrate`. Seule une politique qu'il n'a pas
  pu comparer (le verrou de sa table n'ayant pas été accordé en deux secondes, par exemple) est listée à part.
  Le push lui-même affiche une seule ligne indiquant le décompte des modifications
- Affiche chaque instruction appliquée par Atlas une fois. Atlas se connecte sans SSL à une base de données
  sur cette machine (`localhost`, `127.x`, `::1`) dont l'URL ne spécifie aucun `sslmode`, tout comme l'application,
  au lieu d'échouer sur `SSL is not enabled on the server` ; une URL qui mentionne `sslmode`, ou un autre hôte,
  est transmise telle quelle. Une exécution d'Atlas qui échoue avant la planification ne laisse aucune base de
  données `<db>_dev_diff` résiduelle
- `--dry-run` n'écrit rien dans le projet : `src/schema.generated.ts` reste intact, et les copies
  `drizzle/*.sql` commitées par une ancienne version sont listées, mais pas supprimées. Seule l'entrée
  du plan est écrite dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Durée d'exécution.** La quasi-totalité d'un push est consacrée au calcul du plan par Atlas : il
construit votre schéma cible dans une base de données temporaire et le compare à la véritable base,
et ce coût augmente plus vite que le nombre de tables — sur un ordinateur portable au repos, environ
0,25 s par plan pour 11 tables, 0,9 s pour 111 et 5,5 s pour 411. Un push qui ne modifie rien planifie
une seule fois ; un push qui apporte des modifications planifie deux fois (l'exécution à blanc lue par
la barrière de changements destructifs, puis l'application). Ainsi, un push sur un schéma de 400 tables
ou plus prend plusieurs dizaines de secondes, voire davantage sur une machine chargée ou lente. Ce temps
est imputable à Atlas, non à votre base de données : les étapes annexes — génération du SQL, verrouillage
RLS, recherche, déclencheurs, politiques, rôle — ne prennent que quelques secondes à cette échelle, sur
une unique connexion à votre base de données.

**Les fichiers générés en cours de route**, tous situés sous `.rebase/sql/` dans le répertoire backend.
`db push` et `db generate` écrivent l'ensemble de ces cinq fichiers à partir de vos tables à chaque
exécution, avant d'en lire le moindre, de sorte qu'une version commitée ne serait lue par rien. Le
répertoire possède son propre `.gitignore` et n'est jamais commité.

| Fichier | Contenu |
|---------|---------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état cible pour Atlas, et le seul qu'il compare |
| `policies.sql` | Les politiques RLS issues de la compilation du `rls` de vos tables |
| `search.sql` | Les fonctions de recherche plein texte et les colonnes générées, pour les tables disposant d'un bloc `search` |
| `vector.sql` | Extensions pgvector et index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les déclencheurs `BEFORE UPDATE` derrière `.onUpdateNow()` |

Atlas ne gère que le premier fichier et rien d'autre, si bien que `db push` et la vérification du schéma
au démarrage appliquent eux-mêmes les quatre autres. Un déploiement basé **uniquement sur les migrations**
— qui exécute `db migrate` et jamais `db push` — doit intégrer manuellement ces quatre fichiers dans une
migration ; `db generate` le signale lorsqu'une modification est invisible pour Atlas.

Un projet ayant commité ces fichiers dans `drizzle/` sous une version précédente voit ces copies supprimées
dès sa première exécution, et la commande indique chacune d'elles afin que vous puissiez commiter la suppression.
Elle ne supprime que les fichiers commençant par l'en-tête du générateur. Un fichier que vous avez écrit vous-même
est conservé, tout comme `drizzle/migrations/`.

:::note[Modifier une règle de sécurité renomme sa politique]
Une règle sans `name` explicite est compilée en `<table>_<op>_<hash>`, où le hash couvre la sémantique de la règle — par conséquent, *modifier* une règle (plutôt qu'en ajouter une) produit une politique sous un nouveau nom et laisse subsister l'ancienne.

Cela avait autrefois un impact majeur : Postgres applique un opérateur OU logique (OR) entre les politiques `PERMISSIVE`, de sorte qu'un `USING (rebase.uid() IS NOT NULL)` rendu obsolète continuait d'accorder tous les droits, quelle que soit la sévérité de son remplaçant. Durcir une règle n'avait aucun effet, et push indiquait un succès.

`db push` réconcilie désormais cela : il supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans les supprimer — les politiques dotées d'un nom personnalisé non décrites par vos tables, étant indiscernables d'un code SQL écrit délibérément à la main.

Pour auditer une base de données sur laquelle un push a été effectué avant l'introduction de cette fonctionnalité, exécutez `rebase doctor --policies`. Cela fonctionne comme un point de contrôle (gate) de CI : la commande se termine avec un code non nul en cas de dérive (drift), ainsi que lorsqu'elle n'a pas pu exécuter la vérification du tout — pas de `DATABASE_URL`, un chemin `--schema-dir` introuvable, une lecture de `pg_policies` non accordée au rôle de la CI. Un contrôle qui n'a pas pu examiner la base n'est pas considéré comme réussi.

`doctor` et `db push` distinguent les deux types d'éléments orphelins. Une politique portant un nom généré a été remplacée, et le prochain push la supprimera. Tout autre nom a été écrit à la main ou par un autre outil et reste en vigueur : décrivez-la dans le `rls` de sa table pour la conserver (la vue RLS de Studio l'importe), ou supprimez-la manuellement si elle est obsolète.
:::

:::caution
`db push` modifie directement la base de données. Utilisez-le uniquement en développement. Pour la production, utilisez `db generate` + `db migrate` pour créer des fichiers de migration pouvant être révisés.
:::

### `rebase db generate`

Générez des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle à l'état construit par les migrations dans `drizzle/migrations/`, et non à votre base de données
- Produit des fichiers de migration SQL horodatés dans `backend/drizzle/migrations/`
- Les fichiers peuvent être révisés, modifiés et commités dans le gestionnaire de versions
- Indique chaque instruction de la nouvelle migration qui détruit des données, en utilisant la même
  vérification que celle exécutée par `db push` avant application : suppression d'une table, colonne,
  schéma, vue ou type, un `TRUNCATE`, un changement de type de colonne risquant de perdre des valeurs,
  un changement de clé primaire, ou la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base.
  Elle écrit tout de même le fichier et se termine avec un code 0, émettant ainsi un avertissement sans refuser l'opération.
- Se termine par les étapes suivantes : `rebase db migrate`, et pour la première migration d'un projet,
  le `--baseline <version>` requis par une base de données que le démarrage a déjà initialisée. Une migration
  ultérieure n'indique pas de ligne de baseline, car baseliner une migration destructive ignorerait son
  `DROP`, et une exécution n'écrivant aucune migration se contente de le signaler.

**Une contrainte CHECK ajoutée par l'une de vos migrations est supprimée par la suivante.** `db generate`
calcule le diff sur vos fichiers de migration, pas sur la base de données, et Atlas n'a aucun moyen d'exclure
un objet de ce différentiel. Par conséquent, une contrainte CHECK ou EXCLUDE que vous avez rédigée manuellement
dans une migration, et qu'aucune table ne peut déclarer, réapparaît sous la forme `ALTER TABLE … DROP CONSTRAINT …`
dans la prochaine migration générée, intégrée dans la même instruction que le changement réel. Le rapport
ci-dessus signale cette suppression lorsque la base de données contient déjà la contrainte ; il ne la retire pas
du fichier. Supprimez la clause avant `rebase db migrate`, ou laissez `rebase db migrate --refuse-destructive`
s'interrompre dessus. `db push` lit la base de données et préserve la contrainte.

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Exécutez toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit `drizzle/migrations/` à la recherche de migrations non appliquées
- Les applique dans l'ordre sur la base de données
- Suit les migrations qui ont été appliquées
- Estampille les politiques de sécurité au niveau des lignes de la même manière que `db push` et le
  démarrage du serveur, afin que le premier démarrage après une migration les laisse intactes plutôt
  que de réappliquer chacune d'elles. Une migration ayant été rédigée à partir des tables de son époque,
  une politique n'est estampillée que lorsqu'elle correspond exactement à ce que sa règle produit
  actuellement : migrate la recrée à partir de sa règle sous un autre nom, dans une transaction annulée
  (rollback), et compare ce que Postgres a stocké, comme le fait `db push --dry-run`. Une politique qui
  diffère ne reçoit pas d'estampille, et le démarrage suivant réapplique sa table

`--refuse-destructive` force la commande à refuser à la place. Elle effectue d'abord une exécution à
blanc des migrations en attente. Si une instruction détruit des données, selon la même vérification que
celle utilisée par `db push` et `db generate`, elle liste ces instructions et se termine avec le code 1.
Elle n'applique rien, pas même les fichiers situés avant cette instruction. Sans ce flag, `db migrate`
fonctionne comme auparavant et applique chaque fichier en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration qui reconstruit une colonne de recherche commence par la supprimer : ce flag refuse donc
également cette migration. Examinez la liste affichée, puis exécutez `rebase db migrate` sans ce flag
pour l'appliquer.

#### Établir une ligne de base (baselining) pour une base de données déjà démarrée par Rebase

Chaque démarrage de Rebase valide le schéma, et `rebase db push` l'applique directement. Ainsi, une
base de données qui a déjà exécuté l'un ou l'autre contient déjà les tables et les types que la
première migration créerait, et `rebase db migrate` s'interrompt avec l'erreur `pq: type "posts_status" already exists (42710)`.

La migration ne présente aucune anomalie — la base de données a été approvisionnée par un autre moyen.
Enregistrez son état actuel, puis migrez normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version correspond au préfixe numérique du fichier de migration décrivant ce qui se trouve dans la base
de données *actuellement*. Cette migration et toutes celles antérieures sont enregistrées comme appliquées ;
tout ce qui suit est exécuté. Sur une base de données contre laquelle aucun démarrage n'a jamais eu lieu,
aucune baseline n'est nécessaire — migrez directement.

La même chose se produit plus tard dans le cycle de développement classique : modifiez une table pendant
que `rebase dev` est en cours d'exécution, et le boot ajoute la colonne avant que `rebase db generate`
n'écrive la migration qui l'ajoute, de sorte que `rebase db migrate` s'arrête sur `column … already exists (42701)`.
Définissez la baseline pour cette migration de la même manière. `--baseline` fonctionne sur une base de données
enregistrant déjà des migrations : il marque tout ce qui précède la version comme appliqué avec `atlas migrate set`
et le confirme, ou indique qu'il n'y a rien à enregistrer si l'historique l'atteint déjà. Une version qui ne
correspond à aucun fichier dans `drizzle/migrations` est refusée avant toute exécution, en affichant les versions
existantes.

### `rebase db branch`

Branching de base de données pour le développement en parallèle :

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (et `switch --off`) ainsi que `rebase db branch prune` sont nouveaux.
`create`, `list`, `info` et `delete` sont apparus dans la version 0.17.

Chaque branche est une copie complète de la base de données créée avec `CREATE DATABASE ... TEMPLATE`,
ce qui nécessite un véritable serveur PostgreSQL et consomme autant d'espace disque que sa source.

### `rebase doctor`

Détectez la dérive tripartite entre vos tables, le schéma Drizzle généré et la base de données PostgreSQL en production ou en cours d'exécution :

```bash
rebase doctor
```

**Ce qu'elle vérifie :**
- Tables ↔ Schéma généré — sont-ils synchronisés ?
- Schéma généré ↔ Base de données — y a-t-il des modifications non appliquées ?
- Tables ↔ Base de données — existe-t-il une dérive inattendue ?

Exécutez `doctor` dès qu'un élément semble désynchronisé. La commande indique précisément où se situe le décalage.

La comparaison de base de données inclut celle effectuée au démarrage avant d'avertir que `schema.generated.ts`
et la base de données ne concordent pas, exécutée avec le même code. Chaque différence signalée par le démarrage
figure donc également dans le rapport, dans les mêmes termes : une colonne qui est NOT NULL d'un côté et nullable
de l'autre, et une colonne toujours présente dans la base de données mais absente du fichier (le démarrage ne
supprimant jamais rien, une propriété renommée laisse son ancienne colonne derrière elle). Chacun de ces cas
constitue un avertissement, et la solution préconise `rebase db push`.

La comparaison de la base de données lit la base de données du projet, résolue comme le fait `rebase db url` —
sur un projet fraîchement initialisé, il s'agit de la base gérée, que `doctor` démarre. Lorsqu'aucune base ne
peut être résolue, cette phase est signalée comme **ignorée** (skipped) plutôt que réussie, et l'exécution ne
se termine jamais par "All schemas are in sync" — une vérification qui n'a pas eu lieu n'est pas un certificat
de conformité.

Elle liste également chaque table sans bloc [`search`](/docs/backend/search) qui contient plus d'environ 10 000
lignes. Une recherche sur celle-ci — la barre de recherche d'administration, `.search()`, `?searchString=` —
correspond à un `ILIKE '%term%'` sur les colonnes de texte, qu'aucun index ne peut accélérer ; chacune d'elles
lit donc la table entière, et son comptage la lit à nouveau (environ un tiers de seconde pour 100 000 lignes,
augmentant avec la table). Le nombre de lignes provient de l'estimation interne de Postgres, la vérification
ne scanne donc rien. Il s'agit d'une simple indication : elle ne modifie pas le code de sortie, et rien n'est
indexé automatiquement.

Elle indique les **jonctions orphelines** : une table dans `public` ayant la forme d'une table de jonction
many-to-many qu'aucune table ne déclare. Cette structure est composée de deux colonnes formant ensemble la clé
primaire, chacune étant une clé étrangère vers une table déclarée. Renommer ou supprimer une relation `manyToMany`
laisse son ancienne table de jonction derrière elle, car push et boot ne font que créer des tables, et chaque
ligne d'association s'y trouve toujours. Cette remarque est purement informative et ne modifie pas le code de
sortie. Sa résolution passe par l'instruction `DROP TABLE`, que `doctor` affiche sans jamais l'exécuter.

### `rebase generate-sdk`

Générez un SDK typé à partir de vos tables :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`, via le chargeur utilisé au démarrage du backend, de sorte que le SDK décrive exactement les tables servies ; un schéma qui ne compile pas interrompt le processus
- Génère les types TypeScript pour chaque table dans `generated/sdk/`
- Produit un fichier `database.types.ts` à utiliser avec `createRebaseClient<Database>()` : le type `Database`, `TableName` (l'union de tous les slugs), et `tablesDictionary` / `TablesDictionary`, la table de correspondance entre accesseur et slug

`rebase dev` l'exécute pour vous au démarrage et à chaque enregistrement sous `backend/schema/`. Exécutez-le vous-même en CI, dans un dépôt qui ne contient pas de tables propres (voir `--from` ci-dessous), ou partout où `rebase dev` ne tourne pas.

**Options :**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`, ou la clé `tables` dans `rebase.json`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lire le schéma depuis un projet en cours d'exécution au lieu des sources locales. `link` utilise le projet lié de ce checkout. |
| `--token` | Jeton Bearer pour le endpoint de contrat (par défaut : `$REBASE_SERVICE_KEY` depuis le shell ; `.env` n'est pas lu) |
| `--register` | Typer également les données côté serveur : écrit les types et une déclaration `Register` dans `backend/generated/`, et l'enregistre dans `rebase.json` — voir [Données typées côté serveur](/docs/backend/typed-server-data/) |

`--from` permet à un dépôt qui ne contient pas de tables — un frontend séparé, une deuxième application web,
une application mobile — de générer un client typé à partir du projet avec lequel il communique : il lit les
`tables` de `/api/meta/contract` du backend en cours d'exécution. `REBASE_SERVICE_KEY` n'est envoyée qu'au
projet auquel ce checkout est lié ; transmettez explicitement `--token` pour tout autre hôte. La clé présente
dans `.env` appartient à votre backend local et n'est jamais transmise. Un refus indique lequel de ces cas s'est
produit : un `--token` refusé, une clé shell refusée, une clé retenue pour un hôte non lié, une clé présente
uniquement dans `.env`, ou aucune clé fournie.

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

Les noms de champs dans les types générés sont ceux servis par l'API. Le nom réseau (wire name) d'un
champ est sa clé de colonne, et l'API adopte la convention camelCase partout : l'introspection écrit
une colonne `created_at` sous la forme `createdAt: col.timestamp({ withTimezone: true })`, dont le nom
SQL est la version snake_case de la clé, et la sert sous la forme `row.createdAt`. La colonne elle-même
n'est pas modifiée. L'*accesseur* de la table est transformé en nom de propriété de la même façon
(`my-notes` → `client.data.myNotes`), ce que `tablesDictionary` fait correspondre au slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` déplace `config/collections` vers `backend/schema` (un
`defineTable` par collection, chaque colonne explicite à sa position d'origine, selon la syntaxe Drizzle,
et `index.ts` avec `defaultRls`) et `frontend/src/cms` (un `customizeTable` par collection personnalisée,
les fichiers `defineFirestoreCollection`, `ui-config.json`), écrit `backend/resources.ts`, `backend/storage.ts`
et `backend/generated/register.ts`, ajoute `rebaseBackendGuard()` au `vite.config.ts` d'un projet scaffoldé,
puis exécute `rebase migrate sdk-calls`, qui réécrit `.collection(` en `.table(`, effectue les autres
renommages du SDK ainsi que les sources de règles `existsIn` / `membership` dans votre code, et déplace les
imports de noms que la version 0.31 a transférés vers un autre package ([la liste](/docs/upgrading/0-30-to-0-31-imports/)),
en ajoutant le package aux dépendances de l'importateur ("Dependencies added" : exécutez `pnpm install`).
Mettez à jour tous les packages `@rebasepro` vers la version 0.31 avant de l'exécuter. Chaque exécution
relit le résultat : le SQL généré — DDL, politiques, recherche, vecteurs, déclencheurs, vues, le schéma
Drizzle — doit être identique à l'octet près, sinon chaque fichier est restauré. Ce qu'elle ne peut pas
migrer est refusé avec l'indication du fichier et de la ligne, et ce qu'elle vous laisse à faire est affiché
sous forme d'étapes manuelles numérotées, se terminant par `rebase skills install` lorsque le projet contient
des compétences d'agent (agent skills). Vos propres modules dans `config/` sont conservés ; l'exécution affiche
la ligne `git rm` pour les éléments remplacés. Elle suit également les collections Firestore construites par
une fonction, les alias de chemins, un panneau monté en dehors de `App.tsx` et chaque application statique
non protégée ([la liste complète](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Après le `git rm`, `--check` signale `already-migrated`.

| Flag | Effet |
|---|---|
| `--dry-run` | Afficher les fichiers, refus, remarques et étapes manuelles ; ne rien écrire. Commencez par ici. |
| `--check` | Sur un projet migré : prouve que `backend/schema` produit toujours le même SQL. Quitte avec le code 1 en affichant le diff, ou si une règle change de sens. |
| `--accept-rule-changes` | Avec `--check` : confirme que les règles sous "Review before deploying" ont été vérifiées. |
| `--json` / `--force` / `--skip-sdk-calls` | Le rapport au format JSON (avec `ruleChanges`) ; exécuter sur un arbre de travail non propre (dirty tree) ou sur une sortie modifiée ; ne pas toucher à votre code. |

Consultez deux listes dans sa sortie SDK : **"Rewritten by name — review"** (récepteurs non typés, slots de données,
doublures de test) et **"Left unchanged — check each"** (renommez ceux qui appartiennent au SDK ;
[une recherche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) trouve le reste).

La vérification SQL prouve la fidélité de la conversion, mais ne garantit pas qu'une règle a toujours
la même signification qu'auparavant. La dernière section de la sortie, **"Review before deploying: these rules change meaning"**,
liste chaque règle dont la politique accorde désormais des droits différents — un simple `access: "authenticated"`
n'accordait rien et admet désormais tout appelant authentifié ([les quatre formes](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Vérifiez ensuite par rapport à votre base de données : `rebase db push --dry-run` doit afficher "No changes: the database already matches these tables.",
et `rebase doctor --policies` aucune dérive.

## Flux de travail de développement

Le flux de travail pour une itération rapide en développement :

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flux de travail de production

Le flux de travail sécurisé et révisable pour la production :

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
|---------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Fichier de schéma non mis à jour | Vérifiez que le chemin de `--schema-dir` (ou la clé `tables` dans `rebase.json`) pointe vers le bon répertoire |
| La migration affiche des changements inattendus | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez plutôt `db generate` + `db migrate` |
| Une migration ne doit pas supprimer de données en CI ou en production | `rebase db migrate --refuse-destructive` quitte avec le code 1 et n'applique rien lorsqu'une instruction en attente détruit des données |
| `db migrate` échoue avec `already exists (42710)` | Le démarrage ou `db push` a déjà approvisionné le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |
| `db migrate` échoue avec `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — définissez la baseline pour cette migration de la même manière |
| `db push` sur la base gérée échoue avec `Error: EOF` | Atlas a perdu une connexion détenue par l'instance en cours d'exécution de `rebase dev`. Relancez la commande ; si l'erreur persiste, arrêtez d'abord `rebase dev` |

## Prochaines étapes

- **[Tables](/docs/schema/)** — Définissez votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes du CLI
- **[SDK typé](/docs/sdk)** — Utilisez le SDK généré
