# @rebasepro/cli

Developer CLI for scaffolding, running, and managing Rebase projects.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

The CLI is also bundled with every Rebase project as a local dependency.

## Commands

| Command | Description |
|---------|-------------|
| `rebase init` | Scaffold a new Rebase project |
| `rebase dev` | Start the development server (backend + frontend) |
| `rebase build` | Build the apps declared in `rebase.json` into a bundle |
| `rebase normalize-imports` | Complete compiled output's relative imports for Node ESM |
| `rebase start` | Start the backend server (production) |
| `rebase apps list` | Show the apps this repository declares |
| `rebase schema generate` | Generate Drizzle schema from collection definitions |
| `rebase schema introspect` | Introspect an existing database → Rebase collections |
| `rebase schema stale` | Report generated schema files the collections have moved past |
| `rebase db push` | Apply schema directly to database (dev). Previews the plan and refuses destructive changes (e.g. dropped columns) unless confirmed interactively or run with `--allow-destructive`. |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Run pending migrations |
| `rebase db pull` | Copy another database into local development |
| `rebase db branch` | Create, list, switch and delete database branches |
| `rebase db stop` | Stop the managed development database (data is kept) |
| `rebase db reset` | Delete the managed development database and start over |
| `rebase generate-sdk` | Generate a typed TypeScript SDK from collections |
| `rebase auth reset-password` | Reset a user's password |
| `rebase api-keys list \| create \| revoke` | Manage scoped service API keys |
| `rebase doctor` | Detect schema drift between collections, Drizzle schema, and database |
| `rebase status` | Show every resource this project declares and whether its variables are set |
| `rebase resources` | List the databases, buckets and topics this project declares |
| `rebase eject` | Own the server process and the image (one-way) |
| `rebase skills install` | Install Rebase agent skills for your AI coding assistant |
| `rebase telemetry` | Anonymous usage sharing (opt-in, off by default) |
| `rebase cloud <command>` | Manage your apps on Rebase Cloud (auth, deploy, databases, …) |

Run `rebase --help` or `rebase <command> --help` for detailed usage.

## Rebase Cloud

`rebase cloud` talks to the hosted control plane (default `https://app.rebase.pro`,
override with `--url` or `REBASE_CLOUD_URL`). Sign in once — credentials are stored
in `~/.rebase/credentials.json`, keyed per host — then link a directory to a project
so deploy/logs/status need no flags.

```bash
rebase cloud login                 # sign in (stores a session)
rebase cloud link                  # pick a project → writes .rebase/cloud.json
rebase cloud deploy                # deploy the linked project + stream build logs
rebase cloud logs --runtime        # tail runtime logs
rebase cloud status                # project status at a glance
```

| Group | Commands |
|-------|----------|
| Auth | `login`, `logout`, `whoami` |
| Link/context | `link`, `unlink`, `use [org]`, `open` |
| Projects | `projects list \| create \| info \| delete` |
| Deploy/observe | `deploy`, `logs [--runtime] [-f]`, `status`, `metrics` |
| Organizations | `orgs list \| create \| members` |
| Databases | `db list \| create \| test`, `db backup list \| create \| restore` |
| Resources | `webhooks list \| create \| delete`, `storage`, `clusters`, `billing [checkout]` |

Most commands act on the linked project unless you pass `--project <id>`.
Run `rebase cloud --help` for the full list.

## Quick Start

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm install
pnpm run dev
```

That is the whole first run. With no `DATABASE_URL` set, `rebase dev` starts a
managed PostgreSQL (PGlite) in the project directory, generates the Drizzle
schema from your collections, and creates the tables at boot — no database to
install and no schema step.

Two commands worth knowing straight after:

```bash
rebase status           # every resource, and whether its variables are set
rebase skills install   # Rebase skills for your AI coding assistant
```

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server` | Backend framework used by `dev` and `start` |
| `@rebasepro/server-postgres` | PostgreSQL driver used by schema/db commands |
| `@rebasepro/codegen` | Powers `generate-sdk` |
| `@rebasepro/types` | Shared type definitions |
