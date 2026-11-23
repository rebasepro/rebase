---
sourceHash: 1487ed768dd198b7
title: Hooks de tabela
sidebar_label: Hooks de tabela
description: "Execute código no servidor em cada etapa do ciclo de vida de uma tabela com hooks: restrinja leituras, mascare campos, valide e complete gravações, reaja a salvamentos e exclusões e transforme colunas individuais."
---

Os `hooks` de uma tabela são executados no servidor em cada etapa da vida de uma
linha: antes de uma leitura, em cada linha que sai do servidor, antes e depois
de uma gravação, e antes e depois de uma exclusão. Eles são executados para cada
porta de entrada da tabela — REST, o SDK, realtime, MCP e código de servidor por
meio de `rebase.data` — e seu código nunca sai do servidor, portanto, uma chave
de API ou uma leitura de `process.env` em um hook é segura.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique().serverDefault(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // Derive the slug from the title when none is given.
            const title = values.title ?? previousValues?.title;
            if (title && !values.slug && !previousValues?.slug) {
                values.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        beforeDelete: ({ values }) => {
            if (values.status === "published") {
                throw new Error("Unpublish the article before deleting it.");
            }
        },
    },
});
```

As props são tipadas a partir das colunas da tabela: `values.title` acima é uma
`string`, e `values.status` é `"draft" | "published"`.

`.serverDefault()` em `slug` indica o que o hook faz, já que seu código não pode
ser lido: uma criação pode omitir a coluna, o tipo de inserção do SDK a torna
opcional e o formulário do painel permite que um registro seja criado sem ela.

:::note[Vindo de collections?]
Os hooks de tabela são os `callbacks` de servidor de uma collection, com o mesmo
ciclo de vida. Cada hook recebe o descritor da tabela como `table`, e `afterRead`
e os hooks de exclusão recebem a linha como `values`. O guia de atualização desta
versão lista as renomeações.
:::

## Os sete hooks

| Hook | Quando executa | Retorna |
|---|---|---|
| `beforeQuery` | antes de cada leitura ser compilada | um filtro para combinar com AND na leitura, ou nada |
| `afterRead` | em cada linha que sai do servidor | a linha a ser servida |
| `beforeSave` | antes de uma criação ou atualização, dentro de sua transação | os valores a serem gravados; lance um erro (throw) para recusar |
| `afterSave` | após a gravação, antes do commit | nada; lance um erro para reverter a gravação |
| `afterSaveError` | após uma gravação falhar e ser revertida | nada |
| `beforeDelete` | antes de uma exclusão, dentro de sua transação | `false` ou lance um erro para recusar |
| `afterDelete` | após a exclusão, antes do commit | nada; lance um erro para reverter a exclusão |

Todo hook pode ser `async`. Todo hook recebe:

| Prop | O que é |
|---|---|
| `table` | A tabela como o servidor a conhece: seu descritor, com colunas, relações e a postura de `rls`. |
| `path` | O caminho endereçado pela requisição: o slug ou um caminho aninhado. |
| `context` | O chamador (`context.user`) e o `context.data` com escopo para ele. Consulte [A API `context.data`](/docs/collections/context-data-api/). |

Um gravador não os executa: **o sistema de autenticação**. O registro, login via
OAuth e o gerenciamento de usuários por administradores gravam diretamente na tabela
de usuários. Consulte [A tabela de usuários](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Uma tabela gravada pelo CMS diretamente no navegador, sem nenhum servidor Rebase
no caminho da requisição, nunca alcança esses hooks. O CMS possui hooks próprios
no lado do navegador para esse caso, descritos com as personalizações do CMS.

## `beforeQuery`

Executa **antes de uma leitura ser compilada**, para restringir quais linhas ela
solicita. Retorne condições para aplicar um AND na consulta; retorne nada para não
adicionar nenhuma.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text().notNull(),
        subject:  col.text().notNull(),
    },
    rls: [{ operation: "all", access: "authenticated" }],
    hooks: {
        beforeQuery: ({ operation, context }) => {
            // operation: "list" | "get" | "count" | "aggregate" | "relation"
            if (context.user?.roles?.includes("admin")) return;
            return { filter: { tenantId: ["==", String(context.user?.uid ?? "")] } };
        },
    },
});
```

- **Ele só pode restringir.** `filter` aceita os mesmos filtros de campo que uma
  consulta aceita; `logical` aceita um grupo `or`/`and` para um escopo como
  "meu, ou compartilhado comigo", ainda aplicado com AND como um todo.
- **Ele é executado em todos os caminhos de leitura**: listagem, uma busca única
  (get), contagem (count), agregação, busca textual, leitura vetorial, listagem de
  caminho aninhado, a re-busca em tempo real por trás de um `.listen()` e as
  linhas carregadas para uma relação ou um `?include=`, onde é o hook da tabela
  de **destino** que se aplica.
- **Um filtro que não puder ser compilado recusa a requisição.** Informar uma
  coluna que a tabela não possui resulta em um 400, nunca em uma condição
  descartada.
- **Uma gravação em uma linha que ele exclui resulta em 404.** Uma atualização ou
  exclusão direcionada a uma linha fora do escopo é recusada antes da gravação.
  Recusar uma gravação com base em seu conteúdo é função do `beforeSave`.

A verificação de unicidade por trás de `.unique()` não é restringida: se fosse
restringida, ela responderia "único" para um valor que uma linha oculta já possui.

A segurança em nível de linha (Row-level security - RLS) é o modelo de
autorização; `beforeQuery` é a lógica de aplicação sobre ela. Use
[`rls`](/docs/collections/security-rules/) para qualquer coisa que deva ser
válida também para SQL executado como o chamador.

## `beforeSave`

Executa antes de uma linha ser gravada e retorna os valores a serem gravados.
`values` contém todos os valores em uma criação e os alterados em uma atualização;
`previousValues` é a linha como ela era, em uma atualização; `status` é `"new"`,
`"existing"` ou `"copy"`; `id` está ausente em uma criação cuja chave é gerada pelo
banco de dados.

Ele é executado dentro da transação da gravação, portanto, mantém uma conexão do
pool aberta durante todo o tempo de sua execução. Consulte [Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Lance um erro para **recusar a gravação**. Nada chega ao banco de dados, e o
chamador recebe **400** com sua mensagem e o código `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Para escolher o status e o código — 409 para um conflito, 422 para algo
bem-formado mas inaceitável — lance um `RebaseApiError`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        slug:  col.text().notNull(),
        price: col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: async ({ values, context }) => {
            if (values.slug) {
                const taken = await context.data.products.count({ where: { slug: ["==", values.slug] } });
                if (taken > 0) throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
            }
            return values;
        },
    },
});
```

Importe `RebaseApiError` de `@rebasepro/types`: arquivos de schema não carregam
código do servidor, e essa é a mesma classe que o SDK tipado lança.

## `afterSave` e `afterSaveError`

`afterSave` é executado após a linha ser gravada e antes do commit, na mesma
transação. Suas `values` representam a linha conforme armazenada. Lançar um erro
reverte o salvamento, juntamente com tudo o que o hook gravou por meio de
`context.data`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, status, values, context }) => {
            // Commits with the order, or not at all.
            await context.data.audit_log.create({ table: "orders", rowId: String(id), action: status, state: values.status });
        },
    },
});
```

Trabalhos que saem do banco de dados — um e-mail, um webhook — não pertencem ao
corpo do hook: isso mantém a transação aberta durante uma viagem de ida e volta na
rede (round trip), e nada desfaz a ação se a gravação for revertida. Em vez disso,
enfileire um [job](/docs/backend/jobs/); um job enfileirado a partir de um hook
é commitado junto com a gravação.

`afterSaveError` é executado quando um salvamento falha no banco de dados ou após
ele, assim que a transação da gravação com falha tiver sido revertida. Ele não é
executado para uma recusa em `beforeSave` ou uma requisição recusada antes da
gravação. Seu `context.data` é novo para o mesmo chamador, portanto, um job
enfileirado por ele sobrevive à falha que relata. Um erro lançado por ele é
registrado em log, e o chamador ainda recebe o erro original do salvamento.

## `afterRead`

Executa em cada linha que sai do servidor — a resposta de uma leitura, a resposta
de uma gravação, um frame de realtime, um resultado MCP — e retorna a linha a ser
servida. `values` é a linha como armazenada, depois que o [acesso ao campo](/docs/collections/field-access/)
tiver removido o que o chamador não pode ler.

Ele molda o que o chamador recebe e nada mais: `afterSave`, os hooks de exclusão
e o [histórico](/docs/backend/history/) recebem a linha como armazenada, portanto,
um valor mascarado aqui nunca é o que uma auditoria registra ou o que uma reversão
grava de volta. O histórico também *serve* suas entradas através do `afterRead`,
de modo que um snapshot mostra o valor mascarado assim como a linha o faz.

Linhas incorporadas na resposta de outra tabela — um `include`, valores de
referência de relação, as linhas que um frame de realtime carrega para uma
relação — são mascaradas em um nível de profundidade com o `afterRead` da tabela
de **destino**. A ordem é global, depois tabela, depois `.transform({ afterRead })`
da coluna. Um serviço de realtime sem um driver para executar os hooks recusa frames
para uma tabela que os possui, em vez de enviá-los sem mascaramento.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        email: col.text().notNull(),
        phone: col.text(),
    },
    rls: [{ operation: "select", roles: ["support", "sales"] }],
    hooks: {
        // Mask contact details for everyone but support.
        afterRead: ({ values, context }) => {
            if (context.user?.roles?.includes("support")) return values;
            return {
                ...values,
                email: values.email.replace(/^(.).*(@.*)$/, "$1***$2"),
                phone: values.phone === null ? null : "•••",
            };
        },
    },
});
```

Uma agregação retorna somas e contagens, não linhas, portanto não pode passar por
`afterRead`. Em uma tabela que o possua, apenas `count()` sem `groupBy` é servido;
qualquer outra [agregação](/docs/sdk/aggregates-and-search/#aggregates) é recusada
com `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Um valor que o chamador nunca deve receber é melhor ocultado do que mascarado:
[`.access()` ou `.private()`](/docs/collections/field-access/) removem a coluna
antes que qualquer hook seja executado e a mantêm fora dos filtros também.

## `beforeDelete` e `afterDelete`

Ambos recebem a linha que está sendo excluída como `values` e seu `id`.

`beforeDelete` é executado dentro da transação da exclusão. Lance um erro para
recusar a exclusão, e o chamador receberá `400 CALLBACK_REJECTED` com sua mensagem.
Retornar `false` também a recusa, como `403 CALLBACK_REJECTED` sem nenhuma
mensagem sua.

`afterDelete` é executado após a linha ser excluída e antes do commit. Lançar um
erro reverte a exclusão. Em uma tabela com [soft delete](/docs/collections/soft-delete/),
uma exclusão é uma marcação, e ambos os hooks continuam sendo executados.

## Hooks de campo: `.transform()`

O `.transform()` de uma coluna aceita dois hooks em nível de campo: `beforeSave`
retorna o valor a ser armazenado, e `afterRead` retorna o valor a ser servido.
Eles são executados no servidor para cada chamador e recebem `value`, a linha
inteira como `values` e as props que todo hook recebe.

`value` é tipado com precisão: `T | null` em uma coluna anulável e `T` quando
`.notNull()` for escrito **antes** de `.transform()`. Em um campo JSON, é
`T | undefined`, a menos que `.required()` venha primeiro.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contacts = defineTable("contacts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => value.trim().toLowerCase(),
        }),
        iban: col.text().transform({
            afterRead: ({ value, context }) =>
                value && !context.user?.roles?.includes("finance") ? `•••• ${value.slice(-4)}` : value,
        }),
    },
    rls: "admin-only",
});
```

`.transform()` também está disponível em itens de array e em cada campo de um
[documento JSON](/docs/schema/json/). Para remoção de espaços e caixa de texto (case),
as [regras de validação](/docs/schema/columns/#validation) `trim`, `lowercase` e
`uppercase` não precisam de código.

## Gravando em outras tabelas

`context.data` lê e grava em qualquer tabela pelo seu slug, como o chamador e na
mesma transação que a gravação que executou o hook:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const submissions = defineTable("job_submissions", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        title:         col.text().notNull(),
        status:        col.enum(["pending", "approved", "rejected"]).notNull().default("pending"),
        promotedJobId: col.uuid(),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, values, previousValues, context }) => {
            // When a submission is approved, publish it as a job and link it back.
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const job = await context.data.jobs.create({ title: values.title, status: "published" });
                await context.data.job_submissions.update(id, { promotedJobId: job.id });
            }
        },
    },
});
```

A atualização acima salva `job_submissions` novamente, o que executa este hook
novamente; a verificação de status é o que impede isso. [A API `context.data`](/docs/collections/context-data-api/)
cobre os privilégios com os quais ela é executada, a transação e os limites de aninhamento.

## Hooks para todas as tabelas

Hooks que se aplicam a todas as tabelas — mascaramento de PII em todo o schema,
um log de auditoria global — são exportados como `hooks` de `backend/hooks.ts`, no
mesmo formato `TableHooks`. Eles são executados antes dos hooks da própria tabela,
que por sua vez são executados antes do `.transform()` de suas colunas. Consulte
[Hooks globais](/docs/backend/hooks/).

Os hooks também podem ser vinculados após a inicialização com `setTableHooks(slug, hooks)`
no backend. Isso **substitui** os hooks que a tabela declarou; para adicioná-los
aos existentes, passe `composeTableHooks(declared, yours)`.

## Combinando conjuntos de hooks

Uma tabela tem um único objeto `hooks`. Quando várias preocupações demandam um
hook — um gerador de slugs, uma trilha de auditoria, um escopo de tenant —
escreva cada uma como seu próprio conjunto e combine-os com `composeTableHooks`
de `@rebasepro/common`:

```ts
import { defineTable, col, type TableHooks } from "@rebasepro/server/schema";
import { composeTableHooks } from "@rebasepro/common";

const auditTrail: TableHooks = {
    afterSave: async ({ table, id, status, context }) => {
        await context.data.audit_log.create({ table: table.slug, rowId: String(id), action: status });
    },
};

export const pages = defineTable("pages", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug:  col.text(),
    },
    rls: "admin-only",
    hooks: composeTableHooks(auditTrail, {
        beforeSave: ({ values }) =>
            typeof values.title === "string" && !values.slug
                ? { ...values, slug: values.title.toLowerCase().replace(/\s+/g, "-") }
                : values,
    }),
});
```

Os conjuntos são executados na ordem fornecida, e cada hook combina da mesma
forma que o backend combina suas camadas global e de tabela:

| Hook | Comportamento combinado |
|---|---|
| `beforeSave` | Encadeado: cada conjunto vê os valores retornados pelo anterior, combinados superficialmente (shallow-merged) sobre o que foi recebido |
| `afterRead` | Encadeado: cada conjunto recebe a linha retornada pelo anterior |
| `beforeQuery` | Combinado com AND: todo conjunto vê a consulta do chamador, e uma linha deve passar por todas as restrições |
| `beforeDelete` | Qualquer `false` veta a exclusão; todos os conjuntos continuam executando |
| `afterSave`, `afterDelete` | Executam em ordem, cada um aguardado (awaited); lançar um erro interrompe os demais |
| `afterSaveError` | Executam em ordem; lançar um erro não interrompe o próximo conjunto, e o primeiro erro é relançado ao final |

Um hook só estará no resultado se algum conjunto o possuir, e um conjunto `undefined`
é ignorado. Um conjunto escrito separadamente de sua tabela, como `auditTrail`
acima, é tipado com a linha genérica, portanto, leia seus valores como `unknown`
e faça a checagem deles.

## Testando um hook

Um hook é uma função simples que recebe um objeto de props, portanto, um teste
unitário a invoca diretamente: `posts.config.hooks?.beforeSave?.(props)`.
`createCallContext` de `@rebasepro/server` constrói a prop `context` contendo
apenas os campos passados pelo teste; qualquer outro campo lança um erro no
primeiro uso, identificando a si mesmo. `table` é o descritor retornado por
`compileTables` de `@rebasepro/common` para a tabela. Para executar hooks contra um
banco de dados real, consulte [Scripts e o Console](/docs/backend/scripts/).

## Próximos passos

- [A API `context.data`](/docs/collections/context-data-api/): privilégios, transações e a conexão retida por um hook
- [Hooks globais](/docs/backend/hooks/): hooks em todas as tabelas
- [Histórico de entidades](/docs/backend/history/): uma trilha de auditoria sem escrever hooks
