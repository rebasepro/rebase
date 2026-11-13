---
sourceHash: 5f650040f2d3d2f9
title: Déployer Rebase sur Hostman
description: Déployez un projet rebase init sur Hostman — App Platform avec PostgreSQL géré et stockage S3, ou un serveur cloud unique avec le propre fichier Compose de votre projet.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) propose deux configurations adaptées à un backend Rebase, avec des centres de données en Europe et aux États-Unis :

- **App Platform avec PostgreSQL géré.** Hostman compile et exécute votre application depuis un dépôt GitHub et gère la base de données. Ses conteneurs repartent de zéro à chaque déploiement, donc **les téléversements de fichiers nécessitent un bucket compatible S3 dès le premier jour**.
- **Un serveur cloud unique.** Postgres et le runtime sur un VPS, sous le `docker-compose.yml` que votre projet possède déjà. **Les téléversements peuvent rester sur le disque du serveur.**

Rien sur cette page n'est spécifique à Hostman concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image du runtime publiée et le **bundle** produit par `rebase build` — et le même bundle s'exécute aussi bien sur un ordinateur portable que sur Rebase Cloud ou ici.

## App Platform

### 1. Créer la base de données

Dans le panneau de configuration Hostman, créez un cluster **Managed PostgreSQL** :

- **Version :** 16 ou plus récente.
- **Région :** celle dans laquelle vous exécuterez l'application.
- **Réseau :** un réseau privé. Placez l'application dans le même réseau à l'étape 4. Le réseau d'une application est choisi lors de sa création et ne peut pas être modifié par la suite.

Le cluster est fourni avec un utilisateur, `gen_user`, et une base de données, `default_db`. Depuis l'onglet **Connection**, copiez la chaîne de connexion pour l'**adresse IP privée**. Il s'agit de votre `DATABASE_URL` :

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Si le cluster nécessite TLS, ajoutez `?sslmode=require` à la fin.

#### Créer le rôle vers lequel Rebase bascule

Rebase applique la sécurité au niveau des lignes (Row-Level Security) en basculant chaque requête authentifiée vers un rôle restreint, `rebase_user`. `gen_user` doit être autorisé à créer ce rôle et à basculer vers celui-ci.

1. Dans l'onglet **Users** du cluster, attribuez à `gen_user` le privilège **CREATE ROLE**. La plus petite configuration de Hostman (1 CPU, 1 Go de RAM, 20 Go) ne permet pas d'ajouter des utilisateurs ou des bases de données. Si elle ne vous permet pas d'accorder ce privilège, choisissez la configuration supérieure.
2. Connectez-vous une fois en tant que `gen_user` avec `psql`, avant le premier déploiement, et exécutez :

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   La base de données se trouve sur un réseau privé, exécutez donc ceci depuis un serveur cloud situé sur le même réseau, ou activez l'accès public pour la durée de l'opération.

La seconde instruction est celle qui importe. Sur PostgreSQL 16 et versions ultérieures, un utilisateur qui crée un rôle sans être superutilisateur en devient membre, mais sans pouvoir basculer vers celui-ci. Si le runtime crée le rôle lui-même, le démarrage réussit et chaque requête authentifiée échoue ensuite avec `DB_PERMISSION_DENIED`. Si cela s'est déjà produit, exécutez la ligne `GRANT` et redémarrez l'application.

Si vos tables déclarent une colonne `col.vector()`, activez **pgvector** sous **Configuration → Extensions**. Le squelette de base n'en déclare aucune.

### 2. Créer un bucket

Créez un bucket compatible S3 — le stockage S3 propre à Hostman ou tout autre fournisseur. Depuis les paramètres du bucket, notez l'endpoint, la région, la clé d'accès (access key) et la clé secrète (secret key). Gardez le bucket **privé** : Rebase signe chaque téléchargement, et `storageAuthorize` dans `backend/storage.ts` détermine qui peut lire, écrire et lister.

### 3. Ajouter un Dockerfile

App Platform compile à partir de votre dépôt, et `dist-bundle/` est ignoré par git, l'image compile donc le bundle elle-même, puis le transmet au runtime publié. Commitez ceci à la racine du projet :

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

- **`node:22`, et non `node:22-slim`.** L'installation du CLI télécharge le moteur de schéma Atlas, qui nécessite `curl` et les certificats CA. L'image slim ne contient ni l'un ni l'autre, et l'installation échoue.
- **`--chown=node:node`.** Le runtime s'exécute en tant que `node` et lie ses propres paquets au bundle au démarrage. Un bundle appartenant à root fonctionne tout de même, mais émet un avertissement pour chaque paquet qu'il n'a pas pu lier.
- **Aucun code source dans l'image finale.** Elle contient uniquement le runtime et votre bundle compilé. Mettre à jour Rebase ultérieurement consiste simplement à modifier la seconde ligne `FROM`.

L'image du runtime écoute sur le port 8080 et le déclare avec `EXPOSE`, qui est le port vers lequel App Platform achemine le trafic.

### 4. Créer l'application

Dans **App Platform**, créez une application **Backend** :

1. Connectez le dépôt GitHub et la branche.
2. Définissez **Framework** sur **Dockerfile**.
3. Choisissez la même région que la base de données, ainsi que le **réseau privé** de la base de données.
4. Choisissez une configuration avec **2 Go de RAM**. Le bundle est compilé lors de la construction de l'image et ce processus atteint un pic d'environ 1 Go, une configuration à 1 Go risquant ainsi de manquer de mémoire.
5. Définissez le **health check path** sur `/livez`. La valeur par défaut, `/`, fonctionne également, mais `/livez` répond sans solliciter la base de données, évitant ainsi qu'une brève interruption de celle-ci ne redémarre une application par ailleurs saine.

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

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` désignent le premier administrateur. En production, le premier compte à s'inscrire n'est pas promu, donc aucun autre moyen n'en crée un. Le runtime crée ce compte une seule fois, tant que la table des utilisateurs est vide. Voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

L'adresse de l'application n'est pas connue avant sa création. Créez l'application, récupérez son domaine technique dans l'onglet **Dashboard**, puis assignez-le à `CORS_ORIGINS` et `FRONTEND_URL`. L'enregistrement des paramètres redéploie l'application.

### 5. Ouvrir l'application

Ouvrez le domaine de l'application. Un conteneur unique dessert le panneau d'administration à `/` et l'API à `/api`. Connectez-vous avec `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, puis modifiez le mot de passe.

Chaque push sur la branche déclenche un redéploiement. Pour ajouter votre propre domaine, utilisez **Settings → Domains**. Hostman émet le certificat. Ajoutez la nouvelle origine à `CORS_ORIGINS` et `FRONTEND_URL`.

## Un serveur cloud unique

Un serveur cloud Hostman exécute la même pile que n'importe quel VPS : Postgres et le runtime sous le propre fichier `docker-compose.yml` de votre projet, avec Caddy en frontal pour le HTTPS. Un serveur avec 2 vCPU et 2 Go de RAM suffit pour commencer.

Créez-le avec **Ubuntu 24.04** et votre clé SSH, puis suivez les [étapes pour un serveur unique sur la page Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Rien dans ces étapes ne dépend de Hetzner.

Sur un serveur, les téléversements restent sur son disque : le fichier Compose les conserve sur un volume nommé et définit `FORCE_LOCAL_STORAGE=true`. Ils survivent aux redémarrages et redéploiements, mais pas à la perte du serveur ; activez donc les sauvegardes de serveur de Hostman ou déplacez-les vers un bucket lorsqu'ils prennent de l'importance.

## Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui a un effet additif sur l'ensemble du schéma. Il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes, de sorte qu'une nouvelle collection est disponible dès le déploiement suivant.

`ensure` ne modifie jamais ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car un déploiement ne doit pas altérer la structure d'un schéma par effet de bord.

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé — nécessite `rebase db push`, exécuté depuis une copie locale du projet :

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Lisez le SQL affiché par l'exécution à blanc (dry run), puis relancez la commande sans `--dry-run`. Deux éléments doivent être configurés au préalable sur Managed PostgreSQL :

- **Accessibilité.** Une base de données sur un réseau privé n'est pas accessible depuis votre ordinateur portable. Activez l'accès public pour la durée de l'opération, ou exécutez la commande depuis un serveur situé sur le même réseau.
- **La base de données temporaire.** `db push` planifie chaque modification dans une copie éphémère du schéma, au sein d'une base de données nommée d'après la vôtre avec le suffixe `_dev_diff`. Attribuez à `gen_user` le privilège **CREATEDB**, ou créez `default_db_dev_diff` une fois depuis le panneau de configuration. Aucune de ces options n'est possible sur la plus petite configuration.

Pour les migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de mise en production (release step).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la liste de contrôle pour la production, et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
- [Stockage](/docs/backend/storage) — buckets, règles d'accès, et gestion simultanée de plusieurs sources de stockage.
