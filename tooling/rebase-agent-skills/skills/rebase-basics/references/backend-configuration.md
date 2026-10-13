# Backend configuration

## Two calls, one set of options

A backend you wire yourself comes from one of two calls in `@rebasepro/server`.
They take the same options; what differs is who mounts and starts it.

- **`initializeRebaseBackend(config)`** — the one-call boot. It builds the
  backend, mounts every route group on your Hono `app` under `basePath`,
  attaches the realtime socket to your `server`, starts the timers (cron, job
  workers, sweeps), and returns the backend. This is what an ejected project's
  entry point calls.
- **`createRebaseBackend(options)`** (new in 0.25) — builds the same backend and
  mounts, starts and listens to **nothing**, and writes no process global.
  `initializeRebaseBackend` is exactly `installUnhandledRejectionHandler()`,
  `createRebaseBackend(…)`, `setDefaultBackend(backend)`,
  `backend.mount(app, { basePath })`, `await backend.attachRealtime(server)` and
  `backend.start()`. Drop to it when the shortcut stops fitting: only some route
  groups, another path, timers in another process, two backends in one process,
  or no server at all.

A scaffolded project builds neither: `rebase dev` and the published runtime boot
from the bundle, reading collections and hooks from `config/` and everything else
from environment variables. Pass these options directly only when you own the
server process (an ejected project, or Rebase embedded in your own server).

### Options — `RebaseBackendOptions` / `RebaseBackendConfig`

```typescript
import {
    createRebaseBackend,
    initializeRebaseBackend,
    type RebaseBackendConfig,
    type RebaseBackendOptions
} from "@rebasepro/server";
```

The options are `RebaseBackendOptions` (`packages/server/src/backend/options.ts`),
what `createRebaseBackend` takes. `RebaseBackendConfig`, what
`initializeRebaseBackend` takes, is the same options without `provision`, plus
`app`, `server` and `basePath`. Where the runtime fills an option from the
environment, the row says so.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `server` | `Server` (Node `http.Server`) | — | **Required by `initializeRebaseBackend`.** The HTTP server — the realtime socket attaches to it, and its `shutdown()` closes it. With `createRebaseBackend` you pass it to `attachRealtime(server)` and `shutdown(t, { server })` instead |
| `app` | `Hono<HonoEnv>` | — | **Required by `initializeRebaseBackend`**, which mounts onto it. With `createRebaseBackend`: `backend.mount(app)`, or `app.route(path, backend.routes.data())` per group |
| `provision` | `boolean \| { collections?: boolean; realtime?: boolean }` | — | **Required by `createRebaseBackend`** (new in 0.25); `initializeRebaseBackend` passes `true`. What building the backend may change in the database. `true`: the collection tables and their RLS policies, change capture for realtime, the role requests run as, and the framework's own tables (API keys, cron runs, jobs, metrics). `false`: nothing — the schema must already be there (a migration, or another process built with `true`), and a missing table fails on use, not at boot; what a script, a test or a second process wants. `{ collections: false, realtime: false }`: the framework's tables and the role only — a process that is not the schema's owner. `REBASE_MIGRATE_ON_BOOT=none` still turns the collection schema off |
| `collections` | `AnyCollectionConfig[]` | `[]` | Inline collection definitions. Declaring **none** (and no `collectionsDir`) is what makes the server derive them from the live database instead, so every RLS-protected table is served with nothing to define. There is no `mode` flag — it was removed, because it could only ever agree with this or contradict it |
| `collectionsDir` | `string` | — | Directory to auto-discover collection files (used if `collections` is empty). Also what the schema editor rewrites, so passing it beside `collections` is not ambiguous: the values are served, the directory is edited |
| `basePath` | `string` | `"/api"` | `initializeRebaseBackend` only: base path for all API routes. With `createRebaseBackend`: `backend.mount(app, { basePath })` |
| `database` | `DatabaseAdapter` | — | Database adapter (takes precedence over `bootstrappers`) |
| `bootstrappers` | `BackendBootstrapper[]` | — | Internal: the runtime builds these from the `database()` declarations in `config/resources.ts`, one per data source, and `collection.dataSource` routes by their `id`. Pass `database` instead |
| ~~`dataSources`~~ | — | — | **Removed.** Declare each one with `database("<key>")` in `config/resources.ts`. The backend reads the declarations; passing this key is refused at boot, by name, with the replacement in the message. Collections on a `direct`/`custom` transport are still client-only — the backend skips data routes for them |
| `auth` | `RebaseAuthConfig \| AuthAdapter` | — | Authentication config or pluggable adapter. **`requireAuth`, `jwtSecret`, `serviceKey`, `allowRegistration`, OAuth providers and `email` all live inside this object**, not at the top level |
| `storage` | `BackendStorageConfig \| StorageController \| Record<string, ...>` | — | File storage configuration. Supports `"local"`, `"s3"`, and `"gcs"` (GCS/Firebase Storage) backends. Use `Record<string, StorageController>` for multi-backend setups with named sources, and include a `"(default)"` key — none is promoted. The runtime builds it from the `bucket()` declarations |
| `history` | `HistoryConfig` (`boolean \| { retention?: number }`) | off | Entity history / audit log. `retention` is in days. Omitted here means off; the runtime passes `REBASE_HISTORY`, which defaults to `true` |
| `enableSwagger` | `boolean` | `true` | `true` serves the OpenAPI spec at `/api/docs` publicly; `false` serves it to admins only. Swagger UI at `/api/swagger` is mounted outside production either way. The runtime passes `REBASE_ENABLE_SWAGGER`, and `false` in production when that is unset |
| `functions` | `Record<string, FunctionApp>` | — | New in 0.25. Custom functions as values: the key is the URL segment, the value a Hono app (`defineFunction(...)`) — `{ "send-invoice": sendInvoice }` serves `/api/functions/send-invoice`. `await loadFunctions(dir)` reads a directory into exactly this shape. Give this or `functionsDir`, not both: the boot refuses the pair |
| `functionsDir` | `string` | — | Directory for auto-discovered custom function handlers, one file per URL segment. The same as `functions: await loadFunctions(dir)`, plus the directory's skipped files reported on `GET /api/functions`. The runtime discovers `backend/functions` |
| `crons` | `Record<string, CronJobDefinition>` | — | New in 0.25. Cron jobs as values: the key is the job id, the value a `defineCron(...)` definition. `await loadCrons(dir)` reads a directory into this shape. Scheduled by `start()`. Give this or `cronsDir`, not both: the boot refuses the pair |
| `cronsDir` | `string` | — | Directory for auto-discovered cron job handlers, the filename the job id. The same as `crons: await loadCrons(dir)`. The runtime discovers `backend/crons` |
| `cronPersistence` | `boolean` | `true` | Persist cron job execution logs to the database |
| `maxBodySize` | `number` | `10485760` (10 MB) | Max request body size in bytes. Set `0` to disable. Storage uploads use the storage config's `maxFileSize` instead |
| `csrf` | `{ origin: string \| string[] \| ((origin: string) => boolean) }` | — | CSRF protection (opt-in, disabled by default: mobile apps, cross-origin SPAs and CLIs consume the same API) |
| `callbacks` | `CollectionCallbacks` | — | Global lifecycle callbacks applied to every collection. Same type as per-collection `callbacks`, and fires on **every** data path (REST, realtime/WebSocket, server-side `rebase.dataAsAdmin`). Order: global → collection → property |
| `baas` | `BaasOptions` | — | `baas` mode only: `{ unprotectedTables?: "exclude" \| "serve" }`. Default `"exclude"` — a table with RLS disabled carries no authorization model, and every authenticated request runs as `rebase_user`, so serving one hands every row to every logged-in user. Excluded tables are logged with the SQL to protect them. `"serve"` serves them anyway; only sensible when every caller is already trusted |
| `schemaEditor` | `boolean` | — | Force the schema-editor routes on or off. Defaults to enabled when `collectionsDir` is set, outside production, in `cms` mode. `false` on a built bundle |
| `liveSchema` | `LiveSchemaConfig` | — | Live schema editing (changing the database and committing the change). Mounts whenever there is a `collectionsDir`; this configures *who* may act |
| ~~`storageSources`~~ | — | — | **Removed.** Declare each one with `bucket("<key>")` in `config/resources.ts`. Collection properties still point at it by key via `StorageConfig.storageSource`. (The `<Rebase storageSources>` *prop* is unrelated and still exists — pass `declaredStorageSources()`) |
| `logging` | `{ level?: "error" \| "warn" \| "info" \| "debug" }` | `LOG_LEVEL`, else `"info"` | Log level configuration. Outranks `LOG_LEVEL` when set |
| `storageAuthorize` | `StorageAuthorize` | — | **Per-object access control**, the storage analogue of RLS. Without one, any authenticated user can read, overwrite, delete or list any key they can name — and `GET /storage/list?prefix=` means they need not guess. See the boot guard below |
| `storagePolicies` | `StoragePolicy[]` | — | Path-pattern access rules (`{ path: "users/:uid/**", allow: … }`). A key no policy matches is refused; `storageAuthorize` still runs when none matched. Satisfies the boot guard on its own |
| `storagePublicRead` | `boolean` | `false` | Serve stored objects to unauthenticated readers |
| `storageInsecureAllowAnyAuthenticated` | `boolean` | `false` | Opt out of the storage boot guard. Named to be read twice |
| `storageTriggers` | `StorageTrigger[]` | — | Run a handler when an object lands (`"finalize"`) or goes (`"delete"`), matched by path pattern. A throwing handler is logged, never fails the upload |
| `storageRenditionCache` | `RenditionCacheConfig` | off | Cache image transforms back into the bucket |
| `jobs` | `JobQueueOptions` | off | The durable job queue: `{ enabled, tasks, concurrency, pollIntervalMs, visibilityTimeoutMs, maxAttempts, backoff }`. Needs `enabled: true` and a driver that can run SQL |
| `rateLimit` | `DataRateLimitConfig` | on, loose | Data-API rate limiting per caller: an API key by id, a user by uid, anyone else by IP. Counts are in-process unless you pass a `store`; `{ enabled: false }` when the edge already does this |
| `compression` | `boolean` | `true` | gzip/deflate responses. Set `false` when a proxy already compresses |
| `functionsTimeoutMs` | `number` | `30000` | Per-request ceiling for `/api/functions/*` (or `REBASE_FUNCTIONS_TIMEOUT_MS`). `0` disables it; a timeout answers 504 |
| `functionsSelection` | `FunctionSelection` | — | Internal: which functions this process serves, from `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE`. An unknown name fails the boot |
| `functionsUpstream` | `string` | — | Internal: forward `/api/functions/*` to another process (`REBASE_FUNCTIONS_UPSTREAM`). Only consulted when the `functions` surface is off |
| `surfaces` | `RuntimeSurfaceOptions` | all but `mcp` | Which HTTP surfaces this process mounts, as `{ auth, data, storage, admin, functions, cron, meta, realtime, mcp }` booleans; name only what differs. Every surface is on unless named, except `mcp`, which is off unless named. The runtime derives it from `REBASE_ROLE` |
| `ownership` | `RuntimeOwnershipOptions` | all | Which background singletons this process runs: `{ cronScheduler, jobWorkers, rlsAudit }`. Separate from `surfaces` — serving the cron admin routes and firing the jobs are different questions |
| `provisionSchema` | `boolean` | `true` | Internal, `initializeRebaseBackend` only: whether **this process** runs the collection DDL. Exactly one process in a split deployment may; derived from `REBASE_ROLE`. `false` becomes `provision: { collections: false, realtime: false }` |
| `rlsAudit` | `RlsAuditConfig` | off | Periodic RLS audit served at `GET /api/admin/rls-audit`: `{ enabled, intervalMs, runOnBoot, schemas }`. Needs the optional peer `@rebasepro/rls-check` |
| `corsHandled` | `boolean` | `false` | Internal: declares that the app installs its own CORS middleware, suppressing the "no CORS configuration detected" warning |
| `schemaVersion` / `runtimeVersion` | `string` | — | Stamps carried from the bundle manifest |

**CORS itself is not a config key.** The runtime sets it from the `CORS_ORIGINS` and `FRONTEND_URL` environment variables, and a production boot fails if neither is set.

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
| `refreshExpiresIn` | `string` | `"30d"` | Refresh token TTL. Sliding — each rotation re-ups it. The **runtime** passes `JWT_REFRESH_EXPIRES_IN`, which also defaults to `"30d"` |
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

### `RebaseBackend` — Return Value

Both calls return a `RebaseBackend`. `RebaseBackendInstance`, the name
`initializeRebaseBackend`'s return type has always had, is the same type — in
0.24 and earlier it had every member below except those marked new in 0.25.

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `rebase` | `RebaseServerClient` | New in 0.25. The in-process client — what `import { rebase } from "@rebasepro/server"` answers inside the requests, cron runs and jobs this backend serves. `dataAsAdmin`, `sql`, `storage`, `bucket`, `email` call the drivers directly; `auth`, `admin`, `functions`, `cron` reach this backend's own routes in-process, mounted or not |
| `routes` | `RebaseRoutes` | New in 0.25. `auth()`, `data()`, `storage()`, `functions()`, `admin()`, `cron()`, `meta()` — each a self-contained Hono sub-app (auth context, rate limits, scope guards, admin gate) to mount at any path: `app.route("/v2/data", backend.routes.data())`. A group whose surface is off throws |
| `mount(app, { basePath })` | `void` | New in 0.25. Every group under `basePath` (default `/api`), with the process-wide middleware in front — the exact layout `initializeRebaseBackend` produces |
| `attachRealtime(server, { path })` | `Promise<void>` | New in 0.25. Attach the realtime socket. It answers upgrades on `path` only — by default the `mount()` base path minus `/api` (`/api` → `/`, where the SDK dials) — and leaves other upgrades to the server's other listeners. Once only |
| `start()` | `void` | New in 0.25. Start the timers: cron scheduler, job workers, expired-token and history-retention sweeps, metrics sampler, RLS audit — each where `ownership` gives it to this process. Idempotent |
| `fetch(request)` | `Promise<Response>` | New in 0.25. The whole backend as one fetch handler, laid out at `/api` — for tests and scripts, no server or port: `backend.fetch(new Request("http://local/api/data/posts"))` |
| `services` | `BackendServices` | New in 0.25. The backend's own state: `jwt` (a `JwtService`: sign/verify sessions, JWKS, download tokens), `access` (access model + key-owner resolver), `apiKeyStore`, `rateLimitStore`, `authLimiters`, `collections()`, `topics`, `queues` |
| `verifyCredential(token)` | `Promise<VerifiedCredential \| null>` | New in 0.25. Check a session token or an `rk_` API key against this backend's keys, store and access model: `{ uid, roles, scopes, kind }` |
| `driver` | `DataDriver` | The default data driver |
| `driverRegistry` | `DriverRegistry` | Registry of all initialized drivers |
| `realtimeService` | `RealtimeProvider` | Default realtime provider |
| `realtimeServices` | `Record<string, RealtimeProvider>` | All realtime providers |
| `auth` | `BootstrappedAuth \| undefined` | Bootstrapped auth result |
| `storageRegistry` | `StorageRegistry \| undefined` | All storage backends |
| `storageController` | `StorageController \| undefined` | Default storage controller |
| `collectionRegistry` | `BackendCollectionRegistry` | Registry of all active collections |
| `cronScheduler` | `CronScheduler \| undefined` | The cron job scheduler (if configured). Its jobs are registered at build; `start()` starts its timers |
| `jobQueue` | `JobQueue \| undefined` | The durable job queue, when `jobs.enabled`. Enqueueing works at once; `start()` starts the workers |
| `setCollectionCallbacks(slug, callbacks)` | `void` | Attach callbacks after the backend is built. It **replaces** the callbacks the collection declared — attach `composeCallbacks(declared, mine)` to keep them |
| `healthCheck()` | `() => Promise<HealthCheckResult>` | Deep health check (verifies DB connectivity, returns latency) |
| `shutdown(timeoutMs?, { server })` | `Promise<void>` | Graceful shutdown, default 15s budget. Closes the HTTP server only when it has one: the backend `initializeRebaseBackend` returns closes the `server` it was given; one from `createRebaseBackend` closes the server you pass as `{ server }` |

### Shutdown Behavior

When `shutdown()` is called, it performs these steps in order:

1. **Stops the timers** — the cron scheduler, the job workers, the sweeps, the metrics sampler — and waits for a cron run, a job or a `waitUntil()` task in flight, within part of the budget
2. **Destroys realtime services** (LISTEN clients, debounce timers, subscriptions) — this happens **before** pool close to prevent timer callbacks firing against a closed pool
3. **Closes the HTTP server** (stops accepting, drains in-flight requests) — when there is one to close (see the `shutdown` row above)
4. **Force-resolves** after `timeoutMs` (default 15000ms). Pass `0` to disable the force timer (useful in tests)

### Minimal Backend Example

```typescript
import { Hono } from "hono";
import type { BackendStorageConfig, HonoEnv } from "@rebasepro/server";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import { initializeRebaseBackend, loadEnv } from "@rebasepro/server";
import { createPostgresAdapter, createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { defaultUsersCollection } from "@rebasepro/common";
import { collections } from "../../config/collections";
import dotenv from "dotenv";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();

// The adapter queries through `connection`; a `connectionString` alone opens no pool.
const { db, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);

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
    database: createPostgresAdapter({ connection: db, connectionString }),
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

### The same backend, one step down (0.25+)

`createRebaseBackend`, then the public steps `initializeRebaseBackend` takes
after it. Each line is yours to change: mount only some groups, put them under
another path, attach no socket, or leave `start()` to another process.

```typescript
import { createServer } from "node:http";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import {
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    loadEnv,
    loadFunctions,
    logger,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import { createPostgresAdapter, createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import dotenv from "dotenv";
import { collections } from "../../config/collections";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();                       // validates, and generates JWT_SECRET in development
installUnhandledRejectionHandler();          // log a stray rejection instead of exiting (process-wide)

const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);
const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

// Builds everything; mounts, starts and listens to nothing.
const backend = await createRebaseBackend({
    database: createPostgresAdapter({ connection: db, connectionString }),
    collections,
    auth: { jwtSecret: env.JWT_SECRET },
    functions: await loadFunctions("./src/functions"),   // { name: app }
    provision: true                                     // required: may it run DDL?
});

setDefaultBackend(backend);                 // `import { rebase }` and the module-level helpers answer for it
backend.mount(app, { basePath: "/api" });   // or: app.route("/v2/data", backend.routes.data())
await backend.attachRealtime(server);        // the socket answers on "/" for an API at /api
backend.start();                             // crons, job workers, sweeps

installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
// PORT is the one `rebase dev` picked, and it waits for this line.
server.listen(env.PORT, () => logger.info(`Server running at http://localhost:${env.PORT}`));
```

This is the shape, not a whole scaffold server: the file that serves exactly
what the runtime serves under `rebase dev` (users collection, functions, crons,
buckets, CORS for the admin panel, health routes) is in the docs, at
https://rebase.pro/docs/backend/custom-server/.

A group mounted on its own (`app.route(path, backend.routes.functions())`)
carries its own auth context, rate limits and admin gate, so `getUser(c)` and
`getDriver(c)` work inside it. What only `mount()` adds is the process-wide HTTP
hygiene in front of every group: request ids, the global body limit,
compression, CSRF, the request log and the JSON error envelope. Mounting groups
one by one, add your own (`hono/body-limit`, `app.onError(errorHandler)`).

### Each backend owns its state; the module-level API answers for the default (0.25+)

`createRebaseBackend` writes no process global. A backend keeps its JWT keys,
access model, API-key store, rate limiters, collections and topic/queue runtimes
in `backend.services` (`jwt`, `access`, `apiKeyStore`, `rateLimitStore`,
`authLimiters`, `collections()`, `topics`, `queues`), so two backends in one
process each sign, verify, judge scopes and count limits for themselves.
A backend given no `auth.jwtSecret` (an `AuthAdapter`) follows the process
default's JWT config.

- `rebase` (imported, or `ctx.rebase`), topic `publish` and queue `enqueue`
  resolve to the backend **serving** the current request, cron run or job.
  Anywhere else they answer for the **process default**.
- The process default is set by `setDefaultBackend(backend)`;
  `initializeRebaseBackend` and the bundle boot set it to their backend.
  `configureJwt` / `configureAccess` still set its JWT config / access model
  directly. The module-level helpers (`verifyAccessToken`, `getAccessModel`,
  `verifyCredential`, `extractUserFromToken`, …) answer for the default.
- `backend.verifyCredential(token)` checks a session token or an `rk_` key
  against that backend: `{ uid, roles, scopes, kind }` or `null`.
- `backend.services.jwt.generateAccessToken(uid, roles)` mints a session for that
  backend (tests, a custom login). `createJwtService({ secret })` builds a
  JWT service on its own.
- A route of your own outside the groups is judged by a backend once
  `c.set("services", backend.services)` runs before its guards (`requireAuth`,
  `requireScope` from `@rebasepro/server`); unset, they use the default.

With `provision: false` and no server, the same call is how a test or a script
gets a whole backend: `backend.rebase.dataAsAdmin`, or `backend.fetch(request)`
against its routes, then `await backend.shutdown()`. For data alone,
`openRebase` from `@rebasepro/server-postgres` is lighter — see *Exploring
data from a script* in this skill's `SKILL.md`.

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
