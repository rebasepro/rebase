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
On the first visit to a fresh deployment's admin, Rebase shows a bootstrap screen to **create your admin account**. The first registered account receives admin privileges — claim it right after deploying.
:::

## Docker Compose (Recommended)

The generated project already includes a working `docker-compose.yml` — that
file is the source of truth; use it as-is rather than hand-writing one. It runs
**two** containers, Postgres and the published Rebase runtime with your built
bundle mounted into it. There is no application image to build.

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
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
    volumes:
      # Your built project, from `rebase build`.
      - ./dist-bundle:/bundle

volumes:
  postgres_data:
```

`rebase init` generates `JWT_SECRET` and `REBASE_SERVICE_KEY` into `.env` for
you. Both are declared with `${VAR:?…}`, so a missing one stops the stack with a
message naming it rather than starting something half-configured.

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

## Production Checklist

Before deploying to production, ensure:

| Item | Details |
|------|---------|
| **Database schema** | Boot creates your collection tables additively. Run `pnpm run db:push` (or `pnpm run db:migrate`) for junction-table RLS and for anything not purely additive. |
| **JWT_SECRET** | Use a cryptographically strong random string (≥ 32 chars). Never reuse across environments. |
| **DATABASE_URL** | Use a managed Postgres instance (Neon, Supabase, RDS) with TLS enabled |
| **CORS** | Configure allowed origins on your backend if frontend and backend are on different domains |
| **Storage volumes** | Mount persistent volumes for file uploads. Or switch to S3 for production. |
| **HTTPS** | Terminate TLS at your reverse proxy (nginx, Cloudflare, load balancer) |
| **Registration** | Set `ALLOW_REGISTRATION=false` after creating your admin account |
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

If you want the admin to run at a sub-path (e.g. `/admin`), change one line —
the app's `path` in `rebase.json`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` passes that to Vite as `base` (via `REBASE_APP_BASE`), Vite gives
it back as `import.meta.env.BASE_URL`, and the scaffold's `main.tsx` already
feeds it to the router — so the assets, the routes and the server all agree
without the prefix being written down three times:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

The admin needs a **data router** — `createBrowserRouter`, not the plain
`BrowserRouter` — because unsaved-changes blocking uses `useBlocker`, which only
the data router provides.

**Backend** — if you move the API too, update its base path:

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
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

One router for both halves, because the admin needs the data router anyway and
there is no reason for the product app to be on a different one.

The backend needs no changes for this pattern — the API stays at `/api` and the SPA
catch-all serves `index.html` for both `/` and `/admin/*`.

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration
- **[Storage Configuration](/docs/backend/storage)** — S3 setup for production
