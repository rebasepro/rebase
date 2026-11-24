---
sourceHash: 3e9a0fde0de12d46
title: Um app em execução
sidebar_label: Um app em execução
description: Comandos da CLI que atuam em um app Rebase em execução por meio de sua API — linhas, usuários, cron, logs, funções, arquivos, o simulador de RLS — no rebase dev, em um servidor especificado ou em um projeto do Rebase Cloud.
---

Esses comandos se comunicam com um app em execução por meio de sua própria API, portanto, a segurança em nível de linha (RLS), o acesso a campos, hooks e políticas de armazenamento decidem o que eles podem fazer, assim como fazem para o SDK. Eles acessam o `rebase dev` local, um servidor especificado ou um projeto do Rebase Cloud, com as mesmas flags em qualquer lugar.

## Escolhendo o servidor e a credencial

| Flag | Para onde as requisições vão e como quem |
|---|---|
| *(nenhuma)* | `REBASE_BASE_URL` (shell, depois `.env`), caso contrário, o `rebase dev` que este checkout está executando; com a chave de serviço do `.env` |
| `--url <server>` | Esse servidor, com a chave de serviço do `.env` |
| `--project <slug>` | Um projeto do Rebase Cloud, por meio do proxy do Studio no console: você faz login com `rebase cloud login`, e o plano de controle anexa a chave do app do lado dele, para que nenhuma chave chegue à sua máquina. Proprietários e administradores da organização, em um projeto com acesso ao Studio ativado (`rebase cloud settings set --studio on`) |
| `--cloud` | O projeto do Rebase Cloud ao qual este diretório está vinculado |
| `--token <bearer>` | Envia este bearer em vez disso: uma chave `rk_` ou o token de acesso de um usuário. Em um projeto Cloud, ele vai para o próprio endereço do app |
| `--session` | Envia a sessão de usuário que o `rebase auth login` armazenou para esse servidor |
| `--anon` | Não envia nada: o que um visitante recebe |

Nada mais é adivinhado: sem `REBASE_BASE_URL` e sem um `rebase dev` em execução, o comando se recusa a executar em vez de enviar a chave de serviço para o que quer que esteja escutando em uma porta. O `rebase dev` em execução é aquele cujo processo está ativo, na porta que seu backend anunciou (`.rebase/dev.json`, caso contrário, o próprio `.rebase/state.json` do backend); `.rebase-dev-url` é para seus scripts, e uma execução interrompida o deixa para trás, portanto nenhum comando o lê. Todo comando aceita `--json` (e a saída é em JSON sempre que o stdout não for um terminal, assim como no `rebase cloud`) e `--yes`, que responde à confirmação solicitada por comandos destrutivos; sem um terminal, ele recusa com `confirmation_required` em vez de solicitar confirmação.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` aceitam as mesmas flags.

## `rebase api`

Qualquer rota atendida pelo app, com a credencial do projeto — a cauda longa de rotas que não têm um comando próprio: a atualização de uma materialized view, a auditoria de RLS, `/api/meta/contract`, uma rota adicionada por um plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Um caminho sem uma `/` inicial fica sob `/api`. `-f chave=valor` é um campo de string e `-F` é tipado (`true`, `false`, `null`, números, JSON, `@file`); os campos formam a query string de uma requisição GET, HEAD ou DELETE e um corpo JSON caso contrário. Diferente do `gh api`, um campo isolado nunca transforma a requisição em POST: uma operação de escrita define seu método explicitamente ou utiliza `--input`. A resposta é exibida exatamente como retornada — JSON formatado (pretty-printed) — e respostas que não sejam 2xx são exibidas e encerram com código de saída 1. Um cabeçalho `Authorization` é recusado; as flags de destino escolhem a credencial.

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

| Ação | Observações |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetível), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` percorre todas as páginas; `--format table\|json\|ndjson\|csv` (csv e ndjson fazem streaming com `--all`) |
| `get <table> <id>` | Uma linha, com `--fields` e `--include` |
| `count <table>` | As linhas que correspondem ao `--where` |
| `aggregate <table>` | `--select` e `--group-by`, os mesmos da API |
| `insert <table>` | `--data <json>` ou `--file <path\|->`; um array representa várias linhas em uma única gravação em lote; `--upsert <column>` |
| `update <table> [<id>]` | Uma linha, ou todas as linhas correspondentes a `--where` após uma contagem e confirmação; `--if-match <etag>` |
| `delete <table> [<id>]` | Pede confirmação primeiro; `--hard` em tabelas com soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON ou CSV por extensão, ou `--format`), em lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lê de volta o que `query --format json` grava |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelas com histórico ativado |
| `watch <table>` | As linhas correspondentes a cada alteração, via realtime socket. Não funciona através do proxy do Studio: em um projeto Cloud, use `--token` ou `--session` |

A chave de serviço tem a role `admin`: a segurança em nível de linha (RLS) ainda é aplicada, sob essa role. Passe `--token`, `--session` ou `--anon` para ver a tabela como outra pessoa a veria.

## `rebase schema show`

As tabelas, ou as colunas, relacionamentos e a segurança em nível de linha de uma tabela — obtidos de `backend/schema` por padrão, ou com `--remote` (ou qualquer flag de destino) conforme o servidor em execução os descreve para essa credencial. Uma credencial sem `schema:read` não vê políticas, e uma tabela que ela não pode ler não é listada.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

As contas, por meio de `/api/admin/users`, `/roles` e `/guests`. Uma conta é identificada por seu UID ou e-mail (uma correspondência exata, nunca o primeiro resultado aproximado).

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

`create` envia um convite por e-mail ou retorna uma senha temporária única quando nenhum e-mail puder ser enviado. `--no-invite` cria a conta sem senha e não envia nada, útil para apps com login via magic link, código por e-mail ou provedor (`POST /api/admin/users` com `invite: false`). Conceder uma role, `--disable`, `delete` e `mfa-reset` pedem confirmação antes de executar. Nenhum chamador pode conceder uma role superior à sua, nem agir sobre uma conta de nível mais alto. `rebase auth reset-password` é a sintaxe anterior e ainda recorre ao banco de dados diretamente quando o servidor não está em execução.

### Importando contas

`import` traz contas de outro sistema mantendo seus IDs, de modo que as linhas que apontam para um usuário continuem apontando para o mesmo. Ele aceita um CSV, um array JSON ou NDJSON (`--format`, ou pela extensão do arquivo), com estas colunas:

| Coluna | |
|---|---|
| `id` | Mantido como o ID da conta. Opcional: sem ele, a tabela de usuários gera um. Um UUID é o caso comum; letras, dígitos e `_ - . : \|` com até 128 caracteres também são aceitos, embora uma coluna de ID do tipo `uuid` aceite apenas UUIDs |
| `email` | Obrigatório |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Quando a conta foi criada lá. Opcional: agora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Opcional: `false`, e o primeiro magic link ou link de redefinição acessado pela conta a confirma |
| `roles` | `editor;viewer`, entre aspas `"editor,viewer"`, ou um array Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | O hash armazenado pelo outro sistema. Lido apenas com `--password-hashes bcrypt`; sem a flag, um arquivo contendo essa coluna é recusado antes que qualquer coisa seja enviada |

Nenhum e-mail é enviado. Com `--password-hashes bcrypt`, uma conta cuja linha possui um hash faz login com a senha que tinha, e seu primeiro login substitui o hash pelo formato padrão do Rebase. Qualquer outra conta importada faz login por magic link, código por e-mail, provedor ou redefinição de senha. Senhas em texto puro nunca são importadas. Uma conta cujo ID ou e-mail já esteja em uso é relatada como ignorada (skipped) e mantida inalterada, nunca atualizada, permitindo que o arquivo seja executado novamente. Cada conta é relatada como criada, ignorada ou com falha, acompanhada do motivo; o comando encerra com código 1 caso haja falhas. `--dry-run` verifica todas as contas sem gravar nada. A CLI envia 100 contas por requisição (`POST /api/admin/users/import`), funcionando da mesma forma no `rebase dev`, em um servidor ou em um projeto do Rebase Cloud.

Do Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` conterá então o hash de senha de cada conta: exclua-o assim que a importação for concluída.

## `rebase cron`

As tarefas agendadas (jobs) do app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sobrescrevem o código do job em todos os processos, persistindo entre novos deploys; `run` pede confirmação primeiro, e `--async` retorna assim que a execução é iniciada. Em um projeto Cloud, `rebase cron` não precisa de acesso ao Studio para operações de leitura: ele solicita ao plano de controle um token de plataforma temporário `cron:read`, que qualquer membro com acesso aos logs possui. `run`, `enable`, `disable` e `reset` exigem `cron:write`, que pertence a proprietários ou administradores da organização em projetos com o Studio ativado. `rebase cloud cron` é a sintaxe legada, de leitura apenas.

## `rebase logs`

O log de requisições e da aplicação do servidor — o buffer lido pela visualização de Logs do Studio — exibido de uma vez ou transmitido em tempo real com `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

O buffer pertence a um único processo. Com `--project` ou `--cloud`, isso equivale a `rebase cloud logs --runtime`: a saída de cada réplica, por meio do plano de controle.

## `rebase functions`

As rotas personalizadas do app, uma por arquivo em `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` aceita os mesmos campos, corpo e cabeçalhos que `rebase api` aceita, e exibe a resposta da mesma forma que foi retornada. As funções definem seu próprio controle de acesso, portanto a credencial importa: `--anon` mostra o que um visitante recebe.

## `rebase storage`

Arquivos armazenados, por meio de políticas de armazenamento. O lado armazenado começa com dois-pontos: `:avatars/me.png` na fonte padrão, `media:avatars/me.png` na fonte com a chave `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` faz o upload sob o prefixo público (uma URL permanente, sem token), `--content-type` define o tipo de conteúdo e `--force` sobrescreve um arquivo local no download. `orphans` e `move` representam a parte de manutenção do armazenamento global do grupo.

## `rebase rls simulate`

O que outra identidade veria, a partir do simulador de RLS do app — o mesmo que o "view as" do Studio utiliza: por tabela, as linhas que ela lê em comparação com as linhas que você lê, as tabelas das quais seus escopos a bloqueiam e as colunas que ela não pode ler. Somente leitura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

O simulador responde à própria sessão de um administrador e nunca a uma chave, portanto isso envia a sessão armazenada pelo `rebase auth login`. `rebase verify --live` verifica as políticas em si, sem levar em conta uma identidade específica.

## `rebase auth login`, `emails` e `keys`

Algumas rotas respondem a uma pessoa e nunca a uma máquina: o simulador de RLS, chaves pessoais e aplicação de schema em tempo real. `rebase auth login` faz login em um app em execução — pelo navegador quando o servidor oferece login por dispositivo (device sign-in), ou com `--email` e uma senha (`--code` para um segundo fator) — e armazena a sessão em `~/.rebase/sessions.json`, por servidor, nunca no projeto. `auth whoami` indica quem o servidor reconhece que você é e os escopos que possui; `auth logout` encerra a sessão lá também.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lê a caixa de entrada de desenvolvimento que um servidor sem `SMTP_HOST` mantém em vez de enviar os e-mails; `--clear` a esvazia. Uma caixa de entrada vazia responde informando qual servidor foi consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, e `server` no JSON), já que uma resposta vazia de outro backend se parece exatamente com um e-mail que nunca foi enviado. `auth keys` gerencia suas próprias chaves `rk_`, que atuam em seu nome, restritas aos escopos especificados; o servidor responde a isso apenas quando a tabela de autenticação define `auth.personalKeys: true`. Chaves de serviço são gerenciadas via `rebase api-keys`, que também recebeu o comando `update <id>`.

## Próximos passos

- [Índice de endpoints](/docs/backend/endpoints/) — todas as rotas alcançadas por esses comandos e o escopo que cada uma requer
- [API REST](/docs/backend/api/) — a sintaxe de filtro, ordenação e paginação repassada pelo `rebase data`
- [rebase cloud](/docs/cli/cloud/) — o próprio projeto no Rebase Cloud: deploys, variáveis de ambiente, backups, acesso ao Studio
- [Referência da CLI](/docs/cli/) — todos os outros comandos
