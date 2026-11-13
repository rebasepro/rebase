---
sourceHash: 0804be5779f90bbb
title: Tempo Real e WebSocket
sidebar_label: Tempo Real
description: Sincronização de dados em tempo real, canais de broadcast e rastreamento de presença via WebSocket.
---

O Rebase inclui um motor de tempo real integrado que envia alterações de dados para clientes conectados via WebSocket.
Quando qualquer registro é criado, atualizado ou excluído, cada assinante que estiver monitorando aquela tabela ou entidade recebe a atualização instantaneamente — sem necessidade de polling.

## Como Funciona

O pipeline de tempo real possui três etapas:

1. **Gatilho no banco de dados** — Uma mutação atinge o banco de dados PostgreSQL (via API REST, SDK ou Studio).
2. **Fan-out do servidor** — O servidor Rebase detecta a alteração e a distribui para cada assinatura WebSocket ativa que corresponda à tabela ou entidade afetada.
3. **Callback do cliente** — O SDK tipado dispara seu callback `onUpdate` com os dados atualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implantações com múltiplas instâncias, o Rebase usa o `LISTEN/NOTIFY` do PostgreSQL para transportar alterações entre as instâncias do servidor. Isso é tratado automaticamente. Com a [captura de alterações no nível do banco de dados (CDC)](/docs/backend/realtime-cdc/) ativada (o padrão sempre que a role do banco de dados puder criar gatilhos), cada instância escuta no canal `rebase_cdc` onde os gatilhos de captura publicam, para que uma gravação seja percebida independentemente de qual processo ou ferramenta a realizou. Sem a captura, cada instância anuncia suas próprias gravações no canal `rebase_entity_changes`, e uma conexão dedicada em todas as outras instâncias as retransmite para seus assinantes locais.

### Configuração Zero

O suporte a tempo real já vem habilitado por padrão. Não há nenhuma flag para ativar nem serviço para iniciar — se o seu servidor Rebase estiver em execução, o endpoint WebSocket estará disponível.

### Qual caminho o socket responde

O socket responde a upgrades em um único caminho: o caminho base da API sem o `/api` final, ou seja, `/` para uma API em `/api`. É para onde o SDK se conecta: ele conecta ao seu `baseUrl`, enquanto suas requisições HTTP vão para `${baseUrl}/api`. Um upgrade para qualquer outro caminho é deixado para os outros listeners de `upgrade` do servidor, permitindo que sua aplicação execute seu próprio servidor WebSocket no mesmo `http.Server`. Sem nenhum outro listener, esse upgrade é respondido com `404`.

Em um [servidor customizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` define o caminho, e o `realtime.path` do adaptador Postgres sobrescreve o que o servidor deduziu.

> Por padrão, o Rebase também emite eventos em tempo real para gravações feitas **fora** da API (via `psql`, outro serviço ou o editor SQL do Studio) sempre que a conexão com o banco de dados suportar — consulte a [captura de alterações no nível do banco de dados](/docs/backend/realtime-cdc/).

## Assinaturas no SDK Tipado

O SDK tipado do Rebase expõe dois métodos de assinatura em cada acessador de tabela:

- **`listen()`** — Assina uma tabela inteira (com filtros opcionais).
- **`listenById()`** — Assina uma única entidade pelo seu ID.

Ambos os métodos retornam uma **função de cancelamento de assinatura (unsubscribe)** que você chama para parar de receber atualizações.

### Assinando uma Tabela

Use `listen()` para receber atualizações sempre que os registros em uma tabela forem alterados:

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
- `data` — As linhas, planas, como o `find()` as retorna (`row.name`, e não `row.values.name`).
- `meta` — Informações de paginação (`total`, `limit`, `offset`, `hasMore`).

### Assinando uma Tabela com Filtros

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

Use `listenById()` para monitorar um registro específico:

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

O callback recebe a linha, plana, como o `findById()` a retorna (`row.name`, e não `row.values.name`), ou `undefined` assim que a linha for excluída.

**Cada frame carrega a versão da linha.** `etagOf(row)` é a `ETag` que um `GET` da linha responde, portanto, uma edição feita com base no que um frame exibiu pode ser salva com `ifMatch: etagOf(row)` e é recusada com `412` se a linha já tiver sido alterada (consulte [Gravações condicionais](/docs/backend/writes/)). Na rede, o `subscribe_one` do SDK solicita com `etag: true`, e cada frame `single_update` para uma linha existente traz `"etag"` ao lado de `"row"`. Um servidor anterior a isso ignora a solicitação e não envia nenhuma tag, e um cliente que não solicita recebe frames sem ela.

### Cancelando a Assinatura

Tanto `listen()` quanto `listenById()` retornam uma função de cancelamento de assinatura. Chame-a para parar de receber atualizações e liberar recursos no lado do servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Sempre chame a função de cancelamento de assinatura quando um componente for desmontado ou ao navegar para fora da página. Isso evita vazamentos de memória e processamento desnecessário no servidor.
:::

## `.listen()` no Query Builder

O query builder fluente também suporta assinaturas em tempo real. Encadeie seus filtros e chame `.listen()` em vez de `.find()`:

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
O `.listen()` — tanto no query builder quanto no acessador de tabela — necessita do WebSocket do cliente. O cliente deduz sua URL a partir de `baseUrl`, a menos que `websocketUrl` seja fornecido. Em um cliente criado com `realtime: false`, ou que não conseguiu deduzir nenhuma URL, chamar `.listen()` lança um erro.
:::

## Entrega de Atualizações: Instant Patch + Refetch de Correção

Uma alteração nunca viaja até um assinante como dados. Ela viaja como o fato de que
algo mudou, e cada assinante é então informado sobre o que *ele* pode ver através de uma
consulta executada com a identidade dele:

1. **Invalidação.** Quando uma entidade é alterada (criada, atualizada, excluída), o
   servidor marca os caminhos afetados. A linha que foi gravada não é encaminhada —
   ela foi lida sob a autorização do autor da gravação, o que não diz nada sobre o que
   qualquer assinante tem permissão para ver.

2. **Refetch com debounce e RLS.** Após **300ms** (`REFETCH_DEBOUNCE_MS`), o servidor
   busca a tabela novamente com seus filtros e ordem de classificação originais. A consulta
   é executada dentro de uma transação que define os parâmetros locais da transação `app.user_id` e
   `app.user_roles` a partir do `SubscriptionAuthContext` do assinante, para que o Postgres
   avalie o Row-Level Security sob a identidade daquele cliente e apenas as linhas que
   ele tem autorização para ver sejam enviadas no `collection_update`. O debounce
   também agrupa uma rajada de gravações em uma única consulta. Ele aguarda 300 ms sem
   novas alterações, mas nunca mais do que **1 s** (`REFETCH_MAX_WAIT_MS`) após
   a primeira, de modo que uma tabela que recebe gravações várias vezes por segundo ainda envie
   um frame aos seus assinantes pelo menos uma vez por segundo. Defina esse limite com `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`): valores mais altos realizam o refetch de uma tabela movimentada com menor frequência; valores mais baixos enviam frames mais atualizados.

   Um refetch que lê exatamente o que foi enviado pela última vez ao assinante não envia
   nada a ele: uma gravação na linha 9.000 de uma lista que mostra as primeiras 50 custa
   apenas a leitura, não um frame para cada visualizador. Após um frame de erro, as próximas linhas
   são enviadas novamente, mesmo que sejam as mesmas.

Versões anteriores enviavam um `collection_patch` imediato contendo a linha gravada
antes desse refetch, para feedback entre abas em menos de um milissegundo. Essa linha havia sido
lida sob o escopo de quem gravou, portanto ela poderia alcançar — e de fato alcançava — assinantes cujas
próprias políticas a teriam negado, e o próprio filtro `where` da assinatura
tampouco era aplicado a ela. O patch foi removido: a latência percebida para uma
atualização agora é a janela do debounce.

### O refetch é a leitura REST

O refetch executa o mesmo pipeline que o `GET /api/data/<table>` executa, com o
mesmo tratamento de `include`. É isso que faz com que `find({ q })` e `listen({ q })`
retornem linhas que são idênticas campo a campo.

Costumava ser um método diferente — que aninhava cada relação sob um
envelope `{ "__type": "relation" }` e, como uma assinatura não podia carregar nenhum
`include`, carregava antecipadamente **todas** as relações que a tabela declarava. Assim, a mesma
consulta respondia em um formato via HTTP e em outro via socket, e um cliente
que renderizava ambos via suas linhas mudarem de formato no instante em que uma gravação ocorria.

Um frame de assinatura aceita, portanto, o mesmo que uma requisição de listagem aceita: `filter`,
`logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e
`fields`. `vectorSearch` é a exceção e é **recusado** com
`VECTOR_SEARCH_NOT_LIVE` — uma assinatura é reexecutada a cada gravação correspondente e
nada ali calcula distâncias.

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

`meta` é contado dentro da mesma transação vinculada ao RLS que leu as linhas, portanto,
ele descreve exatamente as linhas ao seu lado. Sem ele, um cliente que precisasse de um total
teria que emitir um `GET /count` **por push** — um round trip extra por gravação, por
assinante, e uma janela na qual a contagem e as linhas descreviam estados
diferentes da tabela.

Quando a contagem em si falha, o frame carrega `partial: true` e nenhum `total`;
isso não é um erro de assinatura, e o cliente deve manter o último total real
em vez de substituí-lo pelo tamanho da página. Em uma tabela grande, a contagem é a maior parte do custo de um frame. Com `REALTIME_RECOUNT_INTERVAL_MS` definido, uma lista cujo último total era de pelo menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por padrão) reutiliza esse total durante o intervalo em vez de contar a cada gravação, e esse frame traz `meta.totalAsOf`, informando quando o total foi obtido. Quando o intervalo termina, uma lista cujo último frame reutilizou o total é contada novamente e o novo total é enviado, quer algo tenha sido gravado desde então ou não. Se não estiver configurado, como por padrão, cada frame realiza a contagem.

### Quanto custa uma gravação e os limites

Como cada frame é uma consulta executada com a identidade do seu assinante, o custo de uma gravação cresce
com o número de **perguntas distintas feitas por entidades (principals) distintas** na
tabela que ela alterou — e não com o número de sockets abertos:

- Assinaturas que fazem a mesma pergunta (mesmo caminho, filtros, ordenação, página,
  `include`, `fields`, busca) como o mesmo principal (mesmo ID de usuário, roles,
  flag de visitante e claims) compartilham um único refetch. Uma gravação em uma lista custa **uma
  transação por esse grupo** — a leitura e sua contagem — independentemente de quantos sockets
  a possuam; cada membro ainda recebe um frame construído a partir de linhas lidas sob aquela
  identidade. Uma primeira página que retorne menos itens do que o seu `limit` representa o conjunto
  completo, portanto não é contada novamente.
- Uma assinatura de registro único é consultada apenas quando seu próprio registro é alterado.
- Principals diferentes nunca compartilham uma leitura — é isso que impede que um frame
  carregue uma linha que seu leitor não tem permissão para ver. Uma lista monitorada por mil
  usuários autenticados diferentes resulta em mil leituras e mil contagens a cada
  gravação nela, em mil transações.

Medido em um laptop contra um PostgreSQL local com um pool de 20 conexões, uma
gravação em uma lista:

| Assinantes | Transações para a gravação | Último frame após a gravação |
|-------------|----------------------------|----------------------------|
| 1.000, um principal | 2 | ~310 ms |
| 1.000, cada um um principal diferente | ~1.000 | ~600 ms |

300 ms de cada um é o debounce. A segunda linha é o teto para o qual você deve planejar. Os
refetches são executados no mesmo pool do seu tráfego REST, mas usando no máximo um quarto das
suas conexões por vez (5 das 20 padrão, nunca menos de 2); o restante
aguarda sua vez no servidor, para que o fan-out de uma gravação atrase seus próprios frames
em vez de atrasar suas requisições. Uma tabela que recebe gravações várias vezes por segundo enquanto
**centenas de usuários diferentes** observam a mesma lista é onde esses frames
começam a sofrer atrasos. Além desse ponto, prefira assinaturas mais restritas (uma página, um filtro nas
próprias linhas do usuário) ou um [canal de broadcast](#canais-de-broadcast) transmitindo a
alteração para que os clientes façam o refetch no seu próprio ritmo.

**Um socket pode conter no máximo 1.000 assinaturas.** A próxima é recusada com um frame de erro com o código `TOO_MANY_SUBSCRIPTIONS`; assinar novamente sob um id que o socket já possui substitui essa assinatura e não conta novamente. O SDK compartilha assinaturas idênticas em um socket, portanto isso conta as listas e registros distintos que uma página tem abertos. Altere isso com `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket` no adaptador Postgres (a variável de ambiente tem precedência); um valor que não seja um número inteiro positivo interrompe o servidor na inicialização. **Os sockets que um usuário possui também podem ser limitados**, por instância de servidor: defina `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), e um login além desse limite será recusado com `TOO_MANY_SOCKETS` e o socket fechado com 4002. Sockets autenticados com uma chave de API contam contra essa chave, cada chave individualmente, não contra a conta que a criou; a chave de serviço é uma única credencial, portanto todos os seus sockets contam juntos. Os sockets de um administrador que personifica um usuário contam contra o administrador, junto com seus próprios sockets, não contra o usuário como o qual ele atua. O SDK notifica todas as assinaturas ativas e `onConnectionLost` de uma só vez, com um erro `CONNECTION_LOST` cujo `details.reason` é `TOO_MANY_SOCKETS`, e continua tentando novamente, esperando mais tempo a cada tentativa até 30 s, para que a aba consiga se conectar assim que outro socket for fechado. Não definido, como por padrão, não há limite máximo.

O id de uma assinatura pertence ao próprio socket: dois clientes que nomeiem uma assinatura como `"sub-1"` mantêm cada um a sua, e um `unsubscribe` encerra apenas a do remetente.

**Assinar consome o limite de taxa (rate limit) de dados.** O primeiro frame de uma assinatura é uma leitura, executada com a identidade do assinante, assim como a requisição de histórico de um canal. Portanto, `subscribe_collection`, `subscribe_one` e `channel_history` contam como requisições de dados no bucket de rate limit do chamador (aquele que suas requisições HTTP e seus outros sockets compartilham) uma vez que a cota do próprio socket for esgotada. Cada socket pode enviar 1.000 dessas requisições sem que sejam contabilizadas, ou tantas quanto o teto de assinaturas quando este for maior, e a cota se restabelece ao longo de 15 minutos. Isso cobre tudo o que um socket pode manter, de modo que a reassinatura após uma reconexão nunca seja recusada e nunca gaste o orçamento da pessoa. Ultrapassada a cota, um frame que exceda o limite é recusado com um frame de erro codificado como `RATE_LIMITED`, que o SDK entrega ao `onError` dessa assinatura ou ao do canal.

### Sockets que param de responder

Um cliente pode desaparecer sem fechar seu socket: um telefone perde o
sinal, um laptop entra em repouso, um NAT esquece a conexão. Nenhum frame de encerramento
chega, portanto nada informa o servidor. O servidor, portanto, envia um ping a cada socket
a cada 30 segundos e encerra qualquer um que não tenha respondido até o próximo ping, de modo que
um cliente desaparecido seja liberado em até um minuto. Os navegadores e o SDK respondem aos
pings automaticamente; um cliente que se comunique diretamente com o protocolo também deve respondê-los,
como a maioria das bibliotecas de WebSocket faz.

**O lado do navegador.** Um navegador não pode enviar um ping nem ver um, portanto, um socket semiaberto parece conectado para ele indefinidamente. O SDK abre o socket com `?rebase_caps=heartbeat,channel_seq,cancel_sql`; um servidor que os reconhece responde com `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listando aqueles que honra (`cancel_sql`: aceita o frame `CANCEL_SQL` do console SQL), e envia `{"type":"heartbeat"}` a cada 30 segundos, e o SDK derruba o socket e [reconecta](#reconexão-automática) após dois perdidos. Um cliente que não especifica nada não recebe nenhum dos dois, e um servidor mais antigo ignora o parâmetro, de modo que um SDK conversando com ele se comporta como antes.

Um socket também é encerrado quando mais de 16&nbsp;MiB de frames enviados a ele
permanecem não lidos. Isso indica um cliente que não lê o que lhe é enviado, ou um tão
atrasado que o que ele leria estaria obsoleto. E quando os sockets de um servidor mantêm juntos
mais de 256&nbsp;MiB não lidos (ou um quarto do limite de memória sob o qual o servidor
opera, o que for menor), aqueles com a maior quantidade não lida são encerrados
primeiro, até que o restante caiba.

Um socket encerrado é limpo da mesma forma que um socket fechado. Suas assinaturas terminam, ele
sai de seus canais e sua presença é removida, com a saída sendo anunciada
para os outros membros. Um cliente que ainda está presente vê a conexão cair,
e o SDK [reconecta](#reconexão-automática) e assina novamente.

## Canais de Broadcast

Os canais de broadcast permitem que os clientes enviem mensagens arbitrárias entre si em tempo real — útil para funcionalidades como indicadores de digitação, posições do cursor ou notificações customizadas.

O broadcast é gerenciado no nível do protocolo WebSocket. O servidor suporta estes tipos de mensagens:

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Entrar em um canal nomeado               |
| `leave_channel`   | Client → Server | Sair de um canal                         |
| `broadcast`       | Client → Server | Enviar uma mensagem para todos os membros do canal |
| `broadcast`       | Server → Client | Receber uma mensagem de outro membro     |
| `channel_history` | Client → Server | Solicitar mensagens retidas após uma sequência |
| `channel_history` | Server → Client | As mensagens retidas que um cliente perdeu |

Quando um cliente envia uma mensagem de `broadcast`, o servidor a retransmite para **todos os outros membros** daquele canal (o remetente não recebe sua própria mensagem).

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

Por padrão, uma transmissão (broadcast) atinge os membros atualmente conectados e depois desaparece. Esse é o compromisso ideal para notificações e cursores, e não custa nada.

Para um fluxo de operações — edição colaborativa, qualquer situação em que uma lacuna silenciosa cause divergência — um canal pode ser configurado para **reter** suas mensagens. Os broadcasts retidos recebem um número de sequência por canal e são armazenados, para que um cliente que se reconecte possa solicitar tudo após a última mensagem que viu.

:::caution[Where this goes]
**Runtime gerenciado: em nenhum lugar.** A retenção de canais e o `realtime.bus` fazem parte
do adaptador de banco de dados que o próprio runtime gerenciado constrói, e nenhum dos dois tem um
formato por variáveis de ambiente. Faça o eject para configurá-los.
**Após o eject:** `createPostgresAdapter({ realtime })` em `backend/src/index.ts`.
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

| Field   | Description                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Nome exato do canal (`"doc:42"`) ou um prefixo terminado em `*` (`"doc:*"`) |
| `limit` | Manter no máximo esta quantidade das mensagens mais recentes por canal      |
| `ttl`   | Manter as mensagens por no máximo este tempo — `"30s"`, `"15m"`, `"24h"`, `"7d"` ou milissegundos |

Uma regra precisa de pelo menos um entre `limit` ou `ttl`. Uma regra sem nenhum dos dois é ignorada e registrada em log, porque uma retenção ilimitada quase nunca é intencional e não pode ser revertida facilmente depois que a tabela crescer.

:::note[Why not let clients ask for history?]
Um canal é criado por quem o nomeia. Se um cliente pudesse escolher sua própria profundidade de histórico, qualquer visitante poderia comprometer seu backend com armazenamento ilimitado. Configurá-lo aqui também significa que os canais de presença e notificação — a esmagadora maioria — não pagam nada: sem regras configuradas, nenhuma tabela é criada e o broadcast segue o mesmo caminho síncrono de sempre.
:::

### Armazenamento

Os canais retidos usam duas tabelas no esquema `rebase`, criadas automaticamente na inicialização quando pelo menos uma regra é configurada:

| Table                     | Contents                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | As mensagens retidas, indexadas por `(channel, seq)`            |
| `rebase.channel_cursors`  | A maior sequência emitida por canal                             |

A poda (pruning) acontece à medida que as mensagens chegam, com taxa limitada por canal para que o custo acompanhe o tempo decorrido em vez do volume de gravações. Ela remove apenas linhas de `channel_messages` — os cursores são mantidos indefinidamente (eles representam uma linha pequena por canal), pois reiniciar a sequência de um canal mudaria o significado do ponto de retomada salvo por um cliente.

### Garantias de entrega

- **Ordenado.** Os números de sequência são alocados por canal, e a ordem de entrega corresponde à ordem de sequência — em uma única instância e entre instâncias no barramento `postgres`, onde a instrução que numera uma mensagem também a anuncia, de modo que cada instância (incluindo a do remetente) receba os anúncios na ordem de sequência. Um barramento que você mesmo forneça transporta os frames em qualquer ordem em que os entregar.
- **Durável antes de entregue.** Uma mensagem que não pode ser armazenada não é entregue a ninguém, e o remetente é informado. Entregá-la a colocaria diante de assinantes ativos enquanto a deixaria de fora de qualquer replay futuro, e nenhuma mensagem posterior poderia reparar essa lacuna.
- **Ao menos uma vez (At-least-once) na recuperação.** Um intervalo de repetição (replay) pode se sobrepor a mensagens que um cliente já recebeu; o SDK descarta aquelas que já tiver entregue.
- **Sem lacunas.** Uma mensagem retida atinge todos os membros: o remetente, que nunca recebe sua própria mensagem, recebe `{"type":"broadcast_ack","channel","seq"}` quando tiver optado pelo `channel_seq`. Portanto, uma mensagem além de `lastSeq + 1` significa que uma foi perdida, e o SDK a retém, solicita o histórico intermediário e entrega todas elas em ordem. Em relação a um servidor sem `channel_seq`, um salto é entregue assim que chega.

:::caution[History has the same access model as the channel]
Um cliente que ingressou em um canal pode reproduzir suas mensagens retidas, incluindo aquelas transmitidas antes de sua chegada — ser membro é a única verificação, e a entrada é permitida a qualquer cliente que souber o nome do canal. A retenção é opcional por padrão de canal, portanto habilitá-la torna o passado desse canal legível para qualquer visitante que adivinhe o nome. Os canais retidos são o caso em que isso se torna durável em vez de momentâneo, portanto trate o conteúdo de um canal retido como público para os seus usuários.
:::

## Rastreamento de Presença

O recurso de presença rastreia quais usuários estão online em um canal no momento e permite que cada usuário compartilhe estado customizado (por exemplo, posição do cursor, status).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Iniciar o rastreamento de presença com estado customizado |
| `presence_untrack`| Client → Server | Parar o rastreamento de presença                     |
| `presence_state`  | Client → Server | Solicitar o estado completo de presença de um canal  |
| `presence_state`  | Server → Client | Todas as presenças no canal, na íntegra              |
| `presence_diff`   | Server → Client | Atualização incremental (entradas e saídas)          |

Quando um cliente envia `presence_track`, o servidor o adiciona automaticamente ao canal (sem necessidade de um `join_channel` separado) e transmite um `presence_diff` para todos os membros do canal. O SDK reenvia seu estado a cada ~20 segundos como um heartbeat; um heartbeat cujo estado permaneça inalterado apenas renova o timeout do cliente e não envia nenhum `presence_diff`.

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

O SDK tipado reconecta automaticamente quando a conexão WebSocket cai:

- **Backoff exponencial** — Cada nova tentativa de discagem espera por um intervalo que começa em 2 segundos e dobra a cada vez, até 30 segundos. O atraso é escolhido aleatoriamente de qualquer ponto desse intervalo, mas nunca inferior a um quarto de segundo, para que clientes desconectados juntos por um deploy retornem distribuídos ao longo de todo o intervalo, em vez de no mesmo instante.
- **Sem desistência enquanto algo estiver ativo** — Enquanto existir uma assinatura ou um canal no qual tenha entrado, o cliente continua tentando rediscar no teto de 30 segundos durante todo o tempo em que a interrupção durar. Sem nada registrado, ele para após 5 tentativas com falha, e a próxima assinatura tenta discar novamente. Em um navegador, o evento `online` e o retorno da visibilidade da aba disparam uma nova discagem imediatamente, em vez de esperar o término do backoff.
- **Interrupções são reportadas uma única vez** — Quando a conexão fica inoperante por 14 segundos, independentemente de quantas tentativas tenham ocorrido, o `onError` de cada assinatura ativa e o `onError` de cada canal acessado recebe um `RebaseApiError` com o código `CONNECTION_LOST`. A assinatura é **mantida**: o erro indica que seus dados não estão sendo atualizados, não que ela foi encerrada.
- **Reassinatura automática** — Após uma reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor, e o próximo `onUpdate` de cada uma carrega tudo o que foi gravado enquanto o cliente esteve desconectado. Essa atualização é o sinal de recuperação. Nenhuma intervenção manual é necessária.
- **As requisições são no máximo uma vez (at-most-once)** — Uma requisição feita enquanto o socket está fora do ar aguarda por ele por até 30 segundos a partir da chamada e, em seguida, falha com `REQUEST_TIMEOUT` sem nunca ter sido enviada. Uma requisição que já havia sido enviada quando a conexão caiu falha com `CONNECTION_LOST` e **não** é enviada novamente: o servidor pode ou não tê-la executado, e apenas o chamador sabe se executá-la duas vezes é seguro.

`client.ws.state` informa o estado atual da conexão, e `onStateChange` é notificado a cada
mudança:

| State | Meaning |
|---|---|
| `idle` | Sem socket, e nenhum desejado ainda (a conexão é lazy), ou um sign-out o encerrou. |
| `connecting` | Discando/conectando, sem nenhuma interrupção em andamento. |
| `connected` | O socket está aberto. |
| `reconnecting` | O socket caiu e o cliente está tentando se reconectar. Nada foi reportado ainda. |
| `disconnected` | A interrupção durou 14 segundos ou mais. `CONNECTION_LOST` foi reportado, e o cliente continua tentando rediscar. |
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

O painel admin do Rebase exibe um banner próprio enquanto o estado estiver como `disconnected`, e mantém as linhas e registros já presentes na tela em vez de substituí-los por um erro.

## Autenticação e RLS

As assinaturas WebSocket respeitam automaticamente as políticas de Row-Level Security (RLS). Quando o cliente está autenticado:

1. A conexão WebSocket se autentica usando o mesmo token JWT da API REST.
2. Cada refetch de assinatura é executado dentro de uma transação PostgreSQL com `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantindo que as políticas de RLS sejam aplicadas.
3. A identidade é verificada novamente enquanto o socket estiver aberto, não apenas no momento da autenticação. Antes de cada frame, o servidor verifica o que uma requisição HTTP verificaria: o token ainda é válido, sua sessão foi encerrada ou revogada, a conta ainda existe e quais roles ela possui agora. Frames de canal realizam essa checagem no máximo uma vez por segundo. Frames que chegam a um socket enquanto a checagem ainda está em andamento — como um cliente reenviando suas assinaturas após uma reconexão — compartilham essa checagem em vez de cada um consultar novamente; o frame seguinte após sua conclusão consulta do zero. Um socket que apenas escuta é consultado pelo menos a cada 30 segundos, e um token deixa de ser aceito no instante exato em que expira. Uma role removida é aplicada a partir do próximo frame (ou, no caso de um frame que compartilhou uma checagem em andamento, a partir do subsequente), para leituras, gravações e assinaturas abertas da mesma forma. Um socket cuja identidade foi finalizada recebe um frame `AUTH_ERROR` e é fechado com o código `4001`. Com a autenticação integrada, o código do frame diz o motivo, assim como as rotas HTTP informam: `SESSION_REVOKED` (sessão finalizada, revogada ou a conta excluída), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED`; para outro adaptador de autenticação, o código é `SESSION_ENDED`. Um `AUTHENTICATE` para uma sessão revogada ou conta desativada é recusado com `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (um token que não seja válido ou que tenha expirado é recusado com `INVALID_TOKEN`). O SDK não faz uma nova solicitação com o mesmo token e entrega a recusa, com o código incluído, ao `onError` do recurso que precisava da conta. O SDK autentica seu socket novamente a cada vez que atualiza seu token; um novo token para a mesma identidade (mesmo id de usuário, roles, flag de convidado e claims) mantém as assinaturas abertas como estão, e um para uma identidade diferente refaz o fetch de cada uma delas com a nova identidade. Após um `4001`, ele se reconecta com a sessão que possuir no momento, ou sem nenhuma. Um cliente que utilize o protocolo diretamente precisa enviar um token novo no `AUTHENTICATE` antes que o antigo expire.

Isso significa que cada socket recebe atualizações apenas para os registros que sua identidade autenticada tem permissão de visualizar.

Uma [chave de API](/docs/backend/api-keys/) também autentica o socket: envie a
chave `rk_…` onde o token de acesso iria. O socket então verifica cada frame
em relação aos [escopos](/docs/backend/roles-and-scopes/) da chave: uma busca (fetch), uma contagem ou uma
assinatura precisa de `data:read` em sua tabela, uma gravação (save) precisa de `data:write`, uma exclusão
`data:delete`. Um caminho aninhado necessita do escopo simples correspondente. Canais (broadcast e
presença) são recusados para uma chave de API, pois nenhum escopo os cobre. As mensagens do editor SQL e
de branches exigem `database:read` ou `database:write`, tanto para uma chave quanto para uma pessoa.

Executar mais de uma instância — o barramento LISTEN/NOTIFY, como a presença funciona
entre processos e como escrever seu próprio transporte — possui uma página própria:
[Tempo real entre instâncias](/docs/backend/realtime-transports/).

## Captura de Alterações no Nível do Banco de Dados (CDC)

Toda gravação confirmada emite eventos em tempo real, independentemente de como foi feita: REST,
SDK, Studio, `psql`, um cron job em outro serviço. Como a captura funciona, a
configuração `REALTIME_CDC` e o que ela requer: [Captura de alterações no banco de dados](/docs/backend/realtime-cdc/).

## Timeout de Requisições Pendentes

Para evitar que as requisições do cliente fiquem travadas indefinidamente, todas as operações WebSocket pendentes que aguardam uma resposta do servidor (como buscas pontuais de tabela `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) têm um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente exclui automaticamente a requisição pendente e rejeita a promise com um `RebaseApiError` cujo código é `REQUEST_TIMEOUT`.

Mensagens unidirecionais que não esperam uma resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) são resolvidas imediatamente após a transmissão e não acionam esse timeout. Uma assinatura cujo primeiro frame não tiver chegado 30 segundos após o envio do subscribe falha, com `SUBSCRIPTION_TIMEOUT` em seu `onError`.

### Quando um frame de canal é recusado

Um frame de canal é no estilo fire-and-forget: `await channel.broadcast(...)` é resolvido quando
o frame é gravado no socket, **não** quando o servidor o aceita. Isso é
intencional — um aplicativo colaborativo transmite a posição do cursor sessenta vezes por
segundo, e aguardar uma confirmação para cada uma tornaria cada envio um round trip.

Portanto, uma recusa não pode ser uma promise rejeitada. Ela chega no `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Means |
|------|-------|
| `CHANNEL_FORBIDDEN` | Você não é um membro do canal — entre nele antes de transmitir ou ler seu histórico |
| `RATE_LIMITED` | Ultrapassou a cota de frames de canal (7.200 frames de canal por minuto por socket) ou, para uma requisição de histórico, ultrapassou o [limite de taxa de dados](#quanto-custa-uma-gravação-e-os-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Um broadcast retido não pôde ser persistido e foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Uma requisição de recuperação não pôde ser atendida |
| `CHANNEL_HISTORY_GAP` | Gerado pelo cliente: uma recuperação identificou que o servidor não retém mais as mensagens que este cliente nunca recebeu. `details` é `{ from, to }`, os números de sequência perdidos. Ressincronize o estado do canal a partir da sua fonte da verdade |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast atingiu apenas esta instância — consulte [O limite de 8 KB no barramento Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sem nenhum manipulador associado, estes erros são registrados como um aviso. Eles costumavam ser
descartados completamente: não havia promise para rejeitar nem canal para entregar,
de modo que um broadcast proibido era indistinguível de um entregue.

## Próximos Passos

- [SDK Tipado](/docs/sdk) — Referência completa do SDK, incluindo acessadores de tabelas tipados.
- [Autenticação](/docs/backend/authentication) — Configure a autenticação JWT e políticas de RLS.
- [Arquitetura do Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.
