---
sourceHash: 194ea0c912d942b7
title: Um app em execução
sidebar_label: Um app em execução
description: Comandos da CLI que atuam em um app Rebase em execução por meio de sua API — linhas, usuários, cron, logs, funções, arquivos, o simulador de RLS — no rebase dev, em um servidor especificado por você ou em um projeto Rebase Cloud.
---

Esses comandos comunicam-se com um app em execução por meio de sua própria API, de modo que a segurança em nível de linha (RLS), o acesso a campos, hooks e políticas de armazenamento decidem o que eles podem fazer, assim como fazem para o SDK. Eles alcançam o `rebase dev` local, um servidor especificado por você ou um projeto Rebase Cloud, com as mesmas flags em qualquer lugar.

## Escolhendo o servidor e a credencial

| Flag | Para onde as requisições vão e como quem |
|---|---|
| *(nenhum)* | `REBASE_BASE_URL` (shell, depois `.env`), caso contrário, o `rebase dev` que este checkout está executando; com a chave de serviço do `.env` |
| `--url <server>` | Esse servidor, com a chave de serviço do `.env` |
| `--project <slug>` | Um projeto Rebase Cloud, através do proxy do Studio no console: você faz login com `rebase cloud login`, e o control plane anexa a chave do app do lado dele, para que nenhuma chave chegue à sua máquina. Proprietários e administradores da organização, em um projeto cujo acesso ao Studio esteja ativo (`rebase cloud settings set --studio on`) |
| `--cloud` | O projeto Rebase Cloud ao qual este diretório está vinculado |
| `--token <bearer>` | Envia este bearer em vez disso: uma chave `rk_` ou um token de acesso de usuário. Em um projeto Cloud, ele vai para o próprio endereço do app |
| `--session` | Envia a sessão de pessoa que o `rebase auth login` armazenou para esse servidor |
| `--anon` | Não envia nada: o que um visitante recebe |

Nada além disso é adivinhado: sem `REBASE_BASE_URL` e sem um `rebase dev` em execução, um comando se recusa a executar em vez de enviar a chave de serviço para qualquer coisa que esteja escutando em uma porta. O `rebase dev` em execução é aquele cujo processo está ativo, na porta que seu backend anunciou (`.rebase/dev.json`, caso contrário, o próprio `.rebase/state.json` do backend); `.rebase-dev-url` é para seus scripts, e uma execução encerrada abruptamente o deixa para trás, portanto nenhum comando o lê. Todos os comandos aceitam `--json` (e a saída é em JSON sempre que o stdout não for um terminal, assim como no `rebase cloud`) e `--yes`, que responde à confirmação solicitada por todas as operações destrutivas; sem um terminal, ele recusa a operação com `confirmation_required` em vez de solicitar confirmação interativa.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` aceitam as mesmas flags.

## `rebase api`

Qualquer rota servida pelo app, com a credencial do projeto — a cauda longa que não possui um comando próprio: a atualização de uma view materializada, a auditoria de RLS, `/api/meta/contract`, uma rota adicionada por um plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Um caminho sem uma `/` inicial fica sob `/api`. `-f key=value` é um campo de string e `-F` um campo tipado (`true`, `false`, `null`, números, JSON, `@file`); os campos formam a query string de um GET, HEAD ou DELETE e um corpo JSON caso contrário. Diferente do `gh api`, um campo por si só nunca transforma a requisição em um POST: uma escrita nomeia seu método ou carrega `--input`. A resposta é exibida exatamente como veio — JSON formatado (pretty-printed) — e uma resposta não-2xx é exibida e encerra com código 1. Um cabeçalho `Authorization` é recusado; as flags de destino escolhem a credencial.

## `rebase data`

As linhas de uma tabela, por meio de `/api/data`. Os filtros são os da própria API (`?status=eq.published`), repassados exatamente como escritos: `--where status=eq.published`, `--where price=gte.10` e um simples `--where status=draft` para igualdade.

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
| `count <table>` | As linhas correspondentes a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, os da própria API |
| `insert <table>` | `--data <json>` ou `--file <path\|->`; um array representa várias linhas em uma única escrita em lote; `--upsert <column>` |
| `update <table> [<id>]` | Uma linha, ou todas as linhas que `--where` corresponder após uma contagem e confirmação; `--if-match <etag>` |
| `delete <table> [<id>]` | Pede confirmação primeiro; `--hard` em uma tabela com exclusão lógica (soft-delete) |
| `import <table>` | `--file` (array JSON, NDJSON ou CSV por extensão, ou `--format`), em lotes (`--batch`); `--upsert`, `--ignore-duplicates`. O que `query --format json` grava pode ser lido de volta |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelas com histórico ativado |
| `watch <table>` | As linhas correspondentes a cada alteração, através do socket em tempo real. Não funciona pelo proxy do Studio: em um projeto Cloud, passe `--token` ou `--session` |

A chave de serviço possui o papel `admin`: a segurança em nível de linha ainda é executada, sob esse papel. Passe `--token`, `--session` ou `--anon` para visualizar a tabela como outro usuário veria.

## `rebase schema show`

As tabelas, ou as colunas, relações e segurança em nível de linha de uma tabela — de `backend/schema` por padrão, ou com `--remote` (ou qualquer flag de destino) conforme o servidor em execução as descreve para esta credencial. Uma credencial sem `schema:read` não visualiza políticas, e uma tabela que ela não puder ler não é listada.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

As contas, por meio de `/api/admin/users`, `/roles` e `/guests`. Uma conta é identificada pelo seu uid ou seu e-mail (uma correspondência exata, nunca o primeiro resultado aproximado).

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

`create` envia um convite por e-mail, ou retorna uma senha temporária uma única vez quando nenhum e-mail puder ser enviado. `--no-invite` cria a conta sem senha e não envia nada, para um app que realiza login via magic link, código por e-mail ou provedor (`POST /api/admin/users` com `invite: false`). Conceder um papel, `--disable`, `delete` e `mfa-reset` pedem confirmação primeiro. Nenhum chamador pode conceder um papel superior ao seu, ou atuar em uma conta de nível hierárquico superior. `rebase auth reset-password` é a sintaxe mais antiga e ainda recorre ao banco de dados quando o servidor não estiver em execução.

### Importando contas

`import` traz contas de outro sistema e preserva seus IDs, para que as linhas que apontam para um usuário continuem apontando para o mesmo. Ele aceita um CSV, um array JSON ou NDJSON (`--format`, caso contrário, pela extensão), com as seguintes colunas:

| Coluna | |
|---|---|
| `id` | Mantido como o ID da conta. Opcional: sem ele, a tabela de usuários gera um. Um uuid é o caso comum; letras, dígitos e `_ - . : \|` de até 128 caracteres também são aceitos, embora uma coluna de ID do tipo `uuid` aceite apenas UUIDs |
| `email` | Obrigatório |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Quando a conta foi criada lá. Opcional: agora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Opcional: `false`, e o primeiro magic link ou redefinição acessado pela conta confirma isso |
| `roles` | `editor;viewer`, um `"editor,viewer"` entre aspas, ou um array Postgres `{editor,viewer}` |

Nenhuma senha e nenhum hash é importado, e nenhum e-mail é enviado: uma conta importada faz login por magic link, código por e-mail, provedor ou redefinição de senha. Uma conta cujo ID ou e-mail já esteja em uso é reportada como ignorada e mantida como está, nunca atualizada, para que um arquivo possa ser executado novamente. Cada conta é reportada como criada, ignorada ou com falha acompanhada do motivo; o comando encerra com código 1 se alguma falhar. `--dry-run` verifica cada conta e não grava nada. A CLI envia 100 contas por requisição (`POST /api/admin/users/import`), igualmente no `rebase dev`, em um servidor ou em um projeto Rebase Cloud.

Do Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

As tarefas agendadas do app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sobrescrevem o código da tarefa em todos os processos, entre redeploys; `run` pede confirmação primeiro, e `--async` retorna assim que a execução é iniciada. Em um projeto Cloud, `rebase cron` não precisa de acesso ao Studio para leituras: ele solicita ao control plane um token de plataforma `cron:read` de curta duração, que qualquer membro com acesso aos logs possui. `run`, `enable`, `disable` e `reset` solicitam `cron:write`, que um proprietário ou administrador da organização possui em um projeto com o Studio ativo. `rebase cloud cron` é a sintaxe mais antiga, apenas de leitura.

## `rebase logs`

O log de requisições e da aplicação do servidor — o buffer que o Logs Explorer do Studio lê — uma vez, ou acompanhado em tempo real com `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

O buffer pertence a um único processo. Com `--project` ou `--cloud`, este comando equivale a `rebase cloud logs --runtime`: a saída de cada réplica, por meio do control plane.

## `rebase functions`

As rotas próprias do app, uma por arquivo em `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` aceita os campos, corpo e cabeçalhos que o `rebase api` aceita, e exibe a resposta da forma como veio. As funções definem seu próprio acesso, portanto a credencial importa: `--anon` mostra o que um visitante recebe.

## `rebase storage`

Arquivos armazenados, por meio das políticas de armazenamento. O lado armazenado começa com dois-pontos: `:avatars/me.png` na fonte padrão, `media:avatars/me.png` na fonte de chave `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` faz upload sob o prefixo público (uma URL permanente, sem token), `--content-type` define o tipo e `--force` sobrescreve um arquivo local no download. `orphans` e `move` formam a parte do grupo voltada à manutenção de todo o armazenamento.

## `rebase rls simulate`

O que outra identidade veria, a partir do simulador de RLS do app — o mesmo que o "view as" do Studio utiliza: por tabela, as linhas que ela lê em comparação com as linhas que você lê, as tabelas das quais seus escopos a bloqueiam e as colunas que ela não pode ler. Somente leitura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

O simulador responde à sessão própria de um administrador e nunca a uma chave, portanto isso envia a sessão armazenada pelo `rebase auth login`. O `rebase verify --live` verifica as políticas em si, sem nenhuma identidade em mente.

## `rebase auth login`, `emails` e `keys`

Algumas rotas respondem a uma pessoa e nunca a uma máquina: o simulador de RLS, chaves pessoais, aplicação de esquema ao vivo. O `rebase auth login` autentica em um app em execução — pelo navegador quando o servidor oferece login por dispositivo, caso contrário com `--email` e uma senha (`--code` para um segundo fator) — e mantém a sessão em `~/.rebase/sessions.json`, por servidor, nunca no projeto. `auth whoami` informa quem o servidor reconhece que você é e os escopos que você possui; `auth logout` encerra a sessão nele também.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

O `auth emails` lê a caixa de entrada de desenvolvimento que um servidor sem `SMTP_HOST` mantém em vez de enviar e-mails; `--clear` esvazia a caixa. Uma caixa de correio vazia é respondida indicando o servidor consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, e `server` no JSON), já que uma resposta vazia de outro backend se parece exatamente com um e-mail que nunca foi enviado. `auth keys` gerencia suas próprias chaves `rk_`, que agem como você, restritas aos escopos especificados; o servidor responde a isso apenas quando a tabela de autenticação define `auth.personalKeys: true`. Chaves de serviço ficam em `rebase api-keys`, que também ganhou o `update <id>`.

## Próximos passos

- [Índice de endpoints](/docs/backend/endpoints/) — cada rota acessada por esses comandos e o escopo que cada uma requer
- [API REST](/docs/backend/api/) — a sintaxe de filtro, ordenação e paginação repassada pelo `rebase data`
- [rebase cloud](/docs/cli/cloud/) — o projeto em si no Rebase Cloud: deploys, ambiente, backups, acesso ao Studio
- [Referência da CLI](/docs/cli/) — todos os outros comandos
