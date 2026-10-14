---
sourceHash: ead814d8414e0434
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
immediatamente — la POST avviene una volta confermata la scrittura, mai per una annullata — e il
dispatcher valida la destinazione, firma il payload, limita ogni tentativo con una scadenza e
ritenta i fallimenti.

Dagli la coda dei job del backend e ogni consegna diventa una riga in `rebase.jobs`: sopravvive a un
deploy o a un crash, viene ritentata con backoff dal worker di qualsiasi istanza la prenda in carico, e un
destinatario non raggiungibile per un giorno costa righe, non memoria. Attiva la coda con
`jobs: { enabled: true }` in `initializeRebaseBackend`, e collega il dispatcher una volta che questa
ha restituito il suo risultato:

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

Sul job viene memorizzato solo l'id del webhook, quindi il suo segreto di firma non finisce mai in `rebase.jobs`. Una
destinazione che il dispatcher rifiuta, o un destinatario che risponde con un redirect, va in dead-letter
dopo un solo tentativo con la motivazione; tutto il resto viene ritentato come qualsiasi job. Vedi
[Webhook persistenti](/docs/backend/jobs#durable-webhooks).

`setCollectionCallbacks` **sostituisce** i callback che la collezione `orders`
dichiara. Se ne dichiara alcuni, mantienili:
passa
`composeCallbacks(declared, { afterSave })`, con `composeCallbacks` da
`@rebasepro/server` e `declared` i `callbacks` della collezione stessa. Vedi
[Combinare Insiemi di Callback](/docs/collections/callbacks/#combining-callback-sets).

### Senza una coda di job

Ometti `jobQueue` — oppure usa un driver senza SQL, dove il backend non ne ha una — e le
consegne vengono messe in coda in memoria, nel processo che ha fatto la modifica. È più semplice, ed è
sufficiente per una notifica che puoi permetterti di perdere:

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

Tieni il dispatcher fuori dal file della collection stesso. Un file di collection viene incluso anche nell'
admin, nel browser: la build ne rimuove i callback, ma un dispatcher costruito in cima al file
e il suo import di `@rebasepro/server` arriverebbero a ogni visitatore, e farebbero fallire la build dell'admin.

Un crash o un deploy tra il commit e la consegna perde l'evento. Ogni webhook ha la propria
coda, quindi un destinatario non raggiungibile ritarda solo le proprie consegne, mai quelle di un altro webhook.
La coda di ciascun webhook contiene al massimo
10.000 consegne in attesa; finché è piena, una nuova consegna viene rifiutata e segnalata a `onDelivery`
con `success: false`, `statusCode: 0`, `attemptNumber: 0` e `responseBody: "queue full"`, e
il log del server lo dice una volta. Chiama `await dispatcher.flush(10_000)` allo spegnimento: attende ciò che
è in coda e si risolve con `false` se il budget si esaurisce prima, perché un destinatario non raggiungibile può
trattenere ciascuna delle sue consegne fino a ~36 secondi di tentativi.

### Cosa riceve il destinatario

Ogni consegna è una `POST` con un body JSON e questi header:

| Header | Valore |
| --- | --- |
| `X-Webhook-Id` | L'`id` del webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` o `DELETE` |
| `X-Webhook-Delivery` | Un id per consegna, lo stesso a ogni tentativo |
| `X-Webhook-Attempt` | Quale tentativo è, a partire da `1` |
| `X-Webhook-Signature` | `sha256=` e l'HMAC-SHA256 esadecimale del body grezzo, con chiave il `secret` del webhook (solo quando ne ha uno) |

Le consegne sono at-least-once: un destinatario che ha risposto troppo lentamente, o un worker morto dopo la
`POST`, fa sì che la stessa consegna arrivi di nuovo. Deduplica su `X-Webhook-Delivery`, e verifica la
firma sul body esattamente com'è arrivato — prima di analizzarlo:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

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
Su Node giudica l'indirizzo a cui ogni
connessione viene effettivamente fatta, all'interno della ricerca DNS della connessione stessa, così un nome il cui record
cambia tra un controllo e la connessione non può eluderlo; il nome di un destinatario viene risolto
una volta per connessione, non una volta per consegna.

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
lancia un'eccezione. È un hook di notifica, non un salvataggio: la transazione viene annullata, la riga
non viene salvata e **l'errore viene rilanciato dopo la sua esecuzione**. In una richiesta viene eseguito
una volta completato il rollback, al di fuori della transazione fallita, quindi una consegna che affida
alla coda del dispatcher viene conservata anziché essere annullata insieme alla scrittura.

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
