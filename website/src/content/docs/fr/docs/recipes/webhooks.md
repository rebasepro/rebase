---
sourceHash: 713d80a42d70ff87
title: "Recette : Intégration de Webhooks"
sidebar_label: Webhooks
description: Utilisez les callbacks d'entité pour envoyer des webhooks à des services externes lorsque les données changent, sans maintenir ouverte la transaction de l'écriture.
---

## Aperçu

Utilisez les callbacks `afterSave` et `afterDelete` pour notifier des services externes lorsque les données changent dans Rebase.

Deux propriétés de ces callbacks déterminent la façon dont cette recette est écrite, et aucune n'est optionnelle :

- **Ils s'exécutent à l'intérieur de la transaction de l'écriture.** Tout ce que vous attendez avec
  `await` y retient une connexion du pool et les verrous de la ligne jusqu'à son retour. Un
  destinataire qui met dix secondes est une transaction de dix secondes ; un destinataire qui ne
  répond jamais est une transaction qui ne se termine jamais.
- **Une exception levée depuis `afterSave` annule l'écriture.** L'erreur atteint l'appelant sous
  forme de 500 et la ligne n'est pas enregistrée. Attendre un tiers dans le callback transforme sa
  panne en votre perte de données.

Donc : n'utilisez jamais `await` sur une requête HTTP sortante dans un callback. Mettez-la en file.

## Notification Slack sur Nouvelle Commande

`WebhookDispatcher` est exporté depuis `@rebasepro/server`. `enqueueEntityChange` retourne
immédiatement — le POST a lieu après le retour du callback, hors de la transaction — et le
dispatcher valide la destination, signe la charge utile, borne chaque tentative par un délai et
réessaie les échecs.

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

La file est en processus et en mémoire : un crash ou un déploiement entre la mise en file et la
livraison perd l'événement, et le destinataire peut voir la notification quelques millisecondes
avant que la ligne ne soit validée. Appelez `await dispatcher.flush()` à l'arrêt. Si les livraisons
doivent survivre à un redémarrage, écrivez une ligne d'outbox dans la même transaction et videz-la
depuis un job.

### Appeler directement un endpoint

Si vous envoyez un corps construit à la main vers un seul endpoint et ne voulez pas du dispatcher,
les deux mêmes règles s'appliquent — bornez la requête, et ne laissez jamais son échec atteindre
l'appelant :

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

Ne passez jamais à un `fetch` nu une URL venue de votre base de données. Le dispatcher refuse les
destinations loopback, link-local, privées et les schémas autres que `http(s)` avant de se
connecter, et refuse de suivre les redirections, précisément parce qu'une URL stockée est une
entrée contrôlée par un attaquant.

## Synchronisation vers une API Externe

`afterDelete` reçoit la ligne supprimée à plat, sous le nom `row` — les colonnes de la table, pas un wrapper d'entité.

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

## Gestion des Erreurs

`afterSaveError` s'exécute lorsque l'enregistrement — ou n'importe quel callback `afterSave` —
lève une exception. C'est un hook de notification, pas un sauvetage : **l'erreur est relancée après
son exécution**, la transaction est annulée et la ligne n'est pas enregistrée.

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

Si un échec ne doit *pas* coûter son écriture à l'utilisateur, il ne doit pas remonter hors de
`afterSave` — attrapez-le là, ou confiez le travail à la file du dispatcher.

## Étapes Suivantes

- **[Callbacks d'Entité](/docs/collections/callbacks)** — Référence complète des callbacks
- **[Recette CMS de Blog](/docs/recipes/blog-cms)** — Exemple complet de blog

---
