---
title: Déployer Rebase sur Scaleway
description: Apprenez à déployer Rebase sur Scaleway pour une infrastructure cloud sécurisée et basée en France à l'aide de conteneurs serverless.
sidebar_label: Scaleway
---

Scaleway est un fournisseur de services cloud européen de premier plan, basé en France, avec des centres de données à Paris, Amsterdam et Varsovie. C'est un excellent choix pour les organisations qui privilégient la souveraineté des données de l'UE.

Nous recommandons d'utiliser la **Base de Données Managée** de Scaleway pour un support Postgres fiable et les **Conteneurs Serverless** pour faire évoluer dynamiquement l'application Rebase Node.js.

## 1. Créer une Base de Données Postgres Managée

Les Bases de Données Managées de Scaleway offrent des sauvegardes automatiques et une haute disponibilité.

1. Dans la Console Scaleway, allez dans **PostgreSQL**.
2. Cliquez sur **Créer une instance de base de données**.
3. Choisissez une Région (par exemple, Paris - `PAR1`).
4. Sélectionnez un Type de Nœud (un **Play2-Pico** ou **Pro2-XXS** standard fonctionne bien).
5. Ajoutez un nom de base de données (`rebase_db`) et définissez un mot de passe utilisateur incroyablement sécurisé.
6. Une fois déployé, notez la **chaîne de connexion** (URI) depuis le tableau de bord. Elle ressemblera à ceci :
   `postgres://user:password@ip:port/rebase_db`

## 2. Construire et Pousser le Conteneur

Les Conteneurs Serverless de Scaleway exécutent des images Docker standard. Commencez par construire le backend Rebase localement et poussez-le vers le Registre de Conteneurs Scaleway.

1. Allez dans **Container Registry** dans la Console Scaleway et créez un Namespace (par exemple, `rebase-apps`).
2. Connectez-vous au registre depuis votre terminal local en utilisant les instructions fournies.
3. Construisez votre application Rebase en utilisant le `Dockerfile` généré :

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest ./backend
```

4. Poussez l'image :

```bash
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

## 3. Déployer un Conteneur Serverless

Déployez maintenant l'image de manière entièrement serverless sans gérer l'infrastructure.

1. Naviguez vers **Serverless Containers**.
2. Cliquez sur **Créer un conteneur**.
3. Choisissez l'image que vous venez de pousser depuis le Registre de Conteneurs.
4. Définissez le Port à **3001**.
5. Sous Variables d'environnement, ajoutez les éléments suivants de manière sécurisée :

| Clé | Valeur |
|-----|-------|
| `DATABASE_URL` | L'URI de votre étape Postgres Managée |
| `JWT_SECRET` | Une chaîne aléatoire sécurisée de 32+ caractères pour signer les jetons d'authentification |
| `NODE_ENV` | `production` |

6. Cliquez sur **Déployer le conteneur**.

Scaleway provisionnera immédiatement le conteneur et vous fournira une URL de point d'accès public (par exemple, `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Remarque : Pour une conformité stricte des données, vérifiez que les détails de votre organisation Scaleway reflètent votre entité juridique européenne.*

---
