---
sourceHash: ac69f91f756be451
title: Déployer Rebase sur Google Cloud Platform
description: Déployez votre instance Rebase en toute sécurité sur GCP en utilisant Cloud SQL et Cloud Run, en vous concentrant sur les régions de centres de données de l'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre une expérience de développement incroyablement fluide pour les applications conteneurisées. Pour une configuration de production robuste, nous tirons parti de **Cloud SQL** pour la base de données et de **Cloud Run** pour l'épine dorsale des conteneurs sans serveur.

Pour maintenir une stricte conformité aux données européennes, assurez-vous d'opérer entièrement au sein d'une région de l'UE, telle que **europe-west3 (Francfort)**, **europe-west9 (Paris)** ou **europe-west1 (Belgique)**.

## 1. Provisionner Cloud SQL (PostgreSQL)

1. Accédez à la console **Cloud SQL** dans votre région de l'UE préférée.
2. Cliquez sur **Créer une instance** et sélectionnez **PostgreSQL**.
3. Définissez votre ID d'instance et générez un mot de passe intégré sécurisé pour l'utilisateur `postgres`.
4. Développez les **Options de configuration** pour allouer le type de machine correct (une machine standard à 2 vCPU est un excellent début).
5. Assurez-vous que la base de données est configurée pour des réseaux IP privés ou des réseaux IP publics autorisés, en fonction de votre configuration VCP avec Cloud Run.
6. Assemblez votre URI de connexion :
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

## 2. Compiler et déployer sur Cloud Run

Cloud Run met à l'échelle le backend Node.js de Rebase automatiquement jusqu'à zéro (si désiré) et gère le TLS nativement. Vous pouvez compiler et déployer l'application en une seule commande CLI depuis votre espace de travail local en utilisant Google Cloud Build.

Assurez-vous d'avoir l'interface de ligne de commande `gcloud` installée et authentifiée :

Il n'y a **aucune image applicative à construire depuis vos sources**. `rebase build` produit un répertoire `dist-bundle` avec vos collections, fonctions et crons compilés — et, si votre projet déclare une app statique, votre frontend construit. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Cloud Run tire depuis un registre : intégrez donc le bundle dans une image dérivée. Trois lignes, et cela fige exactement ce qui tourne :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Mettre Rebase à niveau plus tard revient à changer cette ligne `FROM`. Votre bundle reste intact.

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Authenticate Docker to the registry (one-time)
gcloud auth configure-docker gcr.io

docker build -t gcr.io/YOUR_PROJECT_ID/rebase-backend .
docker push gcr.io/YOUR_PROJECT_ID/rebase-backend

# Deploy the newly built image to Cloud Run
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT_ID/rebase-backend \
  --region europe-west3 \
  --port 3001 \
  --set-env-vars DATABASE_URL="postgresql://...",JWT_SECRET="YOUR_SECURE_RANDOM_STRING",NODE_ENV="production" \
  --allow-unauthenticated
```

## 3. Gérer le stockage de fichiers
Étant donné que les instances Cloud Run sont strictement sans état et éphémères, vous ne pouvez pas utiliser le stockage sur disque local pour les téléchargements de fichiers Rebase.

1. Accédez à **Google Cloud Storage** et créez un nouveau bucket privé dans la région de l'UE choisie.
2. Suivez la [Documentation de stockage de Rebase](/docs/backend/storage) pour configurer Rebase afin d'utiliser l'API compatible S3 fournie par Google Cloud Storage au lieu du système de fichiers local.

Votre instance Rebase est maintenant entièrement sans serveur et hautement évolutive nativement au sein de l'UE !

## Créer le schéma de base de données

Le service est en cours d'exécution, mais Rebase ne crée automatiquement que les tables d'**authentification** au démarrage — les tables de vos propres collections ne sont **pas** créées automatiquement. Exécutez cette commande une fois sur la base de données de production, sinon chaque collection renverra une erreur « missing table » :

```bash
pnpm run db:push
```

Exécutez-la depuis un checkout de votre projet (ou depuis votre job CI) avec `DATABASE_URL` pointant vers votre instance Cloud SQL. Depuis votre machine, connectez-vous via le [proxy d'authentification Cloud SQL](https://cloud.google.com/sql/docs/postgres/sql-proxy) et faites pointer `DATABASE_URL` vers `localhost`. L'image déployée n'inclut pas la CLI, cette commande ne s'exécute donc pas à l'intérieur du conteneur Cloud Run. Pour des migrations versionnées, validez les fichiers de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` à la place.

---
