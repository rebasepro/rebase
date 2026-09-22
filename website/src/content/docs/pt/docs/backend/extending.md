---
sourceHash: 41183c8dc79d618d
title: O Rebase não faz X
sidebar_label: Estendendo o servidor
description: A escada de extensão do lado do servidor — declaração, callback de coleção, função customizada, suas próprias rotas, seu próprio servidor, eject — com o que cada um pode e não pode alcançar.
---

## Visão geral

Algo de que você precisa não está na configuração da coleção. Esta página apresenta a ordem para
tentar as opções e — o que é mais útil — o que cada degrau *não pode* alcançar, para que você pare
de subir no primeiro que conseguir realizar o trabalho.

Existe uma página correspondente para o painel de administração:
[Extending Rebase](/docs/frontend/extending) aborda plugins, slots, substituições de componentes
e visualizações customizadas. Esta aqui é sobre o servidor.

A regra que a escada estabelece: **cada degrau custa algo que o degrau abaixo dele
mantinha.** Uma declaração é portátil, atualizável e compreendida pelo planejador de esquema,
pelo SDK gerado e pelo painel de administração. No momento em que você chega ao
`rebase eject`, você se torna responsável pela sequência de inicialização, e as atualizações do runtime
da plataforma deixam de chegar ao seu projeto. Portanto, suba apenas até onde for necessário.

## A escada

| # | Degrau | Alcança | **Não** alcança | Custo de estar aqui |
|---|---|---|---|---|
| 1 | **Declaração** — uma propriedade, uma relação, um índice, um bloco `search`, uma regra de segurança | O esquema, o SDK gerado, o painel de administração, o planejador de migração | Qualquer coisa que precise executar código | Nenhum. Este é o caminho suportado |
| 2 | **Callback de coleção** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Toda leitura e escrita de uma coleção, em todos os transportes, dentro da própria transação da requisição | Requisições que não tocam em nenhuma coleção; o envelope da resposta; qualquer coisa assíncrona à escrita | Executa no caminho crítico (hot path), mantendo a transação aberta |
| 3 | **Função customizada** — uma aplicação Hono em `functions/` | Sua própria URL, com autenticação resolvida, o driver com escopo definido para o chamador e `rebase` em mãos | As rotas nativas `/api/data`. Ela fica *ao lado* delas, não na frente | Mais uma superfície para autorizar; nenhum método de SDK é gerado para ela |
| 4 | **Suas próprias rotas e middlewares** na aplicação Hono | Qualquer coisa HTTP, incluindo caminhos que executam *antes* dos roteadores do Rebase | O driver e a identidade do chamador, a menos que você proteja a rota manualmente | Fora de todos os roteadores do Rebase: nenhum middleware de autenticação foi executado |
| 5 | **Seu próprio servidor** — incorpore o driver no Express, Fastify ou `http` puro | O adaptador de dados e realtime, em um processo escrito por você | Tudo o que `initializeRebaseBackend` conecta: rotas de autenticação, armazenamento, jobs, cron, API de administração, o servidor MCP | Você monta o backend. O Rebase aqui é uma biblioteca, não um coordenador |
| 6 | **`rebase eject`** | O ponto de entrada (entrypoint) e o `Dockerfile`, no seu repositório | — | **As atualizações de runtime da plataforma deixam de chegar a este projeto.** CORS, configuração de autenticação, armazenamento e encerramento tornam-se sua responsabilidade |

:::tip[Dois degraus são frequentemente ignorados sem motivo]
`beforeQuery` (degrau 2) restringe uma leitura *antes de ela ser compilada*, que é o
motivo pelo qual as pessoas geralmente recorrem ao degrau 3 ou 5. E um bloco `search` com
`mode: "hybrid"` (degrau 1) é o que geralmente leva as pessoas a buscarem SQL puro. Ambos são
recentes o suficiente para que respostas mais antigas na internet não os mencionem.
:::

## 1. Declaração

A maior parte do que um backend precisa é de uma declaração na coleção, porque uma
declaração é o único degrau que o restante do sistema consegue ler. O planejador de esquema a
transforma em DDL, o gerador de código a transforma em métodos de SDK, o painel de administração a
renderiza e o `rebase doctor` a compara com o banco de dados ativo.

| Eu quero… | Declarar | Referência |
|---|---|---|
| Adicionar uma coluna | uma propriedade | [Propriedades](/docs/collections/properties) |
| Vincular duas coleções | uma propriedade `relation` | [Relações](/docs/collections/relations) |
| Tornar uma consulta rápida | `indexes` | [Índices](/docs/backend/indexes) |
| Decidir quem pode ler ou escrever uma linha | `securityRules` | [Autenticação](/docs/backend/authentication) |
| Buscar texto adequadamente — acentos, JSONB, ranqueamento, substrings | um bloco `search` | [Busca](/docs/backend/search) |
| Encontrar linhas por significado | uma propriedade `vector` | [Busca](/docs/backend/search) |
| Manter linhas excluídas | `softDelete` | [Escritas](/docs/backend/writes) |
| Registrar quem alterou o quê | `history` | [Histórico](/docs/backend/history) |
| Executar algo em um agendamento | um arquivo de cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Executar algo após uma escrita, fora de banda | um job | [Jobs](/docs/backend/jobs) |

**O que não pode alcançar:** qualquer coisa que precise tomar uma decisão no momento da requisição.
Uma declaração é um dado. Se a resposta depender de quem está fazendo a requisição, vá para o degrau 2.

## 2. Callbacks de coleção

**Escopo:** uma coleção, ou todas as coleções quando registrado globalmente em
`initializeRebaseBackend({ callbacks })`.

Os callbacks disparam em **todos** os caminhos de dados — REST, o SDK, assinaturas via WebSocket
e escritas no lado do servidor por meio de `rebase.dataAsAdmin` — e cada um executa dentro da
transação aberta para essa requisição. Esse é todo o seu valor: não há como
acessar as linhas de uma coleção contornando-os.

| Callback | Quando dispara | Use para |
|---|---|---|
| `beforeQuery` | antes de uma leitura ser compilada | restringir **quais linhas** uma leitura solicita |
| `afterRead` | por linha, depois de ser buscada | ocultação de dados, mascaramento de PII, campos computados |
| `beforeSave` | após a validação, antes da escrita | valores padrão, colunas derivadas, recusar uma escrita |
| `afterSave` | após a escrita, antes do commit | efeitos colaterais que devem ser desfeitos com ela |
| `afterSaveError` | quando um salvamento lança um erro | relatórios/notificações; `props.error` é o que foi lançado |
| `beforeDelete` | antes da exclusão | recusá-la |
| `afterDelete` | após a exclusão, antes do commit | limpeza em cascata |

→ [Callbacks por coleção](/docs/collections/callbacks) ·
[Hooks globais](/docs/backend/hooks)

### Restringindo uma leitura com `beforeQuery`

`afterRead` visualiza linhas que já foram buscadas, portanto pode ocultar um valor,
mas não pode impedir que a linha seja lida. `beforeQuery` executa antes: ele recebe a
consulta analisada e retorna condições para combinar com **AND** a ela.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Vale a pena conhecer três propriedades antes de depender dele:

- **Ele só pode restringir.** O valor de retorno é um filtro a ser adicionado com AND, e não
  há estrutura que ele possa retornar que amplie a leitura. Isso é deliberado: um hook que
  recebesse a consulta e pudesse retornar uma nova poderia remover uma condição, e em um
  plano de dados com segurança em nível de linha, uma condição removida retornaria todas as linhas
  que as políticas por acaso permitissem.
- **Ele dispara em todos os caminhos de leitura.** Na listagem, na busca individual, na contagem,
  na agregação, na busca textual, na leitura vetorial, em listagens de caminhos aninhados, na
  revalidação em tempo real que constrói os frames de assinatura e nas linhas carregadas para uma
  relação ou um `?include=` — onde é o hook da coleção de **destino** que se aplica.
  Um hook respeitado pela listagem e não pela contagem resulta em uma página que diz
  "1 de 4 resultados".
- **Um filtro que não possa ser compilado recusa a requisição.** Informar uma coluna que a tabela
  não possui resulta em um 400, e não em uma condição descartada, independentemente de como
  `configureUnknownFilterFields` esteja configurado.
- **Uma escrita em uma linha que ele exclui resulta em 404.** Uma atualização ou exclusão direcionada
  a uma linha fora do escopo é recusada antes da escrita, com a mesma resposta de "nenhuma linha…"
  que uma leitura fornece — portanto, um escopo é um escopo para escritas também, e não apenas para
  leituras. O que ele *não* valida são os valores que estão sendo escritos: recusar uma escrita
  com base em seu conteúdo é papel do `beforeSave`.

Uma leitura é deliberadamente *não* restrita: a verificação de unicidade por trás de
`validation: { unique: true }`. Ela consulta se um valor existe em qualquer lugar da
tabela e, se fosse restrita, responderia "único" para um valor que uma linha oculta já
possui — fazendo com que o insert falhasse na restrição (constraint) em vez disso.

`beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção atendida
por outro mecanismo que declare esse hook **falha na inicialização**, informando o nome, em vez de
ser executada com o hook silenciosamente inativo. O mesmo acontece com um hook global ao lado de uma fonte
de dados que não seja Postgres. A ocultação de dados que funciona em todos os mecanismos é o `afterRead`.

**O que os callbacks não podem alcançar:**

- Uma requisição que não toca em nenhuma coleção. Não há nada em que o callback
  possa se acoplar.
- O envelope da resposta — código de status, cabeçalhos, formato de paginação. Um callback
  retorna valores, não uma resposta.
- Trabalho que precisa sobreviver à transação. `afterSave` executa *antes* do commit,
  portanto um erro lançado ali reverte a escrita. Qualquer coisa que precise persistir mesmo
  que a escrita seja desfeita não faz parte da escrita: coloque-a na
  [fila de jobs](/docs/backend/jobs).
- Tarefas lentas, na prática. Um callback mantém a transação aberta e uma
  conexão do pool ocupada com ela. Qualquer coisa que se comunique com serviços de terceiros deve ir para a fila.

## 3. Funções customizadas

**Escopo:** uma URL sob `/api/functions`.

Uma aplicação Hono em `backend/functions/`, descoberta pelo nome do arquivo assim como coleções
e cron jobs. O middleware de autenticação já terá sido executado quando seu manipulador for alcançado,
o driver estará com o escopo delimitado ao chamador e o `rebase` estará disponível para armazenamento, e-mail,
jobs e `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.collection("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Funções customizadas](/docs/backend/custom-functions)

**O que não pode alcançar:** as rotas nativas `/api/data`. Uma função fica
*ao lado* delas, não na frente, portanto não pode alterar como uma listagem é
filtrada, paginada ou estruturada — isso cabe ao degrau 2. Ela também não recebe um
método de SDK gerado; os chamadores a acessam com `client.functions.invoke(...)` ou `fetch` simples.

## 4. Suas próprias rotas e middlewares

**Escopo:** a aplicação Hono, antes que o Rebase a manipule.

`initializeRebaseBackend` recebe a aplicação que você passa para ele, de modo que qualquer coisa registrada
nessa aplicação *antes* de chamá-lo executa antes de todos os roteadores do Rebase — consulte
[Ordem de registro de rotas](/docs/backend/custom-functions#route-registration-order)
para entender a estrutura.

:::caution[Nenhum middleware de autenticação foi executado ali]
Uma rota registrada dessa forma fica **fora** de todos os roteadores do Rebase, portanto
`getDriver(c)` não estará definido e nada terá verificado um token. Proteja-a com
`requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz
do pacote — que verificam o token por conta própria. Os guards exportados de
`@rebasepro/server/functions` leem uma identidade que um roteador do Rebase já
resolveu e retornam 500 em vez de fingir que ela existe.
:::

Uma armadilha do Hono que vale a pena mencionar, por ser silenciosa: `app.use("/*", guard)` cobre
apenas as rotas declaradas *abaixo* dele. Uma rota adicionada posteriormente — no final do
arquivo, meses depois — ficará desprotegida. Coloque os guards no próprio
slot de middleware da rota.

**O que não pode alcançar:** a identidade, o driver com escopo e o envelope de erro
— a menos que você configure cada um por conta própria. Tudo o que um roteador do Rebase fornece a um manipulador
é algo que o roteador do Rebase realizou.

## 5. Seu próprio servidor

**Escopo:** o processo.

`@rebasepro/server-postgres` é agnóstico em relação a frameworks: ele depende do Drizzle e
do `http.Server` do Node e de mais nada. Portanto, você pode incorporar o adaptador de dados e o
realtime no Express, Fastify ou Node puro e ignorar o coordenador completamente.

→ [Integração de servidor customizado](/docs/backend/custom-server)

**O que não pode alcançar:** tudo o que o `initializeRebaseBackend` conecta, o que
representa a maior parte do backend — as rotas de autenticação e renovação de token, armazenamento, a fila
de jobs, cron, a API de administração com a qual o Studio se comunica, o servidor MCP, o envelope de erro,
a pilha de middlewares. Cada um desses itens está disponível para montagem manual;
nenhum deles se monta sozinho. O Rebase é uma biblioteca neste degrau, não um coordenador.

Recorra a ele quando você tiver um servidor existente que precisa permanecer como o ponto de entrada. Se o que
você realmente deseja é apenas uma rota customizada, isso pertence ao degrau 3 ou 4, com uma fração
da superfície de exposição.

## 6. `rebase eject`

**Escopo:** o repositório.

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e altera o funcionamento do seu
backend, de modo que o repositório construa sua própria imagem em vez de executar o
runtime publicado.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**O que custa:** **as atualizações do runtime da plataforma deixam de chegar ao projeto.**
CORS, configuração de autenticação, armazenamento e encerramento passam a ser de sua responsabilidade para
configurar e manter funcionando. Este é o único degrau da escada difícil de reverter.

Visualize antes. `--force` substitui um `backend/src/index.ts` ou
`env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

## Quando nenhuma dessas opções for a resposta

Vale a pena mencionar dois casos, porque a escada não se aplica a eles.

**SQL puro.** Você não precisa sair do framework para escrever uma consulta que o construtor
de consultas não consegue expressar. Restrinja `driver.admin` com `isSQLAdmin` e use
`executeSql`, a partir de uma função customizada ou callback:

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

`driver` é o que o contexto de uma função customizada fornece a você (`c.get("driver")`), ou
`context.driver` dentro de um callback. Faça o estreitamento dele com `isSQLAdmin` em vez de
fazer um cast: essa verificação é a diferença entre um driver que não pode executar SQL informar
isso claramente e um driver que lança `admin.executeSql is not a function` no local da chamada.

**Algo que o framework deveria fazer e não faz.** Se você se pegar criando
patches para `@rebasepro/server-postgres` ou fazendo um eject por causa de um único comportamento, vale a pena
abrir uma issue em vez de criar um fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Tanto `beforeQuery` quanto `search.mode: "hybrid"` existem porque um driver com patch
era a única alternativa.

## Conteúdo relacionado

- [Extending Rebase (frontend)](/docs/frontend/extending) — a mesma escada para o painel de administração
- [Callbacks por coleção](/docs/collections/callbacks)
- [Hooks globais](/docs/backend/hooks)
- [Funções customizadas](/docs/backend/custom-functions)
- [Integração de servidor customizado](/docs/backend/custom-server)
- [Busca](/docs/backend/search)
- [Índice de endpoints](/docs/backend/endpoints) — todas as rotas que o servidor monta
