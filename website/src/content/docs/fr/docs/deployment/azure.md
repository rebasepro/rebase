---
sourceHash: 894fc95e8d4561d7
title: Déployer Rebase sur Microsoft Azure
description: Déployez votre instance Rebase en toute sécurité sur Azure à l'aide d'Azure Database for PostgreSQL et d'Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre des intégrations étroites et une conformité adaptée aux entreprises. L'architecture optimale pour exécuter Rebase sur Azure utilise **Azure Database for PostgreSQL – Flexible Server** pour la couche de données et **Azure Container Apps** pour l'environnement d'exécution.

Pour respecter la conformité européenne sur les données et garantir des temps de réponse locaux rapides, provisionnez vos ressources dans des régions telles que **West Europe (Amsterdam)**, **North Europe (Irlande)** ou **France Central (Paris)**.

Rien sur cette page n'est spécifique à Azure en ce qui concerne votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image de runtime publiée et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, via le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Provisionner PostgreSQL Flexible Server

1. Depuis le portail Azure, recherchez et sélectionnez **Azure Database for PostgreSQL servers**.
2. Cliquez sur **Créer** et sélectionnez **Serveur flexible**.
3. Choisissez votre groupe de ressources et définissez votre région UE préférée.
4. Sélectionnez la taille de calcul (par exemple, Usage général, ou Burstable `B2s` pour les déploiements plus modestes).
5. Configurez l'onglet **Authentification** avec un nom d'utilisateur administrateur et un mot de passe sécurisé.
6. Sous **Réseau**, assurez-vous que l'option « Autoriser l'accès public depuis n'importe quel service Azure au sein d'Azure vers ce serveur » est cochée afin que votre Container App puisse se connecter, ou configurez un VNet sécurisé.
7. Notez le nom de votre serveur et composez l'URI de connexion :
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois : Azure la conditionne derrière le paramètre de serveur `azure.extensions`, puis exécutez `CREATE EXTENSION vector;`.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. La commande `rebase build` produit un répertoire `dist-bundle` contenant vos collections, fonctions et tâches cron compilées, ainsi que votre frontend compilé si votre projet déclare une application statique. L'image de runtime publiée s'occupe de l'exécuter :

```bash
rebase build
```

Container Apps extrait ses images depuis un registre, vous devez donc intégrer le bundle dans une image dérivée. Trois lignes suffisent pour figer exactement ce qui doit s'exécuter :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.1
COPY dist-bundle /bundle
```

1. Créez un **Container Registry** dans la région UE de votre choix.
2. Connectez-vous depuis votre CLI :
   ```bash
   az acr login --name YourRegistryName
   ```
3. Construisez et poussez l'image depuis la racine du projet :
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Mettre à niveau Rebase ultérieurement se résume à modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Déployer la Container App

Azure Container Apps fournit un environnement de conteneurs serverless avec un ingress HTTPS intégré.

1. Recherchez **Container Apps** dans le portail et cliquez sur **Créer**.
2. Créez un nouvel environnement Container Apps dans votre région UE.
3. Dans l'onglet **Conteneur**, pointez vers votre registre ACR et sélectionnez l'image `rebase-backend:latest`.
4. Définissez les **variables d'environnement** :

| Nom | Valeur |
|------|-------|
| `DATABASE_URL` | Votre chaîne de connexion Azure Postgres |
| `JWT_SECRET` | Une chaîne aléatoire sécurisée de 32 caractères ou plus |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire sécurisée de 32 caractères ou plus |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mail et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Les trois dernières variables permettent à ce déploiement d'obtenir un administrateur : en production, le premier compte enregistré n'est pas promu, donc aucun autre moyen ne permet de générer le premier compte connecté. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Enregistrez les données sensibles en tant que secrets Container Apps et référencez-les, plutôt que de les inscrire directement en clair dans les variables d'environnement.

5. Sous l'onglet **Ingress**, activez l'ingress.
6. Définissez le port cible sur **8080** — le port sur lequel l'image de runtime écoute par défaut, sauf si `PORT` est spécifié.
7. Pointez la sonde d'état (health probe) vers `/livez`. Ne ciblez pas `/health` : celle-ci effectue un aller-retour vers la base de données, et une sonde de vivacité (liveness probe) configurée dessus risquerait de redémarrer un conteneur pourtant sain lors d'un bref ralentissement de la base de données.
8. Finalisez la création. Azure provisionne le conteneur et vous attribue une URL d'application sécurisée via TLS.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** La variable `REBASE_MIGRATE_ON_BOOT` est définie par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, les colonnes et les types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur un serveur vide est immédiatement opérationnel pour délivrer vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne change pas le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car le redémarrage d'un conteneur ne doit pas modifier la structure d'un schéma comme effet secondaire d'un déploiement.

Deux opérations nécessitent donc toujours la CLI, exécutée depuis un clone local ou un job CI avec `DATABASE_URL` pointant vers votre Flexible Server (ajoutez une règle de pare-feu autorisant l'IP de votre client si nécessaire) :

```bash
rebase db push
```

- **La RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

L'image de runtime étant distribuée sans la CLI, ces commandes ne s'exécutent jamais à l'intérieur du conteneur. Pour les migrations versionnées, validez les fichiers de migration avec `rebase db generate` et exécutez `rebase db migrate` comme étape de release.

## Stockage de fichiers

Les réplicas de Container Apps ne disposent pas de disque persistant ; le stockage local de fichiers entraîne donc une perte silencieuse de données, raison pour laquelle le runtime le refuse en production. Créez un compte Azure Storage et utilisez son interface compatible S3, ou un bucket compatible S3 dans la même région, avec `STORAGE_TYPE=s3` — voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à chaque plateforme.
- [Configuration](/docs/getting-started/configuration) — la liste complète des variables d'environnement lues par le runtime.
