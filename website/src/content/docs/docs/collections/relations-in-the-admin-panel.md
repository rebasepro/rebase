---
title: Relations in the admin panel
sidebar_label: Relations in the admin panel
description: How every to-many relation becomes a tab under a record — the path segment, owned versus shared rows, the same rules over REST, and what does not become a tab.
---

Every to-many relation — `hasMany`, `manyToMany`, or a to-many `via` — becomes a
**tab** under a record in the admin panel, listing the rows that record reaches.

## The path segment is the relation name

A child list is addressed as `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

The last segment is the **relation name**, not the target collection's slug. They
are often the same, because an unnamed relation takes its target's slug — but an
inline relation property takes the *property key*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

This is also what makes two relations to the same collection work: each has its own
name, so each gets its own tab and its own path.

## Owned rows versus shared rows

What a tab lets you do depends on how the relation is stored, because the two cases
mean different things:

| | One-to-many (`foreignKeyOnTarget`) | Many-to-many (`through`) |
|---|---|---|
| The child belongs to | this parent alone | every parent that links it |
| Create | creates the row under this parent | creates the row and links it |
| Add existing | — | links an existing row |
| Remove | **deletes** the row | **unlinks** it; the row is untouched |

The admin panel renders each accordingly: a many-to-many tab offers **Add existing**
and **Remove from this record**, and never a delete that would take the row away
from other parents.

## The same rules over REST

Child lists are ordinary collection queries narrowed to one parent, so they accept
everything a root list does — filters, `orderBy`, `limit`, `offset`, `include` — and
`meta.total` counts the filtered rows. Filter either per field (`?field=op.value`) or
with a whole-object `?where={"field":["op","value"]}`; both reach the same query:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

The parent segment is enforced, not decorative. Addressing a row that is not under
that parent returns `404`, and `PATCH` never moves a row from one parent to another —
set the foreign key explicitly if that is what you want.

For a many-to-many, `PATCH parent/id/child/childId` is *set membership*: it links the
row if it is not linked yet, and is idempotent. That is how you attach a row that
already exists.

## What does not become a tab

- **To-one relations** — they are a field on the record, not a list. Writing through
  a to-one path is rejected: the foreign key lives on the parent's table.
- **Relations declared inside a `map`** — they are a field of that map.

## Next Steps

- **[Relations](/docs/collections/relations/)** — the five kinds, and how to declare each
- **[Writing over REST](/docs/backend/writes/)** — create, update and delete beyond a child list
