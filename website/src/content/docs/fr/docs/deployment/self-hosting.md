---
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image d'exécution officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Présentation

Auto-héberger Rebase signifie exécuter deux éléments : une base de données Postgres et l'image officielle `rebasepro/server` dans laquelle le bundle de votre projet est monté.

Il n'y a **aucune image d'application à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et mettre à jour Rebase est un simple changement de tag plutôt qu'une nouvelle construction. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

```bash
rebase build                     # produces ./dist-bundle
docker compose up -d db          # start Postgres
rebase db push                   # create the collection tables, once
docker compose up                # start the runtime
```

Un fichier `docker-compose.yml` minimal :

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rebase
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      retries: 12

  api:
    image: rebasepro/server:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      # Writable: the container installs the bundle's declared dependencies into
      # it on first start. See "Dependencies" below for the read-only variant.
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

volumes:
  db-data:
```

## Dépendances

`rebase build` génère un fichier `package.json` à côté de votre bundle, énumérant les dépendances déclarées par votre projet. Le conteneur les installe lors du premier démarrage, c'est pourquoi le montage ci-dessus est en écriture.

Pour effectuer un montage en lecture seule à la place — ce qui est recommandé, car un hook compromis ne pourra alors pas réécrire le code qui s'exécute après le redémarrage suivant — installez-les d'abord :

```bash
npm install --omit=dev --prefix dist-bundle
```

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

Pour un déploiement réel, préférez intégrer les deux directement dans une image, ce qui permet également de figer exactement ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.13.0
COPY dist-bundle /bundle
```

## Création du schéma

Le runtime crée ses propres tables **d'authentification (auth)** au démarrage. **Les tables de collection constituent une étape distincte et délibérée**, et l'image du runtime ne s'en charge pas — un redémarrage de conteneur ne doit pas pouvoir modifier un schéma en tant qu'effet secondaire d'un déploiement.

```bash
rebase db push
```

Exécutez-le depuis un extrait de code local ou une tâche CI, en ciblant la base de données de déploiement. Il effectue d'abord une simulation (dry-run), refuse les modifications destructives sans confirmation explicite, et peut effectuer une sauvegarde avant d'appliquer les changements.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` (la valeur par défaut — tables d'auth uniquement) et `none`.

## Autres plateformes

Le runtime est un conteneur ordinaire à l'écoute sur `$PORT`, de sorte que tout système exécutant des conteneurs fonctionne. Deux points à bien configurer partout :

1. Le bundle doit être présent dans `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à côté — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refusera de démarrer en production sans ces variables plutôt que de tenter de les deviner.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.13.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, définissez les variables d'environnement et configurez le chemin du contrôle de santé sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Exécutez-le sous systemd, avec des lignes `Environment=` pour les variables ci-dessus.

## Contrôles de santé

| Chemin | Utilisation |
| --- | --- |
| `/livez` | État de vie (Liveness). Répond à « ce processus est-il actif ? » sans toucher à la base de données. |
| `/health` | État de disponibilité (Readiness). Effectue un aller-retour avec la base de données et indique la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarrerait un processus parfaitement sain lors d'une brève interruption de la base de données, ce qui est l'inverse de son objectif.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par collection, ainsi que des jauges de processus. Sans jeton, le point de terminaison est accessible en lecture par quiconque peut atteindre le port ; vous devez donc en définir un à moins d'être sur un réseau privé.

## Exécuter les fonctions dans leur propre processus

Tout ce qui précède est un seul conteneur servant l'ensemble du projet, ce qui
est la bonne forme pour presque tous les déploiements. Lorsqu'une fonction
personnalisée doit cesser de concurrencer l'API de données sur la boucle
d'événements — ou monter en charge, redémarrer et échouer de son côté — la même
image et le même bundle peuvent être démarrés comme plusieurs processus
coopérants. Voir [Processus séparés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.13.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).
