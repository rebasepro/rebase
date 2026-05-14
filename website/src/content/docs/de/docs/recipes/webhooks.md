---
title: "Rezept: Webhook-Integration"
sidebar_label: Webhooks
description: Verwenden Sie Entity-Callbacks, um Webhooks an externe Dienste zu senden, wenn sich Daten ändern.
---

## Übersicht

Verwenden Sie die Callbacks `afterSave` und `afterDelete`, um externe Dienste zu benachrichtigen, wenn sich Daten in Rebase ändern.

## Slack-Benachrichtigung bei neuer Bestellung

```typescript
const ordersCollection: EntityCollection = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    callbacks: {
        afterSave: async ({ values, entityId, status }) => {
            if (status === "new") {
                await fetch(process.env.SLACK_WEBHOOK_URL!, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        text: `🛒 New order #${entityId}\nCustomer: ${values.customer_name}\nTotal: $${values.total}`
                    })
                });
            }
        }
    },
    properties: { /* ... */ }
};
```

## Synchronisation mit externer API

```typescript
callbacks: {
    afterSave: async ({ values, entityId }) => {
        // Sync product to Shopify
        await fetch("https://your-shop.myshopify.com/admin/api/2024-01/products.json", {
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
            })
        });
    },

    afterDelete: async ({ entityId, entity }) => {
        // Remove from Shopify
        if (entity.values.shopify_id) {
            await fetch(
                `https://your-shop.myshopify.com/admin/api/2024-01/products/${entity.values.shopify_id}.json`,
                {
                    method: "DELETE",
                    headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN! }
                }
            );
        }
    }
}
```

## Fehlerbehandlung

Verwenden Sie `afterSaveError`, um Fehler elegant zu behandeln:

```typescript
callbacks: {
    afterSave: async ({ values, entityId }) => {
        // This might fail
        await syncToExternalService(values);
    },
    afterSaveError: async ({ entityId, error }) => {
        // Log the error, send alert, or retry
        console.error(`Webhook failed for entity ${entityId}:`, error);
        await sendErrorAlert(entityId, error);
    }
}
```

## Nächste Schritte

- **[Entity-Callbacks](/docs/collections/callbacks)** — Vollständige Callback-Referenz
- **[Blog-CMS-Rezept](/docs/recipes/blog-cms)** — Vollständiges Blog-Beispiel

---
