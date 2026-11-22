---
sourceHash: eda5c036273f52d9
title: "Receita: Migrando do Supabase"
sidebar_label: Migrando do Supabase
description: "Mova um projeto do Supabase para o Rebase: faça a introspecção do esquema, aplique os objetos SQL que não são tabelas, copie os dados mantendo os IDs de usuário, porte edge functions e faça o deploy, tudo a partir da CLI."
---

## Visão geral

Isso move um projeto Supabase (tabelas, row-level security, funções e triggers
SQL, usuários, um bucket de storage, edge functions) para um projeto Rebase,
primeiro localmente e depois no [Rebase Cloud](/docs/deployment/cloud/). Tudo
é feito por comandos da CLI. Para continuar executando no banco de dados do
Supabase em vez de abandoná-lo, consulte [Supabase](/docs/deployment/existing-database/#supabase)
na página de banco de dados existente.

A ordem importa: gere as tabelas a partir da **origem**, depois aponte o
projeto para o **destino** antes que qualquer gravação ocorra.

## 1. Gerar as tabelas

Faça a introspecção do banco de dados do Supabase, ou de uma cópia local dele.
`SUPABASE_DB_URL` abaixo é sua string de conexão direta, usando a role `postgres`
(no painel do Supabase: Connect → Direct connection); defina-a no seu shell primeiro:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduz o que um banco de dados Rebase não possui nativamente:

| No Supabase | Escrito como |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: o servidor grava o ID do chamador |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, e a chave estrangeira listada em "Not carried over" |
| `auth.uid()` em uma policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | a role é removida e a regra passa a exigir um chamador autenticado / não autenticado |
| uma policy apenas `TO service_role` | removida: o código do servidor executa em seu próprio contexto |
| índices simples | os `indexes` da tabela |

Colunas de ID de usuário tornam-se `text` porque `rebase.users.id` e `rebase.uid()` são
texto: uma coluna `uuid` comparada com `rebase.uid()` em uma policy falha.

A execução termina com uma lista do que ela **não** transferiu (funções,
triggers, extensões, restrições CHECK, outros índices, chaves estrangeiras compostas)
e grava o SQL correspondente em `backend/sql/introspected-left-behind.sql`.

## 2. Apontar o projeto para o novo banco de dados

A variável `DATABASE_URL` ainda aponta para o Supabase após a etapa 1, e a saída da
introspecção alerta sobre isso. Altere-a (ou remova-a, para usar o banco de dados
de desenvolvimento gerenciado) antes do primeiro push:

```bash
rebase db push
```

## 3. Aplicar os objetos SQL

Edite `backend/sql/introspected-left-behind.sql` da mesma forma que as tabelas foram
editadas: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, sem
`GRANT … TO anon, authenticated`. Funções que chamavam `pg_net` funcionam melhor como
uma [custom function](/docs/backend/custom-functions/). Em seguida, aplique o arquivo:

```bash
psql "$DATABASE_URL" -f backend/sql/introspected-left-behind.sql
# on Rebase Cloud, with no local psql:
rebase cloud db query --file backend/sql/introspected-left-behind.sql
```

Uma função que o navegador chamava com `supabase.rpc('fn')` é declarada com
<span class="since-badge" data-since="0.35">Desde 0.35</span> [`defineRpc`](/docs/backend/rpc/), junto às tabelas. Ela é então servida em
`POST /api/rpc/<name>` e executa como o chamador sob row-level security, de modo que
uma função `SECURITY DEFINER` se comporte exatamente como no Supabase:

```ts
// backend/schema/rpc.ts, exported from backend/schema/index.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",                         // supabase's anon key; "authenticated" for signed-in only
    args: { token: json.string().required() } // validated before the function runs
});
```

```ts
// in the browser: supabase.rpc("get_public_proposal", { token })
const proposal = await rebase.rpc("get_public_proposal", { token });
```

Apenas funções declaradas podem ser chamadas, e toda função `public` tem limite de taxa (rate limit).
Uma função que realiza escritas precisa de `write: true`.

## 4. Copiar os dados, mantendo os IDs de usuário

Mantenha os IDs de usuário do Supabase para que cada `owner_id` continue apontando
para seu respectivo usuário: importe os usuários primeiro, com seus IDs, e depois
as tabelas da aplicação. O comando `rebase users import` cria as contas mantendo os IDs
originais, sem senha e sem envio de e-mails, ignorando registros cujo ID ou e-mail já
existam, permitindo que seja executado novamente. Ele se conecta ao Rebase Cloud como
qualquer outro comando `rebase users` (`--project <slug>`, ou `--cloud` em um diretório vinculado).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv
```

Ele reporta cada conta como criada, ignorada ou com falha acompanhada do motivo, e
encerra com código 1 caso haja algum erro. Consulte [Importing accounts](/docs/cli/project/#importing-accounts)
para conhecer as colunas que ele aceita (`display_name` e `roles` também).

Em seguida, copie as tabelas da aplicação com o `pg_dump` entre a origem e o
destino. `TARGET_URL` é a string de conexão do novo banco de dados: a sua
`DATABASE_URL`, ou no Rebase Cloud a `connectionString` que o comando
`rebase cloud db connect --reveal` exibe enquanto está em execução.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

As senhas não são migradas. Um usuário importado faz login por meio de um magic link,
código por e-mail ou redefinição de senha, mantendo o mesmo ID de antes.

## 5. Storage

Um bucket público do Supabase mapeia para uma fonte de [storage](/docs/backend/storage/)
com caminhos em `public/`, que são servidos sem token. Copie os objetos
usando qualquer cliente S3, preservando suas chaves.

## 6. Edge functions

Uma edge function do Deno torna-se uma [custom function](/docs/backend/custom-functions/)
em `backend/functions/`. As substituições comuns são:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` dentro do handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` ou `rebase.sql` no servidor |
| um cliente com o JWT do usuário | `getSql(c)`: SQL como o chamador, sob row-level security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([trabalho em segundo plano](/docs/backend/background-work/)) |

O Supabase permite que uma edge function execute por até 150 s; o padrão do Rebase é 30 s.
Uma função que faz chamadas a um LLM deve declarar seu próprio timeout, que o servidor
limita a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s por padrão):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Passe `getSignal(c)` para o `fetch` que chama o modelo, para que a chamada seja
interrompida caso a requisição seja cancelada. Consulte [o timeout próprio de uma função](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. E-mail de login

O login via magic link e código por e-mail requer um serviço de e-mail configurado.
Defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` (`rebase cloud env set`
no Cloud). Sem essas configurações, a rota responderá com 503, e `rebase cloud status`
reportará `blockedOn: email_not_configured`.

## 8. Deploy

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
rebase cloud db query --file backend/sql/introspected-left-behind.sql
```
