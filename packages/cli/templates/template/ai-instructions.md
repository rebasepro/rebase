# Rebase AI Coding Rules

`.mcp.json` in this directory wires the Rebase MCP server up already — no login, no token: it reads `.rebase/state.json` while `pnpm dev` is running. For the full skills (collections, auth, RLS, deployment, the UI kit), run `pnpm skills:install`, or `rebase skills install --agent <claude|cursor|windsurf|gemini|codex|kiro|copilot>` to pick one.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Backend, frontend and the managed development database, together |
| `pnpm schema:generate` then `pnpm generate:sdk` | The same loop with `pnpm dev` not running: collections → Drizzle schema and SDK types. The next boot creates what is missing |
| `pnpm db:push` | The changes boot leaves alone (a rename, a narrowed type, a removed field), on the managed development database as on your own PostgreSQL |
| `pnpm db:generate` then `pnpm db:migrate` | The production path — write the migration file, then apply it |
| `pnpm schema:introspect` | The other direction: existing tables → collection definitions |
| `pnpm generate:sdk` | Regenerate the typed client in `generated/sdk/` from the collections. `pnpm dev` already does this on start and on every save; the script is for CI and for when `pnpm dev` is not running |
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

1. **Schema-as-code**: define and edit collections in `config/collections/` with `defineCollection` from `@rebasepro/cms-types`, one collection per file, default-exported. Every file in that directory is loaded — by the backend, the admin panel and the SDK generator — whether or not `index.ts` lists it: the barrel is a sort order for the admin navigation (and holds `defaultSecurityRules`), not a registry. To remove a collection, delete its file. Never hand-edit generated schemas or Postgres tables.
2. **Applying a collection change**: while `pnpm dev` is running, saving a file in `config/collections/` is the whole step — it regenerates `backend/src/schema.generated.ts` and the SDK types in `generated/sdk/`, restarts the backend, and boot creates the tables and columns that are missing. With `pnpm dev` stopped, that is `pnpm schema:generate` and `pnpm generate:sdk`. `pnpm db:push` is only for what boot deliberately leaves alone — a renamed column, a narrowed type, a removed field — on the managed development database as on your own PostgreSQL. In production the pair is `pnpm db:generate` then `pnpm db:migrate`.
3. **Use the SDK**: server-side that is `rebase.dataAsAdmin.<slug>` for work done as the service identity, or `getDriver(c)` inside a function when the read should run as the caller. The server client has no plain `data` accessor — it is omitted precisely so that the choice of identity is written down.
4. **Guard every custom route**: routes in `backend/functions/` are mounted **without** an auth requirement — webhook receivers need that — so each one is public until you guard it. Import `requireAuth` / `requireAdmin` from `@rebasepro/server/functions` and pass them in the route's own middleware slot (`app.post("/", requireAuth, handler)`), not via `app.use()`, which only covers routes declared below it. Reading `getUser(c)` is not a guard: an anonymous caller gets `undefined` and the handler still runs. See `backend/functions/hello.ts` for all three tiers.
5. **In `backend/functions/`, always import from `@rebasepro/server/functions`** — never from `@rebasepro/server`. Both work today; the subpath is the portable one, and it also gives you the typed context accessors (`getUser`, `getDriver`, `requireDriver`) instead of casting `c.get("user")`. The package root is for a server entrypoint, not for route handlers.
6. **Never read `process.env` at the top of a function file.** A module-scope read that comes back undefined throws at import time, and the loader reports that as a *skipped function* — the route simply 404s with no error attached to it. Read configuration inside the handler with `requireEnv(c, "NAME")`, or build a client once with `lazyResource(env => new Client(env.KEY))`.
7. **Work that outlives the response goes in `waitUntil(c, promise)`**, not a floating promise. A floating promise is dropped when the process shuts down mid-deploy; `waitUntil` is what a graceful shutdown waits for.

## Backend runtime (`runtime: "managed"` on Rebase Cloud)

`rebase.json` declares the backend as `runtime: "managed"`: Rebase Cloud runs this bundle on its own image, and nothing about that image can be changed. Plan backend features against these limits, from [Managed backend runtime](https://rebase.pro/docs/deployment/managed-runtime/). Where that page marks something **not settled**, say so instead of guessing.

- **Node 22 on Debian slim, `linux`/`x64`; pure-JavaScript packages only.** A native module (`sharp`, `canvas`, `bcrypt`, anything with a `.node` binary) makes `rebase cloud deploy` refuse the bundle. Install scripts never run, and the image has no `ffmpeg`, Python or compiler. For work that needs one, call a hosted API, or ask the human about `runtime: "custom"`.
- **Memory and disk belong to one instance, until the next deploy.** A module-level `new Map()` cache survives between requests on one instance, but is not shared between instances and is lost on every deploy and restart. `/tmp` is writable, with the same limits. Keep anything worth keeping in the database or in storage.
- **Requests:** a function times out after 30 seconds (`504 FUNCTION_TIMEOUT`, `REBASE_FUNCTIONS_TIMEOUT_MS`), and a request body over 10 MiB gets a `413` (`REBASE_MAX_BODY_SIZE`). Pass `getSignal(c)` to `fetch`. Put longer work in a job or in `waitUntil`.
- **Outbound network:** HTTP and HTTPS (ports 80 and 443) to anywhere, plus 465, 587 and 993 for mail. Every other port is blocked, so a database or Redis outside Rebase Cloud cannot be reached.
- **Configuration:** the human sets variables with `rebase cloud env set NAME=value` (`--secret` makes a value write-only). A change applies at the next deploy. Read variables inside the handler, with `requireEnv(c, "NAME")`.
- **Generated files** (audio, images, exports) go to storage: `rebase.storage.putObject({ file, key })`. A key under `public/` is served to anyone at `/api/storage/file/<key>`. Any other key needs a download token. The project needs `rebase cloud storage create` once, plus a `storageAuthorize` hook that allows the write.

## Admin UI — only when you build it

These rules apply to views inside the Rebase admin panel: custom views, home pages, dashboards and entity tabs. A public site or a static app this project serves (an `apps` entry with `"type": "static"`) is not the admin panel. Style it the way that app is already styled. It does not need `@rebasepro/ui`.

- **Build admin UI from the kit, never from scratch**: every one of those views is composed from `@rebasepro/ui` components (`Card`, `Typography`, `Button`, `Chip`, `Alert`, …) and the theme's tokens. Backgrounds and borders take a surface by role — `bg-surface-frame`, `bg-surface-sheet`, `bg-surface-card`, `bg-surface-raised`, `bg-surface-field`, `bg-surface-well`, `border-hairline` — and those switch with the theme on their own, so they need no `dark:` pair; text takes `<Typography>` or `text-text-primary dark:text-text-primary-dark`. Do **not** invent a palette, a type scale, or hand-written CSS: a hardcoded colour like `#111` is invisible in one of the two themes and nothing will catch it. The roles and their reasoning are in `@rebasepro/ui/theme.css` in your `node_modules`; the live reference is `import { UIReferenceView } from "@rebasepro/app/debug"` — mount it on a route and look before building a view. See [Styling Custom UI](https://rebase.pro/docs/frontend/styling).
- **Set `admin.span` on every property you write, from what it holds.** The admin form puts every field at full width unless the property says otherwise, pairing only two neighbouring fields with the same small editor (two numbers, two switches, two dates, two short selects); it never pairs free text and never looks at the title. Pair two short values that belong together (`2` + `2`: start / end date, provider / region; `1` for numbers, booleans and short codes beside their siblings), keep anything that reads long at `4` (names, URLs, emails, ids, descriptions, markdown, files), make each row add up to 4, and declare pairs next to each other. See the `rebase-collections` skill, "Form layout".
