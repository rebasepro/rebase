---
sourceHash: f5cc00d6f5f3e4c3
title: A API context.data
sidebar_label: API context.data
description: Leia e grave outras coleções de dentro de um callback com context.data — seus métodos, os privilégios com que é executado, a semântica transacional e a conexão que um callback ocupa.
---

Cada callback recebe um objeto `context` que inclui `context.data` — uma camada unificada de acesso a dados para realizar **operações entre coleções** a partir de hooks de ciclo de vida.

## Acessando Coleções

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

## Métodos Disponíveis

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

## Consultando com `.find()`

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

## Criando Entidades

`.create()` e `.update()` recebem os valores a gravar, com as assinaturas
acima. [Sincronizando Dados Entre Coleções](/docs/collections/callbacks#syncing-data-between-collections)
usa ambos: uma submissão aprovada cria um job publicado e é vinculada de volta
a ele.

## Segurança: com quais privilégios o `context.data` é executado

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

## Semântica de Transações

:::important
**As gravações de `context.data` de um callback fazem parte da gravação que o disparou.** No Postgres, `beforeSave`, o salvamento e `afterSave` — ou `beforeDelete`, a exclusão e `afterDelete` — são executados dentro de uma única transação, cada callback aguardado antes do commit, e o `context.data` grava por meio dessa mesma transação.
:::

Portanto, a gravação que disparou o evento e tudo o que seus callbacks gravaram realizam commit juntos ou não realizam de forma alguma:

- Um erro lançado em `afterSave` ou `afterDelete` reverte (rollback) a gravação acionadora, junto com todas as gravações de `context.data` feitas pelos callbacks. O chamador recebe a resposta **400 `CALLBACK_REJECTED`** com `details.stage` indicando o hook — ou com o próprio status do erro quando este o contiver: um `RebaseApiError` que você lançou, o 409 de uma violação de unicidade.
- Assinantes em tempo real são notificados sobre a linha apenas após o commit, portanto, uma gravação revertida nunca é anunciada.
- Um callback mantém a transação aberta enquanto executa; portanto, um callback lento significa um lock retido e uma conexão do pool ocupada — `beforeSave` e `beforeDelete` tanto quanto os hooks `after`. Veja [Um callback segura uma conexão](#um-callback-segura-uma-conexão).
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

## Um callback segura uma conexão

No Postgres, uma gravação roda em uma conexão retirada do pool do banco de dados,
e todo callback roda nela: `beforeSave` e `beforeDelete` depois que a
transação começou, `afterSave` e `afterDelete` antes de ela ser confirmada. Pelo
tempo em que um callback executa — aguardando uma consulta, um cálculo, qualquer coisa — essa
conexão não atende mais nada, e os locks que a gravação tomou continuam tomados:
no `afterSave`, a linha recém-gravada; em uma gravação em lote ou [`_batch`](/docs/backend/writes/#cross-collection-batches),
toda linha que a transação gravou antes dele.

O custo é a duração do próprio callback, e as gravações concorrentes o somam:

- O pool tem 20 conexões por padrão (`DB_POOL_MAX`). 25 salvamentos simultâneos
  cujo `beforeSave` aguardava 300 ms fizeram uma leitura de uma linha sem relação levar 290 ms,
  quase tudo esperando por uma conexão.
- Uma criação em lote de 100 linhas cujo `beforeSave` aguarda 50 ms é uma transação
  aberta por 5,3 s, segurando sua conexão e os locks de toda linha gravada até
  então durante todo esse tempo.

Portanto:

- Mantenha qualquer coisa lenta fora dos callbacks. Uma chamada a outro serviço pertence a um
  [job](/docs/backend/jobs), ou ao momento depois que a gravação retorna.
- Busque o que um hook precisa antes da gravação, quando puder — no cliente, ou
  em uma [função customizada](/docs/backend/custom-functions) que então grava.
- Envie linhas cujos hooks são lentos em lotes menores.
- Se muitos hooks lentos rodam ao mesmo tempo por projeto, aumente `DB_POOL_MAX`, dentro do que
  o `max_connections` do banco de dados permite para todas as instâncias.
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Com
  `REBASE_METRICS=true`, `/metrics` informa `rebase_db_pool_wait_ms`: quanto tempo
  cada consulta esperou por uma conexão. Um pool saudável o mantém perto de zero; uma cauda
  que cresce com o tráfego são requisições na fila por conexões que os callbacks
  seguram. Veja [Métricas](/docs/deployment/self-hosting/#metrics).
