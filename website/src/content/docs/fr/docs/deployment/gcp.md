---
sourceHash: 8d400239df61cbd4
title: Déployer Rebase sur Google Cloud Platform
description: Déployez votre instance Rebase en toute sécurité sur GCP à l'aide de Cloud SQL et Cloud Run, en ciblant les régions de centres de données de l'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre une expérience de développement fluide pour les applications conteneurisées. Pour une configuration de production robuste, utilisez **Cloud SQL** pour la base de données et **Cloud Run** pour le runtime.

Pour respecter une stricte conformité des données européennes, opérez entièrement au sein d'une région de l'UE telle que **europe-west3 (Francfort)**, **europe-west9 (Paris)** ou **europe-west1 (Belgique)**.

Rien sur cette page n'est spécifique à GCP concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image de runtime publiée et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [chart Helm](/docs/deployment/kubernetes) et ici.

## 1. Provisionner Cloud SQL (PostgreSQL)

1. Rendez-vous dans la console **Cloud SQL** au sein de la région UE de votre choix.
2. Cliquez sur **Créer une instance** et sélectionnez **PostgreSQL**.
3. Définissez votre identifiant d'instance et générez un mot de passe sécurisé pour l'utilisateur `postgres`.
4. Développez **Options de configuration** pour choisir un type de machine (deux vCPU constituent un bon point de départ).
5. Configurez une IP privée ou un réseau public autorisé, selon la manière dont Cloud Run s'y connectera.
6. Assemblez votre URI de connexion :
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si vos tables déclarent une colonne `col.vector()`, activez l'extension une seule fois sur la base de données avec : `CREATE EXTENSION vector;`.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image d'application à compiler depuis votre code source**. La commande `rebase build` génère un répertoire `dist-bundle` contenant vos tables compilées, vos fonctions, vos tâches cron et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Cloud Run récupère les images depuis un registre, vous devez donc intégrer le bundle dans une image dérivée. Trois lignes suffisent, et cela fige exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Create an Artifact Registry repository (one-time)
gcloud artifacts repositories create rebase --repository-format=docker --location=europe-west3

# Authenticate Docker to Artifact Registry (one-time)
gcloud auth configure-docker europe-west3-docker.pkg.dev

# Build from the project root and push
docker build -t europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest .
docker push europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest
```

Mettre à niveau Rebase ultérieurement revient simplement à modifier cette ligne `FROM`. Votre bundle reste intact.

## 3. Déployer sur Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injecte la variable `PORT` et le runtime s'y lie, il n'y a donc aucun port à configurer. Pointez la sonde de démarrage (startup probe) vers `/livez` plutôt que `/health` : cette dernière effectue un aller-retour avec la base de données, donc une sonde de liveness associée redémarrerait une révision par ailleurs saine lors d'un bref dysfonctionnement de la base.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` permettent d'obtenir un administrateur pour ce service : en production, le premier compte enregistré n'est pas promu, donc aucun autre moyen ne permet d'obtenir le premier appelant authentifié. Définissez-les avant que la première révision ne traite du trafic — voir [Votre premier admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` remplace **l'intégralité** du bloc de variables d'environnement à chaque déploiement ; ainsi, un déploiement ultérieur qui omet une variable la supprimera silencieusement. Conservez la liste complète dans votre script de déploiement.

Pour joindre une instance Cloud SQL privée, il faut ajouter `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` ainsi qu'une `DATABASE_URL` utilisant des sockets Unix ; une instance publique dotée d'un réseau autorisé ne nécessite ni l'un ni l'autre.

## 4. Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, qui a un comportement purement additif sur l'ensemble du schéma — il crée les tables, les colonnes et les types enum manquants et applique leur sécurité au niveau des lignes (RLS) — de sorte que le premier démarrage sur une instance vide est immédiatement prêt à servir vos tables.

Ce que `ensure` ne fait jamais, c'est modifier un élément existant : il ne change pas le type d'une colonne, ne supprime rien et n'édite pas les valeurs d'un enum existant, car le démarrage d'une révision ne doit pas remodeler le schéma comme effet secondaire d'un déploiement.

Une opération nécessite donc toujours la CLI, exécutée depuis votre code source local ou un job CI :

```bash
rebase db push
```

Toute modification qui n'est pas purement additive — une colonne renommée, un type restreint, un champ supprimé.

Depuis votre machine, connectez-vous via le [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) et pointez `DATABASE_URL` vers `localhost`. L'image du runtime étant fournie sans la CLI, cette commande ne s'exécute jamais au sein du conteneur Cloud Run. Pour des migrations versionnées, validez vos fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` comme étape de release.

## Stockage de fichiers

Les instances Cloud Run sont sans état (stateless) et éphémères ; le stockage de fichiers en local entraîne donc une perte silencieuse de données, ce que le runtime refuse en production.

1. Créez un bucket Google Cloud Storage privé dans la région UE de votre choix.
2. Créez une clé HMAC pour un compte de service ayant accès au bucket (**Cloud Storage → Paramètres → Interopérabilité**), et accédez au bucket via son endpoint compatible S3 : `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, et la clé en tant que `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — voir [Stockage](/docs/backend/storage). `STORAGE_TYPE=gcs` charge `@google-cloud/storage`, qui n'est pas inclus dans l'image de runtime, et une copie présente dans votre bundle ne figurera pas sur son chemin de résolution.

:::caution
Cloud Run réduit ses instances à zéro (scale to zero). Si votre projet utilise des abonnements en temps réel (subscriptions), définissez `--min-instances 1` — les connexions WebSocket sont interrompues lorsqu'une instance est arrêtée lors d'un scale down.
:::

## Étapes suivantes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
