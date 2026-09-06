---
sourceHash: 4c2b6974a271effa
title: Deployment
sidebar_label: Panoramica
description: Dove può girare un progetto Rebase — Rebase Cloud, un tuo server, Kubernetes o una piattaforma di container gestita — e quale guida aprire per ciascuno.
---

## Che cosa si distribuisce

Un deployment di Rebase è fatto di due pezzi separabili: l'**immagine di
runtime pubblicata** (`rebasepro/server`) e il **bundle** che `rebase build`
produce dal tuo progetto. Non c'è nessuna immagine applicativa da costruire, e
aggiornare Rebase è un cambio di tag anziché una ricompilazione. Lo stesso
bundle gira in locale con Docker Compose, su Rebase Cloud e su tutte le
piattaforme elencate sotto.

Se è il tuo primo deployment, leggi prima la
[guida al deployment](/docs/getting-started/deployment/): spiega che cosa serve
il server, di quale ambiente ha bisogno e come nominare il primo amministratore
prima del primo avvio.

## Fallo gestire a noi

- **[Rebase Cloud](/docs/deployment/cloud/)** — lo stesso Rebase, gestito per
  te: `rebase cloud deploy` dal tuo progetto, un database per progetto, backup e
  TLS inclusi.

## Gestiscilo tu

- **[Self-hosting](/docs/deployment/self-hosting/)** — l'immagine di runtime più
  un database Postgres, con Docker Compose o su un semplice VPS. Parti da qui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — il chart Helm ufficiale, con
  un Job di migrazione che possiede lo schema.
- **[Suddivisione in più processi](/docs/deployment/split-processes/)** — un
  bundle come API, livello functions e worker, così una function pesante smette
  di competere con l'API dei dati.

## Guide per piattaforma

Ognuna usa gli stessi due pezzi, collegati al Postgres gestito e al runtime di
container di quel provider. Tutte possono restare interamente nell'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform o Docker Compose,
  in Germania o in Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, in
  Francia.
- **[Railway](/docs/deployment/railway/)** — l'immagine e un Postgres gestito,
  in un unico progetto.
- **[Fly.io](/docs/deployment/flyio/)** — globale, o limitato alle regioni UE.
