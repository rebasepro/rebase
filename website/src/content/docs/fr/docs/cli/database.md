---
sourceHash: 4e057bf3f4bd759b
title: Commandes de base de données
sidebar_label: Commandes de base de données
description: Les commandes rebase db — push, generate et migrate, sauvegardes et restaurations, copie d'une base distante, chaîne de connexion, base de développement gérée et branches.
---

## Vue d'ensemble

`rebase db` est la famille de commandes qui atteignent la base de données du projet.
Chacune travaille sur la base de données que le projet résout, dans l'ordre que liste
[Branches de base de données](/docs/backend/branching/#cli-integration) :
`--database-url`, puis `DATABASE_URL` dans le shell, la branche sur laquelle l'espace de
travail est basculé, `DATABASE_URL` dans `.env`, `--docker`, et sinon la base de
développement gérée que démarre `rebase dev`. `rebase db url` affiche laquelle c'est.

`request-role` et `provision` concernent une base de données que Rebase ne possède pas entièrement ;
voir [Exécuter sur une base de données existante ou partagée](/docs/deployment/existing-database/).
`push`, `generate` et `migrate` sont décrites en détail dans
[Génération de schéma](/docs/cli/schema/), et toutes les autres commandes figurent dans la
[référence de la CLI](/docs/cli/).

## Commandes

### `rebase db push`

Pousser directement les modifications de schéma vers la base de données (développement uniquement) :

```bash
rebase db push
```

`--database-url <url>` désigne la base de données, et `--docker` celle de docker compose, démarrée
si nécessaire. `generate`, `migrate`, `branch`, `backup` et `restore` acceptent aussi les deux.

Il laisse en paix ce que vos collections ne décrivent pas : les autres tables et vues, les index
que vous avez écrits, et les contraintes CHECK et EXCLUDE de la table d'une collection, qu'une
collection ne peut pas déclarer. Voir [`rebase db push`](/docs/cli/schema/#rebase-db-push) pour
ce qu'il applique et ce avant quoi il s'arrête.

:::caution
`db push` modifie directement la base de données sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `backend/drizzle/migrations/` qui peuvent être vérifiés et commités.

### `rebase db migrate`

Exécuter les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

Sur une base de données qui a déjà démarré, la première migration crée des tables que le démarrage
a déjà créées, si bien que le premier `db migrate` s'y arrête sur `already exists`. Enregistrez plutôt
cette migration comme appliquée, une seule fois :

```bash
rebase db migrate --baseline <version>
```

La version est le préfixe numérique du fichier de migration ; `db generate` affiche la
commande avec la version déjà renseignée. Voir
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) pour une base de données qui enregistre
déjà des migrations.

Ensuite, `db migrate` applique ce que le démarrage n'a pas appliqué, et sur une base de données que
`rebase dev` sert, c'est moins qu'il n'y paraît. Le démarrage ajoute chaque nouvelle table,
colonne et valeur d'enum dès qu'une collection change, si bien qu'au moment où
`db generate` écrit la migration qui ajoute une colonne, la colonne est déjà
là : ce `db migrate` s'arrête de nouveau sur `already exists` et nomme le
`--baseline <version>` qui l'enregistre. Chaque nouvelle propriété implique une nouvelle
baseline. N'enregistrez une migration que lorsque le démarrage a effectué chacune de ses
modifications. Une migration qui supprime, renomme ou rétrécit aussi quelque chose contient des
instructions que le démarrage n'exécute jamais, et l'enregistrer les fait sauter. En
développement, `rebase db push` est la commande qui modifie le schéma ; réservez `db generate`
et `db migrate` à une base de données que le démarrage n'a pas déjà modifiée.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et, étant destructeur,
demande de taper `yes` dans un terminal, ou accepte `--yes` ; sans terminal ni
`--yes`, il refuse et dit de le passer.
Dans une base de données
qui contient déjà ce que la sauvegarde crée, `restore` exige `--clean`. Sans cette option, il
refuse avant que quoi que ce soit ne soit appliqué, rôles du cluster compris, et nomme les objets
qui gênent ainsi que les deux façons de les contourner : `--clean`, ou
`--create-db --target-db <new name>`.
Avec `--clean`,
la restauration est une seule transaction : elle supprime les schémas de la sauvegarde avec tout
ce qu'ils contiennent, restaure, et ne valide qu'une fois toute la restauration réussie, si bien
qu'un échec laisse la base de données telle qu'elle était. Avant de demander confirmation, elle
nomme ce qu'elle supprime et que la sauvegarde ne contient pas. Elle exécute `psql`, fourni avec
`pg_restore`.
`restore` refuse
la base de données de développement gérée : une sauvegarde transporte ses lignes sous forme de
données COPY, qu'elle ne peut pas recevoir. Restaurez dans un Postgres sous Docker (`rebase db restore <dump> --docker --clean --yes`),
puis `rebase db pull --from "$(rebase db url --docker)" --yes` la copie dans
la base de données gérée. Une sauvegarde de la base de données gérée la laisse telle qu'elle
était.
Les chemins relatifs,
et la valeur par défaut `./backups`, se résolvent par rapport au répertoire depuis lequel vous lancez
`rebase`, de sorte que les trois lignes ci-dessus se retrouvent dans un même répertoire ; une
option qu'une commande n'accepte pas est refusée avant que quoi que ce soit ne s'exécute.
La sauvegarde et son fichier des rôles ne sont lisibles que par vous (0600), et
face à une base de données qui ne tourne pas, `backup` et `restore` affichent la
bannière qu'affiche `db push`.
La planification, le fichier des rôles qui accompagne chaque sauvegarde, et la procédure de
restauration sont décrits dans [Sauvegardes et restauration](/docs/deployment/backups/).

### `rebase db pull`

Copier une autre base de données dans la base de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` accepte une URL `postgres://` ou `postgresql://`, ou les paires
`host=… port=… dbname=…` de libpq entre guillemets, comme un seul argument. Toute autre valeur
est refusée avant que quoi que ce soit ne soit lu ou démarré, sans répéter la valeur.

`--anonymize` remplace les champs personnels lors de l'import, afin qu'une copie de production puisse être exploitée localement sans transférer de réelles données client sur un ordinateur portable. Il repère
les colonnes par leur nom et procède au mieux (best-effort). Une colonne `name` seule n'est
remplacée que sur une table de personnes : une table appelée `users`, `authors`, `customers` ou
similaire, ou toute table qui contient aussi une colonne d'adresse e-mail.
Une colonne sous un index unique reçoit une valeur distincte par ligne, et le passage tient en une seule
transaction : s'il échoue, les tables qu'il aurait réécrites sont vidées et
nommées, et la commande se termine avec le code 1.

Une option que `pull`
n'accepte pas est refusée avant que quoi que ce soit ne soit lu ou copié, avec le nom de celle qui
était probablement voulue : `--anonymise` répond « did you mean --anonymize? » et se termine avec
le code 1.
Sur `pull` comme sur toute autre commande, une option booléenne à laquelle on donne une valeur la
lit : `--anonymize=true` ou `=1` l'active, `--anonymize=false` ou `=0` la laisse désactivée,
et toute autre valeur est refusée.

`pg_dump` supprime les privilèges, de sorte que la copie arriverait avec les politiques RLS de la source et aucun des droits d'accès (grants) sous-jacents — chaque lecture en tant que `rebase_user` échouant avec `permission denied`. Le pull réattribue ensuite le rôle de l'application, en utilisant la même routine que le démarrage et `rebase db push`, afin que les tables internes de Rebase restent révoquées comme il se doit.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est refusé plutôt qu'accepté, il n'y a donc aucun moyen de spécifier "pull vers la production". `--from` est la seule direction possible.

Un pull remplace
le contenu de la base de données locale : il vide d'abord chaque schéma qu'il copie, si bien qu'une
table qui n'existe qu'en local n'y survit pas. Dans la base de données de développement gérée, les
lignes transitent sous forme d'instructions `INSERT`, qu'elle accepte là où `COPY` l'arrêterait.

### `rebase db url`

Afficher la chaîne de connexion utilisée par ce projet, et rien d'autre, pour pouvoir l'utiliser dans un pipe :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas d'usage qui nécessite cela : `.env` laisse volontairement `DATABASE_URL` commentée, et le port est dérivé du chemin du projet, de sorte que rien sur le disque ne la mentionne.
Elle conserve ce port d'un arrêt à un démarrage, à moins qu'autre chose ne l'ait pris. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est ce qui s'affiche — l'ordre de résolution est le même que celui suivi par toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

Après
`rebase dev --docker`, `db url` et les autres commandes utilisent cette base de données Docker
(et le disent sur stderr) jusqu'à ce qu'un `rebase dev` soit lancé sans l'option. Ce choix est
conservé dans `.rebase/dev-database.json` et se classe là où se classe `--docker`, sous toutes les
chaînes de connexion. Un `--docker` que vous tapez et qu'une chaîne de connexion écarte
ne démarre aucun conteneur : une ligne sur stderr dit qu'il a été ignoré, nomme ce qui l'a emporté,
et indique comment atteindre Docker autrement. Un `rebase dev --docker` écarté de cette façon
laisse le choix mémorisé tel qu'il était, de sorte qu'une fois la chaîne de connexion disparue,
les commandes suivent de nouveau Docker.

`rebase init`
donne à chaque projet son propre port compose, de 5433 à 5632 selon le chemin du projet,
et `--docker` vérifie que ce qui répond sur ce port est bien le conteneur `db` de ce projet.
Quand un autre conteneur ou un Postgres hors de Docker occupe le port, il s'arrête et le nomme
plutôt que de se connecter à la base de données de quelqu'un d'autre. Pour déplacer le
projet, changez le port hôte du service `db` dans `docker-compose.yml`, ainsi que
`DATABASE_URL` si `.env` en définit une.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Elle appartient au projet, pas à la commande qui l'a démarrée : arrêter
`rebase dev` la laisse donc tourner pour les autres commandes. Après 30 minutes sans aucune
connexion, elle s'arrête d'elle-même, et la prochaine commande qui en a besoin la redémarre.
`rebase dev`
le dit en s'arrêtant, avec la façon d'arrêter la base de données tout de suite.

`db stop` sous un
`rebase dev` en cours d'exécution dit que son backend ne peut pas atteindre la base de données
tant qu'elle n'est pas revenue. La prochaine commande qui en a besoin, `rebase db url` par exemple,
la démarre sur le même port, et le backend se reconnecte sans redémarrage.

### `rebase db request-role migrate`

Déplace les requêtes de cette base de données d'un rôle Postgres vers un autre :

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Les requêtes s'exécutent en tant que `rebase_user`, sauf si le projet nomme un autre rôle
(`REBASE_RLS_REQUEST_ROLE`, ou `rls.requestRole`). Un rôle appartient à tout le
cluster, donc les projets qui en partagent un devraient chacun avoir le leur. Le premier
démarrage qui provisionne enregistre le rôle dans la base de données, et un démarrage ultérieur
configuré avec un autre rôle refuse de se lancer tant que la base n'a pas été migrée.

La commande part du rôle que la base a enregistré, ou de `rebase_user`. En une
seule transaction, elle crée le nouveau rôle s'il manque, permet à la connexion d'y
basculer, réémet, dans cette base de données uniquement, chaque privilège que détient l'ancien rôle,
redirige les politiques qui le nomment et enregistre le nouveau rôle. L'ancien rôle est
laissé tel quel, car une autre base de données du cluster peut l'utiliser. Ensuite, elle
affiche les instructions `REVOKE` qui retirent ici les privilèges de l'ancien rôle,
à exécuter une fois que plus rien n'en a besoin.

`--dry-run` affiche les instructions et les `REVOKE` et ne modifie rien. Dans un
terminal, elle demande d'abord ; sans terminal, elle refuse sans `--yes`. Définissez ensuite
`REBASE_RLS_REQUEST_ROLE` sur le nouveau rôle sur chaque serveur qui utilise la
base de données. Voir [Exécuter sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase db provision --print`

Affiche le SQL qui met en place le ou les rôles des requêtes pour cette base de données, à faire
exécuter par un administrateur de base de données :

```bash
rebase db provision --print > request-role.sql
```

Pour chaque rôle des requêtes, elle affiche les instructions qui créent le rôle, donnent au
rôle de connexion le droit d'y basculer et, avec la valeur par défaut
`grants: "schema"`, lui accordent les schémas `public` et `rebase`. Les rôles sont
`REBASE_RLS_REQUEST_ROLE` s'il est défini, sinon ceux qu'un démarrage a enregistrés dans la
base de données, sinon `rebase_user`. L'explication est écrite sous forme de commentaires SQL, si bien
que la sortie s'exécute telle quelle. Elle lit le rôle de connexion et n'exécute rien d'autre.
`--print` est obligatoire. Associez-la à `REBASE_RLS_PROVISION_ROLE=never` lorsque les rôles
sont créés par un DBA ou par du code d'infrastructure.

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

PostgreSQL ne copiera ni ne supprimera une base de données à laquelle d'autres processus sont connectés, et cet « autre processus » est généralement votre propre `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions au préalable.

Chaque branche est une copie complète sur le disque, elles doivent donc être nettoyées. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé l'ancienneté indiquée. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.
Sans terminal où poser la question, par exemple en CI, elle ne supprime rien, dit de
passer `--yes` et se termine avec le code 1.
`list` et `info` ne font que lire : une base de données sur laquelle aucune branche n'a été créée n'en a aucune, et
elles n'y créent aucun schéma `rebase`.

`diff` montre ce qu'une branche a changé par rapport à la base dont elle a été créée : tables, colonnes, contraintes, index, triggers, politiques RLS, types enum, vues et fonctions ajoutés, supprimés ou modifiés, et par table les lignes qu'elle a insérées, mises à jour et supprimées. Les lignes que le parent a modifiées de son côté depuis sont comptées à part, et celles que les deux ont modifiées sont des conflits. `--json` affiche tout le diff, avec jusqu'à `--sample-limit` lignes par table (100 par défaut). Il lit les deux bases et n'en modifie aucune ; la fusion se fait dans Studio — voir [Examiner et fusionner une branche](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle a la priorité sur `DATABASE_URL` dans `.env` et s'efface devant `--database-url` ou un `DATABASE_URL` dans le shell, de sorte qu'une option sur la ligne de commande prévaut toujours sur un basculement effectué précédemment. `delete` refuse la branche sur laquelle vous vous trouvez, puisque chaque commande
de l'espace de travail, la suppression comprise, y est pointée : faites d'abord `switch --off`,
puis supprimez-la. Le workflow complet est décrit dans [Branches de base de données](/docs/backend/branching/).

:::note[Sur la base de données de développement gérée]
`push`, `generate` et `migrate` fonctionnent ici comme sur n'importe quelle base de données.
`push` et `generate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer la comparaison — et l'instance PGlite gérée n'en fournit qu'une seule. Sur la base gérée, chacune d'elles démarre donc, pour Atlas, un second PGlite jetable en mémoire, et l'arrête à la fin de la commande. C'est ainsi qu'une colonne y est supprimée, renommée ou rétrécie : `rebase dev` ne fait qu'ajouter. Le garde-fou destructif est le même qu'ailleurs. Pour qu'Atlas planifie plutôt contre une base vide qui est la vôtre, définissez `REBASE_ATLAS_DEV_URL` sur celle-ci ; Rebase ne crée ni ne supprime une base de données nommée de cette façon.

`branch` y est refusé. `CREATE DATABASE ... TEMPLATE` avec PGlite écrit une entrée dans le catalogue et ne copie rien, de sorte que la branche pointerait vers la base de données dont elle a été clonée — chaque écriture que vous souhaitiez isoler atterrirait dans votre base de données de développement. `rebase dev --docker` vous fournit un véritable serveur avec lequel les branches fonctionnent.
:::

## Ressources associées

- [Référence de la CLI](/docs/cli/) — toutes les autres commandes `rebase`
- [Génération de schéma](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` et `db branch` en détail
- [Sauvegardes et restauration](/docs/deployment/backups/) — planification, fichier des rôles, restauration
- [Branches de base de données](/docs/backend/branching/) — comment une branche est créée, et ce qu'elle coûte
- [Exécuter sur une base de données existante ou partagée](/docs/deployment/existing-database/) — le rôle des requêtes, ses réglages et `rebase doctor --database`
- [Scripts et console](/docs/backend/scripts/) — la même base de données depuis un script ou un REPL
