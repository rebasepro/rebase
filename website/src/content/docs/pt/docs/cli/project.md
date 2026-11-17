---
sourceHash: ba06503a40ad1397
title: Um app em execução
sidebar_label: Um app em execução
description: Comandos da CLI que atuam em um app Rebase em execução por meio de sua API — linhas, usuários, cron, logs, funções, arquivos, o simulador de RLS — no rebase dev, em um servidor especificado ou em um projeto Rebase Cloud.
---

Estes comandos comunicam-se com um app em execução por meio de sua própria API, portanto, a segurança em nível de linha (row-level security), o acesso a campos, hooks e políticas de armazenamento decidem o que eles podem fazer, assim como fazem para o SDK. Eles alcançam o `rebase dev` local, um servidor especificado por você ou um projeto Rebase Cloud, com as mesmas flags em qualquer lugar.

## Escolhendo o servidor e a credencial

| Flag | Para onde as requisições vão e como quem |
|---|---|
| *(nenhuma)* | `REBASE_BASE_URL` (shell e depois `.env`), caso contrário, o `rebase dev` que este checkout está executando; com a chave de serviço do `.env` |
| `--url <server>` | Esse servidor, com a chave de serviço do `.env` |
| `--project <slug>` | Um projeto Rebase Cloud, por meio do proxy do Studio no console: você faz login com `rebase cloud login`, e o plano de controle anexa a chave do app do lado dele, para que nenhuma chave chegue à sua máquina. Proprietários e administradores da organização, em um projeto cujo acesso ao Studio está ativado (`rebase cloud settings set --studio on`) |
| `--cloud` | O projeto Rebase Cloud ao qual este diretório está vinculado |
| `--token <bearer>` | Envia este bearer em vez disso: uma chave `rk_` ou o token de acesso de um usuário. Em um projeto Cloud, vai para o próprio endereço do app |
| `--session` | Envia a sessão de pessoa que o `rebase auth login` armazenou para aquele servidor |
| `--anon` | Não envia nada: o que um visitante recebe |

Nada mais é presumido: sem `REBASE_BASE_URL` e sem um `rebase dev` em execução, o comando se recusa a executar em vez de enviar a chave de serviço para o que quer que esteja escutando em uma porta. Todos os comandos aceitam `--json` (e a saída é JSON sempre que o stdout não for um terminal, como no `rebase cloud`) e `--yes`, que responde à confirmação exigida por qualquer ação destrutiva; sem um terminal, ele recusa com `confirmation_required` em vez de solicitar confirmação interativa.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` aceitam as mesmas flags.

## `rebase api`

Qualquer rota que o app sirva, com a credencial do projeto — a cauda longa de ações que não possuem um comando próprio: a atualização de uma materialized view, a auditoria de RLS, `/api/meta/contract`, uma rota adicionada por um plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Um caminho sem uma `/` inicial fica sob `/api`. `-f key=value` é um campo de string e `-F` um campo tipado (`true`, `false`, `null`, números, JSON, `@file`); os campos compõem a query string de um GET, HEAD ou DELETE e um corpo JSON nos demais casos. Diferente de `gh api`, apenas definir um campo nunca transforma a requisição em um POST: uma escrita define explicitamente seu método ou utiliza `--input`. A resposta é impressa exatamente como veio — com JSON formatado (pretty-printed) — e uma resposta diferente de 2xx é impressa e encerra com código de saída 1. Um cabeçalho `Authorization` é recusado; as flags de destino escolhem a credencial.

## `rebase data`

As linhas de uma tabela, por meio de `/api/data`. Os filtros são os próprios da API (`?status=eq.published`), repassados exatamente como escritos: `--where status=eq.published`, `--where price=gte.10` e simplesmente `--where status=draft` para igualdade.

```bash
rebase data query posts --where status=eq.published --order-by created_at:desc -n 10
rebase data query orders --all --format csv > orders.csv
rebase data get posts 42 --include author
rebase data count posts --where status=eq.draft
rebase data aggregate orders --select "count(),sum(total)" --group-by status
rebase data insert posts --data '{"title":"Hello"}'
rebase data update posts 42 --data '{"title":"Renamed"}'
rebase data delete posts --where status=eq.draft --yes
rebase data import posts --file seed.csv --upsert slug
rebase data history posts 42 && rebase data revert posts 42 <historyId>
rebase data watch posts --where status=eq.published
```

| Ação | Observações |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetível), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` percorre todas as páginas; `--format table\|json\|ndjson\|csv` (csv e ndjson transmitem via stream com `--all`) |
| `get <table> <id>` | Uma linha, com `--fields` e `--include` |
| `count <table>` | As linhas correspondentes a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, os próprios da API |
| `insert <table>` | `--data <json>` ou `--file <path\|->`; um array representa várias linhas em uma única escrita em lote; `--upsert <column>` |
| `update <table> [<id>]` | Uma linha, ou todas as linhas correspondentes a `--where` após uma contagem e confirmação; `--if-match <etag>` |
| `delete <table> [<id>]` | Solicita confirmação antes; `--hard` em uma tabela com soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON ou CSV por extensão, ou `--format`), em lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lê de volta o que `query --format json` grava |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelas com histórico ativado |
| `watch <table>` | As linhas correspondentes a cada alteração, via socket em tempo real. Não passa pelo proxy do Studio: em um projeto Cloud, passe `--token` ou `--session` |

A chave de serviço possui o papel `admin`: a segurança em nível de linha (RLS) continua ativa, sob esse papel. Passe `--token`, `--session` ou `--anon` para ver a tabela como outra pessoa a veria.

## `rebase schema show`

As tabelas, ou as colunas, relações e segurança em nível de linha de uma tabela — de `backend/schema` por padrão, ou com `--remote` (ou qualquer flag de destino) conforme o servidor em execução as descreve para esta credencial. Uma credencial sem `schema:read` não vê nenhuma política, e uma tabela que ela não puder ler não será listada.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

As contas, por meio de `/api/admin/users`, `/roles` e `/guests`. Uma conta é identificada pelo seu uid ou seu e-mail (uma correspondência exata, nunca o primeiro resultado aproximado).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` envia um convite por e-mail, ou retorna uma senha temporária única quando nenhum e-mail pode ser enviado. A concessão de um papel, `--disable`, `delete` e `mfa-reset` solicitam confirmação prévia. Nenhum autor da chamada pode conceder um papel superior ao seu próprio, ou agir sobre uma conta com nível hierárquico superior. `rebase auth reset-password` é a sintaxe legada e ainda recorre ao banco de dados diretamente quando o servidor não está em execução.

## `rebase cron`

As tarefas agendadas do app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sobrescrevem o código do job em todos os processos, persistindo entre novos deploys; `run` solicita confirmação antes, e `--async` responde assim que a execução for iniciada. Em um projeto Cloud, o `rebase cron` não precisa de acesso ao Studio para leituras: ele solicita ao plano de controle um token de plataforma temporário com escopo `cron:read`, o qual qualquer membro com acesso aos logs possui. `run`, `enable`, `disable` e `reset` exigem `cron:write`, permissão que um proprietário ou administrador da organização detém em um projeto com o Studio ativado. `rebase cloud cron` é a sintaxe legada somente leitura.

## `rebase logs`

O log de requisições e de aplicação do servidor — o buffer que o Logs Explorer do Studio lê — exibido uma vez, ou acompanhado em tempo real com `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

O buffer pertence a um único processo. Com `--project` ou `--cloud`, isso se comporta como `rebase cloud logs --runtime`: a saída de todas as réplicas, através do plano de controle.

## `rebase functions`

As rotas personalizadas do app, uma por arquivo em `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` aceita os mesmos campos, corpo e cabeçalhos que `rebase api` aceita, e imprime a resposta exatamente como veio. As funções decidem seu próprio controle de acesso, portanto a credencial importa: `--anon` mostra o que um visitante receberia.

## `rebase storage`

Arquivos armazenados, por meio das políticas de armazenamento. O lado armazenado começa com dois-pontos: `:avatars/me.png` na fonte padrão, `media:avatars/me.png` na fonte identificada como `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` faz o upload sob o prefixo público (uma URL permanente e sem token), `--content-type` define o tipo MIME, e `--force` sobrescreve um arquivo local durante o download. `orphans` e `move` são os comandos de manutenção ampla do storage dentro desse grupo.

## `rebase rls simulate`

O que outra identidade veria, a partir do simulador de RLS do app — o mesmo que a opção "view as" (ver como) do Studio utiliza: por tabela, as linhas que ela lê em comparação com as linhas que você lê, as tabelas das quais seus escopos a bloqueiam e as colunas que ela não pode ler. Somente leitura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

O simulador responde à própria sessão de um administrador e nunca a uma chave, portanto, isso envia a sessão armazenada por `rebase auth login`. O `rebase verify --live` verifica as próprias políticas, sem levar em conta nenhuma identidade específica.

## `rebase auth login`, `emails` e `keys`

Algumas rotas respondem a uma pessoa e nunca a uma máquina: o simulador de RLS, chaves pessoais, aplicação de esquema ao vivo. `rebase auth login` autentica em um app em execução — através do navegador quando o servidor oferece login por dispositivo (device sign-in), ou então com `--email` e uma senha (`--code` para segundo fator) — e mantém a sessão em `~/.rebase/sessions.json`, separada por servidor, nunca dentro do projeto. `auth whoami` indica quem o servidor entende que você é e os escopos que você possui; `auth logout` encerra a sessão lá também.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lê a caixa de entrada de desenvolvimento que um servidor sem `SMTP_HOST` mantém em vez de enviar e-mails de fato; `--clear` a esvazia. `auth keys` gerencia suas próprias chaves `rk_`, que atuam em seu nome, restritas aos escopos indicados; o servidor responde a isso apenas quando a tabela de autenticação define `auth.personalKeys: true`. Chaves de serviço são gerenciadas via `rebase api-keys`, que também ganhou o subcomando `update <id>`.

## Próximos passos

- [Índice de endpoints](/docs/backend/endpoints/) — todas as rotas que estes comandos alcançam e o escopo necessário para cada uma
- [REST API](/docs/backend/api/) — a sintaxe de filtragem, ordenação e paginação repassada pelo `rebase data`
- [rebase cloud](/docs/cli/cloud/) — o próprio projeto no Rebase Cloud: deploys, ambiente, backups, acesso ao Studio
- [Referência da CLI](/docs/cli/) — todos os outros comandos
