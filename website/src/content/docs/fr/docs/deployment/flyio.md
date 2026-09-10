---
sourceHash: d53d77c2683bb3d3
title: Déployer Rebase sur Fly.io
description: Découvrez comment déployer Rebase à l'échelle mondiale ou le restreindre aux centres de données européens à l'aide de Fly.io.
sidebar_label: Fly.io
---

Fly.io exécute des conteneurs Docker au plus près de vos utilisateurs sur un réseau Anycast mondial, et offre une grande configurabilité quant à l'emplacement des données — idéal pour un déploiement de Rebase strictement axé sur l'Europe. Fly dispose de centres de données à **Amsterdam (ams)**, **Francfort (fra)**, **Madrid (mad)** et **Paris (cdg)**.

Rien sur cette page n'est spécifique à Fly concernant votre projet. Un déploiement Rebase est constitué de deux éléments distincts — l'image runtime publiée et le **bundle** produit par `rebase build` — et le même bundle fonctionne sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) et ici.

## 1. Initialiser l'application Fly

Avec `flyctl` installé, depuis votre projet :

```bash
fly launch --no-deploy
```

1. **App name :** `my-rebase-app`
2. **Organization :** personnelle, ou celle de votre entreprise.
3. **Region :** choisissez un centre de données européen — Francfort (`fra`) ou Paris (`cdg`).
4. **Database :** répondez **Yes** pour un cluster Postgres. Fly le crée dans la même région et injecte `DATABASE_URL`.
5. **Redis :** répondez **No**.

`--no-deploy` car les secrets et le bundle doivent d'abord être en place.

Si vos collections déclarent une propriété `vector`, activez l'extension une fois sur cette base de données : `CREATE EXTENSION vector;`.

## 2. Construire le bundle et faire pointer fly.toml vers l'image runtime

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections, fonctions, tâches cron compilées et — si votre projet déclare une application statique — votre frontend compilé :

```bash
rebase build
```

Commitez un `Dockerfile` de trois lignes à la racine du projet :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Et faites pointer `fly.toml` vers celui-ci :

```toml title="fly.toml"
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DISABLE_SELF_REGISTRATION = "true"

[http_service]
  internal_port = 8080          # the port the runtime image listens on
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1      # realtime subscriptions need a machine to stay up

[[http_service.checks]]
  path = "/livez"
```

`/livez` plutôt que `/health` : le second effectue un aller-retour vers la base de données, donc un liveness check sur celui-ci redémarrerait une machine saine lors d'une brève interruption de la base de données.

`DISABLE_SELF_REGISTRATION` est nouveau : sur la version 0.17.3, cette option n'existe pas, et le premier compte créé devient l'administrateur.

Pour mettre à niveau Rebase ultérieurement, il suffit de modifier cette ligne `FROM`. Votre bundle reste intact.

## 3. Définir les secrets de production

```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

Les deux derniers sont nouveaux et constituent le seul moyen pour cette application d'obtenir un administrateur : en production, le premier compte enregistré n'est pas promu, donc rien d'autre ne produit le premier appelant authentifié. Définissez-les avant que le premier déploiement ne traite du trafic — voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` n'affiche que des empreintes (digests), conservez donc le mot de passe généré par cette commande ; il n'y a aucun moyen de le relire par la suite.

## 4. Déployer

```bash
fly deploy
```

Puis `fly open`.

## 5. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` vaut par défaut `ensure`, ce qui est additif sur l'ensemble du schéma — cela crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une base de données vide est immédiatement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier un élément existant : il ne modifie pas le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car le redémarrage d'une machine ne doit pas altérer un schéma en tant qu'effet secondaire d'un déploiement.

Deux choses nécessitent donc toujours l'utilisation du CLI, exécuté depuis un checkout local ou un job CI :

```bash
rebase db push
```

- **La RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Tout changement qui n'est pas purement additif** — une colonne renommée, un type restreint, un champ supprimé.

Pour un Postgres Fly privé, ouvrez un tunnel avec `fly proxy 5432 -a <your-db-app>` et faites pointer `DATABASE_URL` vers `localhost:5432`. L'image runtime étant fournie sans le CLI, cette commande ne s'exécute jamais à l'intérieur de la machine et une `release_command` ne peut pas non plus l'appeler. Pour des migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Le système de fichiers d'une machine Fly ne survit pas à un déploiement ; le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production. Associez un bucket compatible S3 — Tigris est celui provisionné par Fly — avec `STORAGE_TYPE=s3`. Voir [Stockage](/docs/backend/storage).

## Étapes suivantes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
