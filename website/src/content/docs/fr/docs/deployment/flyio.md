---
sourceHash: 263c0ae6a0fac44f
title: Déployer Rebase sur Fly.io
description: Découvrez comment déployer Rebase à l'échelle mondiale ou le restreindre aux centres de données européens à l'aide de Fly.io.
sidebar_label: Fly.io
---

Fly.io exécute des conteneurs Docker au plus près de vos utilisateurs sur un réseau anycast mondial, et est hautement configurable quant à l'emplacement où résident les données — un choix idéal pour un déploiement Rebase ciblant strictement l'Europe. Fly dispose de centres de données à **Amsterdam (ams)**, **Francfort (fra)**, **Madrid (mad)** et **Paris (cdg)**.

Rien sur cette page n'est propre à Fly concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée et le **bundle** produit par `rebase build` — et le même bundle fonctionne sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [chart Helm](/docs/deployment/kubernetes) et ici.

## 1. Initialiser l'application Fly

Avec `flyctl` installé, depuis votre projet :

```bash
fly launch --no-deploy
```

1. **Nom de l'application :** `my-rebase-app`
2. **Organisation :** personnelle, ou l'organisation de votre entreprise.
3. **Région :** choisissez un centre de données européen — Francfort (`fra`) ou Paris (`cdg`).
4. **Base de données :** répondez **Yes** pour un cluster Postgres. Fly le crée dans la même région et injecte `DATABASE_URL`.
5. **Redis :** répondez **No**.

`--no-deploy` car les secrets et le bundle doivent d'abord être en place.

Si vos collections déclarent une propriété `vector`, activez l'extension une fois sur cette base de données : `CREATE EXTENSION vector;`.

## 2. Générer le bundle et faire pointer fly.toml vers l'image runtime

Il n'y a **aucune image d'application à construire à partir de votre code source**. `rebase build` génère un répertoire `dist-bundle` contenant vos collections compilées, vos fonctions, vos tâches cron et — si votre projet déclare une application statique — votre frontend compilé :

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

`/livez` plutôt que `/health` : le second effectue un aller-retour avec la base de données, donc une vérification de liveness sur celui-ci redémarrerait une machine saine lors d'un bref hoquet de la base de données.

`DISABLE_SELF_REGISTRATION` est nouveau : sur la version 0.17.3, ce paramètre n'existe pas, et le premier compte enregistré devient l'administrateur.

Mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste intact.

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

Les deux derniers sont nouveaux, et c'est ainsi que cette application obtient un administrateur : en production, le premier compte à s'enregistrer n'est pas promu, donc rien d'autre ne génère le premier utilisateur connecté. Définissez-les avant que le premier déploiement ne commence à traiter le trafic — consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` n'affiche que des empreintes (digests), alors conservez bien le mot de passe généré par cette commande ; il n'y a aucun moyen de le relire.

## 4. Déployer

```bash
fly deploy
```

Puis `fly open`.

## 5. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma — il crée les tables, les colonnes et les types enum manquants et applique leur sécurité au niveau des lignes (RLS) — ainsi, le premier démarrage sur une base de données vide est directement prêt à servir vos collections.

Ce que `ensure` ne fait jamais, c'est modifier quelque chose qui existe déjà : il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les libellés d'un enum existant, car le redémarrage d'une machine ne doit pas altérer un schéma comme effet secondaire d'un déploiement.

Deux éléments nécessitent donc toujours la CLI, exécutée depuis un clone local ou un job CI :

```bash
rebase db push
```

- **La RLS sur les tables de jonction** pour les relations plusieurs-à-plusieurs (many-to-many).
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Pour une base Postgres Fly privée, ouvrez un tunnel avec `fly proxy 5432 -a <your-db-app>` et faites pointer `DATABASE_URL` vers `localhost:5432`. L'image runtime étant fournie sans la CLI, cette commande ne s'exécute jamais à l'intérieur de la machine et une `release_command` ne peut pas l'appeler non plus. Pour des migrations versionnées, commitez les fichiers de migration avec `rebase db generate` et exécutez plutôt `rebase db migrate` comme étape de release.

## Stockage de fichiers

Le système de fichiers d'une machine Fly ne survit pas à un déploiement, le stockage de fichiers local entraîne donc une perte silencieuse de données et le runtime le refuse en production. Associez un bucket compatible S3 — Tigris est celui provisionné par Fly — avec `STORAGE_TYPE=s3`. Consultez [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production, et les règles concernant le premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.

---
