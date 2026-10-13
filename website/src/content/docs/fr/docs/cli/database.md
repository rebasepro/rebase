---
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

:::caution
`db push` modifie directement la base de données sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `drizzle/migrations/` qui peuvent être vérifiés et commités.

### `rebase db migrate`

Exécuter les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et, étant destructeur, nécessite `--yes`.
<span class="since-badge" data-since="0.25">Depuis 0.25</span> Les chemins relatifs,
et la valeur par défaut `./backups`, se résolvent par rapport au répertoire depuis lequel vous lancez
`rebase`, de sorte que les trois lignes ci-dessus se retrouvent dans un même répertoire ; une
option qu'une commande n'accepte pas est refusée avant que quoi que ce soit ne s'exécute. En 0.24, la valeur par
défaut est `backend/backups` : listez-la donc avec `--out ./backups`.
<span class="since-badge" data-since="0.25">Depuis 0.25</span> La sauvegarde et son fichier des rôles ne sont lisibles que par vous (0600), et
face à une base de données qui ne tourne pas, `backup` et `restore` affichent la
bannière qu'affiche `db push`. En 0.24, les sauvegardes sont en 0644.
La planification, le fichier des rôles qui accompagne chaque sauvegarde, et la procédure de
restauration sont décrits dans [Sauvegardes et restauration](/docs/deployment/backups/).

### `rebase db pull`

Copier une autre base de données dans la base de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` remplace les champs personnels lors de l'import, afin qu'une copie de production puisse être exploitée localement sans transférer de réelles données client sur un ordinateur portable. Il repère
les colonnes par leur nom et procède au mieux (best-effort). <span class="since-badge" data-since="0.25">Depuis 0.25</span>
Une colonne sous un index unique reçoit une valeur distincte par ligne, et le passage tient en une seule
transaction : s'il échoue, les tables qu'il aurait réécrites sont vidées et
nommées, et la commande se termine avec le code 1. En 0.24, il échouait sur `token_hash` dès que des utilisateurs
s'étaient connectés deux fois, en laissant de réelles données derrière lui.

`pg_dump` supprime les privilèges, de sorte que la copie arriverait avec les politiques RLS de la source et aucun des droits d'accès (grants) sous-jacents — chaque lecture en tant que `rebase_user` échouant avec `permission denied`. Le pull réattribue ensuite le rôle de l'application, en utilisant la même routine que le démarrage et `rebase db push`, afin que les tables internes de Rebase restent révoquées comme il se doit.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est refusé plutôt qu'accepté, il n'y a donc aucun moyen de spécifier "pull vers la production". `--from` est la seule direction possible.

### `rebase db url`

Afficher la chaîne de connexion utilisée par ce projet, et rien d'autre, pour pouvoir l'utiliser dans un pipe :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas d'usage qui nécessite cela : `.env` laisse volontairement `DATABASE_URL` commentée, et le port est dérivé du chemin du projet, de sorte que rien sur le disque ne la mentionne. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est ce qui s'affiche — l'ordre de résolution est le même que celui suivi par toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Après
`rebase dev --docker`, `db url` et les autres commandes utilisent cette base de données Docker
(et le disent sur stderr) jusqu'à ce qu'un `rebase dev` soit lancé sans l'option. Ce choix est
conservé dans `.rebase/dev-database.json` et se classe là où se classe `--docker`, sous toutes les
chaînes de connexion. Un `--docker` que vous tapez et qu'une chaîne de connexion écarte
ne démarre aucun conteneur : une ligne sur stderr dit qu'il a été ignoré, nomme ce qui l'a emporté,
et indique comment atteindre Docker autrement. En 0.24, chaque commande exige son propre
`--docker`, et une option écartée démarre quand même le conteneur.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL ne copiera ni ne supprimera une base de données à laquelle d'autres processus sont connectés, et cet « autre processus » est généralement votre propre `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions au préalable.

Chaque branche est une copie complète sur le disque, elles doivent donc être nettoyées. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé l'ancienneté indiquée. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.
<span class="since-badge" data-since="0.25">Depuis 0.25</span> Sans terminal où poser la question, par exemple en CI, elle ne supprime rien, dit de
passer `--yes` et se termine avec le code 1 ; en 0.24, elle dit « Nothing was changed. » et se termine avec le code 0.
`list` et `info` ne font que lire : une base de données sur laquelle aucune branche n'a été créée n'en a aucune, et
elles n'y créent aucun schéma `rebase`. En 0.24, elles créent le registre.

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle a la priorité sur `DATABASE_URL` dans `.env` et s'efface devant `--database-url` ou un `DATABASE_URL` dans le shell, de sorte qu'une option sur la ligne de commande prévaut toujours sur un basculement effectué précédemment. `delete` refuse la branche sur laquelle vous vous trouvez, puisque chaque commande
de l'espace de travail, la suppression comprise, y est pointée : faites d'abord `switch --off`,
puis supprimez-la. Le workflow complet est décrit dans [Branches de base de données](/docs/backend/branching/).

:::note[Sur la base de données de développement gérée]
<span class="since-badge" data-since="0.25">Depuis 0.25</span> `push`, `generate` et `migrate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer la comparaison — et l'instance PGlite gérée n'en fournit qu'une seule. Sur la base gérée, chacune d'elles démarre donc, pour Atlas, un second PGlite jetable en mémoire, et l'arrête à la fin de la commande. C'est ainsi qu'une colonne y est supprimée, renommée ou rétrécie : `rebase dev` ne fait qu'ajouter. Le garde-fou destructif est le même qu'ailleurs. Pour qu'Atlas planifie plutôt contre une base vide qui est la vôtre, définissez `REBASE_ATLAS_DEV_URL` sur celle-ci ; Rebase ne crée ni ne supprime une base de données nommée de cette façon.

`branch` y est refusé. `CREATE DATABASE ... TEMPLATE` avec PGlite écrit une entrée dans le catalogue et ne copie rien, de sorte que la branche pointerait vers la base de données dont elle a été clonée — chaque écriture que vous souhaitiez isoler atterrirait dans votre base de données de développement. `rebase dev --docker` vous fournit un véritable serveur avec lequel les branches fonctionnent.
:::

## Ressources associées

- [Référence de la CLI](/docs/cli/) — toutes les autres commandes `rebase`
- [Génération de schéma](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` et `db branch` en détail
- [Sauvegardes et restauration](/docs/deployment/backups/) — planification, fichier des rôles, restauration
- [Branches de base de données](/docs/backend/branching/) — comment une branche est créée, et ce qu'elle coûte
- [Scripts et console](/docs/backend/scripts/) — la même base de données depuis un script ou un REPL
