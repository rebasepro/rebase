---
title: Apps and Repositories
sidebar_label: Apps & Repositories
description: A project is a backend plus the apps that talk to it, which can each live in their own repository.
---

## Projects and apps

A **project** is the backend: the database, auth, storage, realtime and
functions. An **app** is something that talks to it.

| Type | What it is |
| --- | --- |
| `backend` | The collections, hooks and functions that define the API. Exactly one per project. |
| `static` | A built client bundle — an SPA or static site, served at its own path. |

That is the whole list. The admin panel is a `static` app like any other: it is
built in your repository, against your collections, which is why custom fields
and custom views work in it on day one.

Who owns the server process is a property of the backend, not a separate app
type:

| `runtime` | What it means |
| --- | --- |
| `managed` | The platform's runtime image runs your bundle. You supply collections, functions, crons and schema. |
| `custom` | You supply the server: your own Dockerfile and entrypoint. `rebase eject` sets this up. |

This is independent of *where* it runs. Both run on Rebase Cloud and both
self-host — the destination lives in `.rebase/cloud.json`, not in the manifest.

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
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin"
    }
  }
}
```

One process serves all of it: the API at `/api`, the site at `/`, the admin at
`/admin`. That is the self-hosting story, and a perfectly good small tier on
Rebase Cloud.

`path` is a **build-time** input as well as a serving one. An app mounted at
`/admin` has to be *built* for `/admin`, or `index.html` loads and every asset
404s — a blank page with no error anywhere. `rebase build` passes the value as
`REBASE_APP_BASE`, which your bundler reads as its base path:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

and refuses to ship a build that ignored it.

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
rebase build admin        # just that app's static assets
```

The backend builds first, because a client app's build may consume an SDK
generated from its collections.

## Multiple repositories

The monorepo stays the default: one repository with a backend and an admin panel
is the simplest thing that works, and `rebase init` scaffolds it. Splitting up is
the graduation step, not a requirement.

In a separate frontend repository you need two things — a manifest declaring
what this repository contributes, and a link to the project:

```jsonc
// rebase.json
{
  "rebase": "^1",
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
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
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
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
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
