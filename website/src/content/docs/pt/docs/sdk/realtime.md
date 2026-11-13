---
sourceHash: eb117d132ea516de
title: Inscrições em Tempo Real
sidebar_label: Tempo Real
description: Inscreva-se em alterações de dados em tempo real com o SDK tipado do Rebase usando listeners em tempo real baseados em WebSocket.
---

## Visão Geral

O SDK tipado do Rebase fornece inscrições de dados em tempo real via WebSocket. Quando registros são alterados no servidor, seus callbacks inscritos são acionados imediatamente com os dados atualizados.

A conexão WebSocket é estabelecida automaticamente quando uma `websocketUrl` está disponível (derivada de `baseUrl` por padrão). A reconexão e a atualização de token são gerenciadas para você. Uma interrupção que dure mais de cerca de 15 segundos é reportada uma vez, para o `onError` de cada inscrição, como `CONNECTION_LOST` — veja [Autenticação e Reconexão](#autenticação-e-reconexão).

## Inscrevendo-se em uma Tabela

Use `listen()` para se inscrever em uma consulta de tabela. O callback é acionado sempre que o conjunto de dados correspondente for alterado:

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

`FindResult<M>` tem a mesma estrutura retornada por `find()`: registros simples em `data`, e
`{ total, limit, offset, hasMore, nextCursor }` em `meta`.

### `listen()` aceita o que `find()` aceita

`params` é um `FindParams` completo. Uma inscrição é a mesma consulta que o
`find()` correspondente, portanto ela aceita as mesmas restrições — `where`, `logical`,
`orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** e
**`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Isso importa mais do que parece. `include` e `fields` costumavam ser silenciosamente
descartados aqui, de modo que a mesma consulta respondia com uma estrutura através de `find()` e
outra através de `listen()` — e um componente renderizando ambos via suas linhas mudarem de
formato no momento em que uma escrita ocorria. Agora eles passam pelo mesmo
pipeline de leitura, então `find({ q })` e `listen({ q })` retornam linhas com os mesmos
campos campo a campo.

A exceção é `vectorSearch`, que é **recusado** em vez de descartado: uma
inscrição é executada novamente a cada escrita correspondente e nada ali calcula
distâncias. Use `.vectorSearch(…).find()` para a consulta e inscreva-se sem ele.

### Uma emissão por alteração

Cada push do servidor chama seu callback **uma vez**, com metadados que descrevem as
linhas ao lado dele. Não há emissão separada para a renderização inicial e nenhuma flag para checar.

Os metadados chegam **no mesmo frame que as linhas**: o servidor faz a contagem da
consulta dentro da mesma transação vinculada à segurança em nível de linha que as leu, de
modo que `meta.total`, `meta.hasMore` e `meta.nextCursor` descrevem exatamente as linhas
ao lado deles. (Cada push costumava ser seguido por um `GET /count` do cliente
— um round trip extra por escrita, por assinante, e uma janela na qual a
contagem e as linhas descreviam estados diferentes da tabela.)

Dois fallbacks, nenhum deles sendo um erro de inscrição e nenhum chamando
`onError`:

- Se a **contagem do servidor falhar**, o frame não traz nenhum total e o último
  que chegou é reutilizado. Uma contagem que falhou não diz nada sobre o tamanho da
  tabela, portanto não deve sobrescrever uma resposta real.
- Se nenhum total tiver chegado para esta inscrição — um servidor mais antigo que
  não envia nenhum metadado —, o cliente pergunta uma vez, no primeiro push. Se isso
  também falhar, `meta.total` é um **limite inferior**: as linhas nesta página mais as
  que foram paginadas anteriormente para alcançá-las.

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

Use `listenById()` para observar um registro específico pelo seu ID:

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .table<{ id: number; name: string }>("products")
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

O callback recebe uma linha simples — não uma `Entity`, portanto não há `.values` —
e `undefined` quando o registro é excluído.

Cada frame carrega os relacionamentos nomeados em `options.include`, carregados como o `find({ include })`
os carrega em cada linha de uma lista. Uma relação to-many não nomeada ali estará ausente
da linha, não vazia:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limites.** Um frame é enviado quando a própria linha é alterada, e cada frame recarrega seus
relacionamentos incluídos. Uma alteração apenas em uma linha relacionada não envia frame: editar o
nome de uma tag não atualiza um post escutado com `include: ["tags"]` até que o post seja alterado também.
Para acompanhar as linhas relacionadas, escute a tabela delas também.

## Observando uma Contagem

`listenCount()` mantém uma contagem atualizada: o total do que o filtro de uma lista corresponde, para uma
barra de ferramentas ou uma opção de "selecionar todos os N" que não deve ficar desatualizada enquanto outras pessoas adicionam e removem linhas.
O callback é executado com o total assim que for conhecido, e novamente sempre que uma escrita o alterar.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Apenas o filtro conta — `where`, `logical` e `searchString`; `limit`, `offset` ou ordenação são
ignorados. O servidor não lê nenhuma linha para isso, apenas a contagem, sob a identidade do assinante como qualquer
outro frame. Um servidor anterior à versão 0.25 não reconhece a requisição; ela é respondida com uma linha e o
mesmo total, e o SDK lê o total a partir disso. Em um cliente sem socket, `listenCount()` é um
stub que lança um erro, assim como o `listen()`. Com o [suporte offline](/docs/sdk/offline/) ativado, a contagem é a do
servidor: escritas em fila não entram nela até serem reproduzidas.

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

Uma inscrição aceita ordenação por múltiplas colunas como qualquer outra consulta — seja
`orderBy: [["category", "asc"], ["createdAt", "desc"]]` nos parâmetros, ou uma
segunda chamada `.orderBy()`, que adiciona um desempate em vez de substituir a
primeira. Veja [Ordenação](/docs/sdk/querying#sorting).

O servidor verifica o *formato* do `orderBy` de uma inscrição ao recebê-lo e
recusa um formato malformado com um frame de erro em vez de se inscrever. Caso contrário,
uma ordenação ilegível transmitiria linhas sem ordem alguma sem reportar
nenhum erro — e um frame `collection_update` carrega linhas e nada mais,
de modo que o assinante não teria como notar.

## Cancelando a Inscrição

Cada inscrição retorna uma função `unsubscribe`. Chame-a para parar de receber atualizações e limpar o listener do WebSocket:

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

- No **login** ou **atualização de token**, um socket já aberto assume a nova credencial. Uma atualização, ou um login na mesma conta já conectada, envia o token em uma mensagem `authenticate`; um login em uma conta diferente — incluindo um visitante fazendo login — reconstrói o socket, que se autentica como aquela conta e reenvia todas as inscrições e canais ativos. Se nenhum estiver aberto, nada acontece — fazer login não é uma solicitação de tempo real, e um socket aberto posteriormente se autentica sozinho.
- No **logout**, a conexão WebSocket é desconectada. O cliente continua utilizável; uma inscrição posterior reconecta anonimamente.
- Se a conexão cair, o cliente **reconecta automaticamente** e restabelece todas as inscrições ativas. Ele nunca para de tentar enquanto existir uma inscrição ou um canal conectado; o intervalo entre as tentativas aumenta para no máximo 30 segundos.
- Se o servidor encerrar a sessão do socket — o usuário fez logout em todos os lugares, esta sessão foi revogada, a conta foi excluída ou o token expirou antes de uma atualização atingir o socket —, ele fecha o socket com o código `4001`. O cliente reconecta como em qualquer queda, autenticando-se com a sessão que possui no momento (atualizada, se possível) ou anonimamente quando não houver nenhuma. A remoção de uma role não fecha o socket: ela se aplica a partir do próximo frame. Veja [Autenticação e RLS](/docs/backend/realtime/#authentication--rls).
- Se a conexão permanecer inativa por mais de cerca de 15 segundos, o `onError` de cada inscrição (e o `onError` de cada canal conectado) é chamado **uma vez** com um `RebaseApiError` cujo `code` é `CONNECTION_LOST`. A inscrição não é encerrada: continue exibindo o que você tem, marque como possivelmente desatualizado e aguarde. Quando o socket retornar, o próximo `onUpdate` da inscrição trará tudo o que foi gravado nesse intervalo.
- `client.ws.state` é o estado da conexão — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` ou `closed` — e `client.ws.onStateChange(listener)` é notificado a cada alteração. `disconnected` é o estado no qual `CONNECTION_LOST` foi reportado.
- Requisições enviadas pelo socket são do tipo **at-most-once**. Uma requisição enviada no momento em que a conexão caiu falha com `CONNECTION_LOST` e nunca é reenviada, já que o servidor pode já tê-la executado. Uma que ainda esteja aguardando por um socket após 30 segundos falha com `REQUEST_TIMEOUT` sem ser enviada.

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

O socket se autentica com o mesmo token que uma requisição HTTP transportaria. Esse
é primeiramente o getter instalado com `client.setAuthTokenGetter()`; quando não houver
nenhum, ou se ele responder `null` ou lançar um erro, é o token que o cliente mantém: o de
sua sessão, um definido com `client.setToken()` ou a opção `token`. Com o
`client.auth` integrado, não há nada a configurar.

Para um provedor de autenticação externo (Clerk, Firebase Auth, uma sessão própria),
instale o getter uma vez. Ele cobre tanto HTTP quanto o socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` responde a um token recusado em ambos: um 401
  via HTTP e um erro de autenticação no socket. Resolva com `true` para tentar novamente com o
  token resolvido de novo. Isso substitui a própria atualização de sessão do cliente.
- Instalar um getter, ou chamar `client.setToken()`, reconstrói um socket aberto:
  o novo socket se autentica com a nova credencial e reenvia cada inscrição
  e canal ativo como ela, e nada do que a identidade anterior continha
  é transferido. Sem nenhum socket aberto, o próximo se autentica sozinho.
- `client.ws.setAuthTokenGetter()` foi descontinuado. Ele ainda funciona, substituindo
  apenas o getter do socket, e emite um aviso uma vez. Use `client.setAuthTokenGetter()`.

Veja [Seu Próprio Provedor de Autenticação](/docs/sdk/your-own-auth-provider/).

### A conexão é lazy

Criar um cliente **não** abre um WebSocket. Ele é conectado na primeira operação que realmente precisa de um — uma inscrição `listen()` / `listenById()`, ou uma operação de canal como `join()`, `track()` ou `broadcast()`. Obter um canal não significa usá-lo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Isso é importante para aplicativos com tráfego relevante de usuários deslogados — páginas de marketing, visualizações públicas somente leitura, ferramentas anônimas por padrão —, que anteriormente pagavam o custo de uma conexão em cada carregamento de página simplesmente para ter tempo real disponível.

Dois comportamentos relacionados:

- `realtime: false` continua sendo uma desativação explícita: nenhum socket jamais é aberto, e `client.realtime.channel()` lança um erro. O mesmo ocorre com `listen()` e `listenById()` — eles estão sempre disponíveis para chamada, e em um cliente sem socket eles lançam um `RebaseClientError` indicando a opção que os habilitaria. `observe()` não faz isso: ele se degrada para uma única busca (fetch).
- `client.close()` é definitivo. Ele libera o socket e seu temporizador de reconexão, e nada enfileirado posteriormente tentará reconectar. No Node, um socket aberto mantém o event loop ativo, de modo que um script que nunca o chame não será encerrado por conta própria.

### Mantendo um grupo na mesma instância

Com mais de uma instância de servidor, os membros de um canal podem parar em instâncias diferentes, e cada mensagem entre eles então [atravessa o barramento do canal](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` nomeia o grupo ao qual um socket pertence, como uma sala ou um documento, para que a plataforma possa enviar todo o grupo para a mesma instância:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Quando a chave só for conhecida mais tarde, defina-a antes que o socket seja aberto:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

A chave vai no endereço do socket como `?affinity=`, e substitui qualquer uma que já esteja em uma `websocketUrl` configurada. `setAffinity(null)` a remove.

- **É uma otimização.** O Rebase Cloud faz o roteamento com base nela quando um projeto executa mais de uma instância. Em ambientes auto-hospedados ou atrás de um proxy que não calcula hash com base nela, ela não faz nada, e os canais funcionam da mesma forma: o barramento ainda transmite tudo o que abranger múltiplas instâncias, incluindo um grupo dividido por uma escala horizontal.
- **Entra em vigor quando o socket se conecta.** Um socket já aberto permanece onde está e usa a nova chave na próxima vez que se conectar. Para mover um cliente que está conectado, crie um novo ou defina a chave antes de seu primeiro `join()` ou `listen()`.
- **Decide onde um socket se conecta, não o que ele pode acessar.** O acesso a um canal não depende disso, e o endereço acaba ficando nos logs de acesso, portanto use um código em vez de um segredo ou qualquer informação pessoal.

Para verificar se está funcionando, compare o que cada instância publica e ignora: veja [Vendo o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

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

Os canais são leves e efêmeros — eles existem enquanto pelo menos um cliente estiver inscrito. Chamadas repetidas a `channel()` com o mesmo nome retornam o **mesmo** objeto, permitindo que dois componentes adicionem handlers de forma independente sem que um desconecte o outro ao sair.

Frames de canal e presença não exigem uma conta: visitantes anônimos podem entrar em canais públicos.

:::caution[Os canais ainda não têm regras de acesso]
A única verificação que o servidor aplica é o **pertencimento**: para transmitir em um canal, ler sua lista de presença ou reproduzir seu histórico, o cliente deve ter entrado nesse canal primeiro. O ato de entrar em si é livre — qualquer cliente que saiba o nome de um canal pode entrar nele, esteja logado ou não.

Portanto, o nome de um canal não é um segredo e não é uma permissão. Não coloque nada em um canal (incluindo histórico retido e estado de presença) que qualquer usuário do seu aplicativo não possa ver, e não derive o nome de um canal a partir de dados que você não divulgaria abertamente. Regras de autorização por canal não estão implementadas; se você precisar delas hoje, mantenha a parte sensível da troca em `client.data`, onde a segurança em nível de linha se aplica.
:::

> **Por padrão, transmissões de broadcast não são reproduzidas.** Elas alcançam apenas os membros conectados no momento. Isso é exatamente o que você deseja para notificações auto-corretivas — um aviso de "alguém salvou" é substituído pelo próximo salvamento — e tem custo zero. Para um fluxo de operações, onde uma lacuna silenciosa causa divergência, ative o [histórico de mensagens](#histórico-de-mensagens-e-catch-up) no canal.

## Histórico de Mensagens e Catch-Up

Um canal pode ser configurado para reter suas transmissões, para que um cliente que se reconecte recupere o que perdeu em vez de ressincronizar do zero. É isso que torna os canais viáveis como transporte para edição colaborativa.

A retenção é configurada **no servidor**, por padrão de canal — veja [Backend em Tempo Real](/docs/backend/realtime#channel-retention). Um cliente não pode ativá-la por conta própria, pois um canal é criado por quem o nomeia, e uma profundidade de histórico escolhida pelo cliente permitiria que qualquer visitante sobrecarregasse seu backend com armazenamento ilimitado.

Em um canal com retenção, passe `{ history: true }` e o SDK faz o resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

No `join()` e após cada reconexão, o SDK solicita ao servidor tudo após o último número de sequência visto e entrega o resultado através dos mesmos handlers. Não há um segundo fluxo de código para escrever: um handler que aplica uma operação corretamente em tempo real a aplica corretamente no catch-up.

### Números de sequência

Cada broadcast em um canal com retenção carrega um `seq` — por canal, sem lacunas e incremental. É o ponto de retomada do cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persista `channel.sequence` se quiser que o catch-up sobreviva tanto a um recarregamento de página quanto a uma reconexão, e passe-o de volta via `history({ sinceSeq })`.

### Buscando o histórico explicitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que o canal não mantém histórico e nunca manterá — uma resposta explícita, para que você possa diferenciar "você não perdeu nada" de "este canal não possui regra de retenção". No segundo caso, um cliente que precisa convergir terá que recorrer a uma ressincronização completa.

`latestSeq` é a sequência mais alta armazenada pelo servidor, quer este lote a tenha alcançado ou não. Se ela estiver muito além do seu último `seq` entregue, você está mais atrasado do que uma única página, e ressincronizar pode ser mais vantajoso do que paginar.

:::note[As reproduções podem se sobrepor, e tudo bem]
O servidor não tem como saber com exatidão quais mensagens chegaram até você antes de o socket cair, portanto um intervalo de catch-up pode incluir algumas que você já aplicou. O SDK descarta qualquer coisa igual ou inferior à sequência já entregue, garantindo que os handlers nunca recebam a mesma mensagem duas vezes.

Suas próprias mensagens são filtradas da reprodução, assim como acontece ao vivo, incluindo aquelas enviadas antes que uma reconexão desse ao socket um novo client id: o canal se lembra dos ids a partir dos quais fez broadcast. Um novo objeto de canal — digamos, após um recarregamento de página — não se lembra de nenhum, portanto o catch-up entregará suas mensagens anteriores como as de qualquer outro usuário, o que é exatamente o necessário para reconstruir o estado a partir do histórico.
:::

## Rastreamento de Presença

O recurso de presença permite rastrear quais usuários estão online e sincronizar estados compartilhados entre todos os participantes:

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

O SDK mantém a lista para você, garantindo que `presences` esteja sempre completa e que você nunca precise reconstruí-la a partir de diffs.

Ele também lida com dois detalhes de protocolo fáceis de errar ao trabalhar diretamente com o WebSocket bruto:

- **A lista de presença não é enviada no join.** O primeiro `presence_diff` de um cliente ao entrar contém apenas ele mesmo; a lista existente deve ser solicitada explicitamente. O `join()` faz isso para você.
- **A presença expira após 30 segundos.** `track()` não é um registro permanente — sem um reenvio periódico, você desaparece silenciosamente da lista de presença de todos os outros usuários mesmo continuando conectado e na página. O SDK envia heartbeats a cada 20 segundos e para ao executar `untrack()` / `leave()`.

Uma reconexão também descarta o pertencimento ao canal e a presença no lado do servidor; o SDK refaz o join, solicita a lista de presença novamente e refaz o rastreamento automaticamente.

## Quando Usar Tempo Real

| Caso de Uso | Método |
|-------------|--------|
| Dashboard com dados ao vivo | `listen()` com filtros |
| Chat ou mensagens | `channel.broadcast()` |
| Edição colaborativa / fluxos de operações | `channel(name, { history: true })` |
| Indicadores de digitação / status online | `channel.track()` + `channel.onPresence()` |
| Página de detalhes com atualizações ao vivo | `listenById()` |
| Monitoramento em painel administrativo | `listen()` com `orderBy` e `limit` |
| Uma lista que deve sobreviver a uma conexão perdida | `observe()` com [offline](/docs/sdk/offline) ativado |

> **Dica:** Para buscas de dados pontuais, use `find()` ou `findById()`. As inscrições são ideais para dados que mudam com frequência e precisam ser refletidos na interface imediatamente.

## `listen()` vs `observe()`

Ambos mantêm uma consulta atualizada e ambos retornam uma função de cancelamento de inscrição — mas atendem a propósitos diferentes.

`listen()` é o socket: entrega o que o servidor envia e não entrega nada quando o socket está fora do ar.

`observe()` é a consulta: com o modo [offline](/docs/sdk/offline) ativado, ele emite primeiro a partir do banco de dados local — antes de qualquer requisição — e reemite em escritas locais, em escritas enfileiradas alcançando o servidor, em rollbacks e em eventos de tempo real, aos quais ele próprio se inscreve a menos que você passe `{ realtime: false }`. Cada resultado informa se veio do cache e se carrega escritas que o servidor ainda não aceitou.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sem o suporte offline ativado, `observe()` é o `find()` mais o `listen()` em uma única chamada, com essas flags sempre como `false`.

## Próximos Passos

- **[Consultando Dados](/docs/sdk/querying)** — Operações de CRUD e query builder
- **[Offline & Sincronização Local-First](/docs/sdk/offline)** — Consultas ao vivo que sobrevivem a uma conexão perdida
- **[Autenticação](/docs/sdk/authentication)** — Login e gerenciamento de sessões
- **[Backend em Tempo Real](/docs/backend/realtime)** — Configuração de WebSocket no lado do servidor
