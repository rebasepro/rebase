---
title: Deployment
sidebar_label: Overview
description: Where a Rebase project can run — Rebase Cloud, your own server, Kubernetes, or a managed container platform — and which guide to open for each.
---

## What you deploy

A Rebase deployment is two separable pieces: the **published runtime image**
(`rebasepro/server`) and the **bundle** `rebase build` produces from your
project. There is no application image to build, and upgrading Rebase is a tag
change rather than a rebuild. The same bundle runs on a laptop under Docker
Compose, on Rebase Cloud, and on every platform below.

If this is your first deployment, read the
[deployment guide](/docs/getting-started/deployment/) first: it covers what the
server serves, the environment it needs, and how to name the first
administrator before the first boot.

## Run it for me

- **[Rebase Cloud](/docs/deployment/cloud/)** — the same Rebase, operated for
  you: `rebase cloud deploy` from your project, a database per project, backups
  and TLS included.

## Run it yourself

- **[Self-hosting](/docs/deployment/self-hosting/)** — the runtime image plus a
  Postgres database, on Docker Compose or a plain VPS. Start here.
- **[Kubernetes](/docs/deployment/kubernetes/)** — the official Helm chart, with
  a migration Job that owns the schema.
- **[Splitting into several processes](/docs/deployment/split-processes/)** —
  one bundle as an API, a functions tier and a worker, so a heavy function
  stops competing with the data API.

## Platform guides

Each of these is the same two pieces, wired to that provider's managed Postgres
and container runtime. All of them can be kept inside the EU.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS and App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL and Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL and Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform or Docker Compose,
  in Germany or Finland.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, in France.
- **[Railway](/docs/deployment/railway/)** — the image and a managed Postgres,
  in one project.
- **[Fly.io](/docs/deployment/flyio/)** — global, or pinned to EU regions.
