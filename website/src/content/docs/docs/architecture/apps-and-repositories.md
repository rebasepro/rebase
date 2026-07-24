---
title: Apps and Repositories
sidebar_label: Apps & Repositories
description: A project is a backend plus the apps that talk to it — web, admin and mobile — which can each live in their own repository.
---

## Projects and apps

A **project** is the backend: the database, auth, storage, realtime and
functions. An **app** is something that talks to it.

| Type | What it is |
| --- | --- |
| `backend` | The collections, hooks and functions that define the API. Exactly one per project. |
| `static` | A built client bundle — an SPA or static site. |
| `admin` | The Rebase admin panel, hosted for you or built into your repository. |
| `mobile` | A native app. Registered for configuration; never built or hosted here. |
| `custom` | An arbitrary container image built from your own Dockerfile. |

The important part is what *owns* the list. A repository declares only the apps
it contains; the project owns the set of apps that exist. Two repositories never
need to know about each other — they only need to know the project. That is what
makes a separate frontend repository, or a mobile app with no repository
relationship at all, an ordinary thing rather than a special case.

## `rebase.json`

The manifest declares topology, and nothing else. Schema, security rules, hooks
and functions stay in TypeScript where a type system can check them.

```jsonc
{
  "runtime": "^1",
  "apps": {
    "backend": { "type": "backend" },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "spa": true
    },
    "admin": { "type": "admin", "mode": "hosted" }
  }
}
```

An existing project does not need one. The CLI infers the same layout from the
directory structure, and `rebase apps init` writes it down when you want it
explicit:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Building and deploying apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build web          # just the static assets
```

The backend builds first, because a client app's build may consume an SDK
generated from its collections.

## Multiple repositories

The monorepo stays the default: one repository with a backend, a web app and the
admin panel is the simplest thing that works, and `rebase init` scaffolds it.
Splitting up is the graduation step, not a requirement.

In a separate frontend repository you need two things — a manifest declaring
what this repository contributes, and a link to the project:

```jsonc
// rebase.json
{
  "runtime": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase link https://api.example.com     # a self-hosted project
rebase link                             # or pick a Rebase Cloud project
```

The link is written to `.rebase/cloud.json` and is **not committed** — it is
per-checkout, like a git remote. The manifest is committed; the link is not.

## Typed clients without the collections

This is the mechanism that makes multi-repo work. A repository that contains no
collections generates its typed SDK from the project itself:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

The CLI fetches `/api/meta/contract`, rebuilds the collection definitions —
including relation targets, which the type generator needs to decide whether a
foreign key is a string or a number — and emits exactly the same output it would
have produced from local source.

The contract endpoint is admin-only. Collection definitions describe every table,
column and relation in the project, including ones no security rule would ever
expose; that is a map of the database, not public API documentation.

## Detecting drift

Splitting repositories costs you one thing worth naming: a schema change and the
frontend that uses it no longer land in the same commit. The backend can deploy a
change that strands a client built against the old shape.

Every generated SDK records the schema it came from:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

And every project publishes its current one, without authentication, because a
version stamp reveals nothing about the schema it stands for:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","mode":"cms"}
```

Comparing the two in CI turns a silent mismatch into a failed check. The stamp
changes when the generated types could change — a new property, a changed
relation — and deliberately *not* when a hook, a security rule or an icon
changes, so it does not cry wolf.

## Client configuration

```bash
rebase apps config web
```

Prints what a client needs to reach the project. It never prints a secret: the
API URL and an app's publishable identity are meant to ship inside a client
bundle, and anything that is not safe there does not belong in output that will
end up in a committed `.env`.
