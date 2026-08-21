---
title: CLI Reference
sidebar_label: CLI
description: Rebase CLI commands for project initialization, schema generation, database migrations, and SDK generation.
---

## Overview

The Rebase CLI (`rebase`) manages your project from scaffolding to deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Or use via `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Commands

### `rebase init`

Initialize a new Rebase project:

```bash
rebase init [directory]
```

Sets up the project structure with frontend, backend, and shared packages.

### `rebase dev`

Start the development server:

```bash
rebase dev
```

Starts both frontend and backend with hot reloading.

Both ports are derived from the project's path so several Rebase projects can run
side by side. Use the URLs `rebase dev` prints. Pin one with `rebase dev --port 3001`.

### `rebase build`

Build the project into a deployable bundle in `dist-bundle/`:

```bash
rebase build
```

The bundle is the artifact you deploy — the runtime image loads it, so there is no
application image to build yourself. Useful flags:

| Flag | Effect |
|------|--------|
| `--out <dir>` | Write the bundle somewhere other than `dist-bundle/` |
| `--vendor` | Always install and ship the bundle's dependencies |
| `--no-vendor` | Never vendor; the pod installs on first start |
| `--skip-type-check` | Skip typechecking (faster, less safe) |
| `--no-static` | Skip building the frontend |

Dependencies are vendored by default so a pod restart does not pay a 35–55 second
install. A tree that grows past 200 MB on disk is dropped instead, because the
upload limit is 100 MB compressed — see the changelog for the reasoning.

### `rebase start`

Run the built bundle as a production server:

```bash
rebase start
```

Reads `PORT` and the rest of `.env`, unlike `rebase dev`. Point it at a bundle
elsewhere with `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Show the apps this repository declares:

```bash
rebase apps list
```

A repository can declare more than one deployable app — a backend and a marketing
site, say. This is how you see what `rebase build` and deployment will act on.

### `rebase eject`

Take ownership of the server process and its image:

```bash
rebase eject
```

Writes the backend entrypoint and a `Dockerfile` into the project and flips its
backend over, so the repository builds its own image instead of running the
published runtime. From then on **platform runtime upgrades no longer reach it**,
and CORS, auth wiring, storage and shutdown become yours to configure.

Preview it with `rebase eject --dry-run`, which lists what would change and
changes nothing. `--force` replaces an existing `backend/src/index.ts` or
`env.ts`, keeping the current file as `<name>.bak`.

### `rebase schema generate`

Generate Drizzle ORM schema from your TypeScript collections:

```bash
rebase schema generate
```

This reads your collections from `config/collections/` and generates `backend/src/schema.generated.ts` with Drizzle table definitions, enums, and relations.

### `rebase db push`

Push schema changes directly to the database (development only):

```bash
rebase db push
```

:::caution
`db push` modifies the database directly without migration files. Use `db generate` + `db migrate` for production.
:::

### `rebase db generate`

Generate SQL migration files from schema changes:

```bash
rebase db generate
```

Creates timestamped migration files in `drizzle/` that can be reviewed and committed.

### `rebase db migrate`

Run pending database migrations:

```bash
rebase db migrate
```

Applies all unapplied migrations to the database.

### `rebase generate-sdk`

Generate a typed client SDK from your collection definitions:

```bash
rebase generate-sdk
```

Creates TypeScript types and a type-safe client for all your collections.

### `rebase doctor`

Run diagnostics to detect drift between your collections, the generated schema, and the current database state:

```bash
rebase doctor
```

### `rebase auth`

Authentication management commands:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Manage scoped service API keys — the credential an agent, script or another
service uses, as opposed to an end user's session:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` takes a JSON array of `{ collection, operations }` objects, or use
`--full-access` for read/write/delete on every collection and function. `--expires`
accepts `7d`, `30d`, `90d`, `1y` or an ISO date, and `--rate-limit` sets requests
per 15-minute window. A key is shown once, at creation.

Keys are double-gated: the key's own permissions and the row-level security of the
identity it acts as both apply, so a key can never read more than that identity can.

### `rebase skills install`

Install the Rebase reference skills for your AI coding assistant. Supports
Cursor, Claude Code, Windsurf, Gemini CLI and Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

See [Agent Skills](/docs/ai/skills) for the full list and where files are written.

### `rebase telemetry`

Anonymous usage sharing. **Opt-in, and off unless you turned it on:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` prints the current setting, `show` prints exactly what would be sent, and
the other two change it. `rebase init` asks once; if you never ran `init`, nothing
was ever collected.

## Migration Workflow

The typical workflow for schema changes:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Next Steps

- **[Schema as Code](/docs/architecture/schema-as-code)** — How schema generation works
- **[Quickstart](/docs/getting-started/quickstart)** — Get started
