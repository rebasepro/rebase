---
sourceHash: f49369700dcdc098
title: Subscrições em Tempo Real
sidebar_label: Realtime
description: Inscreva-se em alterações de dados em tempo real com o Rebase Client SDK usando listeners em tempo real baseados em WebSocket.
---

## Visão Geral

O Rebase Client SDK fornece subscrições de dados em tempo real via WebSocket. Quando registros são alterados no servidor, seus callbacks inscritos são disparados imediatamente com os dados atualizados.

A conexão WebSocket é estabelecida automaticamente quando uma `websocketUrl` está disponível (derivada de `baseUrl` por padrão). A reconexão e a atualização de tokens são tratadas de forma transparente.

## Subscrever uma Coleção

Use `listen()` para se inscrever em uma consulta de coleção. O callback é disparado sempre que o conjunto de dados correspondente for alterado:

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

O método `listen()` aceita os mesmos `FindParams` que `find()` — você pode filtrar, ordenar e paginar sua subscrição:

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

`FindResult<M>` tem o mesmo formato retornado por `find()`: linhas planas em `data` e `{ total, limit, offset, hasMore, nextCursor }` em `meta`.

### `listen()` aceita o que `find()` aceita

`params` é um `FindParams` completo. Uma subscrição é a mesma consulta que o `find()` correspondente, portanto aceita o mesmo refinamento — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** e **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Isso é mais importante do que parece. Anteriormente, `include` e `fields` eram descartados silenciosamente aqui, de modo que a mesma consulta respondia em um formato através de `find()` e em outro através de `listen()` — e um componente renderizando ambos via o formato de suas linhas mudar no momento em que uma escrita ocorria. Agora eles passam pelo mesmo pipeline de leitura, de modo que `find({ q })` e `listen({ q })` retornam linhas que são iguais campo a campo.

A exceção é `vectorSearch`, que é **recusado** em vez de descartado: uma subscrição é executada novamente a cada escrita correspondente e nada ali calcula distâncias. Use `.vectorSearch(…).find()` para a consulta e subscreva sem ele.

### Uma emissão por alteração

Cada push do servidor chama seu callback **uma única vez**, com metadados que descrevem as linhas ao lado dele. Não há emissão separada de primeira renderização e nenhuma flag para verificar.

Os metadados chegam **no mesmo frame que as linhas**: o servidor faz a contagem da consulta dentro da mesma transação vinculada à segurança em nível de linha (row-level security) que as leu, portanto `meta.total`, `meta.hasMore` e `meta.nextCursor` descrevem exatamente as linhas ao lado deles. (Anteriormente, cada push era seguido por um `GET /count` do cliente — um round trip extra por escrita, por assinante, e uma janela na qual a contagem e as linhas descreviam estados diferentes da coleção.)

Dois fallbacks, nenhum deles sendo um erro de subscrição e nenhum chamando `onError`:

- Se a **contagem do servidor falhar**, o frame não carrega nenhum total e o último recebido é reutilizado. Uma contagem com falha não diz nada sobre o tamanho da coleção, portanto não deve sobrescrever uma resposta real.
- Se nenhum total jamais tiver chegado para esta subscrição — um servidor mais antigo que não envia metadados — o cliente solicita uma vez, no primeiro push. Se isso também falhar, `meta.total` será um **limite inferior**: as linhas desta página mais as que foram paginadas para alcançá-las.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Subscrever uma Única Entidade

Use `listenById()` para observar um registro específico pelo seu ID:

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .collection<{ id: number; name: string }>("products")
    .listenById(
    42,
    (product) => {
        if (product) {
            console.log("Product changed:", product.name);
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

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

O callback recebe uma linha plana — não uma `Entity`, portanto não há `.values` — e `undefined` quando o registro é excluído.

## Fluent Query Builder

Você também pode se inscrever através do fluent query builder. Isso é equivalente a chamar `listen()` com parâmetros, mas permite encadear `.where()`, `.orderBy()`, etc.:

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

Uma subscrição aceita ordenação por múltiplas colunas como qualquer outra consulta — seja `orderBy: [["category", "asc"], ["createdAt", "desc"]]` nos parâmetros, seja uma segunda chamada a `.orderBy()`, que adiciona um critério de desempate em vez de substituir o primeiro. Consulte [Ordenação](/docs/sdk/querying#sorting).

O servidor verifica o *formato* do `orderBy` de uma subscrição na chegada e recusa uma formatação inválida com um frame de erro em vez de se inscrever. Caso contrário, uma ordenação que não pudesse ser lida transmitiria linhas sem ordem alguma sem relatar nenhum erro — e um frame `collection_update` carrega apenas linhas e nada mais, de modo que o assinante não teria como notar.

## Cancelar a Subscrição

Toda subscrição retorna uma função `unsubscribe`. Chame-a para parar de receber atualizações e limpar o listener do WebSocket:

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

O cliente WebSocket lida com a autenticação automaticamente:

- No **login** ou **atualização de token**, o novo token é enviado para um socket já aberto via uma mensagem `authenticate`. Se nenhum estiver aberto, nada acontece — fazer login não é uma solicitação de tempo real, e um socket aberto posteriormente autentica a si mesmo.
- No **logout**, a conexão WebSocket é desconectada. O cliente permanece utilizável; uma subscrição posterior se reconecta anonimamente.
- Se a conexão cair, o cliente **se reconecta automaticamente** e restabelece todas as subscrições ativas.

Nenhum gerenciamento manual de tokens é necessário — a integração entre `client.auth` e a camada WebSocket é tratada internamente.

### A conexão é lazy

Criar um cliente **não** abre um WebSocket. Ele é discado na primeira operação que realmente precisa de um — uma subscrição `listen()` / `listenById()`, ou uma operação de canal como `join()`, `track()` ou `broadcast()`. Obter um canal não significa usá-lo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Isso é importante para aplicativos com tráfego relevante de usuários não autenticados — páginas de marketing, visualizações públicas somente leitura, ferramentas anônimas por padrão — que anteriormente pagavam o custo de uma conexão em cada carregamento de página apenas para ter tempo real disponível.

Dois comportamentos relacionados:

- `realtime: false` permanece uma desativação estrita: nenhum socket é aberto, e `client.realtime.channel()` lança um erro. O mesmo vale para `listen()` e `listenById()` — eles estão sempre disponíveis para chamada, e em um cliente sem socket lançam um `RebaseClientError` nomeando a opção que os habilitaria. O `observe()` não lança erro: ele se degrada para um único fetch.
- `client.close()` é definitivo. Ele libera o socket e seu timer de reconexão, e nada enfileirado posteriormente tentará discar novamente. No Node, um socket aberto mantém o event loop ativo, portanto um script que nunca o chama não será encerrado por conta própria.

## Canais de Broadcast

Os canais de broadcast permitem que você envie mensagens arbitrárias entre clientes conectados — ideal para chat, notificações ou recursos colaborativos:

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

Os canais são leves e efêmeros — eles existem enquanto pelo menos um cliente estiver inscrito. Chamadas repetidas a `channel()` com o mesmo nome retornam o **mesmo** objeto, de modo que dois componentes podem anexar handlers de forma independente sem que um desconecte o outro ao sair.

Frames de canal e presença não exigem uma conta: visitantes anônimos podem entrar em canais públicos.

:::caution[Canais ainda não possuem regras de acesso]
A única verificação aplicada pelo servidor é o **pertencimento**: para transmitir em um canal, ler sua lista de presença ou reproduzir seu histórico, o cliente deve ter entrado nesse canal primeiro. A entrada em si é aberta — qualquer cliente que saiba o nome de um canal pode entrar nele, esteja ou não autenticado.

Portanto, o nome de um canal não é um segredo e não é uma permissão. Não coloque nada em um canal (incluindo histórico retido e estado de presença) que qualquer usuário do seu aplicativo não possa ver, e não derive o nome de um canal a partir de dados que você não divulgaria publicamente. Regras de autorização por canal não estão implementadas; se você precisar delas hoje, mantenha a parte sensível da troca em `client.data`, onde a segurança em nível de linha (row-level security) se aplica.
:::

> **Por padrão, os broadcasts não são reproduzidos.** Eles alcançam apenas os membros conectados no momento. Isso é exatamente o que você deseja para notificações que se autocorrigem — um aviso de "alguém salvou" é substituído pelo próximo salvamento — e não custa nada. Para um fluxo de operações, onde uma lacuna silenciosa causa divergência, ative o [histórico de mensagens](#message-history-and-catch-up) no canal.

## Histórico de Mensagens e Recuperação (Catch-Up)

Um canal pode ser configurado para reter seus broadcasts, permitindo que um cliente reconectado recupere o que perdeu em vez de ressincronizar do zero. É isso que torna os canais utilizáveis como transporte para edição colaborativa.

A retenção é configurada **no servidor**, por padrão de canal — consulte [Realtime Backend](/docs/backend/realtime#channel-retention). O cliente não pode ativá-la por conta própria, pois um canal é criado por quem quer que o nomeie, e uma profundidade de histórico escolhida pelo cliente permitiria que qualquer visitante sobrecarregasse seu backend com armazenamento ilimitado.

Em um canal com retenção, passe `{ history: true }` e o SDK cuidará do resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

No `join()` e após cada reconexão, o SDK solicita ao servidor tudo o que aconteceu após o último número de sequência que viu e entrega o resultado através dos mesmos handlers. Não há um segundo fluxo de código a ser escrito: um handler que aplica uma operação corretamente em tempo real a aplica corretamente na recuperação (catch-up).

### Números de sequência

Cada broadcast em um canal retido carrega um `seq` — por canal, contínuo e incremental. É o ponto de retomada do cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persista `channel.sequence` se você deseja que o catch-up sobreviva a uma recarga de página além de uma reconexão, e passe-o de volta via `history({ sinceSeq })`.

### Buscar histórico explicitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que o canal não mantém histórico e nunca manterá — uma resposta explícita, para que você possa diferenciar "você não perdeu nada" de "este canal não possui regra de retenção". No segundo caso, um cliente que precisa convergir deve recorrer a uma ressincronização completa.

`latestSeq` é a sequência mais alta que o servidor mantém, quer este lote a tenha alcançado ou não. Se ela estiver muito além do seu último `seq` entregue, você está atrasado em mais de uma página e ressincronizar pode ser mais vantajoso do que paginar.

:::note[As reproduções podem se sobrepor, e tudo bem]
O servidor não tem como saber exatamente quais mensagens chegaram até você antes da queda do socket, portanto um intervalo de catch-up pode incluir algumas que você já aplicou. O SDK descarta qualquer mensagem com sequência igual ou inferior à que já foi entregue, garantindo que os handlers nunca recebam uma mensagem duas vezes.

Suas próprias mensagens **não** são filtradas em um replay: uma reconexão atribui um novo id de cliente, justamente no cenário para o qual o catch-up existe e onde esse filtro falharia. Torne as operações idempotentes caso reaplicar as suas próprias mensagens seja um problema.
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

O SDK mantém a lista de presença para você, portanto `presences` está sempre completo e você nunca precisa reconstruí-lo a partir de diffs.

Ele também lida com dois detalhes de protocolo fáceis de errar ao trabalhar diretamente com o WebSocket puro:

- **A lista de presença não é enviada no join.** O primeiro `presence_diff` de um cliente que entra contém apenas a si mesmo; a lista existente deve ser solicitada explicitamente. O `join()` faz isso para você.
- **A presença expira após 30 segundos.** `track()` não é um registro permanente — sem um reenvio periódico, você desaparece silenciosamente da lista de presença de todos os outros, mesmo ainda conectado e na página. O SDK envia heartbeats a cada 20s e para no `untrack()` / `leave()`.

Uma reconexão também descarta o pertencimento ao canal e a presença no lado do servidor; o SDK faz o re-join, solicita novamente a lista de presença e refaz o rastreamento automaticamente.

## Quando Usar Tempo Real

| Caso de Uso | Método |
|-------------|--------|
| Dashboard com dados em tempo real | `listen()` com filtros |
| Chat ou mensagens | `channel.broadcast()` |
| Edição colaborativa / fluxos de operações | `channel(name, { history: true })` |
| Indicadores de digitação / status online | `channel.track()` + `channel.onPresence()` |
| Página de detalhes com atualizações em tempo real | `listenById()` |
| Monitoramento em painel administrativo | `listen()` com `orderBy` e `limit` |
| Uma lista que precisa sobreviver a uma conexão perdida | `observe()` com [offline](/docs/sdk/offline) habilitado |

> **Dica:** Para buscas pontuais de dados, use `find()` ou `findById()`. As subscrições são mais indicadas para dados que mudam frequentemente e precisam ser refletidos na interface imediatamente.

## `listen()` vs `observe()`

Ambos mantêm uma consulta atualizada e ambos retornam uma função de cancelamento de subscrição — mas respondem a necessidades diferentes.

`listen()` é o socket: ele entrega o que o servidor envia e não entrega nada quando o socket está inativo.

`observe()` é a consulta: com o modo [offline](/docs/sdk/offline) habilitado, ele emite primeiro a partir do banco de dados local — antes de qualquer requisição — e emite novamente em escritas locais, em escritas na fila que alcançam o servidor, em rollbacks e em eventos em tempo real, nos quais ele próprio se inscreve, a menos que você passe `{ realtime: false }`. Cada resultado informa se veio do cache e se carrega escritas que o servidor ainda não aceitou.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sem o modo offline habilitado, `observe()` é equivalente a `find()` mais `listen()` em uma única chamada, com essas flags sempre `false`.

## Próximos Passos

- **[Querying Data](/docs/sdk/querying)** — Operações CRUD e query builder
- **[Offline & Local-First Sync](/docs/sdk/offline)** — Consultas em tempo real que sobrevivem a uma conexão perdida
- **[Authentication](/docs/sdk/authentication)** — Login e gerenciamento de sessão
- **[Realtime Backend](/docs/backend/realtime)** — Configuração do WebSocket no lado do servidor

---
