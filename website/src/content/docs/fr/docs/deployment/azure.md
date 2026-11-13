---
sourceHash: 1fdfb40ed3615bbd
title: Déployer Rebase sur Microsoft Azure
description: Déployez votre instance Rebase en toute sécurité sur Azure à l'aide d'Azure Database pour PostgreSQL et d'Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre des intégrations étroites et une conformité d'entreprise. L'architecture optimale pour exécuter Rebase sur Azure utilise **Azure Database pour PostgreSQL – Serveur flexible** pour la couche de données et **Azure Container Apps** pour le runtime.

Pour respecter la conformité des données européennes et garantir des temps de réponse locaux rapides, provisionnez vos ressources dans des régions telles que **West Europe (Amsterdam)**, **North Europe (Irlande)** ou **France Central (Paris)**.

Rien sur cette page n'est spécifique à Azure concernant votre projet. Un déploiement Rebase se compose de deux parties distinctes — l'image runtime publiée, et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) et ici.

## 1. Provisionner un serveur flexible PostgreSQL

1. Dans le portail Azure, recherchez et sélectionnez **Serveurs Azure Database pour PostgreSQL**.
2. Cliquez sur **Créer** et sélectionnez **Serveur flexible**.
3. Choisissez votre groupe de ressources et définissez votre région UE préférée.
4. Sélectionnez la taille de calcul (par exemple, Usage général ou Burstable `B2s` pour les déploiements plus modestes).
5. Configurez l'onglet **Authentification** avec un nom d'utilisateur administrateur et un mot de passe sécurisé.
6. Sous **Réseau**, assurez-vous que l'option « Autoriser l'accès public depuis n'importe quel service Azure au sein d'Azure vers ce serveur » est cochée afin que votre Container App puisse s'y connecter, ou configurez un VNet sécurisé.
7. Notez le nom de votre serveur et assemblez l'URI de connexion :
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si vos tables déclarent une colonne `col.vector()`, activez l'extension une seule fois : Azure la restreint via le paramètre de serveur `azure.extensions`, puis exécutez `CREATE EXTENSION vector;`.

## 2. Compiler le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos tables compilées, fonctions, tâches cron et — si votre projet déclare une application statique — votre frontend compilé. L'image runtime publiée l'exécute :

```bash
rebase build
```

Container Apps télécharge les images depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent pour figer exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Créez un **Container Registry** dans la région UE de votre choix.
2. Connectez-vous depuis votre CLI :
   ```bash
   az acr login --name YourRegistryName
   ```
3. Construisez et poussez l'image, depuis la racine du projet :
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Pour mettre à niveau Rebase ultérieurement, il suffit de modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Déployer la Container App

Azure Container Apps fournit un environnement de conteneurs serverless avec un ingress HTTPS intégré.

1. Recherchez **Container Apps** dans le portail et cliquez sur **Créer**.
2. Créez un nouvel environnement Container Apps dans votre région UE.
3. Dans l'onglet **Conteneur**, pointez vers votre registre ACR et sélectionnez l'image `rebase-backend:latest`.
4. Définissez les **Variables d'environnement** :

| Nom | Valeur |
|------|-------|
| `DATABASE_URL` | Votre chaîne de connexion Azure Postgres |
| `JWT_SECRET` | Une chaîne aléatoire et sécurisée d'au moins 32 caractères |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire et sécurisée d'au moins 32 caractères |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (ex. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mail et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Les trois dernières permettent d'obtenir un administrateur pour ce déploiement : en production, le premier compte à s'inscrire n'est pas promu, donc rien d'autre ne crée le premier utilisateur connecté. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Stockez les secrets en tant que secrets Container Apps et référencez-les, plutôt que sous forme de valeurs brutes d'environnement.

5. Dans l'onglet **Ingress**, activez l'ingress.
6. Définissez le port cible sur **8080** — le port sur lequel l'image runtime écoute, sauf indication contraire de `PORT`.
7. Pointez la sonde d'intégrité (health probe) sur `/livez`. Pas `/health` : celle-ci effectue un aller-retour avec la base de données, donc une sonde de vivacité (liveness probe) configurée dessus redémarrerait un conteneur sain lors d'un bref incident sur la base de données.
8. Terminez la création. Azure provisionne le conteneur et vous fournit une URL d'application sécurisée par TLS.

## 4. Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est purement additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (row-level security) — ainsi, le premier démarrage sur un serveur vide dessert immédiatement vos tables.

Ce que `ensure` ne fait jamais, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car le redémarrage d'un conteneur ne doit pas modifier la structure d'un schéma comme effet secondaire d'un déploiement.

Une opération nécessite donc toujours l'utilisation du CLI, exécutée depuis un checkout local ou un job CI avec `DATABASE_URL` pointant vers votre serveur flexible (ajoutez une règle de pare-feu autorisant l'IP de votre client si nécessaire) :

```bash
rebase db push
```

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé.

L'image runtime étant fournie sans le CLI, cela ne s'exécute jamais à l'intérieur du conteneur. Pour des migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` comme étape de livraison (release).

## Stockage de fichiers

Les réplicas Container Apps ne disposent pas de disque persistant ; le stockage de fichiers en local entraîne donc une perte de données silencieuse, et le runtime le refuse en production. Azure Blob Storage n'utilisant pas l'API S3, utilisez un bucket compatible S3 dans la même région avec `STORAGE_TYPE=s3` et son `S3_ENDPOINT` — voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la liste de contrôle pour la production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
