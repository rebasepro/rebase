# Rebase AI Coding Rules

This is a **headless** Rebase project: a REST API, auth, storage and realtime over your PostgreSQL database, with no admin panel. There are no collection files and no generated schema — the server reads the database schema at boot and serves each table that has row-level security enabled. `README.md` shows the SQL.

`.mcp.json` in this directory wires the Rebase MCP server up already — no login, no token: it reads `.rebase/state.json` while `pnpm dev` is running. For the full skills (auth, RLS, functions, storage, deployment), run `pnpm skills:install`, or `rebase skills install --agent <claude|cursor|windsurf|gemini|codex|kiro|copilot>` to pick one.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | The backend and the managed development database, together |
| `rebase db url` | Print the connection string in use — it pipes straight into `psql` |
| `pnpm db:migrate` | Apply the migration files in `backend/drizzle/migrations`. Needs your own PostgreSQL, not the managed development database |
| `pnpm schema:introspect` | Existing tables → collection definitions in `config/collections/`. That directory ends headless mode; see rule 1 |
| `pnpm generate:sdk` | Regenerate the typed client from `config/collections/` — so in a headless project it has nothing to read until you introspect |
| `pnpm build` then `pnpm start` | Build the deployable bundle, then run it |
| `pnpm skills:install` | Install the Rebase skills for your assistant |
| `pnpm example` | Run `scripts/example.ts` against the running backend — the SDK, end to end |
| `rebase doctor` | Checks the environment and the database connection — run this before guessing |
| `rebase resources --write` | After declaring a database, bucket or topic in `config/resources.ts`: regenerate `rebase.resources.json` and commit it (`pnpm build` does this too) |
| `pnpm deploy` | Deploys this project. Never run it; see below |

## Never

- **Never deploy.** `pnpm deploy`, `rebase cloud deploy`, `firebase deploy`, `gcloud run deploy` — print the command and let the human run it, even when the task list ends in "deploy" and the tests are green.
- **Never edit `.env`.** It holds generated secrets and the connection string. Add a variable by asking, and document it in `.env.example`.
- **Never edit `rebase.resources.json`.** It is generated from `config/resources.ts` — declare there, then `rebase resources --write`.
- **Never pass `--allow-destructive`** to anything pointed at a database that is not the local development one. It drops columns and tables.
- **Never read or write application rows with raw SQL or Drizzle from code.** The schema is SQL here; the data is not. That path skips validation, hooks and row-level security.

## Core rules

1. **The database is the schema.** Change it with SQL — `rebase db url` gives `psql` the connection string — or with migration files, then restart `pnpm dev`: the server reads the tables at boot. Do not create `config/collections/` to describe a table; a project with collection files serves those instead of reading the database, which is a different project (`README.md`, "Adding an admin UI later").
2. **A table is served only with row-level security enabled.** Until then the server skips it and logs why — deliberately, so a table is never exposed just by existing — and with RLS on but no policy it is served and returns no rows. The policy *is* the authorization model: write the rule that says whose row it is, using the `rebase` schema's SQL functions `uid()`, `roles()` and `jwt()`, never a policy that admits everyone just to make rows appear.
3. **Storage is not under row-level security.** `config/storage.ts` exports `storageAuthorize`, the whole access model for files, and a production deployment with file storage enabled refuses to boot without one. Change the rule there to match your application; do not delete it.
4. **Use the SDK**: server-side that is `rebase.dataAsAdmin.<table>` for work done as the service identity, or `getDriver(c)` inside a function when the read should run as the caller. The server client has no plain `data` accessor — it is omitted precisely so that the choice of identity is written down.
5. **Guard every custom route**: routes in `backend/functions/` are mounted **without** an auth requirement — webhook receivers need that — so each one is public until you guard it. Import `requireAuth` / `requireAdmin` from `@rebasepro/server/functions` and pass them in the route's own middleware slot (`app.post("/", requireAuth, handler)`), not via `app.use()`, which only covers routes declared below it. Reading `getUser(c)` is not a guard: an anonymous caller gets `undefined` and the handler still runs. See `backend/functions/hello.ts` for all three tiers.
6. **In `backend/functions/`, always import from `@rebasepro/server/functions`** — never from `@rebasepro/server`. Both work today; the subpath is the portable one, and it also gives you the typed context accessors (`getUser`, `getDriver`, `requireDriver`) instead of casting `c.get("user")`. The package root is for a server entrypoint, not for route handlers.
7. **Never read `process.env` at the top of a function file.** A module-scope read that comes back undefined throws at import time, and the loader reports that as a *skipped function* — the route simply 404s with no error attached to it. Read configuration inside the handler with `requireEnv(c, "NAME")`, or build a client once with `lazyResource(env => new Client(env.KEY))`.
8. **Work that outlives the response goes in `waitUntil(c, promise)`**, not a floating promise. A floating promise is dropped when the process shuts down mid-deploy; `waitUntil` is what a graceful shutdown waits for.
