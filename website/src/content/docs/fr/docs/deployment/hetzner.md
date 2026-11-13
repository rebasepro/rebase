---
sourceHash: 23edfa071775b304
title: Déployer Rebase sur Hetzner Cloud
description: Déployez un projet Rebase sur un serveur Hetzner Cloud unique avec son propre fichier Docker Compose et Caddy pour HTTPS, ou provisionnez-le avec Terraform, pour un hébergement basé dans l'UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapport performances/prix exceptionnellement bon et constitue un choix solide pour les projets nécessitant une souveraineté des données européenne, avec des centres de données à Nuremberg, Falkenstein et Helsinki.

Rien ici n'est spécifique à Hetzner concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée, et le **bundle** que produit `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, sous le [chart Helm](/docs/deployment/kubernetes) et sur une machine Hetzner. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

Deux façons d'y parvenir :

- **[Un serveur, depuis votre projet](#un-serveur-depuis-votre-projet) :** le `docker-compose.yml` généré par `rebase init`, sur un serveur que vous créez manuellement. Les fichiers téléversés restent sur le disque du serveur.
- **[Terraform](#terraform) :** un module qui provisionne le serveur, le pare-feu, l'adresse IP, TLS et un volume qui persiste au-delà de l'hôte.

## Un serveur, depuis votre projet

Un projet issu de `rebase init` contient déjà tout le nécessaire au déploiement : un `docker-compose.yml` qui exécute Postgres et le runtime publié avec votre bundle monté, sert le panneau d'administration sur `/` et l'API sur `/api` depuis un seul conteneur, et conserve les téléversements sur un volume. Cette section place ce fichier sur un serveur et configure Caddy en frontal pour le HTTPS.

### 1. Créer le serveur

1. Dans la console Hetzner Cloud, cliquez sur **Add Server**.
2. Choisissez un emplacement (**Location**) : Falkenstein, Nuremberg ou Helsinki pour la résidence des données dans l'UE.
3. Choisissez l'image **Ubuntu 24.04**.
4. Choisissez un type avec au moins **2 vCPU et 4 Go de RAM**. Le runtime, Postgres et Caddy se les partagent.
5. Activez les sauvegardes (**Backups**). La base de données et les téléversements se trouvent sur le disque de ce serveur, et les sauvegardes sont ce qui permet de survivre à sa perte.
6. Ajoutez votre clé SSH et créez-le.

Pointez dès maintenant un enregistrement A pour votre domaine — `app.example.com` ci-dessous — vers l'adresse du serveur. Caddy en a besoin pour obtenir un certificat.

### 2. Installer Docker et Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Construire le bundle et le copier

Depuis votre projet, sur votre machine :

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compile vos tables, fonctions et tâches cron dans `dist-bundle/`, avec leurs dépendances et le panneau d'administration compilé. Il n'y a pas d'image applicative à construire : le serveur exécute l'image de runtime publiée avec ce répertoire monté à l'intérieur.

### 4. Adapter la configuration pour la production

Sur le serveur, modifiez `/opt/my-app/.env`. `rebase init` l'a prérempli pour votre machine locale. Modifiez ces lignes :

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Conservez les variables générées `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` et `REBASE_ADMIN_PASSWORD`, ou remplacez-les par de nouvelles valeurs générées avec `openssl rand -hex 32`. Le fichier Compose les lit depuis cet emplacement et s'arrête avec un message indiquant celles qui manquent.

Le fichier ne transmet au service `api` que les variables qu'il nomme explicitement, de sorte que le reste de `.env` — y compris `NODE_ENV=development` — n'atteint pas le runtime. Le service s'exécute avec `NODE_ENV=production`. Une variable qui n'est pas listée dans le fichier doit être ajoutée dans le bloc `environment:` du service.

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` définissent le premier administrateur. En production, le premier compte à s'inscrire n'est pas promu administrateur ; le runtime crée donc celui-ci au premier démarrage, tant que la table des utilisateurs est vide. Connectez-vous avec ces identifiants et changez le mot de passe. Consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

Ensuite, dans `/opt/my-app/docker-compose.yml`, liez les deux ports publiés à l'interface de bouclage (loopback) :

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Tel qu'il est généré, le fichier publie Postgres et l'API sur toutes les interfaces réseau, ce qui est sans danger sur un ordinateur portable. Sur un serveur public, cela expose la base de données sur Internet, et Docker publiant les ports en contournant `ufw`, une règle de pare-feu ne les bloquera pas. Avec `127.0.0.1`, seuls Caddy et les tunnels SSH peuvent y accéder.

### 5. Démarrer les services

```bash
cd /opt/my-app
docker compose up -d
```

Le premier démarrage crée toutes les tables nécessaires, y compris vos tables, ainsi que leurs politiques de sécurité au niveau des lignes (RLS).

### 6. Terminer le TLS avec Caddy

Remplacez `/etc/caddy/Caddyfile` par :

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy obtient un certificat Let's Encrypt pour le domaine et assure son renouvellement. Ouvrez `https://app.example.com` et connectez-vous.

### Redéployer

Recompilez, copiez le bundle, redémarrez le runtime :

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copier manuellement un répertoire sur une machine convient pour un serveur unique. Au-delà, optez pour l'une des approches qui évitent cette étape :

- **L'intégrer dans une image.** `FROM rebasepro/server:0.30.1`, puis `COPY --chown=node:node dist-bundle /bundle`, et déployez en changeant de tag.
- **Le servir via HTTP.** Définissez `REBASE_BUNDLE_URL` et le runtime récupère et décompresse le bundle à chaque démarrage. Le module Terraform ci-dessous procède ainsi, et le chart Helm utilise le même mécanisme.

## Terraform

Le module `terraform-hcloud-rebase` provisionne le serveur, un pare-feu, une IP stable et — point essentiel — un volume qui héberge les données Postgres, afin que le remplacement de l'hôte ne détruise pas la base de données. Il exécute le runtime publié sous Docker Compose avec Caddy en frontal, et récupère votre bundle depuis une URL.

Le module n'est pas publié sur le registre Terraform. Utilisez-le depuis le dépôt Rebase, épinglé sur une version :

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.30.1"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.30.1" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Un point crucial avant le premier apply : l'enregistrement A pour `domain` doit déjà pointer vers le serveur, sans quoi le challenge Let's Encrypt de Caddy échouera. L'adresse étant créée indépendamment du serveur, vous pouvez d'abord l'obtenir avec `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, configurer le DNS, puis appliquer l'ensemble de la configuration.

Le [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) du module liste l'ensemble des variables.

## Stockage de fichiers

**Les téléversements peuvent rester sur le serveur.** Le fichier Compose du projet les conserve sur un volume nommé, monté sur `/storage`, et définit `FORCE_LOCAL_STORAGE=true`. Ils survivent aux redémarrages et aux redéploiements. Ils ne survivent pas à la perte du serveur, ce à quoi servent les sauvegardes de Hetzner.

Sans ce paramètre, le runtime refuse le stockage local en production. Sur la plupart des plateformes de conteneurs, le système de fichiers est remplacé à chaque déploiement, de sorte qu'un backend local y entraînerait une perte silencieuse de données. Les téléversements renvoient alors une erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce qu'un bucket soit configuré.

Lorsque l'espace d'un disque ne suffit plus, ou si vous déployez un second serveur, déplacez les téléversements vers Hetzner Object Storage. Il est compatible S3 et situé dans les mêmes centres de données. Dans le bloc `environment:` du service `api`, remplacez `STORAGE_PATH` et `FORCE_LOCAL_STORAGE` par :

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

avec les deux clés dans `.env`. Les fichiers déjà présents sur le volume ne se déplacent pas automatiquement : copiez-les vers le bucket en conservant leurs clés.

Le module Terraform propose le même choix via des variables : un bucket S3, ou `force_local_storage = true`, qui conserve les téléversements sur son volume de données. Consultez [Stockage](/docs/backend/storage) pour en savoir plus.

## Ce que le démarrage fait à votre schéma

Lorsque `REBASE_MIGRATE_ON_BOOT` a sa valeur par défaut `ensure`, le runtime provisionne vos tables **et leurs politiques de sécurité au niveau des lignes** au démarrage, de manière additive. Une nouvelle table est active dès le déploiement suivant, sans aucune étape préalable sur le schéma.

En revanche, le démarrage n'effectue délibérément aucune opération destructive : il ne modifie pas le type d'une colonne, ne supprime pas de colonne et n'édite pas d'étiquette d'énumération existante. Un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma par effet de bord.

Une opération nécessite donc toujours [`rebase db push`](/docs/architecture/schema-as-code) : toute modification qui n'est pas purement additive — une colonne renommée, un type restreint, un champ supprimé. Exécutez-la depuis votre copie locale, via un tunnel SSH vers le port de bouclage :

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Vérifiez le SQL affiché par l'exécution à blanc (dry run), puis relancez la commande sans `--dry-run`. `sslmode=disable` est nécessaire car la base de données Compose n'utilise pas TLS ; c'est le tunnel qui chiffre la connexion.

Un port de base de données exposé sur Internet permet de lire les lignes d'un déploiement Rebase en contournant la sécurité au niveau des lignes au lieu de passer par elle. Conservez-le sur la boucle locale (loopback) et utilisez le tunnel.

## Mise à niveau

Modifiez `REBASE_VERSION` dans `.env` et recréez le runtime :

```bash
docker compose pull api && docker compose up -d api
```

Votre bundle reste inchangé.

L'exception concerne la version majeure de Postgres : Postgres refuse de démarrer sur un répertoire de données écrit par une version majeure antérieure, donc cette mise à niveau nécessite un export (dump) et une restauration, jamais une mise à niveau sur place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Prochaines étapes

- [Déploiement](/docs/getting-started/deployment) — la liste de contrôle pour la production, et les règles du premier administrateur communes à toutes les plateformes.
- [Auto-hébergement](/docs/deployment/self-hosting) — le même déploiement sans l'échafaudage initial, avec un pooler de connexions et des processus séparés.
- [Configuration](/docs/getting-started/configuration) — toutes les variables d'environnement lues par le runtime.
