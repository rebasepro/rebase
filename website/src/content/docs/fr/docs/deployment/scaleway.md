---
sourceHash: 8065b392b2b6690b
title: Déployer Rebase sur Scaleway
description: Découvrez comment déployer Rebase sur Scaleway pour une infrastructure cloud sécurisée basée en France à l'aide de Serverless Containers.
sidebar_label: Scaleway
---

Scaleway est un fournisseur cloud européen basé en France, avec des datacenters à Paris, Amsterdam et Varsovie — un excellent choix pour les organisations privilégiant la souveraineté des données dans l'UE.

Utilisez les **Managed Database** de Scaleway pour Postgres et **Serverless Containers** pour le runtime.

Rien sur cette page n'est spécifique à Scaleway concernant votre projet. Un déploiement Rebase est composé de deux éléments distincts — l'image de runtime publiée, et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Créer une base de données Postgres managée

1. Dans la console Scaleway, accédez à **PostgreSQL**.
2. Cliquez sur **Create a Database Instance**.
3. Choisissez une région (par ex. Paris — `PAR1`).
4. Sélectionnez un type de nœud (**Play2-Pico** ou **Pro2-XXS** fonctionnent très bien).
5. Ajoutez un nom de base de données (`rebase_db`) et un mot de passe utilisateur robuste.
6. Une fois déployée, notez la chaîne de connexion (**Connection string** ou URI) depuis le tableau de bord :
   `postgres://user:password@ip:port/rebase_db`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois : `CREATE EXTENSION vector;` sur la base de données.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Serverless Containers télécharge depuis un registre (registry), intégrez donc le bundle dans une image dérivée. Trois lignes, et cela fige exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Rendez-vous dans **Container Registry** dans la console Scaleway et créez un namespace (par ex. `rebase-apps`).
2. Connectez-vous au registre depuis votre terminal en suivant les instructions affichées.
3. Construisez et poussez l'image, depuis la racine du projet :

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Mettre à jour Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Déployer le Serverless Container

1. Accédez à **Serverless Containers**.
2. Cliquez sur **Create a Container**.
3. Choisissez l'image que vous venez de pousser.
4. Définissez le port sur **8080** — le port sur lequel l'image de runtime écoute, sauf indication contraire de `PORT`.
5. Sous Environment Variables, ajoutez :

| Clé | Valeur |
|-----|--------|
| `DATABASE_URL` | L'URI obtenue à l'étape de la base Postgres managée |
| `JWT_SECRET` | Une chaîne aléatoire et sécurisée de plus de 32 caractères pour signer les jetons d'authentification |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire et sécurisée de plus de 32 caractères |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mail et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Les trois dernières permettent à ce déploiement d'obtenir un administrateur : en production, le premier compte enregistré n'est pas promu automatiquement, donc rien d'autre ne crée le premier utilisateur connecté. Voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Marquez les secrets comme des variables d'environnement secrètes plutôt que standard.

6. Pointez le health check vers `/livez`. Pas `/health` : celui-ci effectue un aller-retour vers la base de données, donc une sonde de vivacité (liveness probe) configurée dessus redémarrerait un conteneur sain lors d'une brève indisponibilité de la base de données.
7. Cliquez sur **Deploy Container**.

Scaleway provisionne le conteneur et vous fournit un endpoint public (par ex. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Pour une conformité stricte des données, vérifiez que les informations de votre organisation Scaleway reflètent bien votre entité juridique européenne.*

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une base de données vide est immédiatement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne change pas le type d'une colonne, ne supprime rien et ne modifie pas les valeurs d'un enum existant, car le redémarrage d'un conteneur ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Deux opérations nécessitent donc toujours la CLI, exécutée depuis votre copie locale ou un job CI avec `DATABASE_URL` pointant vers votre base de données managée :

```bash
rebase db push
```

- Le **RLS des tables de jonction** pour les relations plusieurs-à-plusieurs (many-to-many).
- **Tout changement qui n'est pas purement additif** — une colonne renommée, un type restreint, un champ supprimé.

L'image de runtime est fournie sans la CLI, cette commande ne s'exécute donc jamais à l'intérieur du conteneur. Pour les migrations versionnées, validez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les Serverless Containers ne disposent pas de disque persistant, donc le stockage de fichiers en local entraînerait une perte silencieuse de données et le runtime le refuse en production. Scaleway Object Storage est compatible S3 et réside dans les mêmes datacenters :

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consultez [Stockage](/docs/backend/storage) pour une vue d'ensemble complète.

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur partagées par toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
