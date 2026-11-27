---
sourceHash: 0201dc1a9ce575f7
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des tables dans backend/schema, créez des migrations SQL, introspectez une base de données existante dans des fichiers defineTable, et maintenez votre base de données synchronisée avec la CLI Rebase.
---

## Vue d'ensemble

Rebase utilise un pipeline de type **schema-as-code** où les tables que vous déclarez avec
`defineTable` dans `backend/schema/` constituent l'unique source de vérité. La CLI
les transforme via un pipeline déterministe :

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Cette page couvre chaque commande CLI impliquée dans ce pipeline.

## Laquelle utiliser ?

Une modification de table atteint PostgreSQL de trois manières :

- **Au démarrage (boot), automatiquement.** Le backend applique la partie additive à chaque démarrage (`REBASE_MIGRATE_ON_BOOT=ensure`, par défaut) : tables, colonnes, types enum et politiques de sécurité au niveau des lignes (RLS) manquants. Sous `rebase dev`, une table ou une colonne ajoutée ne nécessite rien d'autre. Le démarrage ne supprime, ne renomme ni ne rétrécit jamais rien.
- **`rebase db push`, en développement.** Il synchronise le schéma directement avec la base de données, suppressions et renommages inclus, protégé par son [garde-fou contre les modifications destructives](#rebase-db-push). Utilisez-le sur une base de données que vous ne migrez pas.
- **`rebase db generate` + `rebase db migrate`, en production.** Chaque modification est un fichier SQL revu dans le contrôle de version, appliqué dans l'ordre.

Faire passer sur des migrations une base de données que le démarrage ou `db push` a déjà initialisée nécessite un point de référence (baseline), car elle contient déjà les tables créées par la première migration. `rebase db migrate` lit cela avant d'exécuter quoi que ce soit, s'arrête, et affiche la commande `rebase db migrate --baseline <version>` à exécuter avec la version renseignée ; voir [Définir un point de référence pour une base de données déjà initialisée par Rebase](#définir-un-point-de-référence-pour-une-base-de-données-déjà-initialisée-par-rebase). À l'inverse, `db push` sur une base de données qui enregistre des migrations le signale en une ligne : la prochaine migration qui effectue la même modification s'arrêtera sur `already exists`.

## Le pipeline

### 1. Tables → Schéma Drizzle

Les tables exportées par `backend/schema/index.ts` décrivent les colonnes, les types, les
relations, les énumérations et la sécurité au niveau des lignes. Chaque commande
ci-dessous les lit via le chargeur à partir duquel le backend démarre, de sorte qu'un
schéma qui ne compile pas — une table sans `rls`, `"inherit"` sans `defaultRls`, un
`defineTable` que l'index n'exporte pas — interrompt la commande avec une
`SchemaDefinitionError` indiquant chaque problème, et rien n'est écrit. La commande
`schema generate` génère un fichier de schéma Drizzle ORM à partir de celles-ci.

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet qui
conserve ses tables ailleurs ; la valeur par défaut est `backend/schema`, ou la clé
`tables` de l'application backend dans `rebase.json`. `--collections` / `-c`, le
flag antérieur à la version 0.31, est refusé avec un message mentionnant le codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), tout comme un
projet contenant encore `config/collections`.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` effectue un diff par rapport aux migrations déjà présentes dans `backend/drizzle/migrations/`, rejouées sur une base de données temporaire, et produit des fichiers de migration SQL horodatés. Il ne lit jamais votre base de données : une colonne déjà ajoutée par le démarrage ou par `db push` ressortira tout de même comme `ADD COLUMN`.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente à votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

Générer un fichier de schéma Drizzle ORM à partir de vos tables :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables, énumérations et relations Drizzle

**Options :**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`) ; les chemins relatifs sont résolus à partir de l'emplacement où vous exécutez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus à partir de l'emplacement où vous exécutez la commande |
| `--watch, -w` | Surveiller les modifications et régénérer automatiquement |

Le **mode watch** est utile pendant le développement — modifiez un fichier de table et le schéma se régénère instantanément :

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Vérifier si le schéma généré correspond toujours aux tables :

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Ce qu'elle fait :**
- Effectue le rendu de ce que les tables dans `backend/schema/` génèrent et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Nomme chaque différence — une table manquante, une colonne dont le type a changé, un label d'énumération supprimé, ou des clés étrangères nommées comme les dérivait une version antérieure — et se termine par un code de sortie non nul
- Avec `--fix`, régénère le fichier au lieu de simplement rapporter les écarts

`rebase dev` maintient le fichier à jour automatiquement, c'est donc la vérification
idéale pour une étape de build ou de CI. Il prend `--schema-dir` et `--output` tout
comme `rebase schema generate`.

### `rebase schema reconcile`

Assouplir et supprimer ce que le démarrage ne prend pas en charge, après avoir consulté le plan :

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Ce qu'elle fait :**
- Demande au backend en cours d'exécution de générer un plan par rapport à sa propre base de données. C'est le backend vers lequel pointent le fichier `.env` et le lien cloud, ce qui permet de fonctionner sur Rebase Cloud, où rien d'autre ne peut atteindre la base de données.
- Planifie un `DROP NOT NULL` pour chaque colonne qu'une table déclare comme nullable mais que la base de données exige toujours.
- Liste toutes les colonnes qu'aucune table ne déclare. Une colonne `NOT NULL` sans valeur par défaut bloque chaque insertion, elle est donc également assouplie et ses données sont conservées. Elle ne supprime que les colonnes que vous désignez avec `--drop <table>.<column>`, et affiche le nombre de lignes contenant une valeur pour chacune.
- Applique les changements une fois que vous saisissez `yes`. Le serveur n'exécute le plan que sur l'empreinte (digest) de celui que vous avez lu ; si la base de données ou les tables ont changé entre-temps, il refuse et vous devez le revoir. `--yes` ignore l'invite de confirmation.

Le démarrage ne fait qu'ajouter des éléments, donc après avoir retiré une colonne de son `defineTable`, sa colonne reste dans la base de données, avec ses données. Une colonne `NOT NULL` sans valeur par défaut fait alors échouer chaque insertion, et les logs de démarrage recommandent cette commande pour y remédier : sans `--drop` pour conserver les données, avec `--drop` pour supprimer la colonne. Déployez d'abord la modification de la table, car reconcile établit son plan par rapport à ce que le backend exécute. Cela nécessite `REBASE_SERVICE_KEY` dans `.env`. En local, `rebase db push` couvre la même chose grâce à son garde-fou contre les modifications destructives.

### `rebase schema introspect`

Écrire les fichiers `defineTable` à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à la base de données de ce projet, celle affichée par `rebase db url` (celle gérée est démarrée si c'est le cas) ; `--database-url` en désigne une autre, et `--docker` utilise celle de Docker Compose
- Lit chaque table, colonne, type, clé étrangère et politique, et écrit
  `backend/schema/<table>.ts` — un `defineTable` par table — ainsi que
  `backend/schema/index.ts` qui les exporte (fusionné dans un index déjà
  existant)
- Déclare chaque colonne avec son type Postgres : `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum avec ses labels et son vrai nom de type
  (un `pgEnum` lorsque le type est partagé), un tableau sous la forme `<item>.array()`,
  `col.vector({ dimensions })`, les clés d'identité et de série, les valeurs par défaut — formulés comme
  Drizzle les formule. Un type qu'aucun constructeur ne nomme devient
  `col.custom({ dataType: "<sql type>" })`, que Rebase transmet tel que le
  pilote le renvoie ; `db generate` et `db push` le refusent tant que le planificateur
  ne peut pas le planifier
- Déclare la colonne de clé étrangère, le `belongsTo` associé et le
  `hasMany` inverse sur la cible ; une table de jointure devient un `manyToMany`, ses
  propres colonnes devenant le `pivot`
- Lit les politiques de sécurité au niveau des lignes (RLS) de chaque table dans son `rls` : nom,
  commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques `<table>_default_*`
  que Rebase ajoute lui-même sont exclues, afin que le `db push` suivant recrée
  chaque politique telle qu'elle était. Une table avec la sécurité au niveau des lignes activée et sans politique est
  écrite sous la forme `rls: "admin-only"`
- Lit chaque expression (le `USING` d'une politique, un CHECK, une valeur par défaut de colonne) sous
  le `search_path` utilisé par le serveur, `public`, de sorte qu'une fonction dans le
  schéma `rebase` s'écrive `rebase.roles()`
- Convertit un CHECK lisible (`total >= 0`) en `.validate()` sur la colonne, et conserve la contrainte elle-même dans la base de données, où le push suivant la maintiendra. Chaque CHECK est également listé sous « Not carried over » avec son code SQL : un push vers une *nouvelle* base de données crée la validation, pas la contrainte
- Déclare chaque index simple (colonnes uniquement, btree, gin ou brin, sans prédicat) dans les `indexes` de la table. Un index sur une colonne de clé étrangère seule est laissé à la charge de la relation, qui en crée un
- Avec `--from supabase`, convertit les conventions de Supabase pour une base de données que vous quittez : une valeur par défaut de colonne `auth.uid()` devient `.onCreateUser()` (le serveur écrit l'identifiant de l'appelant), une colonne contenant un identifiant utilisateur Supabase (cette valeur par défaut ou une clé étrangère vers `auth.users`) devient `col.text().userId()`, car `rebase.users.id` et `rebase.uid()` sont du texte, et une politique `TO authenticated` / `TO anon` perd le rôle (une base de données Rebase n'a ni l'un ni l'autre) et exige à la place un appelant connecté / non connecté ; une politique réservée à `service_role` est supprimée. Chaque modification est indiquée en haut du fichier de la table. Sans ce flag, ces éléments sont laissés tels quels (Rebase fonctionnant sur la même base de données aux côtés de Supabase en a toujours besoin), et l'exécution indique quand elle les a détectés
- Se termine par ce qu'elle n'a **pas** repris : fonctions, déclencheurs (triggers), extensions, CHECKs, index que `indexes` ne peut formuler, clés étrangères sur plusieurs colonnes ou vers un autre schéma. Le SQL permettant de recréer chaque élément que Postgres peut afficher est écrit dans `backend/sql/_introspected-left-behind.sql`, un brouillon : examinez-le, rendez-le réexécutable en toute sécurité et renommez-le sans le `_` initial, et `rebase db push` ainsi que chaque déploiement l'appliqueront dès qu'il sera modifié
- Vous rappelle que `DATABASE_URL` désigne toujours la base de données qui a été lue : lors d'une migration, c'est la source, et un `db push` exécuté à ce stade écrirait dedans
- Dans un projet headless, remplace le fichier `ai-instructions.md` du scaffold (« the database is the schema ») par les règles schema-in-code réservées au backend tant que le fichier est exactement tel que le scaffold l'a écrit ; un fichier modifié n'est pas touché, et la commande indique lesquelles de ses règles ne s'appliquent plus
- Place ce qu'elle n'a pas pu déclarer avec exactitude dans un commentaire en haut du fichier de la table et sur le terminal — un ensemble fermé de chaînes sur une colonne texte, une colonne générée dont l'expression n'a pas pu être lue, un type personnalisé — avec ce qu'un push lui ferait subir
- Avec `--data-inference`, échantillonne jusqu'à 100 lignes par table et écrit ce qu'elle a
  trouvé qui relève de la présentation — titres, icônes, tableaux de bord (boards), tris, options de champ — dans
  `frontend/src/cms/<table>.tsx` sous forme de `customizeTable`, lorsque le frontend du
  projet dépend de `@rebasepro/cms`. Un projet headless n'en reçoit aucun
- Face à une base de données qui ne fonctionne pas, affiche la même bannière que `db push`,
  une seule fois, et ne crée rien. Elle affiche le répertoire de sortie sous la forme d'un
  chemin absolu

**Options :**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Où écrire les fichiers de tables (par défaut : `backend/schema`). `--output` a été supprimé |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écraser les fichiers de tables déjà existants ; sans cette option, un fichier existant est ignoré |
| `--database-url` | Lire cette base de données au lieu de celle du projet |
| `--docker` | Lire la base de données Compose, en la démarrant si nécessaire |
| `--from supabase` | Convertir les conventions de Supabase (valeurs par défaut `auth.uid()`, clés étrangères `auth.users`, `TO anon` / `TO authenticated`) pour une base de données Rebase. Laissez désactivé lorsque Rebase s'exécute sur la même base de données aux côtés de Supabase |
| `--data-inference` / `--no-data-inference` | Échantillonner jusqu'à 100 lignes par table pour détecter les formats, contraintes et réglages de panneau, ou lire uniquement la structure. Sans l'un ni l'autre, la commande pose la question, et sans terminal, elle lit uniquement la structure |
| `--users` | Écrire également `users.ts` pour `rebase.users`, sous forme d'un `defineAuthTable` qui correspond à la table créée par auth : le fichier pour ajouter des colonnes, des rôles et des hooks à la table d'utilisateurs. Sans cette option, `rebase.users` est servie telle quelle comme table d'utilisateurs |

Cela est utile lors de l'adoption de Rebase sur une base de données existante — introspectez
d'abord, puis modifiez les tables générées. Une table dont la sécurité au niveau des lignes est désactivée est
écrite comme n'importe quelle autre, avec son `rls` ; le push active RLS, et l'exécution à
blanc (dry run) le signale. Un backend qui s'exécute sans aucun `backend/schema` sert
directement la base de données à la place — voir [Backend only](/docs/getting-started/headless/).
Vous quittez Supabase ? Voir [Migrating from Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Pousser les modifications de schéma directement vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les modifications directement à la base de données (CREATE, ALTER, DROP)
- Exécute d'abord le plan à blanc (dry run) et s'arrête avant toute opération détruisant des données : suppression
  d'une table, colonne, schéma, vue ou type, un `TRUNCATE`, ou un changement de type de colonne
  pouvant faire perdre des valeurs (`timestamptz` → `date`, `numeric` → `integer`),
  ou un changement de clé primaire — `(id)` → `(id, locale)` donne à chaque ligne un nouvel identifiant, de sorte que
  les liens, clés étrangères et identifiants stockés ailleurs ne retrouvent plus leur ligne.
  Elle s'arrête également
  avant la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base de données : aucune ligne
  n'est perdue, mais à partir de là, la base de données accepte les lignes qu'elle refusait.
  Elle demande confirmation dans un terminal, où Ctrl-C ou Ctrl-D répond non, et refuse
  sinon ; `--allow-destructive` l'applique tout de même. `--yes` le fait encore dans
  cette version, avec un avertissement de dépréciation ; à partir de la prochaine version, elle n'approuvera
  que les pushs qui ne détruisent rien. Un push qui
  s'arrête là supprime sa base temporaire `<db>_dev_diff` en quittant
- Active la sécurité au niveau des lignes pour chaque table déclarée, jointures incluses, juste après la
  modification du schéma et avant toute étape susceptible d'échouer, de sorte qu'un push interrompu en cours de route laisse une nouvelle table
  refusant toute requête plutôt que totalement ouverte
- Applique les politiques RLS issues de la compilation du `rls` de vos tables, et **supprime les politiques remplacées par un push antérieur**
- Avec `--prune-policies`, supprime également les politiques sur les tables déclarées qu'aucune table ne déclare — celles que l'exécution à blanc liste comme « left in force », telles que les politiques propres à la base de données après le passage d'une table à `rls: "admin-only"` — dans la transaction qui applique les politiques déclarées. L'exécution à blanc liste chacune d'elles sous « Planned row-level security changes », et le push les soumet au même contrôle qu'une colonne supprimée (il demande confirmation sur un terminal, et nécessite ailleurs `--allow-destructive`) : supprimer une politique modifie qui peut lire et écrire les lignes, et la suppression d'une politique `RESTRICTIVE` élargit les accès. Une table que `backend/schema` ne déclare pas, ainsi que le schéma `rebase`, ne sont jamais touchés
- Laisse chaque
  contrainte CHECK et EXCLUDE sur une table déclarée telle quelle. Une table
  ne pouvant déclarer ni l'une ni l'autre, il s'agit des règles propres à la base de données, écrites à la main
  ou héritées d'une base de données adoptée par `schema introspect` ; pour en supprimer une, supprimez-la
  manuellement (`ALTER TABLE … DROP CONSTRAINT …`). Les déclencheurs (triggers) et fonctions que vous avez écrits
  ne sont pas touchés non plus
- Fait correspondre
  exactement le nom de tout ce qu'elle laisse intact, y compris s'il contient
  un `.`, `[`, `]` ou `*`
- Construit tout
  [index de clé étrangère dérivé par Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  manquant sur une table existante **avant** la planification, avec
  `CREATE INDEX CONCURRENTLY`, afin que les écritures sur la table continuent pendant la construction ;
  Atlas le trouve ensuite en place. `--dry-run` les liste et ne construit rien
- Estampille les
  politiques qu'elle applique de la même manière que le démarrage du serveur, de sorte que le premier démarrage après un
  push les laisse intactes au lieu de recréer chacune d'elles
- `--dry-run`
  liste les modifications de sécurité au niveau des lignes que le push effectuerait, sous « Planned
  row-level security changes » : les tables pour lesquelles RLS est activé, et chaque
  politique créée, remplacée ou supprimée, déterminée selon les étapes
  propres au push. Elle n'affiche « No changes » que lorsque ni le schéma ni
  la sécurité au niveau des lignes ne changeraient. Lorsqu'une estampille de politique ne correspond pas à sa
  règle, ou qu'elle n'en a aucune (créée par `db migrate`, écrite à la main), l'exécution
  à blanc la recrée à partir de sa règle sous un autre nom, dans une transaction qu'elle
  annule (rollback), et compare ce que Postgres a stocké : si le résultat est identique, aucun
  changement n'est prévu. Ainsi, une règle que `schema introspect` a relue sous forme de SQL ne planifie rien, et
  les politiques appliquées par `db migrate` non plus. Seule une politique impossible à comparer (verrou
  de table non accordé en moins de deux secondes, par exemple) est listée à part. Le push
  lui-même affiche une seule ligne comptabilisant les changements
- Le signale lorsqu'une instance de `rebase dev` tourne sur la même base de données : elle applique les nouvelles tables et colonnes à chaque enregistrement, donc « No changes » peut signifier qu'elle les a déjà appliquées
- Affiche chaque
  instruction qu'Atlas applique une fois. Atlas se connecte sans SSL à une base de données sur cette
  machine (`localhost`, `127.x`, `::1`) dont l'URL ne spécifie aucun `sslmode`, comme le fait
  l'application, au lieu d'échouer avec `SSL is not enabled on the server` ; une URL qui
  spécifie `sslmode`, ou un autre hôte, est transmise telle qu'écrite. Une exécution d'Atlas
  qui échoue avant la planification ne laisse aucune base `<db>_dev_diff` derrière elle
- `--dry-run`
  n'écrit rien dans le projet : `src/schema.generated.ts` est laissé tel quel,
  et les copies `drizzle/*.sql` qu'une ancienne version a commitées sont mentionnées mais pas
  supprimées. Seule l'entrée du plan est écrite dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Combien de temps cela prend-il ?** La quasi-totalité d'un push correspond au calcul du plan par Atlas : il
construit le schéma souhaité dans une base temporaire et calcule la différence avec la base
réelle, et ce coût augmente plus vite que le nombre de tables — sur un ordinateur portable au repos,
environ 0,25 s par plan pour 11 tables, 0,9 s pour 111 et 5,5 s pour 411. Un push qui
ne change rien planifie une fois ; un push qui modifie quelque chose planifie deux fois (l'exécution à blanc
lue par le garde-fou contre les modifications destructives, puis l'application). Ainsi, un push sur un schéma de
400 tables ou plus prend plusieurs dizaines de secondes, et davantage sur une machine occupée ou lente.
Ce temps est imputable à Atlas, pas à votre base de données : les étapes annexes — génération du
SQL, verrou RLS, recherche, déclencheurs, politiques, rôle — ne prennent que quelques secondes pour
cette taille, sur une seule connexion à votre base de données.

**Les fichiers générés en cours de route**, tous situés sous `.rebase/sql/` dans le répertoire
backend. `db push` et `db generate` écrivent tous les cinq fichiers à partir de vos tables à
chaque exécution, avant d'en lire le moindre, de sorte qu'une copie commitée ne serait lue par
rien. Le répertoire possède son propre `.gitignore` et n'est jamais commité.

| File | Holds |
|------|-------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état souhaité par Atlas, et le seul sur lequel il effectue un diff |
| `policies.sql` | Les politiques RLS issues de la compilation du `rls` de vos tables |
| `search.sql` | Les fonctions de recherche en texte intégral et les colonnes générées, pour les tables avec un bloc `search` |
| `vector.sql` | Extensions pgvector et index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les déclencheurs `BEFORE UPDATE` derrière `.onUpdateNow()` |

Atlas ne gère que le premier et rien d'autre, donc `db push` et la vérification du schéma au
démarrage appliquent eux-mêmes les quatre autres. Un déploiement **basé uniquement sur des migrations** — qui
exécute `db migrate` et jamais `db push` — doit intégrer manuellement ces quatre fichiers dans
une migration ; `db generate` le signale lorsqu'une modification est invisible pour Atlas.

Un projet ayant commité ces fichiers dans `drizzle/` sous une version antérieure voit
ces copies supprimées lors de sa première exécution, et la commande nomme chacune d'elles afin que vous puissiez
commiter la suppression. Elle ne supprime que les fichiers débutant par l'en-tête du
générateur. Un fichier que vous avez écrit vous-même est conservé, tout comme `drizzle/migrations/`.

:::note[Modifier une règle de sécurité renomme sa politique]
Une règle sans `name` explicite compile en `<table>_<op>_<hash>`, où le hash couvre la sémantique de la règle — par conséquent, *modifier* une règle (plutôt que d'en ajouter une) produit une politique sous un nouveau nom et laisse l'ancienne en place.

Cela avait autrefois un impact majeur : Postgres combine les politiques `PERMISSIVE` avec un opérateur OR, de sorte qu'un `USING (rebase.uid() IS NOT NULL)` obsolète continuait à accorder tous les accès, peu importe le niveau de restriction de son remplaçant. Durcir une règle n'avait aucun effet, et push indiquait pourtant un succès.

`db push` réconcilie désormais cela : il supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans les supprimer — les politiques dotées d'un nom personnalisé que vos tables ne décrivent pas, car elles ne peuvent être distinguées de code SQL écrit délibérément à la main.

Pour auditer une base de données sur laquelle un push a été effectué avant l'introduction de cette fonctionnalité, exécutez `rebase doctor --policies`. Elle fonctionne comme une étape bloquante en CI : elle quitte avec un code non nul en cas d'écart, mais aussi lorsqu'elle n'a pas pu exécuter la vérification — pas de `DATABASE_URL`, un chemin `--schema-dir` introuvable, une lecture de `pg_policies` non autorisée pour le rôle CI. Un contrôle qui n'a pas pu vérifier n'est pas validé.

`doctor` et `db push` font la distinction entre les deux types d'orphelines. Une politique avec un nom généré est obsolète, et le push suivant la supprime. Tout autre nom a été écrit à la main ou par un autre outil et reste en vigueur : décrivez-la dans le `rls` de sa table pour la conserver (la vue RLS du Studio l'importe), ou supprimez-la avec `rebase db push --prune-policies` si elle est obsolète.
:::

:::caution
`db push` modifie directement la base de données. Utilisez-le uniquement en développement. Pour la production, utilisez `db generate` + `db migrate` pour créer des fichiers de migration examinables.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle à l'état construit par les migrations dans `drizzle/migrations/`, et non à votre base de données
- Produit des fichiers de migration SQL horodatés dans `backend/drizzle/migrations/`
- Les fichiers peuvent être examinés, modifiés et commités dans le contrôle de version
- Nomme chaque
  instruction de la nouvelle migration qui détruit des données, à l'aide de la même vérification que `db push`
  exécute avant d'appliquer les modifications : suppression d'une table, colonne, schéma, vue ou type, un
  `TRUNCATE`, un changement de type de colonne pouvant perdre des valeurs, un changement de clé
  primaire, ou la suppression d'une contrainte CHECK ou EXCLUDE que la base de données possède. Elle
  écrit tout de même le fichier et se termine avec le code 0 : elle avertit donc sans refuser.
- Indique pour terminer les
  étapes suivantes : `rebase db migrate`, et pour la première migration d'un projet, le
  `--baseline <version>` requis à la place par une base de données déjà initialisée par le démarrage. Une
  migration ultérieure ne reçoit aucune ligne de baseline, car définir un point de référence sur une migration destructive sauterait
  son `DROP`, et une exécution qui n'écrit aucune migration se contente de le mentionner.

**Un CHECK ajouté par l'une de vos migrations est supprimé par la suivante.** `db generate`
calcule le diff entre vos fichiers de migration, pas avec la base de données, et Atlas n'a aucun moyen d'exclure un
objet de ce diff. Par conséquent, une contrainte CHECK ou EXCLUDE que vous avez rédigée à la main dans une
migration, et qu'aucune table ne peut déclarer, réapparaît sous la forme
`ALTER TABLE … DROP CONSTRAINT …` dans la migration suivante qu'il écrit, intégrée dans
la même instruction que le changement réel. Le rapport ci-dessus mentionne cette suppression lorsque
la base de données contient déjà la contrainte ; il ne la retire pas du
fichier. Supprimez la clause avant `rebase db migrate`, ou laissez
`rebase db migrate --refuse-destructive` s'interrompre dessus. `db push` lit la
base de données et conserve la contrainte.

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Exécuter toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit `drizzle/migrations/` à la recherche des migrations non appliquées
- Les applique dans l'ordre à la base de données
- Suit les migrations qui ont été appliquées
- Estampille les
  politiques de sécurité au niveau des lignes comme le font `db push` et le démarrage du serveur, afin
  que le premier démarrage après une migration les laisse intactes au lieu de recréer chacune
  d'elles. Une migration ayant été rédigée à partir des tables de son époque, une politique n'est
  estampillée que lorsqu'elle correspond exactement à ce que sa règle produit actuellement : migrate la recrée
  à partir de sa règle sous un autre nom, dans une transaction qu'elle annule (rollback), et
  compare ce que Postgres a stocké, à la manière de `db push --dry-run`. Une politique qui
  diffère ne reçoit aucune estampille, et le démarrage suivant réapplique sa table

`--refuse-destructive`
la force plutôt à refuser. Elle effectue d'abord une simulation à blanc des migrations en attente. Si une
instruction détruit des données, selon la même vérification que celle employée par `db push` et `db generate`, elle
liste ces instructions et quitte avec le code 1. Elle n'applique rien, pas même les fichiers
précédant cette instruction. Sans ce flag, `db migrate` se comporte comme d'habitude et
applique chaque fichier en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration qui reconstruit une colonne de recherche la supprime d'abord, ce flag refusera
donc également cette migration. Lisez la liste affichée, puis exécutez `rebase db migrate`
sans le flag pour l'appliquer.

#### Définir un point de référence pour une base de données déjà initialisée par Rebase

Chaque démarrage de Rebase s'assure du schéma, et `rebase db push` l'applique directement. Ainsi, une base de données qui a déjà exécuté l'un ou l'autre possède déjà les tables et les types que la première migration créerait. Sur une telle base de données sans historique de migration, `rebase db migrate` n'exécute rien : il nomme les tables déjà présentes ainsi que la commande à exécuter, avec la version de la migration la plus récente préremplie. Il n'enregistre pas la baseline automatiquement.

La migration ne présente aucune anomalie — la base de données a simplement été approvisionnée par un autre moyen. Enregistrez son état actuel une seule fois ; la même commande exécutera les migrations postérieures, et chaque appel ultérieur à `rebase db migrate` fonctionnera normalement :

```bash
rebase db migrate --baseline 20260906101530
```

La version correspond au préfixe numérique du fichier de migration qui décrit ce qui se trouve *actuellement* dans la base de données. Cette migration et tout ce qui la précède sont marqués comme appliqués ; tout ce qui suit est exécuté. Le démarrage ne supprimant ni ne renommant jamais rien, si l'une de ces migrations effectue de telles opérations, définissez la baseline à la version précédant celle-ci. Sur une base de données sur laquelle rien n'a jamais démarré, aucune baseline n'est nécessaire — migrez directement.

La même chose se produit plus tard dans le cycle habituel : modifiez une table pendant que `rebase dev` tourne, et le démarrage ajoute la colonne avant que `rebase db generate` n'écrive la migration qui l'ajoute, de sorte que `rebase db migrate` s'arrête sur `column … already exists (42701)`. Définissez la baseline pour cette migration de la même manière. `--baseline` fonctionne sur une base de données qui enregistre déjà des migrations : elle marque tout jusqu'à la version spécifiée comme appliqué avec `atlas migrate set` et l'indique, ou signale qu'il n'y a rien à enregistrer si l'historique l'atteint déjà. Une version absente de `drizzle/migrations` est refusée avant toute exécution, en affichant les versions existantes.

### `rebase db branch`

Gestion de branches de base de données pour le développement en parallèle :

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (et `switch --off`) ainsi que `rebase db branch prune`
sont nouveaux. `create`, `list`, `info` et `delete` ont été introduits dans la version 0.17.

Chaque branche est une copie complète de la base de données créée avec `CREATE DATABASE ... TEMPLATE`,
elle nécessite donc un véritable serveur PostgreSQL et occupe le même espace disque que sa source.

### `rebase doctor`

Détecter les dérives tripartites entre vos tables, le schéma Drizzle généré et la base de données PostgreSQL en direct :

```bash
rebase doctor
```

**Ce qu'elle vérifie :**
- Tables ↔ Schéma généré — sont-ils synchronisés ?
- Schéma généré ↔ Base de données — y a-t-il des modifications non appliquées ?
- Tables ↔ Base de données — y a-t-il une dérive inattendue ?

Exécutez `doctor` dès que quelque chose semble désynchronisé. La commande indique précisément où se situe le problème.

La comparaison de la base de données inclut celle effectuée au démarrage avant d'avertir que `schema.generated.ts` et la base de données ne concordent pas, exécutée via le même code. Chaque différence signalée au démarrage se retrouve donc également dans le rapport, dans les mêmes termes : une colonne NOT NULL d'un côté et nullable de l'autre, et une colonne toujours présente en base mais absente du fichier (le démarrage n'en supprimant jamais, une propriété renommée laisse son ancienne colonne derrière elle). Chacune constitue un avertissement, et la solution préconise `rebase db push`.

La comparaison de la base de données lit la base du projet, résolue de la même manière que `rebase db url` la résout — sur un scaffold récent, la base gérée, que `doctor` démarre. Si aucune ne peut être résolue, cette phase est signalée comme **ignorée** (skipped) plutôt que réussie, et l'exécution ne se termine jamais par « All schemas are in sync » — une vérification qui n'a pas eu lieu ne vaut pas validation.

Elle liste également chaque table sans [bloc `search`](/docs/backend/search) qui contient plus d'environ 10 000 lignes. Une recherche sur celle-ci — via la barre de recherche d'administration, `.search()`, `?searchString=` — se traduit par un `ILIKE '%term%'` sur les colonnes texte, qu'aucun index ne peut servir, chaque requête lit donc l'intégralité de la table, et son décompte (count) la relit une nouvelle fois (environ un tiers de seconde pour 100 000 lignes, augmentant avec la taille de la table). Le nombre de lignes est l'estimation propre à Postgres, la vérification ne scanne donc rien. Il s'agit d'une indication : cela ne modifie pas le code de sortie, et rien n'est indexé automatiquement pour vous.

Elle signale les **tables de jointure orphelines** : une table `public` ayant la structure d'une jointure many-to-many qu'aucune table ne déclare. Cette structure est composée de deux colonnes formant ensemble la clé primaire, chacune étant une clé étrangère vers une table déclarée. Renommer ou supprimer un `manyToMany` laisse son ancienne table de jointure en arrière-plan, car push et le démarrage ne font que créer des tables, et chaque ligne d'association s'y trouve encore. Cette remarque est purement informative et ne change pas le code de sortie. Sa résolution consiste en l'instruction `DROP TABLE`, que `doctor` affiche mais n'exécute jamais.

### `rebase generate-sdk`

Générer un SDK typé à partir de vos tables :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`, via le chargeur à partir duquel le backend démarre, de sorte que le SDK décrive exactement les tables servies ; un schéma qui ne compile pas l'interrompt
- Génère les types TypeScript pour chaque table dans `generated/sdk/`
- Produit un fichier `database.types.ts` destiné à être utilisé avec `createRebaseClient<Database>()` : le type `Database`, `TableName` (l'union de chaque slug), et `tablesDictionary` / `TablesDictionary`, la correspondance entre l'accesseur et le slug

`rebase dev` exécute cela pour vous au démarrage et à chaque enregistrement dans
`backend/schema/`. Exécutez-le vous-même en CI, dans un dépôt qui ne contient pas ses propres
tables (voir `--from` ci-dessous), ou partout où `rebase dev` ne tourne pas.

**Options :**

| Flag | Description |
|------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`, ou la clé `tables` dans `rebase.json`) ; les chemins relatifs sont résolus à partir de l'emplacement où vous exécutez la commande |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lire le schéma depuis un projet en cours d'exécution au lieu du code source local. `link` utilise le projet lié à cet espace de travail. |
| `--token` | Jeton Bearer pour le point de terminaison du contrat (par défaut : `$REBASE_SERVICE_KEY` depuis le shell ; `.env` n'est pas lu) |
| `--register` | Typer également les données côté serveur : écrit les types et une déclaration `Register` dans `backend/generated/`, et l'enregistre dans `rebase.json` — voir [Données typées côté serveur](/docs/backend/typed-server-data/) |

`--from` permet à un dépôt qui ne contient aucune table — un frontend séparé,
une deuxième application web, une application mobile — de générer un client typé à partir du
projet avec lequel il communique : il lit les `tables` de `/api/meta/contract` du
backend en cours d'exécution. `REBASE_SERVICE_KEY` n'est envoyé qu'au projet auquel cet
espace de travail est lié ; transmettez `--token` explicitement pour tout autre hôte. La clé présente dans
`.env` appartient à votre backend local et n'est jamais envoyée.
Un refus précise ce qui s'est produit : un `--token` refusé, une clé shell refusée, une clé
retenue pour un hôte non lié, une clé présente uniquement dans `.env`, ou aucune clé fournie.

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

Les noms de champs dans les types générés sont ceux servis par l'API. Le nom
réseau d'un champ correspond à sa clé de colonne, et l'API est intégralement en camelCase :
l'introspection écrit une colonne `created_at` sous la forme `createdAt: col.timestamp({ withTimezone: true })`, dont le nom SQL
est la version snake_case de la clé, et la sert sous la forme `row.createdAt`. La colonne
elle-même reste inchangée. L'*accesseur* de la table est transformé en nom de propriété de la
même façon (`my-notes` → `client.data.myNotes`), que `tablesDictionary`
fait correspondre au slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` déplace `config/collections` vers
`backend/schema` (un `defineTable` par collection, chaque colonne explicite à
sa position d'origine, dans la syntaxe Drizzle, et `index.ts` avec
`defaultRls`) et `frontend/src/cms` (un `customizeTable` par collection personnalisée,
les fichiers `defineFirestoreCollection`, `ui-config.json`), écrit
`backend/resources.ts`, `backend/storage.ts` et `backend/generated/register.ts`,
ajoute `rebaseBackendGuard()` au `vite.config.ts` d'un scaffold, puis exécute
`rebase migrate sdk-calls`, qui remplace `.collection(` par `.table(`, applique les
autres renommages du SDK ainsi que les sources de règles `existsIn` / `membership` dans votre code,
et déplace les imports des éléments que la version 0.31 a migrés vers un autre package
([la liste](/docs/upgrading/0-30-to-0-31-imports/)), en ajoutant le package aux
dépendances de l'importateur (« Dependencies added » : exécutez `pnpm install`). Montez de version chaque package `@rebasepro` vers la 0.31 avant de l'exécuter.
Chaque exécution relit le résultat : le SQL généré — DDL, politiques, recherche,
vecteur, déclencheurs, vues, schéma Drizzle — doit être identique au bit près, sinon chaque
fichier est remis en place. Ce qu'elle ne peut pas convertir est refusé en précisant le fichier et la ligne, et
ce qu'elle vous laisse à faire est affiché sous forme d'étapes manuelles numérotées, se terminant par
`rebase skills install` lorsque le projet contient des compétences d'agent (agent skills). Vos propres modules dans
`config/` sont conservés ; l'exécution affiche la ligne `git rm` pour les éléments remplacés. Elle
suit également les collections Firestore construites par une fonction, les alias de chemin, un panneau monté
en dehors de `App.tsx` et chaque application statique non protégée ([la liste complète](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Après le `git rm`, `--check` signale `already-migrated`.

| Flag | Effet |
|---|---|
| `--dry-run` | Affiche les fichiers, refus, notes et étapes manuelles ; n'écrit rien. Commencez par ici. |
| `--check` | Sur un projet migré : prouve que `backend/schema` génère toujours le même SQL. Quitte avec le code 1 avec le diff, ou si une règle change de sens. |
| `--accept-rule-changes` | Avec `--check` : les règles sous « Review before deploying » ont été examinées. |
| `--json` / `--force` / `--skip-sdk-calls` | Le rapport au format JSON (avec `ruleChanges`) ; exécuter sur un arbre de travail non propre ou sur une sortie modifiée ; ne touche pas à votre code. |

Consultez deux listes dans la sortie de son SDK : **« Rewritten by name — review »** (récepteurs
non typés, slots de données, doublures de test) et **« Left unchanged — check each »**
(renommez ceux qui appartiennent au SDK ; [une recherche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) trouve le reste).

La vérification SQL prouve la fidélité de la conversion, mais pas qu'une règle conserve son sens
d'origine. La dernière section de la sortie, **« Review before deploying: these rules change meaning »**,
liste chaque règle dont la politique accorde désormais quelque chose de différent
— un simple `access: "authenticated"` n'accordait rien et autorise désormais tout appelant
connecté ([les quatre formes](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Vérifiez ensuite par rapport à votre base de données : `rebase db push --dry-run` doit afficher « No
changes: the database already matches these tables. », et
`rebase doctor --policies` ne doit montrer aucune dérive.

## Flux de travail en développement

Le flux de travail à itération rapide pour le développement :

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flux de travail en production

Le flux de travail sécurisé et examinable pour la production :

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
| Schema file not updating | Vérifiez que le chemin `--schema-dir` (ou la clé `tables` dans `rebase.json`) pointe vers le bon répertoire |
| Migration shows unexpected changes | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` fails on production | Utilisez `db generate` + `db migrate` à la place |
| A migration must not drop data in CI or production | `rebase db migrate --refuse-destructive` quitte avec le code 1 et n'applique rien lorsqu'une instruction en attente détruit des données |
| `db migrate` stops with "already has the tables your migrations create", or fails with `already exists (42710)` | Le démarrage ou `db push` a déjà approvisionné le schéma — enregistrez-le avec la commande `rebase db migrate --baseline <version>` qu'il affiche |
| `db migrate` fails with `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — définissez la baseline pour cette migration de la même manière |
| `db push` on the managed database fails with `Error: EOF` | Atlas a perdu une connexion détenue par le processus `rebase dev` en cours d'exécution. Réexécutez la commande ; si l'erreur persiste, arrêtez `rebase dev` au préalable |

## Prochaines étapes

- **[Tables](/docs/schema/)** — Définir votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes CLI
- **[SDK typé](/docs/sdk)** — Utiliser le SDK généré
