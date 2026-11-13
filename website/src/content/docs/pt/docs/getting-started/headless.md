---
sourceHash: 9cda7971a27b0475
title: Apenas backend (headless)
sidebar_label: Apenas backend
description: Execute o Rebase como um Backend-as-a-Service headless sobre seu próprio PostgreSQL — uma API REST, autenticação, armazenamento e realtime, sem painel administrativo e sem backend/schema.
---

O Rebase tem dois formatos, e esta página trata daquele que nunca abre um
navegador: uma API REST, autenticação, armazenamento, realtime e backups sobre um
banco de dados PostgreSQL que você já possui. Sem painel administrativo, sem `backend/schema/`. Se
você estava procurando pelo Supabase ou PostgREST, esta é a opção comparável.

Tudo nesta página também funciona no projeto completo — é o mesmo servidor.
O que a flag `--headless` remove é o pacote de frontend e os arquivos de tabela,
não uma funcionalidade.

## Crie o scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Um workspace, sem `frontend/`:

| Pasta | O que contém |
|--------|---------------|
| `backend/` | `storage.ts` (`storageAuthorize`), suas funções personalizadas e crons, e o `backend/schema/` que `--introspect` gera, quando solicitado. Não há arquivo de servidor — o runtime publicado inicializa o projeto |

`--template` não tem efeito aqui: um preset popula tabelas iniciais, e esta variação
não tem nenhuma. Node 22.22+, o mesmo requisito mínimo do projeto completo — o
`package.json` do overlay headless declara `"node": ">=22.22.0"` e substitui o que
está abaixo dele.

## Aponte para o seu banco de dados

O `init` gera um `.env` pronto para execução. Para usar um banco de dados que você já executa,
passe sua URL no momento da criação do scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou defina `DATABASE_URL` no `.env` posteriormente — é a mesma coisa. Sem
`DATABASE_URL`, o `rebase dev` inicia um PostgreSQL gerenciado (PGlite) no diretório
do projeto, o que é útil para testar a API, mas não é a finalidade principal desta
variação.

Em seguida:

```bash
pnpm install
pnpm run dev
```

**Veja a URL na saída do terminal.** O `rebase dev` obtém uma porta livre a partir do
caminho do projeto em vez de usar uma fixa, portanto ela varia entre projetos e
entre máquinas.

## De onde vêm as tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Não há nenhuma no código: sem `backend/schema/index.ts`, o backend não declara tabelas. O servidor lê o schema do seu banco de dados na inicialização e disponibiliza
as tabelas que encontra, para que a API acompanhe suas migrações: altere o schema e
os endpoints mudam junto.

Uma tabela é disponibilizada assim que a segurança a nível de linha (RLS) for habilitada nela. Sem nenhuma política, ela
é servida, mas não retorna linhas, e a inicialização emite um aviso sobre isso; uma política a abre:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` são instalados pelo Rebase e
leem a identidade da requisição autenticada. Consulte
[Segurança a nível de linha](/docs/collections/security-rules/) para conhecer o vocabulário de políticas,
e [rls-check](/docs/rls-check/) para obter uma auditoria do que suas políticas realmente
permitem.

Uma tabela sem RLS é **ignorada**, deliberadamente: cada requisição autenticada
é executada como `rebase_user`, portanto servir uma tabela que a segurança a nível de linha não protege
entregaria todas as linhas para qualquer chamador autenticado. Cada tabela ignorada é listada na inicialização juntamente com o SQL
necessário para protegê-la.

Uma tabela de junção (join table) não é servida diretamente de nenhuma forma: ela é interpretada como a ligação entre as duas
tabelas que une. Uma com RLS desativado também é listada na inicialização.

A verificação é feita na inicialização. Se o RLS for desativado em uma tabela servida posteriormente, ela continuará
sendo servida até que a próxima inicialização a ignore. A [auditoria agendada](/docs/rls-check/)
relata isso com mais antecedência, e vem desativada por padrão.

:::note
`baas: { unprotectedTables: "serve" }` as disponibiliza de qualquer maneira. É uma
opção de `initializeRebaseBackend`, portanto só fica acessível após `rebase eject` —
o runtime gerenciado não a lê de nenhum arquivo nem do ambiente. Só faz sentido quando todos os chamadores já são confiáveis.
:::

### Gerando arquivos de tabela em vez disso

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se preferir ter as tabelas descritas em TypeScript — para tipos, para
hooks, para revisão — faça a introspecção delas:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` e requer `--install`, pois é executado
contra a CLI instalada. Em um projeto existente, o comando equivalente é:

```bash
pnpm rebase schema introspect
```

Os arquivos são gerados em `backend/schema/`: um `defineTable` por tabela, com suas colunas,
relações e suas políticas como `rls`, e um `index.ts` exportando-os. A partir
desse ponto, o projeto passa a ter tabelas no código e a introspecção em tempo de inicialização deixa
de ser o que define a API.

O scaffold headless
instala o Atlas em `backend/`, portanto `rebase db push`, `rebase db generate`
e `pnpm run db:migrate` funcionam nessas tabelas como em qualquer projeto.

## Como usar

Via HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou com o cliente type-safe, que já é uma dependência inclusa no scaffold
headless:

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

- [API REST](/docs/backend/api/) — estrutura dos endpoints, filtros e erros
- [SDK Tipado](/docs/sdk/) — consultas, autenticação, realtime, armazenamento
- `/api/docs` — o documento OpenAPI, servido pelo backend em execução assim
  que ele disponibilizar uma tabela, para um chamador autenticado (as tabelas que ele tem permissão de ver). Defina
  `REBASE_ENABLE_SWAGGER=true` para publicá-lo para todos, com a interface Swagger
  em `/api/swagger` fora de produção. Um projeto sem tabelas não disponibiliza
  nenhum dos dois: o documento é gerado a partir das tabelas

## `404 NO_TABLES`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se todas as requisições de dados responderem com isso:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

significa que o projeto não declara tabelas no código *e* o banco de dados não
forneceu nada para servir. Antes da versão 0.31, o código era `NO_COLLECTIONS`. É a primeira resposta esperada de um
projeto headless apontado para um banco de dados vazio, e trata-se de um 404 em vez de um 500 porque
nada está quebrado — simplesmente ainda não há nada para servir.

Três verificações resolvem isso, na ordem em que vale a pena conferir:

1. **O banco de dados não tem tabelas.** Crie-as — por uma migração, SQL puro, ou um
   arquivo `defineTable` junto com `rebase db push` — e reinicie.
2. **As tabelas não possuem segurança a nível de linha habilitada**, portanto a inicialização as
   ignorou. O log de inicialização cita cada uma delas, com o SQL. Habilite-a e adicione uma política,
   como mostrado acima. A resposta também avisa: sua mensagem cita as tabelas e fornece o
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` para elas, e
   `details.unprotectedTables` as lista.
3. **`DATABASE_URL` aponta para outro lugar** diferente do que você imagina. O comando `rebase status`
   exibe os três arquivos que determinam o que o backend acessa.

## Adicionando um painel administrativo posteriormente

Nada aqui impede você de adicioná-lo. Adicione uma pasta `frontend/` que monte o `<RebaseCMS />`:
ele renderiza todas as tabelas servidas pelo backend, a partir de `GET /api/schema/tables`, sem
precisar de um arquivo por tabela. Crie `backend/schema/` — manualmente ou com
`rebase schema introspect` — quando quiser as tabelas no código; as personalizações
específicas do painel ficam em `frontend/src/cms/`. A página [Configuração do frontend](/docs/frontend/) é por onde começar.

## Próximos passos

- [Autenticação](/docs/backend/authentication/) — provedores, tokens, chaves de API
- [Segurança a nível de linha](/docs/collections/security-rules/) — o modelo de acesso
- [Funções personalizadas](/docs/backend/custom-functions/) — suas próprias rotas
- [Implantação](/docs/getting-started/deployment/) — levando para produção
