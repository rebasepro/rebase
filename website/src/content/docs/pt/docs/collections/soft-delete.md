---
sourceHash: a289b69be61220df
title: Soft delete
sidebar_label: Soft delete
description: "O softDelete em uma tabela transforma a exclusão em um timestamp, oculta linhas marcadas de todas as leituras e as restaura com uma atualização comum."
---

## O que muda

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Com o `softDelete` ativado, uma exclusão **marca uma coluna em vez de remover a linha**,
e toda leitura filtra as linhas marcadas. Nada mais na operação
muda: a mesma permissão é exigida, `beforeDelete` ainda pode vetá-la e
`afterDelete` ainda é disparado. Do ponto de vista de quem fez a chamada, a linha foi excluída;
a forma como a tabela registra isso é responsabilidade dessa flag.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        reference: col.text().notNull(),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    softDelete: true,
    rls: "admin-only",
});
```

`true` usa a coluna `deletedAt` (SQL `deleted_at`). O formato de objeto especifica
outra coluna: `softDelete: { field: "archivedAt" }`. O campo é validado contra
as colunas da tabela pelos tipos.

:::caution[A coluna deve ser declarada por você]
A flag define o que uma coluna *significa*; ela não adiciona uma. Uma tabela que ativa
o `softDelete` sem declarar essa coluna, ou com uma coluna que não seja
`timestamptz`, `date` ou `time`, é recusada quando o schema é compilado — antes
que alguém tente remover uma linha.
:::

## O que uma leitura vê

Linhas marcadas ficam ocultas por padrão de `find`, `findById`, `count`,
das agregações, do refetch em tempo real e desta tabela quando carregada por meio
de uma relação. Esse padrão é o objetivo: o código escrito antes da flag existir continua
funcionando, e ninguém precisa se lembrar de filtrar.

Dois parâmetros de consulta liberam esse acesso:

| Parâmetro | Retorno |
|-----------|---------|
| `?deleted=include` | Linhas ativas **e** marcadas |
| `?deleted=only` | Apenas linhas marcadas — a visualização da lixeira |

Qualquer outro valor resulta em um 400 em vez de um fallback silencioso. `?deleted=true`
ocultando silenciosamente todas as linhas excluídas pareceria ter funcionado, mas responderia
à pergunta oposta.

## Restaurando e excluindo de verdade

Uma **restauração** é uma atualização comum definindo o campo de volta para `null`. Não
há verbo especial, porque não há estado especial — a linha nunca saiu do lugar.
Via REST, é um `PATCH` — individual, `/bulk` ou `_batch` — cujo corpo define o
campo como `null`:

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

Essa atualização é a única que alcança uma linha marcada. Qualquer outra edição nela retorna
`404`, da mesma forma que a linha responde a qualquer leitura padrão; restaure-a primeiro.

O inverso não é uma atualização. Definir o campo com um valor é recusado com `400`
`FIELD_NOT_WRITABLE` — em vez disso, exclua a linha — para que a permissão de `delete`,
`beforeDelete` e `afterDelete` sempre se apliquem a ela. Um upsert pode criar uma linha
que já esteja marcada, mas nunca marca uma que já estava armazenada.

Um upsert também não grava em uma linha que está na lixeira: quando a sua chave pertence a
uma linha marcada, ele é recusado com `409` `ROW_IN_TRASH` e nada é gravado.
Restaure a linha primeiro ou expurgue-a com `?hard=true` e faça o upsert novamente.

Uma exclusão através de um caminho many-to-many, como `DELETE /api/data/posts/1/tags/5`,
remove o vínculo do post 1 com a tag. Ela não faz soft delete da tag, que ainda
é usada por outros posts.

Um `DELETE` **real** é feito com `?hard=true` na chamada de exclusão. Ele precisa exatamente
da mesma permissão que uma exclusão comum: é o mesmo verbo, e controlá-lo
separadamente seria uma segunda superfície de controle de acesso para uma única operação. O que
ele muda é se a linha pode voltar ou não. Apenas o literal `true` ou `1` significa
sim; um erro de digitação resulta em 400, pois quem chamou solicitando o expurgo e recebeu
um soft delete acreditaria que os dados foram apagados.

## Pelo SDK

O cliente tipado acessa a lixeira por meio de `trash` em cada tabela. Ele envia
as requisições acima: `?deleted=only` nas leituras, a atualização para `null` para uma
restauração, e `?hard=true` para um expurgo.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` e `trash.count` recebem os mesmos parâmetros que `find` e `count`.
Uma restauração redefine `deletedAt`, a menos que você especifique o campo: uma tabela declarada
com `softDelete: { field: "archivedAt" }` restaura com
`trash.restore(7, { field: "archivedAt" })`. O cliente não consegue ler o nome do campo
a partir do servidor.

Use `trash` em uma tabela que declare `softDelete`. Em uma que não o declare,
o servidor ignora `?deleted=`, de modo que `trash.find` retorna as linhas ativas e
`trash.purge` age como uma exclusão comum.

O código no servidor possui o mesmo `trash`: `context.data.invoices.trash` em um hook,
e `rebase.data.invoices.trash` em uma function ou cron. Ele lê e expurga
através do driver, com os privilégios de quem fez a chamada, assim como o restante de
[`context.data`](/docs/collections/context-data-api).

Com o modo [offline](/docs/sdk/offline) habilitado, a lixeira nunca é armazenada em cache e nada
nela é enfileirado. Cada chamada precisa do servidor e falha com o erro `OFFLINE`
sem ele. Uma linha restaurada volta para o banco de dados local, e uma linha expurgada sai dele.

## Próximos passos

- **[Tabelas](/docs/schema/)** — onde o `softDelete` é declarado
- **[API REST](/docs/backend/api)** — os endpoints de exclusão e consulta aos quais estes parâmetros pertencem
- **[Segurança em nível de linha](/docs/collections/security-rules/)** — quem tem permissão para excluir uma linha
