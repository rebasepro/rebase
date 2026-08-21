---
title: Custom Functions
sidebar_label: Custom Functions
description: Add custom Hono API endpoints alongside your Rebase CRUD routes. Auto-discovered from a directory, with full access to the backend instance.
---

## Overview

Custom functions let you add **arbitrary Hono API routes** alongside Rebase's auto-generated CRUD endpoints. They follow the same **file-based discovery** pattern as collections and cron jobs: drop a TypeScript file in your `functions/` directory, and Rebase mounts it automatically.

Use custom functions for:

- **Business logic endpoints** — approvals, promotions, custom workflows
- **Third-party integrations** — Stripe webhooks, Slack commands, external API proxies
- **Public endpoints** — contact forms, lead capture, health checks
- **Aggregate queries** — dashboard stats, reports, analytics

## Defining a Custom Function

Create a file in your `backend/functions/` directory that default-exports a Hono app:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", (c) => c.json({ message: "Hello from custom function!" }));
});
```

This mounts at **`/api/functions/hello`**. The filename (without extension) becomes the route prefix.

:::important
Import from **`@rebasepro/server/functions`**, not from `@rebasepro/server`.

Both work. The subpath is the *portable* authoring surface: it pulls in nothing that requires Node, so a function written against it can run on any JavaScript runtime. The package root reaches the whole framework — the boot sequence, the file loaders, the WebSocket layer — which is right for a server entrypoint and more than a route handler needs. It also gives you typed context accessors (`getUser`, `getDriver`) instead of casting `c.get("user")` by hand.

See [Runtime portability](#runtime-portability) for the full contract.
:::

## Configuration

Enable custom functions by adding `functionsDir` to your backend config:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase will:

1. Scan the directory for `.ts` / `.js` files
2. Validate each default export is a Hono app (duck-typed via `.fetch()` + `.routes`)
3. Mount each app at `/api/functions/<filename>`
4. Apply the auth middleware (see [Authentication](#authentication-and-context-propagation) below)

## File Naming and Route Mapping

| File | Mount Path |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Functions are discovered at the **top level of the directory only** — there is no recursion. `functions/admin/users.ts` is compiled by `rebase build` but never mounted; flatten the name instead (`functions/admin-users.ts`). A subdirectory is reported at boot and counted on the listing endpoint rather than ignored silently.

Files that are **skipped**:

- `index.ts` / `index.js` — reserved
- `*.test.ts` / `*.test.js` — test files
- `*.d.ts` — type declarations
- Subdirectories, and `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` files — reported as problems, since the build compiles more than the runtime loads

The name is the function's identity everywhere else too: it is the URL segment, the `functions/<name>` API-key permission, and the value `REBASE_FUNCTIONS_ONLY` selects by when you give one function its own process.

## Export Formats

The loader accepts two export formats besides `defineFunction`:

### Hono App

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Factory Function

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` returns exactly the Hono app these build by hand, so the three are interchangeable. It saves you declaring `Hono<HonoEnv>` and hands you the `rebase` singleton in the callback.

---

## Under the Hood: The Duck-Typing Loader

When compiling codebases with multiple nested directories or in monorepos, you may run into **Hono package duplication**.

If the Rebase framework depends on one Hono version and your local function directory resolves to another, standard class inheritance checks (`exported instanceof Hono`) will fail because their prototypes exist in separate memory spaces.

To prevent false negatives and reject loading functioning routers, Rebase uses a duck-typed validator (`isHonoLike`):
- It verifies the exported object is a non-null `object`.
- It checks that the object exposes a `.fetch` method (required to route requests).
- It verifies that `.routes` is an `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### ES Module Compiler Escape

To import TypeScript and JavaScript files dynamically on both Windows and Posix systems, the loader converts file paths to standard file URIs via `pathToFileURL(filePath).href`.

To prevent TypeScript compilation from rewriting native ESM dynamic imports (`import(url)`) into CommonJS `require()` calls (which would throw errors at runtime under ESM runtimes), Rebase executes a runtime compiler escape:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Authentication and Context Propagation

Custom functions are mounted with the **same auth middleware** as the data routes, but with `requireAuth: false`. This means:

- The user's JWT is **parsed and injected** into the context if present
- But requests are **not rejected** if no JWT is provided
- You must **explicitly protect** routes that need authentication

A caller who presents a *bad* token never reaches your handler: an unverifiable or expired token is rejected with 401 by the middleware itself, so an expired session is never silently downgraded to an anonymous one.

### Reading the caller

```typescript
import { defineFunction, getUser, getUserId, getRoles, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c) });
    });
});
```

`getUser` returns a narrowed object: `uid` is a string and `roles` is always an array, whatever auth method the caller used. `getUserId(c)` and `getRoles(c)` are shortcuts.

### Protecting Routes

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without an administrative role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Put guards in the **route's own middleware slot**, as above, rather than `app.use("/*", requireAuth)`. `use()` covers only the routes declared *below* it, so a route appended later — at the bottom of the file, months from now — is silently unprotected.

:::important
Reading `getUser(c)` is **not** a guard. An anonymous caller gets `undefined` and your handler runs anyway. Only a guard, or an explicit `if (!user) return 401`, stops the request.
:::

### Service Key Authentication

Rebase supports a static `REBASE_SERVICE_KEY` defined in your `.env` for script or server-to-server calls.

When an external request passes the service key via the Authorization header (`Authorization: Bearer <service_key>`), the auth middleware automatically:
1. Validates the key using constant-time comparison to prevent timing attacks.
2. Grants admin-level access, setting the caller to `{ uid: "service", roles: ["admin"] }`.
3. Injects a `DataDriver` scoped as that same service identity. Row-Level Security still applies — it is evaluated as `{ uid: "service", roles: ["admin"] }`, not skipped.

### Internal Self-Authentication

If you haven't configured a `REBASE_SERVICE_KEY`, Rebase generates a random **internal per-boot key**. The `rebase` singleton uses this key automatically when calling the server's own control-plane APIs (like `rebase.auth` or `rebase.storage`). This means your server-side logic can always perform administrative tasks even without a manually configured service key.

## Accessing the Database & Services

### 1. The user-scoped driver — for anything serving a request

`getDriver(c)` returns the driver **scoped to the caller**, so every read and write is evaluated against your Row-Level Security policies as that user:

```typescript
import { defineFunction, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", requireAuth, async (c) => {
        const driver = requireDriver(c);
        const myProducts = await driver.fetchCollection({ path: "products", limit: 10 });
        return c.json(myProducts);
    });
});
```

`requireDriver(c)` is `getDriver(c)` without the `!` — it throws a message naming the wiring problem instead of failing twenty lines later on `undefined`.

### 2. `rebase.dataAsAdmin` — for trusted background work

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.collection<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

### RLS-Scoped Driver vs. Rebase Singleton

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Runs as**         | The caller (`uid`, their roles)                | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS enforcement** | ✅ Yes (evaluated against the caller)          | ✅ Yes (evaluated against the service identity)                   |
| **Ideal for...**    | General user CRUD, search, and queries          | Background jobs, system triggers, webhooks                        |
| **API style**       | Driver-level methods (`fetchCollection`, `save`) | Fluent collection accessors (`rebase.dataAsAdmin.jobs.find`) |

#### What `dataAsAdmin` is, precisely

`rebase.dataAsAdmin` is **admin-scoped, not RLS-bypassing**. The driver is scoped once, at boot, with `withAuth({ uid: "service", roles: ["admin"] })`, so every read and write runs inside a transaction that has switched to the restricted `rebase_user` role with `app.uid = 'service'`. Your policies are evaluated — against that identity.

For most projects the distinction never surfaces, because the default policies Rebase injects onto every collection admit `serverContext() OR rolesOverlap(['admin'])`, and the service identity clears the second arm. It surfaces the moment you write your own policies:

- **`policy.serverContext()` is false for it.** That helper compiles to `rebase.uid() IS NULL`, and this accessor's `uid` is `'service'`. A collection with `disableDefaultPolicies: true` whose only write rule is `serverContext()` will refuse a `dataAsAdmin` write with Postgres error `42501`, and a read against such a collection returns **zero rows with HTTP 200** — the silent direction. Write `rolesOverlap(["admin"])` (or add it alongside) when you mean "my backend".
- **Its reach equals an `admin` user's reach.** Granting the `admin` role to an application user grants them exactly the rows this accessor sees. It is not a private channel.

### 3. `rebase.sql()` — raw SQL, and the one Node-only accessor

If you genuinely need an unconditional bypass, `rebase.sql()` is it: raw SQL on the owner connection, no policies, every row. It is the most privileged thing in a function's context — more so than the accessor with "admin" in its name.

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", requireAuth, requireAdmin, async (c) => {
        const rows = await rebase.sql(
            "SELECT count(*) AS total FROM jobs WHERE status = $1",
            { params: ["published"] }
        );
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

It runs on a TCP connection to your database, which makes it the only accessor tied to a Node process. That costs nothing on any deployment that exists today — it is simply the one thing to know about if a function may later move. See [Runtime portability](#runtime-portability).

:::caution[Direct Drizzle access is Node-only]
You can also import your own Drizzle instance and query it directly (`db.execute(sql\`…\`)`). It works, and on a self-hosted or managed Node deployment it is fine.

It is worth knowing what it costs: a function that imports `drizzle-orm` and a `pg` pool is permanently a Node function, it bypasses your collection callbacks and validation, and it takes its connection from somewhere other than the request. `rebase.sql()` gives you the same raw SQL through the framework's own connection. Prefer it.
:::

## Configuration and Secrets

Read configuration **inside** the handler, never at module scope:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Built once, on the first request that needs it — not at import time.
const apiKey = lazyResource((env) => env.PRICING_API_KEY ?? "");

export default defineFunction((app) => {
    app.get("/price", async (c) => {
        const endpoint = requireEnv(c, "PRICING_API_URL");
        const response = await fetch(endpoint, {
            headers: { authorization: `Bearer ${apiKey(c)}` }
        });
        return c.json(await response.json());
    });
});
```

Why this matters on **any** runtime, including Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

A module-scope read is evaluated when the file is imported, before any request exists. On Node that means one missing variable takes the whole file down and every route in it with it. On a host that attaches configuration to the request rather than the process, there is nothing to read at import time at all.

- `getEnv(c)` — every variable visible to this request
- `env(c, "NAME")` — one variable, trimmed; blank counts as unset
- `requireEnv(c, "NAME")` — the same, but throws a message naming the variable
- `lazyResource(factory)` — build an expensive client once, on first use

`rebase doctor` reports module-scope `process.env` reads in your functions directory.

## Background Work

Work that should outlive the response goes in `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

An un-awaited promise looks equivalent and is not. `waitUntil` buys two things:

- **On Node**, the promise is tracked, so a graceful shutdown waits for it instead of the process exiting out from under a half-sent webhook. A floating promise at `SIGTERM` is simply lost.
- **On an isolate-based host**, the host is told to keep the isolate alive until the promise settles. Without it, work is dropped the moment the response resolves — silently, with a clean 200 in the logs.

A rejection is logged rather than left to the unhandled-rejection handler, so a failure names the route it came from.

## Runtime portability

A custom function is a Hono app, and Hono runs on every JavaScript server runtime. Whether *your* function could run somewhere other than a Node process therefore comes down to what its own file imports and touches.

Nothing here is a restriction on what you may write today. Every Rebase deployment is a Node process, a function that reads a file or opens a socket is a perfectly good function, and no build or deploy fails because of any of this. It is written down so the answer is knowable now rather than discovered per-file later.

**Portable — works on any runtime:**

- Everything exported from `@rebasepro/server/functions`
- `getDriver(c)` and `rebase.dataAsAdmin` — both go over the same wire wherever they run
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — the web platform
- Any dependency that does not need Node

**Node-only:**

- `rebase.sql()` — the database owner connection is a TCP socket
- A directly imported Drizzle/`pg`/`mongodb` client, for the same reason
- Node built-ins: `fs`, `path`, `crypto` (the Node module — `globalThis.crypto` is portable), `child_process`, …
- Packages built on them: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latent bugs on every runtime** — these are worth fixing regardless:

- `process.env` read at module scope (see [Configuration and Secrets](#configuration-and-secrets))
- Fire-and-forget promises instead of [`waitUntil`](#background-work)
- Relying on a handler continuing to run after its request timed out. On Node it does; that is a property of the process, not a promise the framework makes

### Checking your own functions

`rebase build` prints a line per actionable finding and records the verdict per function in the bundle manifest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` reports the same thing without building.

### If you need a runtime-specific path

`runtimeKey()` returns `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` or `"other"`; `isNodeRuntime()` is the common check. Use them to degrade, not to fork an implementation — a function that needs two implementations is two functions.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

## Route Registration Order

Custom functions are loaded and mounted **after** `initializeRebaseBackend()` completes the core setup. The initialization order is:

1. **Bootstrappers** — Database connections, auth tables, realtime services
2. **Auth routes** — `/api/auth/*`, `/api/admin/*`
3. **Storage routes** — `/api/storage/*`
4. **Data routes** — `/api/data/*` (CRUD for collections)
5. **Custom functions** ← `/api/functions/*`
6. **Cron jobs** — `/api/cron/*`
7. **WebSocket** — Realtime subscriptions

This means your custom functions have access to all initialized services. Register any routes that need to run **before** Rebase on the Hono app directly, prior to calling `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Routes you add to your own app that way are **outside** every Rebase router, so no auth middleware has run on them and `getDriver(c)` is unset. Guard those with `requireAuth` / `requireAdmin` imported from **`@rebasepro/server`** — the package root — which verify the token themselves. The guards on the `/functions` subpath read an identity a Rebase router has already resolved, and will answer 500 rather than pretend one exists.
:::

## Example: Webhook Handler

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Constructed on the first request, from that request's configuration. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberately public: Stripe has no token to send. The signature is the
    // authentication, so verify it before doing anything else.
    app.post("/", async (c) => {
        const signature = c.req.header("stripe-signature");
        const body = await c.req.text();

        if (!signature || !verifySignature(body, signature, secret(c))) {
            return c.json({ error: "Bad signature" }, 400);
        }

        const event = JSON.parse(body) as { type: string; data: { object: Record<string, string> } };

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            await rebase.dataAsAdmin.collection("subscriptions").create({
                user_id: session.client_reference_id,
                stripe_id: session.subscription,
                status: "active",
            });
            // Fulfilment can outlive the response; the 200 tells Stripe to stop retrying.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Debugging

When a function is loaded successfully, you'll see:

```
⚡ Loaded function route: hello
```

If loading fails, the loader provides diagnostic output:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

The router is mounted for the **directory**, not for the functions in it. If every file fails to import — one missing environment variable at module scope is enough to take all of them down — `GET /api/functions` still answers `200` with an empty list plus a `skipped` count, so "nothing loaded" is distinguishable from "this build shipped no functions". The reasons stay in the boot log.

## Timeouts and Rate Limits

Two ceilings apply to `/api/functions/*`:

- **Request timeout** — 30 seconds by default, answering `504` with code `FUNCTION_TIMEOUT`. Configure with `functionsTimeoutMs` (or `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` disables it. The handler cannot be cancelled from the outside, so give outbound HTTP calls an `AbortSignal` — the timeout frees the client and the socket, not the work. That the handler *keeps running* after the 504 is a property of a long-lived Node process, not a guarantee of the contract; anything that must complete belongs in [`waitUntil`](#background-work).
- **Rate limit** — API-key and signed-in callers share the data API's buckets. Anonymous callers get their own, much looser allowance (3000 per window) because this router is public by default for webhook receivers. Override with `rateLimit.anonymousFunctions`; `null` switches it off.

Unhandled promise rejections are logged rather than fatal: a fire-and-forget call in one function would otherwise end the whole process. Set `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` for Node's default behaviour.

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration reference
- **[Entity Callbacks](/docs/collections/callbacks)** — Run logic on data changes
- **[Cron Jobs](/docs/backend/cron-jobs)** — Scheduled background tasks
