---
title: "Receita: Integração de Webhook"
sidebar_label: Webhooks
slug: pt/docs/recipes/webhooks
description: Utilize callbacks de entidade para enviar webhooks a serviços externos quando os dados mudam.
---

## Visão Geral

Utilize os callbacks `afterSave` e `afterDelete` para notificar serviços externos quando os dados mudam no Rebase.

## Notificação do Slack em Novo Pedido

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

## Sincronização com API Externa

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

## Tratamento de Erros

Utilize `afterSaveError` para lidar com falhas de forma elegante:

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

## Próximos Passos

-   **[Callbacks de Entidade](/docs/collections/callbacks)** — Referência completa de callbacks
-   **[Receita de Blog CMS](/docs/recipes/blog-cms)** — Exemplo completo de blog

---
