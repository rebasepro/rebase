---
sourceHash: e902dc7a4aad0fa2
title: Déployer Rebase sur Google Cloud Platform
description: Déployez votre instance Rebase en toute sécurité sur GCP à l'aide de Cloud SQL et Cloud Run, en ciblant les régions de centres de données de l'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre une expérience de développement fluide pour les applications conteneurisées. Pour une configuration de production robuste, utilisez **Cloud SQL** pour la base de données et **Cloud Run** pour le runtime.

Pour respecter la stricte conformité européenne en matière de données, opérez entièrement au sein d'une région de l'UE telle que **europe-west3 (Francfort)**, **europe-west9 (Paris)** ou **europe-west1 (Belgique)**.

Rien sur cette page n'est spécifique à GCP concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image de runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [Helm chart](/docs/deployment/kubernetes) et ici.

## 1. Provisionner Cloud SQL (PostgreSQL)

1. Accédez à la console **Cloud SQL** dans la région UE de votre choix.
2. Cliquez sur **Créer une instance** et sélectionnez **PostgreSQL**.
3. Définissez votre ID d'instance et générez un mot de passe sécurisé pour l'utilisateur `postgres`.
4. Développez les **Options de configuration** pour choisir un type de machine (deux vCPU est un bon point de départ).
5. Configurez une IP privée ou un réseau public autorisé, selon la manière dont Cloud Run y accédera.
6. Composez votre URI de connexion :
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois : `CREATE EXTENSION vector;` sur la base de données.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image d'application à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` avec vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Cloud Run télécharge les images depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent, et cela fige exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Cloud Run injecte `PORT` et le runtime s'y associe, il n'y a donc aucun port à configurer. Pointez la sonde de démarrage (startup probe) vers `/livez` plutôt que vers `/health` : cette dernière effectue un aller-retour vers la base de données, donc une sonde de liveness pointée dessus redémarrerait une révision saine lors d'une brève interruption de la base de données.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` permettent au service de disposer d'un administrateur : en production, le premier compte à s'inscrire n'est pas promu, donc rien d'autre ne génère le premier utilisateur authentifié. Définissez-les avant que la première révision ne commence à traiter du trafic — voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` remplace l'**intégralité** du bloc de variables d'environnement à chaque déploiement ; un déploiement ultérieur qui omet une variable la supprimera donc silencieusement. Conservez la liste complète dans votre script de déploiement.

L'accès à une instance privée Cloud SQL nécessite `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` et une `DATABASE_URL` de type socket ; une instance publique avec un réseau autorisé ne requiert ni l'un ni l'autre.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une instance vide est immédiatement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, c'est modifier quelque chose qui existe déjà : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car le démarrage d'une révision ne doit pas remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Deux éléments nécessitent donc toujours la CLI, exécutée depuis un clone local ou un job CI :

```bash
rebase db push
```

- **La sécurité RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Tout changement qui n'est pas purement additif** — une colonne renommée, un type restreint, un champ supprimé.

Depuis votre machine, connectez-vous via le [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) et faites pointer `DATABASE_URL` vers `localhost`. L'image de runtime est fournie sans la CLI, cette commande ne s'exécute donc jamais à l'intérieur du conteneur Cloud Run. Pour les migrations versionnées, validez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les instances Cloud Run sont sans état (stateless) et éphémères ; le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production.

1. Créez un bucket Google Cloud Storage privé dans la région UE de votre choix.
2. Définissez `STORAGE_TYPE=gcs` et son bucket — voir [Stockage](/docs/backend/storage). Sur Cloud Run, le compte de service ambiant fournit les identifiants, il n'y a donc rien d'autre à configurer.

:::caution
Cloud Run passe à l'échelle jusqu'à zéro instance (scale to zero). Si votre projet utilise des abonnements en temps réel, définissez `--min-instances 1` — les connexions WebSocket sont interrompues lorsqu'une instance est réduite.
:::

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la liste de contrôle pour la production, et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
