---
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
        where: { status: "pending" },
        orderBy: ["created_at", "desc"],
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

```typescript
listen(
    params: FindParams | undefined,
    onUpdate: (response: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

### Metadados em Duas Fases

Quando `listen()` dispara, ele emite atualizações em até duas fases:

1. **Imediata (estimada):** O primeiro callback dispara instantaneamente com as entidades e metadados de paginação heurísticos (`total` = número de entidades retornadas, `hasMore` = se a contagem é igual ao limite solicitado). Essa emissão carrega `meta.estimated: true`.

2. **Autoritativa (opcional):** Uma consulta de contagem assíncrona é executada em segundo plano. Se o `total` ou `hasMore` autoritativo diferir da estimativa, um segundo callback dispara com metadados corrigidos e **sem** o sinalizador `estimated`. Se os valores coincidirem, a segunda emissão é totalmente ignorada — seu callback dispara apenas uma vez.

Se a consulta de contagem **falhar**, nenhuma segunda emissão ocorre. O sinalizador `estimated: true` da primeira emissão permanece como sinal de que os metadados são heurísticos. Isso não é tratado como um erro de assinatura.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        if (response.meta.estimated) {
            // First-paint: render immediately, total/hasMore may change
            renderProducts(response.data, { loading: true });
        } else {
            // Authoritative: safe to render final pagination controls
            renderProducts(response.data, { loading: false });
        }
    }
);
```

> **Dica:** Se você não precisar distinguir entre metadados estimados e autoritativos, pode ignorar o sinalizador `estimated` — ambas as emissões carregam o mesmo array `data`.

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
    onUpdate: (entity: Entity<M> | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

O callback recebe `undefined` quando a entidade é excluída.

## Construtor de Consultas Fluente

Você também pode assinar através do construtor de consultas fluente. Isso é equivalente a chamar `listen()` com parâmetros, mas permite encadear `.where()`, `.orderBy()`, etc.:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("created_at", "desc")
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
| Indicadores de digitação / status online | `channel.track()` + `channel.onPresence()` |
| Página de detalhe com atualizações ao vivo | `listenById()` |
| Monitoramento do painel de administração | `listen()` com `orderBy` e `limit` |

> **Dica:** Para buscas de dados pontuais, use `find()` ou `findById()`. As assinaturas são ideais para dados que mudam com frequência e precisam ser refletidos na interface imediatamente.

## Próximos Passos

- **[Consultar Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Autenticação](/docs/sdk/authentication)** — Login e gerenciamento de sessões
- **[Backend em Tempo Real](/docs/backend/realtime)** — Configuração de WebSocket do lado do servidor
