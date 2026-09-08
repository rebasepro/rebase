---
title: Querying relations
sidebar_label: Relations
description: "Include related entities in a query, and read a child collection through its parent with the SDK's relation accessors."
---

## Loading related rows

Relations can be included so that related entities are returned alongside the primary data, instead of just their foreign key IDs.

### Using `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations, one hop deep
const { data } = await client.data.posts
    .include("*")
    .find();
```

Repeated calls **add** to each other rather than replacing, so
`.include("author").include("categories")` asks for both.

### Using `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Nesting: relations of relations

A dotted path loads a relation of a relation, up to **three hops**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .collection<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Naming the intermediate hop is optional — `comments.author` already implies
`comments` — and sending both is the same request twice.

Each hop is one batched query for the whole page, not one per row: a page of 50
posts with `comments.author` is three queries, whatever the number of comments.
The depth bound is what stops a self-referencing relation from walking forever;
past it the request is a 400 `INCLUDE_TOO_DEEP`.

### Narrowing what a relation loads

The list form has nowhere to put a per-relation `limit`, so a relation that
needs narrowing takes an options object instead:

```typescript
const { data } = await client.data.posts.include({
    comments: {
        limit: 5,
        where: { published: ["==", true] },
        orderBy: ["createdAt", "desc"],
        fields: ["id", "body"],
        include: { author: true }
    }
}).find();
```

| Option | What it does |
|--------|--------------|
| `limit` | Rows **per parent**, not across the page — five comments on each post, not five in total. |
| `where` | The same filter dialect the top-level `where` uses. Pushed into the query, so the `limit` applies to rows that match. |
| `logical` | An `or`/`and`/`not` group over the related rows. |
| `orderBy` | The same sort spelling, including the [NULL placement](/docs/sdk/querying#where-nulls-sort). |
| `fields` | Columns of the *related* row. Its key always survives, so the row stays addressable. |
| `include` | Relations of the related row, in turn — this is how the tree nests. |

`true` is the shorthand for "load it whole": `{ author: true }` and
`["author"]` are the same request.

### Unknown relation names are refused

A name that is not a relation of the collection is a **400
`UNKNOWN_RELATION`**, at every level of the tree — including inside a nested
`include`. It used to be ignored, which answers 200 with the field simply
missing, and a missing relation field is indistinguishable from a row that
genuinely has no related row. A typo therefore looked exactly like empty data.

With a generated `Database` type, it does not get that far: `include` keys are
checked against the collection's real relations at compile time, recursively.
See [Typed includes](#typed-includes).

### On the wire

`include` is one query parameter with two spellings, told apart by a leading
brace:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

The flat form is what a human types and what most requests need; the JSON form
exists because the flat one cannot carry per-relation options, and inventing a
punctuation for them (`comments(limit:5)`) would be a third grammar to learn
beside the two this API already has. Both are accepted on every list and
get-by-id route, and the SDK picks whichever the query needs.

### Combining with Filters

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Reading Relation Data

When relations are included, the response contains **both** the scalar foreign key and the hydrated relation object:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Note:** Without `.include("author")`, only the scalar `authorId` field is returned. The hydrated `author` object will be `undefined`.

### A `belongsTo` has three shapes

One relation, three places it appears — and the wire is deliberately not
symmetric about it, so it is worth knowing all three:

| Where | Shape | Why |
|-------|-------|-----|
| **Write** | `{ author: id }` **or** `{ authorId: id }` | Both are accepted. The write transformer maps the relation property onto the foreign-key column, so the two are the same write. |
| **Read** | `authorId` | It is a column. Every read returns it. |
| **Read with `include`** | `author`, the target's own row | Loaded only when the query names it, so it is absent from every other read. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.collection<Post>("posts");

// Write: either spelling.
await posts.create({ title: "Hello", author: authorId } as Partial<Post>);
await posts.create({ title: "Hello", authorId });

// Read: the key.
const post = await posts.get(id);
post.authorId;          // "uuid-1234"
post.author;            // undefined — nothing asked for it

// Read with include: the row.
const { data } = await posts.include("author").find();
data[0].authorId;       // "uuid-1234" — still there
data[0].author?.name;   // "Jane Doe"
```

A generated `Database` types all three precisely: `Insert` and `Update` accept
either write spelling, `Row` has `authorId` unconditionally, and `author` is
optional on `Row` and **required** on the row a read with `include` returns —
see [Typed includes](#typed-includes).

The one case where the three collapse is a relation named identically to its own
foreign key. There the included row is served *over* the column, and the
generated type says so by typing that key as both.

### Typed includes

`rebase generate-sdk` writes the relation graph into your `Database` type, and
two helpers built on it:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` constrains an include's keys to relations that exist, at every
level. `RowWith<A, I>` is the row that read returns, with every included
relation made **required** — so after asking for the author, `row.author.name`
needs no `?.`.

Without a generated `Database`, `include` stays a plain `string[]` or tree: a
hand-written row type has no relations in it to check against, and the server's
400 is the backstop.

### Relation Names

The relation names you pass to `include()` must match the `relationName` defined in the collection's `relations` array:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Querying Through a Relation

`include()` fetches related rows *after* the page has been chosen. The two
features below choose the page **with** them: they compile to SQL, so they run
before `limit` and `offset` rather than after.

This is what a queue screen needs — *who is waiting, longest first* — where both
halves of the question are answered by a related table rather than by the row
being listed.

### Filter by a column of the related row

A dotted key reaches through a relation to one of the target's columns:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

It compiles to an `EXISTS` over the related table, correlated to the row being
listed — not a join, which would multiply rows and quietly break `limit`.

Every operator works, because the thing being compared is an ordinary column:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

The negative operators — `!=`, `not-in`, `not-like`, `not-ilike` — mean **"no
related row matches"**, not "some related row differs":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

That is the reading you want, and the only one that makes `==` and `!=`
partition the rows. The other reading — "some application is not 'hired'" — is
true of nearly every candidate with more than one application, and answers
nothing anybody asked.

`is-null` and `is-not-null` are deliberately **not** a complementary pair here.
They mean "has a related row whose column is unset" and "has one where it is
set" — both true of a candidate with two applications, one of each.

A relation name that does not exist, or a column the target does not have, is a
400 naming the target's real columns. It is never a dropped condition: dropping
a filter key would *widen* the read to every row.

### Sort by an aggregate over a relation

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

The fluent builder takes the same key:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` and `avg`. `field` is required by all of them
except `count`, which counts the related rows when you leave it out and counts
the rows with a non-null column when you don't.

This is the half of a queue you cannot work around on the client. A filter can
be approximated by denormalising a flag onto the row; an ordering cannot be
approximated at all once the result set is paged, because the client only ever
holds one page and the page was chosen by the wrong order.

Rows the relation reaches nothing from land at a defined end — **last
ascending, first descending**, the placement Postgres gives a `NULL`. A `count`
of nothing is `0` rather than null, so those rows sort as zero.

Over HTTP the key is a single string, so it fits `?orderBy=` unchanged:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

Cursor pagination works over it. There is no aggregate stored on the cursor row
to compare against, so the driver recomputes the cursor row's value in SQL from
the id it does have.

### Row-level security

Both compile to a subquery that runs as the reader, so a related row your
policies hide does not match a filter and does not contribute to an aggregate.

One caveat, on the **negative** direction only: "no related row matches" and "no
related row *this reader can see* matches" are the same sentence. A target table
with row-level security and no `SELECT` policy for `rebase_user` is opaque, so
every row looks unmatched and a `!=` / `not-in` filter over-reports. Nothing
leaks — the listed table's own policies still decide which rows exist at all,
and the positive direction correctly returns nothing. The fix is a `SELECT`
policy on the target. Rebase derives one for a declared many-to-many; a
hand-written schema has to supply it.

### Engine support

Postgres only. Firestore and MongoDB declare `filterableRelationKinds: []` and
do not offer either feature — a document store links by reference and has no
subquery to compile these into. See
[data source capabilities](/docs/backend/multiple-sources).

### Why not `additionalFields`?

`AdditionalFieldDelegate.value()` is async and gets the whole context, so it
*can* read another collection — and it still cannot help here. It runs in the
browser, once per row, **after** the page has been fetched and ordered. A value
computed there can be displayed and can never be filtered, sorted or paged on.

If a derived value is not an aggregate over a relation, put it in the database —
a generated column, or a trigger-maintained one — and it becomes an ordinary
property.

## Next Steps

- [Querying Data](/docs/sdk/querying/) — the query builder these accessors return
- [Relations](/docs/collections/relations/) — declaring the links this page reads
- [REST API](/docs/backend/api/) — the same `include` over HTTP
