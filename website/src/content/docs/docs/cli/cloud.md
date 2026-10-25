---
title: rebase cloud
sidebar_label: rebase cloud
description: The command groups for Rebase Cloud in the CLI — auth, project link, deploys, notifications, config, organizations, databases, resources, compute, storage, clusters, billing and usage.
---

Everything to do with Rebase Cloud, which is in private beta. See the
[Rebase Cloud guide](/docs/deployment/cloud/) for what it is and what the beta
does not include.

Every group answers `--help`, and `--help` never runs the command. Most commands
act on the linked project in `.rebase/cloud.json`; `--project <id>` operates on
one without linking.

Three options apply everywhere: `--json` for machine-readable output (also the
default when piped, except for `deploy`, or with `REBASE_JSON=1`), `--url <origin>` to target a
specific control plane (or `REBASE_CLOUD_URL`), and `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

At a terminal with no password given, <span class="since-badge" data-since="0.26">Since 0.26</span> `login` asks whether to use your password
or a code the control plane emails you. With two-factor authentication on, it
then asks for your authenticator code (or a recovery code). Without a terminal
neither can be typed: set `REBASE_TOKEN` to an access token made in the console
under Settings → Access tokens. See [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

<span class="since-badge" data-since="0.26">Since 0.26</span> `claim` prints the claim link of the project `init --claim` provisioned in this
directory, and the time left before it is deleted unclaimed (`Unclaimed: deleted
in 41h`). `--open` also opens it in a browser. The link is kept only on the
machine that ran `init --claim`, in `~/.rebase/credentials.json`; the control
plane stores a hash of it and cannot print it again. Before answering, `claim`
asks the control plane whether the project's own token still works. A claim
revokes that token, so once someone has claimed the project, `claim` refuses
with `already_claimed` instead of printing a dead link. It also refuses once the
window has ended (`claim_expired`), and in a directory with no claim link
(`no_claim_link`). `rebase cloud status` and `rebase cloud whoami` show the same
link while the project is unclaimed.

## Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` with no app name deploys the backend. A backend bundle
deploy also uploads the project's source — what git tracks, never a `.env` — so a
platform upgrade can rebuild it; `--no-source` skips that once, and `cloud settings set
--platform-rebuilds off` stops it and deletes the stored copy. `--allow-downgrade` deploys an older release.

A followed `deploy` ends on a summary: each app it shipped with its URL, the
deployment id, how long it took, and whether the new version answers there. It
waits up to `--live-timeout` seconds (default 60; `0` skips the check) for a
backend's `/health` and each static app's address to answer. A failed deploy
ends on one line naming the app and the reason, and exits non-zero. The summary
prints even when piped; `--json` (or `REBASE_JSON=1`) prints one object instead,
with `apps`, `hosts`, `live`, `liveChecks` and `durationMs`.

Before uploading, `deploy` parses the JavaScript of every static app it ships:
the `.js`/`.mjs`/`.cjs` files in its `output` and the inline `<script>` blocks in
its HTML. A syntax error stops the deploy with `file:line:column` (code
`syntax_error` under `--json`), and `--no-verify` skips the check. A successful
deploy ends with the way back, `rebase cloud rollback`. A static app deployed on
its own cannot be rolled back yet; see
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` serves the build at `https://<project>--<name>.rebase.website` and
leaves production alone. A preview of the backend runs its own backend, on an
empty database of its own, with its static apps folded in. A static app cannot be
previewed on its own on Rebase Cloud yet: `rebase cloud deploy <app> --preview`
is refused with `PREVIEW_STATIC_UNSERVED` and publishes nothing. A backend
preview is billed as one more app unit at the default size while it exists, and
the deploy says what that comes to per month, from the control plane's own quote
(`cost` under `--json`; only the rule and this link when the control plane cannot
price it); `rebase cloud previews delete <name>` stops it.
See [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` prints the latest build log, and `-f` tails a build that is
still running. `--runtime` reads what the app prints instead, from every pod
behind it, each line tagged with its pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` takes a duration (`30s`, `5m`, `1h`) or an RFC3339 time.
- `--tail <n>` is the lines per pod to start from (the control plane caps it at 2000).
- `--grep` keeps lines containing the text, in any case; write `/re/flags` for a
  regular expression.
- `--level error|warn|info|debug` keeps lines at that severity or worse. It reads
  the structured `severity` a Rebase backend logs, a level word at the start of a
  plain line, or an error shape such as `TypeError:`. Lines with none are left out.

<span class="since-badge" data-since="0.26">Since 0.26</span> A follow polls every two seconds and prints each line once. It announces pods
that start, stop or restart. When a container restarts it also prints the last
lines of the instance that died, where the reason usually is. It waits while no
pod is running, and after a dropped connection it retries with backoff and
resumes where it left off. With `--json`, a follow prints one JSON object per
line (NDJSON): `{"type":"line","ts","pod","text"}` for each log line, and
`{"type":"event","event":…}` for the rest.

`--preview <name>` reads a preview instead of production. Use the preview's
name, or the deployment id a preview deploy printed. On its own, `--preview`
reads the project's only preview. A static preview has a build log but no
runtime log, because it runs no server.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

A backend preview starts from production's variables, live keys included.
`env set KEY=VALUE --preview` gives previews their own value, `env unset KEY
--preview` leaves the variable out of them, `env reset KEY --preview` hands
back production's value, and `env list --preview` shows the differences.
Production is never changed by any of them.

<span class="since-badge" data-since="0.26">Since 0.26</span> `env set KEY --stdin` reads the value from standard input instead of the
command line, where `ps` and your shell history would show it:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

One trailing newline is dropped. The MCP server's `rebase_cloud_env_set` sets
values this way.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

<span class="since-badge" data-since="0.26">Since 0.26</span> `members invite` adds someone whose Rebase account has the address verified,
and otherwise opens an invitation and prints its link: single use, valid 7 days,
accepted only by an account that has verified that address. The output (and
`emailDelivery` in `--json`) says whether it was emailed; when it was not, a
warning says to send the link yourself. `--role` is `admin` or `member`
(default); `owner` only adds an existing verified account, and only an owner
may grant it. `invites resend` gives a new link and the old one stops working.
Inviting and `invites` need a `rebase cloud login` session; `REBASE_TOKEN` is
refused. Inviting, resending and revoking take the owner or admin role; listing
takes any member.
`members remove` asks first (`--yes` skips it); removing or demoting an owner
takes an owner, and the last owner stays. `--org <id>` picks an organization
other than the selected one.

<span class="since-badge" data-since="0.26">Since 0.26</span> `activity` is the selected organization's audit log, newest first: who
deployed, rolled back, set, deleted or revealed an environment variable (by
name, never by value), changed a domain, created, restored or downloaded a
backup, changed a project's compute, stopped or deleted a project, changed a
member's role, or created or revoked an access token. `--action` takes an area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) or a full action
such as `env.set`. A page holds up to 100 entries (`--limit`, default 50); the
output prints the `--before` cursor for the next one. `--json` is one value,
`{ org, events, nextCursor }`. It needs the organization's owner or admin role
and reads with your login: no access-token capability includes it. The
console's **Activity** page shows the same log.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` opens a local port that *is* the managed database (no public
endpoint) until Ctrl-C; `--reveal` adds the password. Owner or admin only.

## Resources

What the platform holds for the project, against what its code declares.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

A deploy never removes a provisioned database when its declaration goes — that
would be data deleted by a push. It keeps, binds and bills it until somebody
prunes it by name.

## Compute

What the project reserves, and what that costs.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` takes `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` and `--no-autoscale`.
`--scale-to-zero` is retired: every backend runs at least one instance, so
`true` is refused and `false` is ignored with a warning. There are no plan
tiers: everything is priced per resource. See
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

<span class="since-badge" data-since="0.26">Since 0.26</span> `notifications add <url>` sends the linked project's events to a URL. `--events`
takes a comma-separated list of `deploy.failed` (the default),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed` and `usage.threshold`. `--format slack` sends
`{ "text" }` alone instead of the event JSON, which also carries a `text`. The URL
is a positional argument because `--url` names the control plane. `add` prints
the signing secret once; `--json` returns `{ projectId, webhook, secret }`.
`test <id>` exits 1 with code `delivery_failed` when the receiver did not accept
the test event. Listing is open to any member of the organization; `add`, `test`
and `remove` need the owner or admin role. These routes take your
`rebase cloud login`: no access-token capability includes them. See
[Cloud notifications](/docs/deployment/cloud-notifications/).

<span class="since-badge" data-since="0.26">Since 0.26</span> `billing invoices` and `billing upcoming` read the same Stripe data as the
console's Billing page, and are open to the organization's owners and admins
only. Amounts in `--json` are in the currency's minor unit (cents), exactly as
Stripe sends them. Draft invoices are not listed; the preview is computed by
Stripe and its metered lines keep growing until the period closes.

<span class="since-badge" data-since="0.26">Since 0.26</span> `usage` reads what the linked project (or `--project`) has used in a calendar
month, in UTC: requests against the included allowance, 5xx errors, the overage
so far in euros and, for the month in progress, where it is heading at this
pace (an estimate). The overage is the overage report's own calculation, the
one that tells Stripe what to bill, and lands on the following month's invoice.
`usage org` lists every project of the organization selected with `rebase cloud
use`, and the total. Any member of the organization can read it, with their
login: no access-token capability includes it yet, so `REBASE_TOKEN` is refused.
`--month` takes a past month. The answer carries `caveats`, each with a `code`: `storage_not_measured`
(object storage reads 0), `multi_pod_undercount` (requests served while two or
more app pods run are not counted), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed` and `billed_next_month`.
