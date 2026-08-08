---
name: rebase-webhooks
description: Guide for sending outbound HTTP webhooks on entity changes in a Rebase backend. Use this skill when the user needs to notify external services on INSERT, UPDATE, or DELETE, verify HMAC signatures, understand retry/backoff behavior, or build a webhook receiver.
---

# Rebase Webhooks

> **IMPORTANT FOR AGENTS**: The `WebhookDispatcher` is a **standalone service class** exported from `@rebasepro/server`. It is **not** auto-wired into the backend init pipeline — you must instantiate it yourself and call `onEntityChange()` from your application code (e.g. collection callbacks, custom functions, or cron jobs). Do NOT look for a `webhooks` key in `RebaseBackendConfig`.

> **IMPORTANT FOR AGENTS**: Webhooks are **outbound** HTTP POST requests sent by your Rebase backend to external URLs. They are NOT inbound endpoints. To receive webhooks FROM external services, use Rebase custom functions instead (see `rebase-custom-functions` skill).

## Overview

Rebase provides a `WebhookDispatcher` class for sending HTTP webhook notifications when entities change. It handles:

- **Table + event matching** — Only dispatches to webhooks whose `table` and `events` match
- **HMAC-SHA256 signing** — Optional payload signing for receiver verification
- **Automatic retries** — Up to 3 attempts with exponential backoff (1s → 5s → 15s)
- **Custom headers** — Attach authorization tokens or other headers to outbound requests
- **10-second timeout** — Requests are aborted if the receiver doesn't respond in time
- **Multiple webhooks** — Multiple webhooks can match the same entity change

## Setup

### Import and Instantiate

```typescript
import { WebhookDispatcher } from "@rebasepro/server";
import type { WebhookConfig } from "@rebasepro/server";

const dispatcher = new WebhookDispatcher();
```

### Register Webhooks

Call `setWebhooks()` with an array of `WebhookConfig` objects. Only **enabled** webhooks are kept — disabled ones are filtered out automatically.

```typescript
dispatcher.setWebhooks([
    {
        id: "wh_orders_new",
        url: "https://my-service.com/webhooks/orders",
        secret: process.env.WEBHOOK_SECRET,
        events: ["INSERT"],
        table: "orders",
        enabled: true,
    },
    {
        id: "wh_users_all",
        url: "https://analytics.example.com/hooks/users",
        secret: "my-hmac-secret",
        headers: {
            "Authorization": "Bearer sk_live_abc123",
            "X-Source": "rebase",
        },
        events: ["INSERT", "UPDATE", "DELETE"],
        table: "users",
        enabled: true,
    },
    {
        id: "wh_disabled_example",
        url: "https://example.com/hook",
        events: ["INSERT"],
        table: "posts",
        enabled: false, // ← filtered out, never dispatched
    },
]);
```

> **WARNING FOR AGENTS**: `setWebhooks()` **replaces** the entire webhook list each time it's called. It does NOT append. Disabled webhooks (`enabled: false`) are silently dropped.

### Dispatch on Entity Changes

Call `onEntityChange()` whenever a entity is created, updated, or deleted. The dispatcher checks all registered webhooks and fires matching ones.

```typescript
const results = await dispatcher.onEntityChange(
    "orders",                          // table name
    "INSERT",                          // event type
    "order_abc123",                    // entity ID
    { id: "order_abc123", total: 99 }  // the entity record
);
```

For **UPDATE** events, pass the previous entity as the 5th argument:

```typescript
const results = await dispatcher.onEntityChange(
    "users",
    "UPDATE",
    "user_42",
    { id: "user_42", name: "Updated Name" },     // current record
    { id: "user_42", name: "Original Name" }     // previous record
);
```

For **DELETE** events, the entity may be `null`:

```typescript
const results = await dispatcher.onEntityChange(
    "orders",
    "DELETE",
    "order_abc123",
    null  // entity was deleted
);
```

## WebhookConfig Interface

```typescript
interface WebhookConfig {
    id: string;
    url: string;
    secret?: string;
    headers?: Record<string, string>;
    events: string[];
    table: string;
    enabled: boolean;
}
```

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `id` | `string` | ✅ | — | Unique identifier for this webhook. Sent in the `X-Webhook-Id` header. |
| `url` | `string` | ✅ | — | The endpoint URL that receives the POST request. |
| `secret` | `string` | ❌ | `undefined` | HMAC-SHA256 signing secret. When set, `X-Webhook-Signature` header is included. |
| `headers` | `Record<string, string>` | ❌ | `undefined` | Custom headers merged into every outbound request (e.g. `Authorization`). |
| `events` | `string[]` | ✅ | — | Event types to match. Values: `"INSERT"`, `"UPDATE"`, `"DELETE"`. |
| `table` | `string` | ✅ | — | The database table name to match against. |
| `enabled` | `boolean` | ✅ | — | Whether this webhook is active. Disabled webhooks are filtered out by `setWebhooks()`. |

## WebhookDeliveryResult Interface

Every call to `onEntityChange()` returns an array of `WebhookDeliveryResult` — one per matching webhook.

```typescript
interface WebhookDeliveryResult {
    webhookId: string;
    event: string;
    payload: Record<string, unknown>;
    statusCode: number;
    responseBody: string;
    success: boolean;
    attemptNumber: number;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `webhookId` | `string` | The `id` of the webhook that was dispatched. |
| `event` | `string` | The event type (`INSERT`, `UPDATE`, `DELETE`). |
| `payload` | `Record<string, unknown>` | The full JSON payload that was sent. |
| `statusCode` | `number` | HTTP status code from the receiver. `0` if the request failed entirely (network error, timeout). |
| `responseBody` | `string` | Response body from the receiver, **truncated to 1000 characters**. Error message if the request failed. |
| `success` | `boolean` | `true` if the final attempt returned a 2xx status code. |
| `attemptNumber` | `number` | The attempt number of the final delivery (1–3). |

## Webhook Payload Format

Every webhook sends a `POST` request with a JSON body containing:

```json
{
    "type": "INSERT",
    "table": "orders",
    "record": {
        "id": "order_abc123",
        "total": 99,
        "status": "pending"
    },
    "old_record": null,
    "schema": "public",
    "timestamp": "2025-01-15T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | The event type: `"INSERT"`, `"UPDATE"`, or `"DELETE"`. |
| `table` | `string` | The database table name where the change occurred. |
| `record` | `object \| null` | The current state of the entity. `null` for DELETE events if no entity data available. |
| `old_record` | `object \| undefined` | The previous state of the entity. **Only present for `UPDATE` events.** `undefined` for INSERT and DELETE. |
| `schema` | `string` | Always `"public"`. |
| `timestamp` | `string` | ISO 8601 timestamp of when the webhook was dispatched. |

### Payload by Event Type

| Event | `record` | `old_record` |
|-------|----------|--------------|
| `INSERT` | The newly created entity | `undefined` |
| `UPDATE` | The updated entity (new state) | The entity before the update (old state) |
| `DELETE` | The deleted entity (or `null`) | `undefined` |

## HTTP Headers

Every webhook request includes these headers:

| Header | Value | Always Present |
|--------|-------|----------------|
| `Content-Type` | `application/json` | ✅ |
| `X-Webhook-Id` | The webhook's `id` (e.g. `wh_orders_new`) | ✅ |
| `X-Webhook-Event` | The event type (`INSERT`, `UPDATE`, `DELETE`) | ✅ |
| `X-Webhook-Delivery` | A unique UUID for this specific delivery attempt | ✅ |
| `X-Webhook-Attempt` | The attempt number (`"1"`, `"2"`, or `"3"`) | ✅ |
| `X-Webhook-Signature` | HMAC-SHA256 signature (e.g. `sha256=abc123...`) | Only when `secret` is set |
| *(custom headers)* | Values from `headers` config | Only when `headers` is set |

> **IMPORTANT FOR AGENTS**: Custom headers from the `headers` config are **merged after** the standard headers. This means custom headers can **override** built-in headers like `Content-Type` if the same key is used.

## HMAC Signature Verification

When a webhook has a `secret` configured, every request includes an `X-Webhook-Signature` header containing an HMAC-SHA256 signature of the raw JSON body.

### How Signing Works

1. The payload is serialized to JSON: `JSON.stringify(payload)`
2. An HMAC is computed: `createHmac("sha256", secret).update(body).digest("hex")`
3. The signature is sent as: `sha256=<hex_digest>`

### Verifying Signatures (Receiver Side)

> **IMPORTANT FOR AGENTS**: Always use **timing-safe comparison** (`timingSafeEqual`) when verifying HMAC signatures to prevent timing attacks. Never use `===` for signature comparison.

#### Node.js / Express Example

```typescript
import { createHmac, timingSafeEqual } from "crypto";
import express from "express";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

function verifyWebhookSignature(
    body: string,
    signatureHeader: string,
    secret: string
): boolean {
    const expectedSig = createHmac("sha256", secret)
        .update(body)
        .digest("hex");
    const expected = `sha256=${expectedSig}`;

    if (signatureHeader.length !== expected.length) return false;

    return timingSafeEqual(
        Buffer.from(signatureHeader),
        Buffer.from(expected)
    );
}

const app = express();

// IMPORTANT: Use raw body for signature verification
app.post("/webhooks/rebase", express.raw({ type: "application/json" }), (req, res) => {
    const signature = req.headers["x-webhook-signature"] as string;
    const rawBody = req.body.toString("utf-8");

    if (!signature || !verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
        return res.status(401).json({ error: "Invalid signature" });
    }

    const payload = JSON.parse(rawBody);

    console.log(`Received ${payload.type} on ${payload.table}`, payload.record);

    // Process the webhook...
    res.status(200).json({ received: true });
});
```

#### Rebase Custom Function Receiver

Author it with `defineFunction`, which hands you a typed `Hono` app and the
`rebase` singleton. Mount no auth middleware on this route — external services
need to reach it, and the HMAC check *is* the authentication.

```typescript
// backend/functions/webhook-receiver.ts
import { defineFunction } from "@rebasepro/server";
import { createHmac, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.EXTERNAL_WEBHOOK_SECRET!;

export default defineFunction((app, { rebase }) => {
    // No requireAuth here — the signature below is what authenticates the caller.
    app.post("/incoming-webhook", async (c) => {
        const signature = c.req.header("x-webhook-signature");
        const rawBody = await c.req.text();

        if (!signature) return c.json({ error: "Missing signature" }, 401);

        const expected = `sha256=${createHmac("sha256", WEBHOOK_SECRET)
            .update(rawBody)
            .digest("hex")}`;

        // Compare lengths first: timingSafeEqual throws on a length mismatch.
        if (
            signature.length !== expected.length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
            return c.json({ error: "Invalid signature" }, 401);
        }

        const payload = JSON.parse(rawBody);
        void payload; // Process it — `rebase.dataAsAdmin` is available here.

        return c.json({ received: true });
    });
});
```

The route is served at `/api/functions/webhook-receiver/incoming-webhook` — the
file name is the mount point.

## Retry Logic

The `WebhookDispatcher` automatically retries failed deliveries with **exponential backoff**.

### Retry Behavior

| Attempt | Delay Before | Total Elapsed |
|---------|-------------|---------------|
| 1 | — (immediate) | 0s |
| 2 | 1,000 ms (1s) | ~1s |
| 3 | 5,000 ms (5s) | ~6s |

- **Max retries:** 3 attempts total
- **Backoff delays:** `[1000, 5000, 15000]` ms (the 15s delay is defined but never used since the 3rd attempt is the last)
- A delivery is **successful** if the HTTP response status code is `>= 200 && < 300`
- A delivery **fails** if the status code is outside 2xx range OR if a network/timeout error occurs
- If any attempt succeeds, retries stop immediately and the successful result is returned
- If all 3 attempts fail, the result from the **last attempt** is returned

### What Triggers a Retry

| Scenario | Retries? |
|----------|----------|
| HTTP 2xx response | ❌ No — success, stop immediately |
| HTTP 4xx response (e.g. 400, 404) | ✅ Yes — retries up to max |
| HTTP 5xx response (e.g. 500, 502) | ✅ Yes — retries up to max |
| Network error (DNS failure, connection refused) | ✅ Yes — `statusCode: 0` |
| Request timeout (>10 seconds) | ✅ Yes — `statusCode: 0`, `AbortError` |

> **WARNING FOR AGENTS**: The dispatcher retries on **all** non-2xx status codes, including 4xx client errors. There is no distinction between retryable and non-retryable HTTP errors. If the receiver returns 400 Bad Request, the dispatcher will still retry twice more.

### Timeout

Each individual delivery attempt has a **10-second timeout** enforced via `AbortController`:

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000); // 10s
```

If the receiver does not respond within 10 seconds, the request is aborted and treated as a failure (triggering a retry if attempts remain).

## Integration Patterns

### With Collection Callbacks

The most common pattern is to wire the dispatcher into Rebase collection callbacks so webhooks fire automatically on CRUD operations:

```typescript
// config/collections/orders.ts
import type { PostgresCollectionConfig, CollectionCallbacks } from "@rebasepro/types";
import { WebhookDispatcher } from "@rebasepro/server";

const dispatcher = new WebhookDispatcher();
dispatcher.setWebhooks([
    {
        id: "wh_orders",
        url: process.env.ORDERS_WEBHOOK_URL!,
        secret: process.env.ORDERS_WEBHOOK_SECRET,
        events: ["INSERT", "UPDATE", "DELETE"],
        table: "orders",
        enabled: true,
    },
]);

const callbacks: CollectionCallbacks = {
    afterSave: async ({ id, values, previousValues, status, collection }) => {
        const event = status === "new" ? "INSERT" : "UPDATE";
        await dispatcher.onEntityChange(
            collection.slug,
            event,
            String(id),
            values,
            status === "new" ? undefined : previousValues
        );
    },
    afterDelete: async ({ id, collection }) => {
        await dispatcher.onEntityChange(
            collection.slug,
            "DELETE",
            String(id),
            null
        );
    },
};

const ordersCollection: PostgresCollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    callbacks,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        // ... the rest of the columns
    },
};

export default ordersCollection;
```

### With Custom Functions (Manual Dispatch)

Trigger webhooks from a custom function endpoint:

```typescript
// backend/functions/process-payment.ts
import { defineFunction } from "@rebasepro/server";
import { WebhookDispatcher } from "@rebasepro/server";

const dispatcher = new WebhookDispatcher();
dispatcher.setWebhooks([
    {
        id: "wh_payments",
        url: "https://accounting.example.com/hooks/payments",
        secret: process.env.PAYMENT_WEBHOOK_SECRET,
        events: ["INSERT"],
        table: "payments",
        enabled: true,
    },
]);

export default defineFunction((app, { rebase }) => {
    app.post("/process-payment", async (c) => {
        const { orderId, amount } = await c.req.json();

        // Create the payment record
        const payment = await rebase.dataAsAdmin
            .collection<{ id: string; orderId: string; amount: number; status: string }>("payments")
            .create({
            orderId,
            amount,
            status: "completed"
        });

        // Manually dispatch the webhook
        const results = await dispatcher.onEntityChange(
            "payments",
            "INSERT",
            payment.id,
            payment
        );

        return c.json({
            payment,
            webhooksDelivered: results.length,
            webhooksSucceeded: results.every(r => r.success)
        });
    });
});
```

### Shared Dispatcher Instance

For applications with many collections, create a single shared dispatcher:

```typescript
// backend/lib/webhooks.ts
import { WebhookDispatcher } from "@rebasepro/server";
import type { WebhookConfig } from "@rebasepro/server";

const dispatcher = new WebhookDispatcher();

// Load webhook configs from environment or database
const webhooks: WebhookConfig[] = [
    {
        id: "wh_orders",
        url: process.env.ORDERS_WEBHOOK_URL!,
        secret: process.env.WEBHOOK_SECRET,
        events: ["INSERT", "UPDATE", "DELETE"],
        table: "orders",
        enabled: !!process.env.ORDERS_WEBHOOK_URL,
    },
    {
        id: "wh_users",
        url: process.env.USERS_WEBHOOK_URL!,
        secret: process.env.WEBHOOK_SECRET,
        events: ["INSERT", "UPDATE"],
        table: "users",
        enabled: !!process.env.USERS_WEBHOOK_URL,
    },
    {
        id: "wh_analytics",
        url: "https://analytics.example.com/ingest",
        events: ["INSERT", "UPDATE", "DELETE"],
        table: "orders",
        headers: { "Authorization": `Bearer ${process.env.ANALYTICS_API_KEY}` },
        enabled: true,
    },
];

dispatcher.setWebhooks(webhooks);

export { dispatcher };
```

Then import it from any callback or function:

```typescript
import { dispatcher } from "../lib/webhooks";

// In a collection callback:
afterSave: async ({ id, values, status, collection }) => {
    if (status === "new") {
        await dispatcher.onEntityChange(collection.slug, "INSERT", String(id), values);
    }
},
```

## WebhookDispatcher API Reference

### `setWebhooks(webhooks: WebhookConfig[]): void`

Registers the list of webhooks to watch. Filters out any with `enabled: false`. **Replaces** the entire list — not additive.

| Parameter | Type | Description |
|-----------|------|-------------|
| `webhooks` | `WebhookConfig[]` | Array of webhook configurations. |

### `onEntityChange(table, event, id, entity, previousEntity?): Promise<WebhookDeliveryResult[]>`

Checks all registered webhooks for matching `table` + `event`, and dispatches to each match.

| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | `string` | The database table name (e.g. `"orders"`). |
| `event` | `"INSERT" \| "UPDATE" \| "DELETE"` | The type of entity change. |
| `id` | `string` | The unique ID of the changed entity. |
| `entity` | `Record<string, unknown> \| null` | The current entity data. May be `null` for deletes. |
| `previousEntity` | `Record<string, unknown> \| null` | *(Optional)* The previous entity state. Only relevant for `UPDATE` events — included as `old_record` in the payload. |

**Returns:** `Promise<WebhookDeliveryResult[]>` — One result per matching webhook. Empty array if no webhooks match.

## Event Types

The dispatcher supports three event types, passed as the `event` parameter to `onEntityChange()`:

| Event | When to Use | `record` Contains | `old_record` Contains |
|-------|-------------|--------------------|-----------------------|
| `INSERT` | A new entity was created | The new entity | `undefined` |
| `UPDATE` | An existing entity was modified | The updated entity | The entity before update |
| `DELETE` | a entity was removed | The deleted entity (or `null`) | `undefined` |

## Error Handling

### Checking Delivery Results

```typescript
const results = await dispatcher.onEntityChange("orders", "INSERT", id, entity);

for (const result of results) {
    if (!result.success) {
        console.error(
            `Webhook ${result.webhookId} failed after ${result.attemptNumber} attempts. ` +
            `Status: ${result.statusCode}, Body: ${result.responseBody}`
        );
    }
}
```

### Failure Scenarios

| Scenario | `statusCode` | `responseBody` | `success` |
|----------|-------------|----------------|-----------|
| Receiver returns 200 | `200` | Response text (truncated to 1000 chars) | `true` |
| Receiver returns 500 | `500` | `"Internal Server Error"` | `false` |
| DNS resolution failure | `0` | `"getaddrinfo ENOTFOUND ..."` | `false` |
| Connection refused | `0` | `"connect ECONNREFUSED ..."` | `false` |
| 10s timeout exceeded | `0` | `"The operation was aborted"` | `false` |
| Network error | `0` | Error message (truncated to 1000 chars) | `false` |

### Non-Blocking Pattern

If you don't want webhook delivery to block your API response, use fire-and-forget:

```typescript
afterSave: async ({ id, values, collection }) => {
    // Fire-and-forget — don't await
    dispatcher.onEntityChange(collection.slug, "INSERT", String(id), values)
        .catch(err => console.error("Webhook dispatch error:", err));
},
```

## Edge Cases and Gotchas

| Scenario | Behavior |
|----------|----------|
| **No webhooks match the table/event** | Returns empty array `[]` immediately. No HTTP requests made. |
| **Webhook URL is unreachable** | Retries 3 times with backoff (1s, 5s delays). Final result has `statusCode: 0`. |
| **Receiver returns 4xx (e.g. 400, 404)** | Treated as failure and retried (no distinction between 4xx and 5xx). |
| **Receiver takes >10 seconds** | Request aborted via `AbortController`. Treated as failure, retried. |
| **Multiple webhooks match same event** | All matching webhooks are dispatched **sequentially** (not in parallel). |
| **Disabled webhook in `setWebhooks()`** | Silently filtered out. Never dispatched. |
| **`setWebhooks()` called multiple times** | Replaces the entire list each time. Previous webhooks are discarded. |
| **`secret` is not set** | No `X-Webhook-Signature` header is sent. Payload is not signed. |
| **Custom header conflicts with built-in** | Custom headers override built-in headers (they are spread after). |
| **Response body very large** | Truncated to **1000 characters** in the `WebhookDeliveryResult`. |
| **`entity` is `null` for DELETE** | Sent as `"record": null` in the payload. |
| **`previousEntity` not passed for UPDATE** | `old_record` is `undefined` (omitted from JSON). |
| **`onEntityChange` is async** | The entire retry sequence is awaited. For INSERT with 3 failed attempts: ~6s of waiting. |

## References

- **Documentation:** [rebase.pro/docs/recipes/webhooks](https://rebase.pro/docs/recipes/webhooks)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
