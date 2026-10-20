---
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud is the same Rebase, operated for you. What it is, how a project links and deploys, and what the private beta does not include yet.
---

Rebase Cloud runs the same open-source Rebase you would self-host — the same
published `rebasepro/server` image, the same bundle, the same Postgres. The
difference is who operates it.

:::note[Private beta]
Rebase Cloud is in **private beta**. It runs real tenants today and opens in
batches. [Request access](https://rebase.pro/pricing).

It is not self-serve, so the commands below need an account that has been let in.
Everything else on this site works without one.
:::

## What it is

A Cloud **project** is three things the platform operates for you:

| | What you get |
|---|---|
| **App** | Your bundle, running on the published runtime image. Deploys are a bundle upload, not a container build |
| **Database** | A managed PostgreSQL, with automated backups and point-in-time recovery |
| **Storage** | A bucket of your own, if your project uses file storage |

Each is provisioned when you first deploy, and each is billed for what it
reserves rather than per seat.

**Nothing about your project changes to run there.** The same repository
self-hosts with `docker compose`, and the escape hatch is real: `rebase build`
produces a bundle that boots anywhere the runtime image runs.

## Link a project

From a project directory:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` takes no positional argument. The name and the subdomain are
flags, and both are required — on a terminal they are prompted for, and a
headless run that omits either exits with `input_required` rather than inventing
one. **The subdomain is not editable afterwards:** it is the
`<slug>.rebase.website` host the project answers on, so pick it deliberately.

`--link` binds this directory to the project in the same call, so there is no
separate `link` step. It writes `.rebase/cloud.json`, which records the project id
and slug. That file is not a secret and it is not your credentials — those live
in `~/.rebase/credentials.json`, written by `login`.

It is committed with the code, though, so a cloned repository can name any
control plane. When the host comes only from that file, and it is neither the
platform's own nor one you have signed in to before, `login` names it and asks
before sending your email and password there. Without a terminal, or with
`--json`, it refuses with `unknown_control_plane`; pass `--url <host>` (or set
`REBASE_CLOUD_URL`) to sign in there on purpose.

`billing setup` attaches a card to the organization, once. It is first in the
sequence on purpose: the first deploy of a project is refused without one, and
finding that out after a bundle has finished uploading is the worse order.

An existing project links without creating one:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

One command, and no flag to remember. A scaffold's `rebase.json` declares
`runtime: "managed"` for its backend, and `deploy` reads that declaration — it
says so on the way past (`rebase.json declares runtime: managed — deploying a
bundle`), builds the app into `dist-bundle`, uploads the bundle, runs it on the
published runtime image, and follows the deployment to a terminal state. The exit
code is the verdict, so the same line works unattended in CI.

It ends by saying where each app now answers and whether the new version is
live there:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
```

"Live" means the address answered after the build: a backend's `/api/health`
returned `ok`, and a static app's page loaded (from this deployment, when the
platform serves it). The check waits up to `--live-timeout` seconds, 60 by
default; `0` skips it. If an app does not answer in time the deploy still exits
zero, because the deployment succeeded, and the last line says which app did not
answer and why. A failed deploy ends on one line instead, naming the app and the
reason, with `rebase cloud logs` for the full build log.

Scripts pass `--json` for one object carrying the same facts — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` and the deployment id. Unlike the rest of
`rebase cloud`, `deploy` does not switch to JSON on its own when piped.

What that runtime allows — packages and native modules, memory and instances,
timeouts and body sizes, the filesystem, secrets, storage and outbound
network — is on its own page:
[Managed backend runtime](/docs/deployment/managed-runtime/).

To ship an artefact that was built earlier — a CI job that builds once and
deploys twice, say — point at the directory instead of rebuilding:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Leaving the managed runtime is its own flag, `--eject`, and nothing else asks
for it: a build that would move a managed project onto a container image it then
owns is refused until you say so. `--force` used to mean this, which put the
least reversible thing the CLI can do under the same word as "overwrite this
file"; it is an unknown option now rather than an alias, so a script carrying it
stops instead.

### The syntax check before the upload

A static app's files are served exactly as they are. When its `build` only
copies hand-written scripts into `output`, nothing has parsed them, and a file
with a typo in it goes live and stops the page from loading. So before anything
is uploaded, `deploy` parses every `.js`, `.mjs` and `.cjs` file in each static
app's `output`, along with every inline `<script>` in its `.html` files. That
covers a static app deployed on its own and static apps folded into the
backend's bundle. A syntax error stops the deploy with the file, line and column:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

With `--json` the error's `code` is `syntax_error`. Inline scripts a browser
does not run as JavaScript are skipped: JSON, import maps, templates and any
other non-JavaScript `type`, a `<script src>`, and a script that still holds
unrendered template markup such as `{{ }}`. A `.js` file passes if it parses as
either a classic script or a module, because the page decides which. Nothing
under `node_modules` is read, and neither is a prebuilt `--bundle-dir`.
`--no-verify` skips the check for one deploy.

Watch it:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` reports `blockedOn` and `nextAction`. When `blockedOn` is `null` the
platform is genuinely working and polling is the right thing to do; when it names
something, that something is waiting for you.

## Preview a change

<span class="since-badge" data-since="0.26">Since 0.26</span>

```bash
rebase cloud deploy --preview
```

This builds and uploads exactly what `deploy` would, but serves it at an address
of its own, such as `https://shop--k3x9ab.rebase.website`. Production keeps
serving what it served before. The deploy prints the preview's address when the
build finishes.

To keep one address across deploys, name the preview. Deploying the same name
again updates it:

```bash
rebase cloud deploy --preview-name new-checkout
```

What a preview talks to depends on what you deployed:

- **`rebase cloud deploy web --preview`** previews one static app. Its pages call
  the **production** backend: a sign-in there is a real session, and anything
  written there is production data.
- **`rebase cloud deploy --preview`** previews the backend, with its static apps
  folded in, the same way production runs them. It gets a backend of its own on
  an **empty database of its own**, never production's. Booting against
  production's database would apply the preview's schema and access rules to it.

A preview uploads no source and registers no apps or hostnames, because each of
those would change the production project. `--source` and `--eject` cannot be
combined with `--preview`. Each builds a container image for production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

A preview expires a week after it was last deployed to.

Previews are rolling out. A control plane that does not serve them yet refuses
`--preview` with `previews_unavailable` and deploys nothing.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

A rollback re-points the project at what a previous successful deployment
shipped, and never rebuilds — the value of a rollback is that it ships an
artefact that has already run.

Which deployments qualify depends on how the project deploys, and both kinds
work:

| How it deployed | What is restored |
|---|---|
| `rebase cloud deploy` (a source build) | The image that build published |
| `rebase cloud deploy --bundle` (the platform runtime) | The bundle that deploy shipped, on the runtime version the project is running now |

Static apps folded into the backend's bundle (a plain `rebase cloud deploy` on a
project with a backend) are part of that bundle, so they roll back with it.

A static app deployed on its own (`rebase cloud deploy <app>`) cannot be rolled
back yet. Its deployment records which app it published, but no bundle, so the
control plane has nothing to restore it from. The fix is to deploy the last good
version again, for example from the commit before the bad one. After such a
deploy, `deploy` says this instead of pointing at `rollback`.

So a rollback needs a deployment that recorded one of the two, which means a
project that has deployed successfully at least twice. `rebase cloud deployments`
marks the ones that qualify, and `--json` reports `rollbackable` per row along
with the `image` or `bundle` it would restore.

Two deployments are refused, and the CLI says which: one that did not succeed,
and one from before the platform recorded its artefact. There is nothing to guess
at in either case — guessing would ship whatever was built or uploaded most
recently while claiming to restore this one — so deploy the version you want
instead.

Every successful deploy ends by naming the way back (`rebase cloud rollback`),
so it is in view at the moment a bad release is noticed.

A rollback appends a new deployment rather than rewinding history, and waits for
the restored version to serve before reporting success. Follow it with
`rebase cloud logs -f`.

## CI and agents

A CI job or an agent should not carry your password. Give it a token
instead: a key that acts as your account, narrowed to a few actions on one
project. Create it from a signed-in terminal:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

The token is printed once, as an `export REBASE_TOKEN=rk_live_…` line. With
`REBASE_TOKEN` set, every `rebase cloud` command authenticates with it instead of
your login, and never reads or writes the stored session. In GitHub Actions,
store it as a repository secret and expose it under that name:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` takes one or more capabilities, comma-separated or repeated:

| Capability | What the token may do |
|---|---|
| `deploy` | Deploy the project and follow its builds: `deploy`, `deployments` |
| `logs` | Read build and runtime logs, and live metrics: `logs`, `metrics` |
| `env` | Read and change environment variables, secrets included |
| `database` | `db list`, `db info` and `db connect`, which includes the database password |
| `backups` | List, create, inspect and download backups, and read the point-in-time window |

Under the hood a token is a [personal API key](/docs/backend/api-keys/#personal-keys)
on the control plane. Each capability becomes a few
[scopes](/docs/backend/roles-and-scopes/): `deploy` on `shop` holds
`project:deploy:<id>`, with the project's id, plus the data and function scopes
the deploy commands call. The token never holds more than your account does at the moment
it is used, so it loses whatever your account loses.

Two things stay with a signed-in person:

- **Managing tokens.** `rebase cloud tokens list`, `create` and `revoke <id>` take
  your `rebase cloud login` session. A token cannot list, create or revoke
  tokens, because a token that could mint tokens could mint its own successor.
- **Restoring.** No capability grants a backup restore or a point-in-time
  `restore` and `cutover`. Putting old data over a live database stays with a
  signed-in owner or admin.

`rebase cloud whoami` with a token set shows what it may do, and on which
project. `rebase cloud tokens revoke <id> --yes` stops it at once.

## Compute, and what it costs

A project is priced from what it reserves, not from a tier. `compute` prints
every dial and the control plane's own itemised quote for them. (`rebase cloud
resources` is a different thing: the databases and buckets the code declares,
and whether each is provisioned — see the [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Dial | Unit, and what it means |
|---|---|
| `--cpu`, `--memory` | App request per instance, e.g. `500m` and `2Gi`. Empty means the platform default — `100m` and `384Mi`, bursting to 2 CPU and `2Gi` |
| `--replicas` | Instances that always exist: the autoscaler's floor, and what the project is billed for at rest |
| `--autoscale-max` | 1–16. The ceiling it may reach, and the worst case it may be billed. `--no-autoscale` turns it off |
| `--autoscale-cpu-target` | 10–95. The CPU utilisation the autoscaler holds, against the request rather than the limit. Empty means 70 |
| `--spot` | `true` or `false`. Preemptible capacity: cheaper, and restarted without notice |
| `--db-instances` | 1–3. `1` is a single instance with no failover; `2` adds an automatic standby |
| `--db-cpu`, `--db-memory`, `--storage` | Per database instance. Empty means `500m`, `2Gi` and the default volume |

An empty dial is not the same as one pinned to the same number: an empty dial
follows the platform default and moves when it moves.

Nothing is validated by the CLI, on purpose — the limits belong to the cluster a
project runs on, and they differ between providers. The control plane refuses a
value it cannot honour and names the field. Run `rebase cloud compute` to see
the €/month before and after; a change applies immediately, prorated from today,
except one that restarts the database, which waits for a maintenance window.

## The rest of the surface

| Command group | What it covers |
|---|---|
| `login`, `logout`, `whoami` | Your session |
| `tokens` | Tokens for CI and agents, each narrowed to one project. See [CI and agents](#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Binding this directory to a project, selecting an organization, opening the console |
| `projects` | Create, list, inspect, delete |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Shipping and watching |
| `previews` | Builds served on their own address by `deploy --preview`, and deleting them. See [Preview a change](#preview-a-change) |
| `start`, `stop`, `restart` | Pausing a project and bringing it back |
| `status`, `metrics`, `debug` | What it is doing, and why it is not |
| `cron` | The deployed app's cron jobs and their recorded runs, read with your `rebase cloud` login. Read-only |
| `env` | Environment variables. `list` never prints values; `--secret` is write-only |
| `domains` | Custom domains, the DNS records to add, and verification. A project can answer on several, each verified on its own; `verify` and `remove` take the domain to act on, which may be left out only when there is one (for `verify`, one still pending). `list --json` returns `{ projectId, tenantHost, domains: [...] }` |
| `db` | Attach or create a database, connect to it from your machine, backups, restore, and point-in-time recovery |
| `extensions` | The Postgres extension allowlist |
| `storage` | The project's bucket |
| `resources` | Which databases and buckets the platform holds, against what the code declares |
| `compute` | What this project reserves, what it costs, and how to change it |
| `clusters` | The clusters tenants run on. Platform-admin only |
| `settings`, `orgs`, `webhooks`, `billing` | Project settings, organizations, deploy hooks, payment |

Every group in that table answers `--help` with a page of its own — a usage line,
its flags, and examples — and `--help` never runs the command. A test holds the
index to the pages, so a group added without one fails the build rather than
answering with the table of contents. `verify:docs` holds the table itself to
that index: every group the CLI dispatches appears here exactly once, so a group
added without a row fails the build too.

Piped, `--help` answers in JSON instead: the same usage line, flags and examples
as a structure to read rather than sixty lines of terminal escapes.

## What the beta does not include

Stated plainly, because finding out later is worse:

- **No region choice.** Everything runs in one region today. The placement model
  exists in the platform, but a project cannot pick a region.
  `projects create --provider` and `--region` are not the exception they look
  like: they record which of the control plane's registered deploy targets a
  project belongs to, and there is one, so both default to it and neither moves a
  project anywhere else. `rebase cloud projects create --help` says the same.
- **Not self-serve.** Access is granted in batches; there is no sign-up-and-pay.
- **No published SLA**, and no SOC 2. If you need either, say so when you request
  access rather than assuming.
- **No branch deploys**, and no first-party GitHub App. Deploy hooks — secret URLs
  you point a repository webhook at — are the supported automation. [Preview
  deploys](#preview-a-change) are rolling out and are started from the CLI.
- **Tokens act as a person.** A [token](#ci-and-agents) is minted by an account
  and acts as it; there is no organization-owned machine identity yet. If you
  sign in from CI instead, pass `REBASE_CLOUD_EMAIL` and `REBASE_CLOUD_PASSWORD`
  from a secret store — `--password` puts the password in your shell history and
  in the process table, and says so before it signs you in. If the repository's
  `.rebase/cloud.json` names a control plane other than the platform's own, pass
  it as `--url` too: without a terminal, `login` refuses to send a password to a
  host that only the checked-out file named.
- **Point-in-time recovery is CLI-only.** The console shows backups; the staged
  PITR workflow is `rebase cloud db pitr`.
- **No public database endpoint.** A managed database is not exposed to the
  internet, so the host the console shows is your backend's address for it and
  resolves to nothing on your machine. `rebase cloud db connect` opens a local
  port that is that database, tunnelled through the control plane, for as long
  as you leave it running — but there is no permanent hostname a third-party
  service can connect to. That tunnel, and the password behind
  `rebase cloud db info --reveal`, both need the organization's owner or admin
  role: the same one Studio's SQL editor asks for, because all three end at a
  session on your production data.

## Self-hosting instead

Nothing here is a lock-in. The [self-hosting guide](/docs/deployment/self-hosting/)
runs the identical image and bundle with `docker compose`, and the
[Kubernetes guide](/docs/deployment/kubernetes/) renders the same topology from
the Helm chart.
