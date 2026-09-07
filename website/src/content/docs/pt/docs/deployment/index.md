---
sourceHash: 4c2b6974a271effa
title: Implantação
sidebar_label: Visão geral
description: Onde um projeto Rebase pode ser executado — Rebase Cloud, o seu próprio servidor, Kubernetes ou uma plataforma de contêineres gerenciada — e qual guia abrir para cada caso.
---

## O que você implanta

Uma implantação do Rebase são duas peças separáveis: a **imagem de runtime
publicada** (`rebasepro/server`) e o **bundle** que `rebase build` gera a partir
do seu projeto. Não há nenhuma imagem de aplicação para construir, e atualizar o
Rebase é uma troca de tag em vez de uma reconstrução. O mesmo bundle roda no
notebook com Docker Compose, no Rebase Cloud e em todas as plataformas abaixo.

Se esta é a sua primeira implantação, leia antes o
[guia de implantação](/docs/getting-started/deployment/): ele descreve o que o
servidor serve, de que ambiente ele precisa e como definir o primeiro
administrador antes do primeiro boot.

## Deixe que operem por você

- **[Rebase Cloud](/docs/deployment/cloud/)** — o mesmo Rebase, operado por
  nós: `rebase cloud deploy` a partir do seu projeto, um banco de dados por
  projeto, backups e TLS incluídos.

## Opere você mesmo

- **[Auto-hospedagem](/docs/deployment/self-hosting/)** — a imagem de runtime
  mais um banco Postgres, com Docker Compose ou em um VPS simples. Comece por
  aqui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — o chart Helm oficial, com um
  Job de migração que é dono do esquema.
- **[Dividir em vários processos](/docs/deployment/split-processes/)** — um
  bundle como API, camada de functions e worker, para que uma function pesada
  deixe de competir com a API de dados.

## Guias por plataforma

Cada um deles são as mesmas duas peças, ligadas ao Postgres gerenciado e ao
runtime de contêineres daquele provedor. Todos podem ficar inteiramente na UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform ou Docker Compose,
  na Alemanha ou na Finlândia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, na França.
- **[Railway](/docs/deployment/railway/)** — a imagem e um Postgres gerenciado,
  em um único projeto.
- **[Fly.io](/docs/deployment/flyio/)** — global, ou fixado em regiões da UE.
