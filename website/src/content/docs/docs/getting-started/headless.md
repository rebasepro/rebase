---
title: Backend only (headless)
sidebar_label: Backend only
description: Run Rebase as a headless Backend-as-a-Service over your own PostgreSQL — a REST API, auth, storage and realtime, with no admin panel and no backend/schema.
---

Rebase has two shapes, and this page is the one that never opens a browser: a
REST API, auth, storage, realtime and backups over a PostgreSQL database you
already have. No admin panel, no `backend/schema/`. If you were
reaching for Supabase or PostgREST, this is the comparable thing.

Everything on this page also works in the full project — it is the same server.
What `--headless` removes is the frontend package and the table files, not
a capability.

## Scaffold it

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

One workspace, no `frontend/`:

| Folder | What is in it |
|--------|---------------|
| `backend/` | `storage.ts` (`storageAuthorize`), your custom functions and crons, and the `backend/schema/` that `--introspect` writes, when you ask for it. There is no server file — the published runtime boots the project |

`--template` has no effect here: a preset seeds tables, and this flavour has
none. Node 22.22+, the same floor as the full project — the headless
overlay's `package.json` declares `"node": ">=22.22.0"` and replaces the one
under it.

## Point it at your database

`init` generates a ready-to-run `.env`. To use a database you already run, pass
its URL at scaffold time:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Or set `DATABASE_URL` in `.env` afterwards — it is the same thing. With no
`DATABASE_URL`, `rebase dev` starts a managed PostgreSQL (PGlite) in the project
directory, which is useful for trying the API out but is not what this flavour
is for.

Then:

```bash
pnpm install
pnpm run dev
```

**Read the URL from the output.** `rebase dev` derives a free port from the
project's path rather than using a fixed one, so it differs between projects and
between machines.

## Where the tables come from

<span class="since-badge" data-since="0.31">Since 0.31</span>

There are none in code: with no `backend/schema/index.ts`, the backend declares no tables. The server reads your database schema at boot and serves
the tables it finds, so the API follows your migrations: change the schema, and
the endpoints change with it.

A table is served once row-level security is enabled on it. With no policy it
is served and returns no rows, and boot warns about it; a policy opens it:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` and `rebase.jwt()` are installed by Rebase and
read the identity of the authenticated request. See
[Row-level security](/docs/collections/security-rules/) for the policy vocabulary,
and [rls-check](/docs/rls-check/) for an audit of what your policies actually
allow.

A table without RLS is **skipped**, deliberately: every authenticated request
runs as `rebase_user`, so serving a table that row-level security does not guard
would hand every row to every signed-in caller. Each skipped table is named at boot along with the SQL
that would protect it.

A join table is not served either way: it is read as the link between the two
tables it joins. One with RLS off is named at boot too.

The check runs at boot. If RLS is disabled on a served table later, it stays
served until the next boot skips it. The [scheduled audit](/docs/rls-check/)
reports it sooner, and is off by default.

:::note
`baas: { unprotectedTables: "serve" }` serves them anyway. It is an
`initializeRebaseBackend` option, so it is reachable only after `rebase eject` —
the managed runtime does not read it from any file or from the environment. Only sensible when every caller is already trusted.
:::

### Generating table files instead

If you would rather have the tables written down as TypeScript — for types, for
hooks, for review — introspect them:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implies `--template blank` and needs `--install`, because it runs
against the installed CLI. In an existing project the same thing is:

```bash
pnpm rebase schema introspect
```

Files land in `backend/schema/`: one `defineTable` per table, with its columns,
relations and its policies as `rls`, and an `index.ts` exporting them. From
that point the project has tables in code and the boot-time introspection stops
being what defines the API.

The headless
scaffold installs Atlas in `backend/`, so `rebase db push`, `rebase db generate`
and `pnpm run db:migrate` work on those tables as in any project.

## Use it

Over HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Or with the type-safe client, which is a dependency of the headless scaffold
already:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST API](/docs/backend/api/) — the endpoint shapes, filters and errors
- [Typed SDK](/docs/sdk/) — querying, auth, realtime, storage
- `/api/docs` and `/api/swagger` — the OpenAPI document and its viewer, served
  by the running backend once it serves a table. A project with none serves
  neither: the document is generated from the tables, so there is nothing
  to describe until the section above has run

## `404 NO_TABLES`

If every data request answers with this:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

then the project declares no tables in code *and* the database gave it
nothing to serve. Before 0.31 the code was `NO_COLLECTIONS`. It is the expected first response from a headless
project pointed at an empty database, and it is a 404 rather than a 500 because
nothing is broken — there is simply nothing to serve yet.

Three things resolve it, in the order worth checking:

1. **The database has no tables.** Create them — a migration, plain SQL, or a
   `defineTable` file plus `rebase db push` — and restart.
2. **The tables do not have row-level security enabled**, so boot skipped
   them. The boot log names each one, with the SQL. Enable it and add a policy,
   as above. The
   response says so too: its message names the tables and gives the
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for them, and
   `details.unprotectedTables` lists them.
3. **`DATABASE_URL` points somewhere else** than you think. `rebase status`
   prints the three files that decide what the backend reaches.

## Adding an admin panel later

Nothing here locks you out of it. Add a `frontend/` that mounts `<RebaseCMS />`:
it renders every table the backend serves, from `GET /api/schema/tables`, with
no file per table. Write `backend/schema/` — by hand or with
`rebase schema introspect` — when you want the tables in code; the panel's own
customizations go in `frontend/src/cms/`. [Frontend Setup](/docs/frontend/) is where that starts.

## Next steps

- [Authentication](/docs/backend/authentication/) — providers, tokens, API keys
- [Row-level security](/docs/collections/security-rules/) — the access model
- [Custom Functions](/docs/backend/custom-functions/) — your own routes
- [Deployment](/docs/getting-started/deployment/) — taking it to production
