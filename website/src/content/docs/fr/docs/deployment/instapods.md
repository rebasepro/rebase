---
sourceHash: ecae5803328dcd65
title: Déployer Rebase sur InstaPods
description: Déployez un projet fraîchement initialisé avec rebase init vers une URL HTTPS en direct sur un pod InstaPods — Node, PostgreSQL et téléversements de fichiers sur la même machine, sans Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) exécute votre application dans un conteneur persistant — un *pod* — avec Node.js, un service PostgreSQL optionnel sur `localhost`, HTTPS automatique et des déploiements depuis un dépôt GitHub. Un backend Rebase se compose d'un processus Node et d'un Postgres, donc l'ensemble tient sur un seul pod : l'API, l'authentification, le temps réel, les tâches cron, le panneau d'administration et le stockage de fichiers.

Cette page vous guide pour faire passer un projet tout juste créé avec `rebase init` à une URL en direct. Tout s'exécute sur le pod lui-même ; il n'y a pas d'image Docker ni rien d'autre à provisionner.

**Les téléversements de fichiers peuvent commencer sur le propre disque du pod.** Le système de fichiers d'un pod survit aux redémarrages et aux redéploiements, le stockage local y est donc sûr, et vous pourrez passer à un bucket compatible S3 plus tard sans modifier le code. Consultez [Stockage de fichiers](#stockage-de-fichiers).

## Ce dont vous avez besoin

- Le forfait **Build** ou supérieur (7 $/mois : 2 vCPU, 2 Go de RAM, 25 Go de disque). Le forfait Launch ne peut pas exécuter le service PostgreSQL.
- Un dépôt GitHub pour le projet.
- La [CLI InstaPods](https://docs.instapods.com/), pour les étapes liées à la base de données et à l'environnement. Le tableau de bord permet de faire les mêmes opérations.

## 1. Créer le projet et le pousser

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Commitez-le et poussez-le vers un dépôt GitHub. Le fichier `.env` est ignoré par Git (`gitignored`), et le reste : le pod recevra ses propres valeurs à l'étape 4.

## 2. Créer le pod

Dans le tableau de bord InstaPods, créez un pod avec le préréglage **Node.js** sur le forfait **Build**.

Le projet généré déclare Node `>=22.22.0` et refuse de s'installer sur une version plus ancienne. Vérifiez la version du pod et passez-le à Node 24 si sa version de Node 22 est antérieure :

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. Ajouter PostgreSQL

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

La deuxième commande affiche les identifiants : hôte `localhost`, port `5432`, utilisateur et base de données `instapod`, et un mot de passe généré. Votre chaîne de connexion est :

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Ensuite, créez le rôle sous lequel Rebase exécute les requêtes authentifiées. Rebase applique la sécurité au niveau des lignes (row-level security / RLS) en basculant chaque requête vers un rôle restreint, `rebase_user`, et l'utilisateur `instapod` a besoin de la permission de basculer vers celui-ci. Créez-le une fois en tant que superutilisateur Postgres, avant le premier déploiement :

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

Le runtime s'occupe du reste lors du premier démarrage : les privilèges et les politiques sur vos tables appartiennent à `instapod`, qui est propriétaire de sa base de données.

Faites cela même si le runtime pouvait créer le rôle lui-même. Un utilisateur autorisé à créer des rôles mais qui n'est pas un superutilisateur obtient, sur PostgreSQL 16 et versions ultérieures, une appartenance au rôle créé qui ne lui permet pas de basculer vers celui-ci. Le démarrage réussit alors, mais chaque requête authentifiée échoue avec `DB_PERMISSION_DENIED`. Si cela s'est déjà produit, exécutez `GRANT rebase_user TO instapod WITH SET TRUE;` de la même manière et redémarrez l'application.

## 4. Configurer l'environnement

Générez les deux secrets avec `openssl rand -hex 32` (une fois pour chacun), puis configurez le tout en une seule commande :

```bash
instapods env set my-app \
  DATABASE_URL='postgresql://instapod:<password>@localhost:5432/instapod' \
  ALLOW_LOCALHOST_IN_PRODUCTION=true \
  JWT_SECRET=<first-secret> \
  REBASE_SERVICE_KEY=<second-secret> \
  CORS_ORIGINS=https://my-app.nbg1-1.instapods.app \
  FRONTEND_URL=https://my-app.nbg1-1.instapods.app \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=<at-least-12-characters> \
  STORAGE_TYPE=local \
  STORAGE_PATH=/home/instapod/app/uploads \
  FORCE_LOCAL_STORAGE=true
```

Utilisez l'URL propre à votre pod pour `CORS_ORIGINS` et `FRONTEND_URL` : le tableau de bord l'affiche, et c'est l'adresse à laquelle vous ouvrirez le panneau d'administration. Ajoutez un domaine personnalisé plus tard et renseignez-le dans les deux.

À quoi servent les lignes les moins évidentes :

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** En production, le runtime refuse une variable `DATABASE_URL` pointant vers `localhost`, car dans un conteneur, cette adresse est généralement une erreur. Sur un pod, la base de données se trouve bel et bien sur la même machine, et cette ligne le confirme.
- **`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`.** En production, le premier compte à s'inscrire n'est pas configuré comme administrateur, ces variables désignent donc le premier. Le runtime crée le compte une seule fois, pendant que la table des utilisateurs est vide. Connectez-vous avec et modifiez le mot de passe. Voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).
- **Les trois lignes de stockage.** Expliquées sous [Stockage de fichiers](#stockage-de-fichiers).

`instapods env set` écrit `/home/instapod/app/.env`, qui est le fichier lu par `rebase start`. InstaPods définit lui-même `PORT`, et le runtime s'y associe.

## 5. Connecter le dépôt

Dans l'onglet **Git** du pod, connectez le dépôt et la branche, puis configurez les commandes :

| Champ | Valeur |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(laisser vide)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Pourquoi chacune d'elles est configurée ainsi :

- **Install** exécute pnpm via `npx`, car le projet fournit un fichier `pnpm-lock.yaml` et le pod peut ne pas avoir pnpm installé. `--prod=false` conserve les dépendances de développement — la CLI Rebase et TypeScript, nécessaires au build — même si `NODE_ENV` est déjà défini sur `production` pendant l'installation.
- **Build** exécute `rebase build`. Il compile vos tables, fonctions et crons dans `dist-bundle/`, et compile le panneau d'administration dans le même bundle. La mémoire culmine à environ 1 Go.
- **Start** exécute le bundle généré. `NODE_ENV=production` est défini directement dans la commande, afin que le runtime ne démarre jamais en mode développement — où le premier venu à s'inscrire deviendrait administrateur.

Déployez. Chaque push ultérieur sur la branche déclenchera un nouveau déploiement.

## 6. Ouvrir l'application

Ouvrez l'URL du pod. Un seul processus sert le panneau d'administration sur `/` et l'API sur `/api`. Connectez-vous avec `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`.

Le premier démarrage crée toutes les tables nécessaires, y compris les vôtres, ainsi que leurs politiques de sécurité au niveau des lignes. Il n'y a aucune migration à exécuter au préalable.

Si les journaux indiquent `Failed to create the "rebase_user" role`, l'étape à la fin de [Ajouter PostgreSQL](#3-ajouter-postgresql) a été ignorée : exécutez-la, puis faites `instapods pods restart my-app`.

## Stockage de fichiers

Les téléversements sont stockés sur le disque du pod sous `/home/instapod/app/uploads`, un répertoire que le fichier `.gitignore` du projet initial exclut déjà du dépôt.

En production, le runtime refuse le stockage local à moins que vous n'indiquiez que le disque est persistant, car sur la plupart des plateformes de conteneurs, il ne l'est pas : le système de fichiers est remplacé à chaque déploiement, emportant avec lui tous les fichiers téléversés. Un pod est différent, car ses fichiers persistent d'un redémarrage et d'un déploiement à l'autre. `FORCE_LOCAL_STORAGE=true` l'indique au runtime.

Conserver le répertoire dans `/home/instapod/app` l'inclut également dans la sauvegarde quotidienne du pod par InstaPods, qui couvre ce répertoire et effectue un dump de la base de données en parallèle.

Ce que le stockage local ne permet pas :

- **Servir depuis plusieurs machines.** Les fichiers existent uniquement sur ce pod. Une deuxième instance ou un CDN placé devant les fichiers nécessite un bucket.
- **Dépasser l'espace disque du forfait.** Les téléversements partagent les 25 Go avec la base de données et l'application.

Lorsque vos besoins dépassent cette capacité, associez n'importe quel bucket compatible S3 et supprimez les trois lignes locales :

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

Les fichiers déjà présents sur le pod ne sont pas déplacés automatiquement : copiez-les dans le bucket en conservant leurs clés. Les autorisations de lecture, d'écriture et de listage des fichiers sont définies par `storageAuthorize` dans `backend/storage.ts`, quel que soit le backend qui les stocke. Voir [Stockage](/docs/backend/storage).

## Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées dans `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma. Cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes, rendant ainsi toute nouvelle collection active dès le prochain déploiement.

`ensure` ne modifie jamais ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car un déploiement ne doit pas altérer un schéma comme effet secondaire.

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé — nécessite `rebase db push`, exécuté depuis votre machine.

`db push` prépare chaque modification dans une copie temporaire du schéma, dans une base de données portant le même nom que la vôtre suffixée par `_dev_diff`, et l'utilisateur `instapod` n'est pas autorisé à créer des bases de données. Créez-la une fois en tant que superutilisateur :

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

Le Postgres du pod écoute uniquement sur `localhost` ; accédez-y donc via un tunnel SSH, puis poussez les modifications :

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Lisez le SQL affiché par la simulation (`dry-run`), puis exécutez-la à nouveau sans `--dry-run`. Une modification qui supprime des données nécessite également `--allow-destructive`.

Pour les migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et renseignez `node_modules/.bin/rebase db migrate` dans le champ **Release**, qu'InstaPods exécute à chaque déploiement.

Si vos tables déclarent une colonne `col.vector()`, le Postgres du pod a besoin de l'extension pgvector : installée sur le pod, puis créée par le superutilisateur avec `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"`. Le projet de départ n'en déclare aucune.

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la liste de contrôle pour la production, et les règles concernant le premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
- [Stockage](/docs/backend/storage) — buckets, règles d'accès et gestion de plusieurs sources de stockage simultanées.
