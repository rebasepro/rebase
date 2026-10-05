---
sourceHash: 4b2acc8e12bf440c
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

Para implantações multi-instância, o Rebase usa o `LISTEN/NOTIFY` do PostgreSQL para transmitir alterações entre instâncias de servidor. Isso é gerenciado automaticamente — uma conexão dedicada do PostgreSQL escuta no canal `rebase_entity_changes` e repassa as atualizações para os assinantes locais.

### Zero Configuração

O tempo real é habilitado por padrão. Não há nenhuma flag para ativar nem serviço para iniciar — se o seu servidor Rebase estiver em execução, o endpoint WebSocket estará disponível.

> Por padrão, o Rebase também emite eventos em tempo real para gravações feitas **fora** da API (via `psql`, outro serviço ou pelo editor SQL do Studio) sempre que a conexão com o banco de dados suportar — veja [captura de alterações a nível de banco de dados (CDC)](#captura-de-alterações-a-nível-de-banco-de-dados-cdc).

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

O callback recebe um `FindResponse<M>` contendo:
- `data` — Array de objetos `Entity<M>`.
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
  (entity) => {
    if (entity) {
      console.log("Product updated:", entity.values);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

O callback recebe `Entity<M> | undefined`. O valor `undefined` significa que a entidade foi excluída.

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
O método `.listen()` no query builder só está disponível quando o `RebaseClient` está configurado com um `websocketUrl`. Se a conexão WebSocket não estiver configurada, chamar `.listen()` lançará um erro.
:::

## Entrega de Atualizações: Patch Instantâneo + Refetch de Correção

Uma alteração nunca viaja para um assinante como dados. Ela viaja como o fato de que algo mudou, e cada assinante é então informado sobre o que *ele* pode ver por meio de uma consulta executada em seu nome:

1. **Invalidação.** Quando uma entidade é alterada (criada, atualizada, excluída), o servidor marca os caminhos afetados. A linha que foi gravada não é encaminhada — ela foi lida sob a autorização de quem gravou, o que não diz nada sobre o que qualquer assinante tem permissão para ver.

2. **Refetch debounced com RLS.** Após **300ms** (`REFETCH_DEBOUNCE_MS`), o servidor busca novamente a coleção com seus filtros e ordenação originais. A consulta é executada dentro de uma transação que define os valores locais de transação `app.user_id` e `app.user_roles` a partir do `SubscriptionAuthContext` do assinante, para que o Postgres avalie a Segurança em Nível de Linha (RLS) sob a identidade daquele cliente e apenas as linhas que ele tem autorização para ver sejam enviadas no `collection_update`. O debounce também agrupa uma sequência rápida de gravações em uma única consulta.

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

Quando a contagem em si falha, o frame traz `partial: true` e nenhum `total`; isso não é um erro de assinatura, e o cliente deve manter o último total real em vez de substituí-lo pelo tamanho da página.

### O que uma gravação custa, e os limites

Como todo frame é uma consulta executada como seu assinante, o custo de uma gravação cresce
com o número de **perguntas distintas feitas por principals distintos** na
coleção que ela afetou — não com o número de sockets abertos:

- Assinaturas que fazem a mesma pergunta (mesmo caminho, filtros, ordenação, página,
  `include`, `fields`, busca) como o mesmo principal (mesmo id de usuário, roles,
  flag de convidado e claims) compartilham um único refetch. Uma gravação em uma lista custa **uma leitura
  e uma contagem por grupo desses**, não importa quantos sockets a possuam; cada membro
  ainda recebe um frame construído a partir de linhas lidas sob essa identidade.
- Uma assinatura de registro único só é consultada quando o próprio registro muda.
- Principals diferentes nunca compartilham uma leitura — é isso que impede que um frame
  carregue uma linha que seu leitor não pode ver. Uma lista observada por mil
  usuários conectados diferentes é mil leituras e mil contagens em cada
  gravação sobre ela.

Medido em um notebook contra um PostgreSQL local com um pool de 20 conexões, uma
gravação em uma lista:

| Assinantes | Transações para a gravação | Último frame após a gravação |
|-------------|----------------------------|----------------------------|
| 1.000, um principal | 4 | ~350 ms |
| 1.000, cada um um principal diferente | ~2.000 | ~700 ms |

300 ms de cada um é o debounce. A segunda linha é o teto a planejar: os
refetches entram na fila do mesmo pool que o seu tráfego REST, então uma coleção escrita
várias vezes por segundo enquanto **centenas de usuários diferentes** observam a mesma
lista é onde o tempo real começa a competir com as requisições. Além disso, prefira
assinaturas mais estreitas (uma página, um filtro sobre as próprias linhas do usuário) ou um
[canal de broadcast](#canais-de-broadcast) carregando a alteração para os clientes
refazerem a busca em seu próprio ritmo.

<span class="since-badge" data-since="0.24">Since 0.24</span> **Um socket pode manter no máximo 1.000 assinaturas.** A próxima é recusada com
um frame de erro codificado `TOO_MANY_SUBSCRIPTIONS`; reassinar sob um id que o
socket já possui substitui aquela assinatura e não conta de novo. O
SDK compartilha assinaturas idênticas em um socket, então isso conta as listas e
registros distintos que uma página mantém abertos. Altere isso com
`REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket`
no adaptador Postgres (a variável de ambiente prevalece); um valor que não é um
número inteiro positivo interrompe o servidor na inicialização. Na 0.23 as assinaturas de um socket
não têm limite.

Um id de assinatura é próprio do socket: dois clientes que ambos nomeiam uma
assinatura `"sub-1"` mantêm cada um a sua, e um `unsubscribe` encerra apenas a
do remetente.

### Sockets que param de responder

<span class="since-badge" data-since="0.24">Desde 0.24</span> Um cliente pode sumir sem fechar seu socket: um celular perde o
sinal, um notebook entra em suspensão, um NAT esquece a conexão. Nenhum frame de
fechamento chega, então nada avisa o servidor. Por isso o servidor envia um ping
a cada socket a cada 30 segundos e encerra o que não respondeu até o ping
seguinte, de modo que um cliente que sumiu é liberado em menos de um minuto.
Navegadores e o SDK respondem aos pings sozinhos; um cliente que fala o
protocolo diretamente também precisa respondê-los, como faz a maioria das
bibliotecas de WebSocket.

Um socket também é encerrado quando mais de 16&nbsp;MiB de frames enviados a ele
continuam sem ser lidos. É um cliente que não lê o que recebe, ou um tão
atrasado que o que ele leria já está desatualizado.

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
| `presence_state`  | Servidor → Cliente | Entidade completa de todas as presenças em um canal  |
| `presence_diff`   | Servidor → Cliente | Atualização incremental (entradas e saídas)          |

Quando um cliente envia `presence_track`, o servidor o adiciona automaticamente ao canal (sem necessidade de um `join_channel` separado) e transmite um `presence_diff` para todos os membros do canal.

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

- **Backoff exponencial** — A primeira nova tentativa ocorre cerca de 2 segundos após a queda, e cada uma das seguintes espera o dobro do tempo, até um limite de 30 segundos. Cada atraso é reduzido em até um quinto, de forma aleatória, para que clientes derrubados juntos por um deploy não voltem todos no mesmo instante.
- **Sem desistência enquanto algo estiver ativo** — Enquanto existir uma assinatura ou um canal associado, o cliente continua tentando reconectar no teto de 30 segundos por todo o tempo que a interrupção durar. Sem nada registrado, ele para após 5 tentativas com falha, e a próxima assinatura disca de novo. Em um navegador, o evento `online` e a aba se tornando visível novamente disparam uma nova tentativa imediatamente, em vez de esperar o backoff.
- **Interrupções são reportadas uma vez** — Quando a conexão está fora do ar por cerca de 15 segundos (três tentativas com falha), o `onError` de toda assinatura ativa e o `onError` de todo canal associado recebe um `RebaseApiError` com o código `CONNECTION_LOST`. A assinatura é **mantida**: o erro diz que seus dados não estão sendo atualizados, não que ela terminou.
- **Re-assinatura automática** — Após uma reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor, e o próximo `onUpdate` de cada uma carrega tudo o que foi gravado enquanto o cliente estava fora. Essa atualização é o sinal de recuperação. Nenhuma intervenção manual é necessária.
- **Requisições são no máximo uma vez (at-most-once)** — Uma requisição feita enquanto o socket está fora do ar espera por ele, por até 30 segundos a partir da chamada, e então falha com `REQUEST_TIMEOUT` sem nunca ter sido enviada. Uma requisição que já havia sido enviada quando a conexão caiu falha com `CONNECTION_LOST` e **não** é enviada novamente: o servidor pode ou não tê-la executado, e só o chamador sabe se executá-la duas vezes é seguro.

<span class="since-badge" data-since="0.24">Since 0.24</span> `client.ws.state` indica em que ponto a conexão está, e `onStateChange` é avisado de cada
mudança. Na 0.23 nenhum dos dois existe, o cliente para após 5 tentativas com falha, e
as mensagens enviadas enquanto desconectado são colocadas em fila e enviadas após a reconexão:

| Estado | Significado |
|---|---|
| `idle` | Sem socket, e nenhum desejado ainda (a conexão é lazy), ou um logout o encerrou. |
| `connecting` | Discando, sem nenhuma interrupção em andamento. |
| `connected` | O socket está aberto. |
| `reconnecting` | O socket caiu e o cliente está discando de novo. Nada foi reportado ainda. |
| `disconnected` | A interrupção já dura cerca de 15 segundos ou mais. `CONNECTION_LOST` já foi reportado, e o cliente continua discando de novo. |
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
3. <span class="since-badge" data-since="0.24">Since 0.24</span> A identidade é verificada novamente durante todo o tempo em que o socket está aberto, não apenas quando se autentica. Antes de cada frame o servidor pergunta o que uma requisição HTTP perguntaria: o token ainda é válido, sua sessão foi desconectada ou revogada, a conta ainda existe, e quais roles ela possui agora. Frames de canal são consultados no máximo uma vez por segundo. Um socket que só escuta é consultado pelo menos a cada 30 segundos, e um token deixa de ser aceito no instante em que expira. Uma role removida se aplica a partir do próximo frame, tanto para leituras quanto para gravações e assinaturas abertas. Um socket cuja identidade terminou recebe um frame `AUTH_ERROR` com o código `SESSION_ENDED` ou `TOKEN_EXPIRED` e é encerrado com o código `4001`. O SDK reautentica seu socket a cada vez que atualiza seu token, e depois de um `4001` ele se reconecta com a sessão que possui naquele momento, ou sem nenhuma. Um cliente que se comunica diretamente com o protocolo precisa enviar um token novo em `AUTHENTICATE` antes que o antigo expire.

Isso significa que cada socket recebe apenas atualizações de registros que sua identidade autenticada tem permissão para ver.

<span class="since-badge" data-since="0.24">Desde 0.24</span> Uma [chave de API](/docs/backend/api-keys/) também autentica o socket: envie a
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

**O Change Data Capture vem ativado por padrão.** O Rebase captura alterações no banco de dados e emite eventos em tempo real para **toda gravação confirmada (committed), independentemente de como ela foi feita** — REST, SDK, Studio, `psql`, um cron job em outro serviço, Drizzle/SQL puro ou pelo **editor SQL** do Studio. Este é o mesmo modelo do Supabase Realtime monitorando o write-ahead log.

Nenhuma configuração é necessária. Em uma conexão de banco de dados que suporte o recurso, o CDC se autoprovisiona na inicialização; em uma que não suporte (por exemplo, uma role restrita que não pode criar triggers), o Rebase silenciosamente usa o tempo real em nível de aplicação — nada para ativar, nada que quebre.

### Configuração

O CDC é controlado pela variável de ambiente `REALTIME_CDC`:

| Valor | Comportamento |
| --- | --- |
| `auto` *(padrão)* | Habilita a captura a nível de banco de dados onde a conexão permitir; faz **fallback silencioso** para o tempo real a nível de aplicação caso contrário. Zero configuração. |
| `trigger` | Força a captura baseada em triggers. Funciona em qualquer PostgreSQL, incluindo instâncias gerenciadas sem replicação lógica. Emite aviso (em vez de fazer fallback silencioso) se não conseguir provisionar. |
| `wal` | Dá preferência à replicação lógica WAL. Ainda não empacotado nativamente — degrada para `trigger` e registra o modo ativo nos logs. |
| `off` | Apenas tempo real a nível de aplicação. Use isso para evitar o overhead de triggers por gravação em cargas de trabalho com muitas gravações. |

Na inicialização, você verá uma linha de log informando o modo ativo, por exemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se a conexão não puder dar suporte, `auto` registra uma linha informativa em vez disso e continua com o tempo real a nível de aplicação:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Como Funciona

1. **Autoprovisionamento** — Na inicialização (contexto de servidor/proprietário), o Rebase instala um trigger idempotente `AFTER INSERT/UPDATE/DELETE` em cada tabela gerenciada. O trigger emite uma notificação de alteração no canal `rebase_cdc` que nomeia a linha alterada pela sua chave — a chave primária, mais as duas colunas de id para uma tabela de junção muitos-para-muitos — e não carrega **nenhuma outra coluna**. O PostgreSQL não impõe nenhum privilégio sobre `LISTEN`, então qualquer role que possa se conectar ao banco de dados pode ler esse canal; ela aprende quais chaves mudaram, nunca o que elas contêm. Uma chave grande demais para o limite de 8&nbsp;KB do `NOTIFY` do PostgreSQL é enviada como nenhuma chave (uma alteração na coleção inteira), garantindo que o CDC nunca aborte a gravação que disparou o trigger. A função é substituída em toda inicialização que provisiona, então um banco de dados instrumentado por uma versão mais antiga — cujo trigger enviava linhas inteiras — é atualizado pela próxima inicialização, mesmo com `REALTIME_CDC=off`.
2. **Captura** — Um cliente `LISTEN` dedicado e fora do pool por instância consome o `rebase_cdc`, mapeia a tabela alterada de volta para sua coleção e encaminha a alteração para o mesmo pipeline de `RealtimeService` usado pelas mutações da API. Assim como o listener entre instâncias, ele prioriza `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura com RLS** — A linha bruta do fluxo de alterações **nunca** é encaminhada aos assinantes. A alteração é marcada como invalidada, e cada assinatura relê a linha sob seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente só recebe linhas que suas políticas de RLS permitem.
4. **Entre instâncias** — Como cada instância observa cada commit através do fluxo de alterações, o CDC também *é* o canal entre instâncias; a transmissão legada `rebase_entity_changes` por mutação não é utilizada enquanto o CDC estiver ativo.
5. **Desduplicação** — Uma mutação feita por meio da API do Rebase é entregue localmente no instante em que é confirmada e também é refletida de volta pelo fluxo de alterações. A instância de origem suprime esse eco (um registro de curta duração de suas próprias emissões), de modo que os assinantes nunca vejam uma gravação da API duas vezes.

### Requisitos & Observações

- O CDC requer uma connection string direta (`DATABASE_DIRECT_URL` ou a conexão primária) para o cliente `LISTEN` — poolers de conexão em modo de transação não oferecem suporte a sessões de `LISTEN` de longa duração.
- Os triggers são instalados apenas em tabelas associadas a uma coleção registrada. Gravações em tabelas não mapeadas são ignoradas.
- Uma coleção cuja tabela ainda não foi migrada é ignorada com um aviso, em vez de bloquear o CDC para as demais.
- O streaming de replicação lógica nativa do WAL (`wal2json`/`pgoutput`) está planejado; atualmente `REALTIME_CDC=wal` degrada para o caminho baseado em triggers, que oferece cobertura equivalente a nível de banco de dados.

## Timeout de Requisições Pendentes

Para evitar que as requisições dos clientes fiquem travadas indefinidamente, todas as operações WebSocket pendentes que esperam uma resposta do servidor (como buscas únicas de coleção `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) têm um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente exclui automaticamente a requisição pendente e rejeita a promise com um `ApiError` contendo a mensagem `"Request timed out"`.

Mensagens unidirecionais que não esperam resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` e `presence_state`) resolvem imediatamente após a transmissão e não acionam timeouts.

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
| `RATE_LIMITED` | Ultrapassou o limite de frames do canal mencionado acima |
| `CHANNEL_HISTORY_WRITE_FAILED` | Um broadcast retido não pôde ser persistido, então foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Uma solicitação de recuperação (catch-up) não pôde ser atendida |
| `CHANNEL_HISTORY_GAP` | Emitido pelo cliente: uma recuperação (catch-up) descobriu que o servidor não retém mais mensagens que este cliente nunca recebeu. `details` é `{ from, to }`, os números de sequência perdidos. Ressincronize o estado do canal a partir de sua fonte da verdade |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast alcançou apenas esta instância — veja [O limite de 8 KB no barramento do Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sem nenhum handler anexado, esses eventos são registrados no log como aviso. Eles costumavam ser completamente descartados: não havia promise para rejeitar e nenhum canal para entregar, então um broadcast proibido era indistinguível de um entregue.

## Próximos Passos

- [SDK tipado](/docs/sdk) — Referência completa do SDK, incluindo acessores tipados de coleção.
- [Autenticação](/docs/backend/authentication) — Configure a autenticação JWT e as políticas de RLS.
- [Arquitetura do Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.
