---
sourceHash: 3a1b51e6e2ae57fd
title: Inférence de types
sidebar_label: Inférence de types
description: "InferRow, InferInsert et InferUpdate lisent les colonnes et les modificateurs d'une table pour typer les lignes qu'elle renvoie et les écritures qu'elle accepte — dans les hooks, dans le code serveur et dans un frontend qui importe le type de la table."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les types TypeScript d'une table sont déduits de sa déclaration. Rien n'est écrit
deux fois : modifiez une colonne, et chaque type qui en découle change avec elle.

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

Ce sont des types de transfert : ce que REST renvoie, ce que le SDK retourne et ce que
les hooks reçoivent. Un horodatage est une chaîne ISO, un `bigint` est un `number`, et une clé
étrangère est la clé.

## Les règles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| La colonne | `InferRow` | `InferInsert` | `InferUpdate` |
|---|---|---|---|
| `.notNull()` ou `.primaryKey()` | `T` | requis, sauf s'il a une valeur par défaut | optionnel |
| nullable (par défaut) | `T \| null` | optionnel, `T \| null` | optionnel, `T \| null` |
| avec une valeur par défaut ou un stamp | comme ci-dessus | optionnel | optionnel |
| `.primaryKey()` | `T` | comme ci-dessus | absent |
| `.readOnly()` ou `.generatedAlwaysAs()` | comme ci-dessus | absent | absent |
| `.private()` | absent | absent | absent |

Une colonne temporelle accepte également un objet `Date` dans `InferInsert` et `InferUpdate`, tout
comme lors d'une écriture. `{ enum: [...] }`, `.oneOf()`, `col.enum()` et `pgEnum` réduisent `T` à l'union de leurs valeurs,
et un [schéma JSON](/docs/schema/json/) type son document.

`.access()` ne modifie pas les types. Ils ont une forme unique pour chaque appelant, et
il n'existe pas de type de ligne unique adapté à la fois à un lecteur qui détient un rôle et à un
autre qui ne l'a pas. Un appelant sans ce rôle ne reçoit tout simplement pas la colonne.

## Clés étrangères

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une clé étrangère `belongsTo` que vous déclarez dans `columns` y est typée avec exactitude.
Celle dérivée par la relation est ajoutée sous forme de clé optionnelle nommée d'après sa colonne en
camelCase — `author_id` devient `authorId` — typée `string | number | null`. Déclarez
la colonne lorsque vous souhaitez son type exact ; les types générés par le SDK sont exacts
dans les deux cas.

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

## Clés d'une table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`ColumnKeyOf<typeof posts>` est l'union des clés de colonne d'une table, et
`RelationKeyOf<typeof posts>` l'union des noms de ses relations. Les deux fonctionnent
également sur les vues. Utilisez-les pour typer le code qui prend une colonne ou une relation par son nom.
Ils proviennent de `@rebasepro/types`, d'où `@rebasepro/server/schema` ne
les réexporte pas :

```ts
import type { ColumnKeyOf, RelationKeyOf } from "@rebasepro/types";
import type { posts } from "./posts";

type PostColumn = ColumnKeyOf<typeof posts>;     // "id" | "title" | "status" | …
type PostRelation = RelationKeyOf<typeof posts>; // never, for a table without relations
```

## Les hooks sont typés pour vous

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les [hooks](/docs/collections/callbacks/) d'une table sont typés à partir de ses colonnes
sans aucune annotation : `values` dans `beforeSave` est un `Partial` du type
d'insertion, `previousValues` ainsi que les lignes de `afterRead` et des hooks de suppression sont du
type de la ligne. Le `.transform()` d'une colonne reçoit le type de cette colonne en tant que `value` :
`T | null`, ou `T` lorsque `.notNull()` est écrit avant `.transform()`. Le `.transform()`
d'un champ JSON reçoit `T | undefined`, ou `T` après `.required()`.

## Dans un frontend

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un frontend peut importer le **type** d'une table depuis `backend/schema`, jamais sa valeur :

```ts
import type { InferRow } from "@rebasepro/server/schema";
import type { posts } from "../../backend/schema/posts";

export function PostTitle({ post }: { post: InferRow<typeof posts> }) {
    return post.title;
}
```

Un import de type est effacé au moment du build, donc aucun code backend —
hooks inclus — n'atteint le bundle du navigateur. Les personnalisations du CMS sont typées de la même manière :
`customizeTable<typeof posts>("posts", { … })` valide ses surcharges de champs
par rapport aux colonnes et relations de la table.
