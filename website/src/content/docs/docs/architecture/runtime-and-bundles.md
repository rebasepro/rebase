---
title: Runtime and Bundles
sidebar_label: Runtime & Bundles
description: How a Rebase project separates into a project bundle and a versioned runtime, and why that separation is what makes upgrades, multi-repo apps and managed hosting possible.
---

## The two halves of a deployment

A Rebase deployment is two things, not one:

- **The bundle** — your project. Compiled collections, hooks, functions and cron
  jobs, plus a generated manifest describing what they need.
- **The runtime** — the engine. `@rebasepro/server`, shipped as the published
  `rebasepro/server` container image.

They are built, versioned and shipped separately. That single decision is what
everything else on this page follows from: because the engine is not baked into
your application image, it can be replaced underneath your project — for a
security fix, a performance improvement, a new feature — without rebuilding
anything you wrote.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

The runtime you self-host is the same runtime Rebase Cloud runs. There is no
separate "platform" build, and nothing about the managed tier is unavailable to
someone running `docker compose up`.

## Building a bundle

```bash
rebase build
```

This regenerates the database schema from your collections, type-checks and
compiles them, resolves import specifiers so Node can load the output directly,
and writes `dist-bundle/` containing:

| Path | What it is |
| --- | --- |
| `manifest.json` | Generated. The contract this bundle claims to satisfy. |
| `package.json` | Generated. Your project's runtime dependencies. |
| `config/` | Compiled collections. |
| `backend/functions/` | Compiled server functions. |
| `backend/crons/` | Compiled cron jobs. |
| `backend/src/schema.generated.js` | Compiled database schema. |

The manifest is worth understanding, because it is what a runtime validates
before it agrees to boot:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.13.0", "contract": 1 },
  "schemaVersion": "v1:c5d97d0f96b7f87a",
  "kind": "backend",
  "entry": {
    "config": "config",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "hooks": { "native": false },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

`kind` is either `backend` — boot the server, plus any static apps in
`entry.static` — or `static`, which serves those assets and nothing else: no
database, no auth. Whether a backend declares its collections in code or
introspects them from the live database is not a third kind; it is simply
whether `entry.config` is there.

## Running a bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` loads the bundle in-process, so signals and stack traces reach
you directly. Locally it links your already-installed dependencies into the
bundle so there is no second install; a deployment installs the bundle's own
`package.json` instead.

## Compatibility

Two version numbers govern whether a bundle and a runtime can work together, and
they are deliberately not the package version.

**`bundleFormat`** is the on-disk layout. A runtime accepts any bundle whose
format is less than or equal to its own, and refuses a newer one rather than
half-loading it. An older bundle on a newer runtime must keep working — that is
the entire point of the separation, so a runtime reads every format it has ever
shipped. Format 1 bundles, which named this field `mode` and carried a single
static directory, still boot unchanged.

**`runtime.contract`** is the interface between a bundle and the engine. Within
one contract major, any bundle that validated keeps validating. Patches and
minors are drop-in; a major is not, and a runtime will refuse a bundle from a
different one rather than start and misbehave later.

This is why upgrading Rebase in a self-hosted deployment is a tag change:

```yaml
image: rebasepro/server:0.14.1   # was 0.14.0 — your bundle is untouched
```

## Development uses the same path

`rebase dev` boots the same runtime over your TypeScript source instead of a
compiled bundle. Hot reload still works, and development predicts production
because both go through one boot path rather than two implementations that
drift.

A project that needs something the stock runtime does not do can still write its
own `backend/src/index.ts` and import the server as a library. `rebase dev`
detects it and runs it. See [Custom server](/docs/backend/custom-server/) — you
lose the stock runtime, not the API surface.

## What the runtime reads from the environment

The runtime is configured entirely by environment variables, because that is what
every deployment target agrees on.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Connection string for the default database. Required. |
| `JWT_SECRET` | Signing secret, at least 32 characters. Required in production. |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API. Required in production. |
| `PORT` | Port to bind. Default `3001` locally, `8080` in the image. |
| `REBASE_SERVICE_KEY` | Server-to-server key granting admin access. |
| `REBASE_METRICS` | `true` to expose Prometheus metrics at `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` leaves the schema alone; anything else — including unset — runs the additive provisioning pass. Defaults to `ensure` everywhere, production included. |
| `REBASE_SERVE_STATIC` | Serve the bundle's static assets from this process. Default on. |

Several databases and several buckets are configured by suffixing the variable
with the source key — see [Multiple databases and
buckets](/docs/backend/multiple-sources/).

## Endpoints the runtime always serves

| Path | Purpose |
| --- | --- |
| `GET /health` | Readiness. Performs a database round-trip. |
| `GET /livez` | Liveness. Deliberately does *not* touch the database, so a database blip cannot make an orchestrator kill a healthy process. |
| `GET /api/meta/schema-version` | The current schema version. Unauthenticated — it is a version stamp, not a schema. |
| `GET /api/meta/contract` | The full collection contract. Admin-only. |
| `GET /metrics` | Prometheus metrics, when `REBASE_METRICS=true`. |
