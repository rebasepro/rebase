---
sourceHash: b853df8c5b0b5e4a
title: Callbacks de Entidade
sidebar_label: Callbacks
description: Use callbacks de ciclo de vida para executar lógica personalizada quando entidades forem criadas, atualizadas, lidas ou excluídas. Inclui a API context.data para operações entre coleções.
---

## Visão Geral

Os callbacks permitem que você se conecte ao ciclo de vida da entidade para:

- **Sincronizar dados entre coleções** — copiar ou mover entidades entre tabelas em mudanças de status
- **Transformar dados** antes de salvar (campos computados, geração de slugs)
- **Validar** regras de negócio além da validação de schema
- **Disparar efeitos colaterais** após gravações (enviar e-mails, sincronizar APIs, atualizar caches)
- **Restringir uma leitura** antes que ela seja compilada, para que o chamador veja apenas suas próprias linhas
- **Filtrar/transformar** dados após a leitura
- **Operações em cascata** — limpar registros relacionados na exclusão

## Onde os callbacks são executados

Uma coleção possui dois blocos de callbacks, e a única diferença é qual runtime os executa.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Executado em | no servidor | no painel de administração, no navegador |
| Disparado para | REST, o SDK, realtime, `dataAsAdmin` | leituras e gravações feitas pelo painel |
| Chega ao navegador | não — os corpos são removidos do bundle | sim, na íntegra |
| Usar para | tudo abaixo | coleções com as quais o painel se comunica diretamente |

**`callbacks` é o que você procura.** Ele é executado em todos os caminhos que chegam ao servidor, de modo que nada o contorna, e seu corpo nunca sai da máquina — uma chave de API ou uma leitura de `process.env` ali é segura. O restante desta página é sobre `callbacks`.

O `admin.browserCallbacks` existe para um único caso: uma coleção em um transporte `direct` ou `custom`, que o painel lê e grava *por conta própria*, sem nenhum servidor Rebase no caminho da requisição. Nada no lado do servidor enxerga essas operações, portanto, `callbacks` nunca pode ser disparado para elas, e este bloco é o único lugar onde sua lógica de ciclo de vida pode residir.

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

Duas regras decorrem do fato de ser "enviado para todos os visitantes", e nenhuma delas é apenas estilística:

1. **Sem segredos.** Sem chaves de API, sem `process.env`, nada que você se importaria que um leitor do bundle visse. Isso pertence a `callbacks`.
2. **Não é um limite de segurança.** Um `browserCallbacks.afterRead` que oculta um campo o faz *depois* que o navegador já possui a linha — em um transporte direto, o documento bruto veio direto do store. Trata-se de apresentação. A ocultação que precisa ser garantida vai em `callbacks` ou nas próprias regras do store.

Em uma coleção com transporte de servidor — o padrão, e quase certamente a sua —, o servidor já executou `callbacks` antes que a linha chegue ao painel, de modo que um `browserCallbacks.afterRead` é executado *além* dele. Escreva-o para ser idempotente, ou não o escreva.

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

<span class="since-badge" data-since="0.22">Since 0.22</span> Chamado **antes que uma leitura seja compilada**, para restringir quais linhas serão solicitadas. Retorne condições para aplicar como AND na consulta; não retorne nada para não adicionar nenhuma.

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

O `afterRead` enxerga linhas que já foram buscadas, portanto, pode omitir um valor, mas não pode impedir que a linha seja lida. Este hook roda antes, e vale a pena saber três coisas sobre ele:

- **Ele só pode restringir.** O valor de retorno é um filtro para combinar com AND, e nenhum valor retornado pode ampliar a leitura. `filter` aceita os mesmos filtros de campo que uma consulta aceita; `logical` aceita um grupo `or`/`and`, para um escopo como "meu ou compartilhado comigo" — ainda aplicado com AND como um todo, portanto, o `or` apenas escolhe entre as linhas que o restante da consulta já aceita.
- **Ele dispara em todos os caminhos de leitura.** A listagem, o get individual, a contagem, o agregado, a busca, a leitura vetorial, uma listagem de caminho aninhado, a re-busca em tempo real por trás de um `.listen()`, e as linhas carregadas para uma relação ou um `?include=` — onde é o hook da coleção de **destino** que se aplica, pois essas são as linhas de destino.
- **Um filtro que não puder ser compilado rejeita a requisição.** Nomear uma coluna que a tabela não possui resulta em 400, nunca em uma condição ignorada.

Uma leitura é deliberadamente não restringida: a verificação de unicidade por trás de `validation: { unique: true }`. Ela pergunta se um valor existe em qualquer lugar da tabela e, se fosse restringida, responderia "único" para um valor que uma linha oculta já possui.

:::caution[Apenas Postgres, por enquanto]
`beforeQuery` é implementado por `@rebasepro/server-postgres`. Uma coleção servida por MongoDB ou Firestore que declare um hook desse tipo **falha na inicialização**, nominalmente, em vez de ser servida com o hook silenciosamente inerte — o que, para um filtro de linha, significaria que todas as linhas seriam servidas a todos. Um [global](/docs/backend/hooks) `beforeQuery` falha na inicialização da mesma forma se qualquer fonte de dados não for Postgres, assim como um anexado posteriormente com `setCollectionCallbacks`. A omissão de dados que funciona em qualquer banco é o [`afterRead`](#afterread).
:::

→ [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) para ver onde isso se posiciona entre as outras opções.

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

Lance um erro para **bloquear o salvamento**. A gravação nunca chega ao banco de dados e o chamador recebe um **400** com sua mensagem e o código `CALLBACK_REJECTED`:

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
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. Um arquivo de coleção é compartilhado com o frontend — o build do Vite do painel de administração lê este mesmo diretório —, portanto, ele só pode importar pacotes executáveis em um navegador. O `RebaseApiError` é a versão segura para o navegador e é a mesma classe que o SDK cliente lança.
:::

### `afterSave`

Chamado após a linha ser gravada e antes do commit, dentro da mesma transação. Lançar um erro desfaz o salvamento — consulte [Semântica de Transação](#transaction-semantics).

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

Chamado após ler entidades do banco de dados. Transforme os dados para exibição.

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

Chamado após a linha ser excluída e antes do commit, dentro da mesma transação. Lançar um erro reverte a exclusão.

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

## A API `context.data`

Todo callback recebe um objeto `context` que inclui `context.data` — uma camada de acesso a dados unificada para realizar **operações entre coleções** a partir de hooks de ciclo de vida.

### Acessando Coleções

O `context.data` usa um Proxy JavaScript, para que você possa acessar qualquer coleção por seu slug como uma propriedade:

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

Cada acessador de coleção (`context.data.<slug>`) fornece estes métodos:

| Método | Assinatura | Descrição |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Consultar entidades com filtros, ordenação e paginação |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Buscar uma única entidade por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Criar uma nova entidade |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Atualizar uma entidade existente |
| `.delete()` | `delete(id: string \| number) → void` | Excluir um registro |
| `.count()` | `count(params?: FindParams) → number` | Contar entidades correspondentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Assinatura em tempo real (onde suportado) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Ouvir uma única entidade |

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
**`context.data` herda os privilégios do que quer que tenha disparado o callback.** Não se trata de um nível de confiança fixo.

- Disparado por uma **requisição do usuário** (REST, realtime, uma edição no painel de administração) → **escopo do usuário**. O callback é executado dentro da transação vinculada a RLS aberta para essa requisição, portanto, as políticas se aplicam a leituras *e* gravações. Um callback não pode ver uma linha que seu chamador não pôde ver.
- Disparado por **`rebase.dataAsAdmin` ou um cron job** (o mesmo singleton) → **escopo de admin**, não sem escopo. Esse driver tem o escopo definido como `{ uid: "service", roles: ["admin"] }`, portanto, o callback ainda é executado em uma transação associada a RLS — suas políticas são avaliadas contra essa identidade.
- Disparado pelo **driver base** (fluxos de autenticação integrados, migrações) → **sem escopo**. Ele roda na conexão do proprietário e ignora o RLS.
:::

Isso é mais relevante na direção que falha silenciosamente. O RLS *filtra*, não lança exceções — portanto, um callback que lê uma linha irmã a encontrará quando uma tarefa de admin salvar e poderá não encontrar nada quando um usuário final salvar, sem nenhum erro em ambos os casos. Escreva callbacks que tolerem um resultado vazio ou acesse o plano de administração deliberadamente:

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
Versões anteriores desta página afirmavam que os callbacks sempre ignoravam o RLS e tinham "acesso total ao banco de dados, independentemente das permissões do usuário que o disparou". Isso estava errado, e errado na direção insegura — induzia a escrita de callbacks sob a premissa de que eles sempre poderiam ver tudo.

O comportamento acima é verificado de ponta a ponta contra o Postgres pelo caso `"scopes context.data to the caller when a callback runs on a user request"` na suíte de aplicação de RLS do `@rebasepro/server-postgres`.
:::

### Semântica de Transação

:::important
**As gravações de `context.data` de um callback fazem parte da gravação que o disparou.** No Postgres, `beforeSave`, o salvamento e `afterSave` — ou `beforeDelete`, a exclusão e `afterDelete` — rodam dentro de uma única transação, cada callback sendo aguardado antes do commit, e `context.data` grava através dessa mesma transação.
:::

Assim, a gravação que disparou o evento e tudo o que seus callbacks gravaram fazem commit juntos ou nada é salvo:

- Um erro lançado em `afterSave` ou `afterDelete` desfaz a gravação que originou o disparo, juntamente com cada gravação feita por `context.data` nos callbacks. O chamador recebe a resposta **400 `CALLBACK_REJECTED`** com `details.stage` indicando o hook — ou com o próprio status do erro quando este contiver um: um `RebaseApiError` lançado por você, ou o 409 de uma violação de unicidade.
- Assinantes realtime são notificados sobre a linha somente após o commit, portanto, uma gravação revertida nunca é anunciada.
- Um callback mantém a transação aberta enquanto é executado; portanto, um callback lento significa um lock retido e uma conexão do pool ocupada.

Deixe uma falha lançar um erro quando a gravação disparadora não dever sobreviver a ela. Trate-a quando ela dever sobreviver: a gravação com falha é desfeita isoladamente e o restante é confirmado.

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

Tarefas que precisam sair do banco de dados — um e-mail, um webhook, uma chamada para uma API de terceiros — não pertencem ao corpo do callback. Elas manteriam a transação aberta durante uma viagem de rede, e nada poderá desfazê-las se a gravação sofrer rollback. Enfileire um [job](/docs/backend/jobs) para isso, ou faça-o após o retorno da gravação: publique em um [canal de realtime](/docs/backend/realtime), ou use `waitUntil` em uma [função personalizada](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indica qual é a melhor opção.

No MongoDB nada disso se aplica. Esse driver executa os mesmos callbacks sem uma transação, portanto a gravação já está armazenada quando o `afterSave` é executado, e lançar um erro ali apenas relata a falha sem desfazê-la.

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
- **Log de auditoria**: Use `afterSave` / `afterDelete` para registrar em uma coleção de log de auditoria
- **Contadores**: Use `afterSave` / `afterDelete` para atualizar campos de contagem em entidades relacionadas

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

Consulte através de `context.data`. O `context.client` não possui `data`: no lado do servidor, ele é o singleton `rebase`, cujo único plano de dados é o `dataAsAdmin` com escopo de admin, portanto `context.client.data` resulta em um erro de compilação.

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Personalizadas](/docs/backend/custom-functions)** — Adicione endpoints de API personalizados
