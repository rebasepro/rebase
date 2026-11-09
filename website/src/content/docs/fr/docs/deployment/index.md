---
sourceHash: 7df4c0efad6c667b
title: Déploiement
sidebar_label: Vue d'ensemble
description: Où un projet Rebase peut s'exécuter — Rebase Cloud, votre propre serveur, Kubernetes ou une plateforme de conteneurs managée — et quel guide consulter pour chacun d'entre eux.
---

## Ce que vous déployez

Un déploiement Rebase se compose de deux éléments distincts : l'**image de runtime publiée** (`rebasepro/server`) et le **bundle** que `rebase build` génère à partir de votre projet. Il n'y a aucune image applicative à construire, et mettre à niveau Rebase consiste simplement à changer un tag plutôt qu'à tout recompiler. Le même bundle s'exécute sur un ordinateur portable avec Docker Compose, sur Rebase Cloud et sur chacune des plateformes ci-dessous.

S'il s'agit de votre premier déploiement, lisez d'abord le [guide de déploiement](/docs/getting-started/deployment/) : il détaille ce que le serveur fournit, l'environnement dont il a besoin et la manière de désigner le premier administrateur avant le premier démarrage.

## Géré pour vous

- **[Rebase Cloud](/docs/deployment/cloud/)** — le même Rebase, exploité pour vous : `rebase cloud deploy` depuis votre projet, une base de données par projet, sauvegardes et TLS inclus.
- **[Runtime backend managé](/docs/deployment/managed-runtime/)** — ce qu'un backend avec `runtime: "managed"` peut y faire : paquets, mémoire, délais d'expiration, système de fichiers, secrets, stockage et réseau sortant.

## Gérez-le vous-même

- **[Auto-hébergement](/docs/deployment/self-hosting/)** — l'image de runtime avec une base de données Postgres, sur Docker Compose ou un simple VPS. Commencez ici.
- **[Kubernetes](/docs/deployment/kubernetes/)** — le chart Helm officiel, avec un Job de migration qui gère le schéma.
- **[Séparation en plusieurs processus](/docs/deployment/split-processes/)** — un bundle réparti en API, couche de fonctions et worker, afin qu'une fonction lourde n'entre plus en concurrence avec l'API de données.
- **[Exécution de plusieurs instances](/docs/deployment/multiple-instances/)** — l'état que chaque processus conserve en local, et le paramètre permettant de le partager, avant qu'un second réplica ne reçoive du trafic.

## Guides par plateforme

Chacun d'entre eux repose sur les deux mêmes éléments, connectés au service Postgres managé et au runtime de conteneurs du fournisseur concerné. Tous peuvent être hébergés au sein de l'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS et App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL et Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for PostgreSQL et Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — le fichier Compose de votre projet sur un serveur unique, ou Terraform, en Allemagne ou en Finlande.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, en France.
- **[Railway](/docs/deployment/railway/)** — l'image et une base Postgres managée, au sein d'un même projet.
- **[Fly.io](/docs/deployment/flyio/)** — mondial, ou restreint aux régions de l'UE.
- **[InstaPods](/docs/deployment/instapods/)** — Node et PostgreSQL dans un seul pod, téléversements sur son disque, sans Docker.
- **[Hostman](/docs/deployment/hostman/)** — App Platform avec Managed PostgreSQL, ou un serveur cloud unique.
