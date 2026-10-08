---
sourceHash: c1478b42d3c890a5
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
Importe-o de `@rebasepro/types`, não de `@rebasepro/server`. Um arquivo de coleção é compartilhado com o frontend — o build do Vite do painel admin lê esse mesmo diretório —, portanto, ele só pode importar pacotes que rodam em um navegador. `RebaseApiError` é o seguro para navegadores e é a mesma classe lançada pelo SDK tipado.
:::

### `afterSave`

Chamado após a linha ser gravada e antes do commit, dentro da mesma transação. Lançar um erro desfaz o salvamento (rollback) — veja [Semântica de Transações](#semântica-de-transações).

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
afterSave: async ({ values, id, context }) => {
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

O método `find()` filtra com tuplas `[operator, value]` — a forma tipada da
query string `?status=eq.published` que a API REST lê:

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Criando Entidades

`.create()` e `.update()` recebem os valores a gravar, com as assinaturas
acima. [Sincronizando Dados Entre Coleções](#sincronizando-dados-entre-coleções)
usa ambos: uma submissão aprovada cria um job publicado e é vinculada de volta
a ele.

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
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` é uma segunda conexão, não parte desta gravação]
No Postgres, `context.client.dataAsAdmin` dentro do callback de uma requisição é executado em uma transação própria, em outra conexão do pool, enquanto a transação da gravação acionadora ainda está aberta. Portanto, ele realiza o commit por conta própria e permanece se a gravação sofrer rollback. Ele também não consegue ver a linha que está sendo salva, que ainda não passou pelo commit, e não deve gravá-la:

- Uma gravação de admin com uma chave estrangeira apontando para essa linha (um `audit_logs.article_id` que referencia `articles`) falha na verificação da chave, e a gravação do chamador falha junto com ela.
- Uma gravação de admin na linha que está sendo salva, ou em qualquer linha que esta gravação tenha bloqueado, espera pelo lock da gravação enquanto a gravação espera pelo callback. O Postgres não consegue identificar isso como um deadlock, então a requisição fica travada até o `statement_timeout` (30 segundos por padrão) e então falha.

Para um registro que precise referenciar a linha, grave-o com `context.data`, que usa a transação da gravação, ou enfileire um [job](/docs/backend/jobs): um job enfileirado a partir do callback realiza o commit junto com a gravação, e seu handler é executado após o commit.
:::

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
- Uma gravação de `context.data` também executa os callbacks da coleção de destino, então um `afterSave` que atualiza sua própria linha executa a si mesmo novamente. Gravações aninhadas em mais de 16 níveis são recusadas com **500 `CALLBACK_RECURSION`**, nomeando o hook e a coleção, e toda a gravação sofre rollback. Torne essa gravação condicional, como faz o exemplo abaixo.

Permita que uma falha lance um erro quando a gravação de origem não deva sobreviver a ela. Trate-a com catch quando ela dever, mas apenas em torno de uma **gravação** de `context.data`: um create, update ou delete que o banco de dados recusa (uma violação de chave única ou estrangeira, um trigger) é desfeito isoladamente, e o restante realiza o commit.

Qualquer outra instrução que falhe na transação da gravação — uma consulta, a leitura que um update ou delete faz para encontrar sua linha (um id que a coluna de chave não consegue conter), o enfileiramento de um job que o banco de dados recusou — aborta essa transação no Postgres, e capturar o erro em JavaScript não desfaz isso. A gravação é recusada com **500 `TRANSACTION_ABORTED`** e nada é armazenado, em vez de responder sucesso para uma gravação que sofreu rollback. Deixe uma falha desse tipo ser lançada, ou verifique a condição antes de executar a instrução.

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
