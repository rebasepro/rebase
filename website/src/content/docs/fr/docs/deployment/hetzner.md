---
sourceHash: 8861ca94a0de827a
title: Déployer Rebase sur Hetzner Cloud
description: Déployez Rebase sur Hetzner Cloud avec Terraform ou Docker Compose, pour d'excellentes performances et la souveraineté des données dans l'UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapport performances/prix exceptionnel et constitue un choix solide pour les projets nécessitant la souveraineté des données européennes, avec des centres de données à Nuremberg, Falkenstein et Helsinki.

Rien ici n'est spécifique à Hetzner concernant votre projet. Un déploiement Rebase est constitué de deux éléments distincts — l'image runtime publiée, et le **bundle** produit par `rebase build` — et ce même bundle s'exécute sous Docker Compose sur un ordinateur portable, sur Rebase Cloud, via le [chart Helm](/docs/deployment/kubernetes) ou sur une machine Hetzner. Passer de l'un à l'autre est un changement d'infrastructure, pas d'application.

## La méthode la plus rapide : Terraform

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

Un point important à régler avant le premier apply : l'enregistrement A pour `domain` doit déjà pointer vers le serveur, sinon le challenge Let's Encrypt de Caddy échouera. L'adresse est créée indépendamment du serveur, vous pouvez donc l'obtenir d'abord avec `terraform apply -target=hcloud_primary_ip.ipv4`, configurer le DNS, puis appliquer l'ensemble correctement.

Le reste de cette page détaille le même déploiement effectué manuellement.

## 1. Provisionner un serveur

1. Dans la console Hetzner Cloud, cliquez sur **Add Server**.
2. Choisissez un emplacement (**Location**) — Falkenstein, Nuremberg ou Helsinki pour la résidence des données dans l'UE.
3. Choisissez une image (**Image**) : Ubuntu 24.04.
4. Choisissez un type (**Type**) : `CPX21` (3 vCPU / 4 Go) est un minimum viable, `CX32` (4 vCPU / 8 Go) est confortable pour le runtime et Postgres.
5. Ajoutez un volume (**Volume**) pour la base de données. Les données situées sur le disque propre au serveur disparaissent avec lui.
6. Ajoutez votre clé SSH et créez le serveur.

## 2. Installer Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Transférer votre bundle sur le serveur

Il n'y a aucune image applicative à construire. `rebase build` génère un répertoire `dist-bundle`, et l'image runtime publiée l'exécute :

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Pour un déploiement réel, privilégiez l'une des deux approches évitant de copier manuellement les fichiers sur une machine :

- **L'intégrer dans une image** — `FROM rebasepro/server:0.19.1` puis `COPY dist-bundle /bundle`, et déployez en changeant simplement de tag.
- **Le servir via HTTP** — définissez `REBASE_BUNDLE_URL` pour que le runtime télécharge et décompresse le bundle à chaque démarrage. C'est ce que fait le module Terraform ci-dessus, et c'est le même mécanisme qu'utilise le chart Helm.

## 4. Configurer et exécuter

Rebase fournit un fichier Compose prévu exactement pour cela : [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Il s'agit de la recette canonique pour l'auto-hébergement — Postgres et le runtime, avec votre bundle monté — et il est recommandé de le lire plutôt que de simplement le copier, car ses commentaires expliquent chaque choix.

Créez l'environnement attendu :

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` sont nouveaux : sur la version 0.17.3, le premier compte à s'inscrire devenait administrateur, y compris en production.

Les six variables sont requises — le fichier Compose les déclare avec `${VAR:?…}` et refuse l'interpolation si elles sont absentes.

Les deux dernières définissent le premier administrateur. Une base de données vierge n'a pas d'utilisateurs, et hors production, la première inscription est promue administratrice — ce qui devient une course critique dès que cette machine répond sur un nom d'hôte, car Caddy active TLS avant même que vous n'ayez saisi quoi que ce soit. En production, cette fenêtre de vulnérabilité est donc fermée et le compte est défini ici ; le runtime le crée une seule fois, tant que la table des utilisateurs est vide, et n'effectue aucune action lors des démarrages ultérieurs. Connectez-vous et modifiez le mot de passe.

Lancez ensuite l'ensemble :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Le runtime écoute sur le port 8080 à l'intérieur du réseau Compose.

`REBASE_SERVICE_KEY` contourne la sécurité au niveau des lignes (row-level security). Considérez-le comme un identifiant de superutilisateur de base de données, et non comme une clé d'API.

## 5. Terminer TLS avec Caddy

N'exposez jamais le runtime directement. Caddy provisionne automatiquement les certificats Let's Encrypt ; l'exécuter en tant que service Compose supplémentaire permet de conserver l'ensemble de la pile dans un seul fichier :

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Avec un `Caddyfile` tel que :

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Faites pointer l'enregistrement A de ce domaine vers le serveur avant de démarrer Caddy, sinon la demande de certificat échouera.

## Le stockage n'est pas optionnel

Le runtime **refuse de démarrer en production** si un stockage local est configuré, car le système de fichiers du conteneur est détruit à chaque redémarrage et un backend local en production équivaut à une perte silencieuse de données.

Hetzner Object Storage est compatible S3 et réside dans les mêmes centres de données, ce qui en fait le complément naturel :

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si votre projet ne stocke aucun fichier téléversé, définissez `FORCE_LOCAL_STORAGE=true` pour le confirmer explicitement. Consultez [Storage](/docs/backend/storage) pour une vue d'ensemble.

## Ce que le démarrage fait à votre schéma

Avec `REBASE_MIGRATE_ON_BOOT` défini sur sa valeur par défaut `ensure`, le runtime provisionne vos tables de collections **ainsi que leurs stratégies de sécurité au niveau des lignes (RLS)** au démarrage, de façon additive. Dès son premier démarrage sur une base de données vide, il est prêt à les servir — aucune étape préalable de schéma n'est requise pour que le déploiement fonctionne.

Ce que le démarrage ne fait délibérément jamais, c'est toute opération destructive : il ne modifie pas le type d'une colonne, ne supprime pas de colonne et n'édite pas les valeurs d'une énumération existante. Un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma par effet de bord.

Deux cas nécessitent donc toujours l'exécution de [`rebase db push`](/docs/architecture/schema-as-code), lancé depuis un clone local ou un pipeline CI où la validation des changements destructifs et une sauvegarde sont à portée de main :

- le RLS pour les tables de jointure des relations many-to-many ;
- toute modification qui n'est pas purement additive.

Si le module ou le fichier Compose lie Postgres à l'interface de bouclage (loopback) — ce que font les deux —, accédez-y via un tunnel SSH :

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Un port de base de données exposé à Internet permettrait de lire les lignes d'un déploiement Rebase en contournant la sécurité au niveau des lignes au lieu de passer par elle.

## Mise à niveau

Modifiez le tag de l'image et redémarrez. Votre bundle reste intact, et chaque projet sur ce runtime bénéficie du nouveau moteur.

L'exception concerne les versions majeures de Postgres : Postgres refuse de démarrer avec un répertoire de données écrit par une version majeure antérieure. Cette mise à niveau nécessite donc un dump et une restauration, jamais une mise à jour sur place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
