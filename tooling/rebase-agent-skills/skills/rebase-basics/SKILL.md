---
name: rebase-basics
description: Core principles, workflow, and maintenance for using Rebase. Use this for all Rebase CLI tasks, project setup, MCP server usage, and general development. Make sure to ALWAYS use this skill whenever you are trying to use Rebase, even if not explicitly asked.
---

# Prerequisites

Please complete these setup steps before proceeding, and remember your progress to avoid repeating them in future interactions.

1. **Local Environment Setup:** Verify the environment is properly set up:
   - Run `node --version` to check Node.js is installed (v20+ required).
   - Run `pnpm --version` to check pnpm is installed. If not, install it: `npm install -g pnpm`.
   - Verify PostgreSQL is available: `psql --version` or confirm Docker is running with a Postgres container.
   - If any of these checks fail, use the `rebase-local-env-setup` skill to get the environment ready.

2. **Authentication:**
   Ensure you are logged in to Rebase Cloud for MCP server access. Run `rebase cloud login`. This opens a browser for Google OAuth.
   - Tokens are stored at `~/.rebase/tokens.json` and shared between CLI and MCP server.
   - If the browser fails to open, check the CLI output for a manual URL.

3. **Active Project:**
   Most Rebase tasks require a project context.
   - For Rebase Cloud: Run `rebase cloud login` and select your project via the MCP `list_projects` tool.
   - For self-hosted: Ensure your `.env` file in the project root contains a valid `DATABASE_URL`.

# Rebase Usage Principles

Please adhere to these principles when working with Rebase, as they ensure reliability and consistency:

1. **Use pnpm exclusively:** Rebase uses pnpm as its package manager. Never use `npm` or `yarn`. All commands should use `pnpm run`, `pnpm install`, `pnpm add`, etc.

2. **Never convert to `any`:** TypeScript strictness is critical. Never use `as any` type assertions. Use proper typing, `unknown`, or explicit type narrowing instead.

3. **Follow the Schema-as-Code approach:** Schemas are defined as standalone TypeScript files. The visual Studio generates TypeScript via AST manipulation — it does NOT run raw SQL. Always define collections in code first.

4. **Use the two-step migration workflow:**
   - `rebase schema generate` — converts collection definitions to Drizzle ORM schema
   - `rebase db push` (development) or `rebase db generate && rebase db migrate` (production)

5. **Use Rebase MCP Server tools when available:** For data operations, user management, and collection browsing, prefer the MCP tools (`list_documents`, `get_document`, `create_document`, etc.) over writing manual API calls.

6. **Respect the monorepo structure:** See the [Package Reference](#package-reference) section below for the full list of packages and when to use each.

7. **Never deploy unless explicitly asked:** Agents should never run `rebase cloud deploy`, `firebase deploy`, `gcloud deploy`, or any command that pushes code to live infrastructure unless the user explicitly asks you to deploy in the current conversation. Provide the exact command and let the user run it themselves if they prefer.

8. **Scripting and Data Tasks:** Default to using the Rebase SDK (`@rebasepro/client` or `@rebasepro/server`) to write scripts or tasks for manipulating data. For standalone scripts running locally, you can dynamically read the active backend URL from the `.rebase-dev-url` temp file automatically created by the dev server. For internal server-side backend tasks, use the global `import { rebase } from "@rebasepro/server"` singleton. For calling custom backend functions from the frontend, use `client.functions.invoke('name', payload)` — NEVER manually construct `/api/functions/` URLs or extract auth tokens from `localStorage`. NEVER default to using raw `psql` queries or raw REST API calls (`fetch`/`curl`) unless explicitly instructed or the SDK lacks the functionality.

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
├── .env                  # Environment variables (generated from .env.example)
├── .env.example          # Template with placeholder secrets
├── docker-compose.yml    # PostgreSQL container (when no custom DB provided)
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

## Framework Monorepo Structure

For development of the Rebase framework itself, the repository is organized as a modular monorepo:

```
rebase/
├── app/                      # Example application (scaffolded structure above)
│   ├── frontend/             # React frontend (Vite)
│   ├── backend/              # Hono backend server
│   └── config/               # Application configuration
│       └── collections/      # TypeScript collection files (one per collection)
├── packages/                 # each directory is its package: `@rebasepro/<dir>`
│   ├── types/                # shared kernel — isomorphic, no UI, no node
│   ├── utils/
│   ├── common/
│   ├── client/               # the SDK
│   ├── server/               # BaaS — Hono coordinator. Never imports a UI package
│   ├── server-postgres/      # database driver
│   ├── server-mongo/         # database driver
│   ├── cli/
│   ├── codegen/
│   ├── inference/
│   ├── mcp/
│   ├── ui/                   # CMS — React tier
│   ├── forms/
│   ├── app/                  # the runtime admin/studio/plugins register into
│   ├── admin/
│   ├── firebase/
│   ├── studio/               # Full — BaaS console (admin is an optional peer)
│   ├── plugin-ai/
│   └── plugin-insights/
├── pnpm-workspace.yaml
└── package.json
```

The tiers are adoption modes, not separate products — see `MODULAR-ARCHITECTURE.md`.
A BaaS install is `server` + a driver + `client`, with no React in the tree.

## Package Reference

| Package | Purpose | When to use |
|---------|---------|-------------|
| `@rebasepro/server` | Hono server coordinator, API generation, auth middleware, storage, email, cron, custom functions | Backend entry point — every Rebase backend imports this |
| `@rebasepro/server-postgres` | PostgreSQL bootstrapper and Drizzle ORM data driver | Backend setup when using PostgreSQL |
| `@rebasepro/server-mongo` | MongoDB bootstrapper and data driver | Backend setup when using MongoDB |
| `@rebasepro/app` | The frontend runtime: hooks, providers, context, the auth controller (`useRebaseAuthController`) and `LoginView` | Frontend — React integration, hooks, providers, auth flows |
| `@rebasepro/types` | Shared TypeScript type definitions (`PostgresCollectionConfig`, `CollectionConfig`, `RebaseClient`, etc.) | Type imports across all packages |
| `@rebasepro/ui` | Standalone component library (Tailwind CSS v4 + Radix) | Building custom views in Studio or standalone UI |
| `@rebasepro/cms` | The CMS: `RebaseCMS`, collection views, entity forms, collection editor — built from your collection definitions | The admin panel. Needs collection files |
| `@rebasepro/studio` | The BaaS console: SQL editor, schema visualizer, RLS editor, storage browser, logs, API explorer, API keys, backups, cron | Database tooling. Ships on BaaS with no CMS — `admin` is an optional peer |
| `@rebasepro/client` | Client SDK for consuming the Rebase API | Any client-side or script-side data operations |
| `@rebasepro/firebase` | Firebase client adapter | When connecting to a Firebase backend |
| `@rebasepro/common` | Shared utilities, `defaultUsersCollection` | Shared constants and default collection exports |
| `@rebasepro/forms` | Form engine | Building dynamic forms from collection schemas |
| `@rebasepro/mcp` | AI agent MCP tools | The MCP server that agents use |
| `@rebasepro/codegen` | Typed SDK generation from collection definitions | Used by `rebase generate-sdk` command |
| `@rebasepro/inference` | Auto-infer schema from data / database introspection | Used by `rebase schema introspect` |
| `@rebasepro/plugin-ai` | AI-powered data autofill | Studio plugin for auto-completing fields |
| `@rebasepro/plugin-insights` | Usage and data insights views | Plugin for analytics over your collections |
| `@rebasepro/cli` | CLI tool | The `rebase` CLI binary |
| `@rebasepro/utils` | Utility functions | Low-level shared helpers |

# CLI Commands

## Global Options

| Option | Description |
|--------|-------------|
| `--version`, `-v` | Show CLI version number |
| `--help`, `-h` | Show help message |

## Full Command Reference

### Project Lifecycle

| Command | Description |
|---------|-------------|
| `rebase init [name]` | Scaffold a new Rebase project interactively |
| `rebase dev` | Start development server (backend + frontend concurrently) |
| `rebase build` | Build all workspace packages for production |
| `rebase start` | Start the backend server in production mode |

### `rebase init` Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--headless` | — | Backend only: no admin panel, no collections. Prompts when omitted |
| `--template` | `-t` | Starter template to scaffold from |
| `--git` | `-g` | Initialize a git repository |
| `--install` | `-i` | Install dependencies with the detected PM |
| `--database-url` | — | PostgreSQL connection string (skip prompt) |
| `--introspect` | — | Auto-introspect the database after init |
| `--yes` | `-y` | Non-interactive mode (use all defaults) |

#### What gets scaffolded

```bash
rebase init my-api   --headless   # backend/ alone — REST, auth, storage, realtime, backups. No collections, no UI, no React
rebase init my-app                # config/ + backend/ + frontend/ — the backend plus the admin panel (default)
```

`--headless` introspects the collections from the database at boot rather than reading
config files, so there is nothing to declare and nothing to keep in sync. It
serves only tables with `ENABLE ROW LEVEL SECURITY` — a table without RLS has no
authorization model, so serving it would hand every row to every logged-in user.

`dev`, `build` and `start` detect a missing `frontend/` and run backend-only.

```bash
# Interactive mode
rebase init my-app

# Non-interactive — scaffold with a remote database and introspect it
rebase init my-app --yes --database-url "postgresql://user:pass@host:5432/db" --introspect --install
```

### `rebase dev` Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--backend-only` | `-b` | Only start the backend server |
| `--frontend-only` | `-f` | Only start the frontend server |
| `--port` | `-P` | Set the backend port (default: deterministic per-project hash) |
| `--generate` | `-g` | Auto-regenerate schema + SDK on startup and file changes |

> **IMPORTANT FOR AGENTS:** Each project automatically receives a **unique default port** derived from its directory path (range 3001–3999), preventing collisions when running multiple Rebase instances. The resolved port is saved to `.rebase-dev-port` for affinity across restarts. The backend URL is saved to `.rebase-dev-url` so scripts can read it. The frontend receives `VITE_API_URL` automatically.

**Port resolution order:**
1. Explicit `--port` flag (highest priority)
2. `PORT` environment variable
3. Previously saved port from `.rebase-dev-port` (port affinity)
4. Deterministic hash from project path (unique per project)

**Auto-generation:** Disabled by default. Enable with `--generate` or by setting `REBASE_AUTO_GENERATE=true` / `REBASE_GENERATE=true` in your environment. When enabled, the CLI:
- Runs `schema generate` + `generate-sdk` once on startup
- Watches `config/collections/` for file changes and regenerates automatically

```bash
# Start everything (default)
rebase dev

# Backend only on a specific port
rebase dev --backend-only --port 3005

# With auto-generation of schema/SDK on collection file changes
rebase dev --generate
```

### `rebase build`

Builds the apps declared in `rebase.json`. For the `backend` app this produces a **bundle** — compiled collections, functions and schema plus a manifest — which is the artifact the runtime (and `rebase start`) loads. For `static` apps it runs the declared build command and reports where the output landed.

Takes an optional list of app names; with none, every app in the manifest is built.

| Option | Alias | Description |
|--------|-------|-------------|
| `--output` | `--out` | Bundle output directory (default: `dist-bundle`) |
| `--skip-type-check` | | Compile without type checking (iteration only) |
| `--skip-schema` | | Do not regenerate the database schema from collections |
| `--no-static` | | Do not fold the frontend assets into the backend bundle |
| `--skip-static-build` | | Fold already-built assets without re-running the app's build |
| `--workspace` | | Run every workspace's own `build` script instead of bundling |
| `--help` | `-h` | Show build command help |

> **IMPORTANT FOR AGENTS:** "Build for production" means the default (bundle) path. `--workspace` runs each workspace's own build script and produces **no** bundle, so `rebase start` will have nothing to run. A project with no `rebase.json`, or one whose backend has been ejected, falls back to that path automatically.

```bash
# Build every app declared in rebase.json
rebase build

# Only the backend bundle, into a custom directory
rebase build backend --output build/bundle
```

### `rebase start`

Runs a built bundle through the Rebase runtime — the same path the official container image takes. Automatically sets `DOTENV_CONFIG_PATH` if a `.env` file is found. With no bundle present it falls back to the backend workspace's own `start` script.

| Option | Alias | Description |
|--------|-------|-------------|
| `--bundle` | | Bundle directory (default: `dist-bundle`) |
| `--workspace` | | Run the backend workspace's own `start` script |
| `--help` | `-h` | Show start command help |

```bash
rebase build && rebase start
```

### Schema Commands

| Command | Description |
|---------|-------------|
| `rebase schema generate` | Generate Drizzle schema from collection definitions |
| `rebase schema introspect` | Introspect a live database → generate Rebase collection files |
| `rebase schema --help` | Show schema command help |

> **IMPORTANT FOR AGENTS:** Schema commands are delegated to the active database driver plugin (e.g. `@rebasepro/server-postgres`). The plugin must be installed in `backend/package.json` or the command will fail with `Could not detect an active database plugin`.

#### `schema generate` Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--collections` | `-c` | Path to collections directory |
| `--output` | `-o` | Output path for generated schema |
| `--watch` | `-w` | Watch for changes and regenerate automatically |

#### `schema introspect` Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--output` | `-o` | Output directory for generated collection files |

### Database Commands

| Command | Description |
|---------|-------------|
| `rebase db push` | Apply schema directly to database (development only) |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Run pending SQL migrations |
| `rebase db branch` | Database branching (create, list, delete, info, prune) — needs a real PostgreSQL |
| `rebase db backup` | Write a backup of the current database |
| `rebase db backups` | List the backups taken so far |
| `rebase db restore` | Restore the database from a backup |
| `rebase db --help` | Show database command help |

<!-- docs-verify: ignore -->
> **IMPORTANT FOR AGENTS:** There is no `rebase db studio`. The driver accepts exactly
> the subcommands above and exits 1 on anything else.

> **IMPORTANT FOR AGENTS:** Like schema commands, database commands are delegated to the active database driver plugin. The plugin provides the actual implementation.

```bash
# Development workflow (fast, no migration files)
rebase schema generate && rebase db push

# Production workflow (versioned migrations)
rebase schema generate
rebase db generate
rebase db migrate

# Create a database branch
rebase db branch create feature_auth
```

### SDK Generation

| Command | Description |
|---------|-------------|
| `rebase generate-sdk` | Generate a typed JS/TS SDK from collection definitions |

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--collections-dir` | `-c` | `./config/collections` | Path to collections directory |
| `--output` | `-o` | `./generated/sdk` | Output path for generated SDK |

The SDK generator uses `jiti` for dynamic TypeScript import of collection files. It will look for an `index.ts` barrel export in the collections directory. If no index file is found, it falls back to scanning individual `.ts`/`.js` files.

```bash
rebase generate-sdk --collections-dir ./config/collections --output ./generated/sdk
```

### Auth Commands

| Command | Description |
|---------|-------------|
| `rebase auth reset-password` | Reset a user's password directly in the database |
| `rebase auth --help` | Show auth command help |

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--email` | `-e` | (required — or pass as positional arg) | User's email address |
| `--password` | `-p` | `NewPassword123!` | New password |

```bash
# With flags
rebase auth reset-password --email user@example.com --password MyNewPass!

# Positional args
rebase auth reset-password user@example.com MyNewPass!
```

### Diagnostics

| Command | Description |
|---------|-------------|
| `rebase doctor` | Detect three-way schema drift between collections, Drizzle schema, and live DB |

> **IMPORTANT FOR AGENTS:** `rebase doctor` compares collection definitions, the generated Drizzle schema (`schema.generated.ts`), and the actual PostgreSQL database. Run it after any manual DB changes or when suspecting schema drift.

# Environment Variables

## `loadEnv()` Function

Rebase provides `loadEnv()` from `@rebasepro/server` to validate and load environment variables with Zod. Call it **after** your `.env` file has been loaded (e.g. via `dotenv.config()`). It does NOT load `.env` files itself.

### Behavior

- **Auto-generates** ephemeral `JWT_SECRET` and `REBASE_SERVICE_KEY` in non-production mode so developers can start without manual setup
- **Blocks** auto-generated secrets in production (fails validation)
- Returns a fully typed, validated env object

### Signature

```typescript
import { loadEnv } from "@rebasepro/server";

// Basic — just Rebase env vars:
export const env = loadEnv();

// Extended — add your own typed vars:
import { z } from "zod";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string      (validated, required)
```

### Function Overloads

```typescript no-verify
function loadEnv(): RebaseEnv;
function loadEnv<E extends z.AnyZodObject>(options: { extend: E }): RebaseEnv & z.infer<E>;
```

When `extend` is provided, the base `rebaseEnvSchema` is merged (`.merge()`) with your custom Zod object, so all fields are validated together in a single pass.

### The `loadEnv()` schema

Everything `rebaseEnvSchema` declares — what an **ejected** project's own
`backend/src/env.ts` validates.

> **IMPORTANT FOR AGENTS:** this is not the whole environment a project reads. A
> project booted by the **runtime** (`rebase dev`, `rebase start`, the published
> image — the default, and what `rebase init` scaffolds) uses `loadBootEnv`,
> which extends this schema with the variables the runtime itself owns: `SMTP_*`
> and `APP_NAME`; `REBASE_SERVE_STATIC`, `REBASE_MIGRATE_ON_BOOT`,
> `REBASE_METRICS`, `REBASE_METRICS_TOKEN`, `LOG_LEVEL`; `STORAGE_PUBLIC_READ`
> and `STORAGE_ALLOW_ANY_AUTHENTICATED`; `AUTH_REQUIRE`,
> `AUTH_ALLOW_USER_LOOKUP`, `AUTH_COOKIE_SAME_SITE`, `AUTH_DEFAULT_ROLE`,
> `GITHUB_CLIENT_*`, `MICROSOFT_CLIENT_*`; `REBASE_BASE_PATH`,
> `REBASE_ENABLE_SWAGGER`, `REBASE_MAX_BODY_SIZE`, `REBASE_COMPRESSION`,
> `REBASE_HISTORY`; and the split-deployment set `REBASE_ROLE`,
> `REBASE_CRON_SCHEDULER`, `REBASE_JOB_WORKERS`, `REBASE_FUNCTIONS_ONLY`,
> `REBASE_FUNCTIONS_EXCLUDE`, `REBASE_FUNCTIONS_UPSTREAM`. Do not tell a user a
> variable "is not supported" because it is missing from the table below.

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `NODE_ENV` | `"development" \| "production" \| "test"` | `"development"` | No | Environment mode |
| `PORT` | `string` → `number` | `"3001"` | No | Server port |
| `DATABASE_URL` | `string` (URL) | — | **Yes** | PostgreSQL connection string |
| `DATABASE_DIRECT_URL` | `string` (URL) | — | No | Direct connection (bypasses pooler) |
| `DATABASE_READ_URL` | `string` (URL) | — | No | Read replica connection |
| `ADMIN_CONNECTION_STRING` | `string` (URL) | — | No | Admin-level DB connection |
| `JWT_SECRET` | `string` (≥32 chars) | Auto-generated in dev | **Yes** (prod) | JWT signing secret |
| `JWT_ACCESS_EXPIRES_IN` | `string` | `"1h"` | No | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `string` | `"400d"` | No | Refresh token TTL. Sliding — each rotation re-ups it |
| `JWT_PRIVATE_KEY` | `string` (PEM) | — | No | Sign access tokens asymmetrically (RS256). Accepts a real-newline PEM, a `\n`-escaped PEM, or base64 of the whole PEM |
| `JWT_KEY_ID` | `string` | `"default"` | No | The `kid` naming `JWT_PRIVATE_KEY` in the token header and the JWKS |
| `REBASE_SERVICE_KEY` | `string` | Auto-generated in dev | No | Static key for server-to-server auth |
| `GOOGLE_CLIENT_ID` | `string` | — | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `string` | — | No | Google OAuth client secret |
| `ALLOW_REGISTRATION` | `"true" \| "false"` | `"false"` | No | Allow public user registration. The first user on an empty table is admitted regardless |
| `DISABLE_SELF_REGISTRATION` | `"true" \| "false"` | — | No | Kill switch — also closes the first-user bootstrap window |
| `ALLOW_ANONYMOUS` | `"true" \| "false"` | — | No | Enable `POST /api/auth/anonymous` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | `"true" \| "false"` | — | No | Skip localhost URL checks in production |
| `CORS_ORIGINS` | `string` | — | **Yes** (prod) | Allowed CORS origins (comma-separated) |
| `FRONTEND_URL` | `string` | — | Prod alt | Alternative to CORS_ORIGINS for single frontend |
| `DB_POOL_MAX` | `string` → `number` | `"20"` | No | Max database pool connections |
| `DB_POOL_IDLE_TIMEOUT` | `string` → `number` | `"30000"` | No | Pool idle timeout (ms) |
| `DB_POOL_CONNECT_TIMEOUT` | `string` → `number` | `"10000"` | No | Pool connect timeout (ms) |
| `STORAGE_TYPE` | `"local" \| "s3" \| "gcs"` | `"local"` | No | File storage backend type |
| `STORAGE_PATH` | `string` | — | No | Local storage directory path |
| `FORCE_LOCAL_STORAGE` | `"true" \| "false"` | — | No | Allow `STORAGE_TYPE=local` in production. Without it the local backend is **not registered** — the backend still boots and serves data, auth and realtime, but uploads are refused with `501 STORAGE_NOT_CONFIGURED` rather than landing on a filesystem the next redeploy erases. Set it only when a durable volume really is mounted at `STORAGE_PATH` |
| `S3_BUCKET` | `string` | — | When S3 | S3 bucket name |
| `S3_REGION` | `string` | — | When S3 | S3 region |
| `S3_ACCESS_KEY_ID` | `string` | — | When S3 | S3 access key |
| `S3_SECRET_ACCESS_KEY` | `string` | — | When S3 | S3 secret key |
| `S3_ENDPOINT` | `string` (URL) | — | No | Custom S3 endpoint (MinIO, R2, etc.) |
| `S3_FORCE_PATH_STYLE` | `"true" \| "false"` | — | No | Use path-style S3 URLs |
| `GCS_BUCKET` | `string` | — | When GCS | GCS/Firebase Storage bucket name |
| `GCS_PROJECT_ID` | `string` | — | When GCS | GCP project ID |
| `GCS_KEY_FILENAME` | `string` (path) | — | No | GCP service-account key file. Omit on GCP: Workload Identity/ADC supplies credentials |
| `GOOGLE_APPLICATION_CREDENTIALS` | `string` (path) | — | No | Standard ADC variable, read by the Google SDK itself rather than by `loadEnv()` |

### Production Validations

`loadEnv()` enforces these rules when `NODE_ENV=production`:

1. `CORS_ORIGINS` or `FRONTEND_URL` **must** be set
2. `JWT_SECRET` and `REBASE_SERVICE_KEY` **must** be explicitly set (auto-generation disabled)
3. No environment variable may contain a localhost/loopback URL (unless `ALLOW_LOCALHOST_IN_PRODUCTION=true`)

### Auto-Generated Dev Secrets

In non-production mode, `loadEnv()` automatically generates cryptographically secure random values for `JWT_SECRET` and `REBASE_SERVICE_KEY` using `crypto.randomBytes(48).toString("hex")` when they are not set. This means:

- **Developers can start immediately** without creating a `.env` file
- **Existing JWT tokens are invalidated on every server restart** because the secret changes
- A console warning is emitted: `⚠️ Auto-generated secrets for: JWT_SECRET, REBASE_SERVICE_KEY...`
- To persist sessions across restarts, set these values explicitly in `.env`

# Backend Configuration

## `initializeRebaseBackend()`

The main entry point for initializing a Rebase backend server. Returns a `RebaseBackendInstance` with access to drivers, auth, storage, and lifecycle methods.

### `RebaseBackendConfig` — Full Interface

```typescript
import { initializeRebaseBackend, RebaseBackendConfig } from "@rebasepro/server";
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `server` | `Server` (Node `http.Server`) | — | **Required.** The HTTP server instance |
| `app` | `Hono<HonoEnv>` | — | **Required.** The Hono application instance |
| `collections` | `CollectionConfig[]` | `[]` | Inline collection definitions. Declaring **none** (and no `collectionsDir`) is what makes the server derive them from the live database instead, so every RLS-protected table is served with nothing to define. There is no `mode` flag — it was removed, because it could only ever agree with this or contradict it |
| `collectionsDir` | `string` | — | Directory to auto-discover collection files (used if `collections` is empty) |
| `basePath` | `string` | `"/api"` | Base path for all API routes |
| `database` | `DatabaseAdapter` | — | Database adapter (takes precedence over `bootstrappers`) |
| `bootstrappers` | `BackendBootstrapper[]` | `[]` | Database bootstrappers. Use one per engine for multiple engines in a single instance (e.g. Postgres + MongoDB); mark one `isDefault` |
| ~~`dataSources`~~ | — | — | **Removed.** Declare each one with `database("<key>")` in `config/resources.ts`. The backend reads the declarations; passing this key is refused at boot, by name, with the replacement in the message. Collections on a `direct`/`custom` transport are still client-only — the backend skips data routes for them |
| `auth` | `RebaseAuthConfig \| AuthAdapter` | — | Authentication config or pluggable adapter |
| `storage` | `BackendStorageConfig \| StorageController \| Record<string, ...>` | — | File storage configuration. Supports `"local"`, `"s3"`, and `"gcs"` (GCS/Firebase Storage) backends. Use `Record<string, StorageController>` for multi-backend setups with named sources |
| `history` | `HistoryConfig` (`boolean \| { retention?: number }`) | `true` | Entity history / audit log. `retention` is in days |
| `enableSwagger` | `boolean` | `true` | Enable OpenAPI spec at `/api/docs` and Swagger UI at `/api/swagger` (dev only) |
| `functionsDir` | `string` | — | Directory for auto-discovered custom function handlers |
| `cronsDir` | `string` | — | Directory for auto-discovered cron job handlers |
| `cronPersistence` | `boolean` | `true` | Persist cron job execution logs to the database |
| `maxBodySize` | `number` | `10485760` (10 MB) | Max request body size in bytes. Set `0` to disable |
| `csrf` | `{ origin: string \| string[] \| ((origin: string) => boolean) }` | — | CSRF protection (opt-in, disabled by default) |
| `callbacks` | `CollectionCallbacks` | — | Global lifecycle callbacks applied to every collection. Same type as per-collection `callbacks`, and fires on **every** data path (REST, realtime/WebSocket, server-side `rebase.dataAsAdmin`). Order: global → collection → property |
| `baas` | `BaasOptions` | — | `baas` mode only: `{ unprotectedTables?: "exclude" \| "serve" }`. Default `"exclude"` — a table with RLS disabled carries no authorization model, and every authenticated request runs as `rebase_user`, so serving one hands every row to every logged-in user. Excluded tables are logged with the SQL to protect them. `"serve"` serves them anyway; only sensible when every caller is already trusted |
| `schemaEditor` | `boolean` | — | Force the schema-editor routes on or off. Defaults to enabled when `collectionsDir` is set, outside production, in `cms` mode |
| ~~`storageSources`~~ | — | — | **Removed.** Declare each one with `bucket("<key>")` in `config/resources.ts`. Collection properties still point at it by key via `StorageConfig.storageSource`. (The `<Rebase storageSources>` *prop* is unrelated and still exists — pass `declaredStorageSources()`) |
| `logging` | `{ level?: "error" \| "warn" \| "info" \| "debug" }` | `"info"` | Log level configuration |
| `storageAuthorize` | `StorageAuthorize` | — | **Per-object access control**, the storage analogue of RLS. Without one, any authenticated user can read, overwrite, delete or list any key they can name — and `GET /storage/list?prefix=` means they need not guess. See the boot guard below |
| `storagePublicRead` | `boolean` | `false` | Serve stored objects to unauthenticated readers |
| `storageInsecureAllowAnyAuthenticated` | `boolean` | `false` | Opt out of the storage boot guard. Named to be read twice |
| `jobs` | `JobQueueOptions` | — | The durable job queue: `{ enabled, tasks, concurrency, pollIntervalMs, visibilityTimeoutMs, maxAttempts, backoff }`. Off unless asked for |
| `rateLimit` | `DataRateLimitConfig` | — | Rate limiting for the data API |
| `compression` | `boolean` | `true` | gzip/brotli responses |
| `functionsTimeoutMs` | `number` | — | Per-invocation timeout for custom functions |
| `functionsSelection` | `FunctionSelection` | — | Which functions this process serves (split deployments) |
| `functionsUpstream` | `string` | — | Forward `/api/functions/*` to another process instead of mounting them |
| `surfaces` | `RuntimeSurfaceOptions` | — | Which route groups this process mounts (`api`/`functions`/`worker` roles) |
| `ownership` | `RuntimeOwnershipOptions` | — | Which background responsibilities this process owns (cron timers, job workers) |
| `provisionSchema` | `boolean` | `true` | Whether **this process** runs the boot DDL. Exactly one process in a split deployment may |
| `schemaVersion` / `runtimeVersion` | `string` | — | Stamps carried from the bundle manifest |

> **IMPORTANT FOR AGENTS: storage refuses to boot in production without an access
> model.** When storage is configured and `NODE_ENV=production`,
> `initializeRebaseBackend` **throws at startup** unless one of `storageAuthorize`,
> `storagePublicRead: true`, or `storageInsecureAllowAnyAuthenticated: true` is
> set. In development it logs a warning instead — so a project can be wrong about
> this and work fine locally right up until it is deployed. A scaffolded project
> ships a hook in `config/storage.ts`; read it before replacing it.

> **IMPORTANT FOR AGENTS:** `maxBodySize` applies to all API routes under `basePath`. Storage upload routes have their **own** limit derived from the storage config's `maxFileSize` property (default: 50 MB), which overrides the global limit.

### `RebaseAuthConfig` — Authentication Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `collection` | `CollectionConfig` | `defaultUsersCollection` | The collection used for auth users |
| `jwtSecret` | `string` | — | JWT signing secret (≥32 chars) |
| `accessExpiresIn` | `string` | `"1h"` | Access token TTL |
| `refreshExpiresIn` | `string` | `"30d"` | Refresh token TTL. The **runtime** passes `JWT_REFRESH_EXPIRES_IN` instead, whose own default is `"400d"`, so this `"30d"` is only what a hand-written `initializeRebaseBackend` call falls back to |
| `requireAuth` | `boolean` | `true` | Require authentication for data routes |
| `allowRegistration` | `boolean` | `false` | Allow public user registration |
| `serviceKey` | `string` | — | Static secret for server-to-server auth (≥32 chars) |
| `defaultRole` | `string` | — | Role assigned to new users on registration |
| `email` | `EmailConfig` | — | SMTP email configuration |
| `hooks` | `AuthHooks` | — | Override auth behavior (password hashing, validation, etc.) |
| `providers` | `OAuthProvider[]` | `[]` | The canonical OAuth array. The named provider fields below resolve into it at startup; the two forms merge |
| `allowedRedirectUris` | `string[]` | — | Narrow which redirect URIs the OAuth routes accept. Unset, the only check is the provider's own registered-URI match — which authorises every URI on that OAuth client, `localhost` included |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch. Also closes the first-user bootstrap window `allowRegistration: false` leaves open |
| `allowAnonymous` | `boolean` | `false` | Enable `POST /api/auth/anonymous`. Deliberately not gated by `allowRegistration` |
| `allowUserLookup` | `boolean` | `false` | Mount `POST /api/auth/find-user` (minimal public profile, authenticated callers only) |
| `magicLink` | `boolean` | `false` | Passwordless email sign-in. Needs `email`; without it the routes answer `503 EMAIL_NOT_CONFIGURED` |
| `cookieAuth` | `CookieAuthConfig` | — | Deliver the refresh token as an `httpOnly` `Secure` `SameSite` cookie instead of in the JSON body. Requires `credentials: "include"` on the client and an explicit CORS origin list |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetric signing keys, so a verifier holding the JWKS cannot mint tokens |
| `activeKid` | `string` | first key | Which of `signingKeys` mints new tokens |

#### Built-in OAuth Providers

| Property | Required Fields | Description |
|----------|----------------|-------------|
| `google` | `clientId`, `clientSecret?` | Google OAuth (supports ID token without secret) |
| `github` | `clientId`, `clientSecret` | GitHub OAuth |
| `linkedin` | `clientId`, `clientSecret` | LinkedIn OAuth |
| `microsoft` | `clientId`, `clientSecret`, `tenantId?` | Microsoft/Azure AD OAuth |
| `apple` | `clientId`, `teamId`, `keyId`, `privateKey` | Apple Sign In |
| `facebook` | `clientId`, `clientSecret` | Facebook OAuth |
| `twitter` | `clientId`, `clientSecret` | Twitter/X OAuth |
| `discord` | `clientId`, `clientSecret` | Discord OAuth |
| `gitlab` | `clientId`, `clientSecret`, `baseUrl?` | GitLab OAuth (supports self-hosted) |
| `bitbucket` | `clientId`, `clientSecret` | Bitbucket OAuth |
| `slack` | `clientId`, `clientSecret` | Slack OAuth |
| `spotify` | `clientId`, `clientSecret` | Spotify OAuth |

### `RebaseBackendInstance` — Return Value

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `driver` | `DataDriver` | The default data driver |
| `driverRegistry` | `DriverRegistry` | Registry of all initialized drivers |
| `realtimeService` | `RealtimeProvider` | Default realtime provider |
| `realtimeServices` | `Record<string, RealtimeProvider>` | All realtime providers |
| `auth` | `BootstrappedAuth \| undefined` | Bootstrapped auth result |
| `storageRegistry` | `StorageRegistry \| undefined` | All storage backends |
| `storageController` | `StorageController \| undefined` | Default storage controller |
| `collectionRegistry` | `BackendCollectionRegistry` | Registry of all active collections |
| `cronScheduler` | `CronScheduler \| undefined` | The cron job scheduler (if configured) |
| `healthCheck()` | `() => Promise<HealthCheckResult>` | Deep health check (verifies DB connectivity, returns latency) |
| `shutdown(timeoutMs?)` | `(timeoutMs?: number) => Promise<void>` | Graceful shutdown (stops cron, destroys realtime, drains HTTP, default 15s timeout) |

### Shutdown Behavior

When `shutdown()` is called, it performs these steps in order:

1. **Stops the cron scheduler** (if configured)
2. **Destroys realtime services** (LISTEN clients, debounce timers, subscriptions) — this happens **before** pool close to prevent timer callbacks firing against a closed pool
3. **Closes the HTTP server** (stops accepting, drains in-flight requests)
4. **Force-resolves** after `timeoutMs` (default 15000ms). Pass `0` to disable the force timer (useful in tests)

### Minimal Backend Example

```typescript
import { Hono } from "hono";
import type { BackendStorageConfig, HonoEnv } from "@rebasepro/server";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import { initializeRebaseBackend, loadEnv } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { defaultUsersCollection } from "@rebasepro/common";
import collections from "../config/collections";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });
const env = loadEnv();

const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

// Each `type` carries its own required fields — `local` needs `basePath`,
// `s3`/`gcs` need `bucket` and credentials — so branch on the env var rather
// than spreading it into one object literal. Annotate the const: inline, the
// ternary is checked against `BackendStorageConfig | StorageController |
// Record<string, …>` all at once and TypeScript cannot distribute over it.
const storage: BackendStorageConfig = env.STORAGE_TYPE === "s3"
    ? {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || ""
    }
    : { type: "local", basePath: "./uploads" };

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connectionString: env.DATABASE_URL,
    }),
    collections: [...collections, defaultUsersCollection],
    collectionsDir: "../config/collections",
    functionsDir: "./src/functions",
    cronsDir: "./src/crons",
    auth: {
        collection: defaultUsersCollection,
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,
    },
    // Multi-backend: Record<string, StorageController> with named sources.
    storage,
});

console.log(`Server running at http://localhost:${env.PORT}`);
```

## Default security rules live with the collections, not here

`defaultSecurityRules` is **not** a `RebaseBackendConfig` option. Declare it in
`config/collections/index.ts`, beside the collections it applies to:

```typescript
// config/collections/index.ts
import type { SecurityRule } from "@rebasepro/types";

export const defaultSecurityRules: SecurityRule[] = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
```

Any collection in that directory that declares no `securityRules` inherits these;
one that declares its own keeps them; one with neither is **locked by default**
(admin-only).

It belongs there because `db push` generates the Postgres policies — the only
thing that actually enforces access — from the collection *files*, and never sees
the running server. A default on the backend config could never reach the
database while reading exactly like an authorization setting. In `baas` mode there
are no collection files and no `db push`, so the database's own RLS is the whole
model and there is nothing to default.

# The `rebase` Singleton

After `initializeRebaseBackend()` completes, a server-side singleton is available:

```typescript
import { rebase } from "@rebasepro/server";
```

> **WARNING FOR AGENTS:** The singleton is a **lazy proxy** — accessing it at module import time (top-level) will throw. Only use it inside request handlers, cron jobs, hooks, or functions that run after the server has started.

### How It Works

The singleton is a JavaScript `Proxy` object. Any property access on `rebase.*` is intercepted:
- If the server **has** been initialized (`_initRebase()` called by `initializeRebaseBackend()`), the access is forwarded to the internal `RebaseClient` instance.
- If the server **has not** been initialized yet, a descriptive error is thrown: `"rebase.<prop>: server not initialized yet"`.
- The proxy is **read-only** — attempting to assign `rebase.anything = value` throws.

The singleton has **two planes**, and they do not work the same way:

- **Data** (`rebase.dataAsAdmin`) is backed by the native DataDriver — no JSON
  serialization, no HTTP dispatch, no middleware. It is scoped once, at boot, as
  `{ uid: "service", roles: ["admin"] }`: **admin-scoped, not RLS-bypassing**.
- **Control plane** (`rebase.auth`, `rebase.admin`, `rebase.cron`,
  `rebase.storage`, …) routes through the Hono app's internal request handler
  (`app.request()`, so no network hop) with an internal per-boot service key.

`rebase.sql()` is the one unconditional bypass: owner connection, no policies.

### What It Exposes

The `rebase` singleton implements `RebaseServerClient` — `RebaseClient` narrowed
to the guarantees that always hold on a server, and with `data` **omitted from
the type** so the privileged plane has exactly one name. (`rebase.data` still
resolves at runtime as an alias of `dataAsAdmin`, so untyped JavaScript keeps
working, but do not write it.)

| Property | Type | Description |
|----------|------|-------------|
| `rebase.dataAsAdmin` | `RebaseData` | Admin-level data access — scoped as `{ uid: "service", roles: ["admin"] }`, so RLS is **evaluated against that identity, not bypassed**. Use `rebase.dataAsAdmin.<slug>.find()`, `.findOne()`, `.create()`, `.update()`, `.delete()` |
| `rebase.auth` | `AuthClient` | Authentication operations |
| `rebase.storage` | `StorageSource \| undefined` | File storage operations |
| `rebase.email` | `EmailService` | Send emails. **Always present** — a no-op sender is wired when SMTP is not configured, so ask `rebase.email.isConfigured()` rather than testing for the property |
| `rebase.admin` | `AdminAPI \| undefined` | User management API |
| `rebase.sql` | `(query, options?) => Promise<Record[]>` | Raw SQL. Always present server-side on SQL engines. Pass values via `options.params` and reference them as `$1`, `$2`, … Runs on the owner connection — this, not `dataAsAdmin`, is the unconditional RLS bypass |
| `rebase.baseUrl` | `string \| undefined` | The base HTTP URL of the backend |

### Usage Examples

```typescript
import { rebase } from "@rebasepro/server";

// In a cron job, custom function, or hook:

// Data operations (admin-level: RLS applies, evaluated as the `admin` role)
const { data: posts } = await rebase.dataAsAdmin.collection<Record<string, unknown>>("posts").find({ limit: 10 });
await rebase.dataAsAdmin.collection<Record<string, unknown>>("orders").create({ status: "pending", total: 99.99 });

// Send an email
await rebase.email.send({
    to: "admin@company.com",
    subject: "Daily Report",
    html: "<p>Today's summary...</p>",
});

// Execute raw SQL
if (rebase.sql) {
    const rows = await rebase.sql("SELECT count(*) FROM orders WHERE status = 'pending'");
}
```

### Testing

```typescript no-verify
import { _setRebaseMock, _resetRebaseMock } from "@rebasepro/server";

// Only works when NODE_ENV=test
beforeEach(() => {
    _setRebaseMock({
        data: mockDataLayer,
        email: mockEmailService,
    });
});
afterEach(() => _resetRebaseMock());
```

> **IMPORTANT FOR AGENTS:** `_setRebaseMock()` and `_resetRebaseMock()` throw if `NODE_ENV !== "test"`. This prevents accidental use in production.

# MCP Server Tools

The Rebase MCP server provides these tools for AI agents. Use the MCP tool calling convention (`call_mcp_tool` with server name `rebase`):

### Dev Server Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `rebase_dev_start` | Start the Rebase dev server (frontend + backend). Returns immediately — use `rebase_dev_logs` to check output | — |
| `rebase_dev_stop` | Stop the running Rebase dev server | — |
| `rebase_dev_logs` | Read recent output from the running dev server | `lines?: number` (default 50) |

### Schema & Database

| Tool | Description | Parameters |
|------|-------------|------------|
| `rebase_schema_generate` | Generate Drizzle schema from collection definitions. Run after adding or modifying collection files | — |
| `rebase_schema_introspect` | Introspect the live database and generate Rebase collection definitions from existing tables | — |
| `rebase_db_push` | Apply the current Drizzle schema directly to the database (development shortcut, skips migration files) | — |
| `rebase_db_generate` | Generate SQL migration files from schema changes (compares current Drizzle schema against the last entity) | — |
| `rebase_db_migrate` | Run all pending SQL migrations against the database | — |

### SDK

| Tool | Description | Parameters |
|------|-------------|------------|
| `rebase_generate_sdk` | Generate a fully-typed JS/TS SDK from collection definitions | — |

### Document Operations

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_documents` | List documents from a collection with optional filtering, sorting, pagination | `collection` (required), `where?: object`, `orderBy?: string`, `limit?: number` (default 25), `offset?: number` |
| `get_document` | Get a single document by ID | `collection` (required), `id` (required) |
| `create_document` | Create a new document in a collection | `collection` (required), `data` (required) |
| `update_document` | Update an existing document | `collection` (required), `id` (required), `data` (required) |
| `delete_document` | Delete a document from a collection | `collection` (required), `id` (required) |

### User Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_users` | List all users registered in the backend, including their roles | — |
| `create_user` | Create a new user | `email` (required), `displayName?: string`, `password?: string`, `roles?: string[]` |
| `update_user` | Update an existing user (email, display name, roles) | `userId` (required), `email?: string`, `displayName?: string`, `roles?: string[]` |
| `delete_user` | Delete a user from the backend | `userId` (required) |
| `list_roles` | List all roles defined in the backend | — |

### Filtering with `list_documents`

The `where` parameter accepts a filter object with PostgREST-style operators:

```json
{
  "collection": "products",
  "where": {
    "status": "eq.active",
    "price": "gte.100",
    "category": "eq.electronics"
  },
  "orderBy": "price:desc",
  "limit": 10
}
```

# Common Issues

### Database & Connection

- **`DATABASE_URL is not set`:** Ensure `.env` exists in the project root with `DATABASE_URL=postgresql://user:password@localhost:5432/rebase`
- **`DATABASE_URL must be a valid URL`:** The value must be a proper PostgreSQL URL including protocol (`postgresql://`). Check for missing or malformed values.
- **Connection refused on port 5432:** PostgreSQL is not running. Start it with `docker compose up -d db` or verify your local Postgres service.
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
- **Column type mismatch after manual DB edit:** Never edit the database manually. Always modify collection files → `rebase schema generate` → `rebase db push` (dev) or `rebase db generate && rebase db migrate` (prod).

### CLI & Tooling

- **pnpm not found:** Install with `npm install -g pnpm`.
- **Node.js version mismatch:** Rebase requires Node.js v20+. Use `nvm install 20 && nvm use 20`.
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
