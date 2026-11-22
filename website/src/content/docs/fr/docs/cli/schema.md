---
sourceHash: 1a01ad3180c225c1
title: Génération de schéma
sidebar_label: Génération de schéma
description: Générez des schémas Drizzle ORM à partir des tables dans backend/schema, créez des migrations SQL, introspectez une base de données existante dans des fichiers defineTable, et gardez votre base de données synchronisée avec la CLI Rebase.
---

## Vue d'ensemble

Rebase utilise un pipeline de **schéma en tant que code** (schema-as-code) où les tables que vous déclarez avec `defineTable` dans `backend/schema/` sont l'unique source de vérité. La CLI les transforme à travers un pipeline déterministe :

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Cette page couvre chaque commande de la CLI impliquée dans ce pipeline.

## Le pipeline

### 1. Tables → Schéma Drizzle

Les tables exportées par `backend/schema/index.ts` décrivent les colonnes, types, relations, énumérations et la sécurité au niveau des lignes (row-level security). Chaque commande ci-dessous les lit via le chargeur utilisé au démarrage du backend ; ainsi, un schéma qui ne compile pas — une table sans `rls`, `"inherit"` sans `defaultRls`, un `defineTable` non exporté par l'index — interrompt la commande avec une `SchemaDefinitionError` précisant chaque problème, et rien n'est écrit. La commande `schema generate` produit un fichier de schéma Drizzle ORM à partir de celles-ci.

Chaque commande qui lit le schéma accepte l'option `--schema-dir <dir>` pour les projets qui conservent leurs tables ailleurs ; la valeur par défaut est `backend/schema`, ou la clé `tables` de l'application backend dans `rebase.json`. L'option `--collections` / `-c`, antérieure à la version 0.31, est refusée avec un message mentionnant le codemod ([`rebase migrate collections-to-tables`](#rebase-migrate)), tout comme un projet contenant encore `config/collections`.

### 2. Schéma Drizzle → Migrations

À partir du schéma Drizzle généré, `db generate` compare les différences avec les migrations déjà présentes dans `backend/drizzle/migrations/`, rejouées sur une base de données temporaire, et produit des fichiers de migration SQL horodatés. La commande ne lit jamais votre base de données : une colonne déjà ajoutée au démarrage ou par `db push` apparaîtra tout de même sous la forme d'un `ADD COLUMN`.

### 3. Migrations → PostgreSQL

La commande `db migrate` applique les migrations en attente à votre base de données PostgreSQL.

## Commandes

### `rebase schema generate`

Générez un fichier de schéma Drizzle ORM à partir de vos tables :

```bash
rebase schema generate
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts`
- Génère `backend/src/schema.generated.ts` avec les définitions de tables, énumérations et relations Drizzle

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--output, -o` | Chemin de sortie pour le fichier de schéma généré ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `--watch, -w` | Surveille les modifications et régénère automatiquement |

Le **mode watch** est utile pendant le développement — modifiez un fichier de table et le schéma est instantanément régénéré :

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Vérifie si le schéma généré correspond toujours aux tables :

```bash
rebase schema stale          # rapport, et quitte avec le code 1 si quelque chose n'est pas à jour
rebase schema stale --fix    # régénère le fichier à la place
```

**Ce qu'elle fait :**
- Calcule ce que les tables de `backend/schema/` génèrent et le compare, déclaration par déclaration, avec `backend/src/schema.generated.ts`
- Indique chaque différence — une table manquante, une colonne dont le type a changé, un libellé d'énumération supprimé, ou des clés étrangères nommées selon la convention d'une version précédente — et quitte avec un code d'erreur non nul
- Avec `--fix`, régénère le fichier au lieu de générer un rapport

`rebase dev` maintient le fichier à jour automatiquement ; cette commande est donc le contrôle idéal pour une étape de build ou de CI. Elle accepte `--schema-dir` et `--output` tout comme `rebase schema generate`.

### `rebase schema reconcile`

Assouplissez et supprimez ce que le démarrage (boot) ne traite pas, après avoir examiné le plan :

```bash
rebase schema reconcile                         # assouplit NOT NULL sur les colonnes devenues nullables ou supprimées
rebase schema reconcile --drop voice_cache.wav  # et supprime une colonne qu'aucune table ne déclare
```

**Ce qu'elle fait :**
- Demande au backend en cours d'exécution d'établir un plan par rapport à sa propre base de données. C'est le backend vers lequel `.env` et la liaison cloud pointent, ce qui fonctionne donc sur Rebase Cloud où rien d'autre ne peut accéder à la base de données.
- Planifie un `DROP NOT NULL` pour chaque colonne déclarée nullable dans une table mais toujours requise par la base de données.
- Liste chaque colonne qui n'est déclarée par aucune table. Une colonne `NOT NULL` sans valeur par défaut bloquant chaque insertion, elle est également assouplie et ses données sont conservées. Elle ne supprime que les colonnes spécifiées avec `--drop <table>.<column>`, et affiche le nombre de lignes contenant une valeur pour chacune d'elles.
- Applique les modifications une fois que vous tapez `yes`. Le serveur n'exécute le plan que sur l'empreinte (digest) de celui que vous avez examiné : si la base de données ou les tables ont changé entre-temps, il refuse et vous devez réexaminer le plan. `--yes` permet d'ignorer la confirmation.

Le démarrage ne fait qu'ajouter des éléments ; par conséquent, après avoir retiré une colonne de son `defineTable`, celle-ci reste dans la base de données avec ses données. Une colonne `NOT NULL` sans valeur par défaut fait alors échouer chaque insertion, et les logs de démarrage suggèrent cette commande pour y remédier : sans `--drop` pour conserver les données, avec `--drop` pour supprimer la colonne. Déployez d'abord la modification de la table, car reconcile s'appuie sur ce que le backend exécute. La commande requiert `REBASE_SERVICE_KEY` dans `.env`. En local, `rebase db push` couvre ce cas grâce à son filtre de modifications destructives.

### `rebase schema introspect`

Générez des fichiers `defineTable` à partir d'une base de données PostgreSQL existante :

```bash
rebase schema introspect
```

**Ce qu'elle fait :**
- Se connecte à la base de données de ce projet, celle affichée par `rebase db url` (la base gérée est démarrée s'il s'agit d'elle) ; `--database-url` permet d'en désigner une autre, et `--docker` utilise celle de Docker Compose
- Lit chaque table, colonne, type, clé étrangère et politique de sécurité, puis écrit `backend/schema/<table>.ts` — un `defineTable` par table — ainsi que le fichier `backend/schema/index.ts` qui les exporte (fusionné avec un index déjà présent le cas échéant)
- Déclare chaque colonne avec son type Postgres : `col.uuid()`, `col.varchar({ length })`, `col.numeric({ precision, scale })`, une énumération avec ses valeurs et son vrai nom de type (un `pgEnum` lorsque le type est partagé), un tableau sous la forme `<item>.array()`, `col.vector({ dimensions })`, les clés identity et serial, les valeurs par défaut — orthographiés selon la syntaxe de Drizzle. Un type non reconnu par un constructeur devient `col.custom({ dataType: "<sql type>" })`, que Rebase transmet tel que retourné par le pilote ; `db generate` et `db push` le refusent jusqu'à ce que le planificateur puisse le gérer
- Déclare la colonne de clé étrangère, la relation `belongsTo` correspondante et la relation inverse `hasMany` sur la cible ; une table de jonction devient un `manyToMany`, avec ses propres colonnes définies comme `pivot`
- Lit les politiques de sécurité au niveau des lignes de chaque table dans sa section `rls` : nom, commande, mode, liste `TO`, `USING` et `WITH CHECK`. Les politiques `<table>_default_*` ajoutées automatiquement par Rebase sont omises, afin que le `db push` suivant recrée chaque politique à l'identique. Une table avec RLS activée mais sans politique est générée avec `rls: "admin-only"`
- Lit chaque expression (le `USING` d'une politique, une contrainte CHECK, une valeur par défaut de colonne) sous le `search_path` utilisé par le serveur, `public`, de sorte qu'une fonction dans le schéma `rebase` soit écrite sous la forme `rebase.roles()`
- Convertit une contrainte CHECK lisible (`total >= 0`) en un `.validate()` sur la colonne, et conserve la contrainte elle-même dans la base de données, où le push suivant la maintiendra. Chaque CHECK est également listé sous « Not carried over » avec son SQL : un push dans une *nouvelle* base de données créera la validation, mais pas la contrainte
- Déclare chaque index standard (colonnes uniquement, btree, gin ou brin, sans prédicat) dans la section `indexes` de la table. Un index reposant uniquement sur une colonne de clé étrangère est délégué à la relation, qui se charge d'en créer un
- Avec `--from supabase`, traduit les conventions de Supabase pour une base de données en cours de migration : une valeur par défaut de colonne égale à `auth.uid()` devient `.onCreateUser()` (le serveur écrit l'identifiant de l'appelant), une colonne contenant un identifiant d'utilisateur Supabase (cette valeur par défaut, ou une clé étrangère vers `auth.users`) devient `col.text().userId()`, étant donné que `rebase.users.id` et `rebase.uid()` sont de type texte, et une politique `TO authenticated` / `TO anon` perd son rôle (une base Rebase n'a ni l'un ni l'autre) et requiert à la place un appelant authentifié / non-authentifié ; une politique réservée à `service_role` est supprimée. Chaque modification est indiquée en haut du fichier de table. Sans cette option, elles sont laissées en l'état (Rebase fonctionnant sur la même base aux côtés de Supabase en ayant toujours besoin), et la commande signale quand elle les a rencontrées
- Se termine par la liste de ce qui n'a **pas** été repris : fonctions, déclencheurs (triggers), extensions, contraintes CHECK, index que `indexes` ne sait pas exprimer, clés étrangères multi-colonnes ou ciblant un autre schéma. Le code SQL permettant de recréer chacun des éléments que Postgres sait exporter est écrit dans `backend/sql/introspected-left-behind.sql`, à examiner et appliquer après le premier push (`psql "$DATABASE_URL" -f …`, ou `rebase cloud db query --file …` sur Rebase Cloud)
- Vous rappelle que `DATABASE_URL` pointe toujours vers la base de données lue : lors d'une migration, il s'agit de la source, et un `db push` à ce moment écrirait dedans
- Dans un projet headless, remplace le fichier `ai-instructions.md` initial (« the database is the schema ») par les règles de schéma-dans-le-code réservées au backend tant que le fichier reste strictement identique à celui généré ; un fichier modifié n'est pas touché, et la commande indique quelles règles ne s'appliquent plus
- Indique ce qu'elle n'a pas pu traduire précisément dans un commentaire en tête du fichier de table et sur le terminal — un ensemble restreint de chaînes sur une colonne texte, une colonne générée dont l'expression n'a pas pu être lue, un type personnalisé — accompagné de ce qu'un push lui appliquerait
- Avec `--data-inference`, échantillonne jusqu'à 100 lignes par table et écrit les éléments de présentation détectés — titres, icônes, tableaux (boards), tris, options de champs — dans `frontend/src/cms/<table>.tsx` sous forme d'un `customizeTable`, lorsque le frontend du projet dépend de `@rebasepro/cms`. Un projet headless n'en reçoit aucun
- Face à une base de données non démarrée, affiche la même bannière que `db push`, une seule fois, et ne crée rien. Elle affiche le répertoire de sortie sous la forme d'un chemin absolu

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Répertoire où écrire les fichiers de tables (par défaut : `backend/schema`). `--output` a été supprimé |
| `--schema` | Schéma Postgres à lire (par défaut : `public`) |
| `--force, -f` | Écrase les fichiers de tables déjà existants ; sans ce flag, les fichiers existants sont ignorés |
| `--database-url` | Lit cette base de données au lieu de celle du projet |
| `--docker` | Lit la base de données Compose, en la démarrant si nécessaire |
| `--from supabase` | Traduit les conventions Supabase (valeurs par défaut `auth.uid()`, clés étrangères `auth.users`, `TO anon` / `TO authenticated`) pour une base Rebase. Laissez-le désactivé lorsque Rebase tourne sur la même base aux côtés de Supabase |
| `--data-inference` / `--no-data-inference` | Échantillonne jusqu'à 100 lignes par table pour détecter formats, contraintes et réglages de panneau, ou lit la structure uniquement. Sans option, une confirmation est demandée, et en l'absence de terminal, seule la structure est lue |

C'est utile lors de l'adoption de Rebase sur une base de données existante — introspectez d'abord, puis modifiez les tables générées. Une table dont la sécurité au niveau des lignes est désactivée est écrite comme les autres, avec sa section `rls` ; le push activera la RLS, et l'exécution à blanc (dry run) le signalera. Un backend qui s'exécute sans aucun `backend/schema` sert directement la base de données — voir [Backend only](/docs/getting-started/headless/). Vous quittez Supabase ? Voir [Migrating from Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Poussez les modifications de schéma directement sur la base de données sans fichiers de migration :

```bash
rebase db push
```

**Ce qu'elle fait :**
- Lit le schéma Drizzle généré
- Applique les modifications directement à la base de données (CREATE, ALTER, DROP)
- Exécute d'abord le plan à blanc et s'arrête avant toute opération destructrice de données : suppression d'une table, colonne, schéma, vue ou type, un `TRUNCATE`, une modification de type de colonne pouvant entraîner une perte de données (`timestamptz` → `date`, `numeric` → `integer`), ou un changement de clé primaire — `(id)` → `(id, locale)` attribuant un nouvel identifiant à chaque ligne, les liens, clés étrangères et identifiants stockés ailleurs ne trouveront plus leur ligne. La commande s'arrête également avant la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base : aucune ligne n'est perdue, mais la base acceptera désormais des lignes qu'elle refusait auparavant. Une confirmation est demandée sur le terminal (où Ctrl-C ou Ctrl-D répond par la négative), et la commande refuse d'aller plus loin autrement ; `--allow-destructive` applique malgré tout les changements. L'option `--yes` fonctionne encore dans cette version avec un avertissement de dépréciation ; à partir de la prochaine version, elle n'approuvera que les opérations sans destruction. Un push interrompu à cette étape supprime sa base temporaire `<db>_dev_diff` en quittant
- Active la sécurité au niveau des lignes pour chaque table déclarée, jonctions comprises, juste après la modification du schéma et avant toute étape susceptible d'échouer, de sorte qu'un push interrompu à mi-chemin laisse une nouvelle table bloquant chaque requête plutôt que totalement ouverte
- Applique les politiques RLS issues de la compilation de la section `rls` de vos tables, et **supprime les politiques remplacées par un push précédent**
- <span class="since-badge" data-since="0.35">Depuis 0.35</span> Avec `--prune-policies`, supprime également les politiques des tables déclarées qui ne sont spécifiées par aucune table — celles que l'exécution à blanc liste sous « left in force », comme les politiques propres à la base de données après le passage d'une table à `rls: "admin-only"` — dans la même transaction que celle appliquant les politiques déclarées. L'exécution à blanc liste chacune d'elles sous « Planned row-level security changes », et le push les filtre de la même manière qu'une colonne supprimée (il demande confirmation sur un terminal, et requiert ailleurs `--allow-destructive`) : supprimer une politique modifie les droits de lecture et d'écriture sur les lignes, et supprimer une politique `RESTRICTIVE` élargit les accès. Une table non déclarée dans `backend/schema` et le schéma `rebase` ne sont jamais touchés
- Conserve chaque contrainte CHECK et EXCLUDE sur une table déclarée telle quelle. Une table ne pouvant déclarer ni l'une ni l'autre, il s'agit de règles propres à la base de données, écrites manuellement ou héritées d'une base adoptée via `schema introspect` ; pour en retirer une, supprimez-la manuellement (`ALTER TABLE … DROP CONSTRAINT …`). Les déclencheurs (triggers) et fonctions que vous avez écrits ne sont pas touchés non plus
- Fait correspondre exactement le nom de tout élément laissé inchangé, y compris s'il contient un `.`, `[`, `]` ou `*`
- Construit tout [index de clé étrangère déduit par Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you) manquant sur une table existante **avant** la planification, avec `CREATE INDEX CONCURRENTLY`, afin que les écritures sur la table puissent se poursuivre pendant la construction ; Atlas le trouve ensuite en place. `--dry-run` les liste sans rien construire
- Estampille les politiques appliquées de la même manière que le démarrage du serveur, de sorte que le premier démarrage après un push les conserve telles quelles au lieu de les recréer une par une
- `--dry-run` répertorie les modifications de sécurité au niveau des lignes que le push apporterait, sous « Planned row-level security changes » : les tables pour lesquelles la RLS est activée, et chaque politique créée, remplacée ou supprimée, déterminée selon les étapes internes du push. Il affiche « No changes » uniquement lorsque ni le schéma ni la sécurité au niveau des lignes ne changent. Lorsqu'une estampille de politique ne correspond pas à sa règle, ou qu'elle n'en a pas (créée par `db migrate` ou écrite à la main), l'exécution à blanc la recrée à partir de sa règle sous un autre nom, dans une transaction annulée (rollback), et compare avec ce que Postgres a stocké : un résultat identique est considéré sans changement. Ainsi, une règle que `schema introspect` a relue sous forme de SQL ne planifie rien, tout comme les politiques appliquées par `db migrate`. Seule une politique impossible à comparer (par exemple, si le verrou sur sa table n'a pas été obtenu en deux secondes) est listée à part. Le push lui-même affiche une ligne résumant le nombre de modifications
- Avertit lorsqu'une instance de `rebase dev` s'exécute sur la même base de données : appliquant les nouvelles tables et colonnes à chaque sauvegarde, « No changes » peut signifier qu'elles ont déjà été appliquées
- Affiche chaque instruction exécutée par Atlas une seule fois. Atlas se connecte sans SSL à une base de données sur cette machine (`localhost`, `127.x`, `::1`) dont l'URL ne mentionne aucun `sslmode`, comme le fait l'application, au lieu d'échouer sur `SSL is not enabled on the server` ; une URL précisant un `sslmode`, ou un autre hôte, est transmise telle quelle. Une exécution d'Atlas qui échoue avant la planification ne laisse aucune base `<db>_dev_diff` résiduelle
- `--dry-run` n'écrit aucun fichier du projet : `src/schema.generated.ts` reste intact, et les copies `drizzle/*.sql` commitées par une ancienne version sont signalées, sans être supprimées. Seules les données d'entrée du plan vont dans `.rebase/sql/`, qui n'est pas commité
- Ne crée **pas** de fichiers de migration

**Durée d'exécution.** La quasi-totalité d'un push est consacrée au calcul du plan par Atlas : il génère votre schéma cible dans une base temporaire et le compare à la base réelle, un coût qui augmente plus vite que le nombre de tables — sur un ordinateur portable au repos, environ 0,25 s par plan pour 11 tables, 0,9 s pour 111 et 5,5 s pour 411. Un push qui ne modifie rien planifie une seule fois ; un push apportant des changements planifie deux fois (l'exécution à blanc lue par la vérification des modifications destructives, puis l'application). Ainsi, un push sur un schéma de 400 tables ou plus prend plusieurs dizaines de secondes, voire davantage sur une machine lente ou occupée. Ce temps est imputable à Atlas, non à votre base de données : les étapes annexes — génération du SQL, verrouillage RLS, recherche, déclencheurs, politiques, rôles — ne prennent que quelques secondes pour cette taille, sur une unique connexion à votre base.

**Les fichiers générés en cours de route**, tous situés sous `.rebase/sql/` dans le répertoire backend. `db push` et `db generate` écrivent tous les cinq à partir de vos tables à chaque exécution, avant d'en lire le moindre, de sorte qu'une copie commitée ne serait lue par rien. Le répertoire possède son propre `.gitignore` et n'est jamais commité.

| Fichier | Contenu |
|---------|---------|
| `schema.sql` | Tables, colonnes, contraintes et index — l'état cible pour Atlas, et le seul qu'il compare |
| `policies.sql` | Les politiques RLS générées à partir de la section `rls` de vos tables |
| `search.sql` | Fonctions de recherche plein texte et colonnes générées, pour les tables avec un bloc `search` |
| `vector.sql` | Extensions pgvector et index ANN |
| `triggers.sql` | `rebase.set_updated_at()` et les déclencheurs `BEFORE UPDATE` derrière `.onUpdateNow()` |

Atlas ne gère que le premier fichier ; `db push` et la synchronisation de schéma au démarrage appliquent donc les quatre autres eux-mêmes. Un déploiement **basé uniquement sur les migrations** — qui exécute `db migrate` et jamais `db push` — doit intégrer manuellement ces quatre éléments dans une migration ; `db generate` le signale lorsqu'une modification est invisible pour Atlas.

Un projet ayant commité ces fichiers dans `drizzle/` sous une version antérieure voit ces copies supprimées lors de sa première exécution, et la commande nomme chacune d'elles afin que vous puissiez commiter la suppression. Elle ne supprime que les fichiers commençant par l'en-tête du générateur. Un fichier rédigé par vos soins est conservé, tout comme `drizzle/migrations/`.

:::note[Modifier une règle de sécurité renomme sa politique]
Une règle sans `name` explicite est compilée en `<table>_<op>_<hash>`, où le hash couvre la sémantique de la règle — ainsi, *modifier* une règle (plutôt que d'en ajouter une) produit une politique sous un nouveau nom et laisse l'ancienne en place.

Cela avait une grande importance autrefois : Postgres combine les politiques `PERMISSIVE` avec un opérateur OR logique, si bien qu'une règle obsolète `USING (rebase.uid() IS NOT NULL)` continuait d'accorder tous les droits, quelle que soit la sévérité de sa remplaçante. Durcir une règle restait sans effet, et push indiquait un succès.

`db push` réconcilie désormais cela : la commande supprime les politiques générées qui ne correspondent plus à aucune règle, et signale — sans les supprimer — les politiques personnalisées non décrites dans vos tables, celles-ci ne pouvant être distinguées de code SQL rédigé volontairement.

Pour auditer une base de données sur laquelle un push a été effectué avant l'introduction de cette fonctionnalité, exécutez `rebase doctor --policies`. Cela fonctionne comme un contrôle CI : un code de retour non nul est renvoyé en cas de dérive, mais également si la vérification n'a pas pu être effectuée du tout — pas de `DATABASE_URL`, un chemin `--schema-dir` introuvable, ou une absence de droits sur `pg_policies` pour le rôle CI. Un contrôle qui n'a pas pu vérifier n'a pas réussi.

`doctor` et `db push` distinguent les deux types d'éléments orphelins. Une politique dotée d'un nom généré est obsolète, et le prochain push la supprimera. Tout autre nom provient d'une saisie manuelle ou d'un autre outil et reste en vigueur : décrivez-la dans le bloc `rls` de sa table pour la conserver (la vue RLS de Studio l'importe), ou supprimez-la avec `rebase db push --prune-policies` si elle n'est plus utile.
:::

:::caution
`db push` modifie directement la base de données. Utilisez-le uniquement en développement. Pour la production, utilisez `db generate` + `db migrate` pour créer des fichiers de migration examinables.
:::

### `rebase db generate`

Générez des fichiers de migration SQL à partir des modifications du schéma :

```bash
rebase db generate
```

**Ce qu'elle fait :**
- Compare le schéma Drizzle à l'état construit par les migrations dans `drizzle/migrations/`, et non à votre base de données
- Produit des fichiers de migration SQL horodatés dans `backend/drizzle/migrations/`
- Les fichiers peuvent être examinés, modifiés et commités dans le gestionnaire de versions
- Identifie chaque instruction de la nouvelle migration susceptible de détruire des données, selon la même vérification que celle effectuée par `db push` avant application : suppression d'une table, colonne, schéma, vue ou type, un `TRUNCATE`, un changement de type de colonne pouvant perdre des valeurs, une modification de clé primaire, ou la suppression d'une contrainte CHECK ou EXCLUDE présente dans la base. Le fichier est tout de même écrit et la commande renvoie 0, affichant un simple avertissement sans bloquer.
- Conclut par les étapes à suivre : `rebase db migrate`, ou pour la première migration d'un projet, l'option `--baseline <version>` requise si un démarrage précédent de la base l'a déjà initialisée. Une migration ultérieure ne mentionne aucune ligne de baseline, car baseliner une modification destructive contournerait son instruction `DROP` ; si aucune migration n'est écrite, la commande se contente de l'indiquer.

**Une contrainte CHECK ajoutée par l'une de vos migrations est supprimée par la suivante.** `db generate` calcule le différentiel entre vos fichiers de migration et non avec la base de données, et Atlas n'a aucun moyen d'exclure un objet de ce différentiel. Par conséquent, une contrainte CHECK ou EXCLUDE ajoutée manuellement dans une migration et qu'aucune table ne peut déclarer réapparaîtra sous la forme `ALTER TABLE … DROP CONSTRAINT …` dans la migration suivante, combinée à la même instruction que le changement réel. Le rapport ci-dessus signale cette suppression lorsque la base contient déjà la contrainte ; il ne la retire pas du fichier. Supprimez cette clause avant `rebase db migrate`, ou laissez `rebase db migrate --refuse-destructive` s'interrompre dessus. `db push` lit quant à lui la base de données et préserve la contrainte.

Les migrations générées sont de simples fichiers SQL — vous pouvez les inspecter et les modifier avant de les appliquer.

### `rebase db migrate`

Exécutez toutes les migrations en attente :

```bash
rebase db migrate
```

**Ce qu'elle fait :**
- Lit `drizzle/migrations/` à la recherche des migrations non appliquées
- Les applique dans l'ordre à la base de données
- Enregistre les migrations qui ont été appliquées
- Estampille les politiques de sécurité au niveau des lignes de la même façon que `db push` et le démarrage du serveur, afin que le premier démarrage après une migration les conserve sans les recréer une à une. Une migration ayant été rédigée à partir de l'état des tables de son époque, une politique n'est estampillée que si elle correspond exactement à ce que sa règle produit aujourd'hui : migrate la recrée à partir de sa règle sous un autre nom, dans une transaction annulée (rollback), et compare avec ce que Postgres a stocké, à la manière de `db push --dry-run`. Une politique qui diffère ne reçoit aucune estampille, et le prochain démarrage réappliquera sa table

`--refuse-destructive` force l'interruption en cas de risque. La commande exécute d'abord les migrations en attente à blanc. Si une instruction détruit des données, selon le même critère que `db push` et `db generate`, elle liste ces instructions et quitte avec le code 1. Rien n'est appliqué, pas même les fichiers précédant cette instruction. Sans ce flag, `db migrate` conserve son comportement par défaut et applique tous les fichiers en attente :

```bash
rebase db migrate --refuse-destructive
```

Une migration qui reconstruit une colonne de recherche commence par la supprimer, ce flag refusera donc également cette migration. Lisez la liste affichée, puis exécutez `rebase db migrate` sans ce flag pour l'appliquer.

#### Définir la baseline d'une base de données déjà démarrée par Rebase

Chaque démarrage de Rebase valide le schéma, et `rebase db push` l'applique directement. Ainsi, une base de données ayant déjà exécuté l'un ou l'autre possède déjà les tables et types que la première migration créerait, et `rebase db migrate` s'arrête avec l'erreur `pq: type "posts_status" already exists (42710)`.

Il n'y a aucun problème avec la migration — la base de données a simplement été approvisionnée par un autre moyen. Enregistrez son état actuel, puis effectuez la migration normalement :

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La version correspond au préfixe numérique du fichier de migration décrivant l'état *actuel* de la base de données. Cette migration et toutes celles qui la précèdent sont enregistrées comme appliquées ; tout ce qui suit sera exécuté. Sur une base de données sur laquelle aucun démarrage n'a jamais eu lieu, aucune baseline n'est nécessaire — effectuez la migration directement.

La même chose se produit plus tard dans le cycle classique : modifiez une table pendant que `rebase dev` s'exécute, et le boot ajoutera la colonne avant que `rebase db generate` n'écrive la migration correspondante ; `rebase db migrate` s'arrêtera alors sur `column … already exists (42701)`. Définissez la baseline pour cette migration de la même manière. `--baseline` fonctionne sur une base qui enregistre déjà des migrations : elle marque tout jusqu'à ladite version comme appliqué via `atlas migrate set` et le confirme, ou indique qu'il n'y a rien à enregistrer si l'historique l'atteint déjà. Une version qui ne correspond à aucun fichier dans `drizzle/migrations` est rejetée avant toute action, en listant les versions disponibles.

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

`rebase db branch switch` (et `switch --off`) ainsi que `rebase db branch prune` sont récents. `create`, `list`, `info` et `delete` sont disponibles depuis la version 0.17.

Chaque branche est une copie intégrale de la base de données créée à l'aide de `CREATE DATABASE ... TEMPLATE` ; elle nécessite donc un véritable serveur PostgreSQL et consomme le même espace disque que sa source.

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

La comparaison de la base de données inclut celle que le démarrage effectue avant d'avertir d'un désaccord entre `schema.generated.ts` et la base, exécutée via le même code. Chaque différence signalée au boot figure donc également dans le rapport, dans les mêmes termes : une colonne NOT NULL d'un côté et nullable de l'autre, ou une colonne présente dans la base mais absente du fichier (le boot n'en supprimant jamais, une propriété renommée laisse son ancienne colonne en place). Chacune est un avertissement, et la solution préconisée indique `rebase db push`.

La comparaison de la base lit la base du projet, résolue de la même façon que `rebase db url` — sur un projet fraîchement initialisé, la base gérée, que `doctor` démarre. Si aucune base ne peut être résolue, cette phase est signalée comme **ignorée** (skipped) plutôt que réussie, et l'exécution ne se termine jamais par « All schemas are in sync » — une vérification non effectuée ne vaut pas validation.

Elle signale également chaque table dépourvue de [bloc `search`](/docs/backend/search) contenant plus d'environ 10 000 lignes. Une recherche sur ces tables — via la zone de recherche de l'admin, `.search()`, `?searchString=` — effectue un `ILIKE '%term%'` sur les colonnes texte, qu'aucun index ne peut accélérer ; chacune d'elles lit donc toute la table, et le comptage la relit à nouveau (environ un tiers de seconde pour 100 000 lignes, augmentant avec la taille de la table). Le nombre de lignes correspond à l'estimation interne de Postgres, l'analyse ne scanne donc rien. Il s'agit d'une simple indication : elle ne modifie pas le code de sortie et rien n'est indexé automatiquement pour vous.

Elle signale les **jonctions orphelines** : une table `public` ayant la structure d'une table de jonction many-to-many mais qu'aucune table ne déclare. Cette structure est composée de deux colonnes formant ensemble la clé primaire, chacune étant une clé étrangère vers une table déclarée. Renommer ou supprimer un `manyToMany` laisse l'ancienne jonction en place, car push et boot ne font que créer des tables, et toutes les lignes d'association y restent stockées. Cette remarque est purement informative et ne change pas le code de sortie. Sa résolution consiste en l'instruction `DROP TABLE`, que `doctor` affiche sans jamais l'exécuter.

### `rebase generate-sdk`

Générez un SDK typé à partir de vos tables :

```bash
rebase generate-sdk
```

**Ce qu'elle fait :**
- Lit les tables exportées par `backend/schema/index.ts` via le chargeur utilisé au boot du backend, de sorte que le SDK décrive exactement les tables servies ; un schéma qui ne compile pas interrompt l'opération
- Génère les types TypeScript pour chaque table dans `generated/sdk/`
- Produit un fichier `database.types.ts` à utiliser avec `createRebaseClient<Database>()` : le type `Database`, `TableName` (l'union de tous les slugs), et `tablesDictionary` / `TablesDictionary`, le mappage entre accesseur et slug

`rebase dev` l'exécute pour vous au démarrage et à chaque sauvegarde sous `backend/schema/`. Exécutez-la vous-même en CI, dans un dépôt qui ne possède pas ses propres tables (voir `--from` ci-dessous), ou n'importe où où `rebase dev` n'est pas lancé.

**Options :**

| Option | Description |
|--------|-------------|
| `--schema-dir` | Le répertoire du schéma (par défaut : `backend/schema`, ou la clé `tables` dans `rebase.json`) ; les chemins relatifs sont résolus à partir de l'endroit où vous exécutez la commande |
| `-o`, `--output` | Répertoire de sortie pour le SDK (par défaut : `generated/sdk/`) |
| `--from <link\|url>` | Lit le schéma depuis un projet en cours d'exécution au lieu de la source locale. `link` utilise le projet lié à ce checkout. |
| `--token` | Jeton Bearer pour le endpoint de contrat (par défaut : `$REBASE_SERVICE_KEY` depuis le shell ; `.env` n'est pas lu) |
| `--register` | Type également les données côté serveur : écrit les types et une déclaration `Register` dans `backend/generated/`, et l'enregistre dans `rebase.json` — voir [Données typées côté serveur](/docs/backend/typed-server-data/) |

`--from` permet à un dépôt ne contenant aucune table — un frontend séparé, une seconde application web, une application mobile — de générer un client typé à partir du projet avec lequel il communique : il lit les `tables` depuis `/api/meta/contract` du backend en cours d'exécution. `REBASE_SERVICE_KEY` n'est envoyée qu'au projet auquel ce checkout est lié ; passez explicitement `--token` pour tout autre hôte. La clé présente dans `.env` appartient à votre backend local et n'est jamais envoyée. En cas de refus, l'erreur précise la cause : un `--token` refusé, une clé shell refusée, une clé retenue pour un hôte non lié, une clé présente uniquement dans `.env`, ou aucune clé fournie.

**Utilisation après la génération :**

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

Les noms de champs dans les types générés correspondent à ceux servis par l'API. Le nom réseau d'un champ est sa clé de colonne, et l'API adopte le camelCase partout : l'introspection écrit une colonne `created_at` sous la forme `createdAt: col.timestamp({ withTimezone: true })`, dont le nom SQL est le snake_case de la clé, et la sert sous la forme `row.createdAt`. La colonne elle-même n'est pas modifiée. L'*accesseur* de table est converti en nom de propriété de la même façon (`my-notes` → `client.data.myNotes`), ce que `tablesDictionary` fait correspondre au slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` déplace `config/collections` vers `backend/schema` (un `defineTable` par collection, chaque colonne explicite à sa position d'origine dans la syntaxe Drizzle, et `index.ts` avec `defaultRls`) et `frontend/src/cms` (un `customizeTable` par collection personnalisée, les fichiers `defineFirestoreCollection`, `ui-config.json`), écrit `backend/resources.ts`, `backend/storage.ts` et `backend/generated/register.ts`, ajoute `rebaseBackendGuard()` au `vite.config.ts` d'origine, puis exécute `rebase migrate sdk-calls`, qui remplace `.collection(` par `.table(`, applique les autres renommages du SDK ainsi que les sources de règles `existsIn` / `membership` dans votre code, et déplace les imports pour les éléments déplacés vers un autre package en 0.31 ([la liste](/docs/upgrading/0-30-to-0-31-imports/)), en ajoutant le package aux dépendances de l'importateur (« Dependencies added » : lancez `pnpm install`). Mettez à niveau tous les packages `@rebasepro` vers la version 0.31 avant de l'exécuter. Chaque exécution relit le résultat : le SQL généré — DDL, politiques, recherche, vectoriel, déclencheurs, vues, schéma Drizzle — doit être identique à l'octet près, sous peine de rétablir tous les fichiers. Ce qui ne peut pas être converti est rejeté avec indication du fichier et de la ligne, et ce qui doit être traité manuellement s'affiche sous forme d'étapes numérotées, se terminant par `rebase skills install` si le projet contient des compétences d'agent (agent skills). Vos propres modules dans `config/` sont conservés ; la commande affiche la ligne `git rm` pour ce qui a été remplacé. Elle prend également en charge les collections Firestore construites par une fonction, les alias de chemins, un panneau monté en dehors de `App.tsx` et toute application statique non protégée ([la liste complète](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)). Après le `git rm`, `--check` indique `already-migrated`.

| Option | Effet |
|---|---|
| `--dry-run` | Affiche les fichiers, refus, notes et étapes manuelles sans rien écrire. Commencez par ici. |
| `--check` | Sur un projet migré : vérifie que `backend/schema` produit toujours le même SQL. Renvoie un code 1 en cas de différence ou si une règle change de sens. |
| `--accept-rule-changes` | Avec `--check` : confirme que les règles sous « Review before deploying » ont été examinées. |
| `--json` / `--force` / `--skip-sdk-calls` | Le rapport au format JSON (avec `ruleChanges`) ; exécution sur un arbre de travail non propre ou sur une sortie modifiée ; ne touche pas à votre code. |

Lisez les deux listes dans la sortie du SDK : **« Rewritten by name — review »** (récepteurs non typés, slots de données, doublures de test) et **« Left unchanged — check each »** (renommez ceux qui appartiennent au SDK ; [une recherche](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) permet de trouver le reste).

La vérification SQL garantit la fidélité de la conversion, mais pas qu'une règle conserve le même sens. La dernière section de la sortie, **« Review before deploying: these rules change meaning »**, liste chaque règle dont la politique accorde désormais des droits différents — un simple `access: "authenticated"` n'accordait rien et autorise désormais tout utilisateur connecté ([les quatre formes](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)). Vérifiez ensuite par rapport à votre base de données : `rebase db push --dry-run` devrait afficher « No changes: the database already matches these tables. », et `rebase doctor --policies` aucune dérive.

## Flux de travail en développement

Le flux de travail à itération rapide pour le développement :

```bash
# 1. Modifiez une table dans backend/schema/
# 2. Générez le schéma Drizzle
rebase schema generate

# 3. Poussez directement sur la base de données de développement
rebase db push
```

## Flux de travail en production

Le flux de travail sécurisé et vérifiable pour la production :

```bash
# 1. Modifiez une table dans backend/schema/
# 2. Générez le schéma Drizzle
rebase schema generate

# 3. Générez les fichiers de migration SQL
rebase db generate

# 4. Examinez le SQL généré dans backend/drizzle/migrations/
# 5. Commitez la migration dans le gestionnaire de versions
git add backend/drizzle/migrations/

# 6. Appliquez en production
#    Une base de données déjà démarrée par Rebase nécessite une baseline la première fois —
#    voir "Définir la baseline d'une base de données déjà démarrée par Rebase" ci-dessus.
rebase db migrate
```

## Dépannage

| Symptôme | Solution |
|----------|----------|
| `Could not detect an active database plugin` | Installez `@rebasepro/server-postgres` dans `backend/package.json` |
| Le fichier de schéma ne se met pas à jour | Vérifiez que le chemin `--schema-dir` (ou la clé `tables` dans `rebase.json`) pointe vers le bon répertoire |
| La migration montre des modifications inattendues | Exécutez `rebase doctor` pour identifier la dérive |
| `db push` échoue en production | Utilisez `db generate` + `db migrate` à la place |
| Une migration ne doit pas supprimer de données en CI ou en production | `rebase db migrate --refuse-destructive` quitte avec le code 1 et n'applique rien lorsqu'une instruction en attente détruit des données |
| `db migrate` échoue avec `already exists (42710)` | Le démarrage ou `db push` a déjà initialisé le schéma — enregistrez-le avec `rebase db migrate --baseline <version>` |
| `db migrate` échoue avec `column … already exists (42701)` | `rebase dev` a ajouté la colonne au démarrage — définissez la baseline pour cette migration de la même manière |
| `db push` sur la base de données gérée échoue avec `Error: EOF` | Atlas a perdu une connexion détenue par l'instance `rebase dev` en cours d'exécution. Relancez-la ; si l'erreur persiste, arrêtez d'abord `rebase dev` |

## Étapes suivantes

- **[Tables](/docs/schema/)** — Définissez votre modèle de données
- **[CLI Reference](/docs/cli)** — Toutes les commandes de la CLI
- **[Typed SDK](/docs/sdk)** — Utilisez le SDK généré
