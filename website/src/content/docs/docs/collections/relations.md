---
title: Relations
sidebar_label: Relations
description: "Link tables with rel.belongsTo, hasOne, hasMany, manyToMany and via: foreign keys bound or derived, junction tables with _pivot columns, delete rules, naming rules and multi-hop joins."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table's `relations` name the links it has to other tables. Each one is a
`rel.*` call, and its key is the relation's name: what `include` asks for, what
a nested path such as `/api/data/users/1/posts` reads, and what a write names to
set the link.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true, onDelete: "restrict" }),
        tags:   rel.manyToMany(() => tags, { pivot: { sortOrder: col.integer().default(0) } }),
    },
    rls: "admin-only",
});
```

The target is a thunk, `() => users`, so two tables can point at each other
whatever order their modules load in. Neither needs a type annotation: what the
thunk returns is checked when the schema is compiled, and a relation whose
target is not a table or view of the schema is refused there.

:::note[Coming from collections?]
Relations are no longer properties. The foreign-key column of a `belongsTo` is
derived from the relation, or bound to a column you declare. The upgrade guide
for this release shows the mapping.
:::

## The five kinds

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Kind | The key lives | Returns | Options |
|---|---|---|---|
| `rel.belongsTo` | on **this** table | one row | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | on the **target** table, unique | one row | `foreignKey`, `sourceKey` |
| `rel.hasMany` | on the **target** table | many rows | `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | in a **junction table** | many rows | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | where `steps` say | one or many | `steps` (required), `cardinality` |

Every option is optional except `steps` on `rel.via`. The rest is derived, by
the rules in [Names](#names).

Every kind also takes `access` and `private`, which decide who receives the
relation's rows, the way they do for a column:

- `access: { read?, write? }` lists the roles that may include or filter by the
  relation and the roles that may set the link. An omitted list leaves that
  direction to the row; an empty list closes it.
- `private: true` keeps the relation on the server: it is not in the API, the
  SDK or OpenAPI.

See [Field access](/docs/collections/field-access/) for what a caller without
access sees.

## belongsTo — the key is on this table

<span class="since-badge" data-since="0.31">Since 0.31</span>

`belongsTo` puts the foreign key on the declaring table. The key's SQL column is
`localKey`, and `<relation name in the singular>_id` when that is omitted:
`author` is `author_id`.

The relation either **binds** to a column you declared, or **derives** one:

- **Bound.** When `columns` has a column whose SQL name is `localKey`, the
  relation uses it. Its type must be the type of the target's key, and its
  modifiers (`.notNull()`, `.unique()`) say what the link is.
- **Derived.** Otherwise the relation adds the column after the declared ones,
  with the type of the target's key. Its wire key is the camelCase of its column:
  `author_id` is served as `authorId`. `notNull: true` and `unique: true` on the
  relation apply to this derived column.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

// Derived: an `author_id` column, served as `authorId`.
export const notes = defineTable("notes", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { author: rel.belongsTo(() => users, { notNull: true }) },
    rls: "admin-only",
});

// Bound: `authorId` is the column `author_id`, so the relation uses it.
export const drafts = defineTable("drafts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        authorId: col.uuid().notNull(),
    },
    relations: { author: rel.belongsTo(() => users) },
    rls: "admin-only",
});
```

Binding keeps every physical column visible in `columns`, at the position you
choose. Deriving is shorter. Both produce the same table.

A relation and a column may not share a key: the relation's key is what
`include` names, so the foreign-key column needs a key of its own (`authorId`,
not `author`). Two relations may not use the same column.

| Option | Default | What it does |
|---|---|---|
| `localKey` | `<singular name>_id` | The SQL column holding the key. |
| `notNull` | `false` | The derived column is `NOT NULL`. On a bound column, write `.notNull()` on the column instead. |
| `unique` | `false` | The derived column is `UNIQUE`, which makes the link one-to-one. On a bound column, write `.unique()`. |
| `onDelete` | `restrict` when the column is `NOT NULL`, `set null` otherwise | What happens to this row when the target row is deleted. See [Delete and update rules](#delete-and-update-rules). |
| `onUpdate` | none (Postgres applies `NO ACTION`) | What happens when the target's key changes. |
| `index` | `true` | `false` skips the index on the foreign-key column. |
| `constraint` | `true` | `false` stores the key without a `FOREIGN KEY` constraint. |

The foreign-key column is indexed unless `index: false`: Postgres indexes the
key a foreign key points at, never the column holding it, so without one every
read from the other side scans this table. See
[Foreign keys are indexed for you](/docs/backend/indexes#foreign-keys-are-indexed-for-you).

## hasOne and hasMany — the key is on the target

<span class="since-badge" data-since="0.31">Since 0.31</span>

`hasMany` reads rows of the target that point back at this one. `hasOne` is the
same link with at most one row on the far side. Neither adds a column here: the
target declares the `belongsTo` that holds the key.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";
import { profiles } from "./profiles";

export const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        // reads posts.author_id
        posts:   rel.hasMany(() => posts, { foreignKey: "author_id", orderBy: ["createdAt", "desc"] }),
        // reads profiles.author_id, which is unique
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
    },
    rls: "admin-only",
});
```

`foreignKey` is the SQL column on the target, and defaults to
`<this table's slug in the singular>_id`: on `authors`, `author_id`. `orderBy`
on `hasMany` is the order related rows come back in when the caller names none.

### Joining on a natural key

<span class="since-badge" data-since="0.31">Since 0.31</span>

By default the target's key holds this row's primary key. When the two sides are
joined on something else (an external identity id, a SKU), `sourceKey` names
the column on this table:

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { applications } from "./applications";

export const talents = defineTable("talents", {
    columns: {
        id:         col.uuid().primaryKey().defaultRandom(),
        authUserId: col.text().notNull().unique(),
    },
    relations: {
        // applications.auth_user_id = talents.auth_user_id
        applications: rel.hasMany(() => applications, { sourceKey: "auth_user_id", foreignKey: "auth_user_id" }),
    },
    rls: "admin-only",
});
```

The `sourceKey` column must be unique: a link that addresses several source
rows cannot say which one a related row belongs to. A row whose `sourceKey` is
`NULL` reaches no related rows, and writing through the relation is an error.

## manyToMany — through a junction

<span class="since-badge" data-since="0.31">Since 0.31</span>

`manyToMany` links rows through a junction table that Rebase creates, with
row-level security of its own. Removing a link deletes the junction row, never
the target.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const projects = defineTable("projects", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        members: rel.manyToMany(() => users, {
            through: "project_members",
            pivot: {
                role:    col.enum(["owner", "editor", "viewer"]).notNull().default("viewer"),
                addedAt: col.timestamptz().onCreateNow(),
            },
        }),
    },
    rls: "admin-only",
});
```

| Option | Default | What it does |
|---|---|---|
| `through` | the two SQL table names, sorted, joined by `_` | The junction table. Always in the `public` schema. |
| `sourceKey` | `<this table's slug in the singular>_id` | The junction column pointing at this table. |
| `targetKey` | `<relation name in the singular>_id` | The junction column pointing at the target. |
| `pivot` | none | Extra columns on the junction, built with `col.*`. |
| `onDelete` | `cascade` | What happens to a link when either row is deleted. |

Both sides of one link may declare it, each from its own point of view:
`sourceKey` always names the declaring table's column. Two relations that
resolve to the same junction table with different key columns are refused.

### `_pivot`: the junction's own columns

<span class="since-badge" data-since="0.31">Since 0.31</span>

`pivot` columns are read and written under `_pivot`. A read that includes the
relation serves each related row with its link's columns:

```json
{ "id": "p1", "name": "Website", "members": [
    { "id": "u7", "email": "ada@example.com", "_pivot": { "role": "owner", "addedAt": "2026-11-02T09:14:00Z" } }
] }
```

A write sets the links as a list, and an element may carry the `_pivot` the link
should hold:

```json
{ "members": [{ "id": "u7", "_pivot": { "role": "owner" } }, "u9"] }
```

Pivot columns take every column modifier except `.primaryKey()`: the junction's
key is its two link columns.

### `_count`: how many related rows

<span class="since-badge" data-since="0.31">Since 0.31</span>

An include of a to-many relation (`hasMany`, `manyToMany`, a to-many `via`) can
ask for the total alongside a limited page of rows, served under the row's
`_count`. It is counted in the same statement, under the same filters and
row-level security. See
[Counting what a limit leaves out](/docs/sdk/relations#counting-what-a-limit-leaves-out).

## via — an explicit join chain

<span class="since-badge" data-since="0.31">Since 0.31</span>

`via` reads through joins you spell out: several hops, composite keys, or a
condition that is not a plain foreign key.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { permissions } from "./permissions";

export const members = defineTable("members", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: {
        permissions: rel.via(() => permissions, {
            steps: [
                { table: "member_roles",     on: { from: "id",            to: "member_id" } },
                { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
                { table: "permissions",      on: { from: "permission_id", to: "id" } },
            ],
        }),
    },
    rls: "admin-only",
});
```

Each step joins `table`, with `from` naming a column of the previous table (this
one, for the first step) and `to` a column of `table`. A list of columns on both
sides joins on a composite key: `on: { from: ["company_code", "region_id"], to:
["code", "region_id"] }`. A list of conditions in `on` joins a row meeting any
one of them, and is read-only.

`cardinality` is `"many"` unless you write `"one"`. Two chains can be written
through, the way the kind they stand in for is written:

- a **to-one** chain of **one step**: the target row holds the key, as with
  `hasOne`;
- a **to-many** chain of **two steps through one table** between the ends: that
  table holds the links, as with `manyToMany` (with no `_pivot`).

Every other chain is read-only. A create or update naming it is refused with
`400 RELATION_NOT_WRITABLE`, and so is a nested write through any `via`.

## Delete and update rules

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Action | Behaviour |
|---|---|
| `"cascade"` | Delete or update the related rows too |
| `"restrict"` | Refuse the delete while related rows exist |
| `"no action"` | As `restrict`, checked at the end of the statement |
| `"set null"` | Empty the foreign-key column |
| `"set default"` | Set the foreign-key column to its default |

When `onDelete` is not set, a nullable `belongsTo` empties the pointer
(`set null`), a `NOT NULL` one refuses the delete (`restrict`), and a
`manyToMany` link is deleted with either row (`cascade`). `NOT NULL` says a row
cannot exist without its parent; it does not say deleting the parent should
delete the row. Ask for `"cascade"` when that is what you mean: it is the one
value that removes rows you did not name.

## Names

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every name a relation uses is derived when you do not write it. The rules are
the ones a deployed database already has, so they do not move between releases.

| Name | Rule | `posts` with relation `author` → `users` |
|---|---|---|
| `belongsTo` column | `localKey`, else `<singular relation name>_id` | `author_id` |
| `belongsTo` wire key | the camelCase of the column | `authorId` |
| `hasOne` / `hasMany` column on the target | `foreignKey`, else `<singular slug of this table>_id` | `post_id` on the target |
| junction table | `through`, else both SQL table names sorted, joined by `_` | `posts_tags` for `posts` ↔ `tags` |
| junction column to this table | `sourceKey`, else `<singular slug of this table>_id` | `post_id` |
| junction column to the target | `targetKey`, else `<singular relation name>_id` | `tag_id` for relation `tags` |

A derived foreign key has the type of the key it points at. A key of type
`serial` is pointed at by a plain `integer` of the same width, and an enum key by
its own enum type.

A `belongsTo` relation's name stands for its foreign-key column wherever a table
names a column: in `indexes`, in `tenant`, and in a rule's `ownerField` or
condition.

## Reading and writing relations

<span class="since-badge" data-since="0.31">Since 0.31</span>

Relations are not included in a read unless the caller asks:

```typescript
const { data } = await client.data.posts
    .include("author", "tags")
    .find();
```

A row then carries both the foreign key and the related row:
`post.authorId` is always there, `post.author` only when included. The
[typed SDK](/docs/sdk/relations/) covers includes in full: per-relation limits,
filters, ordering and nesting.

A write sets a to-one link by its key (`{ author: "u7" }` or
`{ authorId: "u7" }`) and a to-many link as a list of target ids or `{ id }`
objects (`{ tags: ["t1", "t2"] }`). See [Writing data](/docs/sdk/writing/).

In the CMS, every to-many relation becomes a tab under the record. See
[Relations in the admin panel](/docs/collections/relations-in-the-admin-panel/).

## What is refused

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rel.via()` without steps throws when the module loads. When the schema is
compiled, a table is refused for:

- a relation whose target is not a table or view of the schema;
- a relation and a column with the same key;
- a bound column whose type is not the target key's type, or a `notNull` or
  `unique` on the relation that the bound column does not carry;
- two relations using one foreign-key column, or a derived column whose key or
  SQL name another column already has;
- a `belongsTo` pointing at a table with a composite key, a `hasOne` or
  `hasMany` from one without a `sourceKey`, or a `manyToMany` with either side
  composite: one column cannot reference several, so express it with
  `rel.via()`;
- two `manyToMany` relations resolving to one junction table with different key
  columns.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Row-level security](/docs/collections/security-rules/): who reaches the rows at either end
- [Indexes](/docs/backend/indexes/): the foreign-key index and composite indexes over relations
- [Typed SDK relations](/docs/sdk/relations/): `include`, per-relation limits, `_count`
