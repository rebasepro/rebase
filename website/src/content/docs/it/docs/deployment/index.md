---
sourceHash: 7df4c0efad6c667b
title: Deployment
sidebar_label: Panoramica
description: Dove può essere eseguito un progetto Rebase — Rebase Cloud, il tuo server, Kubernetes o una piattaforma di container gestita — e quale guida consultare per ciascuno.
---

## Cosa distribuisci

Un deployment Rebase è composto da due parti separabili: l'**immagine di runtime pubblicata**
(`rebasepro/server`) e il **bundle** prodotto da `rebase build` a partire dal tuo
progetto. Non c'è alcuna immagine applicativa da creare e l'aggiornamento di Rebase consiste
nel cambio di un tag anziché in una ricompilazione. Lo stesso bundle viene eseguito su un computer portatile con Docker
Compose, su Rebase Cloud e su ciascuna delle piattaforme indicate di seguito.

Se questo è il tuo primo deployment, leggi prima la
[guida al deployment](/docs/getting-started/deployment/): illustra cosa
fornisce il server, l'ambiente di cui ha bisogno e come definire il primo
amministratore prima del primo avvio.

## Eseguilo per me

- **[Rebase Cloud](/docs/deployment/cloud/)** — lo stesso Rebase, gestito per
  te: `rebase cloud deploy` dal tuo progetto, un database per progetto, backup
  e TLS inclusi.
- **[Runtime backend gestito](/docs/deployment/managed-runtime/)** — cosa può fare un
  backend con `runtime: "managed"`: pacchetti, memoria, timeout,
  filesystem, secret, storage e rete in uscita.

## Eseguilo in autonomia

- **[Self-hosting](/docs/deployment/self-hosting/)** — l'immagine di runtime più un
  database Postgres, su Docker Compose o un semplice VPS. Inizia da qui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — il chart Helm ufficiale, con
  un Job di migrazione responsabile dello schema.
- **[Suddivisione in più processi](/docs/deployment/split-processes/)** —
  un unico bundle come API, livello per le funzioni e worker, in modo che una funzione
  pesante non competa più con l'API dei dati.
- **[Esecuzione di più istanze](/docs/deployment/multiple-instances/)** —
  lo stato che ciascun processo mantiene per sé e l'impostazione per condividerlo,
  prima che una seconda replica inizi a ricevere traffico.

## Guide alle piattaforme

Ognuna di queste opzioni è costituita dagli stessi due elementi, collegati al Postgres gestito
e al runtime di container di quel provider. Tutte possono essere mantenute all'interno dell'UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — il file Compose del tuo progetto su
  un unico server, o Terraform, in Germania o Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, in Francia.
- **[Railway](/docs/deployment/railway/)** — l'immagine e un database Postgres gestito,
  in un unico progetto.
- **[Fly.io](/docs/deployment/flyio/)** — globale, o vincolato alle regioni UE.
- **[InstaPods](/docs/deployment/instapods/)** — Node e PostgreSQL in un unico pod,
  upload sul relativo disco, senza Docker.
- **[Hostman](/docs/deployment/hostman/)** — App Platform con Managed
  PostgreSQL, oppure un singolo server cloud.
