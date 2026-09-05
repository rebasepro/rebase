---
title: MCP Server
sidebar_label: MCP Server
description: Connect Claude Code, Cursor, Gemini CLI or any MCP client to a Rebase project — the 41 tools it exposes, the credential it authenticates with, and the loopback gate that stands between an agent and production.
---

`@rebasepro/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that hands an AI assistant real tools over a Rebase project: read and
write rows, manage users, run migrations, invoke functions, drive the dev
server.

It speaks MCP over **stdio only**. There is no port and no listener — the
process is exactly as trusted as whatever spawned it, and there is no remote
caller to authenticate. That is the safe part. The interesting questions are all
about what it does *once* it is running, and this page answers them before it
shows you the config block.

## Connecting a client

The server is published to npm and needs no install step; `npx` fetches it.
Every block below is the whole integration.

**Claude Code** — `.mcp.json` at your project root. `rebase init` writes this
file for you:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Cursor** — the same shape, in `.cursor/mcp.json`:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json`, under the same key:

```json title=".gemini/settings.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Codex CLI** — TOML rather than JSON, in `~/.codex/config.toml`. It is
user-level, not per-project, so name the project directory here:

```toml title="~/.codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]
env = { REBASE_PROJECT_DIR = "/absolute/path/to/your/project" }
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

Any MCP client that can spawn a stdio server works; the shape is the same.

### Which directory it acts on

`REBASE_PROJECT_DIR` should be the directory containing `rebase.json`. Omit it
and the server uses its working directory, which for a project-level config file
is the project — that is why only the user-level Codex block sets it.

Set it and it wins: the environment rebuilds the `default` project on every
start, so an absolute path in a per-user config outranks anything remembered in
`~/.rebase/projects.json`.

## What the server can reach

This is the section to read before pointing an assistant at a database you care
about.

The server carries **one ambient credential for the whole process**. There is no
per-tool identity and no read-only mode; every tool uses the same token, and the
only switch in the package opts *in* to more reach rather than less.

Which credential that is, in priority order:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` from the environment
2. `REBASE_SERVICE_KEY` read out of the project's `.env`
3. The service key auto-discovered from `.rebase/state.json` while `rebase dev`
   is running

A token you register for a project **wins over auto-discovery**. Discovery only
fills a gap.

:::danger[The zero-config path is an admin credential]
Options 2 and 3 are the **service key** — an unscoped admin secret. The backend
resolves it to `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. That
identity skips the API-key permission list entirely, and it satisfies the
`_default_admin_read` / `_default_admin_write` policies that Rebase injects into
every collection that has not set `disableDefaultPolicies`.

So the honest answer to "does RLS still constrain it?" is: RLS *runs* — the
driver does downgrade to the `rebase_user` role — and then a policy Rebase
itself wrote grants that identity everything. Reading every row of every
collection is the **designed behaviour of the default configuration**, not a
bypass.

With the zero-config setup, an agent holding these tools can read and write every
row of every collection, list every user, reset any password, invoke any backend
function, and run DDL against whatever `DATABASE_URL` the project resolves.
:::

### Giving it a narrow credential instead

Register a scoped [API key](/docs/backend/api#api-keys) and the two-gate model
applies for real. A non-admin key runs with the roles `["service"]`, which the
injected admin policies do **not** name — so RLS grants it nothing unless one of
your own policies says otherwise, and the permission list narrows it further:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Then hand the resulting `rk_live_…` key to the server rather than letting it
discover a service key:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Two things this does **not** do, both worth knowing before you rely on it:

- **It does not narrow the CLI tools.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` and the branch tools spawn the Rebase CLI, which connects with
  `DATABASE_URL` and never sees your token at all. The loopback gate below is the
  only thing standing in front of those.
- **A non-admin key cannot use the admin tools.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` and `rebase_auth_reset_password`
  live behind `requireAdmin` and will fail with a scoped key. That is the system
  working, but it does mean choosing between reach and narrowness rather than
  getting both.

An API key with `admin: true` is a different matter: it carries the roles
`["admin", "service"]`, which clears the same default admin policies the service
key does. On the data plane its reach is the service key's. What it adds is that
it is **revocable, expirable and rate-limited per key**, none of which is true of
the service key — rotating that means editing `.env` and restarting the server.

See [Agents and MCP Servers](/docs/backend/api#agents-and-mcp-servers) for the
key-scoping guidance in full.

### Putting a collection out of reach entirely

The reason an admin credential reads everything is the baseline policy Rebase
injects into each collection, granting the trusted server context and the
`admin` role. A collection can opt out of that baseline and take full
responsibility for its own RLS:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const medicalRecordsCollection = defineCollection({
    slug: "medical_records",
    name: "Medical records",
    table: "medical_records",
    properties: {
        patient_id: { name: "Patient", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Now the only way in is to match `patient_id`. The service key's uid is the
literal string `service`, so an owner rule never matches it — reads return zero
rows and writes are rejected by Postgres. This is the one control that constrains
the MCP server's default credential rather than assuming it away.

Remember that this is a real RLS change, not a documentation one: it takes effect
only once `rebase schema generate` and a migration have applied the policies. See
[Security Rules (RLS)](/docs/collections/security-rules).

## The loopback gate

`rebase_project_add` accepts any `baseUrl`, and the CLI tools connect with
whatever `DATABASE_URL` the project declares. The same tool list that edits a
scratch database on your laptop can therefore drop production rows, with nothing
in between but the assistant's judgement about which project is active.

**Every tool that changes the target environment is refused unless that target is
on the loopback interface.** The gate is written as a list of what is *not*
gated, so a tool added later arrives protected by default.

- **Not gated — reads:** `rebase_schema_plan`, `rebase_schema_introspect`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_metadata`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Not gated — local only:** `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, the dev-server tools and the project-registry tools.
  These write local files or local state and have no remote target to check.
- **Gated against `DATABASE_URL`:** the remaining CLI tools — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gated against the project `baseUrl`:** the remaining SDK tools —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

The two targets are not interchangeable. CLI tools never see `baseUrl`, so a
localhost backend sitting next to a production `DATABASE_URL` is checked against
the database, not the backend.

A refusal looks like this:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**If no connection string can be resolved at all, the DB tools are refused** —
an unverifiable target is not a safe one:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Only loopback counts as local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Private ranges like `10.x` and `192.168.x` do **not** — those are as likely to be
a shared staging cluster as a laptop, and treating them as local would wave
through exactly the accident the gate exists to stop.

Set `REBASE_MCP_ALLOW_REMOTE_WRITES=true` to opt out. Setting it globally in your
MCP client config removes the gate for every project the server can reach, not
just the one you were thinking about.

## Untrusted-data marking

Rows, user records, storage listings, cron jobs, function responses and CLI
output come back wrapped in an explicit envelope:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Anything stored in your database was written by somebody, and it arrives on the
same channel as the tool contract the assistant is following. The envelope tells
the model to treat it as inert content rather than instructions.

It is a marker, not a sandbox. An assistant holding these tools is only as safe
as the content you let it read.

## Multiple projects

Project configurations are stored in `~/.rebase/projects.json`, and the server
can hold several at once — useful when you work across local and remote
environments. While `rebase dev` is running, the server reads the active port and
service key from `.rebase/state.json` in the project directory, which is what
makes the local case zero-config.

:::note[The environment block wins over the registry]
`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` and `REBASE_API_TOKEN` rebuild the
`default` project **on every start**, not just the first one. The rebuild is
whole-entry: a token registered against the old `projectDir` is dropped rather
than carried into a directory it was never issued for.

The persisted `default` is used only when the client's config sets none of the
three. `activeProject` is still sticky, so if a previous session called
`rebase_project_switch`, tools target that project and the server says so on
stderr. If an assistant seems to be reading the wrong database, call
`rebase_project_current` first.
:::

Tokens are stored in that registry **in plaintext**. It is a file in your home
directory holding admin credentials for every project you have registered; treat
it accordingly.

## Tool reference

41 tools, in eight groups. Tools marked ⚠ are refused against non-local targets
unless you opt out.

### Schema & database (12)

Spawn the Rebase CLI in the active project directory.

| Tool | Required | Description |
|---|---|---|
| `rebase_schema_plan` | — | Show the SQL `rebase_db_push` would run, without running any of it |
| `rebase_schema_generate` | — | Generate Drizzle schema from collection definitions |
| `rebase_db_push` ⚠ | — | Apply the schema directly to the database (dev shortcut) |
| `rebase_schema_introspect` | — | Introspect the live database into collection definitions |
| `rebase_db_generate` | — | Generate SQL migration files from schema changes |
| `rebase_db_migrate` ⚠ | — | Run all pending SQL migrations |
| `rebase_generate_sdk` | — | Generate the fully-typed TypeScript SDK |
| `rebase_doctor` | — | Detect drift between definitions, generated schema and the live database |
| `rebase_db_branch_create` ⚠ | `name` | Create a database branch (admins only) |
| `rebase_db_branch_list` | — | List database branches (admins only) |
| `rebase_db_branch_delete` ⚠ | `name` | Delete a database branch (admins only) |
| `rebase_db_branch_info` | `name` | Branch information and status (admins only) |

### Documents (5)

| Tool | Required | Description |
|---|---|---|
| `list_documents` | `collection` | List rows, with optional `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Fetch a single row by ID |
| `create_document` ⚠ | `collection`, `data` | Create a row |
| `update_document` ⚠ | `collection`, `id`, `data` | Update a row |
| `delete_document` ⚠ | `collection`, `id` | Delete a row |

### Users & roles (6)

| Tool | Required | Description |
|---|---|---|
| `list_users` | — | List all users, including roles |
| `create_user` ⚠ | `email` | Create a user (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | Update email, display name or roles |
| `delete_user` ⚠ | `uid` | Delete a user |
| `list_roles` | — | List defined roles |
| `rebase_auth_reset_password` ⚠ | `email` | Reset a password via the admin API |

`create_user` and `update_user` both accept `roles`, so either can mint an
admin. That is why they are gated rather than treated as merely "additive".

### Storage (3)

| Tool | Required | Description |
|---|---|---|
| `storage_list_objects` | — | List stored objects |
| `storage_get_metadata` | `key` | Metadata plus a temporary signed download URL |
| `storage_delete_object` ⚠ | `key` | Delete an object |

`storage_get_metadata` is classified as a read because it does not change the
environment — but the signed URL it mints is a bearer capability that outlives
the tool call.

### Cron (5)

| Tool | Required | Description |
|---|---|---|
| `cron_list_jobs` | — | List scheduled jobs and their status |
| `cron_get_job` | `jobId` | Job details |
| `cron_get_job_logs` | `jobId` | Execution logs |
| `cron_trigger_job` ⚠ | `jobId` | Run a job immediately |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Enable or disable a job |

`cron_toggle_job` can silently disable a backup or a billing job — a change with
no error and no output until something is missing later.

### Functions (1)

| Tool | Required | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoke a [custom function](/docs/backend/custom-functions) with any method and payload |

This calls code the MCP server has never seen, with a method and body the model
chose. Its blast radius is whatever your functions do.

### Dev server (3)

| Tool | Required | Description |
|---|---|---|
| `rebase_dev_start` | — | Start the dev server; returns immediately |
| `rebase_dev_logs` | — | Read recent output (default 50 lines, 500-line buffer) |
| `rebase_dev_stop` | — | Stop the dev server |

### Project registry (6)

| Tool | Required | Description |
|---|---|---|
| `rebase_project_list` | — | List registered projects and show the active one |
| `rebase_project_switch` | `name` | Change the active project |
| `rebase_project_add` | `name` | Register a project (`baseUrl`, optional `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Remove a project (the default project cannot be removed) |
| `rebase_project_current` | — | Show the active project and its auth status |
| `rebase_project_status` | — | Health-check the active backend |

`rebase_project_switch` is not gated, because it retargets everything else
rather than acting on a target itself. An assistant can therefore switch to a
remote project without tripping the gate — it just cannot then run a destructive
tool there.

## Resources

Beyond tools, the server exposes MCP resources so a client can pull project
context without spending a tool call:

| URI | Description |
|---|---|
| `rebase://collections/{name}` | TypeScript source of a collection definition |
| `rebase://schema` | The generated Drizzle schema (`schema.generated.ts`) |

Collections are discovered from `app/config/collections/`,
`config/collections/` or `collections/` under the active project directory —
whichever exists.

`rebase://schema` is listed **only if** the generated schema is at exactly
`app/backend/src/schema.generated.ts`. That is a single hardcoded path with no
fallbacks, so a project laid out differently — or one that has not run
`rebase schema generate` yet — simply will not see the resource offered. If it
is missing and you expected it, check the path before concluding the server is
broken.

## Recommended setup

- Point the server at a **local** project and leave `REBASE_MCP_ALLOW_REMOTE_WRITES`
  unset. The gate is the single most valuable thing in the package.
- For anything remote, register a **scoped `rk_` API key** rather than letting
  discovery hand over a service key.
- Check `rebase_project_current` when output looks wrong. The active project is
  sticky and lives outside your repo.
- Treat `~/.rebase/projects.json` as a secrets file.
