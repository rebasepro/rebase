---
sourceHash: f6e7c705c409b9aa
title: Um app em execução
sidebar_label: Um app em execução
description: Comandos da CLI que atuam em um app Rebase em execução por meio de sua API — linhas, usuários, cron, logs, funções, arquivos, o simulador de RLS — no rebase dev, em um servidor especificado ou em um projeto Rebase Cloud.
---

Esses comandos comunicam-se com um app em execução por meio de sua própria API, portanto, a segurança em nível de linha (RLS), o acesso a campos, hooks e políticas de armazenamento decidem o que eles podem fazer, assim como fazem para o SDK. Eles alcançam o `rebase dev` local, um servidor especificado por você ou um projeto do Rebase Cloud, com as mesmas flags em qualquer lugar.

## Escolhendo o servidor e a credencial

| Flag | Para onde as requisições vão e como quem |
|---|---|
| *(nenhuma)* | `REBASE_BASE_URL` (shell, depois `.env`), caso contrário, o `rebase dev` que este checkout está executando; com a chave de serviço do `.env` |
| `--url <server>` | Esse servidor, com a chave de serviço do `.env` |
| `--project <slug>` | Um projeto do Rebase Cloud, por meio do proxy do Studio no console: você faz login com `rebase cloud login`, e o plano de controle anexa a chave do app do lado dele, para que nenhuma chave chegue à sua máquina. Proprietários e administradores da organização, em um projeto com o acesso ao Studio ativado (`rebase cloud settings set --studio on`) |
| `--cloud` | O projeto do Rebase Cloud ao qual este diretório está vinculado |
| `--token <bearer>` | Envia este bearer em vez disso: uma chave `rk_` ou o token de acesso de um usuário. Em um projeto Cloud, vai para o próprio endereço do app |
| `--session` | Envia a sessão de pessoa que o `rebase auth login` armazenou para aquele servidor |
| `--anon` | Não envia nada: o que um visitante recebe |

Nada mais é presumido: sem `REBASE_BASE_URL` e sem um `rebase dev` em execução, o comando recusa a execução em vez de enviar a chave de serviço para o que quer que esteja escutando em uma porta. O `rebase dev` em execução é aquele cujo processo está ativo, na porta anunciada pelo seu backend (`.rebase/dev.json`, caso contrário o próprio `.rebase/state.json` do backend); `.rebase-dev-url` é para seus scripts, e uma execução encerrada o deixa para trás, de modo que nenhum comando o lê. Cada comando aceita `--json` (e a saída é em JSON sempre que o stdout não for um terminal, como acontece no `rebase cloud`) e `--yes`, que responde à confirmação exigida por comandos destrutivos; sem terminal, ele recusa com `confirmation_required` em vez de solicitar confirmação no prompt.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` aceitam as mesmas flags.

## `rebase api`

Qualquer rota servida pelo app, com a credencial do projeto — a cauda longa que não possui um comando próprio: a atualização de uma view materializada, a auditoria de RLS, `/api/meta/contract`, uma rota adicionada por um plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Um caminho sem uma `/` inicial fica sob `/api`. `-f key=value` é um campo de texto e `-F` é um campo tipado (`true`, `false`, `null`, números, JSON, `@file`); os campos formam a query string de um GET, HEAD ou DELETE e um corpo JSON nos demais casos. Diferente de `gh api`, um campo sozinho nunca transforma a requisição em um POST: uma escrita especifica seu método ou utiliza `--input`. A resposta é exibida exatamente como retornou — JSON formatado — e uma resposta não-2xx é exibida e encerra com código 1. Um cabeçalho `Authorization` é recusado; as flags de destino escolhem a credencial.

## `rebase data`

As linhas de uma tabela, via `/api/data`. Os filtros são os da própria API (`?status=eq.published`), repassados como escritos: `--where status=eq.published`, `--where price=gte.10` e simplesmente `--where status=draft` para igualdade.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetível), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` percorre todas as páginas; `--format table\|json\|ndjson\|csv` (csv e ndjson transmitem em stream com `--all`) |
| `get <table> <id>` | Uma linha, com `--fields` e `--include` |
| `count <table>` | As linhas correspondentes a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, os da própria API |
| `insert <table>` | `--data <json>` ou `--file <path\|->`; um array representa várias linhas em uma única escrita em lote; `--upsert <column>` |
| `update <table> [<id>]` | Uma linha, ou todas as linhas correspondentes a `--where` após uma contagem e uma confirmação; `--if-match <etag>` |
| `delete <table> [<id>]` | Pede confirmação primeiro; `--hard` em uma tabela com soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON ou CSV por extensão, ou `--format`), em lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lê de volta o que `query --format json` grava |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelas com histórico ativado |
| `watch <table>` | As linhas correspondentes a cada alteração, através do socket de tempo real. Não passa pelo proxy do Studio: em um projeto Cloud, passe `--token` ou `--session` |

A chave de serviço possui a role `admin`: a segurança em nível de linha (RLS) continua em execução, como essa role. Passe `--token`, `--session` ou `--anon` para ver a tabela como outra pessoa veria.

## `rebase schema show`

As tabelas, ou as colunas, relações e segurança em nível de linha de uma tabela — de `backend/schema` por padrão, ou com `--remote` (ou qualquer flag de destino) conforme o servidor em execução as descreve para esta credencial. Uma credencial sem `schema:read` não vê nenhuma política, e uma tabela que ela não pode ler não é listada.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

As contas, através de `/api/admin/users`, `/roles` e `/guests`. Uma conta é identificada por seu uid ou email (uma correspondência exata, nunca o primeiro resultado aproximado).

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

`create` envia um convite por e-mail, ou retorna uma senha temporária única quando nenhum e-mail puder ser enviado. `--no-invite` cria a conta sem senha e não envia nada, para um app que faz login por magic link, código por e-mail ou provedor (`POST /api/admin/users` com `invite: false`). A atribuição de uma role, `--disable`, `delete` e `mfa-reset` solicitam confirmação primeiro. Nenhum chamador pode atribuir uma role superior à sua própria ou agir sobre uma conta com nível hierárquico superior ao seu. `rebase auth reset-password` é a sintaxe mais antiga e ainda recorre diretamente ao banco de dados quando o servidor não está em execução.

### Importando contas

`import` traz contas de outro sistema e mantém seus IDs, para que as linhas que apontam para um usuário continuem apontando para o mesmo. Ele aceita um CSV, um array JSON ou NDJSON (`--format`, caso contrário a extensão), com as seguintes colunas:

| Coluna | |
|---|---|
| `id` | Mantido como o id da conta. Opcional: sem ele, a tabela de usuários gera um. Um uuid é o caso comum; letras, dígitos e `_ - . : \|` de até 128 caracteres também são aceitos, embora uma coluna id do tipo `uuid` aceite apenas uuids |
| `email` | Obrigatório |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Quando a conta foi criada lá. Opcional: agora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Opcional: `false`, e o primeiro magic link ou link de redefinição que a conta acessar irá confirmá-lo |
| `roles` | `editor;viewer`, entre aspas `"editor,viewer"`, ou um array Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | O hash que o outro sistema armazenou. Lido apenas com `--password-hashes bcrypt`; sem a flag, um arquivo que contenha esta coluna é recusado antes de qualquer envio |

Nenhum e-mail é enviado. Com `--password-hashes bcrypt`, uma conta cuja linha possua um hash faz login com a senha que tinha anteriormente, e seu primeiro login substitui o hash pelo hash nativo do Rebase. Qualquer outra conta importada faz login por magic link, código por e-mail, um provedor ou redefinição de senha. Uma senha em texto puro nunca é importada. Uma conta cujo id ou email já esteja em uso é reportada como ignorada (skipped) e mantida como está, nunca atualizada, para que o arquivo possa ser executado novamente. Cada conta é reportada como criada, ignorada ou com falha, com o respectivo motivo; o comando encerra com código 1 se houver alguma falha. `--dry-run` verifica cada conta sem gravar nada. A CLI envia 100 contas por requisição (`POST /api/admin/users/import`), funcionando da mesma forma no `rebase dev`, em um servidor ou em um projeto Rebase Cloud.

A partir do Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` conterá o hash de senha de todas as contas: exclua-o assim que a importação for concluída.

## `rebase cron`

Os jobs agendados do app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sobrescrevem o código do job em todos os processos, persistindo entre novos deploys; `run` pede confirmação primeiro, e `--async` retorna assim que a execução foi iniciada. Em um projeto Cloud, `rebase cron` não precisa de acesso ao Studio para leituras: ele solicita ao plano de controle um token de plataforma `cron:read` de curta duração, que qualquer membro com acesso aos logs possui. `run`, `enable`, `disable` e `reset` exigem `cron:write`, que o proprietário ou administrador da organização possui em projetos com o Studio ativado. `rebase cloud cron` é a sintaxe mais antiga, somente leitura.

## `rebase logs`

Os logs de requisições e da aplicação do servidor — o buffer que a visualização Logs do Studio lê — de uma só vez ou acompanhado em tempo real com `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

O buffer pertence a um único processo. Com `--project` ou `--cloud`, isso equivale a `rebase cloud logs --runtime`: a saída de cada réplica, por meio do plano de controle.

## `rebase functions`

As rotas próprias do app, uma por arquivo em `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` aceita os campos, corpo e cabeçalhos que `rebase api` aceita, e exibe a resposta exatamente como veio. As funções decidem seu próprio acesso, portanto a credencial importa: `--anon` mostra o que um visitante recebe.

## `rebase storage`

Arquivos armazenados, através das políticas de armazenamento. O lado armazenado começa com dois-pontos: `:avatars/me.png` na fonte padrão, `media:avatars/me.png` na fonte identificada como `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` faz o upload sob o prefixo público (uma URL permanente, sem necessidade de token), `--content-type` define o tipo e `--force` sobrescreve um arquivo local no download. `orphans` e `move` representam a parte de manutenção global do armazenamento.

## `rebase rls simulate`

O que outra identidade veria, a partir do simulador de RLS do app — o mesmo que a opção "view as" do Studio usa: por tabela, as linhas que ela lê em comparação com as linhas que você lê, as tabelas às quais seus escopos bloqueiam o acesso e as colunas que ela não pode ler. Somente leitura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

O simulador responde à sessão do próprio administrador e nunca a uma chave, portanto isso envia a sessão armazenada por `rebase auth login`. `rebase verify --live` verifica as políticas em si, sem considerar nenhuma identidade específica.

## `rebase auth login`, `emails` e `keys`

Algumas rotas respondem a uma pessoa e nunca a uma máquina: o simulador de RLS, chaves pessoais, aplicação de schema em tempo real. `rebase auth login` faz login em um app em execução — através do navegador quando o servidor oferece login por dispositivo, caso contrário com `--email` e uma senha (`--code` para um segundo fator) — e mantém a sessão em `~/.rebase/sessions.json`, por servidor, nunca no projeto. `auth whoami` indica quem o servidor reconhece que você é e os escopos que você possui; `auth logout` também encerra a sessão por lá.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lê a caixa de entrada de desenvolvimento que um servidor sem `SMTP_HOST` mantém em vez de enviar e-mails; `--clear` a esvazia. Uma caixa de correio vazia é respondida identificando o servidor consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.` e `server` no JSON), já que uma resposta vazia de outro backend se parece exatamente com um e-mail que nunca foi enviado. `auth keys` gerencia suas próprias chaves `rk_`, que atuam como você, restritas aos escopos especificados; o servidor responde a isso apenas quando a tabela de autenticação define `auth.personalKeys: true`. Chaves de serviço ficam em `rebase api-keys`, que também recebeu `update <id>`.

## `rebase mcp`

Conecte um cliente de IA ao endpoint MCP próprio de um app em execução (`/mcp`), onde um agente faz login como uma pessoa e fica sujeito à segurança em nível de linha dessa pessoa:

```bash
rebase mcp connect                        # pick the clients from a list
rebase mcp connect --client claude-code   # or name them: claude-code, cursor, vscode, claude, chatgpt, all
rebase mcp connect --print                # print every way to connect, change nothing
rebase mcp url                            # the endpoint's URL
```

| Flag | Descrição |
|------|-------------|
| `--client <names>` | Pula a seleção interativa. Separados por vírgula, ou `all` |
| `--name <name>` | O nome sob o qual registrar o servidor. Padrão: o nome do projeto, com `-local` para um servidor de desenvolvimento |
| `--print` | Imprime a URL, o comando do Claude Code e os links de instalação, sem alterar nada |
| `--url <server>` | O backend neste endereço. Padrão: `REBASE_BASE_URL`, caso contrário o `rebase dev` em execução |
| `--cloud` | O projeto do Rebase Cloud ao qual este diretório está vinculado |
| `--json` | Saída legível por máquina |

`rebase mcp url` aceita `--url`, `--cloud` e `--json`. O que cada cliente faz com a URL está em [Conectando um cliente](/docs/ai/remote-mcp/#connecting-a-client). Este não é o servidor MCP de desenvolvimento em `.mcp.json`, configurado por `rebase skills install --mcp`.

## Próximos passos

- [Índice de endpoints](/docs/backend/endpoints/) — todas as rotas alcançadas por esses comandos e o escopo necessário para cada uma
- [API REST](/docs/backend/api/) — a sintaxe de filtro, ordenação e paginação repassada pelo `rebase data`
- [rebase cloud](/docs/cli/cloud/) — o próprio projeto no Rebase Cloud: deploys, ambiente, backups, acesso ao Studio
- [Referência da CLI](/docs/cli/) — todos os outros comandos
