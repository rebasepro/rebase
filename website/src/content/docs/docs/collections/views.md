---
title: Views
sidebar_label: Views
description: "Serve a SQL view or a materialized view read-only with defineView: security_invoker views governed by the tables they read, materialized views gated by roles, refreshed on demand, created by db push."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

`defineView` serves a SQL query as a read-only table. Declare the query, the
columns it returns, and the column or columns that identify a row:

```ts
// backend/schema/artist-stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs:  col.integer().notNull(),
        fame:   col.integer(),
    },
});
```

Export it from `backend/schema/index.ts` like a table. It reads like any
table — `find`, `findById`, `count`, [`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, the REST routes, MCP and the CMS — and it is never written: every
write is a `405 COLLECTION_READ_ONLY`. Write to the tables the view reads.

`rebase db push` creates the view after the tables, `rebase db generate`
appends it to the migration, and a managed boot creates it in its schema step.
A view whose query has not changed is left alone; one whose query changed is
dropped and created again, together with any of your views that read it.
Rebase refuses to replace a table, or a view it did not create, that already
has the name.

## Options

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Key | What it does |
|---|---|
| `query` | **Required.** The defining `SELECT`. |
| `columns` | **Required.** The columns the query returns, as `col.*` builders. `.primaryKey()` marks the ones that identify a row. |
| `materialized` | `true` stores the rows. See [Materialized views](#materialized-views). |
| `roles` | Who may read a materialized view. `["admin"]` when omitted. Refused on a plain view. |
| `slug` | The name in the API. The view's name when omitted. |
| `schema` | The Postgres schema. `public` when omitted. |
| `database` | A non-default Postgres database. |
| `description` | What the view holds, for OpenAPI and MCP. |
| `relations` | Relations to read through, as on a table. No constraint is created for a view. |
| `indexes` | Indexes on a materialized view's stored rows. |
| `hooks` | `beforeQuery` and `afterRead` only. See [Table hooks](/docs/collections/callbacks/). |
| `metadata` | Any data you want served with the view's descriptor. |

A view has at least one `.primaryKey()` column: a view has no key of its own,
and a row needs an address.

## Who sees which rows

<span class="since-badge" data-since="0.31">Since 0.31</span>

A plain view is created `WITH (security_invoker = true)`, so it runs **as the
caller**: the row-level security of the tables it reads decides what each
caller sees. A user whose policies show them their own songs sees the view of
their own songs. That is why a view has no `rls`: there is nothing to attach
policies to, and nothing they could add. See
[Row-level security](/docs/collections/security-rules/) for the policies on the
tables underneath.

## Materialized views

<span class="since-badge" data-since="0.31">Since 0.31</span>

`materialized: true` stores the rows, so a read does not run the query:

```ts
import { defineView, col } from "@rebasepro/server/schema";

export const langs = defineView("langs", {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: {
        lang:  col.text().primaryKey(),
        songs: col.integer().notNull(),
    },
    indexes: [{ columns: ["songs"], reason: "the most-used languages first" }],
});
```

Postgres puts no row-level security on a materialized view: whoever may read it
reads all of it. So Rebase serves it only to callers holding one of `roles`
(`["admin"]` when left out, which `dataAsAdmin` holds) and refuses everyone else
with `403 VIEW_NOT_READABLE`. Put nothing in one that its readers may not see.

The rule is held in the database too, so [SQL run as a caller](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller)
meets it as well. The rows are stored under `<view>_rebase_rows`, which only the
database owner may read, and the view's own name is a view over them that
returns rows only to a caller holding one of `roles`, and to the server itself
(`rebase.sql()`, crons). Query the view's name, never the stored rows.

The rows are as of the last refresh. Refresh with `refresh()` — on the server
as `rebase.dataAsAdmin.langs.refresh()`, or from a client signed in with one of
the roles — or over HTTP:

```typescript
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` keeps serving the old rows while the new ones are computed. It
needs the unique index Rebase creates on the `.primaryKey()` columns, so those
must be unique in the query's result. To refresh on a schedule, call
`refresh()` from a [cron job](/docs/backend/cron-jobs/). A materialized view can
carry `indexes` of its own (see [Indexes](/docs/backend/indexes/)), built on its
stored rows; a plain view reads the indexes of its tables.

## What a view cannot have

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rls`, `history`, `softDelete`, `tenant` and `search` are refused when the
schema is compiled: each needs a table to write to or to attach policies to.
`roles` on a plain view is refused when the module loads, and so is an empty
`query`. `indexes` on a plain view is refused when the schema is compiled.

A `listen` on a view hears of a `refresh()`. A write to the tables under a view
does not reach the view's subscribers: subscribe to the tables, or re-read the
view.
