---
sourceHash: 9674258588f75748
title: Déployer Rebase sur Scaleway
description: Découvrez comment déployer Rebase sur Scaleway pour une infrastructure cloud sécurisée et basée en France avec Serverless Containers.
sidebar_label: Scaleway
---

Scaleway est un fournisseur de cloud européen basé en France, disposant de centres de données à Paris, Amsterdam et Varsovie — un excellent choix pour les organisations qui privilégient la souveraineté des données au sein de l'UE.

Utilisez la **Managed Database** de Scaleway pour Postgres et **Serverless Containers** pour l'environnement d'exécution (runtime).

Rien sur cette page concernant votre projet n'est spécifique à Scaleway. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur une machine locale, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Créer une base de données Postgres managée

1. Dans la console Scaleway, accédez à **PostgreSQL**.
2. Cliquez sur **Create a Database Instance**.
3. Choisissez une région (par ex. Paris — `PAR1`).
4. Sélectionnez un type de nœud (**Play2-Pico** ou **Pro2-XXS** conviennent parfaitement).
5. Définissez un nom de base de données (`rebase_db`) et un mot de passe utilisateur robuste.
6. Une fois le déploiement terminé, notez la **chaîne de connexion** (URI) depuis le tableau de bord :
   `postgres://user:password@ip:port/rebase_db`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois avec : `CREATE EXTENSION vector;` sur la base de données.

## 2. Compiler le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. La commande `rebase build` génère un répertoire `dist-bundle` contenant vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image runtime publiée l'exécute :

```bash
rebase build
```

Serverless Containers télécharge les images depuis un registre, vous devez donc intégrer le bundle dans une image dérivée. Trois lignes suffisent pour figer précisément ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Accédez à **Container Registry** dans la console Scaleway et créez un namespace (par ex. `rebase-apps`).
2. Connectez-vous au registre depuis votre terminal en suivant les instructions fournies.
3. Construisez et poussez l'image depuis la racine du projet :

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Mettre à niveau Rebase ultérieurement se résume à modifier cette ligne `FROM`. Votre bundle reste intact.

## 3. Déployer le Serverless Container

1. Accédez à **Serverless Containers**.
2. Cliquez sur **Create a Container**.
3. Sélectionnez l'image que vous venez de pousser.
4. Définissez le port sur **8080** — le port sur lequel l'image runtime écoute par défaut, sauf si `PORT` est configuré différemment.
5. Sous Variables d'environnement (Environment Variables), ajoutez :

| Clé | Valeur |
|-----|-------|
| `DATABASE_URL` | L'URI obtenue à l'étape Managed Postgres |
| `JWT_SECRET` | Une chaîne aléatoire sécurisée de 32+ caractères pour signer les jetons d'authentification |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire sécurisée de 32+ caractères |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mails et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, configurée **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Ces trois dernières variables sont indispensables pour attribuer un administrateur à ce déploiement : en production, le premier compte inscrit n'est pas promu automatiquement, et aucun autre mécanisme ne crée le premier utilisateur authentifié. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Configurez ces secrets en tant que variables d'environnement secrètes plutôt qu'en clair.

6. Pointez le health check vers `/livez`. N'utilisez pas `/health` : ce dernier effectue un aller-retour avec la base de données, et une sonde de liveness sur ce endpoint risquerait de redémarrer un conteneur sain lors d'une brève saute de connexion à la base.
7. Cliquez sur **Deploy Container**.

Scaleway provisionne le conteneur et vous attribue un point de terminaison public (par ex. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Pour une conformité stricte des données, assurez-vous que les informations de votre organisation Scaleway correspondent bien à votre entité juridique européenne.*

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** La variable `REBASE_MIGRATE_ON_BOOT` est définie par défaut sur `ensure`, un mode purement additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — afin que le premier démarrage sur une base de données vide soit immédiatement prêt à servir vos collections.

Le mode `ensure` ne modifie jamais ce qui existe déjà : il ne change pas le type d'une colonne, ne supprime rien et ne modifie pas les valeurs d'un enum existant, car un redémarrage de conteneur ne doit pas altérer un schéma comme effet de bord d'un déploiement.

Deux opérations nécessitent donc toujours l'utilisation de la CLI, exécutée depuis un clone local ou un job CI avec `DATABASE_URL` pointant vers votre base de données managée :

```bash
rebase db push
```

- **La RLS des tables de jonction** pour les relations many-to-many.
- **Toute modification qui n'est pas strictement additive** — une colonne renommée, un type restreint, un champ supprimé.

L'image runtime étant fournie sans la CLI, ces actions ne s'exécutent jamais dans le conteneur. Pour des migrations versionnées, committez les fichiers de migration à l'aide de `rebase db generate` et exécutez `rebase db migrate` lors d'une étape de publication (release step).

## Stockage de fichiers

Les Serverless Containers n'ont pas de disque persistant ; utiliser un stockage de fichiers local entraînerait donc une perte de données silencieuse, ce que le runtime refuse en production. Scaleway Object Storage est compatible S3 et situé dans les mêmes centres de données :

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consultez [Stockage](/docs/backend/storage) pour obtenir tous les détails.

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles du premier administrateur communes à chaque plateforme.
- [Configuration](/docs/getting-started/configuration) — l'ensemble des variables d'environnement prises en compte par le runtime.
