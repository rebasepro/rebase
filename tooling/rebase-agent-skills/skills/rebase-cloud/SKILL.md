---
name: rebase-cloud
description: Guide for deploying and operating a project on Rebase Cloud — creating a project, attaching a managed or bring-your-own database, environment variables, extensions, domains, logs and rollbacks. Use this when the user wants to ship to Rebase Cloud, or is debugging a cloud deployment. For self-hosting, Docker or Kubernetes, use rebase-deployment instead.
---

# Rebase Cloud

Rebase Cloud is the hosted control plane at [app.rebase.pro](https://app.rebase.pro).
It runs your project as one container per app on Kubernetes, serves it at
`https://<subdomain>.rebase.website`, and gives it a managed PostgreSQL database.

<!-- docs-verify: ignore -->
Everything here is driven by `rebase cloud <command>`. There is no bare
`rebase deploy` or `rebase login` — every cloud command lives under the `cloud`
namespace, and a mistyped one exits 1.

> **⛔ AGENT RULE — read this first.** Never run `rebase cloud deploy`,
> `rebase cloud projects create`, `rebase cloud projects delete`,
> `rebase cloud rollback`, `rebase cloud stop` or any other command that changes
> the hosted platform unless the user asked for it **in the current
> conversation**. Everything in this skill is safe to *read*
> (`status`, `logs`, `deployments`, `env list`, `debug`); the rest is the user's
> call. When in doubt, print the command for them to run.

---

## The first deploy, in order

```bash
rebase cloud login
rebase cloud projects create --name "My App" --subdomain my-app --link
rebase cloud deploy
```

`projects create` attaches a **managed database** in the same call. That is the
step that used to be missing, and its absence is the single most expensive trap
on this platform — see the next section.

Already have a project, or created one in the console?

```bash
rebase cloud link --project my-app     # link this directory
rebase cloud status                    # what is this project waiting for?
```

### If you passed `--db none`, or the project predates this behaviour

```bash
rebase cloud db create --type managed
rebase cloud deploy
```

### What the deployed URL actually serves

One container per app. The backend container handles:

- **`/api/*`** — the data API, auth, realtime, storage
- **everything else** — your built frontend as a static SPA (via `serveSPA()`)

There is **no separate admin URL** — the admin panel is part of your frontend,
so where it appears depends on what your frontend is:

| Project type | What the root URL shows | Where the admin is |
|---|---|---|
| Default scaffold (`rebase init`) | The admin panel itself (login / bootstrap) | `/` — the frontend **is** the admin |
| Custom product frontend | Your product app | Wherever you mount it — commonly `/admin` |
| Backend-only (`rebase init --headless`) | Nothing (API only) | Not deployed |

> **IMPORTANT FOR AGENTS:** On the **first visit** to a freshly deployed
> project's admin, Rebase shows the bootstrap screen ("Create your admin
> account"). The earliest-registered account receives admin privileges — the
> project owner should claim it immediately after deploying. **Never fill this
> form on the user's behalf.**

---

## ⚠️ A project with no database never deploys, and never says so

This is the failure this skill exists to prevent. Read it before acting on any
`status` output.

A project created without a database is written `status: "provisioning"` and
sits there **forever**. Nothing is provisioning. The platform is waiting for
`rebase cloud db create`, and the word "provisioning" says the opposite.

`status` answers this directly. Use these two fields and nothing else to decide
whether to wait:

```bash
rebase cloud status --json
```

```json
{
  "status": "provisioning",
  "blockedOn": "no_database",
  "nextAction": "rebase cloud db create --type managed"
}
```

| `blockedOn` | Meaning | What to do |
|---|---|---|
| `null` | The platform is genuinely working | **This is the only value you may poll on.** |
| `no_database` | No database attached | Run the `nextAction` — this state never resolves itself |
| `never_deployed` | Database attached, nothing shipped | `rebase cloud deploy` |
| `last_deploy_failed` | The build failed | `rebase cloud logs`, fix, deploy again |
| `database_unreachable` | Attached but not answering | `rebase cloud db test` |

> **IMPORTANT FOR AGENTS:** Never poll `status` while `blockedOn` is non-null.
> The value cannot change on its own, so there is no timeout short enough to be
> wrong and none long enough to be right. Run `nextAction`, or stop and report it.

---

## The managed database

Managed PostgreSQL is **CloudNativePG running in-cluster**, not Cloud SQL or
RDS. By default a project's database is a database on a **shared HA pool** that
other tenants also live on. Three consequences follow, and each one changes what
you should do.

### 1. It does not exist until the first deploy

`rebase cloud db create` writes a record. The Postgres cluster, the namespace
and the credentials are created when the project first deploys.

So this is **expected, not a fault**:

```
$ rebase cloud db test
✗ Failed to test database: secrets "postgres-app" not found
```

Do not debug it. Do not retry it. Deploy first; `db test` answers afterwards.
`rebase cloud db create --wait` knows this and returns immediately for a managed
database rather than polling something that cannot appear yet.

### 2. Extensions live on a cluster shared with other tenants

```bash
rebase cloud extensions list
rebase cloud extensions enable vector      # `pgvector` is accepted as an alias
```

`extensions list` marks some with **⟳ restarts DB**. On the shared pool that
restart affects **every tenant on that pool**, so the CLI refuses to do it
without `--yes`. Never pass `--yes` to an extension enable on the user's behalf.

An extension the shared pool will not carry is not something you can work
around from inside the project.

### 3. When the shared pool is not enough

Two escape hatches, in increasing order of ownership:

```bash
# A CloudNativePG cluster of this project's own, still managed by the platform
rebase cloud resources set --db-mode dedicated

# Your own PostgreSQL, anywhere
rebase cloud db create --type byodb --connection-string "$DATABASE_URL" --wait
```

`--db-mode dedicated` costs more and is the right answer for isolation or for an
extension the pool cannot carry. `byodb` is the right answer when the database
has to be somewhere the platform does not run.

> **A project has exactly one database.** The platform reads its `databases`
> rows with `limit: 1` in three places, so a second row does not add a database —
> it makes it undefined which one the project deploys against. `db create`
> refuses with `code: database_exists` rather than creating one; detach the
> existing database first.

### Reading a database's real location

```bash
rebase cloud db info            # host, port, database, username
rebase cloud db info --reveal   # …and the password (never shown by default)
```

---

## Environment variables

```bash
rebase cloud env list
rebase cloud env set STRIPE_SECRET_KEY=sk_live_… --secret
rebase cloud env unset OLD_KEY
rebase cloud env pull            # write them into a local .env
rebase cloud deploy              # variables apply at the NEXT deploy
```

Values are encrypted at rest and decrypted at deploy time. A change is
**pending** until the next deploy.

### Build-time variables cannot be set here — and the CLI will tell you

<!-- docs-verify: ignore -->
```
$ rebase cloud env set VITE_API_URL=https://api.example.com
✗ VITE_API_URL is read by your bundler at BUILD time. Project variables are
  applied at rollout — after the image is built.
  code: build_time_variable
```

This is correct and you should not force past it. `VITE_*`, `NEXT_PUBLIC_*`,
`PUBLIC_*` and `REACT_APP_*` are **inlined into the JavaScript by the bundler**
before the image exists. Setting one here produces a variable that is present in
the container and `undefined` in the bundle — nothing fails, the deploy
succeeds, and the app breaks in the browser several steps away from the cause.

Put them in the source you deploy:

```bash
# frontend/.env.production — committed, read by the bundler at build time
VITE_API_URL=https://my-app.rebase.website
```

`--force` exists for the rare app that genuinely reads such a name at run time.
Do not reach for it to make an error go away.

### Names the platform owns

These are set for every project and cannot be overridden — `env set` refuses
them with `code: env_var_key_reserved`:

`DATABASE_URL` · `DATABASE_DIRECT_URL` · `DATABASE_READ_URL` · `JWT_SECRET` ·
`REBASE_SERVICE_KEY` · `PORT` · `NODE_ENV`

Names that merely look similar (`MY_DATABASE_URL`, `JWT_SECRET_KEY`, `PORTAL`)
are yours to set.

---

## Deploying

```bash
rebase cloud deploy                          # the repository's backend
rebase cloud deploy web                       # a named app
rebase cloud deploy --message "add search"    # label the release
rebase cloud deploy --timeout 600             # bound the wait, in seconds
rebase cloud deploy --no-follow               # return once the build is triggered
```

`deploy` **follows the build to a terminal state and exits non-zero if it
failed**. That is the default on every path — you do not need a poll loop, and
you should not write one. `--wait` is accepted as an explicit spelling of the
same thing.

Which kind of deploy runs is decided by the repository, not by you:

| Situation | What happens |
|---|---|
| `rebase.json` declares `"runtime": "managed"` | A **bundle** deploy — the default for scaffolded projects |
| `--source .` | Uploads the directory and builds a container image |
| Neither | The control plane rebuilds the source it already holds (a git checkout, or an older upload) |

> **IMPORTANT FOR AGENTS:** `--source` on a managed project is **refused**,
> because a source build rewrites the project onto a container image and off the
> platform runtime. `--force` overrides that refusal. Never pass `--force` to
> get past this error — it is a one-way change to how the user's project runs.

---

## Multi-app projects

One container can serve several apps at different paths. Declare them in
`rebase.json`:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin"
    }
  }
}
```

`path` is a **build-time** input, not only a serving one. An app mounted at
`/admin` must be *built* for `/admin`, or `index.html` loads and every asset
404s — a blank page with nothing in the logs. `rebase build` passes the value as
`REBASE_APP_BASE`:

```ts
// admin/vite.config.ts
export default defineConfig({
    base: process.env.REBASE_APP_BASE ?? "/"
});
```

**And no absolute asset paths in `index.html`.** A hand-written
`<link rel="icon" href="/favicon.ico">` is not rewritten by the bundler's base,
so it resolves to the site root. Use the base-relative form:

```html
<link rel="icon" href="%BASE_URL%favicon.ico" />
```

The build refuses a misbuilt app rather than shipping a blank page:

<!-- docs-verify: ignore -->
```
"admin" is declared at /admin but its build emitted assets rooted at /.
    index.html references: /favicon.ico, /assets/index-a1b2.js
    The app would load a blank page. Set `base` from REBASE_APP_BASE in its
    build config
```

---

## Diagnosing a failed deploy

Work outward, cheapest first:

```bash
rebase cloud status                  # blockedOn / nextAction first, always
rebase cloud logs                    # the last build log
rebase cloud logs --runtime          # the running container's log
rebase cloud deployments list        # history: status, duration, trigger
rebase cloud debug                   # read-only diagnosis of a misbehaving deploy
rebase cloud metrics                 # live CPU / memory / disk, restarts, crash reasons
```

Recovering:

```bash
rebase cloud rollback                # back to the last successful deploy
rebase cloud cancel --yes            # stop an in-flight build
rebase cloud restart --yes           # restart the running instances
```

### Telling a platform failure from a project failure

This distinction decides whether there is anything to fix in the code at all,
and getting it wrong is expensive.

**A `403` naming a `system:serviceaccount:` is a PLATFORM problem.** It means the
control plane's own Kubernetes credentials were refused. Nothing in the project
can grant them — not the collections, not `rebase.json`, not a deploy flag. The
CLI now says so:

<!-- docs-verify: ignore -->
```
$ rebase cloud deploy
✗ Deploy failed: the platform's own cluster credentials were refused by Kubernetes.
  cronjobs.batch is forbidden: User "system:serviceaccount:rebase-control-plane:control-plane"
  cannot create resource "cronjobs" in API group "batch" in the namespace "tenant-my-app"
  This is a platform-side permission, not something your project can grant.
  Nothing in your code, collections or deploy flags will change it —
  report it with the message above rather than retrying or changing the project.
```

> **IMPORTANT FOR AGENTS:** On `platform_permission_denied`, **stop and report**.
> Do not retry. Do not delete cron jobs, functions or collections to see whether
> they are the cause — they are not, and you will delete working code. This
> happened: three cron jobs were removed from a real project to A/B a
> `cronjobs.batch` 403, and the 403 was unrelated to all three.

Add `--debug` to any failing command to get the untouched error body (on stderr,
so it never corrupts `--json` output):

```bash
rebase cloud deploy --debug
```

For a platform admin, one command answers the whole question:

```bash
rebase cloud clusters verify <cluster-id> --baseline
```

It reports `permissions.allowed` and `permissions.denied`, which is what names a
missing RBAC grant directly. It exits non-zero when the verdict is `unusable`.

---

## Domains

```bash
rebase cloud domains list
rebase cloud domains add app.example.com     # prints the DNS records to create
rebase cloud domains verify app.example.com  # once DNS has propagated
rebase cloud domains remove app.example.com
```

TLS is issued automatically once verification passes.

---

## Resources and cost

There are no plan tiers. A project is priced by the resources it reserves, and
each one is a dial:

```bash
rebase cloud resources                       # what this project reserves, and €/month
rebase cloud resources set --cpu 500m --memory 1Gi
rebase cloud resources set --db-mode dedicated --db-instances 2
rebase cloud resources set --autoscale-max 5 --autoscale-cpu-target 70
```

`resources` itemises the monthly quote line by line. Empty means the platform
default.

---

## Output is JSON whenever stdout is not a terminal

Every `rebase cloud` command switches to machine-readable output when stdout is
piped or redirected, when `--json` is passed, or when `REBASE_JSON=1` is set.
**An agent running these through a shell always gets JSON**, never the
human-formatted output.

The contract is **one JSON value on stdout and nothing else**. Narration,
warnings and errors go to stderr, so `stdout | jq` is always safe.

```bash
rebase cloud status --json | jq -r '.blockedOn // "ready"'
```

Failures are JSON too, and carry a stable `code`:

```json
{ "error": { "message": "…", "code": "platform_permission_denied", "platform": true } }
```

To see the human output from a non-interactive shell, wrap the call:

```bash
script -q /dev/null rebase cloud status
```

---

## Discovering flags

`--help` prints a page and never runs the command. It works per action, not just
per group:

```bash
rebase cloud --help
rebase cloud projects create --help
rebase cloud deploy --help
rebase cloud db create --help
```

Piped, `--help` returns a structured description of the command — usage,
every flag, notes and examples — which is the right way for an agent to discover
a command it has not used before.

---

## Command reference

| Command | What it does |
|---|---|
| `rebase cloud login` / `logout` / `whoami` | Session |
| `rebase cloud use` | Select the active organization |
| `rebase cloud link` / `unlink` / `open` | Link this directory to a project |
| `rebase cloud projects list` / `create` / `info` / `delete` | Projects |
| `rebase cloud db list` / `create` / `info` / `test` | Databases |
| `rebase cloud db backup list` / `create` / `restore` | Backups |
| `rebase cloud db pitr status` / `restore` / `cutover` / `discard` | Point-in-time recovery |
| `rebase cloud deploy` / `logs` / `deployments list` | Ship and observe |
| `rebase cloud rollback` / `cancel` | Recover |
| `rebase cloud start` / `stop` / `restart` / `status` / `metrics` / `debug` | Operate |
| `rebase cloud env list` / `set` / `unset` / `reveal` / `pull` | Configuration |
| `rebase cloud domains list` / `add` / `verify` / `remove` | Custom domains |
| `rebase cloud extensions list` / `enable` / `disable` | Postgres extensions |
| `rebase cloud settings show` / `set` | Name, branch, repo, subdomain |
| `rebase cloud resources` / `resources set` | What it reserves, and what it costs |
| `rebase cloud storage` / `storage create` / `storage attach` | Object storage |
| `rebase cloud orgs list` / `create` / `members` | Organizations |
| `rebase cloud billing` / `billing setup` | Card on file |
| `rebase cloud clusters` / `clusters add` / `clusters verify` | Platform admin |

Global flags on every one of them: `--project, -p <slug>`, `--json`,
`--url <origin>`, `--yes, -y`, `--debug`.

---

## ⛔ Agent rules

**Never run a command that changes the hosted platform unless the user asked in
the current conversation.** That includes `deploy`, `projects create`,
`projects delete`, `db create`, `env set`, `domains add`, `rollback`, `stop`,
`restart`, `resources set` and `extensions enable`.

**Never pass these to get past an error:**

| Flag | What it actually does |
|---|---|
| `--force` on `deploy` | Moves the project off the managed runtime onto a container image. One-way. |
| `--force` on `env set` | Stores a build-time variable that will silently never reach the bundle |
| `--yes` on `extensions enable/disable` | Restarts a database shared with other tenants |
| `--yes` on `projects delete` | Deletes the project |

**Never retry or "fix" a `platform_permission_denied`.** Report it.

**Safe to run unasked:** `status`, `logs`, `deployments list`, `env list`,
`resources`, `metrics`, `debug`, `db info`, `domains list`, `extensions list`,
and any `--help`.

---

## Related skills

- **rebase-deployment** — Docker, Kubernetes, AWS/GCP/Azure/Hetzner, Railway,
  Render, and the `serveSPA()` / health-check / graceful-shutdown details that
  apply to every deployment target including this one.
- **rebase-basics** — project layout, `rebase.json`, the CLI in general.
- **rebase-backend-postgres** — schema, migrations, `rebase db push`.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **Console:** [app.rebase.pro](https://app.rebase.pro)
- **Apps and repositories:** `website/src/content/docs/docs/architecture/apps-and-repositories.md`
- **Cloud CLI source:** `packages/cli/src/commands/cloud/`
