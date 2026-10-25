---
sourceHash: a31629385c88f416
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vínculo de projetos, deploys, configuração, organizações, bancos de dados, recursos, computação, armazenamento, webhooks, clusters e faturamento.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Todos os grupos respondem a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam globalmente: `--json` para saída legível por máquina (também o padrão quando usado com pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um control plane específico (ou `REBASE_CLOUD_URL`) e `--project, -p <id>`.

## Autenticação

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Vínculo de projeto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projetos

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deploy e observação

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sem o nome de uma aplicação faz o deploy do backend. Um deploy de
bundle do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa reconstruí-lo; `--no-source` ignora isso uma vez, e `cloud settings set
--platform-rebuilds off` desativa isso e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Um `deploy` acompanhado termina com um resumo: cada app implantado com sua URL, o id do deploy, quanto tempo levou e se a nova versão responde ali. Ele espera até `--live-timeout` segundos (60 por padrão; `0` pula a verificação) que o `/api/health` do backend e o endereço de cada app estático respondam. Um deploy que falhou termina com uma linha que nomeia o app e o motivo, e sai com código diferente de zero. O resumo é impresso também com pipe; `--json` (ou `REBASE_JSON=1`) imprime em vez disso um objeto com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes do upload, `deploy` analisa o JavaScript de cada app estático que publica: os arquivos `.js`/`.mjs`/`.cjs` no seu `output` e os blocos `<script>` inline do seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código `syntax_error` com `--json`), e `--no-verify` pula a verificação. Um deploy bem-sucedido termina com o caminho de volta, `rebase cloud rollback`. Um app estático implantado sozinho ainda não pode ter rollback; veja [Rollback](/docs/deployment/cloud#roll-back).

`--preview` serve o build em `https://<project>--<name>.rebase.website` e
deixa a produção intacta. Um preview de um app estático chama o backend de produção.
Um preview do backend executa o seu próprio backend, em um banco de dados vazio e só dele.
Veja [Pré-visualizar uma mudança](/docs/deployment/cloud/#preview-a-change).

## Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

Um preview do backend parte das variáveis da produção, chaves live incluídas.
`env set KEY=VALUE --preview` dá aos previews o seu próprio valor, `env unset KEY
--preview` deixa a variável fora deles, `env reset KEY --preview` devolve
o valor da produção, e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum deles.

## Organizações

```bash
rebase cloud orgs list | create | members
```

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem
endpoint público) até Ctrl-C; `--reveal` adiciona a senha. Apenas para proprietário ou admin.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que seu código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração deixa de existir — isso
seria excluir dados por meio de um push. Ele o mantém, vincula e fatura até que alguém
faça a remoção (prune) pelo nome.

## Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` foi descontinuado: todo backend executa pelo menos uma instância, portanto
`true` é recusado e `false` é ignorado com um aviso. Não há níveis de
plano: tudo é precificado por recurso. Consulte o
[Rebase Cloud](/docs/deployment/cloud/).

## Armazenamento, webhooks, clusters e faturamento

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```
