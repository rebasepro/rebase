---
title: Callbacks de Entidade
sidebar_label: Callbacks
description: Use callbacks de ciclo de vida para executar lógica personalizada quando entidades são criadas, atualizadas, lidas ou excluídas. Inclui a API context.data para operações entre coleções.
---

## Visão Geral

Callbacks permitem que você se conecte ao ciclo de vida da entidade para:

- **Sincronizar dados entre coleções** — copiar ou mover entidades entre tabelas em mudanças de status
- **Transformar dados** antes de salvar (campos calculados, slugificação)
- **Validar** regras de negócio além da validação de esquema
- **Acionar efeitos colaterais** após escritas (enviar e-mails, sincronizar APIs, atualizar caches)
- **Filtrar/transformar** dados após a leitura
- **Operações em cascata** — limpar registros relacionados na exclusão

## Onde os callbacks são executados

Uma coleção tem dois blocos de callbacks, e a única diferença é qual runtime os executa.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Executa em | o servidor | o painel de administração, no navegador |
| Dispara para | REST, o SDK, realtime, `dataAsAdmin` | leituras e escritas feitas pelo painel |
| Chega ao navegador | não — os corpos são removidos do bundle | sim, por inteiro |
| Usar para | tudo o que segue | coleções com as quais o painel fala diretamente |

**`callbacks` é o que você quer.** Ele roda em todo caminho que chega ao
servidor, então nada o contorna, e seu corpo nunca deixa a máquina — uma chave
de API ou uma leitura de `process.env` ali está segura. O resto desta página é
sobre `callbacks`.

`admin.browserCallbacks` existe para um caso: uma coleção em um transporte
`direct` ou `custom`, que o painel lê e escreve *sozinho*, sem nenhum servidor
Rebase no caminho da requisição. Nada do lado do servidor vê essas operações,
então `callbacks` nunca pode disparar para elas, e este bloco é o único lugar
onde a lógica de ciclo de vida delas pode viver.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declarado com transport: "direct"
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

Duas regras decorrem de "chega a todo visitante", e nenhuma delas é estilística:

1. **Sem segredos.** Nenhuma chave de API, nenhum `process.env`, nada que você
   se importaria que fosse lido no bundle. Isso pertence a `callbacks`.
2. **Não é uma fronteira de segurança.** Um `browserCallbacks.afterRead` que
   oculta um campo o oculta *depois* que o navegador já tem a linha — num
   transporte direto o documento bruto veio direto do armazenamento. É
   apresentação. A ocultação que precisa se sustentar vai em `callbacks`, ou nas
   regras do próprio armazenamento.

Numa coleção com transporte de servidor — o padrão, e quase certamente a sua — o
servidor já executou `callbacks` antes de a linha chegar ao painel, então um
`browserCallbacks.afterRead` roda *além* dele. Escreva-o idempotente, ou não o
escreva.

## Definindo Callbacks

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

// The row shape. Without it every `values.x` below is `unknown`.
type Article = {
    title: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
};

const articlesCollection: PostgresCollectionConfig<Article> = {
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

        afterSave: async ({ values, entityId }) => {
            // Send notification
            console.log(`Article ${entityId} saved: ${values.title}`);
        },

        beforeDelete: async ({ entityId }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ entity }) => {
            // Transform data after loading
            return entity;
        }
    },
    properties: { /* ... */ }
});
```

## Referência de Callbacks

### `beforeSave`

Chamado antes de uma entidade ser gravada no banco de dados. Retorne os valores modificados.

```typescript
beforeSave: async ({
    values,       // Entity values
    entityId,     // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lance um erro para **bloquear o salvamento**:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

### `afterSave`

Chamado após um salvamento bem-sucedido. Use para efeitos colaterais.

```typescript
afterSave: async ({
    values,         // Saved values
    entityId,       // Entity ID
    previousValues, // Previous values (null for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Send webhook
    await fetch("https://api.slack.com/webhook", {
        method: "POST",
        body: JSON.stringify({ text: `New article: ${values.title}` })
    });
}
```

### `afterSaveError`

Chamado quando uma operação de salvamento falha.

```typescript
afterSaveError: async ({
    values,
    entityId,
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
    entity,    // The entity to transform
    context
}) => {
    // Add computed fields
    return {
        ...entity,
        values: {
            ...entity.values,
            displayName: `${entity.values.first_name} ${entity.values.last_name}`
        }
    };
}
```

### `beforeDelete`

Chamado antes de uma entidade ser excluída. Lance um erro para bloquear a exclusão.

```typescript
beforeDelete: async ({
    entityId,
    entity,
    context
}) => {
    if (entity.values.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Chamado após uma exclusão bem-sucedida.

```typescript
afterDelete: async ({
    entityId,
    entity,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${entityId} deleted`);
}
```

## Callbacks de Propriedade

Você também pode definir callbacks no nível da propriedade para transformações específicas de campo:

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

Todo callback recebe um objeto `context` que inclui `context.data` — uma camada unificada de acesso a dados para realizar **operações entre coleções** a partir de hooks de ciclo de vida.

### Acessando Coleções

`context.data` usa um Proxy JavaScript, então você pode acessar qualquer coleção pelo seu slug como uma propriedade:

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
| `.find()` | `find(params?: FindParams) → FindResponse` | Consulta entidades com filtros, ordenação e paginação |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Busca uma única entidade por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Cria uma nova entidade |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Atualiza uma entidade existente |
| `.delete()` | `delete(id: string \| number) → void` | Exclui uma entidade |
| `.count()` | `count(params?: FindParams) → number` | Conta entidades correspondentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Assinatura em tempo real (onde suportado) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escuta uma única entidade |

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

### Segurança: com que privilégios `context.data` é executado

:::important
**`context.data` herda os privilégios daquilo que acionou o callback.** Não é um nível de confiança fixo.

- Acionado por uma **requisição de usuário** (REST, tempo real, uma edição no painel de administração) → **com escopo de usuário**. O callback é executado dentro da transação vinculada a RLS aberta para essa requisição, portanto as políticas se aplicam a leituras *e* escritas. Um callback não pode ver uma linha que seu chamador não poderia ver.
- Acionado por **`rebase.dataAsAdmin` ou um job cron** (o mesmo singleton) → **com escopo de administrador**, não sem escopo. Esse driver está limitado a `{ uid: "service", roles: ["admin"] }`, portanto o callback continua sendo executado numa transação vinculada a RLS: suas políticas são avaliadas, contra essa identidade.
- Acionado pelo **driver base** (os fluxos de autenticação integrados, as migrações) → **sem escopo**. É executado na conexão proprietária e ignora o RLS.
:::

Isso importa sobretudo na direção que falha em silêncio. O RLS *filtra*, não levanta erros — então um callback que lê uma linha vizinha a encontrará quando uma tarefa administrativa salvar e pode não encontrar nada quando um usuário final salvar, sem erro em nenhum dos casos. Escreva callbacks que tolerem um resultado vazio, ou recorra deliberadamente ao plano de administração:

```typescript
afterSave: async ({ context }) => {
    // Com escopo de usuário quando foi um usuário que acionou este salvamento:
    // o RLS se aplica.
    await context.data.audit_logs.create({ action: "approved" });

    // Escopo de administrador deliberado — para trabalho que o chamador
    // realmente não deve ver, como um log de auditoria que ele não pode ler nem
    // editar. Atenção: é o alcance de um administrador, não uma dispensa do RLS
    // — uma coleção cuja única regra seja `policy.serverContext()` continua
    // fechada para ele, porque isso compila para `rebase.uid() IS NULL` e o uid
    // deste acessor é `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Esta página afirmava o contrário]
Versões anteriores desta página afirmavam que os callbacks sempre ignoram o RLS e têm «acesso completo ao banco de dados independentemente das permissões do usuário que os aciona». Isso estava errado, e errado na direção insegura — convidava a escrever callbacks presumindo que sempre podiam ver tudo.

O comportamento descrito acima é verificado ponta a ponta contra o Postgres pelo caso `"scopes context.data to the caller when a callback runs on a user request"` na suíte de aplicação de RLS do `@rebasepro/server-postgres`.
:::

### Semântica de Transação

:::warning
**Operações `context.data` NÃO são automaticamente envolvidas na mesma transação que o salvamento que as aciona.**

O salvamento da entidade original completa sua transação de banco de dados primeiro. Em seguida, `afterSave` é executado e quaisquer chamadas `context.data` abrem **transações separadas**. Se uma operação `context.data` falhar em `afterSave`, o salvamento original **não é revertido**.
:::

Isso significa:

- ✅ O salvamento que aciona o callback sempre é bem-sucedido de forma independente
- ⚠️ Escritas de efeito colateral podem falhar sem afetar a operação original
- ⚠️ Não há garantia de atomicidade entre o salvamento original e as chamadas `context.data` subsequentes

Para operações que devem ser atômicas, envolva-as em tratamento de erros:

```typescript
afterSave: async ({ values, entityId, context }) => {
    try {
        await context.data.jobs.create({
            title: values.title,
            status: "published",
        });
    } catch (error) {
        // Log the failure — the original save already succeeded
        console.error(`Failed to promote job from submission ${entityId}:`, error);
        // Optionally: mark the submission as "promotion_failed"
        await context.data["job-submissions"].update(entityId, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Sincronizando Dados Entre Coleções

Um dos usos mais poderosos de callbacks é a **sincronização de dados entre coleções** usando `context.data`:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

type Submission = {
    title: string;
    description: string;
    company_id: string;
    status: string;
    promoted_job_id: string;
};

const submissionsCollection: PostgresCollectionConfig<Submission> = {
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
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    },
    properties: { /* ... */ }
});
```

Outros padrões entre coleções:

- **Exclusão em cascata**: Use `afterDelete` para remover registros relacionados em coleções filhas
- **Desnormalização**: Use `afterSave` para atualizar campos de resumo em uma coleção pai
- **Log de auditoria**: Use `afterSave` / `afterDelete` para gravar em uma coleção de log de auditoria
- **Contadores**: Use `afterSave` / `afterDelete` para atualizar campos de contagem em entidades relacionadas

## Referência Completa do Contexto

Todo callback recebe um objeto `context` do tipo `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** O usuário autenticado, se houver */
    user?: User;
    /** O driver de dados subjacente (PostgresBackendDriver) */
    driver: DataDriver;
    /** Acesso a dados unificado — context.data.<slug>.create/update/find/delete */
    data: RebaseData;
}
```

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Histórico de Entidade](/docs/backend/history)** — Trilha de auditoria
- **[Funções Personalizadas](/docs/backend/custom-functions)** — Adicione endpoints de API personalizados
---
