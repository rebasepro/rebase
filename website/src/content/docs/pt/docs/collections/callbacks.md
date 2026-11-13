---
sourceHash: 067f45147f37ef16
title: Hooks de tabela
sidebar_label: Hooks de tabela
description: "Execute código no lado do servidor em cada etapa do ciclo de vida de uma tabela com hooks: restrinja leituras, mascare campos, valide e complete escritas, reaja a salvamentos e exclusões, e transforme colunas individuais."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os `hooks` de uma tabela são executados no servidor em cada etapa da vida de uma linha: antes de uma
leitura, em cada linha que sai do servidor, antes e depois de uma escrita, e antes e
depois de uma exclusão. Eles são executados para todas as portas de entrada da tabela — REST, o SDK,
realtime, MCP e código do servidor por meio de `rebase.data` — e seu código nunca
sai do servidor, portanto, uma chave de API ou uma leitura de `process.env` em um hook é segura.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique(),
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

:::note[Vindo de coleções?]
Os hooks de tabela são os `callbacks` de servidor de uma coleção, com o mesmo
ciclo de vida. Cada hook recebe o descritor da tabela como `table`, e `afterRead`
e os hooks de exclusão recebem a linha como `values`. O guia de atualização para esta
versão lista as renomeações.
:::

## Os sete hooks

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Hook | Executa | Retorna |
|---|---|---|
| `beforeQuery` | antes de cada leitura ser compilada | um filtro para combinar com AND na leitura, ou nada |
| `afterRead` | em cada linha que sai do servidor | a linha a ser servida |
| `beforeSave` | antes de uma criação ou atualização, dentro de sua transação | os valores a escrever; lance um erro (throw) para recusar |
| `afterSave` | após a escrita, antes do commit | nada; lance um erro (throw) para reverter a escrita |
| `afterSaveError` | após uma escrita falhar e ser revertida | nada |
| `beforeDelete` | antes de uma exclusão, dentro de sua transação | `false` ou lance um erro (throw) para recusar |
| `afterDelete` | após a exclusão, antes do commit | nada; lance um erro (throw) para reverter a exclusão |

Todo hook pode ser `async`. Todo hook recebe:

| Prop | O que é |
|---|---|
| `table` | A tabela como o servidor a conhece: seu descritor, com colunas, relações e a postura de `rls`. |
| `path` | O caminho endereçado pela requisição: o slug, ou um caminho aninhado. |
| `context` | O chamador (`context.user`), e `context.data` com escopo definido para ele. Consulte [A API `context.data`](/docs/collections/context-data-api/). |

Um mecanismo de escrita não os executa: **o sistema de autenticação**. O registro, login via OAuth
e o gerenciamento de usuários de um administrador escrevem diretamente na tabela de usuários. Consulte
[A tabela de usuários](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Uma tabela gravada pelo CMS diretamente no navegador, sem nenhum servidor Rebase no
caminho da requisição, nunca atinge esses hooks. O CMS possui hooks próprios no lado do navegador
para esse caso, descritos junto com as customizações do CMS.

## `beforeQuery`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Executa **antes de uma leitura ser compilada**, para restringir quais linhas ela solicita. Retorne
condições para combinar com AND na consulta; retorne nada para não adicionar nenhuma.

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

- **Só pode restringir.** `filter` aceita os mesmos filtros de campo que uma consulta aceita;
  `logical` aceita um grupo `or`/`and` para um escopo como "meu, ou compartilhado comigo",
  ainda assim combinado com AND como um todo.
- **É executado em todos os caminhos de leitura**: a listagem, uma busca individual (get), a contagem,
  a agregação, a busca, a leitura vetorial, uma listagem de caminho aninhado, a re-busca em tempo real
  por trás de um `.listen()`, e as linhas carregadas para uma relação ou um
  `?include=`, onde é o hook da tabela de **destino** que se aplica.
- **Um filtro que não pode ser compilado recusa a requisição.** Informar uma coluna que a tabela
  não possui resulta em 400, nunca em uma condição ignorada.
- **Uma escrita em uma linha que ele exclui resulta em 404.** Uma atualização ou exclusão direcionada a
  uma linha fora do escopo é recusada antes da escrita. A recusa de uma escrita com base em seu
  conteúdo é função de `beforeSave`.

A verificação de unicidade por trás de `.unique()` não é restringida: se fosse restringida, ela
responderia "único" para um valor que uma linha oculta já possui.

A segurança em nível de linha (Row-level security) é o modelo de autorização; `beforeQuery` é a lógica de
aplicação sobre ela. Use [`rls`](/docs/collections/security-rules/) para qualquer coisa
que também deva ser válida para SQL executado como o chamador.

## `beforeSave`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Executa antes de uma linha ser escrita e retorna os valores a serem gravados. `values` contém
todos os valores em uma criação e os modificados em uma atualização; `previousValues` é
a linha como ela era, em uma atualização; `status` é `"new"`, `"existing"` ou `"copy"`;
`id` fica ausente em uma criação cuja chave é gerada pelo banco de dados.

Ele é executado dentro da transação de escrita, portanto mantém uma conexão do pool ocupada durante
todo o tempo em que executa. Consulte [Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Lance um erro (throw) para **recusar a escrita**. Nada chega ao banco de dados, e o chamador
recebe **400** com a sua mensagem e o código `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Para escolher o status e o código — um 409 para conflito, um 422 para algo
bem formatado, mas inaceitável —, lance um `RebaseApiError`:

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

Importe `RebaseApiError` de `@rebasepro/types`: arquivos de schema não carregam código de servidor,
e essa é a mesma classe que o SDK tipado lança.

## `afterSave` e `afterSaveError`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`afterSave` executa após a linha ser escrita e antes do commit, na mesma
transação. Seus `values` são a linha como armazenada. Um erro lançado (throw) reverte o salvamento,
juntamente com tudo o que o hook escreveu por meio de `context.data`:

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
corpo do hook: eles mantêm a transação aberta durante uma viagem de ida e volta pela rede (round trip), e nada
os desfaz se a escrita for revertida. Em vez disso, enfileire um [job](/docs/backend/jobs/);
um job enfileirado a partir de um hook é comitado com a escrita.

`afterSaveError` executa quando um salvamento falha no banco de dados ou após ele, assim que a
transação da escrita que falhou tiver sido revertida. Ele não executa para uma recusa em
`beforeSave` ou para uma requisição recusada antes da escrita. Seu `context.data` é uma
instância nova para o mesmo chamador, portanto um job enfileirado por ele sobrevive à falha reportada. Um
erro lançado por ele é registrado em log, e o chamador ainda recebe o erro do próprio salvamento.

## `afterRead`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Executa em cada linha que sai do servidor — a resposta de uma leitura, a resposta de uma escrita,
um quadro de tempo real (realtime frame), um resultado MCP — e retorna a linha a ser servida. `values` é a
linha como armazenada, após o [acesso de campo](/docs/collections/field-access/) ter
removido o que o chamador não tem permissão para ler.

Ele molda o que o chamador recebe e nada mais: `afterSave`, os hooks de
exclusão e o [histórico](/docs/backend/history/) recebem a linha como armazenada, de modo que um valor
mascarado aqui nunca é o que uma auditoria registra ou o que uma reversão grava de volta. O histórico
também *serve* suas entradas por meio de `afterRead`, de forma que um snapshot mostra o valor
mascarado assim como a linha o faz.

Linhas incorporadas na resposta de outra tabela — um `include`, valores de uma referência de relação,
as linhas que um frame de realtime carrega para uma relação — são mascaradas em um
nível de profundidade com o `afterRead` da tabela de **destino**. A ordem é global, depois
tabela e depois `.transform({ afterRead })` da coluna. Um serviço de realtime sem
driver para executar os hooks recusa frames para uma tabela que os possui, em vez de
enviá-los sem máscara.

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
`afterRead`. Em uma tabela com esse hook, apenas `count()` sem `groupBy` é servido;
qualquer outra [agregação](/docs/sdk/aggregates-and-search/#aggregates) é recusada
com `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Um valor que um chamador nunca deve receber é melhor ocultado do que mascarado:
[`.access()` ou `.private()`](/docs/collections/field-access/) removem a coluna
antes que qualquer hook seja executado e a mantêm fora dos filtros também.

## `beforeDelete` e `afterDelete`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Ambos recebem a linha que está sendo excluída como `values`, e seu `id`.

`beforeDelete` executa dentro da transação de exclusão. Lance um erro (throw) para recusar a exclusão,
e o chamador receberá `400 CALLBACK_REJECTED` com sua mensagem. Retornar `false`
também a recusa, como `403 CALLBACK_REJECTED` sem nenhuma mensagem sua.

`afterDelete` executa após a linha ser excluída e antes do commit. Lançar um erro
reverte a exclusão. Em uma tabela com [soft delete](/docs/collections/soft-delete/),
uma exclusão é uma marcação de data/hora (stamp), e ambos os hooks ainda assim são executados.

## Hooks de campo: `.transform()`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `.transform()` de uma coluna aceita dois hooks em nível de campo: `beforeSave` retorna o
valor a ser armazenado, e `afterRead` retorna o valor a ser servido. Eles são executados no
servidor, para todos os chamadores, e recebem `value`, a linha inteira como `values` e
as props que todo hook recebe.

`value` é tipado com precisão: `T | null` em uma coluna anulável, e `T` quando
`.notNull()` é declarado **antes** de `.transform()`. Em um campo JSON é
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
[documento JSON](/docs/schema/json/). Para remoção de espaços (trim) e caixa alta/baixa, as
[regras de validação](/docs/schema/columns/#validation) `trim`, `lowercase` e `uppercase`
não precisam de código.

## Escrevendo em outras tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`context.data` lê e escreve em qualquer tabela pelo seu slug, como o chamador e na
mesma transação que a escrita que executou o hook:

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

A atualização acima salva `job_submissions` novamente, o que executa este hook de novo;
a verificação de status é o que o interrompe. [A API `context.data`](/docs/collections/context-data-api/)
aborda os privilégios com os quais ele executa, a transação e os limites de aninhamento.

## Hooks para todas as tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Hooks que se aplicam a todas as tabelas — mascaramento de PII em todo o schema, um log
global de auditoria — são exportados como `hooks` de `backend/hooks.ts`, no mesmo
formato `TableHooks`. Eles são executados antes dos hooks da própria tabela, que por sua vez executam antes
do `.transform()` de suas colunas. Consulte [Hooks globais](/docs/backend/hooks/).

Hooks também podem ser anexados após a inicialização com `setTableHooks(slug, hooks)` no
backend. Isso **substitui** os hooks que a tabela declarou; para adicioná-los aos existentes, passe
`composeTableHooks(declared, yours)`.

## Combinando conjuntos de hooks

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma tabela tem um único objeto `hooks`. Quando várias preocupações precisam de um hook — um gerador
de slug, uma trilha de auditoria, um escopo de tenant —, escreva cada uma como seu próprio conjunto e
combine-as com `composeTableHooks` de `@rebasepro/common`:

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

Os conjuntos são executados na ordem fornecida, e cada hook se combina da mesma forma que o backend
combina suas camadas global e de tabela:

| Hook | Combinado |
|---|---|
| `beforeSave` | Encadeado: cada conjunto vê os valores retornados pelo anterior, combinados superficialmente (shallow-merged) sobre o que foi recebido |
| `afterRead` | Encadeado: cada conjunto recebe a linha retornada pelo anterior |
| `beforeQuery` | Combinado com AND: cada conjunto vê a consulta do chamador, e uma linha precisa passar por todas as restrições |
| `beforeDelete` | Qualquer `false` veta a exclusão; todos os conjuntos ainda são executados |
| `afterSave`, `afterDelete` | Executados em ordem, cada um aguardado com await; um erro lançado interrompe os demais |
| `afterSaveError` | Executados em ordem; um erro lançado não interrompe o próximo conjunto, e o primeiro erro é relançado no final |

Um hook só estará presente no resultado se algum conjunto o possuir, e um conjunto `undefined` é
ignorado. Um conjunto escrito separadamente de sua tabela, como `auditTrail` acima, é tipado
com a linha genérica; portanto, leia seus valores como `unknown` e faça a validação dos tipos.

## Testando um hook

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um hook é uma função simples com um objeto de props, portanto um teste unitário o chama assim:
`posts.config.hooks?.beforeSave?.(props)`. `createCallContext` de
`@rebasepro/server` constrói a prop `context` apenas com os campos fornecidos pelo
teste; qualquer outro campo lança um erro no primeiro uso, identificando seu próprio nome. `table` é o
descritor retornado por `compileTables` de `@rebasepro/common` para a tabela. Para executar
hooks contra um banco de dados real, consulte [Scripts e o Console](/docs/backend/scripts/).

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [A API `context.data`](/docs/collections/context-data-api/): privilégios, transações e a conexão retida por um hook
- [Hooks globais](/docs/backend/hooks/): hooks em todas as tabelas
- [Histórico de entidades](/docs/backend/history/): uma trilha de auditoria sem a necessidade de escrever hooks
