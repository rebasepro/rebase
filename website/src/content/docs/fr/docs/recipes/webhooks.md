---
sourceHash: 517637e2cfd34608
title: "Recette : Intégration de webhooks"
sidebar_label: Webhooks
description: Utilisez les hooks de table pour envoyer des webhooks à des services externes lorsque les données changent, sans maintenir la transaction d'écriture ouverte.
---

## Vue d'ensemble

Utilisez les [hooks de table](/docs/collections/callbacks/) `afterSave` et `afterDelete` pour notifier des services externes lorsque des données changent dans Rebase.

Deux caractéristiques de ces hooks déterminent la façon dont cette recette est conçue, et aucune des deux n'est facultative :

- **Ils s'exécutent au sein de la transaction de base de données de l'écriture.** Tout ce que vous y attendez avec `await` retient une connexion du pool et les verrous de la ligne jusqu'à ce que l'opération se termine. Un récepteur qui met dix secondes entraîne une transaction de dix secondes ; un récepteur qui ne répond jamais entraîne une transaction qui ne se termine jamais.
- **Une exception levée (`throw`) depuis `afterSave` annule l'écriture (rollback).** L'erreur parvient à l'appelant sous la forme d'une erreur 500 et la ligne n'est pas enregistrée. Attendre un service tiers au sein du hook transforme sa panne en une perte de vos données.

Par conséquent : ne faites jamais de `await` sur une requête HTTP sortante dans un hook. Mettez-la en file d'attente.

## Notification Slack lors d'une nouvelle commande

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`WebhookDispatcher` est exporté depuis `@rebasepro/server`. `enqueueEntityChange` retourne immédiatement — le POST a lieu une fois l'écriture validée (commit), jamais pour une écriture annulée (rollback) — et le dispatcher valide la destination, signe le payload, applique un délai limite à chaque tentative et réessaie en cas d'échec.

Fournissez-lui la file d'attente de tâches (job queue) du backend et chaque distribution devient une ligne dans `rebase.jobs` : elle survit à un déploiement ou à un crash, elle est réessayée avec un backoff par le worker de l'instance qui la prend en charge, et un récepteur hors service pendant une journée coûte des lignes, pas de la mémoire. Activez la file d'attente avec `jobs: { enabled: true }` dans `initializeRebaseBackend`, et connectez le dispatcher une fois celui-ci retourné :

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

    backend.setTableHooks("orders", {
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

Seul l'identifiant du webhook est stocké sur la tâche, ainsi son secret de signature ne se retrouve jamais dans `rebase.jobs`. Une destination refusée par le dispatcher, ou un récepteur qui répond par une redirection, est envoyé en rebut (dead-letter) après une seule tentative avec la raison ; tout le reste est réessayé comme n'importe quelle tâche. Consultez [Webhooks durables](/docs/backend/jobs#durable-webhooks).

`setTableHooks` **remplace** les hooks déclarés par la table `orders`. Si elle en déclare déjà, conservez-les : passez `composeTableHooks(declared, { afterSave })`, avec `composeTableHooks` issu de `@rebasepro/common` et `declared` étant les propres `hooks` de la table (`orders.config.hooks`). Consultez [Combiner des ensembles de hooks](/docs/collections/callbacks/#combining-hook-sets).

### Sans file d'attente de tâches

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Omettez `jobQueue` — ou exécutez votre code là où le backend n'a pas de file d'attente de jobs — et les distributions sont mises en file d'attente en mémoire, dans le processus à l'origine de la modification. C'est plus simple, et cela suffit pour une notification que vous pouvez vous permettre de perdre :

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

    backend.setTableHooks("orders", {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    });
}
```

Gardez le dispatcher en dehors du fichier de table lui-même. `backend/schema` est chargé par chaque commande qui lit le schéma — `rebase db push`, `generate-sdk`, `doctor` — et un dispatcher instancié au début du fichier le serait par chacune d'entre elles. Rattachez-le là où le backend est initialisé, comme illustré ci-dessus.

Un crash ou un déploiement entre le commit et la distribution abandonne l'événement. Chaque webhook dispose de sa propre file d'attente, de sorte qu'un récepteur hors service ne retarde que ses propres distributions, jamais celles d'un autre webhook. La file d'attente de chaque webhook contient au maximum 10 000 distributions en attente ; lorsqu'elle est pleine, toute nouvelle distribution est refusée et signalée à `onDelivery` avec `success: false`, `statusCode: 0`, `attemptNumber: 0` et `responseBody: "queue full"`, et les logs du serveur l'indiquent une fois. Appelez `await dispatcher.flush(10_000)` lors de l'arrêt : il attend ce qui est en file d'attente et résout `false` si le temps imparti s'épuise en premier, car un récepteur hors service peut retenir chacune de ses distributions pendant un maximum d'environ 36 secondes de nouvelles tentatives.

### Ce que le récepteur reçoit

Chaque distribution est une requête `POST` avec un corps JSON et les en-têtes suivants :

| En-tête | Valeur |
| --- | --- |
| `X-Webhook-Id` | L'`id` du webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` ou `DELETE` |
| `X-Webhook-Delivery` | Un identifiant par distribution, identique à chaque tentative |
| `X-Webhook-Attempt` | Le numéro de la tentative en cours, à partir de `1` |
| `X-Webhook-Signature` | `sha256=` et le HMAC-SHA256 hexadécimal du corps brut, signé avec le `secret` du webhook (uniquement lorsqu'il en a un) |

Les distributions s'effectuent au moins une fois (« at-least-once ») : un récepteur qui répond trop lentement, ou un worker qui s'interrompt après le `POST`, signifie que la même distribution arrivera à nouveau. Dédupliquez sur `X-Webhook-Delivery`, et vérifiez la signature sur le corps brut exactement tel qu'il a été reçu — avant de le parser :

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Appeler directement un endpoint

Si vous envoyez un corps personnalisé vers un seul endpoint sans vouloir utiliser le dispatcher, les deux mêmes règles s'appliquent toujours — limitez la durée de la requête dans le temps, et ne laissez jamais son échec atteindre l'appelant :

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

type Order = { customer_name: string; total: number };

const hooks: TableHooks<Order> = {
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
            // a throw *inside* the hook would roll the order back.
            console.error("Slack notification failed", error);
        });
    }
};
```

Ne passez jamais une URL provenant de votre base de données dans un simple `fetch`. Le dispatcher rejette les destinations loopback, link-local, privées et non-`http(s)` avant de s'y connecter, et refuse de suivre les redirections, précisément parce qu'une URL stockée est une entrée contrôlable par un attaquant. Sur Node, il évalue l'adresse réelle vers laquelle chaque connexion est établie, au sein de la résolution DNS même de la connexion, de sorte qu'un nom dont l'enregistrement change entre la vérification et la connexion ne puisse pas tromper le système ; le nom d'un récepteur est résolu une fois par connexion, et non une fois par distribution.

## Synchronisation vers une API externe

`afterDelete` reçoit la ligne supprimée à plat, sous forme de `values` — les colonnes de la table, et non un wrapper d'entité.

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

type Product = { name: string; description: string; price: number; shopify_id: string };

const syncQueue: Promise<unknown>[] = [];

const hooks: TableHooks<Product> = {
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

    afterDelete: async ({ values }) => {
        const shopifyId = values.shopify_id;
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

## Gestion des erreurs

`afterSaveError` s'exécute lorsque l'enregistrement — ou tout hook `afterSave` — lève une exception. Il s'agit d'un hook de notification, pas de récupération : la transaction est annulée (rollback), la ligne n'est pas enregistrée, et **l'erreur est à nouveau levée après son exécution**. Lors d'une requête, il s'exécute une fois le rollback terminé, en dehors de la transaction ayant échoué, de sorte qu'une distribution confiée à la file d'attente du dispatcher est conservée plutôt qu'annulée avec l'écriture.

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

const hooks: TableHooks = {
    afterSave: async ({ values }) => {
        // If this throws, the write is rolled back. That is the right behaviour
        // for a validation or an invariant, and the wrong one for a notification.
        await recordAuditEntry(values);
    },
    afterSaveError: async ({ id, values }) => {
        // Runs, and then the error is rethrown. Use it to alert, not to recover.
        console.error(`Save failed for row ${id}`, values);
    }
};
```

Si un échec ne doit *pas* coûter son écriture à l'utilisateur, il ne doit pas lever d'erreur hors de `afterSave` — interceptez-la (`catch`) sur place, ou confiez le travail à la file d'attente du dispatcher.

## Prochaines étapes

- **[Hooks de table](/docs/collections/callbacks)** — Référence complète des hooks
- **[Recette CMS de blog](/docs/recipes/blog-cms)** — Exemple complet de blog
