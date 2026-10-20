---
title: rebase cloud
sidebar_label: rebase cloud
description: The command groups for Rebase Cloud in the CLI — auth, project link, deploys, config, organizations, databases, resources, compute, storage, webhooks, clusters and billing.
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
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

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
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
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
backend's `/api/health` and each static app's address to answer. A failed deploy
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
leaves production alone. A preview of a static app calls the production backend.
A preview of the backend runs its own backend, on an empty database of its own.
See [Preview a change](/docs/deployment/cloud/#preview-a-change).

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

## Organizations

```bash
rebase cloud orgs list | create | members
```

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

## Storage, webhooks, clusters and billing

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```
