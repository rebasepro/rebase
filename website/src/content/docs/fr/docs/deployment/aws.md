---
sourceHash: 936afac32ad9dc9d
title: Déploiement de Rebase sur AWS
description: Déployez votre instance Rebase en toute sécurité sur Amazon Web Services en utilisant RDS et AWS App Runner, avec une forte orientation européenne.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre une évolutivité incroyable et une sécurité de niveau entreprise. Pour un déploiement Rebase en production, nous recommandons de découpler l'architecture en utilisant **Amazon RDS** pour la base de données PostgreSQL et **AWS App Runner** (ou ECS Fargate) pour servir le backend Node.js.

Pour maintenir une conformité stricte aux réglementations européennes sur les données, assurez-vous d'opérer entièrement dans une région de l'UE, telle que **eu-central-1 (Francfort)**, **eu-west-1 (Irlande)** ou **eu-west-3 (Paris)**.

## 1. Provisionner Amazon RDS (PostgreSQL)

1. Naviguez vers la console **RDS** dans votre région de l'UE sélectionnée.
2. Cliquez sur **Créer une base de données** et sélectionnez **Création standard**.
3. Choisissez le moteur **PostgreSQL**.
4. Sous Modèles, choisissez **Production** ou **Niveau gratuit/Développement** selon votre charge.
5. Créez un nom d'utilisateur principal (par exemple, `rebase_admin`) et générez un mot de passe principal en toute sécurité.
6. Sous Connectivité, assurez-vous que la base de données est placée dans un **VPC** auquel votre future instance App Runner peut accéder en toute sécurité (ou rendez-la publiquement accessible si vous contrôlez strictement les plages d'IP d'entrée).
7. Une fois provisionné, notez l'**adresse du point d'accès (Endpoint)** et assemblez votre URI :
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

## 2. Pousser l'image vers ECR (Elastic Container Registry)

AWS App Runner tire directement les images d'ECR.

Il n'y a **aucune image applicative à construire depuis vos sources**. `rebase build` produit un répertoire `dist-bundle` avec vos collections, fonctions et crons compilés — et, si votre projet déclare une app statique, votre frontend construit. L'image de runtime publiée l'exécute :

```bash
rebase build
```

App Runner tire depuis un registre : intégrez donc le bundle dans une image dérivée. Trois lignes, et cela fige exactement ce qui tourne :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Mettre Rebase à niveau plus tard revient à changer cette ligne `FROM`. Votre bundle reste intact.

1. Naviguez vers **Elastic Container Registry** et créez un nouveau dépôt privé nommé `rebase-backend`.
2. Récupérez les commandes de push fournies par AWS dans la console (qui gèrent l'authentification Docker).
3. Construisez et poussez depuis la racine du projet :
   ```bash
   docker build -t rebase-backend .
   ```
4. Balisez et poussez-la vers votre dépôt ECR nouvellement créé.

## 3. Déployer via AWS App Runner

App Runner est le moyen le plus simple d'exécuter des conteneurs sur AWS sans gérer d'orchestrateurs.

1. Naviguez vers **AWS App Runner** et cliquez sur **Créer un service**.
2. Sélectionnez **Registre de conteneurs** et choisissez **Amazon ECR**.
3. Parcourez et sélectionnez votre image `rebase-backend`.
4. Sous **Paramètres du service**, définissez le port sur **3001**.
5. Ajoutez les variables d'environnement nécessaires sous l'onglet de configuration :

| Clé | Valeur |
|-----|-------|
| `DATABASE_URL` | Votre chaîne de connexion RDS |
| `JWT_SECRET` | Un hachage généré aléatoirement et sécurisé (32+ caractères) |
| `NODE_ENV` | `production` |

6. (Facultatif) Si votre instance RDS est strictement privée, configurez la mise en réseau **VPC personnalisé** dans App Runner afin que le conteneur puisse communiquer en toute sécurité avec la base de données.
7. Cliquez sur **Créer et déployer**.

AWS gérera la terminaison TLS (fournissant une URL `https` prête à l'emploi) et démarrera le serveur Rebase.

## Créer le schéma de base de données

Le service est en cours d'exécution, mais Rebase ne crée automatiquement que les tables d'**authentification** au démarrage — les tables de vos propres collections ne sont **pas** créées automatiquement. Exécutez cette commande une fois sur la base de données de production, sinon chaque collection renverra une erreur « missing table » :

```bash
pnpm run db:push
```

Exécutez-la depuis un checkout de votre projet (ou depuis votre job CI) avec `DATABASE_URL` pointant vers votre endpoint RDS. Si l'instance est privée, exécutez-la depuis la CI ou depuis un hôte bastion situé dans le même VPC. L'image déployée n'inclut pas la CLI, cette commande ne s'exécute donc pas à l'intérieur du conteneur App Runner. Pour des migrations versionnées, validez les fichiers de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` à la place.

---
