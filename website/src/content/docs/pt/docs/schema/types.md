---
sourceHash: 3a1b51e6e2ae57fd
title: Inferência de tipos
sidebar_label: Inferência de tipos
description: "InferRow, InferInsert e InferUpdate leem as colunas e modificadores de uma tabela para tipar as linhas que ela fornece e as gravações que aceita — em hooks, no código do servidor e em um frontend que importa o tipo da tabela."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os tipos TypeScript de uma tabela são lidos a partir de sua declaração. Nada é escrito
duas vezes: altere uma coluna e todos os tipos derivados dela mudarão junto.

```ts
import { defineTable, col, type InferRow, type InferInsert, type InferUpdate } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        title:     col.text().notNull(),
        status:    col.enum(["draft", "published"]).notNull().default("draft"),
        summary:   col.text(),
        views:     col.integer().notNull().default(0).readOnly(),
        secret:    col.text().private(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    rls: "admin-only",
});

export type Post = InferRow<typeof posts>;
// { id: string; title: string; status: "draft" | "published"; summary: string | null;
//   views: number; createdAt: string }

export type NewPost = InferInsert<typeof posts>;
// { title: string; id?: string; status?: "draft" | "published"; summary?: string | null;
//   createdAt?: string | Date }

export type PostPatch = InferUpdate<typeof posts>;
// { title?: string; status?: "draft" | "published"; summary?: string | null;
//   createdAt?: string | Date }
```

Estes são tipos de transferência (*wire types*): o que o REST retorna, o que o SDK entrega
de volta e o que os hooks recebem. Um timestamp é uma string ISO, um `bigint` é um `number`
e uma chave estrangeira é a própria chave.

## As regras

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| A coluna | `InferRow` | `InferInsert` | `InferUpdate` |
|---|---|---|---|
| `.notNull()` ou `.primaryKey()` | `T` | obrigatório, a menos que tenha um valor padrão | opcional |
| anulável (o padrão) | `T \| null` | opcional, `T \| null` | opcional, `T \| null` |
| com um valor padrão ou um stamp | como acima | opcional | opcional |
| `.primaryKey()` | `T` | como acima | ausente |
| `.readOnly()` ou `.generatedAlwaysAs()` | como acima | ausente | ausente |
| `.private()` | ausente | ausente | ausente |

Uma coluna temporal também aceita um `Date` em `InferInsert` e `InferUpdate`, assim como uma
gravação aceita. `{ enum: [...] }`, `.oneOf()`, `col.enum()` e `pgEnum` restringem `T` à união de seus valores,
e uma [estrutura JSON](/docs/schema/json/) tipa seu documento.

`.access()` não altera os tipos. Eles possuem um formato único para cada chamador, e
não existe um tipo único de linha que seja adequado para um leitor que possui uma role e outro
que não possui. Um chamador sem a role simplesmente não recebe a coluna.

## Chaves estrangeiras

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma chave estrangeira `belongsTo` declarada em `columns` é tipada ali, exatamente.
Uma chave que a relação deriva é adicionada como uma chave opcional nomeada a partir de sua coluna em
camelCase — `author_id` torna-se `authorId` — tipada como `string | number | null`. Declare
a coluna quando quiser seu tipo exato; os tipos gerados pelo SDK são exatos
de qualquer forma.

```ts
import { defineTable, col, rel, type InferRow } from "@rebasepro/server/schema";
import { users } from "./users";

export const comments = defineTable("comments", {
    columns: {
        id:   col.uuid().primaryKey().defaultRandom(),
        body: col.text().notNull(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: "admin-only",
});

type Comment = InferRow<typeof comments>;
// { id: string; body: string; authorId?: string | number | null }
```

## Chaves de uma tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`ColumnKeyOf<typeof posts>` é a união das chaves de coluna de uma tabela, e
`RelationKeyOf<typeof posts>` a união dos nomes de suas relações. Ambos funcionam
em views também. Use-os para tipar código que recebe uma coluna ou uma relação por nome.
Eles vêm de `@rebasepro/types`, de onde `@rebasepro/server/schema` não os
reexporta:

```ts
import type { ColumnKeyOf, RelationKeyOf } from "@rebasepro/types";
import type { posts } from "./posts";

type PostColumn = ColumnKeyOf<typeof posts>;     // "id" | "title" | "status" | …
type PostRelation = RelationKeyOf<typeof posts>; // never, for a table without relations
```

## Os hooks são tipados para você

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os [hooks](/docs/collections/callbacks/) de uma tabela são tipados a partir de suas colunas
sem nenhuma anotação: `values` em `beforeSave` é um `Partial` do tipo de
inserção, `previousValues` e as linhas de `afterRead` e dos hooks de exclusão são o
tipo da linha. O `.transform()` de uma coluna recebe o tipo dessa coluna como `value`:
`T | null`, ou `T` quando `.notNull()` é declarado antes de `.transform()`. O `.transform()` de um
campo JSON recebe `T | undefined`, ou `T` após `.required()`.

## Em um frontend

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um frontend pode importar o **tipo** de uma tabela de `backend/schema`, nunca o seu valor:

```ts
import type { InferRow } from "@rebasepro/server/schema";
import type { posts } from "../../backend/schema/posts";

export function PostTitle({ post }: { post: InferRow<typeof posts> }) {
    return post.title;
}
```

Uma importação de tipo é removida no momento do build, portanto nenhum código de backend —
hooks inclusos — chega ao bundle do navegador. As customizações de CMS são tipadas da mesma forma:
`customizeTable<typeof posts>("posts", { … })` verifica suas sobrescritas de campos
em relação às colunas e relações da tabela.
