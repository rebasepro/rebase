---
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado por nosotros. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye todavía la beta privada.
---

:::note[Esta página solo está disponible en inglés]
La traducción está pendiente. El contenido siguiente está en inglés.
:::

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
rebase cloud projects create my-app
rebase cloud link
```

`link` writes `.rebase/cloud.json`, which records the project id and slug. It is
not a secret and it is not your credentials — those live in
`~/.rebase/credentials.json`, written by `login`.

An existing project links to an existing Cloud project without creating one:

```bash
rebase cloud projects list
rebase cloud link
```

## Deploy

```bash
rebase build
rebase cloud deploy --bundle
```

`--bundle` uploads the built bundle and runs it on the platform image. That is
the path to use: a bare `rebase cloud deploy` builds from **source** instead,
which is a different and slower mechanism.

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
