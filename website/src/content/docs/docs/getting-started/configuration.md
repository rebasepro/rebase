---
title: Environment & Configuration
sidebar_label: Configuration
description: All environment variables and configuration options for Rebase projects.
---

## Environment Variables

All configuration is done via environment variables in your `.env` file at the project root.

> **Important**: Rebase validates environment variables with **Zod** at startup. If
> anything required is missing or malformed (a URL that is not a URL, a port that
> is not a number), the server refuses to boot and names the variable.
>
> Where the schema lives depends on how you run the backend. A project booted by
> the runtime — `rebase dev`, `rebase start`, the published image — uses the
> schema the runtime owns (`loadBootEnv` in `@rebasepro/server`), which is the
> union of every table below. A project that has run [`rebase eject`](/docs/cli)
> owns a `backend/src/env.ts` calling `loadEnv({ extend })`, and can add its own
> typed variables there.

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
| `PORT` | Port for the backend HTTP server. Read by `rebase start`; **`rebase dev` ignores it** and binds a port derived from the project path so several projects can run at once — use `rebase dev --port` to pin one. | `3001` |
| `LOG_LEVEL` | Logging verbosity: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Environment: `development`, `production`, or `test` | `development` |
| `CORS_ORIGINS` | Comma-separated list of allowed origins. **Required in production** if different from backend domain. In development it is *added to* localhost — see below. | — |
| `FRONTEND_URL` | URL of the frontend app. Used as an alternative to CORS_ORIGINS, in both environments. | — |
| `ADMIN_CONNECTION_STRING` | Admin-level database connection string (used for schema introspection and admin operations). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disable PostgreSQL role-switching in SQL Editor (useful for custom authentication where DB roles are not mapped). | `false` |

#### CORS in development

Development allows **localhost, plus whatever `CORS_ORIGINS` (or `FRONTEND_URL`)
names** — the same list production uses, with localhost added rather than
substituted. So the variable works the same way in both environments, and the
cases that need it in development are the ordinary ones:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

An origin that is neither localhost nor listed is refused, and the refusal is
logged **once per origin** with the exact line that would allow it. Refusing is
not caution for its own sake: the API sends credentials, so reflecting an
arbitrary `Origin` would let any site the developer happens to visit make
authenticated requests against the dev server with their session and read the
answers.

### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for JWT signing (required in production, auto-generated in development) | — |
| `JWT_PRIVATE_KEY` | PEM private key for signing access tokens asymmetrically (RS256), so anything holding the JWKS can verify a session without being able to mint one. Accepts a PEM with real newlines, a PEM with `\n` escapes, or base64 of the whole PEM. Without it tokens stay HS256. | — |
| `JWT_KEY_ID` | Names `JWT_PRIVATE_KEY` in the token header and in the JWKS. Change it whenever the key changes — rotation depends on old and new being distinguishable. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime. Sliding — every rotation re-ups it, so this governs how long a session survives **inactivity**. | `400d` |
| `ALLOW_REGISTRATION` | Allow new users to register (`true`/`false`). Outside production the **first** user can always register, whatever this says — an empty user table has to admit somebody, and that somebody becomes the admin. In production (`NODE_ENV=production`) that window is closed: an empty table refuses the bootstrap registration with `SETUP_REQUIRED`, a first account created through open registration is an ordinary account, and the admin is named with `REBASE_ADMIN_EMAIL` below or assigned with the service key. The scaffold's `.env.example` sets it to `true`; the framework default is off. | `false` |
| `DISABLE_SELF_REGISTRATION` | Kill switch. Closes the first-user bootstrap window that `ALLOW_REGISTRATION=false` deliberately leaves open outside production, so registration is shut even against an empty database. Pair it with `REBASE_ADMIN_EMAIL` below, or the deployment has no way to produce its first signed-in caller. Every shipped deployment artifact sets it. | — |
| `REBASE_ADMIN_EMAIL` | Email of the first admin account, created at boot **while the user table is still empty** and never afterwards. This is how a production deployment gets its admin: the operator names the first account instead of racing the internet for it. Boot warns when the table is empty in production and this is unset. | — |
| `REBASE_ADMIN_PASSWORD` | Password for that account. At least 12 characters, or it is refused and the account is not created. Change it after the first sign-in. | — |
| `ALLOW_ANONYMOUS` | Enable anonymous sign-in (`POST /api/auth/anonymous`). Opt-in, and deliberately not gated by `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Require authentication for the data API. Set `false` for a fully public read surface — RLS still applies. | `true` |
| `AUTH_DEFAULT_ROLE` | Role assigned to a newly registered user when none is given. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Mount `POST /api/auth/find-user`, which resolves an email to a minimal public profile (`uid`, `displayName`, `photoURL`) for invite-by-email flows. Authenticated callers only, and it never returns the email, roles or metadata of the user it found. Off by default: it is an enumeration surface. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` on the refresh cookie: `Strict`, `Lax` or `None`. `None` requires HTTPS and is only for a genuinely cross-site frontend. | `Lax` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (backend validation) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | — |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth client ID | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth client secret | — |
| `REBASE_SERVICE_KEY` | Static admin API key. Bypasses normal JWT auth for server-to-server calls when passed as `Authorization: Bearer <key>`. (Auto-generated in development). | — |
| `REBASE_RATE_LIMIT_STORE` | Where auth rate-limit counters live: `memory` (per-process) or `sql` (shared across replicas). A process cannot see its own replica count, so a deployment with peers has to say so — three replicas on the default enforce three times the limit. Any other value **refuses to boot** rather than falling back, `postgres` included. | `memory` |
| `AUTH_MAGIC_LINK` | Mount the passwordless sign-in-link flow. Needs an email service configured, or the link has nowhere to go. | `false` |
| `AUTH_EMAIL_OTP` | Mount passwordless sign-in with a six-digit code sent by email. Same email requirement as above. | `false` |
| `CAPTCHA_PROVIDER` | Turn on captcha verification on the auth routes: `turnstile` or `hcaptcha`. Unset means no captcha. | — |
| `CAPTCHA_SECRET` | The provider's secret, used server-side to verify the token the browser sends. Required once `CAPTCHA_PROVIDER` is set. | — |
| `CAPTCHA_ROUTES` | Comma-separated auth routes to protect (for example `register,login`). Unset protects the provider's default set. | — |

### Storage

:::caution[Storage has no row-level security, so it needs an access model]
Collections are protected by Postgres RLS. Object storage has no equivalent —
keys share one flat namespace — so with a bucket configured and no access model
the server **refuses to boot in production**. Satisfy it with exactly one of:
a `storageAuthorize` hook exported from `config/index.ts` (what the scaffold
ships), `STORAGE_PUBLIC_READ`, or `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

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
| `GCS_BUCKET` | GCS bucket name (when `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | GCP project. Usually inferred from the credentials. | — |
| `GCS_KEY_FILENAME` | Path to a service-account key file. Omit on GCP, where Workload Identity supplies credentials. | — |
| `STORAGE_PUBLIC_READ` | Serve every object to anyone, no token. Only for a bucket that genuinely is a public CDN. One of the three ways to satisfy the boot guard below. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Let any signed-in caller read, write, list and delete every object. Named `INSECURE` in the config object for a reason: it is only defensible in a single-tenant app where every account is trusted with every file. | `false` |
| `STORAGE_RENDITION_CACHE` | Cache generated image renditions (resizes, format conversions) instead of producing them per request. | `false` |

### Email (Optional)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP server port |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | Sender address for system emails |
| `SMTP_NAME` | Display name on the sender address |
| `APP_NAME` | Product name used in email subjects and bodies (default: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo shown atop the default email templates. Absolute `http(s)` PNG or JPG — clients strip SVG and block `data:` URIs. Unset, an app still named `Rebase` gets the Rebase mark and a renamed one gets none |

### Database connection pool

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_POOL_MAX` | Maximum pooled connections | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milliseconds an idle connection is kept | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milliseconds to wait for a connection | `10000` |
| `DATABASE_DIRECT_URL` | Direct (non-pooled) connection. [Realtime](/docs/backend/realtime) needs one: `LISTEN`/`NOTIFY` does not survive a transaction pooler such as PgBouncer, and without it change notifications are disabled with a warning rather than silently lost. | — |
| `DATABASE_READ_URL` | Read replica. Reads go there when it is set and differs from `DATABASE_URL`; if the connection fails, everything falls back to the primary with a warning. | — |

### Runtime behaviour

Read by the runtime — `rebase dev`, `rebase start` and the published server
image. A project that has ejected owns these decisions in its own code instead.

| Variable | Description | Default |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Run the row-level-security audit at boot and mount its endpoint, which reports tables that are served without policies. | — |
| `REBASE_BASE_PATH` | Base path for every API route. The client must be told the same thing — see [Changing `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve the bundle's static/admin assets from this process. Turn it off when a CDN sits in front. | `true` |
| `REBASE_HISTORY` | Record [entity change history](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | gzip/brotli responses. | `true` |
| `REBASE_MAX_BODY_SIZE` | Maximum request body, **in bytes** (`10485760`, not `10MB` — a value that is not a number refuses to boot rather than silently removing the limit). | — |
| `REBASE_ENABLE_SWAGGER` | The OpenAPI surface. Tri-state: unset means on in development, off in production; `false` turns both off anywhere. Note that `true` in production serves the **spec** at `/api/docs` but not the Swagger **UI** at `/api/swagger` — the UI is gated on `NODE_ENV` separately. | — |
| `REBASE_METRICS` | Expose Prometheus metrics at `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token guarding `/metrics`. Unset leaves the endpoint open to anything that can reach the port — fine on a private network, not on a public one, and the boot logs say so. | — |
| `REBASE_MIGRATE_ON_BOOT` | What the runtime may do to the schema at boot. `ensure` (the default, everywhere — production included) runs the **additive** pass: create missing tables, columns and enum types, never drop or rewrite one. `none` touches nothing. The published image accepts only those two and **refuses to boot on `push`**. In a [split deployment](/docs/deployment/split-processes) exactly one process may provision, so every other role must set `none` or refuse to boot. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse to boot when the database was last provisioned from a different set of collections than this process was built from. Unset (or anything other than `true`/`1`) warns instead. | warn |
| `REALTIME_CDC` | Database-level change capture: `auto` (enable where the connection supports it, silently fall back otherwise), `trigger` (force it, warn if impossible), `wal` (degrades to `trigger` today), `off`. See [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Cross-instance transport for broadcast channels and presence: `memory` or `postgres`. Ignored when `realtime.bus` was given a constructed transport. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permit `localhost`/loopback values under `NODE_ENV=production`. Off, so a production boot fails loudly rather than connecting to a database that is not there. | `false` |

:::note[Boot provisioning is additive, and is not a migration tool]
The boot pass runs unattended with nobody reading a diff, so it will never drop
a column, narrow a type or rewrite a table. That is also why the image refuses
`REBASE_MIGRATE_ON_BOOT=push`: a full push computes a diff and will happily
`DROP COLUMN`, and a container restart must never be able to destroy a
production column as a side effect of rescheduling.

Destructive or reshaping changes stay where they can be reviewed: `rebase db
generate` + `rebase db migrate`, or `rebase db push` from a checkout or CI,
which dry-runs the change, refuses destructive ones without confirmation, and
can take a backup first.
:::

### Split deployments

One image and one bundle can be booted several times over, each serving a
different part of the project. `REBASE_ROLE`, `REBASE_CRON_SCHEDULER`,
`REBASE_JOB_WORKERS`, `REBASE_FUNCTIONS_ONLY`, `REBASE_FUNCTIONS_EXCLUDE` and
`REBASE_FUNCTIONS_UPSTREAM` are documented in full on
**[Split Processes](/docs/deployment/split-processes)**.

### Backups

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron expression for scheduled backups. Unset means scheduled backups are off. | — |
| `BACKUP_DESTINATION` | Local path, or an `s3://bucket/prefix` / `gs://bucket/prefix` URL. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Delete backups older than N days. Unset or `0` keeps everything. | — |
| `BACKUP_KEEP_MINIMUM` | Always retain at least N of the most recent backups, whatever retention says. | — |
| `PG_DUMP_PATH` | Override the `pg_dump` binary — it must match the server's major version. | — |
| `PG_RESTORE_PATH` | Override the `pg_restore` binary. | — |

Backups contain secrets and PII. Use a private destination with
encryption-at-rest.

## Secrets in development

`JWT_SECRET` and `REBASE_SERVICE_KEY` are required in production and generated
for you outside it, so you can start without setting anything up.

Those generated values are cached in `.rebase-dev-secrets.json`, beside
`.rebase-dev-port` and `.rebase-dev-url` and gitignored with them. Before, they
were regenerated on every boot — so restarting the dev server logged you out of
your own app and invalidated any API key you had just created.

- Set either variable explicitly and yours is used; nothing is cached or read.
- Point the cache somewhere else with `REBASE_DEV_SECRETS_FILE`.
- Delete the file to roll both secrets. The next boot writes a fresh one.
- If the file cannot be written — a read-only container, say — the server starts
  anyway with an ephemeral secret, exactly as it used to.

Nothing is cached in production, or under a test runner. In production a boot
that had to generate either secret still fails, naming the variable, and that is
unchanged:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

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

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

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
