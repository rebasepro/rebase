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
| `initializeRebaseBackend(config)` | Main entry point. Wires up drivers, auth, storage, API routes, cron, and custom functions. Returns a `RebaseBackendInstance`. |
| `rebase` | Server-side singleton — a `RebaseServerClient` (from `@rebasepro/types`): the client without `data`, plus `dataAsAdmin`. Available after init. Admin-scoped access to data (RLS is evaluated as the service identity, not skipped), auth, email, and storage. |
| `loadEnv()` | Validates `process.env` against the Rebase env schema (Zod). Auto-generates dev secrets. Supports `extend` for custom vars. |
| `serveSPA(app, config)` | Mounts SPA static-file serving + index.html fallback on a Hono app. |
| `RebaseBackendConfig` | Config type for `initializeRebaseBackend`. |
| `RebaseAuthConfig` | Auth config type (JWT, OAuth providers, hooks, service key). |
| `RebaseBackendInstance` | Return type — includes `driver`, `healthCheck()`, `shutdown()`, `cronScheduler`, `storageController`, etc. |
| `RebaseEnv` | Zod-inferred type of validated environment variables. |
| `z` | The runtime's own Zod instance. Build `loadEnv({ extend })` schemas with this one — a schema from a second copy of zod is silently ignored. |
| `_setRebaseMock` / `_resetRebaseMock` | Test helpers to mock the `rebase` singleton (NODE_ENV=test only). |

Also exports `HonoEnv`, the auth, email, storage, history and cron modules, custom functions, logging utilities, and the driver registry. The abstract driver interfaces (`DatabaseAdapter`, `AuthAdapter`, `DataDriver`, …) are not re-exported: import them from `@rebasepro/types`.

`@rebasepro/server/functions` is the portable surface a function file imports — `defineFunction`, the `requireAuth`/`requireAdmin` guards, `getUser`, `rebase` and the rest. The package also ships the `rebase-server` binary, which runs a built project bundle (`rebase-server ./dist-bundle`); it is what the `rebasepro/server` image executes.

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

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server-postgres` | PostgreSQL database driver (Drizzle ORM) |
| `@rebasepro/server-mongo` | MongoDB database driver |
| `@rebasepro/types` | Shared type definitions (`DataDriver`, `CollectionConfig`, etc.) |
| `@rebasepro/client` | Client SDK used internally by the `rebase` singleton |
| `@rebasepro/common` | Shared utilities and default collections |
