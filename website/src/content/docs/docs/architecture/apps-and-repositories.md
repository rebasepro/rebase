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
| `static` | A built client bundle — an SPA or static site, served at its own path, or on a hostname of its own. |

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
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

One process serves all of it: the API at `/api`, the site at `/`, the admin at
`/admin`. That is the self-hosting story, and a perfectly good small tier on
Rebase Cloud.

## Saying where the CMS is

`cms` is the URL path where an app mounts `<RebaseCMS>`. It is optional, it is
the one field here that describes what is *inside* an app rather than where the
app lives, and it exists because nothing else can find that out.

The CMS is a React component in your own frontend, so its address is a
client-side route. It is not a server route, not a file in the build, and not
distinguishable from any other unmatched path under a SPA — a request to
`/admin` gets the same `index.html` as a request to `/anything-else`. So no
deploy, no running server and no amount of probing can tell where your admin
panel is. If you do not write it down, nothing knows.

What knows it, does something with it:

- **Rebase Cloud** puts an *Open CMS* link in the project header and lists the
  address on the project's overview — on the app's own hostname when it has
  one. Without `cms`, the console can offer only the project host — which
  reaches the CMS only if the CMS happens to sit at the root of it.
- **`rebase dev`** prints the CMS URL in its startup banner when it is not
  simply the frontend's home page.
- **`rebase apps list`** shows it beside the app that serves it.

Three shapes, and all of them are ordinary:

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

The value is the path you would type after the hostname, not a path relative
to `path`, and it has to be inside the app declaring it — that app's SPA
fallback is what answers there. It is always a path, even when the app's `path`
is a URL: the CMS is then at that path on the app's hostname, so `"cms": "/"`
above means `https://admin.example.com/`. A project has one CMS; declaring a
second is an error rather than a coin toss over which one the console links to.

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

## An app on its own hostname

`path` can also be a full `https://` URL, which gives the app a hostname of its
own:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
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
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` serves `admin`. Every other hostname the project
answers on — `example.com`, or the project's own address on Rebase Cloud —
serves `web`, and `admin` is not reachable there at all. It is still one
process and one deploy; the hostname only decides which app answers a request.

Two rules decide it:

- An app with a hostname answers only on that hostname. An app without one
  answers on every hostname.
- Of the apps left, the one with the longest path wins, as it always has. At an
  equal path, the app that names the hostname wins over the one that does not.

In the example both apps are at `/`, so on `admin.example.com` the second rule
picks `admin`. Declare the admin at `"https://admin.example.com/cms"` instead
and it answers only under `/cms` on that hostname: `admin.example.com/pricing`
goes to `web`. A hostname narrows where an app answers; it does not hand the
app everything on that hostname. No two apps may share both a hostname and a
path.

The backend is not an app, and a hostname does not move it. `/api`, `/health`
and the other paths the backend reserves are answered before any app is
consulted, on every hostname, so `https://admin.example.com/api` is the same
API as `https://example.com/api`. An app that calls its own origin — the
scaffold's empty `VITE_API_URL` — needs no API URL of its own and no CORS
setting. For the same reason those paths are refused after a hostname just as
they are on their own: `https://admin.example.com/api` is no more valid than
`/api`.

Everything else about `path` applies to the part after the hostname. The app
is still built for it: `https://admin.example.com` is built with
`REBASE_APP_BASE` set to `/`, `https://admin.example.com/cms` with `/cms`, and
a bundler that ignores it still gives you a blank page. `cms` is a path on the
app's hostname, inside that path part. The URL must be `https://` and carry a
hostname and a path and nothing else — no port, query or fragment. A bare
`admin.example.com` is refused, with the URL it should have been.

Under `rebase dev`, nothing is routed by hostname. It runs the app in
`frontend/` at the root of a localhost port, as it always has, and for an app
with a hostname its banner also prints the `https://` address it will have
once deployed.

`rebase start` is different, because it runs the built bundle through the same
runtime a deployment does — hostname routing included. An app with a hostname
answers only to requests whose `Host` is that hostname, so
`http://localhost:3001/` shows the app without one, and a bundle whose only app
names a hostname answers 404 there. To reach it locally, send the header
yourself:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

or point the hostname at `127.0.0.1` in `/etc/hosts` and open
`http://admin.example.com:3001/`. There is deliberately no query parameter or
header that overrides the routing: one that worked locally would also work
against a deployment, and choosing the app by anything but the real `Host` is
what the routing exists to prevent.

Self-hosted, the process makes the same choice from each request's `Host`
header. Pointing the hostname at the server and giving it a certificate are
yours to do, as they are for the project's main hostname, and a reverse proxy
in front has to pass the original `Host` through — Caddy does by default,
nginx needs `proxy_set_header Host $host;`. `X-Forwarded-Host` is not read,
because any client can send one.

### On Rebase Cloud

`rebase cloud deploy` registers the hostname on the project — what
`rebase cloud domains add` does — so there is no separate step to forget. What
happens next depends on DNS:

- **The records already exist.** The deploy verifies the hostname, and it is
  live when the deploy finishes.
- **They do not.** The deploy goes ahead, and prints the two records to create:
  a TXT record that proves the name is yours, and a CNAME that points it at the
  project (an A record, if the hostname is the domain's apex).

Once the records are published:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` prints the records again if you lose them. When
verification passes, the platform issues the HTTPS certificate for the
hostname; there is nothing to upload. Until then `admin` answers nowhere, since
the one hostname it answers on does not reach the project yet — the rest of
the project is live either way.

The console follows the app onto its hostname: the *Open CMS* link and the CMS
address on the project's overview are `https://admin.example.com/`, not the
project host.

A hostname that another project already holds fails the deploy before anything
rolls out, and so does one under the platform's own domain. Taking the app out
of `rebase.json` leaves the hostname registered on the project; remove it with
`rebase cloud domains remove admin.example.com`.

### A hostname belongs to an app, not to a route

A hostname is given to a whole app. It cannot point at a route inside one. When
the CMS is one route of a single SPA — `web` at `/` with `"cms": "/admin"` — it
lives at `/admin`, on every hostname the project answers on. Giving that app
`https://admin.example.com` would move the whole SPA there, with the CMS still
at `/admin` under it. To give the CMS a hostname of its own, make it an app of
its own, with its own build, as in the example above.

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

The contract endpoint needs the `schema:read` scope, which an admin holds. Collection definitions describe every table,
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

## Related

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — what `rebase build` produces and what boots it
- [Split Processes](/docs/deployment/split-processes/) — running one bundle as several processes
- [CLI Commands](/docs/cli/) — `rebase apps` and the rest
