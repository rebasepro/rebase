---
sourceHash: 5cab02fec4aeb579
title: Déployer Rebase sur AWS
description: Déployez votre instance Rebase en toute sécurité sur Amazon Web Services en utilisant RDS et AWS App Runner, avec une forte orientation européenne.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre une évolutivité exceptionnelle et une sécurité de niveau entreprise. Pour un déploiement de production de Rebase, nous recommandons de découpler l'architecture en utilisant **Amazon RDS** pour la base de données PostgreSQL et **AWS App Runner** (ou ECS Fargate) pour exécuter le runtime.

Pour maintenir une stricte conformité aux réglementations européennes sur les données, veillez à opérer entièrement au sein d'une région de l'UE, comme **eu-central-1 (Francfort)**, **eu-west-1 (Irlande)** ou **eu-west-3 (Paris)**.

Rien sur cette page n'est spécifique à AWS concernant votre projet. Un déploiement Rebase est constitué de deux éléments séparables — l'image runtime publiée, et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [chart Helm](/docs/deployment/kubernetes) et ici. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

## 1. Provisionner Amazon RDS (PostgreSQL)

1. Accédez à la console **RDS** dans la région UE de votre choix.
2. Cliquez sur **Create database** (Créer une base de données) et sélectionnez **Standard create** (Création standard).
3. Choisissez le moteur **PostgreSQL**.
4. Sous Templates (Modèles), choisissez **Production** ou **Free tier/Dev** (Niveau gratuit/Dev) selon votre charge.
5. Créez un Master Username (par ex., `rebase_admin`) et générez un Master Password de manière sécurisée.
6. Sous Connectivity (Connectivité), assurez-vous que la base de données est placée au sein d'un **VPC** auquel votre future instance App Runner pourra accéder de façon sécurisée (ou rendez-la accessible publiquement en contrôlant strictement les plages d'adresses IP entrantes).
7. Une fois provisionnée, notez l'**Endpoint address** et assemblez votre URI :
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si vos collections déclarent une propriété `vector`, l'instance nécessite l'extension `pgvector` — RDS la fournit, mais elle doit être activée : exécutez `CREATE EXTENSION vector;` sur la base de données, une seule fois.

## 2. Compiler le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à compiler à partir de votre code source**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections compilées, vos fonctions, vos tâches cron et — si votre projet déclare une application statique — votre frontend compilé. L'image runtime publiée l'exécute :

```bash
rebase build
```

Pour App Runner, qui effectue ses pulls depuis un registre, intégrez le bundle dans une image dérivée. Cela ne prend que trois lignes et fige exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.1
COPY dist-bundle /bundle
```

1. Accédez à **Elastic Container Registry** et créez un dépôt privé nommé `rebase-backend`.
2. Récupérez les commandes de push affichées par AWS dans la console — elles gèrent l'authentification Docker.
3. Buildez et poussez l'image, depuis la racine du projet :
   ```bash
   docker build -t rebase-backend .
   ```
4. Taguez-la et poussez-la vers votre dépôt ECR.

Mettre à niveau Rebase ultérieurement revient simplement à modifier cette ligne `FROM`. Votre bundle reste intact, et rien dans votre projet n'est recompilé.

## 3. Déployer via AWS App Runner

App Runner est le moyen le plus simple d'exécuter des conteneurs sur AWS sans avoir à gérer d'orchestrateurs.

1. Accédez à **AWS App Runner** et cliquez sur **Create service** (Créer un service).
2. Sélectionnez **Container registry** (Registre de conteneurs) et choisissez **Amazon ECR**.
3. Parcourez la liste et sélectionnez votre image `rebase-backend`.
4. Sous **Service settings** (Paramètres du service), définissez le port sur **8080** — le port sur lequel l'image runtime écoute, sauf indication contraire de la variable `PORT`.
5. Définissez le chemin du **health check** (contrôle de santé) sur `/livez`. Pas `/health` : ce dernier effectue un aller-retour vers la base de données, de sorte qu'une sonde de liveness sur ce chemin redémarrerait un service parfaitement sain lors d'un bref hoquet de la base de données.
6. Ajoutez les variables d'environnement :

| Clé | Valeur |
|-----|-------|
| `DATABASE_URL` | Votre chaîne de connexion RDS |
| `JWT_SECRET` | Une chaîne aléatoire sécurisée générée (32+ caractères) |
| `REBASE_SERVICE_KEY` | Une chaîne aléatoire sécurisée générée (32+ caractères) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mail et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Les trois dernières variables sont indispensables pour que ce déploiement dispose d'un administrateur : en production, le premier compte enregistré n'est pas promu, donc rien d'autre ne génère le premier utilisateur authentifié. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Placez les secrets dans AWS Secrets Manager et référencez-les plutôt que de les saisir dans le formulaire de la console.

7. (Facultatif) Si votre instance RDS est strictement privée, configurez le réseau **Custom VPC** dans App Runner afin que le conteneur puisse joindre la base de données.
8. Cliquez sur **Create & deploy** (Créer et déployer).

AWS prend en charge la terminaison TLS, vous offrant une URL `https` prête à l'emploi.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** La valeur par défaut de `REBASE_MIGRATE_ON_BOOT` est `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — de sorte que le premier démarrage sur une instance RDS vide devient immédiatement opérationnel pour servir vos collections.

Ce que `ensure` ne fait jamais, c'est modifier quelque chose qui existe déjà : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les libellés d'un enum existant, car un redémarrage de conteneur ne doit pas remodeler un schéma comme effet de bord d'un déploiement.

Deux opérations nécessitent donc toujours l'utilisation de la CLI, exécutée depuis un clone local ou un job de CI avec `DATABASE_URL` pointant vers RDS :

```bash
rebase db push
```

- **La RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Si l'instance est privée, exécutez la commande depuis la CI ou un hôte bastion situé au sein du même VPC. L'image runtime étant fournie sans la CLI, cette commande ne s'exécute jamais à l'intérieur du conteneur App Runner. Pour les migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les instances App Runner n'ont pas de disque persistant, de sorte que le stockage de fichiers en local entraîne une perte silencieuse de données et le runtime le refuse en production. Créez un bucket S3 dans la même région et définissez `STORAGE_TYPE=s3` avec son bucket et ses identifiants — consultez [Stockage](/docs/backend/storage).

## Étapes suivantes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur, communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
