---
title: "Recette : Intégration de Webhooks"
sidebar_label: Webhooks
slug: fr/docs/recipes/webhooks
description: Utilisez les callbacks d'entité pour envoyer des webhooks à des services externes lorsque les données changent.
---

## Aperçu

Utilisez les callbacks `afterSave` et `afterDelete` pour notifier les services externes lorsque les données changent dans Rebase.

## Notification Slack sur Nouvelle Commande

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

## Synchronisation vers une API Externe

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

## Gestion des Erreurs

Utilisez `afterSaveError` pour gérer les échecs avec élégance :

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

## Étapes Suivantes

- **[Callbacks d'Entité](/docs/collections/callbacks)** — Référence complète des callbacks
- **[Recette CMS de Blog](/docs/recipes/blog-cms)** — Exemple complet de blog

---
