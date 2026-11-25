---
sourceHash: f1dd22cb350d41d1
title: Déployer Rebase sur Out Plane
description: Déployez un projet rebase init sur Out Plane — une application créée à partir de votre dépôt, le PostgreSQL managé d'Out Plane et le téléversement de fichiers dans un bucket Out Plane.
sidebar_label: Out Plane
---

[Out Plane](https://outplane.com) compile et exécute des applications à partir d'un dépôt GitHub, avec un PostgreSQL managé et des buckets compatibles S3 au sein de la même console, en Allemagne. Un backend Rebase se compose d'un conteneur et d'une base Postgres, il correspond donc à trois ressources Out Plane : une **application**, une **base de données** et un **bucket**.

Cette page vous guide depuis un projet fraîchement créé avec `rebase init` jusqu'à une URL en production, sur une seule instance.

**Rédigé pour Rebase 0.32.0.** La version est figée dans le Dockerfile à l'étape 3 ; la mettre à jour plus tard revient simplement à modifier cette unique ligne.

**Les téléversements de fichiers vont dans un bucket dès le premier jour.** Le système de fichiers d'une application Out Plane est réinitialisé à chaque redéploiement, donc les fichiers écrits sur son disque seraient perdus lors du prochain push. Voir [Stockage de fichiers](#stockage-de-fichiers).

## Ce dont vous avez besoin

- Un compte Out Plane. Le forfait **Starter** couvre les besoins de cette page : une application, une base de données managée et un bucket.
- Un dépôt GitHub pour le projet.
- En option, la [CLI `outplane`](https://docs.outplane.com). Chaque étape ci-dessous peut être réalisée dans la console ; les équivalents en ligne de commande (CLI) sont fournis lorsqu'ils permettent de gagner du temps.

## 1. Créer le projet et le pousser

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Commitez-le et poussez-le vers un dépôt GitHub. `.env` est ignoré par Git, et le reste : l'application recevra ses propres valeurs à l'étape 5.

## 2. Créer la base de données

Dans la console, choisissez **Create → Database** :

- **Version :** 17 (par défaut) ou 16. Tout fonctionne à partir de la version 16.
- **Region :** Francfort, au plus près de votre application.

```bash
outplane db create my-app-db --region aws-eu-central-1
```

Depuis le panneau **Connection** de la base de données, copiez la chaîne de connexion (au format `psql`), ou affichez-la avec `outplane db url my-app-db`. Out Plane exige SSL pour chaque connexion. Votre `DATABASE_URL` est cette chaîne avec `sslmode=no-verify` à la fin, en remplacement de tout `sslmode` déjà présent :

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
```

**Utilisez `no-verify`, pas `require`.** Les deux chiffrent la connexion. Pour `psql`, `require` signifie également « ne pas vérifier le certificat auprès d'une autorité publique », mais le pilote Postgres utilisé par Rebase l'interprète comme « vérifier-le », et un certificat de base de données non signé publiquement échoue alors dès la première connexion avec l'erreur `self-signed certificate`. `no-verify` est la syntaxe propre au pilote correspondant à ce que `require` signifie partout ailleurs. Le guide Node.js d'Out Plane désactive lui-même cette vérification pour la même raison. La même URL fonctionne pour `rebase db push` depuis votre machine : la CLI la transmet au moteur de schéma Atlas avec `sslmode=require`.

### Le rôle vers lequel Rebase bascule

Rebase applique la sécurité au niveau des lignes (*row-level security*) en basculant chaque requête authentifiée vers un rôle restreint, `rebase_user`. Au premier démarrage, le runtime crée ce rôle, accorde au rôle de votre chaîne de connexion le droit de basculer vers lui, et vérifie que le basculement fonctionne avant de traiter la moindre requête. Il n'y a rien à exécuter manuellement.

Si le premier démarrage s'arrête avec une erreur `AppRoleSetupError` mentionnant `rebase_user`, cela signifie que le rôle de votre chaîne de connexion n'est pas autorisé à créer des rôles ou à s'accorder le basculement. L'erreur affiche le code SQL à exécuter à la place : exécutez-le une fois, avec un rôle de la base de données pouvant créer des rôles, puis redéployez.

Si vos tables déclarent une colonne `col.vector()`, la base de données a besoin de l'extension pgvector. Le projet généré initialement n'en déclare aucune.

## 3. Créer un bucket

Sous **Buckets → Create bucket**, créez-en un et laissez-le **privé** (le choix par défaut). Rebase distribue chaque téléchargement via sa propre API, et `storageAuthorize` dans `backend/storage.ts` détermine qui peut lire, écrire et lister.

Out Plane ajoute un suffixe aléatoire au nom. Utilisez le nom **complet** affiché, et non le nom court que vous avez saisi.

Dans l'onglet **Access** du bucket, créez une clé avec la permission **Read and write**. Le secret n'est affiché qu'une seule fois : copiez-le maintenant.

```bash
outplane bucket create my-app-uploads
outplane bucket key create my-app-uploads
```

Les remarques d'Out Plane concernant les téléversements depuis le navigateur nécessitant une règle CORS ne s'appliquent pas ici : le panneau d'administration Rebase et le SDK effectuent les téléversements via l'API, et le runtime écrit dans le bucket depuis le serveur.

## 4. Ajouter un Dockerfile

Out Plane compile soit à partir d'un Dockerfile, soit avec des Buildpacks. Utilisez un Dockerfile : le projet s'installe avec pnpm, et l'image compile le bundle elle-même avant de le transmettre au runtime publié. Commitez ce fichier à la racine du projet :

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.38.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Trois détails ont leur importance ici :

- **`node:22`, et non `node:22-slim`.** L'installation de la CLI télécharge le moteur de schéma Atlas, qui nécessite `curl` et les certificats CA. L'image slim ne contient ni l'un ni l'autre, et l'installation échoue.
- **`--chown=node:node`.** Le runtime s'exécute avec l'utilisateur `node` et lie ses propres paquets au bundle au démarrage. Un bundle appartenant à root fonctionnera quand même, mais émettra un avertissement pour chaque paquet qu'il n'a pas pu lier.
- **Aucun code source dans l'image finale.** Elle ne contient que le runtime et votre bundle compilé, et `dist-bundle/` reste ignoré par Git.

L'image du runtime écoute sur le port **8080** et le déclare avec `EXPOSE`, ce qui permet à Out Plane de préremplir le port lorsqu'il lit le Dockerfile.

## 5. Créer l'application

Créez une application depuis la console, connectez le dépôt et la branche, puis configurez :

| Champ | Valeur |
| --- | --- |
| Méthode de build | **Dockerfile** |
| Répertoire racine | `/` |
| Port | `8080`, **HTTP**, **public** |
| Commande de démarrage | *(laisser vide — celle de l'image)* |

```bash
outplane app create my-app --repo <owner>/<repo> --branch main --port 8080:http:public
```

Sous **Settings → Environment**, choisissez **Edit as .env** et collez :

```env
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app>.outplane.app
FRONTEND_URL=https://<your-app>.outplane.app
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<full bucket name, with its suffix>
S3_REGION=auto
S3_ENDPOINT=https://obj.outplane.dev
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
```

Cliquez ensuite sur **Save & deploy**. Out Plane n'applique les modifications d'environnement qu'au déploiement suivant. Avec la CLI, placez les mêmes lignes dans un fichier et exécutez `outplane env push --app my-app --deploy`.

À quoi servent les lignes les moins évidentes :

- **`NODE_ENV=production`.** Out Plane ne le définit pas. Sans cela, le runtime démarre en mode développement, où le premier inconnu à s'inscrire devient administrateur.
- **`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`.** En production, le premier compte créé n'est pas promu administrateur ; ces variables définissent donc le premier administrateur. Le runtime crée le compte une seule fois, tant que la table des utilisateurs est vide. Voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).
- **`S3_FORCE_PATH_STYLE=false`.** Rebase s'adresse par défaut à un endpoint S3 personnalisé selon le style de chemin (*path-style*), car MinIO et la plupart des stockages auto-hébergés le nécessitent. Les buckets Out Plane n'acceptent que les requêtes basées sur le sous-domaine (*virtual-hosted requests*, `https://<bucket>.obj.outplane.dev/…`), et les requêtes *path-style* échouent. Cette ligne est obligatoire.
- **`S3_REGION=auto`.** Les buckets Out Plane sont globaux, et les clients signent avec `auto`.

L'adresse `outplane.app` de l'application apparaît dès que l'application est créée. Si elle diffère de ce que vous aviez prévu, corrigez `CORS_ORIGINS` et `FRONTEND_URL`, puis cliquez à nouveau sur **Save & deploy**.

## 6. Ouvrir l'application

Ouvrez l'URL de l'application. Un unique conteneur dessert le panneau d'administration sur `/` et l'API sur `/api`. Connectez-vous avec `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, puis modifiez le mot de passe.

Le premier démarrage crée toutes les tables nécessaires, y compris les vôtres, ainsi que leurs stratégies de sécurité au niveau des lignes (*row-level security*). Il n'y a aucune migration à exécuter au préalable. Téléversez un fichier depuis le panneau d'administration pour confirmer les paramètres du bucket : une erreur à cette étape signifie presque toujours qu'il manque le suffixe au nom du bucket ou que `S3_FORCE_PATH_STYLE=false` est absent.

Chaque push sur la branche déclenche un redéploiement. Pour utiliser votre propre domaine, ajoutez-le sous **Domains**, associez-le au port 8080 de l'application, et créez l'enregistrement CNAME (ou l'enregistrement A pour un domaine racine) indiqué dans la console. Le certificat HTTPS est délivré dès que l'enregistrement se résout. Ajoutez ensuite la nouvelle origine à `CORS_ORIGINS` et `FRONTEND_URL`.

## Une seule instance

Cette page décrit un fonctionnement sur **une seule instance**, ce qui est le choix par défaut d'Out Plane et la limite du forfait Starter. Un seul conteneur prend en charge l'API, le panneau d'administration, le temps réel (*realtime*), le cron et la file d'attente de tâches (*job queue*).

Les tâches planifiées resteraient cohérentes avec plusieurs instances : chaque exécution de cron est réservée dans Postgres avant de démarrer, de sorte qu'un créneau ne s'exécute qu'une seule fois, quel que soit le nombre d'instances qui le déclenchent. D'autres éléments fonctionnent par instance — limiteurs de débit (*rate limiters*), caches de transformation d'images, téléversements avec reprise en cours — veuillez donc consulter [Plusieurs instances](/docs/deployment/multiple-instances/) avant d'augmenter le nombre d'instances sous **Settings → Scale**.

## Stockage de fichiers

Les fichiers téléversés résident dans le bucket Out Plane créé à l'étape 3, ils survivent donc aux redéploiements, et le propre disque de l'application ne conserve rien d'important.

Pour renouveler la clé : créez-en une nouvelle dans l'onglet **Access** du bucket, configurez-la dans `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY`, cliquez sur **Save & deploy**, puis supprimez l'ancienne clé. Out Plane précise qu'une clé supprimée peut continuer à fonctionner pendant 15 minutes au maximum.

L'autorisation de lire, écrire et lister les fichiers est déterminée par `storageAuthorize` dans `backend/storage.ts`, quel que soit le bucket qui les héberge. Voir [Stockage](/docs/backend/storage).

## Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui effectue des ajouts cumulatifs sur l'ensemble du schéma. Il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes, de sorte qu'une nouvelle table est disponible dès le déploiement suivant.

`ensure` ne modifie jamais ce qui existe déjà. Il ne change pas le type d'une colonne, ne supprime rien et n'édite pas les valeurs d'un enum existant, car un déploiement ne doit pas restructurer un schéma par effet secondaire.

Toute modification qui n'est pas purement additive — une colonne renommée, un type restreint, un champ supprimé — nécessite `rebase db push`, exécuté depuis une copie de travail locale :

```bash
pnpm exec rebase db push --dry-run --database-url '<your DATABASE_URL>'
```

Examinez le SQL affiché lors de l'exécution à blanc (*dry run*), puis exécutez la commande à nouveau sans `--dry-run`. Une modification qui supprime des données nécessite également `--allow-destructive`.

`db push` prépare chaque modification dans une copie temporaire du schéma, au sein d'une base de données nommée d'après la vôtre avec le suffixe `_dev_diff`. Créez-la une fois dans l'onglet **Access** de la base de données, avec le même rôle propriétaire que votre base de données.

Pour les migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez `pnpm exec rebase db migrate --database-url '<your DATABASE_URL>'` depuis une copie locale avant de pousser. Out Plane ne propose pas d'étape de *release* s'exécutant avant un déploiement.

## Étapes suivantes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
- [Stockage](/docs/backend/storage) — buckets, règles d'accès et utilisation simultanée de plusieurs sources de stockage.
