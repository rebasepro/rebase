# CLI command reference

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
| `rebase build` | Build the apps declared in rebase.json into a deployable bundle |
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
| `rebase db branch` | Database branching (create, list, switch, delete, info, prune) — needs a real PostgreSQL |
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

# Create a database branch and work on it
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch switch --off   # back to the main database
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
| `--password` | `-p` | one is generated and printed | New password |

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
