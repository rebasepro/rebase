## Rebase CLI

Developer tools for scaffolding, running, and managing Rebase projects.

### Installation

The CLI is bundled with every Rebase project. You can also install it globally:

```bash
pnpm add -g @rebasepro/cli
```

### Commands

| Command | Description |
|---------|-------------|
| `rebase init` | Scaffold a new Rebase project |
| `rebase dev` | Start the development server (backend + frontend) |
| `rebase build` | Build all workspace packages |
| `rebase start` | Start the backend server (production) |
| `rebase schema generate` | Generate Drizzle schema from collection definitions |
| `rebase schema introspect` | Introspect an existing database to generate collections |
| `rebase db push` | Apply schema directly to database (development) |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Run pending migrations |
| `rebase db studio` | Open Drizzle Studio |
| `rebase generate-sdk` | Generate a typed JS SDK from collections |
| `rebase auth reset-password` | Reset a user's password |
| `rebase doctor` | Detect schema drift between collections, schema, and DB |

### Quick Start

```bash
rebase init my-app
cd my-app
docker compose up -d db
pnpm run db:push
pnpm run dev
```

### Help

Run `rebase --help` or `rebase <command> --help` for detailed usage information.

### Development

For local development of the CLI itself, link the package:

```bash
pnpm link --global
```

You can change the environment when deploying to Rebase Cloud by defining the `--env` variable.
Possible values are `prod` (default) and `dev`.

```bash
rebase deploy --env dev
```
