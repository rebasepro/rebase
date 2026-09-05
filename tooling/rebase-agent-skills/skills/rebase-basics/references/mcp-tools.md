# MCP server tools

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
| `rebase_schema_plan` | Show the SQL `rebase_db_push` would run, without running any of it. Read this before proposing a schema change | — |
| `rebase_db_push` | Apply the current Drizzle schema directly to the database (development shortcut, skips migration files). Refuses anything that destroys data — plan it, then ask a human to run `rebase db push --allow-destructive` | — |
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
| `update_user` | Update an existing user (email, display name, roles) | `uid` (required), `email?: string`, `displayName?: string`, `roles?: string[]` |
| `delete_user` | Delete a user from the backend | `uid` (required) |
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
