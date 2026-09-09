---
sourceHash: 05f7e05823faa1cf
title: Realtime & WebSocket
sidebar_label: Realtime
description: Sincronização de dados em tempo real, canais de broadcast e rastreamento de presença via WebSocket.
---

O Rebase inclui um mecanismo de tempo real integrado que envia alterações de dados para clientes conectados via WebSocket.
Quando qualquer registro é criado, atualizado ou excluído, cada assinante que estiver observando essa coleção ou entidade recebe a atualização instantaneamente — sem necessidade de polling.

## Como Funciona

O pipeline de tempo real possui três etapas:

1. **Gatilho de banco de dados** — Uma mutação atinge o banco de dados PostgreSQL (via API REST, SDK ou Studio).
2. **Distribuição do servidor (Server fan-out)** — O servidor Rebase detecta a alteração e a distribui para todas as assinaturas WebSocket ativas que correspondam à coleção ou entidade afetada.
3. **Callback do cliente** — O SDK do cliente dispara o seu callback `onUpdate` com os novos dados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implantações com múltiplas instâncias, o Rebase usa o `LISTEN/NOTIFY` do PostgreSQL para transmitir alterações entre instâncias do servidor. Isso é tratado automaticamente — uma conexão dedicada do PostgreSQL escuta no canal `rebase_entity_changes` e retransmite atualizações para os assinantes locais.

### Configuração Zero

O Realtime vem habilitado por padrão. Não há nenhuma flag para ativar ou serviço para iniciar — se o seu servidor Rebase estiver em execução, o endpoint WebSocket estará disponível.

> Por padrão, o Rebase também emite eventos de tempo real para gravações feitas **fora** da API (via `psql`, outro serviço ou o editor SQL do Studio) sempre que a conexão com o banco de dados suportar — consulte [captura de alterações no nível do banco de dados (CDC)](#database-level-change-capture-cdc).

## Assinaturas no SDK do Cliente

O SDK do cliente Rebase expõe dois métodos de assinatura em cada acessor de coleção:

- **`listen()`** — Assine uma coleção inteira (com filtros opcionais).
- **`listenById()`** — Assine uma única entidade pelo seu ID.

Ambos os métodos retornam uma **função de cancelamento de assinatura (unsubscribe)** que você chama para parar de receber atualizações.

### Assinando uma Coleção

Use `listen()` para receber atualizações sempre que os registros em uma coleção mudarem:

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

O callback recebe `Entity<M> | undefined`. Um valor `undefined` significa que a entidade foi excluída.

### Cancelando a Assinatura

Tanto o `listen()` quanto o `listenById()` retornam uma função de cancelamento de assinatura. Chame-a para parar de receber atualizações e liberar recursos no lado do servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Sempre chame a função de cancelamento de assinatura quando um componente for desmontado ou ao navegar para outra página. Isso evita vazamentos de memória e processamento desnecessário no lado do servidor.
:::

## Query Builder `.listen()`

O construtor de consultas fluente (query builder) também suporta assinaturas em tempo real. Encadeie seus filtros e, em seguida, chame `.listen()` em vez de `.find()`:

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
O método `.listen()` no query builder está disponível apenas quando o `RebaseClient` está configurado com uma `websocketUrl`. Se a conexão WebSocket não estiver configurada, chamar `.listen()` lançará um erro.
:::

## Entrega de Atualizações: Patch Instantâneo + Refetch de Correção

Uma alteração nunca viaja até um assinante como dados brutos. Ela viaja como o fato de que algo mudou, e cada assinante é então informado sobre o que *ele* pode ver através de uma consulta executada em seu nome:

1. **Invalidação.** Quando uma entidade muda (criada, atualizada, excluída), o servidor marca os caminhos afetados. A linha que foi gravada não é encaminhada diretamente — ela foi lida sob a autorização do gravador, o que não diz nada sobre o que qualquer assinante tem permissão para ver.

2. **Refetch de RLS com debounce.** Após **300ms** (`REFETCH_DEBOUNCE_MS`), o servidor busca novamente a coleção com seus filtros e ordem de classificação originais. A consulta é executada dentro de uma transação que define `app.user_id` e `app.user_roles` locais da transação a partir do `SubscriptionAuthContext` do assinante, para que o Postgres avalie a Row-Level Security (Segurança em Nível de Linha) sob a identidade daquele cliente e apenas as linhas que ele está autorizado a ver sejam enviadas no `collection_update`. O debounce também agrupa uma sequência rápida de gravações em uma única consulta.

Versões anteriores enviavam um `collection_patch` imediato contendo a linha gravada antes desse refetch, para feedback de submilissegundos entre abas. Essa linha havia sido lida sob o escopo de quem realizou a gravação, portanto podia — e de fato alcançava — assinantes cujas próprias políticas teriam negado o acesso, e o próprio filtro `where` da assinatura também não era aplicado a ela. O patch foi removido: a latência percebida para uma atualização agora é a janela de debounce.

### O refetch é a leitura REST

O refetch executa o mesmo pipeline que o `GET /api/data/<collection>` executa, com o mesmo tratamento de `include`. É isso que faz com que `find({ q })` e `listen({ q })` retornem linhas idênticas campo por campo.

Costumava ser um método diferente — que aninhava cada relação sob um envelope `{ "__type": "relation" }` e, como uma assinatura não podia carregar nenhum `include`, carregava ansiosamente (eager loading) **todas** as relações que a coleção declara. Assim, a mesma consulta respondia com um formato via HTTP e outro via socket, e um cliente renderizando ambos via suas linhas mudarem de formato no momento em que uma gravação ocorria.

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

`meta` é contabilizado dentro da mesma transação vinculada a RLS que leu as linhas, portanto, descreve exatamente as linhas ao seu lado. Sem isso, um cliente que precisasse de um total teria que emitir um `GET /count` **por push** — uma viagem de ida e volta (round trip) extra por gravação, por assinante, e uma janela na qual a contagem e as linhas descreviam estados diferentes da coleção.

Quando a própria contagem falha, o frame traz `partial: true` e nenhum `total`; isso não é um erro de assinatura, e o cliente deve manter o último total real em vez de substituí-lo pelo tamanho da página.

## Canais de Broadcast

Os canais de broadcast permitem que os clientes enviem mensagens arbitrárias uns aos outros em tempo real — útil para recursos como indicadores de digitação, posições do cursor ou notificações personalizadas.

O broadcast é gerenciado no nível do protocolo WebSocket. O servidor suporta estes tipos de mensagem:

| Tipo de Mensagem | Direção         | Descrição                                         |
|------------------|-----------------|---------------------------------------------------|
| `join_channel`   | Cliente → Servidor | Entrar em um canal nomeado                     |
| `leave_channel`  | Cliente → Servidor | Sair de um canal                                  |
| `broadcast`      | Cliente → Servidor | Enviar uma mensagem para todos os membros do canal|
| `broadcast`      | Servidor → Cliente | Receber uma mensagem de outro membro             |
| `channel_history`| Cliente → Servidor | Solicitar mensagens retidas após uma sequência    |
| `channel_history`| Servidor → Cliente | As mensagens retidas que um cliente perdeu        |

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

## Retenção de Canal

Por padrão, um broadcast atinge os membros atualmente conectados e depois desaparece. Esse é o compromisso ideal para notificações e cursores, e não tem custo.

Para um fluxo de operações — edição colaborativa ou qualquer situação em que uma lacuna silenciosa cause divergência — um canal pode ser configurado para **reter** suas mensagens. Broadcasts retidos recebem um número de sequência por canal e são armazenados, para que um cliente que se reconecte possa solicitar tudo após a última mensagem que viu.

:::caution[Onde isso é configurado]
**Runtime gerenciado: em nenhum lugar.** A retenção de canal e o `realtime.bus` fazem parte do adaptador de banco de dados que o runtime gerenciado constrói por conta própria, e nenhum dos dois tem formato de variável de ambiente. Faça o eject para configurá-los.
**Com Eject:** `createPostgresAdapter({ realtime })` em `backend/src/index.ts`.
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
| `ttl`   | Manter as mensagens por no máximo este período — `"30s"`, `"15m"`, `"24h"`, `"7d"` ou milissegundos |

Uma regra precisa de pelo menos `limit` ou `ttl`. Uma regra sem nenhum dos dois é ignorada e registrada em log, pois a retenção ilimitada quase nunca é intencional e não pode ser revertida facilmente quando a tabela cresce.

:::note[Por que não deixar os clientes solicitarem o histórico?]
Um canal é criado por quem quer que o nomeie. Se um cliente pudesse escolher sua própria profundidade de histórico, qualquer visitante poderia sobrecarregar seu backend com armazenamento ilimitado. Configurá-lo aqui também significa que canais de presença e notificação — a grande maioria — não têm custo: sem regras configuradas, nenhuma tabela é criada e o broadcast segue o mesmo caminho síncrono de sempre.
:::

### Armazenamento

Canais retidos usam duas tabelas no schema `rebase`, criadas automaticamente na inicialização quando pelo menos uma regra é configurada:

| Tabela                    | Conteúdo                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | As mensagens retidas, indexadas por `(channel, seq)`             |
| `rebase.channel_cursors`  | A sequência mais alta emitida por canal                          |

A limpeza (pruning) ocorre conforme as mensagens chegam, com taxa limitada por canal para que o custo acompanhe o tempo decorrido e não o volume de gravação. Ela apenas remove linhas de `channel_messages` — os cursores são mantidos indefinidamente (são apenas uma linha pequena por canal), pois reiniciar a sequência de um canal alteraria o significado do ponto de retomada salvo de um cliente.

### Garantias de Entrega

- **Ordenado.** Os números de sequência são alocados por canal, e a ordem de entrega corresponde à ordem de sequência.
- **Durável antes de entregue.** Uma mensagem que não puder ser armazenada não será entregue a ninguém, e o remetente será avisado. Entregá-la a colocaria diante dos assinantes ao vivo, deixando-a de fora de qualquer reprodução futura (replay), e nenhuma mensagem posterior poderia reparar essa lacuna.
- **Pelo menos uma vez (At-least-once) na recuperação.** Um intervalo de reprodução pode se sobrepor a mensagens que o cliente já recebeu; o SDK descarta aquelas que já foram entregues.

:::caution[O histórico tem o mesmo modelo de acesso que o canal]
Um cliente que entrou em um canal pode reproduzir suas mensagens retidas, incluindo aquelas transmitidas antes de sua chegada — a participação é a única verificação, e entrar está aberto a qualquer cliente que saiba o nome do canal. A retenção é opcional por padrão de canal, portanto habilitá-la torna o passado daquele canal legível para qualquer visitante que adivinhe o nome. Canais retidos são o caso em que isso se torna duradouro em vez de momentâneo, então trate o conteúdo de um canal retido como público para seus usuários.
:::

## Rastreamento de Presença

A presença rastreia quais usuários estão online atualmente em um canal e permite que cada usuário compartilhe estados personalizados (ex.: posição do cursor, status).

| Tipo de Mensagem   | Direção         | Descrição                                            |
|--------------------|-----------------|------------------------------------------------------|
| `presence_track`   | Cliente → Servidor | Começar a rastrear a presença com estado personalizado |
| `presence_untrack` | Cliente → Servidor | Parar de rastrear a presença                         |
| `presence_state`   | Cliente → Servidor | Solicitar o estado completo de presença de um canal  |
| `presence_state`   | Servidor → Cliente | Entidade completa de todas as presenças em um canal  |
| `presence_diff`    | Servidor → Cliente | Atualização incremental (entradas e saídas)          |

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

O SDK do cliente se reconecta automaticamente quando a conexão WebSocket cai:

- **Backoff exponencial** — Os atrasos de reconexão começam em 1 segundo e dobram a cada tentativa, com limite máximo de 30 segundos.
- **Máximo de 5 tentativas** — Após 5 tentativas de reconexão com falha, o cliente para de tentar.
- **Reassinatura automática** — Após uma reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor. Nenhuma intervenção manual necessária.
- **Fila de mensagens** — Mensagens enviadas enquanto desconectado são colocadas em fila e entregues após a reconexão.

Você pode escutar eventos do ciclo de vida da conexão:

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

## Autenticação & RLS

As assinaturas WebSocket respeitam automaticamente as políticas de Row-Level Security (RLS). Quando o cliente está autenticado:

1. A conexão WebSocket se autentica usando o mesmo token JWT da API REST.
2. Cada refetch de assinatura é executado dentro de uma transação PostgreSQL com `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantindo que as políticas de RLS sejam aplicadas.
3. Se um token expirar durante uma sessão ativa, o cliente se reautentica e reassina automaticamente.

Isso significa que cada usuário recebe apenas atualizações para registros que tem permissão para ver.

Executar mais de uma instância — o barramento LISTEN/NOTIFY, o que a presença faz entre processos e como escrever seu próprio transporte — tem uma página dedicada:
[Realtime em múltiplas instâncias](/docs/backend/realtime-transports/).

## Captura de Alterações no Nível do Banco de Dados (CDC)

**O Change Data Capture está ativado por padrão.** O Rebase captura alterações no banco de dados e emite eventos de tempo real para **cada gravação confirmada (committed), independentemente de como foi feita** — REST, SDK, Studio, `psql`, um cron job em outro serviço, Drizzle/SQL puro ou o **editor SQL** do Studio. Esse é o mesmo modelo do Supabase Realtime monitorando o write-ahead log.

Nenhuma configuração é necessária. Em uma conexão de banco de dados que suporte o recurso, o CDC se autoprovisiona na inicialização; em uma que não suporte (ex.: uma role restrita que não pode criar triggers), o Rebase usa silenciosamente o tempo real em nível de aplicação — nada a ser ligado, nada que quebre.

### Configuração

O CDC é controlado pela variável de ambiente `REALTIME_CDC`:

| Valor | Comportamento |
| --- | --- |
| `auto` *(padrão)* | Habilita a captura no nível do banco de dados onde a conexão suportar; **faz fallback silencioso** para o tempo real em nível de aplicação caso contrário. Configuração zero. |
| `trigger` | Força a captura baseada em triggers. Funciona em qualquer PostgreSQL, incluindo instâncias gerenciadas sem replicação lógica. Avisa (em vez de fazer fallback silencioso) caso não consiga provisionar. |
| `wal` | Prefere a replicação lógica WAL. Ainda não empacotado — degrada para `trigger` e registra o modo ativo nos logs. |
| `off` | Apenas tempo real em nível de aplicação. Use isso para evitar a sobrecarga de triggers por gravação em cargas de trabalho intensivas em escrita. |

Ao inicializar, você verá uma linha de log indicando o modo ativo, por exemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se a conexão não puder suportá-lo, o modo `auto` registrará uma linha informativa e continuará com o tempo real em nível de aplicação:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Como Funciona

1. **Autoprovisionamento** — Na inicialização (contexto de server/owner), o Rebase instala uma trigger idempotente de `AFTER INSERT/UPDATE/DELETE` em cada tabela gerenciada. A trigger emite uma notificação de alteração compacta no canal `rebase_cdc`. Um payload que exceda o limite de 8&nbsp;KB do `NOTIFY` do PostgreSQL faz fallback para uma mensagem contendo apenas a identidade, garantindo que o CDC nunca aborte a gravação disparadora.
2. **Captura** — Um cliente `LISTEN` dedicado e sem pool por instância consome `rebase_cdc`, mapeia a tabela alterada de volta para sua coleção e alimenta a alteração no mesmo pipeline do `RealtimeService` usado pelas mutações da API. Assim como o listener entre instâncias, ele prefere a `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura com RLS** — A linha bruta do fluxo de alterações **nunca** é encaminhada para os assinantes. A alteração é marcada como invalidada e cada assinatura relê a linha sob seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente só recebe linhas permitidas pelas suas políticas de RLS.
4. **Entre instâncias** — Como cada instância observa cada commit através do fluxo de alterações, o CDC também *é* o canal entre instâncias; a transmissão legada `rebase_entity_changes` por mutação não é utilizada enquanto o CDC estiver ativo.
5. **Deduplicação** — Uma mutação feita por meio da API do Rebase é entregue localmente no instante em que é confirmada e também é ecoada de volta através do fluxo de alterações. A instância originária suprime esse eco (um registro de curta duração de suas próprias emissões), de modo que os assinantes nunca veem uma gravação de API duas vezes.

### Requisitos e Observações

- O CDC requer uma connection string direta (`DATABASE_DIRECT_URL` ou a conexão primária) para o cliente `LISTEN` — poolers de conexão em modo de transação não suportam sessões `LISTEN` de longa duração.
- As triggers são instaladas apenas em tabelas associadas a uma coleção registrada. Gravações em tabelas não mapeadas são ignoradas.
- Uma coleção cuja tabela ainda não foi migrada é ignorada com um aviso, em vez de bloquear o CDC para as demais.
- O streaming nativo de replicação lógica via WAL (`wal2json`/`pgoutput`) está planejado; atualmente, `REALTIME_CDC=wal` degrada para o caminho baseado em triggers, que oferece cobertura equivalente em nível de banco de dados.

## Timeout de Requisições Pendentes

Para evitar que as requisições do cliente fiquem travadas indefinidamente, todas as operações WebSocket pendentes que esperam uma resposta do servidor (como buscas únicas de coleção `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) têm um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente exclui automaticamente a requisição pendente e rejeita a promise com um `ApiError` contendo a mensagem `"Request timed out"`.

Mensagens unidirecionais que não esperam uma resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` e `presence_state`) resolvem imediatamente após a transmissão e não acionam timeouts.

### Quando um frame de canal é recusado

Um frame de canal é fire-and-forget (dispare e esqueça): `await channel.broadcast(...)` resolve quando o frame é gravado no socket, **não** quando o servidor o aceitou. Isso é intencional — um aplicativo colaborativo transmite uma posição de cursor sessenta vezes por segundo, e aguardar uma confirmação para cada uma transformaria cada evento em uma viagem de ida e volta (round trip).

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
| `RATE_LIMITED` | Ultrapassou o limite (budget) de frames do canal acima |
| `CHANNEL_HISTORY_WRITE_FAILED` | Um broadcast retido não pôde ser persistido, então foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Uma requisição de recuperação (catch-up) não pôde ser atendida |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast alcançou apenas esta instância — consulte [O limite de 8 KB no barramento do Postgres](#the-8-kb-limit-on-the-postgres-bus) |

Sem nenhum manipulador anexado, esses eventos são registrados no log como aviso. Eles costumavam ser descartados completamente: não havia promise para rejeitar e nenhum canal para onde entregar, de modo que um broadcast proibido era indistinguível de um entregue com sucesso.

## Próximos Passos

- [Client SDK](/docs/sdk) — Referência completa do SDK, incluindo acessores tipados de coleção.
- [Autenticação](/docs/backend/authentication) — Configure a autenticação JWT e as políticas de RLS.
- [Arquitetura do Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.

---
