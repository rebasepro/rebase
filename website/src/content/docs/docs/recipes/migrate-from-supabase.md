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
`rebase.sql_files`, so a file runs again only when it changes. A deploy applies
them the same way (step 8).

A function the browser called with `supabase.rpc('fn')` is declared with
[`defineRpc`](/docs/backend/rpc/), beside the tables. It is then served at
`POST /api/rpc/<name>` and runs as the caller under row-level security, so a
`SECURITY DEFINER` function behaves as it did on Supabase:

```ts
// backend/schema/rpc.ts, exported from backend/schema/index.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",                         // supabase's anon key; "authenticated" for signed-in only
    args: { token: json.string().required() } // validated before the function runs
});
```

```ts
// in the browser: supabase.rpc("get_public_proposal", { token })
const proposal = await rebase.rpc("get_public_proposal", { token });
```

Only declared functions are callable, and every `public` one is rate-limited.
One that writes needs `write: true`.

## 4. Copy the data, keeping user ids

Keep the Supabase user ids, so every `owner_id` still points at its user:
import the users first, with their ids, then the application tables.
`rebase users import` creates the accounts under the ids they had, with no
password and no email sent, and skips one whose id or email is already there,
so it can be run again. It reaches Rebase Cloud like every other `rebase users`
command (`--project <slug>`, or `--cloud` in a linked directory).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv
```

It reports each account as created, skipped or failed with the reason, and
exits 1 when any failed. See [Importing accounts](/docs/cli/project/#importing-accounts)
for the columns it reads (`display_name` and `roles` too).

Then the application tables, with `pg_dump` against the source and the
target. `TARGET_URL` is the new database's connection string: your
`DATABASE_URL`, or on Rebase Cloud the `connectionString` that
`rebase cloud db connect --reveal` prints while it runs.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Passwords do not move. An imported user signs in with a magic link, an email
code or a password reset, under the same id as before.

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

Supabase lets an edge function run for 150 s; Rebase's default is 30 s. A
function that calls an LLM declares its own timeout, which the server caps at
`REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s by default):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Pass `getSignal(c)` to the `fetch` that calls the model, so the call stops
when the request does. See [a function's own timeout](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Sign-in email

Magic-link and email-code sign-in need an email service. Set `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` (`rebase cloud env set`
on Cloud). Without them the route answers 503, and `rebase cloud status`
reports `blockedOn: email_not_configured`.

## 8. Deploy

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

The deploy applies `backend/sql` as `rebase db push` does: the bundle carries
the files, and the new revision's boot runs each new or changed one once, after
the tables and before the policies. A file that fails stops the boot and names
the file, so a mistake in one shows up in the deploy, not in a running app.
