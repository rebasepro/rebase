---
sourceHash: 89b27e051b61084c
title: O Rebase não faz X
sidebar_label: Estendendo o servidor
description: A escala de extensão do lado do servidor — declaração, callback de coleção, função customizada, suas próprias rotas, seu próprio servidor, eject — com o que cada um pode e não pode alcançar.
---

## Visão geral

Algo de que você precisa não está na configuração da coleção. Esta página apresenta a ordem em que você deve tentar as alternativas e — o que é mais útil — o que cada degrau *não pode* alcançar, para que você pare de subir no primeiro que conseguir realizar a tarefa.

Existe uma página correspondente para o painel de administração:
[Extending Rebase](/docs/frontend/extending) aborda plugins, slots, substituições
de componentes e visualizações customizadas. Esta aqui é sobre o servidor.

A regra que a escala codifica: **cada degrau custa algo que o degrau abaixo dele
mantinha.** Uma declaração é portátil, atualizável e compreendida pelo
planejador de esquema, pelo SDK gerado e pelo painel de administração. No momento
em que você atinge o `rebase eject`, você se torna o dono da sequência de
inicialização, e as atualizações de runtime da plataforma não chegam mais ao seu
projeto. Portanto, suba apenas até onde for estritamente necessário.

## A escala

| # | Degrau | Alcança | **Não** alcança | Custo de estar aqui |
|---|---|---|---|---|
| 1 | **Declaração** — uma propriedade, uma relação, um índice, um bloco `search`, uma regra de segurança | O esquema, o SDK gerado, o painel de administração, o planejador de migração | Qualquer coisa que precise executar código | Nenhum. Este é o caminho suportado |
| 2 | **Callback de coleção** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Cada leitura e escrita de uma coleção, em todos os transportes, dentro da própria transação da requisição | Requisições que não tocam nenhuma coleção; o envelope de resposta; qualquer coisa assíncrona à escrita | Executa no caminho crítico (hot path), mantendo a transação aberta |
| 3 | **Função customizada** — uma aplicação Hono em `functions/` | Sua própria URL, com autenticação resolvida, o driver com escopo definido para o chamador e `rebase` em mãos | As rotas embutidas `/api/data`. Ela fica *ao lado* delas, não na frente | Mais uma superfície para autorizar; nenhum método do SDK é gerado para ela |
| 4 | **Suas próprias rotas e middlewares** na aplicação Hono | Qualquer coisa HTTP, incluindo caminhos que executam *antes* dos roteadores do Rebase | O driver e a identidade do chamador, a menos que você proteja a rota por conta própria | Fora de todos os roteadores do Rebase: nenhum middleware de autenticação foi executado |
| 5 | **Seu próprio servidor** — incorpore o driver no Express, Fastify ou `http` puro | O adaptador de dados e o realtime, em um processo que você escreveu | Tudo o que o `initializeRebaseBackend` conecta: rotas de autenticação, storage, jobs, cron, API de administração, o servidor MCP | Você monta o backend. O Rebase é uma biblioteca aqui, não um coordenador |
| 6 | **`rebase eject`** | O ponto de entrada e o `Dockerfile`, no seu repositório | — | **As atualizações de runtime da plataforma deixam de chegar a este projeto.** CORS, configuração de autenticação, storage e encerramento passam a ser sua responsabilidade |

:::tip[Dois degraus costumam ser ignorados sem motivo]
O `beforeQuery` (degrau 2) restringe uma leitura *antes de ela ser compilada*, que é o
motivo pelo qual as pessoas normalmente recorrem ao degrau 3 ou 5. E um bloco `search` com
`mode: "hybrid"` (degrau 1) é o motivo pelo qual as pessoas normalmente recorrem ao SQL puro. Ambos são
novos o suficiente para que respostas mais antigas na internet não os mencionem.
:::

## 1. Declaração

A maior parte do que um backend precisa é de uma declaração na coleção, porque a
declaração é o único degrau que o restante do sistema consegue interpretar. O planejador
de esquema a converte em DDL, o gerador de código a transforma em métodos do SDK,
o painel de administração a renderiza e o `rebase doctor` a compara com o banco de
dados em execução.

| Eu quero… | Declarar | Referência |
|---|---|---|
| Adicionar uma coluna | uma propriedade | [Propriedades](/docs/collections/properties) |
| Vincular duas coleções | uma propriedade `relation` | [Relações](/docs/collections/relations) |
| Tornar uma consulta rápida | `indexes` | [Índices](/docs/backend/indexes) |
| Decidir quem pode ler ou escrever uma linha | `securityRules` | [Autenticação](/docs/backend/authentication) |
| Buscar texto adequadamente — acentos, JSONB, classificação, substrings | um bloco `search` | [Busca](/docs/backend/search) |
| Encontrar linhas por significado | uma propriedade `vector` | [Busca](/docs/backend/search) |
| Manter linhas excluídas | `softDelete` | [Escritas](/docs/backend/writes) |
| Registrar quem alterou o quê | `history` | [Histórico](/docs/backend/history) |
| Executar algo em um agendamento | um arquivo de cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Executar algo após uma escrita, fora de banda | um job | [Jobs](/docs/backend/jobs) |

**O que ela não pode alcançar:** qualquer coisa que precise tomar uma decisão no
momento da requisição. Uma declaração é dado. Se a resposta depender de quem está
fazendo a requisição, vá para o degrau 2.

## 2. Callbacks de coleção

**Escopo:** uma coleção, ou todas as coleções quando registrado globalmente em
`initializeRebaseBackend({ callbacks })`.

Os callbacks são acionados em **todos** os caminhos de dados — REST, o SDK, assinaturas
via WebSocket e escritas no lado do servidor através de `rebase.dataAsAdmin` — e cada um
executa dentro da transação aberta para essa requisição. Esse é todo o valor: não há como
acessar as linhas de uma coleção contornando-os.

| Callback | Quando é acionado | Use para |
|---|---|---|
| `beforeQuery` | antes de uma leitura ser compilada | restringir **quais linhas** uma leitura solicita |
| `afterRead` | por linha, após ser buscada | ocultação, mascaramento de PII, campos computados |
| `beforeSave` | após a validação, antes da escrita | valores padrão, colunas derivadas, recusar uma escrita |
| `afterSave` | após a escrita, antes do commit | efeitos colaterais que devem ser desfeitos com ela |
| `afterSaveError` | quando um salvamento lança um erro | relatórios; `props.error` é o que foi lançado |
| `beforeDelete` | antes da exclusão | recusá-la |
| `afterDelete` | após a exclusão, antes do commit | limpeza em cascata |

→ [Callbacks por coleção](/docs/collections/callbacks) ·
[Hooks globais](/docs/backend/hooks)

### Restringindo uma leitura com `beforeQuery`

O `afterRead` visualiza linhas que já foram buscadas, portanto ele pode ocultar um valor,
mas não pode impedir que a linha seja lida. O `beforeQuery` executa antes: ele recebe a
consulta analisada e retorna condições para aplicar com **AND** a ela.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Três propriedades valem a pena conhecer antes de confiar nele:

- **Ele só pode restringir.** O valor de retorno é um filtro a ser aplicado com
  AND, e não há formato de retorno que amplie a leitura. Isso é deliberado: um
  hook que recebesse a consulta e pudesse retornar uma nova poderia remover uma
  condição, e em um plano de dados com segurança em nível de linha (row-level
  security), uma condição removida retornaria todas as linhas que as políticas
  porventura permitissem.
- **Ele é acionado em todos os caminhos de leitura.** Na listagem, na busca individual,
  na contagem, no agregador, na busca textual, na leitura vetorial, em uma listagem
  de caminho aninhado, na nova busca em tempo real que monta os frames de assinatura
  e nas linhas carregadas para uma relação ou um `?include=` — onde é o hook da coleção
  de **destino** que se aplica. Um hook respeitado pela listagem e não pela contagem
  resultaria em uma página dizendo "1 de 4 resultados".
- **Um filtro que ele não consiga compilar recusa a requisição.** Nomear uma coluna
  que a tabela não possui resulta em 400, e não em uma condição descartada,
  independentemente de como `configureUnknownFilterFields` esteja configurado.

Uma leitura é deliberadamente *não* restringida: a verificação de unicidade por trás de
`validation: { unique: true }`. Ela pergunta se um valor existe em qualquer lugar da
tabela e, se fosse restringida, responderia "único" para um valor que uma linha oculta
já possui — deixando a inserção falhar na restrição de integridade (constraint).

O `beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção atendida
por outro mecanismo que declare um callback desse tipo **falha na inicialização**, nominalmente,
em vez de ser executada com o hook silenciosamente inativo. O mesmo acontece com um hook
global ao lado de uma fonte de dados que não seja o Postgres. A ocultação que funciona
em todos os mecanismos é o `afterRead`.

**O que os callbacks não podem alcançar:**

- Uma requisição que não toca nenhuma coleção. Não há nada em que o callback possa
  se ancorar.
- O envelope de resposta — código de status, cabeçalhos, formato de paginação. Um
  callback retorna valores, não uma resposta.
- Trabalho que precisa sobreviver à transação. O `afterSave` executa *antes* do
  commit, portanto lançar um erro ali reverte (rollback) a escrita. Qualquer coisa
  que precise sobreviver à reversão da escrita não faz parte da escrita: coloque-a na
  [fila de jobs](/docs/backend/jobs).
- Trabalho lento, na prática. Um callback mantém a transação aberta e, com ela, uma
  conexão do pool. Qualquer coisa que se comunique com terceiros deve ir para a fila.

## 3. Funções customizadas

**Escopo:** uma URL sob `/api/functions`.

Uma aplicação Hono em `backend/functions/`, descoberta pelo nome do arquivo assim como
coleções e cron jobs. O middleware de autenticação já terá sido executado quando seu
manipulador for alcançado, o driver terá o escopo definido para o chamador e `rebase`
estará disponível para storage, e-mail, jobs e `dataAsAdmin`.

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

→ [Funções Customizadas](/docs/backend/custom-functions)

**O que ela não pode alcançar:** as rotas nativas `/api/data`. Uma função fica
*ao lado* delas, não na frente, portanto não pode alterar como uma listagem é
filtrada, paginada ou formatada — isso é o degrau 2. Ela também não recebe um método
gerado no SDK; os chamadores a acessam com `client.functions.invoke(...)` ou um `fetch` comum.

## 4. Suas próprias rotas e middlewares

**Escopo:** a aplicação Hono, antes de o Rebase tocá-la.

O `initializeRebaseBackend` recebe a aplicação que você passa para ele, então qualquer
coisa que você registrar nessa aplicação *antes* de chamá-lo é executada antes de todos
os roteadores do Rebase — consulte
[Route Registration Order](/docs/backend/custom-functions#route-registration-order)
para ver a estrutura.

:::caution[Nenhum middleware de autenticação foi executado ali]
Uma rota registrada dessa forma fica **fora** de todos os roteadores do Rebase, portanto
`getDriver(c)` não estará definido e nada terá verificado um token. Proteja-a com
`requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do
pacote —, que verificam o token por conta própria. Os guards exportados de
`@rebasepro/server/functions` leem uma identidade que um roteador do Rebase já
resolveu, e retornam 500 em vez de fingir que ela existe.
:::

Uma armadilha do Hono que vale a pena mencionar, porque é silenciosa: `app.use("/*", guard)`
cobre apenas as rotas declaradas *abaixo* dele. Uma rota adicionada posteriormente — no
final do arquivo, meses depois — ficará desprotegida. Coloque os guards no slot de
middleware da própria rota.

**O que ela não pode alcançar:** a identidade, o driver com escopo definido e o
envelope de erro — a menos que você mesmo conecte cada um deles. Tudo o que um roteador
do Rebase fornece a um manipulador é algo que um roteador do Rebase executou.

## 5. Seu próprio servidor

**Escopo:** o processo.

O `@rebasepro/server-postgres` é agnóstico quanto a frameworks: ele depende do Drizzle
e do `http.Server` do Node e de mais nada. Assim, você pode incorporar o adaptador de
dados e o realtime no Express, Fastify ou Node puro e ignorar o coordenador completamente.

→ [Integração com Servidor Customizado](/docs/backend/custom-server)

**O que ele não pode alcançar:** tudo o que o `initializeRebaseBackend` conecta, o
que representa a maior parte do backend — as rotas de autenticação e atualização de
token, storage, a fila de jobs, cron, a API de administração com a qual o Studio se
comunica, o servidor MCP, o envelope de erro, a pilha de middlewares. Cada um desses
itens pode ser montado manualmente; nenhum deles se monta sozinho. O Rebase funciona
como uma biblioteca neste degrau, não como um coordenador.

Recorra a ele quando tiver um servidor existente que precisa permanecer como ponto
de entrada. Se o que você realmente quer é uma rota customizada, isso pertence ao
degrau 3 ou 4, com uma fração da superfície de complexidade.

## 6. `rebase eject`

**Escopo:** o repositório.

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e inverte a estrutura
do seu backend, de modo que o repositório crie sua própria imagem em vez de executar
o runtime publicado.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**O que custa:** **as atualizações de runtime da plataforma deixam de chegar ao projeto.**
CORS, configuração de autenticação, storage e encerramento passam a ser sua
responsabilidade de configurar e manter funcionando. Este é o único degrau da escala
do qual é difícil retroceder.

Visualize antes. O parâmetro `--force` substitui um `backend/src/index.ts` ou
`env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

## Quando nenhuma dessas opções é a resposta

Dois casos valem a pena ser mencionados, porque a escala não se aplica a eles.

**SQL puro.** Você não precisa abandonar o framework para escrever uma consulta
que o construtor de consultas não consegue expressar. Isole `driver.admin` com
`isSQLAdmin` e use `executeSql`, a partir de uma função customizada ou callback:

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

`driver` é o que o contexto de uma função customizada fornece (`c.get("driver")`),
ou `context.driver` dentro de um callback. Refine seu tipo com `isSQLAdmin` em vez
de fazer casting: esse guard é a diferença entre um driver que não suporta SQL
avisar isso claramente e outro que lança `admin.executeSql is not a function` no local
da chamada.

**Algo que o framework deveria fazer e não faz.** Se você estiver aplicando patches em
`@rebasepro/server-postgres` ou executando o eject por causa de um único comportamento,
vale mais a pena abrir uma issue do que criar um fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Tanto o `beforeQuery` quanto `search.mode: "hybrid"` existem porque ter um driver modificado com patches era a única alternativa.

## Relacionados

- [Extending Rebase (frontend)](/docs/frontend/extending) — a mesma escala para o painel de administração
- [Callbacks por coleção](/docs/collections/callbacks)
- [Hooks globais](/docs/backend/hooks)
- [Funções Customizadas](/docs/backend/custom-functions)
- [Integração com Servidor Customizado](/docs/backend/custom-server)
- [Busca](/docs/backend/search)
- [Índice de endpoints](/docs/backend/endpoints) — todas as rotas que o servidor disponibiliza
