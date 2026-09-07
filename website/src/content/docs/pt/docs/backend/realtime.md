---
sourceHash: 4f7a93fd3a8e67c8
title: Tempo Real e WebSocket
sidebar_label: Tempo Real
description: Sincronização de dados em tempo real, canais de broadcast e rastreamento de presença via WebSocket.
---

A Rebase inclui um motor de tempo real integrado que envia mudanças de dados aos clientes conectados via WebSocket.
Quando qualquer registro é criado, atualizado ou excluído, todo assinante que observa aquela coleção ou entidade recebe a atualização instantaneamente — sem necessidade de polling.

## Como Funciona

O pipeline de tempo real tem três estágios:

1. **Trigger do banco de dados** — Uma mutação atinge o banco de dados PostgreSQL (via API REST, SDK ou Studio).
2. **Fan-out do servidor** — O servidor Rebase detecta a mudança e a distribui para cada assinatura WebSocket ativa que corresponde à coleção ou entidade afetada.
3. **Callback do cliente** — O SDK cliente dispara seu callback `onUpdate` com os dados novos.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implantações com múltiplas instâncias, a Rebase usa `LISTEN/NOTIFY` do PostgreSQL para transmitir mudanças entre as instâncias do servidor. Isso é tratado automaticamente — uma conexão PostgreSQL dedicada escuta no canal `rebase_entity_changes` e retransmite atualizações para os assinantes locais.

### Zero Configuração

O tempo real vem habilitado por padrão. Não há flag para acionar nem serviço para iniciar — se o seu servidor Rebase estiver rodando, o endpoint WebSocket está disponível.

> Por padrão, a Rebase também emite eventos em tempo real para escritas feitas **fora** da API (via `psql`, outro serviço ou o editor SQL do Studio) sempre que a conexão com o banco de dados suportar — veja [captura de mudanças no nível do banco de dados](#captura-de-mudanças-no-nível-do-banco-de-dados-cdc).

## Assinaturas do SDK Cliente

O SDK cliente da Rebase expõe dois métodos de assinatura em cada acessor de coleção:

- **`listen()`** — Assinar uma coleção inteira (com filtros opcionais).
- **`listenById()`** — Assinar uma única entidade pelo seu ID.

Ambos os métodos retornam uma **função de cancelamento de assinatura** que você chama para parar de receber atualizações.

### Assinar uma Coleção

Use `listen()` para receber atualizações sempre que os registros de uma coleção mudarem:

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

### Assinar uma Coleção com Filtros

Passe `FindParams` como primeiro argumento para filtrar a assinatura:

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

### Assinar uma Única Entidade

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

### Cancelar a Assinatura

Tanto `listen()` quanto `listenById()` retornam uma função de cancelamento. Chame-a para parar de receber atualizações e liberar os recursos do lado do servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Sempre chame a função de cancelamento quando um componente for desmontado ou uma página for abandonada. Isso evita vazamentos de memória e trabalho desnecessário do lado do servidor.
:::

## `.listen()` do Query Builder

O construtor de consultas fluente também suporta assinaturas em tempo real. Encadeie seus filtros e depois chame `.listen()` em vez de `.find()`:

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
O método `.listen()` do construtor de consultas só está disponível quando o `RebaseClient` está configurado com uma `websocketUrl`. Se a conexão WebSocket não estiver configurada, chamar `.listen()` lançará um erro.
:::

## Entrega de Atualizações: Patch Instantâneo + Refetch de Correção

Uma mudança nunca chega a um assinante como dados. Ela chega como o fato de que
algo mudou, e a cada assinante é então dito o que *ele* pode ver, por uma consulta
executada como ele:

1. **Invalidação.** Quando uma entidade muda (criada, atualizada, excluída), o
   servidor marca os caminhos afetados. A linha que foi escrita não é encaminhada
   — ela foi lida sob a autorização de quem escreveu, que nada diz sobre o que
   qualquer assinante tem permissão para ver.

2. **Refetch RLS com debounce.** Após **300 ms** (`REFETCH_DEBOUNCE_MS`), o
   servidor relê a coleção com seus filtros e sua ordenação originais. A consulta
   é executada dentro de uma transação que define os valores locais da transação
   `app.user_id` e `app.user_roles` a partir do `SubscriptionAuthContext` do
   assinante, de modo que o Postgres avalia a segurança em nível de linha sob a
   identidade daquele cliente e apenas as linhas que ele está autorizado a ver são
   enviadas no `collection_update`. O debounce também agrupa uma rajada de
   escritas em uma única consulta.

Versões anteriores enviavam um `collection_patch` imediato com a linha escrita
antes desse refetch, para um feedback entre abas em menos de um milissegundo.
Essa linha havia sido lida sob o escopo de quem escreveu, então podia alcançar —
e alcançava — assinantes cujas próprias políticas a teriam negado, e o filtro
`where` da própria assinatura também não era aplicado a ela. O patch foi
removido: a latência percebida de uma atualização é agora a janela do debounce.

## Canais de Broadcast

Os canais de broadcast permitem que os clientes enviem mensagens arbitrárias uns aos outros em tempo real — útil para recursos como indicadores de digitação, posições de cursor ou notificações personalizadas.

O broadcast é gerenciado no nível do protocolo WebSocket. O servidor suporta estes tipos de mensagem:

| Tipo de Mensagem | Direção          | Descrição                                |
|-----------------|-----------------|------------------------------------------|
| `join_channel`  | Cliente → Servidor | Entrar em um canal nomeado             |
| `leave_channel` | Cliente → Servidor | Sair de um canal                        |
| `broadcast`     | Cliente → Servidor | Enviar uma mensagem a todos os membros do canal |
| `broadcast`     | Servidor → Cliente | Receber uma mensagem de outro membro    |
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

Por padrão, um broadcast alcança os membros conectados no momento e depois desaparece. É o equilíbrio certo para notificações e cursores, e não custa nada.

Para um fluxo de operações — edição colaborativa, qualquer coisa em que uma lacuna silenciosa cause divergência — um canal pode ser configurado para **reter** suas mensagens. Broadcasts retidos recebem um número de sequência por canal e são armazenados, de modo que um cliente que se reconecta pode pedir tudo o que veio depois do último que viu.

:::caution[Onde isso é configurado]
**Runtime gerenciado: em lugar nenhum.** A retenção de canais e `realtime.bus`
fazem parte do adaptador de banco de dados que o runtime gerenciado constrói por
conta própria, e nenhum dos dois tem forma de variável de ambiente. Faça eject
para configurá-los.
**Com eject:** `createPostgresAdapter({ realtime })` em `backend/src/index.ts`.
:::

A retenção é opcional e é configurada aqui, no servidor:

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
|-------|-------------|
| `match` | Nome exato do canal (`"doc:42"`) ou um prefixo terminado em `*` (`"doc:*"`) |
| `limit` | Manter no máximo esta quantidade de mensagens mais recentes por canal |
| `ttl` | Manter as mensagens por no máximo este tempo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, ou milissegundos |

Uma regra precisa de pelo menos `limit` ou `ttl`. Uma sem nenhum dos dois é ignorada e registrada, porque retenção ilimitada quase nunca é intencional e não pode ser desfeita depois que a tabela cresceu.

:::note[Por que não deixar os clientes pedirem histórico?]
Um canal é criado por quem o nomeia. Se um cliente pudesse escolher sua própria profundidade de histórico, qualquer visitante poderia comprometer seu backend com armazenamento ilimitado. Configurar aqui também significa que canais de presença e notificação — a grande maioria — não pagam nada: sem regras configuradas, nenhuma tabela é criada e o broadcast segue o mesmo caminho síncrono de sempre.
:::

### Armazenamento

Canais com retenção usam duas tabelas no esquema `rebase`, criadas automaticamente na inicialização quando há ao menos uma regra configurada:

| Tabela | Conteúdo |
|-------|-----------|
| `rebase.channel_messages` | As mensagens retidas, indexadas por `(channel, seq)` |
| `rebase.channel_cursors` | A maior sequência emitida por canal |

A poda acontece conforme as mensagens chegam, limitada por canal para que o custo dependa do tempo decorrido e não do volume de escrita. Ela só remove linhas de `channel_messages` — os cursores são mantidos indefinidamente (uma linha pequena por canal), porque reiniciar a sequência de um canal mudaria o significado do ponto de retomada salvo por um cliente.

### Garantias de entrega

- **Ordenado.** Os números de sequência são atribuídos por canal, e a ordem de entrega coincide com a ordem de sequência.
- **Durável antes de entregue.** Uma mensagem que não pode ser armazenada não é entregue a ninguém, e o remetente é avisado. Entregá-la a colocaria diante dos assinantes ao vivo deixando-a fora de toda repetição futura, e nenhuma mensagem posterior poderia reparar essa lacuna.
- **Pelo menos uma vez na recuperação.** Uma faixa de repetição pode se sobrepor a mensagens que o cliente já recebeu; o SDK descarta as que já entregou.

:::caution[O histórico tem o mesmo modelo de acesso do canal]
Um cliente que entrou em um canal pode repetir suas mensagens retidas, incluindo as difundidas antes de sua chegada — a participação é a única verificação, e entrar está aberto a qualquer cliente capaz de nomear o canal. A retenção é opcional por padrão de canal, então ativá-la torna o passado desse canal legível para qualquer visitante que adivinhe o nome. Canais com retenção são o caso em que isso se torna duradouro em vez de momentâneo, então trate o conteúdo de um canal retido como público para os seus usuários.
:::

## Rastreamento de Presença

A presença rastreia quais usuários estão atualmente online em um canal e permite que cada usuário compartilhe um estado personalizado (por ex., posição do cursor, status).

| Tipo de Mensagem   | Direção          | Descrição                                            |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Cliente → Servidor | Começar a rastrear a presença com estado personalizado |
| `presence_untrack`| Cliente → Servidor | Parar de rastrear a presença                        |
| `presence_state`  | Cliente → Servidor | Solicitar o estado de presença completo de um canal |
| `presence_state`  | Servidor → Cliente | Estado completo de todas as presenças em um canal   |
| `presence_diff`   | Servidor → Cliente | Atualização incremental (entradas e saídas)         |

Quando um cliente envia `presence_track`, o servidor o junta automaticamente ao canal (sem necessidade de um `join_channel` separado) e transmite um `presence_diff` a todos os membros do canal.

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

As presenças obsoletas são limpas automaticamente após 30 segundos de inatividade.

## Reconexão Automática

O SDK cliente se reconecta automaticamente quando a conexão WebSocket cai:

- **Backoff exponencial** — Os atrasos de reconexão começam em 1 segundo e dobram a cada tentativa, com limite de 30 segundos.
- **Máximo de 5 tentativas** — Após 5 tentativas de reconexão malsucedidas, o cliente para de tentar.
- **Reinscrição automática** — Em uma reconexão bem-sucedida, todas as assinaturas ativas são registradas novamente no servidor. Nenhuma intervenção manual necessária.
- **Enfileiramento de mensagens** — As mensagens enviadas enquanto desconectado são enfileiradas e entregues após a reconexão.

Você pode escutar os eventos do ciclo de vida da conexão:

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

As assinaturas WebSocket respeitam automaticamente as políticas de segurança em nível de linha (RLS). Quando o cliente está autenticado:

1. A conexão WebSocket se autentica usando o mesmo token JWT que a API REST.
2. Cada refetch de assinatura é executado dentro de uma transação PostgreSQL com `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantindo que as políticas RLS sejam aplicadas.
3. Se um token expirar durante uma sessão ativa, o cliente se reautentica e reinscreve automaticamente.

Isso significa que cada usuário só recebe atualizações dos registros que tem permissão para ver.

Executar mais de uma instância — o barramento LISTEN/NOTIFY, o que a presença faz
entre processos e como escrever o seu próprio transporte — tem uma página
própria: [Tempo real entre instâncias](/docs/backend/realtime-transports/).

## Captura de Mudanças no Nível do Banco de Dados (CDC)

**A Change Data Capture está ativada por padrão.** A Rebase captura mudanças no banco de dados e emite eventos em tempo real para **cada escrita confirmada, independentemente de como foi feita** — REST, SDK, Studio, `psql`, um cron job em outro serviço, Drizzle/SQL bruto ou o **editor SQL** do Studio. Este é o mesmo modelo que o Supabase Realtime seguindo o write-ahead log (WAL).

Nenhuma configuração é necessária. Em uma conexão de banco de dados que suporta, o CDC se auto-provisiona na inicialização; em uma que não suporta (por ex., um papel restrito que não pode criar triggers), a Rebase usa silenciosamente o tempo real no nível da aplicação — nada a ativar, nada que quebre.

### Configuração

O CDC é controlado pela variável de ambiente `REALTIME_CDC`:

| Valor | Comportamento |
| --- | --- |
| `auto` *(padrão)* | Habilita a captura no nível do banco de dados onde a conexão suporta; **recorre silenciosamente** ao tempo real no nível da aplicação caso contrário. Zero configuração. |
| `trigger` | Força a captura baseada em triggers. Funciona em qualquer PostgreSQL, incluindo instâncias gerenciadas sem replicação lógica. Avisa (em vez de recorrer silenciosamente) se não conseguir provisionar. |
| `wal` | Prefere a replicação lógica WAL. Ainda não incluída — degrada para `trigger` e registra o modo ativo. |
| `off` | Somente tempo real no nível da aplicação. Use isto para evitar a sobrecarga do trigger por escrita em cargas de trabalho com muitas escritas. |

Na inicialização, você verá uma linha de log indicando o modo ativo, por ex.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se a conexão não puder suportar, `auto` registra uma linha informativa e continua com o tempo real no nível da aplicação:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Como Funciona

1. **Auto-provisionamento** — Na inicialização (contexto de servidor/proprietário), a Rebase instala um trigger idempotente `AFTER INSERT/UPDATE/DELETE` em cada tabela gerenciada. O trigger emite uma notificação de mudança compacta no canal `rebase_cdc`. Um payload que excederia o limite de 8&nbsp;KB do `NOTIFY` do PostgreSQL recorre a uma mensagem de identidade apenas, de modo que o CDC nunca pode abortar a escrita que o disparou.
2. **Captura** — Um cliente `LISTEN` dedicado e sem pool por instância consome `rebase_cdc`, mapeia a tabela modificada de volta à sua coleção e alimenta a mudança no mesmo pipeline `RealtimeService` usado pelas mutações da API. Como o listener entre instâncias, ele prefere `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura para RLS** — A linha bruta do fluxo de mudanças **nunca** é encaminhada aos assinantes. A mudança é marcada como invalidada, e cada assinatura relê a linha sob o seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente só recebe as linhas que suas políticas RLS permitem.
4. **Entre instâncias** — Como cada instância observa cada commit através do fluxo de mudanças, o CDC *também é* o canal entre instâncias; o broadcast legado `rebase_entity_changes` por mutação não é usado enquanto o CDC está ativo.
5. **Desduplicação** — Uma mutação feita através da API da Rebase é entregue localmente no instante em que é confirmada e também é ecoada de volta através do fluxo de mudanças. A instância de origem suprime esse eco (um registro efêmero de suas próprias emissões), de modo que os assinantes nunca veem uma escrita da API duas vezes.

### Requisitos & Notas

- O CDC requer uma string de conexão direta (`DATABASE_DIRECT_URL` ou a conexão primária) para o cliente `LISTEN` — pools de conexões em modo transação não suportam sessões `LISTEN` de longa duração.
- Os triggers são instalados apenas em tabelas suportadas por uma coleção registrada. Escritas em tabelas não mapeadas são ignoradas.
- Uma coleção cuja tabela ainda não foi migrada é ignorada com um aviso, em vez de bloquear o CDC para o restante.
- O streaming nativo de replicação lógica WAL (`wal2json`/`pgoutput`) está planejado; hoje `REALTIME_CDC=wal` degrada para o caminho baseado em triggers, que fornece cobertura equivalente no nível do banco de dados.

## Timeout de Requisições Pendentes

Para evitar que as requisições do cliente fiquem travadas indefinidamente, todas as operações WebSocket pendentes que esperam uma resposta do servidor (como buscas pontuais de coleção `FETCH_COLLECTION`, buscas de entidade única `FETCH_ONE`, criação/atualização `SAVE`, exclusões `DELETE`, contagens `COUNT` e verificações de unicidade `CHECK_UNIQUE_FIELD`) têm um timeout padrão de 30 segundos.

Se o servidor não responder dentro dessa janela de 30 segundos, o cliente exclui automaticamente a requisição pendente e rejeita a promise com um `ApiError` com a mensagem `"Request timed out"`.

Mensagens unidirecionais que não esperam resposta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` e `presence_state`) são resolvidas imediatamente na transmissão e não acionam timeouts.

### Quando um frame de canal é recusado

Um frame de canal é fire-and-forget: `await channel.broadcast(...)` é resolvido
quando o frame é escrito no socket, **não** quando o servidor o aceitou. Isso é
deliberado — um aplicativo colaborativo transmite uma posição de cursor sessenta
vezes por segundo, e esperar por uma confirmação em cada uma faria de cada uma um
round trip.

Portanto, uma recusa não pode ser uma promise rejeitada. Ela chega em `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|------|-------|
| `CHANNEL_FORBIDDEN` | Você não é membro do canal — entre nele antes de transmitir ou de ler seu histórico |
| `RATE_LIMITED` | Acima do orçamento de frames de canal indicado acima |
| `CHANNEL_HISTORY_WRITE_FAILED` | Um broadcast retido não pôde ser persistido, então foi descartado |
| `CHANNEL_HISTORY_READ_FAILED` | Uma requisição de recuperação não pôde ser atendida |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | O broadcast alcançou apenas esta instância — veja [O limite de 8&nbsp;KB do barramento Postgres](#the-8-kb-limit-on-the-postgres-bus) |

Sem um handler anexado, esses erros são registrados como aviso. Antes eram
descartados por completo: não havia promise a rejeitar nem canal para entregar,
de modo que um broadcast proibido era indistinguível de um entregue.

## Próximos Passos

- [SDK Cliente](/docs/sdk) — Referência completa do SDK, incluindo acessores de coleção tipados.
- [Autenticação](/docs/backend/authentication) — Configurar autenticação JWT e políticas RLS.
- [Arquitetura do Backend](/docs/backend) — Visão geral da arquitetura do servidor Rebase.
