---
sourceHash: aaaaecaefd6bb6c4
title: A API context.data
sidebar_label: API context.data
description: Leia e escreva em outras tabelas a partir de um table hook com context.data — seus métodos, os privilégios com os quais é executado, semântica de transações e a conexão que um hook mantém.
---

Cada [table hook](/docs/collections/callbacks/) recebe um objeto `context` que inclui `context.data`: a camada de dados para leitura e escrita em **outras tabelas** a partir de dentro do hook.

## Acessando tabelas

O `context.data` usa um JavaScript Proxy, permitindo que você acesse qualquer tabela pelo seu slug como uma propriedade:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any table slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .table() method for dynamic slugs
    const slug = "jobs";
    const accessor = context.data.table(slug);
}
```

Uma propriedade é o acessor da tabela, o nome que o SDK gerado atribui a ela:
`context.data.myNotes` é a tabela cujo slug é `my-notes`, qualquer que seja a
tabela SQL em que está armazenada. Um nome que não seja o acessor de nenhuma tabela é lido em seu
snake_case, portanto `context.data.auditLog` é `audit_log`.

As linhas não possuem tipagem (`Record<string, unknown>`) até que o projeto registre o seu
`Database` gerado; a partir de então, cada acessor é tipado com base nele. Consulte
[Typed server-side data](/docs/backend/typed-server-data).

## Métodos disponíveis

Cada acessor de tabela (`context.data.<slug>`) fornece estes métodos:

| Method | Signature | Description |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResult` | Consultar linhas com filtros, ordenação e paginação |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Buscar uma única linha por ID |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Criar uma nova linha e retorná-la conforme armazenada |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Atualizar uma linha existente e retorná-la conforme armazenada |
| `.delete()` | `delete(id: string \| number) → void` | Deletar um registro |
| `.count()` | `count(params?: FindParams) → number` | Contar linhas correspondentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Inscrição em tempo real (onde suportado) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escutar uma única linha |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | As linhas marcadas por uma [exclusão reversível (soft delete)](/docs/collections/soft-delete#from-the-sdk) |

### Limites conhecidos em processo

A mesma superfície via HTTP (`@rebasepro/client`) faz algumas coisas que a versão
em processo (`context.data`, `rebase.data`, `rebase.dataAsAdmin`) não faz.
Nada disso é novo na versão 0.31:

- Uma linha em processo não carrega `_matches` de busca e nenhuma versão: `etagOf(row)`
  é `undefined`, portanto passe `ifMatch` a partir de uma linha lida via HTTP.
- `listenCount()` não está disponível em processo: ele lança "Realtime is not
  available".
- O atalho de tabela `.search(text)` não aceita `{ explain }` (o `.search` do query
  builder aceita, mas em processo não há `_matches` para retornar).

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

## Criando linhas

`.create()` e `.update()` recebem os valores para escrita, com as assinaturas acima.
[Escrever em outras tabelas](/docs/collections/callbacks/#writing-to-other-tables) usa ambos:
uma submissão aprovada cria uma vaga publicada e é vinculada de volta a ela.

## Segurança: com quais privilégios o `context.data` é executado

:::important
**O `context.data` herda os privilégios daquilo que disparou o hook.** Não é um nível de confiança fixo.

- Disparado por uma **requisição do usuário** (REST, realtime, uma edição no CMS) → **com escopo de usuário (user-scoped)**. O hook é executado dentro da transação vinculada ao RLS aberta para essa requisição, portanto as políticas se aplicam a leituras *e* escritas. Um hook não pode ver uma linha que seu chamador não pôde ver.
- Disparado por **`rebase.dataAsAdmin` ou um cron job** (o mesmo singleton) → **com escopo de admin (admin-scoped)**, não sem escopo. Esse driver tem escopo definido como `{ uid: "service", roles: ["admin"] }`, de modo que o hook ainda é executado em uma transação vinculada ao RLS — suas políticas são avaliadas contra essa identidade.
- Disparado pelo **driver base** (fluxos de autenticação integrados, migrações) → **sem escopo (unscoped)**. Ele roda na conexão do proprietário (owner) e ignora o RLS.
:::

Isso é mais importante na direção em que as falhas ocorrem silenciosamente. O RLS *filtra*, não lança erros — portanto, um hook que lê uma linha irmã a encontrará quando uma tarefa administrativa salvar, e pode não encontrar nada quando um usuário final salvar, sem nenhum erro em qualquer um dos casos. Escreva hooks que tolerem um resultado vazio ou acesse o plano de administração deliberadamente:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a table whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` é uma segunda conexão, não faz parte desta escrita]
O `context.client.dataAsAdmin` dentro do hook de uma requisição é executado em uma
transação própria, em outra conexão do pool, enquanto a transação da
escrita que o disparou ainda está aberta. Portanto, ele faz commit por conta própria e permanece mesmo se a
escrita sofrer rollback. Ele também não consegue ver a linha que está sendo salva, que ainda não foi
confirmada (committed), e não deve escrevê-la:

- Uma escrita de admin com chave estrangeira apontando de volta para essa linha (um `audit_logs.article_id`
  que referencia `articles`) falhará na verificação de chave, e a escrita do chamador falhará
  junto com ela.
- Uma escrita de admin na linha que está sendo salva, ou em qualquer linha que esta escrita tenha bloqueado,
  aguardará o lock da escrita enquanto a escrita aguarda o hook. O Postgres
  não consegue identificar isso como um deadlock, então a requisição trava até o `statement_timeout`
  (30 segundos por padrão) e depois falha.

Para um registro que precisa referenciar a linha, escreva-o com `context.data`, que
utiliza a transação da escrita, ou enfileire um [job](/docs/backend/jobs): um job
enfileirado a partir do hook é comitado com a escrita, e seu handler é executado após
o commit.
:::

:::caution[Esta página costumava dizer o oposto]
Versões anteriores desta página afirmavam que os hooks (então chamados de callbacks) sempre ignoravam o RLS e tinham "acesso total ao banco de dados, independentemente das permissões do usuário acionador". Isso estava errado, e errado na direção insegura — incentivava hooks escritos sob a suposição de que sempre poderiam ver tudo.

O comportamento acima é verificado de ponta a ponta em relação ao Postgres pelo caso `"scopes context.data to the caller when a callback runs on a user request"` na suíte de aplicação de RLS do `@rebasepro/server-postgres`.
:::

## Semântica de transações

:::important
**As escritas de `context.data` de um hook fazem parte da escrita que o disparou.** `beforeSave`, o salvamento e `afterSave` — ou `beforeDelete`, a exclusão e `afterDelete` — são executados dentro de uma única transação, com cada hook sendo aguardado antes do commit, e o `context.data` escreve através dessa mesma transação.
:::

Portanto, a escrita disparadora e tudo o que seus hooks escreveram são comitados juntos ou não são comitados:

- Um erro lançado (`throw`) a partir de `afterSave` ou `afterDelete` reverte a escrita disparadora (rollback), junto com todas as escritas de `context.data` feitas pelos hooks. O chamador recebe a resposta **400 `CALLBACK_REJECTED`** com `details.stage` informando o nome do hook — ou com o próprio status do erro quando este o possuir: um `RebaseApiError` lançado por você, um 409 de violação de unicidade.
- Os assinantes em tempo real (realtime) são notificados sobre a linha somente após o commit, portanto uma escrita que sofreu rollback nunca é anunciada.
- Um hook mantém a transação aberta enquanto é executado, de modo que um hook lento significa um lock retido e uma conexão do pool ocupada — tanto no `beforeSave` e `beforeDelete` quanto nos hooks `after`. Consulte [Um hook mantém uma conexão](#um-hook-mantém-uma-conexão).
- Uma escrita com `context.data` também executa os hooks da tabela de destino, portanto um `afterSave` que atualiza sua própria linha executará a si mesmo novamente. Escritas aninhadas com mais de 16 níveis de profundidade são recusadas com **500 `CALLBACK_RECURSION`**, identificando o hook e a tabela, e toda a escrita sofre rollback. Torne essa escrita condicional, como no exemplo abaixo.

Deixe uma falha lançar um erro quando a escrita disparadora não deva prosseguir após ela. Trate o erro com `catch` quando ela deva prosseguir, mas apenas em torno de uma **escrita** com `context.data`: uma criação, atualização ou exclusão recusada pelo banco de dados (violação de chave única ou estrangeira, uma trigger) é desfeita isoladamente, e o restante é comitado.

Qualquer outra instrução que falhe na transação da escrita — uma consulta (lookup), a leitura que um update ou delete faz para encontrar sua linha (um id incompatível com a coluna de chave), o enfileiramento de um job recusado pelo banco de dados — aborta essa transação no Postgres, e capturar o erro em JavaScript não desfaz isso. A escrita é recusada com **500 `TRANSACTION_ABORTED`** e nada é armazenado, em vez de responder com sucesso para uma escrita que sofreu rollback. Deixe essa falha lançar uma exceção ou verifique a condição antes de executar a instrução.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this table again, which runs this hook
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

Operações que precisam sair do banco de dados — um e-mail, um webhook, uma chamada para uma API de terceiros — não pertencem ao corpo do hook. Elas manteriam a transação aberta durante uma viagem de ida e volta pela rede (round trip), e nada poderá desfazê-las quando a escrita sofrer rollback. Enfileire um [job](/docs/backend/jobs) para isso ou faça após o retorno da escrita: publique em um [canal realtime](/docs/backend/realtime) ou use `waitUntil` em uma [custom function](/docs/backend/custom-functions). A documentação de [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indica qual opção se adequa melhor.

## Um hook mantém uma conexão

Uma escrita é executada em uma conexão retirada do pool do banco de dados, e cada
hook roda nela: `beforeSave` e `beforeDelete` após o início da
transação, `afterSave` e `afterDelete` antes de ela ser comitada. Por quanto
tempo um hook for executado — aguardando uma consulta, um cálculo, qualquer coisa — essa
conexão não serve a mais nada, e os locks adquiridos pela escrita permanecem ativos:
no `afterSave`, a linha recém-escrita; em uma escrita em lote (bulk) ou [`_batch`](/docs/backend/writes/#cross-table-batches),
cada linha que a transação escreveu antes dela.

O custo é a própria duração do hook, e escritas simultâneas somam esse tempo:

- O pool mantém 20 conexões por padrão (`DB_POOL_MAX`). 25 salvamentos simultâneos
  cujo `beforeSave` aguardou 300 ms fizeram uma leitura não relacionada de uma única linha levar 290 ms,
  quase todo esse tempo gasto esperando por uma conexão.
- Uma criação em massa de 100 linhas cujo `beforeSave` aguarda 50 ms resulta em uma transação
  aberta por 5,3 s, mantendo sua conexão e os locks de cada linha escrita até
  então durante todo esse tempo.

Portanto:

- Mantenha qualquer operação lenta fora dos hooks. Uma chamada para outro serviço pertence a um
  [job](/docs/backend/jobs), ou deve ocorrer após o retorno da escrita.
- Busque o que um hook precisa antes da escrita sempre que possível — no cliente ou
  em uma [custom function](/docs/backend/custom-functions) que então executa a escrita.
- Envie linhas cujos hooks são lentos em lotes menores.
- Se muitos hooks lentos forem executados simultaneamente por design, aumente o `DB_POOL_MAX`, dentro do limite
  que o `max_connections` do banco de dados permitir para cada instância.
- Com
  `REBASE_METRICS=true`, o `/metrics` relata `rebase_db_pool_wait_ms`: quanto tempo
  cada consulta aguardou por uma conexão. Um pool saudável mantém isso próximo de zero; uma cauda
  que cresce com o tráfego indica requisições aguardando na fila por conexões retidas
  pelos hooks. Consulte [Metrics](/docs/deployment/self-hosting/#metrics).
