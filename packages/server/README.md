# @rebasepro/server

Database-agnostic backend core for Rebase.

## Installation

```bash
pnpm add @rebasepro/server
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## What This Package Does

This is the central orchestrator for any Rebase backend. It provides the framework-level plumbing — HTTP routing (Hono), authentication middleware, storage, email, cron jobs, custom functions, and the REST API generator — without being coupled to any specific database. Database implementations are plugged in via driver packages like `@rebasepro/server-postgres` or `@rebasepro/server-mongo`.

## Key Exports

| Export | Description |
|--------|-------------|
| `initializeRebaseBackend(config)` | The one-call boot: `createRebaseBackend`, then `mount`, `attachRealtime` and `start`. Returns the backend, already serving. |
| `createRebaseBackend(options)` | Builds the backend (drivers, auth, storage, route groups, the in-process client) and mounts, starts and listens to nothing. `provision` (`true`, `false` or `{ collections, realtime }`) decides what it may change in the database. New in 0.25. |
| `RebaseBackend` | What both return: `routes.auth/data/storage/functions/admin/cron/meta()` (each a mountable Hono sub-app), `mount(app, { basePath })`, `attachRealtime(server, { path })`, `start()`, `shutdown()`, `fetch(request)`, `rebase`, and the services (`driver`, `cronScheduler`, `jobQueue`, …). |
| `rebase` | Server-side singleton — a `RebaseServerClient` (from `@rebasepro/types`): the client without `data`, plus `dataAsAdmin`. Available after init. Admin-scoped access to data (RLS is evaluated as the service identity, not skipped), auth, email, and storage. |
| `loadEnv()` | Validates `process.env` against the Rebase env schema (Zod). Auto-generates dev secrets. Supports `extend` for custom vars. |
| `serveSPA(app, config)` | Mounts SPA static-file serving + index.html fallback on a Hono app. |
| `RebaseBackendConfig` | Config type for `initializeRebaseBackend`. |
| `RebaseAuthConfig` | Auth config type (JWT, OAuth providers, hooks, service key). |
| `RebaseBackendInstance` | `initializeRebaseBackend`'s return type, the same as `RebaseBackend`. |
| `loadFunctions(dir)` / `loadCrons(dir)` | Read a directory of function or cron files into the `functions` / `crons` option values (`{ [name]: app }`, `{ [id]: definition }`). `declareCrons(crons)` records crons in the resource graph. New in 0.25; `loadFunctionsFromDirectory`, `loadFunctionsWithDiagnostics`, `loadCronJobsFromDirectory` and `loadCronJobsWithDiagnostics` are deprecated. |
| `composeCallbacks(...sets)` / `createCallContext(partial)` | Combine sets of collection callbacks the way the backend's tiers combine; build the `context` a callback receives, to call one from a test. New in 0.25. |
| `RebaseEnv` | Zod-inferred type of validated environment variables. |
| `z` | The runtime's own Zod instance. Build `loadEnv({ extend })` schemas with this one — a schema from a second copy of zod is silently ignored. |
| `_setRebaseMock` / `_resetRebaseMock` | Test helpers to mock the `rebase` singleton (NODE_ENV=test only). |

Also exports `HonoEnv`, the auth, email, storage, history and cron modules, custom functions, logging utilities, and the driver registry. The abstract driver interfaces (`DatabaseAdapter`, `AuthAdapter`, `DataDriver`, …) are not re-exported: import them from `@rebasepro/types`.

`@rebasepro/server/functions` is the portable surface a function file imports — `defineFunction`, the `requireAuth`/`requireAdmin`/`requireScope` guards, `getUser`, `getScopes`, `hasScope`, `rebase` and the rest. The package also ships the `rebase-server` binary, which runs a built project bundle (`rebase-server ./dist-bundle`); it is what the `rebasepro/server` image executes.

## Quick Start

```typescript
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { initializeRebaseBackend, loadEnv, serveSPA, type HonoEnv } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

// 1. Load and validate environment
const env = loadEnv();

// 2. Create Hono app + HTTP server
const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

// 3. Initialize Rebase
const backend = await initializeRebaseBackend({
  app,
  server,
  database: createPostgresAdapter({ connection: db, schema: { tables, enums, relations } }),
  collections: myCollections,
  auth: {
    collection: defaultUsersCollection,
    jwtSecret: env.JWT_SECRET,
    allowRegistration: env.ALLOW_REGISTRATION,
    serviceKey: env.REBASE_SERVICE_KEY,
    google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : undefined,
  },
  storage: {
    type: "s3",
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  },
  // Storage is not under row-level security. In production the server refuses
  // to boot storage without an access model: this hook (or `storagePolicies`),
  // or `storagePublicRead: true` for a bucket that really is public.
  storageAuthorize: async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
  },
  functionsDir: "./functions",
  cronsDir: "./crons",
});

// 4. Optionally serve a frontend SPA
serveSPA(app, { frontendPath: "./frontend/dist" });

server.listen(env.PORT);
```

`initializeRebaseBackend` is a shortcut. One step under it, each part is a call
you make, so you can mount only some route groups, at paths of your own, or
leave the timers to another process (0.25+):

```typescript
import { createRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

const backend = await createRebaseBackend({
  database: createPostgresAdapter({ connection: db, schema: { tables, enums, relations } }),
  collections: myCollections,
  auth: { jwtSecret: env.JWT_SECRET },
  provision: true
});
app.route("/api/data", backend.routes.data());   // or backend.mount(app, { basePath: "/api" })
await backend.attachRealtime(server);
backend.start();                                 // cron, job workers, sweeps
```

See [Custom Server Integration](https://rebase.pro/docs/backend/custom-server).

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server-postgres` | PostgreSQL database driver (Drizzle ORM) |
| `@rebasepro/server-mongo` | MongoDB database driver |
| `@rebasepro/types` | Shared type definitions (`DataDriver`, `CollectionConfig`, etc.) |
| `@rebasepro/client` | Client SDK used internally by the `rebase` singleton |
| `@rebasepro/common` | Shared utilities and default collections |
