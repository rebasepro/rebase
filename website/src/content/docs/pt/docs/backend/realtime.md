---
sourceHash: 512b1a9970d23a5b
title: Tempo Real & WebSocket
sidebar_label: Tempo Real
description: Sincronização de dados em tempo real, canais de broadcast e rastreamento de presença via WebSocket.
---

O Rebase inclui um motor de tempo real integrado que envia alterações de dados para clientes conectados via WebSocket.
Quando qualquer registro é criado, atualizado ou excluído, cada assinante que estiver monitorando essa tabela ou entidade recebe a atualização instantaneamente — sem necessidade de polling.

## Como Funciona

O pipeline de tempo real possui três estágios:

1. **Gatilho de banco de dados** — Uma mutação atinge o banco de dados PostgreSQL (via API REST, SDK ou Studio).
2. **Fan-out do servidor** — O servidor Rebase detecta a alteração e a distribui (fan-out) para cada assinatura ativa de WebSocket que corresponda à tabela ou entidade afetada.
3. **Callback do cliente** — O SDK tipado dispara seu callback `onUpdate` com os dados atualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implantações multi-instância, o Rebase usa o `LISTEN/NOTIFY` do PostgreSQL para propagar alterações entre instâncias do servidor. Isso é gerenciado automaticamente. Com a [captura de alterações no nível do banco de dados (CDC)](/docs/backend/realtime-cdc/) ativada (o padrão onde a role do banco de dados puder criar triggers), cada instância escuta no canal `rebase_cdc` em que os triggers de captura publicam, de modo que uma gravação é ouvida independentemente do processo ou ferramenta que a realizou. Sem a captura, cada instância anuncia suas próprias gravações no canal `rebase_entity_changes`, e uma conexão dedicada em todas as outras instâncias as retransmite para seus assinantes locais.

### Configuração Zero

O tempo real é habilitado por padrão. Não há nenhuma flag para ativar ou serviço para iniciar — se o seu servidor Rebase estiver em execução, o endpoint WebSocket estará disponível.

### Qual caminho o socket responde

O socket responde a upgrades em um único caminho: o caminho base da API sem o `/api` final, ou seja, `/` para uma API em `/api`. É para onde o SDK se conecta: ele conecta em sua `baseUrl`, enquanto suas requisições HTTP vão para `${baseUrl}/api`. Um upgrade para qualquer outro caminho é deixado para os outros listeners de `upgrade` do servidor, permitindo que sua aplicação execute seu próprio servidor WebSocket no mesmo `http.Server`. Sem nenhum outro listener, esse upgrade é respondido com `404`.

Em um [servidor customizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` define o caminho, e o `realtime.path` do adaptador Postgres sobrescreve o que o servidor derivou.

> Por padrão, o Rebase também emite eventos de tempo real para gravações feitas **fora** da API (via `psql`, outro serviço ou pelo editor SQL do Studio) sempre que a conexão com o banco de dados suportar — consulte [captura de alterações no nível do banco de dados](/docs/backend/realtime-cdc/).

## Assinaturas no SDK Tipado

O SDK tipado do Rebase expõe dois métodos de assinatura em cada acessador de tabela:

- **`listen()`** — Assina uma tabela inteira (com filtros opcionais).
- **`listenById()`** — Assina uma única entidade pelo seu ID.

Ambos os métodos retornam uma **função de cancelamento de assinatura (unsubscribe)** que você chama para parar de receber atualizações.

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
- `data` — As linhas, em formato plano, como `find()` as retorna (`row.name`, não `row.values.name`).
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

O callback recebe a linha, de forma plana, como `findById()` a retorna (`row.name`, não `row.values.name`), ou `undefined` quando a linha for excluída.

**Cada frame carrega a versão da linha.** `etagOf(row)` é o `ETag` retornado por um `GET` da linha, de modo que uma edição feita com base no que um frame exibiu pode ser salva com `ifMatch: etagOf(row)` e é recusada com `412` se a linha tiver sido alterada (consulte [Gravações condicionais](/docs/backend/writes/)). Na transmissão (on the wire), o `subscribe_one` do SDK solicita com `etag: true`, e cada frame `single_update` para uma linha existente traz `"etag"` ao lado de `"row"`. Um servidor anterior a isso ignora a solicitação e não envia tag, e um cliente que não solicita recebe frames sem ela.

### Cancelando a Assinatura

Tanto `listen()` quanto `listenById()` retornam uma função de cancelamento de assinatura. Chame-a para parar de receber atualizações e liberar recursos no servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Sempre chame a função de cancelamento de assinatura quando um componente for desmontado ou ao navegar para fora de uma página. Isso evita vazamentos de memória e processamento desnecessário no servidor.
:::

## `.listen()` no Query Builder

O query builder fluente também suporta assinaturas em tempo real. Encadeie seus filtros e, em seguida, chame `.listen()` em vez de `.find()`:

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
O `.listen()` — tanto no query builder quanto no acessador de tabela — precisa do WebSocket do cliente. O cliente deriva sua URL a partir de `baseUrl`, a menos que `websocketUrl` seja fornecido. Em um cliente criado com `realtime: false`, ou em um que não conseguiu derivar nenhuma URL, chamar `.listen()` lança um erro.
:::

## Entrega de Atualizações: Patch Instantâneo + Refetch de Correção

Uma alteração nunca viaja para um assinante como dados. Ela viaja como o fato de que algo mudou, e cada assinante é então informado sobre o que *ele* pode ver através de uma consulta executada em seu nome:

1. **Invalidação.** Quando uma entidade muda (criada, atualizada, excluída), o servidor marca os caminhos afetados. A linha que foi gravada não é repassada — ela foi lida sob a autorização do autor da gravação, o que não diz nada sobre o que qualquer assinante tem permissão para ver.

2. **Refetch com RLS com debounce.** Após **300ms** (`REFETCH_DEBOUNCE_MS`), o servidor busca novamente (refetch) a tabela com seus filtros e ordem de classificação originais. A consulta é executada dentro de uma transação que define os parâmetros locais da transação `app.user_id` e `app.user_roles` a partir do `SubscriptionAuthContext` do assinante, para que o Postgres avalie o Row-Level Security sob a identidade daquele cliente e apenas as linhas que ele está autorizado a ver sejam enviadas no `collection_update`. O debounce também agrupa uma rajada de gravações em uma única consulta. Ele aguarda 300 ms sem novas alterações, mas nunca mais de **1 s** (`REFETCH_MAX_WAIT_MS`) após a primeira, de modo que uma tabela que receba gravações várias vezes por segundo ainda envie aos seus assinantes um frame pelo menos uma vez por segundo. Defina esse limite com `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`): valores maiores fazem o refetch de uma tabela movimentada com menos frequência; valores menores enviam frames mais atualizados.

   Um refetch que lê exatamente o que foi enviado pela última vez a um assinante não envia nada a ele: uma gravação na linha 9.000 de uma lista que mostra as primeiras 50 custa a leitura, e não um frame para cada visualizador. Após um frame de erro, as próximas linhas são enviadas novamente, mesmo que sejam as mesmas.

Versões anteriores enviavam um `collection_patch` imediato contendo a linha gravada antes desse refetch, para um feedback entre abas inferior a milissegundos. Essa linha havia sido lida sob o escopo de quem a gravou, portanto ela podia — e chegava a — atingir assinantes cujas próprias políticas a teriam negado, e o filtro `where` da própria assinatura também não era aplicado a ela. O patch foi removido: a latência percebida para uma atualização agora é a janela do debounce.

### O refetch é a leitura REST

O refetch executa o mesmo pipeline que `GET /api/data/<table>` executa, com o mesmo tratamento de `include`. É isso que faz com que `find({ q })` e `listen({ q })` retornem linhas idênticas campo a campo.

Costumava ser um método diferente — um que aninhava cada relação sob um envelope `{ "__type": "relation" }` e, como uma assinatura não podia carregar nenhum `include`, carregava ansiosamente **todas** as relações declaradas pela tabela. Assim, a mesma consulta respondia em um formato via HTTP e em outro via socket, e um cliente que renderizasse ambos via suas linhas mudarem de formato no instante em que uma gravação ocorria.

Portanto, um frame de assinatura aceita o que uma requisição de listagem aceita: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e `fields`. `vectorSearch` é a exceção e é **recusado** com `VECTOR_SEARCH_NOT_LIVE` — uma assinatura é executada novamente a cada gravação correspondente e nada ali calcula distâncias.

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

`meta` é contado dentro da mesma transação vinculada ao RLS que leu as linhas, portanto descreve exatamente as linhas ao lado dele. Sem isso, um cliente que precisasse de um total teria que emitir um `GET /count` **por push** — uma viagem de ida e volta extra por gravação, por assinante, e uma janela na qual a contagem e as linhas descreviam estados diferentes da tabela.

Quando a própria contagem falha, o frame carrega `partial: true` e nenhum `total`; isso não é um erro de assinatura, e o cliente deve manter o último total real em vez de substituí-lo pelo tamanho da página. Em uma tabela grande, a contagem é a maior parte do custo de um frame. Com `REALTIME_RECOUNT_INTERVAL_MS` configurado, uma lista cujo último total era de pelo menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por padrão) reutiliza esse total durante o intervalo em vez de contar a cada gravação, e esse frame carrega `meta.totalAsOf`, indicando quando o total foi obtido. Quando o intervalo expira, uma lista cujo último frame reutilizou o total é contada novamente e recebe o novo total, mesmo que nada tenha sido gravado desde então. Se não configurado, como é o padrão, todo frame realiza a contagem.

### Quanto custa uma gravação e quais são os limites

Como cada frame é uma consulta executada como seu assinante, o custo de uma gravação cresce com o número de **perguntas distintas feitas por entidades distintas** na tabela afetada — não com o número de sockets abertos:

- Assinaturas que fazem a mesma pergunta (mesmo caminho, filtros, ordenação, página, `include`, `fields`, busca) como o mesmo principal (mesmo ID de usuário, roles, flag de convidado e claims) compartilham um único refetch. Uma gravação em uma lista custa **uma transação por esse grupo** — a leitura e sua contagem — independentemente de quantos sockets a mantenham; cada membro ainda recebe um frame construído a partir de linhas lidas sob essa identidade. Uma primeira página que retorne menos itens do que seu `limit` representa o conjunto completo, portanto não é contada.
- Uma assinatura de registro único só é consultada quando seu próprio registro é alterado.
- Uma lista filtrada com `==` ou `in` em uma coluna da tabela só é consultada quando a gravação pode afetá-la: quando a linha correspondia ao filtro antes da gravação ou passa a corresponder depois. `listen({ where: { owner: ["==", me] } })` mantido por cinco mil usuários custa uma leitura quando um deles grava uma linha sua, e não cinco mil. Isso decide apenas *quem* faz o refetch, nunca o que alguém recebe: cada lista consultada ainda lê sob o escopo de seu próprio assinante, portanto, uma lista que solicita as linhas de outra pessoa é consultada e não encontra nada que sua política oculte.
- Principals diferentes nunca compartilham uma leitura — é isso que impede que um frame traga uma linha que seu leitor não tem permissão para ver. Uma lista que apenas o RLS restringe (a mesma lista não filtrada, observada por mil usuários autenticados diferentes) custa mil leituras a cada gravação nela, em mil transações.

O pré-filtro consulta todas as listas da tabela, como antes, sempre que não puder ter certeza de que uma lista não foi afetada:

- Ele avalia `==` e `in` em colunas do tipo text, `varchar`, uuid, enum, integer e boolean. Outras condições (intervalos, padrões, caminhos JSON, relações, grupos `or(...)`, busca) são deixadas de fora, o que apenas amplia o que ele admite. Uma lista que carrega relações (`include`), uma tabela com um hook `afterRead` e uma coluna com um hook em nível de campo nunca são pré-filtradas.
- Ele precisa dos valores da linha antes e depois da gravação. Uma gravação feita por meio da API os fornece em uma criação e em uma atualização que leu a linha primeiro (toda atualização REST o faz). Uma alteração lida do WAL (`REALTIME_CDC=wal`, ou `auto` onde o WAL estiver disponível) fornece toda a nova linha, mas a linha antiga apenas como sua chave, a menos que a tabela tenha `REPLICA IDENTITY FULL` — portanto, um `UPDATE` ou `DELETE` externo de uma coluna que não seja chave consulta todas as listas. O trigger de captura (`REALTIME_CDC=trigger`) envia apenas a chave, portanto só pode descartar listas filtradas pela chave. Uma exclusão por meio da API e uma chave grande demais para ser notificada consultam todas as listas.

Medido em um notebook contra o PostgreSQL 18 no Docker, com um pool de 20 conexões (`tooling/scripts/bench-realtime-fanout.mts`), uma gravação em uma tabela cuja política mostra a cada usuário suas próprias linhas:

| Assinantes na tabela | Transações para a gravação | Fan-out concluído após a gravação |
|----------------------|----------------------------|-----------------------------------|
| 5.000 usuários, cada um com `where owner == me`, gravação via API | 1 | ~305 ms |
| 5.000 usuários, cada um com `where owner == me`, SQL puro lido do WAL | 1 | ~307 ms |
| 5.000 sockets de um único usuário, uma lista | 1 | ~311 ms |
| 1.000 usuários, a mesma lista sem filtros | 1.000 | ~780 ms |
| 5.000 usuários, a mesma lista sem filtros | 5.000 | ~2,6 s |

300 ms de cada um é o debounce. As duas últimas linhas representam o teto a ser planejado: uma lista que apenas o RLS restringe custa uma leitura por usuário distinto por gravação. Os refetches são executados no mesmo pool do seu tráfego REST, mas usando no máximo um quarto de suas conexões por vez (5 das 20 padrão, nunca menos de 2); o restante aguarda sua vez no servidor, de modo que o fan-out de uma gravação atrasa seus próprios frames em vez das suas requisições. Uma tabela gravada várias vezes por segundo enquanto **milhares de usuários diferentes** observam a mesma lista não filtrada é onde esses frames começam a sofrer atrasos. Filtre a assinatura na coluna que sua política lê (`where owner == me` ao lado de `owner = app.uid`) e ela voltará a custar uma única leitura; ou use um [canal de broadcast](#canais-de-broadcast) transmitindo a alteração para que os clientes façam o refetch em seu próprio ritmo.

**Um socket pode conter no máximo 1.000 assinaturas.** A próxima será recusada com um frame de erro de código `TOO_MANY_SUBSCRIPTIONS`; assinar novamente sob um ID que o socket já possui substitui essa assinatura e não conta novamente. O SDK compartilha assinaturas idênticas em um socket, portanto isso conta as listas e registros distintos que uma página mantém abertos. Altere isso com `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket` no adaptador Postgres (a variável de ambiente tem precedência); um valor que não seja um número inteiro positivo interrompe o servidor na inicialização. **Os sockets que um único usuário mantém também podem ser limitados**, por instância do servidor: defina `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), e um login além disso será recusado com `TOO_MANY_SOCKETS` e o socket fechado com 4002. Sockets autenticados com uma chave de API contam contra essa chave individualmente, e não contra a conta que a criou; a chave de serviço é uma única credencial, portanto todos os seus sockets contam juntos. Os sockets de um administrador que personifica um usuário contam contra o administrador, junto com seus próprios sockets, e não contra o usuário personificado. O SDK notifica todas as assinaturas ativas e o `onConnectionLost` de uma só vez, com um erro `CONNECTION_LOST` cujo `details.reason` é `TOO_MANY_SOCKETS`, e continua tentando novamente, esperando mais tempo a cada vez até 30 s, para que a aba consiga se conectar assim que outro socket for fechado. Não definido, como é o padrão, não há limite.

O ID de uma assinatura pertence ao próprio socket: dois clientes que nomeiem uma assinatura como `"sub-1"` mantêm cada um a sua, e um `unsubscribe` encerra apenas a do remetente.

**A assinatura conta contra o limite de taxa de dados.** O primeiro frame de uma assinatura é uma leitura, executada como o assinante, assim como a requisição de histórico de um canal. Portanto, `subscribe_collection`, `subscribe_one` e `channel_history` contam como requisições de dados no bucket de limite de taxa do chamador (o mesmo compartilhado por suas requisições HTTP e outros sockets) assim que a franquia do próprio socket for gasta. Cada socket pode enviar 1.000 delas sem contabilizá-las, ou tantas quanto o seu teto de assinatura quando este for maior, e a franquia se regenera ao longo de 15 minutos. Isso cobre tudo o que um socket pode manter, de modo que a re-assinatura após uma reconexão nunca seja recusada e nunca gaste a cota do usuário. Ultrapassada a franquia, um frame acima do limite é recusado com um frame de erro com o código `RATE_LIMITED`, que o SDK entrega ao `onError` daquela assinatura ou do canal.

### Sockets que param de responder

Um cliente pode desaparecer sem fechar seu socket: um celular perde o sinal, um notebook entra em repouso, um NAT esquece a conexão. Nenhum frame de encerramento chega, portanto nada avisa o servidor. O servidor, portanto, envia um ping a cada socket a cada 30 segundos e encerra qualquer um que não tenha respondido até o próximo ping, de modo que um cliente desconectado seja liberado em até um minuto. Os navegadores e o SDK respondem aos pings por conta própria; um cliente que se comunique diretamente com o protocolo precisa respondê-los também, como faz a maioria das bibliotecas de WebSocket.

**O lado do navegador.** Um navegador não pode enviar um ping nem ver um, portanto, um socket semiaberto parece conectado a ele para sempre. O SDK abre o socket com `?rebase_caps=heartbeat,channel_seq,cancel_sql`; um servidor compatível responde com `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listando os recursos suportados (`cancel_sql`: aceita o frame `CANCEL_SQL` do console SQL), e envia `{"type":"heartbeat"}` a cada 30 segundos, e o SDK fecha o socket e [reconecta-se](#reconexão-automática) após perder dois. Um cliente que não especifique nada não recebe nenhum dos dois, e um servidor mais antigo ignora o parâmetro, fazendo com que um SDK comunicando-se com ele se comporte como antes.

Um socket também é encerrado quando mais de 16&nbsp;MiB de frames enviados a ele permanecem não lidos. Isso indica um cliente que não lê o que lhe é enviado, ou um tão atrasado que o conteúdo a ser lido já está obsoleto. E quando todos os sockets de um servidor somam mais de 256&nbsp;MiB não lidos (ou um quarto do limite de memória sob o qual o servidor opera, o que for menor), aqueles com a maior quantidade não lida são encerrados primeiro, até que o restante se ajuste ao limite.

Um socket encerrado é limpo da mesma forma que um socket fechado normalmente. Suas assinaturas terminam, ele sai de seus canais e sua presença é removida, com a saída sendo anunciada aos outros membros. Um cliente que ainda esteja ativo percebe a queda da conexão, e o SDK [reconecta-se](#reconexão-automática) e assina novamente.

## Canais de Broadcast

Os canais de broadcast permitem que os clientes enviem mensagens arbitrárias entre si em tempo real — útil para recursos como indicadores de digitação, posições do cursor ou notificações personalizadas.

O broadcast é gerenciado no nível do protocolo WebSocket. O servidor suporta estes tipos de mensagem:

| Tipo de Mensagem | Direção | Descrição |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Cliente → Servidor | Entrar em um canal nomeado |
| `leave_channel`   | Cliente → Servidor | Sair de um canal |
| `broadcast`       | Cliente → Servidor | Enviar uma mensagem para todos os membros do canal |
| `broadcast`       | Servidor → Cliente | Receber uma mensagem de outro membro |
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

Por padrão, um broadcast alcança os membros atualmente conectados e depois desaparece. Esse é o comportamento ideal para notificações e cursores, e não tem custo adicional.

Para um fluxo de operações — edição colaborativa, qualquer cenário onde uma lacuna silenciosa cause divergência — um canal pode ser configurado para **reter** suas mensagens. Os broadcasts retidos recebem um número de sequência por canal e são armazenados, para que um cliente que se reconecte possa solicitar tudo após a última mensagem visualizada.

:::caution[Onde configurar]
**Runtime gerenciado: em nenhum lugar.** A retenção de canais e `realtime.bus` fazem parte do adaptador de banco de dados que o próprio runtime gerenciado constrói, e nenhum dos dois possui uma variável de ambiente correspondente. Faça o eject para configurá-los.
**Após o eject:** `createPostgresAdapter({ realtime })` em `backend/src/index.ts`.
:::

A retenção é opcional e configurada aqui, no servidor:

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

| Campo | Descrição |
|---------|-----------------------------------------------------------------------------|
| `match` | Nome exato do canal (`"doc:42"`) ou um prefixo com `*` final (`"doc:*"`) |
| `limit` | Manter no máximo esta quantidade das mensagens mais recentes por canal |
| `ttl`   | Manter mensagens por no máximo este tempo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, ou milissegundos |

Uma regra precisa de pelo menos um entre `limit` ou `ttl`. Uma regra sem nenhum dos dois é ignorada e registrada em log, pois a retenção ilimitada quase nunca é intencional e não pode ser desfeita facilmente depois que a tabela crescer.

:::note[Por que não deixar os clientes solicitarem o histórico?]
Um canal é criado por quem quer que o nomeie. Se um cliente pudesse escolher sua própria profundidade de histórico, qualquer visitante poderia comprometer seu backend com armazenamento ilimitado. Configurar isso aqui também significa que canais de presença e notificação — a grande maioria — não pagam nada: sem regras configuradas, nenhuma tabela é criada e o broadcast segue o mesmo caminho síncrono de sempre.
:::

### Armazenamento

Os canais com retenção usam duas tabelas no schema `rebase`, criadas automaticamente na inicialização quando pelo menos uma regra estiver configurada:

| Tabela | Conteúdo |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | As mensagens retidas, indexadas por `(channel, seq)` |
| `rebase.channel_cursors`  | A sequência mais alta emitida por canal |

A limpeza acontece à medida que as mensagens chegam, com limitação por canal para que o custo acompanhe o tempo decorrido em vez do volume de gravações. Ela apenas remove linhas de `channel_messages` — os cursores são mantidos indefinidamente (são apenas uma linha pequena por canal), pois reiniciar a sequência de um canal alteraria o significado do ponto de retomada salvo por um cliente.

### Garantias de entrega

- **Ordenada.** Os números de sequência são alocados por canal, e a ordem de entrega corresponde à ordem da sequência — em uma única instância e entre instâncias no barramento `postgres`, onde a instrução que numera uma mensagem também a anuncia, de modo que cada instância (incluindo a do remetente) receba os anúncios na ordem da sequência. Um barramento fornecido por você transporta frames na ordem em que os entregar.
- **Durável antes da entrega.** Uma mensagem que não puder ser armazenada não é entregue a ninguém, e o remetente é informado. Entregá-la a colocaria diante dos assinantes em tempo real, deixando-a de fora de qualquer reprodução futura, e nenhuma mensagem posterior poderia corrigir essa lacuna.
- **Pelo menos uma vez na recuperação.** Um intervalo de reprodução pode se sobrepor a mensagens que um cliente já recebeu; o SDK descarta aquelas que já entregou.
- **Sem lacunas.** Uma mensagem retida atinge todos os membros: o remetente, que nunca recebe sua própria mensagem, recebe `{"type":"broadcast_ack","channel","seq"}` em vez disso quando optou por `channel_seq`. Portanto, uma mensagem após `lastSeq + 1` significa que uma foi perdida, e o SDK a retém, solicita o histórico intermediário e entrega todas elas em ordem. Em relação a um servidor sem `channel_seq`, um salto é entregue assim que chega.

:::caution[O histórico tem o mesmo modelo de acesso do canal]
Um cliente que entrou em um canal pode reproduzir suas mensagens retidas, incluindo aquelas transmitidas antes de sua chegada — ser membro é a única verificação, e a entrada está aberta a qualquer cliente que conheça o nome do canal. A retenção é ativada por padrão de canal, portanto, ativá-la torna o passado daquele canal legível para qualquer visitante que adivinhe o nome. Os canais retidos são o caso em que isso se torna durável em vez de momentâneo, portanto, trate o conteúdo de um canal retido como público para seus usuários.
:::

## Rastreamento de Presença

A presença rastreia quais usuários estão online no momento em um canal e permite que cada usuário compartilhe um estado personalizado (por exemplo, posição do cursor, status).

| Tipo de Mensagem | Direção | Descrição |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Cliente → Servidor | Iniciar o rastreamento de presença com estado personalizado |
| `presence_untrack`| Cliente → Servidor | Parar o rastreamento de presença |
| `presence_state`  | Cliente → Servidor | Solicitar o estado completo de presença de um canal |
| `presence_state`  | Servidor → Cliente | Todas as presenças no canal, na íntegra |
| `presence_diff`   | Servidor → Cliente | Atualização incremental (entradas e saídas) |

Quando um cliente envia `presence_track`, o servidor o adiciona automaticamente ao canal (sem necessidade de um `join_channel` separado) e transmite um `presence_diff` para todos os membros do canal. O SDK reenvia seu estado a cada ~20 segundos como um heartbeat; um heartbeat cujo estado não mudou apenas renova o timeout do cliente e não envia `presence_diff`.

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

- **Backoff exponencial** — Cada nova tentativa aguarda um intervalo que começa em 2 segundos e dobra a cada vez, até 30 segundos. O atraso é sorteado aleatoriamente dentro desse intervalo, mas nunca abaixo de um quarto de segundo, para que clientes desconectados juntos por um deploy retornem distribuídos ao longo do intervalo, em vez de exatamente no mesmo instante.
- **Sem desistência enquanto houver algo ativo** — Enquanto existir uma assinatura ou um canal no qual o cliente tenha entrado, o cliente continuará tentando reconectar no teto de 30 segundos durante todo o tempo em que durar a interrupção. Sem nada registrado, ele para após 5 tentativas com falha, e a próxima assinatura inicia a conexão novamente. No navegador, o evento `online` e a aba voltando a ficar visível forçam uma tentativa imediata, sem aguardar o backoff.
- **Interrupções são reportadas uma única vez** — Quando a conexão fica inativa por 14 segundos, independentemente de quantas tentativas tenham ocorrido, o `onError` de cada assinatura ativa e o `onError` de cada canal conectado recebem um `RebaseApiError` com o código `CONNECTION_LOST`. A assinatura é **mantida**: o erro indica que seus dados não estão sendo atualizados, e não que ela foi encerrada.
- **Re-assinatura automática** — Após uma reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor, e o próximo `onUpdate` de cada uma carrega tudo o que foi gravado enquanto o cliente esteve desconectado. Essa atualização serve como sinal de recuperação. Nenhuma intervenção manual é necessária.
- **Requisições são do tipo 'no máximo uma vez'** — Uma requisição feita enquanto o socket está fora do ar aguarda por ele por até 30 segundos a partir da chamada e, em seguida, falha com `REQUEST_TIMEOUT` sem nunca ter sido enviada. Uma requisição que já havia sido enviada quando a conexão caiu falha com `CONNECTION_LOST` e **não** é enviada novamente: o servidor pode ou não tê-la executado, e apenas quem chamou sabe se executá-la duas vezes é seguro.

`client.ws.state` indica o estado atual da conexão, e `onStateChange` é notificado a cada alteração:

| Estado | Significado |
|---|---|
| `idle` | Sem socket, e nenhum desejado ainda (a conexão é lazy), ou um logout o desconectou. |
| `connecting` | Conectando, sem interrupção em andamento. |
| `connected` | O socket está aberto. |
| `reconnecting` | O socket caiu e o cliente está tentando reconectar. Nada foi reportado ainda. |
| `disconnected` | A interrupção durou 14 segundos ou mais. `CONNECTION_LOST` foi reportado e o cliente continua tentando reconectar. |
| `closed` | `client.close()` foi chamado. Definitivo. |

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

As assinaturas via WebSocket respeitam automaticamente as políticas de Row-Level Security (RLS). Quando o cliente está autenticado:

1. A conexão WebSocket é autenticada usando o mesmo token JWT da API REST.
2. Todo refetch de assinatura é executado dentro de uma transação PostgreSQL com `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantindo que as políticas de RLS sejam aplicadas.
3. A identidade é verificada continuamente enquanto o socket estiver aberto, não apenas no momento da autenticação. Antes de cada frame, o servidor verifica o que uma requisição HTTP verificaria: se o token ainda é válido, se sua sessão foi encerrada ou revogada, se a conta ainda existe e quais roles ela possui atualmente. Frames de canais são verificados no máximo uma vez por segundo. Frames que chegam a um socket enquanto sua verificação ainda está em andamento — como um cliente reenviando suas assinaturas após uma reconexão — compartilham essa mesma verificação em vez de executar uma nova; o frame seguinte após sua conclusão fará uma nova consulta. Um socket que apenas escuta é verificado pelo menos a cada 30 segundos, e um token deixa de ser aceito no instante exato em que expira. Uma role revogada passa a ter efeito a partir do próximo frame (ou, no caso de um frame que compartilhou uma verificação já em andamento, a partir do frame seguinte), aplicando-se a leituras, gravações e assinaturas abertas. Um socket cuja identidade foi finalizada recebe um frame `AUTH_ERROR` e é fechado com o código `4001`. Com a autenticação integrada, o código do frame explica o motivo, da mesma forma que as rotas HTTP: `SESSION_REVOKED` (logout, revogação ou conta excluída), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED`; para outros adaptadores de autenticação, o código é `SESSION_ENDED`. Um `AUTHENTICATE` para uma sessão revogada ou conta desativada é recusado com `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (um token que não valide ou tenha expirado resulta em `INVALID_TOKEN`). O SDK não tenta novamente com o mesmo token e repassa a recusa, código incluído, ao `onError` do recurso que precisava da conta. O SDK autentica seu socket novamente a cada atualização de token; um novo token para a mesma identidade (mesmo ID de usuário, roles, flag de convidado e claims) mantém as assinaturas abertas como estão, enquanto um token para uma identidade diferente refaz o refetch de cada uma delas sob a nova identidade. Após um código `4001`, ele se reconecta com a sessão que possuir no momento, ou sem nenhuma. Um cliente que utilize o protocolo diretamente deve enviar um token novo em `AUTHENTICATE` antes que o antigo expire.

Isso garante que cada socket receba apenas atualizações de registros que sua identidade autenticada tem permissão para visualizar.

Uma [chave de API](/docs/backend/api-keys/) também autentica o socket: envie a chave `rk_…` no lugar onde iria o token de acesso. O socket então verifica cada frame contra os [escopos](/docs/backend/roles-and-scopes/) da chave: um fetch, um count ou uma assinatura exige `data:read` em sua tabela, uma gravação exige `data:write`, uma exclusão exige `data:delete`. Um caminho aninhado requer o escopo simples. Canais (broadcast e presença) são recusados para uma chave de API, pois nenhum escopo os cobre. O editor SQL e as mensagens de branch exigem `database:read` ou `database:write`, tanto para chaves quanto para usuários.

Executar mais de uma instância — o barramento LISTEN/NOTIFY, o comportamento da presença entre processos e como implementar seu próprio transporte — possui uma página dedicada: [Tempo real entre instâncias](/docs/backend/realtime-transports/).

## Captura de Alterações no Nível do Banco de Dados (CDC)

Toda gravação confirmada emite eventos de tempo real, independentemente de como foi realizada: REST, SDK, Studio, `psql` ou uma cron job em outro serviço. Como a captura funciona, a configuração `REALTIME_CDC` e seus requisitos: [Captura de alterações do banco de dados](/docs/backend/realtime-cdc/).

## Timeout de Requisições Pendentes

Para evitar que as requisições do cliente fiquem travadas indefinidamente, todas as operações WebSocket pendentes que aguardam uma resposta do servidor (como buscas pontuais de tabela `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) possuem um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente descarta automaticamente a requisição pendente e rejeita a promise com um `RebaseApiError` cujo código é `REQUEST_TIMEOUT`.

Mensagens unidirecionais que não aguardam uma resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) resolvem imediatamente após a transmissão e não acionam esse timeout. Uma assinatura cujo primeiro frame não tiver chegado 30 segundos após o envio do seu pedido de inscrição falha em vez disso, emitindo `SUBSCRIPTION_TIMEOUT` em seu `onError`.

### Quando um frame de canal é recusado

Um frame de canal opera no modelo 'dispare e esqueça': `await channel.broadcast(...)` resolve assim que o frame é gravado no socket, e **não** quando o servidor o aceitou. Isso é proposital — uma aplicação colaborativa transmite uma posição de cursor sessenta vezes por segundo, e aguardar uma confirmação para cada uma transformaria cada envio em um round trip.

Portanto, uma recusa não pode ser uma promise rejeitada. Ela é recebida no `onError`:

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
| `RATE_LIMITED` | Acima do limite de frames do canal (7.200 frames de canal por minuto por socket) ou, para uma solicitação de histórico, acima do [limite de taxa de dados](#quanto-custa-uma-gravação-e-quais-são-os-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Não foi possível persistir um broadcast retido, portanto ele foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Não foi possível atender a uma solicitação de recuperação de histórico |
| `CHANNEL_HISTORY_GAP` | Gerado pelo cliente: uma recuperação identificou que o servidor não retém mais mensagens que este cliente nunca recebeu. `details` é `{ from, to }`, os números de sequência perdidos. Ressincronize o estado do canal a partir da sua fonte da verdade |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast atingiu apenas esta instância — consulte [O limite de 8 KB no barramento Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sem nenhum handler configurado, esses casos são registrados como aviso no log. Anteriormente, eles eram completamente descartados: não havia promise para rejeitar nem canal para o qual enviar, tornando impossível distinguir um broadcast proibido de um entregue com sucesso.

## Próximos Passos

- [SDK Tipado](/docs/sdk) — Referência completa do SDK, incluindo acessadores de tabela tipados.
- [Autenticação](/docs/backend/authentication) — Configure a autenticação JWT e as políticas de RLS.
- [Arquitetura do Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.
