---
sourceHash: 1b875d11f8a07037
title: Sincronização Offline e Local-First
sidebar_label: Offline
description: Ative o motor de sincronização local-first do SDK tipado do Rebase — um banco de dados local de linhas, gravações offline instantâneas com reversão e consultas reativas em tempo real.
---

## Visão Geral

O suporte offline transforma a camada de dados do SDK em um **motor de sincronização local-first**. Em vez de um cache que memoriza respostas, o cliente mantém um pequeno banco de dados local de linhas, responde a consultas a partir dele e trata a rede como algo que o preenche e que eventualmente aceita suas gravações.

Três coisas decorrem disso:

- **As leituras sobrevivem à perda de conexão com a rede.** Uma consulta que o cliente pode avaliar localmente é avaliada localmente — filtros, ordenação e paginação inclusos — para que uma lista continue renderizando mesmo sem conexão.
- **As gravações são decididas localmente.** Uma gravação feita offline é aplicada imediatamente, colocada em fila e reproduzida em ordem quando a conexão retornar. Se o servidor a rejeitar, a alteração local é revertida (rollback).
- **As leituras são reativas.** `observe()` emite valores a partir do banco de dados local primeiro e reemite sempre que algo alterar as linhas abrangidas por ele — suas próprias gravações, uma gravação da fila sendo confirmada, uma reversão, outra aba do navegador ou um evento em tempo real.

O recurso vem desativado por padrão. Ative-o com uma única opção:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

No navegador, tudo persiste no IndexedDB, portanto uma recarga de página mantém tanto as linhas locais quanto as gravações não enviadas. Em outros ambientes (Node, testes), ele recorre à memória; outros runtimes podem fornecer seu próprio armazenamento.

## O que muda

Nada na API que você já utiliza muda de formato. `find()`, `findById()`, `create()`, `update()`, `delete()` e o fluent builder mantêm suas assinaturas e tipos de retorno — eles apenas deixam de falhar quando a rede cai.

### Leituras

Uma leitura bem-sucedida mescla suas linhas no banco de dados local e memoriza quais IDs o servidor retornou para aquela consulta. Quando uma leitura não consegue alcançar o servidor, ela é respondida localmente:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Offline, isso filtra e ordena as linhas que o cliente possui. Isso inclui linhas buscadas por *outras* consultas — o banco de dados é normalizado, de modo que uma linha é armazenada uma única vez, não importa em quantas listas tenha aparecido — e linhas criadas offline por você.

Se realmente não houver nada com o que responder (uma tabela que o aplicativo nunca leu), a leitura lança um erro reconhecível em vez de um simples `TypeError`:

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Gravações

Enquanto a conexão estiver comprovadamente inativa, a gravação nem sequer é tentada — ela é aplicada localmente e enfileirada, custando nada em vez de gerar um tempo limite (timeout):

```typescript
// Enquanto offline, retorna imediatamente com a linha aplicada localmente.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Aparece em todas as listas correspondentes, imediatamente.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Linhas criadas offline recebem um ID gerado pelo cliente, no mesmo tipo que os IDs da tabela já possuem: um **número inteiro negativo** onde forem números, uma string UUID onde forem strings. O sinal é o indicativo — uma chave real nunca é negativa — de modo que uma linha que ainda não chegou ao servidor é reconhecível sem a necessidade de uma busca, e o `id` continua passando na checagem de tipos conforme o `Row` gerado indicar. Em uma tabela que este dispositivo nunca leu, não há nada local de onde inferir o tipo, e o ID será um UUID.

Se o servidor atribuir seu próprio ID durante a reprodução da fila, a linha local e quaisquer gravações na fila que ainda apontem para o ID temporário são migradas para o ID real, em todas as tabelas: uma postagem enfileirada com `author_id` apontando para um autor criado offline é enviada com o ID que o servidor atribuiu ao autor. Se, em vez disso, o servidor recusar o autor, as gravações que fazem referência a ele são descartadas juntamente e reportadas como `DEPENDENCY_REJECTED` (consulte [Quando o servidor recusa](#quando-o-servidor-recusa)). Até lá, não persista um ID temporário em nenhum lugar fora do banco de dados offline — uma chave estrangeira ou uma URL favoritada contendo um ID temporário apontará para uma linha prestes a ser renumerada.

As gravações são reproduzidas na ordem em que foram feitas, entre tabelas — portanto, a criação em uma tabela ainda ocorre antes da linha em outra que faz referência a ela.

Cada gravação enfileirada é uma requisição por padrão; portanto, 500 linhas digitadas offline levam 500 idas e voltas (round trips) para serem esvaziadas. Com `replayBatchSize` configurado (até 1.000), uma sequência de criações consecutivas offline em uma mesma tabela é reproduzida como um único `createMany`. Apenas criações com um ID gerado pelo SDK como string são agrupadas, e nunca uma que faça referência a outra linha da mesma sequência. Se o servidor recusar ou adiar a sequência por qualquer motivo que não seja perda de conexão, nada é gravado (uma gravação em lote é uma transação única), e a sequência é reproduzida uma gravação por vez, como faria por padrão.

### Gravações enfileiradas por uma versão anterior

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A fila armazena uma gravação como os valores que ela envia — chaves para relações, listas de números para vetores, `{ latitude, longitude }` para pontos, texto ISO para datas — e linhas em cache como as linhas do servidor. Uma gravação enfileirada offline pela versão anterior do SDK, que as armazenava como classes (`EntityRelation`, `GeoPoint`, `Vector`), é convertida para esses valores quando é lida de volta e reproduzida normalmente: nada enfileirado antes da atualização é perdido. Um SDK mais antigo que encontrar uma gravação enfileirada por esta versão a manterá na fila.

## Consultas em tempo real (Live queries)

`observe()` é a leitura reativa e a opção ideal para uso em interfaces de usuário (UI):

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

A primeira emissão vem do banco de dados local sem nenhuma requisição no caminho; uma revalidação ocorre em segundo plano logo em seguida. Depois disso, ela reemite a cada alteração nas linhas que abrange. As emissões são deduplicadas — uma atualização que não altera nada não dispara o callback —, tornando seguro renderizar diretamente a partir dela.

Cada resultado carrega o que uma interface precisa para se descrever:

| Campo | Significado |
|-------|-------------|
| `data`, `meta` | O mesmo formato retornado por `find()` |
| `fromCache` | As linhas vieram do banco de dados local, não de uma requisição concluída |
| `hasPendingWrites` | Pelo menos uma linha aqui possui uma gravação que o servidor ainda não aceitou |
| `partial` | O banco de dados local pode não conter todas as linhas correspondentes — trate como melhor esforço |
| `error` | A última revalidação falhou |

`observeById()` faz o mesmo para uma única linha, e passa `undefined` quando ela é excluída. Aceita `include` da mesma forma que `findById()`, e cada emissão traz essas relações:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

Ambos vinculam a assinatura de tempo real quando o cliente a possui, de modo que alterações feitas por outros usuários também chegam em fluxo (stream). Passe `{ realtime: false }` para obter uma assinatura que reflita apenas o estado local e atualizações explícitas.

Mesmo sem o `offline` ativado, `observe()` ainda existe: ele faz a busca uma vez e permanece ativo via tempo real, com os três sinalizadores (flags) como `false`.

## Estado de sincronização

`client.offline` expõe o motor, a partir do qual um indicador de sincronização pode ser construído:

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Ou leia uma única vez
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Método | Finalidade |
|--------|------------|
| `status()` | Conectividade atual, tamanho da fila, atividade de sincronização, último erro e `persisted`: se o navegador concordou em manter o banco de dados offline (solicitado quando a primeira gravação é enfileirada; `false` significa que ele pode ser descartado sob pressão de armazenamento, incluindo gravações não enviadas). `unverifiedUser` é `true` enquanto uma recarga offline exibe os dados do último usuário sem uma sessão confirmada (consulte [`keepLastUser`](#recargas-offline-no-modo-de-cookie)) |
| `onStatusChange(fn)` | Inscreve-se nas informações acima |
| `onQueueChange(fn)` | Apenas a quantidade de gravações não enviadas, útil para um badge |
| `pending()` | As próprias mutações enfileiradas, da mais antiga para a mais recente. `pending({ orphaned: true })`: aquelas enfileiradas enquanto desconectado — consulte [Usuários](#usuários) |
| `sync()` | Reproduz a fila agora — resolve com `{ flushed, remaining }` |
| `clear()` | Descarta as gravações enfileiradas **e** as linhas locais do usuário atual. `clear({ orphaned: true })`: em vez disso, descarta as que foram enfileiradas enquanto desconectado |

A reprodução ocorre automaticamente: quando o navegador dispara o evento `online`, quando o usuário faz login e em recuo exponencial (exponential backoff de um segundo, dobrando até um minuto) enquanto houver itens enfileirados. `sync()` serve para um botão de "tentar novamente agora".

## Quando o servidor recusa

Uma gravação enfileirada pode ser rejeitada — validação, segurança a nível de linha (RLS), uma linha que outra pessoa excluiu. Esses problemas nunca se resolvem sozinhos, então o motor reverte as linhas locais para o que eram antes da gravação, descarta as edições enfileiradas que foram construídas sobre ela e notifica você:

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

Uma linha excluída por outra pessoa é o único caso que não é revertido. Uma exclusão (`delete`) enfileirada para ela cumpriu seu objetivo, portanto conta como sincronizada e não é reportada. Uma edição enfileirada para ela é reportada, e a linha é removida do banco de dados local em vez de ser restaurada, porque o servidor não a possui mais.

O efeito cascata é restrito: um `update` é descartado junto com a gravação que ele editou, pois só poderia falhar da mesma maneira. Um `create` ou `delete` posterior para a mesma linha mantém-se de forma independente e é preservado. Um `create` recusado de uma linha criada offline também descarta qualquer gravação enfileirada, em qualquer tabela, cujos valores façam referência ao ID temporário daquela linha. Uma gravação descartada nunca foi enviada. Ela é reportada com um `RebaseApiError` cujo `code` é `DEPENDENCY_REJECTED` e cujo `cause` é a recusa que a inviabilizou, permitindo distingui-la da gravação que o servidor de fato recusou.

Edições consecutivas na mesma linha enquanto offline são mescladas em uma única gravação enfileirada, evitando que um formulário sendo preenchido aumente a fila desnecessariamente. Uma gravação cujo envio pela fila já começou não recebe novas mesclagens: uma edição feita após uma tentativa de reprodução cuja resposta foi perdida é enfileirada como um update próprio, e a exclusão de uma linha criada offline é enviada em vez de ser cancelada contra a sua criação, visto que o servidor já pode possuir a linha. Se o servidor recusar a gravação mesclada devido ao seu conteúdo (um erro 400, 403 ou 422 — por exemplo, um campo removido por uma alteração de esquema enquanto o usuário estava offline), o motor desfaz a mesclagem separando-a nas edições individuais e reproduz cada uma delas. Apenas a edição recusada pelo servidor é revertida e reportada; as outras são mantidas.

### Conflitos

Por padrão, uma edição enfileirada offline sobrescreve o que o servidor possui para os campos que ela altera, mesmo que outra pessoa os tenha alterado nesse meio-tempo. Para ser notificado em vez disso, passe `onConflict`. Um `update` enfileirado é então reproduzido com `If-Match`, informando a versão da linha contra a qual a alteração foi feita; quando a linha tiver mudado desde então, o servidor a recusará com 412 e `onConflict` decidirá:

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

- `"overwrite"` envia a edição novamente sem a pré-condição: a última gravação vence (last writer wins), assim como ocorre sem `onConflict`.
- `"discard"` descarta a edição. A linha volta ao estado anterior a ela, como em uma rejeição, e é lida novamente do servidor. Isso não é reportado para `onSyncError`; gravações enfileiradas sobre ela são reportadas como `DEPENDENCY_REJECTED`.

A fila aguarda enquanto `onConflict` é executado, permitindo consultar o usuário. Caso a função lance um erro, a edição é sobrescrita.

A versão contra a qual uma edição é feita é aquela informada na última leitura da linha: `findById()`, um frame do `listenById()` ou a resposta a um `update()` anterior. Uma linha lida pela última vez em uma lista de `find()` ou `listen()` não possui versão, e tampouco uma edição feita sobre outra gravação já enfileirada para a mesma linha. Essas são reproduzidas sem pré-condição. Um `ifMatch` passado manualmente por você para `update()` ou `delete()` é mantido quando a gravação entra na fila, com ou sem `onConflict`, e `findById()` em um cliente com offline habilitado retorna a linha com sua versão, para que `etagOf(row)` funcione da mesma forma que online. Sem `onConflict`, uma gravação enfileirada recusada devido ao seu próprio `ifMatch` é revertida e reportada para `onSyncError` com um erro 412 `PRECONDITION_FAILED`.

Uma falha puramente temporária — um 429, 503 ou queda de conexão — não é uma rejeição. Elas permanecem na fila e são tentadas novamente; somente após `maxRetries` adiamentos uma gravação é revertida.

## Múltiplas abas

Abas da mesma aplicação compartilham o mesmo banco de dados IndexedDB, logo compartilham as linhas locais e a caixa de saída (outbox). Uma gravação em uma aba aparece nas outras, e apenas uma aba por vez reproduz a fila. Não há nada a configurar.

Essa última garantia provém da [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) do navegador, que existe apenas em contextos seguros (HTTPS ou `localhost`) e não está presente no Safari antes da versão 15.4 ou em algumas webviews embarcadas. Sem ela, todas as abas abertas reproduzem a fila ao sincronizar. Criações, gravações em lote, atualizações e exclusões são todas reproduzidas com uma chave de idempotência; assim, um servidor que armazena chaves aplica cada uma apenas uma vez. O que você poderá observar é a mesma gravação sendo enviada a partir de duas abas.

## Usuários

O banco de dados local e a caixa de saída são particionados por usuário autenticado. As linhas em cache correspondem ao que a segurança a nível de linha permitiu que aquele usuário visse, e uma gravação enfileirada deve ser reproduzida como seu autor — portanto, sair e entrar como outra pessoa nunca mistura os dois contextos. Fazer logout não exige limpar nada.

### Enquanto a sessão está sendo restaurada

Até que o cliente saiba quem está autenticado, ele não sabe qual banco de dados local e caixa de saída utilizar; portanto, leituras e gravações offline aguardam. Esse é o tempo que `auth.isInitialized()` leva: nenhum para uma sessão armazenada que ainda é válida, e uma requisição de atualização quando a sessão precisa ser recuperada do servidor — no modo de cookie, onde nada é armazenado no dispositivo, isso ocorre a cada carregamento de página. Uma gravação feita nessa janela é enfileirada sob a identidade em que a sessão se resolver, e uma leitura responde a partir do banco de dados local correspondente. Um frame de tempo real que chegue nesse intervalo é passado para o seu callback conforme enviado pelo servidor, sem ser mantido em nenhum lugar.

Se a sessão não puder ser restaurada — a atualização for recusada ou, no modo de cookie, não conseguir alcançar o servidor —, o cliente passa ao estado desconectado, e as leituras e gravações offline pertencem ao usuário desconectado.

### Gravações feitas enquanto desconectado

Gravações enfileiradas enquanto ninguém estava autenticado não são reproduzidas quando alguém faz login. Aquele usuário não as realizou, e reproduzi-las com suas credenciais atribuiria as alterações de uma pessoa em nome de outra — em um dispositivo compartilhado, gravações de um visitante entrariam na conta do próximo usuário. Elas também não são migradas para a caixa de saída do usuário autenticado. Em vez disso, são mantidas e listadas separadamente, permitindo que o aplicativo decida o que fazer com elas:

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Reenvie cada uma manualmente, agora como o usuário autenticado.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` as descarta, juntamente com as linhas locais às quais foram aplicadas; a caixa de saída própria do usuário conectado não é afetada. Se o aplicativo não fizer nada com elas, elas serão reproduzidas na próxima vez em que ninguém estiver conectado. Enquanto ninguém estiver conectado, elas constituem simplesmente a caixa de saída atual, e `pending({ orphaned: true })` não lista nada.

### Recargas offline no modo de cookie

No modo de cookie, nada referente à sessão é armazenado no dispositivo, de modo que uma recarga que não alcance o servidor não terá nenhum usuário associado. Por padrão, ela é tratada como desconectada: as linhas locais do usuário são ocultadas e as gravações feitas nesse momento entram na fila como sendo do usuário desconectado.

`keepLastUser: true` altera esse comportamento. O cliente memoriza o último usuário autenticado no dispositivo (apenas seu ID), e uma recarga offline abre o banco de dados local daquele usuário. As gravações feitas então entram na fila como sendo dele, mas nenhuma é reproduzida até que a sessão seja confirmada: quando a conexão voltar, o cliente atualiza a sessão, e um login também a confirma. Se o servidor recusar a sessão, ou se outra pessoa se autenticar, o dispositivo alterna de usuário e as gravações enfileiradas permanecem com seu autor original até que ele faça login novamente. Enquanto isso, `status().unverifiedUser` é `true`, o que também é válido online: até que a atualização responda, as gravações são enfileiradas em vez de saírem sem credenciais, e as leituras são respondidas a partir das linhas locais do usuário. O que o servidor retorna a uma requisição sem sessão é o que um chamador desconectado tem permissão de ver, portanto isso não é retido.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

Vem desativado por padrão porque, em um dispositivo compartilhado, permite que as linhas em cache do usuário anterior sejam lidas offline sem uma sessão ativa. Ative-o em instalações pertencentes a uma única pessoa. O ID é esquecido no logout e quando o servidor recusa a sessão. Ele nunca é utilizado quando o servidor responde que não há sessão ativa.

## Configuração

<span class="since-badge" data-since="0.31">Desde 0.31</span> `maxCachedRowsPerTable` e `maxCachedQueriesPerTable` chamavam-se anteriormente `…PerCollection`.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // padrão: IndexedDB no navegador, memória nos demais
        maxCachedRowsPerTable: 5000,          // linhas com gravações pendentes nunca são descartadas
        maxCachedQueriesPerTable: 50,         // composições de páginas do servidor memorizadas
        syncIntervalMs: 60_000,               // limite máximo para o recuo de repetição; 0 desativa a repetição automática
        maxRetries: 5,                        // adiamentos antes de desistir de uma gravação
        crossTab: true,                       // padrão: ativado para IndexedDB, desativado para memória
        keepLastUser: false,                  // abre os dados do último usuário em recargas offline (modo cookie)
        replayBatchSize: 1,                   // criações enfileiradas enviadas por requisição na reprodução (máx. 1000)
        onConflict: (error, mutation) => "overwrite", // ou "discard"; padrão: sem verificação de conflitos
        onSyncError: (error, mutation) => {}
    }
});
```

### Armazenamento customizado (Custom store)

Qualquer ambiente pode persistir o banco de dados local implementando `OfflineStore` — uma interface chave/valor com namespace, contendo uma área de cache de leitura e uma área de fila. É assim que você utiliza o AsyncStorage no React Native ou o sistema de arquivos no Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

O único contrato além do evidente é que as listagens por prefixo retornem em ordem lexicográfica de chave — é isso que garante o comportamento FIFO da caixa de saída.

## Limitações

O cliente não é uma réplica integral do seu banco de dados, nem finge ser:

- **Apenas linhas lidas ou gravadas pelo aplicativo estão disponíveis localmente.** Uma consulta que o cliente nunca enviou ainda pode ser respondida a partir do que ele possui, mas a resposta pode não conter linhas que o servidor teria retornado. Resultados em tempo real informam isso por meio da flag `partial`.
- **`findAll()` e `iterate()` leem apenas páginas respondidas pelo servidor neste dispositivo.** Uma iteração continua enquanto cada página indicar que há mais itens, e apenas o servidor pode fornecer essa informação. Offline, uma iteração que exija uma página nunca obtida por este dispositivo falha com o erro `OFFLINE` (`isOfflineError`) em vez de retornar parte da tabela como se fosse sua totalidade.
- **`count()` offline depende de uma contagem fornecida pelo servidor a este dispositivo para a mesma consulta.** Gravações enfileiradas desde então alteram esse valor: criações, edições que incluam ou retirem uma linha do filtro e exclusões. Sem uma contagem prévia, falha com o erro `OFFLINE` em vez de contar as linhas que o dispositivo porventura possui.
- **`searchString` é uma aproximação**, consistindo em uma varredura de substring que não diferencia maiúsculas de minúsculas sobre campos de texto em cache. O servidor executa busca textual completa (full-text search) real sobre as colunas configuradas da tabela.
- **Relações incluídas via `include` não podem ser avaliadas localmente** — as linhas relacionadas residem em tabelas que a consulta original não carregou. Uma consulta desse tipo é sempre marcada como `partial` quando respondida a partir do cache.
- **Conflitos são resolvidos com a vitória da última gravação (last-writer-wins), por campo, a menos que você passe `onConflict`.** Um `update` reproduzido envia os campos alterados pelo usuário e nada mais; portanto, campos não tocados por ele mantêm os valores que o servidor já possui. Para um campo que ele *de fato* alterou, uma modificação feita por outra pessoa no servidor enquanto ele esteve offline é sobrescrita quando a fila é reproduzida, e nenhum dos usuários é notificado. Com [`onConflict`](#conflitos), uma edição cuja versão de linha seja conhecida é verificada contra a do servidor, e o aplicativo toma a decisão. Criações, exclusões e gravações em lote nunca são verificadas.
- **A reprodução é do tipo at-least-once (ao menos uma vez).** Uma gravação que alcança o servidor mas cuja resposta é perdida pode ser reenviada. Prefira gravações idempotentes (`createMany` com `upsert`) onde duplicidades forem problemáticas.
- **A lixeira exige o servidor.** O banco de dados local mantém apenas linhas ativas; portanto, `trash.find()`, `trash.count()`, `trash.restore()` e `trash.purge()` (consulte [soft delete](/docs/collections/soft-delete#from-the-sdk)) nunca são respondidos localmente nem enfileirados: offline, falham com o erro `OFFLINE`. A restauração ou expurgo de uma linha que ainda possua uma gravação enfileirada sincroniza a fila primeiro e é recusada com `TRASH_PENDING_WRITE` caso a gravação ainda não possa ser enviada.
- **Um upsert com chave natural exige o servidor.** Descobrir qual linha o alvo de `onConflict` referencia cabe ao servidor; portanto, `upsert()` em uma chave natural (ou sem o ID da linha), e um `createMany()` com `onConflict` que nunca tenha sido enviado, são recusados quando offline com `OFFLINE_UPSERT_UNSUPPORTED`. Um upsert sobre a chave primária, com a chave presente em cada linha, é devidamente enfileirado.
- **Leituras locais aplicam a semântica do Postgres, não os dados originais do banco.** Filtros são avaliados como o SQL faria — comparações com `NULL` resultam em desconhecido (unknown), `ORDER BY` posiciona nulos por último na ordem ascendente e desempata pelo ID da linha em ordem descendente, exatamente como o servidor opera —, porém sobre a cópia local das linhas mantida pelo cliente, que pode estar desatualizada.
- **Uma ordenação que o cliente não consiga reproduzir não é aplicada.** Ordenar texto é responsabilidade do servidor: o PostgreSQL realiza a ordenação com base na collation do *banco de dados*, a qual este processo desconhece; e, sob a collation C, `Banana` vem antes de `apple`, enquanto um collator em JavaScript define o contrário. Quando uma coluna de ordenação não puder ser comparada numericamente, as linhas mantêm a ordem enviada pelo servidor, e o resultado é marcado como `partial` em vez de ser apresentado como a página ordenada solicitada. Cada chave de uma ordenação multicoluna precisa ser reproduzível, não apenas a primeira — uma ordenação com a qual o lado local só consegue concordar até a segunda coluna é considerada divergente.

## Exemplo prático: um indicador de offline

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

## Veja também

- [Consultando Dados](/docs/sdk/querying) — a superfície de consulta compartilhada entre `observe()` e `find()`
- [Assinaturas em Tempo Real](/docs/sdk/realtime) — atualizações enviadas pelo servidor, base sobre a qual as consultas em tempo real são construídas
