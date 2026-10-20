---
sourceHash: 7a718828c0eed5a6
title: Distribuzione
sidebar_label: Panoramica
description: Dove può essere eseguito un progetto Rebase — Rebase Cloud, il tuo server, Kubernetes o una piattaforma di container gestita — e quale guida consultare per ciascuno.
---

## Cosa viene distribuito

Un deployment di Rebase è composto da due parti separabili: l'**immagine di runtime pubblicata** (`rebasepro/server`) e il **bundle** generato da `rebase build` a partire dal tuo progetto. Non c'è alcuna immagine applicativa da compilare e l'aggiornamento di Rebase consiste nel cambiare un tag anziché eseguire una ricompilazione. Lo stesso bundle viene eseguito su un laptop con Docker Compose, su Rebase Cloud e su ciascuna delle piattaforme indicate di seguito.

Se si tratta del tuo primo deployment, leggi prima la [guida al deployment](/docs/getting-started/deployment/): illustra cosa serve il server, l'ambiente di cui necessita e come definire il primo amministratore prima del primo avvio.

## Eseguilo per me

- **[Rebase Cloud](/docs/deployment/cloud/)** — lo stesso Rebase, gestito per te: `rebase cloud deploy` dal tuo progetto, un database per progetto, backup e TLS inclusi.
- **[Runtime di backend gestito](/docs/deployment/managed-runtime/)** — cosa può fare un backend con `runtime: "managed"` in questo contesto: pacchetti, memoria, timeout, file system, segreti, storage e rete in uscita.

## Eseguilo tu stesso

- **[Self-hosting](/docs/deployment/self-hosting/)** — l'immagine di runtime più un database Postgres, su Docker Compose o un semplice VPS. Inizia da qui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — il chart Helm ufficiale, con un Job di migrazione dedicato alla gestione dello schema.
- **[Suddivisione in più processi](/docs/deployment/split-processes/)** — un unico bundle come API, un tier per le funzioni e un worker, in modo che una funzione pesante non entri in competizione con l'API dei dati.
- **[Esecuzione di più istanze](/docs/deployment/multiple-instances/)** — lo stato mantenuto internamente da ciascun processo e l'impostazione per condividerlo, prima che una seconda replica inizi a ricevere traffico.

## Guide alle piattaforme

Ognuna di queste opzioni si basa sugli stessi due elementi, collegati al Postgres gestito e al runtime di container di ciascun provider. Tutte possono essere mantenute all'interno dell'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform o Docker Compose, in Germania o Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, in Francia.
- **[Railway](/docs/deployment/railway/)** — l'immagine e un database Postgres gestito, in un unico progetto.
- **[Fly.io](/docs/deployment/flyio/)** — globale o vincolato alle regioni dell'UE.
