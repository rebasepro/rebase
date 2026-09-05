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

To ship an artefact that was built earlier — a CI job that builds once and
deploys twice, say — point at the directory instead of rebuilding:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Watch it:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` reports `blockedOn` and `nextAction`. When `blockedOn` is `null` the
platform is genuinely working and polling is the right thing to do; when it names
something, that something is waiting for you.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

A rollback re-points the project at a previous successful deployment's image. It
needs one that recorded an image, so it is available for a project that has
deployed successfully at least twice.

## The rest of the surface

| Command group | What it covers |
|---|---|
| `login`, `logout`, `whoami` | Your session |
| `link`, `unlink`, `use`, `open` | Binding this directory to a project, selecting an organization, opening the console |
| `projects` | Create, list, inspect, delete |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Shipping and watching |
| `start`, `stop`, `restart` | Pausing a project and bringing it back |
| `status`, `metrics`, `debug` | What it is doing, and why it is not |
| `env` | Environment variables. `list` never prints values; `--secret` is write-only |
| `domains` | Custom domains, the DNS records to add, and verification |
| `db` | Attach or create a database, backups, restore, and point-in-time recovery |
| `extensions` | The Postgres extension allowlist |
| `storage` | The project's bucket |
| `settings`, `orgs`, `webhooks`, `billing` | Project settings, organizations, deploy hooks, payment |

Every group answers `--help`, and `--help` never runs the command.

## What the beta does not include

Stated plainly, because finding out later is worse:

- **No region choice.** Everything runs in one region today. The placement model
  exists in the platform, but a project cannot pick a region.
- **Not self-serve.** Access is granted in batches; there is no sign-up-and-pay.
- **No published SLA**, and no SOC 2. If you need either, say so when you request
  access rather than assuming.
- **No preview or branch deploys**, and no first-party GitHub App. Deploy hooks —
  secret URLs you point a repository webhook at — are the supported automation.
- **CI needs a human's credentials.** There is no machine token yet;
  `rebase cloud login` takes an email and a password.
- **Point-in-time recovery is CLI-only.** The console shows backups; the staged
  PITR workflow is `rebase cloud db pitr`.

## Self-hosting instead

Nothing here is a lock-in. The [self-hosting guide](/docs/deployment/self-hosting/)
runs the identical image and bundle with `docker compose`, and the
[Kubernetes guide](/docs/deployment/kubernetes/) renders the same topology from
the Helm chart.
