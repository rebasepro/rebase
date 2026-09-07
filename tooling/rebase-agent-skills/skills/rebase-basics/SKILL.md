---
name: rebase-basics
description: Core principles, workflow, and maintenance for using Rebase. Use this for all Rebase CLI tasks, project setup, MCP server usage, and general development. Make sure to ALWAYS use this skill whenever you are trying to use Rebase, even if not explicitly asked.
---

# Prerequisites

Please complete these setup steps before proceeding, and remember your progress to avoid repeating them in future interactions.

1. **Local Environment Setup:** Verify the environment is properly set up:
   - Run `node --version`. A scaffolded project declares `node >= 22.22.0`, which is
     what `.nvmrc` pins; an older runtime fails at install, not at run time.
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

1. **Use pnpm exclusively:** Rebase uses pnpm as its package manager. Never use `npm` or `yarn`. All commands should use `pnpm run`, `pnpm install`, `pnpm add`, etc.

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
     junction-table RLS on many-to-many relations, and any change that is not
     purely additive — a renamed column, a narrowed type, a removed field. Those
     need `db push` or a migration, which means they need a `DATABASE_URL`.

5. **Use Rebase MCP Server tools when available:** For data operations, user management, and collection browsing, prefer the MCP tools (`list_documents`, `get_document`, `create_document`, etc.) over writing manual API calls.

6. **Respect the monorepo structure:** See the [Package Reference](#package-reference) section below for the full list of packages and when to use each.

7. **Never deploy unless explicitly asked:** Agents should never run `rebase cloud deploy`, `firebase deploy`, `gcloud deploy`, or any command that pushes code to live infrastructure unless the user explicitly asks you to deploy in the current conversation. Provide the exact command and let the user run it themselves if they prefer.

8. **Scripting and Data Tasks:** Default to using the Rebase SDK (`@rebasepro/client` or `@rebasepro/server`) to write scripts or tasks for manipulating data. For standalone scripts running locally, you can dynamically read the active backend URL from the `.rebase-dev-url` temp file automatically created by the dev server. For internal server-side backend tasks, use the global `import { rebase } from "@rebasepro/server"` singleton. For calling custom backend functions from the frontend, use `client.functions.invoke('name', payload)` — NEVER manually construct `/api/functions/` URLs or extract auth tokens from `localStorage`. NEVER default to using raw `psql` queries or raw REST API calls (`fetch`/`curl`) unless explicitly instructed or the SDK lacks the functionality.

# Recipes

The things you will be asked to do most, end to end. Everything below this
section is background; this is the actual sequence.

**Add a collection**

1. Write `config/collections/<slug>.ts`, default-exporting a `defineCollection`
   call from `@rebasepro/cms-types`.
2. Add it to the `collections` array in `config/collections/index.ts`. A file
   that is not in that array does not exist — `rebase generate-sdk`,
   `rebase build` and the runtime all read the barrel, never the directory
   listing, so a collection left out of it fails silently rather than loudly.
3. `rebase schema generate` — collections become
   `backend/src/schema.generated.ts`. `rebase dev` does this for you on every
   restart, so on a running dev server the step is a way to see the file now.
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
   that — and `app.use()` written after a route never covers it.
3. Read configuration inside the handler with `requireEnv(c, "NAME")`. A
   `process.env` read at module scope throws at import time, and the loader
   reports that as a skipped function: the route just 404s.

**Add an RLS rule**

Rules live on the collection in `securityRules` and become Postgres policies
at boot on the managed database, or when `rebase db push` (or a migration) runs
against your own. Declaring one is not applying it — the rule takes effect on
the next start, not on the next save. The one exception boot leaves alone is a
junction table's RLS on a many-to-many relation; that needs `db push`.

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
│   │   └── index.ts      # Barrel export of all collections
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
> and taking everything else from the environment. `initializeRebaseBackend()` is
> called by the runtime, not by the project. Run `rebase eject` if you want to own
> the entry point — that is what writes `backend/src/index.ts` and `backend/src/env.ts`.

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

# Reference files

Read these when you need them, not before.

- **`references/monorepo.md`** — the framework's own layout and what each `@rebasepro/*` package is for
- **`references/cli-commands.md`** — every command, subcommand and flag, with examples
- **`references/environment.md`** — `loadEnv()`, the validated schema, production checks, generated dev secrets
- **`references/backend-configuration.md`** — `initializeRebaseBackend()` and the full `RebaseBackendConfig` interface
- **`references/singleton.md`** — what the server-side singleton exposes, and how to mock it in tests
- **`references/mcp-tools.md`** — the tools an assistant gets over a project, by group

# Common Issues

### Database & Connection

- **`DATABASE_URL is not set`:** Usually the wrong diagnosis. A scaffolded project has no `DATABASE_URL` on purpose — `rebase dev` starts the managed PostgreSQL (PGlite) under `.rebase/`. Run `rebase db url` to see which database is in use, and start `rebase dev` if nothing is running. Only set `DATABASE_URL` when the user asked for their own Postgres.
- **`rebase db push does not work on the managed development database`:** Correct, and not a fault. `db push` plans with Atlas, which needs a second empty database; the managed one serves exactly one. Boot applies the schema additively instead. Set `DATABASE_URL` to your own Postgres if you need push or migrations.
- **`DATABASE_URL must be a valid URL`:** The value must be a proper PostgreSQL URL including protocol (`postgresql://`). Check for missing or malformed values.
- **Connection refused on port 5432:** Only relevant with your own database. PostgreSQL is not running — start it with `docker compose up -d db` or verify your local Postgres service. The managed database has no port to conflict with.
- **`CORS_ORIGINS or FRONTEND_URL must be set in production`:** In `NODE_ENV=production`, set `CORS_ORIGINS=https://yourapp.com` or `FRONTEND_URL=https://yourapp.com` in `.env`.
- **Localhost URL blocked in production:** `loadEnv()` rejects localhost/loopback URLs in production. Set `ALLOW_LOCALHOST_IN_PRODUCTION=true` to override (not recommended).

### JWT & Authentication

- **`JWT_SECRET must be at least 32 characters long`:** Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set it in `.env`.
- **`JWT_SECRET must be explicitly set in production`:** Auto-generated dev secrets are blocked in production. Set the value explicitly in `.env`.
- **Tokens invalidated on restart:** In development, `JWT_SECRET` is auto-generated ephemerally. Set it explicitly in `.env` for persistent sessions across restarts.
- **`REBASE_SERVICE_KEY is too short`:** Must be ≥32 characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.

### Port Conflicts

- **Port already in use:** `rebase dev` auto-selects a unique port per project (3001–3999). If a conflict occurs, use `--port <number>` to specify an explicit port: `rebase dev --port 3010`.
- **Frontend connecting to wrong backend:** Delete `.rebase-dev-port` to reset port affinity, then restart with `rebase dev`.

### Schema Drift

- **Schema out of sync:** Run `rebase doctor` to detect three-way drift between collections, generated Drizzle schema, and the live database.
- **`schema.generated.ts` is stale:** Run `rebase schema generate` to regenerate it from your collection definitions.
- **Migrations pending:** Run `rebase db migrate` to apply outstanding migration files.
- **Column type mismatch after manual DB edit:** Never edit the database manually. Always modify collection files → restart `rebase dev` (managed database) or `rebase schema generate` → `rebase db push` (your own, dev) or `rebase db generate && rebase db migrate` (prod).

### CLI & Tooling

- **pnpm not found:** Install with `npm install -g pnpm`.
- **Node.js version mismatch:** a scaffolded project declares `node >= 22.22.0`, which is what `.nvmrc` pins. Use `nvm install 22.22.0 && nvm use 22.22.0`.
- **`Could not find tsx binary`:** Install tsx in your project: `pnpm add -D tsx`.
- **`Could not detect an active database plugin`:** Ensure `@rebasepro/server-postgres` (or another driver) is listed in `backend/package.json` dependencies.
- **`No bootstrappers or database adapter provided`:** The `initializeRebaseBackend()` call is missing the `database` (or `bootstrappers`) property. See the backend configuration section above.
- **`Could not find CLI entry point for <plugin>`:** The database driver plugin's CLI script is missing or not found. Reinstall the plugin: `pnpm add @rebasepro/server-postgres`.

### Singleton Errors

- **`rebase.<prop>: server not initialized yet`:** You are accessing the `rebase` singleton at module import time or before `initializeRebaseBackend()` has completed. Move the access inside a handler, hook, or function body.
- **`Cannot set rebase.<prop> directly`:** The singleton is read-only. You cannot assign properties to it.
- **`_setRebaseMock can only be called in a test environment`:** Set `NODE_ENV=test` before calling `_setRebaseMock()`.

### Storage

- **`Storage backend "default" uses local filesystem in production`:** A warning is emitted when using `type: "local"` with `NODE_ENV=production`. Files will be lost on container restart. Configure S3-compatible storage or a custom `StorageController`.
- **`File too large`:** The storage upload endpoint has its own body limit (default 50 MB), separate from the global `maxBodySize` (default 10 MB). Configure `maxFileSize` in your storage config to increase it.

# References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
