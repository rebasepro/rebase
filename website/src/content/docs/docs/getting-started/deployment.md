---
title: Deployment
sidebar_label: Deployment
description: Deploy your Rebase project to production using Docker, cloud platforms, or manual setups.
---

## What a Deployment Serves

A Rebase project deploys as **one server at one URL** (on Rebase Cloud: `https://<project>.rebase.website`). That server handles:

- **`/api/*`** — the data API, authentication, realtime, and storage
- **everything else** — your built `frontend/` as a static SPA

There is no separate admin URL: the admin panel is part of your frontend, so where it appears depends on what your frontend is.

| Project type | Root URL shows | Admin panel is at |
|--------------|----------------|-------------------|
| Default scaffold (`rebase init`) | The admin panel | `/` — the frontend **is** the admin |
| Custom product frontend | Your app | Wherever you mount it, commonly `/admin` — see [Changing the Base URL](#changing-the-base-url) |
| Backend-only project | Nothing (API only) | Not deployed |

:::note[First visit]
A fresh **production** deployment does not offer a bootstrap screen, and its first registration is an ordinary account. Name the administrator before the first boot instead — see [Your first admin](#your-first-admin).
:::

## Docker Compose (Recommended)

The generated project already includes a working `docker-compose.yml` — **that
file is the one to use for a scaffolded project**, as-is rather than
hand-written or copied from elsewhere. `rebase init` filled in its secrets, its
first admin account and its pinned runtime version, and it is booted by the
framework's own acceptance gate on every push. It runs **two** containers,
Postgres and the published Rebase runtime with your built bundle mounted into
it. There is no application image to build.

[Self-Hosting](/docs/deployment/self-hosting) covers the same deployment without
a scaffold behind it, using
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
from the Rebase repository — and the two things this file deliberately leaves
out: a connection pooler, and running functions and the job worker as their own
processes.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

`rebase build` first, always: the `api` service mounts `./dist-bundle`, and
without it the container starts against an empty directory.

The shape of the generated file:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase_app -d rebase"]

  api:
    # The published runtime. Upgrading Rebase is a tag change, not a rebuild.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS in .env}
      # This service runs in production, where the first account to register is
      # not promoted to admin. So the admin is named instead.
      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set REBASE_ADMIN_EMAIL in .env}
      REBASE_ADMIN_PASSWORD: ${REBASE_ADMIN_PASSWORD:?set REBASE_ADMIN_PASSWORD in .env}
      DISABLE_SELF_REGISTRATION: ${DISABLE_SELF_REGISTRATION:-true}
    volumes:
      # Your built project, from `rebase build`.
      - ./dist-bundle:/bundle

volumes:
  postgres_data:
```

`rebase init` writes all of these into `.env` for you, including a generated
admin password. Each is declared with `${VAR:?…}`, so a missing one stops the
stack with a message naming it rather than starting something half-configured —
and Compose interpolates the whole file before selecting services, so a missing
one stops `docker compose up -d db` too.

Change the admin email to yours, sign in, and change the password. See [Your
first admin](#your-first-admin).

### The schema

The runtime creates missing tables at boot, **including your collections'** —
`REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole
schema and applies row-level security with it. A first `docker compose up`
against an empty database comes up serving your collections.

What boot never does is change something that already exists: it does not alter
a column type, drop anything, or edit an existing enum's labels, because a
container restart must not reshape a schema as a side effect of a deploy. Those
go through the CLI, from a checkout or a CI job pointed at the production
database:

```bash
pnpm run db:push
```

Run it for junction-table RLS on many-to-many relations, and for any change that
is not purely additive — a renamed column, a narrowed type, a removed field.

For a **versioned, team workflow**, commit migration files with
`pnpm run db:generate` and run `pnpm run db:migrate` as a release step instead.
Either way it runs from a project checkout, not inside the running container —
the runtime image ships without the CLI.

## Your first admin

**Set `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` before the first boot.**
Every platform guide on this site points here, because this is the one step that
has no recovery from the outside.

A fresh database has no users, and outside production the registration policy
admits the first sign-up and promotes it to admin. It has to: bootstrapping an
admin needs a caller who is already signed in, so an empty database with no such
rule is a dead end. On a laptop the person at the keyboard is the operator and
that is exactly right.

It is exactly wrong on a host with a public name. The shipped artifacts bring
DNS and TLS up before the operator has typed anything, so the window is open to
the internet from the first second — and whoever reaches the sign-up form first
owns the deployment.

So under `NODE_ENV=production` that window is closed. An empty user table
refuses the bootstrap registration with `SETUP_REQUIRED`, an account created
through open registration is an ordinary account, `GET /api/auth/config` never
advertises `needsSetup`, and `POST /api/admin/bootstrap` refuses. In 0.17.3 and
earlier the window was open in production too, so upgrade before you expose a
fresh deployment.

That leaves two ways in, neither of which is a race:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

The runtime creates that account once, while the user table is empty, and does
nothing on every boot after that. Or assign the role to an existing user with
the service key, if you provision accounts out of band.

Two rules the runtime enforces at boot, both of which produce an account nobody
can use if you get them wrong:

- The password must be **at least 12 characters**, or it is refused and no
  account is created.
- The address must be one `POST /api/auth/login` accepts — it parses its body
  with `z.string().email()`, so a domain with no dot (`admin@localhost`) seeds
  fine and then answers 400 on every sign-in. Boot refuses that address too.

Set both or neither: half a credential is a typo, and the deployment it produces
— self-registration off, no admin — needs a `psql` prompt to recover. Boot warns
when the table is empty in production and no admin is named.

Sign in and change the password. It is sitting in plain text wherever you put
your environment.

## Production Checklist

Before deploying to production, ensure:

| Item | Details |
|------|---------|
| **First admin** | Set `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` **before the first boot**, and `DISABLE_SELF_REGISTRATION=true`. In production the first account to register is not promoted — see [Your first admin](#your-first-admin). |
| **NODE_ENV** | `NODE_ENV=production`. It is what closes the bootstrap window, refuses local file storage, requires `CORS_ORIGINS`, and turns the OpenAPI docs off. A deployment left at the default is running in development mode. |
| **Database schema** | Boot creates your collection tables additively. Run `pnpm run db:push` (or `pnpm run db:migrate`) for junction-table RLS and for anything not purely additive. |
| **JWT_SECRET** | Use a cryptographically strong random string (≥ 32 chars). Never reuse across environments. |
| **DATABASE_URL** | Use a managed Postgres instance (Neon, Supabase, RDS) with TLS enabled |
| **CORS_ORIGINS** | Always, not only when the frontend is on another domain. The runtime refuses to start in production with neither `CORS_ORIGINS` nor `FRONTEND_URL`, because an API that guesses its allowed origins eventually allows the wrong one. |
| **Storage volumes** | Mount persistent volumes for file uploads. Or switch to S3 for production. |
| **HTTPS** | Terminate TLS at your reverse proxy (nginx, Cloudflare, load balancer) |
| **Public reads still need a caller** | `access: "public"` widens which *rows* a caller sees, not who may call: an anonymous request to `/api/data/*` answers 401 while `AUTH_REQUIRE` is on. Set `AUTH_REQUIRE=false` for a public site that reads its own backend, and let RLS alone decide. It is an environment variable, so a local `.env` that sets it does **not** travel with your deploy. |

## Native Modules on the Managed Runtime

Rebase Cloud's managed runtime runs your bundle inside a shared image. It has no
compiler and no way to load a **native module** — anything shipping a prebuilt
`.node` binary. The most common one by far is `sharp`, which is also the obvious
dependency for anything serving images.

`rebase cloud deploy` refuses this before the upload rather than after:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Three ways through, in the order they are usually right:

1. **Move the work to build time.** Resize and re-encode images in your build
   step and deploy the results. Nothing native runs in the request path.
2. **Use a service.** An image CDN or a transform API does the same work behind
   a URL.
3. **Run your own container.** A self-hosted deployment (Docker, Kubernetes, any
   of the [platform guides](/docs/deployment/self-hosting)) is your image, so it
   can carry whatever it likes.

Functions that merely need Node rather than a native binary are fine — the
deploy reports those separately (`1 of 3 function(s) depend on Node`) and runs
them.

## Serving the Frontend

In production, the backend can serve the frontend as a static SPA:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Build the frontend first:

```bash
cd frontend && pnpm build
```

This way you only need to deploy one server that handles both SPA and API.

## Platform Deployment Guides

Detailed step-by-step guides for each platform:

| Platform | Type | Guide |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Deploy on AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Deploy on GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Deploy on Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Deploy on Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Deploy on Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-detect Dockerfile) | [Deploy on Railway →](/docs/deployment/railway) |
| **Fly.io** | Container runtime | [Deploy on Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run and other serverless platforms are stateless. Use **S3 storage** instead of local filesystem for file uploads, and set `--min-instances 1` if you use Rebase realtime features (WebSocket connections are terminated when instances scale down).
:::


## Changing the Base URL

If you want Rebase to run at a sub-path (e.g., `/admin`):

**Frontend** — Update the `BrowserRouter` basename:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Update the base path:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Mounting without a router `basename`]
The `basename` approach above is the recommended one — react-router strips the
prefix from the location, so the admin works unchanged. If instead you embed the
admin inside a **path-prefixed route** of a larger app (e.g. `<Route path="/admin/*">`)
with no `basename`, the current path keeps its `/admin` prefix. Tell the CMS about
it so URL⇄collection resolution accounts for the prefix — otherwise views hang on a
spinner with no data fetch:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Set **either** the router `basename` **or** `RebaseCMS basePath` — not both, or the
prefix is applied twice.
:::

### Product App + Admin in One Deployment

The common reason to move the admin to `/admin` is shipping your **own product app**
at the root of the same deployment. A single Vite entry can serve both, split by URL,
so each app is lazy-loaded and product visitors never download the admin bundle:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseCMS basePath="/admin" />

if (isAdmin) {
    // The admin uses useBlocker → needs a data router
    const router = createBrowserRouter([{ path: "/admin/*", element: <AdminApp /> }]);
    root.render(<RouterProvider router={router} />);
} else {
    root.render(<BrowserRouter><ProductApp /></BrowserRouter>);
}
```

The backend needs no changes for this pattern — the API stays at `/api` and the SPA
catch-all serves `index.html` for both `/` and `/admin/*`.

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration
- **[Storage Configuration](/docs/backend/storage)** — S3 setup for production
