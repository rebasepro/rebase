---
sourceHash: a427caf371209bb1
title: Déployer Rebase sur Railway
description: Déployez Rebase sur Railway à partir de l'image de runtime publiée et du bundle de votre projet. Maintenez une conformité UE.
sidebar_label: Railway
---

Railway est un PaaS moderne qui simplifie le DevOps, et il prend en charge des régions de déploiement européennes (Amsterdam), vous permettant ainsi de maintenir la conformité de votre hébergement régional.

Rien sur cette page n'est spécifique à Railway concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image de runtime publiée et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, via le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Créer un projet et une région UE

1. Connectez-vous à votre [compte Railway](https://railway.app/).
2. Cliquez sur **New Project**.
3. Allez dans **Settings → Default Region** et définissez-la sur **Europe (Amsterdam)**. Le faire *après* avoir créé des services implique de devoir les migrer manuellement.

## 2. Provisionner PostgreSQL

1. Dans votre projet, cliquez sur **New → Database → Add PostgreSQL**.
2. Attendez la fin du provisionnement.
3. Railway expose une variable interne `DATABASE_URL` dans l'onglet **Variables** du widget Postgres.

Si vos collections déclarent une propriété `vector`, activez l'extension une fois sur cette base de données : `CREATE EXTENSION vector;`.

## 3. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image d'application à construire à partir de votre code source**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections, fonctions, tâches cron compilées et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Commitez un `Dockerfile` de trois lignes à la racine du dépôt, afin que l'étape de build de Railway soit une simple copie plutôt qu'une compilation :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

Générez le bundle dans votre CI et commitez-le ou téléversez-le lors de votre release, ou exécutez `rebase build` avant de pousser. Dans les deux cas, l'image construite par Railway ne contient ni chaîne d'outils (toolchain) ni code source — mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`, en laissant votre bundle intact.

Ensuite : **New → GitHub Repo**, sélectionnez votre dépôt et laissez Railway détecter le Dockerfile à la racine.

## 4. Définir les variables d'environnement

1. Cliquez sur la carte du service.
2. Rendez-vous dans l'onglet **Variables**.
3. Ajoutez :
   - `JWT_SECRET`: une chaîne aléatoire sécurisée de plus de 32 caractères.
   - `REBASE_SERVICE_KEY`: une autre chaîne aléatoire sécurisée de plus de 32 caractères.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: votre domaine frontend (par exemple `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: identique à `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: l'adresse du premier administrateur
   - `REBASE_ADMIN_PASSWORD`: au moins 12 caractères

   Ces trois dernières variables permettent à ce service d'obtenir un administrateur : en production, le premier compte inscrit n'est pas promu, donc rien d'autre ne génère le premier utilisateur connecté avec des droits d'accès. Définissez-les avant que le service ne commence à traiter du trafic — voir [Votre premier admin](/docs/getting-started/deployment/#your-first-admin).

4. Cliquez sur **Reference Variable** et sélectionnez `DATABASE_URL` depuis le service PostgreSQL. Railway injectera l'URL Postgres interne au moment de l'exécution.

Railway définit `PORT` et le runtime s'y lie, il n'y a donc aucun port à configurer. Pointez le health check vers `/livez` plutôt que `/health` : le second effectue un aller-retour avec la base de données, une sonde de liveness dessus risquerait donc de redémarrer un conteneur sain lors d'une brève interruption de la base de données.

## 5. Exposer le domaine

1. Dans la carte du service, allez dans **Settings → Networking**.
2. Sous **Public Networking**, cliquez sur **Generate Domain** pour obtenir une URL `.up.railway.app`, ou associez un domaine personnalisé.

## 6. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (row-level security) — ainsi, le premier démarrage sur une base de données vide est directement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les labels d'un enum existant, car le redémarrage d'un conteneur ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Deux cas nécessitent donc toujours la CLI, exécutée depuis un clone local ou un job CI :

```bash
rebase db push
```

- **Le RLS des tables de jonction** pour les relations many-to-many.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Faites pointer `DATABASE_URL` vers la chaîne de connexion **publique** de votre service Postgres (widget Postgres → **Connect**) ; l'URL interne référencée n'est accessible que depuis l'intérieur de Railway. L'image de runtime est fournie sans la CLI, cette commande ne s'exécute donc jamais à l'intérieur du conteneur. Pour les migrations versionnées, commitez plutôt les fichiers de migration avec `rebase db generate` et exécutez `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les conteneurs Railway sont remplacés à chaque déploiement, le stockage de fichiers en local entraîne donc une perte silencieuse de données et le runtime le refuse en production. Associez un bucket compatible S3 avec `STORAGE_TYPE=s3` — voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — l'ensemble des variables d'environnement lues par le runtime.
