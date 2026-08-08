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
immediately — the POST happens after the callback returns, outside the transaction — and the
dispatcher validates the destination, signs the payload, bounds every attempt with a deadline and
retries failures.

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { WebhookDispatcher } from "@rebasepro/server";

// The row shape, so `values.customer_name` is a string rather than nothing.
type Order = { customer_name: string; total: number };

const dispatcher = new WebhookDispatcher({
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

const ordersCollection: PostgresCollectionConfig<Order> = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    callbacks: {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                // Returns void, immediately. The delivery runs after this
                // callback returns, so the transaction is not waiting on it.
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    },
    properties: { /* ... */ }
};
```

The queue is in-process and in-memory: a crash or a deploy between the enqueue and the delivery
drops the event, and the receiver may see the notification a few milliseconds before the row is
committed. Call `await dispatcher.flush()` on shutdown. If you need deliveries to survive a
restart, write an outbox row in the same transaction and drain it from a job instead.

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
hook, not a rescue: **the error is rethrown after it runs**, the transaction rolls back, and the
row is not saved.

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
