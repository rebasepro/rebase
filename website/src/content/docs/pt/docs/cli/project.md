---
sourceHash: 1f147c4f06a5601d
title: Uma aplicação em execução
sidebar_label: Uma aplicação em execução
description: Comandos de CLI que atuam em uma aplicação Rebase em execução por meio de sua API — linhas, usuários, cron, logs, funções, arquivos, o simulador de RLS — no rebase dev, em um servidor especificado ou em um projeto do Rebase Cloud.
---

Esses comandos comunicam-se com uma aplicação em execução por meio de sua própria API, portanto, a segurança em nível de linha (RLS), o acesso a campos, hooks e políticas de armazenamento decidem o que eles podem fazer, assim como fazem para o SDK. Eles acessam o `rebase dev` local, um servidor especificado por você ou um projeto do Rebase Cloud, com as mesmas flags em qualquer lugar.

## Escolhendo o servidor e a credencial

| Flag | Para onde as requisições vão e sob qual identidade |
|---|---|
| *(nenhuma)* | `REBASE_BASE_URL` (shell, depois `.env`), caso contrário, o `rebase dev` que este checkout está executando; com a chave de serviço do `.env` |
| `--url <server>` | Esse servidor, com a chave de serviço do `.env` |
| `--project <slug>` | Um projeto do Rebase Cloud, por meio do proxy do Studio no console: você faz login com `rebase cloud login` e o plano de controle anexa a chave da aplicação do lado dele, para que nenhuma chave chegue à sua máquina. Proprietários e administradores da organização, em um projeto com o acesso ao Studio ativado (`rebase cloud settings set --studio on`) |
| `--cloud` | O projeto do Rebase Cloud ao qual este diretório está vinculado |
| `--token <bearer>` | Envia este bearer: uma chave `rk_` ou o token de acesso de um usuário. Em um projeto Cloud, ele vai para o próprio endereço da aplicação |
| `--session` | Envia a sessão de usuário que o `rebase auth login` armazenou para esse servidor |
| `--anon` | Não envia nada: o que um visitante recebe |

Nada mais é adivinhado: sem `REBASE_BASE_URL` e sem um `rebase dev` em execução, o comando é recusado em vez de enviar a chave de serviço para o que quer que esteja escutando em uma porta. O `rebase dev` em execução é aquele cujo processo está ativo, na porta que seu backend anunciou (`.rebase/dev.json`, caso contrário, o próprio `.rebase/state.json` do backend); `.rebase-dev-url` serve para seus scripts, e uma execução interrompida o deixa para trás, de modo que nenhum comando o lê. Todo comando aceita `--json` (e a saída é em JSON sempre que o stdout não for um terminal, assim como no `rebase cloud`) e `--yes`, que responde à confirmação solicitada por qualquer comando destrutivo; sem um terminal, ele recusa a operação com `confirmation_required` em vez de solicitar confirmação interativa.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` aceitam as mesmas flags.

## `rebase api`

Qualquer rota que a aplicação sirva, com a credencial do projeto — a cauda longa de operações que não possuem um comando próprio: a atualização de uma view materializada, a auditoria de RLS, `/api/meta/contract`, uma rota adicionada por um plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Um caminho sem uma `/` inicial fica sob `/api`. `-f key=value` é um campo de string e `-F` um campo tipado (`true`, `false`, `null`, números, JSON, `@file`); os campos formam a query string de um GET, HEAD ou DELETE e o corpo JSON em outros casos. Diferente do `gh api`, um campo por si só nunca transforma a requisição em um POST: uma escrita define explicitamente seu método ou utiliza `--input`. A resposta é exibida como veio — JSON formatado — e uma resposta diferente de 2xx é exibida e encerra com código 1. Um cabeçalho `Authorization` é recusado; as flags de destino escolhem a credencial.

## `rebase data`

As linhas de uma tabela, por meio de `/api/data`. Os filtros são os da própria API (`?status=eq.published`), repassados exatamente como escritos: `--where status=eq.published`, `--where price=gte.10`, e um simples `--where status=draft` para igualdade.

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

| Ação | Notas |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetível), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` percorre todas as páginas; `--format table\|json\|ndjson\|csv` (csv e ndjson usam streaming com `--all`) |
| `get <table> <id>` | Uma linha, com `--fields` e `--include` |
| `count <table>` | As linhas correspondentes a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, os mesmos da API |
| `insert <table>` | `--data <json>` ou `--file <path\|->`; um array representa várias linhas em uma única escrita em lote; `--upsert <column>` |
| `update <table> [<id>]` | Uma linha, ou todas as linhas correspondentes a `--where` após uma contagem e uma confirmação; `--if-match <etag>` |
| `delete <table> [<id>]` | Pede confirmação primeiro; `--hard` em tabelas com soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON ou CSV por extensão, ou `--format`), em lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lê de volta o que `query --format json` grava |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelas com histórico ativado |
| `watch <table>` | As linhas correspondentes a cada alteração, via socket de tempo real (realtime). Não passa pelo proxy do Studio: em um projeto Cloud, passe `--token` ou `--session` |

A chave de serviço possui o papel `admin`: a segurança em nível de linha ainda é executada, sob essa função. Passe `--token`, `--session` ou `--anon` para ver a tabela como outra pessoa a veria.

## `rebase schema show`

As tabelas, ou as colunas, relações e segurança em nível de linha de uma tabela — de `backend/schema` por padrão, ou com `--remote` (ou qualquer flag de destino) conforme o servidor em execução as descreve para esta credencial. Uma credencial sem `schema:read` não vê nenhuma política, e uma tabela que ela não pode ler não é listada.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

As contas, por meio de `/api/admin/users`, `/roles` e `/guests`. Uma conta é identificada por seu uid ou email (uma correspondência exata, nunca o primeiro resultado aproximado).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users import users.csv --dry-run
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` envia um convite por e-mail ou retorna uma senha temporária única quando nenhum e-mail puder ser enviado. `--no-invite` cria a conta sem senha e não envia nada, para uma aplicação que faz login por magic link, código por e-mail ou provedor (`POST /api/admin/users` com `invite: false`). A concessão de um papel, `--disable`, `delete` e `mfa-reset` pedem confirmação primeiro. Nenhum chamador pode conceder um papel superior ao seu próprio ou atuar em uma conta de nível hierárquico superior. `rebase auth reset-password` é a sintaxe anterior e ainda recorre diretamente ao banco de dados quando o servidor não está em execução.

### Importando contas

O comando `import` traz contas de outro sistema e preserva seus ids, de modo que as linhas que apontam para um usuário continuem apontando para o mesmo. Ele aceita um CSV, um array JSON ou NDJSON (`--format`, caso contrário, pela extensão), com as seguintes colunas:

| Coluna | |
|---|---|
| `id` | Mantido como o id da conta. Opcional: sem ele, a tabela de usuários gera um. Um uuid é o caso comum; letras, dígitos e `_ - . : \|` de até 128 caracteres também são aceitos, embora uma coluna de id do tipo `uuid` aceite apenas uuids |
| `email` | Obrigatório |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Quando a conta foi criada lá. Opcional: agora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Opcional: `false`, e o primeiro magic link ou redefinição que a conta acessar irá confirmá-lo |
| `roles` | `editor;viewer`, entre aspas `"editor,viewer"`, ou um array do Postgres `{editor,viewer}` |

Nenhuma senha e nenhum hash é importado, e nenhum e-mail é enviado: uma conta importada faz login por magic link, código por e-mail, provedor ou redefinição de senha. Uma conta cujo id ou e-mail já esteja em uso é relatada como ignorada (skipped) e mantida como está, nunca atualizada, permitindo que um arquivo seja executado novamente. Cada conta é reportada como criada, ignorada ou com falha, com o respectivo motivo; o comando encerra com código 1 caso haja alguma falha. `--dry-run` valida todas as contas e não grava nada. A CLI envia 100 contas por requisição (`POST /api/admin/users/import`), seja no `rebase dev`, em um servidor ou em um projeto do Rebase Cloud.

Do Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

As tarefas agendadas (jobs) da aplicação (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sobrescrevem o código da tarefa em todos os processos, entre redeploys; `run` pede confirmação primeiro, e `--async` retorna resposta assim que a execução for iniciada. Em um projeto Cloud, o `rebase cron` não precisa de acesso ao Studio para leituras: ele solicita ao plano de controle um token de plataforma temporário `cron:read`, o qual qualquer membro com acesso a logs possui. `run`, `enable`, `disable` e `reset` exigem `cron:write`, que proprietários ou administradores da organização possuem em projetos com o Studio ativado. `rebase cloud cron` é a sintaxe anterior, somente leitura.

## `rebase logs`

O log de requisições e da aplicação do servidor — o buffer lido pela visualização de Logs do Studio — uma única vez, ou seguido em tempo real com `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

O buffer pertence a um único processo. Com `--project` ou `--cloud`, isso equivale a `rebase cloud logs --runtime`: a saída de todas as réplicas, por meio do plano de controle.

## `rebase functions`

As rotas próprias da aplicação, uma por arquivo em `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` aceita os mesmos campos, corpo e cabeçalhos que o `rebase api` aceita, e exibe a resposta exatamente como veio. As funções definem seu próprio controle de acesso, portanto a credencial importa: `--anon` mostra o que um visitante recebe.

## `rebase storage`

Arquivos armazenados, por meio das políticas de armazenamento. O caminho armazenado começa com dois pontos: `:avatars/me.png` na origem padrão, `media:avatars/me.png` na origem identificada como `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` faz upload sob o prefixo público (uma URL permanente e sem token), `--content-type` define o tipo e `--force` sobrescreve um arquivo local no download. `orphans` e `move` representam a parte de manutenção de todo o storage do grupo.

## `rebase rls simulate`

O que outra identidade veria, a partir do simulador de RLS da aplicação — o mesmo que o recurso "view as" do Studio usa: por tabela, as linhas que ela lê em comparação com as linhas que você lê, as tabelas das quais seus escopos a bloqueiam e as colunas que ela não pode ler. Somente leitura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

O simulador responde apenas à sessão de um administrador e nunca a uma chave, portanto este comando envia a sessão armazenada por `rebase auth login`. `rebase verify --live` verifica as próprias políticas, sem considerar nenhuma identidade específica.

## `rebase auth login`, `emails` e `keys`

Algumas rotas respondem a uma pessoa e nunca a uma máquina: o simulador de RLS, chaves pessoais, aplicação de schema em tempo real (live schema apply). `rebase auth login` autentica em uma aplicação em execução — pelo navegador quando o servidor oferecer login de dispositivo, caso contrário com `--email` e senha (`--code` para um segundo fator) — e mantém a sessão em `~/.rebase/sessions.json`, por servidor, nunca no projeto. `auth whoami` informa quem o servidor reconhece que você é e os escopos que você possui; `auth logout` encerra a sessão também lá.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lê a caixa de entrada de desenvolvimento que um servidor sem `SMTP_HOST` mantém em vez de enviar os e-mails; `--clear` a esvazia. Uma caixa de entrada vazia responde informando qual servidor foi consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, e `server` no JSON), já que uma resposta vazia de outro backend se parece exatamente com um e-mail que nunca foi enviado. `auth keys` gerencia suas próprias chaves `rk_`, que atuam como você, restritas aos escopos especificados; o servidor responde a isso apenas quando a tabela de autenticação define `auth.personalKeys: true`. Chaves de serviço são gerenciadas por `rebase api-keys`, que também ganhou o subcomando `update <id>`.

## Próximos passos

- [Índice de endpoints](/docs/backend/endpoints/) — cada rota que esses comandos acessam e o escopo que cada uma exige
- [API REST](/docs/backend/api/) — a sintaxe de filtragem, ordenação e paginação repassada pelo `rebase data`
- [rebase cloud](/docs/cli/cloud/) — o próprio projeto no Rebase Cloud: deploys, ambiente, backups, acesso ao Studio
- [Referência da CLI](/docs/cli/) — todos os outros comandos
