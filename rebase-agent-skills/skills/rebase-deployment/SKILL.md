---
name: rebase-deployment
description: Guide for deploying Rebase applications. Use this skill when the user needs to deploy to Rebase Cloud, set up Docker, configure Firebase Hosting, or self-host Rebase.
---

# Rebase Deployment

Rebase supports multiple deployment strategies — from fully managed Rebase Cloud to self-hosted Docker deployments.

## Deployment Options

| Option | Best For | Complexity |
|--------|----------|------------|
| **Rebase Cloud** | Fastest setup, managed infrastructure | ⭐ Easy |
| **Docker** | Full control, self-hosted | ⭐⭐ Medium |
| **Firebase Hosting** | Static frontend + Cloud Functions backend | ⭐⭐ Medium |
| **Custom** | Any Node.js hosting (Railway, Render, Fly.io, etc.) | ⭐⭐⭐ Advanced |

## Rebase Cloud

The simplest deployment path. Sign up at [app.rebase.pro](https://app.rebase.pro).

```bash
# 1. Authenticate
rebase login

# 2. Initialize (if new project)
rebase init

# 3. Deploy
rebase deploy

# Deploy to dev environment
rebase deploy --env dev
```

## Docker (Self-Hosted)

Rebase is designed to be Docker-ready:

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY . .

RUN npm install -g pnpm
RUN pnpm install
RUN pnpm run build

# Generate schema and run migrations
RUN pnpm run generate:schema
CMD ["pnpm", "run", "start"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  rebase:
    build: .
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/rebase
      - JWT_SECRET=your-secret-key-must-be-at-least-32-characters-long
      - NODE_ENV=production
      - CORS_ORIGINS=https://your-frontend-url.com
    depends_on:
      - db

  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=rebase
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

## Firebase Hosting (Frontend)

Deploy the Studio frontend to Firebase Hosting:

```bash
# Build the frontend
cd frontend
pnpm run build

# Deploy to Firebase
npx firebase-tools@latest deploy --only hosting
```

## Production SPA Serving

In production, the backend can serve the frontend SPA directly using `serveSPA()`:

```typescript
import { serveSPA } from "@rebasepro/server-core";

if (isProduction) {
    serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
}
```

This eliminates the need for a separate web server or CDN for the frontend in single-instance deployments.

## ⛔ Agent Deployment Rules

**Agents should NEVER deploy or run deployment commands unless explicitly asked by the user in the current conversation.** This includes:
- `rebase deploy` (any variant)
- `firebase deploy` (any variant)
- `gcloud functions deploy`
- `gcloud run deploy`
- `terraform apply` (any variant that deploys resources)
- Any command targeting staging or production environments

**What agents CAN do:**
- Edit source code
- Run builds (`pnpm run build`)
- Run tests (`pnpm test`)
- Run local dev server (`pnpm dev`)
- Check logs (read-only)
- Run deployment commands *only* if the user explicitly asks you to deploy in the current conversation. Otherwise, provide the exact commands for the user to run.

## Environment Variables

All environment variables are validated at startup via a Zod schema. Required variables will cause the server to fail immediately if missing.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ Yes (≥32 chars) | — | JWT signing secret |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3001` | Server port |
| `CORS_ORIGINS` | ⚠ Prod required | — | Comma-separated allowed origins |
| `FRONTEND_URL` | ⚠ Prod required | — | Frontend URL (CORS fallback) |
| `STORAGE_TYPE` | No | `local` | `local` or `s3` |
| `STORAGE_PATH` | No | `./uploads` | Local file storage directory |
| `S3_BUCKET` | If S3 | — | S3 bucket name |
| `S3_REGION` | No | `auto` | S3 region |
| `S3_ACCESS_KEY_ID` | If S3 | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | If S3 | — | S3 secret key |
| `S3_ENDPOINT` | No | — | Custom S3 endpoint (MinIO, R2) |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `ALLOW_REGISTRATION` | No | `true` | Enable new user registration |
| `REBASE_SERVICE_KEY` | No | — | Service-to-service auth key |

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
