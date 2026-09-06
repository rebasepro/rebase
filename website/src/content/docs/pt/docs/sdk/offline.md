---
sourceHash: f3023e081dcc3e4a
title: Offline e Sincronização Local-First
sidebar_label: Offline
description: Ative o motor de sincronização local-first do SDK Cliente da Rebase — um banco de dados local de linhas, escritas offline instantâneas com reversão e consultas ao vivo reativas.
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
// Returns immediately, offline or not.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

As linhas criadas offline recebem um id gerado pelo cliente. Se o servidor atribuir o seu próprio na reexecução, a linha local e quaisquer escritas enfileiradas que ainda apontem para o id temporário são movidas para o id real.

As escritas são reexecutadas na ordem em que você as fez, entre coleções — de modo que um create em uma coleção ainda chega antes da linha de outra que o referencia.

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

`observeById()` faz o mesmo para uma única linha e passa `undefined` quando ela é excluída.

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
| `status()` | Conectividade atual, tamanho da fila, atividade de sincronização, último erro |
| `onStatusChange(fn)` | Assinar o item acima |
| `onQueueChange(fn)` | Apenas o número de escritas não enviadas, para um badge |
| `pending()` | As próprias mutações enfileiradas, da mais antiga para a mais recente |
| `sync()` | Reexecutar agora — resolve com `{ flushed, remaining }` |
| `clear()` | Descartar as escritas enfileiradas **e** as linhas locais do usuário atual |

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

A cascata é estreita: um `update` é descartado junto com a escrita que ele editava, porque só pode falhar da mesma maneira. Um `create` ou `delete` posterior para a mesma linha se sustenta por conta própria e é mantido.

Uma falha que é meramente temporária — um 429, um 503, uma conexão interrompida — não é uma rejeição. Essas permanecem na fila e são repetidas; somente após `maxRetries` adiamentos uma escrita é revertida.

## Várias Abas

As abas do mesmo app compartilham um único banco de dados IndexedDB, portanto compartilham as linhas locais e a fila de saída (outbox). Uma escrita em uma delas aparece nas outras, e apenas uma aba por vez reexecuta a fila. Nada a configurar.

## Usuários

O banco de dados local e a fila de saída são particionados por usuário autenticado. As linhas em cache são o que a segurança em nível de linha permitiu que aquele usuário visse, e uma escrita enfileirada tem de ser reexecutada como seu autor — de modo que sair e entrar novamente como outra pessoa nunca mistura os dois. Sair da sessão não exige limpar nada.

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
- **`searchString` é aproximado** como uma varredura de substring que não diferencia maiúsculas de minúsculas sobre os campos de texto em cache. O servidor executa uma busca de texto completo real sobre as colunas configuradas da coleção.
- **As relações trazidas por `include` não podem ser avaliadas localmente** — as linhas relacionadas vivem em coleções que a consulta nunca carregou. Uma consulta assim é sempre marcada como `partial` quando respondida a partir do cache.
- **A reexecução é pelo menos uma vez.** Uma escrita que chega ao servidor mas cuja resposta se perde pode ser enviada de novo. Prefira escritas idempotentes (`createMany` com `upsert`) onde duplicatas fizerem diferença.
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
