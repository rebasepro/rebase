---
title: Relations in the admin panel
sidebar_label: Relations in the admin panel
description: "How the CMS draws a table's relations: a picker for a belongsTo, a tab under the record for every to-many relation, owned versus shared rows, the same rules over REST, and the customizeTable options for relation fields."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

The CMS reads a table's [relations](/docs/collections/relations/) from its
descriptor and draws each one by what it is:

| Relation | In the record |
|---|---|
| `belongsTo` | a picker of the related row, in place of its foreign-key column |
| `hasOne` | a picker of the one related row |
| `hasMany`, `manyToMany`, a to-many `via` | a **tab** listing the related rows |
| a `via` that is not writable | read-only |

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const articles = defineTable("articles", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author:       rel.belongsTo(() => users, { notNull: true }),
        tags:         rel.manyToMany(() => tags),
        featuredTags: rel.manyToMany(() => tags, { through: "articles_featured_tags" }),
    },
    rls: "admin-only",
});
```

The form shows **Author** as a picker of a user and no `authorId` field: the
picker edits that column. It is required, because the foreign key is
`NOT NULL` with no default. A foreign key that is part of the table's primary key
stays a field of its own beside the picker. **Tags** and **Featured Tags** are
tabs of the record.

A relation whose target the caller is not served is left out: the CMS cannot
open a table it does not have. A `belongsTo` then leaves its foreign key as a
plain field, so the value stays visible and editable. A `belongsTo` whose
foreign key the caller may not read is left out too.

## The path segment is the relation name

<span class="since-badge" data-since="0.31">Since 0.31</span>

A tab's rows are addressed as `parent/parentId/relationName`:

```text
/c/authors/a-1/posts            the posts of author a-1
/c/articles/p-1/featuredTags    the featured tags of article p-1
```

The last segment is the **relation's name**, the key in `relations`, not the
target's slug. That is what lets two relations to the same table work: each has
its own name, so each gets its own tab and its own path.

## Owned rows versus shared rows

<span class="since-badge" data-since="0.31">Since 0.31</span>

What a tab lets you do depends on how the relation is stored:

| | One-to-many (`hasMany`) | Many-to-many (`manyToMany`) |
|---|---|---|
| The child belongs to | this parent alone | every parent that links it |
| Create | creates the row under this parent | creates the row and links it |
| Add existing | — | links an existing row |
| Remove | **deletes** the row | **unlinks** it; the row is untouched |

A many-to-many tab offers **Add existing** and **Remove from this record**, and
never a delete that would take the row away from other parents.

## The same rules over REST

<span class="since-badge" data-since="0.31">Since 0.31</span>

A tab is an ordinary query narrowed to one parent, so it accepts everything a
root list does (filters, `orderBy`, `limit`, `offset`, `include`) and
`meta.total` counts the filtered rows. Filter per field (`?field=op.value`) or
with a whole-object `?where={"field":["op","value"]}`:

```text
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

The parent segment is enforced. Addressing a row that is not under that parent
returns `404`, and `PATCH` never moves a row from one parent to another: set the
foreign key explicitly if that is what you want.

For a many-to-many, `PATCH parent/id/child/childId` is *set membership*: it links
the row if it is not linked yet, and is idempotent. That is how you attach a row
that already exists.

## What does not become a tab

<span class="since-badge" data-since="0.31">Since 0.31</span>

- **To-one relations**: a `belongsTo` or a `hasOne` is a field of the record, not
  a list. Writing through a to-one path is rejected.
- **A table with `hideFromEntityViews`** in its `customizeTable` is not offered
  as a tab on the records of tables that relate to it.

## Customizing relation fields

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
// frontend/src/cms/articles.tsx
import { customizeTable } from "@rebasepro/cms";
import type { articles } from "../../../backend/schema/articles";

export const articlesCms = customizeTable<typeof articles>("articles", {
    fields: {
        author: {
            previewFields: ["displayName", "email"],
            widget: "dialog",
            includeEntityLink: true,
        },
        featuredTags: {
            name: "Featured",
            renderInForm: true,
            overrides: { name: "Featured tags", defaultViewMode: "cards" },
        },
    },
});
```

| Option | Effect |
|---|---|
| `previewFields` | The target's fields shown in the chip for a related row. At most three fit. |
| `widget` | `"select"` picks from a dropdown, `"dialog"` from a searchable table. |
| `fixedFilter` | Offer only rows that pass this filter. |
| `includeId` | Show the related row's id in previews. |
| `includeEntityLink` | Show a link that opens the related row. |
| `renderInForm` | Also draw a to-many relation as a picker in the form, beside its tab. |
| `overrides` | How the target is presented in this relation's tab: any table option except `fields`. |

`overrides` restyles the tab, not the target's fields. Those belong to the
target table's own `customizeTable`, and writing `fields` inside `overrides`
throws.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Relations](/docs/collections/relations/): the five kinds, and how to declare each
- [customizeTable](/docs/frontend/customize-table/#relations): relation options in the reference
- [Writing over REST](/docs/backend/writes/): create, update and delete beyond a tab
