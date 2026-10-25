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

`--json` is the switch, and outside the `cloud` family it is the only one: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` and `rebase verify` then put one JSON value on stdout — the result, or a `{"error": {"message", "code", "hint", "issues"}}` envelope with a non-zero exit — on **every** exit of the command, so a caller can parse stdout unconditionally. Without it they write human text and failures go to stderr. `rebase cloud` uses the same envelope and is the one exception to the switch: it also turns JSON on by itself when stdout is not a TTY, or when `REBASE_JSON=1` is set. So `rebase cloud status | cat` is JSON while `rebase status | cat` is not — in a script, pass `--json` explicitly rather than relying on either rule.

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
| `-i, --install` | Install dependencies after scaffolding. Without it, init asks (default yes); under `--yes`, nothing is installed |
| `--no-install` | Install nothing, and do not ask |
| `-g, --git` | Initialize a repository and make the first commit. Without it, init asks (default yes); under `--yes`, no repository |
| `--database-url <url>` | Use an existing database instead of the managed one. It must be a `postgres://` or `postgresql://` URL: anything else is refused before a file is written, and the interactive prompt asks again |
| `--introspect` | Generate collections from that database. Implies `--template blank` and needs `--install` |
| `--project <slug>` | Link the scaffold to a Rebase Cloud project |
| `--setup-key <key>` | The one-time key authenticating that link |
| `-a, --agent <name>` | Set up AI coding agents: the [skills](/docs/ai/skills) and the [MCP server](/docs/ai/mcp). Repeatable or comma-separated — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` or `all`. Without it, `init` asks and pre-ticks the agents installed on the machine; under `--yes`, none |

### `rebase dev`

Start the development server:

```bash
rebase dev
```

Starts both frontend and backend with hot reloading, and regenerates the Drizzle schema and the SDK types (`generated/sdk/`) on start and on every collection save. On 0.23 it regenerates the schema only, and `rebase generate-sdk` is yours to run.

Both ports are derived from the project's path so several Rebase projects can run
side by side. Use the URLs `rebase dev` prints. Pin one with `rebase dev --port 3001`.

An edit to `.env`
restarts the backend, which reads the file again, as the admin panel does. What
`rebase dev` sets itself is kept until you restart it: `PORT`, and
`DATABASE_URL` when it is on the managed database or on Docker. On 0.24 an `.env`
edit reached the backend only when some other watched file changed.

With
`--database-url`, `rebase dev` first checks that something answers at that host
and port. If nothing does, it says so, naming the flag, and exits `1` with
nothing started; it also leaves the database `.env` names alone, never starting
its compose container. On 0.24 the backend's banner said to verify
`DATABASE_URL` in `.env`, and dev kept running with the backend down.

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

Every static app the
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

A project on a
prerelease, such as a canary, stays on its channel unless `latest` is newer. A
dist-tag that would move a pin backwards is refused (`downgrade_refused` under
`--json`) unless you pass `--allow-downgrade`; an exact `--to` is applied, and
flagged as a downgrade. A `--dry-run` of an upgrade the real run would refuse
shows what would move and exits 0, and under `--json` its document carries the
refusal as `wouldRefuse` (`{ code, message, hint }`). On 0.24, `rebase upgrade`
takes `latest` regardless.

### `rebase start`

Run the built bundle the way a deployment runs it:

```bash
rebase start
```

Reads `PORT` and the rest of `.env`, unlike `rebase dev`, in the `NODE_ENV` they
set. A scaffolded `.env` says `development`, so the first account to register
still becomes the admin, and `rebase start` says so at the top; set `NODE_ENV=production`
for a production server. `rebase start --bundle ./dist-bundle` runs a bundle elsewhere.

`rebase start` starts no database, and the scaffold's `.env` has no
`DATABASE_URL`, so a local run on the database `rebase dev` uses is
`DATABASE_URL="$(rebase db url)" rebase start`.
Without one, it prints that line before booting; on 0.24 the runtime stops on
"DATABASE_URL: is required".

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

The ejected server
keeps local uploads in the project's `uploads/`, run from source or compiled, as
`rebase dev` does. It runs in `backend/`, so a relative `STORAGE_PATH` there is
read from `backend/`. On 0.24 the compiled server uses `backend/dist/uploads`,
which the next build deletes.

### `rebase schema generate`

Generate Drizzle ORM schema from your TypeScript collections:

```bash
rebase schema generate
```

This reads your collections from `config/collections/` and generates `backend/src/schema.generated.ts` with Drizzle table definitions, enums, and relations.

### `rebase schema stale`

```bash
rebase schema stale          # name what differs from the collections, exit 1 if anything does
rebase schema stale --fix    # regenerate backend/src/schema.generated.ts instead
```

`rebase dev` keeps the file current by itself, so this is the check for a build
or a CI step. See [Schema Generation](/docs/cli/schema/#rebase-schema-stale).

### `rebase db`

```bash
rebase db push                 # apply the collections to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
```

Each is on [Database Commands](/docs/cli/database/), with the order in which a
command picks its database; `push`, `generate` and `migrate` are covered in
depth on [Schema Generation](/docs/cli/schema/).

### `rebase console`

A Node REPL with the project's data open, or one snippet run with `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) and `collections` are in
scope, and top-level `await` works. The database is resolved as `rebase db push`
resolves it, and opening it changes nothing in it. With `-e`, the awaited result
is printed as JSON on stdout and a throw exits `1`. Flags: `--eval`/`-e`,
`--collections`/`-c`, `--database-url`, `--docker`. See
[Scripts and the Console](/docs/backend/scripts/).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` takes no name: it infers every app from the project and writes the
whole `rebase.json`, and refuses to replace one that exists unless you pass
`--force`.

A name argument is
refused. `--force` keeps what inference cannot know from the file it replaces:
each app's name, its `path` and its `cms` route. Everything else is inferred
again, and a declared app it no longer finds is named as removed, so on a
scaffold it writes back the `rebase.json` the scaffold shipped. The static
app's build command uses the project's package manager. On 0.24 the name is
ignored, and `--force` writes plain inference: the static app becomes `web`,
built with `npm run build --workspace frontend`.

For a
checkout not linked to a Cloud project, `apps config` says it is not linked,
whether or not `rebase dev` is running, and gives the backend's URL as
`rebase dev` serves it. On 0.24 it prints `http://localhost:3001`.

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

A
`rebase.resources.json` that no longer matches the declarations gets a `○` line.
One that has not been written yet does not: `rebase build` writes it on every
build, so a project that has never been built, such as a fresh scaffold, has
nothing to fix. On 0.24 every new project's `status` ended with "is missing".

### `rebase resources`

What this project declares it needs — the databases, buckets, topics and
queues its config code asks for, and the crons and functions its files define:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` is the flag a CI job uses to fail on a
`rebase.resources.json` that no longer matches the config code.
`--json` combines
with it: on drift, `rebase resources --check --json` exits 1 with an error
envelope (`resource_graph_missing` or `resource_graph_stale`), and on success
the graph carries `check.status`. `--write --json` writes the file and reports
`written.changed`. On 0.24 `--json` printed the graph and ignored both flags.

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
Declaring a named
one, such as `bucket("media")`, leaves the default where it is, so both are
listed. Only declaring the default itself, or marking one bucket
`default: true`, replaces it. On 0.24 the default storage source dropped out of
`rebase status` and `rebase resources` as soon as any bucket was declared,
though the server went on serving it.

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

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Whether the collections are safe to ship, in one fast command for CI and for an
AI agent's hooks. Offline by default, and it never changes anything.

| Step | What fails it |
| --- | --- |
| Collection config | A file under `config/collections/` that does not load, or that the boot validator rejects — with unknown keys as errors, so a misspelt option or a UI option written outside `admin: { … }` (a top-level `widget`) is caught here rather than silently ignored. |
| RLS coverage | A collection with no `securityRules` that inherits none, or one with a `user_id`, `owner_id`, `organization_id` or `tenant_id` column that relies on directory defaults instead. A rule that lets a role read every row of such a table is a warning. |
| Migration freshness | A table or column the collections declare that no file in `backend/drizzle/migrations` creates, or one they dropped that a migration still creates. Skipped for a project with no migrations yet. |
| Live RLS audit | With `--live`: the [`rls-check`](/docs/rls-check) catalogue against the project's database, and whether every migration has been applied. The database is resolved as the `db` commands resolve it — `--database-url`, `DATABASE_URL`, `--docker`, otherwise the managed development database. A database that is not configured or does not answer is an error, not a skip: the audit was asked for. A `USING (true)` read policy compiled from an `access: "public"` rule is a warning while the API requires a token (`AUTH_REQUIRE`, on by default) — every signed-in user reads every row — and an error with `AUTH_REQUIRE=false`, where the rows are anonymous. |

`--json` prints one object — every step, and every finding with its `file`, the
dotted `path` into the collection config, and the `fix` — so an agent can repair
what it broke. `--quiet` prints nothing when everything passes. Exits non-zero on
an error; warnings do not fail.

A scaffolded project runs it for Claude Code after every collection edit: see
[`rebase skills install`](#rebase-skills-install).

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
rebase api-keys get abc123-def456
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

Whole-store
maintenance of stored files, through the running backend with
`REBASE_SERVICE_KEY` from `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` reads every row of every collection as stored (soft-deleted rows
included, past every `beforeQuery` and `afterRead` hook) and every
[history](/docs/backend/history/) entry, since a revert restores what it holds.
It lists the files of one source (`--source`, the default source when left out)
that no string in any of them names: a key, a URL, a `rebase-storage:`
reference in a text. Files newer than `--older-than` hours (24 by default) are left out,
because the admin panel uploads a file before the row that names it is saved.
`--delete` asks before it deletes (`--yes` skips the question, and is required
with no terminal), the server finds the files again first, and nothing is
deleted while a collection cannot be read — a collection with read hooks on a
data source whose driver cannot read past them counts as unread. Files that only your own tables
outside collections name look unused: check before deleting.

`move` copies the files under `--prefix` to another source under the same keys,
a page at a time. A file the target already holds at the same size is skipped,
so a stopped move resumes by running it again; `--delete-source` deletes each
file from the source once the target holds it, and is refused when the two
sources store in the same bucket or directory. Both need `database:read`, and
deleting or moving `database:write`, which the service key holds.

### `rebase skills install`

Install the Rebase reference skills for your AI coding assistants — every `--agent` above:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

See [Agent Skills](/docs/ai/skills) for the full list and where files are written.

`--hooks` installs the Claude Code guardrail `rebase init` ships with every
project: `.claude/hooks/post-edit-collection.sh`, registered as a `PostToolUse`
hook in `.claude/settings.json`, which runs `rebase verify --quiet` after each edit
under `config/collections/` and hands any problem back to the agent. Existing
settings and hooks are kept. `rebase skills --hooks` installs the hook alone.

### `rebase telemetry`

Anonymous usage sharing, off until you say yes. An interactive `rebase init`
asks at the end, and the prompt defaults to no, so nothing is shared unless you
answer yes. The answer is per machine (`~/.rebase/telemetry.json`): after a yes
`init` never asks again, and after a no the next `init` asks again. Each
checkout gets a random project id, kept in its gitignored
`.rebase/telemetry-project.json`.
On 0.24 the prompt defaults to yes, and the project id changes on every
`rebase dev` restart.

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
