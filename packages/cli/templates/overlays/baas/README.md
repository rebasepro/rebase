# {{PROJECT_NAME}}

A headless Rebase backend: a REST API, auth, storage, realtime and backups over
your PostgreSQL database.

There is no `backend/schema/` directory. The server reads your database schema
at boot and serves your tables, so the API follows your migrations — change the
schema, restart the backend, and the endpoints change with it.

## Serving a table

A table is served once it has an authorization model: row-level security
enabled. Until then the server skips it — deliberately, so a new table is never
exposed just by existing — and logs each table it skipped and why. A table with
row-level security on but no policy yet is served and returns no rows (the boot
log names it); a policy is what opens it:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` and `rebase.jwt()` are provided by Rebase and read the
identity of the authenticated request.

Serving one anyway is `baas: { unprotectedTables: "serve" }`, and it is passed
to `initializeRebaseBackend` — so it needs a project that owns its entrypoint.
This scaffold has none: the published runtime boots it. Run `rebase eject` if
you want that file, and read the flag for what it is — every authenticated
request runs as one database role, so a table with no policy is handed whole to
every signed-in caller.

## Run it

```bash
pnpm install
pnpm dev
```

`rebase dev` prints the URL it bound, and a box with the API, the Swagger path
and the database it is using. **Read that box**: the port is derived from this
project's path rather than fixed, so several Rebase projects can run at once,
and `PORT` in `.env` applies to `rebase start`, not here.

- API: `<the printed URL>/api/data/<table>` — once a table is served
- Docs: `<the printed URL>/api/docs` — likewise; the OpenAPI document of the tables you may see, for a signed-in caller. Set `REBASE_ENABLE_SWAGGER=true` to publish it to everyone with the Swagger UI at `/api/swagger`
- Health: `<the printed URL>/health`

A headless project starts with no tables, so the first two answer
`404 NO_TABLES` until you create one and restart — the box `rebase dev`
prints says the same thing. See [Serving a table](#serving-a-table).

There is no database to install: with no `DATABASE_URL` set, `rebase dev` runs a
managed PostgreSQL for this project, with its data under `.rebase/`. Set
`DATABASE_URL` in `.env` to point at a database of your own — it always wins.
`rebase db url` prints whichever one is in use, so it pipes straight into psql.

## Use it from an app

```ts
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed. `pnpm example` reads it from .rebase-dev-url
// for you rather than hardcoding a port.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });
const posts = await rebase.data.table("posts").find();
```

## Declaring your tables in code

The one-line switch: create `backend/schema/index.ts`. Once it exists, the
tables it exports are the schema — `pnpm dev` creates and migrates them, and the
server serves those rather than reading the database. `pnpm schema:introspect`
writes that directory from the tables you already have, one
`defineTable(...)` per table, each with its row-level security written out:

```ts
// backend/schema/posts.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        authorId: col.text().notNull()
    },
    rls: [{ operations: ["select", "update", "delete"], ownerField: "authorId" }]
});
```

```ts
// backend/schema/index.ts
export { posts } from "./posts";
```

## Adding an admin UI later

Nothing here locks you out of it. `rebase init` without `--headless` scaffolds
the same backend with a `frontend/` beside it: `<RebaseCMS />` lists every table
the backend serves with no code, and `frontend/src/cms/<table>.tsx` customizes
one with `customizeTable(...)`. There is no `backend/src/index.ts` to edit — the
published runtime boots this project — and `rebase eject` writes one if you want
to own the entrypoint.
