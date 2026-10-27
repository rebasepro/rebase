---
sourceHash: e515564ee1857435
title: Dados tipados no servidor
sidebar_label: Dados tipados no servidor
description: "Registre o seu tipo Database gerado uma vez, e context.data, rebase.dataAsAdmin e o rebase que uma função ou um cron recebe passam a ser tipados a partir dele: linhas, filtros, ordenações, includes e entradas de escrita."
---

O cliente do navegador é tipado passando o seu `Database` gerado para
`createRebaseClient<Database>()` (veja [Geração do SDK tipado](/docs/sdk#typed-sdk-generation)).
As superfícies de dados do lado do servidor não têm uma chamada assim para recebê-lo:

- `context.data` em um [callback de coleção](/docs/collections/callbacks),
- `rebase.dataAsAdmin` no singleton `rebase`,
- o `rebase` que uma [função customizada](/docs/backend/custom-functions) ou um
  [cron job](/docs/backend/cron-jobs) recebe.

Então você diz ao TypeScript uma vez, para o projeto inteiro, qual `Database` elas servem.
Até que você faça isso, elas permanecem sem tipos: qualquer coleção com qualquer nome, linhas como
`Record<string, unknown>`. Nada muda para um projeto que não registra nada.

## Registrar o `Database`

```bash
rebase generate-sdk --register
```

Além do SDK em `generated/sdk/`, isso grava dois arquivos em
`config/generated/`: uma cópia de `database.types.ts` e um `register.ts` que
declara o registro:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Eles ficam em `config/` porque os arquivos das suas coleções são compilados duas vezes, pelo
backend (cujo `tsconfig.json` inclui `../config/`) e pelo próprio `tsc` do pacote
`config`, e `config/` é o único diretório que ambos leem. Um
registro ali que importasse `../generated/sdk/` traria para a compilação desse pacote um arquivo de
fora de `config/`, o que o TypeScript recusa. Assim, um único registro tipa suas funções, seus cron jobs e os callbacks nos arquivos
das suas coleções, nas duas compilações. É apenas uma declaração: o runtime faz
exatamente o que fazia antes.

A opção é lembrada em `rebase.json`, como `"registerDatabase": true` no app
de backend, de modo que todo `rebase generate-sdk` posterior, e o `rebase dev` a cada
alteração de coleção, mantém os dois arquivos atualizados. O `.gitignore` do scaffold
ignora os diretórios `generated/`, então um clone novo não tem nenhum dos dois arquivos até
que algo os grave de novo. O `rebase build` (e o `rebase cloud deploy`, que
gera o mesmo bundle) os grava a partir das coleções antes de compilar,
então um job de CI que executa `rebase build` em um clone novo compila callbacks tipados.
Uma etapa de CI que compila o backend ou o pacote `config` de outra forma
(`tsc`, `pnpm build`) ainda precisa do `rebase generate-sdk` antes, ou os callbacks
que leem linhas tipadas compilam contra o `context.data` sem tipos e falham. Um
projeto sem
`rebase.json` continua registrando enquanto `config/generated/register.ts`
estiver lá. Para voltar aos dados do servidor sem tipos, remova `registerDatabase` e
exclua `config/generated/`.

Você também pode escrever o registro você mesmo, em qualquer arquivo que o backend compile
(`backend/src/rebase-env.d.ts`, importando `../../generated/sdk/database.types`).
Ele então alcança apenas a compilação do backend: no `tsc` do próprio pacote `config`,
`context.data` continua sendo o objeto sem tipos, então os callbacks precisam compilar nos dois casos.

## O que ele tipa

```ts
// config/collections/orders.ts — a callback
callbacks: {
    async beforeSave({ context, values }) {
        const { data } = await context.data.customers.find({
            where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
        });
        data[0]?.email;                      // completes from the customers Row

        await context.data.customer.find();  // error: no collection `customer`
        return values;
    }
}
```

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
        // `create` takes the collection's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Cada acessador é tipado como o do cliente do navegador: `find`, `findById`
e `listen` retornam o `Row` da coleção; `where` e `orderBy` são
indexados pelas suas colunas; `include` nomeia as suas relações; `create` recebe o seu
`Insert` e `update` o seu `Update`. Os acessadores são os nomes em camelCase do
arquivo gerado (`order_items` é `orderItems`).
O servidor resolve esses nomes pelas coleções registradas, então uma
coleção `my-notes` armazenada em uma tabela `notes` é `context.data.myNotes`.

`collection(slug)` com um slug que o `Database` declara é tipado da mesma forma:
`context.data.collection("my-notes")` é `context.data.myNotes`. Um slug que você
calcula em tempo de execução, ou um que o schema não declara, recebe o cliente
sem tipos.

## Uma função, sem o registro

`defineFunction` e `defineCron` também recebem o tipo como argumento, que prevalece
sobre o registro. Use-o para tipar um único arquivo, ou para experimentar dados tipados antes
de registrar:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helpers que recebem o objeto de dados

Um helper que recebe `context.data` ou `rebase.dataAsAdmin` nomeia o tipo
registrado, para que continue tipado e aceite ambos:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Um helper declarado com um `RebaseSdkData` simples mantém o tipo sem tipagem, e um
objeto de dados tipado não é atribuível a ele. Mude o parâmetro como acima quando
você registrar.
