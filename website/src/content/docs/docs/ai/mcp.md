---
title: MCP Server
sidebar_label: MCP Server
description: Connect Claude Code, Cursor, Gemini CLI or any MCP client to a Rebase project — the 42 tools it exposes, the credential it authenticates with, and the loopback gate that stands between an agent and production.
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

A deployed backend can also serve MCP itself, over HTTP, to the people who use
your application. That is a different thing with a different credential model:
see [The remote endpoint](#the-remote-endpoint).

## Connecting a client

The server runs from your project: `@rebasepro/mcp` is a devDependency every
`rebase init` scaffold pins with the CLI, and each block below — the whole
integration — starts that copy (`pnpm exec rebase-mcp`, or `npx --no rebase-mcp`
in an npm project), never a newer one from npm. An older project adds it once,
with `rebase skills install --mcp` or `pnpm add -D @rebasepro/mcp`.

<span class="since-badge" data-since="0.24">Since 0.24</span> `rebase init` writes the block for each agent you pick when it
[sets up your AI coding agents](/docs/ai/skills#set-up-by-rebase-init), keeping
any other servers already in the file. `rebase init --agent cursor,codex` does
the same without asking.

**Claude Code** — `.mcp.json` at your project root. `rebase init` writes this
file for you:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — the same shape, in `.cursor/mcp.json`. Cursor expands
`${workspaceFolder}` to the project root:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json`, under the same key:

```json title=".gemini/settings.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — TOML rather than JSON, in the project's `.codex/config.toml`.
Codex reads a project config only once you have trusted the project:

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**GitHub Copilot in VS Code** — `.vscode/mcp.json`, under `servers` and with
an explicit transport:

```json title=".vscode/mcp.json"
{
  "servers": {
    "rebase": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** reads MCP servers only from its user-level config, so there is no
project file to write. Add the server in its MCP settings as `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, with that path as `REBASE_PROJECT_DIR`.

Any MCP client that can spawn a stdio server works; the shape is the same.

### Which directory it acts on

`REBASE_PROJECT_DIR` is the directory containing `rebase.json`. There is **one**
precedence, and it is the same in every client:

1. **The environment block** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. If any of them is set, the `default` project is rebuilt
   from them on every start.
2. **The server's working directory**, when it holds a `rebase.json`. A project
   you are standing in outranks anything remembered in `~/.rebase/projects.json`.
3. **The persisted `default`** in `~/.rebase/projects.json`, when neither of the
   first two says anything.

Auto-discovery from `.rebase/state.json` fills gaps in all three cases and never
overrules a value one of them supplied.

The project-level blocks name the project — `"."`, the client's working
directory, or the editor's `${workspaceFolder}` — because rule 3 reads a file
shared by every project on the machine. A user-level config, such as Windsurf's,
names an absolute path instead.

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
identity holds every [scope](/docs/backend/roles-and-scopes/), and it satisfies the
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

<span class="since-badge" data-since="0.24">Since 0.24</span> Register a scoped [API key](/docs/backend/api-keys) and the two-gate model
applies for real. A service key runs with the roles `["service"]`, which the
injected admin policies do **not** name — so RLS grants it nothing unless one of
your own policies says otherwise, and its scopes narrow it further:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Then hand the resulting `rk_live_…` key to the server rather than letting it
discover a service key:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
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
- **A key reaches an admin tool only with that tool's scope.** `list_users` and
  `list_roles` need `users:read`; `create_user`, `update_user`, `delete_user` and
  `rebase_auth_reset_password` need `users:write`; the storage and cron tools
  need the matching `storage:*` or `cron:*` scope; `invoke_function` needs
  `functions:invoke`. Without
  it the call answers `403 SCOPE_MISSING`. Even with `users:write`, a key cannot
  change an admin's account: an admin holds `keys:read` and `keys:write`, which no
  key can, and nobody may manage an account that holds more than they do.

A key created with `--roles admin` is a different matter: it carries the roles
`["service", "admin"]`, which clears the same default admin policies the service
key does. Give it `--full-access` as well and its reach is the service key's,
less key management. What it adds is that it is **revocable, expirable and
rate-limited per key**, none of which is true of the service key — rotating that
means editing `.env` and restarting the server.

See [Agents and MCP Servers](/docs/backend/api-keys#agents-and-mcp-servers) for the
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

- **Not gated — reads:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Not gated — local only:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
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
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Anything stored in your database was written by somebody, and it arrives on the
same channel as the tool contract the assistant is following. The envelope tells
the model to treat it as inert content rather than instructions.

The `id` is minted fresh for every response, after the data was written, and
only the end marker carrying it closes the block. Text inside the data that is
shaped like a marker is broken with a zero-width space, so a row that prints
`<<<END_UNTRUSTED_DATA>>>` cannot end the envelope early and put what follows it
outside.

The [remote endpoint](#the-remote-endpoint) fences its tool results the same
way and says so to the client; its `structuredContent` carries the plain result.

It is a marker, not a sandbox. An assistant holding these tools is only as safe
as the content you let it read.

## Multiple projects

Project configurations are stored in `~/.rebase/projects.json`, and the server
can hold several at once — useful when you work across local and remote
environments. While `rebase dev` is running, the server reads the active port and
service key from `.rebase/state.json` in the project directory, which is what
makes the local case zero-config.

:::note[The registry is the last word, not the first]
The precedence is the one above: environment block, then the working directory
when it holds a `rebase.json`, then the persisted `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` and `REBASE_API_TOKEN` rebuild the
`default` project **on every start**, not just the first one. The rebuild is
whole-entry: a token registered against the old `projectDir` is dropped rather
than carried into a directory it was never issued for. A `default` derived that
way — or from the working directory — is never written back to
`~/.rebase/projects.json`, so one project's dev service key cannot become
another's.

`activeProject` is sticky, so if a previous session called
`rebase_project_switch`, tools target that project and the server says so on
stderr — unless that project is registered under a *different* directory from
the one this server runs in, in which case it falls back to `default` and says
so. If an assistant seems to be reading the wrong database, call
`rebase_project_current` first.
:::

Tokens are stored in that registry **in plaintext**. It is a file in your home
directory holding admin credentials for every project you have registered; treat
it accordingly.

## Tool reference

42 tools, in nine groups: schema and database, schema planning, documents, users
and roles, storage, cron, functions, the dev server and the project registry.
Each one, with what it needs and whether the gate refuses it against a non-local
target, is in the [MCP tool reference](/docs/ai/mcp-tool-reference).

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

`rebase://schema` is listed **only if** the generated schema exists.
`findBackendDir` looks for `backend/` and then `app/backend/` under the active
project directory, and reads `src/schema.generated.ts` from whichever it finds —
so both the scaffolded layout and this monorepo's work, and a project laid out a
third way, or one that has not run `rebase schema generate` yet, simply will not
see the resource offered.

## The remote endpoint

Everything above is a developer tool: it runs on your machine and holds a service
key or an API key. A deployed backend can also serve MCP itself, at `/mcp`, for
the people who use your application. An assistant one of them connects reads and
writes the project **as that person**, and every call runs under their own
row-level security.

It is off unless you turn it on, and both variables are required:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Without `REBASE_PUBLIC_URL`, a JWT secret, or a data driver that can scope a query
to one user, the endpoint declines to mount and says why in the boot log. No
`REBASE_ROLE` turns it on.

- **OAuth, with a consent screen.** A client finds the authorization server
  through `/.well-known/oauth-protected-resource`, registers itself (dynamic
  registration is on by default; `REBASE_MCP_OPEN_REGISTRATION=false` limits it
  to clients you register), and sends the person to a consent screen that signs
  them in through your existing `/auth/login`.
- <span class="since-badge" data-since="0.24">Since 0.24</span> **Seven tools, three scopes.** The same [scopes](/docs/backend/roles-and-scopes/)
  every credential uses. `data:read` offers `list_collections`,
  `query_collection`, `count_documents` and `get_document`; `data:write` adds `create_document` and
  `update_document`; `data:delete` adds `delete_document`. A client that asks for
  nothing gets `data:read`. Each one narrows to a collection: `data:read:posts`
  lists and reads `posts` and nothing else. A scope decides which tools are
  offered and which collections they reach, not which rows: an empty list can be
  RLS working, and `data:write` still cannot write a row the person could not.
- **Grants made before 0.24 keep their reach.** `mcp:read` is read as
  `data:read`, and `mcp:write` as `data:write data:delete`, on stored grants and
  on tokens already issued.
- <span class="since-badge" data-since="0.24">Since 0.24</span> **An API key works too.** `/mcp` also accepts `Authorization: Bearer rk_…`, for
  a client configured with a header rather than an OAuth flow. The key reaches
  the tools its `data:*` scopes cover, as whoever it acts as: a
  [personal key](/docs/backend/api-keys/#personal-keys) as its owner, a service key
  as `api-key:<id>`.
- **The SDK's vocabulary, REST's answers.** The tools take what the SDK takes —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` or
  `"created_at:desc"`), `limit`, `offset`, `searchString`, and `data` for a
  write — and read through `GET /api/data/<collection>`'s path, so a row comes
  back as REST serves it (ISO dates, a `belongsTo` as its foreign key, e.g.
  `authorId`) and can be sent back in an update unchanged. `query_collection`
  answers `{ data, meta }` with `meta.total` and `meta.hasMore`, `count_documents`
  `{ count }`, and `list_collections` each collection's OpenAPI `row` and
  `create` schemas, plus `softDeleteField` where rows go to a trash. As on REST,
  a `limit` above 1000, an undeclared argument and an edit or delete of a trashed
  row (404) are refused; setting the soft-delete field to `null` restores it.
- **A token for this endpoint only.** An MCP access token is refused by
  `/api/data`, `/api/admin` and the WebSocket, so connecting an assistant does not
  hand it a session.

One limit. Disconnecting a client (`DELETE /api/oauth/grants/:clientId`, with the
person's own session) revokes its refresh tokens at once, but an access token
already issued keeps working until it expires, within the hour. The same hour
bounds everything else: every refresh re-reads the person's roles, and refuses
an account that was deleted or a grant older than its last "sign out everywhere"
or password change. So a demotion or a sign-out reaches a connected client
within one access-token lifetime. A guest session cannot consent at all.

The routes are in [Endpoints](/docs/backend/endpoints/#mcp-surface) and the
variables in [Configuration](/docs/getting-started/configuration/#mcp-surface).

## Recommended setup

- Point the server at a **local** project and leave `REBASE_MCP_ALLOW_REMOTE_WRITES`
  unset. The gate is the single most valuable thing in the package.
- For anything remote, register a **scoped `rk_` API key** rather than letting
  discovery hand over a service key.
- Check `rebase_project_current` when output looks wrong. The active project is
  sticky and lives outside your repo.
- Treat `~/.rebase/projects.json` as a secrets file.
