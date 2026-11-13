---
sourceHash: 6d4d1426d30011ff
title: Commandes de base de données
sidebar_label: Commandes de base de données
description: Les commandes rebase db — push, generate et migrate, sauvegardes et restaurations, extraction d'une copie, chaîne de connexion, base de données de développement gérée et branches.
---

## Vue d'ensemble

`rebase db` est la famille de commandes qui interagissent avec la base de données du projet. Chacune fonctionne sur la base de données résolue par le projet, dans l'ordre listé par [Database Branching](/docs/backend/branching/#cli-integration) : `--database-url`, puis `DATABASE_URL` dans le shell, la branche vers laquelle le checkout a basculé, `DATABASE_URL` dans `.env`, `--docker`, et sinon la base de données de développement gérée démarrée par `rebase dev`. `rebase db url` affiche de laquelle il s'agit.

`request-role` et `provision` sont destinés à une base de données dont Rebase n'est pas le propriétaire exclusif ; voir [Running on an existing or shared database](/docs/deployment/existing-database/). `push`, `generate` et `migrate` sont décrits en détail dans [Schema Generation](/docs/cli/schema/), et toutes les autres commandes se trouvent dans la [CLI reference](/docs/cli/).

## Commandes

### `rebase db push`

Appliquer directement les modifications de schéma à la base de données (développement uniquement) :

```bash
rebase db push
```

`--database-url <url>` spécifie la base de données, et `--docker` celle de compose, démarrée si nécessaire. `generate`, `migrate`, `branch`, `backup` et `restore` acceptent également les deux.

La commande ne touche pas à ce que vos déclarations de tables ne décrivent pas : les autres tables et vues, les index que vous avez écrits, ainsi que les contraintes CHECK et EXCLUDE sur une table déclarée, qu'une déclaration ne peut pas exprimer. Consultez [`rebase db push`](/docs/cli/schema/#rebase-db-push) pour savoir ce qu'elle applique et devant quoi elle s'arrête.

:::caution
`db push` modifie directement la base de données sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `backend/drizzle/migrations/` qui peuvent être examinés et commités.

### `rebase db migrate`

Exécuter les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

Sur une base de données qui a déjà démarré, la première migration crée des tables que le démarrage a déjà créées, de sorte que le premier `db migrate` s'arrête sur `already exists`. Enregistrez plutôt cette migration comme appliquée, une seule fois :

```bash
rebase db migrate --baseline <version>
```

La version est le préfixe numérique du fichier de migration ; `db generate` affiche la commande préremplie avec cette valeur. Consultez [`--baseline`](/docs/cli/schema/#rebase-db-migrate) pour une base de données qui enregistre déjà des migrations.

Après cela, `db migrate` applique ce que le boot n'a pas appliqué, et sur une base de données servie par `rebase dev`, cela représente moins qu'il n'y paraît. Le boot ajoute chaque nouvelle table, colonne et valeur d'énumération dès que la déclaration d'une table change. Ainsi, au moment où `db generate` écrit la migration qui ajoute une colonne, la colonne est déjà présente : ce `db migrate` s'arrête à nouveau sur `already exists` et indique le `--baseline <version>` pour l'enregistrer. Chaque nouvelle propriété implique une nouvelle baseline. N'enregistrez une migration que lorsque le boot a effectué toutes les modifications qu'elle contient. Une migration qui supprime, renomme ou restreint également un élément contient des instructions que le boot n'exécute jamais, et l'enregistrer revient à les ignorer. En développement, `rebase db push` est la commande qui modifie le schéma ; réservez `db generate` et `db migrate` pour une base de données que le boot n'a pas déjà modifiée.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et, étant destructif, demande de saisir `yes` sur un terminal ou accepte `--yes` ; sans terminal et sans `--yes`, la commande refuse de s'exécuter et indique de le passer en argument.
Vers une base de données qui contient déjà ce que la sauvegarde crée, `restore` nécessite `--clean`. Sans cela, la commande refuse de s'exécuter avant que quoi que ce soit ne soit appliqué, rôles de cluster inclus, et liste les objets qui bloquent ainsi que les deux manières de contourner le problème : `--clean`, ou `--create-db --target-db <new name>`.
Avec `--clean`, la restauration s'effectue en une seule transaction : elle supprime les schémas de la sauvegarde ainsi que tout leur contenu, restaure, et ne valide (commit) qu'une fois l'ensemble de la restauration réussi, de sorte qu'un échec laisse la base de données dans son état initial. Avant de demander confirmation, elle nomme ce qu'elle supprime qui n'est pas contenu dans la sauvegarde. Elle exécute `psql`, qui est fourni avec `pg_restore`.
`restore` refuse la base de données de développement gérée : une sauvegarde transporte ses lignes sous forme de données COPY, qu'elle ne peut pas recevoir.
Restaurez dans Postgres sous Docker (`rebase db restore <dump> --docker --clean --yes`), puis `rebase db pull --from "$(rebase db url --docker)" --yes` la copie dans la base de données gérée. Une sauvegarde de la base de données gérée la laisse telle quelle.
Les chemins relatifs, ainsi que le répertoire par défaut `./backups`, sont résolus par rapport au répertoire depuis lequel vous exécutez `rebase`, de sorte que les trois lignes ci-dessus se rejoignent dans un seul répertoire ; une option non acceptée par une commande est rejetée avant toute exécution.
Le dump et son fichier de rôles ne sont lisibles que par vous (0600), et face à une base de données qui ne tourne pas, `backup` et `restore` affichent la même bannière que `db push`.
La planification, le fichier de rôles qui accompagne chaque dump et la procédure de restauration sont détaillés dans [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Copier une autre base de données dans la base de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` accepte une URL `postgres://` ou `postgresql://`, ou les paires clé=valeur de libpq `host=… port=… dbname=…` entourées de guillemets comme un seul argument. Toute autre valeur est rejetée avant que quoi que ce soit ne soit lu ou démarré, sans répéter la valeur.

`--anonymize` remplace les champs personnels lors de l'import, afin qu'une copie de production puisse être utilisée localement sans charger de réelles données clients sur un ordinateur portable. La correspondance des colonnes se fait par nom, au mieux (best-effort). Une simple colonne `name` n'est remplacée que sur une table d'individus : une table nommée `users`, `authors`, `customers` ou équivalent, ou toute table contenant également une colonne d'adresse e-mail.
Une colonne soumise à un index unique reçoit une valeur distincte par ligne, et l'opération se fait en une seule transaction : en cas d'échec, les tables qu'elle aurait dû réécrire sont vidées et listées, et la commande se termine avec le code 1.

Un flag non reconnu par `pull` est rejeté avant que quoi que ce soit ne soit lu ou copié, en suggérant celui qui était probablement visé : `--anonymise` répond « did you mean --anonymize? » et se termine avec le code 1.
Sur `pull` comme sur toutes les autres commandes, un commutateur recevant une valeur la prend en compte : `--anonymize=true` ou `=1` l'active, `--anonymize=false` ou `=0` le désactive, et toute autre valeur est rejetée.

`pg_dump` supprime les privilèges, de sorte que la copie arriverait avec les politiques RLS de la source mais sans aucun des droits (grants) sous-jacents — chaque lecture en tant que `rebase_user` échouerait avec `permission denied`. Le pull réattribue ensuite le rôle de l'application en utilisant la même routine que le boot et `rebase db push`, afin que l'accès aux tables internes de Rebase reste révoqué comme prévu.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est rejetée plutôt qu'acceptée, il n'y a donc aucun moyen de demander un « pull en production ». `--from` est l'unique direction.

Un pull remplace le contenu de la base de données locale : il vide d'abord chaque schéma qu'il copie, de sorte qu'une table existant uniquement en local ne subsiste pas. Dans la base de données de développement gérée, les lignes transitent sous forme d'instructions `INSERT`, qu'elle accepte là où `COPY` échouerait.

### `rebase db url`

Afficher la chaîne de connexion utilisée par ce projet, et rien d'autre, ce qui permet de la rediriger (pipe) :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas d'usage typique de cette commande : `.env` laisse volontairement `DATABASE_URL` en commentaire, et le port est dérivé du chemin du projet, de sorte que rien sur le disque ne le nomme explicitement.
Elle conserve ce port après un arrêt et un redémarrage, à moins qu'un autre processus ne l'ait pris. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est cette valeur qui est affichée — l'ordre de résolution est le même que pour toutes les autres commandes. Elle démarre la base de données gérée si celle-ci n'est pas déjà en cours d'exécution.

Après `rebase dev --docker`, `db url` et les autres commandes utilisent cette base de données Docker (en l'indiquant sur stderr) jusqu'à ce qu'un `rebase dev` soit exécuté sans le flag. Ce choix est conservé dans `.rebase/dev-database.json` et se situe au même rang de priorité que `--docker`, en dessous de toute chaîne de connexion. Un `--docker` saisi alors qu'une chaîne de connexion est prioritaire ne démarre aucun conteneur : une ligne sur stderr indique qu'il a été ignoré, précise l'élément prioritaire et explique comment joindre Docker à la place. Un `rebase dev --docker` ainsi supplanté conserve le choix mémorisé tel quel, de sorte qu'une fois la chaîne de connexion supprimée, les commandes se reconnectent à Docker.

`rebase init` attribue à chaque projet son propre port compose, de 5433 à 5632 selon le chemin du projet, et `--docker` vérifie que ce qui répond sur ce port est bien le conteneur `db` de ce projet. Si un autre conteneur ou une instance Postgres hors Docker occupe le port, la commande s'arrête et le signale plutôt que de se connecter à la base de données d'un tiers. Pour déplacer le projet, modifiez le port hôte du service `db` dans `docker-compose.yml`, ainsi que `DATABASE_URL` si `.env` en définit une.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Elle appartient au projet, et non à la commande qui l'a démarrée ; arrêter `rebase dev` la laisse donc en cours d'exécution pour les autres commandes. Au bout de 30 minutes d'inactivité sans connexion, elle s'arrête d'elle-même, et la commande suivante qui en a besoin la redémarre. `rebase dev` l'indique lors de son arrêt, en précisant comment arrêter la base de données immédiatement.

`db stop` exécuté alors que `rebase dev` tourne indique que son backend ne peut pas joindre la base de données jusqu'à son retour. La prochaine commande qui en a besoin, par exemple `rebase db url`, la redémarre sur le même port, et le backend se reconnecte sans nécessiter de redémarrage.

### `rebase db request-role migrate`

Basculer les requêtes de cette base de données d'un rôle Postgres à un autre :

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Les requêtes s'exécutent en tant que `rebase_user` à moins que le projet ne spécifie un autre rôle (`REBASE_RLS_REQUEST_ROLE` ou `rls.requestRole`). Un rôle appartient à l'ensemble du cluster, les projets qui en partagent un doivent donc avoir chacun le leur. Le premier boot de provisionnement enregistre le rôle dans la base de données, et un boot ultérieur configuré avec un autre rôle refusera de démarrer tant que la base de données n'aura pas été migrée.

La commande migre depuis le rôle enregistré par la base de données, ou `rebase_user`. En une seule transaction, elle crée le nouveau rôle s'il est manquant, permet à la connexion d'y basculer, réattribue dans cette base de données uniquement chaque privilège (grant) détenu par l'ancien rôle, réoriente les politiques qui le mentionnent et enregistre le nouveau rôle. L'ancien rôle est conservé tel quel, car une autre base de données sur le cluster pourrait l'utiliser. Ensuite, elle affiche les instructions `REVOKE` permettant de révoquer ici les privilèges de l'ancien rôle, à exécuter une fois que plus rien n'en a besoin.

`--dry-run` affiche les instructions ainsi que les `REVOKE` et ne modifie rien. Sur un terminal, elle demande confirmation au préalable ; sans terminal, elle refuse de s'exécuter sans `--yes`. Définissez ensuite `REBASE_RLS_REQUEST_ROLE` avec le nouveau rôle sur chaque serveur qui utilise la base de données. Consultez [Running on an existing or shared database](/docs/deployment/existing-database/).

### `rebase db provision --print`

Afficher le SQL configurant le ou les rôles de requête pour cette base de données, à faire exécuter par un administrateur de base de données :

```bash
rebase db provision --print > request-role.sql
```

Pour chaque rôle de requête, elle affiche les instructions qui créent le rôle, donnent au rôle de connexion le droit d'y basculer et, selon la valeur par défaut `grants: "schema"`, lui octroient les privilèges sur les schémas `public` et `rebase`. Les rôles correspondent à `REBASE_RLS_REQUEST_ROLE` lorsqu'il est défini, sinon à ceux qu'un boot a enregistrés dans la base de données, sinon à `rebase_user`. Les explications sont rédigées sous forme de commentaires SQL, de sorte que la sortie peut être exécutée telle quelle. Elle lit le rôle de connexion et n'exécute rien d'autre. `--print` est obligatoire. Associez-le à `REBASE_RLS_PROVISION_ROLE=never` lorsque les rôles sont créés par un DBA ou par du code d'infrastructure.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch diff <name> [--json] [--sample-limit <n>]
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL ne copiera ni ne supprimera une base de données à laquelle d'autres processus sont connectés, et cet autre processus est généralement votre propre `rebase dev`. `create` et `delete` nomment ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions au préalable.

Chaque branche est une copie complète sur le disque, il est donc nécessaire de faire du ménage. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé l'âge spécifié. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`. En l'absence de terminal pour poser la question (en CI par exemple), elle ne supprime rien, invite à passer `--yes`, et se termine avec le code 1.
`list` et `info` se contentent de lire : une base de données sur laquelle aucune branche n'a été créée n'en a aucune, et elles n'y créent aucun schéma `rebase`.

`diff` affiche les modifications apportées par une branche par rapport à la base de données dont elle est issue : tables, colonnes, contraintes, index, triggers, politiques RLS, types énumérés, vues et fonctions ajoutés, supprimés ou modifiés, ainsi que par table les lignes insérées, mises à jour et supprimées. Les lignes modifiées de manière autonome par le parent depuis lors sont comptabilisées à part, et les lignes modifiées des deux côtés sont considérées comme des conflits. `--json` affiche l'intégralité du diff, jusqu'à `--sample-limit` lignes par table (100 par défaut). Elle lit les deux bases de données et n'en modifie aucune ; la fusion s'effectue dans Studio — voir [Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle prévaut sur `DATABASE_URL` dans `.env` et cède le pas face à `--database-url` ou à un `DATABASE_URL` dans le shell ; ainsi, une option sur la ligne de commande a toujours la priorité sur un switch précédent. `delete` refuse de supprimer la branche sur laquelle vous vous trouvez, puisque chaque commande dans le checkout, suppression comprise, pointe vers elle : faites d'abord `switch --off`, puis supprimez-la. L'ensemble du workflow est détaillé dans [Database Branching](/docs/backend/branching/).

:::note[Sur la base de données de développement gérée]
`push`, `generate` et `migrate` fonctionnent ici comme sur n'importe quelle base de données.
`push` et `generate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer des comparaisons — or l'instance PGlite gérée n'en fournit qu'une seule. Ainsi, sur la base de données gérée, chacune d'elles démarre une seconde instance PGlite éphémère en mémoire pour Atlas, puis l'arrête à la fin de la commande. C'est de cette manière qu'une colonne y est supprimée, renommée ou restreinte : `rebase dev` ne fait qu'ajouter. La barrière de sécurité destructive est la même que partout ailleurs. Pour qu'Atlas planifie plutôt son travail sur une base de données vide qui vous est propre, définissez `REBASE_ATLAS_DEV_URL` vers celle-ci ; Rebase ne crée ni ne supprime aucune base de données ainsi désignée.

`branch` y est refusée. `CREATE DATABASE ... TEMPLATE` sur PGlite écrit une entrée de catalogue et ne copie rien, la branche pointerait donc vers la base de données dont elle a été clonée — chaque écriture que vous souhaitiez isoler atterrirait dans votre base de développement. `rebase dev --docker` vous offre un véritable serveur sur lequel les branches fonctionnent.
:::

## Liens associés

- [CLI reference](/docs/cli/) — toutes les autres commandes `rebase`
- [Schema Generation](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` et `db branch` en détail
- [Backups and restore](/docs/deployment/backups/) — planification, fichier de rôles, restauration
- [Database Branching](/docs/backend/branching/) — comment une branche est créée et ce qu'elle implique
- [Running on an existing or shared database](/docs/deployment/existing-database/) — le rôle de requête, ses paramètres et `rebase doctor --database`
- [Scripts and the Console](/docs/backend/scripts/) — la même base de données depuis un script ou un REPL
