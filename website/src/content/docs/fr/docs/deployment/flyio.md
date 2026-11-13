---
sourceHash: 15a0356fd585a797
title: Déployer Rebase sur Fly.io
description: Découvrez comment déployer Rebase mondialement ou restreindre son déploiement aux centres de données européens avec Fly.io.
sidebar_label: Fly.io
---

Fly.io exécute des conteneurs Docker au plus près de vos utilisateurs sur un réseau Anycast mondial, et offre une grande flexibilité quant à l'emplacement des données — une solution idéale pour un déploiement Rebase ciblé strictement sur l'Europe. Fly dispose de centres de données à **Amsterdam (ams)**, **Francfort (fra)**, **Madrid (mad)** et **Paris (cdg)**.

Rien sur cette page n'est spécifique à Fly concernant votre projet. Un déploiement Rebase est composé de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, via le [Helm chart](/docs/deployment/kubernetes) et ici.

## 1. Initialiser l'application Fly

Avec `flyctl` installé, depuis votre projet :

```bash
fly launch --no-deploy
```

1. **Nom de l'application :** `my-rebase-app`
2. **Organisation :** personnelle ou l'organisation de votre entreprise.
3. **Région :** choisissez un centre de données européen — Francfort (`fra`) ou Paris (`cdg`).
4. **Base de données :** répondez **Yes** pour un cluster Postgres. Fly le crée dans la même région et injecte `DATABASE_URL`.
5. **Redis :** répondez **No**.

`--no-deploy` car les secrets et le bundle doivent d'abord être en place.

Si vos tables déclarent une colonne `col.vector()`, activez l'extension une seule fois sur cette base de données : `CREATE EXTENSION vector;`.

## 2. Construire le bundle et faire pointer fly.toml vers l'image runtime

Il n'y a **aucune image applicative à construire à partir de vos sources**. `rebase build` produit un répertoire `dist-bundle` contenant vos tables compilées, vos fonctions, vos tâches cron et — si votre projet déclare une application statique — votre frontend compilé :

```bash
rebase build
```

Commitez un `Dockerfile` de trois lignes à la racine du projet :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Et faites pointer `fly.toml` dessus :

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

`/livez` plutôt que `/health` : le second effectue un aller-retour avec la base de données, donc une vérification de liveness sur celui-ci redémarrerait une machine saine lors d'un bref hoquet de la base de données.

Mettre à jour Rebase plus tard consiste simplement à modifier cette ligne `FROM`. Votre bundle reste inchangé.

## 3. Configurer les secrets de production

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

Les deux derniers sont nouveaux et permettent à cette application d'avoir un administrateur : en production, le premier compte à s'enregistrer n'est pas promu, donc rien d'autre ne crée le premier utilisateur connecté. Définissez-les avant que le premier déploiement ne commence à servir du trafic — voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` n'affiche que des condensats (digests), alors conservez bien le mot de passe généré par cette commande ; il n'y a aucun moyen de le relire.

## 4. Déployer

```bash
fly deploy
```

Puis `fly open`.

## 5. Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (row-level security) — de sorte que le premier démarrage sur une base de données vide est directement prêt à servir vos tables.

Ce que `ensure` ne fait jamais, en revanche, c'est modifier quelque chose qui existe déjà : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les étiquettes d'un enum existant, car le redémarrage d'une machine ne doit pas altérer un schéma en tant qu'effet secondaire d'un déploiement.

Une chose nécessite donc toujours la CLI, exécutée depuis un checkout local ou un job de CI :

```bash
rebase db push
```

Toute modification qui n'est pas purement additive — une colonne renommée, un type restreint, un champ supprimé.

Pour un Postgres Fly privé, ouvrez un tunnel avec `fly proxy 5432 -a <your-db-app>` et faites pointer `DATABASE_URL` vers `localhost:5432`. L'image runtime étant fournie sans la CLI, celle-ci ne s'exécute jamais à l'intérieur de la machine et une `release_command` ne peut pas non plus l'appeler. Pour des migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` en tant qu'étape de release.

## Stockage de fichiers

Le système de fichiers d'une machine Fly ne survit pas à un déploiement ; le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production. Attachez un bucket compatible S3 — Tigris est celui provisionné par Fly — avec `STORAGE_TYPE=s3`. Voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production, et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
