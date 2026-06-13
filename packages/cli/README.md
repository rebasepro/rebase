# @rebasepro/cli

Developer CLI for scaffolding, running, and managing Rebase projects.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

The CLI is also bundled with every Rebase project as a local dependency.

## Commands

| Command | Description |
|---------|-------------|
| `rebase init` | Scaffold a new Rebase project |
| `rebase dev` | Start the development server (backend + frontend) |
| `rebase build` | Build all workspace packages |
| `rebase start` | Start the backend server (production) |
| `rebase schema generate` | Generate Drizzle schema from collection definitions |
| `rebase schema introspect` | Introspect an existing database → Rebase collections |
| `rebase db push` | Apply schema directly to database (dev) |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Run pending migrations |
| `rebase db studio` | Open Drizzle Studio |
| `rebase generate-sdk` | Generate a typed TypeScript SDK from collections |
| `rebase auth reset-password` | Reset a user's password |
| `rebase doctor` | Detect schema drift between collections, Drizzle schema, and database |

Run `rebase --help` or `rebase <command> --help` for detailed usage.

## Quick Start

```bash
rebase init my-app
cd my-app
docker compose up -d db
pnpm run db:push
pnpm run dev
```

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server-core` | Backend framework used by `dev` and `start` |
| `@rebasepro/server-postgresql` | PostgreSQL driver used by schema/db commands |
| `@rebasepro/sdk-generator` | Powers `generate-sdk` |
| `@rebasepro/types` | Shared type definitions |
