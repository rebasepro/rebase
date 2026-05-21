---
title: Environment & Configuration
sidebar_label: Configuration
description: All environment variables and configuration options for Rebase projects.
---

## Environment Variables

All configuration is done via environment variables in your `.env` file at the project root.

> **Important**: Rebase uses **Zod** to validate environment variables at startup in `src/env.ts`. If any required variables are missing or incorrectly formatted (like URLs or ports), the server will fail to start and provide a clear error message.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Secret key for signing JWT tokens. Use a strong random string (min 32 chars). **Required in production** (auto-generated in development). | `a1b2c3d4e5...` |

### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL. Used by the client SDK. | `http://localhost:3001` |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID. Enables "Sign in with Google". | — |

### Backend

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port for the backend HTTP server | `3001` |
| `LOG_LEVEL` | Logging verbosity: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Environment: `development`, `production`, or `test` | `development` |
| `CORS_ORIGINS` | Comma-separated list of allowed origins. **Required in production** if different from backend domain. | — |
| `FRONTEND_URL` | URL of the frontend app. Used as an alternative to CORS_ORIGINS. | — |

### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for JWT signing (required in production, auto-generated in development) | — |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `30d` |
| `ALLOW_REGISTRATION` | Allow new users to register (`true`/`false`). First user can always register. | `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (backend validation) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `REBASE_SERVICE_KEY` | Static admin API key. Bypasses normal JWT auth for server-to-server calls when passed as `Authorization: Bearer <key>`. (Auto-generated in development). | — |

### Storage

| Variable | Description | Default |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage backend: `local` or `s3` | `local` |
| `STORAGE_PATH` | Base path for local storage | `./uploads` |
| `S3_BUCKET` | S3 bucket name (when `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS region | — |
| `S3_ACCESS_KEY_ID` | AWS access key | — |
| `S3_SECRET_ACCESS_KEY` | AWS secret key | — |
| `S3_ENDPOINT` | Custom S3 endpoint (for MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force path-style URLs for S3 bucket (`true`/`false`) | `false` |

### Email (Optional)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP server port |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | Sender address for system emails |

## Backend Config Object

The `RebaseBackendConfig` passed to `initializeRebaseBackend()` provides programmatic control:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server-core";
import { createPostgresAdapter } from "@rebasepro/server-postgresql";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : {
            type: "local",
            basePath: env.STORAGE_PATH || "./uploads"
        },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/data/docs

    logging: {
        level: "info"
    }
});
```

## Next Steps

- **[Deployment](/docs/getting-started/deployment)** — Production deployment guide
- **[Backend Overview](/docs/backend)** — Full backend configuration reference
