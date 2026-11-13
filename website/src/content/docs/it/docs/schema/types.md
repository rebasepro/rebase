---
sourceHash: 3a1b51e6e2ae57fd
title: Inferenza dei tipi
sidebar_label: Inferenza dei tipi
description: "InferRow, InferInsert e InferUpdate leggono le colonne e i modificatori di una tabella per tipizzare le righe restituite e le scritture accettate — negli hook, nel codice server e in un frontend che importa il tipo della tabella."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

I tipi TypeScript di una tabella vengono ricavati direttamente dalla sua dichiarazione. Nulla viene scritto due volte: modificando una colonna, ogni tipo da essa derivato cambierà di conseguenza.

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

Questi sono tipi di trasmissione (wire types): ciò che REST restituisce, ciò che l'SDK fornisce e ciò che gli hook ricevono. Un timestamp è una stringa ISO, un `bigint` è un `number` e una foreign key è la chiave stessa.

## Le regole

<span class="since-badge" data-since="0.31">Da 0.31</span>

| La colonna | `InferRow` | `InferInsert` | `InferUpdate` |
|---|---|---|---|
| `.notNull()` o `.primaryKey()` | `T` | obbligatorio, a meno che non abbia un valore predefinito | opzionale |
| nullable (impostazione predefinita) | `T \| null` | opzionale, `T \| null` | opzionale, `T \| null` |
| con un valore predefinito o uno stamp | come sopra | opzionale | opzionale |
| `.primaryKey()` | `T` | come sopra | assente |
| `.readOnly()` o `.generatedAlwaysAs()` | come sopra | assente | assente |
| `.private()` | assente | assente | assente |

Una colonna temporale accetta anche una `Date` in `InferInsert` e `InferUpdate`, così come avviene per un'operazione di scrittura. `{ enum: [...] }`, `.oneOf()`, `col.enum()` e `pgEnum` restringono `T` all'unione dei loro valori, e una [struttura JSON](/docs/schema/json/) tipizza il relativo documento.

`.access()` non modifica i tipi. Hanno un'unica forma per ogni chiamante e non esiste un singolo tipo di riga valido sia per un lettore che possiede un ruolo sia per uno che non lo possiede. Un chiamante senza il ruolo semplicemente non riceve la colonna.

## Foreign key

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una foreign key `belongsTo` dichiarata in `columns` viene tipizzata esattamente lì. Una derivata dalla relazione viene aggiunta come chiave opzionale denominata come la sua colonna in camelCase — `author_id` diventa `authorId` — tipizzata come `string | number | null`. Dichiara la colonna quando desideri il suo tipo esatto; i tipi generati dall'SDK sono precisi in entrambi i casi.

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

## Chiavi di una tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

`ColumnKeyOf<typeof posts>` è l'unione delle chiavi di colonna di una tabella, e `RelationKeyOf<typeof posts>` l'unione dei nomi delle sue relazioni. Entrambi funzionano anche sulle viste. Usali per tipizzare il codice che accetta una colonna o una relazione per nome. Provengono da `@rebasepro/types`, dal momento che `@rebasepro/server/schema` non li riesporta:

```ts
import type { ColumnKeyOf, RelationKeyOf } from "@rebasepro/types";
import type { posts } from "./posts";

type PostColumn = ColumnKeyOf<typeof posts>;     // "id" | "title" | "status" | …
type PostRelation = RelationKeyOf<typeof posts>; // never, for a table without relations
```

## Gli hook sono tipizzati automaticamente

<span class="since-badge" data-since="0.31">Da 0.31</span>

Gli [hook](/docs/collections/callbacks/) di una tabella sono tipizzati a partire dalle sue colonne senza alcuna annotazione: `values` in `beforeSave` è un `Partial` del tipo di inserimento, `previousValues` e le righe di `afterRead` e degli hook di eliminazione corrispondono al tipo di riga. Il metodo `.transform()` di una colonna riceve il tipo di quella colonna come `value`: `T | null`, oppure `T` quando `.notNull()` viene specificato prima di `.transform()`. Il metodo `.transform()` di un campo JSON riceve `T | undefined`, oppure `T` dopo `.required()`.

## In un frontend

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un frontend può importare il **tipo** di una tabella da `backend/schema`, mai il suo valore:

```ts
import type { InferRow } from "@rebasepro/server/schema";
import type { posts } from "../../backend/schema/posts";

export function PostTitle({ post }: { post: InferRow<typeof posts> }) {
    return post.title;
}
```

L'importazione di un tipo viene rimossa in fase di compilazione (build time), quindi nessun codice di backend — inclusi gli hook — finisce nel bundle del browser. Le personalizzazioni del CMS sono tipizzate allo stesso modo: `customizeTable<typeof posts>("posts", { … })` verifica i suoi override dei campi rispetto alle colonne e alle relazioni della tabella.
