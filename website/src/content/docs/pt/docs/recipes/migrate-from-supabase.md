---
sourceHash: 76cb1578ad9289ff
title: "Receita: Migrando do Supabase"
sidebar_label: Migrando do Supabase
description: "Mova um projeto Supabase para o Rebase: faça a introspecção do esquema, aplique os objetos SQL que não são tabelas, copie os dados mantendo os IDs de usuário, porte as edge functions e faça o deploy, tudo a partir da CLI."
---

## Visão Geral

Isto move um projeto Supabase (tabelas, segurança em nível de linha [row-level security], funções e
gatilhos SQL, usuários, um bucket de armazenamento, edge functions) para um projeto Rebase,
localmente primeiro e depois no [Rebase Cloud](/docs/deployment/cloud/). Tudo
é feito via comando CLI. Para continuar executando no banco de dados do Supabase em vez de
abandoná-lo, consulte [Supabase](/docs/deployment/existing-database/#supabase) na
página de banco de dados existente.

A ordem importa: gere as tabelas a partir da **origem**, depois aponte o
projeto para o **destino** antes que qualquer coisa faça alterações de escrita.

## 1. Gerar as tabelas

Faça a introspecção do banco de dados do Supabase, ou de uma cópia local dele. `SUPABASE_DB_URL`
abaixo é sua string de conexão direta, como a role `postgres` (dashboard do Supabase:
Connect → Direct connection); defina-a no seu shell primeiro:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduz o que um banco de dados Rebase não possui:

| No Supabase | Escrito como |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: o servidor grava o id do chamador |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, e a chave estrangeira listada em "Not carried over" |
| `auth.uid()` em uma política | `rebase.uid()` |
| `TO authenticated` / `TO anon` | a role é removida e a regra requer um chamador autenticado (signed-in) / não autenticado (signed-out) |
| uma política apenas `TO service_role` | descartada: o código do servidor é executado no próprio contexto do servidor |
| índices simples | os `indexes` da tabela |

Colunas de ID de usuário se tornam `text` porque `rebase.users.id` e `rebase.uid()` são
text: uma coluna `uuid` comparada com `rebase.uid()` em uma política falha.

A execução termina com uma lista do que **não** foi transferido (funções,
gatilhos, extensões, restrições CHECK, outros índices, chaves estrangeiras compostas)
e grava o SQL de cada um em `backend/sql/_introspected-left-behind.sql`, um
rascunho que o `rebase db push` não aplica até que você o renomeie.

## 2. Apontar o projeto para o novo banco de dados

`DATABASE_URL` ainda aponta para o Supabase após a etapa 1, e a saída da introspecção
informa isso. Altere-a (ou remova-a, para usar o banco de dados de desenvolvimento gerenciado)
antes do primeiro push:

```bash
rebase db push
```

## 3. Aplicar os objetos SQL

Edite `backend/sql/_introspected-left-behind.sql` da mesma forma que as tabelas foram
editadas: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, sem
`GRANT … TO anon, authenticated`. Funções que chamavam `pg_net` funcionam melhor como uma
[função customizada](/docs/backend/custom-functions/). Torne cada instrução segura para
ser executada novamente (`DROP TRIGGER IF EXISTS` antes de cada `CREATE TRIGGER`), renomeie
o arquivo sem o `_` inicial e faça o push:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

O `rebase db push` aplica cada arquivo `.sql` em `backend/sql` em ordem alfabética de nome, após
as tabelas e antes das políticas, e registra cada um por hash em
`rebase.sql_files`, para que um arquivo só seja executado novamente quando for modificado. Um deploy os
aplica da mesma forma (etapa 8).

Uma função que o navegador chamava com `supabase.rpc('fn')` é declarada com
[`defineRpc`](/docs/backend/rpc/), ao lado das tabelas. Ela é então servida em
`POST /api/rpc/<name>` e roda como o chamador sob row-level security, de modo que uma
função `SECURITY DEFINER` se comporte como fazia no Supabase:

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

Apenas funções declaradas podem ser chamadas, e cada uma do tipo `public` possui rate limit.
Uma função que realiza escritas precisa de `write: true`.

## 4. Copiar os dados, mantendo os IDs de usuário

Mantenha os IDs de usuário do Supabase para que cada `owner_id` continue apontando para o seu usuário:
importe os usuários primeiro, com seus IDs, e depois as tabelas da aplicação.
O comando `rebase users import` cria as contas com os IDs que elas tinham, com seus
hashes de senha do Supabase quando você passa `--password-hashes bcrypt`, não envia
e-mails e ignora contas cujo ID ou e-mail já existam, permitindo que seja executado
novamente. Ele alcança o Rebase Cloud como qualquer outro comando `rebase users`
(`--project <slug>`, ou `--cloud` em um diretório vinculado).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt
rm users.csv
```

Ele reporta cada conta como criada, ignorada ou falha com o motivo, e
retorna código 1 quando houver falhas. Consulte [Importando contas](/docs/cli/project/#importing-accounts)
para conhecer as colunas que ele lê (`display_name` e `roles` também).

Em seguida, as tabelas da aplicação, com o `pg_dump` apontando para a origem e o
destino. `TARGET_URL` é a string de conexão do novo banco de dados: sua
`DATABASE_URL`, ou no Rebase Cloud a `connectionString` que
`rebase cloud db connect --reveal` exibe enquanto estiver em execução.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

As senhas são transferidas como hashes. O Supabase armazena bcrypt em
`auth.users.encrypted_password`, então cada usuário faz login com a senha que
já possui, com o mesmo ID de antes, e seu primeiro login substitui o
hash pelo padrão do próprio Rebase. Uma conta que não possuía senha (magic link, um
provedor OAuth) tem um `encrypted_password` vazio e faz login da mesma forma que antes. Omita
a coluna e a flag para importar sem senhas: esses usuários farão login
com um magic link, um código por e-mail ou redefinição de senha.

## 5. Storage

Um bucket público do Supabase mapeia para uma fonte de [storage](/docs/backend/storage/)
com caminhos sob `public/`, que são servidos sem token. Copie os objetos
usando qualquer cliente S3, mantendo suas chaves.

## 6. Edge functions

Uma edge function em Deno torna-se uma [função customizada](/docs/backend/custom-functions/)
em `backend/functions/`. As substituições habituais:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` dentro do handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` ou `rebase.sql` no servidor |
| um cliente com o JWT do usuário | `getSql(c)`: SQL como o chamador, sob row-level security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([tarefas em segundo plano](/docs/backend/background-work/)) |

O Supabase permite que uma edge function execute por até 150 s; o padrão do Rebase é de 30 s. Uma
função que faz chamadas a um LLM declara seu próprio timeout, o qual o servidor limita a
`REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s por padrão):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Passe `getSignal(c)` para o `fetch` que chama o modelo, para que a chamada seja interrompida
quando a requisição for cancelada. Consulte [o timeout próprio de uma função](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. E-mail de login

O login por magic link e por código de e-mail requer um serviço de e-mail. Defina `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` (`rebase cloud env set`
no Cloud). Sem eles, a rota responde com 503, e `rebase cloud status`
reporta `blockedOn: email_not_configured`.

## 8. Deploy

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

O deploy aplica `backend/sql` da mesma forma que o `rebase db push`: o bundle transporta
os arquivos, e a inicialização da nova revisão executa cada arquivo novo ou modificado uma única vez, após
as tabelas e antes das políticas. Um arquivo que falhar interrompe a inicialização e exibe
o nome do arquivo, de forma que um erro em um deles apareça no deploy, e não em uma aplicação em execução.
