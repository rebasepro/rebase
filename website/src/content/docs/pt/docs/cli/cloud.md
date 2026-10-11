---
sourceHash: dfe254ab13267668
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos do rebase cloud — autenticação, vínculo de projeto, deploys, configuração, organizações, bancos de dados, recursos, computação, armazenamento, webhooks, clusters e faturamento.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o [guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em um projeto sem a necessidade de vinculá-lo.

Três opções se aplicam globalmente: `--json` para saída legível por máquina (também o padrão quando usado com pipe ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um control plane específico (ou `REBASE_CLOUD_URL`) e `--project, -p <id>`.

## Autenticação

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Vínculo de projeto

```bash
rebase cloud link         # vincula este diretório a um projeto na nuvem
rebase cloud link [url]   # ou direto a um backend: sem control plane, sem login, e o restante da família é recusado até que você desvincule
rebase cloud unlink       # remove o vínculo
rebase cloud use [org]    # seleciona a organização ativa
rebase cloud open         # abre o dashboard em um navegador
```

## Projetos

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deploy e observabilidade

```bash
rebase cloud deploy [app] [--source .]   # faz o deploy de um app e transmite os logs de build
rebase cloud logs [--runtime] [-f]       # logs de build ou do processo em execução
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # reverte para um deploy bem-sucedido
rebase cloud cancel [-y]                 # cancela o build em andamento
rebase cloud start | stop | restart [-y] # stop e restart precisam de -y
rebase cloud status                      # status do projeto em uma única visualização
rebase cloud metrics                     # CPU / memória / disco em tempo real
rebase cloud debug [health|logs|…]       # diagnostica uma implantação, somente leitura
```

`deploy` sem o nome de um app implanta o backend. O deploy do bundle do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma atualização de plataforma possa recompilá-lo; `--no-source` pula isso nessa execução, e `cloud settings set --platform-rebuilds off` desativa essa função e exclui a cópia armazenada. `--allow-downgrade` implanta uma versão anterior.

## Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

## Organizações

```bash
rebase cloud orgs list | create | members
```

## Bancos de Dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint público) até que Ctrl-C seja pressionado; `--reveal` adiciona a senha. Apenas para proprietário (owner) ou administrador.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que seu código declara.

```bash
rebase cloud resources                       # cada banco de dados e bucket: declarado? provisionado?
rebase cloud resources prune database <key>  # remove um recurso que o código não declara mais
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é excluída — isso equivaleria a dados apagados por um push. Ele mantém, vincula e cobra por ele até que alguém o remova explicitamente pelo nome.

## Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # a reserva atual e seu custo mensal
rebase cloud compute set        # altera as configurações de reserva
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Não há níveis de planos: tudo é cobrado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

## Armazenamento, webhooks, clusters e faturamento

```bash
rebase cloud storage             # lista os buckets de armazenamento
rebase cloud storage create      # provisiona armazenamento gerenciado pela plataforma
rebase cloud storage attach      # anexa seu próprio bucket compatível com S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # os clusters nos quais os tenants rodam; `add` registra um a partir de um kubeconfig
rebase cloud billing             # a conta de faturamento e o cartão registrado
rebase cloud billing setup       # anexa um cartão, uso único, abre o navegador
rebase cloud billing checkout    # uma sessão do Stripe para um projeto
```
