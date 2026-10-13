---
sourceHash: dc394aa7ff8f8f55
title: Offline e Sincronização Local-First
sidebar_label: Offline
description: Ative o motor de sincronização local-first do SDK tipado do Rebase — um banco de dados local de linhas, escritas offline instantâneas com reversão e consultas ao vivo reativas.
---

## Visão Geral

O suporte offline transforma a camada de dados do SDK em um **motor de sincronização local-first**. Em vez de um cache que memoriza respostas, o cliente mantém um pequeno banco de dados local de linhas, responde às consultas a partir dele e trata a rede como algo que o preenche e que, no fim, aceita as suas escritas.

Três coisas decorrem disso:

- **As leituras sobrevivem à queda da rede.** Uma consulta que o cliente consegue avaliar localmente é avaliada localmente — incluindo filtros, ordenação e paginação —, de modo que uma lista continua sendo renderizada com a conexão morta.
- **As escritas são decididas localmente.** Uma escrita feita offline é aplicada imediatamente, entra na fila e é reexecutada em ordem quando a conexão volta. Se o servidor a rejeitar, a alteração local é revertida.
- **As leituras são reativas.** `observe()` emite primeiro a partir do banco de dados local e volta a emitir sempre que algo altera as linhas que ele cobre — suas próprias escritas, uma escrita enfileirada que chega ao servidor, uma reversão, outra aba do navegador ou um evento em tempo real.

Está desativado por padrão. Ative-o com uma única opção:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

No navegador tudo é persistido no IndexedDB, portanto um recarregamento preserva tanto as linhas locais quanto as escritas não enviadas. Em outros ambientes (Node, testes), ele recorre à memória; outros runtimes podem fornecer o seu próprio store.

## O Que Muda

Nada na API que você já usa muda de formato. `find()`, `findById()`, `create()`, `update()`, `delete()` e o construtor fluente mantêm suas assinaturas e seus tipos de retorno — eles apenas deixam de falhar quando a rede falha.

### Leituras

Uma leitura bem-sucedida mescla suas linhas no banco de dados local e memoriza quais ids o servidor retornou para aquela consulta. Quando uma leitura não consegue alcançar o servidor, ela é respondida localmente:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Offline, isso filtra e ordena as linhas que o cliente possui. Isso inclui linhas obtidas por *outras* consultas — o banco de dados é normalizado, então uma linha é armazenada uma única vez, não importa em quantas listas ela apareceu — e as linhas que você criou offline.

Se realmente não houver nada com que responder (uma coleção que o app nunca leu), a leitura lança um erro reconhecível em vez de um `TypeError` genérico:

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Escritas

Enquanto a conexão está reconhecidamente fora do ar, uma escrita sequer é tentada — ela é aplicada localmente e entra na fila, de modo que não custa nada em vez de um timeout:

```typescript
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

As linhas criadas offline recebem um id gerado pelo cliente, no tipo que os ids da coleção já têm: um **inteiro negativo** onde são números, uma string UUID onde são strings. O sinal é a pista — uma chave real nunca é negativa —, por isso uma linha que ainda não chegou ao servidor é reconhecível sem consulta, e `id` continua a ser o que o tipo `Row` gerado diz. Numa coleção que este dispositivo nunca leu não há nada local de onde deduzir o tipo, e o id é um UUID.

Se o servidor atribuir o seu próprio na reexecução, a linha local e quaisquer escritas enfileiradas que ainda apontem para o id temporário são movidas para o id real, em todas as coleções: um post enfileirado com `author_id` definido como um autor criado offline é enviado com o id que o servidor deu ao autor. Se o servidor recusar o autor, as escritas que o referenciam são descartadas junto com ele e reportadas como `DEPENDENCY_REJECTED` (veja [Quando o Servidor Diz Não](#quando-o-servidor-diz-não)). Até lá, não guarde um id temporário fora da base de dados offline: uma chave estrangeira ou um URL guardado que contenha um aponta para uma linha prestes a ser renumerada.

As escritas são reexecutadas na ordem em que você as fez, entre coleções — de modo que um create em uma coleção ainda chega antes da linha de outra que o referencia.

Cada escrita enfileirada é, por padrão, uma requisição, então 500 linhas digitadas offline levam 500 idas e voltas para escoar. Com `replayBatchSize` definido (até 1 000), uma sequência de creates offline consecutivos em uma coleção é reexecutada como um único `createMany`. Só são agrupados creates com um id que o SDK gerou como string, e nunca um que referencie outra linha da mesma sequência. Se o servidor recusar ou adiar a sequência por qualquer motivo que não seja uma conexão perdida, nada é escrito (uma escrita em massa é uma transação), e a sequência é reexecutada uma escrita de cada vez, como seria por padrão.

## Consultas ao Vivo

`observe()` é a leitura reativa, e a que você deve usar em uma interface:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

A primeira emissão vem do banco de dados local, sem nenhuma requisição no caminho; uma revalidação acontece em segundo plano logo depois. A partir daí, ele volta a emitir a cada mudança nas linhas que cobre. As emissões são desduplicadas — uma atualização que não muda nada não dispara o callback —, então é seguro renderizar diretamente a partir dela.

Cada resultado carrega o que uma interface precisa para se descrever:

| Campo | Significado |
|-------|---------|
| `data`, `meta` | O mesmo formato que `find()` retorna |
| `fromCache` | As linhas vieram do banco de dados local, não de uma requisição concluída |
| `hasPendingWrites` | Pelo menos uma linha aqui carrega uma escrita que o servidor ainda não aceitou |
| `partial` | O banco de dados local pode não conter todas as linhas correspondentes — trate como melhor esforço |
| `error` | A última revalidação falhou |

`observeById()` faz o mesmo para uma única linha e passa `undefined` quando ela é excluída. Ele aceita `include` como `findById()`, e cada emissão carrega essas relações:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

Ambos vinculam a assinatura em tempo real quando o cliente tem uma, então as mudanças feitas por outros usuários também chegam por streaming. Passe `{ realtime: false }` para uma assinatura que reflita apenas o estado local e as atualizações explícitas.

Sem o `offline` ativado, `observe()` continua existindo: ele busca uma vez e permanece ao vivo através do tempo real, com os três sinalizadores em `false`.

## Estado de Sincronização

`client.offline` expõe o motor, que é a partir do que se constrói um indicador de sincronização:

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Método | Finalidade |
|--------|---------|
| `status()` | Conectividade atual, tamanho da fila, atividade de sincronização, último erro e `persisted`: se o navegador concordou em manter a base de dados offline (perguntado quando a primeira escrita é enfileirada; `false` significa que ela pode ser removida sob pressão de armazenamento, escritas não enviadas inclusive). `unverifiedUser` é `true` enquanto um recarregamento offline mostra os dados do último usuário sem uma sessão confirmada (veja [`keepLastUser`](#recarregamentos-offline-no-modo-cookie)) |
| `onStatusChange(fn)` | Assinar o item acima |
| `onQueueChange(fn)` | Apenas o número de escritas não enviadas, para um badge |
| `pending()` | As próprias mutações enfileiradas, da mais antiga para a mais recente. `pending({ orphaned: true })`: as que foram enfileiradas sem sessão iniciada — veja [Usuários](#usuários) |
| `sync()` | Reexecutar agora — resolve com `{ flushed, remaining }` |
| `clear()` | Descartar as escritas enfileiradas **e** as linhas locais do usuário atual. `clear({ orphaned: true })`: em vez disso, as que foram enfileiradas sem sessão iniciada |

A reexecução acontece por conta própria: quando o navegador dispara `online`, quando o usuário faz login e em um backoff exponencial (um segundo, dobrando até um minuto) enquanto houver algo na fila. `sync()` serve para um botão de "tentar novamente".

## Quando o Servidor Diz Não

Uma escrita enfileirada pode ser rejeitada — validação, segurança em nível de linha, uma linha que outra pessoa excluiu. Essas nunca se resolvem sozinhas, então o motor reverte as linhas locais ao que eram antes da escrita, descarta as edições enfileiradas que foram construídas sobre ela e avisa você:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onSyncError: (error, mutation) => {
            toast(`Couldn't save your change to ${mutation.collection}: ${error.message}`);
        }
    }
});
```

Uma linha que outra pessoa excluiu é o único caso que não é revertido. Um `delete` enfileirado dela fez o que devia, então conta como sincronizado e não é reportado. Uma edição enfileirada dela é reportada, e a linha é removida da base de dados local em vez de restaurada, porque o servidor não a tem mais.

A cascata é estreita: um `update` é descartado junto com a escrita que ele editava, porque só pode falhar da mesma maneira. Um `create` ou `delete` posterior para a mesma linha se sustenta por conta própria e é mantido. Um `create` recusado de uma linha criada offline também leva consigo toda escrita enfileirada, em qualquer coleção, cujos valores referenciem o id temporário da linha. Uma escrita descartada nunca foi enviada. Ela é reportada com um `RebaseApiError` cujo `code` é `DEPENDENCY_REJECTED` e cujo `cause` é a recusa que a condenou, para que você possa distingui-la da escrita que o servidor de fato recusou. Na 0.23 ela carrega em vez disso o próprio erro da escrita recusada.

Edições consecutivas em uma mesma linha enquanto offline são mescladas em uma única escrita na fila, para que um formulário sendo digitado não faça a fila crescer. Se o servidor recusar a escrita mesclada por causa do seu conteúdo (um 400, 403 ou 422 — por exemplo, um campo removido por uma alteração de esquema enquanto o usuário estava offline), o motor a divide novamente nas edições separadas e reproduz cada uma. Apenas a edição que o servidor recusa é revertida e reportada; as demais são mantidas.

### Conflitos

Por padrão, uma edição enfileirada offline sobrescreve o que o servidor tem para os campos que ela alterou, mesmo que outra pessoa os tenha alterado nesse meio tempo. Para ser avisado, passe `onConflict`. Um `update` enfileirado é então reexecutado com `If-Match`, a versão da linha contra a qual foi feito, e quando a linha mudou desde então, o servidor o recusa com um 412 e `onConflict` decide:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onConflict: async (error, mutation) =>
            (await askUser(`${mutation.collection} changed while you were offline. Keep your edit?`))
                ? "overwrite"
                : "discard"
    }
});
```

- `"overwrite"` envia a edição de novo sem a pré-condição: vale a última escrita, como sem `onConflict`.
- `"discard"` descarta a edição. A linha volta ao que era antes dela, como numa rejeição, e é lida de novo do servidor. Não é reportada a `onSyncError`; as escritas enfileiradas sobre ela são, como `DEPENDENCY_REJECTED`.

A fila espera enquanto `onConflict` é executado, então ele pode perguntar ao usuário. Se lançar um erro, a edição é sobrescrita.

A versão contra a qual uma edição é feita é a que a última leitura da linha informou: `findById()`, um frame de `listenById()` ou a resposta de um `update()` anterior. Uma linha lida pela última vez numa lista de `find()` ou `listen()` não tem versão, nem uma edição feita sobre outra escrita enfileirada para a mesma linha. Essas são reexecutadas sem pré-condição. Um `ifMatch` que você mesmo passa a `update()` é mantido quando a edição entra na fila.

Uma falha que é meramente temporária — um 429, um 503, uma conexão interrompida — não é uma rejeição. Essas permanecem na fila e são repetidas; somente após `maxRetries` adiamentos uma escrita é revertida.

## Várias Abas

As abas do mesmo app compartilham um único banco de dados IndexedDB, portanto compartilham as linhas locais e a fila de saída (outbox). Uma escrita em uma delas aparece nas outras, e apenas uma aba por vez reexecuta a fila. Nada a configurar.

Essa última garantia vem da [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) do navegador, que só existe em um contexto seguro (HTTPS ou `localhost`) e não no Safari anterior ao 15.4 nem em alguns webviews embutidos. Sem ela, toda aba aberta reexecuta a fila quando sincroniza. Creates, escritas em lote, updates e deletes são todos reexecutados sob uma chave de idempotência, então um servidor que armazena chaves aplica cada um deles uma só vez; o que você pode ver é a mesma escrita enviada de duas abas.

## Usuários

O banco de dados local e a fila de saída são particionados por usuário autenticado. As linhas em cache são o que a segurança em nível de linha permitiu que aquele usuário visse, e uma escrita enfileirada tem de ser reexecutada como seu autor — de modo que sair e entrar novamente como outra pessoa nunca mistura os dois. Sair da sessão não exige limpar nada.

### Enquanto a sessão é restaurada

Até o cliente saber quem está com a sessão iniciada, ele não sabe qual banco de dados local nem qual fila de saída usar, então as leituras e escritas offline esperam. É o tempo que `auth.isInitialized()` leva: nenhum para uma sessão armazenada que ainda é válida, e uma requisição de refresh quando a sessão precisa voltar do servidor — no modo cookie, em que nada é armazenado no dispositivo, isso acontece a cada carregamento de página. Uma escrita feita nesse intervalo é enfileirada em nome de quem a sessão se revelar ser, e uma leitura responde a partir do banco de dados local dessa pessoa. Um evento de tempo real que chegue nesse meio-tempo é passado ao seu callback tal como o servidor o enviou, e não é guardado em lugar nenhum.

Se a sessão não puder ser restaurada — o refresh é recusado ou, no modo cookie, não alcança o servidor —, o cliente fica sem sessão, e as leituras e escritas offline são as do usuário sem sessão. Na 0.23, o modo cookie tratava todo esse intervalo como sem sessão, de modo que uma escrita feita nele era enfileirada como do usuário sem sessão.

### Escritas feitas sem sessão iniciada

Escritas enfileiradas enquanto ninguém estava com a sessão iniciada não são reexecutadas quando alguém faz login. Esse usuário não as fez, e reexecutá-las com as credenciais dele colocaria as alterações de uma pessoa em nome de outra — em um dispositivo compartilhado, as escritas de um visitante na conta do próximo usuário. Elas também não são movidas para a fila de saída do usuário que fez login. São mantidas e listadas à parte, para que o app decida o que fazer com elas:

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Re-issue each one yourself, now as the signed-in user.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` as descarta, junto com as linhas locais às quais foram aplicadas; a fila de saída do próprio usuário com sessão iniciada não é tocada. Se ninguém mexer nelas, são reexecutadas na próxima vez que ninguém estiver com a sessão iniciada. Enquanto ninguém está com a sessão iniciada, elas são simplesmente a fila de saída atual, e `pending({ orphaned: true })` não lista nada.

### Recarregamentos offline no modo cookie

No modo cookie, nada sobre a sessão é guardado no dispositivo, então um recarregamento
que não consegue alcançar o servidor não tem usuário. Por padrão ele é tratado como
sem sessão: as linhas locais do usuário ficam ocultas, e as escritas feitas então entram na fila
como do usuário sem sessão.

`keepLastUser: true` muda isso. O cliente lembra do último usuário que
entrou no dispositivo (apenas o id), e um recarregamento offline abre a base de dados
local desse usuário. As escritas feitas então entram na fila como dele, mas nenhuma
é reexecutada até que a sessão seja confirmada: quando a conexão volta, o
cliente renova a sessão, e um login também a confirma. Se o servidor
recusar a sessão, ou outra pessoa entrar, o dispositivo troca de usuário, e as
escritas enfileiradas ficam com o seu autor até que ele entre de novo. Enquanto isso,
`status().unverifiedUser` é `true`.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

Vem desligado por padrão porque, num dispositivo compartilhado, permite que as linhas em cache do usuário anterior
sejam lidas offline sem uma sessão. Ligue-o para instalações que
pertencem a uma só pessoa. O id é esquecido no logout e quando o servidor
recusa a sessão. Nunca é usado quando o servidor responde que não há
sessão.

## Configuração

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerCollection: 5000,     // rows with unsent writes are never evicted
        maxCachedQueriesPerCollection: 50,    // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        keepLastUser: false,                  // open the last user's data on an offline reload (cookie mode)
        replayBatchSize: 1,                   // queued creates sent per request on replay (max 1000)
        onConflict: (error, mutation) => "overwrite", // or "discard"; default: no conflict check
        onSyncError: (error, mutation) => {}
    }
});
```

### Um Store Personalizado

Qualquer ambiente pode persistir o banco de dados local implementando `OfflineStore` — uma superfície de chave/valor com namespaces, com uma área de cache de leitura e uma área de fila. É assim que você o apoia no AsyncStorage no React Native, ou no sistema de arquivos no Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

O único contrato além do óbvio é que as listagens por prefixo voltam em ordem lexicográfica de chave — é isso que faz da fila de saída um FIFO.

## Limites

O cliente não é uma réplica do seu banco de dados, e não finge ser:

- **Apenas as linhas que o app leu ou escreveu estão locais.** Uma consulta que o cliente nunca enviou ainda pode ser respondida com o que ele possui, mas a resposta pode estar sem linhas que o servidor teria retornado. Os resultados ao vivo indicam isso através de `partial`.
- **`findAll()` e `iterate()` leem apenas páginas que o servidor respondeu neste dispositivo.** Uma varredura continua enquanto cada página disser que há mais, e só o servidor pode dizer isso. Offline, uma varredura que precisa de uma página que este dispositivo nunca buscou falha com o erro `OFFLINE` (`isOfflineError`) em vez de retornar parte da coleção como se fosse toda ela. Na 0.24 ela parava nessa página e retornava o que tinha.
- **`count()` offline precisa de uma contagem que o servidor deu a este dispositivo para a mesma consulta.** As escritas enfileiradas desde então a movem: creates, edições que levam uma linha para dentro ou para fora do filtro, e deletes. Sem uma, ele falha com o erro `OFFLINE` em vez de contar as linhas que este dispositivo por acaso possui. Na 0.24 ele retornava esse número.
- **`searchString` é aproximado** como uma varredura de substring que não diferencia maiúsculas de minúsculas sobre os campos de texto em cache. O servidor executa uma busca de texto completo real sobre as colunas configuradas da coleção.
- **As relações trazidas por `include` não podem ser avaliadas localmente** — as linhas relacionadas vivem em coleções que a consulta nunca carregou. Uma consulta assim é sempre marcada como `partial` quando respondida a partir do cache.
- **Os conflitos são last-writer-wins, por campo, a menos que você passe `onConflict`.** Um `update` reexecutado envia os campos que o usuário alterou e nada mais, então os campos que ele não tocou mantêm o que o servidor tem. Para um campo que ele *alterou*, uma mudança que outra pessoa fez no servidor enquanto ele estava offline é sobrescrita quando a fila é reexecutada, e nenhum dos usuários é avisado. Com [`onConflict`](#conflitos), uma edição cuja versão da linha é conhecida é comparada com a do servidor, e o app decide. Creates, deletes e escritas em massa nunca são verificados.
- **A reexecução é pelo menos uma vez.** Uma escrita que chega ao servidor mas cuja resposta se perde pode ser enviada de novo. Prefira escritas idempotentes (`createMany` com `upsert`) onde duplicatas fizerem diferença.
- **A lixeira precisa do servidor.** A base de dados local guarda apenas linhas ativas, então `trash.find()`, `trash.count()`, `trash.restore()` e `trash.purge()` (veja [soft delete](/docs/collections/soft-delete#from-the-sdk)) nunca são respondidos localmente nem enfileirados: offline falham com o erro `OFFLINE`. Restaurar ou excluir definitivamente uma linha com uma escrita ainda na fila sincroniza a fila primeiro, e é recusado com `TRASH_PENDING_WRITE` se a escrita ainda não puder ser enviada.
- **Um upsert em uma chave natural precisa do servidor.** Qual linha um destino `onConflict` indica só o servidor consegue descobrir, então `upsert()` em uma chave natural (ou sem o id da linha), e um `createMany()` com `onConflict` que nunca foi enviado, são recusados offline com `OFFLINE_UPSERT_UNSUPPORTED`. Um upsert na chave primária, com a chave em cada linha, é colocado na fila.
- **As leituras locais aplicam a semântica do Postgres, não os dados do banco de dados.** Os filtros são avaliados como o SQL faria — comparações com `NULL` são desconhecidas, `ORDER BY` coloca os nulos por último em ordem crescente —, mas sobre a cópia das linhas que o cliente tem, que pode estar desatualizada.

## Receita: Um Indicador de Offline

```tsx
import React from "react";
import type { CreateRebaseClientResult } from "@rebasepro/client";

export function SyncIndicator({ client }: { client: CreateRebaseClientResult }) {
    const offline = client.offline!;
    const [status, setStatus] = React.useState(offline.status());
    React.useEffect(() => offline.onStatusChange(setStatus), [offline]);

    if (!status.online) {
        return <span className="badge warning">
            Offline{status.pending ? ` · ${status.pending} unsaved` : ""}
        </span>;
    }
    if (status.syncing) return <span className="badge">Syncing…</span>;
    if (status.pending) return <span className="badge">{status.pending} unsaved</span>;
    return null;
}
```

## Veja Também

- [Consultar Dados](/docs/sdk/querying) — a superfície de consulta que `observe()` compartilha com `find()`
- [Assinaturas em Tempo Real](/docs/sdk/realtime) — atualizações enviadas pelo servidor, sobre as quais as consultas ao vivo são construídas
