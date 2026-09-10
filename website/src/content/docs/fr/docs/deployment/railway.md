---
sourceHash: 10ade706e21556d1
title: Déployer Rebase sur Railway
description: Déployez Rebase sur Railway à partir de l'image de runtime publiée et du bundle de votre projet. Maintenez la conformité UE.
sidebar_label: Railway
---

Railway est un PaaS moderne qui simplifie le DevOps, et il prend en charge les régions de déploiement européennes (Amsterdam), vous permettant ainsi de respecter la conformité d'hébergement régional.

Rien sur cette page n'est spécifique à Railway concernant votre projet. Un déploiement Rebase est composé de deux parties distinctes — l'image de runtime publiée et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec la [charte Helm](/docs/deployment/kubernetes) ou ici.

## 1. Créer un projet et une région UE

1. Connectez-vous à votre [compte Railway](https://railway.app/).
2. Cliquez sur **New Project**.
3. Allez dans **Settings → Default Region** et définissez-la sur **Europe (Amsterdam)**. Faire cela *après* avoir créé des services implique de devoir les migrer manuellement.

## 2. Provisionner PostgreSQL

1. Dans votre projet, cliquez sur **New → Database → Add PostgreSQL**.
2. Attendez la fin du provisionnement.
3. Railway expose une variable `DATABASE_URL` interne dans l'onglet **Variables** du widget Postgres.

Si vos collections déclarent une propriété `vector`, activez l'extension une fois sur cette base de données : `CREATE EXTENSION vector;`.

## 3. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de votre code source**. `rebase build` génère un répertoire `dist-bundle` contenant vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Commitez un `Dockerfile` de trois lignes à la racine du dépôt, afin que l'étape de build de Railway soit une simple copie plutôt qu'une compilation :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Construisez le bundle dans votre CI et commitez-le ou téléversez-le dans le cadre de votre release, ou exécutez `rebase build` avant de pousser vos modifications. Dans les deux cas, l'image construite par Railway ne contient aucune chaîne d'outils ni aucun code source — mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`, en laissant votre bundle intact.

Ensuite : **New → GitHub Repo**, sélectionnez votre dépôt et laissez Railway détecter le Dockerfile à la racine.

## 4. Définir les variables d'environnement

1. Cliquez sur la carte du service.
2. Rendez-vous sur l'onglet **Variables**.
3. Ajoutez :
   - `JWT_SECRET` : une chaîne aléatoire sécurisée d'au moins 32 caractères.
   - `REBASE_SERVICE_KEY` : une autre chaîne aléatoire sécurisée d'au moins 32 caractères.
   - `NODE_ENV` : `production`
   - `CORS_ORIGINS` : le domaine de votre frontend (ex. `https://your-app.up.railway.app`)
   - `FRONTEND_URL` : identique à `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION` : `true`
   - `REBASE_ADMIN_EMAIL` : l'adresse e-mail du premier administrateur
   - `REBASE_ADMIN_PASSWORD` : au moins 12 caractères

   Ces trois dernières variables sont la seule manière pour ce service d'obtenir un administrateur : en production, le premier compte enregistré n'est pas promu, donc rien d'autre ne génère le premier utilisateur connecté avec des droits d'administration. Définissez-les avant que le service ne commence à traiter du trafic — voir [Votre premier admin](/docs/getting-started/deployment/#your-first-admin).

4. Cliquez sur **Reference Variable** et sélectionnez `DATABASE_URL` depuis le service PostgreSQL. Railway injectera l'URL Postgres interne lors de l'exécution.

Railway définit `PORT` et le runtime s'y lie automatiquement, il n'y a donc aucun port à configurer. Pointez le health check vers `/livez` plutôt que `/health` : le second effectue un aller-retour avec la base de données, ainsi une sonde de liveness (disponibilité) branchée dessus redémarrerait un conteneur sain lors d'un bref ralentissement de la base de données.

## 5. Exposer le domaine

1. Dans la carte du service, allez dans **Settings → Networking**.
2. Sous **Public Networking**, cliquez sur **Generate Domain** pour obtenir une URL en `.up.railway.app`, ou associez un domaine personnalisé.

## 6. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est purement additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une base de données vide est immédiatement opérationnel pour servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car le redémarrage d'un conteneur ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Deux opérations nécessitent donc toujours l'utilisation de la CLI, exécutée depuis un clone local ou un job de CI :

```bash
rebase db push
```

- **La RLS des tables de jonction** pour les relations many-to-many.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Pointez `DATABASE_URL` vers la chaîne de connexion **publique** de votre service Postgres (widget Postgres → **Connect**) ; l'URL interne référencée n'est accessible que depuis l'intérieur de Railway. L'image de runtime étant fournie sans la CLI, cette commande ne s'exécute jamais à l'intérieur du conteneur. Pour les migrations versionnées, commitez les fichiers de migration générés avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les conteneurs Railway sont remplacés à chaque déploiement ; utiliser un stockage de fichiers local entraîne donc une perte silencieuse de données, et le runtime le refuse en production. Associez un bucket compatible S3 avec `STORAGE_TYPE=s3` — voir [Stockage](/docs/backend/storage).

## Étapes suivantes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles concernant le premier administrateur partagées par toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
