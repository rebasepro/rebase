---
title: Custom Server Integration
sidebar_label: Custom Server
description: Build the Rebase backend from public pieces in your own server — createRebaseBackend, its route groups, mount, attachRealtime and start — or embed the Postgres driver in Express.
---

# Custom Server Integration

`initializeRebaseBackend` is a shortcut. It builds the whole backend, mounts
it on your Hono app under `/api`, attaches the realtime socket to your HTTP
server and starts the background work, in one call. When that is what you want,
use it.

When it is not, take one step down. Every part of that call is a public piece
you can call yourself: build the backend, then mount all of it or only the
route groups you want, at the paths you want, and decide which process starts
the timers. The last section goes one step further and embeds the Postgres
driver alone in an Express app.

## Environment Configuration

Rebase provides a centralized `loadEnv()` utility in `@rebasepro/server` that validates your environment variables against a strict Zod schema. Call it **after** loading your `.env` file:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

To add typed variables of your own, extend the schema:

```typescript
import { loadEnv, z } from "@rebasepro/server";

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string        (validated, required)
```

Importing `z` from `@rebasepro/server` is new. On 0.17 and
earlier the package exported no `z`: import it from `zod`, matching the major the
runtime uses, and let your bundler dedupe the two copies.

:::caution[The `z` you extend with must be the runtime's zod]
Two copies of zod loaded at once is the one way this call goes wrong, and it
used to go wrong silently. `.merge()` accepts a schema from the other copy —
the shapes are identical — and then `.parse()` rejects every field carrying a
`.default()`, because a default is recognised by class identity. The server came
up, reported success, and ran none of its crons; nothing in the failure
mentioned zod.

The runtime provides `zod`. The scaffold's `backend/package.json` lists it at
the range `@rebasepro/server` uses, so one copy is installed: keep the two equal.
`loadEnv` now refuses a foreign schema at boot with a message naming the fix,
rather than accepting it and validating half of it.
:::

**Key behaviors:**
- Generates `JWT_SECRET` and `REBASE_SERVICE_KEY` in development when they are unset, so you can start without manual setup, and caches them in `.rebase-dev-secrets.json` so a restart does not sign anyone out.
- Blocks auto-generated secrets in production — you must set them explicitly.
- Validates that `CORS_ORIGINS` or `FRONTEND_URL` is set in production.
- Refuses an `extend` schema built by a different copy of zod.
- Throws an `Error` naming each variable that is missing or wrong, such as `DATABASE_URL: is required`, with zod's issues on its `issues` property. On 0.24 it throws zod's own `ZodError`, which names no variable when nothing catches it.

See `.env.example` in the scaffolded app for the full list of supported variables.

## One step under `initializeRebaseBackend`

On 0.24,
`initializeRebaseBackend` is the only way in, and none of the pieces below is
exported.

`initializeRebaseBackend` is these calls, and nothing else:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` when REBASE_PROVISION=false, and
    // `{ collections: false, realtime: false }` when called with `provisionSchema: false`.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

The `shutdown()` it returns also closes the server it was given. Here is the
same thing written out as a project's `backend/src/index.ts`, ready to change.
`rebase dev` runs that file when a project has one, in place of the runtime's
own boot. Pasted into a scaffolded project, it serves what the runtime served:
the API on the port `rebase dev` picked, sign-in and registration with the
project's users collection, the functions in `backend/functions/`, the cron jobs
in `backend/crons/`, the buckets declared in `config/resources.ts`, and the CORS
the admin panel needs on its own port.

```typescript
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    CORS_EXPOSED_HEADERS,
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    isLocalhostOrigin,
    loadEnv,
    logger,
    resolveStorageSources,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import {
    createPostgresAdapter,
    createPostgresDatabaseConnection,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { declaredStorageSources } from "@rebasepro/types";
import "../../config/resources";
import usersCollection from "../../config/collections/users";
import { storageAuthorize } from "../../config/storage";

// dotenv never overrides a variable already set, so what `rebase dev` sets wins.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cronsDir = path.join(root, "backend/crons");

installUnhandledRejectionHandler();

const app = new Hono<HonoEnv>();

// Localhost in development, and the origins in CORS_ORIGINS or FRONTEND_URL.
const origins = (env.CORS_ORIGINS || env.FRONTEND_URL || "").split(",").map((origin) => origin.trim());
app.use("/*", cors({
    origin: (origin) =>
        origins.includes(origin) || (env.NODE_ENV !== "production" && isLocalhostOrigin(origin)) ? origin : null,
    credentials: true,
    exposeHeaders: [...CORS_EXPOSED_HEADERS]
}));
app.use("/*", secureHeaders());

const server = createServer({ maxHeaderSize: 64 * 1024 }, getRequestListener(app.fetch));
const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);

const backend = await createRebaseBackend({
    collectionsDir: path.join(root, "config/collections"),
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        collection: usersCollection,
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        cookieAuth: { sameSite: "Lax" }
    },
    storage: resolveStorageSources(process.env, declaredStorageSources(), path.join(root, "uploads")),
    storageAuthorize,
    history: true,
    provision: true
});

setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();

// The runtime answers health on both paths; an orchestrator probes `/health`.
for (const healthPath of ["/health", "/api/health"]) {
    app.get(healthPath, async (c) => {
        const { healthy } = await backend.healthCheck();
        return c.json({ status: healthy ? "ok" : "degraded" }, healthy ? 200 : 503);
    });
}

// `rebase dev` reads this line to know the backend is up.
server.listen(env.PORT, () => logger.info(`Server running at http://localhost:${env.PORT}`));
installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
```

The paths are the scaffold's. The file relies on what `rebase dev` sets: the
port it picked in `PORT`, the managed database in `DATABASE_URL`, and the
project's `.env` in `DOTENV_CONFIG_PATH`. `loadEnv()` validates what that
holds, and generates `JWT_SECRET` in development when it is unset. Listen on
another port and the admin panel cannot reach the server; skip `loadEnv()` and,
with no `JWT_SECRET`, sign-in is off.
`rebase dev` also waits for the `Server running at http://localhost:<port>` line
before it reports the backend up. The `auth` options are the scaffold's; the
runtime also reads the OAuth providers, email and the other `AUTH_*` variables,
so pass the ones you use, as [Authentication](/docs/backend/authentication/)
describes. Nor does the file serve the built admin panel in production: the
entrypoint [`rebase eject`](/docs/cli/) writes does, with `serveSPA`, and opens
one connection per database declared in `config/resources.ts`.

`createRebaseBackend` takes the same options as `initializeRebaseBackend`,
without `app`, `server` and `basePath`, and with `provision` required. It
builds everything: it opens the database, sets up auth and storage, loads the
functions and cron jobs, and builds every route group and the in-process
client. It mounts nothing, starts no timer and adds no process listener. Each
of the rest is a call you make, or leave out:

| Call | What it does | Leave it out and |
|---|---|---|
| `installUnhandledRejectionHandler()` | Logs a promise rejection nothing handled, such as a fire-and-forget call in a custom function, instead of letting Node end the process. Process-wide, so it is the process's decision, not a backend's. Returns a function that uninstalls it, or `undefined` when one was already installed or `REBASE_EXIT_ON_UNHANDLED_REJECTION` is set. | an unhandled rejection ends the process, Node's default |
| `setDefaultBackend(backend)` | Makes this backend the [process default](#several-backends-in-one-process): what `import { rebase }` and the rest of the module-level API answer for outside the requests, cron runs and jobs a backend serves | that API has no backend to answer for there |
| `backend.mount(app, { basePath })` | Every route group under `basePath` (default `/api`), behind the process-wide middleware: request ids, the body limit, compression, CSRF, the request log, and the JSON envelope for errors and unknown paths. Also the JWKS document, the MCP server, the OpenAPI docs and the legacy route aliases. | nothing is served over HTTP; `backend.rebase` and `backend.fetch` still work |
| `backend.attachRealtime(server, { path })` | The realtime socket, on `server`, answering upgrades on `path` only | there are no live queries |
| `backend.start()` | The cron scheduler, the job workers, the expired-token and history-retention sweeps, the metrics sampler and the scheduled RLS audit, each where `ownership` gives it to this process. Safe to call twice. | none of them runs, which is what a request-serving process in a [split deployment](/docs/deployment/split-processes/) wants |
| `backend.shutdown(timeoutMs, { server })` | Stops what `start()` and `attachRealtime()` started, waiting for cron runs and jobs in flight. Closes `server` only when you pass it. | |

The socket's default `path` is the base path given to `mount()` with a trailing
`/api` removed, so `/api` gives `/` and `/x/api` gives `/x`. That is where the
SDK dials, because it connects to its `baseUrl` while its HTTP requests go to
`${baseUrl}/api`. An upgrade to any other path is left to the server's other
`upgrade` listeners, so your app can run its own WebSocket server on the same
`http.Server`.

### What creating a backend may change: `provision`

Creating a backend can run DDL, so `createRebaseBackend` asks you to decide:

| `provision` | Creates | For |
|---|---|---|
| `true` | Everything the backend serves: the collection tables and their RLS policies, change capture for realtime, the role requests run as, and the framework's own tables (API keys, cron runs, jobs, metrics). | a single-process deployment; what `initializeRebaseBackend` passes |
| `false` | Nothing, at boot or later: the tables other backends make on first use (idempotency keys, cron claims) are not made either. The schema must already be there, applied by `rebase db push`, a migration, or another process. Missing auth tables refuse at boot; a missing optional table turns its feature off, named in the log. | a script, a test, a REPL, a process that only reads, a database only your change process may change |
| `{ collections: false, realtime: false }` | The framework's tables and the role, but not the collection schema or change capture. | a process that does not own the schema in a split deployment |

It is an option rather than a later step on purpose. The driver reads the
tables as it opens, and attaches change capture to the ones that exist then.
A `provision()` called afterwards would run after the driver had already
decided what exists. `REBASE_MIGRATE_ON_BOOT=none` still turns the collection
schema off for any backend in the process. <span class="since-badge" data-since="0.26">Since 0.26</span> `initializeRebaseBackend` passes
`false` when `REBASE_PROVISION=false`.

## Mounting only the groups you want

`backend.routes` holds the route groups. Each one is a Hono sub-app you can
mount on its own, at any path:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, collections, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`collections` is the array a scaffold's `config/collections/index.ts` exports. It carries that index's `defaultSecurityRules`, as `collectionsDir` does, so the backend provisions the policies `rebase db push` would. An array of your own carries only the rules its collections declare, and `provision: true` makes one that declares none admin-only, dropping the policies Rebase generated for it earlier, on every server that shares the database.

The scaffold's index applies the defaults to its array. In a project scaffolded on 0.24, copy that loop from a new scaffold's `config/collections/index.ts`, or pass `collectionsDir`.

| Group | Normally at | Serves |
|---|---|---|
| `routes.auth()` | `/api/auth` | sign-in, sessions, OAuth, password reset, `GET /config`, the caller's own API keys and the scope catalogue |
| `routes.data()` | `/api/data` | the collections' REST routes and their history |
| `routes.storage()` | `/api/storage` | file storage, or the router that answers `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | your [custom functions](/docs/backend/custom-functions/), or the forwarder to the process that serves them |
| `routes.admin()` | `/api/admin` | users and roles, service keys, schema editing, storage maintenance, backups, the RLS audit, SQL export, the development mailbox and the logs |
| `routes.cron()` | `/api/admin/cron` | the cron admin surface |
| `routes.meta()` | `/api/meta` | the project contract a generated SDK reads |

Each group carries the middleware it needs: the auth context that puts the
caller's `user`, `driver` and `scopes` on the request, its rate limits and its
admin gate. So it answers the same wherever it is mounted, under a
parameterised path such as `/:tenant/data` too. A group also reads where it was
mounted, so the data API still routes each collection to its data source and
the functions listing names the paths it is really served at.

A group also answers the "act as someone else" headers itself, as `mount()`
does: the data and functions groups honour `x-rebase-impersonate` and
`x-rebase-simulate-*` for an administrator, and every other group refuses them
with `400 IMPERSONATION_UNSUPPORTED` or `SIMULATION_UNSUPPORTED`, so a request
asking to act as another user is never answered as the administrator who sent
it. Routes of your own that should refuse them too can use the same guard:

```typescript
import { refuseUnhonouredImpersonation } from "@rebasepro/server";

// Refuses the headers on every path below, except under the mounts listed.
app.use("/v2/*", refuseUnhonouredImpersonation(["/v2/data", "/v2/functions"]));
```

On 0.25 a group mounted on its own ignored the headers and answered as the
administrator.

What a group does not carry is the process-wide middleware `mount()` puts in
front of everything. Mounting groups one by one, add what you want of it
yourself: a body limit (`bodyLimit` from `hono/body-limit`), compression, and
the JSON error envelope:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Every call returns a fresh router over the same handlers, so you can mount a group in two places. Asking for a group whose surface this backend was created without (`surfaces: { data: false }`) throws, because the backend never built it. The OpenAPI docs and the MCP server have no group: they describe the URLs of the `mount()` layout, so only `mount()` serves them.

## The backend without a server

A backend you have built can be used without mounting anything.
`backend.rebase` is its in-process client, and `backend.fetch(request)`
answers a `Request` as `mount()` would at `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, collections, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

The control-plane calls on that client (`rebase.auth`, `rebase.admin`,
`rebase.functions` and `rebase.cron`) reach the backend's own routes
in-process. They work wherever, or whether, you mounted the groups, and
middleware you added to your own app does not run on them.

For a script that only needs the data, [`openRebase`](/docs/backend/scripts/)
opens the database without building a backend at all.

## Several backends in one process

On 0.24 the JWT
configuration, the access model, the API-key store, the rate-limit store and
`rebase` are process globals, and the last backend built wins all of them.

`createRebaseBackend` writes no process global. Each backend holds its own
state in `backend.services`, so two of them in one process stay two: each
signs and verifies sessions with its own keys, judges scopes by its own roles,
checks API keys in its own store and counts rate limits in its own store.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, collections, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, collections, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | What it is |
|---|---|
| `jwt` | The backend's JWT service: signs and verifies sessions, download links and its other tokens, and serves its JWKS |
| `access` | Its access model (roles to scopes) and the resolver for a personal key's owner |
| `apiKeyStore` | Where its API keys are checked |
| `rateLimitStore`, `authLimiters` | Its rate-limit counters, and the limiters on its auth routes |
| `collections()` | The collections it serves |
| `topics`, `queues` | Its topic and queue runtimes |

A backend given no `auth.jwtSecret`, such as one whose `auth` is an adapter,
signs nothing of its own, so its `services.jwt` follows the process default.

**Resources are the process's.** The `database()`, `bucket()`, `topic()` and
`queue()` declarations in `config/resources.ts` are module-level values, and
every backend in the process reads all of them: a backend whose own project
declares no topic still turns its job queue on for another project's topic,
and refuses to boot if its driver cannot carry one. Run one project's
resources per process. Several backends of that one project, each on its own
database, are fine.

**Where `rebase` goes.** Inside a request, a cron run or a job that a backend
serves, `rebase`, whether imported from `@rebasepro/server` or received as
`ctx.rebase`, is that backend, and so are topic `publish` and queue `enqueue`.
Anywhere else (module scope, a script, a test) they answer for the **process
default**, which `setDefaultBackend(backend)` sets, and which
`initializeRebaseBackend` sets to its own backend. So does the rest of the
module-level API: `verifyAccessToken` and the other JWT helpers,
`getAccessModel`, `verifyCredential` and `extractUserFromToken`.

Three pieces work on one backend directly, and one on no backend at all:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the users collection.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The users collection
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

A minted session is checked like any other on every request, so its uid has to be a user that exists: for a uid with no user the request is refused.

`verifyCredential` reaches the verdict the routes reach: a session its owner signed out of, a uid with no user and a disabled account come back null, and the roles are the ones the account holds now. It throws when the database cannot be reached. On 0.24 it checks the signature only, and reads the roles off the token.

Every route group sets `c.var.services` itself. A route outside the groups that uses `requireAuth`, `requireScope` or another guard from `@rebasepro/server` reads it there, and falls back to the process default when it is unset. `requireScope` judges the caller `requireAuth` identified, so it goes after `requireAuth`: on its own it refuses every request with a 401. It takes a built-in scope, or an app scope the backend declares under `auth.scopes` on its users collection, as in the comment above.

A name that is not a scope, or a misspelt built-in one such as `data:raed`, throws where the route is registered. An app scope the backend answering does not declare answers every caller, an administrator too, `500 SCOPE_NOT_DECLARED`. On 0.24 both answer every caller `403 SCOPE_MISSING`.

## Shutting down

A backend from
`createRebaseBackend` is new; the rest of this section holds for 0.24 too.

From `initializeRebaseBackend`, hand the backend to the built-in helper rather
than writing a signal handler. It drains HTTP, stops the cron scheduler, tears
down realtime, closes the SMTP pool once nothing can send, guards against
repeated signals, and force-exits if shutdown hangs:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, collections });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

Do **not** combine it with your own `server.close()`: that backend's
`shutdown()` already closes the server it was given, and a second close
deadlocks. A backend from `createRebaseBackend` closes a server only when you
pass it, `backend.shutdown(timeoutMs, { server })`, as in the example at the
top of this page.

## Embedding the Postgres driver in Express

One step further down, `@rebasepro/server-postgres` works without the Rebase server at all. It depends on Drizzle and Node's `http.Server`, so you can open the data driver and the realtime socket inside Express, Fastify or plain Node. At this level you assemble the backend yourself: there are no auth routes, no storage and no admin API unless you build them.

### 1. Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

### 2. Opening the driver and the socket

`openPostgresDriver`
and `postgresDriverConfigFromEnv` are exported. On 0.24, open the driver with
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, whose `internals` is
untyped.

```typescript
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import {
    createPostgresDatabaseConnection,
    createPostgresWebSocket,
    openPostgresDriver,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { collections } from "./collections";

async function startServer() {
    const app = express();

    // The socket needs the raw http.Server, so listen on it, not on app.listen.
    // 64 KB of headers, as the Rebase runtime takes: a vector search in the URL
    // outgrows Node's 16 KB.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, app);

    const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

    // The environment, read the way the Rebase server's boot reads it:
    // DATABASE_READ_URL, DATABASE_DIRECT_URL and the REALTIME_* variables.
    // Leave this call out and the driver reads no environment variable at all.
    const pgConfig = postgresDriverConfigFromEnv({ connection: db, connectionString });

    // The collections' tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { collections });

    // The realtime socket. It answers upgrades on `path` only, so a WebSocket
    // server of your own can share the same http.Server.
    createPostgresWebSocket(
        server,
        internals.realtimeService,
        internals.driver,
        { requireAuth: true, jwtSecret: process.env.JWT_SECRET },
        undefined,
        { path: "/" }
    );

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // A write through the driver
    app.post("/api/products", async (req, res) => {
        try {
            const result = await driver.save({
                path: "products",
                values: req.body,
                status: "new"   // required: "new" | "existing" | "copy"
            });
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Drizzle directly, typed: `internals.db`, and `internals.readDb` when a
    // read replica is configured.
    app.get("/api/stats", async (req, res) => {
        const result = await internals.db.execute(sql`select count(*) from products`);
        res.json(result.rows);
    });

    const port = process.env.PORT || 3000;
    server.listen(port);

    // Graceful shutdown: stop listening, stop the LISTEN client, evict branch
    // pools, then end the main pool.
    const handleShutdown = (signal: string) => {
        console.log(`Shutdown triggered via ${signal}.`);
        server.close(async () => {
            try {
                await internals.realtimeService.stopListening();
                await internals.poolManager?.shutdown();
                await pool.end();
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

`openPostgresDriver` is what `createPostgresAdapter` runs when the Rebase server boots, after `postgresDriverConfigFromEnv` has read the environment into the config. Its second argument says what to open: the `collections`, whether opening may run its own DDL (`provision`, default `true`), and what part this process takes in realtime (`realtime: false` for none).

It creates no collection table, so against a database without one `POST /api/products` answers `500` "Table not found for collection 'products'". Create the tables first. `rebase db push` does it from a Rebase project whose `config/collections` declares them. In this server, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` before `openPostgresDriver` adds the tables and columns the database lacks, as the Rebase server's boot does, and changes nothing that exists.

---

## Key Backend Concepts

### Read Replica Connections
Set `readConnectionString` on the driver config, or the `DATABASE_READ_URL` environment variable, which the server's boot and `postgresDriverConfigFromEnv` read into it, and the driver opens a second connection pool against your read replica, under `internals.readDb`. Reads go to the replica; writes stay on the primary.

The `readConnectionString` option is honoured. On 0.24 it was declared and ignored, and only `DATABASE_READ_URL` worked.

### Drizzle Integration
You do not have to choose between Rebase and Drizzle. The driver compiles your schemas dynamically, and `internals.db` is the Drizzle `NodePgDatabase` client, typed, for raw SQL or type-safe Drizzle builders alongside Rebase's REST services.

### Graceful Connection Draining
In serverless environments or orchestrators (like Kubernetes), terminating pods can result in broken connections. Always implement signal handlers that call `internals.realtimeService.stopListening()` (which ends the dedicated pg LISTEN client) and `pool.end()`, so you do not leak connection slots on your database server.

### CORS for a browser frontend
A custom server owns its CORS config, and a frontend on another origin can read
only the response headers it exposes. Expose the ones the SDK reads, or
`etagOf(row)` is always `undefined` there — an `ifMatch` write then goes out
with no `If-Match` — and a 429 loses its `Retry-After`:

```typescript
import express from "express";
import cors from "cors";
import { CORS_EXPOSED_HEADERS } from "@rebasepro/server";

const app = express();
app.use(cors({
    origin: ["https://app.example.com"],
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS]
}));
```

`CORS_EXPOSED_HEADERS` is the list the runtime itself exposes, so a
header the SDK starts reading in a later version reaches your frontend without
a change here. It is `ETag`, `Retry-After`, `X-Request-ID`, the three
`X-RateLimit-*` headers and `Preference-Applied`, plus `Location`,
`Upload-Offset` and `Rebase-Upload-Result`, which a resumable upload (files over
8 MiB) answers in. Without those three the SDK cannot follow an upload from
another origin, and sends every file as one multipart request instead. On 0.24,
write the list out by hand.

The Rebase runtime and the ejected backend send this list already. On 0.23
they expose none of these headers, so a frontend on another origin reads no `ETag`.

## Related

- [Scripts and the Console](/docs/backend/scripts/) — the project's data from a script, a test or a REPL, with no server
- [Backend Overview](/docs/backend/) — where each option lives when the runtime boots instead
- [Split Processes](/docs/deployment/split-processes/) — the roles a custom server has to reproduce
- [Storage Configuration](/docs/backend/storage/) — the sources a custom server must resolve itself
