---
sourceHash: 68cf15088ac8b29f
title: Commandes de base de données
sidebar_label: Commandes de base de données
description: Les commandes rebase db — push, generate et migrate, sauvegardes et restaurations, extraction d'une copie, chaîne de connexion, base de données de développement gérée et branches.
---

## Vue d'ensemble

`rebase db` est la famille de commandes qui interagissent avec la base de données du projet. Chacune opère sur la base de données résolue par le projet, selon l'ordre listé dans [Création de branches de base de données](/docs/backend/branching/#cli-integration) :
`--database-url`, puis `DATABASE_URL` dans le shell, la branche sur laquelle le checkout est positionné, `DATABASE_URL` dans `.env`, `--docker`, et sinon la base de données de développement gérée démarrée par `rebase dev`. `rebase db url` affiche de laquelle il s'agit.

`request-role` et `provision` sont destinées aux bases de données que Rebase ne contrôle pas directement ; voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).
`push`, `generate` et `migrate` sont décrites en détail dans [Génération de schéma](/docs/cli/schema/), et toutes les autres commandes figurent dans la [Référence de la CLI](/docs/cli/).

## Commandes

### `rebase db push`

Appliquez les modifications de schéma directement à la base de données (développement uniquement) :

```bash
rebase db push
```

`--database-url <url>` spécifie la base de données, et `--docker` celle de Compose, démarrée si nécessaire. `generate`, `migrate`, `branch`, `backup` et `restore` acceptent également ces deux options.

Cette commande ne touche pas à ce que les déclarations de vos tables ne décrivent pas : les autres tables et vues, les index que vous avez écrits, ainsi que les contraintes CHECK et EXCLUDE sur une table déclarée, qu'une déclaration ne peut pas exprimer. Consultez [`rebase db push`](/docs/cli/schema/#rebase-db-push) pour connaître ce qu'elle applique et ce qu'elle ignore.

Le code SQL qu'une déclaration de table ne peut pas formuler (fonctions, déclencheurs/triggers, contraintes CHECK, autorisations/grants) se place dans `backend/sql/*.sql`. Le push applique ces fichiers dans l'ordre alphabétique de leurs noms, après les tables et les vues et avant les stratégies (policies), de sorte qu'une stratégie puisse appeler une fonction définie par un fichier. Chaque fichier est consigné par son nom et son empreinte (hash) dans `rebase.sql_files` et n'est réexécuté que lorsqu'il change, dans sa propre transaction : un fichier qui échoue fait l'objet d'un rollback et interrompt le push. Écrivez des fichiers pouvant être réexécutés sans risque (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` avant `CREATE TRIGGER`). Un fichier dont le nom commence par `_` est un brouillon et n'est pas appliqué. La suppression d'un fichier n'annule rien de ce qu'il a effectué. `--dry-run` liste les fichiers qui seraient appliqués.

Un déploiement applique les mêmes fichiers : `rebase build` les intègre dans le bundle, et le démarrage du serveur exécute chaque fichier nouveau ou modifié après les tables et l'authentification et avant les stratégies, le tout enregistré dans la même table `rebase.sql_files`. La transaction de chaque fichier acquiert d'abord un advisory lock, de sorte que plusieurs instances démarrant en même temps, ou un push pendant un déploiement, n'exécutent chaque fichier qu'une seule fois. Un fichier peut s'exécuter pendant 15 minutes au maximum. Un fichier en échec bloque le démarrage et son nom est indiqué. `rebase dev` les applique également au démarrage. Une application qui construit son propre backend indique le répertoire avec `createPostgresAdapter({ sqlDir: "backend/sql" })`. Rien n'est appliqué avec `REBASE_PROVISION=false` ou `REBASE_MIGRATE_ON_BOOT=none`.

:::caution
`db push` modifie directement la base de données sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Générez des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `backend/drizzle/migrations/` qui peuvent être examinés et validés dans le gestionnaire de versions (git commit).

### `rebase db migrate`

Exécutez les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

Sur une base de données qui a déjà démarré, la première migration crée des tables que le démarrage a déjà créées ; le premier `db migrate` s'y interrompt donc avant de lancer quoi que ce soit et affiche la ligne de base (baseline) à exécuter. Enregistrez plutôt cette migration comme appliquée, une seule fois :

```bash
rebase db migrate --baseline <version>
```

La version correspond au préfixe numérique du fichier de migration ; `db generate` affiche la commande avec cette valeur déjà renseignée. Consultez [`--baseline`](/docs/cli/schema/#rebase-db-migrate) pour une base de données qui enregistre déjà des migrations.

Ensuite, `db migrate` applique ce que le démarrage n'a pas appliqué, et sur une base de données gérée par `rebase dev`, cela représente moins qu'il n'y paraît. Le démarrage ajoute chaque nouvelle table, colonne et valeur d'énumération dès que la déclaration d'une table change. Ainsi, au moment où `db generate` écrit la migration qui ajoute une colonne, la colonne s'y trouve déjà : ce `db migrate` s'arrête à nouveau sur `already exists` et indique le `--baseline <version>` qui l'enregistre. Chaque nouvelle propriété implique une nouvelle baseline. N'enregistrez une migration comme appliquée que lorsque le démarrage a déjà effectué chaque modification qu'elle contient. Une migration qui supprime, renomme ou restreint un élément contient des instructions que le démarrage n'exécute jamais, et l'enregistrer revient à les ignorer. En développement, `rebase db push` est la commande qui modifie le schéma ; réservez `db generate` et `db migrate` pour une base de données que le démarrage n'a pas déjà modifiée.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # ou s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # lister ce qui est stocké
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et, étant destructif, demande de saisir explicitement `yes` sur un terminal, ou attend `--yes` ; en l'absence de terminal et de `--yes`, la commande refuse de s'exécuter et indique de renseigner ce paramètre.
Vers une base de données qui contient déjà ce que la sauvegarde crée, `restore` nécessite `--clean`. Sans cela, elle refuse de s'exécuter avant que quoi que ce soit ne soit appliqué, rôles de cluster inclus, et liste les objets faisant obstacle ainsi que les deux manières de les contourner : `--clean`, ou `--create-db --target-db <nouveau nom>`.
Avec `--clean`, la restauration s'exécute en une seule transaction : elle supprime les schémas de la sauvegarde avec tout ce qu'ils contiennent, effectue la restauration et ne valide (commit) l'opération qu'une fois l'ensemble de la restauration réussie, de sorte qu'un échec laisse la base de données dans son état initial. Avant toute confirmation, elle liste ce qu'elle supprime qui ne figure pas dans la sauvegarde. Elle exécute `psql`, fourni avec `pg_restore`.
`restore` refuse la base de données de développement gérée : une sauvegarde transporte ses lignes sous forme de données COPY, qu'elle ne peut pas recevoir.
Restaurez dans Postgres sous Docker (`rebase db restore <dump> --docker --clean --yes`), puis `rebase db pull --from "$(rebase db url --docker)" --yes` le copiera dans la base de données gérée. Une sauvegarde de la base de données gérée la laisse intacte.
Les chemins relatifs, ainsi que la valeur par défaut `./backups`, sont résolus par rapport au répertoire depuis lequel vous lancez `rebase`, de sorte que les trois lignes ci-dessus convergent dans un seul répertoire ; une option non reconnue par une commande est rejetée avant toute exécution.
Le dump et son fichier de rôles ne sont lisibles que par vous (0600), et face à une base de données qui ne tourne pas, `backup` et `restore` affichent la même bannière que `db push`.
La planification, le fichier de rôles joint à chaque dump et la procédure de restauration sont décrits dans [Sauvegardes et restauration](/docs/deployment/backups/).

### `rebase db pull`

Copiez une autre base de données dans la base de données de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` accepte une URL `postgres://` ou `postgresql://`, ou les paires libpq `host=… port=… dbname=…` passées sous la forme d'un seul argument entre guillemets. Toute autre valeur est rejetée avant toute lecture ou initialisation, sans répéter la valeur.

`--anonymize` remplace les champs personnels lors de l'import, afin qu'une copie de production puisse être exploitée localement sans transférer de réelles données clients sur un ordinateur portable. La détection des colonnes se fait par nom, au mieux (best-effort). Une simple colonne `name` n'est remplacée que sur une table d'individus : une table nommée `users`, `authors`, `customers` ou similaire, ou toute table comportant également une colonne d'adresse e-mail.
Une colonne soumise à un index unique reçoit une valeur distincte par ligne, et la passe s'exécute en une seule transaction : en cas d'échec, les tables qui auraient dû être réécrites sont vidées et nommées, et la commande se termine avec un code de sortie 1.

Un indicateur non pris en charge par `pull` est rejeté avant toute lecture ou copie, en suggérant celui qui était probablement visé : `--anonymise` répond « did you mean --anonymize? » et sort avec le code 1.
Sur `pull` comme sur toute autre commande, un commutateur auquel on attribue une valeur est interprété : `--anonymize=true` ou `=1` l'active, `--anonymize=false` ou `=0` le désactive, et toute autre valeur est rejetée.

`pg_dump` omettant les privilèges, la copie arriverait avec les stratégies RLS de la source mais sans aucun des droits sous-jacents — chaque lecture en tant que `rebase_user` échouerait alors avec `permission denied`. Le pull reprovisionne ensuite le rôle applicatif en utilisant la même routine que le démarrage et `rebase db push`, garantissant ainsi que les tables internes de Rebase restent révoquées comme il se doit.

La cible est systématiquement la base de données de développement locale de ce projet et ne peut pas être changée : `--database-url` est refusée plutôt qu'acceptée, empêchant ainsi tout « pull vers la production ». `--from` est la seule direction possible.

Un pull remplace le contenu de la base de données locale : il vide d'abord chaque schéma qu'il copie, de sorte qu'une table existant uniquement en local n'y survit pas. Dans la base de données de développement gérée, les lignes sont injectées via des instructions `INSERT`, qu'elle accepte là où `COPY` échouerait. Elle n'accepte qu'un dump encodé en UTF8 : un pull depuis une base de données dans un autre encodage, comme LATIN1, est rejeté avant qu'aucun schéma ne soit vidé. Effectuez le pull de celle-ci vers un Postgres sous Docker (`rebase db pull --docker` avec le même `--from`), ou vers une instance Postgres désignée par `DATABASE_URL`.

### `rebase db url`

Affiche la chaîne de connexion utilisée par ce projet, et rien d'autre, facilitant son utilisation dans des tubes (pipes) :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas d'usage typique nécessitant ceci : `.env` laisse volontairement `DATABASE_URL` commenté, et le port étant dérivé du chemin du projet, aucun élément sur le disque ne l'indique.
Elle conserve ce port après un arrêt et un redémarrage, à moins qu'un autre processus ne l'ait occupé. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est cette valeur qui est affichée — l'ordre de résolution est identique à celui appliqué par toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

Après `rebase dev --docker`, `db url` et les autres commandes utilisent cette base de données Docker (en l'indiquant sur stderr) jusqu'à ce qu'un `rebase dev` soit exécuté sans cet indicateur. Ce choix est conservé dans `.rebase/dev-database.json` et se situe au même niveau de priorité que `--docker`, en dessous de toute chaîne de connexion explicite. Un `--docker` saisi manuellement qui se verrait supplanté par une chaîne de connexion ne démarre aucun conteneur : une ligne sur stderr indique qu'il a été ignoré, précise l'élément prioritaire et indique comment joindre Docker à la place. Un `rebase dev --docker` ainsi supplanté conserve le choix mémorisé en l'état, de sorte qu'une fois la chaîne de connexion retirée, les commandes basculent de nouveau vers Docker.

`rebase init` attribue à chaque projet son propre port Compose, entre 5433 et 5632 selon le chemin du projet, et `--docker` vérifie que le service répondant sur ce port est bien le conteneur `db` de ce projet. Si un autre conteneur ou un Postgres hors Docker occupe ce port, la commande s'arrête et le signale plutôt que de se connecter à la base de données d'un tiers. Pour déplacer le projet, modifiez le port hôte du service `db` dans `docker-compose.yml`, ainsi que `DATABASE_URL` si le fichier `.env` en définit une.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # l'arrêter ; les données sont conservées
rebase db reset    # la supprimer et repartir de zéro
```

Elle appartient au projet, et non à la commande qui l'a lancée ; ainsi, arrêter `rebase dev` la laisse active pour les autres commandes. Au bout de 30 minutes sans aucune connexion, elle s'arrête d'elle-même, et la commande suivante qui en a besoin la relance. `rebase dev` le signale lors de son arrêt, en indiquant comment stopper la base de données immédiatement.

Lancer `db stop` alors que `rebase dev` tourne indique que son backend ne pourra plus joindre la base de données tant qu'elle ne sera pas revenue. La prochaine commande qui en aura besoin, par exemple `rebase db url`, la redémarrera sur le même port, et le backend s'y reconnectera sans nécessiter de redémarrage.

### `rebase db request-role migrate`

Migrez les requêtes de cette base de données d'un rôle Postgres à un autre :

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Les requêtes s'exécutent sous l'identité `rebase_user`, à moins que le projet ne spécifie un autre rôle (`REBASE_RLS_REQUEST_ROLE` ou `rls.requestRole`). Un rôle appartenant à l'ensemble du cluster, les projets qui en partagent un doivent disposer chacun du leur. Le premier démarrage de provisionnement consigne le rôle dans la base de données, et un démarrage ultérieur configuré avec un autre rôle refusera de se lancer tant que la base n'aura pas été migrée.

La commande effectue la migration depuis le rôle consigné dans la base, ou depuis `rebase_user`. En une seule transaction, elle crée le nouveau rôle s'il est manquant, autorise la connexion à basculer vers lui, réattribue dans cette base de données uniquement chaque privilège détenu par l'ancien rôle, réoriente les stratégies qui le mentionnent et enregistre le nouveau rôle. L'ancien rôle demeure intact, car une autre base de données du cluster peut l'utiliser. Ensuite, la commande affiche les instructions `REVOKE` qui révoquent ici les privilèges de l'ancien rôle, à exécuter dès lors que plus rien n'en dépend.

`--dry-run` affiche les instructions ainsi que les `REVOKE` sans rien modifier. Sur un terminal, une confirmation est demandée ; hors terminal, l'opération est refusée en l'absence de `--yes`. Définissez ensuite `REBASE_RLS_REQUEST_ROLE` avec le nouveau rôle sur chaque serveur utilisant la base de données. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase db provision --print`

Affichez le SQL configurant le ou les rôles de requête pour cette base de données, à destination d'un administrateur de base de données :

```bash
rebase db provision --print > request-role.sql
```

Pour chaque rôle de requête, la commande affiche les instructions qui créent le rôle, autorisent le rôle de connexion à basculer vers celui-ci et, selon le réglage par défaut `grants: "schema"`, lui attribuent les schémas `public` et `rebase`. Les rôles correspondent à `REBASE_RLS_REQUEST_ROLE` lorsqu'il est défini, sinon à ceux consignés en base lors d'un démarrage, sinon à `rebase_user`. Les explications sont rédigées sous forme de commentaires SQL, rendant la sortie directement exécutable telle quelle. Elle lit le rôle de connexion et n'exécute rien d'autre. `--print` est obligatoire. Associez cette option à `REBASE_RLS_PROVISION_ROLE=never` lorsque les rôles sont créés par un DBA ou par du code d'infrastructure.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch diff <name> [--json] [--sample-limit <n>]
rebase db branch switch <name>     # travailler dessus ; chaque commande ultérieure s'y appliquera
rebase db branch switch            # afficher la branche sur laquelle vous vous trouvez
rebase db branch switch --off      # revenir à la base de données principale
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL refuse de copier ou de supprimer une base de données à laquelle un autre processus est connecté, cet « autre processus » étant généralement votre propre `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions préalablement.

Chaque branche constituant une copie complète sur le disque, il est nécessaire de faire du nettoyage. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été inscrite, et — uniquement avec `--older-than` — les branches dépassant l'ancienneté spécifiée. Elle demande confirmation avant toute suppression sauf si vous passez `--yes`. Sans terminal interactif pour demander confirmation, par exemple dans un environnement de CI, elle ne supprime rien, indique de renseigner `--yes` et quitte avec le code 1.
`list` et `info` sont en lecture seule : une base de données sur laquelle aucune branche n'a été créée n'en contient aucune, et ces commandes n'y créent aucun schéma `rebase`.

`diff` met en évidence ce qu'une branche a modifié par rapport à la base de données dont elle est issue : les tables, colonnes, contraintes, index, déclencheurs (triggers), stratégies RLS, types énumérés, vues et fonctions ajoutés, supprimés ou modifiés, ainsi que par table les lignes insérées, mises à jour et supprimées. Les lignes modifiées indépendamment par le parent depuis la séparation sont décomptées à part, et les lignes modifiées des deux côtés constituent des conflits. `--json` affiche l'intégralité du diff, jusqu'à concurrence de `--sample-limit` lignes par table (100 par défaut). Elle lit les deux bases sans en modifier aucune ; la fusion s'effectue dans Studio — voir [Examiner et fusionner une branche](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` enregistre la branche dans `.rebase/branch.json` sans jamais modifier `.env`. Cette sélection a priorité sur `DATABASE_URL` dans `.env` mais s'efface devant `--database-url` ou un `DATABASE_URL` présent dans le shell ; un indicateur fourni sur la ligne de commande l'emporte donc toujours sur un basculement réalisé antérieurement. `delete` refuse de supprimer la branche sur laquelle vous êtes actuellement positionné, car chaque commande dans le checkout, y compris la suppression, pointe vers elle : exécutez d'abord `switch --off`, puis supprimez-la. L'ensemble du workflow est détaillé dans [Création de branches de base de données](/docs/backend/branching/).

#### `rebase db branch merge`

```bash
rebase db branch merge <name> [--on-conflict abort|branch|target] [--skip-blocked] [--yes]
```

Applique les lignes insérées, mises à jour et supprimées par une branche sur la base de données dont elle est issue. La commande affiche d'abord le diff et sollicite une confirmation, puis fusionne très exactement ce diff : la fusion mentionne l'empreinte (fingerprint) du diff, de sorte qu'un parent ayant changé entre-temps est refusé plutôt que fusionné. `--on-conflict` détermine la résolution d'une ligne modifiée des deux côtés — `abort` (par défaut) n'écrit rien, `branch` retient la ligne de la branche, `target` conserve celle du parent — et `--skip-blocked` fusionne les tables possibles en ignorant le reste. Les modifications de schéma et de stratégies RLS ne sont jamais fusionnées par cette commande : les migrations s'en chargent. `delete` demande également confirmation au préalable, et `--yes` répond par l'affirmative aux deux dans un script.

:::note[Sur la base de données de développement gérée]
`push`, `generate` et `migrate` fonctionnent ici comme sur n'importe quelle base de données.
`push` et `generate` planifient leurs opérations à l'aide d'Atlas, qui requiert une seconde base de données vide pour effectuer ses comparaisons — or l'instance PGlite gérée n'en fournit qu'une seule. Ainsi, sur la base gérée, chacune de ces commandes instancie une deuxième base PGlite éphémère en mémoire pour les besoins d'Atlas, puis l'arrête à la fin de la commande. C'est de cette manière qu'une colonne y est supprimée, renommée ou restreinte : `rebase dev` ne réalise que des ajouts. Le garde-fou pour les opérations destructives est identique partout ailleurs. Pour qu'Atlas réalise ses comparaisons sur une base de données vide de votre choix, définissez `REBASE_ATLAS_DEV_URL` en conséquence ; Rebase ne créera ni ne supprimera une base désignée de cette manière.

`branch` y est refusée. L'instruction `CREATE DATABASE ... TEMPLATE` appliquée à PGlite crée une entrée dans le catalogue sans copier la moindre donnée ; la branche pointerait donc vers la base de données d'origine — chaque écriture censée être isolée atterrirait directement dans votre base de développement. `rebase dev --docker` vous fournit un serveur réel compatible avec les branches.
:::

## Voir aussi

- [Référence de la CLI](/docs/cli/) — toutes les autres commandes `rebase`
- [Génération de schéma](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` et `db branch` en détail
- [Sauvegardes et restauration](/docs/deployment/backups/) — planification, fichier de rôles, restauration
- [Création de branches de base de données](/docs/backend/branching/) — création d'une branche et coûts associés
- [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/) — rôle de requête, réglages et `rebase doctor --database`
- [Scripts et Console](/docs/backend/scripts/) — manipuler la même base de données depuis un script ou un REPL
