---
sourceHash: 06945ca1e787897f
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des tables dans backend/schema, créez des migrations SQL, introspectez une base de données existante dans des fichiers defineTable, et maintenez votre base de données synchronisée avec la CLI Rebase.
---

## Aperçu

Rebase utilise un pipeline **schema-as-code** où les tables que vous déclarez avec
`defineTable` dans `backend/schema/` constituent l'unique source de vérité. La CLI
les transforme à travers un pipeline déterministe :

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Cette page couvre l'ensemble des commandes CLI impliquées dans ce pipeline.

## Le pipeline

### 1. Tables → Schéma Drizzle

Les tables exportées par `backend/schema/index.ts` décrivent les colonnes, les types, les relations,
les énumérations et la sécurité au niveau des lignes (RLS). Chaque commande ci-dessous les lit via le chargeur
utilisé au démarrage du backend ; ainsi, un schéma qui ne compile pas — une table sans
`rls`, `"inherit"` sans `defaultRls`, un `defineTable` non exporté par l'index — interrompt
la commande avec une `SchemaDefinitionError` précisant chaque problème, et rien n'est écrit.
La commande `schema generate` génère un fichier de schéma Drizzle ORM à partir de ces tables.

Chaque commande lisant le schéma accepte l'option `--schema-dir <dir>` pour les projets
qui stockent leurs tables ailleurs ; la valeur par défaut est `backend/schema`, ou la
clé `tables` de l'application backend dans `rebase.json`. `--collections` / `-c`, l'option
antérieure à la version 0.31, est refusée avec un message indiquant le codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), tout comme un projet
contenant encore `config/collections`.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` calcule le différentiel par rapport aux migrations déjà présentes dans `backend/drizzle/migrations/`, rejouées sur une base de données temporaire (scratch), et produit des fichiers de migration SQL horodatés. Il ne lit jamais votre base de données : une colonne déjà ajoutée au démarrage ou via `db push` apparaîtra tout de même sous forme de `ADD COLUMN`.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente à votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

Génère un fichier de schéma Drizzle ORM à partir de vos tables :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les énumérations et les relations

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--watch, -w` | Surveille les modifications et régénère automatiquement |

Le **mode watch** est pratique pendant le développement — modifiez un fichier de table et le schéma est régénéré instantanément :

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Vérifie si le schéma généré correspond toujours aux tables :

```bash
rebase schema stale          # rapport, et code de sortie 1 si un élément est obsolète
rebase schema stale --fix    # régénère le fichier à la place
```

**Ce qu'elle fait :**
- Calcule ce que les tables dans `backend/schema/` génèrent et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Indique chaque différence — une table manquante, une colonne retypée, un label d'énumération supprimé ou des clés étrangères nommées selon une version antérieure — et se termine avec un code de sortie non nul
- Avec `--fix`, régénère le fichier au lieu de simplement afficher le rapport

`rebase dev` maintient ce fichier à jour automatiquement ; cette commande sert donc de vérification lors du build ou dans une étape de CI. Elle accepte `--schema-dir` et `--output` tout comme `rebase schema generate`.

### `rebase schema reconcile`

Assouplit et supprime ce que le démarrage ignore, après examen du plan :

```bash
rebase schema reconcile                         # assouplit NOT NULL sur les colonnes devenues nullables ou supprimées
rebase schema reconcile --drop voice_cache.wav  # et supprime une colonne qu'aucune table ne déclare
```

**Ce qu'elle fait :**
- Demande au backend en cours d'exécution de générer un plan par rapport à sa propre base de données. C'est celle vers laquelle pointent le `.env` et le lien cloud du backend, ce qui fonctionne donc sur Rebase Cloud où rien d'autre n'accède à la base de données.
- Prévoit un `DROP NOT NULL` pour chaque colonne déclarée nullable par une table mais toujours requise par la base de données.
- Liste chaque colonne qu'aucune table ne déclare. Une colonne `NOT NULL` sans valeur par défaut bloquant chaque insertion, elle est également assouplie et ses données sont conservées. Elle ne supprime que les colonnes indiquées avec `--drop <table>.<column>`, et affiche le nombre de lignes contenant une valeur pour chacune.
- S'applique après avoir saisi `yes`. Le serveur exécute le plan uniquement sur l'empreinte (digest) de celui que vous avez examiné : si la base de données ou les tables ont changé entre-temps, il refuse et vous devez examiner le plan à nouveau. `--yes` permet d'ignorer la confirmation.

Le démarrage ne fait qu'ajouter des éléments ; par conséquent, après avoir retiré une colonne de son `defineTable`, la colonne reste dans la base de données avec ses données. Une colonne `NOT NULL` sans valeur par défaut fait alors échouer chaque insertion, et les logs de démarrage indiquent cette commande pour y remédier : sans `--drop` pour préserver les données, ou avec pour supprimer la colonne. Déployez d'abord la modification de la table, car la réconciliation s'appuie sur ce que le backend exécute. Elle nécessite `REBASE_SERVICE_KEY` dans le fichier `.env`. En local, `rebase db push` couvre ce cas grâce à son contrôle des modifications destructives.

### `rebase schema introspect`

Génère des fichiers `defineTable` à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à la base de données du projet, celle affichée par `rebase db url` (la base gérée est démarrée s'il s'agit d'elle) ; `--database-url` permet d'en spécifier une autre, et `--docker` utilise celle de Docker Compose
- Lit chaque table, colonne, type, clé étrangère et politique de sécurité, puis écrit `backend/schema/<table>.ts` — un `defineTable` par table — et le fichier `backend/schema/index.ts` qui les exporte (fusionné dans un index existant s'il est déjà présent)
- Déclare chaque colonne avec son type Postgres : `col.uuid()`, `col.varchar({ length })`, `col.numeric({ precision, scale })`, une énumération avec ses valeurs et son vrai nom de type (un `pgEnum` lorsque le type est partagé), un tableau sous forme de `<item>.array()`, `col.vector({ dimensions })`, les clés identity et serial, les valeurs par défaut — avec la syntaxe de Drizzle. Un type non reconnu par les builders devient `col.custom({ dataType: "<sql type>" })`, que Rebase renvoie tel que le pilote le fournit ; `db generate` et `db push` le refuseront jusqu'à ce que le planificateur puisse le gérer
- Déclare la colonne de clé étrangère, le `belongsTo` associé et le `hasMany` inverse sur la cible ; une table de jonction devient un `manyToMany`, ses propres colonnes constituant le `pivot`
- Lit les politiques de sécurité au niveau des lignes (RLS) de chaque table dans son `rls` : nom, commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques `<table>_default_*` ajoutées automatiquement par Rebase sont omises, afin que le `db push` ultérieur recrée chaque politique à l'identique. Une table avec RLS activé mais sans politique est générée avec `rls: "admin-only"`
- Lit chaque expression (`USING` d'une politique, CHECK, valeur par défaut d'une colonne) selon le `search_path` utilisé par le serveur (`public`), ainsi une fonction du schéma `rebase` s'écrit `rebase.roles()`
- Transforme un CHECK lisible (`total >= 0`) en `.validate()` sur la colonne, et conserve la contrainte dans la base de données, où le push suivant la maintiendra. Chaque CHECK est également listé sous « Not carried over » avec son SQL : un push vers une *nouvelle* base créera la validation, mais pas la contrainte
- Déclare chaque index simple (colonnes uniquement, btree, gin ou brin, sans prédicat) dans le bloc `indexes` de la table. Un index portant uniquement sur une clé étrangère est laissé à la charge de la relation, qui en crée un
- Avec `--from supabase`, convertit les conventions de Supabase pour une base de données en cours de migration : une valeur par défaut `auth.uid()` devient `.onCreateUser()` (le serveur écrit l'ID de l'appelant), une colonne stockant un ID utilisateur Supabase (cette valeur par défaut, ou une clé étrangère vers `auth.users`) devient `col.text().userId()`, car `rebase.users.id` et `rebase.uid()` sont de type text, et une politique `TO authenticated` / `TO anon` perd son rôle (une base Rebase n'a ni l'un ni l'autre) pour exiger à la place un appelant connecté / déconnecté ; une politique réservée à `service_role` est supprimée. Chaque modification est annotée en haut du fichier de la table. Sans cette option, ces éléments sont conservés tels quels (Rebase tournant sur la même base aux côtés de Supabase en a encore besoin), et l'exécution indique quand elle les a détectés
- Se termine par la liste de ce qui n'a **pas** été conservé : fonctions, déclencheurs (triggers), extensions, contraintes CHECK, index non représentables dans `indexes`, clés étrangères composites ou pointant vers un autre schéma. Le SQL permettant de recréer chaque élément lisible par Postgres est consigné dans `backend/sql/_introspected-left-behind.sql` (un brouillon) : vérifiez-le, rendez-le idempotent, renommez-le en retirant le `_` initial, et `rebase db push` ainsi que chaque déploiement l'appliqueront dès qu'il est modifié
- Rappelle que `DATABASE_URL` pointe toujours vers la base de données lue : dans une migration, il s'agit de la source, et un `db push` immédiat écrirait dedans
- Dans un projet headless, remplace le fichier `ai-instructions.md` du template (« the database is the schema ») par les règles du schema-in-code réservé au backend tant que le fichier est strictement identique à l'original généré ; un fichier modifié reste inchangé, et la commande indique quelles règles ne sont plus valables
- Ajoute les éléments impossibles à définir exactement dans un commentaire en tête du fichier de la table et dans le terminal — un ensemble fini de chaînes sur une colonne texte, une colonne générée dont l'expression n'a pas pu être lue, un type personnalisé — en précisant l'effet qu'aurait un push sur ceux-ci
- Avec `--data-inference`, échantillonne jusqu'à 100 lignes par table et consigne les éléments de présentation détectés — titres, icônes, tableaux (boards), tris, options de champ — dans `frontend/src/cms/<table>.tsx` sous forme de `customizeTable`, lorsque le frontend du projet dépend de `@rebasepro/cms`. Un projet headless n'en reçoit aucun
- Face à une base de données arrêtée, affiche la même bannière que `db push`, une seule fois, et ne crée rien. Le répertoire de sortie est affiché sous forme de chemin absolu

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Emplacement où écrire les fichiers de tables (par défaut : `backend/schema`). L'option `--output` a été supprimée |
| `--schema` | Le schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écrase les fichiers de table existants ; sans cette option, un fichier existant est ignoré |
| `--database-url` | Lit cette base de données au lieu de celle du projet |
| `--docker` | Lit la base de données Docker Compose, en la démarrant si nécessaire |
| `--from supabase` | Traduit les conventions de Supabase (valeurs par défaut `auth.uid()`, clés étrangères `auth.users`, `TO anon` / `TO authenticated`) pour une base Rebase. À désactiver si Rebase tourne sur la même base aux côtés de Supabase |
| `--data-inference` / `--no-data-inference` | Échantillonne jusqu'à 100 lignes par table pour détecter les formats, contraintes et réglages de panneaux, ou lit la structure uniquement. En l'absence de ces options, une invite s'affiche, et sans terminal interactif, seule la structure est lue |
| `--users` | Génère également `users.ts` pour `rebase.users`, sous forme d'un `defineAuthTable` correspondant à la table créée par l'auth. Cela affiche la table Users dans l'admin pour vous permettre d'y ajouter des colonnes. Sans cette option, les comptes sont gérés dans l'espace Users & Roles du Studio |

Cette commande est utile lors de l'adoption de Rebase sur une base de données existante : faites d'abord une introspection, puis éditez les tables générées. Une table dont la sécurité au niveau des lignes est désactivée est générée comme les autres, avec son `rls` ; le push activera le RLS, ce que confirmera la simulation (dry-run). Un backend fonctionnant sans aucun dossier `backend/schema` sert directement la base de données — voir [Backend only](/docs/getting-started/headless/).
Vous quittez Supabase ? Consultez [Migration depuis Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Pousse directement les modifications de schéma vers la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les modifications directement sur la base de données (CREATE, ALTER, DROP)
- Simule le plan d'abord et s'interrompt avant toute opération destructive de données : table, colonne, schéma, vue ou type supprimé, un `TRUNCATE`, une modification de type de colonne risquant d'entraîner une perte de données (`timestamptz` → `date`, `numeric` → `integer`), ou un changement de clé primaire — `(id)` → `(id, locale)` attribue un nouvel identifiant à chaque ligne, rompant les liens, clés étrangères et identifiants stockés ailleurs. La commande s'arrête également avant la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base : aucune ligne n'est perdue, mais la base acceptera désormais des lignes auparavant refusées.
  Une invite interactive demande confirmation (Ctrl-C ou Ctrl-D valant un refus) et bloque le processus en mode non-interactif ; `--allow-destructive` permet de forcer l'application. `--yes` fonctionne encore dans cette version avec un avertissement d'obsolescence ; dès la prochaine version, il n'autorisera que les pushs sans perte de données. Un push interrompu à cette étape supprime sa base temporaire `<db>_dev_diff` avant de quitter
- Active la sécurité au niveau des lignes pour chaque table déclarée, y compris les tables de jonction, immédiatement après la modification du schéma et avant toute étape susceptible d'échouer ; ainsi, un push échouant en cours de route laisse la nouvelle table fermée à toute requête plutôt qu'ouverte à tous
- Applique les politiques RLS issues de la compilation du bloc `rls` de vos tables, et **supprime les politiques rendues obsolètes par un push antérieur**
- <span class="since-badge" data-since="0.35">Depuis 0.35</span> Avec `--prune-policies`, supprime également les politiques présentes sur les tables déclarées mais non définies par une table — celles indiquées par la simulation comme « left in force », comme les politiques natives après le passage d'une table en `rls: "admin-only"` — au sein de la transaction appliquant les politiques déclarées. La simulation les liste sous « Planned row-level security changes », et le push les soumet au même contrôle qu'une colonne supprimée (invite sur le terminal, ou `--allow-destructive` ailleurs) : supprimer une politique modifie les droits de lecture et d'écriture, et retirer une politique `RESTRICTIVE` élargit les accès. Une table non déclarée dans `backend/schema` ainsi que le schéma `rebase` ne sont jamais modifiés
- Laisse inchangée chaque contrainte CHECK et EXCLUDE sur une table déclarée. Une table ne pouvant déclarer ni l'une ni l'autre, il s'agit de règles propres à la base, écrites manuellement ou importées via `schema introspect` ; pour en supprimer une, faites-le manuellement (`ALTER TABLE … DROP CONSTRAINT …`). Les déclencheurs et fonctions créés par vos soins ne sont pas altérés non plus
- Fait correspondre le nom de chaque élément préservé à l'identique, y compris s'il contient des caractères comme `.`, `[`, `]` ou `*`
- Construit tout [index de clé étrangère déduit par Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you) manquant sur une table existante **avant** la planification, via `CREATE INDEX CONCURRENTLY`, afin que les écritures sur la table ne soient pas bloquées ; Atlas le détecte ensuite sur place. `--dry-run` les liste sans rien construire
- Applique une signature aux politiques créées selon le même mécanisme qu'au démarrage du serveur, afin que le premier démarrage suivant un push ne recrée pas inutilement chaque politique
- `--dry-run` liste les modifications de sécurité au niveau des lignes que le push effectuerait, sous « Planned row-level security changes » : les tables pour lesquelles le RLS est activé, et chaque politique créée, remplacée ou supprimée. La mention « No changes » n'apparaît que si ni le schéma ni le RLS ne sont modifiés. Si la signature d'une politique ne correspond pas à sa règle, ou si elle n'en a aucune (créée par `db migrate` ou manuellement), la simulation la recrée temporairement sous un autre nom dans une transaction annulée (rollback) et compare le résultat enregistré par Postgres : s'ils sont identiques, aucun changement n'est planifié. Ainsi, une règle relue sous forme de SQL par `schema introspect` ou appliquée par `db migrate` ne planifie aucune modification. Seules les politiques impossibles à comparer (verrou de table non accordé sous deux secondes, par exemple) sont isolées. Le push affiche ensuite une ligne récapitulant le nombre de changements
- Indique si une instance de `rebase dev` tourne sur la même base de données : appliquant les nouvelles tables et colonnes à l'enregistrement, « No changes » peut signifier qu'elles sont déjà appliquées
- Affiche chaque instruction exécutée par Atlas une seule fois. Atlas se connecte sans SSL aux bases de données locales (`localhost`, `127.x`, `::1`) dont l'URL ne précise pas de `sslmode`, comme le fait l'application, évitant l'erreur `SSL is not enabled on the server` ; une URL stipulant un `sslmode` ou un hôte distant est transmise telle quelle. Une exécution Atlas échouant avant la planification ne laisse aucune base `<db>_dev_diff`
- `--dry-run` n'écrit rien dans le projet : `src/schema.generated.ts` reste intact, et les copies `drizzle/*.sql` commitées par une ancienne version sont signalées sans être supprimées. Seules les entrées du plan sont écrites dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Temps d'exécution.** L'essentiel du temps d'un push est consacré au calcul du plan par Atlas : il construit le schéma cible dans une base temporaire et le compare à la base réelle. Ce coût augmente plus rapidement que le nombre de tables — sur un ordinateur portable au repos, environ 0,25 s par plan pour 11 tables, 0,9 s pour 111 et 5,5 s pour 411 tables. Un push sans modification planifie une fois ; un push avec modifications planifie deux fois (la simulation lue par la vérification de modifications destructives, puis l'application). Ainsi, un push sur un schéma de 400 tables ou plus prend plusieurs dizaines de secondes, et davantage sur une machine chargée ou lente. Ce délai incombe à Atlas, pas à votre base : les étapes environnantes — génération du SQL, verrous RLS, recherche, triggers, politiques, rôle — ne prennent que quelques secondes pour cette taille, sur une seule connexion.

**Fichiers générés en cours de route**, tous situés dans `.rebase/sql/` au sein du répertoire backend. `db push` et `db generate` écrivent ces cinq fichiers à partir de vos tables à chaque exécution, avant d'en lire le moindre ; une copie commitée ne serait donc jamais lue. Le dossier contient son propre `.gitignore` et ne doit jamais être commité.

| Fichier | Contenu |
|---------|---------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état cible pour Atlas, et le seul qu'il compare |
| `policies.sql` | Les politiques RLS issues de la compilation du bloc `rls` de vos tables |
| `search.sql` | Les fonctions de recherche plein texte et colonnes générées pour les tables ayant un bloc `search` |
| `vector.sql` | Extensions pgvector et index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les déclencheurs `BEFORE UPDATE` derrière `.onUpdateNow()` |

Atlas ne gère que le premier fichier ; `db push` et le schéma au démarrage appliquent donc eux-mêmes les quatre autres. Un déploiement reposant **uniquement sur les migrations** — exécutant `db migrate` et jamais `db push` — doit intégrer manuellement ces quatre éléments dans une migration ; `db generate` le signale dès qu'un changement échappe à Atlas.

Si un projet avait commité ces fichiers dans `drizzle/` sous une version antérieure, ces copies sont supprimées à la première exécution, la commande listant chaque suppression pour vous permettre de la commiter. Elle ne supprime que les fichiers débutant par l'en-tête du générateur. Vos propres fichiers sont conservés, tout comme `drizzle/migrations/`.

:::note[Modifier une règle de sécurité renomme sa politique]
Une règle dépourvue de `name` explicite est compilée sous la forme `<table>_<op>_<hash>`, où le hash résume la sémantique de la règle — ainsi, *modifier* une règle (plutôt qu'en ajouter une) produit une politique sous un nouveau nom tout en laissant l'ancienne en place.

Auparavant, cela posait un problème majeur : Postgres combinant les politiques `PERMISSIVE` avec un opérateur OR, une politique obsolète contenant `USING (rebase.uid() IS NOT NULL)` continuait d'accorder tous les droits, quelle que soit la restriction de sa remplaçante. Durcir une règle n'avait aucun effet et le push se soldait pourtant par un succès.

`db push` réconcilie désormais cette situation : il supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans les supprimer — les politiques personnalisées non décrites par vos tables, celles-ci étant indifférenciables de SQL rédigé intentionnellement.

Pour auditer une base de données ayant reçu un push avant l'introduction de ce mécanisme, exécutez `rebase doctor --policies`. Cela fonctionne comme un contrôle en CI : la commande quitte avec un code non nul en cas de divergence, ou si la vérification n'a pas pu être exécutée (absence de `DATABASE_URL`, chemin `--schema-dir` introuvable, permissions insuffisantes sur `pg_policies` pour le rôle CI). Un contrôle qui n'a pas pu s'exécuter n'est pas considéré comme validé.

`doctor` et `db push` distinguent les deux types d'éléments orphelins. Une politique au nom généré est considérée comme obsolète et le prochain push la supprimera. Tout autre nom provient d'une saisie manuelle ou d'un autre outil et reste actif : décrivez-le dans le `rls` de la table pour le conserver (la vue RLS de Studio sait l'importer), ou supprimez-le via `rebase db push --prune-policies` s'il est périmé.
:::

:::caution
`db push` modifie directement la base de données. Utilisez-le uniquement en environnement de développement. Pour la production, utilisez `db generate` + `db migrate` afin de produire des fichiers de migration révisables.
:::

### `rebase db generate`

Génère des fichiers de migration SQL à partir des modifications du schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle à l'état produit par les migrations dans `drizzle/migrations/`, et non à votre base de données réelle
- Génère des fichiers de migration SQL horodatés dans `backend/drizzle/migrations/`
- Ces fichiers peuvent être examinés, édités et commités dans votre gestionnaire de versions
- Liste chaque instruction de la nouvelle migration susceptible de détruire des données, selon le contrôle effectué par `db push` avant application : suppression de table, colonne, schéma, vue ou type, `TRUNCATE`, changement de type risquant de corrompre des données, modification de clé primaire, ou retrait d'une contrainte CHECK ou EXCLUDE. Le fichier est tout de même écrit et la commande retourne le code 0 : il s'agit d'un avertissement, pas d'un refus.
- Conclut sur la marche à suivre : exécuter `rebase db migrate`, et dans le cas d'une première migration d'un projet, indique la commande `--baseline <version>` nécessaire si la base a déjà été configurée au démarrage. Une migration ultérieure ne mentionne pas de ligne de baseline (une migration destructive baselined ignorerait son `DROP`), et une exécution ne générant aucune migration se contente de le signaler.

**Une contrainte CHECK ajoutée par l'une de vos migrations sera supprimée à la suivante.** `db generate` compare vos fichiers de migration et non la base de données, et Atlas ne peut exclure un objet de ce différentiel. Par conséquent, une contrainte CHECK ou EXCLUDE ajoutée manuellement dans une migration, qu'aucune table ne peut déclarer, réapparaîtra sous la forme `ALTER TABLE … DROP CONSTRAINT …` dans la migration suivante, intégrée dans la même instruction que le changement réel. Le rapport signale cette suppression si la contrainte existe déjà en base ; il ne la retire pas du fichier. Supprimez cette clause avant de lancer `rebase db migrate`, ou laissez `rebase db migrate --refuse-destructive` bloquer l'opération. `db push`, quant à lui, lit la base et conserve la contrainte.

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Applique toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Parcourt `drizzle/migrations/` à la recherche des migrations non appliquées
- Les applique dans l'ordre sur la base de données
- Consigne les migrations appliquées
- Applique une signature aux politiques RLS selon le même procédé que `db push` et le démarrage du serveur, afin que le premier redémarrage suivant la migration ne recrée pas l'ensemble des politiques. Une migration ayant été conçue d'après les tables de son époque, une politique n'est signée que si elle correspond strictement à ce que sa règle produit aujourd'hui : migrate la recrée temporairement sous un autre nom dans une transaction annulée et compare le résultat stocké par Postgres, comme le fait `db push --dry-run`. Une politique différente ne reçoit pas de signature, et le prochain démarrage réappliquera sa table

`--refuse-destructive`
force la commande à refuser l'exécution le cas échéant. Elle simule d'abord les migrations en attente. Si une instruction détruit des données, selon les mêmes critères que `db push` et `db generate`, elle liste les instructions en cause et quitte avec le code 1. Rien n'est appliqué, pas même les fichiers précédant cette instruction. Sans cette option, `db migrate` conserve son comportement d'origine et applique chaque fichier en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration qui reconstruit une colonne de recherche commence par la supprimer : cette option refusera donc également cette migration. Consultez la liste affichée, puis relancez `rebase db migrate` sans l'option pour l'appliquer.

#### Initialiser la base de référence (baselining) d'une base déjà démarrée par Rebase

Chaque démarrage de Rebase valide le schéma, et `rebase db push` l'applique directement. Une base ayant déjà exécuté l'un ou l'autre possède donc déjà les tables et les types que la première migration tenterait de créer, provoquant l'échec de `rebase db migrate` avec l'erreur `pq: type "posts_status" already exists (42710)`.

La migration n'est pas en cause : la base de données a simplement été approvisionnée par un autre moyen. Enregistrez son état actuel, puis migrez normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version correspond au préfixe numérique du fichier de migration décrivant l'état *actuel* de la base de données. Cette migration et toutes les précédentes sont marquées comme appliquées ; les suivantes sont exécutées. Sur une base vierge n'ayant jamais démarré avec Rebase, aucune baseline n'est requise : vous pouvez migrer directement.

Le même cas se présente plus tard dans le cycle de travail habituel : modifiez une table pendant que `rebase dev` tourne, et le démarrage ajoutera la colonne avant que `rebase db generate` n'écrive la migration correspondante, provoquant l'erreur `column … already exists (42701)` lors de `rebase db migrate`. Définissez la baseline sur cette migration de la même façon. `--baseline` fonctionne sur une base qui enregistre déjà des migrations : elle marque tout jusqu'à la version indiquée comme appliqué avec `atlas migrate set` et le confirme, ou indique qu'il n'y a rien à enregistrer si l'historique l'atteint déjà. Une version absente des fichiers de `drizzle/migrations` est rejetée avant toute exécution, en affichant les versions disponibles.

### `rebase db branch`

Gestion des branches de base de données pour le développement en parallèle :

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (ainsi que `switch --off`) et `rebase db branch prune`
sont récents. `create`, `list`, `info` et `delete` sont disponibles depuis la version 0.17.

Chaque branche est une copie intégrale de la base de données réalisée via `CREATE DATABASE ... TEMPLATE` ; elle nécessite donc un véritable serveur PostgreSQL et occupe le même espace disque que sa source.

### `rebase doctor`

Détecte les divergences (drift) triangulaires entre vos tables, le schéma Drizzle généré et la base de données PostgreSQL active :

```bash
rebase doctor
```

**Ce qu'elle vérifie :**
- Tables ↔ Schéma généré — sont-ils synchronisés ?
- Schéma généré ↔ Base de données — y a-t-il des changements non appliqués ?
- Tables ↔ Base de données — y a-t-il une dérive inattendue ?

Exécutez `doctor` dès qu'un élément semble désynchronisé. Il identifiera précisément où se situe l'incohérence.

La comparaison avec la base inclut celle que le démarrage effectue avant d'avertir d'un désaccord entre `schema.generated.ts` et la base, via le même code. Chaque différence signalée au démarrage se retrouve donc dans le rapport, dans les mêmes termes : une colonne NOT NULL d'un côté et nullable de l'autre, ou une colonne toujours en base mais absente du fichier (le démarrage ne supprimant rien, une propriété renommée laisse l'ancienne colonne en place). Chaque cas génère un avertissement, et la solution préconise `rebase db push`.

La comparaison lit la base de données du projet, résolue comme le fait `rebase db url` — sur un projet fraîchement initialisé, il s'agit de la base gérée, que `doctor` démarre. Si aucune base ne peut être résolue, cette étape est signalée comme **ignorée (skipped)** plutôt que validée, et l'exécution ne se conclut jamais par « All schemas are in sync » — une vérification non effectuée ne constitue pas une confirmation de bon fonctionnement.

La commande signale également toute table sans [bloc `search`](/docs/backend/search) contenant plus d'environ 10 000 lignes. Une recherche sur une telle table — la barre de recherche de l'admin, `.search()`, `?searchString=` — se traduit par un `ILIKE '%term%'` sur les colonnes texte, qu'aucun index ne peut optimiser ; chaque requête lit donc la table en entier, et le décompte la relit une seconde fois (environ un tiers de seconde pour 100 000 lignes, augmentant avec la taille de la table). Le nombre de lignes correspond à l'estimation propre de Postgres, la vérification ne scanne donc rien. Il s'agit d'un conseil : cela ne change pas le code de sortie, et aucun index n'est créé automatiquement.

Elle identifie également les **tables de jonction orphelines** : une table `public` structurée comme une relation many-to-many qu'aucune table ne déclare. Il s'agit d'une table à deux colonnes formant ensemble la clé primaire, chacune étant une clé étrangère vers une table déclarée. Renommer ou supprimer une relation `manyToMany` laisse son ancienne table de jonction en arrière-plan, car le push et le démarrage ne font que créer des tables, et toutes les lignes de liaison y figurent toujours. Cette remarque est purement informative et ne modifie pas le code de sortie. Sa résolution passe par l'instruction `DROP TABLE`, que `doctor` affiche sans jamais l'exécuter.

### `rebase generate-sdk`

Génère un SDK typé à partir de vos tables :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts` via le chargeur utilisé au démarrage du backend, afin que le SDK décrive précisément les tables servies ; un schéma qui ne compile pas interrompt le processus
- Génère les types TypeScript pour chaque table dans `generated/sdk/`
- Produit un fichier `database.types.ts` utilisable avec `createRebaseClient<Database>()` : le type `Database`, `TableName` (l'union de tous les slugs), ainsi que `tablesDictionary` / `TablesDictionary`, qui fait le pont entre l'accesseur et le slug

`rebase dev` l'exécute pour vous au démarrage et à chaque enregistrement dans `backend/schema/`. Exécutez-le vous-même en CI, dans un dépôt ne disposant pas de ses propres tables (voir `--from` ci-dessous), ou dès lors que `rebase dev` n'est pas lancé.

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`, ou la clé `tables` dans `rebase.json`) ; les chemins relatifs sont résolus à partir de l'endroit où la commande est lancée |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lit le schéma depuis un projet en cours d'exécution plutôt que les sources locales. `link` utilise le projet lié à cet environnement de travail |
| `--token` | Jeton Bearer pour le endpoint contractuel (par défaut : `$REBASE_SERVICE_KEY` depuis l'environnement shell ; le fichier `.env` n'est pas lu) |
| `--register` | Type également les données côté serveur : écrit les types et une déclaration `Register` dans `backend/generated/`, et le mémorise dans `rebase.json` — voir [Données typées côté serveur](/docs/backend/typed-server-data/) |

`--from` permet à un dépôt ne contenant aucune table — un frontend séparé, une seconde application web, une application mobile — de générer un client typé à partir du projet avec lequel il communique : il lit les `tables` exposées sur `/api/meta/contract` du backend actif. `REBASE_SERVICE_KEY` n'est transmis qu'au projet auquel l'environnement actuel est lié ; transmettez explicitement `--token` pour tout autre hôte. La clé présente dans `.env` appartient à votre backend local et n'est jamais transmise. En cas de refus, la raison est précisée : un `--token` refusé, une clé shell refusée, une clé retenue pour un hôte non lié, une clé présente uniquement dans `.env`, ou aucune clé fournie.

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

Les noms de champs dans les types générés correspondent à ceux renvoyés par l'API. Le nom transmis sur le réseau est la clé de sa colonne, et l'API adopte le camelCase sur l'ensemble du périmètre : l'introspection écrit une colonne `created_at` sous la forme `createdAt: col.timestamp({ withTimezone: true })`, dont le nom SQL est la version snake_case de la clé, et la sert en tant que `row.createdAt`. La colonne elle-même reste inchangée. L'*accesseur* de table est transformé en nom de propriété selon le même principe (`my-notes` → `client.data.myNotes`), que `tablesDictionary` rattache au slug initial.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` déplace `config/collections` vers `backend/schema` (un `defineTable` par collection, chaque colonne définie explicitement à sa position d'origine avec la syntaxe Drizzle, et un `index.ts` avec `defaultRls`) et vers `frontend/src/cms` (un `customizeTable` par collection personnalisée, les fichiers `defineFirestoreCollection`, `ui-config.json`), génère `backend/resources.ts`, `backend/storage.ts` et `backend/generated/register.ts`, ajoute `rebaseBackendGuard()` au `vite.config.ts` du template, puis lance `rebase migrate sdk-calls`, qui remplace `.collection(` par `.table(`, applique les renommages du SDK ainsi que les sources de règles `existsIn` / `membership` dans votre code, et déplace les imports de noms transférés vers un autre paquet en 0.31 ([la liste](/docs/upgrading/0-30-to-0-31-imports/)), en ajoutant le paquet aux dépendances du fichier importateur (« Dependencies added » : lancez `pnpm install`). Mettez à jour tous les paquets `@rebasepro` vers la version 0.31 avant de lancer cette commande.
Chaque exécution relit le résultat produit : le SQL généré — DDL, politiques, recherche, vecteurs, déclencheurs, vues, schéma Drizzle — doit être rigoureusement identique au bit près, sans quoi tous les fichiers sont restaurés. Tout ce qui ne peut être migré est refusé en mentionnant le fichier et la ligne, et les opérations manuelles restantes sont affichées sous forme d'étapes numérotées, se terminant par `rebase skills install` si le projet intègre des compétences d'agents (agent skills). Vos propres modules dans `config/` sont conservés ; la commande affiche la commande `git rm` pour les éléments remplacés. Elle prend également en charge les collections Firestore générées par des fonctions, les alias de chemins, les panneaux montés hors de `App.tsx` et chaque application statique non protégée ([la liste complète](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)). Après le `git rm`, `--check` retourne `already-migrated`.

| Option | Effet |
|--------|-------|
| `--dry-run` | Affiche les fichiers, refus, notes et étapes manuelles ; n'écrit rien. Commencez par ici. |
| `--check` | Sur un projet migré : vérifie que `backend/schema` génère toujours le même SQL. Retourne 1 avec le diff, ou si une règle change de comportement. |
| `--accept-rule-changes` | Avec `--check` : confirme que les règles sous « Review before deploying » ont été examinées. |
| `--json` / `--force` / `--skip-sdk-calls` | Rapport au format JSON (avec `ruleChanges`) ; exécution sur un arbre de travail non propre ou écrasement de modifications ; préserve votre code. |

Examinez deux listes dans la sortie du SDK : **« Rewritten by name — review »** (récepteurs non typés, slots de données, doublures de tests) et **« Left unchanged — check each »** (renommez ceux qui proviennent du SDK ; [une recherche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) permet de trouver le reste).

La vérification SQL garantit la fidélité de la conversion, mais n'assure pas qu'une règle conserve sa signification initiale. La dernière section de la sortie, **« Review before deploying: these rules change meaning »**, liste chaque règle dont la politique accorde désormais des droits différents — un simple `access: "authenticated"` n'accordait rien auparavant et autorise désormais tout appelant connecté ([les quatre cas de figure](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Vérifiez ensuite par rapport à votre base de données : `rebase db push --dry-run` doit afficher « No changes: the database already matches these tables. », et `rebase doctor --policies` ne doit montrer aucune dérive.

## Flux de développement

Le flux de travail recommandé pour itérer rapidement en développement :

```bash
# 1. Modifier une table dans backend/schema/
# 2. Générer le schéma Drizzle
rebase schema generate

# 3. Pousser directement vers la base de dev
rebase db push
```

## Flux de production

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
#    Une base déjà démarrée par Rebase nécessite une baseline la première fois —
#    voir "Initialiser la base de référence (baselining) d'une base déjà démarrée par Rebase" ci-dessus.
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|----------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Le fichier de schéma ne se met pas à jour | Vérifiez que le chemin `--schema-dir` (ou la clé `tables` dans `rebase.json`) pointe vers le bon dossier |
| La migration montre des changements inattendus | Lancez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez plutôt `db generate` + `db migrate` |
| Une migration ne doit pas supprimer de données en CI ou en production | `rebase db migrate --refuse-destructive` retourne 1 et n'applique rien dès qu'une instruction en attente risque de détruire des données |
| `db migrate` échoue avec `already exists (42710)` | Le démarrage ou `db push` a déjà créé le schéma — enregistrez son état avec `rebase db migrate --baseline <version>` |
| `db migrate` échoue avec `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — créez la baseline pour cette migration de la même manière |
| `db push` sur la base de données gérée échoue avec `Error: EOF` | Atlas a perdu une connexion détenue par l'instance `rebase dev` active. Relancez la commande ; si l'erreur persiste, arrêtez d'abord `rebase dev` |

## Étapes suivantes

- **[Tables](/docs/schema/)** — Définir votre modèle de données
- **[Référence CLI](/docs/cli)** — Toutes les commandes de la CLI
- **[SDK Typé](/docs/sdk)** — Utiliser le SDK généré
