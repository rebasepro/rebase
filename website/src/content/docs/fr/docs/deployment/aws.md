---
sourceHash: 2228ab84c888b578
title: Déployer Rebase sur AWS
description: Déployez votre instance Rebase en toute sécurité sur Amazon Web Services à l'aide de RDS et AWS App Runner avec une forte orientation européenne.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre une évolutivité exceptionnelle et une sécurité de niveau entreprise. Pour un déploiement de Rebase en production, nous recommandons de découpler l'architecture en utilisant **Amazon RDS** pour la base de données PostgreSQL et **AWS App Runner** (ou ECS Fargate) pour exécuter le runtime.

Pour maintenir une conformité stricte avec les réglementations européennes sur les données, assurez-vous d'opérer entièrement au sein d'une région de l'UE, telle que **eu-central-1 (Francfort)**, **eu-west-1 (Irlande)** ou **eu-west-3 (Paris)**.

Rien sur cette page n'est spécifique à AWS concernant votre projet. Un déploiement Rebase est constitué de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [Helm chart](/docs/deployment/kubernetes) et ici. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

## 1. Provisionner Amazon RDS (PostgreSQL)

1. Naviguez vers la console **RDS** dans la région UE de votre choix.
2. Cliquez sur **Créer une base de données** (Create database) et sélectionnez **Création standard** (Standard create).
3. Choisissez le moteur **PostgreSQL**.
4. Sous Modèles (Templates), choisissez **Production** ou **Offre gratuite/Dev** (Free tier/Dev) selon votre charge.
5. Créez un identifiant principal (Master Username, par ex. `rebase_admin`) et générez un mot de passe principal sécurisé.
6. Sous Connectivité, assurez-vous que la base de données est placée au sein d'un **VPC** auquel votre future instance App Runner pourra accéder en toute sécurité (ou rendez-la accessible publiquement en contrôlant strictement les plages d'adresses IP entrantes).
7. Une fois provisionnée, notez **l'adresse du point de terminaison** (Endpoint address) et assemblez votre URI :
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si vos collections déclarent une propriété `vector`, l'instance nécessite l'extension `pgvector` — RDS la fournit, mais elle doit être activée : `CREATE EXTENSION vector;` sur la base de données, une seule fois.

## 2. Compiler le bundle et l'intégrer dans une image

Il n'y a **aucune image applicative à construire à partir de votre code source**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections, fonctions, tâches cron compilées et — si votre projet déclare une application statique — votre frontend compilé. L'image runtime publiée l'exécute :

```bash
rebase build
```

Pour App Runner, qui effectue ses pulls depuis un registre, intégrez le bundle dans une image dérivée. Cela prend trois lignes et verrouille exactement ce qui s'exécute :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Accédez à **Elastic Container Registry** et créez un dépôt privé nommé `rebase-backend`.
2. Récupérez les commandes de push qu'AWS affiche dans la console — elles gèrent l'authentification Docker.
3. Construisez et poussez l'image, depuis la racine du projet :
   ```bash
   docker build -t rebase-backend .
   ```
4. Taguez et poussez l'image vers votre dépôt ECR.

Mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste intact, et rien dans votre projet n'est reconstruit.

## 3. Déployer via AWS App Runner

App Runner est le moyen le plus simple d'exécuter des conteneurs sur AWS sans avoir à gérer d'orchestrateurs.

1. Naviguez vers **AWS App Runner** et cliquez sur **Créer un service** (Create service).
2. Sélectionnez **Registre de conteneurs** (Container registry) et choisissez **Amazon ECR**.
3. Parcourez et sélectionnez votre image `rebase-backend`.
4. Sous **Paramètres du service** (Service settings), définissez le port sur **8080** — le port sur lequel l'image runtime écoute, sauf si `PORT` en indique un autre.
5. Définissez le chemin du **bilan de santé** (health check) sur `/livez`. Pas `/health` : ce dernier effectue un aller-retour avec la base de données, donc une sonde de vivacité (liveness probe) configurée dessus redémarrerait un service parfaitement sain lors d'un léger hoquet passager de la base de données.
6. Ajoutez les variables d'environnement :

| Clé | Valeur |
|-----|-------|
| `DATABASE_URL` | Votre chaîne de connexion RDS |
| `JWT_SECRET` | Une chaîne sécurisée générée aléatoirement (32+ caractères) |
| `REBASE_SERVICE_KEY` | Une chaîne sécurisée générée aléatoirement (32+ caractères) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Le domaine de votre frontend (par ex. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL de votre frontend (utilisée pour les liens d'e-mail et le repli CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'adresse du premier administrateur, définie **avant le premier démarrage** |
| `REBASE_ADMIN_PASSWORD` | Au moins 12 caractères |

Ces trois dernières variables permettent au déploiement d'avoir un administrateur : en production, le premier compte qui s'inscrit n'est pas promu, donc aucun autre mécanisme ne crée le premier appelant authentifié. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). Placez les secrets dans AWS Secrets Manager et référencez-les plutôt que de les saisir directement dans le formulaire de la console.

7. (Optionnel) Si votre instance RDS est strictement privée, configurez le réseau **Custom VPC** dans App Runner pour que le conteneur puisse joindre la base de données.
8. Cliquez sur **Créer et déployer** (Create & deploy).

AWS prend en charge la terminaison TLS, vous fournissant une URL `https` prête à l'emploi.

## 4. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (row-level security) — ainsi, le premier démarrage sur une instance RDS vide est immédiatement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les libellés d'un enum existant, car le redémarrage d'un conteneur ne doit pas altérer un schéma en tant qu'effet secondaire d'un déploiement.

Deux opérations nécessitent donc toujours le CLI, exécuté depuis un checkout local ou un job CI avec `DATABASE_URL` pointant vers RDS :

```bash
rebase db push
```

- **Le RLS des tables de jonction** pour les relations plusieurs-à-plusieurs (many-to-many).
- **Tout changement qui n'est pas purement additif** — une colonne renommée, un type restreint, un champ supprimé.

Si l'instance est privée, exécutez-le depuis la CI ou un hôte bastion situé dans le même VPC. L'image runtime étant fournie sans le CLI, cette commande ne s'exécute jamais dans le conteneur App Runner. Pour des migrations versionnées, committez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Les instances App Runner ne disposent pas de disque persistant, de sorte que le stockage de fichiers en local entraîne une perte silencieuse de données et le runtime le refuse en production. Créez un compartiment (bucket) S3 dans la même région et configurez `STORAGE_TYPE=s3` avec le nom du bucket et les identifiants d'accès — voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
