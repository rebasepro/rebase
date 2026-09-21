---
sourceHash: e646b24e7b09a75e
title: Déployer Rebase sur Google Cloud Platform
description: Déployez votre instance Rebase en toute sécurité sur GCP à l'aide de Cloud SQL et Cloud Run, en ciblant les régions de centres de données de l'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre une expérience de développement fluide pour les applications conteneurisées. Pour une configuration de production robuste, utilisez **Cloud SQL** pour la base de données et **Cloud Run** pour le runtime.

Pour maintenir une conformité stricte aux exigences européennes en matière de données, opérez entièrement au sein d'une région de l'UE telle que **europe-west3 (Francfort)**, **europe-west9 (Paris)** ou **europe-west1 (Belgique)**.

Rien sur cette page n'est spécifique à GCP concernant votre projet. Un déploiement Rebase est composé de deux éléments distincts — l'image de runtime publiée et le **bundle** généré par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Provisionner Cloud SQL (PostgreSQL)

1. Accédez à la console **Cloud SQL** dans la région UE de votre choix.
2. Cliquez sur **Créer une instance** et sélectionnez **PostgreSQL**.
3. Définissez votre identifiant d'instance et générez un mot de passe sécurisé pour l'utilisateur `postgres`.
4. Développez les **Options de configuration** pour choisir un type de machine (deux vCPU constituent un bon point de départ).
5. Configurez une adresse IP privée ou un réseau public autorisé, selon la manière dont Cloud Run y accédera.
6. Assemblez votre URI de connexion :
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois : `CREATE EXTENSION vector;` sur la base de données.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Cloud Run extrait les images depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent pour figer exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
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

Mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Déployer sur Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injecte `PORT` et le runtime s'y associe automatiquement, il n'y a donc aucun port à configurer. Orientez la sonde de démarrage (startup probe) vers `/livez` plutôt que `/health` : cette dernière effectue un aller-retour avec la base de données, donc une sonde de vivacité (liveness probe) pointant dessus redémarrerait une révision saine lors d'une brève indisponibilité de la base de données.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` permettent d'attribuer un administrateur à ce service : en production, le premier compte à s'inscrire n'est pas promu administrateur, donc rien d'autre ne crée le premier utilisateur authentifié. Définissez-les avant que la première révision ne traite du trafic — voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` remplace l'**ensemble** du bloc d'environnement à chaque déploiement ; un déploiement ultérieur omettant une variable la supprimera donc silencieusement. Conservez la liste complète dans votre script de déploiement.

Accéder à une instance Cloud SQL privée nécessite `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` et une `DATABASE_URL` au format socket ; une instance publique avec un réseau autorisé ne requiert aucun des deux.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une instance vide est immédiatement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car le démarrage d'une révision ne doit pas remodeler un schéma comme effet secondaire d'un déploiement.

Deux éléments nécessitent donc toujours l'utilisation de la CLI, exécutée depuis un clone local ou un job de CI :

```bash
rebase db push
```

- **Le RLS pour les tables de jointure** des relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Depuis votre machine, connectez-vous via le [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) et faites pointer `DATABASE_URL` vers `localhost`. L'image de runtime étant fournie sans la CLI, cette commande ne s'exécute jamais dans le conteneur Cloud Run. Pour les migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` comme étape de mise en production.

## Stockage de fichiers

Les instances Cloud Run sont sans état et éphémères ; un stockage de fichiers local entraînerait donc une perte silencieuse de données, et le runtime le refuse en production.

1. Créez un bucket Google Cloud Storage privé dans la région UE de votre choix.
2. Définissez `STORAGE_TYPE=gcs` ainsi que son bucket — voir [Stockage](/docs/backend/storage). Sur Cloud Run, le compte de service ambiant fournit les identifiants, il n'y a donc rien d'autre à configurer.

:::caution
Cloud Run peut réduire ses instances à zéro (scale to zero). Si votre projet utilise des abonnements en temps réel, définissez `--min-instances 1` — les connexions WebSocket sont interrompues lorsqu'une instance est mise à l'échelle vers le bas.
:::

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à chaque plateforme.
- [Configuration](/docs/getting-started/configuration) — l'ensemble des variables d'environnement lues par le runtime.
