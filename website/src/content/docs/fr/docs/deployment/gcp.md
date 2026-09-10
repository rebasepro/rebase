---
sourceHash: 0633ef5ec34074cf
title: Déployer Rebase sur Google Cloud Platform
description: Déployez votre instance Rebase en toute sécurité sur GCP à l'aide de Cloud SQL et Cloud Run, en ciblant les régions de centres de données de l'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre une expérience développeur fluide pour les applications conteneurisées. Pour une configuration de production robuste, utilisez **Cloud SQL** pour la base de données et **Cloud Run** pour le runtime.

Pour respecter la stricte conformité européenne sur les données, opérez entièrement au sein d'une région de l'UE telle que **europe-west3 (Francfort)**, **europe-west9 (Paris)** ou **europe-west1 (Belgique)**.

Rien sur cette page n'est spécifique à GCP concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [chart Helm](/docs/deployment/kubernetes) et ici.

## 1. Provisionner Cloud SQL (PostgreSQL)

1. Accédez à la console **Cloud SQL** dans la région UE de votre choix.
2. Cliquez sur **Créer une instance** et sélectionnez **PostgreSQL**.
3. Définissez votre ID d'instance et générez un mot de passe sécurisé pour l'utilisateur `postgres`.
4. Développez **Options de configuration** pour choisir un type de machine (deux vCPU constituent un bon début).
5. Configurez une adresse IP privée ou un réseau public autorisé, selon la façon dont Cloud Run y accédera.
6. Composez votre URI de connexion :
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois : `CREATE EXTENSION vector;` sur la base de données.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image d'application à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image runtime publiée l'exécute :

```bash
rebase build
```

Cloud Run télécharge les images depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent pour figer exactement ce qui s'exécute :

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

Mettre à niveau Rebase ultérieurement revient simplement à modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Déployer sur Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injecte `PORT` et le runtime s'y associe, il n'y a donc aucun port à configurer. Pointez la sonde de démarrage (startup probe) vers `/livez` plutôt que `/health` : cette dernière effectue un aller-retour avec la base de données, donc une sonde de vivacité (liveness probe) configurée dessus redémarrerait une révision saine lors d'un bref incident de base de données.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` permettent d'attribuer un administrateur à ce service : en production, le premier compte à s'inscrire n'est pas promu, donc aucun autre moyen ne permet d'obtenir le premier appelant authentifié. Définissez-les avant que la première révision ne traite du trafic — voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` remplace l'**ensemble** du bloc de variables d'environnement à chaque déploiement ; par conséquent, un déploiement ultérieur qui omettrait une variable la supprimerait silencieusement. Conservez la liste complète dans votre script de déploiement.

L'accès à une instance privée Cloud SQL nécessite `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` et une `DATABASE_URL` de type socket ; une instance publique avec un réseau autorisé ne nécessite ni l'un ni l'autre.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une instance vide est prêt à servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les libellés d'un enum existant, car le démarrage d'une révision ne doit pas remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Deux opérations nécessitent donc toujours l'utilisation de la CLI, exécutée depuis un clone local ou un job CI :

```bash
rebase db push
```

- **RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Depuis votre machine, connectez-vous via le [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) et faites pointer `DATABASE_URL` vers `localhost`. L'image runtime étant fournie sans la CLI, cette commande ne s'exécute jamais dans le conteneur Cloud Run. Pour les migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les instances Cloud Run sont sans état (stateless) et éphémères ; le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production.

1. Créez un bucket Google Cloud Storage privé dans la région UE de votre choix.
2. Définissez `STORAGE_TYPE=gcs` ainsi que son bucket — voir [Stockage](/docs/backend/storage). Sur Cloud Run, le compte de service ambiant fournit les identifiants, il n'y a donc rien d'autre à configurer.

:::caution
Cloud Run réduit automatiquement les instances à zéro (scale to zero). Si votre projet utilise des abonnements en temps réel, définissez `--min-instances 1` — les connexions WebSocket sont interrompues lorsqu'une instance est arrêtée.
:::

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — l'ensemble des variables d'environnement lues par le runtime.

---
