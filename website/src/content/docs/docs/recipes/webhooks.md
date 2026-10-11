---
title: "Recipe: Webhook Integration"
sidebar_label: Webhooks
description: Use entity callbacks to send webhooks to external services when data changes, without holding the write's transaction open.
---

## Overview

Use `afterSave` and `afterDelete` callbacks to notify external services when data changes in Rebase.

Two things about those callbacks decide how this recipe is written, and neither is optional:

- **They run inside the write's database transaction.** Anything you `await` there holds a pooled
  connection and the row's locks until it comes back. A receiver that takes ten seconds is a
  ten-second transaction; a receiver that never answers is a transaction that never ends.
- **A throw from `afterSave` rolls the write back.** The error reaches the caller as a 500 and the
  row is not saved. Awaiting a third party inside the callback makes their outage your data loss.

So: never `await` an outbound HTTP request in a callback. Queue it.

## Slack Notification on New Order

`WebhookDispatcher` is exported from `@rebasepro/server`. `enqueueEntityChange` returns
immediately — the POST happens once the write commits, never for one that rolls back — and the
dispatcher validates the destination, signs the payload, bounds every attempt with a deadline and
retries failures.

Give it the backend's job queue and each delivery becomes a row in `rebase.jobs`: it survives a
deploy or a crash, it is retried with backoff by whichever instance's worker claims it, and a
receiver that is down for a day costs rows, not memory. Turn the queue on with
`jobs: { enabled: true }` in `initializeRebaseBackend`, and wire the dispatcher once it has
returned:

```typescript
import {
    WebhookDispatcher,
    WEBHOOK_DELIVERY_TASK,
    type QueuedWebhookDelivery,
    type RebaseBackendInstance
} from "@rebasepro/server";

// Call once, with what `initializeRebaseBackend({ …, jobs: { enabled: true } })` returned.
export function sendOrderWebhooks(backend: RebaseBackendInstance): void {
    const dispatcher = new WebhookDispatcher({
        // Each delivery is a job: kept across deploys, retried by the queue.
        jobQueue: backend.jobQueue,
        // Queued deliveries return nothing to the caller, so this is where their
        // failures surface. Without it, a receiver that has been down for a week
        // looks exactly like one that is working.
        onDelivery: (result) => {
            if (!result.success) {
                console.error(`Webhook ${result.webhookId} failed: ${result.statusCode} ${result.responseBody}`);
            }
        }
    });

    dispatcher.setWebhooks([
        {
            id: "wh_orders_slack",
            url: process.env.SLACK_WEBHOOK_URL!,
            secret: process.env.WEBHOOK_SECRET,
            events: ["INSERT"],
            table: "orders",
            enabled: true
        }
    ]);

    // The worker side: one attempt per job, and the queue's retries. Passing
    // `ctx` lets each attempt send its real `X-Webhook-Attempt`.
    backend.jobQueue?.register<QueuedWebhookDelivery>(WEBHOOK_DELIVERY_TASK, (ctx) => dispatcher.deliverQueuedJob(ctx.payload, ctx));

    backend.setCollectionCallbacks("orders", {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                // Returns void, immediately. The job is written after the
                // write commits, so the transaction is not waiting on it.
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    });
}
```

Only the webhook's id is stored on the job, so its signing secret never sits in `rebase.jobs`. A
destination the dispatcher refuses, or a receiver that answers with a redirect, is dead-lettered
after one attempt with the reason; anything else is retried like any job. See
[Durable webhooks](/docs/backend/jobs#durable-webhooks).

### Without a job queue

Leave out `jobQueue` — or run on a driver with no SQL, where the backend has none — and the
deliveries are queued in memory, in the process that made the change. That is simpler, and it is
enough for a notification you can afford to lose:

```typescript
import { WebhookDispatcher, type RebaseBackendInstance } from "@rebasepro/server";

// Server-only, like the version above: call it with what `initializeRebaseBackend` returned.
export function sendOrderWebhooks(backend: RebaseBackendInstance): void {
    const dispatcher = new WebhookDispatcher({
        onDelivery: (result) => {
            if (!result.success) {
                console.error(`Webhook ${result.webhookId} failed: ${result.statusCode} ${result.responseBody}`);
            }
        }
    });

    dispatcher.setWebhooks([
        {
            id: "wh_orders_slack",
            url: process.env.SLACK_WEBHOOK_URL!,
            secret: process.env.WEBHOOK_SECRET,
            events: ["INSERT"],
            table: "orders",
            enabled: true
        }
    ]);

    backend.setCollectionCallbacks("orders", {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    });
}
```

Keep the dispatcher out of the collection file itself. A collection file is also bundled into the
admin, in the browser: the build strips its callbacks, but a dispatcher built at the top of the file
and its `@rebasepro/server` import would ship to every visitor, and fail the admin build.

A crash or a deploy between the commit and the delivery drops the event. Each webhook has its own
queue, so a receiver that is down delays only its own deliveries, never another webhook's.
<span class="since-badge" data-since="0.25">Since 0.25</span> Each webhook's queue holds at most
10,000 deliveries waiting; while it is full, a new delivery is refused and reported to `onDelivery`
with `success: false`, `statusCode: 0`, `attemptNumber: 0` and `responseBody: "queue full"`, and
the server log says so once. Call `await dispatcher.flush(10_000)` on shutdown: it waits for what
is queued and resolves `false` if the budget runs out first, because a receiver that is down can
hold each of its deliveries for up to ~36 seconds of retries.

### What the receiver gets

Every delivery is a `POST` with a JSON body and these headers:

| Header | Value |
| --- | --- |
| `X-Webhook-Id` | The webhook's `id` |
| `X-Webhook-Event` | `INSERT`, `UPDATE` or `DELETE` |
| `X-Webhook-Delivery` | One id per delivery, the same on every attempt at it |
| `X-Webhook-Attempt` | Which attempt this is, from `1` |
| `X-Webhook-Signature` | `sha256=` and the hex HMAC-SHA256 of the raw body, keyed with the webhook's `secret` (only when it has one) |

Deliveries are at-least-once: a receiver that answered too slowly, or a worker that died after the
`POST`, means the same delivery arrives again. Deduplicate on `X-Webhook-Delivery`, and check the
signature over the body exactly as it arrived — before parsing it:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Calling an endpoint directly

If you are posting a hand-built body to one endpoint and do not want the dispatcher, the same two
rules still apply — bound the request, and never let its failure reach the caller:

```typescript
import type { CollectionCallbacks } from "@rebasepro/types";

type Order = { customer_name: string; total: number };

const callbacks: CollectionCallbacks<Order> = {
    afterSave: async ({ values, id, status }) => {
        if (status !== "new") return;
        // No `await`: the transaction must not wait for Slack. `AbortSignal.timeout`
        // because `fetch` has no default timeout at all — without it a black-holed
        // connection holds the transaction until the OS gives up, minutes later.
        void fetch(process.env.SLACK_WEBHOOK_URL!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: `New order #${id}\nCustomer: ${values.customer_name}\nTotal: $${values.total}`
            }),
            signal: AbortSignal.timeout(10_000)
        }).catch((error) => {
            // Swallowed on purpose. A throw here would be an unhandled rejection;
            // a throw *inside* the callback would roll the order back.
            console.error("Slack notification failed", error);
        });
    }
};
```

Never put a URL that came from your database into a bare `fetch`. The dispatcher rejects loopback,
link-local, private and non-`http(s)` destinations before it connects, and refuses to follow
redirects, precisely because a stored URL is attacker-controlled input.
<span class="since-badge" data-since="0.25">Since 0.25</span> On Node it judges the address each
connection is actually made to, inside the connection's own DNS lookup, so a name whose record
changes between a check and the connection cannot slip past it; a receiver's name is resolved
once per connection, not once per delivery.

## Sync to External API

`afterDelete` receives the deleted row flat, as `row` — the table's columns, not an entity wrapper.

```typescript
import type { CollectionCallbacks } from "@rebasepro/types";

type Product = { name: string; description: string; price: number; shopify_id: string };

const syncQueue: Promise<unknown>[] = [];

const callbacks: CollectionCallbacks<Product> = {
    afterSave: async ({ values, id }) => {
        // Queued, not awaited: Shopify being down must not fail the save.
        syncQueue.push(
            fetch("https://your-shop.myshopify.com/admin/api/2024-01/products.json", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN!
                },
                body: JSON.stringify({
                    product: {
                        id: values.shopify_id,
                        title: values.name,
                        body_html: values.description,
                        variants: [{ price: values.price }]
                    }
                }),
                signal: AbortSignal.timeout(10_000)
            }).catch((error) => console.error(`Shopify sync failed for ${id}`, error))
        );
    },

    afterDelete: async ({ row }) => {
        const shopifyId = row.shopify_id;
        if (!shopifyId) return;
        syncQueue.push(
            fetch(
                `https://your-shop.myshopify.com/admin/api/2024-01/products/${shopifyId}.json`,
                {
                    method: "DELETE",
                    headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN! },
                    signal: AbortSignal.timeout(10_000)
                }
            ).catch((error) => console.error(`Shopify delete failed for ${shopifyId}`, error))
        );
    }
};
```

## Error Handling

`afterSaveError` runs when the save — or any `afterSave` callback — throws. It is a notification
hook, not a rescue: the transaction rolls back, the row is not saved, and **the error is rethrown
after it runs**. On a request it runs once the rollback is done, outside the failed transaction, so a
delivery it hands to the dispatcher's queue is kept rather than rolled back with the write.

```typescript
import type { CollectionCallbacks } from "@rebasepro/types";

const callbacks: CollectionCallbacks = {
    afterSave: async ({ values }) => {
        // If this throws, the write is rolled back. That is the right behaviour
        // for a validation or an invariant, and the wrong one for a notification.
        await recordAuditEntry(values);
    },
    afterSaveError: async ({ id, values }) => {
        // Runs, and then the error is rethrown. Use it to alert, not to recover.
        console.error(`Save failed for entity ${id}`, values);
    }
};
```

If a failure should *not* cost the user their write, it must not throw out of `afterSave` — catch
it there, or hand the work to the dispatcher's queue.

## Next Steps

- **[Entity Callbacks](/docs/collections/callbacks)** — Full callback reference
- **[Blog CMS Recipe](/docs/recipes/blog-cms)** — Complete blog example
