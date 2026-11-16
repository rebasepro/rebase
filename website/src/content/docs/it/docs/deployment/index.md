---
sourceHash: 70d7eb76c5784603
title: Deployment
sidebar_label: Panoramica
description: Dove può essere eseguito un progetto Rebase — Rebase Cloud, il tuo server, Kubernetes o una piattaforma di container gestita — e quale guida consultare per ciascuno.
---

## Cosa distribuisci

Un deployment di Rebase è costituito da due parti separabili: l'**immagine di runtime pubblicata**
(`rebasepro/server`) e il **bundle** generato da `rebase build` a partire dal tuo
progetto. Non c'è alcuna immagine applicativa da creare e l'aggiornamento di Rebase consiste
nel modificare un tag anziché eseguire una ricompilazione. Lo stesso bundle viene eseguito su un laptop
con Docker Compose, su Rebase Cloud e su ciascuna delle piattaforme indicate di seguito.

Se questo è il tuo primo deployment, leggi prima la
[guida al deployment](/docs/getting-started/deployment/): illustra cosa eroga
il server, l'ambiente di cui necessita e come nominare il primo
amministratore prima del primo avvio.

## Gestito per te

- **[Rebase Cloud](/docs/deployment/cloud/)** — lo stesso Rebase, gestito per
  te: `rebase cloud deploy` dal tuo progetto, un database per progetto, backup
  e TLS inclusi.
- **[Runtime backend gestito](/docs/deployment/managed-runtime/)** — cosa può fare un
  backend con `runtime: "managed"` in questo ambiente: pacchetti, memoria, timeout,
  file system, secret, storage e rete in uscita.

## Eseguilo tu stesso

- **[Self-hosting](/docs/deployment/self-hosting/)** — l'immagine di runtime più un
  database Postgres, su Docker Compose o su un semplice VPS. Inizia da qui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — il chart Helm ufficiale, con
  un Job di migrazione dedicato alla gestione dello schema.
- **[Suddivisione in più processi](/docs/deployment/split-processes/)** —
  un unico bundle distribuito come API, livello funzioni e worker, in modo che
  una funzione pesante non competa più con le API dei dati.
- **[Esecuzione di più istanze](/docs/deployment/multiple-instances/)** —
  lo stato che ciascun processo mantiene per sé e l'impostazione per condividerlo,
  prima che una seconda replica inizi a gestire il traffico.

## Guide alle piattaforme

Ciascuna di queste soluzioni utilizza gli stessi due elementi, collegati al Postgres gestito
e al runtime per container del rispettivo provider. Tutte possono essere mantenute all'interno dell'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — il file Compose del tuo progetto su
  un unico server, oppure con Terraform, in Germania o Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, in Francia.
- **[Railway](/docs/deployment/railway/)** — l'immagine e un database Postgres gestito,
  in un unico progetto.
- **[Fly.io](/docs/deployment/flyio/)** — globale o vincolato alle regioni UE.
- **[InstaPods](/docs/deployment/instapods/)** — Node e PostgreSQL in un unico pod,
  upload sul proprio disco, senza Docker.
- **[Hostman](/docs/deployment/hostman/)** — App Platform con PostgreSQL
  gestito, oppure un singolo server cloud.
- **[Out Plane](/docs/deployment/outplane/)** — un'app dal tuo repository,
  PostgreSQL gestito e un bucket, in Germania.
