---
sourceHash: 0632063aadcff623
title: Déployer Rebase sur Google Cloud Platform
description: Déployez votre instance Rebase en toute sécurité sur GCP à l'aide de Cloud SQL et Cloud Run, en ciblant les régions de centres de données de l'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre une expérience développeur fluide pour les applications conteneurisées. Pour une configuration de production robuste, utilisez **Cloud SQL** pour la base de données et **Cloud Run** pour le runtime.

Pour maintenir une stricte conformité des données européennes, opérez entièrement au sein d'une région de l'UE telle que **europe-west3 (Francfort)**, **europe-west9 (Paris)** ou **europe-west1 (Belgique)**.

Rien sur cette page n'est spécifique à GCP concernant votre projet. Un déploiement Rebase est constitué de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Provisionner Cloud SQL (PostgreSQL)

1. Accédez à la console **Cloud SQL** dans la région UE de votre choix.
2. Cliquez sur **Créer une instance** et sélectionnez **PostgreSQL**.
3. Définissez l'identifiant de votre instance (Instance ID) et générez un mot de passe sécurisé pour l'utilisateur `postgres`.
4. Développez les **Options de configuration** pour choisir un type de machine (deux vCPU est un bon point de départ).
5. Configurez une adresse IP privée ou un réseau public autorisé, selon la façon dont Cloud Run y accédera.
6. Assemblez votre URI de connexion :
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si vos tables déclarent une colonne `col.vector()`, activez l'extension une fois : `CREATE EXTENSION vector;` sur la base de données.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos tables, fonctions, crons compilés et — si votre projet déclare une application statique — votre frontend construit. L'image runtime publiée l'exécute :

```bash
rebase build
```

Cloud Run extrait depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent pour figer exactement ce qui s'exécute :

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

Mettre à niveau Rebase ultérieurement revient à modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Déployer sur Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injecte `PORT` et le runtime s'y lie, il n'y a donc aucun port à configurer. Pointez la sonde de démarrage (startup probe) vers `/livez` plutôt que `/health` : cette dernière effectue un aller-retour vers la base de données, ainsi une sonde de vivacité (liveness probe) configurée dessus redémarrerait une révision saine lors d'une brève interruption de la base de données.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` permettent au service d'obtenir son premier administrateur : en production, le premier compte enregistré n'est pas promu, donc aucun autre moyen ne crée le premier utilisateur authentifié. Définissez-les avant que la première révision ne traite du trafic — voir [Votre premier admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` remplace l'**ensemble** du bloc d'environnement à chaque déploiement ; par conséquent, un déploiement ultérieur omettant une variable la supprimera silencieusement. Conservez la liste complète dans votre script de déploiement.

Pour joindre une instance Cloud SQL privée, `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` et une `DATABASE_URL` de type socket sont nécessaires ; une instance publique dotée d'un réseau autorisé n'a besoin d'aucun des deux.

## 4. Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (row-level security) — ainsi le premier démarrage sur une instance vide est immédiatement opérationnel pour servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car le démarrage d'une révision ne doit pas remodeler un schéma comme effet secondaire d'un déploiement.

Une opération nécessite donc toujours le CLI, exécuté depuis un checkout local ou un job CI :

```bash
rebase db push
```

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé.

Depuis votre machine, connectez-vous via le [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) et faites pointer `DATABASE_URL` vers `localhost`. L'image runtime étant fournie sans le CLI, cela ne s'exécute jamais à l'intérieur du conteneur Cloud Run. Pour les migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` comme étape de release.

## Stockage de fichiers

Les instances Cloud Run sont sans état (stateless) et éphémères ; le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production.

1. Créez un bucket Google Cloud Storage privé dans la région UE de votre choix.
2. Créez une clé HMAC pour un compte de service capable d'utiliser le bucket (**Cloud Storage → Paramètres → Interopérabilité**), et accédez au bucket via son endpoint compatible S3 : `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, et la clé en tant que `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — voir [Stockage](/docs/backend/storage). `STORAGE_TYPE=gcs` charge `@google-cloud/storage`, qui n'est pas fourni avec l'image runtime, et une copie dans votre bundle ne se trouve pas sur son chemin de résolution.

:::caution
Cloud Run peut réduire ses instances à zéro (scale to zero). Si votre projet utilise des abonnements en temps réel (realtime subscriptions), définissez `--min-instances 1` — les connexions WebSocket sont interrompues lorsqu'une instance est arrêtée.
:::

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
