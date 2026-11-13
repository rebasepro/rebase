---
sourceHash: 80f640adab500773
title: Déployer Rebase sur Microsoft Azure
description: Déployez votre instance Rebase en toute sécurité sur Azure à l'aide d'Azure Database pour PostgreSQL et d'Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre des intégrations poussées et une conformité adaptée aux entreprises. L'architecture optimale pour exécuter Rebase sur Azure utilise **Azure Database for PostgreSQL – Flexible Server** pour la couche de données et **Azure Container Apps** pour l'environnement d'exécution (runtime).

Pour respecter la conformité européenne relative aux données et bénéficier de temps de réponse locaux rapides, provisionnez vos ressources dans des régions telles que **West Europe (Amsterdam)**, **North Europe (Irlande)** ou **France Central (Paris)**.

Rien sur cette page n'est spécifique à Azure concernant votre projet. Un déploiement Rebase est constitué de deux éléments distincts — l'image de runtime publiée et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) ou ici.

## 1. Provisionner PostgreSQL Flexible Server

1. Depuis le portail Azure, recherchez et sélectionnez **Azure Database for PostgreSQL servers**.
2. Cliquez sur **Créer** et sélectionnez **Serveur flexible** (**Flexible Server**).
3. Choisissez votre groupe de ressources et définissez votre région UE préférée.
4. Sélectionnez votre taille de calcul (par exemple, Usage général, ou Burstable `B2s` pour les déploiements plus modestes).
5. Configurez l'onglet **Authentification** avec un nom d'utilisateur administrateur et un mot de passe sécurisé.
6. Sous **Réseau**, assurez-vous que l'option « Autoriser l'accès public depuis n'importe quel service Azure au sein d'Azure à ce serveur » est cochée afin que votre Container App puisse s'y connecter, ou configurez un VNet sécurisé.
7. Notez le nom de votre serveur et assemblez l'URI de connexion :
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si vos tables déclarent une colonne `col.vector()`, activez l'extension une seule fois : Azure la conditionne au paramètre de serveur `azure.extensions`, puis exécutez `CREATE EXTENSION vector;`.

## 2. Compiler le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire depuis votre code source**. `rebase build` produit un répertoire `dist-bundle` contenant vos tables, fonctions, crôns compilés et — si votre projet déclare une application statique — votre frontend généré. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Container Apps extrait les images depuis un registre, intégrez donc le bundle dans une image dérivée. Trois lignes suffisent, et cela fige exactement ce qui s'exécute :

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

Mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste intact.

## 3. Déployer la Container App

Azure Container Apps fournit un environnement de conteneurs serverless avec un ingress HTTPS intégré.

1. Recherchez **Container Apps** dans le portail et cliquez sur **Créer**.
2. Créez un nouvel environnement Container Apps dans votre région UE.
3. Dans l'onglet **Conteneur**, pointez vers votre registre ACR et sélectionnez l'image `rebase-backend:latest`.
4. Définissez les **variables d'environnement** :

| Nom | Valeur |
|------|-------|
| `DATABASE_URL` | Votre chaîne de connexion Azure Postgres |
| `JWT_SECRET` | Une chaîne aléatoire sécurisée de 32+ caractères |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire sécurisée de 32+ caractères |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mail et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Ces trois dernières variables sont indispensables pour que ce déploiement dispose d'un administrateur : en production, le premier compte à s'inscrire n'est pas promu, donc aucun autre mécanisme ne crée le premier utilisateur authentifié. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Stockez les secrets en tant que secrets Container Apps et référencez-les, plutôt que sous forme de valeurs d'environnement en texte brut.

5. Sous l'onglet **Ingress**, activez l'ingress.
6. Définissez le port cible sur **8080** — le port sur lequel l'image de runtime écoute, sauf indication contraire de `PORT`.
7. Pointez la sonde d'état de santé (health probe) vers `/livez`. Pas `/health` : cette dernière effectue un aller-retour avec la base de données, donc une sonde de vivacité (liveness probe) configurée dessus redémarrerait un conteneur sain lors d'un bref ralentissement de la base de données.
8. Terminez la création. Azure provisionne le conteneur et vous fournit une URL d'application sécurisée par TLS.

## 4. Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — de sorte que le premier démarrage sur un serveur vide dessert immédiatement vos collections.

Ce que `ensure` ne fait jamais, c'est modifier un élément existant : il ne change pas le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car le redémarrage d'un conteneur ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Une opération nécessite donc toujours la CLI, exécutée depuis un clone local ou un job CI avec `DATABASE_URL` pointant vers votre Flexible Server (ajoutez une règle de pare-feu autorisant l'IP de votre client si nécessaire) :

```bash
rebase db push
```

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé.

L'image de runtime est livrée sans la CLI, cette commande ne s'exécute donc jamais à l'intérieur du conteneur. Pour les migrations versionnées, committez plutôt les fichiers de migration avec `rebase db generate` et exécutez `rebase db migrate` en tant qu'étape de livraison.

## Stockage de fichiers

Les réplicas de Container Apps ne disposent pas de disque persistant, le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production. Azure Blob Storage ne gère pas l'API S3, utilisez donc un bucket compatible S3 dans la même région avec `STORAGE_TYPE=s3` et son `S3_ENDPOINT` — voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur partagées par toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — l'ensemble des variables d'environnement lues par le runtime.
