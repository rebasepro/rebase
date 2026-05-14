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

## Definindo Callbacks

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    callbacks: {
        beforeSave: async ({ values, entityId, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.created_at = new Date();
            }
            values.updated_at = new Date();

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
};
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
    return { ...values, updated_at: new Date() };
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
        orderBy: "created_at:desc"
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

### Segurança: Comportamento de Bypass de RLS

:::important
**Operações `context.data` em callbacks ignoram a Segurança em Nível de Linha (RLS).**

Quando os callbacks são executados no backend, eles passam pelo `PostgresBackendDriver` base — e não pelo wrapper autenticado. Isso significa que `context.data` tem **acesso total ao banco de dados** independentemente das permissões do usuário que acionou o callback.

Isso é intencional: hooks de ciclo de vida do lado do servidor são código confiável que frequentemente precisa gravar em coleções às quais o usuário final não tem acesso direto (por exemplo, criando uma entrada de log de auditoria, atualizando um contador em um registro pai).
:::

Se você precisar de operações com escopo RLS dentro de um callback, use o driver autenticado diretamente:

```typescript
afterSave: async ({ context }) => {
    // This bypasses RLS (normal for callbacks):
    await context.data.audit_logs.create({ action: "approved" });

    // To enforce RLS, access the driver and call withAuth():
    const authDriver = await context.driver.withAuth(context.user);
    // authDriver.data operations respect RLS
}
```

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
const submissionsCollection: EntityCollection = {
    slug: "job_submissions",
    callbacks: {
        afterSave: async ({ values, entityId, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.jobs.create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: entityId,
                });

                // Update the submission with the promoted job reference
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    },
    properties: { /* ... */ }
};
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
