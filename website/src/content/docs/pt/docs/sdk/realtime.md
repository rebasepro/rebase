---
sourceHash: 40fb3fc8ab6a79a5
title: Inscrições em Tempo Real
sidebar_label: Realtime
description: Inscreva-se para receber alterações de dados ao vivo com o SDK tipado do Rebase usando listeners em tempo real baseados em WebSocket.
---

## Visão Geral

O SDK tipado do Rebase oferece inscrições de dados em tempo real via WebSocket. Quando os registros são alterados no servidor, seus callbacks inscritos são disparados imediatamente com os dados atualizados.

A conexão WebSocket é estabelecida automaticamente quando uma `websocketUrl` está disponível (derivada de `baseUrl` por padrão). A reconexão e a atualização de token (token refresh) são gerenciadas para você. Uma interrupção que dure mais de cerca de 15 segundos é reportada uma vez, para o `onError` de cada inscrição, como `CONNECTION_LOST` — veja [Autenticação e Reconexão](#autenticação-e-reconexão).

## Inscrevendo-se em uma Coleção

Use `listen()` para se inscrever em uma consulta de coleção. O callback é disparado sempre que o conjunto de dados correspondente é alterado:

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

O método `listen()` aceita os mesmos `FindParams` que `find()` — você pode filtrar, ordenar e paginar sua inscrição:

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

`FindResult<M>` possui o mesmo formato retornado por `find()`: linhas planas em `data` e `{ total, limit, offset, hasMore, nextCursor }` em `meta`.

### `listen()` aceita o que `find()` aceita

`params` é um `FindParams` completo. Uma inscrição é a mesma consulta que o `find()` correspondente, portanto, aceita o mesmo afunilamento de busca — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** e **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Isso é mais importante do que parece. Anteriormente, `include` e `fields` eram descartados silenciosamente aqui, fazendo com que a mesma consulta respondesse em um formato através de `find()` e em outro através de `listen()` — e um componente que renderizasse ambos via a estrutura de suas linhas mudar no momento em que uma gravação ocorria. Agora eles passam pelo mesmo pipeline de leitura, portanto, `find({ q })` e `listen({ q })` retornam linhas que são idênticas campo por campo.

A exceção é `vectorSearch`, que é **recusado** em vez de descartado: uma inscrição é executada novamente a cada gravação correspondente e nada ali calcula distâncias. Use `.vectorSearch(…).find()` para a consulta e inscreva-se sem ele.

### Uma emissão por alteração

Cada push do servidor chama seu callback **uma vez**, com metadados que descrevem as linhas ao lado dele. Não há uma emissão separada de primeira renderização (first-paint) e nenhuma flag para verificar.

Os metadados chegam **no mesmo frame que as linhas**: o servidor realiza a contagem da consulta dentro da mesma transação vinculada a Row-Level Security que as leu, portanto, `meta.total`, `meta.hasMore` e `meta.nextCursor` descrevem exatamente as linhas ao lado deles. (Anteriormente, todo push era seguido por um `GET /count` do cliente — um round trip adicional por gravação, por assinante, e uma janela na qual a contagem e as linhas descreviam estados diferentes da coleção.)

Dois fallbacks, nenhum deles sendo um erro de inscrição e nenhum chamando `onError`:

- Se a **contagem do servidor falhar**, o frame não trará nenhum total e o último que chegou será reutilizado. Uma contagem com falha não diz nada sobre o tamanho da coleção, portanto não deve sobrescrever uma resposta real.
- Se nenhum total jamais tiver chegado para esta inscrição — um servidor mais antigo que não envia nenhum metadado — o cliente solicita uma vez, no primeiro push. Se isso também falhar, `meta.total` é um **limite inferior (lower bound)**: as linhas nesta página mais as que foram paginadas anteriormente para alcançá-las.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Inscrevendo-se em uma Única Entidade

Use `listenById()` para monitorar um registro específico pelo seu ID:

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
    onError?: (error: Error) => void,
    options?: { include?: IncludeSpec }
): () => void   // returns unsubscribe function
```

O callback recebe uma linha plana — não uma `Entity`, portanto não há `.values` — e `undefined` quando o registro é excluído.

Cada frame carrega os relacionamentos nomeados em `options.include`, carregados da mesma forma que `find({ include })` os carrega em cada linha de uma lista. Um relacionamento to-many não nomeado ali estará ausente da linha, não vazio:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limites.** Um frame é enviado quando a própria linha muda, e cada frame recarrega seus relacionamentos incluídos. Uma alteração apenas em uma linha relacionada não envia nenhum frame: editar o nome de uma tag não atualiza um post monitorado com `include: ["tags"]` até que o post também seja alterado. Para acompanhar as linhas relacionadas, monitore a coleção delas também.

## Monitorando uma Contagem

`listenCount()` mantém uma contagem atualizada: o total do que o filtro de uma lista corresponde, para uma barra de ferramentas ou uma opção de "selecionar todos os N" que não deve ficar desatualizada enquanto outras pessoas adicionam e removem linhas. O callback é executado com o total assim que ele é conhecido, e novamente sempre que uma gravação o alterar.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Apenas o filtro conta — `where`, `logical` e `searchString`; um `limit`, um `offset` ou uma ordenação são ignorados. O servidor não lê nenhuma linha para isso, apenas a contagem, sob a identidade do assinante como qualquer outro frame. Um servidor anterior à versão 0.25 não reconhece a requisição; ela é respondida com uma linha e o mesmo total, e o SDK lê o total a partir disso. Em um cliente sem socket, `listenCount()` é um stub que lança um erro, assim como o `listen()`. Com o [suporte offline](/docs/sdk/offline/) ativado, a contagem é a do servidor: gravações na fila não são incluídas nela até serem reproduzidas (replayed).

## Fluent Query Builder

Você também pode se inscrever através do construtor de consultas fluente (fluent query builder). Isso é equivalente a chamar `listen()` com parâmetros, mas permite encadear `.where()`, `.orderBy()`, etc.:

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

Uma inscrição aceita ordenação por múltiplas colunas como qualquer outra consulta — seja com `orderBy: [["category", "asc"], ["createdAt", "desc"]]` nos parâmetros, ou uma segunda chamada a `.orderBy()`, que adiciona um critério de desempate em vez de substituir o primeiro. Veja [Ordenação](/docs/sdk/querying#sorting).

O servidor verifica o *formato* do `orderBy` de uma inscrição na chegada e recusa formatos malformados com um frame de erro em vez de se inscrever. Caso contrário, uma ordenação que ele não pudesse ler transmitiria linhas sem nenhuma ordem, sem reportar nenhum problema — e um frame `collection_update` carrega linhas e nada mais, de modo que o assinante não teria como notar.

## Cancelando a Inscrição

Toda inscrição retorna uma função `unsubscribe`. Chame-a para parar de receber atualizações e limpar o listener do WebSocket:

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

- No **login (sign-in)** ou na **atualização do token (token refresh)**, um socket já aberto assume a nova credencial. Uma atualização, ou um login na mesma conta já conectada, envia o token em uma mensagem `authenticate`; um login com uma conta diferente — incluindo um visitante fazendo login — reconstrói o socket, que se autentica como aquela conta e reenvia todas as inscrições e canais ativos. Se nenhum estiver aberto, nada acontece — fazer login não é uma requisição para realtime, e um socket aberto posteriormente se autentica sozinho.
- No **logout (sign-out)**, a conexão WebSocket é desconectada. O cliente continua utilizável; uma inscrição posterior se reconecta anonimamente.
- Se a conexão cair, o cliente **se reconecta automaticamente** e restabelece todas as inscrições ativas. Ele nunca para de tentar enquanto existir uma inscrição ou um canal conectado; o intervalo entre as tentativas aumenta para no máximo 30 segundos.
- Se o servidor encerrar a sessão do socket — o usuário fez logout em todos os lugares, esta sessão foi revogada, a conta foi excluída ou o token expirou antes que a atualização chegasse ao socket — ele fechará o socket com o código `4001`. O cliente se reconecta como após qualquer queda, autenticando-se com a sessão que possui naquele momento (atualizada, se possível), ou anonimamente quando não houver nenhuma. A remoção de uma role não fecha o socket: ela se aplica a partir do próximo frame. Veja [Autenticação e RLS](/docs/backend/realtime/#authentication--rls).
- Se a conexão permanecer inativa por mais de cerca de 15 segundos, o `onError` de cada inscrição (e o `onError` de cada canal conectado) é chamado **uma vez** com um `RebaseApiError` cujo `code` é `CONNECTION_LOST`. A inscrição não é finalizada: continue exibindo o que você tem, marque os dados como possivelmente desatualizados e aguarde. Quando o socket retornar, o próximo `onUpdate` da inscrição trará tudo o que foi gravado nesse intervalo.
- `client.ws.state` é o estado da conexão — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` ou `closed` — e `client.ws.onStateChange(listener)` é notificado a cada alteração. `disconnected` é o estado no qual `CONNECTION_LOST` foi reportado.
- As requisições enviadas pelo socket são **at-most-once** (no máximo uma vez). Uma requisição enviada quando a conexão caiu falha com `CONNECTION_LOST` e nunca é enviada novamente, pois o servidor já pode tê-la executado. Uma requisição que ainda está aguardando por um socket após 30 segundos falha com `REQUEST_TIMEOUT` sem ser enviada.

Tudo na lista após o logout chegou na versão 0.24.

```typescript
import { RebaseApiError } from "@rebasepro/client";

const unsubscribe = client.data.orders.listen(
    { where: { status: ["==", "open"] } },
    (response) => {
        setOrders(response.data);
        setStale(false);
    },
    (error) => {
        if (error instanceof RebaseApiError && error.code === "CONNECTION_LOST") {
            setStale(true); // keep the rows; the next update clears it
            return;
        }
        setError(error);
    }
);
```

### Qual token o socket envia

O socket se autentica com o mesmo token que uma requisição HTTP transportaria. Esse é, primeiramente, o getter instalado com `client.setAuthTokenGetter()`; quando não houver nenhum, ou se ele retornar `null` ou lançar um erro, será o token que o cliente possui: o de sua sessão, um definido com `client.setToken()`, ou a opção `token`. Com o `client.auth` integrado, não há nada a configurar.

Para um provedor de autenticação externo (Clerk, Firebase Auth, uma sessão própria), instale o getter uma vez. Ele cobre tanto o HTTP quanto o socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` responde a um token recusado em ambos: um 401 via HTTP e um erro de autenticação no socket. Resolva com `true` para tentar novamente com o token resolvido de novo. Isso substitui a atualização de sessão padrão do cliente.
- Instalar um getter ou chamar `client.setToken()` reconstrói um socket aberto: o novo socket se autentica com a nova credencial e reenvia todas as inscrições e canais ativos como essa identidade, e nada que a identidade anterior possuía é mantido. Sem nenhum socket aberto, o próximo se autenticará sozinho.
- `client.ws.setAuthTokenGetter()` está obsoleto (deprecated). Ele ainda funciona, substituindo apenas o getter do socket, e emite um aviso uma vez. Use `client.setAuthTokenGetter()`.

Veja [Seu Próprio Provedor de Autenticação](/docs/sdk/your-own-auth-provider/).

### A conexão é lazy

A criação de um cliente **não** abre nenhum WebSocket. A conexão é iniciada na primeira operação que realmente precisa de uma — uma inscrição com `listen()` / `listenById()`, ou uma operação de canal como `join()`, `track()` ou `broadcast()`. Obter um canal não significa usá-lo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Isso é importante para aplicativos com tráfego relevante de usuários não autenticados — páginas de marketing, visualizações públicas somente leitura, ferramentas de acesso anônimo inicial — que antes pagavam o custo de uma conexão a cada carregamento de página simplesmente para disponibilizar recursos em tempo real.

Dois comportamentos relacionados:

- `realtime: false` continua sendo uma desativação explícita rígida: nenhum socket nunca é aberto, e `client.realtime.channel()` lança um erro. O mesmo vale para `listen()` e `listenById()` — eles estão sempre disponíveis para chamada, e em um cliente sem socket eles lançam um `RebaseClientError` indicando a opção necessária para habilitá-los. O `observe()` não lança erro: ele degrada para uma única busca (fetch).
- `client.close()` é definitivo. Ele libera o socket e seu timer de reconexão, e nada enfileirado posteriormente fará uma nova discagem (redial). No Node, um socket aberto mantém o event loop ativo, portanto, um script que nunca o chame não será encerrado sozinho.

### Mantendo um grupo na mesma instância

Com mais de uma instância de servidor, os membros de um canal podem cair em instâncias diferentes, e cada mensagem entre eles passa a [atravessar o barramento do canal](/docs/backend/realtime-transports/#channels-and-presence-across-instances). O parâmetro `affinity` nomeia o grupo ao qual um socket pertence, como uma sala ou um documento, para que a plataforma possa direcionar o grupo inteiro para a mesma instância:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Quando a chave só for conhecida posteriormente, defina-a antes que o socket seja aberto:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

A chave vai no endereço do socket como `?affinity=`, e substitui qualquer uma já presente na `websocketUrl` configurada. `setAffinity(null)` a remove.

- **É uma otimização.** O Rebase Cloud faz o roteamento com base nela quando um projeto executa mais de uma instância. Em ambientes self-hosted ou atrás de um proxy que não utilize esse hash, ela não faz nada, e os canais funcionam da mesma forma: o barramento continua transportando tudo o que abrange várias instâncias, inclusive um grupo dividido por um escalonamento (scale-up).
- **Entra em vigor quando o socket se conecta.** Um socket já aberto permanece onde está e usa a nova chave na próxima vez que se conectar. Para mover um cliente que está conectado, crie um novo ou defina a chave antes de seu primeiro `join()` ou `listen()`.
- **Ela decide onde o socket se conecta, não o que ele pode acessar.** O acesso a um canal não depende dela, e o endereço acaba registrado nos logs de acesso, portanto, use um código em vez de um segredo ou qualquer dado pessoal.

Para ver se está funcionando, compare o que cada instância publica e ignora: consulte [Vendo o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

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

Os canais são leves e efêmeros — eles existem enquanto pelo menos um cliente estiver inscrito. Chamadas repetidas a `channel()` com o mesmo nome retornam o **mesmo** objeto, de modo que dois componentes podem anexar handlers de forma independente sem que um desconecte o outro ao sair.

Frames de canal e de presença não exigem uma conta: visitantes anônimos podem entrar em canais públicos.

:::caution[Os canais ainda não possuem regras de acesso]
A única verificação que o servidor aplica é o **pertencimento (membership)**: para transmitir (broadcast) em um canal, ler sua lista de presença ou reproduzir seu histórico, o cliente deve ter entrado nesse canal primeiro. A entrada em si é aberta — qualquer cliente que saiba o nome de um canal pode entrar nele, esteja autenticado ou não.

Portanto, o nome de um canal não é um segredo nem uma permissão. Não coloque nada em um canal (incluindo histórico retido e estado de presença) que nem todos os usuários do seu aplicativo possam ver, e não derive o nome de um canal a partir de dados que você não compartilharia publicamente. Regras de autorização por canal ainda não estão implementadas; se você precisar delas hoje, mantenha a parte sensível da troca em `client.data`, onde a segurança em nível de linha (row-level security) é aplicada.
:::

> **Por padrão, broadcasts não são reproduzidos.** Eles chegam apenas aos membros atualmente conectados. Isso é o ideal para notificações auto-corretivas — um aviso de "alguém salvou" é substituído pelo próximo salvamento — e não tem custo adicional. Para um fluxo de operações, onde uma lacuna silenciosa causa divergência, ative o [histórico de mensagens](#histórico-de-mensagens-e-atualização-catch-up) no canal.

## Histórico de Mensagens e Atualização (Catch-Up)

Um canal pode ser configurado para manter seus broadcasts, de modo que um cliente reconectado se atualize sobre o que perdeu em vez de ressincronizar do zero. Isso é o que torna os canais utilizáveis como transporte para edição colaborativa.

A retenção é configurada **no servidor**, por padrão de canal — consulte [Backend Realtime](/docs/backend/realtime#channel-retention). Um cliente não pode ativá-la por conta própria, pois um canal é criado por quem o nomeia, e uma profundidade de histórico escolhida pelo cliente permitiria a qualquer visitante comprometer seu backend com armazenamento ilimitado.

Em um canal com retenção, passe `{ history: true }` e o SDK cuidará do restante:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

No `join()` e após cada reconexão, o SDK solicita ao servidor tudo o que ocorreu após o último número de sequência visto e entrega o resultado através dos mesmos handlers. Não há necessidade de escrever um segundo fluxo de código: um handler que aplica uma operação corretamente em tempo real a aplicará corretamente no catch-up.

### Números de sequência

Todo broadcast em um canal com retenção carrega um `seq` — por canal, contínuo e incremental. Esse é o ponto de retomada do cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persista `channel.sequence` se desejar que a atualização sobreviva tanto a um recarregamento de página quanto a uma reconexão, e passe-o de volta via `history({ sinceSeq })`.

### Buscando o histórico explicitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que o canal não mantém histórico e nunca manterá — uma resposta explícita, para que você possa diferenciar "você não perdeu nada" de "este canal não possui regra de retenção". No segundo caso, um cliente que precise convergir precisará recorrer a uma ressincronização completa.

`latestSeq` é a maior sequência mantida pelo servidor, independentemente de este lote tê-la alcançado ou não. Se ela estiver muito além do seu último `seq` entregue, você está mais atrasado do que uma única página, e ressincronizar pode ser mais vantajoso do que paginar.

:::note[As reproduções podem se sobrepor, e tudo bem]
O servidor não tem como saber exatamente quais mensagens chegaram até você antes de o socket cair, portanto, o intervalo de catch-up pode incluir algumas que você já aplicou. O SDK descarta qualquer item igual ou inferior à sequência já entregue, garantindo que os handlers nunca vejam a mesma mensagem duas vezes.

Suas próprias mensagens são filtradas da reprodução, assim como ocorre em tempo real, incluindo aquelas enviadas antes que uma reconexão atribuísse um novo ID de cliente ao socket: o canal se lembra dos IDs a partir dos quais fez broadcast. Um novo objeto de canal — por exemplo, após um recarregamento de página — não se lembra de nenhum, portanto, a atualização ali entregará suas mensagens anteriores como as de qualquer outro usuário, o que é exatamente o necessário para reconstruir o estado a partir do histórico.
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

O SDK mantém a lista para você, de forma que `presences` esteja sempre completa e você nunca precise remontá-la a partir de diffs.

Ele também gerencia dois detalhes de protocolo fáceis de errar ao trabalhar diretamente com o WebSocket bruto:

- **A lista não é enviada no join.** O primeiro `presence_diff` de um cliente que acabou de entrar contém apenas ele mesmo; a lista existente deve ser solicitada explicitamente. O `join()` faz isso para você.
- **A presença expira após 30 segundos.** O `track()` não é um registro durável — sem um reenvio periódico, você desaparece silenciosamente da lista de todos os outros, mesmo ainda conectado e na página. O SDK envia heartbeats a cada 20 segundos e para no `untrack()` / `leave()`.

Uma reconexão também descarta o pertencimento ao canal e a presença no lado do servidor; o SDK faz um novo join, solicita novamente a lista e reenvia o rastreamento automaticamente.

## Quando Usar Realtime

| Caso de Uso | Método |
|-------------|--------|
| Painel (Dashboard) com dados ao vivo | `listen()` com filtros |
| Chat ou mensagens | `channel.broadcast()` |
| Edição colaborativa / fluxos de operações | `channel(name, { history: true })` |
| Indicadores de digitação / status online | `channel.track()` + `channel.onPresence()` |
| Página de detalhes com atualizações ao vivo | `listenById()` |
| Monitoramento de painel administrativo | `listen()` com `orderBy` e `limit` |
| Uma lista que deve resistir a uma conexão perdida | `observe()` com [offline](/docs/sdk/offline) habilitado |

> **Dica:** Para buscas pontuais de dados, use `find()` ou `findById()`. As inscrições são mais indicadas para dados que mudam frequentemente e precisam ser refletidos na interface imediatamente.

## `listen()` vs `observe()`

Ambos mantêm uma consulta atualizada e ambos retornam uma função de cancelamento de inscrição (unsubscribe) — mas respondem a necessidades diferentes.

`listen()` é o socket: ele entrega o que o servidor envia via push e não entrega nada quando o socket está inativo.

`observe()` é a consulta: com o [offline](/docs/sdk/offline) ativado, ele emite a partir do banco de dados local primeiro — antes de qualquer requisição — e reemite em gravações locais, em gravações na fila que alcançam o servidor, em rollbacks e em eventos de realtime, nos quais ele próprio se inscreve, a menos que você passe `{ realtime: false }`. Cada resultado informa se veio do cache e se traz gravações que o servidor ainda não aceitou.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sem o suporte offline ativado, `observe()` é equivalente a `find()` mais `listen()` em uma única chamada, com essas flags sempre como `false`.

## Próximos Passos

- **[Consultando Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Sincronização Offline e Local-First](/docs/sdk/offline)** — Consultas ao vivo que sobrevivem a uma conexão perdida
- **[Autenticação](/docs/sdk/authentication)** — Login e gerenciamento de sessão
- **[Backend Realtime](/docs/backend/realtime)** — Configuração de WebSocket no lado do servidor
