---
sourceHash: d08c6bb1dfd3357e
title: Dados tipados no lado do servidor
sidebar_label: Dados tipados no lado do servidor
description: "Registre o tipo Database gerado uma vez, e context.data, rebase.dataAsAdmin e o rebase que uma função ou cron recebe serão tipados a partir dele: linhas, filtros, ordenações, includes e entradas de escrita."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O cliente do navegador é tipado passando o seu `Database` gerado para
`createRebaseClient<Database>()` (consulte [Typed SDK Generation](/docs/sdk#typed-sdk-generation)).
As superfícies de dados no lado do servidor não possuem tal chamada para recebê-lo:

- `context.data` em um [hook de tabela](/docs/collections/callbacks),
- `rebase.dataAsAdmin` no singleton `rebase`,
- o `rebase` recebido por uma [função customizada](/docs/backend/custom-functions) ou uma
  [tarefa cron](/docs/backend/cron-jobs).

Portanto, você informa ao TypeScript uma vez, para todo o projeto, qual `Database` elas atendem.
Até que você faça isso, elas permanecem não tipadas: qualquer tabela com qualquer nome, linhas como
`Record<string, unknown>`. Nada muda para um projeto que não registra nada.

Existem duas maneiras de registrar: o `Database` gerado, que é exato, ou
o seu próprio módulo `backend/schema`, que não precisa da execução de codegen.

## Registrar o `Database` gerado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase generate-sdk --register
```

Além do SDK em `generated/sdk/`, isso grava dois arquivos em
`backend/generated/`: uma cópia de `database.types.ts` e um `register.ts` que
declara o registro:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Eles ficam em `backend/` porque esse é o programa no qual os hooks, funções e
crons que eles tipam são compilados, e os tipos são copiados ao lado do
registro em vez de serem importados de `generated/sdk/`, que fica fora do
`rootDir` do backend. É apenas uma declaração: o runtime faz exatamente o que
fazia antes. O `--register` recusa-se a sobrescrever um `register.ts` que ele não
tenha criado.

A flag é memorizada em `rebase.json`, como `"registerDatabase": true` no
app de backend, de modo que cada `rebase generate-sdk` posterior, e `rebase dev` a cada
alteração em `backend/schema/`, mantém ambos os arquivos atualizados. O `.gitignore`
do scaffold ignora os diretórios `generated/`, portanto, um clone novo não tem nenhum dos
arquivos até que algo os gere novamente. O `rebase build` (e o
`rebase cloud deploy`, que compila o mesmo bundle) grava esses arquivos a partir das
tabelas antes de compilar, portanto, um job de CI que executa `rebase build` em um clone
novo compila hooks tipados. Uma etapa de CI que compila o backend de outra forma
(`tsc`, `pnpm build`) ainda precisa do `rebase generate-sdk` primeiro, ou hooks que
leem linhas tipadas compilarão contra o `context.data` não tipado e falharão. Um projeto
sem `rebase.json` continua registrando enquanto o
`backend/generated/register.ts` estiver presente. Para voltar aos dados não tipados
no lado do servidor, remova `registerDatabase` e exclua `backend/generated/`.

## Registrar o schema, sem codegen

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um projeto que não gerou nada registra seu módulo de schema em vez disso,
e é tipado diretamente a partir de seus `defineTable`s:

```ts
// backend/rebase-env.d.ts
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("./schema");
    }
}
```

Cada exportação do módulo que seja uma tabela ou uma view é tipada sob seu
acessador (`orderItems` para `order_items`), com o `Row`, `Insert` e `Update`
que o gerador emitiria — exato para cada coluna declarada. É mais flexível em
relações, porque o destino de uma relação está por trás de um thunk não tipado: uma
chave estrangeira derivada é `string | number`, uma linha incluída é `Record<string, unknown>`,
e um `include` aninhado não é verificado. O `Database` gerado é exato para todos
estes casos, e prevalece quando ambos estão registrados. [Tipos
inferidos](/docs/schema/types/) aborda o que o `DatabaseOf` pode ou não saber.

Uma superfície é tipada apenas a partir do `Database` gerado: `context.data` dentro
dos hooks de tabela desse mesmo schema, porque tipar os hooks de um schema a partir do próprio
schema é uma dependência cíclica que o TypeScript rejeita.

## O que ele tipa

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
// backend/schema/orders.ts — a hook
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric().notNull(),
    },
    rls: "admin-only",
    hooks: {
        async beforeSave({ context, values }) {
            const { data } = await context.data.customers.find({
                where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
            });
            data[0]?.email;                      // completes from the customers Row
            return values;
        },
    },
});
```

Com o `Database` gerado registrado, `context.data.customer` (tabela inexistente)
naquele hook é um erro de tipo.

```ts
// backend/functions/stats.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/", async (c) => {
        const { data } = await rebase.dataAsAdmin.orders.find({
            where: { status: ["==", "paid"] },   // `status` and its values are checked
        });
        return c.json({ paid: data.length });
    });
});
```

```ts
// backend/crons/cleanup.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "Cleanup",
    schedule: "0 3 * * *",
    async handler({ rebase }) {
        // `create` takes the table's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Cada acessador é tipado da mesma forma que o do cliente de navegador: `find`, `findById`
e `listen` retornam o `Row` da tabela; `where` e `orderBy` são
indexados por suas colunas; `include` nomeia suas relações; `create` recebe seu
`Insert` e `update` seu `Update`. Os acessadores são os nomes em camelCase do
arquivo gerado (`order_items` é `orderItems`).
O servidor resolve esses nomes por meio das tabelas servidas, de modo que uma tabela cujo
slug é `my-notes` (armazenada em uma tabela `notes`) é `context.data.myNotes`.

`table(slug)` com um slug que o `Database` declara é tipado da mesma forma:
`context.data.table("my-notes")` é `context.data.myNotes`. Um slug calculado
em tempo de execução, ou que o schema não declara, obtém o cliente
não tipado.

## Uma única função, sem o registro

`defineFunction` e `defineCron` também aceitam o tipo como argumento, o que prevalece
sobre o registro. Use isso para tipar um único arquivo ou para experimentar dados tipados antes
de registrar:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helpers que recebem o objeto de dados

Um helper que recebe `context.data` ou `rebase.dataAsAdmin` referencia o
tipo registrado, mantendo-se tipado e aceitando ambos:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Um helper declarado com um `RebaseSdkData` simples mantém o tipo não tipado, e um
objeto de dados tipado não é atribuível a ele. Altere o parâmetro como mostrado acima quando
fizer o registro.
