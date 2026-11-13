---
sourceHash: 690eccad01963163
title: Déployer Rebase sur Hostman
description: Déployez un projet rebase init sur Hostman — App Platform avec PostgreSQL géré et stockage S3, ou un serveur cloud unique avec le fichier Compose de votre projet.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) propose deux configurations adaptées à un backend Rebase, avec des centres de données en Europe et aux États-Unis :

- **App Platform avec PostgreSQL géré.** Hostman compile et exécute votre application depuis un dépôt GitHub et gère la base de données. Ses conteneurs redémarrent de zéro à chaque déploiement, donc **les téléversements de fichiers nécessitent un bucket compatible S3 dès le premier jour**.
- **Un serveur cloud unique.** Postgres et le runtime sur un VPS, sous le fichier `docker-compose.yml` que votre projet possède déjà. **Les téléversements peuvent rester sur le disque du serveur.**

Rien sur cette page n'est spécifique à Hostman concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image du runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle fonctionne sur un ordinateur portable, sur Rebase Cloud et ici.

## App Platform

### 1. Créer la base de données

Dans le panneau Hostman, créez un cluster **Managed PostgreSQL** :

- **Version :** 16 ou plus récente.
- **Région :** celle dans laquelle vous exécuterez l'application.
- **Réseau :** un réseau privé (private network). Placez l'application dans le même réseau à l'étape 4. Le réseau d'une application est choisi lors de sa création et ne peut plus être modifié par la suite.

Le cluster est fourni avec un utilisateur, `gen_user`, et une base de données, `default_db`. Depuis l'onglet **Connection**, copiez la chaîne de connexion pour l'**IP privée**. Il s'agit de votre `DATABASE_URL` :

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Si le cluster requiert TLS, ajoutez `?sslmode=require` à la fin.

#### Créer le rôle vers lequel Rebase bascule

Rebase applique la sécurité au niveau des lignes (Row-Level Security) en basculant chaque requête authentifiée vers un rôle restreint, `rebase_user`. `gen_user` doit être autorisé à créer ce rôle et à basculer vers lui.

1. Dans l'onglet **Users** du cluster, attribuez à `gen_user` le privilège **CREATE ROLE**. La plus petite configuration de Hostman (1 CPU, 1 Go de RAM, 20 Go) ne permet pas d'ajouter des utilisateurs ou des bases de données. Si elle ne vous permet pas d'accorder ce privilège, choisissez la configuration supérieure.
2. Connectez-vous une fois avec `psql` en tant que `gen_user`, avant le premier déploiement, et exécutez :

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   La base de données se trouvant sur un réseau privé, exécutez ceci depuis un serveur cloud situé sur le même réseau, ou activez l'accès public pour la durée de l'opération.

La deuxième instruction est la plus importante. Sur PostgreSQL 16 et versions ultérieures, un utilisateur qui crée un rôle sans être superutilisateur en devient membre, mais sans l'autorisation d'y basculer. Si le runtime crée le rôle lui-même, le démarrage réussit mais chaque requête authentifiée échoue ensuite avec l'erreur `DB_PERMISSION_DENIED`. Si cela s'est déjà produit, exécutez la ligne `GRANT` et redémarrez l'application.

Si vos tables déclarent une colonne `col.vector()`, activez **pgvector** sous **Configuration → Extensions**. La structure de base n'en déclare aucune.

### 2. Créer un bucket

Créez un bucket compatible S3 — le stockage S3 propre à Hostman, ou tout autre fournisseur. Depuis les paramètres du bucket, notez le point de terminaison (endpoint), la région, la clé d'accès (access key) et la clé secrète (secret key). Gardez le bucket **privé** : Rebase signe chaque téléchargement, et `storageAuthorize` dans `backend/storage.ts` détermine qui peut lire, écrire et lister.

### 3. Ajouter un Dockerfile

App Platform compile à partir de votre dépôt, et `dist-bundle/` est ignoré par Git, donc l'image compile le bundle elle-même, puis le transmet au runtime publié. Commitez ceci à la racine du projet :

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.30.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Trois détails sont importants ici :

- **`node:22`, et non `node:22-slim`.** L'installation de la CLI télécharge le moteur de schéma Atlas, qui nécessite `curl` et les certificats CA. L'image slim ne possède ni l'un ni l'autre, et l'installation échoue.
- **`--chown=node:node`.** Le runtime s'exécute en tant que `node` et lie ses propres paquets dans le bundle au démarrage. Un bundle appartenant à root fonctionnera tout de même, mais affichera un avertissement pour chaque paquet qu'il n'a pas pu lier.
- **Aucun code source dans l'image finale.** Elle ne contient que le runtime et votre bundle compilé. Mettre à niveau Rebase ultérieurement revient simplement à modifier la deuxième ligne `FROM`.

L'image du runtime écoute sur le port 8080 et le déclare avec `EXPOSE`, ce qui correspond au port vers lequel App Platform achemine le trafic.

### 4. Créer l'application

Dans **App Platform**, créez une application **Backend** :

1. Connectez le dépôt GitHub et la branche.
2. Définissez le **Framework** sur **Dockerfile**.
3. Choisissez la même région que la base de données, ainsi que le **réseau privé** de la base de données.
4. Choisissez une configuration avec **2 Go de RAM**. Le bundle est compilé lors de la création de l'image et la compilation monte jusqu'à environ 1 Go, donc une configuration de 1 Go peut manquer de mémoire.
5. Définissez le **health check path** sur `/livez`. La valeur par défaut, `/`, fonctionne également, mais `/livez` répond sans solliciter la base de données, évitant ainsi qu'une brève saute d'humeur de la base ne redémarre une application saine.

Sous **Advanced settings**, ajoutez les variables d'environnement :

```env
NODE_ENV=production
DATABASE_URL=postgresql://gen_user:<password>@<private-ip>:5432/default_db
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app-domain>
FRONTEND_URL=https://<your-app-domain>
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` désignent le premier administrateur. En production, le premier compte à s'inscrire n'est pas promu, donc rien d'autre n'en créera un. Le runtime crée le compte une seule fois, pendant que la table des utilisateurs est vide. Voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

L'adresse de l'application n'est pas connue tant qu'elle n'existe pas. Créez l'application, récupérez son domaine technique depuis l'onglet **Dashboard**, puis assignez-le à `CORS_ORIGINS` et `FRONTEND_URL`. L'enregistrement des paramètres redéploie l'application.

### 5. Ouvrir l'application

Ouvrez le domaine de l'application. Un conteneur unique dessert le panneau d'administration à l'adresse `/` et l'API à l'adresse `/api`. Connectez-vous avec `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, puis modifiez le mot de passe.

Chaque push sur la branche déclenche un nouveau déploiement. Pour ajouter votre propre domaine, utilisez **Settings → Domains**. Hostman émet le certificat. Ajoutez la nouvelle origine à `CORS_ORIGINS` et `FRONTEND_URL`.

## Un serveur cloud unique

Un serveur cloud Hostman exécute la même stack que n'importe quel VPS : Postgres et le runtime sous le propre fichier `docker-compose.yml` de votre projet, avec Caddy en amont pour le HTTPS. Un serveur avec 2 vCPU et 2 Go de RAM est suffisant pour démarrer.

Créez-le avec **Ubuntu 24.04** et votre clé SSH, puis suivez les [étapes pour un serveur unique sur la page Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Aucune d'entre elles ne dépend de Hetzner.

Sur un serveur, les téléversements restent sur son disque : le fichier Compose les conserve sur un volume nommé et définit `FORCE_LOCAL_STORAGE=true`. Ils survivent aux redémarrages et aux redéploiements, mais pas à la perte du serveur ; activez donc les sauvegardes de serveur de Hostman ou déplacez-les vers un bucket dès qu'ils commencent à avoir de l'importance.

## Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma. Il crée les tables, les colonnes et les types enum manquants et applique leur sécurité au niveau des lignes, de sorte qu'une nouvelle table est active dès le déploiement suivant.

`ensure` ne modifie jamais ce qui existe déjà. Il ne change pas le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car un déploiement ne doit pas altérer un schéma comme effet secondaire.

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé — nécessite `rebase db push`, exécuté depuis un checkout :

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Lisez le SQL affiché par l'exécution à blanc (dry run), puis exécutez-le à nouveau sans `--dry-run`. Deux choses doivent d'abord être configurées sur Managed PostgreSQL :

- **L'accessibilité.** Une base de données située sur un réseau privé n'est pas accessible depuis votre ordinateur portable. Activez l'accès public pour la durée de l'opération, ou exécutez la commande depuis un serveur situé sur le même réseau.
- **La base de données temporaire (scratch database).** `db push` planifie chaque modification dans une copie temporaire du schéma, dans une base de données nommée d'après la vôtre avec `_dev_diff` à la fin. Accordez à `gen_user` le privilège **CREATEDB**, ou créez `default_db_dev_diff` une fois depuis le panneau. Aucune de ces options n'est possible sur la plus petite configuration.

Pour les migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` comme étape de release.

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production, et les règles concernant le premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
- [Stockage](/docs/backend/storage) — buckets, règles d'accès, et gestion simultanée de plusieurs sources de stockage.
