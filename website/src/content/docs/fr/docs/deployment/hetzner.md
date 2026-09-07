---
sourceHash: 5f8b43fabd10eb86
title: Déploiement de Rebase sur Hetzner Cloud
description: Déployez Rebase sur Hetzner Cloud avec Terraform ou Docker Compose, pour d'excellentes performances européennes et une souveraineté des données.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapport performance-prix remarquable et constitue un choix solide pour les projets exigeant une souveraineté des données européenne, avec des datacenters à Nuremberg, Falkenstein et Helsinki.

Rien ici n'est spécifique à Hetzner du côté de votre projet. Un déploiement Rebase se compose de deux parties séparables — l'image runtime publiée et le **bundle** produit par `rebase build` — et le même bundle s'exécute sous Docker Compose sur un portable, sur Rebase Cloud, sous le [chart Helm](/docs/deployment/kubernetes) et sur une machine Hetzner. Passer de l'un à l'autre change l'infrastructure, pas l'application.

## La voie la plus rapide : Terraform

Le module `terraform-hcloud-rebase` provisionne le serveur, un pare-feu, une IP stable et — le point essentiel — un volume qui contient les données Postgres, de sorte que remplacer l'hôte ne détruit pas la base.

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

Une chose doit être correcte avant le premier apply : l'enregistrement A de `domain` doit déjà pointer vers le serveur, sinon le challenge Let's Encrypt de Caddy échoue. L'adresse est créée indépendamment du serveur, vous pouvez donc l'obtenir d'abord avec `terraform apply -target=hcloud_primary_ip.ipv4`, définir le DNS, puis appliquer normalement.

Le reste de cette page décrit le même déploiement à la main.

## 1. Créer un serveur

1. Dans la console Hetzner Cloud, cliquez sur **Add Server**.
2. Choisissez un **emplacement** — Falkenstein, Nuremberg ou Helsinki pour une résidence des données dans l'UE.
3. Choisissez une **image** : Ubuntu 24.04.
4. Choisissez un **type** : `CPX21` (3 vCPU / 4 Go) est le plancher praticable, `CX32` (4 vCPU / 8 Go) est confortable pour le runtime et Postgres.
5. Ajoutez un **volume** pour la base de données. Les données sur le disque du serveur disparaissent avec le serveur.
6. Ajoutez votre clé SSH et créez-le.

## 2. Installer Docker

```bash
ssh root@<ip-de-votre-serveur>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Amener votre bundle sur le serveur

Il n'y a aucune image applicative à construire. `rebase build` produit un répertoire `dist-bundle`, et l'image runtime publiée l'exécute :

```bash
rebase build
rsync -a dist-bundle/ root@<ip-de-votre-serveur>:/opt/rebase/dist-bundle/
```

Pour un déploiement réel, préférez l'une des deux formes qui n'impliquent pas de copier des fichiers à la main :

- **L'intégrer à une image** — `FROM rebasepro/server:0.17.3` puis `COPY dist-bundle /bundle` ; déployer devient un changement de tag.
- **La servir en HTTP** — définissez `REBASE_BUNDLE_URL` et le runtime récupère et décompresse le bundle à chaque démarrage. C'est ce que fait le module Terraform ci-dessus, et le mécanisme qu'utilise le chart Helm.

## 4. Configurer et lancer

Rebase fournit un fichier Compose exactement pour cela : [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). C'est la recette d'auto-hébergement canonique — Postgres et le runtime, avec votre bundle monté — et il vaut mieux la lire que la copier, car ses commentaires expliquent chaque choix.

Créez l'environnement qu'il attend :

```env
POSTGRES_PASSWORD=une_longue_chaine_aleatoire
JWT_SECRET=une_autre_longue_chaine_d_au_moins_32_caracteres
REBASE_SERVICE_KEY=une_troisieme_longue_chaine_d_au_moins_32_caracteres
CORS_ORIGINS=https://app.votredomaine.com
```

Puis démarrez :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Le runtime écoute sur le port 8080 à l'intérieur du réseau Compose.

`REBASE_SERVICE_KEY` contourne la sécurité au niveau des lignes. Traitez-la comme un identifiant superutilisateur de base de données, pas comme une clé d'API.

## 5. Terminer le TLS avec Caddy

N'exposez jamais le runtime directement. Caddy provisionne les certificats Let's Encrypt automatiquement ; le lancer comme un autre service Compose garde toute la pile dans un seul fichier :

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Avec un `Caddyfile` de :

```caddyfile
api.votredomaine.com {
    reverse_proxy api:8080
}
```

Faites pointer l'enregistrement A de ce domaine vers le serveur avant de démarrer Caddy, sinon la demande de certificat échoue.

## Le stockage n'est pas optionnel

Le runtime **refuse de démarrer en production** avec un stockage local configuré : le système de fichiers du conteneur est détruit à chaque redémarrage, et un backend local en production est une perte de données silencieuse.

Hetzner Object Storage est compatible S3 et se trouve dans les mêmes datacenters, c'est donc l'association naturelle :

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si votre projet ne stocke aucun fichier, définissez `FORCE_LOCAL_STORAGE=true` pour le reconnaître explicitement. Voir [Stockage](/docs/backend/storage) pour le tableau complet.

## Ce que le démarrage fait à votre schéma

Avec `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut `ensure`, le runtime provisionne vos tables de collections **et leurs politiques de sécurité au niveau des lignes** au démarrage, de façon additive. Un premier démarrage sur une base vide les sert déjà — il n'y a aucune étape de schéma à exécuter avant que le déploiement fonctionne.

Ce que le démarrage ne fait délibérément jamais, c'est du destructif : il ne modifie pas un type de colonne, ne supprime pas de colonne et ne change pas un label d'enum existant. Un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma par effet de bord.

Deux choses nécessitent donc toujours [`rebase db push`](/docs/architecture/schema-as-code), exécuté depuis un checkout ou depuis la CI, où le garde-fou des changements destructifs et une sauvegarde sont à portée :

- la RLS des tables de jonction pour les relations plusieurs-à-plusieurs ;
- tout changement qui n'est pas purement additif.

Si le module ou le fichier Compose a lié Postgres à la boucle locale — les deux le font — atteignez-le par un tunnel SSH :

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<ip-de-votre-serveur>
```

Un port de base de données ouvert sur Internet est la façon dont les lignes d'un déploiement Rebase finissent lues en contournant la sécurité au niveau des lignes plutôt qu'à travers elle.

## Mise à jour

Changez le tag de l'image et redémarrez. Votre bundle reste intact, et tout projet sur ce runtime récupère le nouveau moteur.

L'exception est la version majeure de Postgres : Postgres refuse de démarrer sur un répertoire de données écrit par une version majeure antérieure, cette mise à niveau est donc toujours un dump et un restore, jamais en place.

```bash
rebase db backup --out ./backups
# recréer le volume sur la nouvelle version majeure
rebase db restore ./backups/<fichier>.dump
```
