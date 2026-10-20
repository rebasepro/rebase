---
sourceHash: 7a718828c0eed5a6
title: Déploiement
sidebar_label: Vue d'ensemble
description: Où un projet Rebase peut s'exécuter — Rebase Cloud, votre propre serveur, Kubernetes ou une plateforme de conteneurs managée — et quel guide consulter pour chacun.
---

## Ce que vous déployez

Un déploiement Rebase se compose de deux éléments distincts : l'**image d'exécution publiée**
(`rebasepro/server`) et le **bundle** produit par `rebase build` à partir de votre
projet. Il n'y a aucune image d'application à compiler, et mettre à niveau Rebase consiste
simplement à changer un tag plutôt qu'à recompiler. Le même bundle s'exécute sur un
ordinateur portable sous Docker Compose, sur Rebase Cloud et sur chacune des plateformes
ci-dessous.

S'il s'agit de votre premier déploiement, lisez d'abord le
[guide de déploiement](/docs/getting-started/deployment/) : il détaille ce que le
serveur fournit, l'environnement dont il a besoin et la manière de désigner le premier
administrateur avant le premier démarrage.

## Géré pour vous

- **[Rebase Cloud](/docs/deployment/cloud/)** — le même Rebase, opéré pour
  vous : `rebase cloud deploy` depuis votre projet, une base de données par projet,
  sauvegardes et TLS inclus.
- **[Runtime backend managé](/docs/deployment/managed-runtime/)** — ce qu'un
  backend avec `runtime: "managed"` peut y faire : paquets, mémoire, timeouts,
  système de fichiers, secrets, stockage et réseau sortant.

## Exécutez-le vous-même

- **[Auto-hébergement](/docs/deployment/self-hosting/)** — l'image d'exécution plus une
  base de données Postgres, sur Docker Compose ou un simple VPS. Commencez ici.
- **[Kubernetes](/docs/deployment/kubernetes/)** — le chart Helm officiel, avec
  un Job de migration qui gère le schéma.
- **[Séparation en plusieurs processus](/docs/deployment/split-processes/)** —
  un bundle sous forme d'API, d'une couche de fonctions et d'un worker, afin qu'une fonction
  lourde ne vienne plus concurrencer l'API de données.
- **[Exécuter plusieurs instances](/docs/deployment/multiple-instances/)** —
  l'état que chaque processus conserve pour lui-même, et le paramètre qui le partage,
  avant qu'un second réplica ne reçoive du trafic.

## Guides par plateforme

Chacun d'entre eux repose sur les deux mêmes éléments, connectés au service Postgres
managé et au runtime de conteneurs de ce fournisseur. Tous peuvent être hébergés
au sein de l'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS et App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL et Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL et Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform ou Docker Compose,
  en Allemagne ou en Finlande.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, en France.
- **[Railway](/docs/deployment/railway/)** — l'image et une base Postgres managée,
  dans un seul projet.
- **[Fly.io](/docs/deployment/flyio/)** — mondial, ou limité aux régions de l'UE.
