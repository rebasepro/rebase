---
sourceHash: a82dd911da9d58ef
title: Assinaturas em Tempo Real
sidebar_label: Tempo Real
description: Assine mudanças de dados ao vivo com o SDK Cliente da Rebase usando listeners em tempo real baseados em WebSocket.
---

## Visão Geral

O SDK Cliente da Rebase fornece assinaturas de dados em tempo real via WebSocket. Quando os registros mudam no servidor, seus callbacks assinados disparam imediatamente com os dados atualizados.

A conexão WebSocket é estabelecida automaticamente quando uma `websocketUrl` está disponível (derivada de `baseUrl` por padrão). A reconexão e a atualização de tokens são tratadas de forma transparente.

## Assinar uma Coleção

Use `listen()` para assinar uma consulta de coleção. O callback dispara sempre que o conjunto de dados correspondente muda:

```typescript
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
        console.log("Total:", response.meta.total);
    }
);

// Stop listening when done
unsubscribe();
```

O método `listen()` aceita os mesmos `FindParams` que `find()` — você pode filtrar, ordenar e paginar sua assinatura:

```typescript
const unsubscribe = client.data.orders.listen(
    {
        where: { status: ["==", "pending"] },
        orderBy: ["createdAt", "desc"],
        limit: 20
    },
    (response) => {
        renderOrders(response.data);
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Assinatura

```typescript no-verify
listen(
    params: FindParams<M> | undefined,
    onUpdate: (result: FindResult<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

`FindResult<M>` é a mesma forma que `find()` devolve: linhas planas em `data` e
`{ total, limit, offset, hasMore }` em `meta`.

### Uma emissão por alteração

Cada envio do servidor chama o seu callback **uma vez**, com metadados que descrevem as
linhas ao lado deles. Não há uma primeira emissão separada nem qualquer sinalizador a
verificar:

- Antes da emissão corre um `count()` para a consulta, por isso `meta.total` e
  `meta.hasMore` são autoritativos.
- Se chegar um envio enquanto essa contagem ainda decorre, a emissão mais antiga é
  descartada — nunca recebe um total que pertence a uma página anterior.
- Se a contagem **falhar**, é reutilizado o último total que uma contagem devolveu de
  facto. Uma contagem falhada nada diz sobre o tamanho da coleção, pelo que não pode
  sobrepor-se a uma resposta real. Isto não é um erro de subscrição, e `onError` não é
  chamado.
- Se nenhuma contagem alguma vez teve sucesso nesta subscrição, `meta.total` é um
  **limite inferior** — as linhas desta página mais as que foram saltadas para lá chegar
  — e `meta.hasMore` é `true` quando a página veio cheia.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Assinar uma Única Entidade

Use `listenById()` para observar um registro específico pelo seu ID:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        if (entity) {
            console.log("Product changed:", entity.values.name);
        } else {
            console.log("Product was deleted");
        }
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Assinatura

```typescript
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

O callback recebe uma linha plana — não uma `Entity`, por isso não há `.values` — e
`undefined` quando o registo é eliminado.

## Construtor de Consultas Fluente

Você também pode assinar através do construtor de consultas fluente. Isso é equivalente a chamar `listen()` com parâmetros, mas permite encadear `.where()`, `.orderBy()`, etc.:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

## Cancelar a Assinatura

Toda assinatura retorna uma função `unsubscribe`. Chame-a para parar de receber atualizações e limpar o listener do WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

No React, use a limpeza do `useEffect`:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Autenticação e Reconexão

O cliente WebSocket cuida da autenticação automaticamente:

- No **login** ou na **atualização do token**, o novo token é enviado ao servidor WebSocket através de uma mensagem `authenticate`.
- No **logout**, a conexão WebSocket é desconectada.
- Se a conexão cair, o cliente **se reconecta automaticamente** e restabelece todas as assinaturas ativas.

Nenhum gerenciamento manual de tokens é necessário — a integração entre `client.auth` e a camada WebSocket é tratada internamente.

## Canais de Broadcast

Os canais de broadcast permitem enviar mensagens arbitrárias entre clientes conectados — ideal para chat, notificações ou recursos colaborativos:

```typescript
// Obtain a channel. This alone opens no connection.
const channel = client.realtime.channel("chat-room");

// Listen for broadcasts. Pass an event name to filter, or omit it for all.
channel.onBroadcast("message", (payload) => {
    console.log("New message:", payload);
});

// Send to every other member — the sender never receives its own message.
await channel.broadcast("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave, releasing handlers and timers.
await channel.leave();
```

Os canais são leves e efêmeros — existem enquanto pelo menos um cliente estiver assinado.

> **Por padrão, os broadcasts não são reenviados.** Eles alcançam apenas os membros conectados no momento. É o que se quer para notificações que se autocorrigem — um aviso de «alguém salvou» é substituído pelo salvamento seguinte — e não custa nada. Para um fluxo de operações, onde uma lacuna silenciosa causa divergência, ative o [histórico de mensagens](#histórico-de-mensagens-e-recuperação) no canal.

## Histórico de Mensagens e Recuperação

Um canal pode ser configurado para reter seus broadcasts, de modo que um cliente que se reconecta recupere o que perdeu em vez de ressincronizar do zero. É isso que torna os canais utilizáveis como transporte para edição colaborativa.

A retenção é configurada **no servidor**, por padrão de canal — veja [Backend Realtime](/pt/docs/backend/realtime#retenção-de-canais). Um cliente não pode ativá-la por conta própria, porque um canal é criado por quem o nomeia, e uma profundidade de histórico escolhida pelo cliente permitiria a qualquer visitante comprometer seu backend com armazenamento ilimitado.

Em um canal com retenção, passe `{ history: true }` e o SDK faz o resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

No `join()` e após cada reconexão, o SDK pede ao servidor tudo o que vem depois do último número de sequência que viu, e entrega o resultado pelos mesmos handlers. Não há um segundo caminho de código a escrever: um handler que aplica uma operação corretamente ao vivo a aplica corretamente na recuperação.

### Números de sequência

Todo broadcast em um canal com retenção carrega um `seq` — por canal, sem lacunas e crescente. É o ponto de retomada do cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persista `channel.sequence` se quiser que a recuperação sobreviva também a um recarregamento de página, e devolva-o via `history({ sinceSeq })`.

### Buscar o histórico explicitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que o canal não guarda histórico e nunca guardará — uma resposta explícita, para que você possa distinguir «você não perdeu nada» de «este canal não tem regra de retenção». No segundo caso, um cliente que precisa convergir tem de recorrer a uma ressincronização completa.

`latestSeq` é a maior sequência que o servidor possui, tenha este lote chegado a ela ou não. Se estiver muito além do seu último `seq` entregue, você está mais atrasado do que uma página e ressincronizar pode sair mais barato que paginar.

:::note[As repetições podem se sobrepor, e tudo bem]
O servidor não tem como saber exatamente quais mensagens chegaram até você antes de a conexão cair, então uma faixa de recuperação pode incluir algumas que você já aplicou. O SDK descarta tudo que esteja na ou abaixo da sequência já entregue, de modo que os handlers nunca veem uma mensagem duas vezes.

Suas próprias mensagens **não** são filtradas de uma repetição: uma reconexão atribui um novo id de cliente, portanto o próprio caso para o qual a recuperação existe é aquele em que esse filtro falharia. Torne as operações idempotentes se reaplicar as suas fosse um problema.
:::
## Rastreamento de Presença

A presença permite rastrear quais usuários estão online e sincronizar o estado compartilhado entre todos os participantes:

```typescript
const channel = client.realtime.channel("editors");

// Publish your presence. This is also what opens the connection.
await channel.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// One handler for every change. `presences` is always the full roster;
// `diff` is what changed, when you only care about the delta.
channel.onPresence((presences, diff) => {
    console.log("Online users:", Object.keys(presences));
    if (diff) {
        console.log("joined:", Object.keys(diff.joins));
        console.log("left:", Object.keys(diff.leaves));
    }
});

// Calling track() again replaces your state — this is how you publish a
// moving cursor.
await channel.track({ userId: currentUser.id, status: "idle" });

// Stop publishing without leaving the channel.
await channel.untrack();
```

A presença é construída sobre os canais de broadcast com diferenciação automática de estado — apenas as mudanças são transmitidas.

## Quando Usar o Tempo Real

| Caso de Uso | Método |
|----------|--------|
| Painel com dados ao vivo | `listen()` com filtros |
| Chat ou mensagens | `channel.broadcast()` |
| Edição colaborativa / fluxos de operações | `channel(name, { history: true })` |
| Indicadores de digitação / status online | `channel.track()` + `channel.onPresence()` |
| Página de detalhe com atualizações ao vivo | `listenById()` |
| Monitoramento do painel de administração | `listen()` com `orderBy` e `limit` |

> **Dica:** Para buscas de dados pontuais, use `find()` ou `findById()`. As assinaturas são ideais para dados que mudam com frequência e precisam ser refletidos na interface imediatamente.

## Próximos Passos

- **[Consultar Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Autenticação](/docs/sdk/authentication)** — Login e gerenciamento de sessões
- **[Backend em Tempo Real](/docs/backend/realtime)** — Configuração de WebSocket do lado do servidor
