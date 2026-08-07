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

The generated project already includes a working `docker-compose.yml` (Postgres + backend + frontend) and the `backend/`/`frontend/` Dockerfiles — that generated file is the source of truth; use it as-is rather than hand-writing one. The shape is:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    ports:
      - "5432:5432"

  backend:
    build:
      # Context is the PROJECT ROOT so the image can copy
      # pnpm-workspace.yaml, backend/, and config/. A `./backend`
      # context would fail — the Dockerfile lives at backend/Dockerfile.
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      - db

volumes:
  postgres_data:
  uploads:
```

```bash
docker compose up -d
```

### Create the database schema

Bringing the stack up is **not enough on its own.** The backend boots and
auto-creates the **auth** tables, but it does **not** create the tables for
your own collections — you run that once, explicitly, against the production
database. From a checkout of your project (with dependencies installed), set
`DATABASE_URL` to your production database and push the schema:

```bash
pnpm run db:push
```

:::caution[Required — or every collection returns errors]
Skip this step and the app still starts and you can log in, but each of your
collections is empty and its API calls fail with a "missing table" error until
the schema exists. On startup the server logs a boxed warning naming exactly
which tables are missing and the command to run.
:::

`db:push` is the fast option — it applies the schema directly, with no
migration files. For a **versioned, team workflow**, commit migration files
with `pnpm run db:generate` and run `pnpm run db:migrate` as a release step
instead. Whichever you choose, it runs against the production `DATABASE_URL`
from a project checkout (or your CI job), not inside the running container —
the production image ships without the CLI.

## Production Checklist

Before deploying to production, ensure:

| Item | Details |
|------|---------|
| **Database schema** | Run `pnpm run db:push` (or `pnpm run db:migrate` for versioned migrations) against the production database once. The app boots without your collection tables, but every collection errors until they exist. |
| **JWT_SECRET** | Use a cryptographically strong random string (≥ 32 chars). Never reuse across environments. |
| **DATABASE_URL** | Use a managed Postgres instance (Neon, Supabase, RDS) with TLS enabled |
| **CORS** | Configure allowed origins on your backend if frontend and backend are on different domains |
| **Storage volumes** | Mount persistent volumes for file uploads. Or switch to S3 for production. |
| **HTTPS** | Terminate TLS at your reverse proxy (nginx, Cloudflare, load balancer) |
| **Registration** | Set `ALLOW_REGISTRATION=false` after creating your admin account |

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
<RebaseAdmin collections={collections} basePath="/admin" />
```

Set **either** the router `basename` **or** `RebaseAdmin basePath` — not both, or the
prefix is applied twice.
:::

### Product App + Admin in One Deployment

The common reason to move the admin to `/admin` is shipping your **own product app**
at the root of the same deployment. A single Vite entry can serve both, split by URL,
so each app is lazy-loaded and product visitors never download the admin bundle:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseAdmin basePath="/admin" />

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
