---
sourceHash: 17f8d0b5d00ba945
title: Déployer Rebase sur Hostman
description: Déployez un projet rebase init sur Hostman — App Platform avec PostgreSQL managé et stockage S3, ou un serveur cloud unique avec le fichier Compose de votre projet.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) propose deux configurations adaptées à un backend Rebase, avec des centres de données en Europe et aux États-Unis :

- **App Platform avec PostgreSQL managé.** Hostman compile et exécute votre application depuis un dépôt GitHub et gère la base de données. Ses conteneurs redémarrent de zéro à chaque déploiement, donc **les téléversements de fichiers nécessitent un bucket compatible S3 dès le premier jour**.
- **Un serveur cloud unique.** Postgres et le runtime sur un VPS, sous le `docker-compose.yml` que possède déjà votre projet. **Les téléversements peuvent rester sur le disque du serveur.**

Rien sur cette page n'est spécifique à Hostman concernant votre projet. Un déploiement Rebase est composé de deux éléments distincts — l'image du runtime publiée, et le **bundle** produit par `rebase build` — et le même bundle s'exécute sur un ordinateur portable, sur Rebase Cloud et ici.

## App Platform

### 1. Créer la base de données

Dans le panneau Hostman, créez un cluster **Managed PostgreSQL** :

- **Version :** 16 ou plus récente.
- **Région :** celle dans laquelle vous exécuterez l'application.
- **Réseau :** un réseau privé. Placez l'application dans le même réseau à l'étape 4. Le réseau d'une application est choisi lors de sa création et ne peut pas être modifié par la suite.

Le cluster est fourni avec un utilisateur, `gen_user`, et une base de données, `default_db`. Depuis l'onglet **Connection**, copiez la chaîne de connexion pour l'**IP privée** (**private IP**). Il s'agit de votre `DATABASE_URL` :

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Si le cluster requiert TLS, ajoutez `?sslmode=no-verify` à la fin : chiffré, sans vérifier le certificat auprès d'une autorité publique. Un simple `sslmode=require` est interprété comme « vérifier le certificat » par le pilote Node sur lequel fonctionne Rebase, et échoue sur un certificat qui n'a pas été signé par une autorité publique. Voir [Configuration](/docs/getting-started/configuration/#required).

#### Créer le rôle vers lequel Rebase bascule

Rebase applique la sécurité au niveau des lignes (row-level security) en basculant chaque requête authentifiée vers un rôle restreint, `rebase_user`. `gen_user` doit être autorisé à créer ce rôle et à basculer vers celui-ci.

1. Dans l'onglet **Users** du cluster, attribuez à `gen_user` le privilège **CREATE ROLE**. La plus petite configuration de Hostman (1 CPU, 1 Go de RAM, 20 Go) ne permet pas d'ajouter des utilisateurs ou des bases de données. Si elle ne vous permet pas d'accorder le privilège, choisissez la configuration supérieure.
2. Connectez-vous une fois en tant que `gen_user` avec `psql`, avant le premier déploiement, et exécutez :

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   La base de données se trouve sur un réseau privé, exécutez donc ceci depuis un serveur cloud situé sur le même réseau, ou activez l'accès public pendant cette opération.

La deuxième instruction est la plus importante. Sur PostgreSQL 16 et plus récent, un utilisateur qui crée un rôle sans être superutilisateur en devient membre, mais ne peut pas basculer vers celui-ci. Si le runtime crée le rôle lui-même, le démarrage réussit et chaque requête authentifiée échoue ensuite avec `DB_PERMISSION_DENIED`. Si cela s'est déjà produit, exécutez la ligne `GRANT` et redémarrez l'application.

Si vos tables déclarent une colonne `col.vector()`, activez **pgvector** sous **Configuration → Extensions**. Le scaffold n'en déclare aucune.

### 2. Créer un bucket

Créez un bucket compatible S3 — le stockage S3 propre à Hostman, ou tout autre fournisseur. Depuis les paramètres du bucket, notez le point de terminaison (endpoint), la région, la clé d'accès (access key) et la clé secrète (secret key). Conservez le bucket **privé** : Rebase signe chaque téléchargement, et `storageAuthorize` dans `backend/storage.ts` détermine qui peut lire, écrire et lister.

### 3. Ajouter un Dockerfile

App Platform compile à partir de votre dépôt, et `dist-bundle/` est ignoré par git, l'image compile donc le bundle elle-même avant de le transmettre au runtime publié. Committez ceci à la racine du projet :

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.36.0
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Trois détails sont importants ici :

- **`node:22`, pas `node:22-slim`.** L'installation de la CLI télécharge le moteur de schéma Atlas, qui a besoin de `curl` et des certificats CA. L'image slim ne contient ni l'un ni l'autre, et l'installation échoue.
- **`--chown=node:node`.** Le runtime s'exécute en tant que `node` et crée des liens vers ses propres packages dans le bundle au démarrage. Un bundle appartenant à root fonctionne toujours, mais consigne un avertissement pour chaque package qu'il n'a pas pu lier.
- **Aucun code source dans l'image finale.** Elle ne contient que le runtime et votre bundle compilé. La mise à niveau ultérieure de Rebase consiste simplement à modifier la deuxième ligne `FROM`.

L'image du runtime écoute sur le port 8080 et le déclare avec `EXPOSE`, qui est le port vers lequel App Platform achemine le trafic.

### 4. Créer l'application

Dans **App Platform**, créez une application **Backend** :

1. Connectez le dépôt GitHub et la branche.
2. Définissez **Framework** sur **Dockerfile**.
3. Choisissez la même région que la base de données, ainsi que le **réseau privé** de la base de données.
4. Choisissez une configuration avec **2 Go de RAM**. Le bundle est compilé lors de la création de l'image et la compilation culmine à environ 1 Go, une configuration de 1 Go peut donc manquer de mémoire.
5. Définissez le **health check path** sur `/livez`. La valeur par défaut, `/`, fonctionne aussi, mais `/livez` répond sans solliciter la base de données, de sorte qu'un bref dysfonctionnement de la base de données ne redémarre pas une application saine.

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

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` définissent le premier administrateur. En production, le premier compte à s'inscrire n'est pas promu, donc aucun autre mécanisme n'en crée un. Le runtime crée le compte une seule fois, tant que la table des utilisateurs est vide. Voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

L'adresse de l'application n'est pas connue tant qu'elle n'a pas été créée. Créez l'application, récupérez son domaine technique dans l'onglet **Dashboard**, puis attribuez-le à `CORS_ORIGINS` et `FRONTEND_URL`. L'enregistrement des paramètres redéploie l'application.

### 5. Ouvrir l'application

Ouvrez le domaine de l'application. Un unique conteneur sert le panneau d'administration sur `/` et l'API sur `/api`. Connectez-vous avec `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, puis modifiez le mot de passe.

Chaque push sur la branche déclenche un redéploiement. Pour ajouter votre propre domaine, utilisez **Settings → Domains**. Hostman émet le certificat. Ajoutez la nouvelle origine à `CORS_ORIGINS` et `FRONTEND_URL`.

## Un serveur cloud unique

Un serveur cloud Hostman exécute la même pile que n'importe quel VPS : Postgres et le runtime sous le `docker-compose.yml` propre à votre projet, avec Caddy en frontal pour le HTTPS. Un serveur avec 2 vCPU et 2 Go de RAM est suffisant pour commencer.

Créez-le avec **Ubuntu 24.04** et votre clé SSH, puis suivez les [étapes pour un serveur unique sur la page Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Rien dans ces étapes ne dépend de Hetzner.

Sur un serveur, les téléversements restent sur son disque : le fichier Compose les conserve sur un volume nommé et définit `FORCE_LOCAL_STORAGE=true`. Ils survivent aux redémarrages et aux redéploiements, mais pas à la perte du serveur ; activez donc les sauvegardes de serveur de Hostman ou déplacez-les vers un bucket lorsqu'ils commencent à devenir importants.

## Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma. Il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes, de sorte qu'une nouvelle table est disponible dès le déploiement suivant.

`ensure` ne modifie jamais un élément existant. Il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les valeurs d'un enum existant, car un déploiement ne doit pas altérer un schéma comme effet secondaire.

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé — nécessite `rebase db push`, exécuté depuis une copie de travail locale :

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Lisez le code SQL affiché par la simulation (dry run), puis réexécutez la commande sans `--dry-run`. Deux éléments sont à prévoir au préalable sur Managed PostgreSQL :

- **Accessibilité.** Une base de données sur un réseau privé n'est pas accessible depuis votre ordinateur portable. Activez l'accès public pour la durée de l'opération, ou exécutez la commande depuis un serveur situé sur le même réseau.
- **La base de données temporaire (scratch database).** `db push` planifie chaque modification dans une copie temporaire du schéma, dans une base de données nommée d'après la vôtre avec le suffixe `_dev_diff`. Accordez à `gen_user` le privilège **CREATEDB**, ou créez `default_db_dev_diff` une fois depuis le panneau de configuration. Ni l'un ni l'autre n'est possible sur la plus petite configuration.

Pour les migrations versionnées, committez plutôt les fichiers de migration avec `rebase db generate` et exécutez `rebase db migrate` comme étape de release.

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
- [Stockage](/docs/backend/storage) — buckets, règles d'accès et plusieurs sources de stockage simultanées.
