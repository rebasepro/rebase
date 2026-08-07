---
title: Search
sidebar_label: Search
description: How .search() behaves by default, and how to opt a Postgres collection in to ranked full-text search over the fields you name — including JSONB and array content.
---

`.search("term")` works on every collection without configuration. What it
compiles to depends on whether the collection has asked for anything more.

## The default

With no configuration, `.search()` is a **case-insensitive substring match**,
OR-ed across the collection's top-level `string` properties:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

This is enough for a small collection with its text in plain columns. It has
three limits that no setting inside it can fix:

- **It cannot see inside `map` or `array` properties.** A collection that keeps
  its searchable content in JSONB — tags, certifications, a questionnaire — has
  a search box that silently matches nothing.
- **It has no relevance.** Rows come back in `orderBy` order, so the best match
  can be on page seven.
- **It cannot use an index.** A leading `%` defeats a B-tree, so every search is
  a sequential scan. Fine at a thousand rows; a cliff at a million.

The default does not change, and a collection that has not opted in compiles to
exactly the SQL it always did.

## Opting in

Declare a `search` block on a Postgres collection, naming the fields you want
indexed:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        full_name: { name: "Full name", type: "string" },
        bio: { name: "Bio", type: "string" },
        interests: { name: "Interests", type: "array", of: { name: "Interest", type: "string" } },
        questionnaire: { name: "Questionnaire", type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};
```

Nothing is inferred. A field is searched if and only if you name it, and a path
that does not resolve fails at boot rather than being quietly skipped — a search
field you believe is live and is not is exactly the failure this block exists to
prevent.

`.search()` then compiles to a ranked full-text match, and rows come back with a
`_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### What declaring it creates

One `tsvector` column, `GENERATED ALWAYS AS … STORED`, and one GIN index on it.
Postgres recomputes the column on every write of a source field and refuses any
attempt to write it directly, so the index cannot drift from the row. Both
appear in generated DDL, in `schema.generated.ts`, and in `rebase db push`
output like any other declared object. The column is never returned by the API.

## What you can name in `fields`

| Path | Resolves to | Example |
|------|-------------|---------|
| A `string` property | the column | `"full_name"` |
| A `string[]` property | every element | `"interests"` |
| A `map` property | every string value in the document | `"questionnaire"` |
| A path inside a `map` | every string value at or below that point | `"questionnaire.certifications"` |

A path into a map indexes **string values at any depth** below it — arrays of
strings, nested objects, arrays of objects. JSON *keys* are never indexed, only
values, so a field name common to every row does not become a term that matches
every row.

Naming an enum, a UUID, a `json` (rather than `jsonb`) column, or an array of
numbers is a boot-time error explaining why. Enums in particular are a fixed
vocabulary: filter on them with `where`, which is exact and uses an index.

## Options

### `language`

The Postgres text search configuration, which decides stemming and stopwords.
`"spanish"` stems `auditores` to `auditor` and drops `de`; the default,
`"simple"`, does neither.

`"simple"` is the default because it is the only choice that is never wrong — a
stemmer applied to the wrong language silently mangles lexemes. Set it to your
content's language to get stemming.

### `unaccent`

Fold accents before indexing, so `auditoria` matches `auditoría`.

This is not cosmetic in an accented language. Postgres stems the two spellings
to **different lexemes** — `to_tsvector('spanish', 'auditoría')` yields
`auditor` while `'auditoria'` yields `auditori` — so without it, a query typed
without accents misses every row that carries them, which is most queries most
users type.

Requires the `unaccent` extension.

### `fuzzy`

Also match on trigram similarity, so near-misses still rank: `iso14000` reaching
`ISO 14001`, which no amount of stemming will do because they are simply
different lexemes.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Adds a second generated column and a trigram index, and requires `pg_trgm`.
Costs write time and disk; buys the most common class of failed search.

### `weight`

Each field carries one of Postgres's four weight classes, `A` (strongest)
through `D`. `ts_rank` scores an `A` hit far above a `D` one, which is how a
name outranks a passing mention in a long description. Fields default to `B`.

### `column`

The generated column is named `search_vector`. Change it only if that collides
with a column you already have — it is part of your schema once created, and
renaming it later is a drop and recreate, which rewrites the table.

## Ranking

`_score` is `ts_rank` against the same query the rows were matched with, and is
present only when the collection opted in *and* the request carried a search
string. Outside those two conditions `orderBy: "_score"` is an unknown field and
returns 400 rather than silently returning unsorted rows.

`_score` cannot be combined with cursor pagination (`startAfter`). Relevance is
computed per query rather than stored, so there is no value on the cursor row to
compare the next page against, and two requests with different search strings
produce scores that are not on the same scale. Use `limit`/`offset` for
relevance-ordered pages.

## Adding the block to a live collection

The generated column is added by the boot-time schema ensure, like any other
column, and its index is built with `CREATE INDEX CONCURRENTLY` so writes are
not blocked. Adding a *stored* generated column does rewrite the table, so on a
large one, plan it like any other rewrite.

## Which engines

The `search` block is Postgres-only, and is rejected at boot on other engines
rather than silently ignored. MongoDB collections keep their regex-based
matching; Firestore collections use the external text-search controller.
