---
sourceHash: 96c2cde2b2f611cc
title: Déployer Rebase sur Fly.io
description: Découvrez comment déployer Rebase à l'échelle mondiale ou le restreindre aux centres de données européens à l'aide de Fly.io.
sidebar_label: Fly.io
---

Fly.io exécute des conteneurs Docker au plus près de vos utilisateurs sur un réseau anycast mondial, et offre une grande flexibilité quant à la localisation des données — un choix idéal pour un déploiement Rebase ciblé strictement sur l'Europe. Fly dispose de centres de données à **Amsterdam (ams)**, **Francfort (fra)**, **Madrid (mad)** et **Paris (cdg)**.

Rien sur cette page n'est spécifique à Fly concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute aussi bien avec Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [chart Helm](/docs/deployment/kubernetes) ou ici.

## 1. Initialiser l'application Fly

Une fois `flyctl` installé, depuis votre projet :

```bash
fly launch --no-deploy
```

1. **Nom de l'application :** `my-rebase-app`
2. **Organisation :** personnelle, ou celle de votre entreprise.
3. **Région :** choisissez un centre de données européen — Francfort (`fra`) ou Paris (`cdg`).
4. **Base de données :** répondez **Yes** pour un cluster Postgres. Fly le crée dans la même région et injecte `DATABASE_URL`.
5. **Redis :** répondez **No**.

`--no-deploy` car les secrets et le bundle doivent être en place au préalable.

Si vos collections déclarent une propriété `vector`, activez l'extension une fois sur cette base de données : `CREATE EXTENSION vector;`.

## 2. Compiler le bundle et faire pointer fly.toml vers l'image runtime

Il n'y a **aucune image d'application à compiler depuis votre code source**. `rebase build` produit un répertoire `dist-bundle` contenant vos collections compilées, fonctions, tâches cron et — si votre projet déclare une application statique — votre frontend compilé :

```bash
rebase build
```

Commitez un `Dockerfile` de trois lignes à la racine du projet :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

Et faites-le pointer dans `fly.toml` :

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

Utilisez `/livez` plutôt que `/health` : le second effectue un aller-retour vers la base de données, donc un contrôle de liveness sur celui-ci redémarrerait une machine saine lors d'un bref incident sur la base de données.

`DISABLE_SELF_REGISTRATION` est nouveau : en 0.17.3, ce paramètre n'existe pas, et le premier compte enregistré devient l'administrateur.

Mettre à niveau Rebase ultérieurement consiste simplement à modifier cette ligne `FROM`. Votre bundle reste inchangé.

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

Les deux derniers sont nouveaux et permettent à cette application d'avoir un administrateur : en production, le premier compte enregistré n'est pas promu, donc rien d'autre ne produit le premier utilisateur authentifié. Définissez-les avant que le premier déploiement ne commence à traiter du trafic — voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` n'affiche que des condensats (digests) ; conservez donc le mot de passe généré par cette commande, car il est impossible de le relire par la suite.

## 4. Déployer

```bash
fly deploy
```

Puis `fly open`.

## 5. Le schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma — il crée les tables, colonnes et types enum manquants et applique leur sécurité au niveau des lignes (RLS) — de sorte que le premier démarrage sur une base de données vide est immédiatement opérationnel pour servir vos collections.

Ce que `ensure` ne fait jamais, c'est modifier un élément existant : il n'altère pas le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car le redémarrage d'une machine ne doit pas remodeler un schéma comme effet secondaire d'un déploiement.

Deux opérations nécessitent donc toujours la CLI, exécutée depuis une copie de travail ou un job CI :

```bash
rebase db push
```

- **La RLS pour les tables de jointure** pour les relations many-to-many.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Pour une instance Fly Postgres privée, ouvrez un tunnel avec `fly proxy 5432 -a <your-db-app>` et faites pointer `DATABASE_URL` vers `localhost:5432`. L'image runtime étant livrée sans la CLI, cette commande ne s'exécute jamais à l'intérieur de la machine et une `release_command` ne peut pas non plus l'appeler. Pour des migrations versionnées, commitez plutôt les fichiers de migration avec `rebase db generate` et exécutez `rebase db migrate` lors d'une étape de release.

## Stockage de fichiers

Le système de fichiers d'une machine Fly ne subsiste pas après un déploiement ; un stockage local de fichiers entraîne donc une perte silencieuse de données et le runtime le refuse en production. Associez un bucket compatible S3 — Tigris est celui provisionné par Fly — avec `STORAGE_TYPE=s3`. Voir [Stockage](/docs/backend/storage).

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
