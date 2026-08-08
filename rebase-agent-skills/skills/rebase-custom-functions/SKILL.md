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

## Setup

Enable custom functions by adding `functionsDir` to your backend config:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),  // ← add this
});
```

## Creating a Function

Each file default-exports a Hono app:

```typescript
// backend/functions/send-invoice.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const { orderId, email } = await c.req.json();

    // Your custom logic here — send email, call Stripe, generate PDF, etc.
    console.log(`Sending invoice for order ${orderId} to ${email}`);

    return c.json({ success: true, message: `Invoice sent to ${email}` });
});

app.get("/status/:id", async (c) => {
    const id = c.req.param("id");
    return c.json({ invoiceId: id, status: "sent" });
});

export default app;
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
import type { HonoEnv } from "@rebasepro/server";

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

## Accessing Auth & Services

Custom functions run within the Hono middleware chain, so you have access to auth context:

```typescript
// backend/functions/admin-export.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", async (c) => {
    // Access the authenticated user from middleware
    const user = c.get("user");
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Access the data driver to query collections.
    // fetchCollection takes ONE object; the collection goes in `path`.
    const driver = c.get("driver");
    const entities = await driver.fetchCollection({
        path: "products",
        limit: 1000,
        orderBy: "created_at",
        order: "desc"
    });

    return c.json({ data: entities });
});

export default app;
```

### Use the `rebase` singleton for platform services — not raw SDKs

> **🚨 CRITICAL FOR AGENTS:** For data, storage, auth, and email inside a
> function/hook/job, use the configured platform services on the **`rebase`**
> singleton. **Never** import a cloud provider SDK directly to reimplement what
> the platform already provides.

```typescript
import { rebase } from "@rebasepro/server";

await rebase.dataAsAdmin.collection<Record<string, unknown>>("orders").find({ where: { status: ["==", "paid"] } });
await rebase.storage.putObject({ key, file });   // → storageUrl (gs://|s3://|local://)
await rebase.email.send({ to, subject, html: "<p>Thanks for your order.</p>" });
```

| Need | ✅ Use | ❌ Never import directly |
|------|--------|--------------------------|
| Object storage | `rebase.storage` (see **rebase-storage** skill) | `@aws-sdk/client-s3`, `@google-cloud/storage` |
| Database / collections | `rebase.dataAsAdmin` (or `c.get("driver")`) | `pg`, `drizzle` clients by hand |
| Email | `rebase.email` | `nodemailer`, provider SDKs |
| Auth / users | `rebase.auth` / `c.get("user")` | custom JWT parsing |

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
> app.get("/sensitive-data", async (c) => {
>     const user = c.get("user");
>     const isInternal = user?.uid === "service" || user?.roles?.includes("admin");
>     // Return full or masked data based on identity
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
- Each file's default export must be a Hono app or a factory returning one
- The loader uses duck-typing (`fetch()` + `routes` array) — any Hono-compatible instance works

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
