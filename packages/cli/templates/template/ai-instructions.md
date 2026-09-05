# Rebase AI Coding Rules

`.mcp.json` in this directory wires the Rebase MCP server up already — no login, no token: it reads `.rebase/state.json` while `pnpm dev` is running. For the full skills (collections, auth, RLS, deployment, the UI kit), run `pnpm skills:install`, or `rebase skills install --agent <claude|cursor|windsurf|gemini>` to pick one.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Backend, frontend and the managed development database, together |
| `pnpm schema:generate` then `pnpm db:push` | The same loop with `pnpm dev` not running, plus the changes boot leaves alone: collections → Drizzle schema → development database |
| `pnpm db:generate` then `pnpm db:migrate` | The production path — write the migration file, then apply it |
| `pnpm schema:introspect` | The other direction: existing tables → collection definitions |
| `pnpm generate:sdk` | Regenerate the typed client from the collections |
| `pnpm build` then `pnpm start` | Build the deployable bundle, then run it |
| `pnpm skills:install` | Install the Rebase skills for your assistant |
| `pnpm example` | Run `scripts/example.ts` against the running backend — the SDK, end to end |
| `rebase doctor` | What disagrees between collections, generated schema and the live database — run this before guessing |
| `rebase resources --write` | After declaring a database, bucket or topic in `config/resources.ts`: regenerate `rebase.resources.json` and commit it (`pnpm build` does this too) |
| `pnpm deploy` | Deploys this project. Never run it; see below |

## Never

- **Never deploy.** `pnpm deploy`, `rebase cloud deploy`, `firebase deploy`, `gcloud run deploy` — print the command and let the human run it, even when the task list ends in "deploy" and the tests are green.
- **Never edit `.env`.** It holds generated secrets and the connection string. Add a variable by asking, and document it in `.env.example`.
- **Never edit `backend/src/schema.generated.ts`.** It is overwritten by `pnpm schema:generate`; the collection file is the source.
- **Never edit `rebase.resources.json`.** It is generated from `config/resources.ts` — declare there, then `rebase resources --write`.
- **Never pass `--allow-destructive`** to anything pointed at a database that is not the local development one. It drops columns and tables.
- **Never write raw SQL or Drizzle queries against application tables.** That path skips validation, hooks and row-level security.

## Core rules

1. **Schema-as-code**: define and edit collections in `config/collections/` with `defineCollection` from `@rebasepro/cms-types`, and register each one in that directory's `index.ts` — a collection missing from the barrel does not exist. Never hand-edit generated schemas or Postgres tables.
2. **Applying a collection change**: while `pnpm dev` is running, saving a file in `config/collections/` is the whole step — it regenerates `backend/src/schema.generated.ts`, restarts the backend, and boot creates the tables and columns that are missing. With `pnpm dev` stopped, that is `pnpm schema:generate`. `pnpm db:push` is only for what boot deliberately leaves alone — a renamed column, a narrowed type, a removed field, junction-table RLS — and it needs your own PostgreSQL, not the managed development database. In production the pair is `pnpm db:generate` then `pnpm db:migrate`.
3. **Use the SDK**: server-side that is `rebase.dataAsAdmin.<slug>` for work done as the service identity, or `getDriver(c)` inside a function when the read should run as the caller. The server client has no plain `data` accessor — it is omitted precisely so that the choice of identity is written down.
4. **Guard every custom route**: routes in `backend/functions/` are mounted **without** an auth requirement — webhook receivers need that — so each one is public until you guard it. Import `requireAuth` / `requireAdmin` from `@rebasepro/server/functions` and pass them in the route's own middleware slot (`app.post("/", requireAuth, handler)`), not via `app.use()`, which only covers routes declared below it. Reading `getUser(c)` is not a guard: an anonymous caller gets `undefined` and the handler still runs. See `backend/functions/hello.ts` for all three tiers.
5. **In `backend/functions/`, always import from `@rebasepro/server/functions`** — never from `@rebasepro/server`. Both work today; the subpath is the portable one, and it also gives you the typed context accessors (`getUser`, `getDriver`, `requireDriver`) instead of casting `c.get("user")`. The package root is for a server entrypoint, not for route handlers.
6. **Never read `process.env` at the top of a function file.** A module-scope read that comes back undefined throws at import time, and the loader reports that as a *skipped function* — the route simply 404s with no error attached to it. Read configuration inside the handler with `requireEnv(c, "NAME")`, or build a client once with `lazyResource(env => new Client(env.KEY))`.
7. **Work that outlives the response goes in `waitUntil(c, promise)`**, not a floating promise. A floating promise is dropped when the process shuts down mid-deploy; `waitUntil` is what a graceful shutdown waits for.
8. **Build UI from the kit, never from scratch**: any custom view, home page, dashboard or entity tab must be composed from `@rebasepro/ui` components (`Card`, `Typography`, `Button`, `Chip`, `Alert`, …) and the theme's colour tokens (`text-surface-*`, `bg-surface-accent-*`, `text-primary`), with a `dark:` value beside every light one. Do **not** invent a palette, a type scale, or hand-written CSS: a hardcoded colour like `#111` is invisible in one of the two themes and nothing will catch it. The live reference ships in your `node_modules` — read `@rebasepro/app/src/components/Debug/UIReferenceView.tsx` before building a view, and see [Styling Custom UI](https://rebase.pro/docs/frontend/styling).
