---
title: Views
sidebar_label: Views
description: Serve a SQL view or materialized view as a read-only collection, declared in config and created by db push.
---

## A collection over a query

A collection can serve a SQL view instead of a table. Declare the query under
`view`, describe its columns as properties, and mark the one that identifies a
row with `isId` — a view has no primary key of its own:

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    slug: "artists",
    name: "Artists",
    table: "artist_stats",
    view: {
        query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
                FROM songs GROUP BY 1`
    },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" },
        fame: { name: "Fame", type: "number" }
    }
});
```

It reads like any other collection — `find`, `findById`, `count`,
[`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, the REST routes, MCP and the admin panel — and it is read-only: every
write is a `405 COLLECTION_READ_ONLY`, and the admin offers no create, edit or
delete. Write to the tables the view reads.

`rebase db push` creates the view after the tables (it is applied by Rebase,
not Atlas), `rebase db generate` appends it to the migration, and a managed
boot creates it in its schema step. A view whose query has not changed is left
alone; one whose query changed is dropped and created again, together with any
of your views that read it. Rebase refuses to replace a table, or a view it
did not create, that already has the name.

## Who sees which rows

A plain view runs **as the caller** (`security_invoker`), so the policies of
the tables it reads decide what each caller sees: a user whose policies show
them their own songs sees the view of their own songs. That is why
`securityRules` cannot be declared on a view — there is nothing to attach them
to, and nothing they could add. See [Security rules](/docs/collections/security-rules/) for
the policies on the tables underneath.

## Materialized views

`materialized: true` stores the rows, so a read does not run the query:

```ts
view: {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"]
}
```

Postgres puts no row-level security on a materialized view: whoever may read it
reads all of it. So Rebase serves it only to callers holding one of `roles`
(`["admin"]` when left out, which `dataAsAdmin` holds) and refuses everyone else
with `403 VIEW_NOT_READABLE`. Put nothing in one that its readers may not see.

The rule is held in the database too, so [SQL run as a caller](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller)
meets it as well. The rows are stored under `<table>_rebase_rows`, which only
the database owner may read, and the collection's own name is a view over them
that returns rows only to a caller holding one of `roles`, and to the server
itself (`rebase.sql()`, crons). Query the collection's name, never the stored
rows.

The rows are as of the last refresh. Refresh with `refresh()` — on the server
as `rebase.dataAsAdmin.langs.refresh()`, or from a client signed in with one of
the roles — or over HTTP:

```ts
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` keeps serving the old rows while the new ones are computed; it
needs the unique index Rebase creates on the `isId` columns, so those must be
unique in the query's result. To refresh on a schedule, call `refresh()` from a
[cron job](/docs/backend/cron-jobs/). A materialized view can carry `indexes`
of its own (see [Indexes](/docs/backend/indexes/)), built on its stored rows; a
plain view reads the indexes of its tables.

## What a view cannot have

`securityRules`, `history`, `softDelete`, `tenant` and `search` are refused at
boot, because each needs a table to write to or to attach to.

A `listen` on a view hears of a `refresh()`. A write to the tables under a
view does not reach the view's subscribers: subscribe to the tables, or
re-read the view.
