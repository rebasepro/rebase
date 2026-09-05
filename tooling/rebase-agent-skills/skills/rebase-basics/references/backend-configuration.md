# Backend configuration

## `initializeRebaseBackend()`

The main entry point for initializing a Rebase backend server. Returns a `RebaseBackendInstance` with access to drivers, auth, storage, and lifecycle methods.

### `RebaseBackendConfig` — Full Interface

```typescript
import { initializeRebaseBackend, RebaseBackendConfig } from "@rebasepro/server";
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `server` | `Server` (Node `http.Server`) | — | **Required.** The HTTP server instance |
| `app` | `Hono<HonoEnv>` | — | **Required.** The Hono application instance |
| `collections` | `CollectionConfig[]` | `[]` | Inline collection definitions. Declaring **none** (and no `collectionsDir`) is what makes the server derive them from the live database instead, so every RLS-protected table is served with nothing to define. There is no `mode` flag — it was removed, because it could only ever agree with this or contradict it |
| `collectionsDir` | `string` | — | Directory to auto-discover collection files (used if `collections` is empty) |
| `basePath` | `string` | `"/api"` | Base path for all API routes |
| `database` | `DatabaseAdapter` | — | Database adapter (takes precedence over `bootstrappers`) |
| `bootstrappers` | `BackendBootstrapper[]` | `[]` | Database bootstrappers. Use one per engine for multiple engines in a single instance (e.g. Postgres + MongoDB); mark one `isDefault` |
| ~~`dataSources`~~ | — | — | **Removed.** Declare each one with `database("<key>")` in `config/resources.ts`. The backend reads the declarations; passing this key is refused at boot, by name, with the replacement in the message. Collections on a `direct`/`custom` transport are still client-only — the backend skips data routes for them |
| `auth` | `RebaseAuthConfig \| AuthAdapter` | — | Authentication config or pluggable adapter |
| `storage` | `BackendStorageConfig \| StorageController \| Record<string, ...>` | — | File storage configuration. Supports `"local"`, `"s3"`, and `"gcs"` (GCS/Firebase Storage) backends. Use `Record<string, StorageController>` for multi-backend setups with named sources |
| `history` | `HistoryConfig` (`boolean \| { retention?: number }`) | `true` | Entity history / audit log. `retention` is in days |
| `enableSwagger` | `boolean` | `true` | Enable OpenAPI spec at `/api/docs` and Swagger UI at `/api/swagger` (dev only) |
| `functionsDir` | `string` | — | Directory for auto-discovered custom function handlers |
| `cronsDir` | `string` | — | Directory for auto-discovered cron job handlers |
| `cronPersistence` | `boolean` | `true` | Persist cron job execution logs to the database |
| `maxBodySize` | `number` | `10485760` (10 MB) | Max request body size in bytes. Set `0` to disable |
| `csrf` | `{ origin: string \| string[] \| ((origin: string) => boolean) }` | — | CSRF protection (opt-in, disabled by default) |
| `callbacks` | `CollectionCallbacks` | — | Global lifecycle callbacks applied to every collection. Same type as per-collection `callbacks`, and fires on **every** data path (REST, realtime/WebSocket, server-side `rebase.dataAsAdmin`). Order: global → collection → property |
| `baas` | `BaasOptions` | — | `baas` mode only: `{ unprotectedTables?: "exclude" \| "serve" }`. Default `"exclude"` — a table with RLS disabled carries no authorization model, and every authenticated request runs as `rebase_user`, so serving one hands every row to every logged-in user. Excluded tables are logged with the SQL to protect them. `"serve"` serves them anyway; only sensible when every caller is already trusted |
| `schemaEditor` | `boolean` | — | Force the schema-editor routes on or off. Defaults to enabled when `collectionsDir` is set, outside production, in `cms` mode |
| ~~`storageSources`~~ | — | — | **Removed.** Declare each one with `bucket("<key>")` in `config/resources.ts`. Collection properties still point at it by key via `StorageConfig.storageSource`. (The `<Rebase storageSources>` *prop* is unrelated and still exists — pass `declaredStorageSources()`) |
| `logging` | `{ level?: "error" \| "warn" \| "info" \| "debug" }` | `"info"` | Log level configuration |
| `storageAuthorize` | `StorageAuthorize` | — | **Per-object access control**, the storage analogue of RLS. Without one, any authenticated user can read, overwrite, delete or list any key they can name — and `GET /storage/list?prefix=` means they need not guess. See the boot guard below |
| `storagePublicRead` | `boolean` | `false` | Serve stored objects to unauthenticated readers |
| `storageInsecureAllowAnyAuthenticated` | `boolean` | `false` | Opt out of the storage boot guard. Named to be read twice |
| `jobs` | `JobQueueOptions` | — | The durable job queue: `{ enabled, tasks, concurrency, pollIntervalMs, visibilityTimeoutMs, maxAttempts, backoff }`. Off unless asked for |
| `rateLimit` | `DataRateLimitConfig` | — | Rate limiting for the data API |
| `compression` | `boolean` | `true` | gzip/brotli responses |
| `functionsTimeoutMs` | `number` | — | Per-invocation timeout for custom functions |
| `functionsSelection` | `FunctionSelection` | — | Which functions this process serves (split deployments) |
| `functionsUpstream` | `string` | — | Forward `/api/functions/*` to another process instead of mounting them |
| `surfaces` | `RuntimeSurfaceOptions` | — | Which route groups this process mounts (`api`/`functions`/`worker` roles) |
| `ownership` | `RuntimeOwnershipOptions` | — | Which background responsibilities this process owns (cron timers, job workers) |
| `provisionSchema` | `boolean` | `true` | Whether **this process** runs the boot DDL. Exactly one process in a split deployment may |
| `schemaVersion` / `runtimeVersion` | `string` | — | Stamps carried from the bundle manifest |

> **IMPORTANT FOR AGENTS: storage refuses to boot in production without an access
> model.** When storage is configured and `NODE_ENV=production`,
> `initializeRebaseBackend` **throws at startup** unless one of `storageAuthorize`,
> `storagePublicRead: true`, or `storageInsecureAllowAnyAuthenticated: true` is
> set. In development it logs a warning instead — so a project can be wrong about
> this and work fine locally right up until it is deployed. A scaffolded project
> ships a hook in `config/storage.ts`; read it before replacing it.

> **IMPORTANT FOR AGENTS:** `maxBodySize` applies to all API routes under `basePath`. Storage upload routes have their **own** limit derived from the storage config's `maxFileSize` property (default: 50 MB), which overrides the global limit.

### `RebaseAuthConfig` — Authentication Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `collection` | `CollectionConfig` | `defaultUsersCollection` | The collection used for auth users |
| `jwtSecret` | `string` | — | JWT signing secret (≥32 chars) |
| `accessExpiresIn` | `string` | `"1h"` | Access token TTL |
| `refreshExpiresIn` | `string` | `"30d"` | Refresh token TTL. The **runtime** passes `JWT_REFRESH_EXPIRES_IN` instead, whose own default is `"400d"`, so this `"30d"` is only what a hand-written `initializeRebaseBackend` call falls back to |
| `requireAuth` | `boolean` | `true` | Require authentication for data routes |
| `allowRegistration` | `boolean` | `false` | Allow public user registration |
| `serviceKey` | `string` | — | Static secret for server-to-server auth (≥32 chars) |
| `defaultRole` | `string` | — | Role assigned to new users on registration |
| `email` | `EmailConfig` | — | SMTP email configuration |
| `hooks` | `AuthHooks` | — | Override auth behavior (password hashing, validation, etc.) |
| `providers` | `OAuthProvider[]` | `[]` | The canonical OAuth array. The named provider fields below resolve into it at startup; the two forms merge |
| `allowedRedirectUris` | `string[]` | — | Narrow which redirect URIs the OAuth routes accept. Unset, the only check is the provider's own registered-URI match — which authorises every URI on that OAuth client, `localhost` included |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch. Also closes the first-user bootstrap window `allowRegistration: false` leaves open |
| `allowAnonymous` | `boolean` | `false` | Enable `POST /api/auth/anonymous`. Deliberately not gated by `allowRegistration` |
| `allowUserLookup` | `boolean` | `false` | Mount `POST /api/auth/find-user` (minimal public profile, authenticated callers only) |
| `magicLink` | `boolean` | `false` | Passwordless email sign-in. Needs `email`; without it the routes answer `503 EMAIL_NOT_CONFIGURED` |
| `cookieAuth` | `CookieAuthConfig` | — | Deliver the refresh token as an `httpOnly` `Secure` `SameSite` cookie instead of in the JSON body. Requires `credentials: "include"` on the client and an explicit CORS origin list |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetric signing keys, so a verifier holding the JWKS cannot mint tokens |
| `activeKid` | `string` | first key | Which of `signingKeys` mints new tokens |

#### Built-in OAuth Providers

| Property | Required Fields | Description |
|----------|----------------|-------------|
| `google` | `clientId`, `clientSecret?` | Google OAuth (supports ID token without secret) |
| `github` | `clientId`, `clientSecret` | GitHub OAuth |
| `linkedin` | `clientId`, `clientSecret` | LinkedIn OAuth |
| `microsoft` | `clientId`, `clientSecret`, `tenantId?` | Microsoft/Azure AD OAuth |
| `apple` | `clientId`, `teamId`, `keyId`, `privateKey` | Apple Sign In |
| `facebook` | `clientId`, `clientSecret` | Facebook OAuth |
| `twitter` | `clientId`, `clientSecret` | Twitter/X OAuth |
| `discord` | `clientId`, `clientSecret` | Discord OAuth |
| `gitlab` | `clientId`, `clientSecret`, `baseUrl?` | GitLab OAuth (supports self-hosted) |
| `bitbucket` | `clientId`, `clientSecret` | Bitbucket OAuth |
| `slack` | `clientId`, `clientSecret` | Slack OAuth |
| `spotify` | `clientId`, `clientSecret` | Spotify OAuth |

### `RebaseBackendInstance` — Return Value

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `driver` | `DataDriver` | The default data driver |
| `driverRegistry` | `DriverRegistry` | Registry of all initialized drivers |
| `realtimeService` | `RealtimeProvider` | Default realtime provider |
| `realtimeServices` | `Record<string, RealtimeProvider>` | All realtime providers |
| `auth` | `BootstrappedAuth \| undefined` | Bootstrapped auth result |
| `storageRegistry` | `StorageRegistry \| undefined` | All storage backends |
| `storageController` | `StorageController \| undefined` | Default storage controller |
| `collectionRegistry` | `BackendCollectionRegistry` | Registry of all active collections |
| `cronScheduler` | `CronScheduler \| undefined` | The cron job scheduler (if configured) |
| `healthCheck()` | `() => Promise<HealthCheckResult>` | Deep health check (verifies DB connectivity, returns latency) |
| `shutdown(timeoutMs?)` | `(timeoutMs?: number) => Promise<void>` | Graceful shutdown (stops cron, destroys realtime, drains HTTP, default 15s timeout) |

### Shutdown Behavior

When `shutdown()` is called, it performs these steps in order:

1. **Stops the cron scheduler** (if configured)
2. **Destroys realtime services** (LISTEN clients, debounce timers, subscriptions) — this happens **before** pool close to prevent timer callbacks firing against a closed pool
3. **Closes the HTTP server** (stops accepting, drains in-flight requests)
4. **Force-resolves** after `timeoutMs` (default 15000ms). Pass `0` to disable the force timer (useful in tests)

### Minimal Backend Example

```typescript
import { Hono } from "hono";
import type { BackendStorageConfig, HonoEnv } from "@rebasepro/server";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import { initializeRebaseBackend, loadEnv } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { defaultUsersCollection } from "@rebasepro/common";
import collections from "../config/collections";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });
const env = loadEnv();

const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

// Each `type` carries its own required fields — `local` needs `basePath`,
// `s3`/`gcs` need `bucket` and credentials — so branch on the env var rather
// than spreading it into one object literal. Annotate the const: inline, the
// ternary is checked against `BackendStorageConfig | StorageController |
// Record<string, …>` all at once and TypeScript cannot distribute over it.
const storage: BackendStorageConfig = env.STORAGE_TYPE === "s3"
    ? {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || ""
    }
    : { type: "local", basePath: "./uploads" };

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connectionString: env.DATABASE_URL,
    }),
    collections: [...collections, defaultUsersCollection],
    collectionsDir: "../config/collections",
    functionsDir: "./src/functions",
    cronsDir: "./src/crons",
    auth: {
        collection: defaultUsersCollection,
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,
    },
    // Multi-backend: Record<string, StorageController> with named sources.
    storage,
});

console.log(`Server running at http://localhost:${env.PORT}`);
```

## Default security rules live with the collections, not here

`defaultSecurityRules` is **not** a `RebaseBackendConfig` option. Declare it in
`config/collections/index.ts`, beside the collections it applies to:

```typescript
// config/collections/index.ts
import type { SecurityRule } from "@rebasepro/types";

export const defaultSecurityRules: SecurityRule[] = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
```

Any collection in that directory that declares no `securityRules` inherits these;
one that declares its own keeps them; one with neither is **locked by default**
(admin-only).

It belongs there because `db push` generates the Postgres policies — the only
thing that actually enforces access — from the collection *files*, and never sees
the running server. A default on the backend config could never reach the
database while reading exactly like an authorization setting. In `baas` mode there
are no collection files and no `db push`, so the database's own RLS is the whole
model and there is nothing to default.
