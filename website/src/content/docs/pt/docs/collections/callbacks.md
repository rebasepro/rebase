---
sourceHash: 13eea3897cdb7bee
title: Callbacks de Entidade
sidebar_label: Callbacks
description: Use callbacks de ciclo de vida para executar lógica personalizada quando entidades forem criadas, atualizadas, lidas ou excluídas. Inclui a API context.data para operações entre coleções.
---

## Visão Geral

Os callbacks permitem que você se conecte ao ciclo de vida da entidade para:

- **Sincronizar dados entre coleções** — copiar ou mover entidades entre tabelas em mudanças de status
- **Transformar dados** antes de salvar (campos computados, geração de slugs)
- **Validar** regras de negócio além da validação de esquema
- **Disparar efeitos colaterais** após gravações (enviar e-mails, sincronizar APIs, atualizar caches)
- **Filtrar/transformar** dados após a leitura
- **Operações em cascata** — limpar registros relacionados na exclusão

## Onde os callbacks são executados

Uma coleção possui dois blocos de callback, e a única diferença é qual ambiente de execução (runtime) os executa.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Executa em | no servidor | no painel de administração, no navegador |
| Disparado para | REST, SDK, realtime, `dataAsAdmin` | leituras e gravações feitas pelo painel |
| Chega ao navegador | não — os corpos são removidos do bundle | sim, na íntegra |
| Usar para | tudo abaixo | coleções com as quais o painel se comunica diretamente |

**`callbacks` é o que você procura.** Ele é executado em todos os caminhos que chegam ao servidor, de modo que nada o contorna, e seu corpo nunca sai da máquina — uma chave de API ou uma leitura de `process.env` ali é segura. O restante desta página é sobre `callbacks`.

`admin.browserCallbacks` existe para um caso: uma coleção em um transporte `direct` ou `custom`, que o próprio painel lê e grava sem nenhum servidor Rebase no caminho da requisição. Nada no lado do servidor vê essas operações, portanto, `callbacks` nunca pode disparar para elas, e este bloco é o único lugar onde a lógica de ciclo de vida delas pode residir.

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

1. **Sem segredos.** Sem chaves de API, sem `process.env`, nada que você se importaria que um leitor do bundle visse. Isso pertence ao `callbacks`.
2. **Não é um limite de segurança.** Um `browserCallbacks.afterRead` que oculta um campo o faz *depois* que o navegador já possui a linha — em um transporte direto, o documento bruto veio direto do repositório de dados. Trata-se de apresentação. Redações que precisam ser garantidas devem ficar em `callbacks` ou nas regras do próprio repositório.

Em uma coleção com transporte de servidor — o padrão, e quase certamente a sua —, o servidor já executou `callbacks` antes que a linha chegue ao painel, então um `browserCallbacks.afterRead` é executado *além* dele. Escreva-o para ser idempotente ou não o escreva.

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

Para escolher o status e o código por conta própria — um 409 para um conflito, um 422 para algo bem formatado, mas inaceitável —, lance um `RebaseApiError`:

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
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. Um arquivo de coleção é compartilhado com o frontend — a build do Vite do painel de administração lê este mesmo diretório —, portanto, ele só pode importar pacotes que executam em um navegador. O `RebaseApiError` é a versão segura para o navegador, e é a mesma classe que o SDK do cliente lança.
:::

### `afterSave`

Chamado depois que a linha é gravada e antes do commit, dentro da mesma transação. Lançar um erro desfaz o salvamento — consulte [Semântica de Transação](#semântica-de-transação).

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

Chamado depois que a linha é excluída e antes do commit, dentro da mesma transação. Lançar um erro desfaz a exclusão.

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

Cada callback recebe um objeto `context` que inclui `context.data` — uma camada unificada de acesso a dados para realizar **operações entre coleções** de dentro dos hooks de ciclo de vida.

### Acessando Coleções

O `context.data` usa um Proxy JavaScript, portanto você pode acessar qualquer coleção pelo slug dela como uma propriedade:

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
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Assinatura em tempo real (onde suportado) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escutar uma única entidade |

### Consultando com `.find()`

O método `find()` suporta filtragem avançada:

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
**`context.data` herda os privilégios daquilo que disparou o callback.** Não se trata de um nível de confiança fixo.

- Disparado por uma **requisição de usuário** (REST, realtime, uma edição no painel de administração) → **escopo de usuário**. O callback é executado dentro da transação associada a RLS aberta para essa requisição, de modo que as políticas se aplicam a leituras *e* gravações. Um callback não pode ver uma linha que seu chamador não pôde ver.
- Disparado por **`rebase.dataAsAdmin` ou um cron job** (o mesmo singleton) → **escopo de admin**, e não sem escopo. Esse driver tem escopo definido como `{ uid: "service", roles: ["admin"] }`, de modo que o callback ainda é executado em uma transação associada a RLS — suas políticas são avaliadas contra essa identidade.
- Disparado pelo **driver base** (fluxos de autenticação integrados, migrações) → **sem escopo**. Ele é executado na conexão proprietária e ignora o RLS.
:::

Isso importa mais na direção que falha silenciosamente. O RLS *filtra*, não lança erros — portanto, um callback que lê uma linha irmã a encontrará quando uma tarefa de administração salvar e poderá não encontrar nada quando um usuário final salvar, sem nenhum erro em ambos os casos. Escreva callbacks que tolerem um resultado vazio ou acesse o plano administrativo deliberadamente:

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
Versões anteriores desta página afirmavam que os callbacks sempre ignoravam o RLS e tinham "acesso total ao banco de dados, independentemente das permissões do usuário acionador". Isso estava incorreto e incorreto na direção insegura — convidava à escrita de callbacks com a premissa de que sempre poderiam ver tudo.

O comportamento acima é verificado de ponta a ponta no Postgres pelo caso `"scopes context.data to the caller when a callback runs on a user request"` na suíte de imposição de RLS do `@rebasepro/server-postgres`.
:::

### Semântica de Transação

:::important
**As gravações de `context.data` de um callback fazem parte da gravação que o disparou.** No Postgres, o `beforeSave`, o salvamento e o `afterSave` — ou o `beforeDelete`, a exclusão e o `afterDelete` — são executados dentro de uma única transação, cada callback aguardado antes do commit, e o `context.data` grava através dessa mesma transação.
:::

Portanto, a gravação que disparou o processo e tudo o que seus callbacks gravaram fazem commit juntos ou não fazem nada:

- Um erro lançado a partir de `afterSave` ou `afterDelete` desfaz a gravação disparadora, juntamente com todas as gravações de `context.data` feitas pelos callbacks. O chamador recebe a resposta **400 `CALLBACK_REJECTED`** com `details.stage` indicando o hook — ou com o status próprio do erro quando ele possui um: um `RebaseApiError` que você lançou, um 409 de violação de unicidade.
- Os assinantes de realtime só são notificados sobre a linha após o commit, portanto, uma gravação desfeita (rollback) nunca é anunciada.
- Um callback mantém a transação aberta enquanto é executado; portanto, um callback lento significa um lock retido e uma conexão do pool ocupada.

Deixe uma falha lançar um erro quando a gravação disparadora não deve sobreviver a ela. Capture-a quando ela deve sobreviver: a gravação com falha é desfeita isoladamente, e o restante faz commit.

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

Trabalhos que precisam sair do banco de dados — um e-mail, um webhook, uma chamada a uma API de terceiros — não pertencem ao corpo do callback. Isso manteria a transação aberta durante uma viagem de ida e volta pela rede (round trip), e nada pode reverter isso caso a gravação sofra rollback. Enfileire um [job](/docs/backend/jobs) para isso ou faça-o após o retorno da gravação: publique em um [canal de realtime](/docs/backend/realtime) ou use `waitUntil` em uma [função personalizada](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indica qual é a melhor opção.

No MongoDB, nada disso se aplica. Esse driver executa os mesmos callbacks sem uma transação, portanto, a gravação já está armazenada quando `afterSave` é executado, e lançar um erro ali relata a falha sem desfazê-la.

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
- **Log de auditoria**: Use `afterSave` / `afterDelete` para gravar em uma coleção de log de auditoria
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

Faça consultas através de `context.data`. O `context.client` não possui `data`: no lado do servidor, ele é o singleton `rebase`, cujo único plano de dados é o `dataAsAdmin` de escopo de admin, portanto, `context.client.data` é um erro de compilação.

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Personalizadas](/docs/backend/custom-functions)** — Adicione endpoints de API personalizados
