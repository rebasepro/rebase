---
sourceHash: 213cc853c469bd0c
title: Apenas backend (headless)
sidebar_label: Apenas backend
description: Execute o Rebase como um Backend-as-a-Service headless sobre o seu próprio PostgreSQL — uma API REST, autenticação, storage e realtime, sem painel administrativo e sem arquivos de coleções.
---

O Rebase tem dois formatos, e esta página é sobre o que nunca abre um navegador: uma
API REST, autenticação, storage, realtime e backups sobre um banco de dados PostgreSQL
que você já possui. Sem painel administrativo, sem arquivos de coleções. Se você estava
procurando o Supabase ou o PostgREST, esta é a opção comparável.

Tudo nesta página também funciona no projeto completo — é o mesmo servidor.
O que a flag `--headless` remove é o pacote de frontend e os arquivos de coleções, não
uma funcionalidade.

## Crie o scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Dois workspaces, nenhum `frontend/`:

| Pasta | O que há nela |
|-------|---------------|
| `backend/` | Suas funções personalizadas e crons. Não há arquivo de servidor — o runtime publicado inicializa o projeto |
| `config/` | `storageAuthorize`, e quaisquer coleções geradas por `--introspect` |

`--template` não tem efeito aqui: um preset gera arquivos de coleções iniciais, e este
formato não possui nenhum. Node 22.22+, o mesmo requisito mínimo do projeto completo — o
`package.json` da camada headless declara `"node": ">=22.22.0"` e substitui o que está
sob ele.

## Aponte para o seu banco de dados

O `init` gera um `.env` pronto para execução. Para usar um banco de dados que você já
executa, passe sua URL no momento do scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou defina `DATABASE_URL` no `.env` depois — dá no mesmo. Sem `DATABASE_URL`, o
`rebase dev` inicia um PostgreSQL gerenciado (PGlite) no diretório do projeto, o
que é útil para testar a API, mas não é para isso que esta modalidade foi feita.

Em seguida:

```bash
pnpm install
pnpm run dev
```

**Leia a URL na saída do terminal.** O `rebase dev` deriva uma porta livre a partir do
caminho do projeto em vez de usar uma fixa, portanto ela varia entre projetos e
entre máquinas.

## De onde vêm as coleções

Não há nenhuma no código. O servidor lê o esquema do seu banco de dados na inicialização e
expõe as tabelas que encontrar, de modo que a API acompanha suas migrações: altere o
esquema e os endpoints mudarão juntos.

Uma tabela é disponibilizada assim que possuir um modelo de autorização — row-level
security (RLS) habilitado, mais pelo menos uma policy:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` são instalados pelo Rebase e
leem a identidade da requisição autenticada. Consulte
[Security Rules](/docs/collections/security-rules/) para conhecer o vocabulário de policies,
e [rls-check](/docs/rls-check/) para fazer uma auditoria do que suas policies realmente
permitem.

Uma tabela sem RLS é **ignorada**, deliberadamente: toda requisição autenticada
é executada como `rebase_user`, portanto expor uma tabela sem policy entregaria
todas as linhas para qualquer chamador autenticado. Cada tabela ignorada é listada
na inicialização, junto com o SQL necessário para protegê-la.

:::note
`baas: { unprotectedTables: "serve" }` as disponibiliza mesmo assim. É uma opção de
`initializeRebaseBackend`, portanto só pode ser acessada após o `rebase eject` —
o runtime gerenciado não a lê de `config/index.ts` nem do ambiente. Faz sentido
apenas quando todos os chamadores já são confiáveis.
:::

### Gerando arquivos de coleções em vez disso

Se preferir ter as tabelas definidas em TypeScript — para tipagem, callbacks ou
revisão —, faça a introspecção delas:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` e requer `--install`, porque é executado
contra a CLI instalada. Em um projeto existente, o equivalente é:

```bash
pnpm rebase schema introspect
```

Os arquivos são gerados em `config/collections/`. A partir desse ponto, o projeto passa
a ter coleções no código e a introspecção no momento da inicialização deixa de ser o
que define a API.

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

const { data: posts } = await rebase.data.collection("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST API](/docs/backend/api/) — formatos dos endpoints, filtros e erros
- [Client SDK](/docs/sdk/) — consultas, autenticação, realtime, storage
- `/api/docs` e `/api/swagger` — o documento OpenAPI e seu visualizador, disponibilizados
  pelo backend em execução assim que ele tiver uma coleção. Um projeto sem nenhuma não
  disponibilizará nenhum dos dois: o documento é gerado a partir das coleções, portanto
  não há nada para descrever até que a seção acima seja executada

## `404 NO_COLLECTIONS`

Se todas as requisições de dados responderem com isto:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

então o projeto não declara coleções no código *e* o banco de dados não forneceu
nada de onde derivá-las. Essa é a primeira resposta esperada de um projeto headless
apontado para um banco de dados vazio, e é um 404 em vez de um 500 porque nada
está quebrado — simplesmente ainda não há nada para servir.

Três coisas resolvem isso, na ordem em que vale a pena verificar:

1. **O banco de dados não tem tabelas.** Crie-as — por meio de uma migração, SQL puro
   ou um arquivo de coleção acompanhado de `rebase db push` — e reinicie.
2. **As tabelas não possuem policy de RLS**, então a inicialização as ignorou. O log
   de boot informa o nome de cada uma. Adicione uma policy, como mostrado acima.
3. **A `DATABASE_URL` aponta para outro lugar** diferente do que você pensa. O comando
   `rebase status` exibe os três arquivos que determinam o que o backend acessa.

## Adicionando um painel administrativo mais tarde

Nada aqui impede você de fazer isso. Adicione um diretório `config/collections/` —
manualmente ou com `rebase schema introspect` — e um frontend que as renderize; o
backend não muda. [Frontend Setup](/docs/frontend/) é por onde começar.

## Próximos passos

- [Authentication](/docs/backend/authentication/) — provedores, tokens, chaves de API
- [Security Rules (RLS)](/docs/collections/security-rules/) — o modelo de acesso
- [Custom Functions](/docs/backend/custom-functions/) — suas próprias rotas
- [Deployment](/docs/getting-started/deployment/) — levando para produção

---
