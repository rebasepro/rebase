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

**Signed up with Google, GitHub or LinkedIn?** Your account has no password, so
sign in with a code instead:

```bash
rebase cloud login --code --email me@example.com
```

The control plane emails you a 6-digit code, good for ten minutes, and you type
it at the prompt. Run plainly at a terminal, `rebase cloud login` asks whether
to use your password or a code. Codes need the control plane to be able to send
email; if it cannot, `--code` says so and exits with `otp_unavailable`.

If you turned on two-factor authentication, `login` then asks for the code from
your authenticator app, or one of your recovery codes, whichever way you signed
in. Neither a sign-in code nor a second factor can be typed without a terminal.
For a script, create an access token in the console (**Settings → Access
tokens**) and set `REBASE_TOKEN`; see [CI and agents](#ci-and-agents).

A wrong password answers `invalid_credentials` with the same two ways in, since
the usual cause is an account that never had one.

`billing setup` attaches a card to the organization, once. It is first in the
sequence on purpose: the first deploy of a project is refused without one, and
finding that out after a bundle has finished uploading is the worse order.

After that, the console's **Billing** page lists the organization's invoices,
each with Stripe's hosted page and PDF, and previews the next invoice of every
project. `rebase cloud billing invoices` and `rebase cloud billing upcoming`
print the same. Both are for the organization's owners and admins.

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
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
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

- **`rebase cloud deploy --preview`** previews the backend, with its static apps
  folded in, the same way production runs them. It gets a backend of its own on
  an **empty database of its own**, never production's. Booting against
  production's database would apply the preview's schema and access rules to it.
- **`rebase cloud deploy web --preview`** would preview one static app on its
  own, its pages calling the **production** backend. That needs a control plane
  that serves static sites by themselves, and Rebase Cloud does not yet: it
  refuses with `PREVIEW_STATIC_UNSERVED` and publishes nothing. Preview the
  backend instead, which serves the static apps folded into it; a project with
  no managed backend cannot be previewed yet.

A preview uploads no source and registers no apps or hostnames, because each of
those would change the production project. `--source` and `--eject` cannot be
combined with `--preview`. Each builds a container image for production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` without `--preview` is always production's.

The console's **Deployments** page lists the same previews, and opens, shows the
build log of, or deletes each one. Creating one stays a CLI step.

A preview expires a week after it was last deployed to.

When it finishes, the deploy checks that the preview's address answers, as a
production deploy does (`--live-timeout <seconds>`, `0` to skip). A new
preview's certificate can take a minute or two, so a deploy that succeeded can
say the address does not answer yet.

A backend preview is billed like one app unit at the default size (100m of CPU
and 384 MiB of memory, at your app's rate for its region and capacity),
prorated for as long as it exists, and it appears in the project's monthly
quote in the console. Starting one needs a card on file, as a production deploy
does. A first deploy that
fails before anything runs is removed rather than billed. A project may run
three backend previews at once.

A backend preview's database is a second database on **production's** Postgres:
its own data, but the same instance and the same disk. It is limited to 10
connections, so previews cannot use up production's, but its size is not
limited: a preview that loads a large fixture fills production's disk too.
Delete previews you no longer need. Extensions installed on production are not
installed in a preview's database.

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

## Restore the database to a point in time

A managed database can be recovered to any minute inside its recovery window,
from **Database → Backups** in the console or with the CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
It takes two steps. First a recovered copy is staged beside the live database;
your app keeps running on the live one, and the copy's storage is billed until
you cut over or discard it.
Then, once the copy is ready, cutting over repoints the app at it and restarts
it. Anything written after the target time is not in the copy. The original
database is kept as the way back, and keeps billing storage; switching back,
removing it, or a second restore goes through support. Only an owner or admin
can stage, cut over or discard, and the console asks for the project's name
before it cuts over.

## Secure your account

Your console account can reach production databases, secrets and billing, so
protect it like one. Open **Account security** from the menu under your avatar
in the console (or go to `/account`). The page is yours, not an
organization's: what you set there applies in every organization you belong to.

- **Two-step verification.** Turn it on with any authenticator app (1Password,
  Google Authenticator, Authy). The page shows a setup key to add to the app, or a
  link that opens the app with the key filled in on a phone, then asks for the
  6-digit code the app shows. From then on, every sign-in asks for a code,
  whether you sign in with a password, Google or GitHub.
- **Recovery codes.** Turning it on gives you ten single-use codes, shown once.
  Each one signs you in in place of the authenticator code if you lose your
  phone, so save them before you close the dialog. **New recovery codes**
  replaces them, and the old ones stop working. Turning two-step verification
  off and getting new codes both ask for a code first.
- **Password.** Changing it signs you out on every other device. An account
  created with Google, GitHub or LinkedIn has no password; the page offers to
  email you a link to set one.
- **Signed-in devices.** Every browser and terminal signed in to your account,
  with its address and when it signed in. Sign out any device you do not
  recognise, or all of them at once.

[Access tokens](#ci-and-agents) are not sessions and do not ask for a second
factor, so CI keeps deploying after you turn it on. Revoke a token you no longer
trust under **Settings → Access tokens**.

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
| `deploy` | Deploy the project and follow its builds: `deploy` (`--preview` included), `deployments`, `previews` |
| `logs` | Read build and runtime logs, and live metrics: `logs`, `metrics` |
| `env` | Read and change environment variables, secrets included, and previews' own (`--preview`) |
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

## A backend with no account

An agent that has built an app can give it a live backend before anyone has
signed up, and hand the person it works for a link to keep it:

```bash
rebase cloud init --claim
```

That provisions a project on Rebase Cloud, sets `REBASE_BASE_URL` in `.env` to
its live address, links the directory, and deploys the local collections with
`rebase cloud deploy --bundle`. It prints the live URL, the admin panel URL and a
**claim URL**. Whoever opens the claim URL and signs in can move the project into
one of their organizations. The link works once. A project nobody claims within
72 hours is deleted, database included. The MCP server's `rebase_cloud_provision`
tool runs the same command and returns the same URLs.

`REBASE_BASE_URL` in `.env` is also where `rebase api-keys`, `rebase storage`
and `rebase auth reset-password` send the local service key, so after `init
--claim` they go to the cloud project, which does not take that key. They say so
when they do; set `REBASE_BASE_URL` in the shell to reach a local backend
instead.

Until the project is claimed it belongs to no account. Its token is narrowed to
that one project: it deploys, reads logs and metrics, sets environment variables
and runs `db info`. It reads nothing secret back: not a variable's value (the
service key included), not the database password, and it cannot open
`db connect` or a preview. It is kept in
`~/.rebase/credentials.json`, never in the repository, and `rebase cloud`
commands in the linked directory use it on their own (`REBASE_TOKEN`, when set,
still wins, and those commands warn that it did; the deploy `init --claim` runs
always uses the project's own token). It expires with the project. `rebase cloud whoami` in that directory shows the project, what the
token may do, the claim URL and when the project expires. A command that needs a
person's session refuses with `session_required` and keeps the token; it is
forgotten only once the control plane refuses it everywhere, after a claim or at
expiry, and the claim URL is printed as it goes. `rebase cloud status` shows the
claim URL and the expiry too (`unclaimed` in `--json`). `rebase cloud unlink`
does not delete an unclaimed project: it warns that the project keeps running
until it expires and prints the claim URL, and `init --claim` in a directory
that is already linked to one points at its claim URL instead of provisioning a
second. Until the claim, the app reaches the internet on ports 80 and 443 only;
the mail ports every other project has (465, 587 and 993) open when the project
is claimed.

Once the deploy has built the app, the command also sets `REBASE_API_TOKEN` in
`.env`: a key minted on the app itself, which is what the MCP server and the SDK
send to it. A `REBASE_API_TOKEN` already in `.env` is kept and none is minted,
and a `.env` the command creates is readable by you alone. It reads and writes data (`data:read`, `data:write`) through the
app's row-level security, as a caller who is neither a person nor an admin. It
holds nothing of the admin plane, and it expires with the claim window. With
`--no-deploy`, or when that first deploy fails, there is no key yet: the next
`rebase cloud deploy` that succeeds in the directory asks for one, as long as the
project is unclaimed and `.env` sets no `REBASE_API_TOKEN` already. The key
expires at the end of the claim window even when the project is claimed sooner,
so the MCP server and the SDK start getting 401 from the app then; `init`,
`deploy`, `status` and `whoami` print the date, and so does the refusal that
follows a claim. Once the project is yours, create a permanent key in its admin
panel and put it in `.env` as `REBASE_API_TOKEN` in place of the agent's.

Claiming takes a signed-in browser session, not a token, and a payment method on
the organization the project moves into. From the claim onwards the project is
billed like any other. Claiming also revokes the agent's token: sign in with
`rebase cloud login`, or mint a new token with `rebase cloud tokens create`.

Provisioning without an account is bounded per address and in total, and a
control plane that has not switched it on refuses with a message saying so.

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
| `--replicas` | Instances that always exist: the autoscaler's floor, and what the project is billed for |
| `--autoscale-max` | 1–16. The ceiling it may reach. Instances the autoscaler adds above `--replicas` are not billed today. `--no-autoscale` turns it off |
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
| `init` | With `--claim`: a live backend with no account, and a link to claim it. See [A backend with no account](#a-backend-with-no-account) |
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
