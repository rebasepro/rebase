---
sourceHash: 9b21d41a290148dd
title: Callbacks de Entidade
sidebar_label: Callbacks
description: Use callbacks de ciclo de vida para executar lógica personalizada quando entidades são criadas, atualizadas, lidas ou excluídas. Inclui a API context.data para operações entre coleções.
---

## Visão Geral

Os callbacks permitem que você se conecte ao ciclo de vida da entidade para:

- **Sincronizar dados entre coleções** — copiar ou mover entidades entre tabelas em alterações de status
- **Transformar dados** antes de salvar (campos computados, geração de slugs)
- **Validar** regras de negócio além da validação de schema
- **Disparar efeitos colaterais** após gravações (enviar e-mails, sincronizar APIs, atualizar caches)
- **Restringir uma leitura** antes de ser compilada, para que um chamador veja apenas suas próprias linhas
- **Filtrar/transformar** dados após a leitura
- **Operações em cascata** — limpar registros relacionados na exclusão

## Onde os callbacks são executados

Uma coleção possui dois blocos de callback, e a única diferença é qual runtime
os executa.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Executado em | servidor | painel de administração, no navegador |
| Dispara para | REST, o SDK, realtime, `dataAsAdmin` | leituras e gravações que o painel faz |
| Chega ao navegador | não — os corpos são removidos do bundle | sim, na íntegra |
| Uso indicado | tudo abaixo | coleções com as quais o painel se comunica diretamente |

**`callbacks` é o que você deseja.** Ele é executado em todos os caminhos de dados que chegam
ao servidor — REST, o SDK, realtime, MCP e `rebase.data` — e seu corpo nunca
sai da máquina, portanto, uma chave de API ou uma leitura de `process.env` ali é segura. O
restante desta página é sobre `callbacks`.

Um escritor não é um caminho de dados: **o sistema de autenticação**. Registro, login via OAuth
e o gerenciamento de usuários do admin gravam as linhas de usuários diretamente e não executam nenhum
dos seus callbacks, de modo que um e-mail de boas-vindas em `afterSave` em `users` nunca é disparado
no cadastro. Conecte-o aos [auth hooks](/docs/backend/authentication/) passados em
`auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — que
recebem um backend ejetado; a inicialização avisa quando a coleção de usuários declara callbacks
que o cadastro não executará.

`admin.browserCallbacks` existe para um caso: uma coleção em um transporte `direct` ou
`custom`, que o painel lê e grava *por si mesmo* sem nenhum servidor Rebase
no caminho da requisição. Nada no lado do servidor vê essas operações, portanto,
`callbacks` nunca pode disparar para elas, e este bloco é o único lugar onde a
lógica de ciclo de vida delas pode residir.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declared with transport: "direct"
    properties: {
        city: { name: "City", type: "string" },
        code: { name: "Code", type: "string" }
    },
    admin: {
        browserCallbacks: {
            afterRead: ({ row }) => ({ ...row, label: [row.city, row.code].join(" · ") })
        }
    }
};
```

Duas regras decorrem de "enviado para cada visitante", e nenhuma delas é estilística:

1. **Sem segredos.** Sem chaves de API, sem `process.env`, nada que você se importaria
   se um leitor do bundle visse. Isso pertence a `callbacks`.
2. **Não é um limite de segurança.** Um `browserCallbacks.afterRead` que
   oculta um campo o oculta *depois* que o navegador já possui a linha — em um
   transporte direto, o documento bruto veio direto do repositório de dados. Trata-se de
   apresentação. A ocultação que precisa ser garantida deve ir em `callbacks` ou nas
   regras do próprio repositório.

Em uma coleção de transporte de servidor — o padrão, e quase certamente a sua —
o servidor já executou `callbacks` antes que a linha chegue ao painel, portanto, um
`browserCallbacks.afterRead` é executado *além* dele. Escreva-o para ser
idempotente, ou não o escreva.

Um `browserCallbacks.afterSave` é executado após a gravação ter sido armazenada, e
nada no navegador pode revertê-la. Uma exceção lançada por ele é exibida como um aviso;
o salvamento em si é reportado como concluído, para que o formulário não ofereça a criação do
registro uma segunda vez.

## Definindo Callbacks

```typescript
import { defineCollection } from "@rebasepro/cms-types";

// The row shape is inferred from `properties`, so `values.title` below is a
// `string` without anything being written twice.
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values, id, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            values.updatedAt = new Date().toISOString();

            return values;
        },

        afterSave: async ({ values, id }) => {
            // Send notification
            console.log(`Article ${id} saved: ${values.title}`);
        },

        beforeDelete: async ({ id }) => {
            // Prevent deletion of published articles
            // Throw (or return false) to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Combinando conjuntos de callbacks

Na versão 0.24, combine
os conjuntos manualmente.

Uma coleção possui um único objeto `callbacks`. Quando várias preocupações exigem um hook,
como carimbos de data/hora (timestamps), uma trilha de auditoria e um escopo de locatário (tenant), escreva cada um como seu próprio conjunto
e combine-os com `composeCallbacks`:

```typescript
import { composeCallbacks, defineCollection } from "@rebasepro/cms-types";
import type { CollectionCallbacks } from "@rebasepro/types";

const timestamps: CollectionCallbacks = {
    beforeSave: ({ values, status }) => ({
        ...values,
        ...(status === "new" ? { createdAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString()
    })
};

const auditTrail: CollectionCallbacks = {
    afterSave: async ({ context, id, status }) => {
        await context.data.audit_log.create({ entity: "articles", entityId: String(id), action: status });
    }
};

export default defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: composeCallbacks(timestamps, auditTrail)
});
```

Os conjuntos são executados na ordem fornecida, e cada hook é combinado da mesma forma que o backend
combina seus próprios níveis [global](/docs/backend/hooks), de coleção e de propriedade:

| Hook | Combinado |
|---|---|
| `beforeSave` | Encadeado: cada conjunto vê os valores retornados pelo anterior, combinados superficialmente (shallow-merged) sobre o que foi recebido |
| `afterRead` | Encadeado: cada conjunto recebe a linha retornada pelo anterior |
| `beforeQuery` | Operação AND: cada conjunto vê a consulta do chamador, e uma linha deve passar por todas as restrições |
| `beforeDelete` | Qualquer `false` veta a exclusão; todos os conjuntos ainda são executados |
| `afterSave`, `afterDelete` | Executados em ordem, cada um aguardado (awaited); um erro interrompe os demais |
| `afterSaveError` | Executados em ordem; um erro não interrompe o próximo conjunto, e o primeiro erro é relançado ao final |

Um hook está no resultado apenas se algum conjunto o possuir, e um conjunto `undefined` é
ignorado. `composeCallbacks` também é exportado de `@rebasepro/server` e
`@rebasepro/common`.

Vincular callbacks após a inicialização com `backend.setCollectionCallbacks(slug,
callbacks)` **substitui** os declarados pela coleção. Para adicionar os seus a
eles, passe `composeCallbacks(declared, yours)`.

## Referência de Callbacks

### `beforeQuery`

Chamado **antes de uma leitura ser compilada**, para restringir quais linhas são solicitadas. Retorne
condições para aplicar com AND na consulta; não retorne nada para não adicionar nenhuma.

```typescript
beforeQuery: ({
    operation,   // "list" | "get" | "count" | "aggregate" | "relation"
    query,       // the parsed read, read-only
    context
}) => {
    if (context.user?.roles?.includes("admin")) return;
    return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
}
```

`afterRead` vê linhas que já foram buscadas, portanto, pode ocultar um valor,
mas não pode impedir que a linha seja lida. Este hook é executado antes, e três detalhes sobre ele
valem a pena conhecer:

- **Ele só pode restringir.** O valor de retorno é um filtro para aplicar com AND, e nenhum valor
  que ele possa retornar amplia a leitura. `filter` aceita os mesmos filtros de campo que uma
  consulta aceita; `logical` aceita um grupo `or`/`and`, para um escopo como "meu ou compartilhado
  comigo" — ainda aplicado com AND como um todo, de modo que o `or` apenas escolhe entre
  linhas que o restante da consulta já admite.
- **Ele dispara em todos os caminhos de leitura.** A listagem, a busca individual (get), a contagem, a
  agregação, a pesquisa, a leitura de vetor, uma listagem de caminho aninhado, a nova busca em tempo real
  por trás de um `.listen()`, e as linhas carregadas para uma relação ou um
  `?include=` — onde é o hook da coleção de **destino** que se aplica,
  porque essas são as linhas de destino.
- **Um filtro que ele não consiga compilar rejeita a requisição.** Nomear uma coluna que a tabela
  não possui resulta em 400, nunca em uma condição descartada.
- **Uma gravação em uma linha excluída por ele resulta em 404.** Uma atualização ou exclusão direcionada a
  uma linha fora do escopo é recusada antes da gravação, com a mesma resposta de "nenhuma linha …"
  que uma leitura fornece — portanto, um escopo é um escopo para gravações também, não apenas para
  leituras. Uma gravação de associação um-para-muitos (`comments: [ids]` em uma publicação) deixa um
  filho ocultado pelo escopo do destino onde está, assim como deixa um id que não referencia nenhuma
  linha. O que ele *não* controla são os valores sendo gravados: recusar uma gravação
  com base em seu conteúdo é função do `beforeSave`.

Uma leitura não é deliberadamente restringida: a verificação de unicidade por trás de
`validation: { unique: true }`. Ela pergunta se um valor existe em qualquer lugar da
tabela e, se restringida, responderia "único" para um valor que uma linha oculta já
possui.

:::caution[Apenas Postgres, por enquanto]
`beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção servida
por MongoDB ou Firestore que declare um **falha na inicialização**, nominalmente, em vez
de ser servida com o hook silenciosamente inerte — o que, para um filtro de linha,
significaria que todas as linhas seriam servidas para todos. Um `beforeQuery` [global](/docs/backend/hooks)
falha na inicialização da mesma forma se qualquer fonte de dados não for Postgres, e
o mesmo ocorre com um vinculado posteriormente com `setCollectionCallbacks`. A ocultação que funciona
em todos os motores é [`afterRead`](#afterread).
:::

→ [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) para
ver onde isso se encaixa entre as outras opções.

### `beforeSave`

Chamado antes de um registro ser gravado no banco de dados. Retorne os valores modificados.
No Postgres, ele é executado dentro da transação de gravação, que já foi iniciada, portanto,
mantém uma conexão do pool aberta durante todo o tempo em que é executado — consulte [Um callback retém uma
conexão](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (undefined for a new entity, unless the caller sent one)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lance um erro para **bloquear o salvamento**. A gravação nunca chega ao banco de dados, e
o chamador recebe **400** com sua mensagem e o código `CALLBACK_REJECTED`:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Para escolher o status e o código você mesmo — um 409 para um conflito, um 422 para algo
bem formatado, mas inaceitável — lance um `RebaseApiError`:

```typescript
import { RebaseApiError } from "@rebasepro/types";

beforeSave: async ({ values }) => {
    if (await isTaken(values.slug)) {
        throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
    }
    return values;
}
```

:::note
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. Um arquivo de coleção
é compartilhado com o frontend — a compilação Vite do painel de administração lê este mesmo
diretório — portanto, ele só pode importar pacotes executáveis em um navegador. `RebaseApiError`
é o seguro para o navegador, e é a mesma classe que o SDK tipado lança.
:::

### `afterSave`

Chamado após a linha ser gravada e antes do commit, dentro da mesma transação. Um lançamento de erro reverte o salvamento — consulte [Semântica de Transações](/docs/collections/context-data-api#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values: the row as stored, not afterRead's view of it
    id,             // Entity ID
    previousValues, // Previous values (undefined for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Same transaction as the save: the log row commits with the article or not at all
    await context.data.audit_log.create({ action: status, article_id: id, title: values.title });
}
```

### `afterSaveError`

Chamado quando uma operação de salvamento falha.

```typescript
afterSaveError: async ({
    values,
    id,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

Ele é executado para um salvamento que falhou no banco de dados ou após ele — não para uma
recusa de `beforeSave`, uma requisição recusada antes da gravação (validação, permissão
ausente, um 404), ou um commit recusado após o retorno do salvamento ([lista completa](/docs/backend/hooks/#when-aftersaveerror-runs)).

Em uma requisição, ele é executado assim que a transação da gravação com falha foi revertida, não
dentro dela. Seu `context.data` é novo para o mesmo chamador, onde cada chamada
é uma transação própria, de modo que um [job](/docs/backend/jobs), mensagem de fila ou
webhook enfileirado por ele faz commit e sobrevive à falha que ele relata. Um erro lançado de
`afterSaveError` é registrado em log, e o chamador ainda recebe o erro do próprio salvamento.

### `afterRead`

Chamado após a leitura de entidades do banco de dados. Transforma os dados para exibição.

Ele molda o que um chamador recebe — a resposta de uma leitura ou de uma gravação, e seu
quadro em tempo real — e nada mais: `afterSave`, `beforeDelete`, `afterDelete` e
[histórico](/docs/backend/history) recebem a linha como armazenada: um valor mascarado aqui
nunca é o que uma auditoria registra ou o que uma reversão grava de volta, e um campo adicionado aqui
nunca é gravado.

Uma agregação retorna somas e contagens, não linhas, portanto, não pode passar por
`afterRead`. Em uma coleção à qual um se aplica, apenas `count()` sem `groupBy`
é atendido; qualquer outra [agregação](/docs/sdk/aggregates-and-search/#aggregates) é
recusada com `400 AGGREGATE_MASKED_BY_AFTER_READ`.

```typescript
afterRead: async ({
    row,    // The row to transform
    context
}) => {
    // Add computed fields
    return {
        ...row,
        displayName: `${row.first_name} ${row.last_name}`
    };
}
```

### `beforeDelete`

Chamado antes de um registro ser excluído. Lance um erro para bloquear a exclusão, e o chamador receberá `400 CALLBACK_REJECTED` com sua mensagem. Retornar `false` também a bloqueia, como `403 CALLBACK_REJECTED` sem nenhuma mensagem sua.

```typescript
beforeDelete: async ({
    id,
    row,
    context
}) => {
    if (row.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Chamado após a linha ser excluída e antes do commit, dentro da mesma transação. Um lançamento de erro reverte a exclusão.

```typescript
afterDelete: async ({
    id,
    row,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${id} deleted`);
}
```

## Callbacks de Propriedade

Você também pode definir callbacks no nível da propriedade para transformações específicas de campos:

```typescript
properties: {
    email: {
        type: "string",
        name: "Email",
        callbacks: {
            beforeSave: ({ value }) => value?.toLowerCase().trim(),
            afterRead: ({ value }) => value // Could decrypt, etc.
        }
    }
}
```

Cada callback também recebe `context.data`, uma camada de dados para ler e gravar em outras coleções a partir de dentro do hook — consulte [A API `context.data`](/docs/collections/context-data-api).

## Sincronizando Dados Entre Coleções

Um dos usos mais poderosos dos callbacks é a **sincronização de dados entre coleções** usando `context.data`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const submissionsCollection = defineCollection({
    slug: "job_submissions",
    name: "Job Submissions",
    table: "job_submissions",
    properties: {
        title: { name: "Title", type: "string" },
        description: { name: "Description", type: "string" },
        company_id: { name: "Company", type: "string" },
        status: { name: "Status", type: "string" },
        promoted_job_id: { name: "Promoted job", type: "string" }
    },
    callbacks: {
        afterSave: async ({ values, id, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Update the submission with the promoted job reference
                await context.data.collection<Record<string, unknown>>("job_submissions").update(id, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Outros padrões entre coleções:

- **Exclusão em cascata**: Use `afterDelete` para remover registros relacionados em coleções filhas
- **Desnormalização**: Use `afterSave` para atualizar campos de resumo em uma coleção pai
- **Registro de auditoria**: Use `afterSave` / `afterDelete` para gravar em uma coleção de log de auditoria
- **Contadores**: Use `afterSave` / `afterDelete` para atualizar campos de contagem em entidades relacionadas

## Testando um callback

Um callback é uma função simples de um único objeto de propriedades (props), portanto, um teste unitário a chama diretamente.
`createCallContext` constrói a prop `context`: os campos que você passa são usados como
estão, e qualquer um que você omitir é um substituto que lança um erro no primeiro uso, identificando a
si mesmo, de forma que um teste forneça apenas o que o hook realmente utiliza.

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallContext } from "@rebasepro/server";
import type { User } from "@rebasepro/types";
import articlesCollection from "../config/collections/articles";

const editor: User = {
    uid: "u1", displayName: null, email: null, photoURL: null,
    providerId: "password", isAnonymous: false, roles: ["editor"]
};

test("beforeSave derives the slug from the title", async () => {
    const values = await articlesCollection.callbacks!.beforeSave!({
        collection: articlesCollection,
        path: "articles",
        status: "new",
        values: { title: "Hello World" },
        context: createCallContext({ user: editor })
    });
    assert.equal(values.slug, "hello-world");
});
```

Um hook que lê ou grava através de `context.data` precisa de um driver: passe
`createCallContext({ data: buildSdkData(driver) })`, com `buildSdkData` de
`@rebasepro/common` e qualquer `DataDriver`, incluindo um em memória. `user`
permanece ausente a menos que você o passe, como acontece em uma gravação sem chamador, de forma que um
ramo `if (context.user)` seja testado com precisão. Para executar hooks contra um banco de dados
real, consulte [Scripts e o Console](/docs/backend/scripts/).

## Referência Completa do Context

Cada callback recebe um objeto `context` do tipo `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** The authenticated user, if any */
    user?: User;
    /** The driver running this operation (server-side only) */
    driver?: DataDriver;
    /** The query accessor — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Functions, storage, email and dataAsAdmin — but no `data` */
    client: RebaseCallbackClient;
    /** The default storage source */
    storageSource: StorageSource;
}
```

Faça consultas através de `context.data`. `context.client` não possui `data`: no lado do servidor, ele é
o singleton `rebase`, cujo único plano de dados é o `dataAsAdmin` com escopo de administrador,
portanto, `context.client.data` gera um erro de compilação. Para construir um destes para um teste,
consulte [Testando um callback](#testando-um-callback).

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança a Nível de Linha (RLS)
- **[Histórico da Entidade](/docs/backend/history)** — Trilha de auditoria
- **[Funções Customizadas](/docs/backend/custom-functions)** — Adicionar endpoints de API personalizados
