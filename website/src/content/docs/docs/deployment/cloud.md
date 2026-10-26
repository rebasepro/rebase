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

**Signed up with Google, GitHub or LinkedIn?** <span class="since-badge" data-since="0.26">Since 0.26</span> Your account has no password, so
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
tokens**) and set `REBASE_TOKEN`; see [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

A wrong password answers `invalid_credentials` with the same two ways in, since
the usual cause is an account that never had one.

`billing setup` attaches a card to the organization, once. It is first in the
sequence on purpose: the first deploy of a project is refused without one, and
finding that out after a bundle has finished uploading is the worse order.

After that, the console's **Billing** page lists the organization's invoices,
each with Stripe's hosted page and PDF, and previews the next invoice of every
project. `rebase cloud billing invoices` and `rebase cloud billing upcoming`
print the same. Both are for the organization's owners and admins. Where the
platform offers it, **Manage billing** opens Stripe's customer portal for the
card, the billing details and past invoices.

With a card already on file, creating another project in the console asks for
no second payment: the project is billed on that card and deploys. If the card
is declined, or the bank wants the payment confirmed, the console takes you to
**Billing**, where **Fix your card** saves another card and **Complete the
payment** opens Stripe's invoice.

What a project has used shows on its overview, under **Usage this month**, and
for every project at once on the **Billing** page: requests against the
included allowance (the bar turns amber at 80%), 5xx errors, the overage so far
and where the month is heading at this pace. The overage is computed by the
same code that reports it to Stripe, so it is what the invoice will carry; it
appears on the invoice of the month after. `rebase cloud usage` prints the
same, and `rebase cloud usage org` the whole organization. Any member can read
it. The figures say what they cannot see yet: object storage is not measured,
so no storage overage is billed; while a project runs two or more app pods,
its requests are not counted; and a day with missed samples undercounts. An
autoscaled project also shows the pods it ran above `--replicas`, in pod-hours,
what they cost at its own rates and whether this platform charges them yet. A
project claimed from an agent counts only the days from the claim on: before
it, the project was the platform's.

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
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" means the address answered after the build: a backend's `/health`
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

<span class="since-badge" data-since="0.26">Since 0.26</span>

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
quote in the console. `rebase cloud deploy --preview` prints the same quote for
it, per month (`cost` under `--json`). Starting one needs a card on file, as a production deploy
does. A first deploy that
fails before anything runs is removed rather than billed. A project may run
three backend previews at once.

Each new preview address gets a TLS certificate of its own from Let's Encrypt,
which allows a domain 50 new certificates a week, shared with every production
site on it. Previews may take 20 of them in any 7 days, across the platform. Past
that, a new preview is refused (`429`, `preview_cert_budget`) with the time it can
be deployed; redeploying a preview that already exists never counts.

A backend preview's database is a second database on **production's** Postgres:
its own data, but the same instance and the same disk. It is limited to 10
connections, so previews cannot use up production's, and to 2 GB: a preview
whose database grows past that is paused. Its backend stops, its address stops
answering, `rebase cloud previews` and the console show it as `paused` with the
reason, and the project's owners and admins are notified (`preview.paused`). Its
data is kept until it expires. Deploy it again to start it (it is paused again
while the database is still too large), or delete it. A paused preview is still
billed until it is deleted or expires. Delete previews you no longer need. Extensions installed on production are not
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
deploy, `deploy` says this instead of pointing at `rollback`, and `rollback`
without an id refuses rather than re-deploying the backend that is serving.

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

[Access tokens](/docs/deployment/cloud-agents/#ci-and-agents) are not sessions and do not ask for a second
factor, so CI keeps deploying after you turn it on. Revoke a token you no longer
trust under **Settings → Access tokens**.

## Invite your team

**Members → Invite member** gives a link to copy (emailed when this control plane
sends email) that works once, for 7 days, for an account that has verified that
address; nobody joins until they accept. Invite an admin or a member, and make
them an owner once they have joined. Owners and admins see, resend or revoke it in
**Pending invitations**; from a terminal, <span class="since-badge" data-since="0.26">Since 0.26</span> [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## See who did what

The console's **Activity** page and <span class="since-badge" data-since="0.26">Since 0.26</span> `rebase cloud activity` show the
organization's owners and admins who deployed, set or revealed an environment
variable (by name, never by value), changed a domain, restored a backup,
resized, stopped or deleted a project, changed a member's role, or created a
token, and when. A project's **Settings** links to its own entries; an entry
about a deleted project stays. A script reads it with a token made with
`--can audit` on the organization. Entries are kept for a year. The filters are in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI and agents

A CI job or an agent should not carry your password. Give it a token narrowed to
a few actions on one project, created from a signed-in terminal with
`rebase cloud tokens create --project shop --can deploy,logs`, and set it as
`REBASE_TOKEN`. An organization's billing, activity log and notification
settings are capabilities of their own (`--can billing`, `audit`,
`notifications`) that a token holds only when asked for. The capabilities, a
GitHub Actions workflow and what stays with a signed-in person are in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## A backend with no account

<span class="since-badge" data-since="0.26">Since 0.26</span>

`rebase cloud init --claim` gives an app a live backend before anyone has signed
up, and prints a claim URL for the person to keep it; a project nobody claims
within 72 hours is deleted. What the unclaimed project's token may do, the
`REBASE_API_TOKEN` it writes and what claiming changes are in
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

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
| `--replicas` | Instances that always exist: the autoscaler's floor, and what the project's subscription bills monthly |
| `--autoscale-max` | 1–16. The ceiling it may reach. Instances the autoscaler adds above `--replicas` are metered per pod-second at the same rates, and charged only where the platform has switched that on; **Usage this month** says which. `--no-autoscale` turns it off |
| `--autoscale-cpu-target` | 10–95. The CPU utilisation the autoscaler holds, against the request rather than the limit. Empty means 70 |
| `--spot` | `true` or `false`. Preemptible capacity: cheaper, and restarted without notice |
| `--db-instances` | 1–3. `1` is a single instance with no failover; `2` adds an automatic standby |
| `--db-cpu`, `--db-memory` | Per database instance. Empty means `160m` and `1Gi` |

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
| `tokens` | Tokens for CI and agents, each narrowed to one project. See [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Binding this directory to a project, selecting an organization, opening the console |
| `init`, `claim` | With `--claim`: a live backend with no account, and a link to claim it; `claim` prints that link again. See [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Create, list, inspect, delete |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Shipping and watching |
| `previews` | Builds served on their own address by `deploy --preview`, and deleting them. See [Preview a change](#preview-a-change) |
| `start`, `stop`, `restart` | Pausing a project and bringing it back. A stopped project keeps its subscription, unless the platform bills stopped projects for storage and the platform fee only; the console's **Billing** row says so when it does |
| `status`, `metrics`, `debug` | What it is doing, and why it is not |
| `cron` | The deployed app's cron jobs and their recorded runs, read with your `rebase cloud` login. Read-only |
| `env` | Environment variables. `list` never prints values; `--secret` is write-only |
| `app-key` | The key `init --claim` wrote into `.env` as `REBASE_API_TOKEN`, handed over at the claim; `rotate` replaces it and revokes the old one. Owners and admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin on the app's own API: when it was last rotated; `rotate` gives the app a new one. Owners and admins |
| `domains` | Custom domains, the DNS records to add, and verification. A project can answer on several, each verified on its own; `verify` and `remove` take the domain to act on, which may be left out only when there is one (for `verify`, one still pending). `list --json` returns `{ projectId, tenantHost, domains: [...] }` |
| `db` | Attach or create a database, connect to it from your machine, backups, restore, and point-in-time recovery |
| `extensions` | The Postgres extension allowlist |
| `storage` | The project's bucket |
| `resources` | Which databases and buckets the platform holds, against what the code declares |
| `compute` | What this project reserves, what it costs, and how to change it |
| `usage` | Requests used this month against the included allowance, and the overage so far, as the invoice counts it. `usage org` lists every project of the organization |
| `clusters` | The clusters tenants run on. Platform-admin only |
| `settings`, `orgs`, `billing` | Project settings, organizations and their members and invitations, payment |
| `activity` | The organization's audit log: who deployed, changed an environment variable (by name), a domain, a backup, a member or a token. Owners and admins. See [See who did what](#see-who-did-what) |
| `notifications`, `webhooks` | Where the project's events are POSTed: Slack, Discord or any https URL ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` is retired and exits 1 with code `command_retired` |

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
- **Tokens act as a person.** A [token](/docs/deployment/cloud-agents/#ci-and-agents) is minted by an account
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
- **Deploying is running code with the production secrets.** The app's
  environment holds `REBASE_SERVICE_KEY` (admin on its own API),
  `DATABASE_URL` and `JWT_SECRET`, so code a member deploys can read them,
  even though only owners and admins can reveal them in the console. Invite
  as a member only someone you would trust with those values.
- **The service key can be replaced.** <span class="since-badge" data-since="0.26">Since 0.26</span> The project's **Settings**
  (or `rebase cloud service-key rotate`) issue a new `REBASE_SERVICE_KEY`
  and restart the app onto it. The old key works until the restart has
  finished, and nothing after, so anything that copied it is refused from
  then on. Claiming a project does the same.

## Self-hosting instead

Nothing here is a lock-in. The [self-hosting guide](/docs/deployment/self-hosting/)
runs the identical image and bundle with `docker compose`, and the
[Kubernetes guide](/docs/deployment/kubernetes/) renders the same topology from
the Helm chart.
