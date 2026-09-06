---
sourceHash: 713d80a42d70ff87
title: "Ricetta: Integrazione Webhook"
sidebar_label: Webhooks
description: Utilizza i callback delle entità per inviare webhook a servizi esterni quando i dati cambiano, senza tenere aperta la transazione della scrittura.
---

## Panoramica

Utilizza i callback `afterSave` e `afterDelete` per notificare i servizi esterni quando i dati cambiano in Rebase.

Due caratteristiche di questi callback determinano come è scritta questa ricetta, e nessuna delle due è opzionale:

- **Vengono eseguiti dentro la transazione della scrittura.** Tutto ciò che fai con `await` lì
  trattiene una connessione del pool e i lock della riga finché non ritorna. Un destinatario che
  impiega dieci secondi è una transazione di dieci secondi; un destinatario che non risponde mai è
  una transazione che non finisce mai.
- **Un'eccezione lanciata da `afterSave` annulla la scrittura.** L'errore raggiunge il chiamante
  come 500 e la riga non viene salvata. Attendere un servizio di terze parti dentro il callback
  trasforma il loro disservizio nella tua perdita di dati.

Quindi: non usare mai `await` su una richiesta HTTP in uscita dentro un callback. Mettila in coda.

## Notifica Slack per Nuovo Ordine

`WebhookDispatcher` è esportato da `@rebasepro/server`. `enqueueEntityChange` ritorna
immediatamente — la POST avviene dopo il ritorno del callback, fuori dalla transazione — e il
dispatcher valida la destinazione, firma il payload, limita ogni tentativo con una scadenza e
ritenta i fallimenti.

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

La coda è in-process e in memoria: un crash o un deploy tra l'accodamento e la consegna perde
l'evento, e il destinatario può vedere la notifica qualche millisecondo prima che la riga sia
committata. Chiama `await dispatcher.flush()` allo spegnimento. Se le consegne devono sopravvivere
a un riavvio, scrivi una riga di outbox nella stessa transazione e svuotala da un job.

### Chiamare direttamente un endpoint

Se stai inviando un corpo costruito a mano a un singolo endpoint e non vuoi il dispatcher, valgono
le stesse due regole — limita la richiesta, e non lasciare mai che il suo fallimento raggiunga il
chiamante:

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

Non passare mai a un `fetch` nudo un URL che proviene dal tuo database. Il dispatcher rifiuta
destinazioni loopback, link-local, private e schemi diversi da `http(s)` prima di connettersi, e si
rifiuta di seguire i redirect, proprio perché un URL memorizzato è input controllato da un
attaccante.

## Sincronizzazione con API Esterna

`afterDelete` riceve la riga eliminata in forma piatta, come `row` — le colonne della tabella, non un wrapper di entità.

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

## Gestione degli Errori

`afterSaveError` viene eseguito quando il salvataggio — o un qualsiasi callback `afterSave` —
lancia un'eccezione. È un hook di notifica, non un salvataggio: **l'errore viene rilanciato dopo la
sua esecuzione**, la transazione viene annullata e la riga non viene salvata.

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

Se un fallimento *non* deve costare all'utente la sua scrittura, non deve propagarsi fuori da
`afterSave` — gestiscilo lì, o affida il lavoro alla coda del dispatcher.

## Passi Successivi

- **[Callback delle Entità](/docs/collections/callbacks)** — Riferimento completo ai callback
- **[Ricetta CMS per Blog](/docs/recipes/blog-cms)** — Esempio completo di blog

---
