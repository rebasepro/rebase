---
sourceHash: 3a1b51e6e2ae57fd
title: Inferencia de tipos
sidebar_label: Inferencia de tipos
description: "InferRow, InferInsert e InferUpdate leen las columnas y modificadores de una tabla para tipar las filas que entrega y las escrituras que acepta: en hooks, en código de servidor y en un frontend que importe el tipo de la tabla."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los tipos de TypeScript de una tabla se deducen a partir de su declaración. Nada
se escribe dos veces: cambia una columna y todos los tipos derivados de ella cambiarán
con ella.

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

Estos son tipos de transferencia (*wire types*): lo que devuelve REST, lo que entrega
el SDK y lo que reciben los hooks. Un timestamp es una cadena ISO, un `bigint` es un
`number` y una clave foránea es la clave.

## Las reglas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| La columna | `InferRow` | `InferInsert` | `InferUpdate` |
|---|---|---|---|
| `.notNull()` o `.primaryKey()` | `T` | obligatorio, a menos que tenga un valor por defecto | opcional |
| admite valores nulos (por defecto) | `T \| null` | opcional, `T \| null` | opcional, `T \| null` |
| con un valor por defecto o un stamp | como arriba | opcional | opcional |
| `.primaryKey()` | `T` | como arriba | ausente |
| `.readOnly()` o `.generatedAlwaysAs()` | como arriba | ausente | ausente |
| `.private()` | ausente | ausente | ausente |

Una columna temporal también acepta un `Date` en `InferInsert` e `InferUpdate`, al
igual que lo hace una escritura. `{ enum: [...] }`, `.oneOf()`, `col.enum()` y `pgEnum`
restringen `T` a la unión de sus valores, y una [estructura JSON](/docs/schema/json/) tipa su documento.

`.access()` no cambia los tipos. Tienen una única estructura para cada llamador, y
no existe un tipo de fila único que sea adecuado para un lector que tiene un rol y
otro que no. Un llamador sin el rol simplemente no recibe la columna.

## Claves foráneas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una clave foránea `belongsTo` que declares en `columns` se tipa allí, con exactitud.
Aquella que la relación deriva se añade como una clave opcional con el nombre de su
columna en camelCase —`author_id` pasa a ser `authorId`— tipada como `string | number | null`.
Declara la columna cuando desees su tipo exacto; los tipos generados por el SDK son exactos
en ambos casos.

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

## Claves de una tabla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`ColumnKeyOf<typeof posts>` es la unión de las claves de columna de una tabla, y
`RelationKeyOf<typeof posts>` la unión de sus nombres de relación. Ambos funcionan
también en vistas. Utilízalos para tipar código que reciba una columna o una relación
por su nombre. Provienen de `@rebasepro/types`, ya que `@rebasepro/server/schema` no
los reexporta:

```ts
import type { ColumnKeyOf, RelationKeyOf } from "@rebasepro/types";
import type { posts } from "./posts";

type PostColumn = ColumnKeyOf<typeof posts>;     // "id" | "title" | "status" | …
type PostRelation = RelationKeyOf<typeof posts>; // never, for a table without relations
```

## Los hooks se tipan automáticamente

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los [hooks](/docs/collections/callbacks/) de una tabla se tipan a partir de sus columnas
sin necesidad de ninguna anotación: `values` en `beforeSave` es un `Partial` del tipo
de inserción, mientras que `previousValues` y las filas de `afterRead` y de los hooks
de eliminación corresponden al tipo de fila. El método `.transform()` de una columna
recibe el tipo de dicha columna como `value`: `T | null`, o `T` cuando se escribe
`.notNull()` antes de `.transform()`. El `.transform()` de un campo JSON recibe
`T | undefined`, o `T` después de `.required()`.

## En un frontend

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un frontend puede importar el **tipo** de una tabla desde `backend/schema`, pero nunca su valor:

```ts
import type { InferRow } from "@rebasepro/server/schema";
import type { posts } from "../../backend/schema/posts";

export function PostTitle({ post }: { post: InferRow<typeof posts> }) {
    return post.title;
}
```

Una importación de tipo se elimina en tiempo de compilación (*build time*), por lo que
ningún código del backend —hooks incluidos— llega al bundle del navegador. Las
personalizaciones del CMS se tipan de la misma manera: `customizeTable<typeof posts>("posts", { … })`
comprueba sus anulaciones de campos frente a las columnas y relaciones de la tabla.
