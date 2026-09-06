# @rebasepro/mcp

Model Context Protocol (MCP) server that exposes Rebase schema, database, document CRUD, user management, and dev server tools to AI assistants.

## Installation

```bash
pnpm add @rebasepro/mcp
```

Or run directly:

```bash
npx -y @rebasepro/mcp
```

## What This Package Does

`@rebasepro/mcp` implements the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, allowing AI assistants (Gemini, Claude, Cursor, etc.) to interact with a Rebase project. It provides tools and exposes collection definitions and generated schemas as MCP resources. It has native support for managing multiple local and remote projects.

## Multi-Project Support

The MCP server supports managing multiple Rebase projects simultaneously. This is ideal when working in an IDE with multiple open workspaces or when interacting with both local development servers and remote staging/production environments.

- **Registry**: Project configurations are stored in `~/.rebase/projects.json`.
- **Auto-Discovery**: If `rebase dev` is running locally, the MCP server automatically discovers the active development port and service key from `.rebase/state.json` inside the project directory, giving you **zero-config local development**.

### Which project a run resolves to

One precedence, in this order:

1. **The environment block** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`, `REBASE_API_TOKEN` / `REBASE_TOKEN`. If any of them is set, the `default` project is rebuilt from them on **every** start. The rebuild is whole-entry: a token registered against the old `projectDir` is dropped rather than carried into a directory it was never issued for.
2. **The server's working directory**, when it holds a `rebase.json`. `~/.rebase/projects.json` is machine-wide, and a project you are standing in outranks a home-directory cache.
3. **The persisted `default`**, when neither of the first two says anything.

A `default` derived from 1 or 2 is never written back to the registry: it is recomputed at every start, and persisting it would put one project's directory, backend URL and dev service key in the file every other project on the machine reads.

Auto-discovery fills gaps in all three cases and **never overrules** a value one of them supplied — not the token and not the `baseUrl`. Discovery reads the dev server's *service key*, which is an unscoped admin secret, so a narrow `rk_live_*` key you registered is what gets used even while `rebase dev` is running; likewise a project registered against `https://staging.example.com` stays there rather than being silently redirected to the local dev port. A disagreement between the two is reported on stderr.

`rebase init` writes `"env": { "REBASE_PROJECT_DIR": "." }` into the scaffolded `.mcp.json` — relative to the client's working directory, which for a project-level config file is the project.

## Configuration

The server reads configuration from environment variables and `.env` files:

| Variable | Default | Description |
|---|---|---|
| `REBASE_PROJECT_DIR` | `process.cwd()` | Project root directory (the `rebase.json` directory) |
| `REBASE_BASE_URL` | `http://localhost:3001` | Rebase backend URL, when discovery finds no dev server |
| `REBASE_API_TOKEN` / `REBASE_TOKEN` | (empty) | Auth token for API calls |
| `REBASE_MCP_ALLOW_REMOTE_WRITES` | `false` | Allow destructive tools to run against non-local targets (see below) |

The server attempts to load `.env` from `$REBASE_PROJECT_DIR/.env` or `$REBASE_PROJECT_DIR/app/.env`.

## Destructive-Tool Safety Gate

`rebase_project_add` accepts any `baseUrl`, and the CLI tools connect with whatever `DATABASE_URL` the project's `.env` declares. That means the same tool list that edits a scratch database on your laptop can drop production rows — with nothing in between but the assistant's judgement about which project is currently active.

**Every tool that changes the target environment is refused unless that target is on the loopback interface.** The gate is a list of what is *not* gated, so a newly added tool is protected by default:

- **Not gated — reads:** `rebase_schema_introspect`, `rebase_doctor`, `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`, `get_document`, `list_users`, `list_roles`, `storage_list_objects`, `storage_get_metadata`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`, `rebase_dev_logs`.
- **Not gated — local only:** `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, the dev-server tools, and the project-registry tools. These write local files or local state and have no remote target to check.
- **Gated against `DATABASE_URL`:** every other CLI tool — `rebase_db_push`, `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gated against the project `baseUrl`:** every other SDK tool — `create_document`, `update_document`, `delete_document`, `create_user`, `update_user`, `delete_user`, `rebase_auth_reset_password`, `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`, `invoke_function`.

The two targets are not interchangeable: CLI tools never see `baseUrl`, so a localhost backend sitting next to a production `DATABASE_URL` is checked against the database, not the backend. `create_user` and `update_user` set `roles`, so they can mint an admin; `invoke_function` calls any function with any HTTP method; `cron_toggle_job` disables a scheduled backup silently. None of those is recoverable in the sense "additive" suggests, which is why the list is now the other way round.

The `DATABASE_URL` the gate checks is resolved the way the spawned CLI resolves it — ambient environment first, then `<root>/.env`, `<root>/backend/.env`, `DOTENV_CONFIG_PATH` and the parent directory, including the `ADMIN_CONNECTION_STRING` fallback the branch commands accept. **If no connection string can be resolved at all, the DB tools are refused**: an unverifiable target is not a safe one, and the child does its own resolution from files this process may not see.

Only loopback (`localhost`, `127.0.0.0/8`, `::1`) counts as local — private ranges like `10.x` and `192.168.x` do not, since those are as likely to be a shared staging cluster as a laptop.

Set `REBASE_MCP_ALLOW_REMOTE_WRITES=true` to opt out.

## Untrusted Data Marking

Rows, user records, storage listings, cron jobs, function responses and CLI output are returned inside an explicit `<<<UNTRUSTED_DATA …>>>` envelope. Anything stored in your database was written by somebody, and it arrives on the same channel as the tool contract the assistant is following; the envelope tells the model to treat it as inert content rather than instructions. It is a marker, not a sandbox — an assistant with these tools is only as safe as the content you let it read.

---

## Tools

<!-- generated: mcp tool tables — pnpm generate:mcp-readme -->

42 tools, in 9 groups. Tools marked ⚠ are refused against a non-local
target unless `REBASE_MCP_ALLOW_REMOTE_WRITES=true` — see the gate above.

### Schema & database (12)

Spawn the Rebase CLI in the active project directory.

| Tool | Required | Description |
|---|---|---|
| `rebase_schema_generate` | — | Generate Drizzle schema from Rebase TypeScript collection definitions |
| `rebase_db_push` | — | Apply the current Drizzle schema directly to the database (development shortcut, skips migration files) |
| `rebase_schema_introspect` | — | Introspect the live database and generate Rebase collection definitions from existing tables |
| `rebase_db_generate` | — | Generate SQL migration files from schema changes (compares current Drizzle schema against the last entity) |
| `rebase_db_migrate` | — | Run all pending SQL migrations against the database |
| `rebase_generate_sdk` | — | Generate a fully-typed JavaScript/TypeScript SDK from collection definitions |
| `rebase_doctor` | — | Detect schema drift between collection definitions, generated Drizzle schema, and the live PostgreSQL database |
| `rebase_db_branch_create` | `name` | Create a new database branch (Admins only) |
| `rebase_db_branch_list` | — | List all database branches (Admins only) |
| `rebase_db_branch_delete` | `name` | Delete an existing database branch (Admins only) |
| `rebase_db_branch_info` | `name` | Show information and status for a database branch (Admins only) |
| `rebase_db_branch_switch` | — | Point this checkout at a database branch, or back at the main database (Admins only) |

### Schema planning (1)

Ask the backend what a change would do. No CLI, no files written.

| Tool | Required | Description |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Show the SQL a collection change would run, without running any of it |

### Documents (5)

CRUD over a collection through `@rebasepro/client`.

| Tool | Required | Description |
|---|---|---|
| `list_documents` | `collection` | List documents from a Rebase collection with optional filtering, sorting, and pagination |
| `get_document` | `collection`, `id` | Get a single document by ID from a Rebase collection |
| `create_document` | `collection`, `data` | Create a new document in a Rebase collection |
| `update_document` | `collection`, `id`, `data` | Update an existing document in a Rebase collection |
| `delete_document` | `collection`, `id` | Delete a document from a Rebase collection |

### Users & roles (6)

| Tool | Required | Description |
|---|---|---|
| `list_users` | — | List all users registered in the Rebase backend, including their roles |
| `create_user` | `email` | Create a new user in the Rebase backend |
| `update_user` | `uid` | Update an existing user (email, display name, roles) |
| `delete_user` | `uid` | Delete a user from the Rebase backend |
| `list_roles` | — | List all roles defined in the Rebase backend |
| `rebase_auth_reset_password` | `email` | Reset a user's password via the admin API |

### Dev server (3)

| Tool | Required | Description |
|---|---|---|
| `rebase_dev_start` | — | Start the Rebase development server (frontend + backend) |
| `rebase_dev_logs` | — | Read recent output from the running Rebase dev server |
| `rebase_dev_stop` | — | Stop the running Rebase development server |

### Storage (3)

| Tool | Required | Description |
|---|---|---|
| `storage_list_objects` | — | List files/objects stored in Rebase storage |
| `storage_delete_object` | `key` | Delete an object/file from Rebase storage |
| `storage_get_download_url` | `key` | Mint a temporary signed download URL for a file in Rebase storage |

### Cron (5)

| Tool | Required | Description |
|---|---|---|
| `cron_list_jobs` | — | List all scheduled cron jobs and their configuration status |
| `cron_get_job` | `jobId` | Get status and details of a specific scheduled cron job |
| `cron_trigger_job` | `jobId` | Manually trigger a cron job run immediately |
| `cron_get_job_logs` | `jobId` | Read execution logs for a specific cron job |
| `cron_toggle_job` | `jobId`, `enabled` | Enable or disable a scheduled cron job |

### Functions (1)

| Tool | Required | Description |
|---|---|---|
| `invoke_function` | `name` | Invoke a custom backend Hono function (located in api/functions/:name) |

### Project registry (6)

| Tool | Required | Description |
|---|---|---|
| `rebase_project_list` | — | List all registered Rebase projects and show which one is active |
| `rebase_project_switch` | `name` | Switch the active Rebase project by name |
| `rebase_project_add` | `name` | Register a new Rebase project |
| `rebase_project_remove` | `name` | Remove a registered project from the project registry |
| `rebase_project_current` | — | Show details about the currently active Rebase project, including resolved URL and auth status |
| `rebase_project_status` | — | Health-check the active project's backend by calling GET /health |

<!-- /generated: mcp tool tables -->

---

## Resources

The server exposes MCP resources for AI context:

| URI | Description |
|---|---|
| `rebase://collections/{name}` | TypeScript source of a collection definition |
| `rebase://schema` | Generated Drizzle schema (`schema.generated.ts`) |

Collection files are discovered from `app/config/collections/`, `config/collections/`, or `collections/` under the active project directory.

## Quick Start

Add to your AI assistant's MCP config (e.g. `.gemini/settings.json`):

```json
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

## Related Packages

- `@rebasepro/client` — Used internally for data and admin API calls

