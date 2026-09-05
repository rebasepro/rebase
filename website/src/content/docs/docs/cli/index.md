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

The target is always this project's local development database and cannot be
chosen: `--database-url` is refused rather than accepted, so there is no way to
spell "pull into production". `--from` is the only direction.

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
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL will not copy or drop a database anything else is connected to, and
the usual "anything else" is your own `rebase dev`. `create` and `delete` name
what is holding the database open; `--force` disconnects those sessions first.

<span class="since-badge" data-since="0.18">Since 0.18</span> Every branch is a full copy on disk, so they need clearing out. `prune` removes
three things: an entry whose database was dropped outside Rebase, a branch
database whose entry was never written, and — only with `--older-than` — branches
past an age you name. It asks before removing anything unless you pass `--yes`.

<span class="since-badge" data-since="0.18">Since 0.18</span> `switch` records the branch in `.rebase/branch.json` and never edits `.env`. It
takes precedence over `DATABASE_URL` in `.env` and loses to `--database-url` or a
`DATABASE_URL` in the shell, so a flag on the command line always outranks a
switch made earlier. Deleting the branch you are on returns you to the main
database rather than leaving the checkout pointed at a database that is gone.

:::note[Not on the managed development database]
`push`, `generate` and `migrate` plan their work with Atlas, which needs a second
empty database to compare against — and the managed PGlite serves exactly one.
Running them there stops with a message saying so. Point `DATABASE_URL` at a real
PostgreSQL for the migration workflow; `rebase dev` already creates missing tables
additively on the managed one.

`branch` is refused there for a related reason. `CREATE DATABASE ... TEMPLATE`
against PGlite writes a catalog entry and copies nothing, so the branch would
resolve to the database it was cloned from — every write you meant to sandbox
would land in your development database. `rebase dev --docker` gives you a real
server that branches work against.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Everything this project declares, and whether the environment actually binds it:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  config/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Three files decide what a backend can reach, and this prints all three together:
`rebase.json` says where your code is and who runs the server,
`config/resources.ts` says what the project needs, and the environment says how
to reach each thing. Everything else — `rebase.resources.json`, the bundle
manifest — is generated from the middle one for readers that cannot run your
code, and you never write it.

A `○` is the state worth knowing about before a deploy rather than after:
declared, not configured. A `✗` means the environment sets something *wrongly*,
which refuses the boot rather than degrading.

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

Every group answers `--help`, and `--help` never runs the command. Most commands
act on the linked project in `.rebase/cloud.json`; `--project <id>` operates on
one without linking.

Three options apply everywhere: `--json` for machine-readable output (also the
default when piped, or with `REBASE_JSON=1`), `--url <origin>` to target a
specific control plane (or `REBASE_CLOUD_URL`), and `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Project link

```bash
rebase cloud link       # link this directory to a cloud project
rebase cloud unlink     # remove the link
rebase cloud use [org]  # select the active organization
rebase cloud open       # open the dashboard in a browser
```

#### Projects

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` with no app name deploys the backend.

#### Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organizations

```bash
rebase cloud orgs list | create | members
```

#### Databases

```bash
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Resources

What the project reserves, and what that costs.

```bash
rebase cloud resources          # the current reservation and its monthly cost
rebase cloud resources set      # change it
```

`resources set` takes `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` and `--no-autoscale`.
There are no plan tiers: everything is priced per resource. See
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, webhooks, clusters and billing

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters            # the clusters tenants run on
rebase cloud clusters add        # register one from a kubeconfig
rebase cloud clusters verify     # ask a cluster whether it can host tenants
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
```

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
