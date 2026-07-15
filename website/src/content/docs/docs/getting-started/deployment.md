---
title: Deployment
sidebar_label: Deployment
description: Deploy your Rebase project to production using Docker, cloud platforms, or manual setups.
---

## Docker Compose (Recommended)

The generated project includes a `Dockerfile` and `docker-compose.yml`. This is the simplest way to deploy:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase:rebase@postgres:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    volumes:
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

```bash
docker compose up -d
```

## Production Checklist

Before deploying to production, ensure:

| Item | Details |
|------|---------|
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

```typescript
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

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration
- **[Storage Configuration](/docs/storage)** — S3 setup for production
