---
title: Querying relations
sidebar_label: Relations
description: "Include related entities in a query, and read a child collection through its parent with the SDK's relation accessors."
---

## Fetching Relations

Relations can be included so that related entities are returned alongside the primary data, instead of just their foreign key IDs.

### Using `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations
const { data } = await client.data.posts
    .include("*")
    .find();
```

### Using `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

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
