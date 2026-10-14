---
sourceHash: c3af858aa8d11859
title: Callbacks de Entidade
sidebar_label: Callbacks
description: Use callbacks de ciclo de vida para executar lógica personalizada quando entidades forem criadas, atualizadas, lidas ou excluídas. Inclui a API context.data para operações entre coleções.
---

## Visão geral

Os callbacks permitem interceptar o ciclo de vida da entidade para:

- **Sincronizar dados entre coleções** — copiar ou mover entidades entre tabelas em mudanças de status
- **Transformar dados** antes de salvar (campos computados, geração de slugs)
- **Validar** regras de negócio além da validação de schema
- **Disparar efeitos colaterais** após gravações (enviar e-mails, sincronizar APIs, atualizar caches)
- **Restringir uma leitura** antes de ser compilada, para que o chamador veja apenas as suas próprias linhas
- **Filtrar/transformar** dados após a leitura
- **Operações em cascata** — limpar registros relacionados na exclusão

## Onde os callbacks são executados

Uma coleção possui dois blocos de callback, e a única diferença é qual runtime os executa.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Executa em | o servidor | o painel admin, no navegador |
| Disparado para | REST, o SDK, realtime, `dataAsAdmin` | leituras e gravações feitas pelo painel |
| Chega ao navegador | não — os corpos são removidos do bundle | sim, na íntegra |
| Use para | tudo abaixo | coleções com as quais o painel se comunica diretamente |

**`callbacks` é o que você deseja.** Ele é executado em todo caminho de dados que chega ao servidor — REST, o SDK, realtime, MCP e `rebase.data` — e seu corpo nunca sai da máquina, então uma chave de API ou uma leitura de `process.env` ali é segura. O restante desta página é sobre `callbacks`.

Um gravador não é um caminho de dados: **o sistema de autenticação**. O
cadastro, o login via OAuth e a gestão de usuários do admin gravam as linhas de
`users` diretamente e não executam nenhum de seus callbacks, então um e-mail
de boas-vindas no `afterSave` de `users` nunca dispara no cadastro. Coloque-o
nos [hooks de autenticação](/docs/backend/authentication/) passados em
`auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — que
exigem um backend ejetado; o boot avisa quando a coleção de usuários declara
callbacks que o cadastro não vai executar.

O `admin.browserCallbacks` existe para um único caso: uma coleção em um transporte `direct` ou `custom`, que o próprio painel lê e grava sem nenhum servidor Rebase no caminho da requisição. Nada do lado do servidor vê essas operações, portanto, `callbacks` nunca pode ser disparado para elas, e este bloco é o único lugar onde a lógica de ciclo de vida pode residir.

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

Duas regras decorrem de "enviado para cada visitante", e nenhuma delas é apenas estilística:

1. **Sem segredos.** Nada de chaves de API, nada de `process.env`, nada que você se importaria que um leitor do bundle visse. Isso pertence a `callbacks`.
2. **Não é um limite de segurança.** Um `browserCallbacks.afterRead` que oculta um campo faz isso *depois* que o navegador já possui a linha — em um transporte direto, o documento bruto veio diretamente do armazenamento. É apenas apresentação. Ocultações que precisam ser garantidas devem ficar em `callbacks`, ou nas próprias regras do banco de dados.

Em uma coleção com transporte via servidor — o padrão, e quase certamente a sua —, o servidor já executou `callbacks` antes de a linha chegar ao painel, portanto, um `browserCallbacks.afterRead` é executado *além* dele. Escreva-o para ser idempotente, ou não o escreva.

Um `browserCallbacks.afterSave` é executado depois que a gravação já foi armazenada, e
nada no navegador pode desfazê-la. Um erro lançado por ele é exibido como um aviso;
o salvamento em si é reportado como concluído, de modo que o formulário não se oferece para criar o
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

Na 0.24, combine
os conjuntos à mão.

Uma coleção tem um único objeto `callbacks`. Quando várias preocupações querem
cada uma um hook, como timestamps, uma trilha de auditoria e um escopo de tenant,
escreva cada uma como seu próprio conjunto e combine-os com `composeCallbacks`:

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

Os conjuntos rodam na ordem em que foram dados, e cada hook se combina da maneira
como o backend combina seus próprios níveis [global](/docs/backend/hooks), de
coleção e de propriedade:

| Hook | Combinado |
|---|---|
| `beforeSave` | Encadeado: cada conjunto vê os valores que o anterior retornou, mesclados de forma rasa (shallow merge) sobre o que ele recebeu |
| `afterRead` | Encadeado: cada conjunto recebe a linha que o anterior retornou |
| `beforeQuery` | Combinado com AND: todo conjunto vê a consulta do chamador, e uma linha deve passar por cada restrição |
| `beforeDelete` | Qualquer `false` veta a exclusão; todo conjunto ainda assim roda |
| `afterSave`, `afterDelete` | Rodam em ordem, cada um aguardado (awaited); um throw interrompe o restante |
| `afterSaveError` | Rodam em ordem; um throw não interrompe o próximo conjunto, e o primeiro erro é relançado no final |

Um hook está no resultado apenas se algum conjunto o tiver, e um conjunto
`undefined` é ignorado. `composeCallbacks` também é exportado de
`@rebasepro/server` e `@rebasepro/common`.

Anexar callbacks depois da inicialização com `backend.setCollectionCallbacks(slug,
callbacks)` **substitui** os que a coleção declarou. Para somar os seus a eles,
passe `composeCallbacks(declared, yours)`.

## Referência de Callbacks

### `beforeQuery`

Chamado **antes de uma leitura ser compilada**, para restringir quais linhas ela solicita. Retorne condições para concatenar com AND na consulta; retorne nada para não adicionar nenhuma.

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

O `afterRead` enxerga linhas que já foram buscadas, portanto pode ocultar um valor, mas não pode impedir que a linha seja lida. Este é executado antes, e vale a pena saber três coisas sobre ele:

- **Ele só pode restringir.** O valor de retorno é um filtro a ser adicionado com AND, e nenhum valor retornado pode expandir a leitura. `filter` aceita os mesmos filtros de campo que uma consulta aceita; `logical` aceita um grupo `or`/`and`, para um escopo como "meus, ou compartilhados comigo" — ainda concatenados com AND como um todo, de modo que o `or` sempre escolha apenas entre as linhas que o restante da consulta já admite.
- **Dispara em todos os caminhos de leitura.** A listagem, o get individual, a contagem, a agregação, a busca, a leitura de vetor, uma listagem de caminho aninhado, a revalidação em tempo real sob um `.listen()`, e as linhas carregadas para uma relação ou `?include=` — onde é o hook da coleção de **destino** que se aplica, pois essas são as linhas de destino.
- **Um filtro que não pode ser compilado recusa a requisição.** Nomear uma coluna que a tabela não possui resulta em 400, nunca em uma condição ignorada.
- **Uma gravação em uma linha excluída por ele resulta em 404.** Uma atualização ou exclusão direcionada a uma linha fora do escopo é recusada antes da gravação, com a mesma resposta de "nenhuma linha..." que uma leitura daria — portanto, um escopo é um escopo também para gravações, não apenas para leituras. Uma gravação de pertença um-para-muitos (`comments: [ids]` em um post) deixa onde está um filho que o escopo do alvo oculta, tal como deixa um id que não nomeia nenhuma linha. O que ele *não* bloqueia são os valores sendo gravados: recusar uma gravação com base em seu conteúdo é responsabilidade do `beforeSave`.

Uma leitura é deliberadamente não restringida: a verificação de unicidade por trás de `validation: { unique: true }`. Ela verifica se um valor existe em qualquer lugar da tabela e, se fosse restringida, responderia "único" para um valor que uma linha oculta já possui.

:::caution[Apenas Postgres, por enquanto]
O `beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção atendida por MongoDB ou Firestore que declare um hook **falha na inicialização**, nominalmente, em vez de ser servida com o hook silenciosamente inativo — o que, para um filtro de linhas, significaria entregar todas as linhas para todo mundo. Um `beforeQuery` [global](/docs/backend/hooks) falha na inicialização da mesma forma se qualquer fonte de dados não for Postgres, assim como um adicionado posteriormente com `setCollectionCallbacks`. A ocultação que funciona em qualquer mecanismo é o [`afterRead`](#afterread).
:::

→ [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) para saber onde isso se posiciona entre as outras opções.

### `beforeSave`

Chamado antes que um registro seja gravado no banco de dados. Retorne os valores modificados.
No Postgres, ele é executado dentro da transação da gravação, que já começou, de modo que
mantém uma conexão do pool pelo tempo em que executa — veja [Um callback segura uma
conexão](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lance um erro para **bloquear o salvamento**. A gravação nunca chega ao banco de dados, e o chamador recebe um status **400** com sua mensagem e o código `CALLBACK_REJECTED`:

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

Para escolher o status e o código por conta própria — um 409 para conflito, um 422 para algo bem-formado mas inaceitável —, lance um `RebaseApiError`:

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
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. Um arquivo de coleção é compartilhado com o frontend — o build do Vite do painel admin lê esse mesmo diretório —, portanto, ele só pode importar pacotes que rodam em um navegador. `RebaseApiError` é o seguro para navegadores e é a mesma classe lançada pelo SDK tipado.
:::

### `afterSave`

Chamado após a linha ser gravada e antes do commit, dentro da mesma transação. Lançar um erro desfaz o salvamento (rollback) — veja [Semântica de Transações](/docs/collections/context-data-api#transaction-semantics).

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

Ele é executado para um salvamento que falhou no banco de dados ou depois dele
— não para uma recusa do `beforeSave`, uma requisição recusada antes da
gravação (validação, permissão ausente, um 404), ou um commit recusado depois
que o salvamento retornou ([lista completa](/docs/backend/hooks/#when-aftersaveerror-runs)).

Em uma requisição, ele é executado depois que a transação da gravação que falhou sofreu rollback, e não dentro dela. Seu `context.data` é um novo, para o mesmo chamador, em que cada chamada é uma transação própria, de modo que um [job](/docs/backend/jobs), uma mensagem de fila ou um webhook que ele enfileire realiza o commit e sobrevive à falha que relata. Um erro lançado por `afterSaveError` é registrado no log, e o chamador ainda recebe o erro do próprio salvamento.

### `afterRead`

Chamado após a leitura de entidades do banco de dados. Transforme os dados para exibição.

Ele molda o que um chamador recebe — a resposta de uma leitura ou de uma
escrita, e seu frame de realtime — e nada mais: o `afterSave`, o
`beforeDelete`, o `afterDelete` e o [histórico](/docs/backend/history) recebem
a linha como ela foi armazenada: um valor mascarado aqui nunca é o que uma
auditoria registra ou um revert grava de volta, e um campo adicionado aqui
nunca é escrito.

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

Chamado antes que um registro seja excluído. Lance um erro para bloquear a exclusão, e quem chamou recebe `400 CALLBACK_REJECTED` com a sua mensagem. Retornar `false` também a bloqueia, como `403 CALLBACK_REJECTED` sem nenhuma mensagem sua.

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

Chamado após a linha ser excluída e antes do commit, dentro da mesma transação. Lançar um erro reverte a exclusão (rollback).

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

Você também pode definir callbacks no nível de propriedade para transformações específicas de campos:

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

Cada callback recebe também `context.data`, uma camada de dados para ler e gravar outras coleções de dentro do hook — veja [A API `context.data`](/docs/collections/context-data-api).

## Sincronizando Dados Entre Coleções

Um dos usos mais poderosos dos callbacks é **sincronizar dados entre coleções** usando `context.data`:

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

Um callback é uma função simples de um único objeto de props, então um teste unitário a chama.
O `createCallContext` monta a prop `context`: os campos que você passa são usados
como estão, e qualquer um que você deixe de fora é um substituto que lança um erro no primeiro uso, nomeando
a si mesmo, de modo que um teste fornece apenas o que o hook realmente toca.

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

Um hook que lê ou escreve por meio de `context.data` precisa de um driver: passe
`createCallContext({ data: buildSdkData(driver) })`, com `buildSdkData` de
`@rebasepro/common` e qualquer `DataDriver`, inclusive um em memória. O `user`
permanece ausente a menos que você o passe, como acontece em uma escrita sem chamador, de modo que um
ramo `if (context.user)` é testado de forma honesta. Para rodar hooks contra um banco de dados
real, veja [Scripts e o Console](/docs/backend/scripts/).

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

Faça consultas por meio de `context.data`. `context.client` não possui `data`: no lado do servidor, ele é o singleton `rebase`, cujo único plano de dados é o `dataAsAdmin` com escopo de admin; portanto, `context.client.data` gera um erro de compilação. Para montar um desses para um teste,
veja [Testando um callback](#testando-um-callback).

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Customizadas](/docs/backend/custom-functions)** — Adicionar endpoints de API personalizados
