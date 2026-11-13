---
sourceHash: d9b167443cc3fd35
title: Déployer Rebase sur AWS
description: Déployez votre instance Rebase en toute sécurité sur Amazon Web Services à l'aide de RDS et AWS App Runner, avec une forte orientation européenne.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre une évolutivité exceptionnelle et une sécurité de niveau entreprise. Pour un déploiement de Rebase en production, nous recommandons de découpler l'architecture en utilisant **Amazon RDS** pour la base de données PostgreSQL et **AWS App Runner** (ou ECS Fargate) pour exécuter le runtime.

Pour maintenir une stricte conformité aux réglementations européennes sur les données, veillez à opérer entièrement au sein d'une région de l'UE, telle que **eu-central-1 (Francfort)**, **eu-west-1 (Irlande)** ou **eu-west-3 (Paris)**.

Rien sur cette page n'est spécifique à AWS concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) ou ici. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

## 1. Provisionner Amazon RDS (PostgreSQL)

1. Accédez à la console **RDS** dans la région UE de votre choix.
2. Cliquez sur **Create database** et sélectionnez **Standard create**.
3. Choisissez le moteur **PostgreSQL**.
4. Sous Templates, choisissez **Production** ou **Free tier/Dev** selon votre charge.
5. Créez un Master Username (par ex., `rebase_admin`) et générez un Master Password sécurisé.
6. Sous Connectivity, assurez-vous que la base de données est placée dans un **VPC** auquel votre future instance App Runner pourra accéder en toute sécurité (ou rendez-la accessible publiquement si vous contrôlez strictement les plages d'adresses IP entrantes).
7. Une fois provisionnée, notez l'**Endpoint address** et assemblez votre URI :
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si vos tables déclarent une colonne `col.vector()`, l'instance nécessite l'extension `pgvector` — RDS la fournit, mais elle doit être activée : exécutez `CREATE EXTENSION vector;` une seule fois sur la base de données.

## 2. Construire le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos tables compilées, fonctions, crons et — si votre projet déclare une application statique — votre frontend compilé. L'image runtime publiée l'exécute :

```bash
rebase build
```

Pour App Runner, qui effectue un pull depuis un registre, intégrez le bundle dans une image dérivée. Cela tient en trois lignes et fige exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Accédez à **Elastic Container Registry** et créez un dépôt privé nommé `rebase-backend`.
2. Récupérez les commandes de push affichées par AWS dans la console — elles gèrent l'authentification Docker.
3. Construisez et poussez l'image depuis la racine du projet :
   ```bash
   docker build -t rebase-backend .
   ```
4. Taguez-la et poussez-la vers votre dépôt ECR.

Mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste intact, et rien dans votre projet n'est reconstruit.

## 3. Déployer via AWS App Runner

App Runner est le moyen le plus simple d'exécuter des conteneurs sur AWS sans avoir à gérer d'orchestrateur.

1. Accédez à **AWS App Runner** et cliquez sur **Create service**.
2. Sélectionnez **Container registry** et choisissez **Amazon ECR**.
3. Parcourez et sélectionnez votre image `rebase-backend`.
4. Sous **Service settings**, définissez le Port sur **8080** — le port sur lequel l'image runtime écoute, sauf si `PORT` spécifie autre chose.
5. Définissez le chemin du **health check** sur `/livez`. Pas `/health` : celui-ci effectue un aller-retour avec la base de données, donc une sonde de vivacité configurée dessus redémarrerait un service parfaitement sain lors d'un bref dysfonctionnement de la base de données.
6. Ajoutez les variables d'environnement :

| Clé | Valeur |
|-----|-------|
| `DATABASE_URL` | Votre chaîne de connexion RDS |
| `JWT_SECRET` | Une chaîne sécurisée générée aléatoirement (32+ caractères) |
| `REBASE_SERVICE_KEY` | Une chaîne sécurisée générée aléatoirement (32+ caractères) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (ex. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens dans les e-mails et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Les trois dernières permettent d'obtenir un administrateur sur ce déploiement : en production, le premier compte qui s'inscrit n'est pas promu, donc aucun autre moyen ne permet de générer le premier utilisateur connecté. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Placez les secrets dans AWS Secrets Manager et référencez-les plutôt que de les saisir dans le formulaire de la console.

7. (Facultatif) Si votre instance RDS est strictement privée, configurez la mise en réseau **Custom VPC** dans App Runner afin que le conteneur puisse joindre la base de données.
8. Cliquez sur **Create & deploy**.

AWS gère la terminaison TLS, vous fournissant directement une URL en `https`.

## 4. Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui a un comportement additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (row-level security) — ainsi, le premier démarrage sur une instance RDS vide est immédiatement prêt à servir vos tables.

Ce que `ensure` ne fait jamais, c'est modifier un élément déjà existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les valeurs d'un enum existant, car le redémarrage d'un conteneur ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Une chose nécessite donc toujours la CLI, exécutée depuis un clone local ou un job CI avec `DATABASE_URL` pointant vers RDS :

```bash
rebase db push
```

Tout changement qui n'est pas purement additif — une colonne renommée, un type restreint, un champ supprimé.

Si l'instance est privée, exécutez-la depuis la CI ou un hôte bastion au sein du même VPC. L'image runtime étant fournie sans la CLI, cela ne s'exécute jamais au sein du conteneur App Runner. Pour des migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` en tant qu'étape de release.

## Stockage de fichiers

Les instances App Runner ne disposent pas de disque persistant ; le stockage local de fichiers entraînerait donc une perte silencieuse de données, ce que le runtime refuse en production. Créez un bucket S3 dans la même région et configurez `STORAGE_TYPE=s3` avec son bucket et ses identifiants — voir [Stockage](/docs/backend/storage).

## Étapes suivantes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
