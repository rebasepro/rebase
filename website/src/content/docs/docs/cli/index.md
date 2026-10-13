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

Or run any command without installing it: `pnpm dlx @rebasepro/cli <command>`.

## Machine-readable output

`--json` is the switch, and outside the `cloud` family it is the only one: `rebase status`, `rebase resources`, `rebase apps list` and `rebase upgrade` then put one JSON value on stdout — the result, or a `{"error": {"message", "code", "hint", "issues"}}` envelope with a non-zero exit — on **every** exit of the command, so a caller can parse stdout unconditionally. Without it they write human text and failures go to stderr. `rebase cloud` uses the same envelope and is the one exception to the switch: it also turns JSON on by itself when stdout is not a TTY, or when `REBASE_JSON=1` is set. So `rebase cloud status | cat` is JSON while `rebase status | cat` is not — in a script, pass `--json` explicitly rather than relying on either rule.

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
| `-y, --yes` | Never prompt. **Required wherever there is no terminal to answer**, such as CI. It skips git init and dependency install — the interactive defaults say yes to both, so pass `--git` / `--install` if you want them |
| `-i, --install` | Install dependencies after scaffolding |
| `-g, --git` | Initialize a repository and make the first commit |
| `--database-url <url>` | Use an existing database instead of the managed one |
| `--introspect` | Generate collections from that database. Implies `--template blank` and needs `--install` |
| `--project <slug>` | Link the scaffold to a Rebase Cloud project |
| `--setup-key <key>` | The one-time key authenticating that link |
| `-a, --agent <name>` | Set up AI coding agents: the [skills](/docs/ai/skills) and the [MCP server](/docs/ai/mcp). Repeatable or comma-separated — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` or `all`. Without it, `init` asks and pre-ticks the agents installed on the machine; under `--yes`, none |

### `rebase dev`

Start the development server:

```bash
rebase dev
```

Starts both frontend and backend with hot reloading, and regenerates the Drizzle schema and the SDK types (`generated/sdk/`) on start and on every collection save. for the SDK types — on 0.23 it regenerates the schema only, and `rebase generate-sdk` is yours to run.

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
| `--output <dir>` (or `--out`) | Write the bundle somewhere other than `dist-bundle/` (one app at a time) |
| `--vendor` | Always install and ship the bundle's dependencies |
| `--no-vendor` | Never vendor; the pod installs on first start |
| `--skip-type-check` | Skip typechecking (faster, less safe) |
| `--no-static` | Do not fold the frontend into the backend bundle (each static app still gets its own bundle) |
| `--skip-static-build` | Fold the frontend as already built, without running its build command |

Dependencies are vendored by default so a pod restart does not pay a 35–55 second
install. A tree that grows past 200 MB on disk is dropped instead, because the
upload limit is 100 MB compressed — see the changelog for the reasoning.

<span class="since-badge" data-since="0.25">Since 0.25</span> Every static app the
bundle carries gets a brotli (`.br`) and a gzip (`.gz`) copy beside each
content-hashed asset of 1 KB or more — the files a browser caches for a year.
The runtime sends the one the browser accepts, so those files cost no
compression work per request, the first visit after a deploy included, and
browsers that accept brotli get it (about 11% smaller than gzip on the admin's
JavaScript). Your frontend's own build output is left as it was; only the copy
in the bundle changes. On the example app this adds under a second to the build
and about 2.4 MB to the bundle.

### `rebase upgrade`

Move every `@rebasepro/*` package the project pins to one release, then
install with the package manager its lockfile names. `rebase upgrade` takes the
latest; `--to 0.21.0` an exact version, with no registry lookup; `--to canary` a
dist-tag. Each pin in `dependencies`, `devDependencies` and
`optionalDependencies`, in every `package.json` under the project, keeps its `^`
or `~`, and nothing else in the file changes. `peerDependencies` and
`workspace:`, `link:`, `file:`, git and tag specs are listed and left alone.
Overrides in `pnpm-workspace.yaml` and `package.json` move too, but a `link:` or
`file:` override wins over every pin: it is reported, and
`--drop-local-overrides` removes it. `--dry-run` writes nothing, `--no-install`
skips the install, and `--json` prints one document.

### `rebase start`

Run the built bundle the way a deployment runs it:

```bash
rebase start
```

Reads `PORT` and the rest of `.env`, unlike `rebase dev`, in the `NODE_ENV` they
set. A scaffolded `.env` says `development`, so the first account to register
still becomes the admin, and `rebase start` says so at the top; set `NODE_ENV=production`
for a production server. `rebase start --bundle ./dist-bundle` runs a bundle elsewhere.

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

Creates timestamped migration files in `drizzle/migrations/` that can be reviewed and committed.

### `rebase db migrate`

Run pending database migrations:

```bash
rebase db migrate
```

Applies all unapplied migrations to the database.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` runs `pg_dump`; `restore` runs `pg_restore` and, being destructive, needs `--yes`.
Scheduling, the roles file that travels with each dump, and the restore procedure are in [Backups and restore](/docs/deployment/backups/).

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

### `rebase db url`

Print the connection string this project is using, and nothing else, so it
pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

The managed development database is the case that needs this: `.env` leaves
`DATABASE_URL` commented out on purpose, and the port is derived from the
project path, so nothing on disk names it. When you have set a `DATABASE_URL`
of your own, that is what this prints — the resolution order is the same one
every other command follows. It starts the managed database if it is not
already running.

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

 Every branch is a full copy on disk, so they need clearing out. `prune` removes
three things: an entry whose database was dropped outside Rebase, a branch
database whose entry was never written, and — only with `--older-than` — branches
past an age you name. It asks before removing anything unless you pass `--yes`.

 `switch` records the branch in `.rebase/branch.json` and never edits `.env`. It
takes precedence over `DATABASE_URL` in `.env` and loses to `--database-url` or a
`DATABASE_URL` in the shell, so a flag on the command line always outranks a
switch made earlier. Deleting the branch you are on returns you to the main
database rather than leaving the checkout pointed at a database that is gone.

:::note[On the managed development database]
<span class="since-badge" data-since="0.25">Since 0.25</span> `push`, `generate` and `migrate` plan their work with Atlas, which needs a second
empty database to compare against — and the managed PGlite serves exactly one. So
on the managed database each of them starts a second, throwaway PGlite in memory
for Atlas, and stops it when the command ends. That is how a column is dropped,
renamed or narrowed there: `rebase dev` only ever adds. The destructive gate is the
same as everywhere. To have Atlas plan against an empty database of your own
instead, set `REBASE_ATLAS_DEV_URL` to it; Rebase neither creates nor drops a
database named that way.

`branch` is refused there. `CREATE DATABASE ... TEMPLATE`
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

What this project declares it needs — the databases, buckets, topics and
queues its config code asks for, and the crons and functions its files define:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` is new — the flag a CI job uses to fail
on a `rebase.resources.json` that no longer matches the config code.

A resource is declared in config code — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — or is a file
under `backend/crons` or `backend/functions`, and never written by hand in
`rebase.resources.json`, which is generated from those declarations so a host can
read what a project needs without building it. Each entry records who uses it
(`collection:events`, `property:posts.cover`, `function:report`).

A backend also has a default database and a default storage source that nobody
declares. Both are listed here, marked `implicit`, and neither is written to
`rebase.resources.json` — the host supplies them, so recording them would ask
for something to be provisioned that nobody asked for.

To see what the platform holds for a project against what its code declares,
and to remove a provisioned database the code no longer names, see
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — every command for Rebase Cloud: auth, project link, deploys, config, databases, resources, compute and more — has [its own page](/docs/cli/cloud).

### `rebase generate-sdk`

Generate a typed SDK from your collection definitions:

```bash
rebase generate-sdk
```

Creates TypeScript types and a type-safe client for all your collections.

`--register` also types server-side data: it writes the types and the
`Register` declaration to `config/generated/`, and remembers the choice in
`rebase.json` (`registerDatabase`), so later runs, `rebase dev` and fresh clones
keep them current.
See [Typed server-side data](/docs/backend/typed-server-data).

### `rebase doctor`

```bash
rebase doctor
```

The command to run when something is wrong and you do not yet know what. It
reports and never changes anything, so it is safe against any database you can
reach.

**Without a database.** These run first, because everything that stops a project
from working at all happens before a table can be compared:

| Check | Why |
| --- | --- |
| Node version | Against the range the CLI declares. Too old is not reported as "unsupported Node" — it is a syntax error inside a dependency. |
| Package managers | Two lockfiles in one project. `npm install` in a pnpm workspace rewrites `node_modules` into a layout pnpm disagrees with, and the symptom is `Cannot find module` hours later. |
| Duplicate slugs | The registry keeps the last collection registered, so the other one is not reported missing — it is served as the winner, under its own name. |
| `.env` sanity | A `JWT_SECRET` shorter than 32 characters (which production refuses to boot on), and `NODE_ENV=production` with neither `CORS_ORIGINS` nor `FRONTEND_URL`. Values are never printed. |
| `@rebasepro/*` version skew | The same package pinned to different versions across the project's `package.json` files. Two copies break `instanceof` between them, which fails as a type guard rejecting its own type. |
| Connection strings | An unencoded `=` in a URL parameter, which PostgreSQL's own tools refuse to parse — so backups and `psql` break while the app keeps working. |
| Custom functions | What each function needs from its host, and which of them would not run on an edge runtime. |

**Against the database**, when `DATABASE_URL` is set:

| Check | Why |
| --- | --- |
| Collections → generated schema | Whether `schema.generated.ts` is stale. |
| Collections → database | Missing tables, columns, enums, foreign keys and junctions. |
| Required extensions | A `{ type: "vector" }` property needs pgvector, which Rebase installs only where a project declared it. |
| Schema stamp | Whether this database was provisioned from these collections. A hash, so it can say the two disagree and never which is ahead. |
| Collections → SDK types | Whether the generated typed SDK is stale. |
| RLS policies | Whether the database's policies match the `securityRules` you declared, and whether any policy names a role this server cannot use. |

If the database is unreachable, its phases are reported as skipped with the
reason and the rest still runs — see [Troubleshooting](/docs/troubleshooting/).

Exits non-zero when a check finds an error, or when a phase could not run
because the database it was given refuses connections. A phase skipped because
you set no `DATABASE_URL` is not a failure.

`rebase doctor --policies` runs only the RLS checks — no schema diff, no SDK
types — and fails closed, which makes it the form to use as a CI gate against a
deployed database.

### `rebase auth`

Authentication management commands:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Manage the project's service API keys — the credential an agent, script or
another service uses, as opposed to an end user's session:

```bash
rebase api-keys list
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` names what the key may do, comma-separated or repeated; `--full-access`
gives it every scope the service key holds except `keys:*`. `--roles` adds RLS
roles beside `service`, `--expires-in` takes days and `--expires-at` an ISO date.
`rebase api-keys scopes` lists every scope the backend knows. A key is shown once.
The key's scopes and the row-level security of the identity it acts as both apply.
See [API keys](/docs/backend/api-keys/).

### `rebase storage`

<span class="since-badge" data-since="0.25">Since 0.25</span> Whole-store
maintenance of stored files, through the running backend with
`REBASE_SERVICE_KEY` from `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` reads every row of every collection, soft-deleted rows included, and
lists the files of one source (`--source`, the default source when left out)
that no string in any row names: a key, a URL, a `rebase-storage:` reference in
a text. Files newer than `--older-than` hours (24 by default) are left out,
because the admin panel uploads a file before the row that names it is saved.
`--delete` asks before it deletes (`--yes` skips the question, and is required
with no terminal), the server finds the files again first, and nothing is
deleted while a collection cannot be read. Files that only your own tables
outside collections name look unused: check before deleting.

`move` copies the files under `--prefix` to another source under the same keys,
a page at a time. A file the target already holds at the same size is skipped,
so a stopped move resumes by running it again; `--delete-source` deletes each
file from the source once the target holds it. Both need `database:read`, and
deleting or moving `database:write`, which the service key holds.

### `rebase skills install`

Install the Rebase reference skills for your AI coding assistants — every `--agent` above:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

See [Agent Skills](/docs/ai/skills) for the full list and where files are written.

### `rebase telemetry`

Anonymous usage sharing. **`rebase init` asks once per project, and the prompt
defaults to yes — nothing is sent unless you answer it:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` prints the current setting, `show` prints exactly what would be sent —
whether or not sharing is on, so you can read the payload before deciding — and
the other two change it. If you never ran `init`, nothing was ever collected.

## Next Steps

- **[Schema Generation](/docs/cli/schema/#production-workflow)** — The migration workflow, from collection edit to production
- **[Schema as Code](/docs/architecture/schema-as-code)** — How schema generation works
- **[Quickstart](/docs/getting-started/quickstart)** — Get started
