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

```typescript
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

const app = new Hono();

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

export default function () {
    const app = new Hono();

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
import type { HonoEnv } from "@rebasepro/server-core";

const app = new Hono<HonoEnv>();

app.get("/", async (c) => {
    // Access the authenticated user from middleware
    const user = c.get("user");
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Access the data driver to query collections
    const driver = c.get("driver");
    const entities = await driver.fetchCollection("products", {
        limit: 1000,
        orderBy: "created_at",
        order: "desc"
    });

    return c.json({ data: entities });
});

export default app;
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
