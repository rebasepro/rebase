---
title: Déploiement de Rebase sur Fly.io
description: Découvrez comment déployer Rebase globalement ou le restreindre aux centres de données européens avec Fly.io.
sidebar_label: Fly.io
---

Fly.io vous permet d'héberger des conteneurs Docker à proximité de vos utilisateurs via son réseau anycast mondial. Fly est hautement configurable en matière de routage de données, ce qui en fait un excellent choix pour le déploiement d'applications Rebase avec un focus strict sur les données européennes.

Fly.io dispose de centres de données à **Amsterdam (ams)**, **Francfort (fra)**, **Madrid (mad)** et **Paris (cdg)**. 

## 1. Initialiser l'application Fly
Depuis votre dépôt Rebase local, après vous être assuré que la CLI Fly (`flyctl`) est installée, exécutez :

```bash
fly launch
```

1. **Nom de l'application :** `my-rebase-app`
2. **Organisation :** Personnelle ou votre organisation d'entreprise.
3. **Région :** Lorsque vous êtes invité à choisir une région, sélectionnez explicitement un centre de données européen tel que **Francfort (fra)** ou **Paris (cdg)**.
4. **Base de données :** Lorsque vous êtes invité à configurer une base de données Postgres, répondez **Oui**. Fly créera automatiquement un cluster Postgres dans la *même région* et injectera de manière sécurisée la `DATABASE_URL` dans votre application.
5. **Redis :** Répondez **Non**.

*Ne déployez pas tout de suite lorsque vous y êtes invité.* Nous devons d'abord définir une variable d'environnement critique.

## 2. Définition du Secret JWT
Avant que votre application ne démarre en production, vous devez injecter le Secret JWT afin que Rebase puisse signer en toute sécurité les opérations de jetons d'authentification.

Exécutez la commande suivante localement :
```bash
fly secrets set JWT_SECRET=your_super_long_randomly_generated_secure_string -a my-rebase-app
```

## 3. Valider la configuration interne
Fly aura généré un fichier `fly.toml` à la racine de votre projet. Vérifiez que le port interne s'aligne explicitement avec la configuration par défaut de Rebase (`3001`) :

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3001 # Make sure this matches your Hono app port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Déployer

Vos données sont localisées, votre base de données est provisionnée et vos secrets sont injectés. Démarrez le déploiement :

```bash
fly deploy
```

Une fois l'analyse et le téléchargement terminés, votre application sera automatiquement mise en ligne. Exécutez `fly open` pour afficher votre application déployée dans le navigateur !

---
