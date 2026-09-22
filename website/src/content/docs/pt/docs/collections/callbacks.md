---
sourceHash: a45467350cfc4cad
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

**`callbacks` é o que você deseja.** Ele é executado em todos os caminhos que chegam ao servidor, de modo que nada o contorna, e seu corpo nunca sai da máquina — uma chave de API ou uma leitura de `process.env` ali é segura. O restante desta página é sobre `callbacks`.

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
            // Throw to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

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
- **Uma gravação em uma linha excluída por ele resulta em 404.** Uma atualização ou exclusão direcionada a uma linha fora do escopo é recusada antes da gravação, com a mesma resposta de "nenhuma linha..." que uma leitura daria — portanto, um escopo é um escopo também para gravações, não apenas para leituras. O que ele *não* bloqueia são os valores sendo gravados: recusar uma gravação com base em seu conteúdo é responsabilidade do `beforeSave`.

Uma leitura é deliberadamente não restringida: a verificação de unicidade por trás de `validation: { unique: true }`. Ela verifica se um valor existe em qualquer lugar da tabela e, se fosse restringida, responderia "único" para um valor que uma linha oculta já possui.

:::caution[Apenas Postgres, por enquanto]
O `beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção atendida por MongoDB ou Firestore que declare um hook **falha na inicialização**, nominalmente, em vez de ser servida com o hook silenciosamente inativo — o que, para um filtro de linhas, significaria entregar todas as linhas para todo mundo. Um `beforeQuery` [global](/docs/backend/hooks) falha na inicialização da mesma forma se qualquer fonte de dados não for Postgres, assim como um adicionado posteriormente com `setCollectionCallbacks`. A ocultação que funciona em qualquer mecanismo é o [`afterRead`](#afterread).
:::

→ [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) para saber onde isso se posiciona entre as outras opções.

### `beforeSave`

Chamado antes que um registro seja gravado no banco de dados. Retorne os valores modificados.

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
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. Um arquivo de coleção é compartilhado com o frontend — o build do Vite do painel admin lê esse mesmo diretório —, portanto, ele só pode importar pacotes que rodam em um navegador. `RebaseApiError` é o seguro para navegadores e é a mesma classe lançada pelo SDK cliente.
:::

### `afterSave`

Chamado após a linha ser gravada e antes do commit, dentro da mesma transação. Lançar um erro desfaz o salvamento (rollback) — veja [Semântica de Transações](#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values
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

### `afterRead`

Chamado após a leitura de entidades do banco de dados. Transforme os dados para exibição.

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

Chamado antes que um registro seja excluído. Lance um erro para bloquear a exclusão.

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

## A API `context.data`

Cada callback recebe um objeto `context` que inclui `context.data` — uma camada unificada de acesso a dados para realizar **operações entre coleções** a partir de hooks de ciclo de vida.

### Acessando Coleções

O `context.data` usa um Proxy JavaScript, portanto você pode acessar qualquer coleção pelo seu slug como uma propriedade:

```typescript
afterSave: async ({ values, entityId, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Métodos Disponíveis

Cada acessor de coleção (`context.data.<slug>`) fornece estes métodos:

| Método | Assinatura | Descrição |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Consultar entidades com filtros, ordenação e paginação |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Buscar uma única entidade por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Criar uma nova entidade |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Atualizar uma entidade existente |
| `.delete()` | `delete(id: string \| number) → void` | Excluir um registro |
| `.count()` | `count(params?: FindParams) → number` | Contar entidades correspondentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Inscrição em tempo real (onde suportado) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escutar uma única entidade |

### Consultando com `.find()`

O método `find()` oferece suporte a filtros avançados:

```typescript
afterSave: async ({ values, context }) => {
    // Simple equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: "published" },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // PostgREST-style operators
    const { data: recentJobs } = await context.data.jobs.find({
        where: {
            status: "eq.published",
            salary: "gte.50000"
        }
    });

    // Tuple syntax
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Criando Entidades

```typescript
afterSave: async ({ values, entityId, previousValues, context }) => {
    // Promote an approved submission to a published job
    if (values.status === "approved" && previousValues?.status !== "approved") {
        const newJob = await context.data.jobs.create({
            title: values.title,
            description: values.description,
            company_id: values.company_id,
            status: "published",
            source_submission_id: entityId,
        });

        // Link back to the original submission
        await context.data["job-submissions"].update(entityId, {
            promoted_job_id: newJob.id,
        });
    }
}
```

### Segurança: com quais privilégios o `context.data` é executado

:::important
**`context.data` herda os privilégios do que quer que tenha disparado o callback.** Não se trata de um nível de confiança fixo.

- Disparado por uma **requisição do usuário** (REST, realtime, uma edição no painel admin) → **escopo de usuário**. O callback é executado dentro da transação vinculada a RLS aberta para essa requisição, portanto, as políticas se aplicam a leituras *e* gravações. Um callback não pode ver uma linha que seu chamador não pôde.
- Disparado por **`rebase.dataAsAdmin` ou um cron job** (o mesmo singleton) → **escopo de admin**, não sem escopo. Esse driver é delimitado como `{ uid: "service", roles: ["admin"] }`, de modo que o callback ainda roda em uma transação vinculada a RLS — suas políticas são avaliadas contra essa identidade.
- Disparado pelo **driver base** (fluxos internos de autenticação, migrações) → **sem escopo**. Ele é executado na conexão do proprietário e ignora o RLS.
:::

Isso é especialmente relevante na direção que falha silenciosamente. O RLS *filtra*, ele não lança erros — portanto, um callback que lê uma linha irmã a encontrará quando uma tarefa de admin salvar, e poderá não encontrar nada quando um usuário final salvar, sem erros em nenhum dos casos. Escreva callbacks que tolerem um resultado vazio, ou acesse o plano de admin deliberadamente:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Esta página costumava dizer o oposto]
Versões anteriores desta página afirmavam que os callbacks sempre ignoravam o RLS e tinham "acesso total ao banco de dados, independentemente das permissões do usuário acionador". Isso estava errado, e errado na direção insegura — incentivava callbacks escritos sob a premissa de que sempre podiam ver tudo.

O comportamento acima é verificado de ponta a ponta no Postgres pelo caso `"scopes context.data to the caller when a callback runs on a user request"` na suíte de imposição de RLS de `@rebasepro/server-postgres`.
:::

### Semântica de Transações

:::important
**As gravações de `context.data` de um callback fazem parte da gravação que o disparou.** No Postgres, `beforeSave`, o salvamento e `afterSave` — ou `beforeDelete`, a exclusão e `afterDelete` — são executados dentro de uma única transação, cada callback aguardado antes do commit, e o `context.data` grava por meio dessa mesma transação.
:::

Portanto, a gravação que disparou o evento e tudo o que seus callbacks gravaram realizam commit juntos ou não realizam de forma alguma:

- Um erro lançado em `afterSave` ou `afterDelete` reverte (rollback) a gravação acionadora, junto com todas as gravações de `context.data` feitas pelos callbacks. O chamador recebe a resposta **400 `CALLBACK_REJECTED`** com `details.stage` indicando o hook — ou com o próprio status do erro quando este o contiver: um `RebaseApiError` que você lançou, o 409 de uma violação de unicidade.
- Assinantes em tempo real são notificados sobre a linha apenas após o commit, portanto, uma gravação revertida nunca é anunciada.
- Um callback mantém a transação aberta enquanto executa; portanto, um callback lento significa um lock retido e uma conexão do pool ocupada.

Permita que uma falha lance um erro quando a gravação de origem não deva sobreviver a ela. Trate-a com catch quando ela dever: a gravação com falha é desfeita isoladamente, e o restante realiza o commit.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Tarefas que precisam sair do banco de dados — um e-mail, um webhook, uma chamada a uma API de terceiros — não pertencem ao corpo do callback. Elas manteriam a transação aberta durante uma viagem de ida e volta de rede (network round trip), e nada poderá desfazê-las caso a gravação sofra rollback. Enfileire um [job](/docs/backend/jobs) para isso, ou execute após o retorno da gravação: publique em um [canal de tempo real](/docs/backend/realtime), ou use `waitUntil` em uma [função customizada](/docs/backend/custom-functions). A documentação de [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) explica qual abordagem se adequa melhor.

No MongoDB, nada disso se aplica. Esse driver executa os mesmos callbacks sem uma transação, de modo que a gravação já está armazenada quando `afterSave` é executado, e um throw ali apenas reporta a falha sem desfazê-la.

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

Faça consultas por meio de `context.data`. `context.client` não possui `data`: no lado do servidor, ele é o singleton `rebase`, cujo único plano de dados é o `dataAsAdmin` com escopo de admin; portanto, `context.client.data` gera um erro de compilação.

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Customizadas](/docs/backend/custom-functions)** — Adicionar endpoints de API personalizados
