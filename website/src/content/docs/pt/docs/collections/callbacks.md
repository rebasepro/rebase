---
sourceHash: 3885c8f3dc44eb65
title: Callbacks de Entidade
sidebar_label: Callbacks
description: Use callbacks de ciclo de vida para executar lógica personalizada quando entidades forem criadas, atualizadas, lidas ou excluídas. Inclui a API context.data para operações entre coleções.
---

## Visão Geral

Os callbacks permitem que você se conecte ao ciclo de vida da entidade para:

- **Sincronizar dados entre coleções** — copiar ou mover entidades entre tabelas em alterações de status
- **Transformar dados** antes de salvar (campos computados, geração de slugs)
- **Validar** regras de negócio além da validação de schema
- **Disparar efeitos colaterais** após gravações (enviar e-mails, sincronizar APIs, atualizar caches)
- **Restringir uma leitura** antes que ela seja compilada, para que o chamador veja apenas suas próprias linhas
- **Filtrar/transformar** dados após a leitura
- **Operações em cascata** — limpar registros relacionados na exclusão

## Onde os callbacks são executados

Uma coleção possui dois blocos de callback, e a única diferença é qual runtime os executa.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Executa em | no servidor | no painel de administração, no navegador |
| Disparado para | REST, o SDK, realtime, `dataAsAdmin` | leituras e gravações feitas pelo painel |
| Chega ao navegador | não — os corpos são removidos do bundle | sim, na íntegra |
| Usar para | tudo o que está abaixo | coleções com as quais o painel se comunica diretamente |

**`callbacks` é o que você procura.** Ele executa em todos os caminhos de dados que chegam ao servidor — REST, o SDK, realtime, MCP e `rebase.data` — e seu corpo nunca sai da máquina, portanto, uma chave de API ou uma leitura de `process.env` ali é segura. O restante desta página é sobre `callbacks`.

Um gravador não é um caminho de dados: **o sistema de autenticação**. O cadastro, o login via OAuth e o gerenciamento de usuários do painel gravam as linhas de usuários diretamente e não executam nenhum de seus callbacks; portanto, um e-mail de boas-vindas em `afterSave` em `users` nunca é disparado no cadastro. Vincule-o aos [auth hooks](/docs/backend/authentication/) passados em `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — que recebem um backend ejetado; a inicialização avisa quando a coleção de usuários declara callbacks que o cadastro não executará.

`admin.browserCallbacks` existe para um único caso: uma coleção em um transporte `direct` ou `custom`, a qual o painel lê e grava *por si próprio*, sem nenhum servidor Rebase no caminho da requisição. Nada no lado do servidor vê essas operações, portanto, `callbacks` nunca pode ser disparado para elas, e este bloco é o único lugar onde sua lógica de ciclo de vida pode residir.

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

Duas regras decorrem de "enviado para todo visitante", e nenhuma delas é apenas estilística:

1. **Sem segredos.** Nada de chaves de API, nada de `process.env`, nada que você se importaria que um leitor do bundle visse. Isso pertence a `callbacks`.
2. **Não é um limite de segurança.** Um `browserCallbacks.afterRead` que oculta um campo o faz *depois* que o navegador já possui a linha — em um transporte direto, o documento bruto veio diretamente do armazenamento de dados. É apenas apresentação. A ocultação que precisa ser garantida vai em `callbacks` ou nas próprias regras do store.

Em uma coleção com transporte de servidor — o padrão, e quase certamente a sua — o servidor já executou `callbacks` antes que a linha chegue ao painel, de modo que um `browserCallbacks.afterRead` é executado *além* dele. Escreva-o para ser idempotente, ou não o escreva.

Ambos os blocos recebem a mesma coisa: linhas conforme o servidor as envia, uma data como sua string ISO e um belongsTo como sua coluna de chave estrangeira. Isso vale para cada gravação feita pelo painel — o salvamento de um formulário de registro, uma edição inline em tabela, `useRowWrites`, e uma gravação por meio do `context.data` do navegador —, portanto, o mesmo corpo de callback funciona em qualquer um dos blocos. O que um `browserCallbacks.beforeSave` altera na linha que retorna é o que o formulário salva. O `context` que ele recebe é o do navegador: seu `data` lê linhas da mesma maneira, e uma gravação através dele também executa o `browserCallbacks` da coleção; assim, um hook que grava em sua própria coleção executa a si mesmo novamente.

Um `browserCallbacks.afterSave` é executado após a gravação ter sido armazenada, e nada no navegador pode revertê-la. Um throw lançado por ele é exibido como um aviso; o salvamento em si é reportado como concluído, de modo que o formulário não ofereça a criação do registro uma segunda vez.

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

Na versão 0.24, combine os conjuntos manualmente.

Uma coleção possui um único objeto `callbacks`. Quando várias preocupações demandam um hook cada, como timestamps, uma trilha de auditoria e um escopo de tenant, escreva cada uma como seu próprio conjunto e combine-as com `composeCallbacks`:

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

Os conjuntos são executados na ordem fornecida, e cada hook se combina da mesma forma que o backend combina suas próprias camadas [globais](/docs/backend/hooks), de coleção e de propriedade:

| Hook | Combinação |
|---|---|
| `beforeSave` | Encadeado: cada conjunto vê os valores retornados pelo anterior, combinados superficialmente (shallow-merge) sobre o que foi fornecido |
| `afterRead` | Encadeado: cada conjunto recebe a linha retornada pelo anterior |
| `beforeQuery` | Combinado com AND: todo conjunto vê a consulta do chamador, e uma linha deve passar por todas as restrições |
| `beforeDelete` | Qualquer `false` veta a exclusão; todos os conjuntos ainda são executados |
| `afterSave`, `afterDelete` | Executados em ordem, cada um aguardado (awaited); um throw interrompe os demais |
| `afterSaveError` | Executados em ordem; um throw não interrompe o próximo conjunto, e o primeiro erro é lançado novamente ao final |

Um hook só está presente no resultado se algum conjunto o possuir, e um conjunto `undefined` é ignorado. O `composeCallbacks` também é exportado de `@rebasepro/server` e `@rebasepro/common`.

Anexar callbacks após a inicialização com `backend.setCollectionCallbacks(slug, callbacks)` **substitui** os que a coleção declarou. Para adicionar os seus a eles, passe `composeCallbacks(declared, yours)`.

## Referência de Callbacks

### `beforeQuery`

Chamado **antes de uma leitura ser compilada**, para restringir quais linhas ela solicita. Retorne condições para aplicar com AND na consulta; não retorne nada para não adicionar nenhuma.

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

O `afterRead` vê linhas que já foram buscadas, portanto, pode ocultar um valor, mas não pode impedir que a linha seja lida. Este é executado antes, e três coisas sobre ele valem a pena saber:

- **Ele só pode restringir.** O valor de retorno é um filtro a ser aplicado com AND, e nenhum valor retornado pode ampliar a leitura. `filter` aceita os mesmos filtros de campo que uma consulta aceita; `logical` aceita um grupo `or`/`and`, para um escopo como "meu ou compartilhado comigo" — ainda combinado com AND no todo, de modo que o `or` apenas escolha entre as linhas que o restante da consulta já admite.
- **Ele é disparado em todos os caminhos de leitura.** A listagem, a busca individual (get), a contagem, a agregação, a busca, a leitura vetorial, a listagem de caminhos aninhados, a nova busca em tempo real por trás de um `.listen()`, e as linhas carregadas para uma relação ou um `?include=` — onde é o hook da coleção de **destino** que se aplica, pois essas são as linhas do destino.
- **Um filtro que ele não consegue compilar recusa a requisição.** Informar uma coluna que a tabela não possui resulta em um 400, nunca em uma condição descartada.
- **Uma gravação em uma linha que ele exclui é um 404.** Uma atualização ou exclusão direcionada a uma linha fora do escopo é recusada antes da gravação, com a mesma resposta de "nenhuma linha…" que uma leitura fornece — portanto, um escopo é um escopo para gravações também, não apenas para leituras. Uma gravação de associação um-para-muitos (`comments: [ids]` em uma postagem) deixa um filho oculto pelo escopo de destino onde ele estiver, pois deixa um id que não referencia nenhuma linha. O que ele *não* controla são os valores sendo gravados: recusar uma gravação com base no seu conteúdo é papel do `beforeSave`.

Uma leitura deliberadamente não é restringida: a verificação de unicidade por trás de `validation: { unique: true }`. Ela pergunta se um valor existe em qualquer lugar da tabela e, se fosse restringida, responderia "único" para um valor que uma linha oculta já possui.

:::caution[Apenas Postgres, por enquanto]
O `beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção atendida por MongoDB ou Firestore que declare um **falha na inicialização**, pelo nome, em vez de ser disponibilizada com o hook silenciosamente inerte — o que, para um filtro de linha, significaria fornecer todas as linhas para todo mundo. Um `beforeQuery` [global](/docs/backend/hooks) falha na inicialização da mesma forma se qualquer fonte de dados não for Postgres, assim como um anexado posteriormente com `setCollectionCallbacks`. A ocultação que funciona em todos os mecanismos é [`afterRead`](#afterread).
:::

→ [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) para entender onde isso se posiciona entre as outras opções.

### `beforeSave`

Chamado antes de um registro ser gravado no banco de dados. Retorne os valores modificados. No Postgres, ele é executado dentro da transação de gravação, que já foi iniciada, de modo que retém uma conexão do pool durante todo o tempo de sua execução — consulte [Um callback retém uma conexão](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Lance um erro para **bloquear o salvamento**. A gravação nunca chega ao banco de dados e o chamador recebe **400** com sua mensagem e o código `CALLBACK_REJECTED`:

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

Para escolher o status e o código por conta própria — um 409 para conflito, um 422 para algo bem formatado, mas inaceitável — lance um `RebaseApiError`:

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
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. O arquivo de uma coleção é compartilhado com o frontend — a compilação Vite do painel de administração lê este mesmo diretório —, portanto, ele só pode importar pacotes que rodam no navegador. O `RebaseApiError` é a versão segura para o navegador e é a mesma classe lançada pelo SDK tipado.
:::

### `afterSave`

Chamado após a linha ser gravada e antes do commit, dentro da mesma transação. Um throw reverte o salvamento — consulte [Semântica de Transações](/docs/collections/context-data-api#transaction-semantics).

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

Ele é executado para um salvamento que falhou no banco de dados ou após ele — não para uma recusa em `beforeSave`, uma requisição recusada antes da gravação (validação, permissão ausente, um 404) ou um commit recusado após o retorno do salvamento ([lista completa](/docs/backend/hooks/#when-aftersaveerror-runs)).

Em uma requisição, ele é executado depois que a transação da gravação com falha foi revertida, não dentro dela. Seu `context.data` é uma instância nova para o mesmo chamador, onde cada chamada é uma transação própria, de modo que um [job](/docs/backend/jobs), mensagem de fila ou webhook que ele enfileirar seja comitado e sobreviva à falha reportada. Um throw de `afterSaveError` é registrado nos logs, e o chamador ainda recebe o erro do próprio salvamento.

### `afterRead`

Chamado após a leitura de entidades do banco de dados. Transforme os dados para exibição.

Ele molda o que o chamador recebe — a resposta de uma leitura ou de uma gravação, e seu frame de realtime — e nada mais: `afterSave`, `beforeDelete`, `afterDelete` e o [histórico](/docs/backend/history) recebem a linha conforme armazenada: um valor mascarado aqui nunca é o que uma auditoria registra ou o que uma reversão grava de volta, e um campo adicionado aqui nunca é gravado.

Uma agregação retorna somas e contagens, não linhas, portanto, não pode passar por `afterRead`. Em uma coleção à qual ela se aplica, apenas `count()` sem `groupBy` é atendido; qualquer outro [agregado](/docs/sdk/aggregates-and-search/#aggregates) é recusado com `400 AGGREGATE_MASKED_BY_AFTER_READ`.

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

Chamado antes de um registro ser excluído. Lance um erro para bloquear a exclusão, e o chamador receberá `400 CALLBACK_REJECTED` com sua mensagem. Retornar `false` também a bloqueia, como `403 CALLBACK_REJECTED` sem mensagem personalizada.

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

Chamado após a linha ser excluída e antes do commit, dentro da mesma transação. Um throw reverte a exclusão.

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

Cada callback também recebe `context.data`, uma camada de dados para ler e gravar em outras coleções de dentro do hook — consulte [A API `context.data`](/docs/collections/context-data-api).

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

Um callback é uma função comum que recebe um único objeto de propriedades, portanto, um teste unitário simplesmente a chama. O `createCallContext` constrói a propriedade `context`: os campos que você passa são usados como estão, e qualquer um que você omitir é um substituto que lança um erro no primeiro uso, identificando-se pelo nome, de modo que um teste forneça apenas o que o hook realmente utiliza.

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

Um hook que lê ou grava via `context.data` precisa de um driver: passe `createCallContext({ data: buildSdkData(driver) })`, com `buildSdkData` de `@rebasepro/common` e qualquer `DataDriver`, incluindo um em memória. `user` permanece ausente a menos que você o passe, exatamente como em uma gravação sem chamador, de forma que uma ramificação `if (context.user)` seja testada com fidelidade. Para executar hooks contra um banco de dados real, consulte [Scripts e o Console](/docs/backend/scripts/).

## Referência Completa do Context

Todo callback recebe um objeto `context` do tipo `RebaseCallContext`:

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

Faça consultas por meio de `context.data`. O `context.client` não possui `data`: no lado do servidor, ele é o singleton `rebase`, cujo único plano de dados é o `dataAsAdmin` com escopo de administrador, portanto, `context.client.data` resulta em um erro de compilação. Para construir um desses para um teste, consulte [Testando um callback](#testando-um-callback).

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha (Row Level Security)
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Customizadas](/docs/backend/custom-functions)** — Adicione endpoints de API personalizados
