---
sourceHash: 8412da52cc99478c
title: O Rebase não faz X
sidebar_label: Estendendo o servidor
description: A escada de extensão do lado do servidor — declaração, hook de tabela, função customizada, suas próprias rotas, seu próprio servidor, eject — com o que cada um pode e não pode alcançar.
---

## Visão Geral

Algo que você precisa não está na definição da tabela. Esta página apresenta a ordem
para tentar as soluções e — o que é mais útil — o que cada degrau *não pode*
alcançar, para que você pare de subir assim que encontrar o primeiro capaz de resolver o problema.

Existe uma página correspondente para o painel administrativo:
[Estendendo o Rebase](/docs/frontend/extending) aborda plugins, slots, substituições
de componentes e visualizações customizadas. Esta aqui é sobre o servidor.

A regra que a escada define: **cada degrau custa algo que o degrau abaixo dele
mantinha.** Uma declaração é portátil, atualizável e compreendida pelo planejador
de schema, pelo SDK gerado e pelo painel administrativo. No momento em que você chega ao
`rebase eject`, você se torna o responsável pela sequência de boot, e as atualizações do runtime
da plataforma deixam de alcançar seu projeto. Portanto, suba apenas até onde for estritamente necessário.

## A escada

| # | Degrau | Alcança | **Não** alcança | Custo de estar aqui |
|---|---|---|---|---|
| 1 | **Declaração** — uma coluna, uma relação, um índice, um bloco `search`, uma regra `rls` | O schema, o SDK gerado, o painel administrativo, o planejador de migração | Qualquer coisa que precise executar código | Nenhum. Este é o caminho suportado |
| 2 | **Hook de tabela** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Todas as leituras e escritas de uma tabela, em todos os transportes, dentro da própria transação da requisição | Requisições que não tocam em nenhuma tabela; o envelope da resposta; qualquer coisa assíncrona à escrita | Executa no hot path, mantendo a transação aberta |
| 3 | **Função customizada** — uma aplicação Hono em `functions/` | Sua própria URL, com autenticação resolvida, o driver com escopo definido para o chamador e o `rebase` em mãos | As rotas nativas `/api/data`. Ela fica *ao lado* delas, não na frente | Mais uma superfície para autorizar; nenhum método de SDK é gerado para ela |
| 4 | **Suas próprias rotas e middlewares** na aplicação Hono | Qualquer coisa HTTP, incluindo caminhos que executam *antes* dos roteadores do Rebase | O driver e a identidade do chamador, a menos que você mesmo proteja a rota | Fora de qualquer roteador do Rebase: nenhum middleware de autenticação foi executado |
| 5 | **Seu próprio servidor** — construa o backend com `createRebaseBackend` e monte os grupos de rotas que desejar, ou incorpore apenas o driver no Express, Fastify ou `http` puro | Cada grupo de rotas, no caminho que você escolher, e qual processo inicia os timers; no nível mais baixo, apenas o adaptador de dados e o realtime | Com apenas o driver: tudo o mais, desde rotas de autenticação e armazenamento até cron e a API administrativa | Você chama cada etapa que o `initializeRebaseBackend` fazia por você |
| 6 | **`rebase eject`** | O ponto de entrada e o `Dockerfile`, no seu repositório | — | **As atualizações de runtime da plataforma deixam de chegar a este projeto.** CORS, configuração de autenticação, armazenamento e desligamento tornam-se sua responsabilidade |

:::tip[Dois degraus são frequentemente pulados sem motivo]
`beforeQuery` (degrau 2) restringe uma leitura *antes de ela ser compilada*, que é
o motivo pelo qual as pessoas normalmente recorrem ao degrau 3 ou 5. E um bloco `search` com
`mode: "hybrid"` (degrau 1) é o motivo pelo qual as pessoas normalmente recorrem ao SQL puro. Ambos são
recentes o suficiente para que respostas mais antigas na internet não os mencionem.
:::

## 1. Declaração

A maior parte do que um backend precisa é de uma declaração na tabela, porque uma
declaração é o único degrau que o restante do sistema consegue interpretar. O planejador de schema
a transforma em DDL, o gerador de código a transforma em métodos do SDK, o painel administrativo
a renderiza e o `rebase doctor` a compara com o banco de dados em produção.

| Eu quero… | Declarar | Referência |
|---|---|---|
| Adicionar uma coluna | uma coluna `col.*` | [Colunas](/docs/schema/columns/) |
| Vincular duas tabelas | uma relação `rel.*` | [Relações](/docs/collections/relations) |
| Tornar uma consulta rápida | `indexes` | [Índices](/docs/backend/indexes) |
| Decidir quem pode ler ou escrever uma linha | `rls` | [Segurança a nível de linha (RLS)](/docs/collections/security-rules/) |
| Buscar texto corretamente — acentos, JSONB, classificação, substrings | um bloco `search` | [Busca](/docs/backend/search) |
| Encontrar linhas por significado | uma coluna `col.vector()` | [Busca vetorial](/docs/backend/vector-search/) |
| Manter linhas excluídas | `softDelete` | [Exclusão suave](/docs/collections/soft-delete) |
| Registrar quem alterou o quê | `history` | [Histórico](/docs/backend/history) |
| Executar algo de forma agendada | um arquivo de cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Executar algo após uma escrita, de forma assíncrona | um job | [Jobs](/docs/backend/jobs) |

**O que não pode alcançar:** qualquer coisa que precise tomar uma decisão em tempo de requisição.
Uma declaração é dado. Se a resposta depender de quem está fazendo a pergunta, vá para o degrau 2.

## 2. Hooks de tabela

**Escopo:** uma tabela, ou todas as tabelas quando exportados como `hooks` de
`backend/hooks.ts` (`initializeRebaseBackend({ hooks })` quando ejetado).

Os hooks são disparados em **todos** os caminhos de dados — REST, o SDK, subscrições
WebSocket e escritas do lado do servidor via `rebase.dataAsAdmin` — e cada um executa dentro da
transação aberta para aquela requisição. Esse é todo o seu valor: não há como
acessar as linhas de uma tabela contornando-os.

| Hook | Dispara | Use para |
|---|---|---|
| `beforeQuery` | antes de uma leitura ser compilada | restringir **quais linhas** uma leitura solicita |
| `afterRead` | por linha, após ser buscada | ocultação, mascaramento de PII, campos computados |
| `beforeSave` | após a validação, antes da escrita | valores padrão, colunas derivadas, recusar uma escrita |
| `afterSave` | após a escrita, antes do commit | efeitos colaterais que devem ser desfeitos juntamente com ela |
| `afterSaveError` | quando um save lança um erro | relatório de erros; `props.error` é o que foi lançado |
| `beforeDelete` | antes da exclusão | recusá-la |
| `afterDelete` | após a exclusão, antes do commit | limpeza em cascata |

→ [Hooks de tabela](/docs/collections/callbacks) ·
[Hooks globais](/docs/backend/hooks)

### Restringindo uma leitura com `beforeQuery`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `afterRead` vê linhas que já foram buscadas, portanto ele pode ocultar um valor,
mas não pode impedir que a linha seja lida. O `beforeQuery` executa antes: ele recebe a
consulta analisada e retorna condições para aplicar com **AND** a ela.

```ts
// backend/schema/documents.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const documents = defineTable("documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text(),
        body: col.text()
    },
    rls: "admin-only",
    hooks: {
        beforeQuery: ({ context }) => {
            if (context.user?.roles?.includes("admin")) return;        // no narrowing
            return { filter: { tenantId: ["==", context.user?.claims?.tenant ?? null] } };
        }
    }
});
```

Quatro propriedades que valem a pena conhecer antes de depender dele:

- **Ele só pode restringir.** O valor de retorno é um filtro a ser aplicado com AND, e não
  há nenhuma estrutura que ele possa retornar para ampliar a leitura. Isso é intencional: se um hook
  recebesse a consulta e pudesse retornar uma nova, ele poderia descartar uma condição, e em um
  plano de dados com segurança a nível de linha, uma condição descartada retorna todas as linhas que
  as políticas porventura permitirem.
- **Ele dispara em todos os caminhos de leitura.** A listagem, o get individual, o count, o
  aggregate, a busca, a leitura vetorial, uma listagem de caminho aninhado, a re-busca em tempo real
  que constrói os frames de subscrição e as linhas carregadas para uma relação ou
  um `?include=` — onde é o hook da tabela de **destino** que se aplica.
  Um hook respeitado pela listagem e não pelo count resulta em uma página que diz
  "1 de 4 resultados".
- **Um filtro que ele não consegue compilar recusa a requisição.** Nomear uma coluna que a tabela
  não possui resulta em um 400, não em uma condição descartada, independentemente de como
  `configureUnknownFilterFields` esteja configurado.
- **Uma escrita em uma linha que ele exclui resulta em um 404.** Uma atualização ou exclusão direcionada a
  uma linha fora do escopo é recusada antes da escrita, com a mesma resposta "no row …"
  que uma leitura daria — portanto, um escopo é um escopo também para escritas, não apenas para
  leituras. O que ele *não* valida são os valores que estão sendo escritos: recusar uma escrita
  com base em seu conteúdo é papel do `beforeSave`.

Uma leitura é deliberadamente *não* restringida: a verificação de unicidade por trás
de `.unique()`. Ela pergunta se um valor existe em qualquer lugar da
tabela, e se fosse restringida responderia "único" para um valor que uma linha oculta já
contém — fazendo com que a inserção falhe na restrição (constraint) em vez disso.

**O que os hooks não podem alcançar:**

- Uma requisição que não toca em nenhuma tabela. Não há onde o hook se
  ancorar.
- O envelope da resposta — status code, cabeçalhos, formato de paginação. Um hook
  retorna valores, não uma resposta.
- Trabalho que precisa sobreviver à transação. O `afterSave` executa *antes* do commit,
  então um erro lançado ali desfaz a escrita (rollback). Qualquer coisa que deva sobreviver à anulação
  da escrita não faz parte da escrita: coloque-a na
  [fila de jobs](/docs/backend/jobs).
- Trabalho lento, na prática. Um hook mantém a transação aberta e uma conexão
  do pool ocupada com ela. Qualquer coisa que se comunique com terceiros pertence à fila.

## 3. Funções customizadas

**Escopo:** uma URL sob `/api/functions`.

Uma aplicação Hono em `backend/functions/`, descoberta pelo nome do arquivo assim como os cron jobs
são, ou passada como um valor (`functions: { promote }`). O middleware de autenticação já terá sido executado quando seu handler for alcançado,
o driver terá o escopo definido para o chamador, e o `rebase` estará disponível para armazenamento, e-mail,
jobs e `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.table("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Funções Customizadas](/docs/backend/custom-functions)

**O que não pode alcançar:** as rotas nativas `/api/data`. Uma função fica
*ao lado* delas, não na frente delas, de modo que não pode alterar como uma listagem é
filtrada, paginada ou estruturada — isso é papel do degrau 2. Ela também não recebe nenhum método
gerado no SDK; os chamadores a acessam com `client.functions.invoke(...)` ou com `fetch` simples.

## 4. Suas próprias rotas e middlewares

**Escopo:** a aplicação Hono, antes de o Rebase tocá-la.

O `initializeRebaseBackend` recebe a aplicação que você passa para ele, de modo que qualquer coisa registrada
nessa aplicação *antes* de chamá-lo executa antes de todos os roteadores do Rebase — consulte
[Ordem de Registro de Rotas](/docs/backend/custom-functions#route-registration-order)
para ver o formato. Um grupo de rotas que você mesmo monta a partir de `backend.routes` (degrau 5)
não é uma dessas rotas: ele carrega seu próprio middleware de autenticação.

:::caution[Nenhum middleware de autenticação foi executado ali]
Uma rota registrada dessa forma está **fora** de qualquer roteador do Rebase, portanto
`getDriver(c)` não estará definido e nada terá verificado um token. Proteja-a com
`requireAuth` importado de **`@rebasepro/server`** — a raiz do pacote — que
verifica o token por conta própria, e depois use `requireAdmin` ou `requireScope` da mesma
importação para decidir o que o chamador pode fazer. Os guards exportados de
`@rebasepro/server/functions` leem uma identidade que um roteador do Rebase já
resolveu, e respondem com 500 em vez de fingir que uma existe.
:::

Uma armadilha do Hono que vale a pena mencionar, porque é silenciosa: `app.use("/*", guard)` cobre
apenas as rotas declaradas *abaixo* dele. Uma rota adicionada posteriormente — no final do
arquivo, daqui a meses — fica desprotegida. Coloque os guards no slot de middleware
da própria rota.

**O que não pode alcançar:** a identidade, o driver com escopo e o envelope de erro
— a menos que você mesmo configure cada um. Tudo o que um roteador do Rebase fornece a um handler é
algo que um roteador do Rebase executou.

## 5. Seu próprio servidor

**Escopo:** o processo.

O `initializeRebaseBackend` é um atalho sobre algumas chamadas públicas, e este degrau
consiste em chamá-las você mesmo. O `createRebaseBackend` cria o backend e não monta,
não inicia e não escuta nada. O `backend.routes` contém cada grupo de rotas como
uma sub-aplicação Hono que você pode montar isoladamente, em qualquer caminho. `mount`, `attachRealtime` e
`start` fazem o resto, se você desejar:

```typescript
const backend = await createRebaseBackend({ database: adapter, auth, schemaDir, provision: true });

app.route("/v2/data", backend.routes.data());   // only the parts you want,
app.route("/v2/auth", backend.routes.auth());   // at the paths you want
await backend.attachRealtime(server);
backend.start();                                // cron, job workers, sweeps
```

Um grupo carrega seu próprio contexto de autenticação, rate limits e barreira de admin, e recusa
os cabeçalhos de impersonação e simulação, a menos que seja o grupo de dados ou de funções,
de modo que `getDriver(c)` funciona em um grupo montado em qualquer lugar. O que ele não carrega são os
middlewares de nível de processo adicionados por `mount()`: limite de corpo de requisição, compressão, CSRF e
o envelope de erro ficam a seu cargo ao montar os grupos um a um.

Um passo ainda mais adiante: `@rebasepro/server-postgres` é agnóstico a frameworks: ele
depende apenas do Drizzle e do `http.Server` do Node e de nada mais, de modo que você pode incorporar
o driver de dados e o realtime no Express, Fastify ou Node puro e deixar o
servidor do Rebase inteiramente de fora.

→ [Integração de Servidor Customizado](/docs/backend/custom-server)

**O que não pode alcançar:** com `createRebaseBackend`, nada está fora de alcance;
você assume a responsabilidade pela ordem das chamadas. Apenas com o driver, tudo o que o
servidor configura fica por sua conta para construir: as rotas de autenticação e atualização de tokens, armazenamento,
a fila de jobs, o cron, a API administrativa com a qual o Studio se comunica, o servidor MCP, o
envelope de erro e a pilha de middlewares.

Recorra a isso quando você tiver um servidor existente que precisa permanecer como ponto de entrada, ou
quando apenas parte do backend pertencer a este processo. Se o que você realmente
precisa é de uma rota customizada, isso pertence ao degrau 3 ou 4, com uma fração da superfície.

## 6. `rebase eject`

**Escopo:** o repositório.

Escreve o ponto de entrada do backend e um `Dockerfile` no projeto e altera o funcionamento
do seu backend, de modo que o repositório passe a construir sua própria imagem em vez de rodar o
runtime publicado.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**O que custa:** **as atualizações do runtime da plataforma deixam de alcançar o projeto.**
CORS, configuração de autenticação, armazenamento e desligamento passam a ser de sua responsabilidade para configurar
e manter funcionando. Este é o único degrau na escada que é difícil de reverter.

Visualize antes de executar. O parâmetro `--force` substitui um `backend/src/index.ts` ou
`env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

## Quando nenhuma dessas é a resposta

Dois casos merecem destaque, pois não se encaixam na escada.

**SQL puro.** Você não precisa abandonar o framework para escrever uma consulta que o query
builder não consegue expressar. Isole `driver.admin` com `isSQLAdmin` e use
`executeSql`, a partir de uma função customizada ou de um hook:

```typescript
import { isSQLAdmin, type DataDriver } from "@rebasepro/types";

async function topSellers(driver: DataDriver, since: string) {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) throw new Error("Native SQL is not available on this driver.");
    return admin.executeSql(
        "select product_id, sum(qty) from order_lines where created_at > $1 group by 1",
        { params: [since] }
    );
}
```

O `driver` é o que o contexto de uma função customizada fornece a você (`c.get("driver")`), ou
`context.driver` dentro de um hook. Isole-o com `isSQLAdmin` em vez de fazer
type casting: essa verificação é a diferença entre um driver que não suporta SQL avisar isso
claramente e um que lança `admin.executeSql is not a function` no ponto de chamada.

O `executeSql` retorna
todas as linhas que lê. Para SQL cujo tamanho você não controla, passe `maxResultBytes`:
um resultado cujas linhas excedam esse limite em bytes é recusado com um erro cujo
`code` é `RESULT_TOO_LARGE`, nunca retornado parcialmente. O `EXECUTE_SQL` do socket realtime,
pelo qual o `executeSql` de um cliente admin passa, define 128 MB para
todos os chamadores.

**Algo que o framework deveria fazer e não faz.** Se você se encontrar
criando patches para `@rebasepro/server-postgres`, ou executando eject por conta de um único comportamento,
vale mais a pena abrir uma issue em vez de criar um fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Tanto `beforeQuery` quanto `search.mode: "hybrid"` existem porque um driver com patch
era a única alternativa viável.

## Relacionados

- [Estendendo o Rebase (frontend)](/docs/frontend/extending) — a mesma escada para o painel administrativo
- [Hooks de tabela](/docs/collections/callbacks)
- [Hooks globais](/docs/backend/hooks)
- [Funções Customizadas](/docs/backend/custom-functions)
- [Integração de Servidor Customizado](/docs/backend/custom-server)
- [Busca](/docs/backend/search)
- [Índice de endpoints](/docs/backend/endpoints) — todas as rotas que o servidor monta
