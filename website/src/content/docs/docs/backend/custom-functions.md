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
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", (c) => {
    return c.json({ message: "Hello from custom function!" });
});

export default app;
```

This mounts at **`/api/functions/hello`**. The filename (without extension) becomes the route prefix.

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
4. Apply the auth middleware (see [Authentication](#authentication) below)

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

## Export Formats

The loader accepts two export formats:

### Hono App (recommended)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Factory Function

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

---

## Under the Hood: The Duck-Typing Loader

When compiling codebases with multiple nested directories or in monorepos, you may run into **Hono package duplication**. 

If the Rebase framework depends on one Hono version and your local function directory resolves to another, standard class inheritance checks (`exported instanceof Hono`) will fail because their prototypes exist in separate memory spaces.

To prevent false negatives and reject loading functioning routers, Rebase uses a duck-typed validator (`isHonoLike`):
- It verifies the exported object is a non-null `object`.
- It checks that the object exposes a `.fetch` method (required to route requests).
- It verifies that `.routes` is an `array`.

```typescript
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### ES Module Compiler Escape

To import TypeScript and JavaScript files dynamically on both Windows and Posix systems, the loader converts file paths to standard file URIs via `pathToFileURL(filePath).href`. 

To prevent TypeScript compilation from rewriting native ESM dynamic imports (`import(url)`) into CommonJS `require()` calls (which would throw errors at runtime under ESM runtimes), Rebase executes a runtime compiler escape:

```typescript
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Authentication & Context Propagation

Custom functions are mounted with the **same auth middleware** as the data routes, but with `requireAuth: false`. This means:

- The user's JWT is **parsed and injected** into the context if present
- But requests are **not rejected** if no JWT is provided
- You must **explicitly protect** routes that need authentication

### Protecting Routes

Use Rebase's built-in auth helpers:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

// Public endpoint — no auth required
app.get("/public", (c) => {
    return c.json({ message: "Anyone can access this" });
});

// Protected endpoint — requires a valid JWT
app.post("/protected", async (c) => {
    // Narrowed: the env types every variable the middleware may set.
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ message: `Hello, ${user.uid}` });
});

// Admin-only endpoint
app.post("/admin-only", async (c) => {
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    const roles: string[] = user?.roles ?? [];
    if (!roles.includes("admin")) {
        return c.json({ error: "Admin access required" }, 403);
    }
    return c.json({ message: "Admin operation succeeded" });
});

export default app;
```

:::important
Rebase's JWT middleware is scoped to the built-in API routes (`/api/data`, `/api/auth`, etc.). Custom function routes get the **parsed user context** (e.g. `c.get("user")`), but you must enforce access control yourself.
:::

### Service Key Authentication

Rebase supports a static `REBASE_SERVICE_KEY` defined in your `.env` for script or server-to-server calls. 

When an external request passes the service key via the Authorization header (`Authorization: Bearer <service_key>`), the auth middleware automatically:
1. Validates the key using constant-time comparison to prevent timing attacks.
2. Grants admin-level access, setting `c.get("user")` with:
   ```json
   {
     "uid": "service",
     "roles": ["admin"]
   }
   ```
3. Injects a `DataDriver` into `c.get("driver")` scoped as that same service identity. Row-Level Security still applies — it is evaluated as `{ uid: "service", roles: ["admin"] }`, not skipped.

### Internal Self-Authentication

If you haven't configured a `REBASE_SERVICE_KEY`, Rebase generates a random **internal per-boot key**. The `rebase` singleton uses this key automatically when calling the server's own control-plane APIs (like `rebase.auth` or `rebase.storage`). This means your server-side logic can always perform administrative tasks even without a manually configured service key.

## Accessing the Database & Services

Custom functions run alongside Rebase, providing multiple ways to interact with your data depending on your security requirements:

### 1. Via the User-Scoped Data Driver (Recommended for User Requests)

Rebase automatically injects the `driver` into the Hono request context (`c.get("driver")`). This driver is **scoped to the authenticated user** and automatically respects all PostgreSQL Row-Level Security (RLS) policies.

Using the driver ensures that users can only query or update records they are authorized to access under your database security policies:

```typescript
// backend/functions/my-products.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", async (c) => {
    const driver = c.get("driver")!; // Injected scoped driver
    const user = c.get("user");       // Authenticated user context

    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Queries respect Row-Level Security
    const myProducts = await driver.fetchCollection({
        path: "products",
        limit: 10
    });

    return c.json(myProducts);
});

export default app;
```

### 2. Via the Rebase Singleton (Admin-Scoped Access)

The `@rebasepro/server` package provides a `rebase` singleton whose `dataAsAdmin` accessor runs as the service identity `{ uid: "service", roles: ["admin"] }`. Use this for background processing, system updates, integrations, or cases where a request needs to read or write to tables that the end-user has no direct permissions for:

```typescript
// backend/functions/approve-job.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { rebase } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");

    // Use the admin-level data API (RLS is evaluated as the `admin` role)
    await rebase.dataAsAdmin.collection<Record<string, unknown>>("jobs").update(id, {
        status: "published",
        approved_at: new Date().toISOString(),
    });

    return c.json({ success: true });
});

export default app;
```

### RLS-Scoped Driver vs. Rebase Singleton

|                     | `c.get("driver")` (request-scoped)             | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Runs as**         | The caller (`uid`, their roles)                | `{ uid: "service", roles: ["admin"] }`                            |
| **RLS enforcement** | ✅ Yes (evaluated against the caller)          | ✅ Yes (evaluated against the service identity)                   |
| **Performance**     | Native (direct driver call)                     | Native (direct driver call)                                       |
| **Ideal for...**    | General user CRUD, search, and queries          | Background jobs, system triggers, webhooks                        |
| **API style**       | Driver-level methods (`fetchCollection`, `saveEntity`) | Fluent collection accessors (`rebase.dataAsAdmin.jobs.find`) |

#### What `dataAsAdmin` is, precisely

`rebase.dataAsAdmin` is **admin-scoped, not RLS-bypassing**. The driver is scoped once, at boot, with `withAuth({ uid: "service", roles: ["admin"] })`, so every read and write runs inside a transaction that has switched to the restricted `rebase_user` role with `app.uid = 'service'`. Your policies are evaluated — against that identity.

For most projects the distinction never surfaces, because the default policies Rebase injects onto every collection admit `serverContext() OR rolesOverlap(['admin'])`, and the service identity clears the second arm. It surfaces the moment you write your own policies:

- **`policy.serverContext()` is false for it.** That helper compiles to `rebase.uid() IS NULL`, and this accessor's `uid` is `'service'`. A collection with `disableDefaultPolicies: true` whose only write rule is `serverContext()` will refuse a `dataAsAdmin` write with Postgres error `42501`, and a read against such a collection returns **zero rows with HTTP 200** — the silent direction. Write `rolesOverlap(["admin"])` (or add it alongside) when you mean "my backend".
- **Its reach equals an `admin` user's reach.** Granting the `admin` role to an application user grants them exactly the rows this accessor sees. It is not a private channel.

If you genuinely need an unconditional bypass, `rebase.sql()` is it: raw SQL on the owner connection, no policies, every row. It is the most privileged thing in a function's context — more so than the accessor with "admin" in its name.

### 3. Via Direct Drizzle Access

If you need raw SQL or complex custom queries, you can access your Drizzle database instance directly:

```typescript
// backend/functions/reports.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { db } from "../src/db"; // Your Drizzle instance
import { sql } from "drizzle-orm";

const app = new Hono<HonoEnv>();

app.get("/stats", async (c) => {
    const result = await db.execute(sql`
        SELECT COUNT(*) as total FROM jobs WHERE status = 'published'
    `);
    return c.json({ totalJobs: result.rows[0]?.total });
});

export default app;
```

:::tip
The Drizzle `db` instance used by Rebase is the same one you pass to `createPostgresBootstrapper`. You can share it freely between custom functions and Rebase.
:::

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

## Example: Webhook Handler

```typescript
// backend/functions/stripe-webhook.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import Stripe from "stripe";
import { instance } from "../src/index";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const sig = c.req.header("stripe-signature")!;
    const body = await c.req.text();

    const event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await instance.driver.data.subscriptions.create({
            user_id: session.client_reference_id,
            stripe_id: session.subscription,
            status: "active",
        });
    }

    return c.json({ received: true });
});

export default app;
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

- **Request timeout** — 30 seconds by default, answering `504` with code `FUNCTION_TIMEOUT`. Configure with `functionsTimeoutMs` (or `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` disables it. The handler cannot be cancelled from the outside, so give outbound HTTP calls an `AbortSignal` — the timeout frees the client and the socket, not the work.
- **Rate limit** — API-key and signed-in callers share the data API's buckets. Anonymous callers get their own, much looser allowance (3000 per window) because this router is public by default for webhook receivers. Override with `rateLimit.anonymousFunctions`; `null` switches it off.

Unhandled promise rejections are logged rather than fatal: a fire-and-forget call in one function would otherwise end the whole process. Set `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` for Node's default behaviour.

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration reference
- **[Entity Callbacks](/docs/collections/callbacks)** — Run logic on data changes
- **[Cron Jobs](/docs/backend/cron-jobs)** — Scheduled background tasks
