# @rebasepro/mcp-server

Model Context Protocol (MCP) server that exposes Rebase schema, database, document CRUD, user management, and dev server tools to AI assistants.

## Installation

```bash
pnpm add @rebasepro/mcp-server
```

Or run directly:

```bash
npx rebase-mcp
```

## What This Package Does

`@rebasepro/mcp-server` implements the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, allowing AI assistants (Gemini, Claude, Cursor, etc.) to interact with a Rebase project. It provides 20 tools across four categories and exposes collection definitions and generated schemas as MCP resources.

## Configuration

The server reads configuration from environment variables and `.env` files:

| Variable | Default | Description |
|---|---|---|
| `REBASE_PROJECT_DIR` | `process.cwd()` | Project root directory |
| `REBASE_BASE_URL` | `http://localhost:3001` | Rebase backend URL |
| `REBASE_API_TOKEN` / `REBASE_TOKEN` | (empty) | Auth token for API calls |

The server attempts to load `.env` from `$REBASE_PROJECT_DIR/.env` or `$REBASE_PROJECT_DIR/app/.env`.

## Tools

### CLI Tools (6)

Spawn `npx rebase <command>` in the project directory.

| Tool | Description |
|---|---|
| `rebase_schema_generate` | Generate Drizzle schema from collection definitions |
| `rebase_db_push` | Apply schema directly to DB (dev shortcut) |
| `rebase_schema_introspect` | Introspect live DB → collection definitions |
| `rebase_db_generate` | Generate SQL migration files from schema diff |
| `rebase_db_migrate` | Run pending SQL migrations |
| `rebase_generate_sdk` | Generate typed TypeScript SDK |

### Data Tools (5)

CRUD operations via `@rebasepro/client`.

| Tool | Required Args | Description |
|---|---|---|
| `list_documents` | `collection` | List with optional `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Get single document by ID |
| `create_document` | `collection`, `data` | Create a new document |
| `update_document` | `collection`, `id`, `data` | Update existing document |
| `delete_document` | `collection`, `id` | Delete a document |

### Admin Tools (5)

User and role management.

| Tool | Required Args | Description |
|---|---|---|
| `list_users` | (none) | List all users with roles |
| `create_user` | `email` | Create user (optional: `displayName`, `password`, `roles`) |
| `update_user` | `userId` | Update user (optional: `email`, `displayName`, `roles`) |
| `delete_user` | `userId` | Delete a user |
| `list_roles` | (none) | List all defined roles |

### Dev Server Tools (3)

Manage the local development server.

| Tool | Description |
|---|---|
| `rebase_dev_start` | Start `pnpm run dev` in the `app/` directory |
| `rebase_dev_logs` | Read recent output (default: 50 lines, max buffer: 500) |
| `rebase_dev_stop` | Send SIGTERM to the dev server process |

## Resources

The server exposes MCP resources for AI context:

| URI | Description |
|---|---|
| `rebase://collections/{name}` | TypeScript source of a collection definition |
| `rebase://schema` | Generated Drizzle schema (`schema.generated.ts`) |

Collection files are discovered from `app/config/collections/`, `config/collections/`, or `collections/` under the project directory.

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
