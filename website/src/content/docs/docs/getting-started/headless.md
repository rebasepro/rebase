---
title: Backend only (headless)
sidebar_label: Backend only
description: Run Rebase as a headless Backend-as-a-Service over your own PostgreSQL — a REST API, auth, storage and realtime, with no admin panel and no collection files.
---

Rebase has two shapes, and this page is the one that never opens a browser: a
REST API, auth, storage, realtime and backups over a PostgreSQL database you
already have. No admin panel, no React, no collection files. If you were
reaching for Supabase or PostgREST, this is the comparable thing.

Everything on this page also works in the full project — it is the same server.
What `--headless` removes is the frontend package and the collection files, not
a capability.

## Scaffold it

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Two workspaces, no `frontend/`:

| Folder | What is in it |
|--------|---------------|
| `backend/` | Your custom functions and crons. There is no server file — the published runtime boots the project |
| `config/` | `storageAuthorize`, and any collections `--introspect` generates |

`--template` has no effect here: a preset seeds collection files, and this
flavour has none. Node 22.22+, the same floor as the full project — the headless
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

## Where the collections come from

There are none in code. The server reads your database schema at boot and serves
the tables it finds, so the API follows your migrations: change the schema, and
the endpoints change with it.

A table is served once it has an authorization model — row-level security
enabled, plus at least one policy:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` and `rebase.jwt()` are installed by Rebase and
read the identity of the authenticated request. See
[Security Rules](/docs/collections/security-rules/) for the policy vocabulary,
and [rls-check](/docs/rls-check/) for an audit of what your policies actually
allow.

A table without RLS is **skipped**, deliberately: every authenticated request
runs as `rebase_user`, so serving a table with no policy would hand every row to
every signed-in caller. Each skipped table is named at boot along with the SQL
that would protect it.

:::note
`baas: { unprotectedTables: "serve" }` serves them anyway. It is an
`initializeRebaseBackend` option, so it is reachable only after `rebase eject` —
the managed runtime does not read it from `config/index.ts` or from the
environment. Only sensible when every caller is already trusted.
:::

### Generating collection files instead

If you would rather have the tables written down as TypeScript — for types, for
callbacks, for review — introspect them:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implies `--template blank` and needs `--install`, because it runs
against the installed CLI. In an existing project the same thing is:

```bash
pnpm rebase schema introspect
```

Files land in `config/collections/`. From that point the project has collections
in code and the boot-time introspection stops being what defines the API.

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

const { data: posts } = await rebase.data.collection("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST API](/docs/backend/api/) — the endpoint shapes, filters and errors
- [Client SDK](/docs/sdk/) — querying, auth, realtime, storage
- `/api/docs` and `/api/swagger` — the OpenAPI document and its viewer, served
  by the running backend once it has a collection. A project with none serves
  neither: the document is generated from the collections, so there is nothing
  to describe until the section above has run

## `404 NO_COLLECTIONS`

If every data request answers with this:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

then the project declares no collections in code *and* the database gave it
nothing to derive them from. It is the expected first response from a headless
project pointed at an empty database, and it is a 404 rather than a 500 because
nothing is broken — there is simply nothing to serve yet.

Three things resolve it, in the order worth checking:

1. **The database has no tables.** Create them — a migration, plain SQL, or a
   collection file plus `rebase db push` — and restart.
2. **The tables have no RLS policy**, so boot skipped them. The boot log names
   each one. Add a policy, as above.
3. **`DATABASE_URL` points somewhere else** than you think. `rebase status`
   <span class="since-badge" data-since="0.18">Since 0.18</span> prints the three files that decide what the backend reaches.

## Adding an admin panel later

Nothing here locks you out of it. Add a `config/collections/` directory — by
hand or with `rebase schema introspect` — and a frontend that renders them; the
backend does not change. [Frontend Setup](/docs/frontend/) is where that starts.

## Next steps

- [Authentication](/docs/backend/authentication/) — providers, tokens, API keys
- [Security Rules (RLS)](/docs/collections/security-rules/) — the access model
- [Custom Functions](/docs/backend/custom-functions/) — your own routes
- [Deployment](/docs/getting-started/deployment/) — taking it to production
