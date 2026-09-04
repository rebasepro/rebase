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

| Flag | What it does |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` or `blank`. Default `blog` |
| `--headless` | Backend only — no admin panel and no collection files. `--template` has no effect, because there are no collections to seed |
| `-y, --yes` | Accept every default and never prompt. **Required wherever there is no terminal to answer**, such as CI |
| `-i, --install` | Install dependencies after scaffolding |
| `-g, --git` | Initialize a repository and make the first commit |
| `--database-url <url>` | Use an existing database instead of the managed one |
| `--introspect` | Generate collections from that database. Implies `--template blank` and needs `--install` |
| `--project <slug>` | Link the scaffold to a Rebase Cloud project |
| `--setup-key <key>` | The one-time key authenticating that link |

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

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` runs `pg_dump`; `restore` runs `pg_restore` and is destructive, so it
requires `--yes`. `--out` accepts a local path or an object-storage URL, and
defaults to `$BACKUP_DESTINATION` or `./backups`.

### `rebase db pull`

Copy another database into the local development one:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` replaces personal fields on the way in, so a production copy can be
worked on locally without carrying real customer data onto a laptop.

`pg_dump` strips privileges, so the copy would arrive with the source's RLS
policies and none of the grants behind them — every read as `rebase_user` failing
with `permission denied`. The pull re-provisions the app role afterwards, using
the same routine boot and `rebase db push` use, so Rebase's internal tables stay
revoked as they should be.

### `rebase db stop` / `rebase db reset`

For the managed development database only:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch delete <name>
```

:::note[Not on the managed development database]
`push`, `generate` and `migrate` plan their work with Atlas, which needs a second
empty database to compare against — and the managed PGlite serves exactly one.
Running them there stops with a message saying so. Point `DATABASE_URL` at a real
PostgreSQL for the migration workflow; `rebase dev` already creates missing tables
additively on the managed one.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase resources`

What this project declares it needs — the databases, buckets and topics its
config code asks for:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

A resource is declared in config code — `database("analytics")`,
`bucket("media")`, `topic("signups")` — and never by hand in
`rebase.resources.json`, which is generated from those declarations so a host can
read what a project needs without building it.

### `rebase cloud`

Everything to do with Rebase Cloud, which is in private beta. See the
[Rebase Cloud guide](/docs/deployment/cloud/) for what it is and what the beta
does not include.

```bash
rebase cloud login | logout | whoami
rebase cloud link | unlink | use | open
rebase cloud projects list | create | info | delete
rebase cloud deploy [--bundle]
rebase cloud logs [--runtime]
rebase cloud deployments | rollback | cancel
rebase cloud start | stop | restart
rebase cloud status | metrics | debug
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud db list | create | info | test | backup | pitr
rebase cloud extensions list | enable | disable
rebase cloud storage | settings | orgs | webhooks | billing | clusters
```

Every group answers `--help`, and `--help` never runs the command.

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
