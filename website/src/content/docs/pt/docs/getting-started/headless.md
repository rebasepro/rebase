---
sourceHash: a43be9786395a654
title: Apenas backend (headless)
sidebar_label: Apenas backend
description: Execute o Rebase como um Backend-as-a-Service headless sobre o seu próprio PostgreSQL — uma API REST, autenticação, armazenamento e realtime, sem painel de administração e sem ficheiros de coleção.
---

O Rebase tem dois formatos, e esta página é sobre aquele que nunca abre um navegador: uma
API REST, autenticação, armazenamento, realtime e cópias de segurança sobre uma base de dados PostgreSQL
que já possui. Sem painel de administração, sem ficheiros de coleção. Se estava
a pensar utilizar o Supabase ou o PostgREST, esta é a alternativa comparável.

Tudo o que está nesta página também funciona no projeto completo — é o mesmo servidor.
O que o `--headless` remove é o pacote de frontend e os ficheiros de coleção, não
uma funcionalidade.

## Criar a estrutura base (Scaffold)

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Dois workspaces, sem `frontend/`:

| Pasta | O que contém |
|--------|---------------|
| `backend/` | As suas funções personalizadas e crons. Não existe nenhum ficheiro de servidor — o runtime publicado inicializa o projeto |
| `config/` | `storageAuthorize`, e quaisquer coleções que o `--introspect` gere |

O `--template` não tem qualquer efeito aqui: um preset gera ficheiros de coleção iniciais, e esta
variante não tem nenhum. Node 22.22+, o mesmo requisito mínimo do projeto completo — o `package.json`
da camada headless declara `"node": ">=22.22.0"` e substitui o que estiver
abaixo dele.

## Apontar para a sua base de dados

O `init` gera um `.env` pronto a executar. Para utilizar uma base de dados que já tenha em execução, passe
o URL da mesma no momento da criação da estrutura:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou defina `DATABASE_URL` no `.env` posteriormente — é a mesma coisa. Sem
`DATABASE_URL`, o `rebase dev` inicia um PostgreSQL gerido (PGlite) no diretório
do projeto, o que é útil para testar a API, mas não é para isso que esta variante
serve.

Em seguida:

```bash
pnpm install
pnpm run dev
```

**Leia o URL a partir da saída do terminal.** O `rebase dev` obtém uma porta livre a partir
do caminho do projeto em vez de usar uma fixa, pelo que difere entre projetos e
entre máquinas.

## De onde vêm as coleções

Não existem no código. O servidor lê o esquema da sua base de dados no arranque e disponibiliza
as tabelas que encontrar, de modo que a API acompanha as suas migrações: altere o esquema, e
os endpoints mudam com ele.

Uma tabela é disponibilizada assim que o row-level security (RLS) for ativado nela. Sem nenhuma política,
ela é disponibilizada mas não devolve nenhuma linha, e o arranque emite um aviso sobre isso; uma política permite o acesso:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` são instalados pelo Rebase e
leem a identidade do pedido autenticado. Consulte as
[Regras de Segurança](/docs/collections/security-rules/) para o vocabulário das políticas,
e [rls-check](/docs/rls-check/) para uma auditoria do que as suas políticas realmente
permitem.

Uma tabela sem RLS é **ignorada**, deliberadamente: cada pedido autenticado
é executado como `rebase_user`, pelo que disponibilizar uma tabela que o row-level security não protege
entregaria todas as linhas a qualquer utilizador autenticado. Cada tabela ignorada é indicada no arranque, juntamente com o SQL
necessário para a proteger.

Uma tabela de junção (join table) não é disponibilizada de qualquer forma, porque nunca se torna uma coleção.
Se tiver o RLS desativado, também será indicada no arranque.

A verificação é executada no arranque. Se o RLS for desativado posteriormente numa tabela disponibilizada, ela continuará
a ser disponibilizada até que o próximo arranque a ignore. A [auditoria agendada](/docs/rls-check/)
deteta-o mais cedo, e está desativada por predefinição.

:::note
`baas: { unprotectedTables: "serve" }` disponibiliza-as mesmo assim. É uma
opção de `initializeRebaseBackend`, pelo que só fica acessível após executar `rebase eject` —
o runtime gerido não a lê a partir de `config/index.ts` nem das
variáveis de ambiente. Apenas faz sentido quando todos os requerentes já são de confiança.
:::

### Gerar ficheiros de coleção em alternativa

Se preferir ter as tabelas declaradas em TypeScript — para tipagens,
callbacks ou revisão de código — utilize a introspeção:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

O `--introspect` implica `--template blank` e requer `--install`, porque é executado
recorrendo à CLI instalada. Num projeto existente, o equivalente é:

```bash
pnpm rebase schema introspect
```

Os ficheiros são guardados em `config/collections/`. A partir desse momento, o projeto passa a ter coleções
no código e a introspeção em tempo de arranque deixa de ser o que define a API.

A estrutura base
headless instala o Atlas em `backend/`, pelo que `rebase db push`, `rebase db generate`
e `pnpm run db:migrate` funcionam nessas coleções como em qualquer outro projeto. Na versão 0.24,
cada um deles falha com a mensagem "The atlas binary is missing"; adicione-o ao backend com
`pnpm --dir backend add @ariga/atlas`.

## Utilização

Via HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou com o cliente type-safe, que já é uma dependência da estrutura
headless:

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

- [API REST](/docs/backend/api/) — os formatos dos endpoints, filtros e erros
- [SDK Tipado](/docs/sdk/) — consultas, autenticação, realtime, armazenamento
- `/api/docs` e `/api/swagger` — o documento OpenAPI e o respetivo visualizador, disponibilizados
  pelo backend em execução assim que tiver pelo menos uma coleção. Um projeto sem nenhuma não disponibiliza
  nenhum dos dois: o documento é gerado a partir das coleções, pelo que não há nada
  a descrever até que a secção acima seja executada

## `404 NO_COLLECTIONS`

Se todos os pedidos de dados responderem com isto:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

significa que o projeto não declara nenhuma coleção no código *e* a base de dados não forneceu
nada a partir do qual as pudesse derivar. É a primeira resposta expectável de um projeto
headless apontado para uma base de dados vazia, e é um 404 em vez de um 500 porque
nada está com erro — simplesmente ainda não há nada para disponibilizar.

Três coisas resolvem esta situação, pela ordem que vale a pena verificar:

1. **A base de dados não tem tabelas.** Crie-as — uma migração, SQL simples ou um
   ficheiro de coleção seguido de `rebase db push` — e reinicie.
2. **As tabelas não têm row-level security ativado**, pelo que o arranque
   as ignorou. O registo de arranque indica cada uma delas, juntamente com o SQL correspondente. Ative-o e adicione uma política,
   como explicado acima. A
   resposta também o indica: a respetiva mensagem nomeia as tabelas e fornece o comando
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` para as mesmas, e
   `details.unprotectedTables` lista-as. Na versão 0.24, é indicado que a base de dados não tem
   tabelas.
3. **O `DATABASE_URL` aponta para um local diferente** do que pensa. O comando `rebase status`
   imprime os três ficheiros que determinam a que destino o backend se liga.

## Adicionar um painel de administração mais tarde

Nada aqui o impede de o fazer futuramente. Adicione um diretório `config/collections/` — manualmente
ou com `rebase schema introspect` — e um frontend que as apresente; o
backend permanece inalterado. [Configuração do Frontend](/docs/frontend/) é o ponto de partida.

## Próximos passos

- [Autenticação](/docs/backend/authentication/) — fornecedores, tokens, chaves de API
- [Regras de Segurança (RLS)](/docs/collections/security-rules/) — o modelo de acesso
- [Funções Personalizadas](/docs/backend/custom-functions/) — as suas próprias rotas
- [Implantação](/docs/getting-started/deployment/) — levar para produção
