---
sourceHash: c423ff16c60af471
title: Apenas backend (headless)
sidebar_label: Apenas backend
description: Execute o Rebase como um Backend-as-a-Service headless sobre o seu próprio PostgreSQL — uma API REST, autenticação, armazenamento e tempo real, sem painel de administração e sem backend/schema.
---

O Rebase tem dois formatos, e esta página trata daquele que nunca abre um navegador: uma
API REST, autenticação, armazenamento, tempo real e backups sobre um banco de dados PostgreSQL
que você já possui. Sem painel de administração, sem `backend/schema/`. Se você estava
pensando em Supabase ou PostgREST, esta é a alternativa comparável.

Tudo nesta página também funciona no projeto completo — é o mesmo servidor.
O que o `--headless` remove é o pacote de frontend e os arquivos de tabelas, não
uma funcionalidade.

## Crie o scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Um workspace, sem `frontend/`:

| Pasta | O que contém |
|-------|--------------|
| `backend/` | `storage.ts` (`storageAuthorize`), suas funções personalizadas e crons, e o `backend/schema/` que o `--introspect` grava, quando você solicita. Não há arquivo de servidor — o runtime publicado inicializa o projeto |

O `--template` não tem efeito aqui: um preset popula tabelas, e esta variação
não possui nenhuma. Node 22.22+, o mesmo requisito mínimo do projeto completo — o `package.json`
do overlay headless declara `"node": ">=22.22.0"` e substitui o que
está abaixo dele.

## Aponte para o seu banco de dados

O `init` gera um `.env` pronto para execução. Para usar um banco de dados que você já executa, passe
a URL dele no momento do scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou defina `DATABASE_URL` no `.env` depois — dá no mesmo. Sem
`DATABASE_URL`, o `rebase dev` inicia um PostgreSQL gerenciado (PGlite) no diretório
do projeto, o que é útil para testar a API, mas não é a finalidade
desta variação.

Depois:

```bash
pnpm install
pnpm run dev
```

**Leia a URL na saída.** O `rebase dev` deriva uma porta livre a partir do
caminho do projeto em vez de usar uma fixa, portanto ela varia entre projetos e
entre máquinas.

## De onde vêm as tabelas

Não há nenhuma no código: sem `backend/schema/index.ts`, o backend não declara tabelas. O servidor lê o esquema do seu banco de dados na inicialização e serve
as tabelas que encontrar, de modo que a API acompanha suas migrações: altere o esquema e
os endpoints mudarão junto.

Uma tabela é servida assim que o row-level security for habilitado nela. Sem nenhuma política, ela
é servida e não retorna nenhuma linha, e a inicialização emite um aviso sobre isso; uma política a libera:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` são instalados pelo Rebase e
leem a identidade da requisição autenticada. Consulte
[Row-level security](/docs/collections/security-rules/) para o vocabulário de políticas,
e [rls-check](/docs/rls-check/) para uma auditoria do que suas políticas realmente
permitem.

Uma tabela sem RLS é **ignorada**, deliberadamente: toda requisição autenticada
é executada como `rebase_user`, portanto servir uma tabela que a segurança em nível de linha não protege
entregaria todas as linhas a qualquer chamador autenticado. Cada tabela ignorada é listada na inicialização juntamente com o SQL
necessário para protegê-la.

Uma tabela de junção não é servida de nenhuma forma: ela é lida como a ligação entre as duas
tabelas que conecta. Uma tabela de junção com RLS desativado também é listada na inicialização.

A verificação é executada na inicialização. Se o RLS for desativado em uma tabela servida posteriormente, ela continuará
sendo servida até que a próxima inicialização a ignore. A [auditoria agendada](/docs/rls-check/)
reporta isso mais cedo, e fica desativada por padrão.

:::note
`baas: { unprotectedTables: "serve" }` as serve mesmo assim. É uma
opção de `initializeRebaseBackend`, portanto só é acessível após `rebase eject` —
o runtime gerenciado não a lê de nenhum arquivo nem do ambiente. Só faz sentido quando todos os chamadores já são confiáveis.
:::

### Gerando arquivos de tabelas em vez disso

Se preferir ter as tabelas descritas em TypeScript — para tipos, para
hooks, para revisão —, faça a introspecção delas:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

O `--introspect` implica `--template blank` e precisa de `--install`, porque ele é executado
contra a CLI instalada. Em um projeto existente, o equivalente é:

```bash
pnpm rebase schema introspect
```

Os arquivos vão para `backend/schema/`: um `defineTable` por tabela, com suas colunas,
relações e suas políticas como `rls`, além de um `index.ts` exportando-as. A partir
desse ponto, o projeto passa a ter tabelas no código e a introspecção em tempo de inicialização deixa de
ser o que define a API.

O scaffold headless
instala o Atlas em `backend/`, portanto `rebase db push`, `rebase db generate`
e `pnpm run db:migrate` funcionam nessas tabelas como em qualquer projeto.

## Como usar

Via HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou com o cliente type-safe, que já é uma dependência do scaffold headless:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [API REST](/docs/backend/api/) — os formatos de endpoint, filtros e erros
- [SDK Tipado](/docs/sdk/) — consultas, autenticação, tempo real, armazenamento
- `/api/docs` — o documento OpenAPI, servido pelo backend em execução assim que
  ele servir uma tabela, para um chamador autenticado (as tabelas que ele pode ver). Defina
  `REBASE_ENABLE_SWAGGER=true` para publicá-lo para todos, com a Swagger UI
  em `/api/swagger` fora de produção. Um projeto sem tabelas não serve
  nenhum dos dois: o documento é gerado a partir das tabelas

## `404 NO_TABLES`

Se todas as requisições de dados responderem com isto:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

então o projeto não declara tabelas no código *e* o banco de dados não
forneceu nada para servir. Antes da versão 0.31, o código era `NO_COLLECTIONS`. Essa é a primeira resposta esperada de um
projeto headless apontado para um banco de dados vazio, e é um 404 em vez de um 500 porque
nada está quebrado — simplesmente ainda não há nada para servir.

Três coisas resolvem isso, na ordem em que vale a pena verificar:

1. **O banco de dados não tem tabelas.** Crie-as — uma migração, SQL puro ou um
   arquivo `defineTable` mais `rebase db push` — e reinicie.
2. **As tabelas não estão com row-level security habilitado**, portanto a inicialização as ignorou.
   O log de inicialização lista cada uma delas, com o SQL. Habilite-o e adicione uma política,
   conforme mostrado acima. A resposta também indica isso: sua mensagem cita as tabelas e fornece o
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` para elas, e
   `details.unprotectedTables` as lista.
3. **O `DATABASE_URL` aponta para outro lugar** diferente do que você pensa. O `rebase status`
   exibe os três arquivos que decidem o que o backend acessa.

## Adicionando um painel de administração mais tarde

Nada aqui impede você de fazer isso. Um único comando adiciona o diretório `frontend/` que
o `rebase init` sem `--headless` teria criado, com seu workspace e
sua aplicação no `rebase.json`:

```bash
pnpm rebase apps add admin               # at /, or at /admin when another app is at /
pnpm rebase apps add admin --path /admin
pnpm install
pnpm run dev
```

Ele cria o que o `rebase init` sem `--headless` criaria, a partir dos mesmos
modelos:

- `frontend/`, com `rebaseBackendGuard()` em sua configuração do Vite. O admin renderiza
  todas as tabelas servidas pelo backend, a partir de `GET /api/schema/tables`, sem a necessidade de um arquivo por
  tabela; a customização de `users` só vem junto quando
  `backend/schema/users.ts` declara a tabela de autenticação assim como o scaffold faz. As
  customizações do próprio painel ficam em `frontend/src/cms/`.
- a aplicação `admin` no `rebase.json`, com `cms` em seu caminho e um comando de build
  no gerenciador de pacotes do projeto. Um projeto sem `rebase.json` recebe um.
- `frontend` no `workspaces` do `package.json` e no `pnpm-workspace.yaml`.
- com tabelas no código (`backend/schema/index.ts`, manualmente ou a partir de
  `rebase schema introspect`), os scripts `db:push`, `db:generate` e
  `schema:generate` do scaffold, o build do backend que executa
  `rebase schema generate` primeiro, e o `ts-morph`. Um script que você alterou é mantido
  e identificado.

Todo pacote `@rebasepro/*` é fixado na versão que o projeto já utiliza
(com prioridade para o `@rebasepro/server`), e não na versão da CLI. Um projeto que fixa apenas
especificadores `link:` ou `workspace:` recebe a versão da CLI e é avisado sobre isso.

A operação é recusada quando `frontend/` já existe, quando uma aplicação já se chama `admin` ou
declara o CMS, ou quando `--path` já está ocupado ou não é um caminho no qual uma aplicação possa ser
servida. Uma recusa não altera nada, assim como uma gravação que falhe no
meio do caminho: todos os arquivos são restaurados. Com `--json`, ele exibe o que gravou ou o
envelope de erro. Consulte [Frontend Setup](/docs/frontend/) para obter detalhes sobre o frontend em si.

## Próximos passos

- [Autenticação](/docs/backend/authentication/) — provedores, tokens, chaves de API
- [Row-level security](/docs/collections/security-rules/) — o modelo de acesso
- [Funções personalizadas](/docs/backend/custom-functions/) — suas próprias rotas
- [Implantação](/docs/getting-started/deployment/) — levando para produção
