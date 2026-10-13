---
sourceHash: 75953facb59d9645
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
immédiatement — le POST a lieu une fois l'écriture validée, jamais pour une écriture annulée — et le
dispatcher valide la destination, signe la charge utile, borne chaque tentative par un délai et
réessaie les échecs.

Donnez-lui la file de jobs du backend et chaque livraison devient une ligne de `rebase.jobs` : elle survit
à un déploiement ou à un crash, elle est réessayée avec un backoff par le worker de l'instance qui la
réserve, et un destinataire hors service pendant une journée coûte des lignes, pas de la mémoire.
Activez la file avec `jobs: { enabled: true }` dans `initializeRebaseBackend`, et branchez le dispatcher
une fois que celui-ci a retourné :

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

Seul l'id du webhook est stocké dans le job, si bien que son secret de signature ne se trouve jamais dans
`rebase.jobs`. Une destination que le dispatcher refuse, ou un destinataire qui répond par une
redirection, est placé en dead-letter après une seule tentative avec la raison ; tout le reste est réessayé
comme n'importe quel job. Voir [Webhooks durables](/docs/backend/jobs#durable-webhooks).

`setCollectionCallbacks` **remplace** les callbacks que la collection `orders`
déclare. Si elle en déclare, conservez-les :
<span class="since-badge" data-since="0.25">Depuis 0.25</span> passez
`composeCallbacks(declared, { afterSave })`, avec `composeCallbacks` issu de
`@rebasepro/server` et `declared` les `callbacks` propres à la collection. Voir
[Combiner des ensembles de callbacks](/docs/collections/callbacks/#combining-callback-sets).

### Sans file de jobs

Omettez `jobQueue` — ou utilisez un pilote sans SQL, où le backend n'en a pas — et les livraisons sont mises
en file en mémoire, dans le processus qui a fait le changement. C'est plus simple, et cela suffit pour une
notification que vous pouvez vous permettre de perdre :

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

Gardez le dispatcher hors du fichier de collection lui-même. Un fichier de collection est aussi inclus
dans l'admin, dans le navigateur : le build en retire les callbacks, mais un dispatcher construit en haut
du fichier et son import de `@rebasepro/server` seraient livrés à chaque visiteur, et feraient échouer le
build de l'admin.

Un crash ou un déploiement entre la validation et la livraison perd l'événement. Chaque webhook possède sa
propre file : un destinataire hors service ne retarde que ses propres livraisons, jamais celles d'un autre
webhook. <span class="since-badge" data-since="0.25">Depuis 0.25</span> La file de chaque webhook contient au plus 10 000 livraisons en attente ; tant qu'elle est
pleine, une nouvelle livraison est refusée et signalée à `onDelivery` avec `success: false`,
`statusCode: 0`, `attemptNumber: 0` et `responseBody: "queue full"`, et le journal du serveur l'indique une
fois. Appelez `await dispatcher.flush(10_000)` à l'arrêt : l'appel attend ce qui est en file et se résout à
`false` si le délai imparti expire d'abord, car un destinataire hors service peut retenir chacune de ses
livraisons jusqu'à ~36 secondes de nouvelles tentatives.

### Ce que reçoit le destinataire

Chaque livraison est un `POST` avec un corps JSON et ces en-têtes :

| En-tête | Valeur |
| --- | --- |
| `X-Webhook-Id` | L'`id` du webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` ou `DELETE` |
| `X-Webhook-Delivery` | Un id par livraison, identique à chaque tentative |
| `X-Webhook-Attempt` | Le numéro de cette tentative, à partir de `1` |
| `X-Webhook-Signature` | `sha256=` et le HMAC-SHA256 hexadécimal du corps brut, avec le `secret` du webhook comme clé (uniquement s'il en a un) |

Les livraisons sont au moins une fois (at-least-once) : un destinataire qui a répondu trop lentement, ou
un worker mort après le `POST`, fait que la même livraison arrive à nouveau. Dédoublonnez sur
`X-Webhook-Delivery`, et vérifiez la signature sur le corps exactement tel qu'il est arrivé — avant de
l'analyser :

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

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
<span class="since-badge" data-since="0.25">Depuis 0.25</span> Sur Node, il juge l'adresse à laquelle chaque connexion est réellement établie, à l'intérieur de la
résolution DNS propre à la connexion, de sorte qu'un nom dont l'enregistrement change entre une vérification
et la connexion ne peut pas passer à travers ; le nom d'un destinataire est résolu une fois par connexion,
et non une fois par livraison.

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
lève une exception. C'est un hook de notification, pas un sauvetage : la transaction est annulée, la
ligne n'est pas enregistrée et **l'erreur est relancée après son exécution**. Lors d'une requête, il
s'exécute une fois l'annulation terminée, en dehors de la transaction en échec, de sorte qu'une
livraison qu'il confie à la file d'attente du dispatcher est conservée plutôt qu'annulée avec l'écriture.

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
