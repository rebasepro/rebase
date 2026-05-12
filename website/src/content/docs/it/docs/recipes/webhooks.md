---
title: "Ricetta: Integrazione Webhook"
sidebar_label: Webhooks
slug: docs/recipes/webhooks
description: Utilizza i callback delle entità per inviare webhook a servizi esterni quando i dati cambiano.
---

## Panoramica

Utilizza i callback `afterSave` e `afterDelete` per notificare i servizi esterni quando i dati cambiano in Rebase.

## Notifica Slack per Nuovo Ordine

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

## Sincronizzazione con API Esterna

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

## Gestione degli Errori

Utilizza `afterSaveError` per gestire i fallimenti in modo elegante:

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

## Passi Successivi

- **[Callback delle Entità](/docs/collections/callbacks)** — Riferimento completo ai callback
- **[Ricetta CMS per Blog](/docs/recipes/blog-cms)** — Esempio completo di blog

---
