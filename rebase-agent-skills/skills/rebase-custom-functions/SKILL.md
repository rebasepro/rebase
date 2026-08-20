---
name: rebase-custom-functions
description: Guide for adding custom API endpoints to a Rebase backend using the file-based function discovery pattern. Use this skill when the user needs a custom endpoint, webhook handler, payment callback, PDF generator, or any server-side route beyond auto-generated CRUD.
---

# Custom API Functions

> **IMPORTANT FOR AGENTS**: Rebase supports **auto-discovered custom Hono routes** via the `functionsDir` config option. **Do NOT** modify the main Hono `app` instance or create standalone Express/Fastify servers. Instead, drop a TypeScript file in the `functions/` directory and Rebase will auto-mount it.

## Overview

Custom functions let you add arbitrary HTTP endpoints to your Rebase backend. They follow the same **file-based discovery** pattern as collections and cron jobs:

1. Create a TypeScript file in your `backend/functions/` directory
2. Default-export a **Hono app** (or a factory function that returns one)
3. Rebase auto-mounts it at `/api/functions/{filename}`

> **🚨 IMPORT PATH — ALWAYS `@rebasepro/server/functions`, NEVER `@rebasepro/server`.**
> Inside `backend/functions/` use the `/functions` subpath. It is the portable
> authoring surface — it pulls in nothing that requires Node, so the function can
> run on any JavaScript runtime — and it carries typed context accessors
> (`getUser`, `getDriver`) so you never cast `c.get("user")`. The package root
> reaches the entire framework and is for a server entrypoint, not a route
> handler. Both work today; only one of them still works later.

## Setup

Enable custom functions by adding `functionsDir` to your backend config:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),  // ← add this
});
```

## Creating a Function

Use `defineFunction` — it gives you a pre-typed Hono app plus the `rebase`
singleton, and returns exactly the app a hand-written `new Hono<HonoEnv>()`
would:

```typescript
// backend/functions/send-invoice.ts
import { defineFunction, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", requireAuth, async (c) => {
        const { orderId, email } = await c.req.json();

        await rebase.email.send({
            to: email,
            subject: `Invoice for order ${orderId}`,
            html: "<p>Thanks for your order.</p>"
        });

        return c.json({ success: true, message: `Invoice sent to ${email}` });
    });

    app.get("/status/:id", requireAuth, (c) => {
        return c.json({ invoiceId: c.req.param("id"), status: "sent" });
    });
});
```

This auto-mounts as:
- `POST /api/functions/send-invoice`
- `GET /api/functions/send-invoice/status/:id`

The **filename** (without extension) becomes the route prefix.

## Factory Pattern

You can also export a factory function:

```typescript
// backend/functions/webhooks.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();

    app.post("/stripe", async (c) => {
        const body = await c.req.text();
        // Verify Stripe signature, process event
        return c.json({ received: true });
    });

    app.post("/github", async (c) => {
        const payload = await c.req.json();
        // Process GitHub webhook
        return c.json({ received: true });
    });

    return app;
}
```

## Guarding Routes

> **🚨 CRITICAL FOR AGENTS: functions are PUBLIC by default.** The router parses
> the caller's token and puts the result in the context, but does not reject
> anonymous requests — webhook receivers have no token to send. Reading
> `getUser(c)` is **not** a check: an anonymous caller gets `undefined` and the
> handler runs anyway. Every route needs a deliberate decision.

```typescript
// backend/functions/admin-export.ts
import {
    defineFunction, requireAuth, requireAdmin, requireRole, requireDriver
} from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 401 for anonymous callers.
    app.get("/mine", requireAuth, async (c) => {
        // The request-scoped driver runs as the CALLER: RLS applies to them.
        // fetchCollection takes ONE object; the collection goes in `path`.
        const rows = await requireDriver(c).fetchCollection({
            path: "products",
            limit: 1000
        });
        return c.json({ data: rows });
    });

    // 401 anonymous, then 403 without an administrative role. Order matters.
    app.get("/", requireAuth, requireAdmin, async (c) => {
        return c.json({ data: await requireDriver(c).fetchCollection({ path: "products" }) });
    });

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Put guards in the **route's own middleware slot**, as above — not
`app.use("/*", requireAuth)`. `use()` covers only routes declared *below* it, so
a route appended later at the bottom of the file is silently unprotected.

## Reading the caller

Use the typed accessors, never a cast:

```typescript
import { defineFunction, getUser, getUserId, getRoles, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);            // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: getUserId(c), roles: getRoles(c), admin: isAdmin(c) });
    });
});
```

`getUser` narrows whatever the middleware resolved: `uid` is a string, `roles` is
always an array. `getDriver(c)` / `requireDriver(c)` return the caller-scoped
driver; `getApiKey(c)` and `getRequestId(c)` are there too.

## Configuration — never at module scope

> **🚨 CRITICAL FOR AGENTS: never write `process.env.X` at the top of a function
> file.** It is evaluated when the file is *imported*. If the variable is unset,
> the import throws and the loader reports the whole file as a **skipped
> function** — the route 404s with the reason buried in a boot log. Read
> configuration inside the handler.

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Built once, on first use — not at import time.
const apiKey = lazyResource((env) => env.PRICING_API_KEY ?? "");

export default defineFunction((app) => {
    app.get("/price", async (c) => {
        const endpoint = requireEnv(c, "PRICING_API_URL");   // throws naming the variable
        const response = await fetch(endpoint, {
            headers: { authorization: `Bearer ${apiKey(c)}` }
        });
        return c.json(await response.json());
    });
});
```

`getEnv(c)` returns the whole bag; `env(c, "NAME")` one value (trimmed, blank =
unset). `rebase doctor` reports module-scope reads.

## Work that outlives the response

> **🚨 CRITICAL FOR AGENTS: do not leave a floating promise.** Use
> `waitUntil(c, promise)`. A floating promise is dropped when the process shuts
> down mid-deploy; `waitUntil` is what a graceful shutdown waits for, and what an
> isolate-based host needs to keep the isolate alive past the response.

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: `Order ${order.id}`,
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });   // caller does not wait
    });
});
```

### Use the `rebase` singleton for platform services — not raw SDKs

> **🚨 CRITICAL FOR AGENTS:** For data, storage, auth, and email inside a
> function/hook/job, use the configured platform services on the **`rebase`**
> singleton. **Never** import a cloud provider SDK directly to reimplement what
> the platform already provides.

```typescript
import { rebase } from "@rebasepro/server/functions";

await rebase.dataAsAdmin.collection<Record<string, unknown>>("orders").find({ where: { status: ["==", "paid"] } });
await rebase.storage.putObject({ key, file });   // → storageUrl (gs://|s3://|local://)
await rebase.email.send({ to, subject, html: "<p>Thanks for your order.</p>" });
```

| Need | ✅ Use | ❌ Never import directly |
|------|--------|--------------------------|
| Object storage | `rebase.storage` (see **rebase-storage** skill) | `@aws-sdk/client-s3`, `@google-cloud/storage` |
| Database / collections | `rebase.dataAsAdmin` (or `requireDriver(c)`) | `pg`, `drizzle` clients by hand |
| Email | `rebase.email` | `nodemailer`, provider SDKs |
| Auth / users | `rebase.auth` / `getUser(c)` | custom JWT parsing |

Importing a provider SDK hardcodes one backend, bypasses the app's config
(`STORAGE_TYPE`, `DATABASE_URL`, SMTP, …), and defeats the point of the platform.
The only code that touches provider SDKs is the adapters **inside**
`@rebasepro/server`.

### Reserved Identity Values in `c.get("user")`

The `user` object set by the auth middleware uses reserved values for system identities:

| Auth Method | `user.uid` | `user.roles` |
|---|---|---|
| JWT (end-user) | Real user ID | User's assigned roles |
| Service Key | `"service"` | `["admin"]` |
| API Key (default) | `"api-key:{id}"` | `["service"]` |
| API Key (admin) | `"api-key:{id}"` | `["admin", "service"]` |
| Anonymous | `"anon"` | `["anon"]` |

> **TIP:** Use these to differentiate internal vs. external callers in your custom functions:
> ```typescript
> app.get("/sensitive-data", requireAuth, (c) => {
>     const isInternal = getUserId(c) === "service" || isAdmin(c);
>     // Return full or masked data based on identity
>     return c.json({ full: isInternal });
> });
> ```

## Invoking Functions from the Frontend

> **CRITICAL FOR AGENTS**: When calling custom backend functions from the frontend, **ALWAYS** use `client.functions.invoke()`. **NEVER** use raw `fetch()`, manually construct URLs, or manually extract auth tokens from `localStorage`. The SDK handles all of this automatically.

The `@rebasepro/client` SDK provides a `functions` namespace that handles:
- **Automatic routing** — appends `/api/functions/{name}` to the client's configured `baseUrl`
- **Automatic authentication** — injects the current session's JWT into the `Authorization: Bearer` header
- **Standardized errors** — throws `RebaseApiError` on non-2xx responses, matching the behavior of collection methods
- **401 retry** — automatically attempts token refresh on unauthorized responses

### Basic Usage

```typescript
// Invoke a function by name — auth token is injected automatically
const result = await client.functions.invoke<{ job: JobData }>('extract-job', {
    url: 'https://example.com/job-posting',
    html: htmlContent,
});
console.log(result.job.title);
```

### With Options

```typescript
// Custom HTTP method
const status = await client.functions.invoke<{ status: string }>('send-invoice', undefined, {
    method: 'GET',
    path: `status/${invoiceId}`,
});

// DELETE request
await client.functions.invoke('cleanup', { olderThan: '30d' }, {
    method: 'DELETE',
});
```

### TypeScript Generics

Use the generic type parameter to get full type safety on the response:

```typescript
interface ExtractResult {
    job: {
        title: string;
        company_name: string;
        description_md: string;
    };
}

const result = await client.functions.invoke<ExtractResult>('extract-job', { url });
// result.job.title is typed as string
```

### Error Handling

Errors follow the same pattern as collection methods:

```typescript
import { RebaseApiError } from '@rebasepro/client';

try {
    const result = await client.functions.invoke('process-payment', { orderId });
} catch (err) {
    if (err instanceof RebaseApiError) {
        console.error(`Status ${err.status}: ${err.message}`);
        // err.code and err.details are also available
    }
}
```

### ❌ Anti-Pattern — Do NOT Do This

```typescript
// WRONG: Manual fetch with manual URL and manual token extraction
const token = JSON.parse(localStorage.getItem('rebase_auth') || '{}').accessToken;
const res = await fetch(`${apiUrl}/api/functions/extract-job`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ url }),
});
```

### ✅ Correct Pattern

```typescript
// RIGHT: SDK handles URL, auth, Content-Type, and error handling
const result = await client.functions.invoke('extract-job', { url });
```

## Common Use Cases

- **Webhook handlers** — Stripe, GitHub, Slack, Twilio incoming webhooks
- **Payment processing** — Custom checkout or subscription logic
- **PDF/report generation** — Server-side document rendering
- **Third-party API integrations** — Proxy or aggregate external APIs
- **Custom auth flows** — Magic links, phone verification, SSO
- **Data export** — CSV/Excel downloads of collection data
- **Health checks** — Custom readiness/liveness probes

## File Discovery Rules

- Files must be `.ts` or `.js` (not `.d.ts`, not `.test.*`)
- `index.ts` / `index.js` are ignored
- **Top level only** — `functions/admin/users.ts` is compiled but never mounted. Flatten it (`admin-users.ts`)
- Each file's default export must be a Hono app or a factory returning one
- The loader uses duck-typing (`fetch()` + `routes` array) — any Hono-compatible instance works

## Runtime Portability

A function is a Hono app, and Hono runs everywhere. What pins a function to a
Node process is only what its own file imports and touches. None of this is a
restriction on what you may write — every deployment today is Node — but an
agent writing a new function should default to the portable choice, because it
costs nothing and cannot be retrofitted cheaply.

**Portable:** everything from `@rebasepro/server/functions`; `requireDriver(c)`
and `rebase.dataAsAdmin`; `rebase.auth`/`storage`/`email`; `fetch`, `URL`,
`crypto.subtle`, `TextEncoder`.

**Node-only:** `rebase.sql()` (owner TCP connection); a directly imported
`pg`/`drizzle-orm`/`mongodb` client; Node built-ins (`fs`, `path`, `node:crypto`,
`child_process`); packages built on them (`jsonwebtoken`, `nodemailer`, `sharp`,
`bcrypt`).

**Bugs on every runtime:** `process.env` at module scope; floating promises
instead of `waitUntil`; relying on a handler continuing after its request timed
out.

`runtimeKey()` / `isNodeRuntime()` let a function degrade rather than fail.
`rebase build` records a per-function verdict in the bundle manifest and
`rebase doctor` reports it without building.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
