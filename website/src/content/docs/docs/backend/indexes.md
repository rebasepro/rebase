---
title: Indexes
sidebar_label: Indexes
description: Declare ordinary Postgres indexes on a table — btree, GIN and BRIN, partial, composite, covering and unique — and why a hand-written one used to disappear.
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table declares the indexes its queries need, beside the columns they cover:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        status:      col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
    },
    indexes: [
        {
            columns: ["status", { column: "publishDate", direction: "desc" }],
            reason: "admin list: filter by status, newest first",
        },
    ],
    rls: "admin-only",
});
```

## Why this exists

The DDL generator has always emitted index statements for exactly two things,
and both are structures a *feature* owns rather than queries you wrote: the GIN
index behind a [`search` block](/docs/backend/search), and the ANN index behind
a [`col.vector()` column](/docs/sdk/aggregates-and-search#the-index). The plain case — the btree
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

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Field | Type | Description |
|-------|------|-------------|
| `columns` | `(string \| { column, direction?, nulls? })[]` | **Required.** The key columns, in order. 1–5 entries. |
| `reason` | `string` | Why this index exists, in one line. Strongly recommended. |
| `using` | `"btree" \| "gin" \| "brin"` | Access method. Defaults to `btree`. |
| `where` | `IndexPredicate` | Makes the index partial — it covers only the rows matching this. |
| `unique` | `boolean` | btree only. A composite uniqueness guarantee. |
| `include` | `string[]` | btree only. Payload columns carried for index-only scans. |

### `columns` takes column keys, never SQL names

<span class="since-badge" data-since="0.31">Since 0.31</span>

A `belongsTo` relation's name stands for its foreign-key column, so the relation
`author` is the column `author_id`:

```ts
indexes: [
    // `author` is the relation; its key is the column author_id.
    { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" },
]
```

Writing `author_id` here is refused: it is a SQL column name, not a key of the
table, and `columns` names keys. Postgres does not
index a foreign key column for you — without this index, both "list this
author's posts" and the `ON DELETE` cascade are sequential scans.

A `hasMany` or many-to-many relation has no column on this table, and is
refused: declare the index on the table that owns the foreign key.

### Order matters, and only a leading subset is usable

Postgres can use a leading subset of the key columns, so
`["ownerId", "createdAt"]` serves a query filtering on `ownerId`, and one
filtering on both, and **never** one filtering on `createdAt` alone.

`direction` and `nulls` earn their place only when a query's `ORDER BY` mixes
directions. A lone `DESC` index is redundant with its `ASC` twin — Postgres
scans a btree backwards just as fast — so one index serves the filter *and* the
sort in the example at the top of this page.

```ts
indexes: [{ columns: [{ column: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }]
```

Writing the Postgres default down explicitly is free: the derived name hashes
the *effective* order, so adding `direction: "asc"` to a column that was already
ascending is not a redefinition and rebuilds nothing.

The cap is five keys. Postgres allows thirty-two; past four the trailing columns
are dead weight on every write, and the declaration is usually someone hoping a
query gets faster by accretion. Payload columns that are not searched belong in
`include`, which does not count against the cap.

### `where` is structured, not SQL

```ts
indexes: [{
    columns: ["publishDate"],
    where: { column: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date",
}]
```

The index then holds only published rows, and stays small as drafts accumulate.

Operators are `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` and
`is not null`, combined with `and`:

```ts
indexes: [{
    columns: ["assignee"],
    where: {
        and: [
            { column: "status", op: "in", value: ["open", "in_progress"] },
            { column: "archivedAt", op: "is null" },
        ],
    },
    reason: "the open-work queue, which is a fraction of the table",
}]
```

There is deliberately no `or`. An OR predicate almost always means the index
should not be partial at all; if you genuinely need one, declare two indexes.

A predicate is structure rather than a string because a string could not be
checked against the table's columns, could not be fingerprinted without
putting its own text into the index name — so reformatting it would rename a
live index — and would be the one place a caller reaches for an extension
operator class that the planner cannot replay.

### `unique` is for composites only

Single-column uniqueness is `.unique()` on the column, and declaring it here as
well is refused rather than accepted as a synonym. `.unique()` compiles to an
inline `UNIQUE` whose backing index
Postgres — not Rebase — names `<table>_<column>_key`.

```ts
indexes: [{ columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }]
```

### `include` buys an index-only scan

Payload columns live in the leaf pages: not searchable, not ordered, and they
save a heap fetch at the cost of a fatter index. They may not overlap `columns`.

```ts
indexes: [{ columns: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }]
```

### `using`

`btree` (the default) answers equality, range, `ORDER BY` and uniqueness.

`gin` is containment over an array column or a `jsonb` column. `brin` is for a
naturally-ordered column on an append-only table — tiny, and useless the moment
rows start arriving out of order. Neither has an ordering, so `direction` and
`nulls` are unrepresentable on them rather than refused later by Postgres.

There is no `gist` and no `hash`: every interesting gist operator class ships in
an extension, and hash indexes cannot be unique, composite, or ordered. That
restriction is what keeps the whole model on the Atlas path — `rebase db push`
materialises the desired state in a bare scratch database to plan against, and
`CREATE EXTENSION` cannot go in that file. **Trigram search is
[`search:`](/docs/backend/search); ANN is a
[`col.vector()` column](/docs/sdk/aggregates-and-search#the-index).** An index needing
`gin_trgm_ops` or `vector_cosine_ops` is refused at build time rather than
emitted to fail later against a database you have never seen.

### `reason`

<span class="since-badge" data-since="0.31">Since 0.31</span>

It is the one field with no SQL behind it, and it is optional — but write it.

An index is the only thing a schema can declare that costs money forever
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

### Declaring an index you already have

When you declare an index the database already has under another name, Rebase
takes that index over instead of building a second copy. Before building a
declared index that is missing, `rebase db push`, `rebase db migrate` and the
boot look for an existing index on the same table that matches it in every
part. A match is renamed to the declared name with
`ALTER INDEX … RENAME TO …`, which changes the catalogue and rebuilds nothing.
From then on it is the declared index: found by name, kept, and dropped if the
declaration is removed.

These parts must all match:

- the access method;
- uniqueness;
- the key columns, in order, each with its direction and `NULLS` placement
  (direction counts only for `btree`);
- the `INCLUDE` columns;
- the predicate. Postgres's quoting, literal casts and parentheses are ignored;
  anything else that differs means no match.

Rebase leaves an existing index alone, and builds the declared one beside it,
when that index differs in any of those parts. It also leaves it alone when a
key is an expression, a key uses a non-default operator class or collation, the
index backs a constraint, the index is `INVALID`, or it already has a Rebase
name.

`rebase db generate` writes each declared index into the migration as
`CREATE INDEX IF NOT EXISTS`, so the statement succeeds when `rebase db migrate`
has just renamed an existing index to that name.

## When they are created

Both producers emit them, which matters because not every deployment runs
`db push`:

- **`rebase db push` / `rebase db generate`** put them in `schema.sql`, on the
  ordinary Atlas path — so they get migrations, drift detection and rollback
  like every other object.
- **`rebase schema generate`** also writes them into `schema.generated.ts`, so
  the Drizzle schema describes the same table the database has. A covering
  index's `INCLUDE` columns are the one exception: Drizzle cannot express them,
  and the generated line carries a comment saying so and pointing at
  `schema.sql`, which does.
- **Boot-time schema ensure** creates them too, on the same terms as the
  search and ANN indexes beside them. A managed-runtime tenant provisions at
  boot and never runs `db push`; without this it would start with none of its
  declared indexes and nothing would say so. A table the boot creates gets its
  indexes with the table. On a table that already exists, the boot builds a
  missing index after the server is serving, in the background, the way it
  builds the [foreign-key indexes](#what-upgrading-does-to-an-existing-database).
  It uses `CREATE INDEX CONCURRENTLY` on a connection of its own, so the
  pool's 30 s `statement_timeout` cannot cancel a long build. An index that an
  interrupted build left `INVALID` under its name is dropped and built again.
  `IF NOT EXISTS` matches on the name, so it never repairs one. A `unique`
  index is built the same way but before the server serves, and the boot fails
  if it cannot be built. Serving without it would let duplicate rows in.

## Foreign keys are indexed for you

Postgres creates the
index a foreign key *points at* — the target's primary key — and never one on
the column *holding* it. Every read from the other side of a link filters on
that column: a `hasMany` or `hasOne` include, a nested listing such as
`/authors/5/posts` (its page and its count), the reverse side of a
`manyToMany`, and the `ON DELETE` check when a parent row is deleted. Without
an index each of those reads every row of the child table.

So Rebase derives a plain btree for:

- the `localKey` of every [`belongsTo`](/docs/collections/relations/#belongsto--the-key-is-on-this-table)
  — which is also the column the far side's `hasOne` / `hasMany` reads;
- the target column of every `manyToMany` junction. The junction's primary key
  `(source, target)` already serves lookups by the source column; the reverse
  side of the link needs this one. A junction is Rebase's table, so this one
  has no opt-out.

Measured on Postgres 18 with a warm cache, 1M comments over 50k posts:

| The read | Without the index | With it |
|---|---|---|
| `include=comments` on a 25-post page (`post_id IN (…)`) | 38 ms | 0.3 ms |
| `GET /posts/77/comments?limit=25` — the page | 28 ms | 0.3 ms |
| …and its `count(*)` | 29 ms | 0.2 ms |
| deleting one post (`ON DELETE SET NULL` check) | 129 ms | 1.7 ms |

Nothing is indexed twice. The derived index is skipped when the column already
leads the primary key, carries a `UNIQUE` (`.unique()` on a bound column, or
`unique: true` on the relation), or leads an index in `indexes:` —
plain or composite, as long as it is a btree with no `where`. A partial index
cannot serve a lookup that has to reach every row, and a GIN or BRIN index
answers a different question, so neither counts.

The name is the one [a declaration](#what-a-declaration-is-called) of a plain
index on that column derives — `posts_author_id_ix_00ad191` — so the derived
index and `indexes: [{ columns: ["author"], … }]` are one object, not two. It is a
[frozen derived name](/docs/architecture/schema-as-code) like every other.

To keep the constraint and drop the index — a table so write-heavy that the
index costs more than the lookups it serves, or one where you keep an index of
your own outside `indexes:` — say so on the relation:

```ts
relations: {
    author: rel.belongsTo(() => authors, { index: false }),
}
```

`index` exists on `belongsTo` only: on the other kinds the foreign key is a
column on the target (set `index` on the target's `belongsTo`) or in a junction.

Rebase reads only your tables to decide this, never the database: `db
push` and the boot have to reach the same set of indexes with the same names, or
the next push would drop what the boot built. An index you wrote by hand on the
same column, outside `indexes:`, is therefore not seen — declare it in
`indexes:`, or set `index: false`, to keep one index rather than two.

### What upgrading does to an existing database

The indexes are new objects on tables that already hold data, and the two doors
build them differently:

- **The boot does not wait for them.** On a table that already exists, the
  schema ensure leaves the missing foreign-key indexes out of the boot and
  builds them after the server is serving, one at a time, with
  `CREATE INDEX CONCURRENTLY` on a connection of its own (the pool's 30 s
  `statement_timeout` does not apply to it). That takes no lock reads or writes
  wait on. A table another session holds — another instance's build, an
  `ALTER TABLE` — is given up on within the boot's lock budget and tried again on
  the next boot. An index an interrupted build left `INVALID` (a deploy that
  replaced the process mid-build, two instances racing on one name) is dropped
  and built again. Each one is logged as it starts and finishes; a failure is a
  warning, never a failed boot. A table this boot creates gets its indexes with
  the table, before anything can write to it. Under `REBASE_PROVISION_ONLY` the
  builds run before the process exits, since nothing after it would run them.
- **`rebase db push` builds them before it plans**, with the same builder and
  on the same terms as the boot: `CREATE INDEX CONCURRENTLY`, one at a time,
  so reads and writes go on while it runs (about 0.4 s at 1M rows and 6 s at
  10M as a plain build on a laptop SSD, `maintenance_work_mem` 64 MB; a
  concurrent one takes longer and blocks nothing). Atlas then finds each index
  in place and plans nothing for it. An index it could not build first — a
  table another session held for the whole lock budget — is left to Atlas,
  which builds it inside the push's transaction and so blocks writes to that
  table for the build; the push says which. A foreign-key column the push
  itself adds gets its index from Atlas along with the column, before anything
  is in it. `--dry-run` builds nothing: it names the indexes a real push would
  build first, and the plan it prints lists them, since they do not exist yet.

## What is refused, and when

<span class="since-badge" data-since="0.31">Since 0.31</span>

All of these are refused when the schema is compiled, naming the table and the
position in the array — an index that silently does not exist is the failure
this whole feature removes:

- a key that is no column or `belongsTo` relation of the table, or a relation
  whose foreign key lives on the other table
- more than five keys in `columns`, or the same column twice
- exactly the primary key columns — `<table>_pkey` already indexes those
- a column in both `columns` and `include`
- `unique` on one column that already declares `.unique()`
- `direction` or `nulls` under `gin` or `brin`
- an `in` list that repeats a value
- two declarations that derive the same name — they are the same index, twice
- an empty `reason`

## Related

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Search](/docs/backend/search) — ranked full-text, which builds its own GIN
  index over a generated `tsvector`
- [Vector search](/docs/sdk/aggregates-and-search#vector-search) — the ANN index over an
  embedding column, configured on `col.vector()`
- [Schema as code](/docs/architecture/schema-as-code) — how declarations reach
  the database, and what a derived name is
- [Tables](/docs/schema/) — every key of `defineTable`
