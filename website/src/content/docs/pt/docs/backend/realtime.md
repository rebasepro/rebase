---
sourceHash: be1f8cd1b6c6a95b
title: Tempo Real & WebSocket
sidebar_label: Tempo Real
description: Sincronização de dados em tempo real, canais de broadcast e rastreamento de presença via WebSocket.
---

O Rebase inclui um mecanismo de tempo real integrado que envia alterações de dados para clientes conectados via WebSocket.
Quando qualquer registro é criado, atualizado ou excluído, cada assinante que estiver observando essa coleção ou entidade recebe a atualização instantaneamente — sem a necessidade de polling.

## Como Funciona

O pipeline de tempo real possui três etapas:

1. **Gatilho no banco de dados** — Uma mutação atinge o banco de dados PostgreSQL (via REST API, SDK ou Studio).
2. **Fan-out no servidor** — O servidor Rebase detecta a alteração e a distribui (fan-out) para cada assinatura WebSocket ativa que corresponda à coleção ou entidade afetada.
3. **Callback no cliente** — O SDK tipado dispara seu callback `onUpdate` com os dados atualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implantações multi-instância, o Rebase usa o `LISTEN/NOTIFY` do PostgreSQL para levar as alterações entre instâncias de servidor. Isso é gerenciado automaticamente. Com a [captura de alterações no nível do banco de dados](/docs/backend/realtime-cdc/) ligada (o padrão onde quer que a role do banco de dados possa criar triggers), toda instância escuta no canal `rebase_cdc` em que os triggers de captura publicam, de modo que uma gravação é ouvida seja qual for o processo ou a ferramenta que a fez. Sem a captura, cada instância anuncia suas próprias gravações no canal `rebase_entity_changes`, e uma conexão dedicada em cada uma das outras instâncias as repassa para seus assinantes locais.

### Zero Configuração

O tempo real é habilitado por padrão. Não há nenhuma flag para ativar nem serviço para iniciar — se o seu servidor Rebase estiver em execução, o endpoint WebSocket estará disponível.

### Qual caminho o socket atende

Na 0.24 o socket aceita todo upgrade de WebSocket no servidor, seja qual for o caminho.

O socket atende upgrades em um único caminho: o caminho base da API com um `/api` final removido, ou seja, `/` para uma API em `/api`. É para lá que o SDK disca: ele se conecta ao seu `baseUrl`, enquanto suas requisições HTTP vão para `${baseUrl}/api`. Um upgrade para qualquer outro caminho é deixado para os outros listeners de `upgrade` do servidor, de modo que seu app pode rodar o próprio servidor WebSocket no mesmo `http.Server`. Sem nenhum outro listener, esse upgrade é respondido com `404`.

Em um [servidor customizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` define o caminho, e o `realtime.path` do adaptador Postgres sobrescreve o que o servidor derivou.

> Por padrão, o Rebase também emite eventos em tempo real para gravações feitas **fora** da API (via `psql`, outro serviço ou pelo editor SQL do Studio) sempre que a conexão com o banco de dados suportar — veja [captura de alterações a nível de banco de dados (CDC)](/docs/backend/realtime-cdc/).

## Assinaturas do SDK tipado

O SDK tipado do Rebase expõe dois métodos de assinatura em cada acessor de coleção:

- **`listen()`** — Assina uma coleção inteira (com filtros opcionais).
- **`listenById()`** — Assina uma única entidade pelo seu ID.

Ambos os métodos retornam uma **função de cancelamento de assinatura (unsubscribe)** que você chama para parar de receber atualizações.

### Assinando uma Coleção

Use `listen()` para receber atualizações sempre que os registros de uma coleção forem alterados:

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — pass undefined for all records
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

O callback recebe um `FindResult<M>` contendo:
- `data` — As linhas, planas, como o `find()` as retorna (`row.name`, não `row.values.name`).
- `meta` — Informações de paginação (`total`, `limit`, `offset`, `hasMore`).

### Assinando uma Coleção com Filtros

Passe `FindParams` como o primeiro argumento para filtrar a assinatura:

```typescript
const unsubscribe = client.data.products.listen(
  {
    where: { status: ["==", "published"] },
    orderBy: ["createdAt", "desc"],
    limit: 50,
  },
  (response) => {
    console.log("Published products:", response.data);
  }
);
```

O servidor respeita esses filtros — apenas os registros correspondentes são incluídos nas atualizações.

### Assinando uma Única Entidade

Use `listenById()` para observar um registro específico:

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (row) => {
    if (row) {
      console.log("Product updated:", row.name);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

O callback recebe a linha, plana, como `findById()` a retorna (`row.name`, não `row.values.name`), ou `undefined` quando a linha é excluída.

**Cada frame traz a versão da linha.** `etagOf(row)` é a `ETag` que um `GET` da linha responde, de modo que uma edição feita contra o que um frame mostrava pode ser salva com `ifMatch: etagOf(row)` e é recusada com `412` se a linha já mudou (veja [Escritas condicionais](/docs/backend/writes/)). No fio, o `subscribe_one` do SDK pergunta com `etag: true`, e cada frame `single_update` de uma linha que existe traz `"etag"` ao lado de `"row"`. Um servidor anterior a isto ignora o pedido e não envia tag, e um cliente que não pergunta recebe frames sem ela.

### Cancelando a Assinatura

Tanto `listen()` quanto `listenById()` retornam uma função de cancelamento de assinatura. Chame-a para parar de receber atualizações e liberar recursos do lado do servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Sempre chame a função de cancelamento de assinatura quando um componente for desmontado ou ao navegar para outra página. Isso evita vazamentos de memória e processamento desnecessário no servidor.
:::

## Query Builder `.listen()`

O query builder fluente também oferece suporte a assinaturas em tempo real. Encadeie seus filtros e, em seguida, chame `.listen()` em vez de `.find()`:

```typescript
const unsubscribe = client.data.orders
  .where("status", "==", "pending")
  .orderBy("createdAt", "desc")
  .limit(20)
  .listen(
    (response) => {
      console.log("Pending orders:", response.data);
    },
    (error) => {
      console.error("Error:", error);
    }
  );
```

:::note
`.listen()` — tanto no query builder quanto no accessor da coleção — precisa do WebSocket do cliente. O cliente deriva a URL a partir de `baseUrl`, a menos que `websocketUrl` seja informado. Em um cliente criado com `realtime: false`, ou que não conseguiu derivar nenhuma URL, chamar `.listen()` lança um erro.
:::

## Entrega de Atualizações: Patch Instantâneo + Refetch de Correção

Uma alteração nunca viaja para um assinante como dados. Ela viaja como o fato de que algo mudou, e cada assinante é então informado sobre o que *ele* pode ver por meio de uma consulta executada em seu nome:

1. **Invalidação.** Quando uma entidade é alterada (criada, atualizada, excluída), o servidor marca os caminhos afetados. A linha que foi gravada não é encaminhada — ela foi lida sob a autorização de quem gravou, o que não diz nada sobre o que qualquer assinante tem permissão para ver.

2. **Refetch debounced com RLS.** Após **300ms** (`REFETCH_DEBOUNCE_MS`), o servidor busca novamente a coleção com seus filtros e ordenação originais. A consulta é executada dentro de uma transação que define os valores locais de transação `app.user_id` e `app.user_roles` a partir do `SubscriptionAuthContext` do assinante, para que o Postgres avalie a Segurança em Nível de Linha (RLS) sob a identidade daquele cliente e apenas as linhas que ele tem autorização para ver sejam enviadas no `collection_update`. O debounce também agrupa uma sequência rápida de gravações em uma única consulta. Ele espera 300 ms sem
uma nova alteração, mas nunca mais de **1 s** (`REFETCH_MAX_WAIT_MS`) depois da
primeira, de modo que uma coleção gravada várias vezes por segundo ainda envia
aos seus assinantes um frame pelo menos uma vez por segundo. Defina esse limite com `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`): um valor maior refaz a leitura de uma tabela movimentada com menos frequência, um menor envia frames mais recentes.

   Um refetch que lê exatamente o que um assinante recebeu por último não envia nada
   a esse assinante: uma gravação na linha 9.000 de uma lista que mostra as primeiras 50 custa
   a leitura, não um frame para cada espectador. Depois de um frame de erro, as próximas linhas
   são enviadas de novo, mesmo que sejam as mesmas.

Versões anteriores enviavam um `collection_patch` imediato contendo a linha gravada antes desse refetch, para feedback cross-tab em submilissegundos. Essa linha havia sido lida sob o escopo de quem realizou a gravação, portanto podia — e conseguia — alcançar assinantes cujas próprias políticas teriam negado o acesso, e o próprio filtro `where` da assinatura também não havia sido aplicado a ela. O patch foi removido: a latência percebida para uma atualização agora é a janela do debounce.

### O refetch é a leitura REST

O refetch executa o mesmo pipeline que o `GET /api/data/<collection>` executa, com o mesmo tratamento de `include`. É isso que faz com que `find({ q })` e `listen({ q })` retornem linhas idênticas, campo por campo.

Costumava ser um método diferente — que aninhava cada relação sob um invólucro `{ "__type": "relation" }` e, como uma assinatura não podia carregar nenhum `include`, carregava de forma antecipada (eager loading) **todas** as relações declaradas pela coleção. Assim, a mesma consulta respondia em um formato via HTTP e em outro via socket, e um cliente renderizando ambos via suas linhas mudarem de formato no momento em que uma gravação ocorria.

Portanto, um frame de assinatura aceita o que uma requisição de listagem aceita: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e `fields`. `vectorSearch` é a exceção e é **recusado** com `VECTOR_SEARCH_NOT_LIVE` — uma assinatura é reexecutada a cada gravação correspondente e nada ali calcula distâncias.

### `collection_update` carrega seus próprios metadados

O frame é `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` é contabilizado dentro da mesma transação com restrição de RLS que leu as linhas, portanto descreve exatamente as linhas ao lado dele. Sem isso, um cliente que precisasse de um total teria que emitir um `GET /count` **por push** — uma viagem de ida e volta (round trip) extra por gravação, por assinante, e uma janela na qual a contagem e as linhas descreviam estados diferentes da coleção.

Quando a contagem em si falha, o frame traz `partial: true` e nenhum `total`; isso não é um erro de assinatura, e o cliente deve manter o último total real em vez de substituí-lo pelo tamanho da página. Em uma tabela grande, a contagem é a maior parte do que um frame custa. Com `REALTIME_RECOUNT_INTERVAL_MS` definido, uma lista cujo último total foi de pelo menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por padrão) reaproveita esse total durante o intervalo em vez de contar a cada gravação, e esse frame traz `meta.totalAsOf`, quando o total foi obtido. Sem definir, como por padrão, todo frame conta.

### O que uma gravação custa, e os limites

Como todo frame é uma consulta executada como seu assinante, o custo de uma gravação cresce
com o número de **perguntas distintas feitas por principals distintos** na
coleção que ela afetou — não com o número de sockets abertos:

- Assinaturas que fazem a mesma pergunta (mesmo caminho, filtros, ordenação, página,
  `include`, `fields`, busca) como o mesmo principal (mesmo id de usuário, roles,
  flag de convidado e claims) compartilham um único refetch. Uma gravação em uma lista custa **uma
  transação por grupo desses** — a leitura e a sua contagem —, não importa quantos sockets a
  possuam; cada membro ainda recebe um frame construído a partir de linhas lidas sob essa
  identidade. Uma primeira página que volta menor que o seu `limit` é o conjunto inteiro,
  portanto nem chega a ser contada.
- Uma assinatura de registro único só é consultada quando o próprio registro muda.
- Principals diferentes nunca compartilham uma leitura — é isso que impede que um frame
  carregue uma linha que seu leitor não pode ver. Uma lista observada por mil
  usuários conectados diferentes é mil leituras e mil contagens em cada
  gravação sobre ela, em mil transações.

Medido em um notebook contra um PostgreSQL local com um pool de 20 conexões, uma
gravação em uma lista:

| Assinantes | Transações para a gravação | Último frame após a gravação |
|-------------|----------------------------|----------------------------|
| 1.000, um principal | 2 | ~310 ms |
| 1.000, cada um um principal diferente | ~1.000 | ~600 ms |

300 ms de cada um é o debounce. A segunda linha é o teto a planejar. Os
refetches rodam no mesmo pool que o seu tráfego REST, mas usando no máximo um quarto
das suas conexões por vez (5 das 20 padrão, nunca menos de 2); as demais
esperam a sua vez no servidor, de modo que o fan-out de uma gravação atrasa os seus próprios frames
e não as suas requisições. Uma coleção escrita várias vezes por segundo enquanto
**centenas de usuários diferentes** observam a mesma lista é onde esses frames
começam a ficar para trás. Além disso, prefira assinaturas mais estreitas (uma página, um filtro sobre as próprias linhas do usuário) ou um
[canal de broadcast](#canais-de-broadcast) carregando a alteração para os clientes
refazerem a busca em seu próprio ritmo.

**Um socket pode manter no máximo 1.000 assinaturas.** A próxima é recusada com
um frame de erro codificado `TOO_MANY_SUBSCRIPTIONS`; reassinar sob um id que o
socket já possui substitui aquela assinatura e não conta de novo. O
SDK compartilha assinaturas idênticas em um socket, então isso conta as listas e
registros distintos que uma página mantém abertos. Altere isso com
`REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket`
no adaptador Postgres (a variável de ambiente prevalece); um valor que não é um
número inteiro positivo interrompe o servidor na inicialização. Na 0.23 as assinaturas de um socket
não têm limite. **Os sockets que um usuário mantém também podem ser limitados**, por instância de servidor: defina `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), e um login além dele é recusado com `TOO_MANY_SOCKETS` e o socket é fechado com 4002. Sem definir, como por padrão, não há limite.

Um id de assinatura é próprio do socket: dois clientes que ambos nomeiam uma
assinatura `"sub-1"` mantêm cada um a sua, e um `unsubscribe` encerra apenas a
do remetente.

**Assinar conta para o limite de taxa de dados.** O primeiro frame de uma assinatura é uma leitura, executada como o assinante, e o mesmo vale para a requisição de histórico de um canal. Por isso `subscribe_collection`, `subscribe_one` e `channel_history` contam como requisições de dados no bucket de limite de taxa do chamador (o mesmo que suas requisições HTTP e seus outros sockets compartilham) depois que a cota do próprio socket se esgota. Cada socket pode enviar 1.000 delas sem que sejam contadas, ou tantas quanto o seu teto de assinaturas, quando este for maior, e a cota volta ao longo de 15 minutos. Isso é tudo o que um socket pode manter, de modo que a reassinatura após uma reconexão nunca é recusada e nunca gasta o orçamento da pessoa. Passada a cota, um frame acima do limite é recusado com um frame de erro codificado `RATE_LIMITED`, que o SDK entrega ao `onError` dessa assinatura, ou ao do canal. Na 0.23 esses frames contam apenas para o orçamento próprio do socket, de 2.000 frames por minuto.

### Sockets que param de responder

Um cliente pode sumir sem fechar seu socket: um celular perde o
sinal, um notebook entra em suspensão, um NAT esquece a conexão. Nenhum frame de
fechamento chega, então nada avisa o servidor. Por isso o servidor envia um ping
a cada socket a cada 30 segundos e encerra o que não respondeu até o ping
seguinte, de modo que um cliente que sumiu é liberado em menos de um minuto.
Navegadores e o SDK respondem aos pings sozinhos; um cliente que fala o
protocolo diretamente também precisa respondê-los, como faz a maioria das
bibliotecas de WebSocket.

**O lado do navegador.** Um navegador não consegue enviar nem ver um ping, então um socket meio aberto parece conectado para ele para sempre. O SDK abre o socket com `?rebase_caps=heartbeat,channel_seq,cancel_sql`; um servidor que as conhece responde com `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listando as que honra (`cancel_sql`: aceita o frame `CANCEL_SQL` do console SQL), e envia `{"type":"heartbeat"}` a cada 30 segundos, e o SDK derruba o socket e [se reconecta](#reconexão-automática) depois de duas perdidas. Um cliente que não nomeia nada não recebe nenhuma das duas, e um servidor mais antigo ignora o parâmetro, então um SDK falando com um se comporta como antes.

Um socket também é encerrado quando mais de 16&nbsp;MiB de frames enviados a ele
continuam sem ser lidos. É um cliente que não lê o que recebe, ou um tão
atrasado que o que ele leria já está desatualizado. E quando os sockets de um servidor
juntos mantêm mais de 256&nbsp;MiB sem leitura (ou um quarto do limite de memória sob o
qual o servidor roda, quando este for menor), aqueles com mais dados sem leitura são
encerrados primeiro, até que o restante caiba.

Um socket encerrado é limpo como um fechado. Suas assinaturas terminam, ele sai
dos seus canais e sua presença é removida, com a saída anunciada aos outros
membros. Um cliente que ainda está lá vê a conexão cair, e o SDK
[se reconecta](#reconexão-automática) e assina de novo. Na 0.23 um socket assim
continua aberto até o sistema operacional desistir da conexão (cerca de duas
horas no Linux), e cada gravação em uma coleção que ele assina continua custando
um refetch para ele.

## Canais de Broadcast

Os canais de broadcast permitem que os clientes enviem mensagens arbitrárias uns aos outros em tempo real — útil para recursos como indicadores de digitação, posições de cursor ou notificações personalizadas.

O broadcast é gerenciado no nível do protocolo WebSocket. O servidor suporta os seguintes tipos de mensagem:

| Tipo de Mensagem | Direção         | Descrição                                |
|------------------|-----------------|------------------------------------------|
| `join_channel`   | Cliente → Servidor | Entrar em um canal nomeado               |
| `leave_channel`  | Cliente → Servidor | Sair de um canal                         |
| `broadcast`      | Cliente → Servidor | Enviar uma mensagem para todos os membros do canal |
| `broadcast`      | Servidor → Cliente | Receber uma mensagem de outro membro     |
| `channel_history`| Cliente → Servidor | Solicitar mensagens retidas após uma sequência |
| `channel_history`| Servidor → Cliente | As mensagens retidas que um cliente perdeu |

Quando um cliente envia uma mensagem `broadcast`, o servidor a repassa para **todos os outros membros** daquele canal (o remetente não recebe sua própria mensagem).

```typescript
// Broadcast message structure (sent by client)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Received by other clients in the channel
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Retenção de Canais

Por padrão, um broadcast alcança os membros conectados no momento e depois desaparece. Esse é o compromisso ideal para notificações e cursores, e não tem custo adicional.

Para um fluxo de operações — edição colaborativa, qualquer coisa em que uma lacuna silenciosa cause divergência — um canal pode ser configurado para **reter** suas mensagens. Os broadcasts retidos recebem um número de sequência por canal e são armazenados, de modo que um cliente que se reconectar pode solicitar tudo o que veio após a última mensagem visualizada.

:::caution[Onde isso vai]
**Runtime gerenciado: em lugar nenhum.** A retenção de canais e o `realtime.bus` fazem parte do adaptador de banco de dados que o próprio runtime gerenciado constrói, e nenhum dos dois tem formato de variável de ambiente. Faça o eject para configurá-los.
**Após eject:** `createPostgresAdapter({ realtime })` em `backend/src/index.ts`.
:::

A retenção é opcional (opt-in) e configurada aqui, no servidor:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations },
        realtime: {
            channels: [
                // Most specific first — the first match wins.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Campo   | Descrição                                                                   |
|---------|-----------------------------------------------------------------------------|
| `match` | Nome exato do canal (`"doc:42"`) ou um prefixo terminado em `*` (`"doc:*"`) |
| `limit` | Manter no máximo esta quantidade das mensagens mais recentes por canal       |
| `ttl`   | Manter mensagens por no máximo este tempo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, ou milissegundos |

Uma regra precisa de pelo menos um entre `limit` ou `ttl`. Uma regra sem nenhum dos dois é ignorada e registrada em log, porque uma retenção ilimitada quase nunca é intencional e não pode ser revertida facilmente depois que a tabela crescer.

:::note[Por que não deixar os clientes solicitarem o histórico?]
Um canal é criado por quem quer que o nomeie. Se um cliente pudesse escolher sua própria profundidade de histórico, qualquer visitante poderia comprometer seu backend com armazenamento ilimitado. Configurá-lo aqui também significa que canais de presença e notificação — a esmagadora maioria — não pagam nada: sem regras configuradas, nenhuma tabela é criada e o broadcast segue o mesmo caminho síncrono de sempre.
:::

### Armazenamento

Os canais retidos usam duas tabelas no schema `rebase`, criadas automaticamente na inicialização quando pelo menos uma regra é configurada:

| Tabela                    | Conteúdo                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | As mensagens retidas, indexadas por `(channel, seq)`            |
| `rebase.channel_cursors`  | A maior sequência emitida por canal                             |

A limpeza (pruning) ocorre à medida que as mensagens chegam, com limitação de taxa (throttled) por canal, para que o custo acompanhe o tempo decorrido em vez do volume de gravação. Ela apenas remove linhas de `channel_messages` — os cursores são mantidos indefinidamente (são uma linha pequena por canal), porque reiniciar a sequência de um canal mudaria o significado do ponto de retomada salvo de um cliente.

### Garantias de entrega

- **Ordenada.** Os números de sequência são alocados por canal, e a ordem de entrega corresponde à ordem da sequência — em uma instância, e entre instâncias no bus `postgres`, onde a mesma instrução que numera uma mensagem também a anuncia, então toda instância (incluindo a do remetente) recebe os anúncios em ordem de sequência. Um bus que você mesmo fornece carrega frames na ordem em que os entrega.
- **Durável antes de entregue.** Uma mensagem que não pode ser armazenada não é entregue a ninguém, e o remetente é informado. Entregá-la a colocaria diante dos assinantes conectados, enquanto a deixaria de fora de qualquer repetição (replay) futura, e nenhuma mensagem posterior poderia reparar essa lacuna.
- **Pelo menos uma vez (At-least-once) na recuperação.** Um intervalo de repetição pode se sobrepor a mensagens que o cliente já recebeu; o SDK descarta aquelas que já foram entregues.
- **Sem buracos.** Uma mensagem retida chega a todos os membros: o remetente, que nunca recebe a própria mensagem, recebe `{"type":"broadcast_ack","channel","seq"}` no lugar quando aderiu a `channel_seq`. Assim, uma mensagem além de `lastSeq + 1` significa que uma foi perdida, e o SDK a segura, pede o histórico no meio e entrega todas em ordem. Contra um servidor sem `channel_seq`, um salto é entregue como chega.

:::caution[O histórico tem o mesmo modelo de acesso que o canal]
Um cliente que entrou em um canal pode reproduzir suas mensagens retidas, incluindo aquelas transmitidas antes de sua entrada — o pertencimento ao canal é a única verificação, e a entrada é aberta a qualquer cliente que saiba o nome do canal. A retenção é opcional por padrão de canal, portanto, ativá-la torna o passado desse canal legível para qualquer visitante que adivinhe o nome. Os canais retidos são o caso em que isso se torna durável em vez de momentâneo, portanto trate o conteúdo de um canal retido como público para os seus usuários.
:::

## Rastreamento de Presença

A presença rastreia quais usuários estão atualmente online em um canal e permite que cada usuário compartilhe um estado personalizado (por exemplo, posição do cursor, status).

| Tipo de Mensagem  | Direção         | Descrição                                            |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Cliente → Servidor | Iniciar o rastreamento de presença com estado personalizado |
| `presence_untrack`| Cliente → Servidor | Parar o rastreamento de presença                     |
| `presence_state`  | Cliente → Servidor | Solicitar o estado completo de presença de um canal  |
| `presence_state`  | Servidor → Cliente | Todas as presenças do canal, na íntegra             |
| `presence_diff`   | Servidor → Cliente | Atualização incremental (entradas e saídas)          |

Quando um cliente envia `presence_track`, o servidor o adiciona automaticamente ao canal (sem necessidade de um `join_channel` separado) e transmite um `presence_diff` para todos os membros do canal. O SDK reenvia o seu estado a cada ~20 segundos como heartbeat; um heartbeat cujo estado não mudou apenas renova o tempo limite do cliente e não envia nenhum `presence_diff`.

```typescript
// Track presence
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Presence diff received by other clients
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Full presence state response
{
  type: "presence_state",
  channel: "document-edit-42",
  presences: {
    "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } },
    "client-def": { name: "Bob", cursor: { line: 22, col: 0 } }
  }
}
```

Presenças inativas são limpas automaticamente após 30 segundos de inatividade.

## Reconexão Automática

O SDK tipado se reconecta automaticamente quando a conexão WebSocket cai:

- **Backoff exponencial** — Cada nova tentativa espera por um degrau que começa em 2 segundos e dobra a cada vez, até 30 segundos. O atraso é sorteado ao acaso em qualquer ponto do seu degrau, mas nunca abaixo de um quarto de segundo, de modo que clientes derrubados juntos por um deploy voltam espalhados por todo o degrau em vez de no mesmo instante.
- **Sem desistência enquanto algo estiver ativo** — Enquanto existir uma assinatura ou um canal associado, o cliente continua tentando reconectar no teto de 30 segundos por todo o tempo que a interrupção durar. Sem nada registrado, ele para após 5 tentativas com falha, e a próxima assinatura disca de novo. Em um navegador, o evento `online` e a aba se tornando visível novamente disparam uma nova tentativa imediatamente, em vez de esperar o backoff.
- **Interrupções são reportadas uma vez** — Quando a conexão está fora do ar por 14 segundos, não importa quantas novas tentativas isso tenha levado, o `onError` de toda assinatura ativa e o `onError` de todo canal associado recebe um `RebaseApiError` com o código `CONNECTION_LOST`. A assinatura é **mantida**: o erro diz que seus dados não estão sendo atualizados, não que ela terminou.
- **Re-assinatura automática** — Após uma reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor, e o próximo `onUpdate` de cada uma carrega tudo o que foi gravado enquanto o cliente estava fora. Essa atualização é o sinal de recuperação. Nenhuma intervenção manual é necessária.
- **Requisições são no máximo uma vez (at-most-once)** — Uma requisição feita enquanto o socket está fora do ar espera por ele, por até 30 segundos a partir da chamada, e então falha com `REQUEST_TIMEOUT` sem nunca ter sido enviada. Uma requisição que já havia sido enviada quando a conexão caiu falha com `CONNECTION_LOST` e **não** é enviada novamente: o servidor pode ou não tê-la executado, e só o chamador sabe se executá-la duas vezes é seguro.

`client.ws.state` indica em que ponto a conexão está, e `onStateChange` é avisado de cada
mudança. Na 0.23 nenhum dos dois existe, o cliente para após 5 tentativas com falha, e
as mensagens enviadas enquanto desconectado são colocadas em fila e enviadas após a reconexão:

| Estado | Significado |
|---|---|
| `idle` | Sem socket, e nenhum desejado ainda (a conexão é lazy), ou um logout o encerrou. |
| `connecting` | Discando, sem nenhuma interrupção em andamento. |
| `connected` | O socket está aberto. |
| `reconnecting` | O socket caiu e o cliente está discando de novo. Nada foi reportado ainda. |
| `disconnected` | A interrupção já dura 14 segundos ou mais. `CONNECTION_LOST` já foi reportado, e o cliente continua discando de novo. |
| `closed` | `client.close()` foi chamado. Final. |

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.onStateChange((state) => {
        showOfflineBanner(state === "disconnected");
    });
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

O admin do Rebase mostra sua própria faixa de aviso enquanto o estado é `disconnected`, e mantém as linhas e registros já na tela em vez de substituí-los por um erro.

## Autenticação & RLS

As assinaturas WebSocket respeitam automaticamente as políticas de Segurança em Nível de Linha (RLS). Quando o cliente é autenticado:

1. A conexão WebSocket se autentica usando o mesmo token JWT que a API REST.
2. Cada refetch de assinatura é executado dentro de uma transação PostgreSQL com `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantindo que as políticas de RLS sejam aplicadas.
3. A identidade é verificada novamente durante todo o tempo em que o socket está aberto, não apenas quando se autentica. Antes de cada frame o servidor pergunta o que uma requisição HTTP perguntaria: o token ainda é válido, sua sessão foi desconectada ou revogada, a conta ainda existe, e quais roles ela possui agora. Frames de canal são consultados no máximo uma vez por segundo. Frames que chegam em um mesmo socket enquanto a verificação dele ainda está em andamento — um cliente reenviando suas assinaturas após uma reconexão — compartilham essa verificação em vez de cada um perguntar de novo; o próximo frame depois que ela se resolve pergunta novamente. Um socket que só escuta é consultado pelo menos a cada 30 segundos, e um token deixa de ser aceito no instante em que expira. Uma role removida se aplica a partir do próximo frame (ou, para um frame que compartilhou uma verificação já em andamento, a partir do seguinte), tanto para leituras quanto para gravações e assinaturas abertas. Um socket cuja identidade terminou recebe um frame `AUTH_ERROR` e é encerrado com o código `4001`. Com a autenticação embutida, o código do frame diz o motivo, como as rotas HTTP o dizem: `SESSION_REVOKED` (sessão encerrada, revogada, ou a conta excluída), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED`; o de outro adaptador de autenticação é `SESSION_ENDED`. Um `AUTHENTICATE` para uma sessão revogada ou uma conta desativada é recusado com `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (um token que não é verificado, ou que expirou, com `INVALID_TOKEN`). O SDK não pergunta de novo com o mesmo token, e entrega a recusa, código incluído, ao `onError` do que quer que precisasse da conta. O SDK reautentica seu socket a cada vez que atualiza seu token; um token novo para a mesma identidade (o mesmo id de usuário, roles, flag de convidado e claims) mantém as assinaturas abertas como estão, e um para uma identidade diferente refaz a busca de cada uma delas como essa identidade. Depois de um `4001` ele se reconecta com a sessão que possui naquele momento, ou sem nenhuma. Um cliente que se comunica diretamente com o protocolo precisa enviar um token novo em `AUTHENTICATE` antes que o antigo expire.

Isso significa que cada socket recebe apenas atualizações de registros que sua identidade autenticada tem permissão para ver.

Uma [chave de API](/docs/backend/api-keys/) também autentica o socket: envie a
chave `rk_…` onde iria o token de acesso. O socket então verifica cada frame
contra os [escopos](/docs/backend/roles-and-scopes/) da chave: uma busca, uma contagem ou uma
inscrição precisa de `data:read` na sua coleção, um salvamento de `data:write`, uma exclusão de
`data:delete`. Um caminho aninhado precisa do escopo simples. Canais (broadcast e
presence) são recusados para uma chave, porque nenhum escopo os cobre. O editor SQL e as
mensagens de branch precisam de `database:read` ou `database:write`, tanto para uma chave quanto para uma
pessoa.

Executar mais de uma instância — o barramento LISTEN/NOTIFY, o comportamento da presença entre processos e como escrever seu próprio transporte — tem uma página dedicada:
[Tempo real entre instâncias](/docs/backend/realtime-transports/).

## Captura de Alterações a Nível de Banco de Dados (CDC)

Toda gravação confirmada emite eventos em tempo real, não importa como foi feita: REST, o
SDK, o Studio, `psql`, um cron job em outro serviço. Como a captura funciona, a configuração
`REALTIME_CDC` e do que ela precisa: [Captura de alterações do banco de dados](/docs/backend/realtime-cdc/).

## Timeout de Requisições Pendentes

Para evitar que as requisições dos clientes fiquem travadas indefinidamente, todas as operações WebSocket pendentes que esperam uma resposta do servidor (como buscas únicas de coleção `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) têm um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente exclui automaticamente a requisição pendente e rejeita a promise com um `RebaseApiError` cujo código é `REQUEST_TIMEOUT`.

Mensagens unidirecionais que não esperam resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) resolvem imediatamente após a transmissão e não acionam este timeout. Uma assinatura cujo primeiro frame não chegou 30 segundos depois de o subscribe ter sido enviado falha em vez disso, com `SUBSCRIPTION_TIMEOUT` no seu `onError`.

### Quando um frame de canal é recusado

Um frame de canal é fire-and-forget: `await channel.broadcast(...)` resolve quando o frame é gravado no socket, **não** quando o servidor o aceitou. Isso é deliberado — um aplicativo colaborativo transmite uma posição de cursor sessenta vezes por segundo, e aguardar uma confirmação para cada uma transformaria cada transmissão em uma viagem de ida e volta (round trip).

Portanto, uma recusa não pode ser uma promise rejeitada. Ela chega no `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|--------|-------------|
| `CHANNEL_FORBIDDEN` | Você não é membro do canal — entre nele antes de transmitir ou ler seu histórico |
| `RATE_LIMITED` | Ultrapassou o limite de frames do canal (7.200 frames de canal por minuto por socket), ou, para uma requisição de histórico, o [limite de taxa de dados](#o-que-uma-gravação-custa-e-os-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Um broadcast retido não pôde ser persistido, então foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Uma solicitação de recuperação (catch-up) não pôde ser atendida |
| `CHANNEL_HISTORY_GAP` | Emitido pelo cliente: uma recuperação (catch-up) descobriu que o servidor não retém mais mensagens que este cliente nunca recebeu. `details` é `{ from, to }`, os números de sequência perdidos. Ressincronize o estado do canal a partir de sua fonte da verdade |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast alcançou apenas esta instância — veja [O limite de 8 KB no barramento do Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sem nenhum handler anexado, esses eventos são registrados no log como aviso. Eles costumavam ser completamente descartados: não havia promise para rejeitar e nenhum canal para entregar, então um broadcast proibido era indistinguível de um entregue.

## Próximos Passos

- [SDK tipado](/docs/sdk) — Referência completa do SDK, incluindo acessores tipados de coleção.
- [Autenticação](/docs/backend/authentication) — Configure a autenticação JWT e as políticas de RLS.
- [Arquitetura do Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.
