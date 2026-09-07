---
sourceHash: 44b8d8c5aa0525b6
title: Déploiement de Rebase sur Microsoft Azure
description: Déployez votre instance Rebase en toute sécurité sur Azure en utilisant Azure Database pour PostgreSQL et Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre des intégrations poussées et une conformité d'entreprise. L'architecture optimale pour exécuter Rebase sur Azure implique l'utilisation d'**Azure Database pour PostgreSQL - Serveur Flexible** pour la couche de données et d'**Azure Container Apps** pour l'hébergement du conteneur backend.

Pour respecter la conformité des données européennes et garantir des temps de réponse locaux rapides, provisionnez vos ressources dans des régions telles que l'**Europe de l'Ouest (Amsterdam)**, l'**Europe du Nord (Irlande)** ou la **France Centre (Paris)**.

## 1. Provisionner un serveur flexible PostgreSQL

Il n'y a **aucune image applicative à construire depuis vos sources**. `rebase build` produit un répertoire `dist-bundle` avec vos collections, fonctions et crons compilés — et, si votre projet déclare une app statique, votre frontend construit. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Container Apps tire depuis un registre : intégrez donc le bundle dans une image dérivée. Trois lignes, et cela fige exactement ce qui tourne :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Mettre Rebase à niveau plus tard revient à changer cette ligne `FROM`. Votre bundle reste intact.

1. Depuis le portail Azure, recherchez et sélectionnez **Serveurs Azure Database pour PostgreSQL**.
2. Cliquez sur **Créer** et sélectionnez **Serveur Flexible**.
3. Choisissez votre groupe de ressources et définissez votre région UE préférée.
4. Sélectionnez votre taille de calcul (par exemple, Usage général ou Burstable `B2s` pour les déploiements plus petits).
5. Configurez l'onglet **Authentification** avec un nom d'utilisateur administrateur et un mot de passe sécurisé.
6. Sous **Mise en réseau**, assurez-vous que l'option "Autoriser l'accès public depuis n'importe quel service Azure au sein d'Azure vers ce serveur" est cochée afin que votre Container App puisse se connecter, ou configurez un VNet sécurisé.
7. Notez le nom de votre serveur et composez l'URI de connexion :
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

## 2. Créer et pousser vers Azure Container Registry (ACR)

Azure Container Apps extraira votre image Docker depuis ACR.
1. Créez un nouveau **Registre de conteneurs** dans la région UE de votre choix.
2. Connectez-vous depuis votre CLI :
   ```bash
   az acr login --name YourRegistryName
   ```
3. Construisez et poussez depuis la racine du projet :
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

## 3. Déployer une application de conteneur Azure

Azure Container Apps fournit un environnement de conteneur serverless avec une entrée HTTPS intégrée.

1. Recherchez **Container Apps** dans le portail et cliquez sur **Créer**.
2. Créez un nouvel environnement Container Apps dans votre région UE.
3. Dans l'onglet **Conteneur**, pointez vers votre registre ACR et sélectionnez l'image `rebase-backend:latest`.
4. Définissez les **Variables d'environnement** :

| Nom | Valeur |
|------|-------|
| `DATABASE_URL` | Votre chaîne de connexion Azure Postgres |
| `JWT_SECRET` | Une chaîne sécurisée aléatoire de 32+ caractères |
| `NODE_ENV` | `production` |

5. Sous l'onglet **Ingress**, activez explicitement Ingress.
6. Définissez le port cible sur **3001**.
7. Terminez la création. Azure provisionnera automatiquement le conteneur et vous fournira une URL d'application sécurisée avec TLS !

## Créer le schéma de base de données

Le conteneur est en cours d'exécution, mais Rebase ne crée automatiquement que les tables d'**authentification** au démarrage — les tables de vos propres collections ne sont **pas** créées automatiquement. Exécutez cette commande une fois sur la base de données de production, sinon chaque collection renverra une erreur « missing table » :

```bash
pnpm run db:push
```

Exécutez-la depuis un checkout de votre projet (ou depuis votre job CI) avec `DATABASE_URL` pointant vers votre chaîne de connexion Azure Database pour PostgreSQL (ajoutez une règle de pare-feu autorisant l'IP de votre client si nécessaire). L'image déployée n'inclut pas la CLI, cette commande ne s'exécute donc pas à l'intérieur du conteneur. Pour des migrations versionnées, validez les fichiers de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` à la place.

---
