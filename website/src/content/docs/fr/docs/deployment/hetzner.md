---
sourceHash: 3f229b142441d5cb
title: Déployer Rebase sur Hetzner Cloud
description: Déployez un projet Rebase sur un serveur Hetzner Cloud unique avec son propre fichier Docker Compose et Caddy pour HTTPS, ou provisionnez-le avec Terraform, pour un hébergement basé dans l'UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapport performance-prix particulièrement avantageux et constitue un excellent choix pour les projets nécessitant une souveraineté des données européenne, grâce à ses centres de données situés à Nuremberg, Falkenstein et Helsinki.

Rien ici n'est spécifique à Hetzner concernant votre projet. Un déploiement Rebase est constitué de deux éléments distincts — l'image runtime publiée, et le **bundle** que `rebase build` génère — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) ou sur une machine Hetzner. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

Deux approches pour y parvenir :

- **[Un serveur, depuis votre projet](#un-serveur-depuis-votre-projet) :** le fichier `docker-compose.yml` généré par `rebase init`, sur un serveur créé manuellement. Les fichiers téléversés restent sur le disque du serveur.
- **[Terraform](#terraform) :** un module qui provisionne le serveur, le pare-feu, l'adresse IP, TLS ainsi qu'un volume persistant au-delà du cycle de vie de l'hôte.

## Un serveur, depuis votre projet

Un projet issu de `rebase init` contient déjà tout le nécessaire pour le déploiement : un fichier `docker-compose.yml` qui exécute Postgres et le runtime publié avec votre bundle monté, sert le panneau d'administration sur `/` et l'API sur `/api` depuis un seul conteneur, et conserve les téléversements sur un volume. Cette section explique comment placer ce fichier sur un serveur et configurer Caddy en amont pour le HTTPS.

### 1. Créer le serveur

1. Dans la console Hetzner Cloud, cliquez sur **Add Server**.
2. Choisissez un emplacement (**Location**) : Falkenstein, Nuremberg ou Helsinki pour la résidence des données dans l'UE.
3. Choisissez l'image **Ubuntu 24.04**.
4. Choisissez un type d'instance avec au moins **2 vCPU et 4 Go de RAM**. Le runtime, Postgres et Caddy se partagent ces ressources.
5. Activez les sauvegardes (**Backups**). La base de données et les fichiers téléversés résident sur le disque de ce serveur, et les sauvegardes sont ce qui permet de survivre à sa perte.
6. Ajoutez votre clé SSH et créez le serveur.

Faites pointer dès maintenant un enregistrement A de votre domaine — `app.example.com` ci-dessous — vers l'adresse du serveur. Caddy en a besoin pour obtenir un certificat.

### 2. Installer Docker et Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Compiler le bundle et le copier

Depuis votre projet, sur votre machine :

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compile vos collections, fonctions et crons dans `dist-bundle/`, avec leurs dépendances et le panneau d'administration compilé. Il n'y a pas d'image applicative à construire : le serveur exécute l'image runtime publiée en y montant ce répertoire.

### 4. Adapter la configuration pour la production

Sur le serveur, modifiez `/opt/my-app/.env`. `rebase init` l'a prérempli pour votre machine locale. Modifiez ces lignes :

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Conservez les valeurs générées pour `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` et `REBASE_ADMIN_PASSWORD`, ou remplacez-les par de nouvelles valeurs issues de `openssl rand -hex 32`. Le fichier Compose les lit ici et s'arrête en indiquant le nom de toute variable manquante.

Le fichier ne transmet au service `api` que les variables qu'il nomme explicitement ; le reste du fichier `.env` — notamment `NODE_ENV=development` — n'atteint donc pas le runtime. Le service s'exécute avec `NODE_ENV=production`. Toute variable non listée dans le fichier doit être ajoutée dans le bloc `environment:` du service.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` définissent le premier administrateur. En production, le premier compte enregistré n'est pas promu automatiquement ; le runtime crée donc celui-ci au premier démarrage, tant que la table des utilisateurs est vide. Connectez-vous avec ces identifiants et changez le mot de passe. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

Ensuite, dans `/opt/my-app/docker-compose.yml`, liez les deux ports publiés à l'interface de bouclage (loopback) :

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Tel qu'il est généré, le fichier publie Postgres et l'API sur toutes les interfaces réseau, ce qui est sans danger sur un ordinateur portable. Sur un serveur public, cela expose la base de données à Internet, et Docker publiant les ports en contournant `ufw`, une règle de pare-feu ne suffira pas à les bloquer. Avec `127.0.0.1`, seuls Caddy et les tunnels SSH peuvent y accéder.

### 5. Démarrer les services

```bash
cd /opt/my-app
docker compose up -d
```

Le premier démarrage crée toutes les tables nécessaires, y compris celles de vos collections, ainsi que leurs politiques de sécurité au niveau des lignes (row-level security policies).

### 6. Terminer TLS avec Caddy

Remplacez `/etc/caddy/Caddyfile` par :

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy obtient un certificat Let's Encrypt pour le domaine et gère son renouvellement. Ouvrez `https://app.example.com` et connectez-vous.

### Redéploiement

Recompilez, copiez le bundle, redémarrez le runtime :

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copier manuellement un répertoire sur une machine convient pour un serveur unique. Au-delà, adoptez l'une des approches évitant cette étape manuelle :

- **L'intégrer dans une image.** `FROM rebasepro/server:0.29.1`, puis `COPY --chown=node:node dist-bundle /bundle`, et déployez simplement en modifiant un tag.
- **Le servir via HTTP.** Définissez `REBASE_BUNDLE_URL` et le runtime récupère et décompresse le bundle à chaque démarrage. Le module Terraform ci-dessous procède ainsi, et le Helm chart utilise le même mécanisme.

## Terraform

Le module `terraform-hcloud-rebase` provisionne le serveur, un pare-feu, une IP stable et — élément essentiel — un volume qui héberge les données Postgres, de sorte que le remplacement de l'hôte ne détruise pas la base de données. Il exécute le runtime publié sous Docker Compose avec Caddy en amont, et récupère votre bundle depuis une URL.

Le module n'est pas publié sur le Terraform Registry. Utilisez-le depuis le dépôt Rebase, épinglé à une version spécifique :

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.29.1"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.29.1" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Un point essentiel avant le premier apply : l'enregistrement A pour `domain` doit déjà pointer vers le serveur, sinon le challenge Let's Encrypt de Caddy échouera. L'adresse IP étant créée indépendamment du serveur, vous pouvez d'abord l'obtenir avec `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, configurer le DNS, puis appliquer la configuration complète.

Le [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) du module détaille l'ensemble des variables.

## Stockage de fichiers

**Les téléversements peuvent rester sur le serveur.** Le fichier Compose du projet les conserve sur un volume nommé, monté sur `/storage`, et définit `FORCE_LOCAL_STORAGE=true`. Ils survivent aux redémarrages et aux redéploiements. Ils ne survivent pas à la perte du serveur, ce à quoi servent les sauvegardes Hetzner.

Sans ce paramètre, le runtime refuse le stockage local en production. Sur la plupart des plateformes de conteneurs, le système de fichiers est réinitialisé à chaque déploiement ; un backend local y entraînerait une perte silencieuse de données. Les téléversements renvoient alors `501 STORAGE_NOT_CONFIGURED` tant qu'aucun bucket n'est configuré.

Lorsque vous dépassez la capacité d'un seul disque ou que vous déployez un second serveur, déplacez les téléversements vers Hetzner Object Storage. Il est compatible S3 et hébergé dans les mêmes centres de données. Dans le bloc `environment:` du service `api`, remplacez `STORAGE_PATH` et `FORCE_LOCAL_STORAGE` par :

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

en plaçant les deux clés dans `.env`. Les fichiers déjà présents sur le volume ne sont pas migrés automatiquement : copiez-les dans le bucket en conservant leurs clés.

Le module Terraform propose les mêmes options sous forme de variables : un bucket S3, ou `force_local_storage = true`, qui conserve les téléversements sur son volume de données. Consultez [Stockage](/docs/backend/storage) pour une vue d'ensemble complète.

## Ce que le démarrage fait à votre schéma

Avec `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut `ensure`, le runtime provisionne les tables de vos collections **et leurs politiques de sécurité au niveau des lignes** au démarrage, de façon additive. Une nouvelle collection est ainsi opérationnelle dès le déploiement suivant, sans étape préalable de migration du schéma.

Ce que le démarrage ne fait délibérément jamais, c'est toute opération destructrice : il ne modifie pas le type d'une colonne, ne supprime pas de colonne et n'édite pas de valeur d'énumération existante. Un redémarrage de conteneur ne doit en aucun cas pouvoir altérer un schéma comme effet secondaire.

Une opération nécessite par conséquent toujours [`rebase db push`](/docs/architecture/schema-as-code) : toute modification qui n'est pas purement additive — une colonne renommée, un type restreint, un champ supprimé. Exécutez-la depuis votre copie locale, via un tunnel SSH vers le port de bouclage :

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Vérifiez le SQL affiché par l'exécution à blanc (dry run), puis relancez la commande sans `--dry-run`. `sslmode=disable` est nécessaire car la base de données Compose n'utilise pas TLS ; c'est le tunnel qui chiffre la connexion.

Un port de base de données exposé à Internet permettrait de lire les lignes d'un déploiement Rebase en contournant la sécurité au niveau des lignes plutôt qu'en la traversant. Conservez-le sur l'interface de bouclage et utilisez le tunnel.

## Mises à jour

Modifiez `REBASE_VERSION` dans `.env` et recréez le runtime :

```bash
docker compose pull api && docker compose up -d api
```

Votre bundle reste inchangé.

L'exception concerne les versions majeures de Postgres : Postgres refuse de démarrer avec un répertoire de données écrit par une version majeure antérieure. Cette mise à niveau nécessite donc une sauvegarde et une restauration, jamais une mise à niveau sur place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la checklist de production et les règles relatives au premier administrateur communes à toutes les plateformes.
- [Auto-hébergement](/docs/deployment/self-hosting) — le même déploiement sans framework prédéfini, avec un gestionnaire de connexions (connection pooler) et des processus séparés.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
