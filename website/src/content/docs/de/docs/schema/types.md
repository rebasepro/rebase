---
sourceHash: 3a1b51e6e2ae57fd
title: Typinferenz
sidebar_label: Typinferenz
description: "InferRow, InferInsert und InferUpdate lesen die Spalten und Modifikatoren einer Tabelle aus, um die Zeilen, die sie ausliefert, und die Schreibvorgänge, die sie akzeptiert, zu typisieren – in Hooks, im Server-Code und in einem Frontend, das den Typ der Tabelle importiert."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die TypeScript-Typen einer Tabelle werden aus ihrer Deklaration abgeleitet. Nichts wird doppelt geschrieben: Ändert sich eine Spalte, ändern sich alle davon abgeleiteten Typen automatisch mit.

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

Dies sind Wire-Typen: was REST zurückgibt, was das SDK liefert und was Hooks empfangen. Ein Zeitstempel ist ein ISO-String, ein `bigint` ist eine `number` und ein Fremdschlüssel ist der Schlüssel.

## Die Regeln

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Die Spalte | `InferRow` | `InferInsert` | `InferUpdate` |
|---|---|---|---|
| `.notNull()` oder `.primaryKey()` | `T` | erforderlich, sofern kein Standardwert vorhanden ist | optional |
| nullable (Standard) | `T \| null` | optional, `T \| null` | optional, `T \| null` |
| mit Standardwert oder Zeitstempel | wie oben | optional | optional |
| `.primaryKey()` | `T` | wie oben | nicht vorhanden |
| `.readOnly()` oder `.generatedAlwaysAs()` | wie oben | nicht vorhanden | nicht vorhanden |
| `.private()` | nicht vorhanden | nicht vorhanden | nicht vorhanden |

Eine zeitbezogene Spalte akzeptiert in `InferInsert` und `InferUpdate` wie bei einem Schreibvorgang auch ein `Date`. `{ enum: [...] }`, `.oneOf()`, `col.enum()` und `pgEnum` schränken `T` auf die Vereinigung ihrer Werte ein, und eine [JSON-Form](/docs/schema/json/) typisiert ihr Dokument.

`.access()` ändert die Typen nicht. Sie haben für jeden Aufrufer dieselbe Form, und es gibt keinen einzelnen Zeilentyp, der sowohl für einen lesenden Zugriff mit einer bestimmten Rolle als auch ohne Rolle passend wäre. Ein Aufrufer ohne die entsprechende Rolle erhält die Spalte schlichtweg nicht.

## Fremdschlüssel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein `belongsTo`-Fremdschlüssel, der in `columns` deklariert wird, ist dort exakt typisiert. Ein von der Relation abgeleiteter Schlüssel wird als optionaler Schlüssel hinzugefügt, der nach seiner Spalte in camelCase benannt ist – `author_id` wird zu `authorId` – typisiert als `string | number | null`. Deklarieren Sie die Spalte, wenn Sie ihren genauen Typ benötigen; die generierten SDK-Typen sind in beiden Fällen exakt.

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

## Schlüssel einer Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`ColumnKeyOf<typeof posts>` ist die Union der Spaltenschlüssel einer Tabelle und `RelationKeyOf<typeof posts>` die Union ihrer Relationsnamen. Beide funktionieren auch bei Views. Verwenden Sie sie, um Code zu typisieren, der eine Spalte oder Relation über den Namen entgegennimmt. Sie stammen aus `@rebasepro/types`, woraus `@rebasepro/server/schema` sie nicht erneut exportiert:

```ts
import type { ColumnKeyOf, RelationKeyOf } from "@rebasepro/types";
import type { posts } from "./posts";

type PostColumn = ColumnKeyOf<typeof posts>;     // "id" | "title" | "status" | …
type PostRelation = RelationKeyOf<typeof posts>; // never, for a table without relations
```

## Hooks werden automatisch typisiert

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die [Hooks](/docs/collections/callbacks/) einer Tabelle werden ohne zusätzliche Typannotationen anhand ihrer Spalten typisiert: `values` in `beforeSave` ist ein `Partial` des Insert-Typs, `previousValues` sowie die Zeilen von `afterRead` und den Delete-Hooks entsprechen dem Row-Typ. Das `.transform()` einer Spalte empfängt den Typ dieser Spalte als `value`: `T | null` oder `T`, wenn `.notNull()` vor `.transform()` angegeben ist. Das `.transform()` eines JSON-Felds erhält `T | undefined` oder `T` nach `.required()`.

## Im Frontend

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Frontend darf den **Typ** einer Tabelle aus `backend/schema` importieren, niemals jedoch deren Wert:

```ts
import type { InferRow } from "@rebasepro/server/schema";
import type { posts } from "../../backend/schema/posts";

export function PostTitle({ post }: { post: InferRow<typeof posts> }) {
    return post.title;
}
```

Ein Typ-Import wird beim Build-Vorgang entfernt, sodass kein Backend-Code – einschließlich Hooks – in das Browser-Bundle gelangt. CMS-Anpassungen werden auf die gleiche Weise typisiert: `customizeTable<typeof posts>("posts", { … })` prüft seine Feldüberschreibungen anhand der Spalten und Relationen der Tabelle.
