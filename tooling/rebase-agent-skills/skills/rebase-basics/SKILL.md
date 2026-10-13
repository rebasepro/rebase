---
name: rebase-basics
description: Core principles, workflow, and maintenance for using Rebase. Use this for all Rebase CLI tasks, project setup, MCP server usage, and general development. Make sure to ALWAYS use this skill whenever you are trying to use Rebase, even if not explicitly asked.
---

# Prerequisites

Please complete these setup steps before proceeding, and remember your progress to avoid repeating them in future interactions.

1. **Local Environment Setup:** Verify the environment is properly set up:
   - Run `node --version`. A scaffolded project declares `node >= 22.22.0` in its
     `package.json` `engines`; an older runtime fails at install, not at run time.
   - Run `pnpm --version` to check pnpm is installed. If not, install it: `npm install -g pnpm`.
   - **Do not check for PostgreSQL.** With `DATABASE_URL` unset — which is how
     `rebase init` leaves `.env` — `rebase dev` starts a **managed PostgreSQL
     (PGlite)** for the project, with its data under `.rebase/`. Nothing to
     install, no container, no connection string. `rebase db url` prints
     whichever database is in use.
   - If Node or pnpm is missing, use the `rebase-local-env-setup` skill to get
     the environment ready.

2. **MCP server access:** The MCP server needs a running `rebase dev`, or a
   `REBASE_SERVICE_KEY` in the project's `.env`. Nothing else — there is no
   login step, and the server never talks to Rebase Cloud.
   - `rebase dev` writes `.rebase/state.json`, and the MCP server reads the
     backend URL and service key straight out of it. That is the zero-config
     path.
   - Without a dev server, the server reads `REBASE_SERVICE_KEY` from
     `.env` or `app/.env` under `REBASE_PROJECT_DIR`.
   - Call `rebase_project_current` to see which project, URL and credential the
     tools are actually using.

3. **Project context:** Most Rebase tasks need a project directory.
   - `REBASE_PROJECT_DIR` in the MCP client's config should be the directory
     containing `rebase.json`; without it the server uses its working directory.
   - The CLI tools (`rebase_db_push`, `rebase_doctor`, the branch tools) connect
     with `DATABASE_URL` and never see the API token. On the managed database
     there is no `DATABASE_URL` to set and none is needed — do not invent one to
     make a tool run.

# Rebase Usage Principles

Please adhere to these principles when working with Rebase, as they ensure reliability and consistency:

1. **Use the project's package manager:** `rebase init` scaffolds a pnpm workspace, or an npm one when pnpm is not available or the developer chose npm. Look for the lockfile (`pnpm-lock.yaml` or `package-lock.json`) and use that manager for every command: `pnpm add` / `npm install`, and `pnpm run <script>` / `npm run <script>`. Never mix the two in one project.

2. **Never convert to `any`:** TypeScript strictness is critical. Never use `as any` type assertions. Use proper typing, `unknown`, or explicit type narrowing instead.

3. **Follow the Schema-as-Code approach:** Schemas are defined as standalone TypeScript files. The visual Studio generates TypeScript via AST manipulation — it does NOT run raw SQL. Always define collections in code first.

4. **Know which schema loop this project is on:**
   - `rebase schema generate` — converts collection definitions to Drizzle ORM schema.
   - **On the managed database (the default), boot applies it.** `rebase dev`
     generates the schema and creates the missing tables additively at every
     start; there is no push step, and `rebase db push` refuses — it plans with
     Atlas, which needs a second empty database to compare against.
   - **With your own `DATABASE_URL`:** `rebase db push` (development) or
     `rebase db generate && rebase db migrate` (production).
   - What boot's additive apply deliberately leaves alone, on either database:
     any change that is not purely additive — a renamed column, a narrowed
     type, a removed field. Those
     need `db push` or a migration, which means they need a `DATABASE_URL`.

5. **Use Rebase MCP Server tools when available:** For data operations, user management, and collection browsing, prefer the MCP tools (`list_documents`, `get_document`, `create_document`, etc.) over writing manual API calls.

6. **Respect the monorepo structure:** See `references/monorepo.md` for the full list of packages and when to use each.

7. **Never deploy unless explicitly asked:** Agents should never run `rebase cloud deploy`, `firebase deploy`, `gcloud deploy`, or any command that pushes code to live infrastructure unless the user explicitly asks you to deploy in the current conversation. Provide the exact command and let the user run it themselves if they prefer.

8. **Scripting and Data Tasks:** Default to using the Rebase SDK (`@rebasepro/client` or `@rebasepro/server`) to write scripts or tasks for manipulating data. For standalone scripts running locally, you can dynamically read the active backend URL from the `.rebase-dev-url` temp file automatically created by the dev server. For internal server-side backend tasks, use the global `import { rebase } from "@rebasepro/server"` singleton. To read or change the project's data from a script or a terminal with no server running, use `openRebase` from `@rebasepro/server-postgres` or `rebase console` (0.25+; see *Exploring data from a script* below). For calling custom backend functions from the frontend, use `client.functions.invoke('name', payload)` — NEVER manually construct `/api/functions/` URLs or extract auth tokens from `localStorage`. NEVER default to using raw `psql` queries or raw REST API calls (`fetch`/`curl`) unless explicitly instructed or the SDK lacks the functionality.

# Recipes

The things you will be asked to do most, end to end. Everything below this
section is background; this is the actual sequence.

**Add a collection**

1. Write `config/collections/<slug>.ts`, default-exporting a `defineCollection`
   call from `@rebasepro/cms-types`.
2. Add it to the `collections` array in `config/collections/index.ts` — for
   its place in the admin navigation. The barrel is a sort order, not a
   registry: the runtime, the admin panel, `rebase build`, `rebase schema
   generate` and `rebase generate-sdk` all load every collection file in the
   directory, listed or not. Leaving a file out of the array does not disable
   it; to remove a collection, delete its file.
3. `rebase schema generate` — collections become
   `backend/src/schema.generated.ts`. `rebase dev` does this for you on start
   and on every save under `config/collections/`, together with the SDK types in
   `generated/sdk/`, so on a running dev server the step is a way to see the
   file now.
4. **On the managed database: nothing.** Boot creates the new table. Restart
   `rebase dev` (or let it restart itself) and the collection is there.
   With your own `DATABASE_URL`: `rebase db push` in development, or
   `rebase db generate && rebase db migrate` for production.

**Add a backend function**

1. Write `backend/functions/<name>.ts`, default-exporting a Hono app. It is
   served at `/api/functions/<name>` and called with
   `client.functions.invoke("<name>", payload)`.
2. Import `requireAuth` / `requireAdmin` from `@rebasepro/server/functions` and
   pass them in the route's own middleware slot: `app.post("/", requireAuth,
   handler)`. A function is **public until you do** — webhook receivers need
   that — and `app.use()` written after a route never covers it. For an action
   a narrower role or an API key should reach, declare a scope under
   `auth.scopes` on the users collection and guard with `requireScope` instead
   of `requireAdmin` (see `rebase-custom-functions`).
3. Read configuration inside the handler with `requireEnv(c, "NAME")`. A
   `process.env` read at module scope throws at import time, and the loader
   reports that as a skipped function: the route just 404s.

**Add an RLS rule**

Rules live on the collection in `securityRules` and become Postgres policies
at boot on the managed database, or when `rebase db push` (or a migration) runs
against your own. Declaring one is not applying it — the rule takes effect on
the next start, not on the next save — junction tables of many-to-many
relations included.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
import { policy } from "@rebasepro/types";

export default defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    securityRules: [
        // Owner-only, the short form.
        { operations: ["select", "update", "delete"], ownerField: "author_id" },
        // A StructuredSecurityRule, when the admin UI should also understand it:
        // raw `using` SQL is treated as unknown client-side, this is not.
        {
            operation: "select",
            condition: policy.or(
                policy.compare(policy.field("status"), "eq", policy.literal("published")),
                policy.rolesOverlap(["editor"])
            )
        }
    ],
    properties: { /* … */ }
});
```

**Deploy**

Do not run it. Print the command — `rebase cloud deploy`, or
`rebase build && docker compose up` for a self-hosted project — and let the
person you are working with run it.

# Project Structure

## Scaffolded Project Structure (CLI)

When you initialize a Rebase project via the CLI (`rebase init`), the generated project structure contains:

```
<project-root>/
├── frontend/             # React frontend (Vite)
├── backend/
│   ├── functions/        # Custom backend functions (one file per function)
│   └── src/
│       └── schema.generated.ts  # Auto-generated Drizzle schema — never edit
├── config/               # Shared between frontend and backend
│   ├── index.ts          # Exports `collections` and `storageAuthorize`
│   ├── collections/      # TypeScript collection files (one per collection)
│   │   └── index.ts      # Sort order + defaultSecurityRules (not a registry)
│   └── storage.ts        # `storageAuthorize` — who may read/write which keys
├── scripts/              # Standalone SDK scripts
├── rebase.json           # Which apps this project deploys, and how
├── .rebase/              # Dev-server state, and the managed database's data
├── .env                  # Environment variables (generated from .env.example)
├── .env.example          # Template with placeholder secrets
├── docker-compose.yml    # Optional PostgreSQL container — `rebase dev --docker`
├── pnpm-workspace.yaml   # pnpm workspace definition
└── package.json          # Root workspace package.json
```

> **There is no `backend/src/index.ts`.** A scaffolded project has no hand-written
> server entry point: `rebase dev`, `rebase start` and the published image all boot
> from the bundle, reading `config/index.ts` for collections and `storageAuthorize`
> and taking everything else from the environment. The runtime builds and starts
> the backend, not the project. Run `rebase eject` if you want to own the entry
> point — that is what writes `backend/src/index.ts` (an `initializeRebaseBackend()`
> call) and `backend/src/env.ts`.

### Key Files

| File | Purpose |
|------|---------|
| `.env` | Environment variables — secrets, DATABASE_URL, JWT_SECRET |
| `config/collections/*.ts` | Collection definitions (schema-as-code) |
| `config/index.ts` | Exports `collections` and `storageAuthorize` — what the runtime boots from |
| `config/storage.ts` | `storageAuthorize`: who may read, write, delete and list which keys |
| `backend/functions/*.ts` | Custom backend functions, served at `/api/functions/<name>` |
| `rebase.json` | Declares the project's apps (backend, static frontends) for deployment |
| `backend/src/schema.generated.ts` | Auto-generated by `rebase schema generate` — DO NOT edit manually |
| `.rebase-dev-port` | Written by `rebase dev` — stores the resolved backend port |
| `.rebase-dev-url` | Written by `rebase dev` — stores `http://localhost:<port>` for scripts |

# When you own the server

An ejected project, or Rebase inside a server you already run, calls the backend
itself. Your code calls Rebase, and every shortcut sits one step above public
pieces you can call yourself:

- **`initializeRebaseBackend({ app, server, … })`** — the shortcut: build the
  backend, mount every route group under `/api`, attach the realtime socket,
  start the timers. What `rebase eject` writes.
- **`createRebaseBackend({ …, provision })`** (new in 0.25) — the step under it:
  builds everything, and mounts, starts and listens to nothing. Then
  `backend.mount(app, { basePath })`, `await backend.attachRealtime(server)`,
  `backend.start()`, and `backend.shutdown(timeoutMs, { server })`. Or mount only
  the groups you want, at your own paths:
  `app.route("/hooks", backend.routes.functions())` — `routes.auth()`, `data()`,
  `storage()`, `functions()`, `admin()`, `cron()`, `meta()`. `backend.fetch(request)`
  serves the whole API with no server, and `backend.rebase` is the in-process client.
- **A backend built by hand writes no process global** (0.25+): its JWT keys,
  access model, API keys and limits are in `backend.services`, so two backends
  in one process stay two. `import { rebase }` / `ctx.rebase` resolve to the
  backend serving the request, cron run or job, and elsewhere to the process
  default — `setDefaultBackend(backend)`, which `initializeRebaseBackend` calls
  for you (its other added step is `installUnhandledRejectionHandler()`).
  `backend.verifyCredential(token)` checks a session or `rk_` key against one
  backend.
- **`provision` is required on `createRebaseBackend`:** `true` creates what the
  backend serves (tables, RLS policies, change capture), `false` changes nothing
  in the database (a script, a test, a second process), and
  `{ collections, realtime }` picks. `initializeRebaseBackend` passes `true`.
- **Functions and crons are values** (0.25+): `functions: { "send-invoice": sendInvoice }`
  and `crons: { nightly: defineCron({ … }) }`, or `functions: await loadFunctions(dir)`
  and `crons: await loadCrons(dir)`, which read a directory into that same shape.
  `functionsDir` / `cronsDir` still work; passing both forms of one kind is refused
  at boot.

Every option, the return value, and the composition written out:
`references/backend-configuration.md`.

# Exploring data from a script

To read or fix data from a script — a seed, a check, a question while debugging —
open the project from code (new in 0.25) instead of booting a server or reaching
for `psql`:

```typescript
// backend/scripts/x.ts: the backend workspace is the one that can import the driver.
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const { data: posts } = await rebase.dataAsAdmin.posts.find({ limit: 10 });

// The same data as one user sees it, under row-level security.
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
const { data: hers } = await ada.data.posts.find();

await rebase.sql("SELECT count(*) FROM posts WHERE author_id = $1", { params: ["ada"] });
await rebase.close();
```

- `dataAsAdmin` and `sql` are the accessors a function's `rebase` has, so a
  snippet moves between a function and a script unchanged. They are typed by the
  `Database` that `rebase generate-sdk --register` registers, or per call with
  `openRebase<Database>({ … })`.
- Run it from `backend/` with the URL the project uses:
  `DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/x.ts`.
- Opening changes nothing in the database and reads no environment variable.
  `withAuth` against a database no server has booted on fails rather than run
  unfiltered.
- A write to a `history: true` collection records its history entry the way a
  server write does: in the write's transaction, as whoever the write ran as.
  On a database with no history table (no backend with history has booted on
  it), those writes are refused with `HISTORY_UNAVAILABLE`. Reads still work.

`rebase console` opens the same object in a Node REPL, with `rebase` and the
project's `collections` in scope and top-level await. It finds the database the
way `rebase db push` does, the managed one included. `rebase console -e "<code>"`
runs one snippet and prints its result as JSON on stdout; every log line goes to
stderr, so stdout pipes:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
```

Input piped into the REPL runs one line at a time, each after the previous
line's `await` has settled.

# Reference files

Read these when you need them, not before.

- **`references/monorepo.md`** — the framework's own layout and what each `@rebasepro/*` package is for
- **`references/cli-commands.md`** — every command, subcommand and flag, with examples
- **`references/environment.md`** — `loadEnv()`, the validated schema, production checks, generated dev secrets
- **`references/backend-configuration.md`** — `initializeRebaseBackend()`, `createRebaseBackend()`, every backend option, and what the backend returns
- **`references/singleton.md`** — what the server-side singleton exposes, and how to mock it in tests
- **`references/mcp-tools.md`** — the tools an assistant gets over a project, by group

# Common Issues

### Database & Connection

- **`DATABASE_URL is not set`:** Usually the wrong diagnosis. A scaffolded project has no `DATABASE_URL` on purpose — `rebase dev` starts the managed PostgreSQL (PGlite) under `.rebase/`. Run `rebase db url` to see which database is in use, and start `rebase dev` if nothing is running. Only set `DATABASE_URL` when the user asked for their own Postgres.
- **`rebase db push` on the managed development database:** It works. `db push`, `db generate` and `db migrate` plan with Atlas, which needs a second empty database; on the managed one (which serves exactly one) the CLI starts a throwaway in-memory PGlite for the command and stops it afterwards. `REBASE_ATLAS_DEV_URL` names an empty database of your own to plan against instead. On 0.24 and earlier these commands refuse the managed database: set `DATABASE_URL` to your own Postgres there. `db branch` stays refused on the managed database; use `rebase dev --docker` for branches.
- **`DATABASE_URL must be a valid URL`:** The value must be a proper PostgreSQL URL including protocol (`postgresql://`). Check for missing or malformed values.
- **Connection refused on port 5432:** Only relevant with your own database. PostgreSQL is not running — start it with `docker compose up -d db` or verify your local Postgres service. The managed database has no port to conflict with.
- **`CORS_ORIGINS or FRONTEND_URL must be set in production`:** In `NODE_ENV=production`, set `CORS_ORIGINS=https://yourapp.com` or `FRONTEND_URL=https://yourapp.com` in `.env`.
- **Localhost URL blocked in production:** `loadEnv()` rejects localhost/loopback URLs in production. Set `ALLOW_LOCALHOST_IN_PRODUCTION=true` to override (not recommended).

### JWT & Authentication

- **`JWT_SECRET must be at least 32 characters long`:** Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set it in `.env`.
- **`JWT_SECRET must be explicitly set in production`:** Auto-generated dev secrets are blocked in production. Set the value explicitly in `.env`.
- **Tokens invalidated on restart:** `rebase init` writes `JWT_SECRET` into `.env`, and outside production a `JWT_SECRET` left unset is generated once and cached in `.rebase-dev-secrets.json`, so sessions survive a restart. They do not only when that file cannot be written (a read-only or containerised working directory); boot then warns that the secrets are ephemeral. Set `JWT_SECRET` in `.env` to fix it.
- **`REBASE_SERVICE_KEY is too short`:** Must be ≥32 characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.

### Port Conflicts

- **Port already in use:** `rebase dev` auto-selects a unique port per project (3001–3999). If a conflict occurs, use `--port <number>` to specify an explicit port: `rebase dev --port 3010`.
- **Frontend connecting to wrong backend:** Delete `.rebase-dev-port` to reset port affinity, then restart with `rebase dev`.

### Schema Drift

- **Schema out of sync:** Run `rebase doctor` to detect three-way drift between collections, generated Drizzle schema, and the live database.
- **`schema.generated.ts` is stale:** Run `rebase schema generate` to regenerate it from your collection definitions.
- **Migrations pending:** Run `rebase db migrate` to apply outstanding migration files.
- **Column type mismatch after manual DB edit:** Never edit the database manually. Always modify collection files → restart `rebase dev`, which adds what is missing, then `rebase db push` for a rename, a narrowed type or a removed field (dev, the managed database included), or `rebase db generate && rebase db migrate` (prod).

### CLI & Tooling

- **pnpm not found:** Install with `npm install -g pnpm`.
- **Node.js version mismatch:** a scaffolded project declares `node >= 22.22.0` in its `package.json` `engines`. Use `nvm install 22.22.0 && nvm use 22.22.0`.
- **`Could not find tsx binary`:** Install tsx in your project: `pnpm add -D tsx`.
- **`Could not detect an active database plugin`:** Ensure `@rebasepro/server-postgres` (or another driver) is listed in `backend/package.json` dependencies.
- **`No bootstrappers or database adapter provided`:** The `initializeRebaseBackend()` (or `createRebaseBackend()`) call is missing the `database` (or `bootstrappers`) property. See `references/backend-configuration.md`.
- **"createRebaseBackend needs `provision`":** Pass `provision: true` to create what the backend serves, or `false` to change nothing in the database.
- **"Both `functions` and `functionsDir` are set"** (or `crons` and `cronsDir`): keep one. `functions: await loadFunctions(dir)` is the same as `functionsDir: dir`.
- **`Could not find CLI entry point for <plugin>`:** The database driver plugin's CLI script is missing or not found. Reinstall the plugin: `pnpm add @rebasepro/server-postgres`.

### Singleton Errors

- **`rebase.<prop>: server not initialized yet`:** You are accessing the `rebase` singleton at module import time, or before `initializeRebaseBackend()` has completed, or outside any request of a backend built with `createRebaseBackend()` that was never made the default (`setDefaultBackend(backend)`, 0.25+). Move the access inside a handler, hook, or function body, or use `backend.rebase`. A standalone script has no backend to wait for: use `openRebase` (see *Exploring data from a script*).
- **`Cannot set rebase.<prop> directly`:** The singleton is read-only. You cannot assign properties to it.
- **`_setRebaseMock can only be called in a test environment`:** Set `NODE_ENV=test` before calling `_setRebaseMock()`.

### Storage

- **`Storage backend "default" uses local filesystem in production`:** A warning is emitted when using `type: "local"` with `NODE_ENV=production`. Files will be lost on container restart. Configure S3-compatible storage or a custom `StorageController`.
- **`File too large`:** The storage upload endpoint has its own body limit (default 50 MB), separate from the global `maxBodySize` (default 10 MB). Configure `maxFileSize` in your storage config to increase it.

# References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
