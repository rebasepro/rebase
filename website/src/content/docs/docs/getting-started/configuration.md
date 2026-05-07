---
title: Environment & Configuration
sidebar_label: Configuration
slug: docs/getting-started/configuration
description: All environment variables and configuration options for Rebase projects.
---

## Environment Variables

All configuration is done via environment variables in your `.env` file at the project root.

> **Important**: Rebase uses **Zod** to validate environment variables at startup in `src/env.ts`. If any required variables are missing or incorrectly formatted (like URLs or ports), the server will fail to start and provide a clear error message.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Database connection string (PostgreSQL or MongoDB) | `postgresql://user:pass@localhost:5432/mydb` or `mongodb://localhost:27017/mydb` |
| `JWT_SECRET` | Secret key for signing JWT tokens. Use a strong random string (min 32 chars). | `a1b2c3d4e5...` |

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
| `NODE_ENV` | Environment: `development` or `production` | `development` |

### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for JWT signing (required if auth is enabled) | — |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `30d` |
| `ALLOW_REGISTRATION` | Allow new users to register (`true`/`false`). First user can always register. | `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (backend validation) | — |

### Storage

| Variable | Description | Default |
|----------|-------------|---------|
| `STORAGE_TYPE` | Storage backend: `local` or `s3` | `local` |
| `STORAGE_BASE_PATH` | Base path for local storage | `./uploads` |
| `S3_BUCKET` | S3 bucket name (when `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS region | — |
| `S3_ACCESS_KEY_ID` | AWS access key | — |
| `S3_SECRET_ACCESS_KEY` | AWS secret key | — |
| `S3_ENDPOINT` | Custom S3 endpoint (for MinIO, Cloudflare R2, etc.) | — |

### Email (Optional)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP server port |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `EMAIL_FROM` | Sender address for system emails |

## Backend Config Object

The `RebaseBackendConfig` passed to `initializeRebaseBackend()` provides programmatic control:

```typescript
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collections,
    basePath: "/api",        // Base path for all API routes (default: "/api")

    bootstrappers: [         // Database and service bootstrappers
        isMongo
            ? createMongoBootstrapper({ ... })
            : createPostgresBootstrapper({ ... })
    ],

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: {
            clientId: env.GOOGLE_CLIENT_ID
        }
    },

    storage: {               // File storage config
        type: "local",
        basePath: "./uploads"
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
