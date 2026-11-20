---
title: "Recipe: Migrating from Supabase"
sidebar_label: Migrating from Supabase
description: "Move a Supabase project to Rebase: introspect the schema, apply the SQL objects that are not tables, copy the data keeping user ids, port edge functions, and deploy, all from the CLI."
---

## Overview

This moves a Supabase project (tables, row-level security, SQL functions and
triggers, users, a storage bucket, edge functions) to a Rebase project,
locally first and then on [Rebase Cloud](/docs/deployment/cloud/). Everything
is a CLI command. To keep running on the Supabase database instead of leaving
it, see [Supabase](/docs/deployment/existing-database/#supabase) on the
existing-database page.

The order matters: generate the tables from the **source**, then point the
project at the **target** before anything writes.

## 1. Generate the tables

Introspect the Supabase database, or a local copy of it. `SUPABASE_DB_URL`
below is its direct connection string, as the `postgres` role (Supabase's
dashboard: Connect → Direct connection); set it in your shell first:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` translates what a Rebase database does not have:

| In Supabase | Written as |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: the server writes the caller's id |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, and the foreign key listed under "Not carried over" |
| `auth.uid()` in a policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | the role is dropped and the rule requires a signed-in / signed-out caller |
| a policy only `TO service_role` | dropped: server code runs in the server's own context |
| plain indexes | the table's `indexes` |

User-id columns become `text` because `rebase.users.id` and `rebase.uid()` are
text: a `uuid` column compared with `rebase.uid()` in a policy fails.

The run ends with a list of what it did **not** carry over (functions,
triggers, extensions, CHECK constraints, other indexes, composite foreign keys)
and writes the SQL for each to `backend/sql/_introspected-left-behind.sql`, a
draft that `rebase db push` does not apply until you rename it.

## 2. Point the project at the new database

`DATABASE_URL` still names Supabase after step 1, and the introspect output
says so. Change it (or remove it, to use the managed development database)
before the first push:

```bash
rebase db push
```

## 3. Apply the SQL objects
<span class="since-badge" data-since="0.35">Since 0.35</span>

Edit `backend/sql/_introspected-left-behind.sql` the way the tables were
edited: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, no
`GRANT … TO anon, authenticated`. Functions that called `pg_net` are better as a
[custom function](/docs/backend/custom-functions/). Make every statement safe to
run again (`DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`), then rename
the file without the leading `_` and push:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` applies every `.sql` file in `backend/sql` in name order, after
the tables and before the policies, and records each by hash in
`rebase.sql_files`, so a file runs again only when it changes.

A function the browser called with `supabase.rpc('fn')` is reached through a
custom function that validates its input and calls it, as the caller under
row-level security:

```ts
// backend/functions/rpc.ts
import { defineFunction, getSql } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/get_public_proposal", async (c) => {
        const { token } = await c.req.json<{ token: string }>();
        const sql = getSql(c);
        const [row] = await sql("select public.get_public_proposal($1::uuid) as result", { params: [token] });
        return c.json(row?.result ?? null);
    });
});
```

## 4. Copy the data, keeping user ids

Keep the Supabase user ids, so every `owner_id` still points at its user:
insert the users first, with their ids, then the application tables. With
`pg_dump` against the source and the target. `TARGET_URL` is the new
database's connection string: your `DATABASE_URL`, or on Rebase Cloud the
`connectionString` that `rebase cloud db connect --reveal` prints while it runs.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
psql "$SUPABASE_DB_URL" -c "\copy (select id::text, email, created_at from auth.users) to users.csv csv"
psql "$TARGET_URL" -c "\copy rebase.users (id, email, created_at) from users.csv csv"
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Passwords do not move. Users sign in again with a magic link or a password
reset.

## 5. Storage

A public Supabase bucket maps to a [storage](/docs/backend/storage/) source
with paths under `public/`, which are served without a token. Copy the objects
with any S3 client, keeping their keys.

## 6. Edge functions

A Deno edge function becomes a [custom function](/docs/backend/custom-functions/)
in `backend/functions/`. The usual substitutions:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` inside the handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` or `rebase.sql` on the server |
| a client with the user's JWT | `getSql(c)`: SQL as the caller, under row-level security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([background work](/docs/backend/background-work/)) |

Supabase lets an edge function run for 150 s; Rebase's default is 30 s. Raise
`REBASE_FUNCTIONS_TIMEOUT_MS` for one that calls an LLM.

## 7. Sign-in email

Magic-link and email-code sign-in need an email service. Set `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` (`rebase cloud env set`
on Cloud). Without them the route answers 503, and `rebase cloud status`
reports `blockedOn: email_not_configured`.

## 8. Deploy
<span class="since-badge" data-since="0.35">Since 0.35</span>

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
rebase cloud db query --file backend/sql/introspected.sql
```

A deploy does not apply `backend/sql` yet; run the file once on the Cloud
database as above, and again after you change it.
