---
sourceHash: 07bac8e87682b53f
title: Déployer Rebase sur Hetzner Cloud
description: Déployez Rebase sur Hetzner Cloud avec Terraform ou Docker Compose, pour d'excellentes performances basées dans l'UE et la souveraineté des données.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapport performances/prix exceptionnel et constitue un choix solide pour les projets nécessitant une souveraineté des données européenne, avec des centres de données à Nuremberg, Falkenstein et Helsinki.

Rien ici n'est spécifique à Hetzner concernant votre projet. Un déploiement Rebase se compose de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, via le [Helm chart](/docs/deployment/kubernetes) et sur un serveur Hetzner. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

## La méthode la plus rapide : Terraform

Le module `terraform-hcloud-rebase` provisionne le serveur, un pare-feu, une IP stable et — le point le plus important — un volume qui héberge les données Postgres, afin que le remplacement de l'hôte ne détruise pas la base de données.

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

Un point important avant le premier apply : l'enregistrement A pour `domain` doit déjà pointer vers le serveur, sinon le challenge Let's Encrypt de Caddy échouera. L'adresse est créée indépendamment du serveur, vous pouvez donc l'obtenir d'abord avec `terraform apply -target=hcloud_primary_ip.ipv4`, configurer le DNS, puis appliquer l'ensemble correctement.

Le reste de cette page décrit le même déploiement effectué manuellement.

## 1. Provisionner un serveur

1. Dans la console Hetzner Cloud, cliquez sur **Add Server**.
2. Choisissez une **Location** — Falkenstein, Nuremberg ou Helsinki pour la résidence des données dans l'UE.
3. Choisissez une **Image** : Ubuntu 24.04.
4. Choisissez un **Type** : `CPX21` (3 vCPU / 4 Go) est une base fonctionnelle, `CX32` (4 vCPU / 8 Go) est confortable pour le runtime et Postgres.
5. Ajoutez un **Volume** pour la base de données. Les données situées sur le disque propre au serveur disparaissent avec le serveur.
6. Ajoutez votre clé SSH et créez-le.

## 2. Installer Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Transférer votre bundle sur le serveur

Il n'y a pas d'image applicative à construire. `rebase build` produit un répertoire `dist-bundle`, et l'image runtime publiée l'exécute :

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Pour un véritable déploiement, privilégiez l'une des deux approches qui n'impliquent pas de copier des fichiers manuellement sur une machine :

- **L'intégrer dans une image** — `FROM rebasepro/server:0.22.0` puis `COPY dist-bundle /bundle`, et déployez en changeant de tag.
- **Le servir via HTTP** — définissez `REBASE_BUNDLE_URL` et le runtime récupère et décompresse le bundle à chaque démarrage. C'est ce que fait le module Terraform ci-dessus, et le même mécanisme qu'utilise le Helm chart.

## 4. Configurer et exécuter

Rebase fournit un fichier Compose conçu exactement pour cela : [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Il s'agit de la recette canonique d'auto-hébergement — Postgres et le runtime, avec votre bundle monté — et cela vaut la peine de la lire plutôt que de simplement la copier, car ses commentaires expliquent chaque choix.

Créez l'environnement attendu :

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` sont nouveaux : sur la 0.17.3, le premier compte à s'enregistrer devient l'administrateur, y compris en production.

Les six sont obligatoires — le fichier Compose les déclare avec `${VAR:?…}` et refuse l'interpolation sans elles.

Les deux dernières correspondent au premier administrateur. Une base de données vierge n'a pas d'utilisateurs, et hors production, la première inscription est promue administrateur — ce qui devient une course contre la montre dès lors que la machine répond sur un nom d'hôte, car Caddy active TLS avant même que vous n'ayez pu saisir quoi que ce soit. En production, cette brèche est donc fermée et le compte est défini ici à la place ; le runtime le crée une seule fois, tant que la table des utilisateurs est vide, et ne fait plus rien lors des démarrages ultérieurs. Connectez-vous et modifiez le mot de passe.

Ensuite, lancez l'ensemble :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Le runtime écoute sur le port 8080 à l'intérieur du réseau Compose.

`REBASE_SERVICE_KEY` contourne la sécurité au niveau des lignes (row-level security). Considérez-le comme un identifiant de superutilisateur de base de données, et non comme une clé d'API.

## 5. Terminer le TLS avec Caddy

N'exposez jamais le runtime directement. Caddy provisionne automatiquement les certificats Let's Encrypt ; l'exécuter en tant qu'autre service Compose permet de conserver l'ensemble de la pile dans un seul fichier :

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Avec un `Caddyfile` comme suit :

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Faites pointer l'enregistrement A de ce domaine vers le serveur avant de démarrer Caddy, sinon la demande de certificat échouera.

## Le stockage n'est pas facultatif

Le runtime **refuse de démarrer en production** si le stockage local est configuré, car le système de fichiers du conteneur est détruit à chaque redémarrage et un backend local en production équivaut à une perte silencieuse de données.

Hetzner Object Storage est compatible S3 et réside dans les mêmes centres de données, ce qui en fait l'association naturelle :

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si votre projet ne stocke aucun fichier téléversé, définissez `FORCE_LOCAL_STORAGE=true` pour le spécifier explicitement. Consultez [Storage](/docs/backend/storage) pour une vue d'ensemble complète.

## Ce que le démarrage fait à votre schéma

Avec `REBASE_MIGRATE_ON_BOOT` à sa valeur par défaut `ensure`, le runtime provisionne vos tables de collections **et leurs politiques de sécurité au niveau des lignes** au démarrage, de manière additive. Un premier démarrage sur une base de données vide la rend opérationnelle immédiatement — aucune étape de schéma n'est nécessaire avant que le déploiement ne fonctionne.

Ce que le démarrage ne fait délibérément jamais, c'est quoi que ce soit de destructif : il ne modifie pas le type d'une colonne, ne supprime aucune colonne et n'édite aucun libellé d'enum existant. Un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma par effet secondaire.

Deux opérations nécessitent donc toujours [`rebase db push`](/docs/architecture/schema-as-code), exécuté depuis une copie de travail locale ou un pipeline CI où la validation des changements destructifs et une sauvegarde sont à portée de main :

- les politiques RLS des tables de jonction pour les relations plusieurs-à-plusieurs ;
- toute modification qui n'est pas purement additive.

Si le module ou le fichier Compose lie Postgres à l'interface de bouclage (loopback) — ce que font les deux —, accédez-y via un tunnel SSH :

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Un port de base de données ouvert sur Internet est le moyen par lequel un déploiement Rebase voit ses lignes lues en contournant la sécurité au niveau des lignes plutôt qu'au travers de celle-ci.

## Mise à niveau

Changez le tag de l'image et redémarrez. Votre bundle reste intact, et chaque projet sur ce runtime bénéficie du nouveau moteur.

L'exception concerne la version majeure de Postgres : Postgres refuse de démarrer avec un répertoire de données écrit par une version majeure antérieure. Cette mise à niveau se fait donc par dump et restauration, jamais sur place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```
