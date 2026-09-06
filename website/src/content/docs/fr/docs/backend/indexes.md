---
sourceHash: 5b3faf351da73329
title: Indexes
sidebar_label: Indexes
description: Declare ordinary Postgres indexes on a collection — btree, GIN and BRIN, partial, composite, covering and unique — and why a hand-written one used to disappear.
---

:::note[Cette page n'est disponible qu'en anglais]
La traduction est à venir. Le contenu ci-dessous est en anglais.
:::

A collection declares the indexes its queries need, in the same file as the
properties they cover:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { name: "Publish date", type: "date" }
    },
    indexes: [
        {
            on: ["status", { prop: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        }
    ]
};
```

Postgres only. On another engine the key is refused at boot rather than
silently ignored.

## Why this exists

The DDL generator has always emitted index statements for exactly two things,
and both are structures a *feature* owns rather than queries you wrote: the GIN
index behind a [`search` block](/docs/backend/search), and the ANN index behind
a [`vector` property](/docs/sdk/querying#the-index). The plain case — the btree
behind a `where` clause — had no declaration site at all.

So the only way to have one was to write it by hand. And:

:::caution[If you have hand-written indexes on a Rebase-managed table]
`rebase db push` is declarative. An index on a managed table that was absent
from `schema.sql` counted as drift, and Atlas planned `DROP INDEX` for it —
which is not in the destructive-statement list, so the auto-approved apply took
it without asking. Every hand-written index on a managed table was living on
borrowed time.

That is fixed by the ownership rule below: an index Rebase did not create is now
excluded from the diff by name and never touched. Declaring your hand-written
indexes is still the better end state — a declared index is created on a fresh
database and on every tenant, and a hand-written one is not — but nothing drops
them in the meantime.
:::

## The shape

| Field | Type | Description |
|-------|------|-------------|
| `on` | `(string \| IndexKey)[]` | **Required.** The key columns, in order. 1–5 entries. |
| `reason` | `string` | **Required.** Why this index exists, in one line. |
| `using` | `"btree" \| "gin" \| "brin"` | Access method. Defaults to `btree`. |
| `where` | `IndexPredicate` | Makes the index partial — it covers only the rows matching this. |
| `unique` | `boolean` | btree only. A composite uniqueness guarantee. |
| `include` | `string[]` | btree only. Payload columns carried for index-only scans. |

### `on` takes property keys, never column names

This is the one that bites. A `belongsTo` relation compiles to its resolved
`localKey`, so the property `author` is the column `author_id`:

```typescript
// Correct — `author` is the relation property.
{ on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
```

Writing `author_id` here would work for most properties and quietly index
nothing for a foreign key, which is the one people reach for. Postgres does not
index a foreign key column for you — without this index, both "list this
author's posts" and the `ON DELETE` cascade are sequential scans.

A `hasMany` or many-to-many relation has no column on this table, and is
refused with the collection that does own the foreign key.

### Order matters, and only a leading subset is usable

Postgres can use a leading subset of the key columns, so
`["ownerId", "createdAt"]` serves a query filtering on `ownerId`, and one
filtering on both, and **never** one filtering on `createdAt` alone.

`direction` and `nulls` earn their place only when a query's `ORDER BY` mixes
directions. A lone `DESC` index is redundant with its `ASC` twin — Postgres
scans a btree backwards just as fast — so one index serves the filter *and* the
sort in the example at the top of this page.

```typescript
{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }
```

Writing the Postgres default down explicitly is free: the derived name hashes
the *effective* order, so adding `direction: "asc"` to a column that was already
ascending is not a redefinition and rebuilds nothing.

The cap is five keys. Postgres allows thirty-two; past four the trailing columns
are dead weight on every write, and the declaration is usually someone hoping a
query gets faster by accretion. Payload columns that are not searched belong in
`include`, which does not count against the cap.

### `where` is structured, not SQL

```typescript
{
    on: ["publish_date"],
    where: { prop: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date"
}
```

The index then holds only published rows, and stays small as drafts accumulate.

Operators are `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` and
`is not null`, combined with `and`:

```typescript
{
    on: ["assignee"],
    where: {
        and: [
            { prop: "status", op: "in", value: ["open", "in_progress"] },
            { prop: "archived_at", op: "is null" }
        ]
    },
    reason: "the open-work queue, which is a fraction of the table"
}
```

There is deliberately no `or`. An OR predicate almost always means the index
should not be partial at all; if you genuinely need one, declare two indexes.

A predicate is structure rather than a string because a string could not be
checked against the collection's properties, could not be fingerprinted without
putting its own text into the index name — so reformatting it would rename a
live index — and would be the one place a caller reaches for an extension
operator class that the planner cannot replay.

### `unique` is for composites only

Single-column uniqueness is `validation.unique` on the property, and declaring
it here as well is refused rather than accepted as a synonym.
`validation.unique` compiles to an inline `UNIQUE` whose backing index
Postgres — not Rebase — names `<table>_<column>_key`.

```typescript
{ on: ["tenantId", "slug"], unique: true, reason: "one slug per tenant" }
```

### `include` buys an index-only scan

Payload columns live in the leaf pages: not searchable, not ordered, and they
save a heap fetch at the cost of a fatter index. They may not overlap `on`.

```typescript
{ on: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }
```

### `using`

`btree` (the default) answers equality, range, `ORDER BY` and uniqueness.

`gin` is containment over an `array` property or a JSONB `map`. `brin` is for a
naturally-ordered column on an append-only table — tiny, and useless the moment
rows start arriving out of order. Neither has an ordering, so `direction` and
`nulls` are unrepresentable on them rather than refused later by Postgres.

There is no `gist` and no `hash`: every interesting gist operator class ships in
an extension, and hash indexes cannot be unique, composite, or ordered. That
restriction is what keeps the whole model on the Atlas path — `rebase db push`
materialises the desired state in a bare scratch database to plan against, and
`CREATE EXTENSION` cannot go in that file. **Trigram search is
[`search:`](/docs/backend/search); ANN is a
[`vector` property](/docs/sdk/querying#the-index).** An index needing
`gin_trgm_ops` or `vector_cosine_ops` is refused at build time rather than
emitted to fail later against a database you have never seen.

### `reason` is required

It is the only required field with no SQL behind it.

An index is the only thing a Rebase config can declare that costs money forever
and whose benefit is invisible from the config. The reason is what gets printed
beside "0 scans in 34 days, 412 MB", which is the one moment anybody is in a
position to decide whether to delete it. Without it nobody can decide, so nobody
does, and the table accretes indexes for the life of the product.

It is deliberately **not** part of the index's identity — rewording a
justification never rebuilds an index.

## What a declaration is called

`<table>_<columns>_ix_<7 hex>`, or `_ux_` when unique. For example
`posts_status_publish_date_ix_a91c3f4`.

The hash is over the index's *semantics* — method, columns, order, uniqueness,
included columns, predicate — and not over its rendered SQL, so a change to how
Rebase formats DDL never renames anything in your database.

The hash is load-bearing. `CREATE INDEX IF NOT EXISTS` matches on the **name**,
not the definition: with a readable name, changing a declaration would keep the
old index and report success forever. With the hash in the name, a redefinition
is a different object, so it is created and the old one dropped.

Two consequences worth stating:

- **Changing a declaration is a DROP and a CREATE**, emitted bare — no
  `CONCURRENTLY`, and a window with no index in between. Fine on a development
  database; on a large live table, apply it at a time you choose.
- The name is [a frozen derived name](/docs/architecture/schema-as-code). It is
  in `contracts/derived-names.txt` and cannot change across releases.

## Who owns an index

`_ix_`/`_ux_` plus seven hex is unreachable by every other namer here — `_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, the vector distances, auth's `idx_` prefix. So
the name alone decides ownership:

| The index | In the plan? | Named by Rebase? | What happens |
|---|---|---|---|
| declared | yes | yes | created, then kept |
| declaration deleted | no | yes | **dropped**, as intended |
| hand-written, or from introspection | no | no | **excluded — never touched** |

Neither case needs a prompt. Deleting a declaration *should* remove the index
quietly; what must never be dropped is one Rebase did not create. This is also
what makes the introspection round trip safe: the existing indexes of a database
you pointed Rebase at are foreign until somebody declares them.

## When they are created

Both producers emit them, which matters because not every deployment runs
`db push`:

- **`rebase db push` / `rebase db generate`** put them in `schema.sql`, on the
  ordinary Atlas path — so they get migrations, drift detection and rollback
  like every other object.
- **Boot-time schema ensure** creates them with
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, on the same terms as the ANN
  indexes beside it. A managed-runtime tenant provisions at boot and never runs
  `db push`; without this it would start with none of its declared indexes and
  nothing would say so.

## What is refused, and when

All of these throw at build time, naming the collection and the position in the
array — an index that silently does not exist is the failure this whole feature
removes:

- a property that is not on the collection, or a relation whose foreign key
  lives on the other table
- more than five keys in `on`, or the same column twice
- exactly the primary key columns — `<table>_pkey` already indexes those
- a column in both `on` and `include`
- `unique` on one column whose property already declares `validation.unique`
- `direction` or `nulls` under `gin` or `brin`
- an `in` list that repeats a value
- two declarations that derive the same name — they are the same index, twice
- an empty or missing `reason`

## Related

- [Search](/docs/backend/search) — ranked full-text, which builds its own GIN
  index over a generated `tsvector`
- [Vector search](/docs/sdk/querying#vector-search) — the ANN index over an
  embedding column, configured on the property
- [Schema as code](/docs/architecture/schema-as-code) — how declarations reach
  the database, and what a derived name is
