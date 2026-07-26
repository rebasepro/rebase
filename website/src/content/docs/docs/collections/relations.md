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

You can define the relation directly on the property. The framework automatically extracts these into the collection's `relations[]` at normalization time, so you no longer need a separate `relations[]` entry for properties.

```typescript
import { defineCollection } from "@rebasepro/admin-types";
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
            target: () => usersCollection,
            cardinality: "one",
            direction: "owning",
            localKey: "author_id"
        }
    }
});
```

### 2. Explicit Relations Array

For advanced use cases or when a relation doesn't map directly to a form field, you can define it in the `relations` array:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: { type: "relation", name: "Author", relationName: "author" }
    },
    relations: [
        {
            relationName: "author",
            target: () => usersCollection,
            cardinality: "one",
            localKey: "author_id"
        }
    ]
});
```

## Relation Types

### One-to-One / Many-to-One

A foreign key on **this** table points to another table's primary key.

```typescript
relations: [
    {
        relationName: "author",
        target: () => usersCollection,
        cardinality: "one",          // This entity has ONE author
        direction: "owning",         // The FK is on THIS table
        localKey: "author_id"        // Column on the posts table
    }
]
```

This creates: `posts.author_id → users.id`

### One-to-Many (Inverse)

The foreign key is on the **target** table, pointing back to this entity.

```typescript
// On the Users collection:
relations: [
    {
        relationName: "posts",
        target: () => postsCollection,
        cardinality: "many",          // This user has MANY posts
        direction: "inverse",         // The FK is on the TARGET table
        foreignKeyOnTarget: "author_id"  // Column on the posts table
    }
]
```

### Many-to-Many (Junction Table)

Two collections connected through an intermediate junction table.

```typescript
// On the Articles collection:
relations: [
    {
        relationName: "tags",
        target: () => tagsCollection,
        cardinality: "many",
        direction: "owning",
        through: {
            table: "article_tags",           // Junction table name
            sourceColumn: "article_id",      // FK to this collection
            targetColumn: "tag_id"           // FK to target collection
        }
    }
]
```

This creates:
```sql
CREATE TABLE article_tags (
    article_id INTEGER REFERENCES articles(id),
    tag_id INTEGER REFERENCES tags(id),
    PRIMARY KEY (article_id, tag_id)
);
```

## Relation Properties

To render a relation field in a form, add a property with `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        target: () => usersCollection, // Target collection
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

![Relation field in form](/img/features/relation-form-field.png)

When rendering a preview (like in a table cell or a reference chip), Rebase handles hydration automatically:

![Relation preview in table](/img/features/relation-table-preview.png)

## Multi-Hop Joins

For complex relationships that traverse multiple tables, use `joinPath`:

```typescript
// Users → Permissions through Roles
relations: [
    {
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
        relationName: "author",
        target: () => usersCollection,
        cardinality: "one",
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
const { data } = await client.data.articles
    .include("author")
    .find();

for (const article of data) {
    // Scalar FK — always present
    article.values.author_id;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> The relation names passed to `include()` must match the `relationName` defined in the collection's `relations` array.

For the full query builder reference (filtering, sorting, pagination, real-time), see the [Client SDK documentation](/docs/sdk).

## Relations in the admin panel

Every relation with `cardinality: "many"` becomes a **tab** under a record in the
admin panel, listing the rows that record reaches.

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
        target: () => tagsCollection,
        cardinality: "many"
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
everything a root list does — `where`, `orderBy`, `limit`, `offset`, `include` — and
`meta.total` counts the filtered rows:

```
GET    /api/data/authors/a-1/posts?where=status:eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PUT    /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

The parent segment is enforced, not decorative. Addressing a row that is not under
that parent returns `404`, and `PUT` never moves a row from one parent to another —
set the foreign key explicitly if that is what you want.

For a many-to-many, `PUT parent/id/child/childId` is *set membership*: it links the
row if it is not linked yet, and is idempotent. That is how you attach a row that
already exists.

### What does not become a tab

- **To-one relations** — they are a field on the record, not a list. Writing through
  a to-one path is rejected: the foreign key lives on the parent's table.
- **Relations declared inside a `map`** — they are a field of that map.

## Full Relation Interface

```typescript
interface Relation {
    relationName?: string;
    target: () => CollectionConfig;
    cardinality: "one" | "many";
    direction?: "owning" | "inverse";
    inverseRelationName?: string;
    localKey?: string;
    foreignKeyOnTarget?: string;
    through?: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
    };
    joinPath?: JoinStep[];
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<CollectionConfig>;
    validation?: { required?: boolean };
}
```

## Next Steps

- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Properties](/docs/collections/properties)** — Property types reference
