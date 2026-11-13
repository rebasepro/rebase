---
sourceHash: 8cfa91fb2859caf0
title: Tempo Real & WebSocket
sidebar_label: Tempo Real
description: Sincronização de dados em tempo real, canais de broadcast e rastreamento de presença via WebSocket.
---

O Rebase inclui um mecanismo de tempo real integrado que envia alterações de dados para clientes conectados via WebSocket.
Quando qualquer registro é criado, atualizado ou excluído, cada assinante que monitora essa tabela ou entidade recebe a atualização instantaneamente — sem necessidade de polling.

## Como Funciona

O pipeline de tempo real possui três estágios:

1. **Gatilho de banco de dados** — Uma mutação atinge o banco de dados PostgreSQL (via API REST, SDK ou Studio).
2. **Distribuição do servidor (fan-out)** — O servidor Rebase detecta a alteração e a distribui para todas as assinaturas WebSocket ativas que correspondem à tabela ou entidade afetada.
3. **Callback do cliente** — O SDK tipado dispara seu callback `onUpdate` com os dados atualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implantações com múltiplas instâncias, o Rebase usa o `LISTEN/NOTIFY` do PostgreSQL para transmitir alterações entre as instâncias do servidor. Isso é gerenciado automaticamente. Com a [captura de alterações no nível do banco de dados](/docs/backend/realtime-cdc/) ativada (o padrão onde a role do banco de dados puder criar gatilhos), cada instância escuta no canal `rebase_cdc` no qual os gatilhos de captura publicam, de modo que uma gravação seja ouvida independentemente do processo ou ferramenta que a realizou. Sem a captura, cada instância anuncia suas próprias gravações no canal `rebase_entity_changes`, e uma conexão dedicada em cada outra instância as retransmite para seus assinantes locais.

### Configuração Zero

O recurso de tempo real vem habilitado por padrão. Não há nenhuma flag para alternar ou serviço para iniciar — se o seu servidor Rebase estiver em execução, o endpoint do WebSocket estará disponível.

### Qual caminho o socket responde

O socket responde a upgrades em um caminho: o caminho base da API com a terminação `/api` removida, ou seja, `/` para uma API em `/api`. É para lá que o SDK disca: ele se conecta à sua `baseUrl`, enquanto suas requisições HTTP vão para `${baseUrl}/api`. Um upgrade para qualquer outro caminho é deixado para os outros ouvintes de `upgrade` do servidor, permitindo que seu aplicativo execute seu próprio servidor WebSocket no mesmo `http.Server`. Sem nenhum outro ouvinte, tal upgrade recebe uma resposta `404`.

Em um [servidor personalizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` define o caminho, e o `realtime.path` do adaptador Postgres sobrescreve o que o servidor derivou.

> Por padrão, o Rebase também emite eventos em tempo real para gravações feitas **fora** da API (via `psql`, outro serviço ou pelo editor SQL do Studio) sempre que a conexão do banco de dados permitir — consulte [captura de alterações no nível do banco de dados](/docs/backend/realtime-cdc/).

## Assinaturas no SDK Tipado

O SDK tipado do Rebase expõe dois métodos de assinatura em cada acessador de tabela:

- **`listen()`** — Assinar uma tabela inteira (com filtros opcionais).
- **`listenById()`** — Assinar uma única entidade pelo seu ID.

Ambos os métodos retornam uma **função para cancelar a assinatura** que você chama para parar de receber atualizações.

### Assinando uma Tabela

Use `listen()` para receber atualizações sempre que registros em uma tabela forem alterados:

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
- `data` — As linhas, de forma plana, conforme `find()` as retorna (`row.name`, e não `row.values.name`).
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

O servidor respeita esses filtros — apenas registros correspondentes são incluídos nas atualizações.

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

O callback recebe a linha, plana, como `findById()` a retorna (`row.name`, e não `row.values.name`), ou `undefined` quando a linha for excluída.

**Cada frame carrega a versão da linha.** `etagOf(row)` é a `ETag` que um `GET` da linha responde, portanto uma edição feita contra o que um frame exibiu pode ser salva com `ifMatch: etagOf(row)` e é recusada com `412` se a linha tiver sido alterada (consulte [Gravações condicionais](/docs/backend/writes/)). Na transmissão (on the wire), o `subscribe_one` do SDK solicita com `etag: true`, e cada frame `single_update` para uma linha existente traz `"etag"` ao lado de `"row"`. Um servidor anterior a isso ignora a solicitação e não envia a tag, e um cliente que não solicita recebe frames sem ela.

### Cancelando a Assinatura

Tanto `listen()` quanto `listenById()` retornam uma função de cancelamento de assinatura. Chame-a para parar de receber atualizações e limpar recursos no lado do servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Sempre chame a função de cancelamento de assinatura quando um componente for desmontado ou a página for navegada para fora. Isso evita vazamentos de memória e trabalho desnecessário no servidor.
:::

## Query Builder `.listen()`

O construtor de consultas fluente também oferece suporte a assinaturas em tempo real. Encadeie seus filtros e depois chame `.listen()` em vez de `.find()`:

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
`.listen()` — tanto no query builder quanto no acessador de tabela — necessita do WebSocket do cliente. O cliente deriva sua URL de `baseUrl`, a menos que `websocketUrl` seja fornecida. Em um cliente criado com `realtime: false`, ou em um que não conseguiu derivar uma URL, chamar `.listen()` lança um erro.
:::

## Entrega de Atualizações: Patch Instantâneo + Refetch de Correção

Uma alteração nunca viaja até um assinante como dados. Ela viaja como o fato de que
algo mudou, e cada assinante é então informado sobre o que *ele* pode ver através de
uma consulta executada em seu nome:

1. **Invalidação.** Quando uma entidade muda (criada, atualizada, excluída), o
   servidor marca os caminhos afetados. A linha gravada não é encaminhada —
   ela foi lida sob a autorização de quem gravou, o que não diz nada sobre o que
   qualquer assinante tem permissão para ver.

2. **Refetch com RLS debounced.** Após **300ms** (`REFETCH_DEBOUNCE_MS`), o servidor
   busca novamente a tabela com seus filtros e ordem de classificação originais. A consulta
   é executada dentro de uma transação que define `app.user_id` e
   `app.user_roles` locais da transação a partir do `SubscriptionAuthContext` do assinante, para que o Postgres
   avalie o Row-Level Security sob a identidade daquele cliente e apenas as linhas
   que ele tem autorização para ver sejam enviadas no `collection_update`. O debounce
   também agrupa uma rajada de gravações em uma única consulta. Ele aguarda 300 ms sem
   nenhuma alteração adicional, mas nunca mais do que **1 s** (`REFETCH_MAX_WAIT_MS`) após
   a primeira, de modo que uma tabela que receba gravações várias vezes por segundo ainda envie
   aos seus assinantes um frame pelo menos uma vez por segundo. Defina esse limite com `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`): um valor maior busca novamente uma tabela movimentada com menos frequência; um valor menor envia frames mais recentes.

   Um refetch que lê exatamente o que foi enviado pela última vez a um assinante não envia
   nada a ele: uma gravação na linha 9.000 de uma lista que mostra os primeiros 50 itens custa
   a leitura, não um frame para cada visualizador. Após um frame de erro, as próximas linhas
   são enviadas novamente, mesmo que sejam idênticas.

Versões anteriores enviavam um `collection_patch` imediato contendo a linha gravada
antes desse refetch, para feedback entre abas em sub-milissegundos. Essa linha havia sido
lida sob o escopo de quem a gravou, portanto podia — e conseguia — alcançar assinantes cujas
próprias políticas teriam negado o acesso, e o próprio filtro `where` da assinatura também não
era aplicado a ela. O patch foi removido: a latência percebida para uma
atualização agora é a janela do debounce.

### O refetch é a leitura REST

O refetch executa o mesmo pipeline que o `GET /api/data/<collection>` executa, com o
mesmo tratamento de `include`. É isso que faz com que `find({ q })` e `listen({ q })`
retornem linhas idênticas campo por campo.

Costumava ser um método diferente — que aninhava cada relação sob um
envelope `{ "__type": "relation" }` e, como uma assinatura não podia carregar nenhum
`include`, carregava ansiosamente (eagerly) **todas** as relações declaradas pela tabela. Assim, a mesma
consulta respondia com um formato via HTTP e outro via socket, e um cliente
renderizando ambos via suas linhas mudarem de formato no instante em que uma gravação ocorria.

Portanto, um frame de assinatura aceita o mesmo que uma requisição de listagem: `filter`,
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

`meta` é contabilizado dentro da mesma transação vinculada ao RLS que leu as linhas, de modo
que descreve com exatidão as linhas ao lado. Sem isso, um cliente que precisasse de um total
teria que emitir um `GET /count` **por push** — uma viagem de ida e volta (round trip) extra por gravação,
por assinante, e uma janela na qual a contagem e as linhas descreviam diferentes
estados da tabela.

Quando a contagem em si falha, o frame traz `partial: true` e nenhum `total`;
isso não é um erro de assinatura, e o cliente deve manter o último total real
em vez de substituí-lo pelo tamanho da página. Em uma tabela grande, a contagem representa a maior parte do custo de um frame. Com `REALTIME_RECOUNT_INTERVAL_MS` definido, uma lista cujo último total foi de pelo menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por padrão) reutiliza esse total durante o intervalo em vez de contar a cada gravação, e tal frame traz `meta.totalAsOf`, indicando quando o total foi obtido. Quando o intervalo termina, uma lista cujo último frame reutilizou o total é contada novamente e o novo total é enviado, quer algo tenha sido gravado desde então ou não. Não definido, como por padrão, cada frame faz a contagem.

### Quanto custa uma gravação e os limites

Como cada frame é uma consulta executada como seu assinante, o custo de uma gravação cresce
com o número de **perguntas distintas feitas por entidades principais (principals) distintas** na
tabela afetada — e não com o número de sockets abertos:

- Assinaturas que fazem a mesma pergunta (mesmo caminho, filtros, ordenação, página,
  `include`, `fields`, busca) como o mesmo principal (mesmo ID de usuário, roles,
  flag de convidado e claims) compartilham um único refetch. Uma gravação em uma lista custa **uma
  transação por grupo desse tipo** — a leitura e sua contagem — independentemente de quantos sockets
  a mantenham; cada membro ainda recebe um frame construído a partir de linhas lidas sob essa
  identidade. Uma primeira página que retorne menos itens do que o seu `limit` representa o conjunto
  completo, portanto não é contada de forma alguma.
- Uma assinatura de registro único só é consultada quando seu próprio registro é alterado.
- Principals diferentes nunca compartilham uma leitura — é isso que impede que um frame
  carregue uma linha que seu leitor não tem permissão para ver. Uma lista observada por mil
  usuários autenticados diferentes resulta em mil leituras e mil contagens a cada
  gravação nela, em mil transações.

Medido em um laptop contra um PostgreSQL local com um pool de 20 conexões, uma
gravação em uma lista:

| Assinantes | Transações para a gravação | Último frame após a gravação |
|-------------|----------------------------|----------------------------|
| 1.000, um único principal | 2 | ~310 ms |
| 1.000, cada um com um principal diferente | ~1.000 | ~600 ms |

300 ms de cada é o debounce. A segunda linha é o teto para o qual se deve planejar. Os
refetches são executados no mesmo pool do seu tráfego REST, mas usando no máximo um quarto de
suas conexões por vez (5 das 20 padrão, nunca menos de 2); o restante aguarda sua vez no servidor,
de modo que a distribuição (fan-out) de uma gravação atrase seus próprios frames
em vez de suas requisições. Uma tabela gravada várias vezes por segundo enquanto
**centenas de usuários diferentes** observam a mesma lista é onde esses frames
começam a sofrer atraso (lag). Além disso, dê preferência a assinaturas mais restritas (uma página, um filtro nas
próprias linhas do usuário) ou a um [canal de broadcast](#canais-de-broadcast) transmitindo a
alteração para que os clientes façam o refetch em seu próprio ritmo.

**Um socket pode manter no máximo 1.000 assinaturas.** A seguinte é recusada com um frame de erro com o código `TOO_MANY_SUBSCRIPTIONS`; assinar novamente sob um ID que o socket já possui substitui essa assinatura e não conta novamente. O SDK compartilha assinaturas idênticas em um socket, portanto isso conta as listas e registros distintos que uma página mantém abertos. Altere isso com `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket` no adaptador Postgres (a variável de ambiente tem precedência); um valor que não seja um número inteiro positivo interrompe o servidor na inicialização. **Os sockets que um usuário mantém também podem ser limitados**, por instância de servidor: defina `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), e um login além desse limite será recusado com `TOO_MANY_SOCKETS` e o socket fechado com 4002. Sockets autenticados com uma chave de API contam contra essa chave, cada chave individualmente, e não contra a conta que a criou; a chave de serviço é uma credencial única, portanto todos os seus sockets contam juntos. Os sockets de um administrador que personifica um usuário contam contra o administrador, junto com seus próprios sockets, e não contra o usuário em cujo nome atuam. O SDK notifica todas as assinaturas ativas e o `onConnectionLost` de uma só vez, com um erro `CONNECTION_LOST` cujo `details.reason` é `TOO_MANY_SOCKETS`, e continua tentando novamente, esperando mais tempo a cada tentativa até 30 s, para que a aba consiga se conectar assim que outro socket for fechado. Não definido, como por padrão, não há teto.

O ID de uma assinatura pertence ao próprio socket: dois clientes que nomeiem uma assinatura como `"sub-1"` mantêm cada um a sua, e um `unsubscribe` encerra apenas a do remetente.

**A assinatura conta contra o rate limit de dados.** O primeiro frame de uma assinatura é uma leitura, executada como o assinante, assim como a requisição de histórico de um canal. Portanto, `subscribe_collection`, `subscribe_one` e `channel_history` contam como requisições de dados no bucket de rate limit de quem chama (aquele compartilhado entre suas requisições HTTP e seus outros sockets) assim que a cota própria do socket é consumida. Cada socket pode enviar 1.000 dessas requisições sem que sejam contabilizadas, ou tantas quantas forem o seu teto de assinaturas quando este for maior, e a cota se renova ao longo de 15 minutos. Isso é tudo o que um socket pode comportar, de modo que a nova assinatura após uma reconexão nunca seja recusada e nunca gaste o limite do usuário. Ultrapassada a cota, um frame que exceda o limite é recusado com um frame de erro com o código `RATE_LIMITED`, que o SDK entrega ao `onError` daquela assinatura ou ao do canal.

### Sockets que param de responder

Um cliente pode desaparecer sem fechar seu socket: um celular perde o sinal, um notebook entra em repouso, um NAT esquece a conexão. Nenhum frame de encerramento chega, portanto nada avisa o servidor. Por essa razão, o servidor envia um ping a cada socket a cada 30 segundos e encerra aquele que não tiver respondido até o próximo ping, fazendo com que um cliente desconectado seja liberado em até um minuto. Navegadores e o SDK respondem aos pings automaticamente; um cliente que se comunique diretamente pelo protocolo também deve respondê-los, como faz a maioria das bibliotecas de WebSocket.

**O lado do navegador.** Um navegador não pode enviar um ping nem ver um, portanto um socket semiaberto parece conectado para ele indefinidamente. O SDK abre o socket com `?rebase_caps=heartbeat,channel_seq,cancel_sql`; um servidor que os reconheça responde com `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listando os recursos suportados (`cancel_sql`: ele aceita o frame `CANCEL_SQL` do console SQL) e envia `{"type":"heartbeat"}` a cada 30 segundos, e o SDK derruba o socket e [reconecta-se](#reconexão-automática) após perder dois heartbeats. Um cliente que não especifica nada não recebe nenhum dos dois, e um servidor mais antigo ignora o parâmetro, fazendo com que um SDK comunicando-se com ele se comporte como antes.

Um socket também é encerrado quando mais de 16&nbsp;MiB em frames enviados a ele ainda não foram lidos. Isso indica um cliente que não lê o que lhe é enviado, ou um tão atrasado que o que ele leria já estaria obsoleto. E quando os sockets de um servidor mantêm juntos mais de 256&nbsp;MiB não lidos (ou um quarto do limite de memória sob o qual o servidor roda, quando este for menor), aqueles com mais dados não lidos são encerrados primeiro, até que o restante se acomode.

Um socket encerrado é limpo da mesma forma que um fechado. Suas assinaturas terminam, ele sai de seus canais e sua presença é removida, com a saída sendo anunciada aos outros membros. Um cliente que ainda esteja lá percebe a queda da conexão, e o SDK [reconecta-se](#reconexão-automática) e assina novamente.

## Canais de Broadcast

Os canais de broadcast permitem que os clientes enviem mensagens arbitrárias entre si em tempo real — útil para recursos como indicadores de digitação, posições do cursor ou notificações personalizadas.

O broadcast é gerenciado no nível do protocolo WebSocket. O servidor suporta os seguintes tipos de mensagem:

| Tipo de Mensagem | Direção         | Descrição                                |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Cliente → Servidor | Entrar em um canal nomeado               |
| `leave_channel`   | Cliente → Servidor | Sair de um canal                         |
| `broadcast`       | Cliente → Servidor | Enviar uma mensagem para todos os membros do canal |
| `broadcast`       | Servidor → Cliente | Receber uma mensagem de outro membro     |
| `channel_history` | Cliente → Servidor | Solicitar mensagens retidas após uma sequência |
| `channel_history` | Servidor → Cliente | As mensagens retidas que um cliente perdeu |

Quando um cliente envia uma mensagem `broadcast`, o servidor a retransmite para **todos os outros membros** daquele canal (o remetente não recebe sua própria mensagem).

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

Por padrão, um broadcast alcança os membros conectados no momento e depois desaparece. Esse é o equilíbrio ideal para notificações e cursores, e não custa nada.

Para um fluxo de operações — edição colaborativa ou qualquer situação em que uma lacuna silenciosa cause divergência — um canal pode ser configurado para **reter** suas mensagens. Os broadcasts retidos recebem um número de sequência por canal e são armazenados, permitindo que um cliente que se reconecte possa solicitar tudo após a última mensagem que viu.

:::caution[Onde isso vai]
**Runtime gerenciado: em lugar nenhum.** A retenção de canal e o `realtime.bus` fazem parte do adaptador de banco de dados que o próprio runtime gerenciado constrói, e nenhum dos dois tem formato em variáveis de ambiente. Faça o eject para configurá-los.
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
| `ttl`   | Manter mensagens por no máximo este tempo — `"30s"`, `"15m"`, `"24h"`, `"7d"` ou milissegundos |

Uma regra precisa de pelo menos um entre `limit` ou `ttl`. Uma regra sem nenhum dos dois é ignorada e registrada em log, pois a retenção ilimitada quase nunca é intencional e não pode ser desfeita facilmente depois que a tabela cresceu.

:::note[Por que não permitir que os clientes solicitem o histórico?]
Um canal é criado por quem o nomeia. Se um cliente pudesse escolher sua própria profundidade de histórico, qualquer visitante poderia comprometer seu backend com armazenamento ilimitado. Configurá-lo aqui também significa que canais de presença e notificação — a grande maioria — não pagam nada: sem regras configuradas, nenhuma tabela é criada e o broadcast segue o mesmo caminho síncrono de sempre.
:::

### Armazenamento

Canais retidos usam duas tabelas no esquema `rebase`, criadas automaticamente na inicialização quando pelo menos uma regra é configurada:

| Tabela                    | Conteúdo                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | As mensagens retidas, indexadas por `(channel, seq)`             |
| `rebase.channel_cursors`  | A maior sequência emitida por canal                              |

A limpeza (pruning) ocorre à medida que as mensagens chegam, com taxa limitada (throttled) por canal para que o custo acompanhe o tempo decorrido em vez do volume de gravações. Ela remove apenas linhas de `channel_messages` — os cursores são mantidos indefinidamente (eles representam uma linha pequena por canal), pois reiniciar a sequência de um canal alteraria o significado do ponto de retomada salvo por um cliente.

### Garantias de entrega

- **Ordenado.** Números de sequência são alocados por canal, e a ordem de entrega corresponde à ordem da sequência — em uma única instância e entre instâncias no barramento `postgres`, onde a instrução que numera uma mensagem também a anuncia, de modo que cada instância (incluindo a do remetente) receba os anúncios na ordem da sequência. Um barramento fornecido por você mesmo transporta os frames na ordem em que os entrega.
- **Durável antes de entregue.** Uma mensagem que não pode ser armazenada não é entregue a ninguém, e o remetente é avisado. Entregá-la colocaria a mensagem na frente dos assinantes em tempo real, enquanto a deixaria de fora de qualquer reprodução (replay) futura, e nenhuma mensagem posterior conseguiria reparar essa lacuna.
- **Pelo menos uma vez (at-least-once) na recuperação.** Um intervalo de reprodução pode se sobrepor a mensagens que o cliente já recebeu; o SDK descarta aquelas que já tiver entregue.
- **Sem lacunas.** Uma mensagem retida chega a todos os membros: o remetente, que nunca recebe a sua própria mensagem, recebe `{"type":"broadcast_ack","channel","seq"}` quando opta por `channel_seq`. Portanto, uma mensagem além de `lastSeq + 1` significa que uma foi perdida, e o SDK a retém, solicita o histórico intermediário e entrega todas elas em ordem. Em relação a um servidor sem `channel_seq`, um salto é entregue assim que chega.

:::caution[O histórico tem o mesmo modelo de acesso do canal]
Um cliente que entrou em um canal pode reproduzir suas mensagens retidas, incluindo aquelas transmitidas antes de sua chegada — ser membro é a única verificação, e entrar está aberto a qualquer cliente que saiba o nome do canal. A retenção é opcional por padrão de canal, portanto ativá-la torna o passado daquele canal legível para qualquer visitante que adivinhe o nome. Canais retidos são o caso em que isso se torna durável em vez de momentâneo, portanto trate o conteúdo de um canal retido como público para seus usuários.
:::

## Rastreamento de Presença

O rastreamento de presença monitora quais usuários estão online no momento em um canal e permite que cada usuário compartilhe um estado personalizado (ex.: posição do cursor, status).

| Tipo de Mensagem   | Direção         | Descrição                                            |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Cliente → Servidor | Iniciar o rastreamento de presença com estado personalizado |
| `presence_untrack`| Cliente → Servidor | Parar o rastreamento de presença                     |
| `presence_state`  | Cliente → Servidor | Solicitar o estado completo de presença de um canal  |
| `presence_state`  | Servidor → Cliente | Todas as presenças no canal, por completo            |
| `presence_diff`   | Servidor → Cliente | Atualização incremental (entradas e saídas)          |

Quando um cliente envia `presence_track`, o servidor o adiciona automaticamente ao canal (sem necessidade de um `join_channel` separado) e transmite um `presence_diff` para todos os membros do canal. O SDK reenvia seu estado a cada ~20 segundos como um heartbeat; um heartbeat cujo estado não mudou apenas renova o timeout do cliente e não envia nenhum `presence_diff`.

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

O SDK tipado reconecta-se automaticamente quando a conexão WebSocket cai:

- **Backoff exponencial** — Cada nova tentativa de conexão aguarda por um intervalo que começa em 2 segundos e dobra a cada vez, até 30 segundos. O atraso é sorteado aleatoriamente dentro do intervalo, mas nunca abaixo de um quarto de segundo, para que clientes desconectados juntos por um deploy retornem distribuídos ao longo de todo o intervalo em vez de no mesmo instante.
- **Sem desistência enquanto algo estiver ativo** — Enquanto existir uma assinatura ou um canal no qual o cliente entrou, o cliente continuará tentando reconectar no teto de 30 segundos durante todo o tempo em que durar a interrupção. Sem nada registrado, ele para após 5 tentativas com falha, e a próxima assinatura tenta discar novamente. Em um navegador, o evento `online` e o retorno da visibilidade da aba acionam a reconexão imediatamente, em vez de aguardar o término do backoff.
- **Interrupções são reportadas uma única vez** — Quando a conexão fica inoperante por 14 segundos, independentemente de quantas tentativas tenham ocorrido, o `onError` de cada assinatura ativa e o `onError` de cada canal conectado recebem um `RebaseApiError` com o código `CONNECTION_LOST`. A assinatura é **mantida**: o erro indica que seus dados não estão sendo atualizados, e não que ela foi finalizada.
- **Reassinatura automática** — Após a reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor, e o próximo `onUpdate` de cada uma carrega tudo o que foi gravado enquanto o cliente esteve desconectado. Essa atualização é o sinal de recuperação. Nenhuma intervenção manual é necessária.
- **Requisições são do tipo at-most-once (no máximo uma vez)** — Uma requisição feita enquanto o socket está fora do ar aguarda por ele por até 30 segundos a partir da chamada, e então falha com `REQUEST_TIMEOUT` sem nunca ter sido enviada. Uma requisição que já havia sido enviada quando a conexão caiu falha com `CONNECTION_LOST` e **não** é enviada novamente: o servidor pode ou não tê-la executado, e somente o chamador sabe se executá-la duas vezes é seguro.

`client.ws.state` informa em que estado a conexão se encontra, e `onStateChange` é notificado a cada alteração:

| Estado | Significado |
|---|---|
| `idle` | Nenhum socket, e nenhum solicitado ainda (a conexão é lazy), ou um logout o desconectou. |
| `connecting` | Discando (conectando), sem interrupção em andamento. |
| `connected` | O socket está aberto. |
| `reconnecting` | O socket caiu e o cliente está tentando reconectar. Nada foi reportado ainda. |
| `disconnected` | A interrupção durou 14 segundos ou mais. `CONNECTION_LOST` foi reportado, e o cliente continua tentando reconectar. |
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

O painel de administração do Rebase exibe um banner próprio enquanto o estado for `disconnected`, mantendo as linhas e registros já exibidos na tela em vez de substituí-los por um erro.

## Autenticação & RLS

As assinaturas WebSocket respeitam automaticamente as políticas de Row-Level Security (RLS). Quando o cliente está autenticado:

1. A conexão WebSocket se autentica usando o mesmo token JWT da API REST.
2. Todo refetch de assinatura é executado dentro de uma transação PostgreSQL com `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantindo que as políticas de RLS sejam aplicadas.
3. A identidade é verificada novamente enquanto o socket estiver aberto, e não apenas no momento da autenticação. Antes de cada frame, o servidor verifica o mesmo que uma requisição HTTP verificaria: o token ainda é válido, sua sessão foi encerrada ou revogada, a conta ainda existe e quais roles ela possui agora. Frames de canal são verificados no máximo uma vez por segundo. Frames que chegam em um socket enquanto sua verificação ainda está em andamento — como um cliente reenviando suas assinaturas após uma reconexão — compartilham essa mesma verificação em vez de cada um consultar novamente; o frame seguinte após sua conclusão fará uma nova consulta. Um socket que apenas escuta é consultado pelo menos a cada 30 segundos, e um token deixa de ser aceito no instante em que expira. Uma role removida é aplicada a partir do próximo frame (ou, para um frame que compartilhou uma verificação já em andamento, a partir do subsequente), tanto para leituras, gravações quanto para assinaturas abertas. Um socket cuja identidade foi encerrada recebe um frame `AUTH_ERROR` e é fechado com o código `4001`. Com a autenticação integrada, o código do frame diz o motivo, assim como as rotas HTTP dizem: `SESSION_REVOKED` (logout realizado, revogado ou conta excluída), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED`; em outro adaptador de autenticação é `SESSION_ENDED`. Um `AUTHENTICATE` para uma sessão revogada ou conta desativada é recusado com `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (um token que não é verificado ou que expirou, com `INVALID_TOKEN`). O SDK não tenta novamente com o mesmo token e repassa a recusa, código incluído, para o `onError` de tudo o que precisava da conta. O SDK autentica seu socket novamente toda vez que renova seu token; um novo token para a mesma identidade (mesmo ID de usuário, roles, flag de convidado e claims) mantém as assinaturas abertas como estão, e um para uma identidade diferente executa o refetch de cada uma delas com essa nova identidade. Após um `4001`, ele reconecta com a sessão que possuir no momento, ou sem nenhuma. Um cliente que se comunica diretamente pelo protocolo precisa enviar um novo token em `AUTHENTICATE` antes que o antigo expire.

Isso significa que cada socket recebe atualizações apenas para registros que sua identidade autenticada tem permissão para ver.

Uma [chave de API](/docs/backend/api-keys/) também autentica o socket: envie a chave `rk_…` onde iria o token de acesso. O socket então verifica cada frame contra os [escopos](/docs/backend/roles-and-scopes/) da chave: uma busca (fetch), contagem ou assinatura precisa de `data:read` em sua tabela, um salvamento de `data:write`, uma exclusão de `data:delete`. Um caminho aninhado precisa do escopo simples. Canais (broadcast e presença) são recusados para uma chave, pois nenhum escopo os abrange. O editor SQL e mensagens de branch precisam de `database:read` ou `database:write`, tanto para uma chave quanto para uma pessoa.

A execução de mais de uma instância — o barramento LISTEN/NOTIFY, como a presença funciona entre processos e como escrever seu próprio transporte — tem uma página dedicada: [Tempo real entre instâncias](/docs/backend/realtime-transports/).

## Captura de Alterações no Nível do Banco de Dados (CDC)

Toda gravação confirmada (committed) emite eventos em tempo real, independentemente de como foi feita: REST, SDK, Studio, `psql`, um cron job em outro serviço. Como a captura funciona, a configuração `REALTIME_CDC` e seus requisitos: [Captura de alterações do banco de dados](/docs/backend/realtime-cdc/).

## Timeout de Requisições Pendentes

Para evitar que as requisições do cliente fiquem travadas indefinidamente, todas as operações WebSocket pendentes que aguardam uma resposta do servidor (como buscas pontuais de tabela `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) têm um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente exclui automaticamente a requisição pendente e rejeita a promise com um `RebaseApiError` cujo código é `REQUEST_TIMEOUT`.

Mensagens unidirecionais que não esperam resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) são resolvidas imediatamente após a transmissão e não acionam esse timeout. Uma assinatura cujo primeiro frame não tiver chegado 30 segundos após o envio do subscribe falhará com `SUBSCRIPTION_TIMEOUT` em seu `onError`.

### Quando um frame de canal é recusado

Um frame de canal é do tipo fire-and-forget: `await channel.broadcast(...)` resolve quando o frame é gravado no socket, e **não** quando o servidor o aceitou. Isso é intencional — um aplicativo colaborativo transmite uma posição de cursor sessenta vezes por segundo, e esperar por uma confirmação em cada uma tornaria cada envio uma viagem de ida e volta (round trip).

Portanto, uma recusa não pode ser uma promise rejeitada. Ela chega no `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|------|-------|
| `CHANNEL_FORBIDDEN` | Você não é membro do canal — entre nele antes de transmitir ou ler seu histórico |
| `RATE_LIMITED` | Excedeu a cota de frames do canal (7.200 frames de canal por minuto por socket) ou, para uma requisição de histórico, excedeu o [rate limit de dados](#quanto-custa-uma-gravação-e-os-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Um broadcast retido não pôde ser persistido, portanto foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Uma requisição de recuperação (catch-up) não pôde ser atendida |
| `CHANNEL_HISTORY_GAP` | Disparado pelo cliente: uma recuperação identificou que o servidor não retém mais as mensagens que este cliente nunca recebeu. `details` é `{ from, to }`, os números de sequência perdidos. Ressincronize o estado do canal a partir da sua fonte da verdade |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast alcançou apenas esta instância — consulte [O limite de 8 KB no barramento do Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sem nenhum manipulador (handler) associado, estes erros são registrados como aviso no log. Anteriormente, eles eram completamente descartados: não havia promise para rejeitar nem canal para entregar, portanto um broadcast proibido era indistinguível de um entregue.

## Próximos Passos

- [SDK Tipado](/docs/sdk) — Referência completa do SDK, incluindo acessadores tipados de tabela.
- [Autenticação](/docs/backend/authentication) — Configure a autenticação JWT e políticas de RLS.
- [Arquitetura de Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.
