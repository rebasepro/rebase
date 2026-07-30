# @rebasepro/mcp

Model Context Protocol (MCP) server that exposes Rebase schema, database, document CRUD, user management, and dev server tools to AI assistants.

## Installation

```bash
pnpm add @rebasepro/mcp
```

Or run directly:

```bash
npx rebase-mcp
```

## What This Package Does

`@rebasepro/mcp` implements the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, allowing AI assistants (Gemini, Claude, Cursor, etc.) to interact with a Rebase project. It provides tools and exposes collection definitions and generated schemas as MCP resources. It has native support for managing multiple local and remote projects.

## Multi-Project Support

The MCP server supports managing multiple Rebase projects simultaneously. This is ideal when working in an IDE with multiple open workspaces or when interacting with both local development servers and remote staging/production environments.

- **Registry**: Project configurations are stored in `~/.rebase/projects.json`.
- **Auto-Discovery**: If `rebase dev` is running locally, the MCP server automatically discovers the active development port and service key from `.rebase/state.json` inside the project directory, giving you **zero-config local development**.
- **Default Project**: If no project registry exists, a default project named `default` is created using `REBASE_PROJECT_DIR` (or current working directory), `REBASE_BASE_URL`, and `REBASE_API_TOKEN`.

A token registered for a project **takes precedence over auto-discovery**. Discovery reads the dev server's *service key*, which is an unscoped admin secret — so if you deliberately register a narrow `rk_live_*` API key for a project, that key is what gets used, even while `rebase dev` is running. Discovery only fills in a token when none is registered.

## Configuration

The server reads configuration from environment variables and `.env` files:

| Variable | Default | Description |
|---|---|---|
| `REBASE_PROJECT_DIR` | `process.cwd()` | Project root directory (fallback if no registry) |
| `REBASE_BASE_URL` | `http://localhost:3001` | Rebase backend URL (fallback if no registry) |
| `REBASE_API_TOKEN` / `REBASE_TOKEN` | (empty) | Auth token for API calls (fallback if no registry) |
| `REBASE_MCP_ALLOW_REMOTE_WRITES` | `false` | Allow destructive tools to run against non-local targets (see below) |

The server attempts to load `.env` from `$REBASE_PROJECT_DIR/.env` or `$REBASE_PROJECT_DIR/app/.env`.

## Destructive-Tool Safety Gate

`rebase_project_add` accepts any `baseUrl`, and the CLI tools connect with whatever `DATABASE_URL` the project's `.env` declares. That means the same tool list that edits a scratch database on your laptop can drop production rows — with nothing in between but the assistant's judgement about which project is currently active.

These tools are therefore refused unless their target is on the loopback interface:

| Tool | Target checked |
|---|---|
| `rebase_db_push` | `DATABASE_URL` |
| `rebase_db_migrate` | `DATABASE_URL` |
| `rebase_db_branch_delete` | `DATABASE_URL` |
| `delete_document` | project `baseUrl` |
| `delete_user` | project `baseUrl` |
| `storage_delete_object` | project `baseUrl` |
| `rebase_auth_reset_password` | project `baseUrl` |

The two targets are not interchangeable: CLI tools never see `baseUrl`, so a localhost backend sitting next to a production `DATABASE_URL` is checked against the database, not the backend.

Only loopback (`localhost`, `127.0.0.0/8`, `::1`) counts as local — private ranges like `10.x` and `192.168.x` do not, since those are as likely to be a shared staging cluster as a laptop. Read-only tools, and writes that only add data (`create_document`, `create_user`), are not gated.

Set `REBASE_MCP_ALLOW_REMOTE_WRITES=true` to opt out.

---

## Tools

### Project Management Tools (6) [NEW]

Manage multiple local projects or remote environments.

| Tool | Required Args | Description |
|---|---|---|
| `rebase_project_list` | (none) | List all registered projects and show which one is currently active |
| `rebase_project_switch` | `name` | Switch the active project to another registered project |
| `rebase_project_add` | `name` | Register a new project (requires `baseUrl` and optional `projectDir`, `token`/`serviceKey`) |
| `rebase_project_remove` | `name` | Remove a project from the registry (cannot remove the default project) |
| `rebase_project_current` | (none) | Show details of the active project (name, directory, base URL, auth token status) |
| `rebase_project_status` | (none) | Perform a health check on the active project's backend URL |

### CLI Tools (6)

Spawn `npx rebase <command>` in the active project directory.

| Tool | Description |
|---|---|
| `rebase_schema_generate` | Generate Drizzle schema from collection definitions |
| `rebase_db_push` | Apply schema directly to DB (dev shortcut) |
| `rebase_schema_introspect` | Introspect live DB → collection definitions |
| `rebase_db_generate` | Generate SQL migration files from schema diff |
| `rebase_db_migrate` | Run pending SQL migrations |
| `rebase_generate_sdk` | Generate typed TypeScript SDK |

### Data Tools (5)

CRUD operations via `@rebasepro/client` on the active project.

| Tool | Required Args | Description |
|---|---|---|
| `list_documents` | `collection` | List with optional `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Get single document by ID |
| `create_document` | `collection`, `data` | Create a new document |
| `update_document` | `collection`, `id`, `data` | Update existing document |
| `delete_document` | `collection`, `id` | Delete a document |

### Admin Tools (6)

User and role management.

| Tool | Required Args | Description |
|---|---|---|
| `list_users` | (none) | List all users with roles |
| `create_user` | `email` | Create user (optional: `displayName`, `password`, `roles`) |
| `update_user` | `userId` | Update user (optional: `email`, `displayName`, `roles`) |
| `delete_user` | `userId` | Delete a user |
| `list_roles` | (none) | List all defined roles |
| `rebase_auth_reset_password` | `email` | Reset a user's password using the admin API (optional: `password`) |

> [!NOTE]
> `rebase_auth_reset_password` now calls the running admin endpoint instead of performing direct database queries. This makes it compatible with both local development and remote servers.

### Dev Server Tools (3)

Manage the local development server.

| Tool | Description |
|---|---|
| `rebase_dev_start` | Start `pnpm run dev` in the `app/` directory |
| `rebase_dev_logs` | Read recent output (default: 50 lines, max buffer: 500) |
| `rebase_dev_stop` | Send SIGTERM to the dev server process |

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
      "args": ["rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

## Related Packages

- `@rebasepro/client` — Used internally for data and admin API calls

