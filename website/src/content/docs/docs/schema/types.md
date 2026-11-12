---
title: Type inference
sidebar_label: Type inference
description: "InferRow, InferInsert and InferUpdate read a table's columns and modifiers to type the rows it serves and the writes it accepts — in hooks, in server code, and in a frontend that imports the table's type."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table's TypeScript types are read off its declaration. Nothing is written
twice: change a column, and every type derived from it changes with it.

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
        createdAt: col.timestamptz().notNull().onCreateNow(),
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

These are wire types: what REST returns, what the SDK hands back and what hooks
receive. A timestamp is an ISO string, a `bigint` is a `number`, and a foreign
key is the key.

## The rules

<span class="since-badge" data-since="0.31">Since 0.31</span>

| The column | `InferRow` | `InferInsert` | `InferUpdate` |
|---|---|---|---|
| `.notNull()` or `.primaryKey()` | `T` | required, unless it has a default | optional |
| nullable (the default) | `T \| null` | optional, `T \| null` | optional, `T \| null` |
| with a default or a stamp | as above | optional | optional |
| `.primaryKey()` | `T` | as above | absent |
| `.readOnly()` or `.generatedAs()` | as above | absent | absent |
| `.private()` | absent | absent | absent |

A temporal column also accepts a `Date` in `InferInsert` and `InferUpdate`, as a
write does. `.oneOf()` and `col.enum()` narrow `T` to the union of their values,
and a [JSON shape](/docs/schema/json/) types its document.

`.access()` does not change the types. They are one shape for every caller, and
there is no single row type that is right for a reader who holds a role and one
who does not. A caller without the role simply does not receive the column.

## Foreign keys

<span class="since-badge" data-since="0.31">Since 0.31</span>

A `belongsTo` foreign key that you declare in `columns` is typed there, exactly.
One the relation derives is added as an optional key named after its column in
camelCase — `author_id` is `authorId` — typed `string | number | null`. Declare
the column when you want its exact type; the generated SDK types are exact
either way.

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

## Keys of a table

<span class="since-badge" data-since="0.31">Since 0.31</span>

`ColumnKeyOf<typeof posts>` is the union of a table's column keys, and
`RelationKeyOf<typeof posts>` the union of its relation names. Both work on
views too. Use them to type code that takes a column or a relation by name:

```ts
import type { ColumnKeyOf, RelationKeyOf } from "@rebasepro/server/schema";
import type { posts } from "./posts";

type PostColumn = ColumnKeyOf<typeof posts>;     // "id" | "title" | "status" | …
type PostRelation = RelationKeyOf<typeof posts>; // never, for a table without relations
```

## Hooks are typed for you

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table's [hooks](/docs/collections/callbacks/) are typed from its columns
without any annotation: `values` in `beforeSave` is a `Partial` of the insert
type, `previousValues` and the rows of `afterRead` and the delete hooks are the
row type. A column's `.transform()` receives that column's type as `value`.

## In a frontend

<span class="since-badge" data-since="0.31">Since 0.31</span>

A frontend may import a table's **type** from `backend/schema`, never its value:

```ts
import type { InferRow } from "@rebasepro/server/schema";
import type { posts } from "../../backend/schema/posts";

export function PostTitle({ post }: { post: InferRow<typeof posts> }) {
    return post.title;
}
```

A type import is erased at build time, so no backend code — hooks included —
reaches the browser bundle. CMS customizations are typed the same way:
`customizeTable<typeof posts>("posts", { … })` checks its field overrides
against the table's columns and relations.
