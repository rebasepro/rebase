---
sourceHash: 7df4c0efad6c667b
title: Implantação
sidebar_label: Visão geral
description: Onde um projeto Rebase pode ser executado — Rebase Cloud, seu próprio servidor, Kubernetes ou uma plataforma gerenciada de contêineres — e qual guia abrir para cada um.
---

## O que você implanta

Uma implantação do Rebase é composta por duas partes separáveis: a **imagem de runtime publicada**
(`rebasepro/server`) e o **bundle** que o `rebase build` produz a partir do seu
projeto. Não há imagem de aplicativo para construir, e atualizar o Rebase é uma alteração
de tag em vez de uma reconstrução. O mesmo bundle é executado em um laptop com Docker
Compose, no Rebase Cloud e em todas as plataformas abaixo.

Se esta for a sua primeira implantação, leia o
[guia de implantação](/docs/getting-started/deployment/) primeiro: ele aborda o que o
servidor disponibiliza, o ambiente de que necessita e como definir o primeiro
administrador antes da primeira inicialização.

## Execute para mim

- **[Rebase Cloud](/docs/deployment/cloud/)** — o mesmo Rebase, operado para
  você: `rebase cloud deploy` a partir do seu projeto, um banco de dados por projeto, backups
  e TLS inclusos.
- **[Managed backend runtime](/docs/deployment/managed-runtime/)** — o que um
  backend com `runtime: "managed"` pode fazer lá: pacotes, memória, timeouts,
  o sistema de arquivos, segredos, armazenamento e rede de saída.

## Execute você mesmo

- **[Self-hosting](/docs/deployment/self-hosting/)** — a imagem de runtime mais um
  banco de dados Postgres, no Docker Compose ou em uma VPS comum. Comece aqui.
- **[Kubernetes](/docs/deployment/kubernetes/)** — o Helm chart oficial, com
  um Job de migração responsável pelo schema.
- **[Splitting into several processes](/docs/deployment/split-processes/)** —
  um bundle como uma API, uma camada de funções e um worker, para que uma função pesada
  pare de competir com a API de dados.
- **[Running more than one instance](/docs/deployment/multiple-instances/)** —
  o estado que cada processo mantém para si e a configuração que o compartilha,
  antes que uma segunda réplica receba tráfego.

## Guias de plataformas

Cada um destes consiste nas mesmas duas partes, conectadas ao Postgres gerenciado
e ao runtime de contêiner daquele provedor. Todos eles podem ser mantidos dentro da UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS e App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL e Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL e Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — o arquivo Compose do seu projeto em
  um servidor, ou Terraform, na Alemanha ou Finlândia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, na França.
- **[Railway](/docs/deployment/railway/)** — a imagem e um Postgres gerenciado,
  em um único projeto.
- **[Fly.io](/docs/deployment/flyio/)** — global, ou fixado em regiões da UE.
- **[InstaPods](/docs/deployment/instapods/)** — Node e PostgreSQL em um único pod,
  uploads em seu disco, sem Docker.
- **[Hostman](/docs/deployment/hostman/)** — App Platform com Managed
  PostgreSQL, ou um servidor em nuvem.
