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

const app = new Hono();

app.get("/", (c) => {
    return c.json({ message: "Hello from custom function!" });
});

export default app;
```

This mounts at **`/api/functions/hello`**. The filename (without extension) becomes the route prefix.

## Configuration

Enable custom functions by adding `functionsDir` to your backend config:

```typescript
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

Files that are **skipped**:

- `index.ts` / `index.js` — reserved
- `*.test.ts` / `*.test.js` — test files
- `*.d.ts` — type declarations

## Export Formats

The loader accepts two export formats:

### Hono App (recommended)

```typescript
import { Hono } from "hono";
const app = new Hono();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Factory Function

```typescript
import { Hono } from "hono";
export default function () {
    const app = new Hono();
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

const app = new Hono();

// Public endpoint — no auth required
app.get("/public", (c) => {
    return c.json({ message: "Anyone can access this" });
});

// Protected endpoint — requires a valid JWT
app.post("/protected", async (c) => {
    const user = c.get("user"); // Injected by Rebase middleware
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ message: `Hello, ${user.userId}` });
});

// Admin-only endpoint
app.post("/admin-only", async (c) => {
    const user = c.get("user");
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
3. Injects an admin-privileged `DataDriver` into `c.get("driver")` that bypasses Row-Level Security.

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
import { HonoEnv } from "@rebasepro/server-core"; // Import types for typing Hono context

const app = new Hono<HonoEnv>();

app.get("/", async (c) => {
    const driver = c.get("driver")!; // Injected scoped driver
    const user = c.get("user");       // Authenticated user context

    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Queries respect Row-Level Security
    const { data: myProducts } = await driver.fetchCollection({
        path: "products",
        limit: 10
    });

    return c.json(myProducts);
});

export default app;
```

### 2. Via the Rebase Singleton (Bypasses RLS - Admin Access)

The `@rebasepro/server-core` package provides a `rebase` singleton that has **full administrative privileges** (no RLS). Use this for background processing, system updates, integrations, or cases where a request needs to read or write to tables that the end-user has no direct permissions for:

```typescript
// backend/functions/approve-job.ts
import { Hono } from "hono";
import { rebase } from "@rebasepro/server-core";

const app = new Hono();

app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");

    // Use the admin-level data API (bypasses RLS completely)
    await rebase.data.jobs.update(id, {
        status: "published",
        approved_at: new Date().toISOString(),
    });

    return c.json({ success: true });
});

export default app;
```

### RLS-Scoped Driver vs. Rebase Singleton

| **RLS Enforcement** | ✅ Yes (evaluated against user/roles) | ❌ No (bypasses all security rules) |
| **Performance** | Native (direct driver call) | Native (direct driver call for `rebase.data`) |
| **Ideal for...** | General user CRUD, search, and queries | Background jobs, system triggers, webhooks |
| **API style** | Driver-level methods (`fetchCollection`, `saveEntity`) | Fluent collection accessors (`rebase.data.jobs.find`) |

### 3. Via Direct Drizzle Access

If you need raw SQL or complex custom queries, you can access your Drizzle database instance directly:

```typescript
// backend/functions/reports.ts
import { Hono } from "hono";
import { db } from "../src/db"; // Your Drizzle instance
import { sql } from "drizzle-orm";

const app = new Hono();

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

```typescript
const app = new Hono();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

## Example: Webhook Handler

```typescript
// backend/functions/stripe-webhook.ts
import { Hono } from "hono";
import Stripe from "stripe";
import { instance } from "../src/index";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = new Hono();

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

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration reference
- **[Snapshot Callbacks](/docs/collections/callbacks)** — Run logic on data changes
- **[Cron Jobs](/docs/backend/cron-jobs)** — Scheduled background tasks
