---
sourceHash: fcd75234f992e56c
title: Déployer Rebase sur Microsoft Azure
description: Déployez votre instance Rebase en toute sécurité sur Azure à l'aide d'Azure Database pour PostgreSQL et Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre des intégrations étroites et une conformité pour les entreprises. L'architecture optimale pour exécuter Rebase sur Azure utilise **Azure Database pour PostgreSQL – Serveur flexible** pour la couche de données et **Azure Container Apps** pour le runtime.

Pour respecter la conformité des données européennes et garantir des temps de réponse locaux rapides, provisionnez vos ressources dans des régions comme **West Europe (Amsterdam)**, **North Europe (Irlande)** ou **France Central (Paris)**.

Rien sur cette page n'est spécifique à Azure concernant votre projet. Un déploiement Rebase se compose de deux parties distinctes — l'image de runtime publiée et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) et ici.

## 1. Provisionner un serveur flexible PostgreSQL

1. Dans le portail Azure, recherchez et sélectionnez **Azure Database for PostgreSQL servers**.
2. Cliquez sur **Créer** et sélectionnez **Serveur flexible**.
3. Choisissez votre groupe de ressources et définissez votre région UE préférée.
4. Sélectionnez la taille de votre calcul (par ex., Usage général ou Burstable `B2s` pour les déploiements plus modestes).
5. Configurez l'onglet **Authentification** avec un nom d'utilisateur administrateur et un mot de passe sécurisé.
6. Sous **Réseau**, assurez-vous que l'option « Autoriser l'accès public depuis n'importe quel service Azure au sein d'Azure vers ce serveur » est cochée afin que votre Container App puisse se connecter, ou configurez un VNet sécurisé.
7. Notez le nom de votre serveur et assemblez l'URI de connexion :
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si vos collections déclarent une propriété `vector`, activez l'extension une fois : Azure la conditionne via le paramètre de serveur `azure.extensions`, puis exécutez `CREATE EXTENSION vector;`.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image d'application à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Container Apps télécharge depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent, et cela fige exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Mettre à niveau Rebase ultérieurement revient simplement à modifier cette ligne `FROM`. Votre bundle reste intact.

## 3. Déployer la Container App

Azure Container Apps fournit un environnement de conteneurs serverless avec un ingress HTTPS intégré.

1. Recherchez **Container Apps** dans le portail et cliquez sur **Créer**.
2. Créez un nouvel environnement Container Apps dans votre région UE.
3. Dans l'onglet **Conteneur**, pointez vers votre registre ACR et sélectionnez l'image `rebase-backend:latest`.
4. Définissez les **variables d'environnement** :

| Nom | Valeur |
|------|-------|
| `DATABASE_URL` | Votre chaîne de connexion Postgres Azure |
| `JWT_SECRET` | Une chaîne aléatoire et sécurisée de 32 caractères ou plus |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire et sécurisée de 32 caractères ou plus |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens dans les e-mails et comme fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Les trois dernières permettent à ce déploiement d'avoir un administrateur : en production, le premier compte créé n'est pas promu automatiquement, donc rien d'autre ne produit le premier utilisateur connecté. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Stockez les secrets sous forme de secrets Container Apps et référencez-les, plutôt que comme de simples valeurs d'environnement en clair.

5. Dans l'onglet **Ingress**, activez l'ingress.
6. Définissez le port cible sur **8080** — le port sur lequel l'image de runtime écoute, sauf indication contraire de `PORT`.
7. Pointez la sonde d'état vers `/livez`. Pas `/health` : celle-ci effectue un aller-retour avec la base de données, donc une sonde de liveness sur celle-ci redémarrerait un conteneur sain lors d'un bref ralentissement de la base de données.
8. Finalisez la création. Azure provisionne le conteneur et vous fournit une URL d'application sécurisée avec TLS.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur un serveur vide est immédiatement opérationnel pour servir vos collections.

Ce que `ensure` ne fait jamais, c'est modifier quelque chose qui existe déjà : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car un redémarrage de conteneur ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Deux éléments nécessitent donc toujours la CLI, exécutée depuis un clone local ou un job CI avec `DATABASE_URL` pointant vers votre serveur flexible (ajoutez une règle de pare-feu autorisant l'IP de votre client si nécessaire) :

```bash
rebase db push
```

- **Le RLS pour les tables de jointure** pour les relations plusieurs-à-plusieurs.
- **Tout changement qui n'est pas purement additif** — une colonne renommée, un type restreint, un champ supprimé.

L'image de runtime est fournie sans la CLI, cela ne s'exécute donc jamais à l'intérieur du conteneur. Pour les migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` en tant qu'étape de release.

## Stockage de fichiers

Les réplicas de Container Apps ne disposent d'aucun disque persistant, le stockage de fichiers local entraînerait donc une perte de données silencieuse et le runtime le refuse en production. Créez un compte Azure Storage et utilisez son interface compatible S3, ou un bucket compatible S3 dans la même région, avec `STORAGE_TYPE=s3` — voir [Storage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à chaque plateforme.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
