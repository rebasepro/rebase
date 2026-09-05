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

The term is matched **literally**: `%` and `_` are LIKE metacharacters, and they
are escaped before the pattern is built, so searching for `50%` searches for
`50%` rather than returning every row. If you want wildcards, the `like` filter
operator takes a pattern (`.where("title", "like", "post-%")`); `.search()` does
not.

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
attempt to write it directly, so the index cannot drift from the row. The column
is never returned by the API.

They are generated into `drizzle/search.sql`, next to `schema.sql` and
`policies.sql`, and `rebase db push` applies them for you — nothing extra to
run. They get their own file because a generated `tsvector` column needs an
`IMMUTABLE` helper function to exist first (`unaccent` is only `STABLE`, and
flattening a `jsonb` document needs a set-returning function), and Atlas — the
engine behind `db push` — cannot manage functions on its free tier.

One consequence worth knowing if you deploy by migration rather than by push:
adding a `search` block on its own produces no migration, because the schema
Atlas compares has not changed. `rebase db generate` says so when it happens.
The block is still applied by `rebase db push` and by the boot-time schema
ensure; to put it in a migration explicitly, append `drizzle/search.sql` to one.

### Changing the block later

A generated column carries its expression, and Postgres cannot alter that
expression in place — so adding a field, moving a weight, changing the language
or turning `unaccent` on is **not** something `ADD COLUMN IF NOT EXISTS` can
apply to a column that already exists.

Rebase records a fingerprint of the expression on the column when it creates it,
and compares it on every boot and every `db push`. A change is refused, loudly,
with the two statements that apply it — a `DROP COLUMN` and an `ADD COLUMN`,
which rewrite the table and rebuild the GIN index. Run them at a time you
choose; nothing rewrites a live table on your behalf. (Turning `fuzzy` on is
additive — a second column — and applies without any of this.)

Boot refuses rather than serving, because the alternative is what this check
replaced: a column that keeps indexing the previous field set, and a search that
returns nothing for content plainly in the row.

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
string.

With `fuzzy` on, the trigram similarity is **added** to that rank. This is not a
refinement — it is what makes `fuzzy` a ranking at all. A typo matches nothing on
the exact path, so every row it finds has a `ts_rank` of exactly zero; ordering
by rank alone would return the best match in whatever order the table felt like.
The two terms are summed rather than weighted, so a row that matched exactly
contributes both and outranks a merely-similar row without needing a coefficient
to say so. Outside those two conditions `orderBy: "_score"` is an unknown field and
returns 400 rather than silently returning unsorted rows.

`_score` cannot be combined with cursor pagination (`startAfter`). Relevance is
computed per query rather than stored, so there is no value on the cursor row to
compare the next page against, and two requests with different search strings
produce scores that are not on the same scale. Use `limit`/`offset` for
relevance-ordered pages.

## Why did this row match?

A ranked list tells you *which* rows, never *why* one is there. Ask each row to
explain itself:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` is the path exactly as declared in `fields`, so you can map it to a
label for display. Fields come back in the order you declared them.

Per-query, not per-collection, because the cost is per-query: one `ts_headline`
per declared field per returned row, and `ts_headline` re-parses the document
rather than reading the index. Right for a page of results, wrong for an export.

**The snippet contains markup by construction** — each hit is wrapped in
`<mark>`. Render it as HTML or strip the tags, but do not treat it as plain
text, and do not trust the surrounding text: it is whatever the user typed.
Splitting on `<mark>` and rendering the parts is safer than
`dangerouslySetInnerHTML`.

With `unaccent` on, snippets read with accents folded — `Auditoria`, not
`Auditoría`. `ts_headline` over the original text cannot find a hit that an
unaccented query produced, so it would return the text with nothing marked at
all; a readable snippet that highlights beats a prettier one that silently
doesn't.

## Adding the block to a live collection

The generated column is added by the boot-time schema ensure, like any other
column, and its index is built with `CREATE INDEX CONCURRENTLY` so writes are
not blocked. Adding a *stored* generated column does rewrite the table, so on a
large one, plan it like any other rewrite.

## Which engines

The `search` block is Postgres-only, and is rejected at boot on other engines
rather than silently ignored. MongoDB collections keep their regex-based
matching; Firestore collections use the external text-search controller.

## Related

- [REST API](/docs/backend/api/) — the query parameters a search reaches the server as
- [Indexes](/docs/backend/indexes/) — what the search block creates, and what it costs
- [Querying Data](/docs/sdk/querying/) — searching from the client SDK
