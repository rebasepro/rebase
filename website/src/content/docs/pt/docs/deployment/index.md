---
sourceHash: 7a718828c0eed5a6
title: Implantação
sidebar_label: Visão geral
description: Onde um projeto Rebase pode ser executado — Rebase Cloud, seu próprio servidor, Kubernetes ou uma plataforma gerenciada de contêineres — e qual guia abrir para cada um.
---

## O que você implanta

Uma implantação do Rebase é composta por duas partes separáveis: a **imagem de runtime publicada**
(`rebasepro/server`) e o **bundle** que o `rebase build` gera a partir do seu
projeto. Não há imagem de aplicativo para compilar, e atualizar o Rebase é uma mudança
de tag em vez de uma recompilação. O mesmo bundle roda em um laptop com Docker
Compose, no Rebase Cloud e em todas as plataformas abaixo.

Se esta for a sua primeira implantação, leia o
[guia de implantação](/docs/getting-started/deployment/) primeiro: ele aborda o que o
servidor disponibiliza, o ambiente de que precisa e como definir o primeiro
administrador antes da primeira inicialização.

## Execute para mim

- **[Rebase Cloud](/docs/deployment/cloud/)** — o mesmo Rebase, operado para
  você: `rebase cloud deploy` a partir do seu projeto, um banco de dados por projeto, backups
  e TLS inclusos.
- **[Runtime de backend gerenciado](/docs/deployment/managed-runtime/)** — o que um
  backend com `runtime: "managed"` pode fazer lá: pacotes, memória, timeouts,
  o sistema de arquivos, segredos, armazenamento e rede de saída.

## Execute você mesmo

- **[Auto-hospedagem](/docs/deployment/self-hosting/)** — a imagem de runtime mais um
  banco de dados Postgres, no Docker Compose ou em uma VPS simples. Comece por aqui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — o Helm chart oficial, com
  um Job de migração que gerencia o schema.
- **[Divisão em vários processos](/docs/deployment/split-processes/)** —
  um bundle como uma API, uma camada de funções e um worker, para que uma função
  pesada deixe de competir com a API de dados.
- **[Executando mais de uma instância](/docs/deployment/multiple-instances/)** —
  o estado que cada processo mantém isolado e a configuração que o compartilha,
  antes que uma segunda réplica receba tráfego.

## Guias de plataformas

Cada uma dessas opções utiliza as mesmas duas partes, conectadas ao Postgres gerenciado
e ao runtime de contêiner daquele provedor. Todas elas podem ser mantidas dentro da UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform ou Docker Compose,
  na Alemanha ou Finlândia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, na França.
- **[Railway](/docs/deployment/railway/)** — a imagem e um Postgres gerenciado,
  em um único projeto.
- **[Fly.io](/docs/deployment/flyio/)** — global, ou fixado em regiões da UE.
