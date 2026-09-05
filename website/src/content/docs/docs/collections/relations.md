---
title: Relations
sidebar_label: Relations
description: Define one-to-one, one-to-many, and many-to-many SQL relations between collections with foreign keys, junction tables, and multi-hop joins.
---

## Overview

Relations define how collections are connected at the database level. They enable Rebase to:

- Render **relation picker fields** in entity forms
- Resolve **related entities** when displaying previews
- Generate **foreign key constraints** in the Drizzle schema
- Support **cascade delete/update** behaviors

Relations can be defined either inline within the property, or explicitly in the `relations` array of a collection:

### 1. Inline Relations (Recommended)

Declare the link on the property, nested under `relation`. Pick the `kind` and
the type offers exactly the fields that kind needs.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => usersCollection
            }
        }
    }
});
```

### 2. Explicit Relations Array

For a link with no property of its own — nothing to name it by in the form or in
a table column — declare it in `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    properties: {
        name: { type: "string", name: "Name" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection
        }
    ]
});
```

## The five kinds

A relation is one of five kinds. The kind decides where the key lives, whether
one row or many come back, and what a write through it may touch.

| Kind | The key lives | Returns | Notes |
|---|---|---|---|
| `belongsTo` | on **this** table | one | `localKey`, defaults to `<relationName>_id` |
| `hasOne` | on the **target's** table | one | `foreignKeyOnTarget`, defaults to `<thisCollection>_id` |
| `hasMany` | on the **target's** table | many | children belong to this parent alone |
| `manyToMany` | in a **junction table** | many | rows are shared; you own the link |
| `via` | an explicit `joinPath` | either | read-only; state `cardinality` yourself |

Every field is optional except `kind` and `target` — the rest is derived.

### belongsTo — the key is on this table

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

### hasMany / hasOne — the key is on theirs

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` is the same link with at most one row on the far side.

#### Joining on a natural key

By default the target's foreign key holds the source row's **id**. When the two
sides are joined on something else — an external identity id, a SKU, a tenant
slug — name that column with `sourceKey`:

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // column on THIS table
        foreignKeyOnTarget: "auth_user_id"  // column on the TARGET's table
    }
]
// → reads applications.auth_user_id = talents.auth_user_id
```

`sourceKey` is the mirror of `localKey` on `belongsTo`: that one names the
column this side reads *from*, this one names the column the other side points
*at*. Without it a link like the above is not expressible as `hasMany` at all
and has to drop to [`via`](#via--an-explicit-join-chain), which is read-only.

The column must be unique. A link that addresses more than one source row
cannot say which one a related row belongs to, and Postgres will not accept a
foreign key against a non-unique column either. Rebase checks this at read
time and refuses rather than picking one.

A parent whose `sourceKey` is `NULL` reaches no rows, and writing through the
relation is an error — there is nothing for the related rows to point at.

### manyToMany — through a junction

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Both sides declare their own, and each writes `through` **from its own point of
view** — `sourceColumn` always names *this* collection:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — an explicit join chain

For links the four shapes above cannot express: multi-hop paths, composite keys,
or a join whose condition is not a plain foreign key. Read-only — Rebase will
not infer how to write through an arbitrary chain.

```typescript
{
    kind: "via",
    relationName: "permissions",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        { table: "user_roles",       on: { from: "id",            to: "user_id" } },
        { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
        { table: "permissions",      on: { from: "permission_id", to: "id" } }
    ]
}
```

## Relation Properties

To render a relation field in a form, add a property with `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

![Relation field in form](/img/features/relation-form-field.png)

When rendering a preview (like in a table cell or a reference chip), Rebase handles hydration automatically:

![Relation preview in table](/img/features/relation-table-preview.png)

### To-one gets a picker, many gets a tab

The cardinality decides the surface, and only one surface is used:

- **`belongsTo` / `hasOne`** — one row, so the property is a foreign key the
  author edits. It renders as the picker above.
- **`hasMany` / `manyToMany`** — many rows, so the entity view lists them as a
  **tab** of their own. The property is not rendered in the form: a collection's
  children are a list, not a value the record holds, and selecting them from a
  dropdown is not something the form can meaningfully offer.

Declaring a many-relation as a property is still worth doing — it is what names
the tab, and what gives the relation a column in the collection table, which the
list fetch hydrates so the child rows show up as chips on the row. Only the form
field is dropped.

In the table, a relation with a property of its own gets **one** column: its own.
Every tab also has a jump-to-tab button column, but for a property-declared
relation that button repeated the same heading beside a column already showing
the children, so it is dropped. Hide the relation's column
(`admin: { hideFromCollection: true }`) and the button comes back, so the
relation never falls out of the table entirely.

If you want the inline picker anyway, ask for it:

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // off by default; the tab is the default treatment
    }
}
```

## Multi-Hop Joins

For relationships that traverse multiple tables, use `kind: "via"` with a `joinPath`.
These are read-only: Rebase will not infer how to write through an arbitrary chain.

```typescript
// Users → Permissions through Roles
relations: [
    {
        kind: "via",
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }
            }
        ]
    }
]
```

### Composite Key Joins

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Multiple columns
            to: ["code", "region_id"]
        }
    }
]
```

## Cascade Rules

Control what happens when related entities are updated or deleted:

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Delete posts when user is deleted
        onUpdate: "cascade"     // Update FK when user ID changes
    }
]
```

| Action | Behavior |
|--------|----------|
| `"cascade"` | Propagate the change to related rows |
| `"restrict"` | Prevent the operation if related rows exist |
| `"no action"` | Same as restrict (defer to constraint check) |
| `"set null"` | Set the FK column to NULL |
| `"set default"` | Set the FK column to its default value |

### What you get when you say nothing

`onDelete` is optional, so most relations never name one. The default depends on
whether the relation is required:

| Relation | Default `onDelete` |
|--------|----------|
| `belongsTo`, optional | `"set null"` — the pointer is emptied |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — the parent delete fails |
| `manyToMany` (junction rows) | `"cascade"` — the link goes, the target stays |

A required relation is **not** a cascade. `required` says a child cannot exist
without a parent; it does not say deleting the parent should destroy the child.
Those are different claims, and only one of them removes rows you did not name.
So the default fails the delete and names the constraint, and `"cascade"` is
something you ask for:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // A line item is meaningless without its order — say so.
    onDelete: "cascade"
}
```

`onUpdate` has no default: with nothing set, Postgres applies `NO ACTION`. Set
`"cascade"` when the target's key is something a person can edit — a slug, a SKU
— so the pointers follow it.

## Fetching Relations in the SDK

When querying data through the Rebase Client SDK, relations are **not** included by default. Use the `include()` method to request related entities alongside the primary data.

### Include specific relations

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Include all relations

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Using params syntax

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Response structure

When included, the response contains both the **scalar foreign key** and the **hydrated relation object**:

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// The SDK returns flat rows — there is no `.values` wrapper. (`Entity`, with
// `id`/`path`/`values`, is an admin-UI view model, not what the client hands back.)
for (const article of data) {
    // Scalar FK — always present
    article.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.author?.name;  // "Jane Doe"
}
```

> The relation names passed to `include()` must match the `relationName` defined in the collection's `relations` array.

For the full query builder reference (filtering, sorting, pagination, real-time), see the [Client SDK documentation](/docs/sdk).

## Relations in the admin panel

Every to-many relation — `hasMany`, `manyToMany`, or a to-many `via` — becomes a
**tab** under a record in the admin panel, listing the rows that record reaches.

### The path segment is the relation name

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

### Owned rows versus shared rows

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

### The same rules over REST

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

### What does not become a tab

- **To-one relations** — they are a field on the record, not a list. Writing through
  a to-one path is rejected: the foreign key lives on the parent's table.
- **Relations declared inside a `map`** — they are a field of that map.

## Full Relation Interface

`Relation` is a closed union — one member per kind, each carrying only the
fields that kind has. There is no combination of fields that describes two
different links, and no field you can set that the kind does not use.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // defaults to the property key, then the target's slug
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // applied when rendered as a tab
}
// `required` is not here. It is `validation: { required: true }` on the
// property that declares the relation, the same key every other field uses.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### The resolved form

What you write above is the *authoring* shape. Internally Rebase works with
`ResolvedRelation`: the same link with every default filled in and nothing
optional, plus `cardinality`, `targetSlug`, and two flags — `writable` (false
only for `via`) and `shared` (true when the target rows belong to other parents
too, so a removal unlinks rather than deletes).

`sourceKey` is the one exception to "nothing optional": its default is the
source's primary key, and resolving that needs the driver's schema, which
resolution does not have. `undefined` there means "the primary key" and nothing
else.

You never write a `ResolvedRelation`. On a relation property, `relation` is
yours and `resolvedRelation` is the filled-in one, stamped during
normalization.

## Next Steps

- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Properties](/docs/collections/properties)** — Property types reference
