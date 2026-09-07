---
sourceHash: 4c2b6974a271effa
title: Déploiement
sidebar_label: Aperçu
description: Où un projet Rebase peut tourner — Rebase Cloud, votre propre serveur, Kubernetes ou une plateforme de conteneurs managée — et quel guide ouvrir pour chacun.
---

## Ce que vous déployez

Un déploiement Rebase, ce sont deux pièces séparables : l'**image de runtime
publiée** (`rebasepro/server`) et le **bundle** que `rebase build` produit à
partir de votre projet. Il n'y a aucune image applicative à construire, et
mettre Rebase à jour se résume à changer de tag plutôt qu'à reconstruire. Le
même bundle tourne sur un portable avec Docker Compose, sur Rebase Cloud et sur
chacune des plateformes ci-dessous.

S'il s'agit de votre premier déploiement, lisez d'abord le
[guide de déploiement](/docs/getting-started/deployment/) : il décrit ce que le
serveur sert, l'environnement dont il a besoin et comment désigner le premier
administrateur avant le premier démarrage.

## Le faire exploiter pour vous

- **[Rebase Cloud](/docs/deployment/cloud/)** — le même Rebase, exploité pour
  vous : `rebase cloud deploy` depuis votre projet, une base de données par
  projet, sauvegardes et TLS inclus.

## L'exploiter vous-même

- **[Auto-hébergement](/docs/deployment/self-hosting/)** — l'image de runtime
  plus une base Postgres, avec Docker Compose ou sur un simple VPS. Commencez
  ici.
- **[Kubernetes](/docs/deployment/kubernetes/)** — le chart Helm officiel, avec
  un Job de migration qui possède le schéma.
- **[Découpage en plusieurs processus](/docs/deployment/split-processes/)** — un
  bundle en API, couche de fonctions et worker, pour qu'une fonction lourde
  cesse de concurrencer l'API de données.

## Guides par plateforme

Chacun reprend les deux mêmes pièces, reliées au Postgres managé et au runtime
de conteneurs du fournisseur. Tous peuvent rester entièrement dans l'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS et App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL et Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL et Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform ou Docker Compose,
  en Allemagne ou en Finlande.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, en France.
- **[Railway](/docs/deployment/railway/)** — l'image et un Postgres managé, dans
  un même projet.
- **[Fly.io](/docs/deployment/flyio/)** — mondial, ou limité aux régions de l'UE.
