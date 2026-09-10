---
sourceHash: 39e0a58a37e930cb
title: Déployer Rebase sur Hetzner Cloud
description: Déployez Rebase sur Hetzner Cloud avec Terraform ou Docker Compose, pour d'excellentes performances basées dans l'UE et la souveraineté des données.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapport performance-prix particulièrement avantageux et constitue un choix solide pour les projets nécessitant une souveraineté des données européenne, avec des centres de données à Nuremberg, Falkenstein et Helsinki.

Rien ici n'est spécifique à Hetzner concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image de runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, avec le [Helm chart](/docs/deployment/kubernetes) et sur une machine Hetzner. Passer de l'un à l'autre relève d'un changement d'infrastructure, non d'application.

## La voie la plus rapide : Terraform

Le module `terraform-hcloud-rebase` provisionne le serveur, un pare-feu, une adresse IP stable et — ce qui importe le plus — un volume stockant les données Postgres, afin que le remplacement de l'hôte ne détruise pas la base de données.

```hcl
module "rebase" {
  source = "rebasepro/rebase/hcloud"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]

  bundle_url = "https://storage.example.com/bundles/app-1.4.0.tar.gz"

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Un point crucial à vérifier avant la première exécution (`apply`) : l'enregistrement A pour `domain` doit déjà pointer vers le serveur, sinon le challenge Let's Encrypt de Caddy échouera. L'adresse étant créée indépendamment du serveur, vous pouvez d'abord l'obtenir avec `terraform apply -target=hcloud_primary_ip.ipv4`, configurer le DNS, puis exécuter l'apply complet.

Le reste de cette page décrit le même déploiement effectué manuellement.

## 1. Provisionner un serveur

1. Dans la console Hetzner Cloud, cliquez sur **Add Server**.
2. Choisissez un emplacement (**Location**) — Falkenstein, Nuremberg ou Helsinki pour la résidence des données dans l'UE.
3. Choisissez une image (**Image**) : Ubuntu 24.04.
4. Choisissez un type (**Type**) : `CPX21` (3 vCPU / 4 Go) est un minimum viable, `CX32` (4 vCPU / 8 Go) est confortable pour le runtime ainsi que Postgres.
5. Ajoutez un volume (**Volume**) pour la base de données. Les données situées sur le disque propre du serveur disparaissent avec celui-ci.
6. Ajoutez votre clé SSH et créez le serveur.

## 2. Installer Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Déployer votre bundle sur le serveur

Il n'y a aucune image applicative à construire. `rebase build` génère un répertoire `dist-bundle`, et l'image de runtime publiée l'exécute :

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Pour un déploiement en production, privilégiez l'une des deux approches évitant la copie manuelle de fichiers vers une machine :

- **L'intégrer dans une image** — `FROM rebasepro/server:0.20.0` puis `COPY dist-bundle /bundle`, et déployer en modifiant un tag.
- **Le servir via HTTP** — définissez `REBASE_BUNDLE_URL` pour que le runtime télécharge et décompresse le bundle à chaque démarrage. C'est ce que fait le module Terraform ci-dessus, et c'est le même mécanisme qu'utilise le Helm chart.

## 4. Configurer et exécuter

Rebase fournit un fichier Compose conçu exactement pour cela : [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Il s'agit de la recette canonique d'auto-hébergement — Postgres et le runtime, avec votre bundle monté — et il est recommandé de le lire attentivement plutôt que de simplement le copier, car ses commentaires détaillent chaque choix.

Créez l'environnement attendu :

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` sont récents : sur la version 0.17.3,
le premier compte enregistré devient l'administrateur, y compris en production.

Ces six variables sont requises — le fichier Compose les déclare avec `${VAR:?…}` et
refuse de s'exécuter sans elles.

Les deux dernières correspondent au premier administrateur. Une base de données vierge n'a aucun utilisateur, et
hors production, la première inscription est promue administratrice — ce qui crée une condition de concurrence
dès l'instant où la machine répond sur un nom d'hôte, car Caddy active TLS avant même que vous n'ayez
pu saisir quoi que ce soit. En production, cette opportunité est donc verrouillée et le compte est défini
ici ; le runtime le crée une seule fois, pendant que la table des utilisateurs est vide, et
ne fait plus rien lors des démarrages suivants. Connectez-vous et modifiez le mot de passe.

Démarrez ensuite l'ensemble :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Le runtime écoute sur le port 8080 au sein du réseau Compose.

`REBASE_SERVICE_KEY` contourne la sécurité au niveau des lignes (row-level security). Considérez-le comme un identifiant de superutilisateur de base de données, et non comme une simple clé d'API.

## 5. Terminaison TLS avec Caddy

N'exposez jamais le runtime directement. Caddy provisionne automatiquement les certificats Let's Encrypt ; l'exécuter en tant qu'autre service Compose permet de conserver toute la pile dans un seul fichier :

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Avec le `Caddyfile` suivant :

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Faites pointer l'enregistrement A de ce domaine vers le serveur avant de démarrer Caddy, faute de quoi la demande de certificat échouera.

## Le stockage n'est pas optionnel

Le runtime **refuse de démarrer en production** avec un stockage local configuré, car le système de fichiers du conteneur est détruit à chaque redémarrage et un backend local en production entraîne une perte de données silencieuse.

Hetzner Object Storage est compatible S3 et hébergé dans les mêmes centres de données, ce qui en fait le complément idéal :

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si votre projet ne stocke aucun fichier téléversé, définissez `FORCE_LOCAL_STORAGE=true` pour l'indiquer explicitement. Consultez [Storage](/docs/backend/storage) pour une vue d'ensemble.

## Ce que le démarrage fait à votre schéma

Avec `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut `ensure`, le runtime provisionne vos tables de collections **ainsi que leurs politiques de sécurité au niveau des lignes (RLS)** au démarrage, de manière incrémentale. Un premier démarrage sur une base de données vide est immédiatement opérationnel — aucune étape de schéma n'est requise avant que le déploiement ne fonctionne.

En revanche, le démarrage n'effectue délibérément aucune opération destructive : il ne modifie pas le type d'une colonne, ne supprime aucune colonne et n'édite pas de valeur d'enum existante. Un redémarrage de conteneur ne doit jamais altérer un schéma comme effet secondaire.

Deux éléments nécessitent donc toujours [`rebase db push`](/docs/architecture/schema-as-code), exécuté depuis un checkout local ou une CI où le contrôle des changements destructifs et une sauvegarde sont à portée de main :

- les politiques RLS des tables de jonction pour les relations plusieurs-à-plusieurs ;
- toute modification qui n'est pas purement additive.

Si le module ou le fichier Compose a lié Postgres à l'interface de bouclage (loopback) — ce que font les deux —, accédez-y via un tunnel SSH :

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Un port de base de données ouvert sur Internet permettrait la lecture directe des lignes sans passer par la sécurité au niveau des lignes.

## Mise à niveau

Modifiez le tag de l'image et redémarrez. Votre bundle reste intact, et chaque projet sur ce runtime bénéficie du nouveau moteur.

L'exception concerne les versions majeures de Postgres : Postgres refuse de démarrer avec un répertoire de données écrit par une version majeure antérieure, de sorte que cette mise à niveau nécessite un export/import (dump et restore), et ne peut jamais être effectuée sur place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
