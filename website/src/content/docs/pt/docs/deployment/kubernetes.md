---
title: Kubernetes
sidebar_label: Kubernetes
description: Faça o deploy do Rebase em um cluster Kubernetes com o Helm chart oficial — um Deployment ou vários, um Job de migração responsável pelo schema, e aplicações estáticas no mesmo host.
---

## Visão Geral

O chart oficial é o equivalente em Kubernetes da configuração de auto-hospedagem (self-hosting) com Docker Compose. Mesma ideia, mesma imagem, mesmo bundle: **o runtime é a imagem, seu projeto é o bundle, e atualizar o Rebase é apenas mudar uma tag.**

Ele é publicado como um artefato OCI junto com a imagem de runtime, e ambos compartilham a mesma versão — o chart que faz o deploy do runtime `0.15.0` *é* o chart `0.15.0`, logo há apenas um número para acompanhar. Sem `--version` você obtém a versão mais recente; fixe-a para um deploy real, da mesma forma que você fixaria `image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

O chart faz o deploy **apenas do runtime**. Ele não faz o deploy do Postgres — use CloudNativePG, um banco de dados gerenciado ou seu próprio StatefulSet, e aponte `config.databaseUrl` para ele. Um chart que também gerenciasse seu banco de dados teria que assumir seus backups e failover, o que é uma promessa muito maior do que apenas "executar a aplicação".

> **Maturidade.** O chart passa por lint e renderização em CI contra o Helm v4.2.4 — cobrindo todas as topologias documentadas e um caso para cada recusa listada abaixo. Ele **ainda não foi testado em um cluster ativo**. Trate-o como um ponto de partida bem testado em vez de um padrão comprovado em produção, e leia [Auto-hospedagem](/docs/deployment/self-hosting) para o caminho comprovado.

Para trabalhar a partir de um clone local — um chart modificado ou uma instalação air-gapped — `helm install rebase ./charts/rebase` aceita os mesmos valores.

## Levando seu projeto para o pod

| `bundle.mode` | Como | Quando |
|---|---|---|
| `image` (padrão) | Crie a imagem `FROM rebasepro/server` com `COPY dist-bundle /bundle`, depois defina `image.repository` | Quase sempre. Um único artefato, imutável, sem dependência em tempo de execução de que uma URL permaneça ativa |
| `url` | Imagem padrão; o runtime baixa um tarball a cada inicialização do pod | Um painel de controle (control plane) que entrega bundles fora de banda |

## Um processo ou vários

O padrão é um único Deployment servindo tudo — o mesmo formato executado pelo arquivo Compose. A divisão requer apenas um valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Isso fornece uma camada de `api`, uma camada de `functions` e um `worker`, todos a partir da mesma imagem e do mesmo bundle. Veja [Processos Divididos](/docs/deployment/split-processes) para entender o que cada função faz e por que separá-las.

O que o chart acrescenta em relação a fazer isso manualmente é que ele **deduz as configurações cujo modo de falha é silencioso**, a partir dos valores que você já forneceu:

- `REBASE_ROLE` por unidade
- `REBASE_MIGRATE_ON_BOOT=none` em todos os lugares, porque o Job de migração gerencia o schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` na api quando um worker existir
- `TRUSTED_PROXY_HOPS` na unidade de functions
- `REBASE_RATE_LIMIT_STORE=sql` assim que um segundo processo passar a servir HTTP

Um `REBASE_ROLE` incorreto não serve HTTP enquanto `/health` ainda responde, fazendo o readiness passar e toda requisição retornar 404. A ausência de `REBASE_MIGRATE_ON_BOOT` gera um loop de travamento (crash loop) cujo motivo fica em um log que ninguém está monitorando. O chart define todos eles, e o `config.env` não pode sobrescrevê-los.

### Separando o cron da execução de jobs

Dois workers com responsabilidades opostas — sem nova role e sem código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## O painel de administração e qualquer outro front-end

Uma aplicação estática usa a mesma imagem de runtime inicializando um bundle `kind: static`. Esse fluxo é interrompido antes de o runtime ler `DATABASE_URL` ou `JWT_SECRET`, portanto esses pods **não contêm nenhum segredo**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

O ingress roteia `/admin` para ele e `/` para a API, no **mesmo host**. Isso é proposital: mesma origem significa que a autenticação por cookies e o CORS permanecem exatamente iguais, e a divisão continua sendo uma decisão interna de topologia, em vez de uma alteração na superfície pública do seu produto. A contrapartida é que os assets precisam ser *compilados* para esse caminho, o que o runtime verifica durante a inicialização.

O deploy do admin passa a ser apenas o incremento da tag da imagem em um Deployment. O backend não é reiniciado.

## Schema

`migrationJob.enabled` (o padrão) executa um Job de `pre-install,pre-upgrade` que provisiona e finaliza, e cada pod inicializa com `REBASE_MIGRATE_ON_BOOT=none`. Nada no caminho das requisições gerencia DDL, o que é a resposta mais limpa para "exatamente um processo provisiona o schema" — isso deixa de ser uma regra que alguém precisa lembrar.

`mode: ensure` cria o que estiver faltando. `mode: push` também aplica alterações de schema das coleções e **é destrutivo**; não é o padrão.

## O que o chart se recusa a renderizar

Cada um destes itens é uma configuração que não gera erros em tempo de execução — o deploy sobe e algo silenciosamente deixa de funcionar. Em vez disso, o `helm install` falha, indicando qual valor deve ser alterado:

- mais de um processo HTTP com `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` enquanto `split=false`
- duas aplicações estáticas reivindicando o mesmo caminho, ou uma reivindicando um caminho sob `/api`
- `bundle.mode=image` enquanto `image.repository` ainda for a imagem padrão de runtime
- `ingress.enabled` sem host, ou `bundle.mode=url` sem URL
- um `migrationJob.mode` ou `sharedState.rateLimitStore` não reconhecido

## O que o chart não pode fazer por você

**Transmissão em tempo real (broadcast) e presença entre réplicas.** O barramento de canal padrão do runtime é em memória; portanto, com mais de uma réplica da API, um assinante em um pod não verá uma transmissão publicada em outro. A correção fica na configuração do seu projeto, e não no chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Defina `sharedState.channelBusConfigured: true` para declarar que você o configurou — o chart usa isso apenas para decidir se deve emitir um aviso. Assinaturas comuns de coleções não são afetadas; elas trafegam pelo CDC do Postgres.
