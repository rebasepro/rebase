---
title: "Receta: Integración de Webhooks"
sidebar_label: Webhooks
description: Utiliza las devoluciones de llamada de la entidad para enviar webhooks a servicios externos cuando los datos cambien.
---

## Descripción general

Utiliza las devoluciones de llamada `afterSave` y `afterDelete` para notificar a servicios externos cuando los datos cambien en Rebase.

## Notificación de Slack sobre un Nuevo Pedido

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const ordersCollection = defineCollection({
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
});
```

## Sincronización con API Externa

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

## Gestión de Errores

Utiliza `afterSaveError` para gestionar los fallos de forma elegante:

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

## Próximos Pasos

- **[Devoluciones de llamada de entidad](/docs/collections/callbacks)** — Referencia completa de devoluciones de llamada
- **[Receta de CMS para Blog](/docs/recipes/blog-cms)** — Ejemplo completo de blog
