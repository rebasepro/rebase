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

> **`sslmode=no-verify` is a node-postgres spelling, not a libpq one.**
>
> Rebase and the Node driver accept it — encrypt, but do not check the
> certificate. `psql`, `pg_dump`, `pg_restore` and Atlas do not, and they do not
> degrade: they refuse to start with `invalid sslmode value: "no-verify"`.
>
> Rebase's own commands (`rebase db push`, `rebase db backup`, `rebase db
> restore`) rewrite it to the equivalent `sslmode=require` before shelling out,
> so they work with the URL as configured. Reaching for `psql` by hand does not
> — swap in `sslmode=require` there, which encrypts without verifying in exactly
> the same way.

### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL for the client SDK. **Set this in development only** — see below. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID. Enables "Sign in with Google". | — |


> **Leave `VITE_API_URL` unset in production builds.**
>
> In development the frontend and backend are separate origins, so the dev
> server injects this. In production the Rebase backend serves the SPA, so the
> API is the page's own origin and the client resolves it that way on its own.
>
> Baking an absolute URL into a production bundle works right up until a second
> hostname points at the same app: a custom domain then loads the page from
> `example.com` and calls the API on `example.rebase.website`, which is
> cross-origin, so every request fails preflight. Allowing the origin in CORS
> does **not** fix it either — the refresh cookie is `SameSite=Lax` and is not
> sent cross-site, so you would clear the console errors and still have broken
> auth. Unset, every domain pointing at the app works with no CORS
> configuration at all.

### Backend

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port for the backend HTTP server | `3001` |
| `LOG_LEVEL` | Logging verbosity: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Environment: `development`, `production`, or `test` | `development` |
| `CORS_ORIGINS` | Comma-separated list of allowed origins. **Required in production** if different from backend domain. | — |
| `FRONTEND_URL` | URL of the frontend app. Used as an alternative to CORS_ORIGINS. | — |
| `ADMIN_CONNECTION_STRING` | Admin-level database connection string (used for schema introspection and admin operations). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disable PostgreSQL role-switching in SQL Editor (useful for custom authentication where DB roles are not mapped). | `false` |

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
| `STORAGE_TYPE` | Storage backend: `local`, `s3` or `gcs`. In production `local` disables storage unless `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Base path for local storage | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Allow local storage in production — only with a durable volume mounted at `STORAGE_PATH` | `false` |
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
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
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

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
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

### Changing `basePath`

`basePath` moves every API route, so the client has to be told the same thing —
otherwise it keeps asking for `/api/...` and gets a 404 for everything:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

The admin panel picks this up from the client it is given; nothing else needs
configuring. If you build a request URL by hand, join it from the client rather
than writing `/api` yourself:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Troubleshooting

### SQL Editor Permission Denied (`permission denied for table <name>`)

* **Symptoms:** Custom queries executed in the Rebase Studio SQL Editor fail with `cause: error: permission denied for table <name>`, even though the spreadsheet CMS view loads data successfully.
* **Cause:** By default, Rebase attempts to execute SQL Editor queries by temporarily switching database roles to match the active user's application role (e.g., `SET LOCAL ROLE "admin"`). If you are using custom authentication where roles exist only in database tables rather than actual PostgreSQL roles, the role switch fails or database privileges are missing. The CMS spreadsheet view executes under the default connection owner user and bypasses this.
* **Solution:** Add `DISABLE_DB_ROLE_SWITCHING=true` to your backend `.env` configuration. This forces Rebase to run SQL Editor queries using the connection owner's privileges (typically a superuser/owner).

### SQL Editor Schema Fetch Failed (`Cross-database execution requires adminConnectionString`)

* **Symptoms:** Studio fails to load the schema tree, or SQL Editor throws `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause:** Rebase requires administrative privileges to query database system catalogs and run administrative commands. If `adminConnectionString` is not provided to the bootstrapper, or `getAdmin()` is overridden to return `undefined`, these operations fail.
* **Solution:** Ensure `adminConnectionString` is configured during backend bootstrapper initialization:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Next Steps

- **[Deployment](/docs/getting-started/deployment)** — Production deployment guide
- **[Backend Overview](/docs/backend)** — Full backend configuration reference
